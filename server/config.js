'use strict';

/**
 * Vérification de la configuration de production.
 *
 *  - erreurs : le serveur refuse de démarrer (secret de session absent ou
 *    trop court, adresse publique manquante ou sans HTTPS) ;
 *  - avertissements : fonctionnalités désactivées ou incomplètes (e-mails,
 *    paiements, mentions légales...).
 *
 * Utilisable seule : `npm run check-config` (lit le fichier .env s'il existe).
 */

const STRIPE_VARS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ESSENTIEL', 'STRIPE_PRICE_PRO'];
const LEGAL_VARS = ['LEGAL_COMPANY', 'LEGAL_FORM', 'LEGAL_ADDRESS', 'LEGAL_SIREN', 'LEGAL_EMAIL', 'LEGAL_DIRECTOR', 'LEGAL_COURT', 'HOST_NAME', 'HOST_ADDRESS'];

function checkConfig(env = process.env) {
  const errors = [];
  const warnings = [];
  const prod = env.NODE_ENV === 'production';

  if (!env.JWT_SECRET) {
    (prod ? errors : warnings).push('JWT_SECRET absent : générez-le avec « openssl rand -hex 32 »');
  } else if (env.JWT_SECRET.length < 32) {
    (prod ? errors : warnings).push('JWT_SECRET trop court (32 caractères minimum)');
  }

  if (!env.APP_URL) {
    (prod ? errors : warnings).push('APP_URL absent (adresse publique, ex. https://app.mon-domaine.fr)');
  } else if (prod && !/^https:\/\//.test(env.APP_URL)) {
    errors.push('APP_URL doit commencer par https:// en production');
  }

  if (prod && !env.TRUST_PROXY) warnings.push('TRUST_PROXY non défini : à mettre à 1 derrière Caddy ou Nginx (limitation des tentatives par adresse IP)');

  if (!env.SMTP_HOST) warnings.push('SMTP non configuré : aucun e-mail ne partira (mot de passe oublié, rappels, alertes)');
  else if (!env.MAIL_FROM) warnings.push('MAIL_FROM absent : expéditeur par défaut non délivrable');

  const stripeSet = STRIPE_VARS.filter((k) => env[k]);
  if (stripeSet.length === 0) {
    warnings.push('Stripe non configuré : facturation désactivée, ACCÈS GRATUIT ET ILLIMITÉ pour tous les comptes');
  } else if (stripeSet.length < STRIPE_VARS.length) {
    errors.push(`Stripe partiellement configuré : il manque ${STRIPE_VARS.filter((k) => !env[k]).join(', ')}`);
  } else if (prod && env.STRIPE_SECRET_KEY.startsWith('sk_test_')) {
    warnings.push('Clé Stripe de TEST en production : aucun paiement réel ne sera encaissé');
  }

  const legalMissing = LEGAL_VARS.filter((k) => !env[k]);
  if (legalMissing.length) warnings.push(`Mentions légales incomplètes : ${legalMissing.join(', ')}`);
  if (!env.CONTACT_EMAIL && !env.LEGAL_EMAIL) warnings.push('CONTACT_EMAIL absent : les demandes de démo ne vous seront pas transmises');

  if (prod && (!env.RESTIC_REPOSITORY || !env.RESTIC_PASSWORD)) {
    warnings.push('Sauvegardes externes non configurées (RESTIC_REPOSITORY, RESTIC_PASSWORD) : une panne du serveur ferait tout perdre');
  }

  return { errors, warnings };
}

/** Lit un fichier .env simple (CLE=valeur, guillemets facultatifs) sans écraser l'environnement. */
function loadEnvFile(file) {
  const fs = require('fs');
  if (!fs.existsSync(file)) return false;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
  return true;
}

function report({ errors, warnings }, log = console) {
  for (const e of errors) log.error(`✖ ${e}`);
  for (const w of warnings) log.warn(`⚠ ${w}`);
  if (!errors.length && !warnings.length) log.log('✔ Configuration complète');
}

if (require.main === module) {
  const path = require('path');
  loadEnvFile(path.join(__dirname, '..', '.env'));
  const result = checkConfig();
  report(result);
  process.exit(result.errors.length ? 1 : 0);
}

module.exports = { checkConfig, loadEnvFile, report };
