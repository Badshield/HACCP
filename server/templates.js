'use strict';

/**
 * Modèles de démarrage par métier : équipements, plan de nettoyage et durées
 * de vie (DLC secondaires) préremplis à l'inscription.
 *
 * Les durées de vie sont INDICATIVES : chaque établissement doit les valider
 * dans son Plan de Maîtrise Sanitaire (idéalement par des analyses de
 * vieillissement) et peut les modifier.
 */

const rules = require('./rules');

const D = 'daily';
const W = 'weekly';
const M = 'monthly';
const U = 'after_use';

const DETERGENT_DESINFECTANT = 'Détergent-désinfectant contact alimentaire';
const DEGRAISSANT = 'Dégraissant alcalin';
const SOLS = 'Détergent sols';

// Tâches communes à tous les métiers.
const COMMON_CLEANING = [
  ['Locaux', 'Poubelles et local déchets', 'Détergent-désinfectant', 'Vider, laver et désinfecter les conteneurs', D],
  ['Locaux', 'Lave-mains (savon, essuie-mains)', null, 'Vérifier et réapprovisionner', D],
  ['Stockage', 'Réfrigérateurs', DETERGENT_DESINFECTANT, 'Vider, nettoyer parois et clayettes, rincer, sécher', W],
  ['Stockage', 'Congélateurs (dégivrage)', DETERGENT_DESINFECTANT, 'Transférer les produits, dégivrer, nettoyer, sécher', M],
];

const TEMPLATES = {
  restaurant: {
    label: 'Restaurant / brasserie',
    description: 'Restauration traditionnelle avec cuisine sur place',
    equipment: [
      ['Réfrigérateur cuisine', 'fridge'],
      ['Saladette / frigo du passe', 'fridge'],
      ['Chambre froide positive', 'cold_room'],
      ['Congélateur', 'freezer'],
      ['Bain-marie / maintien au chaud', 'hot_holding'],
    ],
    cleaning: [
      ['Cuisine', 'Plans de travail', DETERGENT_DESINFECTANT, 'Débarrasser, laver, désinfecter, rincer', D],
      ['Cuisine', 'Piano / fourneaux / plancha', DEGRAISSANT, 'Dégraisser à chaud puis rincer', D],
      ['Cuisine', 'Sols', SOLS, 'Balayage humide puis lavage', D],
      ['Cuisine', 'Hotte et filtres', DEGRAISSANT, 'Démonter les filtres, tremper, rincer', W],
      ['Cuisine', 'Planches et ustensiles', DETERGENT_DESINFECTANT, 'Lavage en machine ou trempage', U],
      ['Cuisine', 'Trancheuse', DETERGENT_DESINFECTANT, 'Démonter, laver, désinfecter', U],
      ['Plonge', 'Plonge et éviers', DETERGENT_DESINFECTANT, 'Laver, désinfecter, rincer', D],
      ['Plonge', 'Lave-vaisselle (vidange)', 'Détartrant', 'Vidange, nettoyage des filtres', D],
      ['Stockage', 'Chambre froide', DETERGENT_DESINFECTANT, 'Vider partiellement, nettoyer étagères et sol', W],
      ['Salle', 'Tables et chaises', 'Détergent', 'Essuyage après chaque service', D],
      ['Salle', 'Toilettes clients', 'Désinfectant sanitaire', 'Nettoyage complet', D],
      ...COMMON_CLEANING,
    ],
    shelfLives: [
      ['Produit entamé (conserve, sous-vide, crème...)', 'opened', 3],
      ['Préparation froide maison', 'prepared', 3],
      ['Sauce émulsionnée maison (mayonnaise...)', 'prepared', 1],
      ['Plat cuisiné refroidi en cellule', 'prepared', 3],
      ['Viande / poisson décongelé', 'defrosted', 3],
      ['Légumes crus préparés', 'prepared', 2],
    ],
  },

  boulangerie: {
    label: 'Boulangerie / pâtisserie',
    description: 'Fabrication de pains, viennoiseries, pâtisseries et snacking',
    equipment: [
      ['Réfrigérateur laboratoire', 'fridge'],
      ['Chambre froide positive', 'cold_room'],
      ['Congélateur / chambre négative', 'freezer'],
      ['Vitrine pâtisseries', 'display'],
      ['Vitrine snacking / sandwichs', 'display'],
    ],
    cleaning: [
      ['Laboratoire', 'Pétrin', DETERGENT_DESINFECTANT, 'Racler, laver, désinfecter, rincer', D],
      ['Laboratoire', 'Diviseuse / façonneuse', 'Brosse sèche + désinfectant', 'Brosser la farine puis désinfecter les parties en contact', D],
      ['Laboratoire', 'Tours et plans de travail', DETERGENT_DESINFECTANT, 'Débarrasser, laver, désinfecter', D],
      ['Laboratoire', 'Batteur / mélangeur', DETERGENT_DESINFECTANT, 'Démonter les accessoires, laver, désinfecter', U],
      ['Laboratoire', 'Poches, douilles et moules', DETERGENT_DESINFECTANT, 'Lavage, désinfection, séchage', U],
      ['Laboratoire', 'Plaques et grilles', DEGRAISSANT, 'Gratter, laver', W],
      ['Laboratoire', 'Four (soles et abords)', null, 'Brossage des soles, nettoyage des façades', W],
      ['Laboratoire', 'Sols', SOLS, 'Balayage humide puis lavage', D],
      ['Magasin', 'Vitrines', DETERGENT_DESINFECTANT, 'Vider, nettoyer, désinfecter', D],
      ['Magasin', 'Trancheuse à pain', 'Brosse', 'Brosser les lames et le bac à miettes', W],
      ['Stockage', 'Chambre froide', DETERGENT_DESINFECTANT, 'Nettoyer étagères et sol', W],
      ...COMMON_CLEANING,
    ],
    shelfLives: [
      ['Crème pâtissière', 'prepared', 1],
      ['Crème chantilly', 'prepared', 1],
      ['Pâtisserie à la crème', 'prepared', 2],
      ['Sandwich / snacking', 'prepared', 1],
      ['Pâte crue (sablée, feuilletée...)', 'prepared', 3],
      ['Produit laitier entamé', 'opened', 3],
      ['Ovoproduit entamé', 'opened', 1],
      ['Produit décongelé', 'defrosted', 3],
    ],
  },

  boucherie: {
    label: 'Boucherie / charcuterie',
    description: 'Découpe, préparations de viande, charcuterie et rôtisserie',
    equipment: [
      ['Chambre froide carcasses', 'cold_room'],
      ['Chambre froide produits élaborés', 'cold_room'],
      ['Vitrine réfrigérée', 'display'],
      ['Vitrine viandes hachées', 'display', 0, 2],
      ['Congélateur', 'freezer'],
      ['Rôtissoire / maintien au chaud', 'hot_holding'],
    ],
    cleaning: [
      ['Laboratoire', 'Billots et plans de découpe', DETERGENT_DESINFECTANT, 'Gratter, laver, désinfecter, rincer', D],
      ['Laboratoire', 'Hachoir', DETERGENT_DESINFECTANT, 'Démonter entièrement, laver, désinfecter, sécher', U],
      ['Laboratoire', 'Scie à os', DETERGENT_DESINFECTANT, 'Démonter la lame, nettoyer, désinfecter', D],
      ['Laboratoire', 'Trancheuse', DETERGENT_DESINFECTANT, 'Démonter, laver, désinfecter', U],
      ['Laboratoire', 'Couteaux et fusils', DETERGENT_DESINFECTANT, 'Laver, désinfecter (stérilisateur)', U],
      ['Laboratoire', 'Poussoir / cutter', DETERGENT_DESINFECTANT, 'Démonter, laver, désinfecter', U],
      ['Laboratoire', 'Sols et siphons', SOLS, 'Lavage, désinfection des siphons', D],
      ['Magasin', 'Vitrines', DETERGENT_DESINFECTANT, 'Vider, nettoyer, désinfecter', D],
      ['Magasin', 'Rôtissoire', DEGRAISSANT, 'Dégraisser broches et bac', D],
      ['Stockage', 'Chambres froides, crochets et rails', DETERGENT_DESINFECTANT, 'Nettoyer parois, crochets, rails et sol', W],
      ...COMMON_CLEANING,
    ],
    shelfLives: [
      ['Viande hachée à la demande', 'prepared', 0],
      ['Préparation de viande (saucisses, farces...)', 'prepared', 1],
      ['Charcuterie tranchée', 'opened', 3],
      ['Plat cuisiné traiteur', 'prepared', 3],
      ['Viande décongelée', 'defrosted', 3],
    ],
  },

  traiteur: {
    label: 'Traiteur / cuisine centrale',
    description: 'Fabrication à l\'avance, liaison froide ou chaude, livraison',
    equipment: [
      ['Chambre froide positive', 'cold_room'],
      ['Réfrigérateur préparations', 'fridge'],
      ['Congélateur', 'freezer'],
      ['Caisson / véhicule de livraison réfrigéré', 'fridge'],
      ['Étuve / maintien au chaud', 'hot_holding'],
      ['Vitrine', 'display'],
    ],
    cleaning: [
      ['Cuisine', 'Plans de travail', DETERGENT_DESINFECTANT, 'Débarrasser, laver, désinfecter, rincer', D],
      ['Cuisine', 'Cellule de refroidissement', DETERGENT_DESINFECTANT, 'Nettoyer parois, grilles et sonde', D],
      ['Cuisine', 'Fours mixtes', 'Produit de lavage four', 'Cycle de lavage automatique', D],
      ['Cuisine', 'Bacs gastronormes', DETERGENT_DESINFECTANT, 'Lavage en machine', U],
      ['Cuisine', 'Sols', SOLS, 'Balayage humide puis lavage', D],
      ['Cuisine', 'Hotte et filtres', DEGRAISSANT, 'Démonter les filtres, tremper, rincer', W],
      ['Livraison', 'Conteneurs isothermes', DETERGENT_DESINFECTANT, 'Laver, désinfecter, sécher ouverts', U],
      ['Livraison', 'Véhicule de livraison (caisson)', DETERGENT_DESINFECTANT, 'Nettoyer et désinfecter le caisson', W],
      ['Stockage', 'Chambre froide', DETERGENT_DESINFECTANT, 'Nettoyer étagères et sol', W],
      ...COMMON_CLEANING,
    ],
    shelfLives: [
      ['Plat cuisiné en liaison froide', 'prepared', 3],
      ['Entrée froide / salade composée', 'prepared', 2],
      ['Sauce émulsionnée maison', 'prepared', 1],
      ['Produit entamé', 'opened', 3],
      ['Produit décongelé', 'defrosted', 3],
    ],
  },

  food_truck: {
    label: 'Food-truck / vente ambulante',
    description: 'Cuisine mobile, petite capacité de stockage',
    equipment: [
      ['Réfrigérateur', 'fridge'],
      ['Saladette', 'fridge'],
      ['Congélateur', 'freezer'],
      ['Maintien au chaud', 'hot_holding'],
    ],
    cleaning: [
      ['Camion', 'Plans de travail', DETERGENT_DESINFECTANT, 'Laver, désinfecter, rincer', D],
      ['Camion', 'Plancha / grill', DEGRAISSANT, 'Gratter et dégraisser à chaud', D],
      ['Camion', 'Friteuse (filtration)', null, 'Filtrer l\'huile, nettoyer la cuve au changement', D],
      ['Camion', 'Sol du camion', SOLS, 'Lavage', D],
      ['Camion', 'Hotte et filtres', DEGRAISSANT, 'Démonter les filtres, tremper, rincer', W],
      ['Eau', 'Réservoir d\'eau propre', 'Désinfectant réservoir', 'Vidanger, désinfecter, rincer', W],
      ['Eau', 'Bac eaux usées', null, 'Vidanger à un point autorisé, rincer', D],
      ...COMMON_CLEANING,
    ],
    shelfLives: [
      ['Produit entamé', 'opened', 3],
      ['Sauce maison', 'prepared', 1],
      ['Crudités préparées', 'prepared', 1],
      ['Viande marinée', 'prepared', 2],
    ],
  },

  collectivite: {
    label: 'Restauration collective',
    description: 'Cantine scolaire, EHPAD, crèche, restaurant d\'entreprise',
    equipment: [
      ['Chambre froide positive', 'cold_room'],
      ['Chambre froide négative', 'freezer'],
      ['Réfrigérateur légumerie', 'fridge'],
      ['Armoire de liaison froide', 'fridge', 0, 3],
      ['Armoire de maintien en température', 'hot_holding'],
      ['Ligne de self (vitrine)', 'display'],
    ],
    cleaning: [
      ['Cuisine', 'Plans de travail', DETERGENT_DESINFECTANT, 'Débarrasser, laver, désinfecter, rincer', D],
      ['Cuisine', 'Marmites et sauteuses', DEGRAISSANT, 'Laver à chaud, rincer', U],
      ['Cuisine', 'Sols et siphons', SOLS, 'Lavage, désinfection des siphons', D],
      ['Cuisine', 'Hotte et filtres', DEGRAISSANT, 'Démonter les filtres, tremper, rincer', W],
      ['Légumerie', 'Légumerie (bacs, éplucheuse)', DETERGENT_DESINFECTANT, 'Laver, désinfecter, rincer', D],
      ['Distribution', 'Ligne de self', DETERGENT_DESINFECTANT, 'Nettoyer vitrines et bacs', D],
      ['Distribution', 'Chariots de service', DETERGENT_DESINFECTANT, 'Laver, désinfecter', D],
      ['Plonge', 'Lave-vaisselle tunnel', 'Détartrant', 'Vidange, nettoyage des rideaux et filtres', D],
      ['Salle', 'Tables du réfectoire', 'Détergent-désinfectant', 'Nettoyage après chaque service', D],
      ...COMMON_CLEANING,
    ],
    shelfLives: [
      ['Plat témoin (à conserver 5 jours)', 'prepared', 5],
      ['Plat en liaison froide', 'prepared', 3],
      ['Produit entamé', 'opened', 3],
      ['Produit décongelé', 'defrosted', 3],
    ],
  },
};

function listTemplates() {
  return Object.entries(TEMPLATES).map(([key, t]) => ({
    key,
    label: t.label,
    description: t.description,
    counts: { equipment: t.equipment.length, cleaning: t.cleaning.length, shelfLives: t.shelfLives.length },
  }));
}

/**
 * Ajoute le contenu d'un modèle à un établissement. Les éléments déjà
 * présents (même nom, actifs) sont ignorés : on peut réappliquer sans doublon.
 */
function applyTemplate(db, orgId, key) {
  const t = TEMPLATES[key];
  if (!t) throw Object.assign(new Error('Modèle inconnu'), { status: 400 });
  const counts = { equipment: 0, cleaning: 0, shelfLives: 0 };
  const has = (table, col, value, extra = '') => !!db
    .prepare(`SELECT 1 FROM ${table} WHERE org_id = ? AND active = 1 AND lower(${col}) = lower(?) ${extra}`)
    .get(orgId, value);
  db.transaction(() => {
    const eq = db.prepare('INSERT INTO equipment (org_id, name, type, min_temp, max_temp) VALUES (?,?,?,?,?)');
    for (const [name, type, min, max] of t.equipment) {
      if (has('equipment', 'name', name)) continue;
      const def = rules.EQUIPMENT_TYPES[type];
      eq.run(orgId, name, type, min ?? def.min, max ?? def.max);
      counts.equipment++;
    }
    const task = db.prepare('INSERT INTO cleaning_tasks (org_id, zone, name, product, method, frequency) VALUES (?,?,?,?,?,?)');
    for (const [zone, name, product, method, freq] of t.cleaning) {
      if (has('cleaning_tasks', 'name', name)) continue;
      task.run(orgId, zone, name, product, method, freq);
      counts.cleaning++;
    }
    const sl = db.prepare('INSERT INTO shelf_life_presets (org_id, product, kind, days) VALUES (?,?,?,?)');
    for (const [product, kind, days] of t.shelfLives) {
      if (has('shelf_life_presets', 'product', product)) continue;
      sl.run(orgId, product, kind, days);
      counts.shelfLives++;
    }
    db.prepare('UPDATE organizations SET activity = COALESCE(activity, ?) WHERE id = ?').run(t.label, orgId);
  })();
  return counts;
}

module.exports = { TEMPLATES, listTemplates, applyTemplate };
