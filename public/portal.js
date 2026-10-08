// Portail prestataire : pilotage de tous les clients (création, e-mails, accès, historique, SAV).
// Page à part, avec sa propre connexion : les clients n'y ont aucun accès.

import {
  app, esc, fmtDT, fmtD, plural, ago, fieldHtml, bindForm, tableHtml, modal, toast, readForm, ROLES,
} from './core.js';
import { ico } from './icons.js';

const P = { token: localStorage.getItem('portalToken'), operator: null, billingEnabled: false };

// ---------------------------------------------------------------- appels API

async function papi(path, { method = 'GET', body, raw } = {}) {
  const res = await fetch(`/api/portal${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(P.token ? { Authorization: `Bearer ${P.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && P.token && !path.startsWith('/login')) { logout(); throw new Error('Session expirée'); }
  if (raw) { if (!res.ok) throw new Error('Téléchargement impossible'); return res; }
  const data = res.status === 204 ? null : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || 'Erreur');
  return data;
}

async function download(path, filename) {
  try {
    const res = await papi(path, { raw: true });
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { toast(e.message, true); }
}

function logout() {
  P.token = null;
  P.operator = null;
  localStorage.removeItem('portalToken');
  route();
}

// ---------------------------------------------------------------- libellés

const TIMEZONES = [
  ['Europe/Paris', 'France métropolitaine'], ['Indian/Reunion', 'La Réunion'], ['Indian/Mayotte', 'Mayotte'],
  ['America/Martinique', 'Martinique'], ['America/Guadeloupe', 'Guadeloupe'], ['America/Cayenne', 'Guyane'],
  ['Pacific/Noumea', 'Nouvelle-Calédonie'], ['Pacific/Tahiti', 'Polynésie française'],
  ['Europe/Brussels', 'Belgique'], ['Europe/Zurich', 'Suisse'], ['Europe/Luxembourg', 'Luxembourg'], ['America/Toronto', 'Québec'],
];

/** [classe de pastille, libellé] d'un état d'accès. */
function accessPill(a) {
  switch (a.state) {
    case 'suspended': return ['bad', 'Suspendu'];
    case 'expired': return ['bad', 'Essai terminé'];
    case 'trial': return [a.trialDaysLeft <= 7 ? 'warn' : 'info', `Essai · ${a.trialDaysLeft} j`];
    case 'active': return ['ok', a.managed ? 'Actif' : 'Abonné'];
    case 'past_due': return ['warn', 'Paiement en échec'];
    default: return ['info', 'Accès libre'];
  }
}

// Ce que fait un client : entité du journal d'audit → [nom, registre ?]
const ENTITY = {
  temperature_logs: ['un relevé de température', true], cleaning_logs: ['un nettoyage', true], receptions: ['une réception', true],
  process_logs: ['un refroidissement ou une remise en température', true], oil_checks: ['un contrôle d\'huile', true],
  labels: ['une étiquette DLC', true], pest_controls: ['un contrôle nuisibles', true], photos: ['une photo', true],
  non_conformities: ['une non-conformité', true], equipment: ['un équipement', false], cleaning_tasks: ['une tâche de nettoyage', false],
  suppliers: ['un fournisseur', false], trainings: ['une formation', false], recipes: ['un plat', false], shelf_life_presets: ['une durée de vie', false],
  organizations: ['les CGV', false],
};
function eventText(e) {
  if (e.action === 'login') return 's\'est connecté(e)';
  if (e.action === 'accept_terms') return 'a accepté les CGV';
  const [noun, register] = ENTITY[e.entity] || [e.entity, true];
  if (e.action === 'create') return `${register ? 'a enregistré' : 'a ajouté'} ${noun}`;
  if (e.action === 'update') return `a modifié ${noun}`;
  if (e.action === 'delete') return `a supprimé ${noun}`;
  return `${e.action} : ${noun}`;
}

const OPLOG = {
  org_create: 'Client créé', org_update: 'Informations modifiées', org_delete: 'Client supprimé', access_trial: 'Essai', access_active: 'Accès actif',
  access_billing: 'Paiement en ligne', access_suspend: 'Accès suspendu', access_resume: 'Accès rétabli', user_create: 'Utilisateur ajouté', user_update: 'Utilisateur modifié',
  user_invite: 'Lien de connexion envoyé', note_add: 'Note ajoutée', operator_create: 'Opérateur ajouté', operator_update: 'Opérateur modifié',
};

const dash = (v) => (v == null || v === '' ? '—' : v);
const when = (iso, empty = 'jamais') => (iso ? ago(iso) : empty);
const initial = (name) => (String(name || '?').trim().charAt(0) || '?').toUpperCase();

// ---------------------------------------------------------------- briques

function shell({ tab, back } = {}) {
  app.innerHTML = `<div class="shell">
    <header class="appbar no-print">
      ${back ? `<a class="back" href="${back.href}">${ico('arrow_back')}<span>${esc(back.label)}</span></a>`
        : `<span class="brand"><img src="/icon.svg" alt="" width="32" height="32"><b>Portail prestataire</b></span>`}
      <span class="spacer"></span>
      <a class="avatar" href="#/account" title="${esc(P.operator?.name || '')}" aria-label="Mon compte">${esc(initial(P.operator?.name))}</a>
    </header>
    <div class="content"><div data-main></div></div>
    <nav class="tabbar n3 no-print" aria-label="Navigation du portail">${[
    ['clients', 'domain', 'Clients'], ['activity', 'history', 'Activité'], ['account', 'admin_panel_settings', 'Compte'],
  ].map(([key, icon, label]) => `<a href="#/${key}" class="tab${key === tab ? ' active' : ''}"${key === tab ? ' aria-current="page"' : ''}>
      <span class="tab-ind">${ico(icon)}</span><span class="tab-label">${esc(label)}</span></a>`).join('')}</nav>
  </div>`;
  return app.querySelector('[data-main]');
}

/** Bloc « lien d'invitation » : copiable, avec l'état de l'envoi par e-mail. */
function inviteHtml(inv, email) {
  const status = inv.emailed ? `Invitation envoyée à <b>${esc(email)}</b>.`
    : inv.error ? `L'e-mail n'a pas pu partir (${esc(inv.error)}). Transmettez le lien ci-dessous à <b>${esc(email)}</b>.`
      : inv.mailConfigured ? `Aucun e-mail envoyé. Transmettez le lien ci-dessous à <b>${esc(email)}</b>.`
        : `L'envoi d'e-mails n'est pas configuré sur ce serveur : transmettez le lien ci-dessous à <b>${esc(email)}</b>.`;
  return `<div class="invite-box"><p>${status}</p>
    <div class="copy-row"><input readonly value="${esc(inv.url)}" aria-label="Lien d'invitation" data-link><button type="button" class="tonal" data-copy>${ico('content_copy')}Copier</button></div>
    <small>Le lien est valable 7 jours et ne peut servir qu'une fois : la personne y choisit son mot de passe.</small></div>`;
}
function bindCopy(root) {
  root.querySelector('[data-copy]')?.addEventListener('click', async () => {
    const input = root.querySelector('[data-link]');
    try { await navigator.clipboard.writeText(input.value); } catch { input.select(); document.execCommand?.('copy'); }
    toast('Lien copié');
  });
}

const kpi = (value, label, tone = '') => `<div class="kpi"><div class="v"${tone ? ` style="color:var(--${tone})"` : ''}>${value}</div><div class="l">${esc(label)}</div></div>`;

// ---------------------------------------------------------------- connexion

function loginPage() {
  const fields = [
    { name: 'email', label: 'E-mail', type: 'email', required: true, full: true },
    { name: 'password', label: 'Mot de passe', type: 'password', required: true, full: true },
  ];
  app.innerHTML = `<div class="auth"><div class="card">
    <h1><img src="/icon.svg" width="32" height="32" alt=""> Portail prestataire</h1>
    <p class="muted">Accès réservé à l'équipe qui gère les clients.</p><div data-form></div></div></div>`;
  const box = app.querySelector('[data-form]');
  box.innerHTML = `<form class="form">${fields.map((f) => fieldHtml(f)).join('')}<div class="submit"><button type="submit" class="big">Se connecter</button></div></form>`;
  bindForm(box, fields, async (data) => {
    const res = await papi('/login', { method: 'POST', body: data });
    P.token = res.token;
    localStorage.setItem('portalToken', res.token);
    location.hash = '#/clients';
    route();
  });
}

// ---------------------------------------------------------------- liste des clients

async function clientsPage(main) {
  const { orgs } = await papi('/orgs');
  const DAY = 86400000;
  const quiet = (o) => !o.access.readOnly && Date.parse(o.created_at) < Date.now() - 3 * DAY
    && (!o.last_activity || Date.parse(o.last_activity) < Date.now() - 3 * DAY);
  const blocked = (o) => o.access.state === 'suspended' || o.access.state === 'expired';
  const FILTERS = [
    ['all', 'Tous', () => true], ['alerts', 'Alertes ouvertes', (o) => o.open_nc > 0], ['quiet', 'Sans saisie depuis 3 jours', quiet],
    ['trial', 'En essai', (o) => o.access.state === 'trial'], ['blocked', 'Suspendus ou expirés', blocked],
  ];
  let filter = 'all';
  let q = '';

  main.innerHTML = `<div class="page-head"><h1>Clients</h1><a class="btn" href="#/clients/new">${ico('add')}Nouveau client</a></div>
    <div class="kpis compact">
      ${kpi(orgs.length, 'Clients')}
      ${kpi(orgs.filter((o) => ['active', 'unlimited'].includes(o.access.state)).length, 'Actifs')}
      ${kpi(orgs.filter((o) => o.access.state === 'trial').length, 'En essai')}
      ${kpi(orgs.filter(blocked).length, 'Suspendus ou expirés', orgs.some(blocked) ? 'error' : '')}
      ${kpi(orgs.reduce((n, o) => n + o.open_nc, 0), 'Alertes ouvertes', orgs.some((o) => o.open_nc) ? 'error' : '')}
      ${kpi(orgs.filter(quiet).length, 'Sans saisie depuis 3 jours', orgs.some(quiet) ? 'warning' : '')}
    </div>
    <input type="search" class="search" data-q placeholder="Rechercher un client, un groupe ou une adresse e-mail" aria-label="Rechercher un client" autocomplete="off">
    <div class="chips" data-filters>${FILTERS.map(([key, label]) => `<button type="button" class="chip" data-f="${key}" aria-pressed="${key === filter}">${esc(label)}</button>`).join('')}</div>
    <div data-list></div>`;

  const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const draw = () => {
    const test = FILTERS.find((f) => f[0] === filter)[2];
    const term = norm(q);
    const rows = orgs.filter((o) => test(o) && (!term || [o.name, o.group_name, o.admin_email, o.activity].some((v) => norm(v).includes(term))));
    main.querySelector('[data-list]').innerHTML = rows.length ? `<div class="seg wide">${rows.map((o) => {
      const [tone, label] = accessPill(o.access);
      const sub = [o.group_name, o.activity, plural(o.users, 'utilisateur', 'utilisateurs')].filter(Boolean).join(' · ');
      return `<a class="seg-item" href="#/clients/${o.id}"><span class="seg-lead">${ico('storefront')}</span>
        <span class="seg-text"><strong>${esc(o.name)}</strong><small>${esc(sub)}</small>
          <span class="seg-meta"><span class="pill ${tone}">${esc(label)}</span>
            ${o.open_nc ? `<span class="pill bad">${plural(o.open_nc, 'alerte', 'alertes')}</span>` : ''}
            <span class="pill info">${o.last_activity ? `Dernière saisie ${esc(ago(o.last_activity))}` : 'Aucune saisie'}</span></span></span>${ico('chevron_right')}</a>`;
    }).join('')}</div>` : `<div class="empty"><span class="empty-ico">${ico('domain')}</span><h2>${orgs.length ? 'Aucun client ne correspond' : 'Aucun client pour l\'instant'}</h2>
      <p>${orgs.length ? 'Essayez un autre filtre ou une autre recherche.' : 'Créez votre premier client : il recevra une invitation par e-mail.'}</p>
      ${orgs.length ? '' : `<a class="btn" href="#/clients/new">${ico('add')}Nouveau client</a>`}</div>`;
  };
  main.querySelector('[data-q]').addEventListener('input', (e) => { q = e.target.value; draw(); });
  main.querySelector('[data-filters]').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-f]');
    if (!chip) return;
    filter = chip.dataset.f;
    main.querySelectorAll('[data-f]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.f === filter)));
    draw();
  });
  draw();
}

// ---------------------------------------------------------------- nouveau client

async function newClientPage(main) {
  const [templates, { groups }] = await Promise.all([papi('/templates'), papi('/orgs')]);
  const orgFields = [
    { name: 'name', label: 'Nom de l\'établissement', required: true, full: true },
    { name: 'group_name', label: 'Client ou groupe (si plusieurs sites)', placeholder: 'Ex. Famille Dupain' },
    { name: 'activity', label: 'Activité', placeholder: 'Ex. Boulangerie-pâtisserie' },
    { name: 'siret', label: 'SIRET' },
    { name: 'timezone', label: 'Fuseau horaire', type: 'select', required: true, default: 'Europe/Paris', options: TIMEZONES },
    { name: 'address', label: 'Adresse', full: true },
    { name: 'template', label: 'Modèle de métier (préremplit équipements, nettoyage et durées de vie)', type: 'select', full: true, default: 'restaurant', emptyLabel: 'Aucun : partir de zéro', options: templates.map((t) => [t.key, t.label]) },
  ];
  const accessFields = [
    {
      name: 'mode', label: 'Accès', type: 'select', required: true, default: 'trial',
      options: [['trial', 'Essai gratuit (puis lecture seule)'], ['active', 'Actif (facturé par vos soins)'], ...(P.billingEnabled ? [['auto', 'Paiement en ligne (Stripe) après l\'essai']] : [])],
    },
    { name: 'trial_days', label: 'Durée de l\'essai (jours)', type: 'number', step: '1', min: 1, default: 30 },
  ];
  const adminFields = [
    { name: 'admin_name', label: 'Nom de l\'administrateur', required: true },
    { name: 'admin_email', label: 'Adresse e-mail de l\'administrateur', type: 'email', required: true },
    { name: 'send_invitation', label: 'Envoyer l\'invitation par e-mail maintenant', type: 'checkbox', default: true, full: true },
  ];
  const fields = [...orgFields, ...accessFields, ...adminFields];
  main.innerHTML = `<h1>Nouveau client</h1>
    <p class="lead">Vous créez l'établissement et son administrateur. Celui-ci reçoit un lien pour choisir son mot de passe ; il pourra ensuite ajouter son équipe.</p>
    <div class="card" data-box><form class="form">
      <h2 class="full">Établissement</h2>${orgFields.map((f) => fieldHtml(f)).join('')}
      <h2 class="full">Accès</h2>${accessFields.map((f) => fieldHtml(f)).join('')}
      <h2 class="full">Administrateur du client</h2>${adminFields.map((f) => fieldHtml(f)).join('')}
      <div class="submit"><button type="submit" class="big">Créer le client</button></div></form>
      <datalist id="groups">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist></div>`;
  const box = main.querySelector('[data-box]');
  const form = box.querySelector('form');
  form.elements.group_name.setAttribute('list', 'groups');
  const trialLabel = form.elements.trial_days.closest('label');
  form.elements.mode.addEventListener('change', () => { trialLabel.hidden = form.elements.mode.value === 'active'; });
  bindForm(box, fields, async (d) => {
    const body = {
      name: d.name, group_name: d.group_name, activity: d.activity, siret: d.siret, timezone: d.timezone, address: d.address, template: d.template || null,
      mode: d.mode, trial_days: Number(d.trial_days) || 30, admin: { name: d.admin_name, email: d.admin_email }, send_invitation: d.send_invitation,
    };
    const r = await papi('/orgs', { method: 'POST', body });
    main.innerHTML = `<h1>Client créé</h1>
      <div class="card"><h2>${esc(r.org.name)}</h2>
        <p>L'administrateur <b>${esc(r.admin.name)}</b> (${esc(r.admin.email)}) est rattaché à cet établissement.</p>${inviteHtml(r.invitation, r.admin.email)}
        <div class="row" style="margin-top:16px"><a class="btn" href="#/clients/${r.org.id}">Ouvrir la fiche du client</a><a class="btn secondary" href="#/clients/new">Créer un autre client</a></div></div>`;
    bindCopy(main);
  });
}

// ---------------------------------------------------------------- fiche d'un client

const TABS = [['summary', 'Résumé'], ['users', 'Utilisateurs'], ['activity', 'Activité'], ['registers', 'Registres'], ['notes', 'Notes SAV']];

async function clientPage(main, id, tab = 'summary') {
  let d = await papi(`/orgs/${id}`);
  const [tone, label] = accessPill(d.access);
  const reload = () => clientPage(main, id, tab);

  main.innerHTML = `<div class="page-head"><div><h1>${esc(d.name)}</h1>
      <p class="muted" style="margin:0">${esc([d.group_name, d.activity].filter(Boolean).join(' · ') || 'Établissement')}</p></div>
      <div class="row"><span class="pill ${tone}">${esc(label)}</span>
        <button type="button" class="secondary small" data-edit>${ico('edit')}Modifier</button>
        <button type="button" class="secondary small" data-pdf>${ico('download')}Classeur PDF</button></div></div>
    <div class="subtabs" role="tablist">${TABS.map(([key, name]) => `<a class="subtab${key === tab ? ' active' : ''}" role="tab" aria-selected="${key === tab}" href="#/clients/${id}/${key}">${esc(name)}</a>`).join('')}</div>
    <div data-tab></div>`;
  const pane = main.querySelector('[data-tab]');

  main.querySelector('[data-edit]').onclick = () => editClient(d, reload);
  main.querySelector('[data-pdf]').onclick = () => pdfDialog(d);
  const tabs = { summary: summaryTab, users: usersTab, activity: activityTab, registers: registersTab, notes: notesTab };
  await (tabs[tab] || summaryTab)(pane, d, reload);
}

function editClient(d, done) {
  const fields = [
    { name: 'name', label: 'Nom de l\'établissement', required: true, full: true },
    { name: 'group_name', label: 'Client ou groupe' },
    { name: 'activity', label: 'Activité' },
    { name: 'siret', label: 'SIRET' },
    { name: 'timezone', label: 'Fuseau horaire', type: 'select', required: true, options: TIMEZONES },
    { name: 'address', label: 'Adresse', full: true },
  ];
  const dlg = modal('Modifier le client', `<form class="form">${fields.map((f) => fieldHtml(f, d[f.name])).join('')}<div class="submit"><button type="submit" class="big">Enregistrer</button></div></form>`);
  bindForm(dlg, fields, async (data) => {
    await papi(`/orgs/${d.id}`, { method: 'PUT', body: data });
    dlg.close(); toast('Client modifié'); done();
  });
}

function pdfDialog(d) {
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const dlg = modal('Classeur HACCP du client', `<p class="muted">Le même document que celui du client, pour la période choisie (registres et photos).</p>
    <form class="form"><label>Du<input type="date" name="from" value="${from}" required></label><label>Au<input type="date" name="to" value="${today}" required></label>
    <div class="submit"><button type="submit" class="big">${ico('download')}Télécharger le PDF</button></div></form>`);
  dlg.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target.elements;
    download(`/orgs/${d.id}/reports/haccp.pdf?from=${f.from.value}&to=${f.to.value}`, `classeur-${d.name.replace(/[^\w]+/g, '-')}.pdf`);
    dlg.close();
  });
}

// ---- Résumé : indicateurs, accès, informations

async function summaryTab(pane, d, reload) {
  const c = d.stats.compliance;
  const pct = (s) => (s.total ? `${Math.round((100 * s.ok) / s.total)} %` : '—');
  const a = d.access;
  const accessText = {
    suspended: 'Accès suspendu : le client voit ses registres mais ne peut plus rien saisir.',
    expired: `Essai terminé${d.trial_ends_at ? ` le ${fmtD(d.trial_ends_at)}` : ''} : le client est en lecture seule.`,
    trial: `Essai en cours jusqu'au ${fmtD(a.trialEndsAt)} (${plural(a.trialDaysLeft, 'jour restant', 'jours restants')}).`,
    active: a.managed ? 'Actif : facturation gérée par vos soins, sans limite de date.' : `Abonnement ${a.plan || ''} actif.`,
    unlimited: 'Accès libre (ancien mode, sans pilotage). Choisissez un essai ou un accès actif pour le piloter.',
    past_due: 'Paiement en échec côté Stripe.',
  }[a.state] || '';
  pane.innerHTML = `<div class="kpis compact">
      ${kpi(d.last_activity ? esc(ago(d.last_activity)) : '—', 'Dernière saisie')}
      ${kpi(d.last_login ? esc(ago(d.last_login)) : '—', 'Dernière connexion')}
      ${kpi(d.stats.records_30d, 'Saisies sur 30 jours')}
      ${kpi(pct(c.temperatures), 'Conformité températures (30 j)')}
      ${kpi(d.open_nc, 'Alertes ouvertes', d.open_nc ? 'error' : '')}
      ${kpi(d.users, 'Utilisateurs actifs')}
      ${kpi(d.stats.devices, 'Tablettes de cuisine')}
      ${kpi(d.stats.equipment, 'Équipements suivis')}
    </div>
    <div class="card"><h2>Accès</h2><p>${esc(accessText)}</p>
      <div class="row">
        ${a.state === 'suspended' ? `<button type="button" data-act="resume">${ico('play_circle')}Rétablir l'accès</button>`
    : `<button type="button" class="secondary" data-act="suspend">${ico('pause_circle')}Suspendre l'accès</button>`}
        ${a.state !== 'active' || !a.managed ? `<button type="button" class="tonal" data-act="activate">${ico('verified')}Passer en accès actif</button>` : ''}
        ${P.billingEnabled && d.access_mode !== 'auto' ? `<button type="button" class="secondary" data-act="billing">${ico('credit_card')}Passer au paiement en ligne</button>` : ''}
        <button type="button" class="secondary" data-act="extend">${ico('schedule')}${a.state === 'trial' ? 'Prolonger l\'essai' : 'Remettre en essai'}</button>
      </div></div>
    <div class="card"><h2>Informations</h2><dl class="kv">
      <dt>Administrateur</dt><dd>${esc(dash(d.admin_email))}</dd>
      <dt>SIRET</dt><dd>${esc(dash(d.siret))}</dd>
      <dt>Adresse</dt><dd>${esc(dash(d.address))}</dd>
      <dt>Fuseau horaire</dt><dd>${esc(dash(TIMEZONES.find((t) => t[0] === d.timezone)?.[1] || d.timezone))}</dd>
      <dt>Créé le</dt><dd>${esc(fmtD(d.created_at))}${d.created_by ? ` par ${esc(d.created_by)}` : ''}</dd>
      <dt>CGV</dt><dd>${d.terms_accepted_at ? `acceptées le ${esc(fmtD(d.terms_accepted_at))}` : 'pas encore acceptées (à la première connexion)'}</dd></dl></div>
    <div class="card danger-zone"><h2>Zone sensible</h2><p class="muted">La suppression efface définitivement l'établissement, ses utilisateurs, ses registres et ses photos. Pensez à exporter son classeur avant.</p>
      <button type="button" class="danger" data-delete>${ico('delete')}Supprimer ce client</button></div>`;

  const act = async (body, message) => { try { await papi(`/orgs/${d.id}/access`, { method: 'POST', body }); toast(message); reload(); } catch (e) { toast(e.message, true); } };
  pane.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = () => {
      const kind = b.dataset.act;
      if (kind === 'suspend') { if (confirm('Suspendre l\'accès ? Le client passera en lecture seule immédiatement.')) act({ action: 'suspend' }, 'Accès suspendu'); }
      else if (kind === 'resume') act({ action: 'resume' }, 'Accès rétabli');
      else if (kind === 'activate') act({ action: 'activate' }, 'Accès actif');
      else if (kind === 'billing') act({ action: 'billing' }, 'Paiement en ligne activé');
      else {
        const dlg = modal('Essai', `<form class="form"><label class="full">Nombre de jours à ajouter<input type="number" name="days" min="1" max="365" value="14" required></label>
          <div class="submit"><button type="submit" class="big">Valider</button></div></form>`);
        dlg.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); const days = Number(e.target.elements.days.value); dlg.close(); act({ action: 'extend_trial', days }, `Essai prolongé de ${plural(days, 'jour', 'jours')}`); });
      }
    };
  });
  pane.querySelector('[data-delete]').onclick = () => {
    const dlg = modal('Supprimer le client', `<p class="banner bad">${ico('warning', { fill: true })}<span>Action <b>irréversible</b> : « ${esc(d.name)} », ses utilisateurs, ses registres et ses photos seront effacés.</span></p>
      <form class="form"><label class="full">Saisissez le nom du client pour confirmer<input name="confirm" required autocomplete="off"></label>
      <label class="full">Votre mot de passe<input type="password" name="password" required autocomplete="current-password"></label>
      <div class="submit"><button type="submit" class="danger solid big">Supprimer définitivement</button></div></form>`);
    bindForm(dlg, [{ name: 'confirm' }, { name: 'password' }], async (data) => {
      await papi(`/orgs/${d.id}/delete`, { method: 'POST', body: data });
      dlg.close(); toast('Client supprimé'); location.hash = '#/clients';
    });
  };
}

// ---- Utilisateurs et adresses e-mail

async function usersTab(pane, d, reload) {
  const users = await papi(`/orgs/${d.id}/users`);
  pane.innerHTML = `<div class="actions-top"><button type="button" data-add>${ico('person_add')}Ajouter un utilisateur</button></div>
    <p class="muted">Les adresses e-mail rattachées à ce client : chacune reçoit un lien pour choisir son mot de passe. Les employés « code PIN seul » sont créés par l'administrateur du client.</p>
    <div class="seg wide">${users.map((u) => `<button type="button" class="seg-item" data-u="${u.id}"><span class="seg-lead">${ico(u.role === 'admin' ? 'admin_panel_settings' : 'person')}</span>
      <span class="seg-text"><strong>${esc(u.name)}</strong><small>${esc(u.pin_only ? 'Employé · code PIN seul (sans e-mail)' : u.email)}</small>
        <span class="seg-meta"><span class="pill info">${esc(ROLES[u.role])}</span>${u.active ? '' : '<span class="pill bad">Désactivé</span>'}
          <span class="pill ${u.last_login ? 'ok' : 'warn'}">${u.last_login ? `Connecté ${esc(ago(u.last_login))}` : 'Jamais connecté'}</span></span></span>${ico('chevron_right')}</button>`).join('')}</div>`;

  const roleOptions = Object.entries(ROLES);
  pane.querySelector('[data-add]').onclick = () => {
    const fields = [
      { name: 'name', label: 'Nom', required: true, full: true },
      { name: 'email', label: 'Adresse e-mail', type: 'email', required: true, full: true },
      { name: 'role', label: 'Rôle', type: 'select', required: true, default: 'manager', options: roleOptions, full: true },
    ];
    const dlg = modal('Ajouter un utilisateur', `<form class="form">${fields.map((f) => fieldHtml(f)).join('')}<div class="submit"><button type="submit" class="big">Ajouter et inviter</button></div></form>`);
    bindForm(dlg, fields, async (data) => {
      const r = await papi(`/orgs/${d.id}/users`, { method: 'POST', body: data });
      dlg.querySelector('form').replaceWith(Object.assign(document.createElement('div'), { innerHTML: `<p><b>${esc(r.user.name)}</b> est rattaché(e) à ${esc(d.name)}.</p>${inviteHtml(r.invitation, r.user.email)}<div class="submit" style="margin-top:16px"><button type="button" class="big" data-done>Terminé</button></div>` }));
      bindCopy(dlg);
      dlg.querySelector('[data-done]').onclick = () => { dlg.close(); reload(); };
    });
  };

  pane.querySelectorAll('[data-u]').forEach((b) => {
    b.onclick = () => {
      const u = users.find((x) => x.id === Number(b.dataset.u));
      const fields = [
        { name: 'name', label: 'Nom', required: true, full: true },
        ...(u.pin_only ? [] : [{ name: 'email', label: 'Adresse e-mail', type: 'email', required: true, full: true }]),
        { name: 'role', label: 'Rôle', type: 'select', required: true, options: u.pin_only ? [['employee', ROLES.employee]] : roleOptions, full: true },
        { name: 'active', label: 'Compte actif', type: 'checkbox', full: true },
      ];
      const dlg = modal(u.name, `<form class="form">${fields.map((f) => fieldHtml(f, f.name === 'active' ? !!u.active : u[f.name])).join('')}<div class="submit"><button type="submit" class="big">Enregistrer</button></div></form>
        ${u.pin_only ? '' : `<div data-invite style="margin-top:12px"><button type="button" class="secondary wide" data-send>${ico('send')}Envoyer un nouveau lien de connexion</button></div>`}`);
      bindForm(dlg, fields, async (data) => {
        await papi(`/orgs/${d.id}/users/${u.id}`, { method: 'PUT', body: data });
        dlg.close(); toast('Utilisateur modifié'); reload();
      });
      dlg.querySelector('[data-send]')?.addEventListener('click', async (e) => {
        e.target.disabled = true;
        try {
          const inv = await papi(`/orgs/${d.id}/users/${u.id}/invite`, { method: 'POST', body: {} });
          dlg.querySelector('[data-invite]').innerHTML = inviteHtml(inv, u.email);
          bindCopy(dlg);
        } catch (err) { toast(err.message, true); e.target.disabled = false; }
      });
    };
  });
}

// ---- Activité d'un client (et fil global)

function feedHtml(rows, { withOrg = false } = {}) {
  if (!rows.length) return '<p class="muted">Aucune activité pour l\'instant.</p>';
  return `<ul class="feed">${rows.map((e) => `<li><time datetime="${esc(e.at)}">${esc(fmtDT(e.at))}</time>
    <span><b>${esc(e.user_name || 'Quelqu\'un')}</b> ${esc(eventText(e))}${withOrg && e.org_name ? ` · <a href="#/clients/${e.org_id}/activity">${esc(e.org_name)}</a>` : ''}</span></li>`).join('')}</ul>`;
}

/** Fil d'activité paginé (« Afficher plus »). */
function feedPane(pane, path, opts = {}) {
  let rows = [];
  const draw = (more) => {
    pane.innerHTML = `${feedHtml(rows, opts)}${more ? `<div class="actions-top" style="margin-top:12px"><button type="button" class="secondary" data-more>Afficher plus</button></div>` : ''}`;
    pane.querySelector('[data-more]')?.addEventListener('click', load);
  };
  async function load() {
    const sep = path.includes('?') ? '&' : '?';
    const chunk = await papi(`${path}${sep}limit=60${rows.length ? `&before=${rows.at(-1).id}` : ''}`);
    rows = rows.concat(chunk);
    draw(chunk.length === 60);
  }
  return load();
}

async function activityTab(pane, d) { await feedPane(pane, `/orgs/${d.id}/activity`); }

// ---- Registres (lecture seule)

async function registersTab(pane, d) {
  const regs = await papi(`/orgs/${d.id}/registers`);
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  pane.innerHTML = `<p class="muted">Consultation en lecture seule : le portail ne peut rien modifier dans les registres d'un client.</p>
    <form class="form" data-q><label>Registre<select name="key">${regs.map((r) => `<option value="${esc(r.key)}">${esc(r.title)}</option>`).join('')}</select></label>
      <label>Du<input type="date" name="from" value="${from}"></label><label>Au<input type="date" name="to" value="${today}"></label>
      <div class="submit"><button type="submit">Afficher</button></div></form><div data-out style="margin-top:16px"></div>`;
  const out = pane.querySelector('[data-out]');
  const form = pane.querySelector('[data-q]');
  const load = async () => {
    const f = readForm(form, [{ name: 'key' }, { name: 'from' }, { name: 'to' }]);
    out.innerHTML = '<p class="muted">Chargement…</p>';
    try {
      const r = await papi(`/orgs/${d.id}/registers/${f.key}?from=${f.from}&to=${f.to}`);
      const cols = r.columns.map((label, i) => ({ label, get: (row) => row.cells[i] }));
      out.innerHTML = `<div class="row" style="margin-bottom:8px"><b>${esc(r.title)}</b><span class="muted">${plural(r.total, 'enregistrement', 'enregistrements')}${r.truncated ? ' (les 500 plus récents sont affichés)' : ''}</span><span class="spacer"></span>
          <button type="button" class="secondary small" data-csv>CSV / Excel</button><button type="button" class="secondary small" data-pdf>PDF</button></div>${tableHtml(cols, r.rows, { rowClass: (row) => (row.nc ? 'nc' : '') })}`;
      out.querySelector('[data-csv]').onclick = () => download(`/orgs/${d.id}/reports/${f.key}.csv?from=${f.from}&to=${f.to}`, `${f.key}.csv`);
      out.querySelector('[data-pdf]').onclick = () => download(`/orgs/${d.id}/reports/haccp.pdf?only=${f.key}&from=${f.from}&to=${f.to}`, `${f.key}.pdf`);
    } catch (e) { out.innerHTML = `<p class="pill bad">${esc(e.message)}</p>`; }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); load(); });
  await load();
}

// ---- Notes du SAV et journal du portail

async function notesTab(pane, d) {
  const [notes, log] = await Promise.all([papi(`/orgs/${d.id}/notes`), papi(`/orgs/${d.id}/log`)]);
  pane.innerHTML = `<p class="muted">Notes internes : jamais visibles par le client.</p>
    <form class="form" data-note><label class="full">Nouvelle note<textarea name="text" required maxlength="4000" placeholder="Ex. Appel du 8/10 : la tablette de cuisine est à reconfigurer."></textarea></label>
      <div class="submit"><button type="submit">${ico('add')}Ajouter la note</button></div></form>
    <div class="notes">${notes.length ? notes.map((n) => `<article class="note"><header><b>${esc(n.operator_name || 'Opérateur')}</b><time>${esc(fmtDT(n.created_at))}</time></header><p>${esc(n.text)}</p></article>`).join('') : '<p class="muted">Aucune note.</p>'}</div>
    <details class="block" style="margin-top:24px"><summary>${ico('history')}Actions faites depuis le portail (${log.length})</summary>
      ${log.length ? `<ul class="feed">${log.map((l) => `<li><time>${esc(fmtDT(l.at))}</time><span><b>${esc(l.operator_name || 'Opérateur')}</b> : ${esc(OPLOG[l.action] || l.action)}${l.detail ? ` — ${esc(l.detail)}` : ''}</span></li>`).join('')}</ul>` : '<p class="muted">Rien pour l\'instant.</p>'}</details>`;
  bindForm(pane.querySelector('[data-note]').parentElement, [{ name: 'text' }], async (data, form) => {
    await papi(`/orgs/${d.id}/notes`, { method: 'POST', body: data });
    form.reset(); toast('Note ajoutée');
    await notesTab(pane, d);
  });
}

// ---------------------------------------------------------------- activité de tous les clients

async function activityPage(main) {
  const { orgs } = await papi('/orgs');
  main.innerHTML = `<h1>Activité</h1><p class="lead">Tout ce que font vos clients, du plus récent au plus ancien.</p>
    <label style="max-width:360px;margin-bottom:16px">Client<select data-org><option value="">Tous les clients</option>${orgs.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></label>
    <div data-feed></div>`;
  const select = main.querySelector('[data-org]');
  const load = () => feedPane(main.querySelector('[data-feed]'), `/activity${select.value ? `?org=${select.value}` : ''}`, { withOrg: true });
  select.addEventListener('change', load);
  await load();
}

// ---------------------------------------------------------------- compte et équipe

async function accountPage(main) {
  const team = await papi('/operators');
  const pw = [
    { name: 'current', label: 'Mot de passe actuel', type: 'password', required: true },
    { name: 'password', label: 'Nouveau mot de passe (10 caractères min.)', type: 'password', required: true },
  ];
  main.innerHTML = `<h1>Compte</h1>
    <div class="card"><h2>${esc(P.operator.name)}</h2><p class="muted" style="margin:0">${esc(P.operator.email)}</p></div>
    <div class="card"><h2>Mot de passe</h2><div data-pw><form class="form">${pw.map((f) => fieldHtml(f)).join('')}<div class="submit"><button type="submit">Changer mon mot de passe</button></div></form></div></div>
    <div class="card"><div class="row"><h2>Équipe du portail</h2><span class="spacer"></span><button type="button" class="secondary small" data-add>${ico('person_add')}Ajouter</button></div>
      <p class="muted">Les personnes qui peuvent piloter les clients. Chacune a son propre mot de passe.</p>
      ${tableHtml([
    { label: 'Nom', get: (o) => o.name }, { label: 'E-mail', get: (o) => o.email },
    { label: 'Dernière connexion', get: (o) => when(o.last_login_at) },
    { label: 'Statut', html: (o) => (o.active ? '<span class="pill ok">Actif</span>' : '<span class="pill bad">Désactivé</span>') },
    { label: '', html: (o) => (o.id === P.operator.id ? '' : `<button type="button" class="secondary small" data-toggle="${o.id}" data-active="${o.active}">${o.active ? 'Désactiver' : 'Réactiver'}</button>`) },
  ], team)}</div>
    <button type="button" class="secondary" data-logout>${ico('logout')}Se déconnecter</button>`;

  bindForm(main.querySelector('[data-pw]'), pw, async (data, form) => {
    const r = await papi('/password', { method: 'PUT', body: data });
    P.token = r.token; localStorage.setItem('portalToken', r.token);
    form.reset(); toast('Mot de passe modifié');
  });
  main.querySelectorAll('[data-toggle]').forEach((b) => {
    b.onclick = async () => {
      try { await papi(`/operators/${b.dataset.toggle}`, { method: 'PUT', body: { active: b.dataset.active !== '1' } }); route(); } catch (e) { toast(e.message, true); }
    };
  });
  main.querySelector('[data-add]').onclick = () => {
    const fields = [
      { name: 'name', label: 'Nom', required: true, full: true },
      { name: 'email', label: 'Adresse e-mail', type: 'email', required: true, full: true },
      { name: 'password', label: 'Mot de passe provisoire (10 caractères min.)', type: 'password', required: true, full: true },
    ];
    const dlg = modal('Ajouter un opérateur', `<form class="form">${fields.map((f) => fieldHtml(f)).join('')}<div class="submit"><button type="submit" class="big">Ajouter</button></div></form>`);
    bindForm(dlg, fields, async (data) => { await papi('/operators', { method: 'POST', body: data }); dlg.close(); toast('Opérateur ajouté'); route(); });
  };
  main.querySelector('[data-logout]').onclick = logout;
}

// ---------------------------------------------------------------- routage

async function route() {
  if (!P.token) return loginPage();
  if (!P.operator) {
    try { const me = await papi('/me'); P.operator = me.operator; P.billingEnabled = me.billingEnabled; } catch { return loginPage(); }
  }
  const [key = 'clients', a, b] = (location.hash.slice(2) || 'clients').split('?')[0].split('/');
  let main;
  try {
    if (key === 'clients' && a === 'new') {
      main = shell({ tab: 'clients', back: { href: '#/clients', label: 'Clients' } });
      await newClientPage(main);
    } else if (key === 'clients' && a) {
      main = shell({ tab: 'clients', back: { href: '#/clients', label: 'Clients' } });
      await clientPage(main, Number(a), b);
    } else if (key === 'activity') {
      main = shell({ tab: 'activity' });
      await activityPage(main);
    } else if (key === 'account') {
      main = shell({ tab: 'account' });
      await accountPage(main);
    } else {
      main = shell({ tab: 'clients' });
      await clientsPage(main);
    }
  } catch (e) {
    if (main) main.innerHTML = `<p class="pill bad">${esc(e.message)}</p>`;
  }
}

window.addEventListener('hashchange', route);
route();
