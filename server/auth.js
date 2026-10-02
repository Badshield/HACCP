'use strict';

const jwt = require('jsonwebtoken');

const DEV_SECRET = 'dev-secret-change-me';
const SECRET = process.env.JWT_SECRET || DEV_SECRET;
if (SECRET === DEV_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET doit être défini en production');
}

const ROLE_LEVEL = { employee: 1, manager: 2, admin: 3 };

function signToken(user) {
  return jwt.sign({ uid: user.id, org: user.org_id, role: user.role }, SECRET, { expiresIn: '12h' });
}

function authenticate(db) {
  const findUser = db.prepare('SELECT id, org_id, email, name, role, active, notify, password_changed_at FROM users WHERE id = ?');
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
