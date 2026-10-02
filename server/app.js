'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const rules = require('./rules');
const { signToken, authenticate, requireRole } = require('./auth');
const { coerce } = require('./resource');
const { mountModules } = require('./modules');
const { mountReports } = require('./reports');
const { createBilling, trialEnd } = require('./billing');
const { TEMPLATES, listTemplates, applyTemplate } = require('./templates');
const { createMailer, compose, appUrl } = require('./mailer');
const { createReminders, normalizeTimes, defaultBaseUrl } = require('./reminders');

const RESET_TTL_MS = 60 * 60000;
const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const nowIso = () => new Date().toISOString();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ORG_PRIVATE = ['stripe_customer_id', 'stripe_subscription_id'];
function publicOrg(org) {
  const out = { ...org };
  for (const k of ORG_PRIVATE) delete out[k];
  return out;
}

function publicUser(u) {
  return { id: u.id, org_id: u.org_id, email: u.email, name: u.name, role: u.role, active: u.active, notify: u.notify };
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
  const mailer = opts.mailer || createMailer();
  const reminders = createReminders({
    db, mailer, access: billing.access, baseUrl: opts.baseUrl !== undefined ? opts.baseUrl : defaultBaseUrl(),
  });
  app.locals.mailer = mailer;
  app.locals.reminders = reminders;
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

  // Mot de passe oublié : la réponse est identique que le compte existe ou non
  // (pas de divulgation des adresses inscrites).
  api.post('/auth/forgot', loginLimiter({ max: 5 }), (req, res) => {
    const email = String(req.body?.email || '').trim();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Adresse e-mail invalide' });
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
    if (user) {
      const token = crypto.randomBytes(32).toString('base64url');
      db.prepare('DELETE FROM password_resets WHERE user_id = ? AND (used_at IS NOT NULL OR expires_at < ?)').run(user.id, nowIso());
      db.prepare('INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?,?,?)')
        .run(user.id, sha256(token), new Date(Date.now() + RESET_TTL_MS).toISOString());
      const url = `${opts.baseUrl || appUrl(req)}/#/reset?token=${token}`;
      // Envoi en arrière-plan : le temps de réponse ne révèle pas si le compte existe.
      mailer.send({
        to: user.email,
        ...compose({
          subject: 'Réinitialisation de votre mot de passe',
          blocks: [
            `Bonjour ${user.name},`,
            'Vous avez demandé à réinitialiser votre mot de passe. Cliquez sur le bouton ci-dessous pour en choisir un nouveau. Ce lien est valable 1 heure et ne peut servir qu\'une fois.',
            { button: 'Choisir un nouveau mot de passe', url },
            'Si vous n\'êtes pas à l\'origine de cette demande, ignorez cet e-mail : votre mot de passe actuel reste valable.',
          ],
        }),
      }).catch((e) => console.error('E-mail de réinitialisation non envoyé :', e.message));
    }
    res.json({ ok: true });
  });

  api.post('/auth/reset', loginLimiter(), (req, res) => {
    const { token, password } = req.body || {};
    const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?').get(sha256(String(token || '')));
    const user = row && db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(row.user_id);
    if (!row || row.used_at || row.expires_at < nowIso() || !user) {
      return res.status(400).json({ error: 'Ce lien est invalide ou a expiré. Faites une nouvelle demande.' });
    }
    checkPassword(password);
    const at = nowIso();
    db.transaction(() => {
      db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?')
        .run(bcrypt.hashSync(password, 10), at, user.id);
      db.prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL').run(at, user.id);
    })();
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
    db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?')
      .run(bcrypt.hashSync(password, 10), nowIso(), req.user.id);
    // Les autres sessions sont déconnectées ; celle-ci reçoit un nouveau jeton.
    res.json({ token: signToken(req.user) });
  });

  api.put('/me/notify', requireRole('manager'), (req, res) => {
    db.prepare('UPDATE users SET notify = ? WHERE id = ?').run(req.body?.notify ? 1 : 0, req.user.id);
    res.json({ notify: req.body?.notify ? 1 : 0 });
  });

  // ---------- Rappels et alertes ----------
  const NOTIF_FIELDS = 'timezone, notif_enabled, notif_temp_times, notif_grace_min, notif_digest_time, notif_nc_alert';
  api.get('/organization/notifications', requireRole('manager'), (req, res) => {
    res.json({
      ...db.prepare(`SELECT ${NOTIF_FIELDS} FROM organizations WHERE id = ?`).get(req.user.org_id),
      mailConfigured: mailer.configured,
      recipients: db.prepare(`SELECT name, email FROM users WHERE org_id = ? AND active = 1 AND notify = 1
        AND role IN ('admin','manager') ORDER BY name`).all(req.user.org_id),
    });
  });

  api.put('/organization/notifications', requireRole('admin'), (req, res) => {
    const b = req.body || {};
    const bad = (msg) => res.status(400).json({ error: msg });
    const temps = normalizeTimes(b.notif_temp_times ?? '');
    if (temps === null) return bad('Horaires de relevé invalides (format attendu : 09:00, 17:00)');
    const digest = normalizeTimes(b.notif_digest_time ?? '', { max: 1 });
    if (!digest) return bad('Heure du récapitulatif invalide (format attendu : 20:00)');
    const grace = Number(b.notif_grace_min);
    if (!Number.isInteger(grace) || grace < 0 || grace > 240) return bad('Délai de tolérance invalide (0 à 240 minutes)');
    const tz = String(b.timezone || 'Europe/Paris');
    try { new Intl.DateTimeFormat('fr-FR', { timeZone: tz }); } catch { return bad('Fuseau horaire invalide'); }
    db.prepare(`UPDATE organizations SET timezone = ?, notif_enabled = ?, notif_temp_times = ?, notif_grace_min = ?,
      notif_digest_time = ?, notif_nc_alert = ? WHERE id = ?`)
      .run(tz, b.notif_enabled ? 1 : 0, temps, grace, digest, b.notif_nc_alert ? 1 : 0, req.user.org_id);
    res.json(db.prepare(`SELECT ${NOTIF_FIELDS} FROM organizations WHERE id = ?`).get(req.user.org_id));
  });

  api.post('/organization/notifications/test', requireRole('manager'), async (req, res, next) => {
    try {
      await mailer.send({
        to: req.user.email,
        ...compose({
          subject: 'E-mail de test',
          blocks: [`Bonjour ${req.user.name},`, 'Les e-mails de rappel et d\'alerte arrivent bien dans votre boîte. Pensez à vérifier le dossier « Indésirables » et à ajouter notre adresse à vos contacts.'],
        }),
      });
      res.json({ ok: true, to: req.user.email });
    } catch (e) {
      e.status = 502;
      e.message = `Envoi impossible : ${e.message}`;
      next(e);
    }
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
      db.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), nowIso(), id);
    }
    res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
  });

  // ---------- Modules HACCP ----------
  mountModules(api, db, { onNonConformity: (e) => reminders.nonConformity(e) });

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
    reminders.nonConformity({ orgId: req.user.org_id, description, author: req.user.name });
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
    // 502 : erreur d'un service externe (SMTP, Stripe) dont le message aide l'utilisateur.
    res.status(status).json({ error: status >= 500 && status !== 502 ? 'Erreur serveur' : err.message });
  });

  return app;
}

module.exports = { createApp };
