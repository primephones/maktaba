import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { pushOverlay } from '../../app/router';
import { clamp } from '../../lib/util';
import { Icon } from '../../ui/Icon';
import { drawPdfPage, paragraphRects, type Rect } from './PdfPage';

export type ZoomSource = { kind: 'pdf'; bookId: string; page: number } | { kind: 'img'; url: string };

/** Full-screen view of a scanned page or picture: pinch to zoom, drag to move, double-tap. */
/** A paragraph to show on the page: by its text (PDF text) or its area (a recognised scan). */
export interface PageMark {
  page: number;
  text?: string;
  /** Fractions of the page: left, top, right, bottom. */
  box?: [number, number, number, number];
}

export function ZoomViewer({ source, onClose, label = 'Zoomed page', children, onSwipe, mark, onMarked, darkPage, redraw = 0 }: {
  source: ZoomSource;
  /** Highlight this paragraph on its page, and zoom to it. */
  mark?: PageMark;
  /** Told whether the paragraph was found on the page. */
  onMarked?: (found: boolean) => void;
  onClose: () => void;
  label?: string;
  /** Controls drawn over the page (the original-page viewer's page buttons). */
  children?: React.ReactNode;
  /** A sideways swipe while not zoomed in: -1 for the page before, 1 for the page after. */
  onSwipe?: (dir: 1 | -1) => void;
  /** Draw the page light on dark (for reading a scan at night). */
  darkPage?: boolean;
  /** Changes when the page should be drawn again (its file has just come back). */
  redraw?: number;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({ scale: 1, x: 0, y: 0 });
  const [, force] = useState(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const release = useRef<() => void>(() => undefined);

  useLayoutEffect(() => {
    release.current = pushOverlay(() => closeRef.current());
    return () => release.current();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        release.current();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const pdfKey = source.kind === 'pdf' ? `${source.bookId}:${source.page}:${redraw}` : '';
  useEffect(() => {
    // A new page starts unzoomed.
    view.current = { scale: 1, x: 0, y: 0 };
    if (stage.current) stage.current.style.transform = '';
    if (source.kind !== 'pdf' || !canvas.current) return;
    let current = true;
    // Drawn out of sight, then shown: turning pages quickly never mixes two pages.
    const off = document.createElement('canvas');
    const width = Math.min(3000, window.innerWidth * Math.min(3, (window.devicePixelRatio || 1) * 1.6));
    void drawPdfPage(source.bookId, source.page, off, width)
      .then(() => {
        const c = canvas.current;
        if (!current || !c) return;
        c.width = off.width;
        c.height = off.height;
        c.getContext('2d')?.drawImage(off, 0, 0);
        if (mark && mark.page === source.page) void showMark(c, source.bookId, mark, () => current);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfKey]);

  /** Bands over the paragraph being read, then the page zoomed so it sits mid-screen. */
  const showMark = async (c: HTMLCanvasElement, bookId: string, m: PageMark, alive: () => boolean) => {
    let rects: Rect[] = [];
    if (m.box) {
      const [x0, y0, x1, y1] = m.box;
      rects = [{ x: x0 * c.width, y: y0 * c.height, w: (x1 - x0) * c.width, h: (y1 - y0) * c.height }];
    } else if (m.text) {
      rects = await paragraphRects(bookId, m.page, m.text, c.width).catch(() => []);
    }
    if (!alive()) return;
    onMarked?.(rects.length > 0);
    if (!rects.length) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const pad = c.width * 0.006;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(232, 190, 80, 0.45)';
    for (const r of rects) ctx.fillRect(r.x - pad, r.y - pad, r.w + 2 * pad, r.h + 2 * pad);
    ctx.restore();
    // A rubric bar in the margin beside the whole paragraph.
    const top = Math.min(...rects.map((r) => r.y)) - pad;
    const bottom = Math.max(...rects.map((r) => r.y + r.h)) + pad;
    const right = Math.max(...rects.map((r) => r.x + r.w));
    ctx.fillStyle = 'rgba(163, 48, 42, 0.85)';
    ctx.fillRect(Math.min(c.width - pad * 2, right + pad * 3), top, Math.max(3, c.width * 0.005), bottom - top);
    // Zoom so the paragraph fills most of the screen's width, centred.
    const box = c.getBoundingClientRect();
    if (!box.width) return;
    const k = box.width / c.width;
    const left = Math.min(...rects.map((r) => r.x)) - pad;
    const span = (right - left + pad * 2) * k;
    const scale = clamp((window.innerWidth * 0.92) / Math.max(span, 1), 1, 2.6);
    const cx = box.left + ((left + right) / 2) * k;
    const cy = box.top + ((top + bottom) / 2) * k;
    view.current = { scale, x: window.innerWidth / 2 - scale * cx, y: window.innerHeight * 0.42 - scale * cy };
    apply();
  };

  const apply = () => {
    const v = view.current;
    const maxX = (window.innerWidth * (v.scale - 1));
    const maxY = (window.innerHeight * (v.scale - 1));
    v.x = clamp(v.x, -maxX, 0);
    v.y = clamp(v.y, -maxY, 0);
    if (stage.current) stage.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
  };

  const zoomAt = (cx: number, cy: number, next: number) => {
    const v = view.current;
    const scale = clamp(next, 1, 6);
    v.x = cx - ((cx - v.x) / v.scale) * scale;
    v.y = cy - ((cy - v.y) / v.scale) * scale;
    v.scale = scale;
    apply();
  };

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; scale: number } | null>(null);
  const lastTap = useRef(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  return createPortal(
    <div
      className="zoom"
      data-dark-page={darkPage || undefined}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        swipe.current = pointers.current.size === 1 && view.current.scale <= 1.01 ? { x: e.clientX, y: e.clientY } : null;
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.current.scale };
        }
      }}
      onPointerMove={(e) => {
        const prev = pointers.current.get(e.pointerId);
        if (!prev) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2 && gesture.current) {
          const [a, b] = [...pointers.current.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, gesture.current.scale * (dist / gesture.current.dist));
        } else if (pointers.current.size === 1 && swipe.current && onSwipe) {
          // Not zoomed in: a sideways swipe turns the page instead of moving it.
        } else if (pointers.current.size === 1) {
          view.current.x += e.clientX - prev.x;
          view.current.y += e.clientY - prev.y;
          apply();
        }
      }}
      onPointerUp={(e) => {
        const start = swipe.current;
        swipe.current = null;
        if (start && onSwipe && pointers.current.size === 1) {
          const dx = e.clientX - start.x;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - start.y) * 1.5) {
            pointers.current.delete(e.pointerId);
            onSwipe(dx < 0 ? 1 : -1);
            return;
          }
        }
        const moved = pointers.current.get(e.pointerId);
        pointers.current.delete(e.pointerId);
        if (pointers.current.size < 2) gesture.current = null;
        if (moved && pointers.current.size === 0) {
          const now = Date.now();
          if (now - lastTap.current < 300) {
            zoomAt(e.clientX, e.clientY, view.current.scale > 1.2 ? 1 : 2.6);
            force((n) => n + 1);
            lastTap.current = 0;
          } else lastTap.current = now;
        }
      }}
      onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
      onWheel={(e) => zoomAt(e.clientX, e.clientY, view.current.scale * (e.deltaY < 0 ? 1.15 : 0.87))}
    >
      <div className="zoom-stage" ref={stage}>
        {source.kind === 'pdf' ? <canvas ref={canvas} /> : <img src={source.url} alt="" draggable={false} />}
      </div>
      <button
        className="icon-btn"
        aria-label="Close"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          release.current();
          onClose();
        }}
      >
        <Icon name="close" />
      </button>
      {children ?? <div className="zoom-hint">Pinch or double-tap to zoom</div>}
    </div>,
    document.body,
  );
}
