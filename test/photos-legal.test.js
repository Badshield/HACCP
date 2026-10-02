'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDb } = require('../server/db');
const { createApp } = require('../server/app');
const { createMemoryMailer } = require('../server/mailer');
const { TERMS_VERSION } = require('../server/legal');

// Image PNG 1×1 valide.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

let server;
let base;
let db;
const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'haccp-photos-'));

async function call(urlPath, { token, method = 'GET', body, raw, type } = {}) {
  const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}) };
  if (body) headers['content-type'] = 'application/json';
  if (raw) headers['content-type'] = type || 'image/png';
  const res = await fetch(base + urlPath, { method, headers, body: raw || (body ? JSON.stringify(body) : undefined) });
  const ct = res.headers.get('content-type') || '';
  const out = ct.includes('json') ? await res.json() : ct.startsWith('image/') ? Buffer.from(await res.arrayBuffer()) : await res.text();
  return { status: res.status, body: out, headers: res.headers };
}

async function signup(email) {
  const r = await call('/api/auth/signup', {
    method: 'POST', body: { organization: `Org ${email}`, name: 'Gérant', email, password: 'motdepasse', accept_terms: true },
  });
  assert.equal(r.status, 201);
  return { token: r.body.token, orgId: r.body.user.org_id };
}

const upload = (token, entity, id, raw = PNG, type) => call(`/api/photos?entity=${entity}&entity_id=${id}`, { token, method: 'POST', raw, type });
const reception = async (token) => (await call('/api/receptions', { token, method: 'POST', body: { product: 'Filets de poulet', category: 'volaille', temperature: 3 } })).body;

test.before(async () => {
  db = openDb(':memory:');
  const app = createApp(db, { billing: { stripe: null }, mailer: createMemoryMailer(), photos: { dir: uploadDir } });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); fs.rmSync(uploadDir, { recursive: true, force: true }); });

test('inscription : acceptation des CGV obligatoire et enregistrée', async () => {
  const refused = await call('/api/auth/signup', { method: 'POST', body: { organization: 'X', name: 'X', email: 'nocgv@test.fr', password: 'motdepasse' } });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /CGV/);
  const { token, orgId } = await signup('cgv@test.fr');
  const me = (await call('/api/me', { token })).body;
  assert.deepEqual(me.terms, { version: TERMS_VERSION, outdated: false });
  assert.equal(db.prepare('SELECT terms_version FROM organizations WHERE id = ?').get(orgId).terms_version, TERMS_VERSION);
});

test('nouvelle version des CGV : l\'administrateur doit les accepter', async () => {
  const { token, orgId } = await signup('cgv2@test.fr');
  db.prepare("UPDATE organizations SET terms_version = '2020-01-01' WHERE id = ?").run(orgId);
  assert.equal((await call('/api/me', { token })).body.terms.outdated, true);
  assert.equal((await call('/api/organization/accept-terms', { token, method: 'POST', body: { version: '2020-01-01' } })).status, 400);
  assert.equal((await call('/api/organization/accept-terms', { token, method: 'POST', body: { version: TERMS_VERSION } })).status, 200);
  assert.equal((await call('/api/me', { token })).body.terms.outdated, false);
});

test('pages légales publiques', async () => {
  for (const [page, title] of [['mentions', 'Mentions légales'], ['cgv', 'Conditions générales'], ['confidentialite', 'Politique de confidentialité'], ['sous-traitance', 'article 28']]) {
    const r = await call(`/legal/${page}`);
    assert.equal(r.status, 200, page);
    assert.match(r.body, new RegExp(title));
    assert.match(r.body, /À compléter/, 'informations manquantes signalées');
  }
  const cgv = (await call('/legal/cgv')).body;
  assert.match(cgv, /19 € HT par mois/);
  assert.match(cgv, /L\. 441-10/);
});

test('photos : envoi, lecture, compteur et cloisonnement', async () => {
  const { token } = await signup('photo@test.fr');
  const { token: other } = await signup('photo-autre@test.fr');
  const rec = await reception(token);

  const up = await upload(token, 'receptions', rec.id);
  assert.equal(up.status, 201);
  assert.equal(up.body.mime, 'image/png');
  const list = (await call('/api/receptions', { token })).body;
  assert.equal(list.find((r) => r.id === rec.id).photo_count, 1);

  const img = await call(`/api/photos/${up.body.id}`, { token });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.ok(img.body.equals(PNG));

  assert.equal((await call(`/api/photos/${up.body.id}`, { token: other })).status, 404, 'autre client : invisible');
  assert.equal((await upload(other, 'receptions', rec.id)).status, 404, 'autre client : pas d\'ajout');
  assert.equal((await call(`/api/photos?entity=receptions&entity_id=${rec.id}`, { token: other })).status, 404);
  assert.equal((await call(`/api/photos/${up.body.id}`)).status, 401, 'authentification requise');

  const photos = (await call(`/api/photos?entity=receptions&entity_id=${rec.id}`, { token })).body;
  assert.equal(photos.length, 1);
  assert.equal(photos[0].user_name, 'Gérant');
});

test('photos : formats contrôlés, limites et suppression encadrée', async () => {
  const { token } = await signup('photo2@test.fr');
  const rec = await reception(token);
  const fake = await upload(token, 'receptions', rec.id, Buffer.from('<script>alert(1)</script>'), 'image/png');
  assert.equal(fake.status, 400, 'contenu non image refusé malgré l\'en-tête');
  assert.equal((await upload(token, 'users', 1)).status, 400, 'type d\'enregistrement non autorisé');

  const ids = [];
  for (let i = 0; i < 10; i++) ids.push((await upload(token, 'receptions', rec.id)).body.id);
  assert.equal((await upload(token, 'receptions', rec.id)).status, 400, '10 photos maximum');

  // Suppression : auteur uniquement, dans les 15 minutes.
  await call('/api/users', { token, method: 'POST', body: { name: 'Resp', email: 'resp-photo@test.fr', password: 'motdepasse', role: 'manager' } });
  const resp = (await call('/api/auth/login', { method: 'POST', body: { email: 'resp-photo@test.fr', password: 'motdepasse' } })).body.token;
  assert.equal((await call(`/api/photos/${ids[0]}`, { token: resp, method: 'DELETE' })).status, 403);
  const row = db.prepare('SELECT * FROM photos WHERE id = ?').get(ids[0]);
  const file = path.join(uploadDir, String(row.org_id), row.filename);
  assert.ok(fs.existsSync(file));
  assert.equal((await call(`/api/photos/${ids[0]}`, { token, method: 'DELETE' })).status, 204);
  assert.ok(!fs.existsSync(file), 'fichier supprimé');
  db.prepare("UPDATE photos SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(ids[1]);
  assert.equal((await call(`/api/photos/${ids[1]}`, { token, method: 'DELETE' })).status, 403, 'au-delà de 15 min : preuve conservée');
});

test('photos sur une non-conformité et annexe du classeur PDF', async () => {
  const { token } = await signup('photo-nc@test.fr');
  const nc = (await call('/api/non-conformities', { token, method: 'POST', body: { description: 'Emballage percé' } })).body;
  assert.equal((await upload(token, 'non_conformities', nc.id)).status, 201);
  assert.equal((await call('/api/non-conformities', { token })).body[0].photo_count, 1);
  const pdf = await fetch(`${base}/api/reports/haccp.pdf`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(pdf.status, 200);
  const buf = Buffer.from(await pdf.arrayBuffer());
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
  assert.match(buf.toString('latin1'), /\/Subtype \/Image/, 'photo intégrée au PDF');
});

test('export complet des données (portabilité)', async () => {
  const { token } = await signup('export@test.fr');
  const rec = await reception(token);
  await upload(token, 'receptions', rec.id);
  const r = await call('/api/organization/export', { token });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /attachment/);
  assert.equal(r.body.receptions[0].product, 'Filets de poulet');
  assert.equal(r.body.users[0].email, 'export@test.fr');
  assert.equal(r.body.users[0].password_hash, undefined, 'mots de passe exclus');
  assert.match(r.body.photos[0].download, /^\/api\/photos\/\d+$/);
  assert.equal(r.body.photos[0].filename, undefined);
});

test('suppression du compte : confirmation, données et fichiers effacés', async () => {
  const { token, orgId } = await signup('suppr@test.fr');
  const { token: other } = await signup('garde@test.fr');
  const rec = await reception(token);
  await upload(token, 'receptions', rec.id);
  const kept = await reception(other);
  await upload(other, 'receptions', kept.id);

  assert.equal((await call('/api/organization/delete', { token, method: 'POST', body: { password: 'faux', confirm: 'Org suppr@test.fr' } })).status, 400);
  assert.equal((await call('/api/organization/delete', { token, method: 'POST', body: { password: 'motdepasse', confirm: 'autre' } })).status, 400);
  const del = await call('/api/organization/delete', { token, method: 'POST', body: { password: 'motdepasse', confirm: 'Org suppr@test.fr' } });
  assert.equal(del.status, 204);

  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'suppr@test.fr', password: 'motdepasse' } })).status, 401);
  for (const t of ['organizations', 'users', 'receptions', 'photos', 'audit_log']) {
    const col = t === 'organizations' ? 'id' : 'org_id';
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = ?`).get(orgId).n, 0, t);
  }
  assert.ok(!fs.existsSync(path.join(uploadDir, String(orgId))), 'photos effacées');
  assert.equal((await call('/api/receptions', { token: other })).body.length, 1, 'autres clients intacts');
  assert.equal((await call('/api/organization/delete', { token: other, method: 'POST', body: {} })).status, 400);
});
