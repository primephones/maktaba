import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

/**
 * A small hash router. Hash paths work the same from a web address, a home-screen
 * install and the Android app, and every step is a real history entry so the Android
 * back gesture always has somewhere sensible to go.
 */

export type Route =
  | { name: 'home' }
  | { name: 'library'; folderId?: string }
  | { name: 'references' }
  | { name: 'search' }
  | { name: 'settings'; page?: string }
  | { name: 'setup'; step?: string }
  | { name: 'reader'; bookId: string }
  | { name: 'review'; bookId: string; page?: number }
  | { name: 'notfound' };

export const TABS = ['home', 'library', 'references'] as const;

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
  switch (parts[0]) {
    case undefined:
    case 'home':
      return { name: 'home' };
    case 'library':
      return { name: 'library', folderId: parts[1] === 'folder' ? parts[2] : undefined };
    case 'references':
      return { name: 'references' };
    case 'search':
      return { name: 'search' };
    case 'settings':
      return { name: 'settings', page: parts[1] };
    case 'setup':
      return { name: 'setup', step: parts[1] };
    case 'book':
      if (parts[1] && parts[2] === 'review') return { name: 'review', bookId: parts[1], page: parts[3] ? Number(parts[3]) : undefined };
      return parts[1] ? { name: 'reader', bookId: parts[1] } : { name: 'notfound' };
    default:
      return { name: 'notfound' };
  }
}

let current: Route = parse(location.hash);
let currentHash = location.hash;
const listeners = new Set<() => void>();

function sync() {
  if (location.hash === currentHash) return;
  currentHash = location.hash;
  current = parse(location.hash);
  listeners.forEach((l) => l());
}
// Going back (button, gesture or browser) animates the other way. A step back that only
// closes a sheet leaves the screen as it is, so nothing moves.
let popDirection: Direction | null = null;
window.addEventListener('popstate', () => {
  const dir = popDirection ?? 'back';
  popDirection = null;
  if (location.hash === currentHash) return;
  const leaving = current;
  withTransition(sync, dir, leaving.name === 'reader' ? leaving.bookId : undefined);
});
window.addEventListener('hashchange', sync);

/** How many in-app steps lie behind the current one. */
const depth = () => (history.state as { d?: number } | null)?.d ?? 0;
if (history.state == null) {
  // Home is always the bottom of the stack, even when the app is opened on a deep link.
  const initial = location.hash;
  if (current.name !== 'home') {
    history.replaceState({ d: 0 }, '', '#/');
    history.pushState({ d: 1 }, '', initial);
  } else history.replaceState({ d: 0 }, '');
}

const reducedMotion = () =>
  document.documentElement.dataset.motion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The cover the reader last touched, so that opening the book grows it into the page.
 * Kept for a moment only: a book opened any other way just slides in.
 */
let touched: { el: HTMLElement; at: number } | null = null;
document.addEventListener(
  'pointerdown',
  (e) => {
    const el = (e.target as Element | null)?.closest?.('.cover');
    touched = el ? { el: el as HTMLElement, at: Date.now() } : null;
  },
  { capture: true, passive: true },
);

type Direction = 'forward' | 'back' | 'tab';

/** Resolves with the element once it is on screen, or with nothing after a short wait. */
function appear<T>(find: () => T | null | undefined, within = 320): Promise<T | undefined> {
  const until = performance.now() + within;
  return new Promise((resolve) => {
    const look = () => {
      const found = find();
      if (found) resolve(found);
      else if (performance.now() > until) resolve(undefined);
      else window.setTimeout(look, 16);
    };
    look();
  });
}

/**
 * Animates a change of screen. Screens slide the way the reader is going; a book opened
 * from its cover grows out of the cover, and shrinks back into it on the way out.
 */
function withTransition(change: () => void, dir: Direction = 'forward', closingBook?: string) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  if (!doc.startViewTransition || reducedMotion() || document.visibilityState !== 'visible') {
    change();
    return;
  }
  const root = document.documentElement;
  const named: HTMLElement[] = [];
  const name = (el: HTMLElement | null | undefined) => {
    if (!el) return;
    el.style.viewTransitionName = 'book';
    named.push(el);
  };
  const opening = dir === 'forward' && touched && touched.el.isConnected && Date.now() - touched.at < 1500 ? touched.el : null;
  touched = null;
  name(opening);
  if (closingBook) name(document.querySelector<HTMLElement>('.rd'));
  root.dataset.nav = dir;
  try {
    const t = doc.startViewTransition(async () => {
      named.forEach((el) => (el.style.viewTransitionName = ''));
      flushSync(change);
      // The new screen may draw a moment later (its data comes from the database): wait a
      // little for the element that takes over, so the morph has somewhere to go.
      if (opening) name(await appear(() => document.querySelector<HTMLElement>('.rd')));
      if (closingBook) {
        // The same book's cover on the screen being returned to, if it is in view.
        name(
          await appear(() =>
            [...document.querySelectorAll<HTMLElement>(`.cover[data-book="${CSS.escape(closingBook)}"]`)].find((c) => {
              const r = c.getBoundingClientRect();
              return r.width > 0 && r.bottom > 0 && r.top < innerHeight;
            }),
          ),
        );
      }
    });
    void t.finished.finally(() => {
      named.forEach((el) => (el.style.viewTransitionName = ''));
      if (root.dataset.nav === dir) delete root.dataset.nav;
    });
  } catch {
    named.forEach((el) => (el.style.viewTransitionName = ''));
    change();
  }
}

export function navigate(path: string, opts: { replace?: boolean; dir?: Direction } = {}) {
  const hash = `#${path}`;
  if (hash === location.hash) return;
  // Leaving from inside a sheet: reuse its history entry so back does not land on a ghost.
  const fromOverlay = !!(history.state as { overlay?: boolean } | null)?.overlay;
  if (fromOverlay) overlayEntry = false;
  withTransition(() => {
    if (opts.replace || fromOverlay) history.replaceState({ d: depth() }, '', hash);
    else history.pushState({ d: depth() + 1 }, '', hash);
    sync();
  }, opts.dir);
}

/** Tabs sit side by side rather than stacking up in history: back from any tab is Home. */
export function switchTab(tab: (typeof TABS)[number]) {
  if (current.name === tab && !(current.name === 'library' && current.folderId)) return;
  const onTabRoot = (TABS as readonly string[]).includes(current.name) && !(current.name === 'library' && current.folderId);
  if (tab === 'home') {
    if (onTabRoot && depth() === 1) {
      popDirection = 'tab';
      history.back();
    }
    else navigate('/', { replace: onTabRoot, dir: 'tab' });
    return;
  }
  navigate(`/${tab}`, { replace: onTabRoot && depth() > 0, dir: 'tab' });
}

export function goBack(fallback = '/') {
  // Called from inside a sheet: step over the sheet's own history entry as well.
  const onOverlay = !!(history.state as { overlay?: boolean } | null)?.overlay;
  if (onOverlay) {
    overlayEntry = false;
    overlays.length = 0;
    if (depth() > 1) history.go(-2);
    else {
      history.back();
      window.setTimeout(() => navigate(fallback, { replace: true }), 60);
    }
    return;
  }
  if (depth() > 0) history.back();
  else navigate(fallback, { replace: true });
}

export const canGoBack = () => depth() > 0;

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

/**
 * Lets overlays (sheets, popups, the zoom viewer) be closed with the back gesture.
 *
 * However many overlays are open, they share one history entry: it is added when the
 * first opens and removed when the last closes. Swapping one sheet for another in the
 * same moment therefore leaves history alone, and going back closes only the top one.
 */
interface Overlay {
  onBack: () => void;
}
const overlays: Overlay[] = [];
let overlayEntry = false;
let settleTimer = 0;

function settleOverlays() {
  window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => {
    const onEntry = !!(history.state as { overlay?: boolean } | null)?.overlay;
    if (overlays.length > 0 && !overlayEntry) {
      history.pushState({ d: depth() + 1, overlay: true }, '');
      overlayEntry = true;
    } else if (overlays.length === 0 && overlayEntry) {
      overlayEntry = false;
      if (onEntry) history.back();
    }
  }, 0);
}

window.addEventListener('popstate', () => {
  if (!overlayEntry) return;
  if ((history.state as { overlay?: boolean } | null)?.overlay) return;
  // The reader went back past the overlay entry: close the top overlay.
  overlayEntry = false;
  overlays.pop()?.onBack();
  settleOverlays();
});

export function pushOverlay(onBack: () => void): () => void {
  const overlay: Overlay = { onBack };
  overlays.push(overlay);
  // The history entry is added at once, so back works from the first moment the overlay
  // is on screen. Only its removal waits a tick, in case another overlay takes its place.
  window.clearTimeout(settleTimer);
  if (!overlayEntry) {
    history.pushState({ d: depth() + 1, overlay: true }, '');
    overlayEntry = true;
  }
  return () => {
    const i = overlays.indexOf(overlay);
    if (i < 0) return;
    overlays.splice(i, 1);
    settleOverlays();
  };
}
