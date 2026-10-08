'use strict';

/**
 * Portail prestataire (/portal) : pilotage de tous les clients par vous et votre équipe SAV.
 *
 *  - création des clients (établissement, administrateur, modèle de métier) : il n'y a pas d'inscription publique ;
 *  - rattachement des adresses e-mail, invitations par lien à usage unique, désactivation d'un utilisateur ;
 *  - pilotage de l'accès : essai daté, actif, suspendu (lecture seule) ;
 *  - consultation EN LECTURE SEULE de tout ce que fait chaque client : activité, registres, classeur PDF ;
 *  - notes internes du SAV et journal des actions faites depuis le portail.
 *
 * Étanchéité : les opérateurs ont leur propre table, leurs propres jetons (clé distincte) et aucune
 * route ne leur permet d'écrire dans les registres d'un client. Un client n'a aucun accès au portail.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const { signOperatorToken, authenticateOperator } = require('./auth');
const { listTemplates } = require('./templates');
const { REGISTERS, mountReports } = require('./reports');
const { appUrl } = require('./mailer');
const T = require('./tenants');

const DAY_MS = 86400000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const nowIso = () => new Date().toISOString();

function checkOperatorPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) throw T.fail('Le mot de passe doit contenir au moins 10 caractères');
}

function createPortal(db, { mailer, billing, photos, purgeOrganization, limiter, baseUrl }) {
  const router = express.Router();
  const base = (req) => baseUrl || appUrl(req);

  const getOrg = db.prepare('SELECT * FROM organizations WHERE id = ?');
  const logStmt = db.prepare('INSERT INTO operator_log (operator_id, org_id, action, detail) VALUES (?,?,?,?)');
  const log = (req, action, orgId, detail) => logStmt.run(req.operator.id, orgId ?? null, action, detail ?? null);

  // ---------- Connexion ----------
  router.post('/login', limiter, (req, res) => {
    const op = db.prepare('SELECT * FROM operators WHERE email = ?').get(String(req.body?.email || '').trim());
    if (!op || !op.active || !bcrypt.compareSync(String(req.body?.password || ''), op.password_hash)) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }
    db.prepare('UPDATE operators SET last_login_at = ? WHERE id = ?').run(nowIso(), op.id);
    res.json({ token: signOperatorToken(op), operator: { id: op.id, name: op.name, email: op.email }, mustChangePassword: !!op.must_change_password });
  });

  router.use(authenticateOperator(db));

  // Compte créé avec un mot de passe provisoire (accès par défaut, installation) : rien d'autre n'est
  // possible tant qu'un nouveau mot de passe n'a pas été choisi.
  router.use((req, res, next) => {
    const allowed = (req.method === 'GET' && req.path === '/me') || (req.method === 'PUT' && req.path === '/password');
    if (!req.operator.must_change || allowed) return next();
    res.status(403).json({ error: 'Choisissez d\'abord votre mot de passe personnel', code: 'password_change_required' });
  });

  router.get('/me', (req, res) => res.json({
    operator: { id: req.operator.id, name: req.operator.name, email: req.operator.email },
    billingEnabled: billing.enabled,
    mustChangePassword: req.operator.must_change,
  }));

  router.put('/password', (req, res) => {
    const row = db.prepare('SELECT password_hash FROM operators WHERE id = ?').get(req.operator.id);
    checkOperatorPassword(req.body?.password);
    if (req.operator.must_change) {
      // La session vient de s'ouvrir avec le mot de passe provisoire : pas besoin de le ressaisir, mais le nouveau doit être différent.
      if (bcrypt.compareSync(req.body.password, row.password_hash)) throw T.fail('Choisissez un mot de passe différent du mot de passe provisoire');
    } else if (!bcrypt.compareSync(String(req.body?.current || ''), row.password_hash)) {
      return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    }
    db.prepare('UPDATE operators SET password_hash = ?, password_changed_at = ?, must_change_password = 0 WHERE id = ?')
      .run(bcrypt.hashSync(req.body.password, 10), nowIso(), req.operator.id);
    // Les autres sessions sont déconnectées ; celle-ci reçoit un nouveau jeton.
    res.json({ token: signOperatorToken(req.operator) });
  });

  // ---------- Équipe du prestataire ----------
  router.get('/operators', (req, res) => {
    res.json(db.prepare('SELECT id, name, email, active, last_login_at, created_at FROM operators ORDER BY name COLLATE NOCASE').all());
  });

  router.post('/operators', (req, res) => {
    const name = T.text(req.body?.name, 100, { required: true, label: 'Nom' });
    const email = T.email(req.body?.email);
    checkOperatorPassword(req.body?.password);
    if (db.prepare('SELECT 1 FROM operators WHERE email = ?').get(email)) throw T.fail('Un opérateur existe déjà avec cet e-mail', 409);
    const id = Number(db.prepare('INSERT INTO operators (email, name, password_hash) VALUES (?,?,?)')
      .run(email, name, bcrypt.hashSync(req.body.password, 10)).lastInsertRowid);
    log(req, 'operator_create', null, `${name} <${email}>`);
    res.status(201).json(db.prepare('SELECT id, name, email, active, last_login_at, created_at FROM operators WHERE id = ?').get(id));
  });

  router.put('/operators/:id', (req, res) => {
    const id = Number(req.params.id);
    const op = db.prepare('SELECT * FROM operators WHERE id = ?').get(id);
    if (!op) return res.status(404).json({ error: 'Introuvable' });
    if (req.body?.active !== undefined) {
      if (id === req.operator.id && !req.body.active) throw T.fail('Vous ne pouvez pas désactiver votre propre compte');
      db.prepare('UPDATE operators SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, id);
    }
    if (req.body?.password) {
      checkOperatorPassword(req.body.password);
      db.prepare('UPDATE operators SET password_hash = ?, password_changed_at = ? WHERE id = ?')
        .run(bcrypt.hashSync(req.body.password, 10), nowIso(), id);
    }
    log(req, 'operator_update', null, `${op.name} <${op.email}>`);
    res.json(db.prepare('SELECT id, name, email, active, last_login_at, created_at FROM operators WHERE id = ?').get(id));
  });

  // ---------- Clients ----------
  router.get('/templates', (req, res) => res.json(listTemplates()));

  const LIST_SQL = `SELECT o.*,
    (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id AND u.active = 1) AS users,
    (SELECT COUNT(*) FROM non_conformities n WHERE n.org_id = o.id AND n.status = 'open') AS open_nc,
    (SELECT MAX(a.at) FROM audit_log a WHERE a.org_id = o.id AND a.action = 'create') AS last_activity,
    (SELECT MAX(a.at) FROM audit_log a WHERE a.org_id = o.id AND a.action = 'login') AS last_login,
    (SELECT u.email FROM users u WHERE u.org_id = o.id AND u.role = 'admin' AND u.pin_only = 0 ORDER BY u.id LIMIT 1) AS admin_email
    FROM organizations o`;

  function summary(o) {
    return {
      id: o.id, name: o.name, group_name: o.group_name, activity: o.activity, address: o.address, siret: o.siret, timezone: o.timezone,
      created_at: o.created_at, users: o.users, open_nc: o.open_nc, last_activity: o.last_activity, last_login: o.last_login,
      admin_email: o.admin_email, access_mode: o.access_mode, suspended: !!o.suspended_at, access: billing.access(o),
    };
  }

  router.get('/orgs', (req, res) => {
    const orgs = db.prepare(`${LIST_SQL} ORDER BY lower(o.name)`).all().map(summary);
    const groups = [...new Set(orgs.map((o) => o.group_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    res.json({ orgs, groups });
  });

  router.post('/orgs', async (req, res, next) => {
    try {
      const { org, admin } = T.createCustomer(db, req.body || {}, { operatorId: req.operator.id });
      log(req, 'org_create', org.id, `${org.name} (administrateur : ${admin.email})`);
      const url = T.createInvitation(db, admin.id, base(req));
      let emailed = false;
      let emailError = null;
      if (req.body?.send_invitation !== false) {
        try { emailed = await T.sendInvitation(mailer, { user: admin, org, url }); } catch (e) { emailError = e.message; }
      }
      res.status(201).json({
        org: { id: org.id, name: org.name },
        admin: { id: admin.id, name: admin.name, email: admin.email },
        invitation: { url, emailed, mailConfigured: mailer.configured, error: emailError },
      });
    } catch (e) { next(e); }
  });

  router.get('/orgs/:id', (req, res) => {
    const o = db.prepare(`${LIST_SQL} WHERE o.id = ?`).get(Number(req.params.id));
    if (!o) return res.status(404).json({ error: 'Client introuvable' });
    const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const count = (sql, ...p) => db.prepare(sql).get(o.id, ...p).n;
    const compliance = {};
    for (const [key, table, field] of [
      ['temperatures', 'temperature_logs', 'recorded_at'], ['receptions', 'receptions', 'received_at'],
      ['processes', 'process_logs', 'start_at'], ['oil', 'oil_checks', 'checked_at'],
    ]) {
      compliance[key] = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(compliant),0) AS ok FROM ${table} WHERE org_id = ? AND ${field} >= ?`).get(o.id, since);
    }
    res.json({
      ...summary(o),
      trial_ends_at: o.trial_ends_at,
      suspended_at: o.suspended_at,
      created_by: o.created_by_operator ? db.prepare('SELECT name FROM operators WHERE id = ?').get(o.created_by_operator)?.name || null : null,
      terms_accepted_at: o.terms_accepted_at,
      stats: {
        records_30d: count("SELECT COUNT(*) AS n FROM audit_log WHERE org_id = ? AND action = 'create' AND at >= ?", since),
        equipment: count('SELECT COUNT(*) AS n FROM equipment WHERE org_id = ? AND active = 1'),
        devices: count('SELECT COUNT(*) AS n FROM devices WHERE org_id = ? AND revoked_at IS NULL'),
        compliance,
      },
    });
  });

  router.put('/orgs/:id', (req, res) => {
    const org = getOrg.get(Number(req.params.id));
    if (!org) return res.status(404).json({ error: 'Client introuvable' });
    const f = T.orgFields(req.body || {});
    db.prepare('UPDATE organizations SET name = ?, group_name = ?, siret = ?, activity = ?, address = ?, timezone = ? WHERE id = ?')
      .run(f.name, f.group_name, f.siret, f.activity, f.address, f.timezone, org.id);
    log(req, 'org_update', org.id, f.name);
    res.json({ ok: true });
  });

  // Pilotage de l'accès : essai daté, actif (facturé hors application), suspension (lecture seule).
  router.post('/orgs/:id/access', (req, res) => {
    const org = getOrg.get(Number(req.params.id));
    if (!org) return res.status(404).json({ error: 'Client introuvable' });
    const action = req.body?.action;
    if (action === 'extend_trial') {
      const days = Number(req.body?.days);
      if (!Number.isInteger(days) || days < 1 || days > 365) throw T.fail('Durée invalide (1 à 365 jours)');
      const from = Math.max(Date.now(), org.trial_ends_at ? Date.parse(org.trial_ends_at) : 0);
      db.prepare("UPDATE organizations SET access_mode = 'trial', trial_ends_at = ? WHERE id = ?").run(new Date(from + days * DAY_MS).toISOString(), org.id);
      log(req, 'access_trial', org.id, `essai prolongé de ${days} jours`);
    } else if (action === 'activate') {
      db.prepare("UPDATE organizations SET access_mode = 'active' WHERE id = ?").run(org.id);
      log(req, 'access_active', org.id, 'accès actif');
    } else if (action === 'billing') {
      if (!billing.enabled) throw T.fail('Le paiement en ligne n\'est pas configuré sur ce serveur (voir docs/STRIPE.md)');
      db.prepare("UPDATE organizations SET access_mode = 'auto' WHERE id = ?").run(org.id);
      log(req, 'access_billing', org.id, 'paiement en ligne (Stripe)');
    } else if (action === 'suspend') {
      db.prepare('UPDATE organizations SET suspended_at = ? WHERE id = ?').run(nowIso(), org.id);
      log(req, 'access_suspend', org.id, 'accès suspendu (lecture seule)');
    } else if (action === 'resume') {
      db.prepare('UPDATE organizations SET suspended_at = NULL WHERE id = ?').run(org.id);
      log(req, 'access_resume', org.id, 'accès rétabli');
    } else {
      throw T.fail('Action inconnue');
    }
    res.json({ access: billing.access(getOrg.get(org.id)) });
  });

  // Suppression définitive : nom du client et mot de passe de l'opérateur exigés.
  router.post('/orgs/:id/delete', async (req, res, next) => {
    try {
      const org = getOrg.get(Number(req.params.id));
      if (!org) return res.status(404).json({ error: 'Client introuvable' });
      const op = db.prepare('SELECT password_hash FROM operators WHERE id = ?').get(req.operator.id);
      if (!bcrypt.compareSync(String(req.body?.password || ''), op.password_hash)) throw T.fail('Mot de passe incorrect');
      if (String(req.body?.confirm || '').trim() !== org.name) throw T.fail('Saisissez exactement le nom du client pour confirmer');
      await purgeOrganization(org);
      log(req, 'org_delete', org.id, org.name);
      res.status(204).end();
    } catch (e) { next(e); }
  });

  // ---------- Utilisateurs et adresses e-mail d'un client ----------
  const USER_SQL = `SELECT u.id, u.name, u.email, u.role, u.active, u.pin_only, u.pin_hash IS NOT NULL AS has_pin, u.created_at,
    (SELECT MAX(a.at) FROM audit_log a WHERE a.user_id = u.id AND a.action = 'login') AS last_login FROM users u`;
  const publicUser = (u) => ({ ...u, email: u.pin_only ? null : u.email, pin_only: !!u.pin_only, has_pin: !!u.has_pin });

  router.get('/orgs/:id/users', (req, res) => {
    if (!getOrg.get(Number(req.params.id))) return res.status(404).json({ error: 'Client introuvable' });
    const users = db.prepare(`${USER_SQL} WHERE u.org_id = ? ORDER BY u.active DESC, u.name COLLATE NOCASE`).all(Number(req.params.id));
    res.json(users.map(publicUser));
  });

  async function invite(req, org, user, again) {
    const url = T.createInvitation(db, user.id, base(req));
    let emailed = false;
    let error = null;
    if (req.body?.send_invitation !== false) {
      try { emailed = await T.sendInvitation(mailer, { user, org, url, again }); } catch (e) { error = e.message; }
    }
    return { url, emailed, mailConfigured: mailer.configured, error };
  }

  router.post('/orgs/:id/users', async (req, res, next) => {
    try {
      const org = getOrg.get(Number(req.params.id));
      if (!org) return res.status(404).json({ error: 'Client introuvable' });
      const name = T.text(req.body?.name, 100, { required: true, label: 'Nom' });
      const mail = T.email(req.body?.email);
      if (T.emailTaken(db, mail)) throw T.fail('Cette adresse e-mail est déjà utilisée', 409);
      const id = T.addUser(db, org.id, { name, email: mail, role: req.body?.role });
      log(req, 'user_create', org.id, `${name} <${mail}> (${req.body.role})`);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      res.status(201).json({ user: publicUser({ ...user, has_pin: !!user.pin_hash }), invitation: await invite(req, org, user, false) });
    } catch (e) { next(e); }
  });

  /** Garde-fou : un client doit toujours garder au moins un administrateur actif avec une adresse e-mail. */
  function checkAdminLeft(orgId, userId, { role, active }) {
    const stays = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE org_id = ? AND id != ? AND role = 'admin' AND active = 1 AND pin_only = 0`).get(orgId, userId).n;
    if (!stays && (role !== 'admin' || active === false)) throw T.fail('Le client doit garder au moins un administrateur actif');
  }

  router.put('/orgs/:id/users/:uid', (req, res) => {
    const org = getOrg.get(Number(req.params.id));
    const user = org && db.prepare('SELECT * FROM users WHERE id = ? AND org_id = ?').get(Number(req.params.uid), org.id);
    if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const b = req.body || {};
    const next = {
      name: b.name !== undefined ? T.text(b.name, 100, { required: true, label: 'Nom' }) : user.name,
      email: b.email !== undefined && !user.pin_only ? T.email(b.email) : user.email,
      role: b.role !== undefined ? b.role : user.role,
      active: b.active !== undefined ? !!b.active : !!user.active,
    };
    if (!T.ROLES.includes(next.role)) throw T.fail('Rôle invalide');
    if (user.pin_only && next.role !== 'employee') throw T.fail('Un employé sans e-mail reste employé');
    if (T.emailTaken(db, next.email, user.id)) throw T.fail('Cette adresse e-mail est déjà utilisée', 409);
    if (user.role === 'admin' && user.active && !user.pin_only) checkAdminLeft(org.id, user.id, next);
    db.prepare('UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ?')
      .run(next.name, next.email, next.role, next.active ? 1 : 0, user.id);
    log(req, 'user_update', org.id, `${next.name} <${user.pin_only ? 'code PIN' : next.email}> (${next.role}${next.active ? '' : ', désactivé'})`);
    res.json({ ok: true });
  });

  // Nouveau lien de connexion (mot de passe oublié, invitation perdue...).
  router.post('/orgs/:id/users/:uid/invite', async (req, res, next) => {
    try {
      const org = getOrg.get(Number(req.params.id));
      const user = org && db.prepare('SELECT * FROM users WHERE id = ? AND org_id = ? AND active = 1 AND pin_only = 0').get(Number(req.params.uid), org.id);
      if (!user) return res.status(404).json({ error: 'Utilisateur introuvable ou sans adresse e-mail' });
      log(req, 'user_invite', org.id, `${user.name} <${user.email}>`);
      res.json(await invite(req, org, user, true));
    } catch (e) { next(e); }
  });

  // ---------- Ce que fait le client (lecture seule) ----------
  function feed({ orgId, before, limit }) {
    const where = [];
    const params = [];
    if (orgId) { where.push('a.org_id = ?'); params.push(orgId); }
    if (before) { where.push('a.id < ?'); params.push(before); }
    return db.prepare(`SELECT a.id, a.at, a.org_id, o.name AS org_name, a.user_id, u.name AS user_name, a.action, a.entity, a.entity_id
      FROM audit_log a LEFT JOIN organizations o ON o.id = a.org_id LEFT JOIN users u ON u.id = a.user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.id DESC LIMIT ?`).all(...params, limit);
  }
  const feedParams = (req) => ({ before: Number(req.query.before) || 0, limit: Math.min(Number(req.query.limit) || 60, 200) });

  router.get('/activity', (req, res) => res.json(feed({ ...feedParams(req), orgId: Number(req.query.org) || 0 })));

  router.get('/orgs/:id/activity', (req, res) => {
    if (!getOrg.get(Number(req.params.id))) return res.status(404).json({ error: 'Client introuvable' });
    res.json(feed({ ...feedParams(req), orgId: Number(req.params.id) }));
  });

  router.get('/orgs/:id/registers', (req, res) => {
    if (!getOrg.get(Number(req.params.id))) return res.status(404).json({ error: 'Client introuvable' });
    res.json(Object.entries(REGISTERS).map(([key, r]) => ({ key, title: r.title })));
  });

  router.get('/orgs/:id/registers/:key', (req, res) => {
    const org = getOrg.get(Number(req.params.id));
    const reg = REGISTERS[req.params.key];
    if (!org || !reg) return res.status(404).json({ error: 'Introuvable' });
    const day = (v, fallback) => (DATE_RE.test(String(v || '')) ? String(v) : fallback);
    const to = day(req.query.to, new Date().toISOString().slice(0, 10));
    const from = day(req.query.from, new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10));
    const rows = db.prepare(reg.sql).all(org.id, from, to).reverse(); // du plus récent au plus ancien
    const LIMIT = 500;
    res.json({
      title: reg.title, from, to, total: rows.length, truncated: rows.length > LIMIT,
      columns: reg.columns.map((c) => c[0]),
      rows: rows.slice(0, LIMIT).map((r) => ({ cells: reg.columns.map((c) => String(c[1](r) ?? '')), nc: r.compliant === 0 })),
    });
  });

  // ---------- Notes internes et journal du portail ----------
  router.get('/orgs/:id/notes', (req, res) => {
    if (!getOrg.get(Number(req.params.id))) return res.status(404).json({ error: 'Client introuvable' });
    res.json(db.prepare(`SELECT n.id, n.text, n.created_at, o.name AS operator_name FROM org_notes n
      LEFT JOIN operators o ON o.id = n.operator_id WHERE n.org_id = ? ORDER BY n.id DESC LIMIT 200`).all(Number(req.params.id)));
  });

  router.post('/orgs/:id/notes', (req, res) => {
    const org = getOrg.get(Number(req.params.id));
    if (!org) return res.status(404).json({ error: 'Client introuvable' });
    const note = T.text(req.body?.text, 4000, { required: true, label: 'Note' });
    const id = Number(db.prepare('INSERT INTO org_notes (org_id, operator_id, text) VALUES (?,?,?)').run(org.id, req.operator.id, note).lastInsertRowid);
    log(req, 'note_add', org.id, null);
    res.status(201).json(db.prepare(`SELECT n.id, n.text, n.created_at, o.name AS operator_name FROM org_notes n
      LEFT JOIN operators o ON o.id = n.operator_id WHERE n.id = ?`).get(id));
  });

  router.get('/orgs/:id/log', (req, res) => {
    if (!getOrg.get(Number(req.params.id))) return res.status(404).json({ error: 'Client introuvable' });
    res.json(db.prepare(`SELECT l.id, l.action, l.detail, l.at, o.name AS operator_name FROM operator_log l
      LEFT JOIN operators o ON o.id = l.operator_id WHERE l.org_id = ? ORDER BY l.id DESC LIMIT 100`).all(Number(req.params.id)));
  });

  // ---------- Classeur HACCP et exports d'un client (mêmes documents que ceux du client) ----------
  const reportsRouter = express.Router();
  mountReports(reportsRouter, db, photos);
  router.use('/orgs/:id', (req, res, next) => {
    const org = getOrg.get(Number(req.params.id));
    if (!org) return res.status(404).json({ error: 'Client introuvable' });
    req.user = { id: null, org_id: org.id, name: `${req.operator.name} (prestataire)`, role: 'admin' };
    next();
  }, reportsRouter);

  return { router };
}

module.exports = { createPortal, checkOperatorPassword };
