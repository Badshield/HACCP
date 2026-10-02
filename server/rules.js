'use strict';

/**
 * Règles de conformité HACCP (réglementation française / européenne).
 * Fonctions pures, sans accès base de données, pour être testables et
 * réutilisables côté rapports.
 *
 * Références principales :
 *  - Règlement (CE) 852/2004 (hygiène des denrées alimentaires)
 *  - Arrêté du 21 décembre 2009 (températures de conservation)
 *  - GBPH Restaurateur (refroidissement / remise en température)
 */

/** Plages par défaut des équipements (°C). */
const EQUIPMENT_TYPES = {
  fridge: { label: 'Réfrigérateur', min: 0, max: 4 },
  cold_room: { label: 'Chambre froide positive', min: 0, max: 3 },
  display: { label: 'Vitrine réfrigérée', min: 0, max: 4 },
  freezer: { label: 'Congélateur / chambre négative', min: -30, max: -18 },
  hot_holding: { label: 'Maintien au chaud', min: 63, max: 100 },
};

/** Températures maximales (ou minimales) à réception, par catégorie de produit. */
const RECEPTION_CATEGORIES = {
  frais: { label: 'Produits frais réfrigérés', max: 4 },
  viande_hachee: { label: 'Viandes hachées / préparations de viande', max: 2 },
  produits_peche: { label: 'Produits de la pêche frais', max: 2 },
  volaille: { label: 'Volailles / viandes fraîches', max: 4 },
  laitier: { label: 'Produits laitiers', max: 6 },
  surgele: { label: 'Surgelés / congelés', max: -18 },
  chaud: { label: 'Plats livrés chauds', min: 63 },
  sec: { label: 'Épicerie sèche / ambiant' },
};

/** Refroidissement rapide : de +63 °C à +10 °C à cœur en moins de 2 h. */
const COOLING = { maxEndTemp: 10, maxMinutes: 120 };
/** Remise en température : atteindre +63 °C à cœur en moins de 1 h. */
const REHEATING = { minEndTemp: 63, maxMinutes: 60 };
/** Huile de friture : composés polaires totaux ≤ 25 %. */
const OIL_MAX_POLAR = 25;

/** Les 14 allergènes à déclaration obligatoire (règlement INCO 1169/2011). */
const ALLERGENS = [
  'Gluten', 'Crustacés', 'Œufs', 'Poissons', 'Arachides', 'Soja', 'Lait',
  'Fruits à coque', 'Céleri', 'Moutarde', 'Graines de sésame',
  'Anhydride sulfureux et sulfites', 'Lupin', 'Mollusques',
];

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function inRange(value, min, max) {
  if (!isNum(value)) return false;
  if (isNum(min) && value < min) return false;
  if (isNum(max) && value > max) return false;
  return true;
}

function temperatureCompliant(equipment, value) {
  return inRange(value, equipment.min_temp, equipment.max_temp);
}

function receptionCompliant({ category, temperature, packaging_ok, dlc, received_at }) {
  const reasons = [];
  const rule = RECEPTION_CATEGORIES[category];
  if (rule && (isNum(rule.max) || isNum(rule.min))) {
    if (!isNum(temperature)) reasons.push('Température non relevée');
    else if (!inRange(temperature, rule.min, rule.max)) {
      reasons.push(`Température ${temperature} °C hors limite (${rule.label})`);
    }
  }
  if (packaging_ok === false || packaging_ok === 0) reasons.push('Emballage / étiquetage non conforme');
  if (dlc) {
    const day = (received_at || new Date().toISOString()).slice(0, 10);
    if (dlc < day) reasons.push(`DLC dépassée (${dlc})`);
  }
  return { compliant: reasons.length === 0, reasons };
}

function minutesBetween(startIso, endIso) {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
}

function processCompliant({ type, start_at, end_at, end_temp }) {
  const minutes = minutesBetween(start_at, end_at);
  const reasons = [];
  if (!Number.isFinite(minutes) || minutes < 0) {
    reasons.push('Horaires incohérents');
  } else if (type === 'cooling') {
    if (minutes > COOLING.maxMinutes) reasons.push(`Durée ${Math.round(minutes)} min > ${COOLING.maxMinutes} min`);
    if (!(end_temp <= COOLING.maxEndTemp)) reasons.push(`Température finale ${end_temp} °C > ${COOLING.maxEndTemp} °C`);
  } else if (type === 'reheating') {
    if (minutes > REHEATING.maxMinutes) reasons.push(`Durée ${Math.round(minutes)} min > ${REHEATING.maxMinutes} min`);
    if (!(end_temp >= REHEATING.minEndTemp)) reasons.push(`Température finale ${end_temp} °C < ${REHEATING.minEndTemp} °C`);
  } else {
    reasons.push('Type de process inconnu');
  }
  return { compliant: reasons.length === 0, reasons, minutes: Math.round(minutes) };
}

function oilCompliant(polar) {
  return isNum(polar) && polar <= OIL_MAX_POLAR;
}

/** Une tâche de nettoyage est-elle à faire, compte tenu de sa dernière réalisation ? */
function cleaningDue(frequency, lastDoneIso, now = new Date()) {
  if (frequency === 'after_use') return false;
  if (!lastDoneIso) return true;
  const last = new Date(lastDoneIso);
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (frequency === 'daily') return last < startOfDay;
  if (frequency === 'weekly') return now - last >= 7 * 86400000;
  if (frequency === 'monthly') return now - last >= 30 * 86400000;
  return false;
}

/** Calcule une DLC secondaire (après ouverture / fabrication). */
function secondaryDlc(fromIso, days) {
  const d = new Date(fromIso);
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

module.exports = {
  EQUIPMENT_TYPES,
  RECEPTION_CATEGORIES,
  COOLING,
  REHEATING,
  OIL_MAX_POLAR,
  ALLERGENS,
  temperatureCompliant,
  receptionCompliant,
  processCompliant,
  oilCompliant,
  cleaningDue,
  secondaryDlc,
};
