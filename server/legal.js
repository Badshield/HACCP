'use strict';

/**
 * Pages légales publiques : mentions légales, CGV, politique de
 * confidentialité et contrat de sous-traitance (article 28 du RGPD).
 *
 * ⚠ Ce sont des MODÈLES à faire relire par un juriste avant toute
 * commercialisation. Les informations de l'éditeur viennent des variables
 * d'environnement LEGAL_* ; tant qu'elles manquent, la page affiche
 * « [À compléter] » en surbrillance.
 */

const { PLANS, TRIAL_DAYS } = require('./billing');

/** Version des documents contractuels : à changer à chaque modification des CGV. */
const TERMS_VERSION = '2026-10-02';

const VERSION_FR = TERMS_VERSION.split('-').reverse().join('/');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function config(env = process.env) {
  const v = (key, label) => (env[key] ? esc(env[key]) : `<mark>[À compléter : ${label}]</mark>`);
  return {
    product: esc(env.APP_NAME || 'Pack Hygiène HACCP'),
    company: v('LEGAL_COMPANY', 'raison sociale'),
    form: v('LEGAL_FORM', 'forme juridique, ex. SASU ou entreprise individuelle'),
    capital: env.LEGAL_CAPITAL ? `au capital de ${esc(env.LEGAL_CAPITAL)}` : '',
    address: v('LEGAL_ADDRESS', 'adresse du siège'),
    siren: v('LEGAL_SIREN', 'SIREN'),
    rcs: env.LEGAL_RCS ? esc(env.LEGAL_RCS) : '',
    vat: env.LEGAL_VAT ? `N° de TVA intracommunautaire : ${esc(env.LEGAL_VAT)}` : 'TVA non applicable, art. 293 B du CGI <mark>[ou n° de TVA intracommunautaire]</mark>',
    email: v('LEGAL_EMAIL', 'e-mail de contact'),
    phone: v('LEGAL_PHONE', 'téléphone'),
    director: v('LEGAL_DIRECTOR', 'nom du directeur de la publication'),
    dpo: env.LEGAL_DPO_EMAIL ? esc(env.LEGAL_DPO_EMAIL) : v('LEGAL_EMAIL', 'e-mail de contact'),
    court: v('LEGAL_COURT', 'ville du tribunal de commerce compétent'),
    host: v('HOST_NAME', 'nom de l\'hébergeur'),
    hostAddress: v('HOST_ADDRESS', 'adresse de l\'hébergeur'),
    hostPhone: v('HOST_PHONE', 'téléphone de l\'hébergeur'),
    hostLocation: v('HOST_LOCATION', 'pays des serveurs, ex. France'),
    mailProvider: v('MAIL_PROVIDER', 'fournisseur d\'envoi d\'e-mails, ex. Brevo (France)'),
    url: esc((env.APP_URL || '').replace(/\/$/, '')) || '<mark>[À compléter : adresse du site]</mark>',
  };
}

const sections = (list) => list.map(([title, body]) => `<h2>${title}</h2>${body}`).join('\n');

const PAGES = {
  mentions: {
    title: 'Mentions légales',
    render: (c) => sections([
      ['Éditeur', `<p>Le service ${c.product} (${c.url}) est édité par <strong>${c.company}</strong>, ${c.form} ${c.capital},
        dont le siège est situé ${c.address}, immatriculée sous le numéro SIREN ${c.siren} ${c.rcs ? `(${c.rcs})` : ''}.<br>${c.vat}.</p>
        <p>Contact : ${c.email} – ${c.phone}</p>
        <p>Directeur de la publication : ${c.director}.</p>`],
      ['Hébergement', `<p>${c.host}, ${c.hostAddress} – ${c.hostPhone}. Serveurs situés en : ${c.hostLocation}.</p>`],
      ['Propriété intellectuelle', `<p>Le logiciel, son code, son interface, ses textes et sa marque sont la propriété de l'éditeur.
        Toute reproduction sans autorisation est interdite. Les données saisies par les clients restent leur propriété.</p>`],
      ['Données personnelles', '<p>Voir la <a href="/legal/confidentialite">politique de confidentialité</a>.</p>'],
    ]),
  },

  cgv: {
    title: 'Conditions générales de vente et d\'utilisation',
    render: (c) => sections([
      ['1. Objet', `<p>Les présentes conditions générales (les « CGV ») régissent l'accès et l'utilisation du service en ligne
        ${c.product} (le « Service »), logiciel d'aide à la tenue des registres d'hygiène alimentaire (méthode HACCP), proposé par
        ${c.company} (l'« Éditeur ») à des <strong>professionnels</strong> (le « Client »). Le Service n'est pas destiné aux consommateurs.</p>
        <p>L'inscription vaut acceptation sans réserve des CGV dans leur version en vigueur (version du ${VERSION_FR}).</p>`],
      ['2. Inscription et comptes', `<p>Le Client crée un espace pour son établissement et en devient administrateur. Il peut créer des comptes
        pour ses salariés, dont il est responsable. Les identifiants sont personnels et confidentiels ; toute action réalisée avec un compte
        est réputée faite par son titulaire. Le Client prévient sans délai l'Éditeur de toute utilisation non autorisée.</p>`],
      ['3. Essai gratuit', `<p>Chaque nouvel établissement bénéficie d'un essai gratuit de ${TRIAL_DAYS} jours, sans moyen de paiement.
        À son terme, l'accès en saisie nécessite un abonnement payant ; les données restent consultables et exportables.</p>`],
      ['4. Offres et prix', `<p>Les offres disponibles sont :</p><ul>${Object.values(PLANS).map((p) => `<li><strong>${esc(p.label)}</strong> :
        ${p.price} € HT par mois et par établissement${p.maxUsers ? `, ${p.maxUsers} utilisateurs actifs maximum` : ', utilisateurs illimités'}.</li>`).join('')}</ul>
        <p>Les prix s'entendent hors taxes ; la TVA applicable est ajoutée. L'Éditeur peut modifier ses prix pour l'avenir en informant le
        Client au moins 30 jours avant leur application ; le Client peut résilier avant cette date.</p>`],
      ['5. Paiement et facturation', `<p>L'abonnement est payable mensuellement et d'avance, par prélèvement sur le moyen de paiement enregistré
        via notre prestataire de paiement sécurisé Stripe. Les factures sont disponibles dans l'espace « Abonnement ».</p>
        <p>En cas d'échec de paiement, le prélèvement est représenté automatiquement pendant quelques jours. À défaut de régularisation,
        le compte passe en lecture seule. Conformément à l'article L. 441-10 du Code de commerce, tout retard de paiement entraîne de plein
        droit des pénalités au taux de la BCE majoré de 10 points ainsi qu'une indemnité forfaitaire pour frais de recouvrement de 40 €.</p>`],
      ['6. Durée et résiliation', `<p>L'abonnement est sans engagement de durée et se renouvelle chaque mois. Le Client peut le résilier à tout
        moment depuis l'espace « Abonnement » : la résiliation prend effet à la fin de la période payée, sans remboursement prorata temporis.</p>
        <p>L'Éditeur peut suspendre ou résilier l'accès en cas de manquement grave du Client (impayé, usage frauduleux, atteinte à la sécurité),
        après mise en demeure restée sans effet pendant 15 jours, sauf urgence.</p>`],
      ['7. Responsabilité du Client en matière d\'hygiène', `<p>Le Service est un <strong>outil d'aide</strong> à la tenue des enregistrements.
        Il ne remplace ni le Plan de Maîtrise Sanitaire du Client, ni sa responsabilité d'exploitant au titre du règlement (CE) 852/2004.
        Les seuils et durées de vie proposés par défaut sont indicatifs : le Client doit les vérifier et les adapter à son activité.
        Le Client est seul responsable de l'exactitude et de l'exhaustivité des données saisies, ainsi que des décisions prises
        (retrait de produits, actions correctives...). Les rappels par e-mail sont une aide et ne garantissent pas la réalisation des contrôles.</p>`],
      ['8. Disponibilité du Service', `<p>L'Éditeur met en œuvre les moyens raisonnables pour assurer l'accès au Service 24 h/24, sous une
        obligation de moyens. Des interruptions peuvent survenir pour maintenance, si possible annoncées à l'avance, ou en cas d'incident.
        L'Éditeur réalise des sauvegardes régulières des données. Le Client conserve la possibilité d'exporter ses registres à tout moment
        (PDF, CSV) et est invité à le faire périodiquement.</p>`],
      ['9. Données du Client et réversibilité', `<p>Le Client reste propriétaire de ses données. Il peut à tout moment les exporter
        (registres PDF et CSV, export complet au format JSON depuis les Paramètres) et supprimer son compte. Après la fin de l'abonnement,
        les données restent accessibles en lecture seule ; l'Éditeur peut les supprimer après 12 mois sans abonnement, après en avoir
        informé le Client au moins 30 jours à l'avance par e-mail.</p>
        <p>Pour les données personnelles traitées pour le compte du Client, le <a href="/legal/sous-traitance">contrat de sous-traitance</a>
        fait partie intégrante des CGV.</p>`],
      ['10. Limitation de responsabilité', `<p>La responsabilité de l'Éditeur ne peut être engagée qu'en cas de faute prouvée et est limitée
        aux dommages directs. Elle est plafonnée, toutes causes confondues, au montant payé par le Client au titre du Service au cours des
        12 mois précédant le fait générateur. L'Éditeur n'est pas responsable des dommages indirects (perte d'exploitation, de chiffre
        d'affaires, sanction administrative, atteinte à l'image...), ni des conséquences d'une saisie erronée ou omise par le Client.</p>`],
      ['11. Propriété intellectuelle', `<p>L'Éditeur concède au Client, pour la durée de l'abonnement, un droit personnel, non exclusif et
        non cessible d'utiliser le Service pour les besoins de son établissement. Toute copie, revente ou ingénierie inverse est interdite.</p>`],
      ['12. Modification des CGV', `<p>L'Éditeur peut modifier les CGV. Le Client en est informé à sa connexion et doit accepter la nouvelle
        version pour continuer ; à défaut, il peut résilier son abonnement sans frais.</p>`],
      ['13. Droit applicable et litiges', `<p>Les CGV sont soumises au droit français. En cas de litige, les parties recherchent d'abord une
        solution amiable. À défaut, compétence exclusive est attribuée au tribunal de commerce de ${c.court}, y compris en cas de pluralité
        de défendeurs ou d'appel en garantie.</p>`],
    ]),
  },

  confidentialite: {
    title: 'Politique de confidentialité',
    render: (c) => sections([
      ['Qui sommes-nous ?', `<p>${c.company} (${c.address}) édite ${c.product}. Contact pour toute question relative à vos données :
        ${c.dpo}.</p>
        <p>Nous intervenons à deux titres :</p><ul>
        <li>comme <strong>responsable de traitement</strong> pour les données nécessaires à la gestion des comptes clients (inscription,
        facturation, support, e-mails de service) ;</li>
        <li>comme <strong>sous-traitant</strong> de nos clients pour les données qu'ils saisient dans le logiciel (comptes de leurs salariés,
        registres, photos). Ces traitements sont régis par le <a href="/legal/sous-traitance">contrat de sous-traitance</a> ;
        le client est alors responsable de traitement.</li></ul>`],
      ['Données collectées', `<ul>
        <li>Identification : nom, adresse e-mail, nom et adresse de l'établissement, SIRET ;</li>
        <li>Connexion : mot de passe (stocké sous forme chiffrée irréversible), dates de connexion, journal des actions (traçabilité) ;</li>
        <li>Facturation : offre choisie, statut de l'abonnement, factures. Les données de carte bancaire sont collectées directement par
        Stripe ; nous n'y avons jamais accès ;</li>
        <li>Contenu saisi par les clients : relevés, réceptions, photos, non-conformités, noms des opérateurs.</li></ul>`],
      ['Finalités et bases légales', `<table><thead><tr><th>Finalité</th><th>Base légale</th><th>Durée de conservation</th></tr></thead><tbody>
        <tr><td>Fourniture du service, comptes utilisateurs</td><td>Exécution du contrat</td><td>Durée de l'abonnement, puis 12 mois maximum en lecture seule</td></tr>
        <tr><td>Facturation et comptabilité</td><td>Obligation légale</td><td>10 ans (article L. 123-22 du Code de commerce)</td></tr>
        <tr><td>Rappels et alertes par e-mail</td><td>Exécution du contrat (désactivables dans les Paramètres)</td><td>Durée de l'abonnement</td></tr>
        <tr><td>Réinitialisation du mot de passe</td><td>Exécution du contrat</td><td>Lien valable 1 heure</td></tr>
        <tr><td>Réponse aux demandes de contact et de démonstration (formulaire du site)</td><td>Intérêt légitime / mesures précontractuelles</td><td>3 ans après le dernier contact</td></tr>
        <tr><td>Sécurité, prévention de la fraude, journal d'audit</td><td>Intérêt légitime</td><td>Durée de vie du compte</td></tr>
        </tbody></table>`],
      ['Destinataires et sous-traitants', `<p>Vos données ne sont jamais vendues. Elles sont accessibles aux seules personnes habilitées
        de l'Éditeur et à ses prestataires techniques :</p><ul>
        <li>Hébergement : ${c.host} (${c.hostLocation}) ;</li>
        <li>Paiement : Stripe Payments Europe Ltd (Irlande). Stripe peut transférer des données aux États-Unis dans le cadre du Data Privacy
        Framework et de clauses contractuelles types ;</li>
        <li>Envoi des e-mails : ${c.mailProvider}.</li></ul>`],
      ['Sécurité', `<p>Connexions chiffrées (HTTPS), mots de passe hachés (bcrypt), séparation stricte des données entre clients,
        rôles et droits d'accès, limitation des tentatives de connexion, sauvegardes régulières, journal des actions.</p>`],
      ['Cookies', `<p>Le Service n'utilise <strong>aucun cookie publicitaire ni de mesure d'audience</strong>. Seul un jeton de session est
        conservé dans le stockage local de votre navigateur pour vous maintenir connecté : strictement nécessaire au service, il est
        exempté de consentement (article 82 de la loi Informatique et Libertés).</p>`],
      ['Vos droits', `<p>Vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation, de portabilité et d'opposition,
        ainsi que du droit de définir des directives sur le sort de vos données après votre décès. L'administrateur d'un compte peut exporter
        l'intégralité des données et supprimer le compte depuis les Paramètres. Pour toute autre demande : ${c.dpo}. Nous répondons sous un mois.</p>
        <p>Si vous êtes salarié d'un de nos clients, adressez d'abord votre demande à votre employeur, responsable de ces données.</p>
        <p>Vous pouvez introduire une réclamation auprès de la CNIL (www.cnil.fr).</p>`],
    ]),
  },

  'sous-traitance': {
    title: 'Contrat de sous-traitance des données personnelles (article 28 du RGPD)',
    render: (c) => sections([
      ['1. Parties et objet', `<p>Le présent contrat est conclu entre le Client, <strong>responsable de traitement</strong>, et ${c.company},
        <strong>sous-traitant</strong>, en complément des <a href="/legal/cgv">CGV</a>. Il définit les conditions dans lesquelles le
        sous-traitant traite des données personnelles pour le compte du Client dans le cadre du Service ${c.product}.</p>`],
      ['2. Description du traitement', `<ul>
        <li><strong>Nature et finalité</strong> : hébergement et traitement des enregistrements d'hygiène alimentaire du Client (registres
        HACCP, traçabilité, non-conformités), gestion des comptes de ses utilisateurs, envoi de rappels et d'alertes ;</li>
        <li><strong>Personnes concernées</strong> : salariés et intervenants du Client, contacts de ses fournisseurs et prestataires ;</li>
        <li><strong>Données</strong> : nom, adresse e-mail, rôle, actions horodatées (auteur des saisies), coordonnées des fournisseurs,
        photos jointes aux enregistrements. Aucune donnée sensible au sens de l'article 9 du RGPD n'est nécessaire ; le Client s'engage à
        ne pas photographier de personnes et à ne pas saisir de telles données ;</li>
        <li><strong>Durée</strong> : celle des CGV, augmentée de la période de lecture seule éventuelle.</li></ul>`],
      ['3. Obligations du sous-traitant', `<p>Le sous-traitant s'engage à :</p><ul>
        <li>traiter les données uniquement pour la fourniture du Service et sur instruction documentée du Client (les CGV et l'usage du Service
        constituent ces instructions), et l'informer si une instruction lui paraît contraire à la réglementation ;</li>
        <li>garantir la confidentialité des données et veiller à ce que les personnes autorisées à les traiter y soient tenues ;</li>
        <li>mettre en œuvre les mesures de sécurité de l'article 32 du RGPD : chiffrement des échanges, hachage des mots de passe, séparation
        des données entre clients, contrôle d'accès par rôle, journalisation, sauvegardes ;</li>
        <li>aider le Client à répondre aux demandes d'exercice des droits des personnes, notamment grâce aux fonctions d'export et de suppression ;</li>
        <li>notifier au Client toute violation de données personnelles dans les meilleurs délais et au plus tard 48 heures après en avoir
        pris connaissance, avec les informations utiles à sa propre notification à la CNIL ;</li>
        <li>aider le Client à réaliser une analyse d'impact si elle est nécessaire ;</li>
        <li>mettre à disposition les informations nécessaires pour démontrer le respect de ces obligations et permettre des audits, à la
        charge du Client, moyennant un préavis de 30 jours et dans la limite d'un audit par an, sauf violation avérée.</li></ul>`],
      ['4. Sous-traitants ultérieurs', `<p>Le Client autorise le recours aux sous-traitants ultérieurs suivants : ${c.host} (hébergement,
        ${c.hostLocation}) et ${c.mailProvider} (envoi des e-mails). Le sous-traitant informe le Client de tout changement envisagé au moins
        30 jours à l'avance ; le Client peut s'y opposer en résiliant son abonnement. Le sous-traitant impose à ses sous-traitants ultérieurs
        les mêmes obligations de protection des données et reste responsable de leur respect.</p>`],
      ['5. Localisation des données', `<p>Les données sont hébergées dans l'Union européenne. Tout transfert hors de l'Union est encadré
        par les garanties prévues au chapitre V du RGPD.</p>`],
      ['6. Sort des données en fin de contrat', `<p>Le Client peut exporter l'intégralité de ses données à tout moment. À la suppression du
        compte par le Client, ou au plus tard 12 mois après la fin de l'abonnement, le sous-traitant supprime les données et les fichiers
        associés ; les sauvegardes sont écrasées selon leur cycle de rotation (30 jours maximum). Les données de facturation sont conservées
        au titre des obligations légales du sous-traitant.</p>`],
      ['7. Obligations du Client', `<p>Le Client s'engage à fournir les données nécessaires uniquement, à informer ses salariés du traitement
        de leurs données, à veiller au respect du RGPD de son côté et à superviser le traitement.</p>`],
    ]),
  },
};

function layout(title, body) {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="/styles.css"><link rel="icon" href="/icon.svg"></head>
<body><main class="legal">
<p><a href="/">← Accueil</a> · <a href="/app">Accéder à l'application</a></p>
<h1>${esc(title)}</h1>${body}
<hr><p class="muted">Version du ${VERSION_FR} · <a href="/legal/mentions">Mentions légales</a> · <a href="/legal/cgv">CGV</a> ·
<a href="/legal/confidentialite">Confidentialité</a> · <a href="/legal/sous-traitance">Sous-traitance RGPD</a></p>
</main></body></html>`;
}

function mountLegal(app) {
  app.get('/legal/:page', (req, res, next) => {
    const page = PAGES[req.params.page];
    if (!page) return next();
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(layout(page.title, page.render(config())));
  });
}

module.exports = { mountLegal, TERMS_VERSION, PAGES, config };
