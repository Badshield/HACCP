import { state, esc, fmtDT, api, toast, modal } from './core.js';

// ---------------------------------------------------------------- photos

const PHOTO_INPUT = `<div class="full photo-pick">
  <label class="photo-btn"><span aria-hidden="true">📷</span> <span data-photo-label>Ajouter une photo</span>
    <input type="file" accept="image/*" capture="environment" multiple hidden data-photos></label>
  <div class="thumbs" data-thumbs></div></div>`;

/** Redimensionne (1600 px max) et compresse en JPEG avant l'envoi : rapide même en 4G. */
export async function compressImage(file, max = 1600, quality = 0.8) {
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

export async function uploadPhotos(entity, entityId, files) {
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
export function attachPhotoInput(form) {
  // Placé avant « Plus de détails » : la photo reste à portée de pouce.
  const anchor = form.querySelector('details.more') || form.querySelector('button[type=submit]').parentElement;
  anchor.insertAdjacentHTML('beforebegin', PHOTO_INPUT);
  const input = form.querySelector('[data-photos]');
  const thumbs = form.querySelector('[data-thumbs]');
  const label = form.querySelector('[data-photo-label]');
  input.addEventListener('change', () => {
    thumbs.innerHTML = '';
    for (const file of input.files) {
      const img = new Image();
      img.alt = '';
      img.src = URL.createObjectURL(file);
      img.onload = () => URL.revokeObjectURL(img.src);
      thumbs.append(img);
    }
    const n = input.files.length;
    label.textContent = n ? `${n} photo${n > 1 ? 's' : ''} prête${n > 1 ? 's' : ''} ✓` : 'Ajouter une photo';
  });
  return async (entity, id) => {
    if (!input.files.length) return 0;
    try { return await uploadPhotos(entity, id, [...input.files]); } catch (e) { toast(e.message, true); return 0; }
  };
}

export const photoCell = (entity) => ({
  label: 'Photos',
  html: (r) => `<button type="button" class="secondary small" data-gallery="${entity}:${r.id}">📷 ${r.photo_count ? r.photo_count : '+'}</button>`,
});

export function bindGalleries(root, onChange) {
  root.querySelectorAll('[data-gallery]').forEach((b) => {
    b.onclick = () => { const [entity, id] = b.dataset.gallery.split(':'); openGallery(entity, Number(id), onChange); };
  });
}

export async function photoUrl(id) {
  const res = await api(`/photos/${id}`, { raw: true });
  return URL.createObjectURL(await res.blob());
}

/** Galerie d'un enregistrement : affichage, ajout, suppression (auteur, 15 min). */
export async function openGallery(entity, id, onChange) {
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
