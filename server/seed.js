'use strict';

/**
 * Crée un établissement de démonstration avec des données réalistes.
 * Usage : npm run seed   (compte : demo@haccp.local / demo1234)
 */
const bcrypt = require('bcryptjs');
const { openDb } = require('./db');
const rules = require('./rules');

function seed(db, { email = 'demo@haccp.local', password = 'demo1234' } = {}) {
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    console.log(`Le compte ${email} existe déjà, rien à faire.`);
    return;
  }
  db.transaction(() => {
    const org = db.prepare('INSERT INTO organizations (name, address, activity, siret) VALUES (?,?,?,?)')
      .run('Restaurant Le Bon Goût', '12 rue des Halles, 75001 Paris', 'Restauration traditionnelle', '12345678900012')
      .lastInsertRowid;
    const hash = bcrypt.hashSync(password, 10);
    const addUser = db.prepare('INSERT INTO users (org_id, email, password_hash, name, role) VALUES (?,?,?,?,?)');
    const admin = addUser.run(org, email, hash, 'Marie Dupont (gérante)', 'admin').lastInsertRowid;
    const cook = addUser.run(org, 'cuisine@haccp.local', hash, 'Karim (chef)', 'employee').lastInsertRowid;

    const eq = db.prepare('INSERT INTO equipment (org_id, name, type, min_temp, max_temp) VALUES (?,?,?,?,?)');
    const equip = [
      ['Frigo cuisine 1', 'fridge'], ['Chambre froide positive', 'cold_room'],
      ['Congélateur réserve', 'freezer'], ['Vitrine desserts', 'display'], ['Bain-marie service', 'hot_holding'],
    ].map(([n, t]) => ({ id: eq.run(org, n, t, rules.EQUIPMENT_TYPES[t].min, rules.EQUIPMENT_TYPES[t].max).lastInsertRowid, t }));

    const temp = db.prepare('INSERT INTO temperature_logs (org_id, equipment_id, value, compliant, user_id, recorded_at) VALUES (?,?,?,?,?,?)');
    const base = { fridge: 3, cold_room: 2, freezer: -20, display: 3, hot_holding: 68 };
    for (let d = 14; d >= 1; d--) {
      for (const h of [8, 16]) {
        const at = new Date(Date.now() - d * 86400000);
        at.setHours(h, 0, 0, 0);
        for (const e of equip) {
          const v = Math.round((base[e.t] + (Math.random() - 0.5) * 2) * 10) / 10;
          const def = rules.EQUIPMENT_TYPES[e.t];
          temp.run(org, e.id, v, rules.temperatureCompliant({ min_temp: def.min, max_temp: def.max }, v) ? 1 : 0,
            d % 2 ? cook : admin, at.toISOString());
        }
      }
    }

    const task = db.prepare('INSERT INTO cleaning_tasks (org_id, zone, name, product, method, frequency) VALUES (?,?,?,?,?,?)');
    const tasks = [
      ['Cuisine', 'Plans de travail', 'Détergent-désinfectant D10', 'Pulvériser, laisser agir 5 min, rincer', 'daily'],
      ['Cuisine', 'Sols', 'Dégraissant sols', 'Balayage humide puis lavage', 'daily'],
      ['Cuisine', 'Hotte et filtres', 'Dégraissant alcalin', 'Démonter filtres, tremper, rincer', 'weekly'],
      ['Stockage', 'Chambre froide', 'Désinfectant contact alimentaire', 'Vider, nettoyer parois et étagères', 'weekly'],
      ['Plonge', 'Lave-vaisselle', 'Détartrant', 'Vidange et détartrage', 'weekly'],
      ['Salle', 'Toilettes clients', 'Désinfectant sanitaire', 'Nettoyage complet', 'daily'],
      ['Cuisine', 'Trancheuse', 'Désinfectant contact alimentaire', 'Démonter, laver, désinfecter', 'after_use'],
    ].map((t) => task.run(org, ...t).lastInsertRowid);
    const clean = db.prepare('INSERT INTO cleaning_logs (org_id, task_id, user_id, done_at) VALUES (?,?,?,?)');
    for (let d = 7; d >= 1; d--) {
      const at = new Date(Date.now() - d * 86400000);
      at.setHours(22, 30, 0, 0);
      clean.run(org, tasks[0], cook, at.toISOString());
      clean.run(org, tasks[1], cook, at.toISOString());
    }

    const sup = db.prepare('INSERT INTO suppliers (org_id, name, approval_number, contact, phone) VALUES (?,?,?,?,?)');
    const s1 = sup.run(org, 'Boucherie Martin', 'FR 75.101.001 CE', 'M. Martin', '01 23 45 67 89').lastInsertRowid;
    const s2 = sup.run(org, 'Marée Fraîche SARL', 'FR 44.109.002 CE', 'Service commandes', '02 40 00 00 00').lastInsertRowid;
    sup.run(org, 'Primeurs du Marché', null, 'Julie', '06 00 00 00 00');

    const rec = db.prepare(`INSERT INTO receptions (org_id, supplier_id, product, category, lot_number, dlc, temperature, packaging_ok, compliant, user_id, received_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    rec.run(org, s1, 'Bavette de bœuf', 'volaille', 'L2409A', inDays(5), 3.2, 1, 1, cook, new Date(Date.now() - 3 * 86400000).toISOString());
    rec.run(org, s2, 'Filets de cabillaud', 'produits_peche', 'MF-8812', inDays(2), 1.5, 1, 1, cook, new Date(Date.now() - 2 * 86400000).toISOString());
    const ncRec = rec.run(org, s1, 'Steak haché', 'viande_hachee', 'L2410B', inDays(3), 4.5, 1, 0, cook,
      new Date(Date.now() - 86400000).toISOString()).lastInsertRowid;
    db.prepare(`INSERT INTO non_conformities (org_id, source, source_id, description, corrective_action, status, created_by, closed_by, closed_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(org, 'receptions', ncRec,
      'Réception Steak haché : Température 4.5 °C hors limite (Viandes hachées / préparations de viande)',
      'Livraison refusée, fournisseur prévenu, avoir demandé', 'closed', cook, admin, new Date().toISOString());

    db.prepare(`INSERT INTO process_logs (org_id, type, product, lot_number, start_at, start_temp, end_at, end_temp, duration_min, compliant, user_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(org, 'cooling', 'Blanquette de veau', 'BLQ-01',
      new Date(Date.now() - 86400000 - 7200000).toISOString(), 70,
      new Date(Date.now() - 86400000 - 1800000).toISOString(), 8, 90, 1, cook);
    db.prepare(`INSERT INTO oil_checks (org_id, fryer, polar_percent, oil_changed, compliant, user_id, checked_at)
      VALUES (?,?,?,?,?,?,?)`).run(org, 'Friteuse 1', 18, 0, 1, cook, new Date(Date.now() - 86400000).toISOString());

    const recipe = db.prepare('INSERT INTO recipes (org_id, name, description, allergens) VALUES (?,?,?,?)');
    recipe.run(org, 'Blanquette de veau', 'Veau, carottes, champignons, crème, farine', JSON.stringify(['Gluten', 'Lait', 'Céleri']));
    recipe.run(org, 'Tarte au citron meringuée', 'Pâte sablée, crème citron, meringue', JSON.stringify(['Gluten', 'Œufs', 'Lait']));
    recipe.run(org, 'Salade niçoise', 'Thon, œufs, anchois, olives, légumes', JSON.stringify(['Œufs', 'Poissons', 'Moutarde']));

    db.prepare('INSERT INTO trainings (org_id, person, title, organism, date, expires_on) VALUES (?,?,?,?,?,?)')
      .run(org, 'Marie Dupont', 'Formation hygiène alimentaire (14 h)', 'CCI Paris', '2023-03-15', null);
  })();
  console.log(`Démo créée : ${email} / ${password}`);
}

if (require.main === module) seed(openDb());

module.exports = { seed };
