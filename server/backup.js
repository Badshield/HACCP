'use strict';

/**
 * Instantanés de la base SQLite pour les sauvegardes.
 *
 * Copier le fichier .db pendant que l'application écrit peut donner une copie
 * corrompue. L'API de sauvegarde de SQLite produit au contraire une copie
 * cohérente sans interrompre le service. Le service « backup » (restic) envoie
 * ensuite ce dossier et les photos vers un stockage externe chiffré.
 */

const fs = require('fs');
const path = require('path');

/** Crée (ou remplace) l'instantané dir/haccp.db de façon atomique. */
async function snapshot(db, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, 'haccp.db');
  const tmp = `${target}.tmp`;
  fs.rmSync(tmp, { force: true });
  await db.backup(tmp);
  fs.renameSync(tmp, target);
  const info = { created_at: new Date().toISOString(), bytes: fs.statSync(target).size };
  fs.writeFileSync(path.join(dir, 'snapshot.json'), `${JSON.stringify(info, null, 2)}\n`);
  return info;
}

/** Âge en minutes du dernier instantané (null s'il n'y en a pas). */
function snapshotAge(dir, now = Date.now()) {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(dir, 'snapshot.json'), 'utf8'));
    return Math.round((now - Date.parse(info.created_at)) / 60000);
  } catch {
    return null;
  }
}

function startSnapshots(db, dir, { intervalMin = 60 } = {}) {
  const run = () => snapshot(db, dir).catch((e) => console.error('Instantané de la base impossible :', e.message));
  const first = setTimeout(run, 5000);
  const timer = setInterval(run, intervalMin * 60000);
  first.unref();
  timer.unref();
  return { run, stop: () => { clearTimeout(first); clearInterval(timer); } };
}

module.exports = { snapshot, snapshotAge, startSnapshots };
