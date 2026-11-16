import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, action?: Toast['action'], ms = 4200) {
  const id = ++seq;
  toasts = [...toasts.slice(-2), { id, text, action }];
  emit();
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, action ? Math.max(ms, 6500) : ms);
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
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                toasts = toasts.filter((x) => x.id !== t.id);
                emit();
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}
