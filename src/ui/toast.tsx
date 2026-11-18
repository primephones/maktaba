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
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** A short message, with up to two buttons (one action, or a list of them). */
export function toast(text: string, action?: Action | Action[], ms = 4200) {
  const id = ++seq;
  const actions = action ? (Array.isArray(action) ? action : [action]) : [];
  toasts = [...toasts.slice(-2), { id, text, actions }];
  emit();
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, actions.length ? Math.max(ms, 6500) : ms);
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
        <div className="toast" key={t.id}>
          <span>{t.text}</span>
          {t.actions.map((a) => (
            <button
              key={a.label}
              onClick={() => {
                a.run();
                toasts = toasts.filter((x) => x.id !== t.id);
                emit();
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
