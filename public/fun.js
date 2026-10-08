// Petites récompenses visuelles : retour immédiat après une saisie, confettis, vibration.
// Tout est facultatif et discret ; les animations sont coupées si l'appareil demande « réduire les animations ».

const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function buzz(pattern = 25) {
  try { navigator.vibrate?.(pattern); } catch { /* vibration indisponible */ }
}

/** Grand pictogramme au centre de l'écran : « ok » (✓ vert) ou « bad » (⚠ orange). */
export function flash(kind, text) {
  document.querySelector('.flash')?.remove();
  const el = document.createElement('div');
  el.className = `flash ${kind}`;
  el.setAttribute('role', 'status');
  el.innerHTML = '<div class="flash-badge"></div><div class="flash-text"></div>';
  el.querySelector('.flash-badge').textContent = kind === 'ok' ? '✓' : '⚠';
  el.querySelector('.flash-text').textContent = text || '';
  document.body.append(el);
  buzz(kind === 'ok' ? 25 : [60, 40, 60]);
  const life = kind === 'ok' ? 900 : 1600;
  setTimeout(() => el.classList.add('out'), life);
  setTimeout(() => el.remove(), life + 300);
}

const COLORS = ['#0f766e', '#f59e0b', '#ef4444', '#3b82f6', '#a855f7', '#22c55e', '#ec4899'];

/** Pluie de confettis : à réserver aux vraies victoires (journée complète). */
export function confetti(count = 56) {
  if (reduced()) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  box.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i++) {
    const piece = document.createElement('i');
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = COLORS[i % COLORS.length];
    piece.style.animationDelay = `${Math.random() * 0.5}s`;
    piece.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
    piece.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 220)}px`);
    piece.style.setProperty('--rot', `${Math.round(360 + Math.random() * 540)}deg`);
    if (i % 3 === 0) piece.style.borderRadius = '50%';
    box.append(piece);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 3600);
}
