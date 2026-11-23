import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

interface Action {
  label: string;
  run: () => void;
}

interface Toast {
  id: number;
  text: string;
  actions: Action[];
  leaving?: boolean;
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** A short message, with up to two buttons (one action, or a list of them). */
export function toast(text: string, action?: Action | Action[], ms = 4200) {
  const actions = action ? (Array.isArray(action) ? action : [action]) : [];
  // The same message again (a button tapped twice) is not stacked: the one showing stays a little longer.
  const same = toasts.find((t) => t.text === text);
  if (same) toasts = toasts.filter((t) => t !== same);
  const id = ++seq;
  toasts = [...toasts.slice(-2), { id, text, actions }];
  emit();
  window.setTimeout(() => dismiss(id), actions.length ? Math.max(ms, 6500) : ms);
}

/** Lets a message slip away, then removes it. */
function dismiss(id: number) {
  if (!toasts.some((t) => t.id === id && !t.leaving)) return;
  toasts = toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t));
  emit();
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 200);
}

/** A message can be flicked away sideways. */
function swipeAway(id: number) {
  let x0: number | null = null;
  return {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      x0 = e.clientX;
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (x0 === null) return;
      const dx = e.clientX - x0;
      e.currentTarget.style.transform = `translateX(${dx}px)`;
      e.currentTarget.style.opacity = String(Math.max(0.2, 1 - Math.abs(dx) / 220));
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      if (x0 === null) return;
      const dx = e.clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 70) dismiss(id);
      else {
        e.currentTarget.style.transform = '';
        e.currentTarget.style.opacity = '';
      }
    },
    onPointerCancel: (e: React.PointerEvent<HTMLDivElement>) => {
      x0 = null;
      e.currentTarget.style.transform = '';
      e.currentTarget.style.opacity = '';
    },
  };
}

/** `place` keeps toasts clear of whatever sits at the bottom of the current screen. */
export function Toasts({ place }: { place: 'bar' | 'reader' | 'edge' }) {
  const list = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => toasts,
  );
  return createPortal(
    <div className="toasts" data-place={place} role="status" aria-live="polite">
      {list.map((t) => (
        <div className="toast" key={t.id} data-leaving={t.leaving || undefined} {...swipeAway(t.id)}>
          <span>{t.text}</span>
          {t.actions.map((a) => (
            <button
              key={a.label}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                a.run();
                dismiss(t.id);
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );
}
