/**
 * Motion shared by the whole app. Three speeds (quick for presses, standard for sheets and
 * choices, deliberate for opening a book or a new theme), and everything shortened to a
 * fade when the phone, or Maktaba's own switch, asks for less motion.
 */
export const reducedMotion = () =>
  document.documentElement.dataset.motion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;

type ViewTransition = { finished: Promise<void> };
type WithVT = Document & { startViewTransition?: (cb: () => void) => ViewTransition };

/**
 * A new colour theme spreads out from where it was chosen, instead of switching in a blink.
 * `change` must change the page's colours at once (it runs inside the transition).
 */
export function revealTheme(at: { clientX: number; clientY: number } | null, change: () => void) {
  const doc = document as WithVT;
  if (!doc.startViewTransition || reducedMotion() || document.visibilityState !== 'visible') {
    change();
    return;
  }
  const root = document.documentElement;
  root.style.setProperty('--reveal-x', `${at?.clientX ?? innerWidth / 2}px`);
  root.style.setProperty('--reveal-y', `${at?.clientY ?? innerHeight / 2}px`);
  root.dataset.vt = 'theme';
  try {
    const t = doc.startViewTransition(change);
    void t.finished.catch(() => undefined).finally(() => {
      if (root.dataset.vt === 'theme') delete root.dataset.vt;
    });
  } catch {
    delete root.dataset.vt;
    change();
  }
}

/**
 * Choices in a row (`.seg`) glide from one option to the next: the old choice's background
 * slides across to the new one. Works for every such control in the app, by watching taps.
 */
export function initGlide() {
  document.addEventListener(
    'click',
    (e) => {
      if (reducedMotion()) return;
      const btn = (e.target as Element | null)?.closest?.('.seg > button');
      const seg = btn?.parentElement as HTMLElement | null | undefined;
      if (!btn || !seg) return;
      const old = seg.querySelector<HTMLElement>(':scope > button[aria-pressed="true"], :scope > button[aria-selected="true"]');
      if (!old || old === btn) return;
      const from = old.getBoundingClientRect();
      const box = seg.getBoundingClientRect();
      // After the choice has been drawn.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const now = seg.querySelector<HTMLElement>(':scope > button[aria-pressed="true"], :scope > button[aria-selected="true"]');
          if (!now || now === old || !seg.isConnected) return;
          const to = now.getBoundingClientRect();
          const ghost = document.createElement('span');
          ghost.className = 'seg-ghost';
          ghost.style.cssText = `left:${from.left - box.left}px;top:${from.top - box.top}px;width:${from.width}px;height:${from.height}px`;
          seg.appendChild(ghost);
          seg.dataset.gliding = '';
          void ghost.offsetWidth;
          ghost.style.transform = `translate(${to.left - from.left}px, ${to.top - from.top}px)`;
          ghost.style.width = `${to.width}px`;
          window.setTimeout(() => {
            ghost.remove();
            if (!seg.querySelector('.seg-ghost')) delete seg.dataset.gliding;
          }, 340);
        }),
      );
    },
    true,
  );
}
