'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const { createMemoryMailer } = require('../server/mailer');
const { checkPin } = require('../server/kiosk');

process.env.CONTACT_EMAIL = 'commercial@editeur.test';
const { createApp } = require('../server/app');

const mailer = createMemoryMailer();
let server;
let base;
let db;

async function call(urlPath, { token, device, method = 'GET', body } = {}) {
  const headers = {
    ...(body ? { 'content-type': 'application/json' } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(device ? { 'x-device-token': device } : {}),
  };
  const res = await fetch(base + urlPath, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text() };
}

async function signup(email) {
  const r = await call('/api/auth/signup', {
    method: 'POST', body: { organization: `Org ${email}`, name: 'Gérante', email, password: 'motdepasse', template: 'restaurant', accept_terms: true },
  });
  assert.equal(r.status, 201);
  return { token: r.body.token, orgId: r.body.user.org_id, userId: r.body.user.id };
}

test.before(async () => {
  db = openDb(':memory:');
  const app = createApp(db, { billing: { stripe: null }, mailer });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('code PIN : 4 à 6 chiffres, codes trop simples refusés', () => {
  for (const bad of ['12', '1234567', 'abcd', '0000', '1234', '9876', '4567', '7890', '1111']) {
    assert.throws(() => checkPin(bad), undefined, bad);
  }
  for (const ok of ['2580', '1397', '804215', '1123']) assert.equal(checkPin(ok), ok);
});

test('tablette de cuisine : déclaration, liste des employés, connexion par PIN', async () => {
  const { token, userId } = await signup('cuisine@test.fr');

  // Employé sans e-mail.
  const emp = await call('/api/users', { token, method: 'POST', body: { name: 'Karim', pin_only: true, pin: '2580' } });
  assert.equal(emp.status, 201);
  assert.equal(emp.body.email, null);
  assert.equal(emp.body.role, 'employee');
  assert.equal(emp.body.has_pin, true);
  assert.equal((await call('/api/users', { token, method: 'POST', body: { name: 'X', pin_only: true, pin: '1234' } })).status, 400);
  assert.equal((await call(`/api/users/${emp.body.id}`, { token, method: 'PUT', body: { role: 'manager' } })).status, 400);

  // Seul un responsable peut déclarer une tablette.
  const empLogin = await call('/api/users', { token, method: 'POST', body: { name: 'Lise', email: 'lise@test.fr', password: 'motdepasse', role: 'employee' } });
  const lise = (await call('/api/auth/login', { method: 'POST', body: { email: 'lise@test.fr', password: 'motdepasse' } })).body.token;
  assert.equal((await call('/api/devices', { token: lise, method: 'POST', body: { name: 'T' } })).status, 403);
  assert.equal(empLogin.body.has_pin, false);

  const dev = await call('/api/devices', { token, method: 'POST', body: { name: 'Tablette passe' } });
  assert.equal(dev.status, 201);
  assert.ok(dev.body.token.length > 30);
  assert.ok(!db.prepare('SELECT 1 FROM devices WHERE token_hash = ?').get(dev.body.token), 'jeton stocké haché');

  assert.equal((await call('/api/kiosk')).body.code, 'device_invalid');
  const info = await call('/api/kiosk', { device: dev.body.token });
  assert.equal(info.body.organization, 'Org cuisine@test.fr');
  assert.deepEqual(info.body.users.map((u) => u.name), ['Karim'], 'seuls les comptes avec PIN sont proposés');
  assert.equal(info.body.users[0].email, undefined, 'aucune adresse exposée sur la tablette');

  const login = await call('/api/kiosk/login', { device: dev.body.token, method: 'POST', body: { user_id: emp.body.id, pin: '2580' } });
  assert.equal(login.status, 200);
  const me = (await call('/api/me', { token: login.body.token })).body;
  assert.equal(me.user.name, 'Karim');
  assert.equal(me.user.kiosk, true);

  // Les saisies sont attribuées à la bonne personne.
  const eq = (await call('/api/equipment', { token: login.body.token })).body[0];
  const t = await call('/api/temperatures', { token: login.body.token, method: 'POST', body: { equipment_id: eq.id, value: 3 } });
  assert.equal(t.status, 201);
  assert.equal(t.body.user_name, 'Karim');

  // L'administratrice définit aussi son PIN : sur la tablette, elle n'a que des droits d'employé.
  assert.equal((await call('/api/me/pin', { token, method: 'PUT', body: { password: 'faux', pin: '1397' } })).status, 400);
  assert.equal((await call('/api/me/pin', { token, method: 'PUT', body: { password: 'motdepasse', pin: '1397' } })).status, 200);
  const adminKiosk = (await call('/api/kiosk/login', { device: dev.body.token, method: 'POST', body: { user_id: userId, pin: '1397' } })).body.token;
  const adminMe = (await call('/api/me', { token: adminKiosk })).body.user;
  assert.equal(adminMe.role, 'employee');
  assert.equal((await call('/api/equipment', { token: adminKiosk, method: 'POST', body: { name: 'F', type: 'fridge' } })).status, 403);
  assert.equal((await call('/api/users', { token: adminKiosk })).status, 403);
  assert.equal((await call('/api/organization/export', { token: adminKiosk })).status, 403);
  assert.equal((await call('/api/me/password', { token: adminKiosk, method: 'PUT', body: { current: 'motdepasse', password: 'nouveaumdp' } })).status, 403);
  assert.equal((await call('/api/devices', { token: adminKiosk, method: 'POST', body: {} })).status, 403);

  // Changement de son PIN depuis la tablette avec l'ancien code.
  assert.equal((await call('/api/me/pin', { token: login.body.token, method: 'PUT', body: { current_pin: '0000', pin: '8642' } })).status, 400);
  assert.equal((await call('/api/me/pin', { token: login.body.token, method: 'PUT', body: { current_pin: '2580', pin: '8642' } })).status, 200);

  // Retirer la tablette coupe immédiatement les sessions ouvertes dessus.
  assert.equal((await call(`/api/devices/${dev.body.id}`, { token, method: 'DELETE' })).status, 204);
  const after = await call('/api/me', { token: login.body.token });
  assert.equal(after.status, 401);
  assert.equal(after.body.code, 'device_invalid');
  assert.equal((await call('/api/kiosk', { device: dev.body.token })).status, 401);
  assert.equal((await call('/api/me', { token })).status, 200, 'la session classique reste valable');
});

test('code PIN : blocage après 5 erreurs, déblocage par un administrateur', async () => {
  const { token } = await signup('blocage@test.fr');
  const emp = (await call('/api/users', { token, method: 'POST', body: { name: 'Paul', pin_only: true, pin: '2580' } })).body;
  const device = (await call('/api/devices', { token, method: 'POST', body: { name: 'T' } })).body.token;
  const tryPin = (pin) => call('/api/kiosk/login', { device, method: 'POST', body: { user_id: emp.id, pin } });

  const first = await tryPin('1111');
  assert.equal(first.status, 401);
  assert.match(first.body.error, /encore 4 essai/);
  for (let i = 0; i < 3; i++) await tryPin('1111');
  assert.match((await tryPin('1111')).body.error, /bloqué 15 minutes/);
  const locked = await tryPin('2580');
  assert.equal(locked.status, 423, 'même le bon code est refusé pendant le blocage');

  await call(`/api/users/${emp.id}`, { token, method: 'PUT', body: { pin: '3691' } });
  assert.equal((await tryPin('3691')).status, 200);
});

test('tablette : impossible de se connecter avec un compte d\'un autre établissement', async () => {
  const { token } = await signup('etab-a@test.fr');
  const { token: tokenB } = await signup('etab-b@test.fr');
  const empB = (await call('/api/users', { token: tokenB, method: 'POST', body: { name: 'Zoé', pin_only: true, pin: '2580' } })).body;
  const deviceA = (await call('/api/devices', { token, method: 'POST', body: { name: 'A' } })).body.token;
  assert.equal((await call('/api/kiosk/login', { device: deviceA, method: 'POST', body: { user_id: empB.id, pin: '2580' } })).status, 400);
  assert.equal((await call('/api/kiosk', { device: deviceA })).body.users.length, 0);
});

test('page d\'accueil publique, application sous /app', async () => {
  const home = await call('/');
  assert.equal(home.status, 200);
  assert.match(home.body, /<h1>Votre classeur HACCP sur tablette/);
  assert.match(home.body, /19 €<small> HT \/ mois/);
  assert.match(home.body, /39 €<small> HT \/ mois/);
  assert.match(home.body, /Boulangerie \/ pâtisserie/, 'métiers repris des modèles');
  assert.match(home.body, /"@type":"SoftwareApplication"/);
  assert.match(home.body, /href="\/app#\/signup"/);
  const appPage = await call('/app');
  assert.equal(appPage.status, 200);
  assert.match(appPage.body, /src="\/app\.js"/);
  assert.equal((await call('/landing.css')).status, 200);
  assert.equal((await call('/api/inconnu')).status, 401, 'les routes API restent protégées');
});

test('formulaire de démo : validation, anti-robot, enregistrement et e-mail', async () => {
  assert.equal((await call('/api/leads', { method: 'POST', body: { name: 'A', email: 'pas-un-email' } })).status, 400);
  const before = db.prepare('SELECT COUNT(*) AS n FROM leads').get().n;
  assert.equal((await call('/api/leads', { method: 'POST', body: { name: 'Robot', email: 'r@spam.test', website: 'http://spam' } })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM leads').get().n, before, 'robot ignoré');

  const ok = await call('/api/leads', {
    method: 'POST', body: { name: 'Sophie Martin', email: 'sophie@boulangerie.test', phone: '06 00 00 00 00', business: 'Boulangerie, 2 boutiques', message: 'Démo possible jeudi ?' },
  });
  assert.equal(ok.status, 201);
  const lead = db.prepare('SELECT * FROM leads ORDER BY id DESC').get();
  assert.equal(lead.email, 'sophie@boulangerie.test');
  const mail = mailer.outbox.at(-1);
  assert.deepEqual(mail.to, ['commercial@editeur.test']);
  assert.match(mail.subject, /Sophie Martin \(Boulangerie, 2 boutiques\)/);
  assert.match(mail.text, /Démo possible jeudi/);
});
