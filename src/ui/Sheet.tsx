import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { pushOverlay } from '../app/router';
import { Icon } from './Icon';

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Extra buttons shown beside the close button. */
  actions?: ReactNode;
}

/**
 * A bottom sheet. It is drawn above everything, including the bottom bar, scrolls
 * inside itself, and closes with the close button, a tap outside, Escape or the Android
 * back gesture.
 */
export function Sheet({ title, onClose, children, actions }: SheetProps) {
  const [closing, setClosing] = useState(false);
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const releaseRef = useRef<() => void>(() => undefined);

  const finish = useCallback(() => {
    setClosing(true);
    const reduce = document.documentElement.dataset.motion === 'off' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => closeRef.current(), reduce ? 0 : 190);
  }, []);

  const close = useCallback(() => {
    releaseRef.current();
    finish();
  }, [finish]);

  useEffect(() => {
    releaseRef.current = pushOverlay(finish);
    const previous = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      releaseRef.current();
      previous?.focus?.();
    };
  }, [close, finish]);

  return createPortal(
    <div className="sheet-root" data-closing={closing}>
      <div className="sheet-scrim" onClick={close} />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={sheetRef} tabIndex={-1}>
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          {actions}
          <button className="icon-btn" onClick={close} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
