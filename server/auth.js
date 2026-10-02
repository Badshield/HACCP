'use strict';

const jwt = require('jsonwebtoken');

const DEV_SECRET = 'dev-secret-change-me';
const SECRET = process.env.JWT_SECRET || DEV_SECRET;
if (SECRET === DEV_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET doit être défini en production');
}

const ROLE_LEVEL = { employee: 1, manager: 2, admin: 3 };

/** dev : identifiant de la tablette pour une session ouverte par code PIN. */
function signToken(user, { dev, expiresIn = '12h' } = {}) {
  return jwt.sign({ uid: user.id, org: user.org_id, role: user.role, ...(dev ? { dev } : {}) }, SECRET, { expiresIn });
}

function authenticate(db) {
  const findUser = db.prepare('SELECT id, org_id, email, name, role, active, notify, password_changed_at, pin_only, pin_hash IS NOT NULL AS has_pin FROM users WHERE id = ?');
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentification requise' });
    try {
      const payload = jwt.verify(token, SECRET);
      const user = findUser.get(payload.uid);
      if (!user || !user.active) return res.status(401).json({ error: 'Compte désactivé' });
      // Un changement de mot de passe déconnecte toutes les sessions ouvertes avant lui.
      if (user.password_changed_at && payload.iat < Math.floor(Date.parse(user.password_changed_at) / 1000)) {
        return res.status(401).json({ error: 'Session expirée' });
      }
      if (payload.dev) {
        // Session tablette : la tablette doit toujours être active, et les droits sont ceux d'un employé.
        const device = db.prepare('SELECT 1 FROM devices WHERE id = ? AND org_id = ? AND revoked_at IS NULL').get(payload.dev, user.org_id);
        if (!device) return res.status(401).json({ error: 'Tablette retirée', code: 'device_invalid' });
        user.role = 'employee';
        user.kiosk = true;
        user.device_id = payload.dev;
      }
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: 'Session expirée' });
    }
  };
}

function requireRole(minRole) {
  return (req, res, next) => {
    if (ROLE_LEVEL[req.user.role] >= ROLE_LEVEL[minRole]) return next();
    res.status(403).json({ error: 'Droits insuffisants' });
  };
}

module.exports = { signToken, authenticate, requireRole, ROLE_LEVEL };
