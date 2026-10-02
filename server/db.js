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

function openDb(file = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'haccp.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb };
