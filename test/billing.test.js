'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Stripe = require('stripe');
const { openDb } = require('../server/db');
const { createApp } = require('../server/app');
const { createMemoryMailer } = require('../server/mailer');
const { accessFor } = require('../server/billing');

const WEBHOOK_SECRET = 'whsec_test_secret';
const realStripe = new Stripe('sk_test_dummy');

// Faux client Stripe : enregistre les appels, aucun accès réseau.
const calls = { customers: [], checkout: [], portal: [] };
const fakeStripe = {
  customers: { create: async (p) => { calls.customers.push(p); return { id: `cus_${calls.customers.length}` }; } },
  checkout: { sessions: { create: async (p) => { calls.checkout.push(p); return { url: 'https://checkout.stripe.test/session' }; } } },
  billingPortal: { sessions: { create: async (p) => { calls.portal.push(p); return { url: 'https://billing.stripe.test/portal' }; } } },
  webhooks: realStripe.webhooks,
};

let server;
let base;
let db;

async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
}

async function signup(email, template) {
  const r = await call('/api/auth/signup', {
    method: 'POST',
    body: { organization: `Org ${email}`, name: 'Admin', email, password: 'motdepasse', template },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { token: r.body.token, orgId: r.body.user.org_id };
}

function sendWebhook(event, { secret = WEBHOOK_SECRET } = {}) {
  const payload = JSON.stringify(event);
  const header = realStripe.webhooks.generateTestHeaderString({ payload, secret });
  return fetch(`${base}/api/billing/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': header },
    body: payload,
  });
}

function subscriptionEvent(type, { orgId, status, price, customer = 'cus_x' }) {
  return {
    id: `evt_${Math.random()}`,
    type,
    data: {
      object: {
        id: 'sub_123',
        object: 'subscription',
        customer,
        status,
        metadata: { org_id: String(orgId) },
        items: { data: [{ price: { id: price }, current_period_end: 1893456000 }] },
      },
    },
  };
}

test.before(async () => {
  db = openDb(':memory:');
  const app = createApp(db, {
    billing: { stripe: fakeStripe, prices: { essentiel: 'price_ess', pro: 'price_pro' }, webhookSecret: WEBHOOK_SECRET },
    mailer: createMemoryMailer(),
  });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('modèles de métiers : listés publiquement et appliqués à l\'inscription', async () => {
  const list = await call('/api/templates');
  assert.ok(list.body.length >= 6);
  assert.ok(list.body.find((t) => t.key === 'boulangerie'));

  const { token } = await signup('boulanger@test.fr', 'boulangerie');
  const equipment = (await call('/api/equipment', { token })).body;
  assert.ok(equipment.some((e) => e.name === 'Vitrine pâtisseries'));
  const tasks = (await call('/api/cleaning-tasks', { token })).body;
  assert.ok(tasks.some((t) => t.name === 'Pétrin'));
  const shelf = (await call('/api/shelf-lives', { token })).body;
  assert.ok(shelf.some((s) => s.product === 'Crème pâtissière' && s.days === 1));
  assert.equal((await call('/api/me', { token })).body.organization.activity, 'Boulangerie / pâtisserie');

  // Réappliquer n'ajoute pas de doublons.
  const again = await call('/api/organization/template', { token, method: 'POST', body: { template: 'boulangerie' } });
  assert.deepEqual(again.body, { equipment: 0, cleaning: 0, shelfLives: 0 });
  // Un autre modèle complète sans dupliquer les éléments communs.
  const more = await call('/api/organization/template', { token, method: 'POST', body: { template: 'traiteur' } });
  assert.ok(more.body.equipment > 0);
  const names = (await call('/api/cleaning-tasks', { token })).body.map((t) => t.name.toLowerCase());
  assert.equal(names.length, new Set(names).size, 'aucun doublon');

  assert.equal((await call('/api/auth/signup', {
    method: 'POST', body: { organization: 'X', name: 'X', email: 'x@test.fr', password: 'motdepasse', template: 'inconnu' },
  })).status, 400);
});

test('modèle vierge : aucune donnée préremplie', async () => {
  const { token } = await signup('vierge@test.fr');
  assert.equal((await call('/api/equipment', { token })).body.length, 0);
});

test('essai gratuit de 30 jours à l\'inscription', async () => {
  const { token } = await signup('essai@test.fr', 'restaurant');
  const me = (await call('/api/me', { token })).body;
  assert.equal(me.access.state, 'trial');
  assert.equal(me.access.trialDaysLeft, 30);
  assert.equal(me.access.readOnly, false);
  assert.equal(me.organization.stripe_customer_id, undefined, 'identifiants Stripe non exposés');
});

test('souscription via Stripe Checkout (administrateur uniquement)', async () => {
  const { token, orgId } = await signup('checkout@test.fr', 'restaurant');
  assert.equal((await call('/api/billing/checkout', { token, method: 'POST', body: { plan: 'gold' } })).status, 400);
  const r = await call('/api/billing/checkout', { token, method: 'POST', body: { plan: 'pro' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.url, 'https://checkout.stripe.test/session');
  const params = calls.checkout.at(-1);
  assert.equal(params.mode, 'subscription');
  assert.equal(params.line_items[0].price, 'price_pro');
  assert.equal(params.client_reference_id, String(orgId));
  assert.equal(params.subscription_data.metadata.org_id, String(orgId));
  assert.match(params.success_url, /#\/billing\?checkout=success$/);
  // Le client Stripe est créé une seule fois.
  const before = calls.customers.length;
  await call('/api/billing/checkout', { token, method: 'POST', body: { plan: 'essentiel' } });
  assert.equal(calls.customers.length, before);
  assert.equal(calls.checkout.at(-1).line_items[0].price, 'price_ess');

  await call('/api/users', { token, method: 'POST', body: { name: 'E', email: 'emp-co@test.fr', password: 'motdepasse', role: 'manager' } });
  const emp = (await call('/api/auth/login', { method: 'POST', body: { email: 'emp-co@test.fr', password: 'motdepasse' } })).body.token;
  assert.equal((await call('/api/billing/checkout', { token: emp, method: 'POST', body: { plan: 'pro' } })).status, 403);

  const portal = await call('/api/billing/portal', { token, method: 'POST' });
  assert.equal(portal.body.url, 'https://billing.stripe.test/portal');
});

test('fin d\'essai sans abonnement → lecture seule, données toujours consultables', async () => {
  const { token, orgId } = await signup('expire@test.fr', 'restaurant');
  db.prepare('UPDATE organizations SET trial_ends_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', orgId);
  const me = (await call('/api/me', { token })).body;
  assert.equal(me.access.state, 'expired');
  assert.equal(me.access.readOnly, true);

  const eq = (await call('/api/equipment', { token })).body;
  assert.ok(eq.length > 0, 'lecture autorisée');
  const blocked = await call('/api/temperatures', { token, method: 'POST', body: { equipment_id: eq[0].id, value: 2 } });
  assert.equal(blocked.status, 402);
  assert.equal(blocked.body.code, 'subscription_required');
  const pdf = await fetch(`${base}/api/reports/haccp.pdf`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(pdf.status, 200, 'export PDF toujours possible');
  assert.equal((await call('/api/billing/checkout', { token, method: 'POST', body: { plan: 'pro' } })).status, 200);
});

test('webhook : signature vérifiée, abonnement activé puis résilié', async () => {
  const { token, orgId } = await signup('webhook@test.fr', 'restaurant');
  db.prepare('UPDATE organizations SET trial_ends_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', orgId);

  const forged = await sendWebhook(subscriptionEvent('customer.subscription.created', { orgId, status: 'active', price: 'price_pro' }), { secret: 'whsec_mauvais' });
  assert.equal(forged.status, 400);
  assert.equal((await call('/api/me', { token })).body.access.state, 'expired');

  const ok = await sendWebhook(subscriptionEvent('customer.subscription.created', { orgId, status: 'active', price: 'price_ess' }));
  assert.equal(ok.status, 200);
  let me = (await call('/api/me', { token })).body;
  assert.equal(me.access.state, 'active');
  assert.equal(me.access.plan, 'essentiel');
  assert.equal(me.access.currentPeriodEnd, '2030-01-01T00:00:00.000Z');
  const eq = (await call('/api/equipment', { token })).body;
  assert.equal((await call('/api/temperatures', { token, method: 'POST', body: { equipment_id: eq[0].id, value: 2 } })).status, 201);
  assert.equal((await call('/api/billing/checkout', { token, method: 'POST', body: { plan: 'pro' } })).status, 409);

  // Offre Essentiel : 3 utilisateurs actifs maximum.
  for (const n of [1, 2]) {
    const r = await call('/api/users', { token, method: 'POST', body: { name: `U${n}`, email: `u${n}-wh@test.fr`, password: 'motdepasse', role: 'employee' } });
    assert.equal(r.status, 201);
  }
  const fourth = await call('/api/users', { token, method: 'POST', body: { name: 'U3', email: 'u3-wh@test.fr', password: 'motdepasse', role: 'employee' } });
  assert.equal(fourth.status, 403);
  assert.match(fourth.body.error, /3 utilisateurs/);

  // Paiement en échec : accès maintenu avec avertissement.
  await sendWebhook(subscriptionEvent('customer.subscription.updated', { orgId, status: 'past_due', price: 'price_ess' }));
  me = (await call('/api/me', { token })).body;
  assert.equal(me.access.state, 'past_due');
  assert.equal(me.access.readOnly, false);

  // Passage à Pro : plus de limite d'utilisateurs.
  await sendWebhook(subscriptionEvent('customer.subscription.updated', { orgId, status: 'active', price: 'price_pro' }));
  assert.equal((await call('/api/me', { token })).body.access.plan, 'pro');
  assert.equal((await call('/api/users', { token, method: 'POST', body: { name: 'U3', email: 'u3-wh@test.fr', password: 'motdepasse', role: 'employee' } })).status, 201);

  // Résiliation : retour en lecture seule.
  await sendWebhook(subscriptionEvent('customer.subscription.deleted', { orgId, status: 'canceled', price: 'price_pro' }));
  me = (await call('/api/me', { token })).body;
  assert.equal(me.access.state, 'expired');
  assert.equal((await call('/api/temperatures', { token, method: 'POST', body: { equipment_id: eq[0].id, value: 2 } })).status, 402);
});

test('webhook checkout.session.completed : rattache le client Stripe', async () => {
  const { orgId } = await signup('cs@test.fr');
  const res = await sendWebhook({
    id: 'evt_cs', type: 'checkout.session.completed',
    data: { object: { object: 'checkout.session', client_reference_id: String(orgId), customer: 'cus_cs', subscription: 'sub_cs' } },
  });
  assert.equal(res.status, 200);
  const org = db.prepare('SELECT stripe_customer_id, stripe_subscription_id FROM organizations WHERE id = ?').get(orgId);
  assert.deepEqual({ ...org }, { stripe_customer_id: 'cus_cs', stripe_subscription_id: 'sub_cs' });
});

test('accessFor : facturation désactivée = accès illimité', () => {
  assert.equal(accessFor({}, { enabled: false }).state, 'unlimited');
  assert.equal(accessFor({ subscription_status: 'incomplete', trial_ends_at: '2999-01-01T00:00:00Z' }, { enabled: true }).state, 'trial');
});
