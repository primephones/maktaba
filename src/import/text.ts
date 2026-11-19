import type { Block } from '../db/types';
import type { DraftSection, ParsedBook } from './types';
import { tocFromHeadings } from './sections';

export async function readText(file: Blob): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  // Byte-order marks first, then strict UTF-8, then the usual Arabic Windows code page.
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1256').decode(buf);
  }
}

const CHAPTER_WORD = /^(?:chapter|book|part|section)\s+[\dIVXLC]+\b|^(?:باب|فصل|كتاب|مقدمة|المقدمة|خاتمة|الخاتمة|مسألة|المسألة|فائدة|تنبيه)(?:\s|$|:)/i;

/** Plain text: blank lines separate paragraphs; short "Chapter"/"باب" lines become headings. */
export function parsePlainText(source: string): ParsedBook {
  const text = source.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  if (/^######OpenITI#/m.test(text.slice(0, 2000))) return parseOpenITI(text);

  const lines = text.split('\n');
  const blank = lines.filter((l) => !l.trim()).length;
  const hardWrapped = blank > lines.length * 0.08;
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    const joined = para.join(' ').replace(/\s+/g, ' ').trim();
    para = [];
    if (!joined) return;
    if (joined.length <= 90 && CHAPTER_WORD.test(joined)) blocks.push({ t: 'h', level: 2, text: joined });
    else blocks.push({ t: 'p', text: joined });
  };
  for (const line of lines) {
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line.trim());
    if (!hardWrapped) flush();
  }
  flush();
  const sections = sectionsFromBlocks(blocks);
  return { sections, toc: tocFromHeadings(sections) };
}

/** Markdown: headings, quotations, lists and emphasis; everything else is a paragraph. */
export function parseMarkdown(source: string): ParsedBook {
  const text = source.replace(/\r\n?/g, '\n').replace(/^﻿/, '');
  if (/^######OpenITI#/m.test(text.slice(0, 2000))) return parseOpenITI(text);

  const blocks: Block[] = [];
  let title: string | undefined;
  let para: string[] = [];
  let paraType: Block['t'] = 'p';
  let inCode = false;
  let code: string[] = [];

  const inline = (raw: string): Block => {
    // Links and images keep their text; emphasis becomes spans.
    let s = raw.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/`([^`]+)`/g, '$1');
    const spans: NonNullable<Block['spans']> = [];
    const re = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1|(\*)(?=\S)(.+?)(?<=\S)\3/g;
    let out = '';
    let last = 0;
    for (const m of s.matchAll(re)) {
      out += s.slice(last, m.index);
      const inner = (m[2] ?? m[4]).replace(/\*\*|__|\*/g, '');
      spans.push({ s: out.length, e: out.length + inner.length, k: m[1] ? 'b' : 'i' });
      out += inner;
      last = m.index + m[0].length;
    }
    out += s.slice(last);
    const lead = out.length - out.trimStart().length;
    s = out;
    for (const sp of spans) {
      sp.s = Math.max(0, sp.s - lead);
      sp.e = Math.max(0, sp.e - lead);
    }
    const b: Block = { t: 'p', text: s.trim() };
    if (spans.length) b.spans = spans.filter((sp) => sp.e <= b.text.length && sp.e > sp.s);
    return b;
  };

  const flush = () => {
    if (!para.length) return;
    const b = inline(para.join(' ').replace(/\s+/g, ' '));
    b.t = paraType;
    if (b.text) blocks.push(b);
    para = [];
    paraType = 'p';
  };

  for (const line of text.split('\n')) {
    if (/^\s*```/.test(line)) {
      if (inCode) {
        blocks.push({ t: 'pre', text: code.join('\n') });
        code = [];
      } else flush();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) {
      flush();
      const b = inline(h[2]);
      if (!b.text) continue;
      if (h[1].length === 1 && !title) title = b.text;
      blocks.push({ ...b, t: 'h', level: h[1].length });
      continue;
    }
    if (/^\s{0,3}(?:[-*_]\s*){3,}$/.test(line)) {
      flush();
      blocks.push({ t: 'hr', text: '' });
      continue;
    }
    const q = line.match(/^\s{0,3}>\s?(.*)$/);
    if (q) {
      if (paraType !== 'quote') flush();
      paraType = 'quote';
      para.push(q[1]);
      continue;
    }
    const li = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flush();
      paraType = 'li';
      para.push(li[1]);
      continue;
    }
    if (paraType === 'quote') flush();
    para.push(line.trim());
  }
  flush();
  if (inCode && code.length) blocks.push({ t: 'pre', text: code.join('\n') });

  const sections = sectionsFromBlocks(blocks);
  return { title, sections, toc: tocFromHeadings(sections) };
}

/**
 * OpenITI mARkdown: the corpus format for classical Arabic texts. Its structural codes
 * (page markers like PageV01P023, milestones like ms045, line continuations "~~") are
 * read as structure and never reach the page as stray text.
 */
export function parseOpenITI(source: string): ParsedBook {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let title: string | undefined;
  let author: string | undefined;
  let inMeta = true;
  let volume = 0;
  let printed = '';
  let current: Block | null = null;

  const cleanInline = (s: string): string => {
    let out = s;
    out = out.replace(/PageV(\d+)P(\d+)/g, (_m, v: string, p: string) => {
      volume = parseInt(v, 10);
      // Page 0 is the corpus's mark for "before the first page", not a page.
      printed = parseInt(p, 10) ? String(parseInt(p, 10)) : '';
      return ' ';
    });
    return out
      .replace(/\bms[A-Z]?\d+\b/g, ' ')
      .replace(/Milestone\d+/g, ' ')
      .replace(/@[A-Z]{2,}[@A-Z0-9_]*@?/g, ' ') // semantic tags such as @QUR@ or @RWY
      .replace(/#\$#[A-Z]+#?/g, ' ')
      .replace(/\$[A-Z_]+\$?/g, ' ')
      .replace(/%~%/g, ' ۞ ')
      .replace(/~~/g, ' ')
      .replace(/<\/?[a-z][^>]*>/gi, ' ') // HTML left in some Shamela texts
      .replace(/\b(?:EDITOR|PARATEXT)\|\s*=?/g, ' ') // editors' marks on volume headings
      .replace(/\b[A-Z]{2,}\b/g, ' ') // the corpus's own tags in capitals (CHECK, NO PAGE, a scanner's credit)
      .replace(/\b[A-Za-z]+(?:\s+[A-Za-z]+)+\b/g, ' ') // a line of English in an Arabic text: a digitiser's credit
      .replace(/(^|\s)[|$%@]+(?=\s|$)/g, ' ') // line breaks of the printed page (|) and loose markers
      .replace(/(^|\s)#+(?=\s|$)/g, ' ') // a paragraph mark left inside a line where a page broke it
      .replace(/^\s*AUTO\b\s*/, '') // headings made by the corpus's own tools are marked AUTO
      .replace(/\s+/g, ' ')
      .trim();
  };

  const stamp = (b: Block) => {
    if (printed) b.printed = volume > 1 ? `${volume}/${printed}` : printed;
    return b;
  };
  const flush = () => {
    if (current && current.text) blocks.push(current);
    current = null;
  };

  // Some Shamela commentaries mark the text commented on (the matn) with
  // <span class="matn">…</span>: its paragraphs are kept as quotations, set apart from the sharḥ.
  let inMatn = false;
  /** Follows the matn marks through a line, and says whether the line's text begins inside the matn. */
  const matnAt = (text: string): boolean => {
    let startsIn: boolean | null = null;
    const re = /<span[^>]*class="matn-hr"[^>]*>\s*<\/span>|<span[^>]*class="matn"[^>]*>|<\/span>|[^<\s]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m[0].startsWith('<span') && !/matn-hr/.test(m[0])) inMatn = true;
      else if (m[0] === '</span>') inMatn = false;
      else if (!m[0].startsWith('<') && startsIn === null && !/^[#~|]$/.test(m[0])) startsIn = inMatn;
    }
    return startsIn ?? inMatn;
  };

  /**
   * Continues the paragraph with a line. Some texts (Tabyīn al-Ḥaqāʾiq, al-Suyūṭī on al-Nasāʾī)
   * mark almost no paragraphs: a whole volume would be one paragraph, too long for a phone to
   * lay out. A long paragraph is ended where a printed page ends.
   */
  const addRun = (rawText: string, matn: boolean) => {
    const parts = rawText.split(/(?=PageV\d+P\d+)/);
    parts.forEach((part, i) => {
      if (i > 0 && current && current.text.length > 1500) flush();
      const text = cleanInline(part);
      if (!text) return;
      if (current) current.text = `${current.text} ${text}`.trim();
      else current = stamp({ t: matn ? 'quote' : 'p', text });
    });
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (inMeta) {
      if (/^#META#Header#End#/.test(line)) inMeta = false;
      const t = line.match(/^#META#.*?(?:Title|BookTITLE|020\.BookTITLE)\s*::\s*(.+)$/i);
      if (t && !title && !/NODATA|NOTGIVEN/i.test(t[1])) title = t[1].trim();
      const a = line.match(/^#META#.*?(?:AuthorName|AuthorNAME|010\.AuthorNAME)\s*::\s*(.+)$/i);
      if (a && !author && !/NODATA|NOTGIVEN/i.test(a[1])) author = a[1].trim();
      if (/^######OpenITI#/.test(line) || /^#META#/.test(line) || !line.trim()) continue;
      inMeta = false;
    }
    if (!line.trim()) continue;

    const head = line.match(/^###\s*(\|{1,6})\s*(.*)$/);
    if (head) {
      flush();
      const text = cleanInline(head[2]);
      // A heading with no words ("0000 -", "....") is a numbering left by the corpus.
      if (text && /\p{L}/u.test(text)) blocks.push(stamp({ t: 'h', level: Math.min(6, head[1].length + 1), text }));
      continue;
    }
    if (/^###\s*\$/.test(line) || /^###\s*@/.test(line)) {
      // Biography / event unit markers: start a new paragraph with the remaining text.
      flush();
      const text = cleanInline(line.replace(/^###\s*[$@]+[A-Z_]*\$?\s*/, ''));
      current = stamp({ t: 'p', text });
      continue;
    }
    const matn = /<\/?span/.test(line) ? matnAt(line) : inMatn;
    if (line.startsWith('# ')) {
      flush();
      // "# | 1 ( قوله … )": a commentary's quotation of its matn, numbered; the marks go.
      current = stamp({ t: matn ? 'quote' : 'p', text: cleanInline(line.slice(2).replace(/^\|\s*\d*\s*/, '')) });
      continue;
    }
    if (line.startsWith('~~')) {
      addRun(line.slice(2), matn);
      continue;
    }
    if (/^#+\s*$/.test(line)) continue;
    if (!cleanInline(line.replace(/^#+\s*/, '')) && !/PageV\d/.test(line)) continue;
    addRun(line.replace(/^#+\s*/, ''), matn);
  }
  flush();

  // A heading repeated on every page (Shamela puts "[the book's title]" before each page's
  // commentary) is not a heading: it would cut the book into a section per page.
  const seen = new Map<string, number>();
  for (const b of blocks) if (b.t === 'h') seen.set(b.text, (seen.get(b.text) ?? 0) + 1);
  const kept = blocks.filter((b) => b.text && !(b.t === 'h' && /^\[.*\]$/.test(b.text) && (seen.get(b.text) ?? 0) > 30)).flatMap(splitLong);
  const sections = sectionsFromBlocks(kept);
  return { title, author, sections, toc: tocFromHeadings(sections) };
}

/**
 * A paragraph longer than a phone screen can sensibly hold (a text with no paragraph marks, and
 * no page marks either) is cut at sentence ends, or failing that between words.
 */
export function splitLong(b: Block): Block[] {
  const LIMIT = 4000;
  if (b.text.length <= LIMIT || b.t === 'h') return [b];
  const out: Block[] = [];
  let rest = b.text;
  while (rest.length > LIMIT) {
    const window = rest.slice(1500, LIMIT);
    let cut = -1;
    for (const re of [/[.!?؟۔]\s/g, /[:؛]\s/g, /[،,]\s/g, /\s/g]) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(window))) cut = 1500 + m.index + m[0].length;
      if (cut > 0) break;
    }
    if (cut <= 0) cut = LIMIT;
    out.push({ ...b, text: rest.slice(0, cut).trim() });
    rest = rest.slice(cut);
  }
  if (rest.trim()) out.push({ ...b, text: rest.trim() });
  return out;
}

/** Groups a flat block list into sections at top-level headings. */
export function sectionsFromBlocks(blocks: Block[]): DraftSection[] {
  if (!blocks.length) return [];
  const levels = blocks.filter((b) => b.t === 'h').map((b) => b.level ?? 1);
  const top = levels.length ? Math.min(...levels) : 0;
  const sections: DraftSection[] = [];
  let cur: DraftSection = { title: '', blocks: [] };
  for (const b of blocks) {
    if (b.t === 'h' && (b.level ?? 1) === top && cur.blocks.length >= 3) {
      sections.push(cur);
      cur = { title: '', blocks: [] };
    }
    if (b.t === 'h' && !cur.title) cur.title = b.text;
    cur.blocks.push(b);
  }
  if (cur.blocks.length) sections.push(cur);
  sections.forEach((s, i) => {
    if (!s.title) s.title = sections.length === 1 ? 'Text' : `Part ${i + 1}`;
  });
  return sections;
}
