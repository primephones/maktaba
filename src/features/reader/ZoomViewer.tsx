import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { pushOverlay } from '../../app/router';
import { clamp } from '../../lib/util';
import { Icon } from '../../ui/Icon';
import { drawPdfPage } from './PdfPage';

export type ZoomSource = { kind: 'pdf'; bookId: string; page: number } | { kind: 'img'; url: string };

/** Full-screen view of a scanned page or picture: pinch to zoom, drag to move, double-tap. */
export function ZoomViewer({ source, onClose }: { source: ZoomSource; onClose: () => void }) {
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

  useEffect(() => {
    if (source.kind !== 'pdf' || !canvas.current) return;
    const width = Math.min(3000, window.innerWidth * Math.min(3, (window.devicePixelRatio || 1) * 1.6));
    void drawPdfPage(source.bookId, source.page, canvas.current, width).catch(() => undefined);
  }, [source]);

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

  return createPortal(
    <div
      className="zoom"
      role="dialog"
      aria-modal="true"
      aria-label="Zoomed page"
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
        } else if (pointers.current.size === 1) {
          view.current.x += e.clientX - prev.x;
          view.current.y += e.clientY - prev.y;
          apply();
        }
      }}
      onPointerUp={(e) => {
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
      <div className="zoom-hint">Pinch or double-tap to zoom</div>
    </div>,
    document.body,
  );
}
