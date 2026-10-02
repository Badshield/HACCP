'use strict';

const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const rules = require('./rules');
const { signToken, authenticate, requireRole } = require('./auth');
const { coerce } = require('./resource');
const { mountModules } = require('./modules');
const { mountReports } = require('./reports');
const { createBilling, trialEnd } = require('./billing');
const { TEMPLATES, listTemplates, applyTemplate } = require('./templates');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ORG_PRIVATE = ['stripe_customer_id', 'stripe_subscription_id'];
function publicOrg(org) {
  const out = { ...org };
  for (const k of ORG_PRIVATE) delete out[k];
  return out;
}

function publicUser(u) {
  return { id: u.id, org_id: u.org_id, email: u.email, name: u.name, role: u.role, active: u.active };
}

function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) {
    const e = new Error('Le mot de passe doit contenir au moins 8 caractères');
    e.status = 400;
    throw e;
  }
}

/** Limite simple en mémoire des tentatives de connexion (anti brute force). */
function loginLimiter({ max = 10, windowMs = 15 * 60000 } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const key = `${req.ip}|${String(req.body?.email || '').toLowerCase()}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) hits.set(key, { n: 1, reset: now + windowMs });
    else if (++entry.n > max) {
      return res.status(429).json({ error: 'Trop de tentatives, réessayez dans quelques minutes' });
    }
    if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    next();
  };
}

function createApp(db, opts = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
  const billing = createBilling(db, opts.billing);
  // Le webhook Stripe doit recevoir le corps brut pour vérifier la signature.
  app.post('/api/billing/webhook', express.raw({ type: 'application/json', limit: '1mb' }), billing.webhook);
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  const api = express.Router();

  // ---------- Public ----------
  api.get('/health', (req, res) => res.json({ ok: true }));

  api.get('/reference', (req, res) => {
    res.json({
      equipmentTypes: rules.EQUIPMENT_TYPES,
      receptionCategories: rules.RECEPTION_CATEGORIES,
      allergens: rules.ALLERGENS,
      cooling: rules.COOLING,
      reheating: rules.REHEATING,
      oilMaxPolar: rules.OIL_MAX_POLAR,
    });
  });

  api.get('/templates', (req, res) => res.json(listTemplates()));

  // Inscription d'un nouveau client : crée l'établissement et son administrateur.
  api.post('/auth/signup', (req, res) => {
    const { organization, name, email, password, template } = req.body || {};
    if (!organization || !name || !EMAIL_RE.test(email || '')) {
      return res.status(400).json({ error: 'Établissement, nom et e-mail valides requis' });
    }
    if (template && !TEMPLATES[template]) return res.status(400).json({ error: 'Modèle de métier inconnu' });
    checkPassword(password);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'Un compte existe déjà avec cet e-mail' });
    }
    const hash = bcrypt.hashSync(password, 10);
    const user = db.transaction(() => {
      const org = db.prepare('INSERT INTO organizations (name, trial_ends_at) VALUES (?, ?)')
        .run(String(organization).trim(), trialEnd());
      if (template) applyTemplate(db, Number(org.lastInsertRowid), template);
      const info = db
        .prepare("INSERT INTO users (org_id, email, password_hash, name, role) VALUES (?,?,?,?, 'admin')")
        .run(org.lastInsertRowid, email.trim(), hash, String(name).trim());
      return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    })();
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  });

  api.post('/auth/login', loginLimiter(), (req, res) => {
    const { email, password } = req.body || {};
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim());
    if (!user || !user.active || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  });

  // ---------- Authentifié ----------
  api.use(authenticate(db));
  api.use(billing.guard);

  api.get('/me', (req, res) => {
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.user.org_id);
    res.json({ user: publicUser(req.user), organization: publicOrg(org), access: billing.access(org) });
  });

  api.use('/billing', billing.router);

  // Réapplique un modèle de métier (ajoute uniquement les éléments manquants).
  api.post('/organization/template', requireRole('admin'), (req, res) => {
    res.json(applyTemplate(db, req.user.org_id, req.body?.template));
  });

  api.put('/me/password', (req, res) => {
    const { current, password } = req.body || {};
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(String(current || ''), row.password_hash)) {
      return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    }
    checkPassword(password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), req.user.id);
    res.status(204).end();
  });

  api.put('/organization', requireRole('admin'), (req, res) => {
    const b = req.body || {};
    const data = {
      name: coerce('name', { type: 'string', required: true, label: 'Nom' }, b.name),
      siret: coerce('siret', { type: 'string' }, b.siret),
      address: coerce('address', { type: 'string' }, b.address),
      activity: coerce('activity', { type: 'string' }, b.activity),
    };
    db.prepare('UPDATE organizations SET name=?, siret=?, address=?, activity=? WHERE id=?')
      .run(data.name, data.siret, data.address, data.activity, req.user.org_id);
    res.json(publicOrg(db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.user.org_id)));
  });

  const activeUsers = (orgId) => db.prepare('SELECT COUNT(*) AS n FROM users WHERE org_id = ? AND active = 1').get(orgId).n;
  function checkUserQuota(orgId) {
    const { maxUsers } = billing.access(orgId);
    if (maxUsers && activeUsers(orgId) >= maxUsers) {
      const e = new Error(`Votre offre est limitée à ${maxUsers} utilisateurs actifs : passez à l'offre Pro pour en ajouter`);
      e.status = 403;
      throw e;
    }
  }

  // ---------- Utilisateurs (admin) ----------
  api.get('/users', requireRole('manager'), (req, res) => {
    const rows = db.prepare('SELECT * FROM users WHERE org_id = ? ORDER BY name').all(req.user.org_id);
    res.json(rows.map(publicUser));
  });

  api.post('/users', requireRole('admin'), (req, res) => {
    const { name, email, password, role } = req.body || {};
    if (!name || !EMAIL_RE.test(email || '')) return res.status(400).json({ error: 'Nom et e-mail valides requis' });
    if (!['admin', 'manager', 'employee'].includes(role)) return res.status(400).json({ error: 'Rôle invalide' });
    checkPassword(password);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'E-mail déjà utilisé' });
    }
    checkUserQuota(req.user.org_id);
    const info = db
      .prepare('INSERT INTO users (org_id, email, password_hash, name, role) VALUES (?,?,?,?,?)')
      .run(req.user.org_id, email.trim(), bcrypt.hashSync(password, 10), String(name).trim(), role);
    res.status(201).json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)));
  });

  api.put('/users/:id', requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND org_id = ?').get(id, req.user.org_id);
    if (!user) return res.status(404).json({ error: 'Introuvable' });
    const { role, active, password, name } = req.body || {};
    if (id === req.user.id && (active === false || (role && role !== 'admin'))) {
      return res.status(400).json({ error: 'Vous ne pouvez pas retirer vos propres droits administrateur' });
    }
    if (role !== undefined) {
      if (!['admin', 'manager', 'employee'].includes(role)) return res.status(400).json({ error: 'Rôle invalide' });
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    }
    if (active && !user.active) checkUserQuota(req.user.org_id);
    if (active !== undefined) db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    if (name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(String(name).trim(), id);
    if (password) {
      checkPassword(password);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), id);
    }
    res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
  });

  // ---------- Modules HACCP ----------
  mountModules(api, db);

  // ---------- Non-conformités ----------
  const ncSelect = `SELECT n.*, u.name AS created_by_name, c.name AS closed_by_name FROM non_conformities n
    LEFT JOIN users u ON u.id = n.created_by LEFT JOIN users c ON c.id = n.closed_by`;

  api.get('/non-conformities', (req, res) => {
    const where = ['n.org_id = ?'];
    const params = [req.user.org_id];
    if (req.query.status) { where.push('n.status = ?'); params.push(String(req.query.status)); }
    if (req.query.from) { where.push('n.created_at >= ?'); params.push(String(req.query.from)); }
    if (req.query.to) { where.push("n.created_at < date(?, '+1 day')"); params.push(String(req.query.to)); }
    res.json(db.prepare(`${ncSelect} WHERE ${where.join(' AND ')} ORDER BY n.created_at DESC LIMIT 500`).all(...params));
  });

  api.post('/non-conformities', (req, res) => {
    const description = coerce('description', { type: 'string', required: true, max: 2000, label: 'Description' }, req.body?.description);
    const action = coerce('corrective_action', { type: 'string', max: 2000 }, req.body?.corrective_action);
    const info = db
      .prepare("INSERT INTO non_conformities (org_id, source, description, corrective_action, created_by) VALUES (?, 'manual', ?, ?, ?)")
      .run(req.user.org_id, description, action, req.user.id);
    res.status(201).json(db.prepare(`${ncSelect} WHERE n.id = ?`).get(info.lastInsertRowid));
  });

  // Clôture d'une NC : l'action corrective est obligatoire (exigence HACCP).
  api.post('/non-conformities/:id/close', (req, res) => {
    const id = Number(req.params.id);
    const nc = db.prepare('SELECT * FROM non_conformities WHERE id = ? AND org_id = ?').get(id, req.user.org_id);
    if (!nc) return res.status(404).json({ error: 'Introuvable' });
    if (nc.status === 'closed') return res.status(400).json({ error: 'Déjà clôturée' });
    const action = coerce('corrective_action', { type: 'string', required: true, max: 2000, label: 'Action corrective' },
      req.body?.corrective_action || nc.corrective_action);
    db.prepare(`UPDATE non_conformities SET status='closed', corrective_action=?, closed_by=?,
      closed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`).run(action, req.user.id, id);
    res.json(db.prepare(`${ncSelect} WHERE n.id = ?`).get(id));
  });

  // ---------- Tableau de bord ----------
  api.get('/dashboard', (req, res) => {
    const org = req.user.org_id;
    const today = new Date().toISOString().slice(0, 10);
    const equipment = db.prepare(`
      SELECT e.id, e.name, e.min_temp, e.max_temp,
        (SELECT value FROM temperature_logs WHERE equipment_id = e.id ORDER BY recorded_at DESC LIMIT 1) AS last_value,
        (SELECT recorded_at FROM temperature_logs WHERE equipment_id = e.id ORDER BY recorded_at DESC LIMIT 1) AS last_at,
        (SELECT compliant FROM temperature_logs WHERE equipment_id = e.id ORDER BY recorded_at DESC LIMIT 1) AS last_compliant
      FROM equipment e WHERE e.org_id = ? AND e.active = 1 ORDER BY e.name`).all(org);
    const tasks = db.prepare(`
      SELECT c.*, (SELECT MAX(done_at) FROM cleaning_logs WHERE task_id = c.id) AS last_done
      FROM cleaning_tasks c WHERE c.org_id = ? AND c.active = 1 ORDER BY c.zone, c.name`).all(org);
    const now = new Date();
    const cleaningDue = tasks.filter((t) => rules.cleaningDue(t.frequency, t.last_done, now));
    const openNc = db.prepare("SELECT COUNT(*) AS n FROM non_conformities WHERE org_id = ? AND status = 'open'").get(org).n;
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const stats = {};
    for (const [key, table, field] of [
      ['temperatures', 'temperature_logs', 'recorded_at'],
      ['receptions', 'receptions', 'received_at'],
      ['processes', 'process_logs', 'start_at'],
      ['oil', 'oil_checks', 'checked_at'],
    ]) {
      stats[key] = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(compliant),0) AS ok FROM ${table}
        WHERE org_id = ? AND ${field} >= ?`).get(org, since);
    }
    const expiringLabels = db.prepare(`SELECT * FROM labels WHERE org_id = ? AND dlc BETWEEN date(?, '-1 day') AND date(?, '+1 day')
      ORDER BY dlc`).all(org, today, today);
    const trainingsExpiring = db.prepare(`SELECT * FROM trainings WHERE org_id = ? AND expires_on IS NOT NULL
      AND expires_on <= date(?, '+60 day') ORDER BY expires_on`).all(org, today);
    res.json({
      today,
      equipment: equipment.map((e) => ({ ...e, checked_today: !!(e.last_at && e.last_at.slice(0, 10) === today) })),
      cleaningDue,
      openNc,
      stats,
      expiringLabels,
      trainingsExpiring,
    });
  });

  mountReports(api, db);

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Erreur serveur' : err.message });
  });

  return app;
}

module.exports = { createApp };
