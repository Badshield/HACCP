'use strict';

/**
 * Abonnements Stripe.
 *
 * Fonctionnement :
 *  - à l'inscription, l'établissement a un essai gratuit (TRIAL_DAYS, sans carte) ;
 *  - l'administrateur souscrit via Stripe Checkout, puis gère carte et
 *    factures via le portail client Stripe ;
 *  - Stripe informe l'application par webhook (source de vérité du statut) ;
 *  - sans abonnement valide, le compte passe en LECTURE SEULE : les registres
 *    HACCP restent consultables et exportables, seules les saisies sont bloquées.
 *
 * Si Stripe n'est pas configuré (développement, installation sur site), la
 * facturation est désactivée et l'accès est illimité.
 */

const express = require('express');
const { requireRole } = require('./auth');

const TRIAL_DAYS = Number(process.env.TRIAL_DAYS) || 30;

const PLANS = {
  essentiel: {
    label: 'Essentiel',
    price: 19,
    maxUsers: 3,
    features: ['Tous les registres HACCP', 'Classeur PDF pour les contrôles', 'Modèles par métier', "Jusqu'à 3 utilisateurs"],
  },
  pro: {
    label: 'Pro',
    price: 39,
    maxUsers: null,
    features: ['Tout Essentiel', 'Utilisateurs illimités', 'Idéal pour les équipes en roulement', 'Support prioritaire'],
  },
};

// Statuts Stripe qui donnent accès en écriture. « past_due » : Stripe relance
// le paiement pendant quelques jours, on laisse travailler avec un avertissement.
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

function trialEnd(from = Date.now()) {
  return new Date(from + TRIAL_DAYS * 86400000).toISOString();
}

/** Calcule les droits d'un établissement à partir de son état d'abonnement. */
function accessFor(org, { enabled }, now = Date.now()) {
  if (!enabled) return { state: 'unlimited', readOnly: false, plan: null, maxUsers: null };
  if (org.subscription_status && ACTIVE_STATUSES.has(org.subscription_status)) {
    const plan = PLANS[org.plan] ? org.plan : 'pro';
    return {
      state: org.subscription_status === 'past_due' ? 'past_due' : 'active',
      readOnly: false,
      plan,
      maxUsers: PLANS[plan].maxUsers,
      currentPeriodEnd: org.current_period_end,
    };
  }
  const trialEndsAt = org.trial_ends_at ? Date.parse(org.trial_ends_at) : 0;
  // L'essai reste valable même si un premier paiement est en cours (statut « incomplete »).
  if (trialEndsAt > now) {
    return {
      state: 'trial',
      readOnly: false,
      plan: 'pro',
      maxUsers: null,
      trialEndsAt: org.trial_ends_at,
      trialDaysLeft: Math.ceil((trialEndsAt - now) / 86400000),
    };
  }
  return { state: 'expired', readOnly: true, plan: null, maxUsers: PLANS.essentiel.maxUsers, subscriptionStatus: org.subscription_status };
}

function createBilling(db, opts = {}) {
  let stripe = opts.stripe;
  if (stripe === undefined && process.env.STRIPE_SECRET_KEY) {
    const Stripe = require('stripe');
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  const prices = opts.prices || {
    essentiel: process.env.STRIPE_PRICE_ESSENTIEL,
    pro: process.env.STRIPE_PRICE_PRO,
  };
  const webhookSecret = opts.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET;
  const enabled = !!(stripe && prices.essentiel && prices.pro);
  const planByPrice = Object.fromEntries(Object.entries(prices).map(([plan, id]) => [id, plan]));

  const getOrg = db.prepare('SELECT * FROM organizations WHERE id = ?');
  const access = (orgOrId) => accessFor(typeof orgOrId === 'object' ? orgOrId : getOrg.get(orgOrId), { enabled });

  function appUrl(req) {
    return (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  }

  // ---------- Garde : lecture seule sans abonnement ----------
  const WRITE_ALLOWED = [/^\/billing\//, /^\/me\/password$/];
  function guard(req, res, next) {
    if (req.method === 'GET' || WRITE_ALLOWED.some((re) => re.test(req.path))) return next();
    if (access(req.user.org_id).readOnly) {
      return res.status(402).json({
        error: 'Votre période d\'essai ou votre abonnement est terminé. Vos registres restent consultables ; abonnez-vous pour continuer à saisir.',
        code: 'subscription_required',
      });
    }
    next();
  }

  // ---------- Webhook (corps brut obligatoire pour vérifier la signature) ----------
  function syncSubscription(sub) {
    const orgId = Number(sub.metadata?.org_id)
      || db.prepare('SELECT id FROM organizations WHERE stripe_customer_id = ?').get(sub.customer)?.id;
    if (!orgId) return;
    const item = sub.items?.data?.[0];
    const plan = planByPrice[item?.price?.id] || null;
    const periodEnd = item?.current_period_end ?? sub.current_period_end;
    db.prepare(`UPDATE organizations SET subscription_status = ?, stripe_subscription_id = ?, stripe_customer_id = ?,
        plan = COALESCE(?, plan), current_period_end = ? WHERE id = ?`)
      .run(sub.status, sub.id, sub.customer, plan, periodEnd ? new Date(periodEnd * 1000).toISOString() : null, orgId);
  }

  function webhook(req, res) {
    if (!stripe || !webhookSecret) return res.status(400).json({ error: 'Webhook non configuré' });
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, req.get('stripe-signature'), webhookSecret);
    } catch (e) {
      return res.status(400).json({ error: `Signature invalide : ${e.message}` });
    }
    const obj = event.data.object;
    switch (event.type) {
      case 'checkout.session.completed': {
        const orgId = Number(obj.client_reference_id);
        if (orgId && obj.customer) {
          db.prepare(`UPDATE organizations SET stripe_customer_id = ?, stripe_subscription_id = COALESCE(?, stripe_subscription_id)
            WHERE id = ?`).run(obj.customer, obj.subscription, orgId);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed':
        syncSubscription(obj);
        break;
      default:
        break;
    }
    res.json({ received: true });
  }

  // ---------- Routes authentifiées ----------
  const router = express.Router();

  router.get('/', (req, res) => {
    const org = getOrg.get(req.user.org_id);
    res.json({
      enabled,
      access: access(org),
      plan: org.plan,
      subscriptionStatus: org.subscription_status,
      hasCustomer: !!org.stripe_customer_id,
      plans: Object.entries(PLANS).map(([key, p]) => ({ key, ...p })),
    });
  });

  router.post('/checkout', requireRole('admin'), async (req, res, next) => {
    try {
      if (!enabled) return res.status(400).json({ error: 'La facturation n\'est pas configurée' });
      const plan = req.body?.plan;
      if (!PLANS[plan]) return res.status(400).json({ error: 'Offre inconnue' });
      const org = getOrg.get(req.user.org_id);
      if (org.subscription_status && ACTIVE_STATUSES.has(org.subscription_status)) {
        return res.status(409).json({ error: 'Un abonnement est déjà actif : utilisez « Gérer mon abonnement » pour changer d\'offre' });
      }
      let customer = org.stripe_customer_id;
      if (!customer) {
        const c = await stripe.customers.create({
          email: req.user.email,
          name: org.name,
          metadata: { org_id: String(org.id) },
          preferred_locales: ['fr'],
        });
        customer = c.id;
        db.prepare('UPDATE organizations SET stripe_customer_id = ? WHERE id = ?').run(customer, org.id);
      }
      const base = appUrl(req);
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer,
        client_reference_id: String(org.id),
        line_items: [{ price: prices[plan], quantity: 1 }],
        subscription_data: { metadata: { org_id: String(org.id) } },
        allow_promotion_codes: true,
        billing_address_collection: 'required',
        tax_id_collection: { enabled: true },
        customer_update: { name: 'auto', address: 'auto' },
        ...(process.env.STRIPE_AUTOMATIC_TAX === '1' ? { automatic_tax: { enabled: true } } : {}),
        locale: 'fr',
        success_url: `${base}/#/billing?checkout=success`,
        cancel_url: `${base}/#/billing`,
      });
      res.json({ url: session.url });
    } catch (e) {
      next(e);
    }
  });

  router.post('/portal', requireRole('admin'), async (req, res, next) => {
    try {
      if (!enabled) return res.status(400).json({ error: 'La facturation n\'est pas configurée' });
      const org = getOrg.get(req.user.org_id);
      if (!org.stripe_customer_id) return res.status(400).json({ error: 'Aucun abonnement à gérer' });
      const session = await stripe.billingPortal.sessions.create({
        customer: org.stripe_customer_id,
        locale: 'fr',
        return_url: `${appUrl(req)}/#/billing`,
      });
      res.json({ url: session.url });
    } catch (e) {
      next(e);
    }
  });

  return { enabled, access, guard, webhook, router };
}

module.exports = { createBilling, accessFor, trialEnd, PLANS, TRIAL_DAYS };
