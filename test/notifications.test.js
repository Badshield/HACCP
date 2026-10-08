'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const { makeCustomer } = require('./helpers');
const { createApp } = require('../server/app');
const { createMemoryMailer } = require('../server/mailer');
const { normalizeTimes, localClock } = require('../server/reminders');

const mailer = createMemoryMailer();
let server;
let base;
let db;
let reminders;

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

const mailsTo = (email) => mailer.outbox.filter((m) => m.to.includes(email));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  db = openDb(':memory:');
  const app = createApp(db, { billing: { stripe: null }, mailer, baseUrl: 'https://app.test' });
  reminders = app.locals.reminders;
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('mot de passe oublié : lien unique, valable 1 h, sessions déconnectées', async () => {
  const { token: oldSession } = await signup('oubli@test.fr');

  // Réponse identique pour une adresse inconnue, et aucun e-mail.
  const unknown = await call('/api/auth/forgot', { method: 'POST', body: { email: 'inconnu@test.fr' } });
  assert.equal(unknown.status, 200);
  assert.equal(mailsTo('inconnu@test.fr').length, 0);

  const r = await call('/api/auth/forgot', { method: 'POST', body: { email: 'oubli@test.fr' } });
  assert.equal(r.status, 200);
  const mail = mailsTo('oubli@test.fr').at(-1);
  assert.match(mail.subject, /Réinitialisation/);
  const link = /https:\/\/app\.test\/app#\/reset\?token=([\w-]+)/.exec(mail.text);
  assert.ok(link, 'lien de réinitialisation présent');
  const resetToken = link[1];
  assert.ok(!db.prepare('SELECT 1 FROM password_resets WHERE token_hash = ?').get(resetToken), 'jeton stocké haché');

  assert.equal((await call('/api/auth/reset', { method: 'POST', body: { token: 'faux', password: 'nouveaumdp' } })).status, 400);
  assert.equal((await call('/api/auth/reset', { method: 'POST', body: { token: resetToken, password: 'court' } })).status, 400);

  await sleep(1100); // les jetons JWT sont datés à la seconde
  const ok = await call('/api/auth/reset', { method: 'POST', body: { token: resetToken, password: 'nouveaumdp' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token, 'connecté directement');
  assert.equal((await call('/api/me', { token: ok.body.token })).status, 200);
  assert.equal((await call('/api/me', { token: oldSession })).status, 401, 'ancienne session déconnectée');

  // Lien à usage unique.
  assert.equal((await call('/api/auth/reset', { method: 'POST', body: { token: resetToken, password: 'autremdp1' } })).status, 400);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'oubli@test.fr', password: 'motdepasse' } })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'oubli@test.fr', password: 'nouveaumdp' } })).status, 200);
});

test('mot de passe oublié : lien expiré refusé', async () => {
  await signup('expire-mdp@test.fr');
  await call('/api/auth/forgot', { method: 'POST', body: { email: 'expire-mdp@test.fr' } });
  const t = /token=([\w-]+)/.exec(mailsTo('expire-mdp@test.fr').at(-1).text)[1];
  db.prepare("UPDATE password_resets SET expires_at = '2020-01-01T00:00:00.000Z'").run();
  const r = await call('/api/auth/reset', { method: 'POST', body: { token: t, password: 'nouveaumdp' } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /expiré/);
});

test('changement de mot de passe : nouveau jeton, autres sessions déconnectées', async () => {
  const { token } = await signup('change@test.fr');
  await sleep(1100);
  const r = await call('/api/me/password', { token, method: 'PUT', body: { current: 'motdepasse', password: 'nouveaumdp' } });
  assert.equal(r.status, 200);
  assert.equal((await call('/api/me', { token: r.body.token })).status, 200);
  assert.equal((await call('/api/me', { token })).status, 401);
});

test('alerte immédiate par e-mail à chaque non-conformité', async () => {
  const { token } = await signup('alerte@test.fr');
  await call('/api/users', { token, method: 'POST', body: { name: 'Resp', email: 'resp-alerte@test.fr', password: 'motdepasse', role: 'manager' } });
  await call('/api/users', { token, method: 'POST', body: { name: 'Emp', email: 'emp-alerte@test.fr', password: 'motdepasse', role: 'employee' } });
  const eq = (await call('/api/equipment', { token, method: 'POST', body: { name: 'Frigo bar', type: 'fridge' } })).body;

  await call('/api/temperatures', { token, method: 'POST', body: { equipment_id: eq.id, value: 2 } });
  assert.equal(mailsTo('alerte@test.fr').length, 0, 'pas d\'alerte si conforme');

  await call('/api/temperatures', { token, method: 'POST', body: { equipment_id: eq.id, value: 9 } });
  const alert = mailsTo('alerte@test.fr').at(-1);
  assert.match(alert.subject, /Non-conformité/);
  assert.match(alert.text, /Frigo bar : 9 °C hors plage/);
  assert.ok(alert.to.includes('resp-alerte@test.fr'), 'responsable prévenu');
  assert.ok(!alert.to.includes('emp-alerte@test.fr'), 'employé non destinataire');

  // Un utilisateur peut couper ses alertes ; l'établissement peut désactiver les alertes NC.
  const resp = (await call('/api/auth/login', { method: 'POST', body: { email: 'resp-alerte@test.fr', password: 'motdepasse' } })).body.token;
  await call('/api/me/notify', { token: resp, method: 'PUT', body: { notify: false } });
  await call('/api/non-conformities', { token, method: 'POST', body: { description: 'Rupture de la chaîne du froid' } });
  assert.ok(!mailer.outbox.at(-1).to.includes('resp-alerte@test.fr'));
  assert.match(mailer.outbox.at(-1).text, /Rupture de la chaîne du froid/);

  const settings = (await call('/api/organization/notifications', { token })).body;
  await call('/api/organization/notifications', { token, method: 'PUT', body: { ...settings, notif_nc_alert: false } });
  const before = mailer.outbox.length;
  await call('/api/temperatures', { token, method: 'POST', body: { equipment_id: eq.id, value: 12 } });
  assert.equal(mailer.outbox.length, before);
});

test('paramètres des rappels : validation et normalisation', async () => {
  const { token } = await signup('reglages@test.fr');
  const cur = (await call('/api/organization/notifications', { token })).body;
  assert.equal(cur.notif_temp_times, '09:00,17:00');
  assert.equal(cur.timezone, 'Europe/Paris');
  const put = (body) => call('/api/organization/notifications', { token, method: 'PUT', body: { ...cur, ...body } });
  assert.equal((await put({ notif_temp_times: '25:00' })).status, 400);
  assert.equal((await put({ notif_digest_time: '' })).status, 400);
  assert.equal((await put({ timezone: 'Mars/Olympus' })).status, 400);
  assert.equal((await put({ notif_grace_min: 999 })).status, 400);
  const ok = await put({ notif_temp_times: '17:30 9:00, 12:00', timezone: 'Indian/Reunion' });
  assert.equal(ok.body.notif_temp_times, '09:00,12:00,17:30');
  assert.equal(normalizeTimes(''), '', 'aucun rappel de relevé possible');
  const test1 = await call('/api/organization/notifications/test', { token, method: 'POST' });
  assert.equal(test1.body.to, 'reglages@test.fr');
});

// Jour fixe pour les rappels : 12 mars 2030 (heure d'hiver, Paris = UTC+1).
const at = (iso) => new Date(iso);

test('rappel de relevé de températures oublié (une seule fois par créneau)', async () => {
  const { token, orgId } = await signup('rappel@test.fr', 'restaurant');
  const eq = (await call('/api/equipment', { token })).body;
  const keys = (sent) => sent.filter((k) => k.startsWith(`${orgId}:`));

  // 09:20 à Paris : délai de tolérance (30 min) pas encore écoulé.
  assert.deepEqual(keys(await reminders.run(at('2030-03-12T08:20:00Z'))), []);
  // Un équipement relevé à 08:15 compte pour le créneau de 09:00.
  await call('/api/temperatures', { token, method: 'POST', body: { equipment_id: eq[0].id, value: 3, recorded_at: '2030-03-12T07:15:00Z' } });
  // 09:35 : rappel envoyé, listant uniquement les équipements non relevés.
  assert.deepEqual(keys(await reminders.run(at('2030-03-12T08:35:00Z'))), [`${orgId}:temp:2030-03-12:09:00`]);
  const mail = mailsTo('rappel@test.fr').at(-1);
  assert.match(mail.subject, /Relevé de températures de 09:00 non effectué/);
  assert.ok(!mail.text.includes(`- ${eq[0].name}\n`), 'équipement déjà relevé non listé');
  assert.ok(mail.text.includes(`- ${eq[1].name}`));
  assert.match(mail.text, /https:\/\/app\.test\/app#\/temperatures/);
  // Pas de doublon au passage suivant.
  assert.deepEqual(keys(await reminders.run(at('2030-03-12T08:40:00Z'))), []);
  // Au-delà de 2 h de retard, plus de rappel (serveur redémarré tard).
  const { orgId: late } = await signup('tard@test.fr', 'restaurant');
  assert.deepEqual((await reminders.run(at('2030-03-12T11:00:00Z'))).filter((k) => k.startsWith(`${late}:temp`)), []);

  // 17:35 : tout a été relevé à 17:05 → aucun rappel.
  for (const e of eq) {
    await call('/api/temperatures', { token, method: 'POST', body: { equipment_id: e.id, value: e.type === 'freezer' ? -20 : e.type === 'hot_holding' ? 70 : 3, recorded_at: '2030-03-12T16:05:00Z' } });
  }
  assert.deepEqual(keys(await reminders.run(at('2030-03-12T16:35:00Z'))), []);
});

test('rappels dans le fuseau de l\'établissement (La Réunion)', async () => {
  const { token, orgId } = await signup('reunion@test.fr', 'food_truck');
  const cur = (await call('/api/organization/notifications', { token })).body;
  await call('/api/organization/notifications', { token, method: 'PUT', body: { ...cur, timezone: 'Indian/Reunion' } });
  // 09:35 à La Réunion = 05:35 UTC.
  const sent = (await reminders.run(at('2030-03-12T05:35:00Z'))).filter((k) => k.startsWith(`${orgId}:`));
  assert.deepEqual(sent, [`${orgId}:temp:2030-03-12:09:00`]);
  assert.equal(localClock(at('2030-03-12T05:35:00Z'), 'Indian/Reunion').minutes, 9 * 60 + 35);
});

test('récapitulatif du soir : nettoyages, NC ouvertes, DLC du jour', async () => {
  const { token, orgId } = await signup('recap@test.fr', 'boulangerie');
  const tasks = (await call('/api/cleaning-tasks', { token })).body;
  const petrin = tasks.find((t) => t.name === 'Pétrin');
  await call('/api/cleaning-logs', { token, method: 'POST', body: { task_id: petrin.id, done_at: '2030-03-12T13:00:00Z' } });
  await call('/api/non-conformities', { token, method: 'POST', body: { description: 'Vitrine en panne' } });
  await call('/api/labels', { token, method: 'POST', body: { product: 'Crème pâtissière', kind: 'prepared', start_at: '2030-03-11T08:00:00Z', shelf_life_days: 1 } });

  // 20:05 à Paris.
  const sent = (await reminders.run(at('2030-03-12T19:05:00Z'))).filter((k) => k.startsWith(`${orgId}:digest`));
  assert.deepEqual(sent, [`${orgId}:digest:2030-03-12`]);
  const mail = mailsTo('recap@test.fr').at(-1);
  assert.match(mail.subject, /Récapitulatif hygiène du 12\/03\/2030/);
  assert.match(mail.text, /NETTOYAGES NON VALIDÉS/);
  assert.ok(!mail.text.includes('Laboratoire – Pétrin'), 'tâche faite non listée');
  assert.ok(mail.text.includes('Laboratoire – Tours et plans de travail'));
  assert.match(mail.text, /Vitrine en panne/);
  assert.match(mail.text, /Crème pâtissière : 12\/03\/2030/);
  assert.match(mail.text, /AUCUN RELEVÉ AUJOURD'HUI/);
  assert.deepEqual((await reminders.run(at('2030-03-12T19:30:00Z'))).filter((k) => k.startsWith(`${orgId}:digest`)), []);
});

test('rappels désactivés ou sans destinataire : aucun envoi', async () => {
  const { token, orgId } = await signup('off@test.fr', 'restaurant');
  const cur = (await call('/api/organization/notifications', { token })).body;
  await call('/api/organization/notifications', { token, method: 'PUT', body: { ...cur, notif_enabled: false } });
  assert.deepEqual((await reminders.run(at('2030-03-13T08:35:00Z'))).filter((k) => k.startsWith(`${orgId}:`)), []);

  const { token: t2, orgId: o2 } = await signup('muet@test.fr', 'restaurant');
  await call('/api/me/notify', { token: t2, method: 'PUT', body: { notify: false } });
  assert.deepEqual((await reminders.run(at('2030-03-13T08:36:00Z'))).filter((k) => k.startsWith(`${o2}:`)), []);
});
