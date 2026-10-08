// Écrans principaux, pensés pour l'équipe de cuisine : Aujourd'hui, Saisir, Alertes, Plus.
// Principe : dire clairement quoi faire maintenant, un geste par tâche, un retour immédiat.

import {
  state, store, esc, can, api, toast, buzz, modal, refreshBadge, hooks, firstName, plural, fmtTemp, num, ago, longDate,
  fmtDT, tableHtml,
} from './core.js';
import { ico } from './icons.js';
import { attachPhotoInput, bindGalleries, photoCell } from './photos.js';

export const EQUIP_ICON = { fridge: 'kitchen', cold_room: 'ac_unit', freezer: 'severe_cold', display: 'storefront', hot_holding: 'heat' };
const FREQ_SHORT = { daily: 'Chaque jour', weekly: 'Chaque semaine', monthly: 'Chaque mois', after_use: 'Après usage' };
const WEEKDAY = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const WEEKDAY_LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const DAY_STATE = {
  done: 'relevés complets', missed: 'relevés incomplets', off: 'aucun relevé (fermé ?)', none: '', today: 'aujourd\'hui', partial: 'aujourd\'hui, en cours',
};
const DAY_ICON = { done: 'check', missed: 'priority_high', off: 'remove', partial: 'schedule' };
const hhmm = (iso) => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// ------------------------------------------------------------------ températures

/** Lit « 3,5 », « -18 », « 20 » (signe apporté par la touche −) ; null si illisible. */
export function parseTemp(raw, negative) {
  const m = /^([-−+])?(\d+(?:[.,]\d+)?|[.,]\d+)$/.exec(String(raw).trim());
  if (!m) return null;
  let v = Number(m[2].replace(',', '.'));
  if (m[1] === '-' || m[1] === '−') v = -v;
  else if (!m[1] && negative) v = -v; // un signe tapé explicitement l'emporte sur la touche −
  return v;
}

function rangeText(e) {
  const lo = num(e.min_temp);
  const hi = num(e.max_temp);
  if (lo != null && hi != null) return `entre ${fmtTemp(lo)} et ${fmtTemp(hi)} °C`;
  if (hi != null) return `${fmtTemp(hi)} °C maximum`;
  if (lo != null) return `${fmtTemp(lo)} °C minimum`;
  return 'sans limite définie';
}

function judge(e, v) {
  const lo = num(e.min_temp);
  const hi = num(e.max_temp);
  if (hi != null && v > hi) return { ok: false, why: 'trop chaud' };
  if (lo != null && v < lo) return { ok: false, why: 'trop froid' };
  return { ok: true };
}

const defaultNegative = (e) => num(e.max_temp) != null && num(e.max_temp) < 0; // congélateurs

/** Carte de relevé : un grand champ, la touche −, un retour immédiat pendant la frappe. */
export function tempCardHtml(e, draft = {}) {
  const neg = draft.neg ?? defaultNegative(e);
  const info = e.done
    ? `<span class="chip-done">${ico('check')}${fmtTemp(e.reading.value)} °C à ${hhmm(e.reading.at)}</span>`
    : esc(e.previous ? `Dernier relevé : ${fmtTemp(e.previous.value)} °C` : 'Premier relevé');
  return `<form class="task temp${e.done ? ' is-done' : ''}" data-eq="${e.id}">
    <div class="task-head"><span class="ico-box">${ico(EQUIP_ICON[e.type] || 'thermostat')}</span>
      <div><strong>${esc(e.name)}</strong><small>${esc(cap(rangeText(e)))}</small><small>${info}</small></div></div>
    <div class="temp-row">
      <button type="button" class="sign${neg ? ' on' : ''}" data-sign aria-pressed="${neg}" aria-label="Température négative (moins)">−</button>
      <div class="temp-field"><input class="temp-input" inputmode="decimal" autocomplete="off" enterkeyhint="done" placeholder="0,0"
        aria-label="Température de ${esc(e.name)}" value="${esc(draft.text ?? '')}"><span class="unit">°C</span></div>
      <button type="submit" class="go">Valider</button>
    </div>
    <p class="hint" aria-live="polite"></p>
  </form>`;
}

/**
 * Branche les cartes de relevé d'un conteneur (délégation : les cartes peuvent être
 * redessinées sans rebrancher). getList renvoie les équipements à jour.
 */
export function bindTempCards(root, getList, { drafts = {}, onSaved } = {}) {
  const find = (form) => getList().find((e) => e.id === Number(form.dataset.eq));
  const negative = (form) => form.querySelector('[data-sign]').classList.contains('on');
  const reading = (form) => parseTemp(form.querySelector('.temp-input').value, negative(form));

  const say = (form, kind, icon, text) => {
    const out = form.querySelector('.hint');
    out.className = kind ? `hint ${kind}` : 'hint';
    out.innerHTML = text ? `${icon ? ico(icon, { fill: true }) : ''}<span>${esc(text)}</span>` : '';
  };
  const showHint = (form) => {
    const raw = form.querySelector('.temp-input').value.trim();
    if (!raw) { say(form, '', '', ''); return; }
    const v = reading(form);
    if (v == null) { say(form, '', '', 'Saisissez uniquement des chiffres, par exemple 3,5'); return; }
    const e = find(form);
    const j = judge(e, v);
    if (j.ok) say(form, 'ok', 'check_circle', `${fmtTemp(v)} °C : conforme`);
    else say(form, 'bad', 'error', `${fmtTemp(v)} °C : ${j.why} (${rangeText(e)})`);
  };
  // Les brouillons survivent au redessin de la page (ex. on valide une carte pendant qu'on tape dans une autre) :
  // l'appelant invoque refresh() après chaque redessin pour réafficher les indications.
  const refresh = () => root.querySelectorAll('form.temp').forEach(showHint);

  root.addEventListener('input', (ev) => {
    const form = ev.target.closest?.('form.temp');
    if (!form || !ev.target.matches('.temp-input')) return;
    drafts[form.dataset.eq] = { ...drafts[form.dataset.eq], text: ev.target.value, neg: negative(form) };
    showHint(form);
  });

  root.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-sign]');
    if (!btn) return;
    const form = btn.closest('form');
    btn.classList.toggle('on');
    btn.setAttribute('aria-pressed', String(btn.classList.contains('on')));
    drafts[form.dataset.eq] = { ...drafts[form.dataset.eq], neg: btn.classList.contains('on') };
    showHint(form);
    form.querySelector('.temp-input').focus();
  });

  root.addEventListener('submit', async (ev) => {
    const form = ev.target.closest?.('form.temp');
    if (!form) return;
    ev.preventDefault();
    const e = find(form);
    const v = reading(form);
    if (v == null) {
      say(form, 'bad', 'error', 'Saisissez la température affichée sur l\'appareil');
      form.querySelector('.temp-input').focus();
      return;
    }
    const btn = form.querySelector('.go');
    btn.disabled = true;
    try {
      const row = await api('/temperatures', { method: 'POST', body: { equipment_id: e.id, value: v } });
      delete drafts[e.id];
      if (row.compliant) {
        toast(`${e.name} : ${fmtTemp(v)} °C enregistré`);
      } else {
        buzz([60, 40, 60]);
        refreshBadge();
        if (row.non_conformity_id) {
          await actionSheet({ id: row.non_conformity_id, title: `${e.name} : ${fmtTemp(v)} °C`, detail: `${cap(judge(e, v).why)} : la norme est ${rangeText(e)}`, kind: 'temp' });
        }
      }
      await onSaved?.(row, e, v);
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  });
  return { refresh };
}

// ------------------------------------------------------------------ alertes : que faire ?

const ACTIONS = {
  temp: ['Produits transférés', 'Porte vérifiée et refermée', 'Thermostat réglé', 'Technicien appelé', 'Produits jetés'],
  reception: ['Livraison refusée', 'Produit isolé', 'Produit jeté', 'Fournisseur prévenu', 'Avoir demandé'],
  process: ['Produit jeté', 'Refroidissement ou remise en température refait', 'Responsable prévenu'],
  other: ['Produit jeté', 'Produit isolé', 'Équipement réglé', 'Technicien appelé', 'Responsable prévenu'],
};
export const actionKind = (source) => ({ temperature_logs: 'temp', receptions: 'reception', process_logs: 'process' })[source] || 'other';

/**
 * Feuille « Action corrective » : des choix en un toucher plutôt qu'un champ à remplir.
 * Deux issues : « Clôturer l'alerte » ou « Noter l'action, alerte à suivre » (elle reste ouverte).
 * Renvoie une promesse résolue à la fermeture de la feuille.
 */
export function actionSheet({ id, title, detail = '', action = '', kind = 'other' }) {
  return new Promise((resolve) => {
    const chips = ACTIONS[kind] || ACTIONS.other;
    const dlg = modal('Action corrective', `
      <div class="sheet-alert">${ico('warning', { fill: true })}<div><strong>${esc(title)}</strong>${detail ? `<p>${esc(detail)}</p>` : ''}</div></div>
      ${action ? `<p class="noted">Déjà noté : <b>${esc(action)}</b></p>` : ''}
      <p class="sheet-q">Quelle action avez-vous menée ?</p>
      <div class="chips" data-chips>${chips.map((c) => `<button type="button" class="chip" aria-pressed="false">${esc(c)}</button>`).join('')}</div>
      <label>Précision (facultatif)<input data-note maxlength="300" autocomplete="off"></label>
      <div class="sheet-actions">
        <button type="button" class="big" data-solve>${ico('check')}Clôturer l'alerte</button>
        <button type="button" class="secondary big" data-follow>Noter l'action, alerte à suivre</button>
        <button type="button" class="link" data-later>Plus tard</button>
      </div>`);
    dlg.dataset.sheet = '1';
    dlg.addEventListener('close', () => resolve());
    dlg.querySelector('[data-chips]').addEventListener('click', (ev) => {
      const chip = ev.target.closest('.chip');
      if (!chip) return;
      const on = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', String(on));
    });
    const typed = () => [...dlg.querySelectorAll('.chip[aria-pressed=true]')].map((c) => c.textContent)
      .concat(dlg.querySelector('[data-note]').value.trim()).filter(Boolean).join(' · ');
    const run = async (fn) => {
      const buttons = dlg.querySelectorAll('button');
      buttons.forEach((b) => { b.disabled = true; });
      try { await fn(); refreshBadge(); dlg.close(); } catch (e) { toast(e.message, true); buttons.forEach((b) => { b.disabled = false; }); }
    };
    dlg.querySelector('[data-solve]').onclick = () => {
      const text = typed() || action;
      if (!text) { toast('Indiquez l\'action menée', true); return; }
      run(async () => {
        await api(`/non-conformities/${id}/close`, { method: 'POST', body: { corrective_action: text } });
        toast('Alerte clôturée');
      });
    };
    dlg.querySelector('[data-follow]').onclick = () => {
      const text = typed();
      if (!text) { toast('Indiquez l\'action menée', true); return; }
      run(async () => {
        await api(`/non-conformities/${id}/action`, { method: 'PUT', body: { corrective_action: text } });
        toast('Action enregistrée : l\'alerte reste ouverte');
      });
    };
    dlg.querySelector('[data-later]').onclick = () => dlg.close();
  });
}

/** « Signaler un problème » : une phrase et, si possible, une photo. */
export function reportProblem(onDone) {
  const dlg = modal('Signaler un problème', `<form class="form">
    <label class="full">Que se passe-t-il ?
      <textarea name="description" required maxlength="500" placeholder="Ex. Emballage percé sur la livraison de poulet"></textarea></label>
    <div class="submit"><button type="submit" class="big">Envoyer le signalement</button></div></form>`);
  const form = dlg.querySelector('form');
  const sendPhotos = attachPhotoInput(form);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const nc = await api('/non-conformities', { method: 'POST', body: { description: form.elements.description.value } });
      await sendPhotos('non_conformities', nc.id);
      dlg.close();
      toast('Problème signalé');
      refreshBadge();
      onDone?.(nc);
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  });
}

// ------------------------------------------------------------------ Aujourd'hui

const greet = () => { const h = new Date().getHours(); return h >= 18 || h < 5 ? 'Bonsoir' : 'Bonjour'; };

function ringHtml(done, total) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const complete = total && done === total;
  return `<div class="ring" role="img" aria-label="${done} tâche${done > 1 ? 's' : ''} terminée${done > 1 ? 's' : ''} sur ${total}">
    <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="track" cx="60" cy="60" r="${r}"/>
      <circle class="bar" cx="60" cy="60" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c}" data-circ="${c}"/></svg>
    <div class="ring-num">${complete ? ico('check') : `<b>${done}</b><span>sur ${total}</span>`}</div></div>`;
}

function statusText(d) {
  const { done, total } = d.progress;
  const left = total - done;
  if (!total) return can('manager') ? 'Ajoutez vos équipements pour démarrer.' : 'Aucune tâche prévue pour le moment.';
  if (left <= 0) {
    return d.alerts.count ? `Tâches terminées. ${plural(d.alerts.count, 'alerte à traiter', 'alertes à traiter')}.` : 'Toutes les tâches du jour sont terminées.';
  }
  return `${plural(left, 'tâche restante', 'tâches restantes')} aujourd'hui.`;
}

function weekHtml(week) {
  return `<ol class="week" aria-label="Les sept derniers jours">${week.map((w) => {
    const dow = new Date(`${w.day}T12:00:00Z`).getUTCDay();
    return `<li class="day ${w.state}" aria-label="${WEEKDAY_LONG[dow]} : ${DAY_STATE[w.state]}"><span class="dot">${ico(DAY_ICON[w.state] || '')}</span><small>${WEEKDAY[dow]}</small></li>`;
  }).join('')}</ol>`;
}

/** Suivi de la régularité : masqué tant qu'il n'y a aucun historique à montrer. */
function weekCardHtml(d) {
  const n = d.streak;
  if (!n && d.week.every((w) => w.state === 'none' || w.state === 'today')) return '';
  const title = n >= 2 ? `${n} jours consécutifs` : 'Cette semaine';
  const sub = n >= 2 ? 'Tous les équipements relevés chaque jour' : n === 1 ? 'Première journée complète' : 'Relevés des sept derniers jours';
  return `<section class="week-card"><div class="week-head">${ico('event_available')}<div><strong>${title}</strong><small>${sub}</small></div></div>${weekHtml(d.week)}</section>`;
}

export function cleanCardHtml(t) {
  const how = [t.product ? `<p><b>Produit :</b> ${esc(t.product)}</p>` : '', t.method ? `<p>${esc(t.method)}</p>` : ''].join('');
  return `<article class="task clean" data-task="${t.id}">
    <div class="task-head"><span class="ico-box">${ico('cleaning_services')}</span><div><strong>${esc(t.name)}</strong><small>${esc(t.zone)} · ${FREQ_SHORT[t.frequency]}</small></div></div>
    ${how ? `<details class="how"><summary>Comment faire ?</summary>${how}</details>` : ''}
    <button type="button" class="go wide" data-clean="${t.id}">${ico('check')}Marquer comme fait</button></article>`;
}

function firstStepsHtml(d) {
  const f = d.firstSteps;
  if (!f || f.age_days > 30 || store.get('hideFirstSteps') === '1') return '';
  const steps = [
    { ok: f.equipment > 0, text: 'Vérifier vos équipements', href: '#/equipment' },
    { ok: f.readings > 0, text: 'Faire un premier relevé de température' },
    { ok: f.members > 1, text: 'Ajouter votre équipe', href: '#/settings' },
    { ok: f.devices > 0, text: 'Installer la tablette de cuisine', href: '#/settings' },
  ];
  const n = steps.filter((s) => s.ok).length;
  if (n === steps.length) return '';
  return `<section class="block first-steps"><h2>Pour bien démarrer <small>${n}/${steps.length}</small></h2>
    <ul>${steps.map((s) => `<li class="${s.ok ? 'ok' : ''}">${ico(s.ok ? 'task_alt' : 'radio_button_unchecked', { fill: s.ok })}${s.href && !s.ok ? `<a href="${s.href}">${esc(s.text)}</a>` : esc(s.text)}</li>`).join('')}</ul>
    <button type="button" class="link" data-hide-first>Masquer</button></section>`;
}

export async function todayPage(main) {
  const wrap = document.createElement('div');
  wrap.className = 'today-page';
  main.replaceChildren(wrap);
  const drafts = {};
  let data = null;
  let shownRatio = 0;

  const render = () => {
    const d = data;
    const { done, total } = d.progress;
    const complete = total > 0 && done === total;
    const pending = d.temperatures.filter((t) => !t.done);
    const doneTemps = d.temperatures.filter((t) => t.done);
    const dueClean = d.cleaning.filter((t) => t.due);
    const doneClean = d.cleaning.filter((t) => t.done && t.frequency !== 'after_use');
    const nDone = doneTemps.length + doneClean.length;

    const alertCard = d.alerts.count
      ? `<a class="alert-card" href="#/nonconformities">${ico('warning', { fill: true })}
          <div><strong>${plural(d.alerts.count, 'alerte à traiter', 'alertes à traiter')}</strong><p>${esc(d.alerts.items[0].description)}</p></div>${ico('chevron_right')}</a>` : '';
    const allDone = (text) => `<p class="all-done">${ico('check_circle', { fill: true })}${text}</p>`;
    const tempBlock = d.temperatures.length ? `<section class="block"><h2><span>Relevés de température</span><small>${doneTemps.length}/${d.temperatures.length}</small></h2>
        ${pending.length ? pending.map((t) => tempCardHtml(t, drafts[t.id])).join('') : allDone('Tous les relevés sont effectués')}</section>` : '';
    const cleanBlock = dueClean.length || doneClean.length ? `<section class="block"><h2><span>Nettoyage</span><small>${doneClean.length}/${doneClean.length + dueClean.length}</small></h2>
        ${dueClean.length ? dueClean.map(cleanCardHtml).join('') : allDone('Tout est nettoyé')}</section>` : '';
    const doneBlock = nDone ? `<details class="block done-list"><summary>${ico('task_alt')}Effectué aujourd'hui (${nDone})</summary><ul>
        ${doneTemps.map((t) => `<li>${esc(t.name)} <span>${fmtTemp(t.reading.value)} °C${t.reading.compliant ? '' : ' (hors norme)'} · ${hhmm(t.reading.at)}</span></li>`).join('')}
        ${doneClean.map((t) => `<li>${esc(t.name)} <span>${hhmm(t.done_at)}</span></li>`).join('')}</ul></details>` : '';
    const labelBlock = d.labels.length ? `<section class="block"><h2>Dates limites à surveiller</h2><ul class="watch">${d.labels.map((l) =>
      `<li><span><b>${esc(l.product)}</b>${l.lot_number ? ` <small>lot ${esc(l.lot_number)}</small>` : ''}</span>
        <span class="pill ${l.when === 'today' ? 'bad' : 'warn'}">DLC ${l.when === 'today' ? 'aujourd\'hui' : 'demain'}</span></li>`).join('')}</ul></section>` : '';
    const empty = !total && !d.alerts.count ? `<div class="empty"><span class="empty-ico">${ico('task_alt')}</span><h2>Rien à faire pour l'instant</h2>
        <p>${can('manager') ? 'Ajoutez vos équipements et votre plan de nettoyage pour voir vos tâches du jour.' : 'Aucune tâche n\'est prévue aujourd\'hui.'}</p>
        ${can('manager') ? '<a class="btn" href="#/equipment">Ajouter mes équipements</a>' : ''}</div>` : '';

    wrap.innerHTML = `
      <div class="today-side">
        <section class="hero${complete ? ' complete' : ''}">
          <div class="hero-text"><p class="date">${esc(longDate())}</p><h1>${greet()} ${esc(firstName(state.user?.name))}</h1><p class="status">${esc(statusText(d))}</p></div>
          ${total ? ringHtml(done, total) : ''}
        </section>
        ${weekCardHtml(d)}${alertCard}
      </div>
      <div class="today-main">
        ${tempBlock}${cleanBlock}${empty}${firstStepsHtml(d)}${doneBlock}${labelBlock}
        <a class="btn secondary wide" href="#/saisir">${ico('add')}Autre saisie : réception, étiquette…</a>
      </div>`;

    // La jauge se remplit en douceur depuis sa valeur précédente.
    const bar = wrap.querySelector('.ring .bar');
    if (bar) {
      const circ = Number(bar.dataset.circ);
      const target = total ? done / total : 0;
      bar.style.strokeDashoffset = String(circ * (1 - shownRatio));
      requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.strokeDashoffset = String(circ * (1 - target)); }));
      shownRatio = target;
    }
    temps.refresh();
  };

  const load = async ({ announce = false } = {}) => {
    const before = data?.progress;
    data = await api('/today');
    render();
    refreshBadge();
    const complete = data.progress.total > 0 && data.progress.done === data.progress.total;
    if (announce && before && before.done < before.total && complete) toast('Toutes les tâches du jour sont terminées');
  };

  const temps = bindTempCards(wrap, () => data?.temperatures || [], { drafts, onSaved: () => load({ announce: true }) });
  wrap.addEventListener('click', async (ev) => {
    const clean = ev.target.closest('[data-clean]');
    if (clean) {
      clean.disabled = true;
      try {
        await api('/cleaning-logs', { method: 'POST', body: { task_id: Number(clean.dataset.clean) } });
        toast('Nettoyage enregistré');
        await load({ announce: true });
      } catch (err) {
        toast(err.message, true);
        clean.disabled = false;
      }
      return;
    }
    if (ev.target.closest('[data-hide-first]')) { store.set('hideFirstSteps', '1'); render(); }
  });

  // Tablette laissée ouverte toute la journée : on se remet à jour au retour sur la page.
  const onVisible = () => {
    if (!wrap.isConnected) { document.removeEventListener('visibilitychange', onVisible); return; }
    if (!document.hidden) load().catch(() => {});
  };
  document.addEventListener('visibilitychange', onVisible);

  await load();
}

// ------------------------------------------------------------------ listes de choix (Saisir, Plus)

/** Une ligne de liste : pictogramme, titre, précision, flèche. `alarm` pour une action d'urgence. */
function segItem(t) {
  const inner = `<span class="seg-lead">${ico(t.icon)}</span><span class="seg-text"><strong>${esc(t.title)}</strong>${t.sub ? `<small>${esc(t.sub)}</small>` : ''}</span>${t.action === 'logout' ? '' : ico('chevron_right')}`;
  const cls = `seg-item${t.alarm ? ' alarm' : ''}`;
  return t.href ? `<a class="${cls}" href="${t.href}">${inner}</a>` : `<button type="button" class="${cls}" data-action="${t.action}">${inner}</button>`;
}
const groupHtml = (g) => `<h2 class="group-title">${esc(g.title)}</h2><div class="seg">${g.items.map(segItem).join('')}</div>`;

// ------------------------------------------------------------------ Saisir

const CAPTURE = [
  { title: 'Chaque jour', items: [
    { href: '#/temperatures', icon: 'thermostat', title: 'Température', sub: 'Frigos, congélateurs, maintien au chaud' },
    { href: '#/cleaning', icon: 'cleaning_services', title: 'Nettoyage', sub: 'Cocher les tâches effectuées' },
  ] },
  { title: 'Réception et production', items: [
    { href: '#/receptions', icon: 'inventory_2', title: 'Réception', sub: 'Contrôler une livraison' },
    { href: '#/cooling', icon: 'ac_unit', title: 'Refroidissement', sub: 'Après la cuisson' },
    { href: '#/reheating', icon: 'heat', title: 'Remise en température', sub: 'Avant le service' },
    { href: '#/oil', icon: 'oil_barrel', title: 'Huile de friture', sub: 'Contrôler le bain' },
    { href: '#/labels', icon: 'label', title: 'Étiquette DLC', sub: 'Calculer et imprimer' },
  ] },
  { title: 'Autres contrôles', items: [
    { href: '#/pests', icon: 'pest_control', title: 'Nuisibles', sub: 'Contrôle ou passage du prestataire' },
  ] },
  { title: 'Anomalie', items: [
    { action: 'report', icon: 'report', title: 'Signaler un problème', sub: 'Avec une photo si possible', alarm: true },
  ] },
];

export function capturePage(main) {
  main.innerHTML = `<h1>Nouvelle saisie</h1>${CAPTURE.map(groupHtml).join('')}`;
  main.querySelector('[data-action=report]').addEventListener('click', () => reportProblem());
}

// ------------------------------------------------------------------ Alertes

export async function alertsPage(main) {
  const render = async () => {
    const open = await api('/non-conformities?status=open');
    main.innerHTML = `<h1>Alertes</h1>
      <p class="lead">Ce qui sort de la norme apparaît ici. Notez l'action menée pour chaque problème.</p>
      <div class="actions-top"><button type="button" class="big soft-bad" data-report>${ico('report')}Signaler un problème</button></div>
      <div data-open>${open.length ? open.map((nc) => `<article class="alert-item" data-nc="${nc.id}">
          <div class="alert-top"><span class="ico-box">${ico('warning', { fill: true })}</span><div><strong>${esc(nc.description)}</strong>
            <small>${esc(ago(nc.created_at))}${nc.created_by_name ? ` · ${esc(nc.created_by_name)}` : ''}</small></div></div>
          ${nc.corrective_action ? `<p class="noted">Action notée : <b>${esc(nc.corrective_action)}</b></p>` : ''}
          <div class="alert-actions">
            <button type="button" class="big" data-solve>${ico('check')}Marquer comme réglée</button>
            <button type="button" class="secondary" data-act>${ico('edit')}${nc.corrective_action ? 'Modifier l\'action' : 'Noter une action'}</button>
            <button type="button" class="secondary" data-gallery="non_conformities:${nc.id}" aria-label="Photos">${ico('photo_camera')}${nc.photo_count || 'Photo'}</button>
          </div></article>`).join('')
        : `<div class="empty"><span class="empty-ico">${ico('task_alt')}</span><h2>Aucune alerte en cours</h2><p>Tout est conforme pour le moment.</p></div>`}</div>
      <details class="block closed-list"><summary>${ico('history')}Alertes clôturées</summary><div data-closed><p class="muted">Chargement…</p></div></details>`;

    main.querySelector('[data-report]').onclick = () => reportProblem(render);
    bindGalleries(main.querySelector('[data-open]'), render);
    main.querySelectorAll('.alert-item').forEach((card) => {
      const nc = open.find((n) => n.id === Number(card.dataset.nc));
      const sheet = () => actionSheet({ id: nc.id, title: nc.description, action: nc.corrective_action || '', kind: actionKind(nc.source) }).then(render);
      card.querySelector('[data-act]').onclick = sheet;
      card.querySelector('[data-solve]').onclick = async () => {
        if (!nc.corrective_action) return sheet();
        try {
          await api(`/non-conformities/${nc.id}/close`, { method: 'POST', body: {} });
          toast('Alerte clôturée');
          refreshBadge();
          render();
        } catch (err) { toast(err.message, true); }
      };
    });

    const closedBox = main.querySelector('[data-closed]');
    main.querySelector('.closed-list').addEventListener('toggle', async (ev) => {
      if (!ev.target.open || closedBox.dataset.loaded) return;
      closedBox.dataset.loaded = '1';
      const rows = (await api('/non-conformities?status=closed')).slice(0, 30);
      closedBox.innerHTML = tableHtml([
        { label: 'Date', get: (r) => fmtDT(r.created_at) },
        { label: 'Problème', get: (r) => r.description },
        { label: 'Action', get: (r) => r.corrective_action },
        { label: 'Clôturée', get: (r) => `${fmtDT(r.closed_at)}${r.closed_by_name ? ` · ${r.closed_by_name}` : ''}` },
        photoCell('non_conformities'),
      ], rows);
      bindGalleries(closedBox);
    });
  };
  await render();
}

// ------------------------------------------------------------------ Plus

const MORE = [
  { title: 'Au service', items: [
    { href: '#/allergens', icon: 'no_food', title: 'Allergènes', sub: 'Quels plats contiennent quoi' },
  ] },
  { title: 'Gérer mon établissement', role: 'manager', items: [
    { href: '#/reports', icon: 'fact_check', title: 'Préparer un contrôle', sub: 'Classeur HACCP en PDF' },
    { href: '#/dashboard', icon: 'monitoring', title: 'Statistiques', sub: 'Conformité sur 30 jours' },
    { href: '#/equipment', icon: 'kitchen', title: 'Équipements', sub: 'Frigos, congélateurs et seuils' },
    { href: '#/cleaning-tasks', icon: 'checklist', title: 'Plan de nettoyage', sub: 'Tâches et fréquences' },
    { href: '#/suppliers', icon: 'local_shipping', title: 'Fournisseurs', sub: 'Carnet d\'adresses' },
    { href: '#/shelf-lives', icon: 'hourglass_top', title: 'Durées de vie', sub: 'DLC des préparations' },
    { href: '#/trainings', icon: 'school', title: 'Formations', sub: 'Suivi de l\'équipe' },
  ] },
  { title: 'Mon compte', items: [
    { href: '#/settings', icon: 'settings', title: 'Paramètres', sub: 'Équipe, rappels, tablette', role: 'manager' },
    { href: '#/settings', icon: 'pin', title: 'Mon code PIN', sub: 'Et mot de passe', notRole: 'manager' },
    { href: '#/billing', icon: 'credit_card', title: 'Abonnement', sub: 'Offre et factures', role: 'admin', hideIfManaged: true },
    { action: 'logout', icon: 'logout', title: 'Se déconnecter', sub: '' },
  ] },
];

export function morePage(main) {
  const kiosk = !!state.user?.kiosk;
  const sections = MORE.filter((s) => !s.role || can(s.role)).map((s) => ({
    ...s,
    items: s.items.filter((i) => (!i.role || can(i.role)) && (!i.notRole || !can(i.notRole)) && !(i.hideIfManaged && (state.access?.managed || state.access?.state === 'unlimited'))).map((i) => (
      i.action === 'logout' && kiosk ? { ...i, icon: 'swap_horiz', title: 'Changer d\'utilisateur' } : i)),
  })).filter((s) => s.items.length);
  main.innerHTML = `<h1>Plus</h1>${sections.map(groupHtml).join('')}
    <p class="legal-links"><a href="/legal/cgv" target="_blank">CGV</a> · <a href="/legal/confidentialite" target="_blank">Confidentialité</a> · <a href="/legal/mentions" target="_blank">Mentions légales</a></p>`;
  main.querySelector('[data-action=logout]')?.addEventListener('click', () => hooks.logout());
}
