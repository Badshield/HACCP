'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { checkConfig } = require('../server/config');
const { snapshot, snapshotAge } = require('../server/backup');
const { openDb } = require('../server/db');
const { createApp } = require('../server/app');
const { createMemoryMailer } = require('../server/mailer');

const FULL = {
  NODE_ENV: 'production',
  JWT_SECRET: 'x'.repeat(64),
  APP_URL: 'https://app.exemple.fr',
  TRUST_PROXY: '1',
  SMTP_HOST: 'smtp.exemple.fr',
  MAIL_FROM: 'a@exemple.fr',
  STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', STRIPE_PRICE_ESSENTIEL: 'price_a', STRIPE_PRICE_PRO: 'price_b',
  LEGAL_COMPANY: 'X', LEGAL_FORM: 'SASU', LEGAL_ADDRESS: 'Paris', LEGAL_SIREN: '1', LEGAL_EMAIL: 'c@x.fr',
  LEGAL_DIRECTOR: 'Y', LEGAL_COURT: 'Paris', HOST_NAME: 'Scaleway', HOST_ADDRESS: 'Paris',
  RESTIC_REPOSITORY: 's3:https://s3.fr-par.scw.cloud/b/haccp', RESTIC_PASSWORD: 'p',
};

test('configuration de production complète : aucune erreur ni alerte', () => {
  assert.deepEqual(checkConfig(FULL), { errors: [], warnings: [] });
});

test('configuration : erreurs bloquantes en production', () => {
  const r = checkConfig({ ...FULL, JWT_SECRET: 'court', APP_URL: 'http://app.exemple.fr', STRIPE_PRICE_PRO: '' });
  assert.equal(r.errors.length, 3);
  assert.ok(r.errors.some((e) => /JWT_SECRET trop court/.test(e)));
  assert.ok(r.errors.some((e) => /https/.test(e)));
  assert.ok(r.errors.some((e) => /STRIPE_PRICE_PRO/.test(e)));
  assert.ok(checkConfig({ ...FULL, JWT_SECRET: '' }).errors.length);
});

test('configuration : avertissements utiles', () => {
  const r = checkConfig({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), APP_URL: 'https://a.fr', STRIPE_SECRET_KEY: '' });
  assert.equal(r.errors.length, 0);
  const all = r.warnings.join('\n');
  assert.match(all, /ACCÈS GRATUIT ET ILLIMITÉ/);
  assert.match(all, /SMTP non configuré/);
  assert.match(all, /TRUST_PROXY/);
  assert.match(all, /Mentions légales incomplètes/);
  assert.match(all, /Sauvegardes externes non configurées/);
  assert.match(checkConfig({ ...FULL, STRIPE_SECRET_KEY: 'sk_test_x' }).warnings.join(), /TEST en production/);
  assert.equal(checkConfig({}).errors.length, 0, 'en développement, rien n\'est bloquant');
});

test('instantané de la base : copie cohérente et lisible', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'haccp-snap-'));
  const dbFile = path.join(dir, 'source.db');
  const db = openDb(dbFile);
  db.prepare("INSERT INTO organizations (name) VALUES ('Snapshot test')").run();
  assert.equal(snapshotAge(path.join(dir, 'snap')), null);
  const info = await snapshot(db, path.join(dir, 'snap'));
  assert.ok(info.bytes > 0);
  db.prepare("INSERT INTO organizations (name) VALUES ('Après instantané')").run();
  const copy = new Database(path.join(dir, 'snap', 'haccp.db'), { readonly: true });
  assert.deepEqual(copy.prepare('SELECT name FROM organizations').all().map((r) => r.name), ['Snapshot test']);
  assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok');
  copy.close();
  assert.equal(snapshotAge(path.join(dir, 'snap')), 0);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('santé et en-têtes de sécurité', async () => {
  const app = createApp(openDb(':memory:'), { billing: { stripe: null }, mailer: createMemoryMailer() });
  const server = await new Promise((resolve) => { const srv = app.listen(0, () => resolve(srv)); });
  test.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/api/health`);
  assert.deepEqual(await health.json(), { ok: true });
  const home = await fetch(`${base}/`);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
});
