import type { Block, InlineSpan, NoteMarker } from '../db/types';

const BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'li', 'pre', 'div', 'section', 'article',
  'aside', 'ul', 'ol', 'table', 'tr', 'td', 'th', 'tbody', 'thead', 'figure', 'figcaption', 'dl',
  'dt', 'dd', 'header', 'footer', 'main', 'nav', 'body', 'hr', 'center', 'address',
]);
const SKIP_TAGS = new Set(['script', 'style', 'head', 'template', 'svg', 'math', 'iframe', 'nav']);

export interface HtmlParseOptions {
  /** Resolves an <img src> to a stored asset key, or null to drop the image. */
  resolveImage?: (src: string) => string | null;
  /** Returns the text of the footnote a link points at, or null when it is an ordinary link. */
  resolveNote?: (href: string, el: Element) => string | null;
  /** Called with each element id and the index of the block that will hold it. */
  onAnchor?: (id: string, blockIndex: number) => void;
}

export interface HtmlParseResult {
  blocks: Block[];
  notes: Record<string, string>;
}

const epubType = (el: Element) =>
  (el.getAttribute('epub:type') || el.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || el.getAttribute('role') || '').toLowerCase();

export const isNoteContainer = (el: Element) => /footnote|endnote|rearnote|doc-footnote|doc-endnote/.test(epubType(el)) && !/noteref/.test(epubType(el));

const clean = (s: string) => s.replace(/[\s ]+/g, ' ');

/**
 * Turns a parsed HTML/XHTML tree into the app's flat block list: paragraphs, headings,
 * quotations, list items and images, with bold/italic runs and footnote markers kept.
 */
export function htmlToBlocks(root: Element, opts: HtmlParseOptions = {}): HtmlParseResult {
  const blocks: Block[] = [];
  const notes: Record<string, string> = {};
  let noteSeq = 0;

  let text = '';
  let spans: InlineSpan[] = [];
  let markers: NoteMarker[] = [];
  let pendingIds: string[] = [];
  let type: Block['t'] = 'p';
  let level: number | undefined;

  const flush = () => {
    const trimmedStart = text.length - text.trimStart().length;
    const t = text.trim();
    if (t) {
      const shift = (n: number) => Math.max(0, Math.min(t.length, n - trimmedStart));
      const block: Block = { t: type, text: t };
      if (level) block.level = level;
      const sp = spans.map((s) => ({ ...s, s: shift(s.s), e: shift(s.e) })).filter((s) => s.e > s.s);
      if (sp.length) block.spans = sp;
      if (markers.length) block.notes = markers.map((m) => ({ ...m, at: shift(m.at) }));
      for (const id of pendingIds) opts.onAnchor?.(id, blocks.length);
      pendingIds = [];
      blocks.push(block);
    }
    text = '';
    spans = [];
    markers = [];
    type = 'p';
    level = undefined;
  };

  const addText = (s: string) => {
    const c = clean(s);
    if (!c) return;
    if (c === ' ' && (text === '' || text.endsWith(' '))) return;
    text += text.endsWith(' ') && c.startsWith(' ') ? c.slice(1) : c;
  };

  const walk = (node: Node, ctx: { b: boolean; i: boolean; pre: boolean }) => {
    if (node.nodeType === 3) {
      if (ctx.pre) text += node.nodeValue ?? '';
      else addText(node.nodeValue ?? '');
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.localName.toLowerCase();
    if (SKIP_TAGS.has(tag) || isNoteContainer(el)) return;

    const id = el.getAttribute('id');
    if (id) pendingIds.push(id);

    if (tag === 'br') {
      if (ctx.pre) text += '\n';
      else addText(' ');
      return;
    }
    if (tag === 'hr') {
      flush();
      blocks.push({ t: 'hr', text: '' });
      return;
    }
    if (tag === 'img' || tag === 'image') {
      const src = el.getAttribute('src') || el.getAttribute('xlink:href') || el.getAttribute('href') || '';
      const key = src && opts.resolveImage ? opts.resolveImage(src) : null;
      if (key) {
        flush();
        for (const pid of pendingIds) opts.onAnchor?.(pid, blocks.length);
        pendingIds = [];
        blocks.push({ t: 'img', text: el.getAttribute('alt') || '', src: key });
      }
      return;
    }
    if (tag === 'a') {
      const href = el.getAttribute('href') || '';
      const isRef = /noteref/.test(epubType(el)) || (!!el.closest('sup') || !!el.querySelector('sup')) || /^\s*[[(]?\d{1,3}[\])]?\s*$/.test(el.textContent || '');
      if (href && isRef && opts.resolveNote) {
        const noteText = opts.resolveNote(href, el);
        if (noteText) {
          const key = `n${++noteSeq}`;
          notes[key] = noteText;
          const label = clean(el.textContent || '').trim().replace(/^[[(]|[\])]$/g, '') || String(noteSeq);
          markers.push({ at: text.length, id: key, label });
          return;
        }
      }
    }

    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) {
      flush();
      if (/^h[1-6]$/.test(tag)) {
        type = 'h';
        level = parseInt(tag[1], 10);
      } else if (tag === 'blockquote') type = 'quote';
      else if (tag === 'li') type = 'li';
      else if (tag === 'pre') type = 'pre';
    }

    const bold = ctx.b || tag === 'b' || tag === 'strong';
    const ital = ctx.i || tag === 'i' || tag === 'em' || tag === 'cite';
    const start = text.length;
    const inherited = { t: type, l: level };
    for (const child of Array.from(el.childNodes)) {
      walk(child, { b: bold, i: ital, pre: ctx.pre || tag === 'pre' });
      // A nested block ended our paragraph; carry a blockquote/list context on.
      if (isBlock && text === '' && (inherited.t === 'quote' || inherited.t === 'li')) type = inherited.t;
    }
    if (!isBlock) {
      if (bold && !ctx.b && text.length > start) spans.push({ s: start, e: text.length, k: 'b' });
      if (ital && !ctx.i && text.length > start) spans.push({ s: start, e: text.length, k: 'i' });
    } else {
      flush();
    }
  };

  walk(root, { b: false, i: false, pre: false });
  flush();
  return { blocks, notes };
}

export function parseHtml(source: string, mime: 'text/html' | 'application/xhtml+xml' = 'text/html'): Document {
  let doc = new DOMParser().parseFromString(source, mime);
  // Strict XML parsing fails on sloppy EPUBs; fall back to the forgiving HTML parser.
  if (mime !== 'text/html' && doc.getElementsByTagName('parsererror').length) {
    doc = new DOMParser().parseFromString(source, 'text/html');
  }
  return doc;
}
