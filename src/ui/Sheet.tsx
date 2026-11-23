import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { pushOverlay } from '../app/router';
import { Icon } from './Icon';
import { haptic } from '../lib/haptics';

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Extra buttons shown beside the close button. */
  actions?: ReactNode;
  /** Leave the page behind as it is (for settings whose effect should be seen while choosing). */
  keepPage?: boolean;
}

/**
 * A bottom sheet. It is drawn above everything, including the bottom bar, scrolls
 * inside itself, and closes with the close button, a tap outside, Escape or the Android
 * back gesture.
 */
export function Sheet({ title, onClose, children, actions, keepPage }: SheetProps) {
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

  // While a sheet is open, the screen behind steps back a little (see .rd in the styles).
  useLayoutEffect(() => {
    if (keepPage) return;
    const root = document.documentElement;
    root.dataset.sheet = String(Number(root.dataset.sheet ?? 0) + 1);
    return () => {
      const n = Number(root.dataset.sheet ?? 1) - 1;
      if (n > 0) root.dataset.sheet = String(n);
      else delete root.dataset.sheet;
    };
  }, [keepPage]);
  useEffect(() => {
    if (closing) document.documentElement.dataset.sheetClosing = '';
    return () => {
      delete document.documentElement.dataset.sheetClosing;
    };
  }, [closing]);

  // Registered before the sheet is painted, so the back gesture can never slip past it.
  useLayoutEffect(() => {
    releaseRef.current = pushOverlay(finish);
    return () => releaseRef.current();
  }, [finish]);

  useEffect(() => {
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
      previous?.focus?.();
    };
  }, [close]);

  useSheetDrag(sheetRef, close);

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

/**
 * Drag a sheet down to close it. It follows the finger from the handle, the title, or
 * anywhere in its body while that is scrolled to the top; let go past a third of its
 * height, or with a flick, and it closes, otherwise it springs back. Sliders, text being
 * selected and lists scrolled down are left alone.
 */
function useSheetDrag(ref: React.RefObject<HTMLDivElement | null>, close: () => void) {
  useEffect(() => {
    const sheet = ref.current;
    if (!sheet) return;
    let startY = 0;
    let startX = 0;
    let lastY = 0;
    let lastT = 0;
    let speed = 0;
    let dy = 0;
    let state: 'idle' | 'maybe' | 'drag' | 'no' = 'idle';
    let felt = false;
    const scrim = sheet.parentElement?.querySelector<HTMLElement>('.sheet-scrim');

    const allowedFrom = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el?.closest) return false;
      if (el.closest('input, textarea, select, [contenteditable="true"], [data-no-drag]')) return false;
      if (el.closest('.sheet-grab, .sheet-head')) return true;
      // Inside the body only when it (and anything scrollable under the finger) is at the top.
      for (let p: HTMLElement | null = el; p && p !== sheet; p = p.parentElement) {
        if (p.scrollTop > 0) return false;
        if (p.scrollWidth > p.clientWidth + 2 && getComputedStyle(p).overflowX !== 'visible') return false;
      }
      return true;
    };
    const set = (y: number) => {
      sheet.style.transform = y > 0 ? `translateY(${y}px)` : '';
      if (scrim) scrim.style.opacity = String(Math.max(0.25, 1 - y / (sheet.offsetHeight || 1)));
    };
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !allowedFrom(e.target)) {
        state = 'no';
        return;
      }
      state = 'maybe';
      startY = lastY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      lastT = e.timeStamp;
      speed = 0;
      dy = 0;
      felt = false;
    };
    const onMove = (e: TouchEvent) => {
      if (state === 'no' || state === 'idle') return;
      const y = e.touches[0].clientY;
      const x = e.touches[0].clientX;
      if (state === 'maybe') {
        const ddy = y - startY;
        const ddx = Math.abs(x - startX);
        if (Math.abs(ddy) < 6 && ddx < 6) return;
        if (ddy <= 0 || ddx > ddy || getSelection()?.toString()) {
          state = 'no';
          return;
        }
        state = 'drag';
        sheet.dataset.dragging = 'true';
        delete sheet.dataset.released;
      }
      e.preventDefault();
      const dt = Math.max(1, e.timeStamp - lastT);
      speed = 0.8 * ((y - lastY) / dt) + 0.2 * speed;
      lastY = y;
      lastT = e.timeStamp;
      dy = Math.max(0, y - startY);
      const past = dy > sheet.offsetHeight / 3;
      if (past !== felt) {
        felt = past;
        if (past) haptic('light');
      }
      set(dy);
    };
    const onEnd = () => {
      if (state !== 'drag') {
        state = 'idle';
        return;
      }
      state = 'idle';
      delete sheet.dataset.dragging;
      sheet.dataset.released = 'true';
      if (dy > sheet.offsetHeight / 3 || (speed > 0.55 && dy > 24)) {
        close();
      } else {
        set(0);
        if (scrim) scrim.style.opacity = '';
      }
    };
    sheet.addEventListener('touchstart', onStart, { passive: true });
    sheet.addEventListener('touchmove', onMove, { passive: false });
    sheet.addEventListener('touchend', onEnd);
    sheet.addEventListener('touchcancel', onEnd);
    return () => {
      sheet.removeEventListener('touchstart', onStart);
      sheet.removeEventListener('touchmove', onMove);
      sheet.removeEventListener('touchend', onEnd);
      sheet.removeEventListener('touchcancel', onEnd);
    };
  }, [ref, close]);
}
