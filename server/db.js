'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  siret TEXT,
  address TEXT,
  activity TEXT,
  plan TEXT NOT NULL DEFAULT 'trial',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','employee')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  min_temp REAL,
  max_temp REAL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS temperature_logs (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id),
  value REAL NOT NULL,
  compliant INTEGER NOT NULL,
  comment TEXT,
  user_id INTEGER REFERENCES users(id),
  recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cleaning_tasks (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  zone TEXT NOT NULL,
  name TEXT NOT NULL,
  product TEXT,
  method TEXT,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly','after_use')),
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS cleaning_logs (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  task_id INTEGER NOT NULL REFERENCES cleaning_tasks(id),
  comment TEXT,
  user_id INTEGER REFERENCES users(id),
  done_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  approval_number TEXT,
  contact TEXT,
  phone TEXT,
  email TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS receptions (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  supplier_id INTEGER REFERENCES suppliers(id),
  product TEXT NOT NULL,
  category TEXT NOT NULL,
  lot_number TEXT,
  dlc TEXT,
  temperature REAL,
  packaging_ok INTEGER NOT NULL DEFAULT 1,
  compliant INTEGER NOT NULL,
  comment TEXT,
  user_id INTEGER REFERENCES users(id),
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS process_logs (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('cooling','reheating')),
  product TEXT NOT NULL,
  lot_number TEXT,
  start_at TEXT NOT NULL,
  start_temp REAL,
  end_at TEXT NOT NULL,
  end_temp REAL NOT NULL,
  duration_min INTEGER,
  compliant INTEGER NOT NULL,
  comment TEXT,
  user_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS oil_checks (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  fryer TEXT NOT NULL,
  polar_percent REAL NOT NULL,
  oil_changed INTEGER NOT NULL DEFAULT 0,
  compliant INTEGER NOT NULL,
  comment TEXT,
  user_id INTEGER REFERENCES users(id),
  checked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product TEXT NOT NULL,
  lot_number TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('opened','prepared','defrosted')),
  start_at TEXT NOT NULL,
  shelf_life_days INTEGER NOT NULL,
  dlc TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS shelf_life_presets (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('opened','prepared','defrosted')),
  days INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS recipes (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  allergens TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pest_controls (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT,
  kind TEXT NOT NULL,
  findings TEXT,
  compliant INTEGER NOT NULL DEFAULT 1,
  user_id INTEGER REFERENCES users(id),
  checked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trainings (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person TEXT NOT NULL,
  title TEXT NOT NULL,
  organism TEXT,
  date TEXT NOT NULL,
  expires_on TEXT
);

CREATE TABLE IF NOT EXISTS non_conformities (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_id INTEGER,
  description TEXT NOT NULL,
  corrective_action TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT
);

-- Photos jointes aux enregistrements (fichiers stockés sur disque).
CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_photos_entity ON photos(org_id, entity, entity_id);

-- Tablettes de cuisine partagées : connexion des employés par code PIN.
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT,
  revoked_at TEXT
);

-- Demandes de contact / démo envoyées depuis la page d'accueil.
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  business TEXT,
  message TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Rappels déjà envoyés (évite les doublons, une clé par rappel et par jour).
CREATE TABLE IF NOT EXISTS reminder_log (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (org_id, key)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  org_id INTEGER NOT NULL,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_temp_org_date ON temperature_logs(org_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_clean_org_date ON cleaning_logs(org_id, done_at);
CREATE INDEX IF NOT EXISTS idx_recep_org_date ON receptions(org_id, received_at);
CREATE INDEX IF NOT EXISTS idx_nc_org_status ON non_conformities(org_id, status);
`;

/** Colonnes ajoutées après la première version : ajoutées aux bases existantes. */
const ADDED_COLUMNS = {
  organizations: {
    trial_ends_at: 'TEXT',
    subscription_status: 'TEXT',
    stripe_customer_id: 'TEXT',
    stripe_subscription_id: 'TEXT',
    current_period_end: 'TEXT',
    timezone: "TEXT NOT NULL DEFAULT 'Europe/Paris'",
    notif_enabled: 'INTEGER NOT NULL DEFAULT 1',
    notif_temp_times: "TEXT NOT NULL DEFAULT '09:00,17:00'",
    notif_grace_min: 'INTEGER NOT NULL DEFAULT 30',
    notif_digest_time: "TEXT NOT NULL DEFAULT '20:00'",
    notif_nc_alert: 'INTEGER NOT NULL DEFAULT 1',
    terms_accepted_at: 'TEXT',
    terms_version: 'TEXT',
  },
  users: {
    notify: 'INTEGER NOT NULL DEFAULT 1',
    password_changed_at: 'TEXT',
    pin_hash: 'TEXT',
    pin_failed: 'INTEGER NOT NULL DEFAULT 0',
    pin_locked_until: 'TEXT',
    pin_only: 'INTEGER NOT NULL DEFAULT 0',
  },
};

function migrate(db) {
  for (const [table, cols] of Object.entries(ADDED_COLUMNS)) {
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, type] of Object.entries(cols)) {
      if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }
  // Les établissements créés avant la facturation démarrent un essai à la migration.
  db.prepare("UPDATE organizations SET trial_ends_at = ? WHERE trial_ends_at IS NULL")
    .run(new Date(Date.now() + 30 * 86400000).toISOString());
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_org_customer ON organizations(stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL`);
}

function openDb(file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'haccp.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

module.exports = { openDb };
