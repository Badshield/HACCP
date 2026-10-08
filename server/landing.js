'use strict';

/**
 * Page d'accueil commerciale (/) et formulaire de demande de démo.
 *
 * La page est générée côté serveur : les prix, la durée d'essai et la liste
 * des métiers viennent directement de la configuration du logiciel, pour ne
 * jamais afficher une offre différente de celle facturée. Elle est lisible
 * sans JavaScript (référencement naturel).
 */

const express = require('express');
const { PLANS, TRIAL_DAYS } = require('./billing');
const { listTemplates } = require('./templates');
const { compose } = require('./mailer');
const { icon } = require('./landing-icons');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FEATURES = [
  ['thermostat', 'Relevés de températures', 'Frigos, chambres froides, congélateurs, vitrines, maintien au chaud : un relevé en deux gestes, alerte immédiate si la température sort des limites.'],
  ['cleaning_services', 'Plan de nettoyage', 'Chaque tâche avec sa zone, son produit et sa fréquence. La liste du jour se coche au fur et à mesure.'],
  ['inventory_2', 'Contrôle à réception', 'Température, emballage, DLC et lot de chaque livraison, avec la photo du bon de livraison.'],
  ['ac_unit', 'Refroidissement et remise en température', 'Durée calculée automatiquement et conformité vérifiée selon les règles du GBPH.'],
  ['label', 'Étiquettes DLC secondaires', 'Produits entamés, fabriqués ou décongelés : la DLC est calculée et l\'étiquette s\'imprime.'],
  ['report', 'Non-conformités', 'Ouvertes automatiquement à chaque anomalie, clôturées avec l\'action corrective. Rien ne passe entre les mailles.'],
  ['no_food', 'Allergènes', 'Le tableau des 14 allergènes de vos plats, prêt à imprimer pour la salle.'],
  ['fact_check', 'Classeur prêt pour le contrôle', 'Tous vos registres et leurs photos dans un PDF propre, pour la période demandée par l\'inspecteur.'],
];

const FAQ = [
  ['Le logiciel est-il conforme à la réglementation ?', 'Il reprend les exigences du règlement (CE) 852/2004, de l\'arrêté du 21 décembre 2009 et des guides de bonnes pratiques d\'hygiène (GBPH) : seuils de température, refroidissement rapide, traçabilité, actions correctives. C\'est un outil qui vous aide à tenir et à prouver vos enregistrements ; votre Plan de Maîtrise Sanitaire reste sous votre responsabilité, et vous pouvez adapter chaque seuil.'],
  ['Faut-il installer quelque chose ?', 'Non. Le logiciel fonctionne dans le navigateur d\'une tablette, d\'un téléphone ou d\'un ordinateur, et s\'ajoute à l\'écran d\'accueil comme une application. Une connexion internet (Wi-Fi ou 4G) est nécessaire pour enregistrer.'],
  ['Mes employés n\'ont pas d\'adresse e-mail : comment font-ils ?', 'Installez une tablette dans la cuisine : chacun touche son nom et tape son code PIN personnel. Chaque relevé est signé par la bonne personne, sans partager de mot de passe.'],
  [`Que se passe-t-il après les ${TRIAL_DAYS} jours d'essai ?`, 'Vous choisissez une offre et payez par carte en ligne. Sans abonnement, votre compte passe en lecture seule : vos registres restent consultables et exportables, rien n\'est perdu.'],
  ['Mes données sont-elles protégées ?', 'Elles sont hébergées dans l\'Union européenne, chiffrées pendant les échanges et strictement séparées de celles des autres clients. Vous pouvez à tout moment tout exporter ou supprimer votre compte.'],
  ['Puis-je arrêter quand je veux ?', 'Oui, l\'abonnement est sans engagement et se résilie en un clic depuis votre espace.'],
];

function page({ appName, plans, templates, trialDays, contactEmail, company }) {
  const year = new Date().getFullYear();
  const minPrice = Math.min(...plans.map((p) => p.price));
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: appName,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web, iOS, Android',
    description: 'Logiciel HACCP pour restaurants et métiers de bouche : relevés de températures, plan de nettoyage, traçabilité, étiquettes DLC, allergènes et classeur PDF pour le contrôle sanitaire.',
    offers: plans.map((p) => ({ '@type': 'Offer', name: p.label, price: String(p.price), priceCurrency: 'EUR' })),
  };
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(appName)} – Logiciel HACCP sur tablette pour restaurants et métiers de bouche</title>
<meta name="description" content="Remplacez le classeur HACCP papier : relevés de températures, plan de nettoyage, traçabilité, étiquettes DLC et allergènes sur tablette. Alertes en cas d'oubli, classeur PDF prêt pour le contrôle. Essai gratuit ${trialDays} jours.">
<meta property="og:title" content="${esc(appName)} – Votre classeur HACCP sur tablette">
<meta property="og:description" content="Relevés, nettoyage, traçabilité et classeur PDF pour le contrôle sanitaire. Essai gratuit ${trialDays} jours, sans carte bancaire.">
<meta property="og:type" content="website">
<meta name="theme-color" content="#f4fbf8">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/roboto-flex-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/landing.css">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
</head>
<body>
<header class="nav"><div class="wrap">
  <a class="logo" href="/"><img src="/icon.svg" alt="" width="30" height="30"> ${esc(appName)}</a>
  <nav><a href="#fonctionnalites">Fonctionnalités</a><a href="#tarifs">Tarifs</a><a href="#faq">Questions</a></nav>
  <div class="nav-cta"><a href="/app#/login" class="link">Se connecter</a><a href="/app#/signup" class="btn small">Essai gratuit</a></div>
</div></header>

<main>
<section class="hero"><div class="wrap hero-grid">
  <div>
    <p class="eyebrow">Logiciel HACCP pour les métiers de bouche</p>
    <h1>Votre classeur HACCP sur tablette, prêt pour le contrôle sanitaire.</h1>
    <p class="lead">Relevés de températures, plan de nettoyage, réceptions, étiquettes DLC, allergènes : votre équipe saisit en quelques secondes, vous êtes prévenu en cas d'oubli, et le classeur PDF s'édite en un clic le jour du contrôle.</p>
    <div class="cta-row"><a href="/app#/signup" class="btn">Essayer gratuitement ${trialDays} jours</a><a href="#demo" class="btn ghost">Demander une démo</a></div>
    <p class="fine">Sans carte bancaire · Sans engagement · À partir de ${minPrice} € HT/mois</p>
  </div>
  <div class="device" aria-hidden="true">
    <div class="screen">
      <div class="s-head">${icon('thermostat')}Relevés du matin</div>
      <div class="s-card ok"><span>Chambre froide positive</span><b>2,4 °C</b><i>${icon('check')}</i></div>
      <div class="s-card ok"><span>Congélateur réserve</span><b>-19,8 °C</b><i>${icon('check')}</i></div>
      <div class="s-card bad"><span>Frigo du passe</span><b>6,1 °C</b><i>${icon('priority_high')}</i></div>
      <div class="s-alert">${icon('warning')}<span>Non-conformité ouverte : produits transférés, technicien appelé</span></div>
      <div class="s-card todo"><span>Vitrine desserts</span><b>— °C</b><i>OK</i></div>
    </div>
  </div>
</div></section>

<section class="pains"><div class="wrap grid3">
  <div><h3>${icon('edit_note')}Fini le classeur papier</h3><p>Plus de feuilles tachées, perdues ou remplies en retard. Tout est daté, signé et rangé automatiquement.</p></div>
  <div><h3>${icon('notifications')}Les oublis repérés à temps</h3><p>Un e-mail vous prévient si un relevé n'a pas été fait, et chaque anomalie vous est signalée tout de suite.</p></div>
  <div><h3>${icon('task_alt')}Serein le jour du contrôle</h3><p>Montrez à l'inspecteur un classeur complet, lisible, avec les actions correctives et les photos.</p></div>
</div></section>

<section id="fonctionnalites" class="section"><div class="wrap">
  <h2>Tout votre Plan de Maîtrise Sanitaire au même endroit</h2>
  <div class="features">${FEATURES.map(([i, t, d]) => `<article><div class="ico-box">${icon(i)}</div><h3>${esc(t)}</h3><p>${esc(d)}</p></article>`).join('')}</div>
  <div class="extras">
    <span>${icon('add_a_photo')}Photos depuis le téléphone</span><span>${icon('pin')}Code PIN pour l'équipe</span><span>${icon('notifications')}Rappels par e-mail</span>
    <span>${icon('pest_control')}Nuisibles</span><span>${icon('oil_barrel')}Huiles de friture</span><span>${icon('school')}Formations</span><span>${icon('download')}Export Excel</span>
  </div>
</div></section>

<section class="section alt"><div class="wrap">
  <h2>Opérationnel en 10 minutes</h2>
  <ol class="steps">
    <li><b>Choisissez votre métier</b><span>Équipements, plan de nettoyage et durées de vie sont préremplis : vous n'avez qu'à ajuster.</span></li>
    <li><b>Installez la tablette en cuisine</b><span>Chaque employé se connecte avec son code PIN et saisit ses relevés en quelques secondes.</span></li>
    <li><b>Suivez et prouvez</b><span>Tableau de bord, alertes, récapitulatif du soir, et le classeur PDF prêt pour le contrôle.</span></li>
  </ol>
  <p class="center muted">Modèles disponibles : ${templates.map((t) => esc(t.label)).join(' · ')}</p>
</div></section>

<section id="tarifs" class="section"><div class="wrap">
  <h2>Des tarifs simples, sans engagement</h2>
  <p class="center muted">${trialDays} jours d'essai gratuit avec toutes les fonctionnalités, sans carte bancaire.</p>
  <div class="plans">${plans.map((p, i) => `<div class="plan${i === plans.length - 1 ? ' featured' : ''}">
    ${i === plans.length - 1 ? '<span class="badge">Le plus complet</span>' : ''}
    <h3>${esc(p.label)}</h3><div class="price">${p.price} €<small> HT / mois</small></div>
    <p class="muted">par établissement</p>
    <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
    <a href="/app#/signup" class="btn${i === plans.length - 1 ? '' : ' ghost'}">Commencer l'essai</a></div>`).join('')}</div>
  <p class="center muted small">Plusieurs établissements ou une franchise ? <a href="#demo">Contactez-nous</a> pour un tarif adapté.</p>
</div></section>

<section id="faq" class="section alt"><div class="wrap narrow">
  <h2>Questions fréquentes</h2>
  ${FAQ.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
</div></section>

<section id="demo" class="section"><div class="wrap narrow">
  <h2>Une question ? Une démonstration ?</h2>
  <p class="center muted">Laissez-nous vos coordonnées, nous vous rappelons pour vous montrer le logiciel sur votre activité.</p>
  <form class="lead-form" data-lead>
    <label>Nom *<input name="name" required maxlength="100" autocomplete="name"></label>
    <label>E-mail *<input name="email" type="email" required maxlength="200" autocomplete="email"></label>
    <label>Téléphone<input name="phone" maxlength="30" autocomplete="tel"></label>
    <label>Établissement / activité<input name="business" maxlength="150" placeholder="Ex. boulangerie, 2 boutiques"></label>
    <label class="full">Message<textarea name="message" maxlength="2000" rows="4"></textarea></label>
    <label class="hp" aria-hidden="true">Site web<input name="website" tabindex="-1" autocomplete="off"></label>
    <p class="full fine">Vos coordonnées servent uniquement à vous recontacter. <a href="/legal/confidentialite">Politique de confidentialité</a>.</p>
    <div class="full"><button class="btn" type="submit">Être rappelé</button> <span data-msg role="status"></span></div>
  </form>
  ${contactEmail ? `<p class="center muted">Ou écrivez-nous : <a href="mailto:${esc(contactEmail)}">${esc(contactEmail)}</a></p>` : ''}
</div></section>

<section class="final"><div class="wrap center">
  <h2>Prêt à ranger le classeur papier ?</h2>
  <a href="/app#/signup" class="btn light">Créer mon espace gratuitement</a>
</div></section>
</main>

<footer><div class="wrap foot">
  <span>© ${year} ${esc(company || appName)}</span>
  <nav><a href="/legal/mentions">Mentions légales</a><a href="/legal/cgv">CGV</a><a href="/legal/confidentialite">Confidentialité</a><a href="/app#/login">Connexion</a></nav>
</div></footer>

<script>
document.querySelector('[data-lead]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, msg = f.querySelector('[data-msg]'), btn = f.querySelector('button');
  btn.disabled = true; msg.textContent = 'Envoi…'; msg.className = '';
  try {
    const res = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(f))) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Envoi impossible');
    f.reset(); msg.textContent = 'Merci ! Nous vous recontactons très vite.'; msg.className = 'ok';
  } catch (err) { msg.textContent = err.message; msg.className = 'err'; }
  btn.disabled = false;
});
</script>
</body>
</html>`;
}

function mountLanding(app, db, { mailer, limiter }) {
  const appName = process.env.APP_NAME || 'Pack Hygiène HACCP';
  const contactEmail = process.env.CONTACT_EMAIL || process.env.LEGAL_EMAIL || '';
  let cached;
  app.get('/', (req, res) => {
    cached ??= page({
      appName,
      plans: Object.values(PLANS),
      templates: listTemplates(),
      trialDays: TRIAL_DAYS,
      contactEmail,
      company: process.env.LEGAL_COMPANY,
    });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(cached);
  });

  app.post('/api/leads', express.json({ limit: '20kb' }), limiter, (req, res) => {
    const b = req.body || {};
    // Champ piège invisible : rempli uniquement par les robots. On répond « OK » sans rien enregistrer.
    if (b.website) return res.json({ ok: true });
    const clean = (v, max) => String(v ?? '').trim().slice(0, max);
    const lead = {
      name: clean(b.name, 100), email: clean(b.email, 200), phone: clean(b.phone, 30),
      business: clean(b.business, 150), message: clean(b.message, 2000),
    };
    if (!lead.name || !EMAIL_RE.test(lead.email)) return res.status(400).json({ error: 'Nom et e-mail valides requis' });
    db.prepare('INSERT INTO leads (name, email, phone, business, message, ip) VALUES (?,?,?,?,?,?)')
      .run(lead.name, lead.email, lead.phone, lead.business, lead.message, req.ip);
    if (contactEmail) {
      mailer.send({
        to: contactEmail,
        ...compose({
          subject: `Nouvelle demande de démo : ${lead.name}${lead.business ? ` (${lead.business})` : ''}`,
          blocks: [
            'Un prospect a rempli le formulaire de la page d\'accueil :',
            { list: [`Nom : ${lead.name}`, `E-mail : ${lead.email}`, `Téléphone : ${lead.phone || '—'}`, `Activité : ${lead.business || '—'}`] },
            ...(lead.message ? [{ title: 'Message' }, lead.message] : []),
          ],
        }),
      }).catch((e) => console.error('Notification de prospect non envoyée :', e.message));
    }
    res.status(201).json({ ok: true });
  });
}

module.exports = { mountLanding, FEATURES, FAQ };
