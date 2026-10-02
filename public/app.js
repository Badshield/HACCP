// Pack Hygiène HACCP – application monopage (sans dépendance, sans build).

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* stockage indisponible */ } },
};
const state = { deviceToken: store.get('deviceToken'), token: localStorage.getItem('token'), user: null, org: null, access: null, ref: null, openNc: 0 };
const app = document.getElementById('app');

// ---------------------------------------------------------------- utilitaires
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const fmtD = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const pad = (n) => String(n).padStart(2, '0');
const localNow = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const isoDay = (offset = 0) => { const d = new Date(Date.now() + offset * 86400000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const conf = (c) => (c ? '<span class="pill ok">Conforme</span>' : '<span class="pill bad">Non conforme</span>');
const can = (role) => ({ employee: 1, manager: 2, admin: 3 })[state.user?.role] >= ({ employee: 1, manager: 2, admin: 3 })[role];
const FREQ = { daily: 'Quotidienne', weekly: 'Hebdomadaire', monthly: 'Mensuelle', after_use: 'Après utilisation' };
const LABEL_KIND = { opened: 'Ouverture', prepared: 'Fabrication', defrosted: 'Décongélation' };
const ROLES = { admin: 'Administrateur', manager: 'Responsable', employee: 'Employé' };

function toast(msg, error = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show${error ? ' error' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = ''; }, 3000);
}

async function api(path, { method = 'GET', body, raw } = {}) {
  const kioskCall = path.startsWith('/kiosk');
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(state.token && !kioskCall ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(kioskCall && state.deviceToken ? { 'X-Device-Token': state.deviceToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    const data = await res.clone().json().catch(() => ({}));
    if (data.code === 'device_invalid') {
      // Tablette retirée par un responsable : retour à la connexion classique.
      state.deviceToken = null;
      store.del('deviceToken');
      if (state.token && state.user?.kiosk) { logout(); throw new Error('Cette tablette a été retirée'); }
      if (kioskCall) { route(); throw new Error('Cette tablette a été retirée'); }
    }
    if (state.token && !kioskCall) { logout(); throw new Error('Session expirée'); }
  }
  if (raw) { if (!res.ok) throw new Error('Téléchargement impossible'); return res; }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur');
  return data;
}

async function download(path, filename) {
  try {
    const res = await api(path, { raw: true });
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { toast(e.message, true); }
}

/** Convertit les valeurs d'un formulaire selon la définition des champs. */
function readForm(form, fields) {
  const out = {};
  for (const f of fields) {
    const el = form.elements[f.name];
    if (!el) continue;
    if (f.type === 'checkbox') out[f.name] = el.checked;
    else if (f.type === 'datetime') out[f.name] = el.value ? new Date(el.value).toISOString() : '';
    else out[f.name] = el.value;
  }
  return out;
}

function fieldHtml(f, value) {
  const v = value ?? (typeof f.default === 'function' ? f.default() : f.default) ?? '';
  const req = f.required ? 'required' : '';
  const cls = f.full ? 'full' : '';
  if (f.type === 'hidden') return `<input type="hidden" name="${f.name}" value="${esc(v)}">`;
  if (f.type === 'checkbox') {
    // labelHtml : libellé contenant des liens (texte statique, jamais issu d'une saisie).
    return `<label class="check ${cls}"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''} ${req}> <span>${f.labelHtml || esc(f.label)}</span></label>`;
  }
  let input;
  if (f.type === 'select') {
    const opts = (typeof f.options === 'function' ? f.options() : f.options)
      .map(([val, lab]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(lab)}</option>`).join('');
    input = `<select name="${f.name}" ${req}>${f.required ? '' : `<option value="">${esc(f.emptyLabel || '—')}</option>`}${opts}</select>`;
  } else if (f.type === 'textarea') {
    input = `<textarea name="${f.name}" ${req} placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
  } else {
    const type = { datetime: 'datetime-local', number: 'number', date: 'date', email: 'email', password: 'password' }[f.type] || 'text';
    const val = f.type === 'datetime' && v && v.includes('Z') ? localNow(new Date(v)) : v;
    input = `<input type="${type}" name="${f.name}" value="${esc(val)}" ${req} ${f.type === 'number' ? `step="${f.step || 'any'}" inputmode="decimal"` : ''} placeholder="${esc(f.placeholder || '')}">`;
  }
  return `<label class="${cls}">${esc(f.label)}${f.required ? ' *' : ''}${input}</label>`;
}

function formHtml(fields, values = {}, submit = 'Enregistrer') {
  return `<form class="form">${fields.map((f) => fieldHtml(f, values[f.name])).join('')}
    <div><button type="submit">${esc(submit)}</button></div></form>`;
}

function tableHtml(columns, rows, { rowClass } = {}) {
  if (!rows.length) return '<p class="muted">Aucun enregistrement.</p>';
  return `<div class="table-wrap"><table><thead><tr>${columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr class="${rowClass ? rowClass(r) : ''}">${columns.map((c) => `<td>${c.html ? c.html(r) : esc(c.get(r))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function bindForm(root, fields, onSubmit) {
  const form = root.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try { await onSubmit(readForm(form, fields), form); } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
  });
  return form;
}

function modal(title, html) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<div class="row"><h2>${esc(title)}</h2><span class="spacer"></span><button class="secondary small" data-close>✕</button></div>${html}`;
  document.body.append(dlg);
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  return dlg;
}

// ---------------------------------------------------------------- photos

const PHOTO_INPUT = `<label class="full photo-input">📷 Photos (facultatif : bon de livraison, étiquette, produit...)
  <input type="file" accept="image/*" capture="environment" multiple data-photos></label>`;

/** Redimensionne (1600 px max) et compresse en JPEG avant l'envoi : rapide même en 4G. */
async function compressImage(file, max = 1600, quality = 0.8) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error(`${file.name} : format d'image non pris en charge`);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = Object.assign(document.createElement('canvas'), {
    width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale),
  });
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

async function uploadPhotos(entity, entityId, files) {
  let ok = 0;
  for (const file of files) {
    const blob = await compressImage(file);
    const res = await fetch(`/api/photos?entity=${entity}&entity_id=${entityId}`, {
      method: 'POST', headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${state.token}` }, body: blob,
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Envoi de la photo impossible');
    ok++;
  }
  return ok;
}

/** Ajoute le champ photo à un formulaire et renvoie une fonction qui envoie les fichiers choisis. */
function attachPhotoInput(form) {
  form.querySelector('button[type=submit]').parentElement.insertAdjacentHTML('beforebegin', PHOTO_INPUT);
  const input = form.querySelector('[data-photos]');
  return async (entity, id) => {
    if (!input.files.length) return 0;
    try { return await uploadPhotos(entity, id, [...input.files]); } catch (e) { toast(e.message, true); return 0; }
  };
}

const photoCell = (entity) => ({
  label: 'Photos',
  html: (r) => `<button type="button" class="secondary small" data-gallery="${entity}:${r.id}">📷 ${r.photo_count ? r.photo_count : '+'}</button>`,
});

function bindGalleries(root, onChange) {
  root.querySelectorAll('[data-gallery]').forEach((b) => {
    b.onclick = () => { const [entity, id] = b.dataset.gallery.split(':'); openGallery(entity, Number(id), onChange); };
  });
}

async function photoUrl(id) {
  const res = await api(`/photos/${id}`, { raw: true });
  return URL.createObjectURL(await res.blob());
}

/** Galerie d'un enregistrement : affichage, ajout, suppression (auteur, 15 min). */
async function openGallery(entity, id, onChange) {
  const dlg = modal('Photos', '<div class="gallery" data-items><p class="muted">Chargement…</p></div><div class="row" style="margin-top:1rem"><label class="btn secondary">+ Ajouter des photos<input type="file" accept="image/*" capture="environment" multiple hidden data-add></label></div>');
  const urls = [];
  dlg.addEventListener('close', () => urls.forEach((u) => URL.revokeObjectURL(u)));
  const box = dlg.querySelector('[data-items]');
  const render = async () => {
    const photos = await api(`/photos?entity=${entity}&entity_id=${id}`);
    if (!photos.length) { box.innerHTML = '<p class="muted">Aucune photo pour cet enregistrement.</p>'; return; }
    box.innerHTML = photos.map((p) => `<figure data-photo="${p.id}"><a target="_blank" rel="noopener"><img alt="Photo ${p.id}"></a>
      <figcaption>${esc(fmtDT(p.created_at))} – ${esc(p.user_name || '')}
      ${p.user_id === state.user.id && Date.now() - Date.parse(p.created_at) < 15 * 60000 ? `<button class="danger small" data-del="${p.id}">Supprimer</button>` : ''}</figcaption></figure>`).join('');
    for (const p of photos) {
      const url = await photoUrl(p.id);
      urls.push(url);
      const fig = box.querySelector(`[data-photo="${p.id}"]`);
      fig.querySelector('img').src = url;
      fig.querySelector('a').href = url;
    }
    box.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Supprimer cette photo ?')) return;
        try { await api(`/photos/${b.dataset.del}`, { method: 'DELETE' }); await render(); onChange?.(); } catch (e) { toast(e.message, true); }
      };
    });
  };
  dlg.querySelector('[data-add]').onchange = async (e) => {
    try {
      box.insertAdjacentHTML('afterbegin', '<p class="muted" data-wait>Envoi en cours…</p>');
      const n = await uploadPhotos(entity, id, [...e.target.files]);
      toast(`${n} photo(s) ajoutée(s) ✓`);
      await render();
      onChange?.();
    } catch (err) { toast(err.message, true); box.querySelector('[data-wait]')?.remove(); }
  };
  await render();
}

// ---------------------------------------------------------------- pages génériques

/**
 * Page « registre » : formulaire de saisie + historique filtrable.
 * Les enregistrements sont non modifiables (valeur de preuve HACCP).
 */
function logPage({ title, intro, endpoint, fields, columns, register, after, query = '', photos }) {
  if (photos) columns = [...columns, photoCell(photos)];
  return async (main) => {
    let from = isoDay(-7);
    let to = isoDay();
    main.innerHTML = `<h1>${esc(title)}</h1>${intro ? `<p class="muted">${intro}</p>` : ''}
      <div class="card"><h2>Nouvel enregistrement</h2><div data-form></div></div>
      <div class="card"><div class="row no-print"><h2>Historique</h2><span class="spacer"></span>
        <label>Du <input type="date" data-from value="${from}"></label><label>Au <input type="date" data-to value="${to}"></label>
        ${register ? '<button class="secondary" data-pdf>PDF</button><button class="secondary" data-csv>CSV</button>' : ''}
      </div><div data-list></div></div>`;
    const formBox = main.querySelector('[data-form]');
    const renderForm = () => {
      formBox.innerHTML = formHtml(fields);
      const sendPhotos = photos ? attachPhotoInput(formBox.querySelector('form')) : null;
      bindForm(formBox, fields, async (data, form) => {
        const row = await api(endpoint, { method: 'POST', body: data });
        const n = sendPhotos ? await sendPhotos(photos, row.id) : 0;
        const withPhotos = n ? ` (${n} photo${n > 1 ? 's' : ''})` : '';
        toast(row.compliant === 0 ? `⚠ Enregistré${withPhotos} – NON CONFORME : une non-conformité a été ouverte` : `Enregistré ✓${withPhotos}`, row.compliant === 0);
        if (after) after(row);
        renderForm();
        load();
        refreshBadge();
      });
    };
    const list = main.querySelector('[data-list]');
    const load = async () => {
      const rows = await api(`${endpoint}?from=${from}&to=${to}${query}`);
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
  main.innerHTML = `<h1>Tableau de bord</h1>
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
  const equipment = await api('/equipment');
  const dash = await api('/dashboard');
  const byId = Object.fromEntries(dash.equipment.map((e) => [e.id, e]));
  const history = logPage({
    title: 'Historique des relevés',
    endpoint: '/temperatures',
    register: 'temperatures',
    photos: 'temperature_logs',
    fields: [
      { name: 'equipment_id', label: 'Équipement', type: 'select', required: true, options: equipment.map((e) => [e.id, e.name]) },
      { name: 'value', label: 'Température (°C)', type: 'number', required: true, step: '0.1' },
      { name: 'recorded_at', label: 'Date / heure', type: 'datetime', default: () => localNow() },
      { name: 'comment', label: 'Commentaire / action corrective', type: 'text' },
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
  main.innerHTML = `<h1>Relevés de températures</h1>
    <p class="muted">Relevé rapide : saisissez la température affichée et validez. Une alerte et une non-conformité sont créées automatiquement en cas de dépassement.</p>
    <div class="grid" data-quick></div><div data-history></div>`;
  const quick = main.querySelector('[data-quick]');
  quick.innerHTML = equipment.map((e) => {
    const s = byId[e.id] || {};
    const cls = s.checked_today ? (s.last_compliant ? 'done' : 'alert') : '';
    return `<form class="card equip-card ${cls}" data-eq="${e.id}">
      <strong>${esc(e.name)}</strong>
      <span class="range">Plage : ${e.min_temp ?? '—'} à ${e.max_temp ?? '—'} °C ${s.checked_today ? `· dernier : ${s.last_value} °C` : ''}</span>
      <div class="row"><input type="number" step="0.1" inputmode="decimal" name="value" required placeholder="°C" style="flex:1">
      <button type="submit">OK</button></div></form>`;
  }).join('') || '<p class="muted">Aucun équipement. <a href="#/equipment">Ajoutez vos frigos et congélateurs</a>.</p>';
  quick.querySelectorAll('form').forEach((f) => {
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const row = await api('/temperatures', { method: 'POST', body: { equipment_id: Number(f.dataset.eq), value: f.elements.value.value } });
        f.classList.remove('done', 'alert');
        f.classList.add(row.compliant ? 'done' : 'alert');
        f.elements.value.value = '';
        toast(row.compliant ? `${row.equipment_name} : ${row.value} °C ✓` : `⚠ ${row.equipment_name} : ${row.value} °C HORS PLAGE`, !row.compliant);
        refreshBadge();
        history(main.querySelector('[data-history]'));
      } catch (err) { toast(err.message, true); }
    });
  });
  await history(main.querySelector('[data-history]'));
}

async function cleaningPage(main) {
  const dash = await api('/dashboard');
  const tasks = await api('/cleaning-tasks');
  const history = logPage({
    title: 'Historique du nettoyage',
    endpoint: '/cleaning-logs',
    register: 'cleaning',
    photos: 'cleaning_logs',
    fields: [
      { name: 'task_id', label: 'Tâche', type: 'select', required: true, options: tasks.map((t) => [t.id, `${t.zone} – ${t.name}`]) },
      { name: 'done_at', label: 'Date / heure', type: 'datetime', default: () => localNow() },
      { name: 'comment', label: 'Commentaire', type: 'text' },
    ],
    columns: [
      { label: 'Date', get: (r) => fmtDT(r.done_at) },
      { label: 'Zone', get: (r) => r.zone },
      { label: 'Élément', get: (r) => r.task_name },
      { label: 'Commentaire', get: (r) => r.comment },
      { label: 'Par', get: (r) => r.user_name },
    ],
  });
  main.innerHTML = `<h1>Plan de nettoyage</h1>
    <div class="card"><div class="row"><h2>À faire</h2><span class="spacer"></span><a href="#/cleaning-tasks">Gérer le plan →</a></div><div data-due></div></div>
    <div data-history></div>`;
  const due = main.querySelector('[data-due]');
  due.innerHTML = dash.cleaningDue.map((t) => `<div class="list-item"><div><strong>${esc(t.name)}</strong>
      <div class="muted">${esc(t.zone)} · ${FREQ[t.frequency]}${t.product ? ` · ${esc(t.product)}` : ''}${t.method ? `<br>${esc(t.method)}` : ''}</div></div>
      <span class="spacer"></span><button data-done="${t.id}">✓ Fait</button></div>`).join('') || '<p class="muted">Tout est à jour ✓</p>';
  due.querySelectorAll('[data-done]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api('/cleaning-logs', { method: 'POST', body: { task_id: Number(b.dataset.done) } });
        b.closest('.list-item').remove();
        toast('Tâche validée ✓');
        history(main.querySelector('[data-history]'));
      } catch (e) { toast(e.message, true); }
    };
  });
  await history(main.querySelector('[data-history]'));
}

async function receptionsPage(main) {
  const suppliers = await api('/suppliers');
  const cats = state.ref.receptionCategories;
  const limit = (c) => (c.max != null ? ` (≤ ${c.max} °C)` : c.min != null ? ` (≥ ${c.min} °C)` : '');
  return logPage({
    title: 'Contrôle à réception',
    intro: 'Contrôlez chaque livraison : température, emballage, étiquetage et DLC. Les produits non conformes doivent être refusés ou isolés.',
    endpoint: '/receptions',
    register: 'receptions',
    photos: 'receptions',
    fields: [
      { name: 'supplier_id', label: 'Fournisseur', type: 'select', options: suppliers.map((s) => [s.id, s.name]) },
      { name: 'product', label: 'Produit', required: true },
      { name: 'category', label: 'Catégorie', type: 'select', required: true, options: Object.entries(cats).map(([k, c]) => [k, c.label + limit(c)]) },
      { name: 'temperature', label: 'Température (°C)', type: 'number', step: '0.1' },
      { name: 'lot_number', label: 'N° de lot' },
      { name: 'dlc', label: 'DLC / DDM', type: 'date' },
      { name: 'packaging_ok', label: 'Emballage et étiquetage conformes', type: 'checkbox', default: true },
      { name: 'received_at', label: 'Date / heure', type: 'datetime', default: () => localNow() },
      { name: 'comment', label: 'Commentaire / action (refus, avoir...)', full: true },
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
  { label: 'Début', get: (r) => `${fmtDT(r.start_at)} (${r.start_temp ?? '?'} °C)` },
  { label: 'Fin', get: (r) => `${fmtDT(r.end_at)} (${r.end_temp} °C)` },
  { label: 'Durée', get: (r) => `${r.duration_min} min` },
  { label: 'Statut', html: (r) => conf(r.compliant) },
  { label: 'Par', get: (r) => r.user_name },
];
const processFields = (type, startTemp) => [
  { name: 'type', type: 'hidden', default: type },
  { name: 'product', label: 'Produit / préparation', required: true },
  { name: 'lot_number', label: 'N° de lot' },
  { name: 'start_at', label: 'Début', type: 'datetime', required: true, default: () => localNow(new Date(Date.now() - 3600000)) },
  { name: 'start_temp', label: 'T° de départ (°C)', type: 'number', step: '0.1', default: startTemp },
  { name: 'end_at', label: 'Fin', type: 'datetime', required: true, default: () => localNow() },
  { name: 'end_temp', label: 'T° finale à cœur (°C)', type: 'number', step: '0.1', required: true },
  { name: 'comment', label: 'Commentaire / action corrective', full: true },
];

const pages = {
  dashboard: { title: 'Tableau de bord', icon: '📊', group: 'Quotidien', render: dashboardPage },
  temperatures: { title: 'Températures', icon: '🌡️', group: 'Quotidien', render: temperaturesPage },
  cleaning: { title: 'Nettoyage', icon: '🧽', group: 'Quotidien', render: cleaningPage },
  receptions: { title: 'Réceptions', icon: '📦', group: 'Quotidien', render: receptionsPage },
  cooling: {
    title: 'Refroidissement', icon: '❄️', group: 'Quotidien',
    render: (main) => logPage({
      title: 'Refroidissement rapide',
      intro: 'Objectif : passer de +63 °C à +10 °C à cœur en moins de 2 heures (cellule de refroidissement).',
      endpoint: '/processes', register: 'processes', query: '&type=cooling', photos: 'process_logs',
      fields: processFields('cooling', 63), columns: processColumns,
    })(main),
  },
  reheating: {
    title: 'Remise en T°', icon: '🔥', group: 'Quotidien',
    render: (main) => logPage({
      title: 'Remise en température',
      intro: 'Objectif : atteindre +63 °C à cœur en moins d\'1 heure.',
      endpoint: '/processes', register: 'processes', query: '&type=reheating', photos: 'process_logs',
      fields: processFields('reheating', 3), columns: processColumns,
    })(main),
  },
  oil: {
    title: 'Huiles de friture', icon: '🍟', group: 'Quotidien',
    render: (main) => logPage({
      title: 'Contrôle des huiles de friture',
      intro: 'Le taux de composés polaires ne doit pas dépasser 25 %. Au-delà, l\'huile doit être changée.',
      endpoint: '/oil-checks', register: 'oil',
      fields: [
        { name: 'fryer', label: 'Friteuse', required: true, default: 'Friteuse 1' },
        { name: 'polar_percent', label: '% composés polaires', type: 'number', step: '0.5', required: true },
        { name: 'oil_changed', label: 'Huile changée', type: 'checkbox' },
        { name: 'checked_at', label: 'Date / heure', type: 'datetime', default: () => localNow() },
        { name: 'comment', label: 'Commentaire', full: true },
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
    title: 'Étiquettes DLC', icon: '🏷️', group: 'Traçabilité',
    render: async (main) => {
      const presets = await api('/shelf-lives');
      await logPage({
      title: 'Étiquettes de traçabilité (DLC secondaire)',
      intro: 'Produits entamés, fabriqués ou décongelés : la DLC secondaire est calculée automatiquement. Imprimez l\'étiquette après enregistrement.',
      endpoint: '/labels', register: 'labels',
      fields: [
        { name: 'product', label: 'Produit', required: true },
        { name: 'kind', label: 'Type', type: 'select', required: true, options: Object.entries(LABEL_KIND) },
        { name: 'start_at', label: 'Date d\'ouverture / fabrication', type: 'datetime', required: true, default: () => localNow() },
        { name: 'shelf_life_days', label: 'Durée de vie (jours)', type: 'number', step: '1', required: true, default: 3 },
        { name: 'lot_number', label: 'N° de lot' },
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
    title: 'Nuisibles', icon: '🐭', group: 'Traçabilité',
    render: (main) => logPage({
      title: 'Plan de lutte contre les nuisibles',
      endpoint: '/pest-controls', register: 'pests', photos: 'pest_controls',
      fields: [
        { name: 'kind', label: 'Contrôle', required: true, placeholder: 'Passage prestataire, contrôle appâts...' },
        { name: 'provider', label: 'Prestataire' },
        { name: 'compliant', label: 'Aucune trace de nuisibles', type: 'checkbox', default: true },
        { name: 'checked_at', label: 'Date / heure', type: 'datetime', default: () => localNow() },
        { name: 'findings', label: 'Constats', type: 'textarea', full: true },
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
  nonconformities: { title: 'Non-conformités', icon: '⚠️', group: 'Traçabilité', render: ncPage },
  allergens: { title: 'Allergènes', icon: '🥜', group: 'Traçabilité', render: allergensPage },
  trainings: {
    title: 'Formations', icon: '🎓', group: 'Traçabilité',
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
  reports: { title: 'Rapports / Contrôle', icon: '📄', group: 'Gestion', render: reportsPage },
  equipment: {
    title: 'Équipements', icon: '🧊', group: 'Gestion',
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
    title: 'Plan de nettoyage', icon: '📋', group: 'Gestion',
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
    title: 'Fournisseurs', icon: '🚚', group: 'Gestion',
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
    title: 'Durées de vie', icon: '⏳', group: 'Gestion',
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
  billing: { title: 'Abonnement', icon: '💳', group: 'Gestion', role: 'admin', render: billingPage },
  settings: { title: 'Paramètres', icon: '⚙️', group: 'Gestion', render: settingsPage },
};

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

async function ncPage(main) {
  let status = 'open';
  main.innerHTML = `<h1>Non-conformités et actions correctives</h1>
    <p class="muted">Les non-conformités sont créées automatiquement lors d'un relevé hors limite. Chacune doit être clôturée avec l'action corrective mise en œuvre.</p>
    <div class="card"><h2>Déclarer une non-conformité</h2><div data-form></div></div>
    <div class="card"><div class="row"><h2>Liste</h2><span class="spacer"></span>
      <select data-status style="width:auto"><option value="open">Ouvertes</option><option value="closed">Clôturées</option><option value="">Toutes</option></select></div>
      <div data-list></div></div>`;
  const fields = [
    { name: 'description', label: 'Description', required: true, full: true },
    { name: 'corrective_action', label: 'Action corrective immédiate', full: true },
  ];
  const box = main.querySelector('[data-form]');
  box.innerHTML = formHtml(fields, {}, 'Déclarer');
  const sendPhotos = attachPhotoInput(box.querySelector('form'));
  bindForm(box, fields, async (data, form) => {
    const nc = await api('/non-conformities', { method: 'POST', body: data });
    const n = await sendPhotos('non_conformities', nc.id);
    form.reset();
    toast(`Déclarée${n ? ` avec ${n} photo(s)` : ''}`);
    load();
    refreshBadge();
  });
  const list = main.querySelector('[data-list]');
  const load = async () => {
    const rows = await api(`/non-conformities${status ? `?status=${status}` : ''}`);
    list.innerHTML = tableHtml([
      { label: 'Date', get: (r) => fmtDT(r.created_at) },
      { label: 'Description', get: (r) => r.description },
      { label: 'Action corrective', get: (r) => r.corrective_action },
      { label: 'Statut', html: (r) => (r.status === 'open' ? '<span class="pill bad">Ouverte</span>' : `<span class="pill ok">Clôturée</span><div class="muted">${esc(fmtDT(r.closed_at))} – ${esc(r.closed_by_name)}</div>`) },
      photoCell('non_conformities'),
      { label: '', html: (r) => (r.status === 'open' ? `<button class="small" data-close="${r.id}">Clôturer</button>` : '') },
    ], rows);
    bindGalleries(list, load);
    list.querySelectorAll('[data-close]').forEach((b) => {
      b.onclick = () => {
        const nc = rows.find((r) => r.id === Number(b.dataset.close));
        const f = [{ name: 'corrective_action', label: 'Action corrective réalisée', type: 'textarea', required: true, full: true }];
        const dlg = modal('Clôturer la non-conformité', `<p>${esc(nc.description)}</p>${formHtml(f, nc, 'Clôturer')}`);
        bindForm(dlg, f, async (data) => {
          await api(`/non-conformities/${nc.id}/close`, { method: 'POST', body: data });
          dlg.close(); toast('Clôturée ✓'); load(); refreshBadge();
        });
      };
    });
  };
  main.querySelector('[data-status]').onchange = (e) => { status = e.target.value; load(); };
  await load();
}

async function allergensPage(main) {
  const all = state.ref.allergens;
  const fields = [
    { name: 'name', label: 'Nom du plat', required: true },
    { name: 'description', label: 'Ingrédients', type: 'textarea', full: true },
  ];
  const render = async () => {
    const recipes = await api('/recipes');
    main.innerHTML = `<h1>Allergènes</h1>
      <p class="muted">Tableau des 14 allergènes réglementaires (règlement INCO) à tenir à disposition des clients. Imprimez-le pour l'afficher en salle.</p>
      <div class="card no-print"><div class="row"><span class="spacer"></span><button class="secondary" onclick="window.print()">Imprimer le tableau</button>${can('manager') ? '<button data-add>+ Ajouter un plat</button>' : ''}</div></div>
      <div class="card"><h2>${esc(state.org?.name || '')} – Allergènes présents dans nos plats</h2>
      ${recipes.length ? `<div class="table-wrap"><table class="matrix"><thead><tr><th>Plat</th>${all.map((a) => `<th class="rot">${esc(a)}</th>`).join('')}${can('manager') ? '<th class="no-print"></th>' : ''}</tr></thead>
        <tbody>${recipes.map((r) => `<tr><td><strong>${esc(r.name)}</strong><div class="muted">${esc(r.description)}</div></td>
        ${all.map((a) => `<td class="x">${r.allergens.includes(a) ? '●' : ''}</td>`).join('')}
        ${can('manager') ? `<td class="no-print"><button class="secondary small" data-edit="${r.id}">Modifier</button></td>` : ''}</tr>`).join('')}</tbody></table></div>` : '<p class="muted">Aucun plat enregistré.</p>'}</div>`;
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
        dlg.close(); toast('Enregistré ✓'); render();
      });
    };
    main.querySelector('[data-add]')?.addEventListener('click', () => edit(null));
    main.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => edit(recipes.find((x) => x.id === Number(b.dataset.edit))); });
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
        if (location.hash === '#/temperatures') route(); else location.hash = '#/temperatures';
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
    history.replaceState(null, '', '#/dashboard');
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
    location.hash = signup ? (data.template ? '#/temperatures' : '#/equipment') : '#/dashboard';
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

async function refreshBadge() {
  try {
    state.openNc = (await api('/non-conformities?status=open')).length;
    const b = document.querySelector('[data-nc-badge]');
    if (b) { b.textContent = state.openNc; b.hidden = !state.openNc; }
  } catch { /* ignoré */ }
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
  if (state.user?.kiosk) {
    html = `<div class="kiosk-bar">👤 <strong>${esc(state.user.name)}</strong><span class="spacer"></span>
      <button class="secondary small" data-switch>🔄 Changer d'utilisateur</button></div>${html}`;
  }
  box.innerHTML = html;
  box.querySelector('[data-switch]')?.addEventListener('click', () => logout());
}

function renderShell() {
  const current = (location.hash.slice(2) || 'dashboard').split('?')[0];
  let group = '';
  const nav = Object.entries(pages).filter(([, p]) => !p.role || can(p.role)).map(([key, p]) => {
    const head = p.group !== group ? `<div class="nav-group">${esc((group = p.group))}</div>` : '';
    const badge = key === 'nonconformities' ? `<span class="badge" data-nc-badge ${state.openNc ? '' : 'hidden'}>${state.openNc}</span>` : '';
    return `${head}<a href="#/${key}" class="${key === current ? 'active' : ''}"><span>${p.icon}</span> ${esc(p.title)}${badge}</a>`;
  }).join('');
  app.innerHTML = `<div class="topbar"><button data-menu aria-label="Menu">☰</button><strong>${esc(pages[current]?.title || '')}</strong></div>
    <div class="layout"><nav class="sidebar">
      <div class="brand"><img src="/icon.svg" alt=""> Pack Hygiène</div>
      <div class="org-name">${esc(state.org?.name)}<br>${esc(state.user?.name)} · ${esc(ROLES[state.user?.role])}</div>
      ${nav}
      <div class="nav-group">Compte</div><a href="#" data-logout>${state.user?.kiosk ? '<span>🔄</span> Changer d\'utilisateur' : '<span>🚪</span> Déconnexion'}</a>
      <div class="nav-legal"><a href="/legal/cgv" target="_blank">CGV</a> · <a href="/legal/confidentialite" target="_blank">Confidentialité</a> · <a href="/legal/mentions" target="_blank">Mentions légales</a></div>
    </nav><main class="main"><div data-banner class="no-print"></div><div data-main></div></main></div>`;
  renderBanner();
  app.querySelector('[data-logout]').onclick = (e) => { e.preventDefault(); logout(); };
  app.querySelector('[data-menu]').onclick = () => app.querySelector('.sidebar').classList.toggle('open');
  app.querySelectorAll('.sidebar a').forEach((a) => a.addEventListener('click', () => app.querySelector('.sidebar').classList.remove('open')));
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
  if (key === 'login' || key === 'signup') { location.hash = '#/dashboard'; return; }
  try {
    if (!state.user) { await loadSession(); refreshBadge(); }
  } catch { return; }
  const page = pages[key] && (!pages[key].role || can(pages[key].role)) ? pages[key] : pages.dashboard;
  const main = renderShell();
  main.innerHTML = '<p class="muted">Chargement…</p>';
  try { await page.render(main); } catch (e) { main.innerHTML = `<p class="pill bad">${esc(e.message)}</p>`; }
  askTermsIfNeeded();
  armKioskIdle();
}

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
