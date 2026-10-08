'use strict';

/**
 * Création et gestion des clients (établissements) et de leurs utilisateurs.
 *
 * Il n'y a pas d'inscription publique : seuls les opérateurs du portail créent
 * des clients. Un utilisateur créé ici reçoit un mot de passe aléatoire
 * inutilisable ; il choisit le sien grâce à un lien d'invitation à usage unique.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { TEMPLATES, applyTemplate } = require('./templates');
const { trialEnd, TRIAL_DAYS } = require('./billing');
const { compose, APP_NAME } = require('./mailer');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['admin', 'manager', 'employee'];
const INVITE_TTL_MS = 7 * 86400000;

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function text(value, max, { required = false, label = 'Champ' } = {}) {
  const v = String(value ?? '').trim();
  if (required && !v) throw fail(`${label} requis`);
  if (v.length > max) throw fail(`${label} trop long (${max} caractères maximum)`);
  return v || null;
}

function email(value) {
  const v = String(value ?? '').trim();
  if (!EMAIL_RE.test(v)) throw fail('Adresse e-mail invalide');
  return v;
}

function timezone(value) {
  const tz = String(value || 'Europe/Paris');
  try { new Intl.DateTimeFormat('fr-FR', { timeZone: tz }); } catch { throw fail('Fuseau horaire invalide'); }
  return tz;
}

/** Champs modifiables d'un établissement depuis le portail. */
function orgFields(b) {
  return {
    name: text(b.name, 120, { required: true, label: 'Nom de l\'établissement' }),
    group_name: text(b.group_name, 120),
    siret: text(b.siret, 20),
    activity: text(b.activity, 120),
    address: text(b.address, 300),
    timezone: timezone(b.timezone),
  };
}

const emailTaken = (db, value, exceptId = null) => !!db
  .prepare('SELECT 1 FROM users WHERE email = ? AND id IS NOT ?').get(value, exceptId);

/**
 * Crée un établissement et son administrateur.
 * input : champs de l'établissement + template, mode ('trial' | 'active' | 'auto'), trial_days, admin { name, email }.
 */
function createCustomer(db, input, { operatorId = null } = {}) {
  const f = orgFields(input);
  const admin = { name: text(input.admin?.name, 100, { required: true, label: 'Nom de l\'administrateur' }), email: email(input.admin?.email) };
  if (input.template && !TEMPLATES[input.template]) throw fail('Modèle de métier inconnu');
  const mode = ['trial', 'active', 'auto'].includes(input.mode) ? input.mode : 'trial'; // auto : paiement en ligne (Stripe)
  const days = Number(input.trial_days ?? TRIAL_DAYS);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw fail('Durée d\'essai invalide (1 à 365 jours)');
  if (emailTaken(db, admin.email)) throw fail('Un compte existe déjà avec cet e-mail', 409);
  return db.transaction(() => {
    const info = db.prepare(`INSERT INTO organizations (name, group_name, siret, activity, address, timezone, access_mode, trial_ends_at, created_by_operator)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(f.name, f.group_name, f.siret, f.activity, f.address, f.timezone, mode, trialEnd(Date.now(), days), operatorId);
    const orgId = Number(info.lastInsertRowid);
    if (input.template) applyTemplate(db, orgId, input.template);
    const userId = addUser(db, orgId, { name: admin.name, email: admin.email, role: 'admin' });
    return {
      org: db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId),
      admin: db.prepare('SELECT * FROM users WHERE id = ?').get(userId),
    };
  })();
}

/** Ajoute un utilisateur avec un mot de passe aléatoire : il n'a pas encore de moyen de se connecter. */
function addUser(db, orgId, { name, email: mail, role }) {
  if (!ROLES.includes(role)) throw fail('Rôle invalide');
  const hash = bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 10);
  return Number(db.prepare('INSERT INTO users (org_id, email, password_hash, name, role) VALUES (?,?,?,?,?)')
    .run(orgId, mail, hash, name, role).lastInsertRowid);
}

/** Lien à usage unique pour choisir son mot de passe (invitation ou nouvelle demande). */
function createInvitation(db, userId, baseUrl) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(userId);
  db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,?)')
    .run(userId, sha256(token), new Date(Date.now() + INVITE_TTL_MS).toISOString());
  return `${baseUrl}/app#/reset?token=${token}`;
}

/** E-mail d'invitation ; renvoie true si le message est parti (SMTP configuré). */
async function sendInvitation(mailer, { user, org, url, again = false }) {
  if (!mailer.configured) return false;
  await mailer.send({
    to: user.email,
    ...compose({
      subject: again ? `Votre lien de connexion – ${org.name}` : `Votre espace ${org.name} est prêt`,
      blocks: [
        `Bonjour ${user.name},`,
        again
          ? `Voici un nouveau lien pour choisir votre mot de passe et accéder à l'espace « ${org.name} » sur ${APP_NAME}.`
          : `Votre espace « ${org.name} » est prêt sur ${APP_NAME} : relevés de températures, plan de nettoyage, réceptions, alertes et classeur pour les contrôles.`,
        'Choisissez votre mot de passe avec le bouton ci-dessous. Ce lien est valable 7 jours et ne peut servir qu\'une fois.',
        { button: 'Choisir mon mot de passe', url },
        'Une fois connecté, vous retrouverez l\'application à la même adresse. Si ce message ne vous concerne pas, ignorez-le.',
      ],
    }),
  });
  return true;
}

module.exports = {
  EMAIL_RE, ROLES, INVITE_TTL_MS, fail, text, email, orgFields, emailTaken,
  createCustomer, addUser, createInvitation, sendInvitation,
};
