'use strict';

/**
 * Rappels et alertes par e-mail.
 *
 *  - Relevés de températures : à chaque horaire prévu (ex. 09:00 et 17:00),
 *    si un équipement n'a pas été relevé après le délai de grâce, un e-mail
 *    liste les équipements oubliés.
 *  - Récapitulatif du soir : températures non relevées dans la journée,
 *    nettoyages en retard, non-conformités ouvertes, DLC secondaires du jour,
 *    formations à renouveler. Envoyé seulement s'il y a quelque chose à signaler.
 *  - Alerte immédiate à chaque nouvelle non-conformité.
 *
 * Destinataires : administrateurs et responsables actifs ayant laissé les
 * alertes activées. Les heures s'entendent dans le fuseau de l'établissement.
 */

const rules = require('./rules');
const { compose, appUrl } = require('./mailer');

const WINDOW_MIN = 120; // un rappel manqué (serveur arrêté) n'est plus envoyé après 2 h
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseTimes(str) {
  return String(str || '')
    .split(/[,;\s]+/)
    .filter(Boolean)
    .map((t) => {
      const m = TIME_RE.exec(t.length === 4 ? `0${t}` : t);
      return m ? { label: `${m[1]}:${m[2]}`, minutes: Number(m[1]) * 60 + Number(m[2]) } : null;
    })
    .filter(Boolean);
}

/** Valide et normalise une liste d'horaires saisie par l'utilisateur ("9:00, 17:30"). */
function normalizeTimes(str, { max = 6 } = {}) {
  const raw = String(str || '').split(/[,;\s]+/).filter(Boolean);
  const parsed = parseTimes(str);
  if (parsed.length !== raw.length) return null;
  const uniq = [...new Set(parsed.map((t) => t.label))].sort();
  return uniq.length <= max ? uniq.join(',') : null;
}

/** Date et minute courantes dans le fuseau de l'établissement. */
function localClock(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function composeFor(org, msg) {
  return compose({
    ...msg,
    footer: `Vous recevez ce message en tant que responsable de « ${org.name} ». Pour ne plus le recevoir : Paramètres → Rappels et alertes.`,
  });
}

const fmtDay = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
function fmtDateTime(iso, timeZone) {
  return new Date(iso).toLocaleString('fr-FR', { timeZone, dateStyle: 'short', timeStyle: 'short' });
}

function recipients(db, orgId) {
  return db.prepare(`SELECT email FROM users WHERE org_id = ? AND active = 1 AND notify = 1
    AND role IN ('admin','manager') ORDER BY id`).all(orgId).map((u) => u.email);
}

function createReminders({ db, mailer, access, baseUrl }) {
  const claim = db.prepare('INSERT OR IGNORE INTO reminder_log (org_id, key) VALUES (?, ?)');
  const release = db.prepare('DELETE FROM reminder_log WHERE org_id = ? AND key = ?');

  /** Envoie un e-mail une seule fois par clé (org, key). */
  async function sendOnce(org, key, message) {
    if (!claim.run(org.id, key).changes) return false;
    try {
      await mailer.send({ to: recipients(db, org.id), ...message });
      return true;
    } catch (e) {
      release.run(org.id, key); // nouvel essai au prochain passage
      console.error(`Rappel ${key} (établissement ${org.id}) non envoyé :`, e.message);
      return false;
    }
  }

  const link = (label, path) => (baseUrl ? [{ button: label, url: `${baseUrl}/app#/${path}` }] : []);

  function missingTemperatures(orgId, sinceIso) {
    return db.prepare(`SELECT e.name FROM equipment e WHERE e.org_id = ? AND e.active = 1 AND NOT EXISTS (
      SELECT 1 FROM temperature_logs t WHERE t.equipment_id = e.id AND t.recorded_at >= ?) ORDER BY e.name`)
      .all(orgId, sinceIso).map((r) => r.name);
  }

  function temperatureReminder(org, clock, now) {
    const grace = Math.max(0, org.notif_grace_min ?? 30);
    const out = [];
    for (const slot of parseTimes(org.notif_temp_times)) {
      const late = clock.minutes - slot.minutes - grace;
      if (late < 0 || late >= WINDOW_MIN) continue;
      // Un relevé fait jusqu'à 2 h avant l'horaire prévu compte pour ce créneau.
      const slotInstant = new Date(now.getTime() - (clock.minutes - slot.minutes) * 60000);
      const missing = missingTemperatures(org.id, new Date(slotInstant.getTime() - 120 * 60000).toISOString());
      if (!missing.length) continue;
      out.push({
        key: `temp:${clock.day}:${slot.label}`,
        message: composeFor(org, {
          subject: `Relevé de températures de ${slot.label} non effectué – ${org.name}`,
          blocks: [
            `Le relevé de ${slot.label} n'a pas été saisi pour ${missing.length > 1 ? 'les équipements suivants' : 'l\'équipement suivant'} :`,
            { list: missing },
            'Pensez à relever les températures dès que possible : en cas de contrôle, les relevés manquants sont considérés comme une non-conformité.',
            ...link('Saisir les températures', 'temperatures'),
          ],
        }),
      });
    }
    return out;
  }

  function dailyDigest(org, clock, now) {
    const slot = parseTimes(org.notif_digest_time)[0];
    if (!slot) return [];
    const late = clock.minutes - slot.minutes;
    if (late < 0 || late >= WINDOW_MIN) return [];
    const dayStart = new Date(now.getTime() - clock.minutes * 60000).toISOString();
    const tz = org.timezone;
    const blocks = [];

    const noTemp = missingTemperatures(org.id, dayStart);
    if (noTemp.length) blocks.push({ title: `Aucun relevé aujourd'hui (${noTemp.length})` }, { list: noTemp });

    const tasks = db.prepare(`SELECT c.*, (SELECT MAX(done_at) FROM cleaning_logs WHERE task_id = c.id) AS last_done
      FROM cleaning_tasks c WHERE c.org_id = ? AND c.active = 1 ORDER BY c.zone, c.name`).all(org.id);
    const dueTasks = tasks.filter((t) => (t.frequency === 'daily'
      ? !t.last_done || t.last_done < dayStart
      : rules.cleaningDue(t.frequency, t.last_done, now)));
    if (dueTasks.length) {
      blocks.push({ title: `Nettoyages non validés (${dueTasks.length})` }, { list: dueTasks.map((t) => `${t.zone} – ${t.name}`) });
    }

    const ncs = db.prepare("SELECT * FROM non_conformities WHERE org_id = ? AND status = 'open' ORDER BY created_at")
      .all(org.id);
    if (ncs.length) {
      const shown = ncs.slice(0, 10).map((n) => `${fmtDateTime(n.created_at, tz)} : ${n.description}`);
      if (ncs.length > 10) shown.push(`… et ${ncs.length - 10} autre(s)`);
      blocks.push({ title: `Non-conformités à clôturer (${ncs.length})` }, { list: shown });
    }

    const labels = db.prepare('SELECT * FROM labels WHERE org_id = ? AND dlc BETWEEN ? AND ? ORDER BY dlc, product')
      .all(org.id, clock.day, addDays(clock.day, 1));
    if (labels.length) {
      blocks.push({ title: `DLC secondaires aujourd'hui ou demain (${labels.length})` }, {
        list: labels.map((l) => `${l.product}${l.lot_number ? ` (lot ${l.lot_number})` : ''} : ${fmtDay(l.dlc)}`),
      });
    }

    // Formations : prévenir à J-30, J-7 et le jour même seulement (pas tous les soirs).
    const milestones = [30, 7, 0].map((n) => addDays(clock.day, n));
    const trainings = db.prepare(`SELECT * FROM trainings WHERE org_id = ? AND expires_on IN (${milestones.map(() => '?').join(',')})`)
      .all(org.id, ...milestones);
    if (trainings.length) {
      blocks.push({ title: 'Formations à renouveler' }, { list: trainings.map((t) => `${t.person} – ${t.title} : ${fmtDay(t.expires_on)}`) });
    }

    if (!blocks.length) return [];
    return [{
      key: `digest:${clock.day}`,
      message: composeFor(org, {
        subject: `Récapitulatif hygiène du ${fmtDay(clock.day)} – ${org.name}`,
        blocks: ['Voici les points à traiter avant la fin de la journée :', ...blocks, ...link('Ouvrir le tableau de bord', 'dashboard')],
      }),
    }];
  }

  /** Un passage du planificateur : envoie les rappels dus. Renvoie les clés envoyées. */
  async function run(now = new Date()) {
    const sent = [];
    const orgs = db.prepare('SELECT * FROM organizations WHERE notif_enabled = 1').all();
    for (const org of orgs) {
      if (access(org).readOnly || !recipients(db, org.id).length) continue;
      let clock;
      try { clock = localClock(now, org.timezone || 'Europe/Paris'); } catch { clock = localClock(now, 'Europe/Paris'); }
      for (const r of [...temperatureReminder(org, clock, now), ...dailyDigest(org, clock, now)]) {
        if (await sendOnce(org, r.key, r.message)) sent.push(`${org.id}:${r.key}`);
      }
    }
    db.prepare("DELETE FROM reminder_log WHERE sent_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')").run();
    return sent;
  }

  /** Alerte immédiate lors d'une nouvelle non-conformité (sans bloquer la saisie). */
  function nonConformity({ orgId, description, author }) {
    const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(orgId);
    if (!org || !org.notif_enabled || !org.notif_nc_alert) return Promise.resolve(false);
    const to = recipients(db, orgId);
    if (!to.length) return Promise.resolve(false);
    return mailer.send({
      to,
      ...composeFor(org, {
        subject: `Non-conformité – ${org.name}`,
        blocks: [
          `${author ? `${author} a enregistré` : 'Nouvelle'} non-conformité le ${fmtDateTime(new Date().toISOString(), org.timezone)} :`,
          { list: [description] },
          'Mettez en œuvre une action corrective (isoler ou jeter le produit, régler l\'équipement...) puis clôturez la non-conformité en la décrivant.',
          ...link('Traiter la non-conformité', 'nonconformities'),
        ],
      }),
    }).then(() => true, (e) => { console.error('Alerte non-conformité non envoyée :', e.message); return false; });
  }

  return { run, nonConformity };
}

function startScheduler(reminders, { intervalMs = 5 * 60000 } = {}) {
  const tick = () => reminders.run().catch((e) => console.error('Planificateur de rappels :', e));
  const first = setTimeout(tick, 10000);
  const timer = setInterval(tick, intervalMs);
  first.unref();
  timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}

function defaultBaseUrl() {
  try { return appUrl(); } catch { return null; }
}

module.exports = { createReminders, startScheduler, parseTimes, normalizeTimes, localClock, defaultBaseUrl };
