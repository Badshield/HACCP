'use strict';

/**
 * Photos jointes aux enregistrements HACCP (bon de livraison, étiquette,
 * produit non conforme, trace de nuisibles...).
 *
 *  - Les images sont redimensionnées et compressées par le navigateur avant
 *    l'envoi, puis stockées sur disque (UPLOAD_DIR, par défaut data/uploads).
 *  - Le type réel du fichier est vérifié (signature binaire), pas seulement
 *    l'en-tête envoyé.
 *  - Une photo est une preuve : elle ne peut être supprimée que par son
 *    auteur, dans les 15 minutes (erreur de prise de vue).
 *  - Quota de stockage par établissement (PHOTO_QUOTA_MB).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const MAX_BYTES = 8 * 1024 * 1024;
const DELETE_WINDOW_MS = 15 * 60000;
const MAX_PER_RECORD = 10;

/** Enregistrements auxquels on peut joindre des photos : entité → table. */
const ENTITIES = {
  receptions: 'receptions',
  non_conformities: 'non_conformities',
  pest_controls: 'pest_controls',
  cleaning_logs: 'cleaning_logs',
  temperature_logs: 'temperature_logs',
  process_logs: 'process_logs',
};

function sniff(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  return null;
}

/** Sous-requête SQL : nombre de photos d'un enregistrement (alias t). */
const photoCount = (entity) => `(SELECT COUNT(*) FROM photos p WHERE p.entity = '${entity}' AND p.entity_id = t.id) AS photo_count`;

function createPhotos(db, opts = {}) {
  const dir = opts.dir || process.env.UPLOAD_DIR || path.join(__dirname, '..', 'data', 'uploads');
  const quota = (Number(opts.quotaMb ?? process.env.PHOTO_QUOTA_MB) || 2000) * 1024 * 1024;
  const audit = db.prepare('INSERT INTO audit_log (org_id, user_id, action, entity, entity_id) VALUES (?,?,?,?,?)');

  const fileOf = (row) => path.join(dir, String(row.org_id), row.filename);
  const err = (status, message) => Object.assign(new Error(message), { status });

  function checkEntity(entity, entityId, orgId) {
    const table = ENTITIES[entity];
    if (!table) throw err(400, 'Type d\'enregistrement non pris en charge');
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND org_id = ?`).get(entityId, orgId)) throw err(404, 'Enregistrement introuvable');
  }

  const router = express.Router();

  router.get('/', (req, res) => {
    const entity = String(req.query.entity || '');
    const entityId = Number(req.query.entity_id);
    checkEntity(entity, entityId, req.user.org_id);
    res.json(db.prepare(`SELECT ph.id, ph.entity, ph.entity_id, ph.mime, ph.size, ph.created_at, ph.user_id, u.name AS user_name
      FROM photos ph LEFT JOIN users u ON u.id = ph.user_id
      WHERE ph.org_id = ? AND ph.entity = ? AND ph.entity_id = ? ORDER BY ph.id`).all(req.user.org_id, entity, entityId));
  });

  router.post('/', express.raw({ type: ['image/*', 'application/octet-stream'], limit: MAX_BYTES }), (req, res) => {
    const entity = String(req.query.entity || '');
    const entityId = Number(req.query.entity_id);
    checkEntity(entity, entityId, req.user.org_id);
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const type = sniff(buf);
    if (!type) throw err(400, 'Format d\'image non reconnu (JPEG ou PNG attendu)');
    const { n, used } = db.prepare('SELECT COUNT(*) FILTER (WHERE entity = ? AND entity_id = ?) AS n, COALESCE(SUM(size),0) AS used FROM photos WHERE org_id = ?')
      .get(entity, entityId, req.user.org_id);
    if (n >= MAX_PER_RECORD) throw err(400, `${MAX_PER_RECORD} photos maximum par enregistrement`);
    if (used + buf.length > quota) throw err(413, 'Espace de stockage des photos plein : contactez le support');

    const filename = `${crypto.randomBytes(16).toString('hex')}.${type.ext}`;
    const orgDir = path.join(dir, String(req.user.org_id));
    fs.mkdirSync(orgDir, { recursive: true });
    fs.writeFileSync(path.join(orgDir, filename), buf, { flag: 'wx' });
    const info = db.prepare('INSERT INTO photos (org_id, entity, entity_id, filename, mime, size, user_id) VALUES (?,?,?,?,?,?,?)')
      .run(req.user.org_id, entity, entityId, filename, type.mime, buf.length, req.user.id);
    audit.run(req.user.org_id, req.user.id, 'create', 'photos', info.lastInsertRowid);
    res.status(201).json(db.prepare('SELECT id, entity, entity_id, mime, size, created_at, user_id FROM photos WHERE id = ?').get(info.lastInsertRowid));
  });

  router.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM photos WHERE id = ? AND org_id = ?').get(Number(req.params.id), req.user.org_id);
    if (!row) return res.status(404).json({ error: 'Photo introuvable' });
    res.set('Content-Type', row.mime);
    res.set('Cache-Control', 'private, max-age=86400');
    res.set('Content-Security-Policy', "default-src 'none'");
    fs.createReadStream(fileOf(row)).on('error', () => res.status(404).end()).pipe(res);
  });

  router.delete('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM photos WHERE id = ? AND org_id = ?').get(Number(req.params.id), req.user.org_id);
    if (!row) return res.status(404).json({ error: 'Photo introuvable' });
    if (row.user_id !== req.user.id || Date.now() - Date.parse(row.created_at) > DELETE_WINDOW_MS) {
      return res.status(403).json({ error: 'Une photo ne peut être supprimée que par son auteur, dans les 15 minutes qui suivent' });
    }
    db.prepare('DELETE FROM photos WHERE id = ?').run(row.id);
    fs.rmSync(fileOf(row), { force: true });
    audit.run(req.user.org_id, req.user.id, 'delete', 'photos', row.id);
    res.status(204).end();
  });

  /** Chemin et métadonnées des photos d'une période (annexe du PDF). */
  function forReport(orgId, entity, ids) {
    if (!ids.length) return [];
    return db.prepare(`SELECT * FROM photos WHERE org_id = ? AND entity = ? AND entity_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
      .all(orgId, entity, ...ids).map((r) => ({ ...r, path: fileOf(r) }));
  }

  /** Supprime tous les fichiers d'un établissement (suppression de compte). */
  function removeOrgFiles(orgId) {
    fs.rmSync(path.join(dir, String(orgId)), { recursive: true, force: true });
  }

  return { router, forReport, removeOrgFiles, dir };
}

module.exports = { createPhotos, photoCount, ENTITIES, sniff };
