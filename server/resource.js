'use strict';

const express = require('express');
const { requireRole } = require('./auth');

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function coerce(name, spec, raw) {
  if (raw === undefined || raw === null || raw === '') {
    if (spec.required) throw new ValidationError(`Champ obligatoire : ${spec.label || name}`);
    return spec.default !== undefined ? spec.default : null;
  }
  switch (spec.type) {
    case 'string': {
      const s = String(raw).trim();
      if (spec.required && !s) throw new ValidationError(`Champ obligatoire : ${spec.label || name}`);
      if (s.length > (spec.max || 500)) throw new ValidationError(`${name} trop long`);
      return s;
    }
    case 'number':
    case 'int': {
      const n = Number(String(raw).replace(',', '.'));
      if (!Number.isFinite(n)) throw new ValidationError(`${spec.label || name} doit être un nombre`);
      return spec.type === 'int' ? Math.trunc(n) : n;
    }
    case 'bool':
      return raw === true || raw === 1 || raw === '1' || raw === 'true' || raw === 'on' ? 1 : 0;
    case 'date':
      if (!DATE_RE.test(String(raw))) throw new ValidationError(`${spec.label || name} : date invalide`);
      return String(raw);
    case 'datetime': {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) throw new ValidationError(`${spec.label || name} : date/heure invalide`);
      return d.toISOString();
    }
    case 'enum':
      if (!spec.values.includes(raw)) throw new ValidationError(`${spec.label || name} : valeur invalide`);
      return raw;
    case 'json':
      if (!Array.isArray(raw)) throw new ValidationError(`${name} doit être une liste`);
      return JSON.stringify(raw.map(String));
    case 'ref': {
      const id = Number(raw);
      if (!Number.isInteger(id)) throw new ValidationError(`${spec.label || name} invalide`);
      return id;
    }
    default:
      throw new Error(`Type inconnu ${spec.type}`);
  }
}

/**
 * Crée un routeur CRUD isolé par organisation (multi-tenant).
 *
 * options :
 *  - table, fields
 *  - mode : 'referential' (modifiable, réservé manager+) ou 'log' (registre
 *    en ajout seul : un enregistrement HACCP ne doit jamais être modifié ni
 *    supprimé pour garder sa valeur de preuve)
 *  - select : requête SELECT de base (avec alias "t" pour la table)
 *  - dateField : champ utilisé pour filtrer ?from=&to=
 *  - compute(data, ctx) : enrichit la ligne (conformité...) et peut renvoyer
 *    { nonConformity: 'description' } pour ouvrir une NC automatiquement
 *  - onNonConformity({ orgId, description, author }) : appelé après l'ouverture d'une NC
 */
function resource(db, opts) {
  const {
    table, fields, mode = 'referential', dateField, compute,
    orderBy = dateField ? `t.${dateField} DESC` : 't.id DESC',
    select = `SELECT t.* FROM ${table} t`,
    serialize = (r) => r,
  } = opts;
  const writeRole = opts.writeRole || (mode === 'log' ? 'employee' : 'manager');
  const router = express.Router();
  const audit = db.prepare('INSERT INTO audit_log (org_id, user_id, action, entity, entity_id) VALUES (?,?,?,?,?)');
  const insertNc = db.prepare(
    'INSERT INTO non_conformities (org_id, source, source_id, description, corrective_action, created_by) VALUES (?,?,?,?,?,?)'
  );

  function parse(body, partial = false) {
    const out = {};
    for (const [name, spec] of Object.entries(fields)) {
      if (spec.computed) continue;
      if (partial && !(name in body)) continue;
      out[name] = coerce(name, spec, body[name]);
    }
    return out;
  }

  function checkRefs(data, orgId) {
    for (const [name, spec] of Object.entries(fields)) {
      if (spec.type !== 'ref' || data[name] == null) continue;
      const row = db.prepare(`SELECT id FROM ${spec.table} WHERE id = ? AND org_id = ?`).get(data[name], orgId);
      if (!row) throw new ValidationError(`${spec.label || name} introuvable`);
    }
  }

  function getOne(id, orgId) {
    return db.prepare(`${select} WHERE t.id = ? AND t.org_id = ?`).get(id, orgId);
  }

  router.get('/', (req, res) => {
    const where = ['t.org_id = ?'];
    const params = [req.user.org_id];
    if (dateField && req.query.from) { where.push(`t.${dateField} >= ?`); params.push(String(req.query.from)); }
    if (dateField && req.query.to) { where.push(`t.${dateField} < date(?, '+1 day')`); params.push(String(req.query.to)); }
    if ('active' in fields && req.query.all !== '1') where.push('t.active = 1');
    for (const key of opts.filters || []) {
      if (req.query[key] !== undefined) { where.push(`t.${key} = ?`); params.push(String(req.query[key])); }
    }
    const limit = Math.min(Number(req.query.limit) || 200, 2000);
    const rows = db.prepare(`${select} WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT ${limit}`).all(...params);
    res.json(rows.map(serialize));
  });

  router.get('/:id', (req, res) => {
    const row = getOne(Number(req.params.id), req.user.org_id);
    if (!row) return res.status(404).json({ error: 'Introuvable' });
    res.json(serialize(row));
  });

  router.post('/', requireRole(writeRole), (req, res) => {
    const data = parse(req.body || {});
    checkRefs(data, req.user.org_id);
    if ('user_id' in fields) data.user_id = req.user.id;
    if (dateField && fields[dateField] && !data[dateField]) data[dateField] = new Date().toISOString();
    const extra = compute ? compute(data, { db, user: req.user }) || {} : {};
    const tx = db.transaction(() => {
      const row = { ...data, org_id: req.user.org_id };
      const cols = Object.keys(row);
      const info = db
        .prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
        .run(...cols.map((c) => row[c]));
      const id = Number(info.lastInsertRowid);
      if (extra.nonConformity) {
        insertNc.run(req.user.org_id, table, id, extra.nonConformity, data.comment || null, req.user.id);
      }
      audit.run(req.user.org_id, req.user.id, 'create', table, id);
      return id;
    });
    const id = tx();
    if (extra.nonConformity && opts.onNonConformity) {
      opts.onNonConformity({ orgId: req.user.org_id, description: extra.nonConformity, author: req.user.name });
    }
    res.status(201).json(serialize(getOne(id, req.user.org_id)));
  });

  if (mode === 'referential') {
    router.put('/:id', requireRole(writeRole), (req, res) => {
      const id = Number(req.params.id);
      if (!getOne(id, req.user.org_id)) return res.status(404).json({ error: 'Introuvable' });
      const data = parse(req.body || {}, true);
      checkRefs(data, req.user.org_id);
      if (compute) compute(data, { db, user: req.user, id });
      const cols = Object.keys(data);
      if (cols.length) {
        db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(',')} WHERE id = ? AND org_id = ?`)
          .run(...cols.map((c) => data[c]), id, req.user.org_id);
        audit.run(req.user.org_id, req.user.id, 'update', table, id);
      }
      res.json(serialize(getOne(id, req.user.org_id)));
    });

    // Suppression logique : l'historique des registres reste lié au référentiel.
    router.delete('/:id', requireRole(writeRole), (req, res) => {
      const id = Number(req.params.id);
      if (!getOne(id, req.user.org_id)) return res.status(404).json({ error: 'Introuvable' });
      if ('active' in fields) {
        db.prepare(`UPDATE ${table} SET active = 0 WHERE id = ? AND org_id = ?`).run(id, req.user.org_id);
      } else {
        db.prepare(`DELETE FROM ${table} WHERE id = ? AND org_id = ?`).run(id, req.user.org_id);
      }
      audit.run(req.user.org_id, req.user.id, 'delete', table, id);
      res.status(204).end();
    });
  }

  return router;
}

module.exports = { resource, ValidationError, coerce };
