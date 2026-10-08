'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { openDb } = require('../server/db');
const { createApp } = require('../server/app');
const { createMemoryMailer } = require('../server/mailer');
const { upsertOperator } = require('../server/operator-cli');
const { makeCustomer } = require('./helpers');

const mailer = createMemoryMailer();
let server;
let base;
let db;
let op; // jeton de l'opérateur principal

async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : type.includes('pdf') ? Buffer.from(await res.arrayBuffer()) : await res.text() };
}
const portal = (path, o = {}) => call(`/api/portal${path}`, { token: op, ...o });

async function createClient(overrides = {}) {
  const r = await portal('/orgs', {
    method: 'POST',
    body: { name: 'Boulangerie Dupain', group_name: 'Famille Dupain', template: 'boulangerie', mode: 'trial', trial_days: 30, admin: { name: 'Paul Dupain', email: 'paul@dupain.test' }, ...overrides },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
/** Ouvre la session du client à partir du lien d'invitation (comme le ferait son administrateur). */
async function acceptInvitation(url, password = 'motdepasse-client') {
  const token = new URL(url.replace('#', '')).searchParams.get('token');
  const r = await call('/api/auth/reset', { method: 'POST', body: { token, password } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}

test.before(async () => {
  db = openDb(':memory:');
  upsertOperator(db, { email: 'sav@presta.test', name: 'Équipe SAV', password: 'motdepasse-presta' });
  const app = createApp(db, { billing: { stripe: null }, mailer, baseUrl: 'https://app.test' });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await call('/api/portal/login', { method: 'POST', body: { email: 'sav@presta.test', password: 'motdepasse-presta' } });
  assert.equal(login.status, 200);
  op = login.body.token;
});
test.after(() => server.close());

test('étanchéité : ni un client dans le portail, ni un opérateur chez un client', async () => {
  assert.equal((await call('/api/portal/orgs')).status, 401, 'portail fermé sans jeton');
  const client = makeCustomer(db, { email: 'resto@test.fr', template: 'restaurant' });
  assert.equal((await call('/api/portal/orgs', { token: client.token })).status, 401, 'un jeton client n\'ouvre pas le portail');
  assert.equal((await call('/api/portal/orgs/1/users', { token: client.token })).status, 401);
  for (const path of ['/api/me', '/api/dashboard', '/api/temperatures', '/api/users']) {
    assert.equal((await call(path, { token: op })).status, 401, `${path} : un jeton opérateur n'ouvre aucun espace client`);
  }
  assert.equal((await call('/api/portal/login', { method: 'POST', body: { email: 'sav@presta.test', password: 'faux' } })).status, 401);
  assert.equal((await call('/api/portal/login', { method: 'POST', body: { email: 'resto@test.fr', password: 'motdepasse' } })).status, 401, 'un compte client ne se connecte pas au portail');
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'sav@presta.test', password: 'motdepasse-presta' } })).status, 401, 'un opérateur n\'a pas de compte client');
});

test('création d\'un client : établissement, modèle de métier, administrateur invité par e-mail', async () => {
  const before = mailer.outbox.length;
  const r = await createClient();
  assert.equal(r.invitation.emailed, true);
  assert.match(r.invitation.url, /^https:\/\/app\.test\/app#\/reset\?token=/);
  const mail = mailer.outbox.at(-1);
  assert.equal(mailer.outbox.length, before + 1);
  assert.deepEqual(mail.to, ['paul@dupain.test']);
  assert.match(mail.subject, /Boulangerie Dupain/);
  assert.ok(mail.text.includes(r.invitation.url));

  // Avant l'invitation, personne ne peut se connecter avec ce compte.
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'paul@dupain.test', password: 'motdepasse-client' } })).status, 401);
  const token = await acceptInvitation(r.invitation.url);
  const me = (await call('/api/me', { token })).body;
  assert.equal(me.organization.name, 'Boulangerie Dupain');
  assert.equal(me.organization.group_name, 'Famille Dupain');
  assert.equal(me.user.role, 'admin');
  assert.equal(me.access.state, 'trial');
  assert.equal(me.access.managed, true);
  assert.equal(me.terms.outdated, true, 'CGV à accepter à la première connexion');
  assert.ok((await call('/api/equipment', { token })).body.length > 0, 'modèle appliqué');
  // Le lien ne sert qu'une fois.
  assert.equal((await call('/api/auth/reset', { method: 'POST', body: { token: new URL(r.invitation.url.replace('#', '')).searchParams.get('token'), password: 'autre-mot-de-passe' } })).status, 400);
});

test('création refusée : e-mail déjà pris, modèle inconnu, adresse invalide', async () => {
  const dup = await portal('/orgs', { method: 'POST', body: { name: 'Autre', admin: { name: 'X', email: 'PAUL@dupain.test' } } });
  assert.equal(dup.status, 409);
  assert.equal((await portal('/orgs', { method: 'POST', body: { name: 'Autre', template: 'inconnu', admin: { name: 'X', email: 'x@test.fr' } } })).status, 400);
  assert.equal((await portal('/orgs', { method: 'POST', body: { name: 'Autre', admin: { name: 'X', email: 'pas-un-email' } } })).status, 400);
  assert.equal((await portal('/orgs', { method: 'POST', body: { name: '', admin: { name: 'X', email: 'y@test.fr' } } })).status, 400);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM organizations WHERE name = 'Autre'").get().n, 0, 'rien n\'est créé à moitié');
});

test('sans SMTP : le lien d\'invitation est quand même fourni à l\'opérateur', async () => {
  const silent = createApp(db, { billing: { stripe: null }, mailer: { configured: false, async send() { throw new Error('ne doit pas être appelé'); } }, baseUrl: 'https://app.test' });
  const s2 = await new Promise((resolve) => { const s = silent.listen(0, () => resolve(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${s2.address().port}/api/portal/orgs`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${op}` },
      body: JSON.stringify({ name: 'Sans mail', admin: { name: 'Jo', email: 'jo@sansmail.test' } }),
    });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.invitation.emailed, false);
    assert.equal(body.invitation.mailConfigured, false);
    assert.match(body.invitation.url, /reset\?token=/);
  } finally { s2.close(); }
});

test('liste des clients : groupe, utilisateurs, accès, dernière activité', async () => {
  const list = (await portal('/orgs')).body;
  const dupain = list.orgs.find((o) => o.name === 'Boulangerie Dupain');
  assert.equal(dupain.group_name, 'Famille Dupain');
  assert.equal(dupain.users, 1);
  assert.equal(dupain.admin_email, 'paul@dupain.test');
  assert.equal(dupain.access.state, 'trial');
  assert.ok(list.groups.includes('Famille Dupain'));
  assert.equal(dupain.last_activity, null, 'aucune saisie pour l\'instant');
  assert.ok(dupain.last_login, 'la connexion par invitation est tracée');
  assert.equal(JSON.stringify(list).includes('password'), false, 'aucun secret dans les réponses');
});

test('ce que fait le client est visible : activité, registres, classeur PDF', async () => {
  const c = await createClient({ name: 'Resto Visible', group_name: null, template: 'restaurant', admin: { name: 'Léa', email: 'lea@visible.test' } });
  const token = await acceptInvitation(c.invitation.url);
  const equipment = (await call('/api/equipment', { token })).body[0];
  const saisie = await call('/api/temperatures', { token, method: 'POST', body: { equipment_id: equipment.id, value: 25 } });
  assert.equal(saisie.status, 201);
  assert.equal(saisie.body.compliant, 0);

  const orgId = c.org.id;
  const feed = (await portal(`/orgs/${orgId}/activity`)).body;
  assert.ok(feed.some((e) => e.action === 'create' && e.entity === 'temperature_logs' && e.user_name === 'Léa'));
  assert.ok(feed.some((e) => e.action === 'login'));
  assert.ok((await portal('/activity')).body.some((e) => e.org_name === 'Resto Visible'), 'fil global');
  assert.ok((await portal(`/activity?org=${orgId}`)).body.every((e) => e.org_id === orgId), 'filtre par client');

  const registers = (await portal(`/orgs/${orgId}/registers`)).body;
  assert.ok(registers.some((r) => r.key === 'temperatures'));
  const temps = (await portal(`/orgs/${orgId}/registers/temperatures`)).body;
  assert.equal(temps.total, 1);
  assert.equal(temps.rows[0].nc, true, 'relevé non conforme signalé');
  assert.ok(temps.columns.includes('Équipement'));
  assert.ok(temps.rows[0].cells.includes('25'));
  assert.equal((await portal(`/orgs/${orgId}/registers/inconnu`)).status, 404);

  const detail = (await portal(`/orgs/${orgId}`)).body;
  assert.equal(detail.open_nc, 1);
  assert.ok(detail.last_activity);
  assert.equal(detail.stats.compliance.temperatures.total, 1);

  const pdf = await call(`/api/portal/orgs/${orgId}/reports/haccp.pdf`, { token: op });
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /pdf/);
  assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
  assert.equal((await call(`/api/portal/orgs/${orgId}/reports/haccp.pdf`, { token })).status, 401, 'le client n\'utilise pas cette route');
  assert.equal((await call('/api/portal/orgs/99999/reports/haccp.pdf', { token: op })).status, 404);
});

test('lecture seule : le portail ne permet pas d\'écrire dans les registres d\'un client', async () => {
  const c = db.prepare("SELECT id FROM organizations WHERE name = 'Resto Visible'").get().id;
  const before = db.prepare('SELECT COUNT(*) AS n FROM temperature_logs WHERE org_id = ?').get(c).n;
  for (const path of [`/orgs/${c}/temperatures`, `/orgs/${c}/registers/temperatures`, `/orgs/${c}/non-conformities`]) {
    const r = await portal(path, { method: 'POST', body: { value: 3 } });
    assert.ok(r.status >= 400, `${path} refusé`);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM temperature_logs WHERE org_id = ?').get(c).n, before);
});

test('pilotage de l\'accès : suspension (lecture seule), essai prolongé, actif', async () => {
  const c = await createClient({ name: 'Client Accès', group_name: null, admin: { name: 'Ana', email: 'ana@acces.test' } });
  const token = await acceptInvitation(c.invitation.url);
  const id = c.org.id;
  const write = () => call('/api/cleaning-tasks', { token, method: 'POST', body: { zone: 'Cuisine', name: 'Sols', frequency: 'daily' } });
  assert.equal((await write()).status, 201);

  assert.equal((await portal(`/orgs/${id}/access`, { method: 'POST', body: { action: 'suspend' } })).body.access.state, 'suspended');
  const refused = await write();
  assert.equal(refused.status, 402);
  assert.equal(refused.body.code, 'suspended');
  assert.match(refused.body.error, /prestataire/);
  assert.equal((await call('/api/cleaning-tasks', { token })).status, 200, 'les registres restent consultables');
  assert.equal((await call('/api/me', { token })).body.access.state, 'suspended');

  assert.equal((await portal(`/orgs/${id}/access`, { method: 'POST', body: { action: 'resume' } })).body.access.state, 'trial');
  assert.equal((await write()).status, 201);

  // Essai terminé : lecture seule, avec un message qui renvoie vers le prestataire (pas vers un paiement).
  db.prepare("UPDATE organizations SET trial_ends_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(id);
  const expired = await write();
  assert.equal(expired.status, 402);
  assert.match(expired.body.error, /prestataire/);
  const extended = await portal(`/orgs/${id}/access`, { method: 'POST', body: { action: 'extend_trial', days: 14 } });
  assert.equal(extended.body.access.state, 'trial');
  assert.ok(extended.body.access.trialDaysLeft >= 13 && extended.body.access.trialDaysLeft <= 14);
  assert.equal((await write()).status, 201);

  assert.equal((await portal(`/orgs/${id}/access`, { method: 'POST', body: { action: 'activate' } })).body.access.state, 'active');
  db.prepare("UPDATE organizations SET trial_ends_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(id);
  assert.equal((await write()).status, 201, 'un client actif n\'est pas limité par la date d\'essai');
  assert.equal((await portal(`/orgs/${id}/access`, { method: 'POST', body: { action: 'extend_trial', days: 0 } })).status, 400);
  assert.equal((await portal(`/orgs/${id}/access`, { method: 'POST', body: { action: 'inconnue' } })).status, 400);
  assert.equal((await portal(`/orgs/${id}/access`, { method: 'POST', body: { action: 'billing' } })).status, 400, 'paiement en ligne indisponible sans Stripe');
});

test('utilisateurs d\'un client : rattacher une adresse, inviter, modifier, désactiver', async () => {
  const c = await createClient({ name: 'Client Équipe', group_name: null, template: null, admin: { name: 'Chef', email: 'chef@equipe.test' } });
  const id = c.org.id;
  const created = await portal(`/orgs/${id}/users`, { method: 'POST', body: { name: 'Sam', email: 'sam@equipe.test', role: 'manager' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.invitation.emailed, true);
  assert.deepEqual(mailer.outbox.at(-1).to, ['sam@equipe.test']);
  const samToken = await acceptInvitation(created.body.invitation.url, 'motdepasse-sam');
  assert.equal((await call('/api/me', { token: samToken })).body.user.role, 'manager');

  assert.equal((await portal(`/orgs/${id}/users`, { method: 'POST', body: { name: 'Doublon', email: 'SAM@equipe.test', role: 'employee' } })).status, 409);
  assert.equal((await portal(`/orgs/${id}/users`, { method: 'POST', body: { name: 'Mauvais', email: 'm@equipe.test', role: 'roi' } })).status, 400);

  const users = (await portal(`/orgs/${id}/users`)).body;
  assert.equal(users.length, 2);
  const sam = users.find((u) => u.email === 'sam@equipe.test');
  assert.ok(sam.last_login, 'dernière connexion visible');

  // Changement d'adresse e-mail et de rôle.
  assert.equal((await portal(`/orgs/${id}/users/${sam.id}`, { method: 'PUT', body: { email: 'samuel@equipe.test', role: 'employee' } })).status, 200);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'samuel@equipe.test', password: 'motdepasse-sam' } })).status, 200);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'sam@equipe.test', password: 'motdepasse-sam' } })).status, 401);
  assert.equal((await portal(`/orgs/${id}/users/${sam.id}`, { method: 'PUT', body: { email: 'chef@equipe.test' } })).status, 409);

  // Nouveau lien de connexion.
  const again = await portal(`/orgs/${id}/users/${sam.id}/invite`, { method: 'POST', body: {} });
  assert.equal(again.status, 200);
  assert.match(mailer.outbox.at(-1).subject, /lien de connexion/i);
  assert.ok(again.body.url.includes('reset?token='));

  // Désactivation : la personne ne peut plus se connecter.
  assert.equal((await portal(`/orgs/${id}/users/${sam.id}`, { method: 'PUT', body: { active: false } })).status, 200);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'samuel@equipe.test', password: 'motdepasse-sam' } })).status, 401);
  assert.equal((await call('/api/me', { token: samToken })).status, 401, 'sa session ouverte est coupée aussi');

  // Le client garde toujours un administrateur actif.
  const chef = users.find((u) => u.email === 'chef@equipe.test');
  assert.equal((await portal(`/orgs/${id}/users/${chef.id}`, { method: 'PUT', body: { active: false } })).status, 400);
  assert.equal((await portal(`/orgs/${id}/users/${chef.id}`, { method: 'PUT', body: { role: 'employee' } })).status, 400);

  // Un utilisateur d'un autre client est introuvable via ce client.
  const other = db.prepare("SELECT id FROM users WHERE email = 'lea@visible.test'").get().id;
  assert.equal((await portal(`/orgs/${id}/users/${other}`, { method: 'PUT', body: { name: 'Pirate' } })).status, 404);
});

test('employé « code PIN seul » : son adresse technique n\'est jamais affichée', async () => {
  const c = await createClient({ name: 'Client PIN', group_name: null, admin: { name: 'Boss', email: 'boss@pin.test' } });
  const token = await acceptInvitation(c.invitation.url);
  assert.equal((await call('/api/users', { token, method: 'POST', body: { name: 'Karim', pin_only: true, pin: '2580' } })).status, 201);
  const users = (await portal(`/orgs/${c.org.id}/users`)).body;
  const karim = users.find((u) => u.name === 'Karim');
  assert.equal(karim.email, null);
  assert.equal(karim.pin_only, true);
  assert.equal((await portal(`/orgs/${c.org.id}/users/${karim.id}/invite`, { method: 'POST', body: {} })).status, 404, 'pas de lien pour un compte sans e-mail');
});

test('notes du SAV et journal du portail', async () => {
  const id = db.prepare("SELECT id FROM organizations WHERE name = 'Client Équipe'").get().id;
  assert.equal((await portal(`/orgs/${id}/notes`, { method: 'POST', body: { text: '   ' } })).status, 400);
  const note = await portal(`/orgs/${id}/notes`, { method: 'POST', body: { text: 'Appelé le 8/10 : tablette à reconfigurer.' } });
  assert.equal(note.status, 201);
  assert.equal(note.body.operator_name, 'Équipe SAV');
  assert.equal((await portal(`/orgs/${id}/notes`)).body[0].text, 'Appelé le 8/10 : tablette à reconfigurer.');
  const log = (await portal(`/orgs/${id}/log`)).body;
  assert.ok(log.some((l) => l.action === 'org_create'));
  assert.ok(log.some((l) => l.action === 'user_create'));
  assert.ok(log.every((l) => l.operator_name === 'Équipe SAV'));
  // Les notes ne sont visibles d'aucun client.
  const client = (await call('/api/auth/login', { method: 'POST', body: { email: 'chef@equipe.test', password: 'x' } }));
  assert.equal(client.status, 401);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM org_notes WHERE org_id = ?").get(id).n, 1);
});

test('modification d\'un client et du groupe', async () => {
  const id = db.prepare("SELECT id FROM organizations WHERE name = 'Client Équipe'").get().id;
  assert.equal((await portal(`/orgs/${id}`, { method: 'PUT', body: { name: 'Client Équipe 2', group_name: 'Groupe Z', siret: '123', timezone: 'Indian/Reunion' } })).status, 200);
  const d = (await portal(`/orgs/${id}`)).body;
  assert.equal(d.name, 'Client Équipe 2');
  assert.equal(d.group_name, 'Groupe Z');
  assert.equal(d.timezone, 'Indian/Reunion');
  assert.equal((await portal(`/orgs/${id}`, { method: 'PUT', body: { name: 'X', timezone: 'Mars/Olympus' } })).status, 400);
  assert.equal((await portal('/orgs/99999')).status, 404);
});

test('suppression d\'un client : confirmation par le nom et le mot de passe de l\'opérateur', async () => {
  const c = await createClient({ name: 'À supprimer', group_name: null, admin: { name: 'Zed', email: 'zed@suppr.test' } });
  const token = await acceptInvitation(c.invitation.url);
  const id = c.org.id;
  assert.equal((await portal(`/orgs/${id}/delete`, { method: 'POST', body: { confirm: 'Autre nom', password: 'motdepasse-presta' } })).status, 400);
  assert.equal((await portal(`/orgs/${id}/delete`, { method: 'POST', body: { confirm: 'À supprimer', password: 'faux' } })).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM organizations WHERE id = ?').get(id).n, 1);
  assert.equal((await portal(`/orgs/${id}/delete`, { method: 'POST', body: { confirm: 'À supprimer', password: 'motdepasse-presta' } })).status, 204);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM organizations WHERE id = ?').get(id).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE org_id = ?').get(id).n, 0);
  assert.equal((await call('/api/me', { token })).status, 401);
  assert.ok(db.prepare("SELECT 1 FROM operator_log WHERE action = 'org_delete' AND detail = 'À supprimer'").get(), 'la suppression reste tracée');
});

test('équipe du prestataire : nouvel opérateur, mot de passe, désactivation', async () => {
  assert.equal((await portal('/operators', { method: 'POST', body: { name: 'Court', email: 'court@presta.test', password: 'court' } })).status, 400);
  const created = await portal('/operators', { method: 'POST', body: { name: 'Sophie SAV', email: 'sophie@presta.test', password: 'motdepasse-sophie' } });
  assert.equal(created.status, 201);
  assert.equal(JSON.stringify(created.body).includes('hash'), false);
  assert.equal((await portal('/operators', { method: 'POST', body: { name: 'Bis', email: 'SOPHIE@presta.test', password: 'motdepasse-bis!' } })).status, 409);
  const login = await call('/api/portal/login', { method: 'POST', body: { email: 'sophie@presta.test', password: 'motdepasse-sophie' } });
  assert.equal(login.status, 200);
  const sophie = login.body.token;
  assert.equal((await call('/api/portal/orgs', { token: sophie })).status, 200);

  // Changement de mot de passe : les anciennes sessions sont coupées, la session courante reçoit un nouveau jeton.
  assert.equal((await call('/api/portal/password', { token: sophie, method: 'PUT', body: { current: 'faux', password: 'nouveau-motdepasse' } })).status, 400);
  await new Promise((r) => setTimeout(r, 1100));
  const changed = await call('/api/portal/password', { token: sophie, method: 'PUT', body: { current: 'motdepasse-sophie', password: 'nouveau-motdepasse' } });
  assert.equal(changed.status, 200);
  assert.equal((await call('/api/portal/orgs', { token: sophie })).status, 401);
  assert.equal((await call('/api/portal/orgs', { token: changed.body.token })).status, 200);

  // Désactivation : la session est coupée ; on ne peut pas désactiver son propre compte.
  assert.equal((await portal(`/operators/${created.body.id}`, { method: 'PUT', body: { active: false } })).status, 200);
  assert.equal((await call('/api/portal/orgs', { token: changed.body.token })).status, 401);
  const me = (await call('/api/portal/me', { token: op })).body.operator;
  assert.equal((await portal(`/operators/${me.id}`, { method: 'PUT', body: { active: false } })).status, 400);
  assert.equal((await portal('/operators')).body.length, 2);
});

test('outil en ligne de commande : création puis réinitialisation d\'un opérateur', () => {
  const mem = openDb(':memory:');
  const first = upsertOperator(mem, { email: 'moi@presta.test', name: 'Moi' });
  assert.equal(first.created, true);
  assert.ok(first.password.length >= 16, 'mot de passe aléatoire généré');
  assert.ok(bcrypt.compareSync(first.password, mem.prepare('SELECT password_hash FROM operators').get().password_hash));
  const second = upsertOperator(mem, { email: 'MOI@presta.test', password: 'un-autre-mot-de-passe' });
  assert.equal(second.created, false);
  assert.equal(mem.prepare('SELECT COUNT(*) AS n FROM operators').get().n, 1);
  assert.ok(bcrypt.compareSync('un-autre-mot-de-passe', mem.prepare('SELECT password_hash FROM operators').get().password_hash));
  assert.throws(() => upsertOperator(mem, { email: 'x@presta.test', password: 'court' }), /10 caractères/);
  assert.throws(() => upsertOperator(mem, { email: 'pas-un-email' }), /e-mail/);
});

test('la page du portail est servie, non indexable ; l\'accueil mène à l\'application', async () => {
  const page = await call('/portal');
  assert.equal(page.status, 200);
  assert.match(page.body, /portal\.js/);
  assert.match(page.headers.get('x-robots-tag'), /noindex/);
  const root = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(root.headers.get('location'), '/app');
});
