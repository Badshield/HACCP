// Pack Hygiène HACCP – application monopage (sans dépendance, sans build).

import {
  hooks, store, state, app, esc, fmtDT, fmtD, localNow, isoDay, conf, can, FREQ, LABEL_KIND, ROLES,
  firstName, plural, fmtTemp, toast, api, download, formHtml, tableHtml, bindForm, modal, refreshBadge,
} from './core.js';
import { attachPhotoInput, bindGalleries, photoCell, openGallery, uploadPhotos } from './photos.js';
import { flash } from './fun.js';
import {
  todayPage, capturePage, alertsPage, morePage, tempCardHtml, bindTempCards, cleanCardHtml, actionSheet,
} from './home.js';

// ---------------------------------------------------------------- pages génériques

/**
 * Page « registre » : un formulaire court, puis l'historique replié.
 * Les enregistrements sont non modifiables (valeur de preuve HACCP).
 *  - bare : page intégrée à une autre (pas de titre)
 *  - transform(data) : adapte les valeurs saisies avant l'envoi
 *  - formSummary : si fourni, le formulaire est replié sous ce libellé (HTML statique)
 *  - ncKind / ncTitle : pilotent la feuille « Qu'avez-vous fait ? » quand l'enregistrement est hors limite
 */
function logPage({
  title, icon = '', intro, endpoint, fields, columns, register, after, query = '', photos,
  bare = false, transform, formSummary, ncKind = 'other', ncTitle,
}) {
  if (photos) columns = [...columns, photoCell(photos)];
  return async (main) => {
    let from = isoDay(-7);
    let to = isoDay();
    const formCard = '<div class="card form-card" data-form></div>';
    main.innerHTML = `${bare ? '' : `<h1>${icon ? `${icon} ` : ''}${esc(title)}</h1>${intro ? `<p class="lead">${intro}</p>` : ''}`}
      ${formSummary ? `<details class="block quick-form"><summary>${formSummary}</summary>${formCard}</details>` : formCard}
      <details class="block history"${can('manager') ? ' open' : ''}>
        <summary data-count>📜 Historique</summary>
        <div class="row no-print filters">
          <label>Du <input type="date" data-from value="${from}"></label><label>Au <input type="date" data-to value="${to}"></label>
          <span class="spacer"></span>
          ${register ? '<button type="button" class="secondary" data-pdf>PDF</button><button type="button" class="secondary" data-csv>Excel</button>' : ''}
        </div><div data-list></div></details>`;
    const formBox = main.querySelector('[data-form]');
    const renderForm = () => {
      formBox.innerHTML = formHtml(fields);
      const sendPhotos = photos ? attachPhotoInput(formBox.querySelector('form')) : null;
      bindForm(formBox, fields, async (data, form) => {
        const row = await api(endpoint, { method: 'POST', body: transform ? transform(data) : data });
        const n = sendPhotos ? await sendPhotos(photos, row.id) : 0;
        if (row.compliant === 0) {
          refreshBadge();
          if (row.non_conformity_id) {
            await actionSheet({
              id: row.non_conformity_id, kind: ncKind, detail: 'Hors limite : une alerte a été ouverte.',
              title: ncTitle ? ncTitle(row) : (row.product || row.fryer || row.kind || title),
            });
          }
        } else {
          flash('ok', n ? `Enregistré avec ${plural(n, 'photo', 'photos')}` : 'Enregistré !');
        }
        if (after) after(row);
        renderForm();
        load();
        refreshBadge();
      });
    };
    const list = main.querySelector('[data-list]');
    const load = async () => {
      const rows = await api(`${endpoint}?from=${from}&to=${to}${query}`);
      main.querySelector('[data-count]').textContent = `📜 Historique (${rows.length})`;
      list.innerHTML = tableHtml(columns, rows, { rowClass: (r) => (r.compliant === 0 ? 'nc' : '') });
      bindGalleries(list, load);
    };
    main.querySelector('[data-from]').onchange = (e) => { from = e.target.value; load(); };
    main.querySelector('[data-to]').onchange = (e) => { to = e.target.value; load(); };
    if (register) {
      main.querySelector('[data-pdf]').onclick = () => download(`/reports/haccp.pdf?only=${register}&from=${from}&to=${to}`, `${register}.pdf`);
      main.querySelector('[data-csv]').onclick = () => download(`/reports/${register}.csv?from=${from}&to=${to}`, `${register}.csv`);
    }
    renderForm();
    await load();
  };
}

/** Page « référentiel » : liste éditable (équipements, fournisseurs...). */
function refPage({ title, intro, endpoint, fields, columns, role = 'manager' }) {
  return async (main) => {
    main.innerHTML = `<h1>${esc(title)}</h1>${intro ? `<p class="muted">${intro}</p>` : ''}
      <div class="card"><div class="row"><span class="spacer"></span>${can(role) ? '<button data-add>+ Ajouter</button>' : ''}</div><div data-list></div></div>`;
    const list = main.querySelector('[data-list]');
    const edit = (row) => {
      const dlg = modal(row ? 'Modifier' : 'Ajouter', formHtml(fields, row || {}));
      bindForm(dlg, fields, async (data) => {
        await api(row ? `${endpoint}/${row.id}` : endpoint, { method: row ? 'PUT' : 'POST', body: data });
        dlg.close();
        toast('Enregistré ✓');
        load();
      });
    };
    const load = async () => {
      const rows = await api(endpoint);
      const cols = can(role)
        ? [...columns, { label: '', html: (r) => `<div class="row"><button class="secondary small" data-edit="${r.id}">Modifier</button><button class="danger small" data-del="${r.id}">Supprimer</button></div>` }]
        : columns;
      list.innerHTML = tableHtml(cols, rows);
      list.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => edit(rows.find((r) => r.id === Number(b.dataset.edit))); });
      list.querySelectorAll('[data-del]').forEach((b) => {
        b.onclick = async () => {
          if (!confirm('Supprimer cet élément ? L\'historique associé est conservé.')) return;
          try { await api(`${endpoint}/${b.dataset.del}`, { method: 'DELETE' }); load(); } catch (e) { toast(e.message, true); }
        };
      });
    };
    main.querySelector('[data-add]')?.addEventListener('click', () => edit(null));
    await load();
  };
}

// ---------------------------------------------------------------- pages

async function dashboardPage(main) {
  const d = await api('/dashboard');
  const pct = (s) => (s.total ? `${Math.round((100 * s.ok) / s.total)} %` : '—');
  const unchecked = d.equipment.filter((e) => !e.checked_today);
  main.innerHTML = `<h1>📊 Statistiques</h1>
    <div class="kpis">
      <div class="kpi"><div class="v">${d.equipment.length - unchecked.length}/${d.equipment.length}</div><div class="l">Équipements relevés aujourd'hui</div></div>
      <div class="kpi"><div class="v">${d.cleaningDue.length}</div><div class="l">Tâches de nettoyage à faire</div></div>
      <div class="kpi"><div class="v" style="color:${d.openNc ? 'var(--bad)' : 'var(--ok)'}">${d.openNc}</div><div class="l">Non-conformités ouvertes</div></div>
      <div class="kpi"><div class="v">${pct(d.stats.temperatures)}</div><div class="l">Conformité températures (30 j)</div></div>
      <div class="kpi"><div class="v">${pct(d.stats.receptions)}</div><div class="l">Conformité réceptions (30 j)</div></div>
    </div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
      <div class="card"><div class="row"><h2>Températures</h2><span class="spacer"></span><a href="#/temperatures">Saisir →</a></div>
        ${d.equipment.map((e) => `<div class="list-item"><div><strong>${esc(e.name)}</strong><div class="muted">${e.last_at ? `${e.last_value} °C – ${fmtDT(e.last_at)}` : 'Jamais relevé'}</div></div><span class="spacer"></span>
          ${e.checked_today ? (e.last_compliant ? '<span class="pill ok">OK</span>' : '<span class="pill bad">Alerte</span>') : '<span class="pill warn">À relever</span>'}</div>`).join('') || '<p class="muted">Aucun équipement. <a href="#/equipment">En ajouter</a></p>'}
      </div>
      <div class="card"><div class="row"><h2>Nettoyage à faire</h2><span class="spacer"></span><a href="#/cleaning">Voir →</a></div>
        ${d.cleaningDue.map((t) => `<div class="list-item"><div><strong>${esc(t.name)}</strong><div class="muted">${esc(t.zone)} · ${FREQ[t.frequency]}</div></div></div>`).join('') || '<p class="muted">Tout est à jour ✓</p>'}
      </div>
      ${d.expiringLabels.length ? `<div class="card"><h2>DLC secondaires proches</h2>${d.expiringLabels.map((l) => `<div class="list-item"><strong>${esc(l.product)}</strong><span class="spacer"></span><span class="pill ${l.dlc < d.today ? 'bad' : 'warn'}">${fmtD(l.dlc)}</span></div>`).join('')}</div>` : ''}
      ${d.trainingsExpiring.length ? `<div class="card"><h2>Formations à renouveler</h2>${d.trainingsExpiring.map((t) => `<div class="list-item">${esc(t.person)} – ${esc(t.title)}<span class="spacer"></span><span class="pill warn">${fmtD(t.expires_on)}</span></div>`).join('')}</div>` : ''}
    </div>`;
}

async function temperaturesPage(main) {
  const drafts = {};
  main.innerHTML = `<h1>🌡️ Températures</h1>
    <p class="lead">Tapez la température affichée sur l'appareil, puis OK. Si elle sort de la norme, l'application vous guide.</p>
    <div data-status></div><div data-cards></div><div data-history></div>`;
  const cards = main.querySelector('[data-cards]');
  let list = (await api('/today')).temperatures;

  // Saisie détaillée (heure précise, commentaire, photo) : repliée, pour les cas particuliers.
  const history = logPage({
    bare: true,
    title: 'Relevés de température',
    endpoint: '/temperatures',
    register: 'temperatures',
    photos: 'temperature_logs',
    ncKind: 'temp',
    ncTitle: (r) => `${r.equipment_name} : ${fmtTemp(r.value)} °C`,
    formSummary: '✍️ Saisie détaillée : heure précise, commentaire, photo',
    fields: [
      { name: 'equipment_id', label: 'Équipement', type: 'select', required: true, options: list.map((e) => [e.id, e.name]) },
      { name: 'value', label: 'Température (°C)', type: 'number', required: true, step: '0.1' },
      { name: 'recorded_at', label: 'Date / heure', type: 'datetime', advanced: true, default: () => localNow() },
      { name: 'comment', label: 'Commentaire / action corrective', advanced: true, full: true },
    ],
    columns: [
      { label: 'Date', get: (r) => fmtDT(r.recorded_at) },
      { label: 'Équipement', get: (r) => r.equipment_name },
      { label: 'T°', get: (r) => `${r.value} °C` },
      { label: 'Plage', get: (r) => `${r.min_temp ?? ''} / ${r.max_temp ?? ''}` },
      { label: 'Statut', html: (r) => conf(r.compliant) },
      { label: 'Commentaire', get: (r) => r.comment },
      { label: 'Par', get: (r) => r.user_name },
    ],
  });

  const render = () => {
    const allDone = list.length > 0 && list.every((t) => t.done);
    main.querySelector('[data-status]').innerHTML = allDone ? '<p class="all-done">✅ Tous les relevés du jour sont faits. Bravo !</p>' : '';
    cards.innerHTML = list.map((t) => tempCardHtml(t, drafts[t.id])).join('') || `<div class="empty"><div class="big-emoji">🧊</div>
      <h2>Aucun équipement</h2><p>${can('manager') ? 'Ajoutez vos frigos et congélateurs pour commencer les relevés.' : 'Demandez à votre responsable de configurer les équipements.'}</p>
      ${can('manager') ? '<a class="btn" href="#/equipment">Ajouter mes équipements</a>' : ''}</div>`;
    temps.refresh();
  };
  const temps = bindTempCards(cards, () => list, {
    drafts,
    onSaved: async () => {
      list = (await api('/today')).temperatures;
      render();
      history(main.querySelector('[data-history]'));
    },
  });
  render();
  await history(main.querySelector('[data-history]'));
}

async function cleaningPage(main) {
  const render = async () => {
    const tasks = (await api('/today')).cleaning;
    const due = tasks.filter((t) => t.due);
    const onDemand = tasks.filter((t) => t.frequency === 'after_use');
    const done = tasks.filter((t) => t.done && t.frequency !== 'after_use');
    main.innerHTML = `<h1>🧽 Nettoyage</h1>
      <section class="block"><h2><span>À faire aujourd'hui</span><small>${done.length}/${due.length + done.length}</small></h2>
        ${due.length ? due.map(cleanCardHtml).join('') : '<p class="all-done">✅ Tout est nettoyé, bravo !</p>'}</section>
      ${onDemand.length ? `<section class="block"><h2>Après chaque usage</h2><p class="muted">À cocher quand vous venez de nettoyer.</p>${onDemand.map(cleanCardHtml).join('')}</section>` : ''}
      ${done.length ? `<details class="block done-list"><summary>✅ Fait aujourd'hui (${done.length})</summary><ul>${done.map((t) => `<li>${esc(t.name)} <span>${esc(t.zone)}</span></li>`).join('')}</ul></details>` : ''}
      <div data-history></div>`;
    main.querySelectorAll('[data-clean]').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        try {
          await api('/cleaning-logs', { method: 'POST', body: { task_id: Number(b.dataset.clean) } });
          flash('ok', 'Bien joué !');
          render();
        } catch (e) { toast(e.message, true); b.disabled = false; }
      };
    });
    const all = await api('/cleaning-tasks');
    await logPage({
      bare: true,
      title: 'Nettoyage',
      endpoint: '/cleaning-logs',
      register: 'cleaning',
      photos: 'cleaning_logs',
      formSummary: '✍️ Noter un nettoyage fait à une autre heure',
      fields: [
        { name: 'task_id', label: 'Tâche', type: 'select', required: true, options: all.map((t) => [t.id, `${t.zone} – ${t.name}`]) },
        { name: 'done_at', label: 'Date / heure', type: 'datetime', advanced: true, default: () => localNow() },
        { name: 'comment', label: 'Commentaire', advanced: true, full: true },
      ],
      columns: [
        { label: 'Date', get: (r) => fmtDT(r.done_at) },
        { label: 'Zone', get: (r) => r.zone },
        { label: 'Élément', get: (r) => r.task_name },
        { label: 'Commentaire', get: (r) => r.comment },
        { label: 'Par', get: (r) => r.user_name },
      ],
    })(main.querySelector('[data-history]'));
  };
  await render();
}

async function receptionsPage(main) {
  const suppliers = await api('/suppliers');
  const cats = state.ref.receptionCategories;
  const limit = (c) => (c.max != null ? ` (≤ ${c.max} °C)` : c.min != null ? ` (≥ ${c.min} °C)` : '');
  return logPage({
    icon: '📦',
    title: 'Réception de marchandises',
    intro: 'Une livraison arrive : contrôlez la température, l\'emballage et la date limite.',
    endpoint: '/receptions',
    register: 'receptions',
    photos: 'receptions',
    ncKind: 'reception',
    ncTitle: (r) => `Réception : ${r.product}`,
    fields: [
      { name: 'supplier_id', label: 'Fournisseur', type: 'select', options: suppliers.map((s) => [s.id, s.name]) },
      { name: 'product', label: 'Produit', required: true },
      { name: 'category', label: 'Catégorie', type: 'select', required: true, options: Object.entries(cats).map(([k, c]) => [k, c.label + limit(c)]) },
      { name: 'temperature', label: 'Température (°C)', type: 'number', step: '0.1' },
      { name: 'dlc', label: 'DLC / DDM', type: 'date' },
      { name: 'packaging_ok', label: 'Emballage et étiquetage corrects', type: 'checkbox', default: true },
      { name: 'lot_number', label: 'N° de lot', advanced: true },
      { name: 'received_at', label: 'Date / heure', type: 'datetime', advanced: true, default: () => localNow() },
      { name: 'comment', label: 'Commentaire (refus, avoir…)', advanced: true, full: true },
    ],
    columns: [
      { label: 'Date', get: (r) => fmtDT(r.received_at) },
      { label: 'Fournisseur', get: (r) => r.supplier_name },
      { label: 'Produit', get: (r) => r.product },
      { label: 'Lot', get: (r) => r.lot_number },
      { label: 'DLC', get: (r) => fmtD(r.dlc) },
      { label: 'T°', get: (r) => (r.temperature != null ? `${r.temperature} °C` : '') },
      { label: 'Statut', html: (r) => conf(r.compliant) },
      { label: 'Par', get: (r) => r.user_name },
    ],
  })(main);
}

const processColumns = [
  { label: 'Produit', get: (r) => r.product },
  { label: 'Lot', get: (r) => r.lot_number },
  { label: 'Début', get: (r) => `${fmtDT(r.start_at)}${r.start_temp != null ? ` (${r.start_temp} °C)` : ''}` },
  { label: 'Fin', get: (r) => `${fmtDT(r.end_at)} (${r.end_temp} °C)` },
  { label: 'Durée', get: (r) => `${r.duration_min} min` },
  { label: 'Statut', html: (r) => conf(r.compliant) },
  { label: 'Par', get: (r) => r.user_name },
];
// On saisit la durée mesurée ; les heures de début et de fin en sont déduites. Aucune valeur
// n'est préremplie à la place de l'employé : durée et température finale sont obligatoires.
const processFields = (type) => [
  { name: 'type', type: 'hidden', default: type },
  { name: 'product', label: 'Quel produit ?', required: true },
  {
    name: 'duration', type: 'number', step: '1', min: 0, required: true,
    label: type === 'cooling' ? 'Durée du refroidissement (minutes)' : 'Durée de la remise en température (minutes)',
    placeholder: type === 'cooling' ? 'Ex. 90' : 'Ex. 45',
  },
  { name: 'end_temp', label: 'Température finale à cœur (°C)', type: 'number', step: '0.1', required: true },
  { name: 'lot_number', label: 'N° de lot', advanced: true },
  { name: 'start_temp', label: 'Température de départ (°C)', type: 'number', step: '0.1', advanced: true },
  { name: 'end_at', label: 'Heure de fin', type: 'datetime', advanced: true, default: () => localNow() },
  { name: 'comment', label: 'Commentaire', advanced: true, full: true },
];
const processTransform = (d) => {
  const end = d.end_at || new Date().toISOString();
  const minutes = Number(String(d.duration).replace(',', '.'));
  return { ...d, end_at: end, start_at: new Date(Date.parse(end) - minutes * 60000).toISOString() };
};

const pages = {
  // Les quatre onglets de la barre de navigation.
  today: { title: 'Aujourd\'hui', icon: '🏠', render: todayPage },
  saisir: { title: 'Saisir', icon: '➕', render: capturePage },
  nonconformities: { title: 'Alertes', icon: '🔔', render: alertsPage },
  plus: { title: 'Plus', icon: '☰', render: morePage },
  // Pages ouvertes depuis « Saisir » ou « Plus » (voir PAGE_PLACE).
  dashboard: { title: 'Statistiques', icon: '📊', role: 'manager', render: dashboardPage },
  temperatures: { title: 'Températures', icon: '🌡️', render: temperaturesPage },
  cleaning: { title: 'Nettoyage', icon: '🧽', render: cleaningPage },
  receptions: { title: 'Réceptions', icon: '📦', render: receptionsPage },
  cooling: {
    title: 'Refroidissement', icon: '❄️',
    render: (main) => logPage({
      icon: '❄️',
      title: 'Refroidissement rapide',
      intro: 'Objectif : passer de +63 °C à +10 °C à cœur en moins de 2 heures.',
      endpoint: '/processes', register: 'processes', query: '&type=cooling', photos: 'process_logs',
      fields: processFields('cooling'), transform: processTransform, columns: processColumns,
      ncKind: 'process', ncTitle: (r) => `Refroidissement : ${r.product}`,
    })(main),
  },
  reheating: {
    title: 'Remise en T°', icon: '♨️',
    render: (main) => logPage({
      icon: '♨️',
      title: 'Remise en température',
      intro: 'Objectif : atteindre +63 °C à cœur en moins d\'1 heure.',
      endpoint: '/processes', register: 'processes', query: '&type=reheating', photos: 'process_logs',
      fields: processFields('reheating'), transform: processTransform, columns: processColumns,
      ncKind: 'process', ncTitle: (r) => `Remise en température : ${r.product}`,
    })(main),
  },
  oil: {
    title: 'Huiles de friture', icon: '🍟',
    render: (main) => logPage({
      icon: '🍟',
      title: 'Huile de friture',
      intro: 'Le taux de composés polaires ne doit pas dépasser 25 %. Au-delà, l\'huile doit être changée.',
      endpoint: '/oil-checks', register: 'oil',
      ncTitle: (r) => `Huile ${r.fryer} : ${r.polar_percent} %`,
      fields: [
        { name: 'fryer', label: 'Quelle friteuse ?', required: true, default: 'Friteuse 1' },
        { name: 'polar_percent', label: '% composés polaires', type: 'number', step: '0.5', min: 0, required: true },
        { name: 'oil_changed', label: 'J\'ai changé l\'huile', type: 'checkbox' },
        { name: 'checked_at', label: 'Date / heure', type: 'datetime', advanced: true, default: () => localNow() },
        { name: 'comment', label: 'Commentaire', advanced: true, full: true },
      ],
      columns: [
        { label: 'Date', get: (r) => fmtDT(r.checked_at) },
        { label: 'Friteuse', get: (r) => r.fryer },
        { label: '% polaires', get: (r) => `${r.polar_percent} %` },
        { label: 'Changée', get: (r) => (r.oil_changed ? 'Oui' : 'Non') },
        { label: 'Statut', html: (r) => conf(r.compliant) },
        { label: 'Par', get: (r) => r.user_name },
      ],
    })(main),
  },
  labels: {
    title: 'Étiquettes DLC', icon: '🏷️',
    render: async (main) => {
      const presets = await api('/shelf-lives');
      await logPage({
      icon: '🏷️',
      title: 'Étiquette DLC',
      intro: 'La date limite est calculée toute seule. L\'étiquette s\'imprime après l\'enregistrement.',
      endpoint: '/labels', register: 'labels',
      fields: [
        { name: 'product', label: 'Quel produit ?', required: true },
        { name: 'kind', label: 'Il vient d\'être…', type: 'select', required: true, options: [['opened', 'ouvert'], ['prepared', 'fabriqué'], ['defrosted', 'décongelé']] },
        { name: 'shelf_life_days', label: 'Se conserve (jours)', type: 'number', step: '1', min: 0, required: true, default: 3 },
        { name: 'lot_number', label: 'N° de lot', advanced: true },
        { name: 'start_at', label: 'Date et heure d\'ouverture / fabrication', type: 'datetime', required: true, advanced: true, default: () => localNow() },
      ],
      columns: [
        { label: 'Produit', get: (r) => r.product },
        { label: 'Type', get: (r) => LABEL_KIND[r.kind] },
        { label: 'Date', get: (r) => fmtDT(r.start_at) },
        { label: 'DLC', html: (r) => `<span class="pill ${r.dlc < isoDay() ? 'bad' : 'info'}">${fmtD(r.dlc)}</span>` },
        { label: 'Lot', get: (r) => r.lot_number },
        { label: 'Par', get: (r) => r.user_name },
        { label: '', html: (r) => `<button class="secondary small" onclick='window.printLabel(${esc(JSON.stringify(r))})'>Imprimer</button>` },
      ],
      after: (r) => window.printLabel(r),
      })(main);
      if (presets.length) addPresetBar(main, presets);
    },
  },
  pests: {
    title: 'Nuisibles', icon: '🐭',
    render: (main) => logPage({
      icon: '🐭',
      title: 'Lutte contre les nuisibles',
      intro: 'Passage du prestataire ou contrôle des pièges : notez ce que vous avez constaté.',
      endpoint: '/pest-controls', register: 'pests', photos: 'pest_controls',
      ncTitle: (r) => `Nuisibles : ${r.kind}`,
      fields: [
        { name: 'kind', label: 'Quel contrôle ?', required: true, placeholder: 'Passage du prestataire, contrôle des pièges…' },
        { name: 'compliant', label: 'Aucune trace de nuisibles', type: 'checkbox', default: true },
        { name: 'findings', label: 'Ce que vous avez constaté', type: 'textarea', full: true },
        { name: 'provider', label: 'Prestataire', advanced: true },
        { name: 'checked_at', label: 'Date / heure', type: 'datetime', advanced: true, default: () => localNow() },
      ],
      columns: [
        { label: 'Date', get: (r) => fmtDT(r.checked_at) },
        { label: 'Contrôle', get: (r) => r.kind },
        { label: 'Prestataire', get: (r) => r.provider },
        { label: 'Constats', get: (r) => r.findings },
        { label: 'Statut', html: (r) => conf(r.compliant) },
      ],
    })(main),
  },
  allergens: { title: 'Allergènes', icon: '🥜', render: allergensPage },
  trainings: {
    title: 'Formations', icon: '🎓',
    render: refPage({
      title: 'Formations du personnel',
      intro: 'Formation hygiène alimentaire obligatoire (14 h) pour au moins une personne en restauration commerciale.',
      endpoint: '/trainings',
      fields: [
        { name: 'person', label: 'Personne', required: true },
        { name: 'title', label: 'Formation', required: true },
        { name: 'organism', label: 'Organisme' },
        { name: 'date', label: 'Date', type: 'date', required: true },
        { name: 'expires_on', label: 'À renouveler le', type: 'date' },
      ],
      columns: [
        { label: 'Personne', get: (r) => r.person },
        { label: 'Formation', get: (r) => r.title },
        { label: 'Organisme', get: (r) => r.organism },
        { label: 'Date', get: (r) => fmtD(r.date) },
        { label: 'Échéance', get: (r) => fmtD(r.expires_on) },
      ],
    }),
  },
  reports: { title: 'Préparer un contrôle', icon: '📄', role: 'manager', render: reportsPage },
  equipment: {
    title: 'Équipements', icon: '🧊',
    render: refPage({
      title: 'Équipements frigorifiques et maintien au chaud',
      intro: 'Laissez les plages vides pour appliquer les seuils réglementaires par défaut du type choisi.',
      endpoint: '/equipment',
      fields: [
        { name: 'name', label: 'Nom', required: true },
        { name: 'type', label: 'Type', type: 'select', required: true, options: () => Object.entries(state.ref.equipmentTypes).map(([k, v]) => [k, v.label]) },
        { name: 'min_temp', label: 'T° min (°C)', type: 'number' },
        { name: 'max_temp', label: 'T° max (°C)', type: 'number' },
      ],
      columns: [
        { label: 'Nom', get: (r) => r.name },
        { label: 'Type', get: (r) => state.ref.equipmentTypes[r.type]?.label },
        { label: 'Plage', get: (r) => `${r.min_temp ?? '—'} à ${r.max_temp ?? '—'} °C` },
      ],
    }),
  },
  'cleaning-tasks': {
    title: 'Plan de nettoyage', icon: '📋',
    render: refPage({
      title: 'Plan de nettoyage et désinfection',
      endpoint: '/cleaning-tasks',
      fields: [
        { name: 'zone', label: 'Zone', required: true, placeholder: 'Cuisine, plonge, salle...' },
        { name: 'name', label: 'Élément', required: true },
        { name: 'frequency', label: 'Fréquence', type: 'select', required: true, options: Object.entries(FREQ) },
        { name: 'product', label: 'Produit' },
        { name: 'method', label: 'Méthode', type: 'textarea', full: true },
      ],
      columns: [
        { label: 'Zone', get: (r) => r.zone },
        { label: 'Élément', get: (r) => r.name },
        { label: 'Fréquence', get: (r) => FREQ[r.frequency] },
        { label: 'Produit', get: (r) => r.product },
        { label: 'Méthode', get: (r) => r.method },
      ],
    }),
  },
  suppliers: {
    title: 'Fournisseurs', icon: '🚚',
    render: refPage({
      title: 'Fournisseurs',
      endpoint: '/suppliers',
      fields: [
        { name: 'name', label: 'Nom', required: true },
        { name: 'approval_number', label: 'N° d\'agrément sanitaire' },
        { name: 'contact', label: 'Contact' },
        { name: 'phone', label: 'Téléphone' },
        { name: 'email', label: 'E-mail', type: 'email' },
      ],
      columns: [
        { label: 'Nom', get: (r) => r.name },
        { label: 'Agrément', get: (r) => r.approval_number },
        { label: 'Contact', get: (r) => r.contact },
        { label: 'Téléphone', get: (r) => r.phone },
        { label: 'E-mail', get: (r) => r.email },
      ],
    }),
  },
  'shelf-lives': {
    title: 'Durées de vie', icon: '⏳',
    render: refPage({
      title: 'Durées de vie (DLC secondaires)',
      intro: 'Produits fréquents proposés sur la page Étiquettes. Durées indicatives : validez-les dans votre Plan de Maîtrise Sanitaire.',
      endpoint: '/shelf-lives',
      fields: [
        { name: 'product', label: 'Produit', required: true },
        { name: 'kind', label: 'Type', type: 'select', required: true, options: Object.entries(LABEL_KIND) },
        { name: 'days', label: 'Durée de vie (jours, 0 = jour même)', type: 'number', step: '1', required: true },
      ],
      columns: [
        { label: 'Produit', get: (r) => r.product },
        { label: 'Type', get: (r) => LABEL_KIND[r.kind] },
        { label: 'Durée', get: (r) => (r.days === 0 ? 'Jour même' : `${r.days} jour(s)`) },
      ],
    }),
  },
  billing: { title: 'Abonnement', icon: '💳', role: 'admin', render: billingPage },
  settings: { title: 'Paramètres', icon: '⚙️', render: settingsPage },
};

// Chaque page appartient à un onglet ; `parent` ajoute un lien de retour « ‹ Saisir » ou « ‹ Plus ».
const PAGE_PLACE = {
  today: { tab: 'today' }, saisir: { tab: 'saisir' }, nonconformities: { tab: 'nonconformities' }, plus: { tab: 'plus' },
  temperatures: { tab: 'saisir', parent: 'saisir' }, cleaning: { tab: 'saisir', parent: 'saisir' },
  receptions: { tab: 'saisir', parent: 'saisir' }, cooling: { tab: 'saisir', parent: 'saisir' },
  reheating: { tab: 'saisir', parent: 'saisir' }, oil: { tab: 'saisir', parent: 'saisir' },
  labels: { tab: 'saisir', parent: 'saisir' }, pests: { tab: 'saisir', parent: 'saisir' },
  allergens: { tab: 'plus', parent: 'plus' }, dashboard: { tab: 'plus', parent: 'plus' }, reports: { tab: 'plus', parent: 'plus' },
  equipment: { tab: 'plus', parent: 'plus' }, 'cleaning-tasks': { tab: 'plus', parent: 'plus' }, suppliers: { tab: 'plus', parent: 'plus' },
  'shelf-lives': { tab: 'plus', parent: 'plus' }, trainings: { tab: 'plus', parent: 'plus' }, billing: { tab: 'plus', parent: 'plus' },
  settings: { tab: 'plus', parent: 'plus' },
};
for (const [key, place] of Object.entries(PAGE_PLACE)) Object.assign(pages[key], place);

/** Boutons « produits fréquents » qui préremplissent le formulaire d'étiquette. */
function addPresetBar(main, presets) {
  const bar = document.createElement('div');
  bar.className = 'card presets no-print';
  bar.innerHTML = `<span class="muted">Produits fréquents :</span> ${presets.map((p) => `<button type="button" class="secondary small" data-preset="${p.id}">${esc(p.product)} · ${p.days === 0 ? 'jour même' : `J+${p.days}`}</button>`).join(' ')}`;
  main.querySelector('[data-form]').closest('.card').before(bar);
  bar.querySelectorAll('[data-preset]').forEach((b) => {
    b.onclick = () => {
      const p = presets.find((x) => x.id === Number(b.dataset.preset));
      const form = main.querySelector('[data-form] form');
      form.elements.product.value = p.product;
      form.elements.kind.value = p.kind;
      form.elements.shelf_life_days.value = p.days;
      form.elements.lot_number.focus();
    };
  });
}

window.printLabel = (r) => {
  const w = window.open('', '_blank', 'width=420,height=360');
  if (!w) return;
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Étiquette</title><link rel="stylesheet" href="/styles.css"></head>
    <body style="padding:1rem"><div class="label-print">
      <div><strong>${esc(r.product)}</strong></div>
      <div>${esc(LABEL_KIND[r.kind])} : ${esc(fmtDT(r.start_at))}</div>
      ${r.lot_number ? `<div>Lot : ${esc(r.lot_number)}</div>` : ''}
      <div class="dlc">DLC : ${esc(fmtD(r.dlc))}</div>
      <div style="font-size:.75rem">${esc(state.org?.name || '')} · ${esc(r.user_name || '')}</div>
    </div><script>window.onload=()=>{window.print()}<\/script></body></html>`);
  w.document.close();
};

async function allergensPage(main) {
  const all = state.ref.allergens;
  const picked = new Set();
  let recipes = [];
  let search = '';
  const norm = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fields = [
    { name: 'name', label: 'Nom du plat', required: true },
    { name: 'description', label: 'Ingrédients', type: 'textarea', full: true },
  ];

  const dishHtml = (r) => {
    const hits = r.allergens.filter((a) => picked.has(a));
    const verdict = !picked.size ? ''
      : hits.length ? `<p class="verdict bad">⛔ Contient : ${hits.map(esc).join(', ')}</p>`
        : `<p class="verdict ok">✅ Sans ${[...picked].map(esc).join(', ')}</p>`;
    return `<article class="dish${hits.length ? ' has' : ''}">
      <div class="dish-top"><div><strong>${esc(r.name)}</strong>${r.description ? `<small>${esc(r.description)}</small>` : ''}</div>
        ${can('manager') ? `<button type="button" class="secondary small no-print" data-edit="${r.id}">Modifier</button>` : ''}</div>
      <div class="algs">${r.allergens.length ? r.allergens.map((a) => `<span class="alg${picked.has(a) ? ' hit' : ''}">${esc(a)}</span>`).join('') : '<span class="pill ok">Aucun allergène déclaré</span>'}</div>
      ${verdict}</article>`;
  };

  const matrixHtml = () => (recipes.length ? `<h2>${esc(state.org?.name || '')} – Allergènes présents dans nos plats</h2>
    <table class="matrix"><thead><tr><th>Plat</th>${all.map((a) => `<th class="rot">${esc(a)}</th>`).join('')}</tr></thead>
    <tbody>${recipes.map((r) => `<tr><td><strong>${esc(r.name)}</strong></td>${all.map((a) => `<td class="x">${r.allergens.includes(a) ? '●' : ''}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '');

  const edit = (r) => {
    const dlg = modal(r ? 'Modifier le plat' : 'Nouveau plat', `${formHtml(fields, r || {})}`);
    const form = dlg.querySelector('form');
    form.querySelector('button[type=submit]').parentElement.insertAdjacentHTML('beforebegin',
      `<div class="full"><label>Allergènes présents</label><div class="allergen-grid">${all.map((a) => `<label class="check"><input type="checkbox" name="alg" value="${esc(a)}" ${r?.allergens.includes(a) ? 'checked' : ''}> ${esc(a)}</label>`).join('')}</div></div>
       ${r ? '<div><button type="button" class="danger" data-del>Supprimer</button></div>' : ''}`);
    form.querySelector('[data-del]')?.addEventListener('click', async () => {
      if (!confirm('Supprimer ce plat ?')) return;
      await api(`/recipes/${r.id}`, { method: 'DELETE' }); dlg.close(); render();
    });
    bindForm(dlg, fields, async (data) => {
      data.allergens = [...form.querySelectorAll('input[name=alg]:checked')].map((i) => i.value);
      await api(r ? `/recipes/${r.id}` : '/recipes', { method: r ? 'PUT' : 'POST', body: data });
      dlg.close(); flash('ok', 'Plat enregistré'); render();
    });
  };

  const drawDishes = () => {
    const q = norm(search);
    let list = recipes.filter((r) => !q || norm(r.name).includes(q));
    // Les plats sûrs d'abord quand on cherche à éviter un allergène.
    if (picked.size) list = [...list].sort((a, b) => a.allergens.some((x) => picked.has(x)) - b.allergens.some((x) => picked.has(x)));
    const box = main.querySelector('[data-dishes]');
    box.innerHTML = list.length ? list.map(dishHtml).join('') : `<p class="muted">${recipes.length ? 'Aucun plat ne correspond.' : 'Aucun plat enregistré pour l\'instant.'}</p>`;
    box.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => edit(recipes.find((x) => x.id === Number(b.dataset.edit))); });
  };

  const render = async () => {
    recipes = await api('/recipes');
    main.innerHTML = `<h1>🥜 Allergènes</h1>
      <p class="lead">Un client a une allergie ? Touchez l'allergène à éviter : les plats concernés sont signalés.</p>
      <div class="chips" data-pick>${all.map((a) => `<button type="button" class="chip" data-a="${esc(a)}" aria-pressed="${picked.has(a)}">${esc(a)}</button>`).join('')}</div>
      <input type="search" class="search" data-search placeholder="🔍 Chercher un plat" aria-label="Chercher un plat" autocomplete="off" value="${esc(search)}">
      <div data-dishes></div>
      <div class="row no-print"><button type="button" class="secondary" onclick="window.print()">🖨️ Imprimer le tableau pour la salle</button>
        ${can('manager') ? '<button type="button" data-add>+ Ajouter un plat</button>' : ''}</div>
      <div class="print-only">${matrixHtml()}</div>`;
    main.querySelector('[data-pick]').addEventListener('click', (ev) => {
      const chip = ev.target.closest('.chip');
      if (!chip) return;
      const name = chip.dataset.a;
      if (picked.has(name)) picked.delete(name); else picked.add(name);
      chip.setAttribute('aria-pressed', String(picked.has(name)));
      drawDishes();
    });
    main.querySelector('[data-search]').addEventListener('input', (ev) => { search = ev.target.value; drawDishes(); });
    main.querySelector('[data-add]')?.addEventListener('click', () => edit(null));
    drawDishes();
  };
  await render();
}

async function reportsPage(main) {
  const regs = await api('/reports/registers');
  main.innerHTML = `<h1>Rapports et contrôle sanitaire</h1>
    <p class="muted">En cas de contrôle (DDPP / DDETSPP), éditez le classeur HACCP complet de la période demandée.</p>
    <div class="card"><div class="form">
      <label>Du<input type="date" data-from value="${isoDay(-30)}"></label>
      <label>Au<input type="date" data-to value="${isoDay()}"></label>
      <div><button data-pdf>📄 Classeur HACCP complet (PDF)</button></div></div></div>
    <div class="card"><h2>Registres individuels</h2>${regs.map((r) => `<div class="list-item"><span>${esc(r.title)}</span><span class="spacer"></span>
      <button class="secondary small" data-one="${r.key}">PDF</button><button class="secondary small" data-csv="${r.key}">CSV / Excel</button></div>`).join('')}</div>`;
  const q = () => `from=${main.querySelector('[data-from]').value}&to=${main.querySelector('[data-to]').value}`;
  main.querySelector('[data-pdf]').onclick = () => download(`/reports/haccp.pdf?${q()}`, 'classeur-haccp.pdf');
  main.querySelectorAll('[data-one]').forEach((b) => { b.onclick = () => download(`/reports/haccp.pdf?only=${b.dataset.one}&${q()}`, `${b.dataset.one}.pdf`); });
  main.querySelectorAll('[data-csv]').forEach((b) => { b.onclick = () => download(`/reports/${b.dataset.csv}.csv?${q()}`, `${b.dataset.csv}.csv`); });
}

async function billingPage(main) {
  if (location.hash.includes('checkout=success')) {
    main.innerHTML = '<h1>Abonnement</h1><div class="card"><p>✅ Paiement reçu, merci ! Activation de votre abonnement…</p></div>';
    // Stripe confirme l'abonnement par webhook : on attend quelques secondes.
    for (let i = 0; i < 10 && state.access?.state !== 'active'; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      await loadSession();
    }
    history.replaceState(null, '', '#/billing');
    renderBanner();
  }
  const b = await api('/billing');
  const a = b.access;
  const STATUS = {
    unlimited: ['info', 'Accès illimité (facturation non configurée sur ce serveur)'],
    trial: ['info', `Essai gratuit : ${a.trialDaysLeft} jour(s) restant(s), jusqu'au ${fmtD(a.trialEndsAt)}`],
    active: ['ok', `Abonnement ${b.plans.find((p) => p.key === a.plan)?.label || ''} actif${a.currentPeriodEnd ? `, renouvellement le ${fmtD(a.currentPeriodEnd)}` : ''}`],
    past_due: ['warn', 'Paiement en échec : mettez à jour votre moyen de paiement pour éviter la suspension'],
    expired: ['bad', 'Aucun abonnement actif : votre compte est en lecture seule'],
  };
  const [cls, text] = STATUS[a.state];
  const subscribed = a.state === 'active' || a.state === 'past_due';
  main.innerHTML = `<h1>Abonnement</h1>
    <div class="card"><div class="row"><span class="pill ${cls}">${esc(text)}</span><span class="spacer"></span>
      ${b.hasCustomer && b.enabled ? '<button class="secondary" data-portal>Gérer mon abonnement et mes factures</button>' : ''}</div></div>
    ${b.enabled && !subscribed ? `<div class="plans">${b.plans.map((p) => `<div class="card plan ${p.key === 'pro' ? 'featured' : ''}">
        <h2>${esc(p.label)}</h2><div class="price">${p.price} € <small>HT / mois</small></div>
        <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        <button data-plan="${p.key}">Choisir ${esc(p.label)}</button></div>`).join('')}</div>
      <p class="muted">Paiement sécurisé par Stripe. Sans engagement, résiliable à tout moment depuis le portail. Vos données restent consultables et exportables même sans abonnement.</p>` : ''}
    ${subscribed ? '<p class="muted">Pour changer d\'offre, mettre à jour votre carte ou télécharger vos factures, utilisez « Gérer mon abonnement ».</p>' : ''}`;
  const go = async (path, body) => {
    try { const r = await api(path, { method: 'POST', body }); location.href = r.url; } catch (e) { toast(e.message, true); }
  };
  main.querySelector('[data-portal]')?.addEventListener('click', () => go('/billing/portal'));
  main.querySelectorAll('[data-plan]').forEach((btn) => {
    btn.onclick = () => { btn.disabled = true; go('/billing/checkout', { plan: btn.dataset.plan }).finally(() => { btn.disabled = false; }); };
  });
}

const TIMEZONES = [
  ['Europe/Paris', 'France métropolitaine'], ['Indian/Reunion', 'La Réunion'], ['Indian/Mayotte', 'Mayotte'],
  ['America/Martinique', 'Martinique'], ['America/Guadeloupe', 'Guadeloupe'], ['America/Cayenne', 'Guyane'],
  ['Pacific/Noumea', 'Nouvelle-Calédonie'], ['Pacific/Tahiti', 'Polynésie française'],
  ['Europe/Brussels', 'Belgique'], ['Europe/Zurich', 'Suisse'], ['Europe/Luxembourg', 'Luxembourg'], ['America/Toronto', 'Québec'],
];

async function notificationsSection(main) {
  const box = main.querySelector('[data-notif]');
  if (!box) return;
  const n = await api('/organization/notifications');
  const admin = can('admin');
  const fields = [
    { name: 'notif_enabled', label: 'Activer les rappels par e-mail', type: 'checkbox', full: true },
    { name: 'notif_temp_times', label: 'Heures des relevés de températures', placeholder: '09:00, 17:00' },
    { name: 'notif_grace_min', label: 'Rappel si oubli après (minutes)', type: 'number', step: '5' },
    { name: 'notif_digest_time', label: 'Heure du récapitulatif du soir', placeholder: '20:00' },
    { name: 'timezone', label: 'Fuseau horaire', type: 'select', required: true, options: TIMEZONES },
    { name: 'notif_nc_alert', label: 'Alerte immédiate à chaque non-conformité', type: 'checkbox', full: true },
  ];
  box.innerHTML = `
    ${n.mailConfigured ? '' : '<p class="banner warn">L\'envoi d\'e-mails n\'est pas encore configuré sur le serveur (voir docs/EMAILS.md) : les rappels ne partiront pas.</p>'}
    <p class="muted">Un e-mail est envoyé aux responsables si un équipement n'a pas été relevé à l'heure prévue, puis un récapitulatif chaque soir (nettoyages oubliés, non-conformités ouvertes, DLC du jour) s'il y a quelque chose à signaler.</p>
    ${admin ? formHtml(fields, { ...n, notif_temp_times: n.notif_temp_times.replace(/,/g, ', ') }) : `<p>Rappels ${n.notif_enabled ? `activés : relevés à ${esc(n.notif_temp_times.replace(/,/g, ', ') || '—')}, récapitulatif à ${esc(n.notif_digest_time)}` : 'désactivés'}.</p>`}
    <p class="muted" style="margin-top:1rem">Destinataires (administrateurs et responsables) : ${n.recipients.map((r) => esc(r.name)).join(', ') || 'aucun'}</p>
    <div class="row">
      <label class="check"><input type="checkbox" data-notify ${state.user.notify ? 'checked' : ''}> Je reçois les rappels et alertes</label>
      <span class="spacer"></span><button class="secondary" data-test-mail>Envoyer un e-mail de test</button>
    </div>`;
  if (admin) {
    bindForm(box, fields, async (data) => {
      await api('/organization/notifications', { method: 'PUT', body: { ...data, notif_grace_min: Number(data.notif_grace_min) } });
      toast('Rappels enregistrés ✓');
    });
  }
  box.querySelector('[data-notify]').onchange = async (e) => {
    try {
      const r = await api('/me/notify', { method: 'PUT', body: { notify: e.target.checked } });
      state.user.notify = r.notify;
      toast(r.notify ? 'Vous recevrez les rappels' : 'Vous ne recevrez plus les rappels');
    } catch (err) { toast(err.message, true); }
  };
  box.querySelector('[data-test-mail]').onclick = async () => {
    try { const r = await api('/organization/notifications/test', { method: 'POST' }); toast(`E-mail de test envoyé à ${r.to}`); } catch (e) { toast(e.message, true); }
  };
}

async function settingsPage(main) {
  const orgFields = [
    { name: 'name', label: 'Nom de l\'établissement', required: true },
    { name: 'siret', label: 'SIRET' },
    { name: 'activity', label: 'Activité' },
    { name: 'address', label: 'Adresse', full: true },
  ];
  const pwFields = [
    { name: 'current', label: 'Mot de passe actuel', type: 'password', required: true },
    { name: 'password', label: 'Nouveau mot de passe (8 car. min.)', type: 'password', required: true },
  ];
  const userFields = [
    // Le code PIN est facultatif : il donne aussi accès à la tablette de cuisine.
    { name: 'name', label: 'Nom', required: true },
    { name: 'email', label: 'E-mail', type: 'email', required: true },
    { name: 'password', label: 'Mot de passe provisoire', type: 'password', required: true },
    { name: 'role', label: 'Rôle', type: 'select', required: true, options: Object.entries(ROLES) },
  ];
  main.innerHTML = `<h1>Paramètres</h1>
    ${can('admin') ? '<div class="card"><h2>Établissement</h2><div data-org></div></div>' : ''}
    ${can('admin') ? `<div class="card"><h2>Modèle de métier</h2>
      <p class="muted">Ajoute les équipements, le plan de nettoyage et les durées de vie types d'un métier. Les éléments déjà présents ne sont pas dupliqués.</p>
      <div class="row"><select data-template style="width:auto"></select><button class="secondary" data-apply>Ajouter les éléments du modèle</button></div></div>` : ''}
    ${can('manager') ? '<div class="card"><div class="row"><h2>Utilisateurs</h2><span class="spacer"></span>' + (can('admin') ? '<button class="secondary" data-add-pin-user>+ Employé sans e-mail (code PIN)</button><button data-add-user>+ Ajouter</button>' : '') + '</div><div data-users></div></div>' : ''}
    ${can('manager') ? '<div class="card"><h2>🔢 Tablettes de cuisine</h2><div data-devices></div></div>' : ''}
    <div class="card"><h2>Mon code PIN</h2><div data-mypin></div></div>
    ${can('manager') ? '<div class="card"><h2>Rappels et alertes par e-mail</h2><div data-notif></div></div>' : ''}
    ${state.user.kiosk || state.user.pin_only ? '' : '<div class="card"><h2>Mon mot de passe</h2><div data-pw></div></div>'}
    ${can('admin') ? `<div class="card"><h2>Mes données</h2>
      <p class="muted">Vous restez propriétaire de vos données. ${state.org?.terms_accepted_at ? `CGV acceptées le ${esc(fmtDT(state.org.terms_accepted_at))} (version du ${esc(fmtD(state.org.terms_version))}).` : ''}</p>
      <div class="row"><button class="secondary" data-export>⬇ Exporter toutes mes données (JSON)</button>
      <span class="spacer"></span><button class="danger" data-delete-account>Supprimer définitivement le compte</button></div></div>` : ''}`;
  const orgBox = main.querySelector('[data-org]');
  if (orgBox) {
    orgBox.innerHTML = formHtml(orgFields, state.org);
    bindForm(orgBox, orgFields, async (data) => { state.org = await api('/organization', { method: 'PUT', body: data }); toast('Enregistré ✓'); renderShell(); });
  }
  const tplSelect = main.querySelector('[data-template]');
  if (tplSelect) {
    const templates = await api('/templates');
    tplSelect.innerHTML = templates.map((t) => `<option value="${t.key}">${esc(t.label)}</option>`).join('');
    main.querySelector('[data-apply]').onclick = async () => {
      try {
        const c = await api('/organization/template', { method: 'POST', body: { template: tplSelect.value } });
        toast(`Ajouté : ${c.equipment} équipement(s), ${c.cleaning} tâche(s) de nettoyage, ${c.shelfLives} durée(s) de vie`);
      } catch (e) { toast(e.message, true); }
    };
  }
  const pwBox = main.querySelector('[data-pw]');
  if (pwBox) {
    pwBox.innerHTML = formHtml(pwFields, {}, 'Changer');
    bindForm(pwBox, pwFields, async (data, form) => {
      const r = await api('/me/password', { method: 'PUT', body: data });
      state.token = r.token;
      store.set('token', r.token);
      form.reset();
      toast('Mot de passe modifié ✓ (vos autres appareils ont été déconnectés)');
    });
  }
  await notificationsSection(main);
  main.querySelector('[data-export]')?.addEventListener('click', () => download('/organization/export', `export-${isoDay()}.json`));
  main.querySelector('[data-delete-account]')?.addEventListener('click', () => {
    const f = [
      { name: 'confirm', label: `Saisissez le nom de l'établissement : ${state.org.name}`, required: true, full: true },
      { name: 'password', label: 'Votre mot de passe', type: 'password', required: true, full: true },
    ];
    const dlg = modal('Supprimer le compte', `<p class="banner bad">Cette action est <strong>irréversible</strong> : tous les registres, photos et
      utilisateurs de l'établissement seront effacés et l'abonnement résilié. Pensez à exporter vos registres (PDF) et vos données avant :
      ils peuvent vous être demandés lors d'un contrôle.</p>${formHtml(f, {}, 'Supprimer définitivement')}`);
    dlg.querySelector('button[type=submit]').classList.add('danger');
    bindForm(dlg, f, async (data) => {
      await api('/organization/delete', { method: 'POST', body: data });
      dlg.close();
      alert('Votre compte a été supprimé. Merci d\'avoir utilisé Pack Hygiène.');
      logout();
    });
  });
  const usersBox = main.querySelector('[data-users]');
  const loadUsers = async () => {
    const users = await api('/users');
    usersBox.innerHTML = tableHtml([
      { label: 'Nom', get: (u) => u.name },
      { label: 'E-mail', html: (u) => (u.pin_only ? '<span class="muted">— (code PIN seul)</span>' : esc(u.email)) },
      { label: 'Tablette', html: (u) => (u.has_pin ? '<span class="pill ok">🔢 PIN</span>' : '<span class="muted">—</span>') },
      { label: 'Rôle', get: (u) => ROLES[u.role] },
      { label: 'Statut', html: (u) => (u.active ? '<span class="pill ok">Actif</span>' : '<span class="pill bad">Désactivé</span>') },
      { label: '', html: (u) => (can('admin') ? `<div class="row">
        <button class="secondary small" data-pin="${u.id}">Code PIN</button>
        ${u.id !== state.user.id ? `<button class="secondary small" data-toggle="${u.id}" data-active="${u.active}">${u.active ? 'Désactiver' : 'Réactiver'}</button>` : ''}</div>` : '') },
    ], users);
    usersBox.querySelectorAll('[data-pin]').forEach((b) => {
      b.onclick = () => {
        const u = users.find((x) => x.id === Number(b.dataset.pin));
        const f = [{ name: 'pin', label: 'Nouveau code PIN (4 à 6 chiffres)', type: 'password', required: true, full: true }];
        const dlg = modal(`Code PIN de ${u.name}`, `<p class="muted">Ce code permet de se connecter sur la tablette de cuisine. Communiquez-le à la personne de vive voix.
          Le définir débloque aussi le compte après des erreurs.</p>${formHtml(f, {}, 'Enregistrer')}
          ${u.has_pin && !u.pin_only ? '<p><button class="danger small" data-remove-pin>Retirer l\'accès tablette</button></p>' : ''}`);
        dlg.querySelector('input[name=pin]').setAttribute('inputmode', 'numeric');
        bindForm(dlg, f, async (data) => {
          await api(`/users/${u.id}`, { method: 'PUT', body: { pin: data.pin } });
          dlg.close(); toast('Code PIN enregistré ✓'); loadUsers();
        });
        dlg.querySelector('[data-remove-pin]')?.addEventListener('click', async () => {
          await api(`/users/${u.id}`, { method: 'PUT', body: { pin: null } }); dlg.close(); loadUsers();
        });
      };
    });
    usersBox.querySelectorAll('[data-toggle]').forEach((b) => {
      b.onclick = async () => { await api(`/users/${b.dataset.toggle}`, { method: 'PUT', body: { active: b.dataset.active !== '1' } }); loadUsers(); };
    });
  };
  if (usersBox) await loadUsers();
  main.querySelector('[data-add-pin-user]')?.addEventListener('click', () => {
    const f = [
      { name: 'name', label: 'Prénom et nom', required: true, full: true },
      { name: 'pin', label: 'Code PIN (4 à 6 chiffres)', type: 'password', required: true, full: true },
    ];
    const dlg = modal('Nouvel employé (code PIN)', `<p class="muted">Pour le personnel sans adresse e-mail : il se connecte uniquement sur la tablette de cuisine,
      avec les droits de saisie d'un employé.</p>${formHtml(f, {}, 'Créer')}`);
    dlg.querySelector('input[name=pin]').setAttribute('inputmode', 'numeric');
    bindForm(dlg, f, async (data) => {
      await api('/users', { method: 'POST', body: { ...data, pin_only: true } });
      dlg.close(); toast('Employé créé ✓'); loadUsers();
    });
  });
  await devicesSection(main);
  myPinSection(main);
  main.querySelector('[data-add-user]')?.addEventListener('click', () => {
    const dlg = modal('Nouvel utilisateur', formHtml(userFields, { role: 'employee' }));
    bindForm(dlg, userFields, async (data) => { await api('/users', { method: 'POST', body: data }); dlg.close(); toast('Utilisateur créé ✓'); loadUsers(); });
  });
}

// ---------------------------------------------------------------- tablette de cuisine (code PIN)

const KIOSK_IDLE_MS = 3 * 60000;

async function devicesSection(main) {
  const box = main.querySelector('[data-devices]');
  if (!box) return;
  const devices = state.user.kiosk ? [] : await api('/devices');
  box.innerHTML = `<p class="muted">Installez une tablette dans la cuisine : chacun touche son nom et tape son code PIN. Les saisies sont signées
    par la bonne personne, sans partager de mot de passe. Les sessions tablette ont les droits d'un employé et se ferment après 3 minutes sans activité.</p>
    ${state.deviceToken ? '<p class="banner warn">Cet appareil est configuré comme tablette de cuisine. <button class="secondary small" data-local-off>Désactiver sur cet appareil</button></p>'
      : '<p><button data-make-kiosk>Utiliser cet appareil comme tablette de cuisine</button></p>'}
    ${tableHtml([
      { label: 'Tablette', get: (d) => d.name },
      { label: 'Ajoutée le', get: (d) => `${fmtDT(d.created_at)}${d.created_by_name ? ` par ${d.created_by_name}` : ''}` },
      { label: 'Dernière utilisation', get: (d) => fmtDT(d.last_seen_at) || 'jamais' },
      { label: '', html: (d) => `<button class="danger small" data-revoke="${d.id}">Retirer</button>` },
    ], devices)}`;
  box.querySelector('[data-make-kiosk]')?.addEventListener('click', async () => {
    const name = prompt('Nom de cette tablette (ex. « Tablette cuisine », « Tablette laboratoire ») :', 'Tablette cuisine');
    if (name === null) return;
    try {
      const d = await api('/devices', { method: 'POST', body: { name } });
      state.deviceToken = d.token;
      store.set('deviceToken', d.token);
      toast('Tablette configurée ✓ Les employés peuvent maintenant se connecter avec leur code PIN.');
      logout();
    } catch (e) { toast(e.message, true); }
  });
  box.querySelector('[data-local-off]')?.addEventListener('click', () => {
    if (!confirm('Désactiver le mode tablette sur cet appareil ? (Pensez aussi à la retirer de la liste.)')) return;
    state.deviceToken = null;
    store.del('deviceToken');
    devicesSection(main);
  });
  box.querySelectorAll('[data-revoke]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('Retirer cette tablette ? Les personnes connectées dessus seront déconnectées.')) return;
      try { await api(`/devices/${b.dataset.revoke}`, { method: 'DELETE' }); devicesSection(main); } catch (e) { toast(e.message, true); }
    };
  });
}

function myPinSection(main) {
  const box = main.querySelector('[data-mypin]');
  if (!box) return;
  const f = state.user.kiosk
    ? [{ name: 'current_pin', label: 'Code PIN actuel', type: 'password', required: true }, { name: 'pin', label: 'Nouveau code PIN', type: 'password', required: true }]
    : [{ name: 'password', label: 'Votre mot de passe', type: 'password', required: true }, { name: 'pin', label: 'Code PIN (4 à 6 chiffres)', type: 'password', required: true }];
  box.innerHTML = `<p class="muted">${state.user.has_pin ? 'Vous avez un code PIN pour la tablette de cuisine.' : 'Définissez un code PIN pour vous connecter rapidement sur la tablette de cuisine.'}</p>${formHtml(f, {}, state.user.has_pin ? 'Changer mon code' : 'Définir mon code')}`;
  box.querySelectorAll('input[name=pin], input[name=current_pin]').forEach((i) => i.setAttribute('inputmode', 'numeric'));
  bindForm(box, f, async (data, form) => {
    await api('/me/pin', { method: 'PUT', body: data });
    state.user.has_pin = true;
    form.reset();
    toast('Code PIN enregistré ✓');
  });
}

/** Écran de la tablette : choix de la personne puis clavier PIN. */
async function kioskPage() {
  let info;
  try { info = await api('/kiosk'); } catch (e) { return authPage('login'); }
  const showUsers = () => {
    app.innerHTML = `<div class="kiosk"><header><img src="/icon.svg" width="34" height="34" alt=""><div><strong>${esc(info.organization)}</strong><br><span>${esc(info.device)}</span></div>
      <span class="spacer"></span><span class="clock" data-clock></span></header>
      <h1>Qui êtes-vous ?</h1>
      <div class="kiosk-users">${info.users.map((u) => `<button data-user="${u.id}"><span class="avatar">${esc(u.name.trim().charAt(0).toUpperCase())}</span>${esc(u.name)}</button>`).join('')
        || '<p class="muted">Aucun employé n\'a encore de code PIN. Un responsable doit en définir dans Paramètres → Utilisateurs.</p>'}</div>
      <p class="kiosk-foot"><a href="#/login" data-classic>Connexion responsable (e-mail)</a></p></div>`;
    tick();
    app.querySelectorAll('[data-user]').forEach((b) => { b.onclick = () => showPad(info.users.find((u) => u.id === Number(b.dataset.user))); });
    app.querySelector('[data-classic]').onclick = (e) => { e.preventDefault(); authPage('login'); };
  };
  const tick = () => {
    const c = app.querySelector('[data-clock]');
    if (!c) return;
    const txt = new Date().toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    c.textContent = txt.charAt(0).toUpperCase() + txt.slice(1);
  };
  const showPad = (user) => {
    let pin = '';
    app.innerHTML = `<div class="kiosk"><header><button class="secondary" data-back>← Retour</button><span class="spacer"></span></header>
      <h1>Bonjour ${esc(user.name)}</h1><p class="muted center">Tapez votre code PIN</p>
      <div class="pin-dots" data-dots></div><p class="pin-error" data-err role="alert"></p>
      <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-d="${n}">${n}</button>`).join('')}
        <button data-del aria-label="Effacer">⌫</button><button data-d="0">0</button><button data-ok class="ok" aria-label="Valider">✓</button></div></div>`;
    const dots = app.querySelector('[data-dots]');
    const err = app.querySelector('[data-err]');
    const draw = () => { dots.innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join(''); };
    const submit = async () => {
      if (pin.length < 4) return;
      try {
        const r = await api('/kiosk/login', { method: 'POST', body: { user_id: user.id, pin } });
        state.token = r.token;
        state.user = null;
        store.set('token', r.token);
        if (location.hash === '#/today') route(); else location.hash = '#/today';
      } catch (e) { err.textContent = e.message; pin = ''; draw(); }
    };
    app.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => { if (pin.length < 6) { pin += b.dataset.d; err.textContent = ''; draw(); } }; });
    app.querySelector('[data-del]').onclick = () => { pin = pin.slice(0, -1); draw(); };
    app.querySelector('[data-ok]').onclick = submit;
    app.querySelector('[data-back]').onclick = showUsers;
    draw();
  };
  showUsers();
  clearInterval(kioskPage.clock);
  kioskPage.clock = setInterval(tick, 30000);
}

/** Session tablette : déconnexion automatique après 3 minutes sans activité. */
function armKioskIdle() {
  clearTimeout(armKioskIdle.timer);
  if (!state.user?.kiosk) return;
  armKioskIdle.timer = setTimeout(() => { if (state.user?.kiosk) logout(); }, KIOSK_IDLE_MS);
}
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, armKioskIdle, { passive: true }));

// ---------------------------------------------------------------- authentification & shell

/** Écran d'authentification simple (mot de passe oublié, réinitialisation). */
function authCard(title, intro, inner) {
  app.innerHTML = `<div class="auth"><div class="card">
    <h1><img src="/icon.svg" width="32" height="32" alt=""> ${esc(title)}</h1>
    <p class="muted">${intro}</p><div data-form>${inner}</div>
    <p class="muted"><a href="#/login">← Retour à la connexion</a></p></div><p class="legal-links"><a href="/legal/mentions" target="_blank">Mentions légales</a> · <a href="/legal/cgv" target="_blank">CGV</a> · <a href="/legal/confidentialite" target="_blank">Confidentialité</a></p></div>`;
  return app.querySelector('[data-form]');
}

function forgotPage() {
  const fields = [{ name: 'email', label: 'E-mail du compte', type: 'email', required: true, full: true }];
  const box = authCard('Mot de passe oublié', 'Saisissez votre adresse : vous recevrez un lien pour choisir un nouveau mot de passe.',
    formHtml(fields, {}, 'Recevoir le lien'));
  bindForm(box, fields, async (data) => {
    await api('/auth/forgot', { method: 'POST', body: data });
    box.innerHTML = `<p>📧 Si un compte existe pour <strong>${esc(data.email)}</strong>, un e-mail vient d'être envoyé. Le lien est valable 1 heure.</p>
      <p class="muted">Pensez à vérifier vos courriers indésirables.</p>`;
  });
}

function resetPage() {
  const token = new URLSearchParams(location.hash.split('?')[1] || '').get('token');
  if (!token) { location.hash = '#/forgot'; return; }
  const fields = [
    { name: 'password', label: 'Nouveau mot de passe (8 caractères min.)', type: 'password', required: true, full: true },
    { name: 'confirm', label: 'Confirmation', type: 'password', required: true, full: true },
  ];
  const box = authCard('Nouveau mot de passe', 'Choisissez votre nouveau mot de passe.', formHtml(fields, {}, 'Enregistrer et me connecter'));
  bindForm(box, fields, async (data) => {
    if (data.password !== data.confirm) throw new Error('Les deux mots de passe ne correspondent pas');
    const res = await api('/auth/reset', { method: 'POST', body: { token, password: data.password } });
    state.token = res.token;
    state.user = null;
    localStorage.setItem('token', res.token);
    history.replaceState(null, '', '#/today');
    toast('Mot de passe modifié ✓');
    route();
  });
}

function logout() {
  state.token = null;
  state.user = null;
  clearTimeout(armKioskIdle.timer);
  store.del('token');
  route();
}

async function authPage(mode = 'login') {
  const signup = mode === 'signup';
  const templates = signup ? await api('/templates').catch(() => []) : [];
  const fields = signup
    ? [
      { name: 'organization', label: 'Nom de l\'établissement', required: true, full: true },
      {
        name: 'template', label: 'Votre métier (préremplit équipements, nettoyage et durées de vie)', type: 'select', full: true,
        default: 'restaurant', emptyLabel: 'Autre : partir de zéro', options: templates.map((t) => [t.key, t.label]),
      },
      { name: 'name', label: 'Votre nom', required: true, full: true },
      { name: 'email', label: 'E-mail', type: 'email', required: true, full: true },
      { name: 'password', label: 'Mot de passe (8 caractères min.)', type: 'password', required: true, full: true },
      {
        name: 'accept_terms', type: 'checkbox', required: true, full: true,
        labelHtml: 'J\'accepte les <a href="/legal/cgv" target="_blank">CGV</a>, la <a href="/legal/confidentialite" target="_blank">politique de confidentialité</a> et le <a href="/legal/sous-traitance" target="_blank">contrat de sous-traitance</a>',
      },
    ]
    : [
      { name: 'email', label: 'E-mail', type: 'email', required: true, full: true },
      { name: 'password', label: 'Mot de passe', type: 'password', required: true, full: true },
    ];
  app.innerHTML = `<div class="auth"><div class="card">
    <h1><img src="/icon.svg" width="32" height="32" alt=""> Pack Hygiène HACCP</h1>
    <p class="muted">${signup ? 'Créez votre espace en 1 minute. 30 jours d\'essai gratuit, sans carte bancaire.' : 'Connectez-vous à votre espace.'}</p>
    <div data-form></div>
    <p class="muted">${signup ? 'Déjà inscrit ? <a href="#/login">Se connecter</a>' : '<a href="#/forgot">Mot de passe oublié ?</a><br>Nouveau client ? <a href="#/signup">Créer un compte</a>'}</p>
  </div><p class="legal-links"><a href="/legal/mentions" target="_blank">Mentions légales</a> · <a href="/legal/cgv" target="_blank">CGV</a> · <a href="/legal/confidentialite" target="_blank">Confidentialité</a></p></div>`;
  const box = app.querySelector('[data-form]');
  box.innerHTML = formHtml(fields, {}, signup ? 'Créer mon compte' : 'Se connecter');
  bindForm(box, fields, async (data) => {
    const res = await api(signup ? '/auth/signup' : '/auth/login', { method: 'POST', body: data });
    state.token = res.token;
    localStorage.setItem('token', res.token);
    await loadSession();
    location.hash = signup ? (data.template ? '#/today' : '#/equipment') : '#/today';
    route();
  });
}

async function loadSession() {
  const [me, ref] = await Promise.all([api('/me'), state.ref ? state.ref : api('/reference')]);
  state.user = me.user;
  state.org = me.organization;
  state.access = me.access;
  state.terms = me.terms;
  state.ref = ref;
}


function renderBanner() {
  const box = document.querySelector('[data-banner]');
  if (!box) return;
  const a = state.access || {};
  const link = can('admin') ? ' <a href="#/billing">Voir les offres →</a>' : ' Contactez l\'administrateur de votre compte.';
  let html = '';
  if (a.state === 'expired') html = `<div class="banner bad">🔒 Votre essai ou votre abonnement est terminé : le compte est en lecture seule (vos registres restent consultables et exportables).${link}</div>`;
  else if (a.state === 'past_due') html = `<div class="banner warn">⚠ Le dernier paiement a échoué.${can('admin') ? ' <a href="#/billing">Mettre à jour le moyen de paiement →</a>' : ''}</div>`;
  else if (a.state === 'trial' && a.trialDaysLeft <= 7) html = `<div class="banner warn">⏳ Plus que ${a.trialDaysLeft} jour(s) d'essai gratuit.${link}</div>`;
  box.innerHTML = html;
}

// Quatre onglets seulement : tout le reste s'ouvre depuis « Saisir » ou « Plus ».
const TABS = [
  { key: 'today', icon: '🏠', label: 'Aujourd\'hui' },
  { key: 'saisir', icon: '➕', label: 'Saisir' },
  { key: 'nonconformities', icon: '🔔', label: 'Alertes' },
  { key: 'plus', icon: '☰', label: 'Plus' },
];

function renderShell() {
  const current = (location.hash.slice(2) || 'today').split('?')[0];
  const page = pages[current] || pages.today;
  const parent = page.parent && pages[page.parent];
  const first = firstName(state.user?.name);
  app.innerHTML = `<div class="shell">
    <header class="appbar no-print">
      ${parent ? `<a class="back" href="#/${page.parent}">‹ ${esc(parent.title)}</a>`
        : `<span class="brand"><img src="/icon.svg" alt="" width="28" height="28"><b>${esc(state.org?.name || '')}</b></span>`}
      <span class="spacer"></span>
      ${state.user?.kiosk ? `<button type="button" class="who" data-switch>👤 ${esc(first)} · changer</button>` : `<span class="who">👤 ${esc(first)}</span>`}
    </header>
    <div class="content"><div data-banner class="no-print"></div><div data-main></div></div>
    <nav class="tabbar no-print" aria-label="Navigation principale">${TABS.map((t) => `<a href="#/${t.key}" class="tab${t.key === page.tab ? ' active' : ''}"${t.key === page.tab ? ' aria-current="page"' : ''}>
      <span class="tab-ico" aria-hidden="true">${t.icon}</span><span>${esc(t.label)}</span>
      ${t.key === 'nonconformities' ? `<span class="badge" data-nc-badge ${state.openNc ? '' : 'hidden'}>${state.openNc}</span>` : ''}</a>`).join('')}</nav>
  </div>`;
  renderBanner();
  app.querySelector('[data-switch]')?.addEventListener('click', () => logout());
  return app.querySelector('[data-main]');
}

function askTermsIfNeeded() {
  if (!state.terms?.outdated || !can('admin') || document.querySelector('dialog[data-terms]')) return;
  const dlg = modal('Nos conditions évoluent', `<p>Nos conditions générales ont été mises à jour (version du ${esc(fmtD(state.terms.version))}).
    Merci de les lire et de les accepter pour continuer à utiliser le service.</p>
    <ul><li><a href="/legal/cgv" target="_blank">Conditions générales de vente</a></li>
    <li><a href="/legal/confidentialite" target="_blank">Politique de confidentialité</a></li>
    <li><a href="/legal/sous-traitance" target="_blank">Contrat de sous-traitance (RGPD)</a></li></ul>
    <div class="row"><button data-accept>J'ai lu et j'accepte</button></div>`);
  dlg.dataset.terms = '1';
  dlg.querySelector('[data-close]').remove();
  dlg.addEventListener('cancel', (e) => e.preventDefault());
  dlg.querySelector('[data-accept]').onclick = async () => {
    try {
      await api('/organization/accept-terms', { method: 'POST', body: { version: state.terms.version } });
      await loadSession();
      dlg.close();
      toast('Merci ✓');
    } catch (e) { toast(e.message, true); }
  };
}

async function route() {
  const key = (location.hash.slice(2) || '').split('?')[0];
  if (key === 'forgot') return forgotPage();
  if (key === 'reset') return resetPage();
  if (!state.token) {
    // Tablette de cuisine : écran de choix de la personne, sauf demande explicite d'une autre page.
    if (state.deviceToken && !['login', 'signup'].includes(key)) return kioskPage();
    return authPage(key === 'signup' ? 'signup' : 'login');
  }
  if (key === 'login' || key === 'signup') { location.hash = '#/today'; return; }
  try {
    if (!state.user) { await loadSession(); refreshBadge(); }
  } catch { return; }
  const page = pages[key] && (!pages[key].role || can(pages[key].role)) ? pages[key] : pages.today;
  const main = renderShell();
  main.innerHTML = '<p class="muted">Chargement…</p>';
  try { await page.render(main); } catch (e) { main.innerHTML = `<p class="pill bad">${esc(e.message)}</p>`; }
  askTermsIfNeeded();
  armKioskIdle();
}

hooks.logout = logout;
hooks.route = route;
window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
