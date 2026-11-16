import { useEffect, useRef, useState } from 'react';
import { db } from '../../db/db';
import { pdfForBook } from '../../lib/pdfjs';

/** Pages are drawn one at a time so a fast scroll does not swamp the phone. */
let chain: Promise<unknown> = Promise.resolve();
const enqueue = <T,>(job: () => Promise<T>): Promise<T> => {
  const next = chain.then(job, job);
  chain = next.catch(() => undefined);
  return next;
};

const getFile = (bookId: string) => async () => (await db.files.get(bookId))?.blob;

export async function drawPdfPage(bookId: string, pageNumber: number, canvas: HTMLCanvasElement, targetWidth: number): Promise<number> {
  const pdf = await pdfForBook(bookId, getFile(bookId));
  const page = await pdf.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: targetWidth / base.width });
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return base.width / base.height;
  } finally {
    page.cleanup();
  }
}

/** One page of a PDF shown as an image: drawn when it nears the screen, released after. */
export function PdfPage({ bookId, page, label, onZoom }: { bookId: string; page: number; label?: string; onZoom: () => void }) {
  const holder = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ratio, setRatio] = useState(0.7);
  const [failed, setFailed] = useState(false);
  const drawn = useRef(false);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver(
      (entries) => {
        const near = entries.some((e) => e.isIntersecting);
        if (near && !drawn.current) {
          drawn.current = true;
          void enqueue(async () => {
            if (!alive || !canvas.current) return;
            const width = Math.min(2200, Math.max(320, el.clientWidth) * Math.min(2.5, window.devicePixelRatio || 1));
            const r = await drawPdfPage(bookId, page, canvas.current, width);
            if (alive) setRatio(r);
          }).catch(() => {
            drawn.current = false;
            if (alive) setFailed(true);
          });
        } else if (!near && drawn.current && canvas.current) {
          // Far off screen: give the memory back.
          canvas.current.width = 0;
          canvas.current.height = 0;
          drawn.current = false;
        }
      },
      { rootMargin: '900px 900px' },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [bookId, page]);

  return (
    <button ref={holder} className="pdfpage" style={{ aspectRatio: String(ratio) }} onClick={onZoom} aria-label={`Page ${label ?? page}. Tap to zoom.`} data-skip>
      <canvas ref={canvas} />
      {failed ? <span className="pn">Page {label ?? page} could not be shown</span> : <span className="pn" aria-hidden="true">{label ?? page}</span>}
    </button>
  );
}
