'use strict';

/**
 * Tablette de cuisine partagée : connexion des employés par code PIN.
 *
 *  - Un responsable déclare l'appareil comme « tablette de cuisine » : il
 *    reçoit un jeton d'appareil (révocable) conservé par le navigateur.
 *  - Sur cette tablette, chacun touche son nom puis tape son code PIN : les
 *    saisies sont ainsi attribuées à la bonne personne (traçabilité HACCP),
 *    sans partager un compte ni retaper un e-mail avec des gants.
 *  - Une session PIN a toujours les droits d'un employé (saisie seulement),
 *    même pour un responsable : un code à 4 chiffres ne doit pas donner accès
 *    à l'administration. Elle expire vite et tombe si la tablette est révoquée.
 *  - 5 codes faux → compte bloqué 15 minutes sur la tablette.
 */

const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { signToken, requireRole } = require('./auth');

const PIN_RE = /^\d{4,6}$/;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60000;
const KIOSK_SESSION = '4h';

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const nowIso = () => new Date().toISOString();
const err = (status, message) => Object.assign(new Error(message), { status });

/** Refuse les codes trop faciles à deviner (0000, 1234, 9876...). */
function checkPin(pin) {
  const p = String(pin ?? '');
  if (!PIN_RE.test(p)) throw err(400, 'Le code PIN doit comporter 4 à 6 chiffres');
  const digits = [...p].map(Number);
  const same = digits.every((d) => d === digits[0]);
  const step = (k) => digits.every((d, i) => i === 0 || d === (digits[i - 1] + k + 10) % 10);
  if (same || step(1) || step(-1)) throw err(400, 'Code PIN trop simple : évitez les chiffres identiques ou qui se suivent');
  return p;
}

const hashPin = (pin) => bcrypt.hashSync(checkPin(pin), 10);

function createKiosk(db, { limiter, onLogin }) {
  function deviceFrom(req) {
    const token = req.get('x-device-token');
    if (!token) return null;
    return db.prepare('SELECT * FROM devices WHERE token_hash = ? AND revoked_at IS NULL').get(sha256(token)) || null;
  }

  // ---------- Routes publiques de la tablette (jeton d'appareil) ----------
  const kiosk = express.Router();
  kiosk.use((req, res, next) => {
    const device = deviceFrom(req);
    if (!device) return res.status(401).json({ error: 'Tablette non reconnue ou retirée', code: 'device_invalid' });
    db.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').run(nowIso(), device.id);
    req.device = device;
    next();
  });

  kiosk.get('/', (req, res) => {
    const org = db.prepare('SELECT name FROM organizations WHERE id = ?').get(req.device.org_id);
    const users = db.prepare(`SELECT id, name FROM users WHERE org_id = ? AND active = 1 AND pin_hash IS NOT NULL
      ORDER BY name COLLATE NOCASE`).all(req.device.org_id);
    res.json({ organization: org.name, device: req.device.name, users });
  });

  kiosk.post('/login', limiter, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND org_id = ? AND active = 1')
      .get(Number(req.body?.user_id), req.device.org_id);
    if (!user || !user.pin_hash) return res.status(400).json({ error: 'Utilisateur inconnu' });
    if (user.pin_locked_until && user.pin_locked_until > nowIso()) {
      const min = Math.ceil((Date.parse(user.pin_locked_until) - Date.now()) / 60000);
      return res.status(423).json({ error: `Trop d'erreurs : réessayez dans ${min} min ou demandez à un responsable` });
    }
    if (!bcrypt.compareSync(String(req.body?.pin ?? ''), user.pin_hash)) {
      const fails = user.pin_failed + 1;
      const locked = fails >= MAX_FAILS;
      db.prepare('UPDATE users SET pin_failed = ?, pin_locked_until = ? WHERE id = ?')
        .run(locked ? 0 : fails, locked ? new Date(Date.now() + LOCK_MS).toISOString() : null, user.id);
      return res.status(401).json({
        error: locked ? 'Code faux. Compte bloqué 15 minutes sur la tablette.' : `Code faux (encore ${MAX_FAILS - fails} essai(s))`,
      });
    }
    db.prepare('UPDATE users SET pin_failed = 0, pin_locked_until = NULL WHERE id = ?').run(user.id);
    onLogin?.(user);
    res.json({
      token: signToken(user, { dev: req.device.id, expiresIn: KIOSK_SESSION }),
      user: { id: user.id, name: user.name, role: 'employee', kiosk: true },
    });
  });

  // ---------- Gestion des tablettes (responsables) ----------
  const devices = express.Router();
  devices.use(requireRole('manager'));

  devices.get('/', (req, res) => {
    res.json(db.prepare(`SELECT d.id, d.name, d.created_at, d.last_seen_at, u.name AS created_by_name FROM devices d
      LEFT JOIN users u ON u.id = d.created_by WHERE d.org_id = ? AND d.revoked_at IS NULL ORDER BY d.id`).all(req.user.org_id));
  });

  devices.post('/', (req, res) => {
    if (req.user.kiosk) throw err(403, 'Action impossible depuis une session tablette');
    const name = String(req.body?.name || '').trim().slice(0, 80) || 'Tablette cuisine';
    const token = crypto.randomBytes(32).toString('base64url');
    const info = db.prepare('INSERT INTO devices (org_id, name, token_hash, created_by) VALUES (?,?,?,?)')
      .run(req.user.org_id, name, sha256(token), req.user.id);
    // Le jeton n'est renvoyé qu'une fois : seule son empreinte est stockée.
    res.status(201).json({ id: Number(info.lastInsertRowid), name, token });
  });

  devices.delete('/:id', (req, res) => {
    const info = db.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND org_id = ? AND revoked_at IS NULL')
      .run(nowIso(), Number(req.params.id), req.user.org_id);
    if (!info.changes) return res.status(404).json({ error: 'Tablette introuvable' });
    res.status(204).end();
  });

  return { kiosk, devices };
}

module.exports = { createKiosk, checkPin, hashPin };
