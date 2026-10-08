// Briques communes de l'interface : état, appels API, formulaires, fenêtres.
// (Pas de dépendance, pas d'étape de compilation : modules ES chargés par le navigateur.)

import { ico } from './icons.js';

/** Points d'accroche renseignés par app.js (évite une dépendance circulaire). */
export const hooks = { logout() {}, route() {} };

export const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* stockage indisponible */ } },
};
export const state = { deviceToken: store.get('deviceToken'), token: localStorage.getItem('token'), user: null, org: null, access: null, ref: null, openNc: 0 };
export const app = document.getElementById('app');

// ---------------------------------------------------------------- utilitaires
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmtDT = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '');
export const fmtD = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
export const pad = (n) => String(n).padStart(2, '0');
export const localNow = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const isoDay = (offset = 0) => { const d = new Date(Date.now() + offset * 86400000); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const conf = (c) => (c ? '<span class="pill ok">Conforme</span>' : '<span class="pill bad">Non conforme</span>');
export const can = (role) => ({ employee: 1, manager: 2, admin: 3 })[state.user?.role] >= ({ employee: 1, manager: 2, admin: 3 })[role];
export const FREQ = { daily: 'Quotidienne', weekly: 'Hebdomadaire', monthly: 'Mensuelle', after_use: 'Après utilisation' };
export const LABEL_KIND = { opened: 'Ouverture', prepared: 'Fabrication', defrosted: 'Décongélation' };
export const ROLES = { admin: 'Administrateur', manager: 'Responsable', employee: 'Employé' };

/** « Marie Dupont (gérante) » → « Marie ». */
export const firstName = (name) => String(name || '').trim().split(/[\s(]/)[0] || '';
export const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
export const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
/** Température à la française : 3,2 ; -18 ; 63. */
export const fmtTemp = (v) => String(Math.round(v * 10) / 10).replace('.', ',');

/** « il y a 5 min », « il y a 2 h », « hier ». */
export function ago(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(min) || min < 1) return 'à l\'instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'hier' : `il y a ${d} jours`;
}

/** « vendredi 8 octobre », première lettre en majuscule. */
export function longDate(date = new Date()) {
  const t = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Vibration brève (si l'appareil le permet) : confirme un geste sans regarder l'écran. */
export function buzz(pattern = 20) {
  try { navigator.vibrate?.(pattern); } catch { /* vibration indisponible */ }
}

/** Message de confirmation discret en bas de l'écran (snackbar). */
export function toast(msg, error = false) {
  const t = document.getElementById('toast');
  t.innerHTML = `${ico(error ? 'error' : 'check_circle', { fill: true })}<span></span>`;
  t.querySelector('span').textContent = msg;
  t.className = `show${error ? ' error' : ''}`;
  buzz(error ? [60, 40, 60] : 20);
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.className = ''; }, error ? 4500 : 3000);
}

export async function api(path, { method = 'GET', body, raw } = {}) {
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
      if (state.token && state.user?.kiosk) { hooks.logout(); throw new Error('Cette tablette a été retirée'); }
      if (kioskCall) { hooks.route(); throw new Error('Cette tablette a été retirée'); }
    }
    if (state.token && !kioskCall) { hooks.logout(); throw new Error('Session expirée'); }
  }
  if ([502, 503, 504].includes(res.status)) throw new Error('Mise à jour du service en cours : réessayez dans quelques secondes');
  if (raw) { if (!res.ok) throw new Error('Téléchargement impossible'); return res; }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur');
  return data;
}

export async function download(path, filename) {
  try {
    const res = await api(path, { raw: true });
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { toast(e.message, true); }
}

/** Convertit les valeurs d'un formulaire selon la définition des champs. */
export function readForm(form, fields) {
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

export function fieldHtml(f, value) {
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
    input = `<input type="${type}" name="${f.name}" value="${esc(val)}" ${req} ${f.type === 'number' ? `step="${f.step || 'any'}" inputmode="decimal"${f.min != null ? ` min="${f.min}"` : ''}` : ''} placeholder="${esc(f.placeholder || '')}">`;
  }
  return `<label class="${cls}">${esc(f.label)}${f.required ? ' *' : ''}${input}</label>`;
}

/**
 * Formulaire : les champs essentiels d'abord, les champs `advanced: true` repliés
 * sous « Plus de détails ». Ne marquez « advanced » que les champs dont la valeur
 * par défaut est sûre (date = maintenant, commentaire vide) : un champ replié est
 * envoyé tel quel, sans que la personne le relise.
 */
export function formHtml(fields, values = {}, submit = 'Enregistrer') {
  const main = fields.filter((f) => !f.advanced || f.type === 'hidden');
  const more = fields.filter((f) => f.advanced && f.type !== 'hidden');
  return `<form class="form">${main.map((f) => fieldHtml(f, values[f.name])).join('')}
    ${more.length ? `<details class="more full"><summary>Plus de détails</summary><div class="form">${more.map((f) => fieldHtml(f, values[f.name])).join('')}</div></details>` : ''}
    <div class="submit"><button type="submit" class="big">${esc(submit)}</button></div></form>`;
}

export function tableHtml(columns, rows, { rowClass } = {}) {
  if (!rows.length) return '<p class="muted">Aucun enregistrement.</p>';
  return `<div class="table-wrap"><table><thead><tr>${columns.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr class="${rowClass ? rowClass(r) : ''}">${columns.map((c) => `<td>${c.html ? c.html(r) : esc(c.get(r))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function bindForm(root, fields, onSubmit) {
  const form = root.querySelector('form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try { await onSubmit(readForm(form, fields), form); } catch (err) { toast(err.message, true); } finally { btn.disabled = false; }
  });
  return form;
}

export function modal(title, html) {
  const dlg = document.createElement('dialog');
  dlg.innerHTML = `<div class="row"><h2>${esc(title)}</h2><span class="spacer"></span><button class="icon-btn" data-close aria-label="Fermer">${ico('close')}</button></div>${html}`;
  document.body.append(dlg);
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  return dlg;
}

export async function refreshBadge() {
  try {
    state.openNc = (await api('/non-conformities?status=open')).length;
    const b = document.querySelector('[data-nc-badge]');
    if (b) { b.textContent = state.openNc; b.hidden = !state.openNc; }
  } catch { /* ignoré */ }
}
