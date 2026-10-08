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

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomPassword = (n = 16) => Array.from(crypto.randomBytes(n), (b) => ALPHABET[b % ALPHABET.length]).join('');

/** Crée l'opérateur, ou réinitialise son mot de passe s'il existe déjà. */
function upsertOperator(db, { email, name, password }) {
  const mail = String(email || '').trim();
  if (!EMAIL_RE.test(mail)) throw new Error('Adresse e-mail invalide');
  const pw = password || randomPassword();
  if (pw.length < 10) throw new Error('Le mot de passe doit contenir au moins 10 caractères');
  const hash = bcrypt.hashSync(pw, 10);
  const existing = db.prepare('SELECT id FROM operators WHERE email = ?').get(mail);
  if (existing) {
    db.prepare('UPDATE operators SET password_hash = ?, password_changed_at = ?, active = 1, name = COALESCE(?, name) WHERE id = ?')
      .run(hash, new Date().toISOString(), name || null, existing.id);
    return { created: false, email: mail, password: pw };
  }
  db.prepare('INSERT INTO operators (email, name, password_hash) VALUES (?,?,?)').run(mail, name || mail.split('@')[0], hash);
  return { created: true, email: mail, password: pw };
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
    if (!password) console.log(`Mot de passe (affiché une seule fois) : ${r.password}`);
    console.log('Portail : /portal');
    db.close();
  } catch (e) {
    console.error(`Erreur : ${e.message}`);
    process.exit(1);
  }
}

module.exports = { upsertOperator, randomPassword };
