import { useEffect, useRef, useState } from 'react';
import { db } from '../../db/db';
import { pdfForBook, pdfjs } from '../../lib/pdfjs';
import { normalizeForSearch } from '../../lib/arabic';

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

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Folds text for matching a paragraph against a page's own text: no spaces, marks or punctuation. */
const foldForMatch = (s: string) => normalizeForSearch(s).replace(/[\s\p{P}\p{S}]+/gu, '');

/**
 * Where a paragraph sits on a PDF page, as rectangles in the coordinates of a page drawn
 * `width` pixels wide: the page's own text pieces that make up the paragraph, joined into
 * one band per line. The paragraph was built from these same pieces when the book was
 * added, so its text is found among them.
 */
export async function paragraphRects(bookId: string, pageNumber: number, text: string, width: number): Promise<Rect[]> {
  const want = foldForMatch(text);
  if (want.length < 4) return [];
  const [mod, pdf] = await Promise.all([pdfjs(), pdfForBook(bookId, getFile(bookId))]);
  const page = await pdf.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const content = await page.getTextContent();
    type Item = { str: string; transform: number[]; width: number };
    const items = content.items.filter((it): it is Item & typeof it => 'str' in it) as unknown as Item[];
    let hay = '';
    const owner: number[] = [];
    items.forEach((it, i) => {
      for (const ch of foldForMatch(it.str)) {
        hay += ch;
        owner.push(i);
      }
    });
    // Find the paragraph by a few anchors from its start and middle (a stray character at
    // a line join must not lose it).
    let start = -1;
    for (const at of [0, Math.floor(want.length / 3), Math.floor((2 * want.length) / 3)]) {
      const anchor = want.slice(at, at + Math.min(18, want.length - at));
      if (anchor.length < 4) continue;
      const found = hay.indexOf(anchor);
      if (found >= 0) {
        start = Math.max(0, found - at);
        break;
      }
    }
    if (start < 0) return [];
    const end = Math.min(hay.length, start + want.length);
    const used = [...new Set(owner.slice(start, end))];
    const raw = used.map((i) => {
      const t = mod.Util.transform(viewport.transform, items[i].transform);
      const h = Math.hypot(t[2], t[3]);
      return { x: t[4], y: t[5] - h, w: items[i].width * viewport.scale, h };
    });
    // One band per line.
    const lines: Rect[] = [];
    for (const r of raw.sort((a, b) => a.y - b.y)) {
      const line = lines.find((l) => Math.abs(l.y - r.y) < r.h * 0.5);
      if (line) {
        const x0 = Math.min(line.x, r.x);
        const x1 = Math.max(line.x + line.w, r.x + r.w);
        const y0 = Math.min(line.y, r.y);
        const y1 = Math.max(line.y + line.h, r.y + r.h);
        Object.assign(line, { x: x0, w: x1 - x0, y: y0, h: y1 - y0 });
      } else lines.push({ ...r });
    }
    return lines;
  } finally {
    page.cleanup();
  }
}
