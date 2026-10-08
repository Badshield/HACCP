'use strict';

/**
 * Crée ou réinitialise un opérateur du portail prestataire.
 *
 *   node server/operator-cli.js <e-mail> [nom] [mot de passe]
 *   npm run operator -- vous@exemple.fr "Votre Nom"
 *
 * Sans mot de passe, un mot de passe aléatoire est généré et affiché une seule fois.
 * Sur le serveur : docker compose exec app node server/operator-cli.js vous@exemple.fr "Votre Nom"
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { openDb } = require('./db');
const { EMAIL_RE } = require('./tenants');

/** Accès de départ du portail, utilisé en test local uniquement (jamais créé en production sans configuration). */
const DEFAULT_OPERATOR = { email: 'admin@releveo.local', name: 'Administrateur', password: 'ChangeMoi-2026' };

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomPassword = (n = 16) => Array.from(crypto.randomBytes(n), (b) => ALPHABET[b % ALPHABET.length]).join('');

/**
 * Crée l'opérateur, ou réinitialise son mot de passe s'il existe déjà.
 * mustChange : le portail impose de choisir un nouveau mot de passe à la première connexion
 * (par défaut : oui quand le mot de passe est provisoire, non quand vous en imposez un).
 */
function upsertOperator(db, { email, name, password, mustChange }) {
  const mail = String(email || '').trim();
  if (!EMAIL_RE.test(mail)) throw new Error('Adresse e-mail invalide');
  const pw = password || randomPassword();
  if (pw.length < 10) throw new Error('Le mot de passe doit contenir au moins 10 caractères');
  const change = (mustChange ?? !password) ? 1 : 0;
  const hash = bcrypt.hashSync(pw, 10);
  const existing = db.prepare('SELECT id FROM operators WHERE email = ?').get(mail);
  if (existing) {
    db.prepare('UPDATE operators SET password_hash = ?, password_changed_at = ?, must_change_password = ?, active = 1, name = COALESCE(?, name) WHERE id = ?')
      .run(hash, new Date().toISOString(), change, name || null, existing.id);
    return { created: false, email: mail, password: pw, mustChange: !!change };
  }
  db.prepare('INSERT INTO operators (email, name, password_hash, must_change_password) VALUES (?,?,?,?)').run(mail, name || mail.split('@')[0], hash, change);
  return { created: true, email: mail, password: pw, mustChange: !!change };
}

/**
 * Garantit un premier accès au portail quand aucun opérateur n'existe :
 *  - OPERATOR_EMAIL + OPERATOR_PASSWORD (.env) : accès créé à l'installation du serveur ;
 *  - sinon, hors production : l'accès par défaut ci-dessus (test local).
 * En production sans configuration, rien n'est créé : jamais d'identifiant connu d'avance sur un serveur en ligne.
 * Dans tous les cas, le portail impose de changer le mot de passe à la première connexion.
 * Renvoie { email, password, source } si un accès vient d'être créé, sinon null.
 */
function ensureDefaultOperator(db, env = process.env) {
  if (db.prepare('SELECT 1 FROM operators LIMIT 1').get()) return null;
  if (env.OPERATOR_EMAIL || env.OPERATOR_PASSWORD) {
    if (!env.OPERATOR_EMAIL || !env.OPERATOR_PASSWORD) throw new Error('OPERATOR_EMAIL et OPERATOR_PASSWORD doivent être renseignés ensemble');
    const r = upsertOperator(db, { email: env.OPERATOR_EMAIL, name: env.OPERATOR_NAME || 'Administrateur', password: env.OPERATOR_PASSWORD, mustChange: true });
    return { email: r.email, password: r.password, source: 'env' };
  }
  if (env.NODE_ENV === 'production') return null;
  const r = upsertOperator(db, { ...DEFAULT_OPERATOR, mustChange: true });
  return { email: r.email, password: r.password, source: 'default' };
}

/** L'accès par défaut est-il encore en place (mot de passe jamais changé) ? */
function defaultOperatorPending(db) {
  return !!db.prepare('SELECT 1 FROM operators WHERE email = ? AND must_change_password = 1').get(DEFAULT_OPERATOR.email);
}

if (require.main === module) {
  const [email, name, password] = process.argv.slice(2);
  if (!email) {
    console.error('Usage : node server/operator-cli.js <e-mail> [nom] [mot de passe]');
    process.exit(1);
  }
  try {
    const db = openDb();
    const r = upsertOperator(db, { email, name, password });
    console.log(`${r.created ? 'Opérateur créé' : 'Mot de passe réinitialisé'} : ${r.email}`);
    if (!password) console.log(`Mot de passe provisoire (affiché une seule fois) : ${r.password}\nLe portail vous demandera d'en choisir un nouveau à la première connexion.`);
    console.log('Portail : /portal');
    db.close();
  } catch (e) {
    console.error(`Erreur : ${e.message}`);
    process.exit(1);
  }
}

module.exports = { upsertOperator, ensureDefaultOperator, defaultOperatorPending, DEFAULT_OPERATOR, randomPassword };
