'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const { createApp } = require('../server/app');
const { createMemoryMailer } = require('../server/mailer');

let server;
let base;

async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
}

async function signup(org, email) {
  const r = await call('/api/auth/signup', { method: 'POST', body: { organization: org, name: 'Admin', email, password: 'motdepasse', accept_terms: true } });
  assert.equal(r.status, 201);
  return r.body.token;
}

test.before(async () => {
  const app = createApp(openDb(':memory:'), { billing: { stripe: null }, mailer: createMemoryMailer() });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('inscription, connexion et authentification', async () => {
  await signup('Resto A', 'a@test.fr');
  const dup = await call('/api/auth/signup', { method: 'POST', body: { organization: 'X', name: 'X', email: 'a@test.fr', password: 'motdepasse', accept_terms: true } });
  assert.equal(dup.status, 409);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'a@test.fr', password: 'mauvais' } })).status, 401);
  const ok = await call('/api/auth/login', { method: 'POST', body: { email: 'A@test.fr', password: 'motdepasse' } });
  assert.equal(ok.status, 200);
  assert.equal((await call('/api/dashboard')).status, 401);
  const me = await call('/api/me', { token: ok.body.token });
  assert.equal(me.body.organization.name, 'Resto A');
});

test('relevé hors plage → non conforme + non-conformité automatique', async () => {
  const token = await signup('Resto B', 'b@test.fr');
  const eq = await call('/api/equipment', { token, method: 'POST', body: { name: 'Frigo', type: 'fridge' } });
  assert.equal(eq.status, 201);
  assert.equal(eq.body.max_temp, 4, 'seuil par défaut appliqué');
  const ok = await call('/api/temperatures', { token, method: 'POST', body: { equipment_id: eq.body.id, value: '3,5' } });
  assert.equal(ok.body.compliant, 1);
  assert.equal(ok.body.value, 3.5);
  const bad = await call('/api/temperatures', { token, method: 'POST', body: { equipment_id: eq.body.id, value: 8 } });
  assert.equal(bad.body.compliant, 0);
  const ncs = await call('/api/non-conformities?status=open', { token });
  assert.equal(ncs.body.length, 1);
  assert.match(ncs.body[0].description, /Frigo/);
  // Clôture : l'action corrective est obligatoire.
  assert.equal((await call(`/api/non-conformities/${ncs.body[0].id}/close`, { token, method: 'POST', body: {} })).status, 400);
  const closed = await call(`/api/non-conformities/${ncs.body[0].id}/close`, { token, method: 'POST', body: { corrective_action: 'Produits transférés' } });
  assert.equal(closed.body.status, 'closed');
  const dash = await call('/api/dashboard', { token });
  assert.equal(dash.body.openNc, 0);
  assert.equal(dash.body.equipment[0].checked_today, true);
});

test('les registres sont en ajout seul (ni modification ni suppression)', async () => {
  const token = await signup('Resto C', 'c@test.fr');
  const eq = await call('/api/equipment', { token, method: 'POST', body: { name: 'Frigo', type: 'fridge' } });
  const log = await call('/api/temperatures', { token, method: 'POST', body: { equipment_id: eq.body.id, value: 2 } });
  assert.equal((await call(`/api/temperatures/${log.body.id}`, { token, method: 'PUT', body: { value: 3 } })).status, 404);
  assert.equal((await call(`/api/temperatures/${log.body.id}`, { token, method: 'DELETE' })).status, 404);
});

test('isolation stricte entre clients (multi-tenant)', async () => {
  const t1 = await signup('Client 1', 'd1@test.fr');
  const t2 = await signup('Client 2', 'd2@test.fr');
  const eq = await call('/api/equipment', { token: t1, method: 'POST', body: { name: 'Frigo secret', type: 'fridge' } });
  assert.equal((await call('/api/equipment', { token: t2 })).body.length, 0);
  assert.equal((await call(`/api/equipment/${eq.body.id}`, { token: t2 })).status, 404);
  assert.equal((await call(`/api/equipment/${eq.body.id}`, { token: t2, method: 'PUT', body: { name: 'pirate' } })).status, 404);
  const cross = await call('/api/temperatures', { token: t2, method: 'POST', body: { equipment_id: eq.body.id, value: 2 } });
  assert.equal(cross.status, 400, 'impossible de saisir sur l\'équipement d\'un autre client');
});

test('droits : un employé saisit mais ne gère pas le référentiel', async () => {
  const admin = await signup('Resto E', 'e@test.fr');
  const u = await call('/api/users', { token: admin, method: 'POST', body: { name: 'Emp', email: 'emp@test.fr', password: 'motdepasse', role: 'employee' } });
  assert.equal(u.status, 201);
  const emp = (await call('/api/auth/login', { method: 'POST', body: { email: 'emp@test.fr', password: 'motdepasse' } })).body.token;
  assert.equal((await call('/api/equipment', { token: emp, method: 'POST', body: { name: 'F', type: 'fridge' } })).status, 403);
  const eq = await call('/api/equipment', { token: admin, method: 'POST', body: { name: 'F', type: 'fridge' } });
  assert.equal((await call('/api/temperatures', { token: emp, method: 'POST', body: { equipment_id: eq.body.id, value: 2 } })).status, 201);
  assert.equal((await call('/api/users', { token: emp })).status, 403);
  // Compte désactivé → accès refusé immédiatement.
  await call(`/api/users/${u.body.id}`, { token: admin, method: 'PUT', body: { active: false } });
  assert.equal((await call('/api/dashboard', { token: emp })).status, 401);
});

test('validation des saisies', async () => {
  const token = await signup('Resto F', 'f@test.fr');
  assert.equal((await call('/api/temperatures', { token, method: 'POST', body: { value: 2 } })).status, 400);
  assert.equal((await call('/api/receptions', { token, method: 'POST', body: { product: 'X', category: 'inconnu' } })).status, 400);
  assert.equal((await call('/api/recipes', { token, method: 'POST', body: { name: 'X', allergens: ['Chocolat'] } })).status, 400);
  const rec = await call('/api/recipes', { token, method: 'POST', body: { name: 'Quiche', allergens: ['Œufs', 'Lait', 'Gluten'] } });
  assert.deepEqual(rec.body.allergens, ['Œufs', 'Lait', 'Gluten']);
});

test('process, réception, étiquette et exports', async () => {
  const token = await signup('Resto G', 'g@test.fr');
  const p = await call('/api/processes', {
    token,
    method: 'POST',
    body: { type: 'cooling', product: 'Sauce', start_at: '2026-10-02T10:00:00Z', start_temp: 70, end_at: '2026-10-02T12:30:00Z', end_temp: 8 },
  });
  assert.equal(p.body.compliant, 0);
  assert.equal(p.body.duration_min, 150);
  const r = await call('/api/receptions', { token, method: 'POST', body: { product: 'Haché', category: 'viande_hachee', temperature: 1.5 } });
  assert.equal(r.body.compliant, 1);
  const l = await call('/api/labels', { token, method: 'POST', body: { product: 'Crème', kind: 'opened', start_at: '2026-10-02T10:00:00Z', shelf_life_days: 3 } });
  assert.equal(l.body.dlc, '2026-10-05');
  const csv = await call('/api/reports/receptions.csv', { token });
  assert.equal(csv.status, 200);
  assert.match(csv.body, /Haché/);
  const pdf = await fetch(`${base}/api/reports/haccp.pdf?from=2026-01-01&to=2026-12-31`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
});

test('connexion : blocage après trop de tentatives', async () => {
  await signup('Resto H', 'h@test.fr');
  let last;
  for (let i = 0; i < 11; i++) {
    last = await call('/api/auth/login', { method: 'POST', body: { email: 'h@test.fr', password: 'mauvais' } });
  }
  assert.equal(last.status, 429);
});
