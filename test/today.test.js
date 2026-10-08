'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const { makeCustomer } = require('./helpers');
const { createApp } = require('../server/app');
const { createMemoryMailer } = require('../server/mailer');
const { isDue } = require('../server/today');

// Horloge fixe : jeudi 8 octobre 2026, 10 h 00 à Paris (UTC+2).
let clock = new Date('2026-10-08T08:00:00Z');
let server;
let base;
let db;

async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function signup(email, template) {
  return makeCustomer(db, { email, template, name: 'Gérant' });
}

function addEquipment(orgId, name) {
  return Number(db.prepare("INSERT INTO equipment (org_id, name, type, min_temp, max_temp) VALUES (?,?,'fridge',0,4)").run(orgId, name).lastInsertRowid);
}
const reading = (orgId, eq, iso, value = 3) => db.prepare(
  'INSERT INTO temperature_logs (org_id, equipment_id, value, compliant, recorded_at) VALUES (?,?,?,1,?)').run(orgId, eq, value, iso);
const cleaned = (orgId, task, iso) => db.prepare('INSERT INTO cleaning_logs (org_id, task_id, done_at) VALUES (?,?,?)').run(orgId, task, iso);
const task = (orgId, name, frequency) => Number(db.prepare(
  "INSERT INTO cleaning_tasks (org_id, zone, name, frequency) VALUES (?, 'Cuisine', ?, ?)").run(orgId, name, frequency).lastInsertRowid);

test.before(async () => {
  db = openDb(':memory:');
  const app = createApp(db, { billing: { stripe: null }, mailer: createMemoryMailer(), now: () => clock });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('isDue : fréquences de nettoyage', () => {
  assert.equal(isDue('daily', null, '2026-10-08'), true);
  assert.equal(isDue('daily', '2026-10-08', '2026-10-08'), false);
  assert.equal(isDue('daily', '2026-10-07', '2026-10-08'), true);
  assert.equal(isDue('weekly', '2026-10-02', '2026-10-08'), false);
  assert.equal(isDue('weekly', '2026-10-01', '2026-10-08'), true);
  assert.equal(isDue('monthly', '2026-09-10', '2026-10-08'), false);
  assert.equal(isDue('monthly', '2026-09-08', '2026-10-08'), true);
  assert.equal(isDue('after_use', null, '2026-10-08'), false, 'à la demande : jamais en retard');
});

test('liste du jour : relevés, nettoyages et progression', async () => {
  const { token, orgId } = await signup('jour@test.fr');
  const a = addEquipment(orgId, 'Frigo A');
  const b = addEquipment(orgId, 'Frigo B');
  const daily = task(orgId, 'Plans de travail', 'daily');
  const weekly = task(orgId, 'Hotte', 'weekly');
  const onDemand = task(orgId, 'Trancheuse', 'after_use');
  cleaned(orgId, weekly, '2026-10-06T20:00:00Z'); // fait il y a 2 jours : pas à refaire

  let t = (await call('/api/today', { token })).body;
  assert.equal(t.today, '2026-10-08');
  assert.deepEqual(t.progress, { done: 0, total: 3 }, '2 relevés + 1 nettoyage quotidien (hebdo récent et à la demande exclus)');
  assert.deepEqual(t.temperatures.map((x) => x.name), ['Frigo A', 'Frigo B']);
  assert.equal(t.cleaning.find((x) => x.id === daily).due, true);
  assert.equal(t.cleaning.find((x) => x.id === weekly).due, false);
  assert.equal(t.cleaning.find((x) => x.id === onDemand).due, false);

  reading(orgId, a, '2026-10-08T06:30:00Z', 2.5);
  cleaned(orgId, daily, '2026-10-08T07:00:00Z');
  t = (await call('/api/today', { token })).body;
  assert.deepEqual(t.progress, { done: 2, total: 3 });
  assert.equal(t.temperatures[0].done, true);
  assert.equal(t.temperatures[0].reading.value, 2.5);
  assert.equal(t.temperatures[1].done, false);
  assert.equal(t.cleaning.find((x) => x.id === daily).done, true);
});

test('les jours suivent le fuseau horaire de l\'établissement', async () => {
  const { token, orgId } = await signup('fuseau@test.fr');
  const eq = addEquipment(orgId, 'Frigo');
  // 22 h 30 UTC le 7 octobre = 0 h 30 le 8 octobre à Paris : c'est déjà « aujourd'hui ».
  reading(orgId, eq, '2026-10-07T22:30:00Z');
  let t = (await call('/api/today', { token })).body;
  assert.equal(t.temperatures[0].done, true, 'Paris (UTC+2)');

  // Même instant à Los Angeles (UTC-7) : encore le 7 octobre → pas fait aujourd'hui.
  db.prepare("UPDATE organizations SET timezone = 'America/Los_Angeles' WHERE id = ?").run(orgId);
  t = (await call('/api/today', { token })).body;
  assert.equal(t.today, '2026-10-08');
  assert.equal(t.temperatures[0].done, false);
  assert.equal(t.temperatures[0].previous.value, 3);
});

test('série de jours : complète, jour de fermeture neutre, jour incomplet qui casse', async () => {
  const { token, orgId } = await signup('serie@test.fr');
  const a = addEquipment(orgId, 'Frigo A');
  const b = addEquipment(orgId, 'Frigo B');
  const day = (n) => `2026-10-${String(n).padStart(2, '0')}T08:00:00Z`;

  // Du lundi 28 septembre au mercredi 7 octobre : tout est relevé, sauf le dimanche 4 (fermé).
  for (const iso of ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-07']) {
    reading(orgId, a, `${iso}T08:00:00Z`);
    reading(orgId, b, `${iso}T08:05:00Z`);
  }
  let t = (await call('/api/today', { token })).body;
  assert.equal(t.streak, 9, 'les 9 jours ouverts comptent, le dimanche fermé est neutre');
  assert.deepEqual(t.week.map((w) => w.state), ['done', 'done', 'off', 'done', 'done', 'done', 'today'], 'semaine du 2 au 8 octobre');
  assert.equal(t.week[0].day, '2026-10-02');
  assert.equal(t.week[2].state, 'off', 'dimanche 4 octobre : fermé');
  assert.equal(t.week.at(-1).state, 'today');

  // Aujourd'hui, un seul frigo relevé : série inchangée (pas encore complète), jour « partiel ».
  reading(orgId, a, day(8));
  t = (await call('/api/today', { token })).body;
  assert.equal(t.streak, 9);
  assert.equal(t.week.at(-1).state, 'partial');

  // Tout est relevé : la série gagne un jour.
  reading(orgId, b, day(8));
  t = (await call('/api/today', { token })).body;
  assert.equal(t.streak, 10);
  assert.equal(t.week.at(-1).state, 'done');

  // Un jour avec un seul frigo relevé casse la série.
  db.prepare("DELETE FROM temperature_logs WHERE equipment_id = ? AND recorded_at LIKE '2026-10-06%'").run(b);
  t = (await call('/api/today', { token })).body;
  assert.equal(t.streak, 2, 'aujourd\'hui + hier seulement');
  assert.equal(t.week.find((w) => w.day === '2026-10-06').state, 'missed');
});

test('compte neuf : pas de série fantôme, premiers pas pour le responsable', async () => {
  const { token } = await signup('neuf@test.fr', 'restaurant');
  const t = (await call('/api/today', { token })).body;
  assert.equal(t.streak, 0);
  assert.ok(t.week.every((w) => ['none', 'today'].includes(w.state)), 'aucun jour « manqué » avant le premier relevé');
  assert.ok(t.progress.total > 5, 'le modèle de métier remplit la liste du jour');
  assert.equal(t.firstSteps.readings, 0);
  assert.equal(t.firstSteps.members, 1);
  assert.ok(t.firstSteps.equipment > 0);
});

test('alertes et DLC du jour, premiers pas réservés aux responsables', async () => {
  const { token, orgId } = await signup('alertes@test.fr');
  db.prepare("INSERT INTO non_conformities (org_id, source, description) VALUES (?, 'manual', 'Frigo en panne')").run(orgId);
  db.prepare("INSERT INTO labels (org_id, product, kind, start_at, shelf_life_days, dlc) VALUES (?, 'Crème', 'prepared', '2026-10-07T08:00:00Z', 1, '2026-10-08')").run(orgId);
  db.prepare("INSERT INTO labels (org_id, product, kind, start_at, shelf_life_days, dlc) VALUES (?, 'Sauce', 'prepared', '2026-10-07T08:00:00Z', 2, '2026-10-09')").run(orgId);
  db.prepare("INSERT INTO labels (org_id, product, kind, start_at, shelf_life_days, dlc) VALUES (?, 'Ancien', 'prepared', '2026-10-01T08:00:00Z', 1, '2026-10-02')").run(orgId);
  const t = (await call('/api/today', { token })).body;
  assert.equal(t.alerts.count, 1);
  assert.equal(t.alerts.items[0].description, 'Frigo en panne');
  assert.deepEqual(t.labels.map((l) => [l.product, l.when]), [['Crème', 'today'], ['Sauce', 'tomorrow']]);

  await call('/api/users', { token, method: 'POST', body: { name: 'Emp', email: 'emp-jour@test.fr', password: 'motdepasse', role: 'employee' } });
  const emp = (await call('/api/auth/login', { method: 'POST', body: { email: 'emp-jour@test.fr', password: 'motdepasse' } })).body.token;
  assert.equal((await call('/api/today', { token: emp })).body.firstSteps, null);
});

test('isolation entre clients et authentification', async () => {
  const { token: t1, orgId } = await signup('iso1@test.fr');
  const { token: t2 } = await signup('iso2@test.fr');
  addEquipment(orgId, 'Frigo secret');
  assert.equal((await call('/api/today', { token: t2 })).body.temperatures.length, 0);
  assert.equal((await call('/api/today', { token: t1 })).body.temperatures.length, 1);
  assert.equal((await call('/api/today')).status, 401);
});

test('un relevé hors limite renvoie la non-conformité à traiter', async () => {
  const { token, orgId } = await signup('hors@test.fr');
  const eq = addEquipment(orgId, 'Frigo');
  const ok = await call('/api/temperatures', { token, method: 'POST', body: { equipment_id: eq, value: 2 } });
  assert.equal(ok.body.non_conformity_id, undefined);
  const bad = await call('/api/temperatures', { token, method: 'POST', body: { equipment_id: eq, value: 9 } });
  assert.equal(bad.body.compliant, 0);
  assert.ok(Number.isInteger(bad.body.non_conformity_id));
  const closed = await call(`/api/non-conformities/${bad.body.non_conformity_id}/close`, { token, method: 'POST', body: { corrective_action: 'Produits transférés' } });
  assert.equal(closed.status, 200);
});

test('noter une action sans clore l\'alerte, puis la clore avec cette action', async () => {
  const { token, orgId } = await signup('action@test.fr');
  const other = (await signup('action-autre@test.fr')).token;
  const eq = addEquipment(orgId, 'Frigo');
  const bad = await call('/api/temperatures', { token, method: 'POST', body: { equipment_id: eq, value: 9 } });
  const id = bad.body.non_conformity_id;

  assert.equal((await call(`/api/non-conformities/${id}/action`, { token, method: 'PUT', body: {} })).status, 400, 'action obligatoire');
  assert.equal((await call(`/api/non-conformities/${id}/action`, { token: other, method: 'PUT', body: { corrective_action: 'x' } })).status, 404, 'autre client');
  const noted = await call(`/api/non-conformities/${id}/action`, { token, method: 'PUT', body: { corrective_action: 'Technicien appelé' } });
  assert.equal(noted.status, 200);
  assert.equal(noted.body.status, 'open', 'l\'alerte reste ouverte');
  assert.equal(noted.body.corrective_action, 'Technicien appelé');

  // La clôture sans nouveau texte reprend l'action déjà notée.
  const closed = await call(`/api/non-conformities/${id}/close`, { token, method: 'POST', body: {} });
  assert.equal(closed.body.status, 'closed');
  assert.equal(closed.body.corrective_action, 'Technicien appelé');
  assert.equal((await call(`/api/non-conformities/${id}/action`, { token, method: 'PUT', body: { corrective_action: 'autre' } })).status, 400, 'plus modifiable une fois clôturée');
});
