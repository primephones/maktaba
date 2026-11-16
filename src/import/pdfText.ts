import type { Block } from '../db/types';

/** The parts of a pdf.js text item this module needs. */
export interface TextItem {
  str: string;
  /** [a, b, c, d, x, y] */
  transform: number[];
  width: number;
  height: number;
}

interface Line {
  y: number;
  size: number;
  left: number;
  right: number;
  text: string;
}

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const LATIN = /[A-Za-z]/g;
const DIGITS_ONLY = /^[\s\-–—.·•|\[\]()]*([0-9٠-٩۰-۹]{1,4})[\s\-–—.·•|\[\]()]*$/;
const TERMINAL = /[.؟?!:۔。…»"”)\]]\s*$/;

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** Presentation-form glyphs and ligatures become ordinary letters. */
const tidy = (s: string) => s.normalize('NFKC').replace(/[​­]/g, '').replace(/\s+/g, ' ');

const MARKS_ONLY = /^[\s\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]+$/;
const UNMAPPED = /[\u0000\uFFFD\uE000-\uF8FF]/g;

/**
 * Measures how trustworthy a page's built-in text is. Many Arabic PDFs carry a text layer
 * in which some glyphs have no character behind them, so letters silently go missing.
 * Returns the number of such glyphs and the number of real characters.
 */
export function textDamage(items: TextItem[]): { bad: number; total: number } {
  let bad = 0;
  let total = 0;
  for (const it of items) {
    if (!it.str) continue;
    bad += (it.str.match(UNMAPPED) || []).length;
    total += it.str.replace(/\s/g, '').length;
  }
  return { bad, total };
}

/** True when enough letters are missing that showing the text would misquote the book. */
export const isDamaged = (d: { bad: number; total: number }) => d.bad >= 3 && d.bad / Math.max(1, d.total) > 0.002;

/** Groups positioned text fragments into lines, in reading order for the line's script. */
export function itemsToLines(items: TextItem[]): Line[] {
  const frags = items
    .map((it) => {
      let str = (it.str || '').replace(UNMAPPED, '');
      // A vowel mark drawn on its own carries no space of its own.
      const mark = MARKS_ONLY.test(str) && /\S/.test(str);
      if (mark) str = str.replace(/\s+/g, '');
      return {
        str,
        mark,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width,
        size: Math.abs(it.transform[3]) || Math.hypot(it.transform[1], it.transform[3]) || it.height || 10,
      };
    })
    .filter((f) => f.str.trim());
  frags.sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: Array<typeof frags> = [];
  for (const f of frags) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].y - f.y) < Math.max(row[0].size, f.size) * 0.45) row.push(f);
    else rows.push([f]);
  }

  return rows.map((row) => {
    const joined = row.map((f) => f.str).join('');
    const rtl = (joined.match(ARABIC) || []).length > (joined.match(LATIN) || []).length;
    row.sort((a, b) => (rtl ? b.x + b.w - (a.x + a.w) : a.x - b.x));
    let text = '';
    let prev: (typeof row)[number] | null = null;
    for (const f of row) {
      if (f.mark) {
        // Attach the mark to the letter before it without disturbing the spacing logic.
        text = text.replace(/\s+$/, '') + f.str;
        continue;
      }
      if (prev) {
        const gap = rtl ? prev.x - (f.x + f.w) : f.x - (prev.x + prev.w);
        if (gap > Math.min(prev.size, f.size) * 0.18 && !text.endsWith(' ') && !f.str.startsWith(' ')) text += ' ';
      }
      text += f.str;
      prev = f;
    }
    return {
      y: row[0].y,
      size: median(row.map((f) => f.size)),
      left: Math.min(...row.map((f) => f.x)),
      right: Math.max(...row.map((f) => f.x + f.w)),
      text: tidy(text).trim(),
    };
  }).filter((l) => l.text);
}

export interface PageText {
  blocks: Block[];
  /** The page number printed on the page, if one was found. */
  printed?: string;
  /** Whether the page's last paragraph looks unfinished (continues on the next page). */
  openEnded: boolean;
  chars: number;
}

/**
 * Rebuilds paragraphs and headings from the lines of one page. A lone number at the top or
 * bottom is taken as the printed page number and kept out of the text.
 */
export function linesToBlocks(lines: Line[], page: number): PageText {
  let printed: string | undefined;
  const body = [...lines];
  if (body.length > 1) {
    const last = body[body.length - 1].text.match(DIGITS_ONLY);
    const head = body[0].text.match(DIGITS_ONLY);
    if (last) {
      printed = last[1];
      body.pop();
    } else if (head) {
      printed = head[1];
      body.shift();
    }
  }
  if (!body.length) return { blocks: [], printed, openEnded: false, chars: 0 };

  const bodySize = median(body.map((l) => l.size));
  const gaps: number[] = [];
  for (let i = 1; i < body.length; i++) gaps.push(body[i - 1].y - body[i].y);
  // Ordinary line spacing is the common small gap, so take the lower middle value:
  // on a page with few lines, one paragraph break must not pass for the norm.
  const positive = gaps.filter((g) => g > 0).sort((a, b) => a - b);
  const lineGap = positive.length ? positive[Math.floor((positive.length - 1) / 2)] : bodySize * 1.4;
  const width = Math.max(...body.map((l) => l.right)) - Math.min(...body.map((l) => l.left));

  const blocks: Block[] = [];
  let para: Line[] = [];
  const flush = () => {
    if (!para.length) return;
    let text = '';
    for (const l of para) {
      if (!text) text = l.text;
      else if (/[A-Za-z]-$/.test(text) && /^[a-z]/.test(l.text)) text = text.slice(0, -1) + l.text;
      else text += ' ' + l.text;
    }
    const size = median(para.map((l) => l.size));
    const isHeading = size > bodySize * 1.18 && text.length <= 120 && para.length <= 2;
    const b: Block = isHeading ? { t: 'h', level: size > bodySize * 1.5 ? 2 : 3, text, page } : { t: 'p', text, page };
    if (printed) b.printed = printed;
    blocks.push(b);
    para = [];
  };

  for (let i = 0; i < body.length; i++) {
    const l = body[i];
    const prev = body[i - 1];
    if (prev && para.length) {
      const gap = prev.y - l.y;
      const sizeChange = Math.abs(l.size - prev.size) > bodySize * 0.15;
      const prevShort = prev.right - prev.left < width * 0.82;
      if (gap > lineGap * 1.45 || gap < 0 || sizeChange || (prevShort && TERMINAL.test(prev.text))) flush();
    }
    para.push(l);
  }
  const lastLine = body[body.length - 1];
  const openEnded = !TERMINAL.test(lastLine.text) && lastLine.right - lastLine.left >= width * 0.82;
  flush();
  return { blocks, printed, openEnded, chars: blocks.reduce((n, b) => n + b.text.length, 0) };
}

/**
 * Drops running headers: a first line that repeats (ignoring digits) across several pages
 * of a batch is the book or chapter title printed at the top, not part of the text.
 */
export function dropRunningHeaders(pages: PageText[]): void {
  const key = (s: string) => s.replace(/[0-9٠-٩۰-۹\s\-–—.|]/g, '');
  const counts = new Map<string, number>();
  for (const p of pages) {
    const first = p.blocks[0];
    if (first && first.t === 'p' && first.text.length <= 80) counts.set(key(first.text), (counts.get(key(first.text)) ?? 0) + 1);
  }
  for (const p of pages) {
    const first = p.blocks[0];
    // Only plain small lines qualify: a large-type line is a chapter heading, not a header.
    if (!first || first.t !== 'p' || first.text.length > 80 || p.blocks.length < 2) continue;
    const k = key(first.text);
    if (k && (counts.get(k) ?? 0) >= Math.max(3, Math.ceil(pages.length * 0.4))) p.blocks.shift();
  }
}

/** Joins a paragraph cut by a page break with its continuation on the next page. */
export function mergeAcrossPages(pages: PageText[]): Block[] {
  const out: Block[] = [];
  let open = false;
  for (const p of pages) {
    p.blocks.forEach((b, i) => {
      const prev = out[out.length - 1];
      if (i === 0 && open && prev && prev.t === 'p' && b.t === 'p') {
        prev.text = /[A-Za-z]-$/.test(prev.text) && /^[a-z]/.test(b.text) ? prev.text.slice(0, -1) + b.text : `${prev.text} ${b.text}`;
      } else out.push(b);
    });
    if (p.blocks.length) open = p.openEnded;
  }
  return out;
}
