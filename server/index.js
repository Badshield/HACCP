'use strict';

const path = require('path');
const { checkConfig, report } = require('./config');

// Vérifie la configuration avant tout : en production, on refuse de démarrer
// avec un réglage critique manquant plutôt que de tourner dans un état dangereux.
const config = checkConfig();
report(config);
if (config.errors.length && process.env.NODE_ENV === 'production') {
  console.error('Démarrage annulé : corrigez la configuration (voir docs/DEPLOIEMENT.md).');
  process.exit(1);
}

const { openDb } = require('./db');
const { createApp } = require('./app');
const { startScheduler } = require('./reminders');
const { startSnapshots } = require('./backup');

const port = Number(process.env.PORT) || 3000;
const db = openDb();
const app = createApp(db);
const stopReminders = startScheduler(app.locals.reminders);

const snapshotDir = process.env.BACKUP_SNAPSHOT_DIR
  || (process.env.NODE_ENV === 'production' ? path.join(path.dirname(path.resolve(process.env.DB_FILE || 'data/haccp.db')), 'snapshots') : null);
const snapshots = snapshotDir
  ? startSnapshots(db, snapshotDir, { intervalMin: Number(process.env.BACKUP_INTERVAL_MIN) || 60 })
  : null;
app.locals.snapshotDir = snapshotDir;

const server = app.listen(port, () => {
  console.log(`HACCP prêt sur http://localhost:${port}${snapshotDir ? ` (instantanés : ${snapshotDir})` : ''}`);
});

// Arrêt propre (mise à jour, redémarrage du conteneur) : on termine les
// requêtes en cours, puis on fait un dernier instantané et on ferme la base.
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} reçu : arrêt en cours…`);
  const force = setTimeout(() => process.exit(1), 15000);
  force.unref();
  server.close(async () => {
    stopReminders();
    if (snapshots) {
      snapshots.stop();
      await snapshots.run();
    }
    db.close();
    console.log('Arrêt terminé.');
    process.exit(0);
  });
  server.closeIdleConnections?.();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
