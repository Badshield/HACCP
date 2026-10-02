'use strict';

const rules = require('./rules');
const { resource, ValidationError } = require('./resource');

const LOGGED = { user_id: { computed: true } };

function fmtTemp(v) {
  return `${v} °C`;
}

/** Monte toutes les ressources HACCP sur le routeur API. */
function mountModules(api, db) {
  // ---------- Référentiels ----------
  api.use('/equipment', resource(db, {
    table: 'equipment',
    orderBy: 't.name',
    fields: {
      name: { type: 'string', required: true, label: 'Nom' },
      type: { type: 'enum', values: Object.keys(rules.EQUIPMENT_TYPES), required: true, label: 'Type' },
      min_temp: { type: 'number', label: 'T° min' },
      max_temp: { type: 'number', label: 'T° max' },
      active: { type: 'bool', default: 1 },
    },
    compute(data) {
      const def = rules.EQUIPMENT_TYPES[data.type];
      if (def) {
        if (data.min_temp == null) data.min_temp = def.min;
        if (data.max_temp == null) data.max_temp = def.max;
      }
      if (data.min_temp != null && data.max_temp != null && data.min_temp > data.max_temp) {
        throw new ValidationError('T° min supérieure à T° max');
      }
    },
  }));

  api.use('/cleaning-tasks', resource(db, {
    table: 'cleaning_tasks',
    orderBy: 't.zone, t.name',
    fields: {
      zone: { type: 'string', required: true, label: 'Zone' },
      name: { type: 'string', required: true, label: 'Élément' },
      product: { type: 'string' },
      method: { type: 'string', max: 2000 },
      frequency: { type: 'enum', values: ['daily', 'weekly', 'monthly', 'after_use'], required: true, label: 'Fréquence' },
      active: { type: 'bool', default: 1 },
    },
  }));

  api.use('/suppliers', resource(db, {
    table: 'suppliers',
    orderBy: 't.name',
    fields: {
      name: { type: 'string', required: true, label: 'Nom' },
      approval_number: { type: 'string' },
      contact: { type: 'string' },
      phone: { type: 'string' },
      email: { type: 'string' },
      active: { type: 'bool', default: 1 },
    },
  }));

  api.use('/recipes', resource(db, {
    table: 'recipes',
    orderBy: 't.name',
    fields: {
      name: { type: 'string', required: true, label: 'Nom' },
      description: { type: 'string', max: 5000 },
      allergens: { type: 'json', default: '[]' },
      active: { type: 'bool', default: 1 },
    },
    compute(data) {
      if (data.allergens) {
        const list = JSON.parse(data.allergens);
        const bad = list.filter((a) => !rules.ALLERGENS.includes(a));
        if (bad.length) throw new ValidationError(`Allergène inconnu : ${bad.join(', ')}`);
      }
    },
    serialize: (r) => ({ ...r, allergens: JSON.parse(r.allergens || '[]') }),
  }));

  api.use('/shelf-lives', resource(db, {
    table: 'shelf_life_presets',
    orderBy: 't.product',
    fields: {
      product: { type: 'string', required: true, label: 'Produit' },
      kind: { type: 'enum', values: ['opened', 'prepared', 'defrosted'], required: true, label: 'Type' },
      days: { type: 'int', required: true, label: 'Durée de vie (jours)' },
      active: { type: 'bool', default: 1 },
    },
    compute(data) {
      if (data.days != null && (data.days < 0 || data.days > 365)) throw new ValidationError('Durée de vie invalide');
    },
  }));

  api.use('/trainings', resource(db, {
    table: 'trainings',
    dateField: 'date',
    fields: {
      person: { type: 'string', required: true, label: 'Personne' },
      title: { type: 'string', required: true, label: 'Formation' },
      organism: { type: 'string' },
      date: { type: 'date', required: true, label: 'Date' },
      expires_on: { type: 'date' },
    },
  }));

  // ---------- Registres (ajout seul) ----------
  const equipmentById = db.prepare('SELECT * FROM equipment WHERE id = ?');
  api.use('/temperatures', resource(db, {
    table: 'temperature_logs',
    mode: 'log',
    dateField: 'recorded_at',
    filters: ['equipment_id'],
    select: `SELECT t.*, e.name AS equipment_name, e.min_temp, e.max_temp, u.name AS user_name
             FROM temperature_logs t JOIN equipment e ON e.id = t.equipment_id
             LEFT JOIN users u ON u.id = t.user_id`,
    fields: {
      equipment_id: { type: 'ref', table: 'equipment', required: true, label: 'Équipement' },
      value: { type: 'number', required: true, label: 'Température' },
      comment: { type: 'string', max: 2000 },
      recorded_at: { type: 'datetime' },
      compliant: { computed: true },
      ...LOGGED,
    },
    compute(data) {
      const eq = equipmentById.get(data.equipment_id);
      data.compliant = rules.temperatureCompliant(eq, data.value) ? 1 : 0;
      if (!data.compliant) {
        return { nonConformity: `${eq.name} : ${fmtTemp(data.value)} hors plage [${eq.min_temp} ; ${eq.max_temp}]` };
      }
    },
  }));

  api.use('/cleaning-logs', resource(db, {
    table: 'cleaning_logs',
    mode: 'log',
    dateField: 'done_at',
    select: `SELECT t.*, c.zone, c.name AS task_name, u.name AS user_name
             FROM cleaning_logs t JOIN cleaning_tasks c ON c.id = t.task_id
             LEFT JOIN users u ON u.id = t.user_id`,
    fields: {
      task_id: { type: 'ref', table: 'cleaning_tasks', required: true, label: 'Tâche' },
      comment: { type: 'string', max: 2000 },
      done_at: { type: 'datetime' },
      ...LOGGED,
    },
  }));

  api.use('/receptions', resource(db, {
    table: 'receptions',
    mode: 'log',
    dateField: 'received_at',
    select: `SELECT t.*, s.name AS supplier_name, u.name AS user_name
             FROM receptions t LEFT JOIN suppliers s ON s.id = t.supplier_id
             LEFT JOIN users u ON u.id = t.user_id`,
    fields: {
      supplier_id: { type: 'ref', table: 'suppliers', label: 'Fournisseur' },
      product: { type: 'string', required: true, label: 'Produit' },
      category: { type: 'enum', values: Object.keys(rules.RECEPTION_CATEGORIES), required: true, label: 'Catégorie' },
      lot_number: { type: 'string' },
      dlc: { type: 'date', label: 'DLC' },
      temperature: { type: 'number', label: 'Température' },
      packaging_ok: { type: 'bool', default: 1 },
      comment: { type: 'string', max: 2000 },
      received_at: { type: 'datetime' },
      compliant: { computed: true },
      ...LOGGED,
    },
    compute(data) {
      const r = rules.receptionCompliant({ ...data, packaging_ok: data.packaging_ok === 1 });
      data.compliant = r.compliant ? 1 : 0;
      if (!r.compliant) return { nonConformity: `Réception ${data.product} : ${r.reasons.join(' ; ')}` };
    },
  }));

  api.use('/processes', resource(db, {
    table: 'process_logs',
    mode: 'log',
    dateField: 'start_at',
    filters: ['type'],
    select: `SELECT t.*, u.name AS user_name FROM process_logs t LEFT JOIN users u ON u.id = t.user_id`,
    fields: {
      type: { type: 'enum', values: ['cooling', 'reheating'], required: true, label: 'Type' },
      product: { type: 'string', required: true, label: 'Produit' },
      lot_number: { type: 'string' },
      start_at: { type: 'datetime', required: true, label: 'Début' },
      start_temp: { type: 'number' },
      end_at: { type: 'datetime', required: true, label: 'Fin' },
      end_temp: { type: 'number', required: true, label: 'T° finale' },
      comment: { type: 'string', max: 2000 },
      duration_min: { computed: true },
      compliant: { computed: true },
      ...LOGGED,
    },
    compute(data) {
      const r = rules.processCompliant(data);
      data.duration_min = r.minutes;
      data.compliant = r.compliant ? 1 : 0;
      const label = data.type === 'cooling' ? 'Refroidissement' : 'Remise en température';
      if (!r.compliant) return { nonConformity: `${label} ${data.product} : ${r.reasons.join(' ; ')}` };
    },
  }));

  api.use('/oil-checks', resource(db, {
    table: 'oil_checks',
    mode: 'log',
    dateField: 'checked_at',
    select: `SELECT t.*, u.name AS user_name FROM oil_checks t LEFT JOIN users u ON u.id = t.user_id`,
    fields: {
      fryer: { type: 'string', required: true, label: 'Friteuse' },
      polar_percent: { type: 'number', required: true, label: '% composés polaires' },
      oil_changed: { type: 'bool', default: 0 },
      comment: { type: 'string', max: 2000 },
      checked_at: { type: 'datetime' },
      compliant: { computed: true },
      ...LOGGED,
    },
    compute(data) {
      // Une huile au-delà du seuil reste conforme si elle a été changée immédiatement.
      data.compliant = rules.oilCompliant(data.polar_percent) || data.oil_changed ? 1 : 0;
      if (!data.compliant) {
        return { nonConformity: `Huile ${data.fryer} : ${data.polar_percent} % > ${rules.OIL_MAX_POLAR} % sans changement` };
      }
    },
  }));

  api.use('/labels', resource(db, {
    table: 'labels',
    mode: 'log',
    dateField: 'created_at',
    select: `SELECT t.*, u.name AS user_name FROM labels t LEFT JOIN users u ON u.id = t.user_id`,
    fields: {
      product: { type: 'string', required: true, label: 'Produit' },
      lot_number: { type: 'string' },
      kind: { type: 'enum', values: ['opened', 'prepared', 'defrosted'], required: true, label: 'Type' },
      start_at: { type: 'datetime', required: true, label: 'Date' },
      shelf_life_days: { type: 'int', required: true, label: 'Durée de vie (jours)' },
      dlc: { computed: true },
      ...LOGGED,
    },
    compute(data) {
      if (data.shelf_life_days < 0 || data.shelf_life_days > 365) throw new ValidationError('Durée de vie invalide');
      data.dlc = rules.secondaryDlc(data.start_at, data.shelf_life_days);
    },
  }));

  api.use('/pest-controls', resource(db, {
    table: 'pest_controls',
    mode: 'log',
    dateField: 'checked_at',
    select: `SELECT t.*, u.name AS user_name FROM pest_controls t LEFT JOIN users u ON u.id = t.user_id`,
    fields: {
      provider: { type: 'string' },
      kind: { type: 'string', required: true, label: 'Type de contrôle' },
      findings: { type: 'string', max: 2000 },
      compliant: { type: 'bool', default: 1 },
      checked_at: { type: 'datetime' },
      ...LOGGED,
    },
    compute(data) {
      if (!data.compliant) return { nonConformity: `Nuisibles (${data.kind}) : ${data.findings || 'présence constatée'}` };
    },
  }));
}

module.exports = { mountModules };
