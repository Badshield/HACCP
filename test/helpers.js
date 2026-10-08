'use strict';

const bcrypt = require('bcryptjs');
const { createCustomer } = require('../server/tenants');
const { signToken } = require('../server/auth');
const { TERMS_VERSION } = require('../server/legal');

/**
 * Crée un client comme le fait le portail (il n'y a plus d'inscription publique) et ouvre une session
 * pour son administrateur. Par défaut : accès « auto » (comme avant le portail) et CGV acceptées.
 */
function makeCustomer(db, { email, template, orgName, name = 'Admin', password = 'motdepasse', terms = true, mode = 'auto', group } = {}) {
  const { org, admin } = createCustomer(db, { name: orgName || `Org ${email}`, group_name: group, template, admin: { name, email } });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 4), admin.id);
  db.prepare('UPDATE organizations SET access_mode = ? WHERE id = ?').run(mode, org.id);
  if (terms) db.prepare('UPDATE organizations SET terms_accepted_at = ?, terms_version = ? WHERE id = ?').run(new Date().toISOString(), TERMS_VERSION, org.id);
  return { token: signToken(admin), orgId: org.id, userId: admin.id };
}

module.exports = { makeCustomer };
