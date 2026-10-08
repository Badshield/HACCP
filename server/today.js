'use strict';

/**
 * Page « Aujourd'hui » : ce qu'il reste à faire, la progression de la journée
 * et la série de jours réussis.
 *
 * Toutes les dates sont calculées dans le fuseau horaire de l'établissement :
 * un relevé de 0 h 30 à Paris appartient bien au jour qui commence.
 *
 * Série (« streak ») : nombre de jours de suite où TOUS les équipements ont été
 * relevés. Un jour sans aucun relevé (jour de fermeture) est neutre : il ne
 * casse pas la série, sinon un restaurant fermé le dimanche la perdrait chaque
 * semaine. Un jour avec des relevés incomplets, lui, la casse.
 */

const DAY_MS = 86400000;
const HISTORY_DAYS = 62;
const MAX_STREAK = 60;

function dayFormatter(timeZone) {
  const options = { year: 'numeric', month: '2-digit', day: '2-digit' };
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, ...options });
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', ...options });
  }
}

const dayNumber = (day) => Math.round(Date.parse(`${day}T12:00:00Z`) / DAY_MS);
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** Une tâche de nettoyage est-elle à faire aujourd'hui, selon son dernier jour de réalisation ? */
function isDue(frequency, lastDay, today) {
  if (frequency === 'after_use') return false; // à la demande : jamais « en retard »
  if (!lastDay) return true;
  const gap = dayNumber(today) - dayNumber(lastDay);
  if (frequency === 'daily') return gap >= 1;
  if (frequency === 'weekly') return gap >= 7;
  if (frequency === 'monthly') return gap >= 30;
  return false;
}

function mountToday(api, db, { now = () => new Date() } = {}) {
  api.get('/today', (req, res) => {
    const orgId = req.user.org_id;
    const org = db.prepare('SELECT timezone, created_at FROM organizations WHERE id = ?').get(orgId);
    const fmt = dayFormatter(org.timezone || 'Europe/Paris');
    const nowDate = now();
    const today = fmt.format(nowDate);
    const dayOf = (iso) => fmt.format(new Date(iso));

    // ---------- Relevés de températures ----------
    const equipment = db.prepare(`SELECT id, name, type, min_temp, max_temp FROM equipment
      WHERE org_id = ? AND active = 1 ORDER BY name COLLATE NOCASE`).all(orgId);
    const since = new Date(nowDate.getTime() - HISTORY_DAYS * DAY_MS).toISOString();
    const readings = db.prepare(`SELECT equipment_id, value, compliant, recorded_at FROM temperature_logs
      WHERE org_id = ? AND recorded_at >= ? ORDER BY recorded_at`).all(orgId, since);
    const firstDay = Object.fromEntries(db.prepare(`SELECT equipment_id, MIN(recorded_at) AS first FROM temperature_logs
      WHERE org_id = ? GROUP BY equipment_id`).all(orgId).map((r) => [r.equipment_id, dayOf(r.first)]));

    const byDay = new Map(); // jour → équipements relevés ce jour-là
    const todayReading = new Map();
    const previous = new Map();
    for (const r of readings) {
      const day = dayOf(r.recorded_at);
      if (!byDay.has(day)) byDay.set(day, new Set());
      byDay.get(day).add(r.equipment_id);
      if (day === today) todayReading.set(r.equipment_id, r);
      else previous.set(r.equipment_id, r);
    }

    const temperatures = equipment.map((e) => {
      const t = todayReading.get(e.id);
      const p = previous.get(e.id);
      return {
        ...e,
        done: !!t,
        reading: t ? { value: t.value, compliant: t.compliant, at: t.recorded_at } : null,
        previous: p ? { value: p.value, at: p.recorded_at } : null,
      };
    });

    // ---------- Nettoyage ----------
    const tasks = db.prepare(`SELECT id, zone, name, product, method, frequency FROM cleaning_tasks
      WHERE org_id = ? AND active = 1 ORDER BY zone COLLATE NOCASE, name COLLATE NOCASE`).all(orgId);
    const lastClean = Object.fromEntries(db.prepare(`SELECT task_id, MAX(done_at) AS last FROM cleaning_logs
      WHERE org_id = ? GROUP BY task_id`).all(orgId).map((r) => [r.task_id, r.last]));
    const cleaning = tasks.map((t) => {
      const last = lastClean[t.id];
      const lastDay = last ? dayOf(last) : null;
      const done = lastDay === today;
      return { ...t, due: !done && isDue(t.frequency, lastDay, today), done, done_at: done ? last : null };
    });

    // ---------- Progression ----------
    const counted = cleaning.filter((t) => t.frequency !== 'after_use' && (t.due || t.done));
    const progress = {
      total: temperatures.length + counted.length,
      done: temperatures.filter((t) => t.done).length + counted.filter((t) => t.done).length,
    };

    // ---------- Série et semaine ----------
    const firstEver = Object.values(firstDay).sort()[0];
    const dayState = (day) => {
      if (!firstEver || day < firstEver) return 'none'; // avant le premier relevé : pas d'historique
      const got = byDay.get(day);
      if (!got || !got.size) return 'off'; // aucun relevé ce jour-là : jour de fermeture
      const required = equipment.filter((e) => firstDay[e.id] && firstDay[e.id] <= day);
      if (!required.length) return 'none';
      return required.every((e) => got.has(e.id)) ? 'done' : 'missed';
    };
    const todayComplete = equipment.length > 0 && equipment.every((e) => todayReading.has(e.id));
    let streak = todayComplete ? 1 : 0;
    for (let i = 1; i <= MAX_STREAK; i++) {
      const state = dayState(addDays(today, -i));
      if (state === 'done') streak++;
      else if (state !== 'off') break;
    }
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const day = addDays(today, -i);
      let state;
      if (i === 0) state = todayComplete ? 'done' : todayReading.size ? 'partial' : 'today';
      else state = dayState(day);
      week.push({ day, state });
    }

    // ---------- Alertes, DLC, premiers pas ----------
    const openNc = db.prepare("SELECT COUNT(*) AS n FROM non_conformities WHERE org_id = ? AND status = 'open'").get(orgId).n;
    const alerts = db.prepare(`SELECT id, description, created_at FROM non_conformities
      WHERE org_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 3`).all(orgId);
    const tomorrow = addDays(today, 1);
    const labels = db.prepare(`SELECT id, product, lot_number, dlc FROM labels WHERE org_id = ? AND dlc BETWEEN ? AND ?
      ORDER BY dlc, product LIMIT 6`).all(orgId, today, tomorrow)
      .map((l) => ({ ...l, when: l.dlc === today ? 'today' : 'tomorrow' }));

    const manager = req.user.role === 'manager' || req.user.role === 'admin';
    const firstSteps = manager ? {
      equipment: equipment.length,
      readings: db.prepare('SELECT COUNT(*) AS n FROM temperature_logs WHERE org_id = ?').get(orgId).n,
      members: db.prepare('SELECT COUNT(*) AS n FROM users WHERE org_id = ? AND active = 1').get(orgId).n,
      devices: db.prepare('SELECT COUNT(*) AS n FROM devices WHERE org_id = ? AND revoked_at IS NULL').get(orgId).n,
      age_days: Math.max(0, Math.floor((nowDate.getTime() - Date.parse(org.created_at)) / DAY_MS)),
    } : null;

    res.json({
      today, temperatures, cleaning, progress, streak, week,
      alerts: { count: openNc, items: alerts },
      labels, firstSteps,
    });
  });
}

module.exports = { mountToday, isDue, addDays };
