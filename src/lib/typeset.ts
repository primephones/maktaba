/**
 * Drawing words onto pictures: quote cards to share, and the pages of a notebook or a book's
 * English saved as a PDF. Each line is measured and broken by words, right to left for
 * Arabic, Persian and Urdu, in the app's own typefaces, and in the colours of the theme.
 */
import { hasArabicScript } from './arabic';

export interface Ink {
  bg: string;
  ink: string;
  ink2: string;
  accent: string;
  gold: string;
  line: string;
}

/** The colours of the theme in use, for a picture that matches what is on screen. */
export function themeInk(): Ink {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return { bg: v('--surface', '#fcfbf8'), ink: v('--ink', '#1d1c1a'), ink2: v('--ink-2', '#4a4741'), accent: v('--rubric', '#a3302a'), gold: v('--gold-soft', '#b79a57'), line: v('--line', '#ddd7c9') };
}

/** Paper colours, for pages meant to be printed or read anywhere. */
export const PAPER: Ink = { bg: '#ffffff', ink: '#1d1c1a', ink2: '#4a4741', accent: '#a3302a', gold: '#b79a57', line: '#ddd7c9' };

export type Script = 'latin' | 'arabic' | 'urdu';
export const scriptOf = (text: string, lang?: string): Script => (lang === 'ur' ? 'urdu' : hasArabicScript(text) ? 'arabic' : 'latin');

const FACE: Record<Script, string> = {
  latin: "'Literata Variable', 'Literata', Georgia, serif",
  arabic: "'Amiri', 'Noto Naskh Arabic', serif",
  urdu: "'Noto Nastaliq Urdu', 'Amiri', serif",
};
/** Line height as a share of the type size: Nastaliq needs far more room. */
const LEADING: Record<Script, number> = { latin: 1.5, arabic: 1.75, urdu: 2.25 };

export const fontOf = (script: Script, size: number, style = '') => `${style ? `${style} ` : ''}${size}px ${FACE[script]}`;

/** Makes sure the typefaces are loaded before anything is drawn with them. */
export async function fontsReady(): Promise<void> {
  await Promise.all([
    document.fonts.load(fontOf('latin', 40)),
    document.fonts.load(fontOf('latin', 40, 'italic')),
    document.fonts.load(fontOf('arabic', 40)),
    document.fonts.load(fontOf('urdu', 40, ''), 'ابت'),
    document.fonts.load(fontOf('arabic', 40), 'ابت'),
  ]).catch(() => undefined);
}

/** Breaks a text into lines no wider than `width`, by words (and by letters for one over-long word). */
export function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n+/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width <= width || !line) {
        line = next;
        if (ctx.measureText(line).width > width && !line.includes(' ')) {
          // A single word wider than the line: broken where it must be.
          let part = '';
          for (const ch of line) {
            if (ctx.measureText(part + ch).width > width && part) {
              out.push(part);
              part = ch;
            } else part += ch;
          }
          line = part;
        }
      } else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export interface Run {
  text: string;
  script: Script;
  size: number;
  color: string;
  style?: string;
  /** Space after the block, in pixels. */
  after?: number;
  align?: 'start' | 'center';
}

/** How tall a block of text is, laid out at this width. */
export function measureRun(ctx: CanvasRenderingContext2D, run: Run, width: number): { lines: string[]; height: number; lh: number } {
  ctx.font = fontOf(run.script, run.size, run.style);
  const lines = wrap(ctx, run.text, width);
  const lh = run.size * LEADING[run.script];
  return { lines, height: lines.length * lh + (run.after ?? 0), lh };
}

/** Draws a block of text at (x, y) within `width`; returns where the next block starts. */
export function drawRun(ctx: CanvasRenderingContext2D, run: Run, x: number, y: number, width: number, laid = measureRun(ctx, run, width)): number {
  const rtl = run.script !== 'latin';
  ctx.font = fontOf(run.script, run.size, run.style);
  ctx.fillStyle = run.color;
  ctx.textBaseline = 'alphabetic';
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = run.align === 'center' ? 'center' : rtl ? 'right' : 'left';
  const ax = run.align === 'center' ? x + width / 2 : rtl ? x + width : x;
  let at = y;
  for (const line of laid.lines) {
    at += laid.lh;
    ctx.fillText(line, ax, at - laid.lh * (run.script === 'urdu' ? 0.38 : 0.28));
  }
  ctx.direction = 'ltr';
  return at + (run.after ?? 0);
}

/** The eight-pointed star, drawn as a small ornament. */
export function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, r / 9);
  ctx.lineJoin = 'round';
  for (const turn of [0, Math.PI / 4]) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(turn);
    ctx.strokeRect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
    ctx.restore();
  }
  ctx.restore();
}

export const toBlob = (canvas: HTMLCanvasElement, type = 'image/png', quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The picture could not be made.'))), type, quality));

/**
 * A passage as a picture to share: the original set large, its English beneath, and the
 * book it is from, in the colours of the theme.
 */
export async function quoteCard(opts: { original?: string; lang?: string; english?: string; source: string; ink?: Ink }): Promise<Blob> {
  await fontsReady();
  const ink = opts.ink ?? themeInk();
  const W = 1080;
  const H = 1350;
  const pad = 96;
  const width = W - pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = ink.bg;
  ctx.fillRect(0, 0, W, H);
  // A double rule round the edge, as on a printed page.
  ctx.strokeStyle = ink.gold;
  ctx.lineWidth = 3;
  ctx.strokeRect(44, 44, W - 88, H - 88);
  ctx.lineWidth = 1;
  ctx.strokeRect(56, 56, W - 112, H - 112);

  // Each part made smaller until everything fits between the ornament and the foot.
  const room = H - pad * 2 - 230;
  let scale = 1;
  let runs: Run[] = [];
  for (; scale > 0.3; scale -= 0.06) {
    runs = [];
    if (opts.original) runs.push({ text: opts.original, script: scriptOf(opts.original, opts.lang), size: Math.round(64 * scale), color: ink.ink, after: opts.english ? 30 : 0 });
    if (opts.english) runs.push({ text: opts.english, script: 'latin', size: Math.round((opts.original ? 38 : 50) * scale), color: opts.original ? ink.ink2 : ink.ink, style: opts.original ? 'italic' : '' });
    const total = runs.reduce((n, r) => n + measureRun(ctx, r, width).height, 0) + (opts.original && opts.english ? 40 : 0);
    if (total <= room) break;
  }
  drawStar(ctx, W / 2, pad + 40, 26, ink.gold);
  const heights = runs.map((r) => measureRun(ctx, r, width));
  const body = heights.reduce((n, h) => n + h.height, 0) + (opts.original && opts.english ? 40 : 0);
  let y = pad + 110 + Math.max(0, (room - body) / 2);
  runs.forEach((r, i) => {
    y = drawRun(ctx, r, pad, y, width, heights[i]);
    if (i === 0 && runs.length > 1) {
      ctx.fillStyle = ink.gold;
      ctx.fillRect(W / 2 - 60, y + 4, 120, 2);
      y += 40;
    }
  });
  // The source, and the app's name, at the foot.
  const foot: Run = { text: opts.source, script: scriptOf(opts.source), size: 30, color: ink.ink2, align: 'center' };
  drawRun(ctx, foot, pad, H - pad - 110, width);
  ctx.font = fontOf('latin', 26);
  ctx.fillStyle = ink.accent;
  ctx.textAlign = 'center';
  ctx.direction = 'ltr';
  ctx.fillText('Maktaba · مكتبة', W / 2, H - pad + 6);
  return toBlob(canvas);
}

/** One entry on a page: blocks of text set one after another, kept together where they fit. */
export type Entry = Run[];

/**
 * Lays entries out on pages of the given size (pixels), starting each page with a running
 * head, and returns each page as a JPEG.
 */
export async function pagesOf(entries: Entry[], opts: { width?: number; height?: number; head: string; ink?: Ink; title?: Entry }): Promise<Array<{ data: Uint8Array; width: number; height: number }>> {
  await fontsReady();
  const W = opts.width ?? 1240;
  const H = opts.height ?? 1754;
  const ink = opts.ink ?? PAPER;
  const margin = 120;
  const width = W - margin * 2;
  const pages: Array<{ data: Uint8Array; width: number; height: number }> = [];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  let y = 0;
  let n = 0;
  const start = () => {
    n++;
    ctx.fillStyle = ink.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.font = fontOf('latin', 22);
    ctx.fillStyle = ink.ink2;
    ctx.textAlign = 'center';
    ctx.direction = 'ltr';
    ctx.fillText(`${opts.head} · ${n}`, W / 2, H - 60);
    y = margin;
  };
  const finish = async () => {
    const blob = await toBlob(canvas, 'image/jpeg', 0.86);
    pages.push({ data: new Uint8Array(await blob.arrayBuffer()), width: W, height: H });
  };
  start();
  const all = opts.title ? [opts.title, ...entries] : entries;
  for (const entry of all) {
    const laid = entry.map((r) => measureRun(ctx, r, width));
    const height = laid.reduce((s, l) => s + l.height, 0);
    if (y + height > H - margin && y > margin) {
      await finish();
      start();
    }
    for (let i = 0; i < entry.length; i++) {
      const r = entry[i];
      if (y + laid[i].height <= H - margin) {
        y = drawRun(ctx, r, margin, y, width, laid[i]);
        continue;
      }
      // A block taller than what is left of the page runs on, line by line, onto the next.
      for (const line of laid[i].lines) {
        if (y + laid[i].lh > H - margin) {
          await finish();
          start();
        }
        y = drawRun(ctx, { ...r, after: 0 }, margin, y, width, { lines: [line], height: laid[i].lh, lh: laid[i].lh });
      }
      y += r.after ?? 0;
    }
    y += 26;
  }
  await finish();
  return pages;
}

/** A PDF of whole-page pictures (JPEG): every page as it was drawn. */
export function pdfOfPages(pages: Array<{ data: Uint8Array; width: number; height: number }>): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (b: Uint8Array | string) => {
    const bytes = typeof b === 'string' ? enc.encode(b) : b;
    parts.push(bytes);
    size += bytes.length;
  };
  const obj = (id: number, body: string | Array<string | Uint8Array>) => {
    offsets[id] = size;
    push(`${id} 0 obj\n`);
    for (const p of Array.isArray(body) ? body : [body]) push(p);
    push('\nendobj\n');
  };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  // A4: 595 × 842 points.
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const page = 3 + i * 3;
    const content = `q 595 0 0 842 0 0 cm /Im0 Do Q`;
    obj(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${page + 2} 0 R >> >> /Contents ${page + 1} 0 R >>`);
    obj(page + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    obj(page + 2, [`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.data.length} >>\nstream\n`, p.data, '\nendstream']);
  });
  const count = 3 + pages.length * 3;
  const xref = size;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let i = 1; i < count; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}
