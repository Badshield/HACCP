'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../server/rules');

test('températures : plage de l\'équipement', () => {
  const fridge = { min_temp: 0, max_temp: 4 };
  assert.equal(r.temperatureCompliant(fridge, 3.9), true);
  assert.equal(r.temperatureCompliant(fridge, 4), true);
  assert.equal(r.temperatureCompliant(fridge, 4.1), false);
  assert.equal(r.temperatureCompliant(fridge, -1), false);
  assert.equal(r.temperatureCompliant({ min_temp: null, max_temp: -18 }, -25), true);
});

test('réception : température, emballage et DLC', () => {
  const at = '2026-10-02T08:00:00.000Z';
  assert.equal(r.receptionCompliant({ category: 'viande_hachee', temperature: 2, received_at: at }).compliant, true);
  const bad = r.receptionCompliant({ category: 'viande_hachee', temperature: 3, received_at: at });
  assert.equal(bad.compliant, false);
  assert.match(bad.reasons[0], /hors limite/);
  assert.equal(r.receptionCompliant({ category: 'surgele', temperature: -15, received_at: at }).compliant, false);
  assert.equal(r.receptionCompliant({ category: 'frais', received_at: at }).compliant, false);
  assert.equal(r.receptionCompliant({ category: 'sec', received_at: at }).compliant, true);
  assert.equal(r.receptionCompliant({ category: 'sec', packaging_ok: false, received_at: at }).compliant, false);
  assert.equal(r.receptionCompliant({ category: 'sec', dlc: '2026-10-01', received_at: at }).compliant, false);
  assert.equal(r.receptionCompliant({ category: 'sec', dlc: '2026-10-02', received_at: at }).compliant, true);
});

test('refroidissement : +10 °C en moins de 2 h', () => {
  const base = { type: 'cooling', start_at: '2026-10-02T10:00:00Z' };
  assert.equal(r.processCompliant({ ...base, end_at: '2026-10-02T11:50:00Z', end_temp: 9 }).compliant, true);
  assert.equal(r.processCompliant({ ...base, end_at: '2026-10-02T12:10:00Z', end_temp: 9 }).compliant, false);
  assert.equal(r.processCompliant({ ...base, end_at: '2026-10-02T11:00:00Z', end_temp: 12 }).compliant, false);
  assert.equal(r.processCompliant({ ...base, end_at: '2026-10-02T09:00:00Z', end_temp: 5 }).compliant, false);
});

test('remise en température : +63 °C en moins d\'1 h', () => {
  const base = { type: 'reheating', start_at: '2026-10-02T10:00:00Z' };
  assert.equal(r.processCompliant({ ...base, end_at: '2026-10-02T10:45:00Z', end_temp: 70 }).compliant, true);
  assert.equal(r.processCompliant({ ...base, end_at: '2026-10-02T11:15:00Z', end_temp: 70 }).compliant, false);
  assert.equal(r.processCompliant({ ...base, end_at: '2026-10-02T10:45:00Z', end_temp: 60 }).compliant, false);
});

test('huile de friture : 25 % de composés polaires', () => {
  assert.equal(r.oilCompliant(24.5), true);
  assert.equal(r.oilCompliant(25), true);
  assert.equal(r.oilCompliant(26), false);
});

test('nettoyage : échéances', () => {
  const now = new Date(2026, 9, 2, 12, 0);
  assert.equal(r.cleaningDue('daily', null, now), true);
  assert.equal(r.cleaningDue('daily', new Date(2026, 9, 2, 8).toISOString(), now), false);
  assert.equal(r.cleaningDue('daily', new Date(2026, 9, 1, 22).toISOString(), now), true);
  assert.equal(r.cleaningDue('weekly', new Date(2026, 8, 28).toISOString(), now), false);
  assert.equal(r.cleaningDue('weekly', new Date(2026, 8, 20).toISOString(), now), true);
  assert.equal(r.cleaningDue('after_use', null, now), false);
});

test('DLC secondaire', () => {
  assert.equal(r.secondaryDlc('2026-10-02T10:00:00Z', 3), '2026-10-05');
});
