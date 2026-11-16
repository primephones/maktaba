import type { Block } from '../db/types';
import type { DraftSection, ParsedBook } from './types';
import { tocFromHeadings } from './sections';
import { readText } from './text';

const kids = (el: Element, name?: string) => Array.from(el.children).filter((c) => !name || c.localName === name);
const txt = (el: Element | null | undefined) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

export async function parseFb2(file: Blob): Promise<ParsedBook> {
  const doc = new DOMParser().parseFromString(await readText(file), 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('This FB2 file is damaged and could not be read.');
  const find = (name: string) => Array.from(doc.getElementsByTagName('*')).find((e) => e.localName === name);

  const info = find('title-info');
  const title = txt(info ? kids(info, 'book-title')[0] : null) || undefined;
  const authorEl = info ? kids(info, 'author')[0] : null;
  const author = authorEl
    ? ['first-name', 'middle-name', 'last-name'].map((n) => txt(kids(authorEl, n)[0])).filter(Boolean).join(' ') || undefined
    : undefined;

  const assets = new Map<string, Blob>();
  for (const bin of Array.from(doc.getElementsByTagName('*')).filter((e) => e.localName === 'binary')) {
    const id = bin.getAttribute('id');
    if (!id) continue;
    try {
      const raw = atob((bin.textContent || '').replace(/\s+/g, ''));
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      assets.set(id, new Blob([bytes], { type: bin.getAttribute('content-type') || 'image/jpeg' }));
    } catch {
      /* skip a damaged image */
    }
  }
  const hrefOf = (el: Element) => (el.getAttribute('l:href') || el.getAttribute('xlink:href') || el.getAttribute('href') || '').replace(/^#/, '');
  const coverImg = info ? Array.from(info.getElementsByTagName('*')).find((e) => e.localName === 'image') : undefined;
  const cover = coverImg ? assets.get(hrefOf(coverImg)) : undefined;

  const sections: DraftSection[] = [];
  const bodies = Array.from(doc.getElementsByTagName('*')).filter((e) => e.localName === 'body');
  const main = bodies.find((b) => !b.getAttribute('name')) ?? bodies[0];
  if (!main) throw new Error('This FB2 file has no text.');

  const emit = (el: Element, level: number, out: Block[]) => {
    for (const c of kids(el)) {
      switch (c.localName) {
        case 'title':
          for (const p of kids(c, 'p')) if (txt(p)) out.push({ t: 'h', level: Math.min(6, level), text: txt(p) });
          break;
        case 'p':
        case 'v':
          if (txt(c)) out.push({ t: 'p', text: txt(c) });
          break;
        case 'subtitle':
          if (txt(c)) out.push({ t: 'h', level: Math.min(6, level + 1), text: txt(c) });
          break;
        case 'epigraph':
        case 'cite':
          for (const p of kids(c)) if (txt(p)) out.push({ t: 'quote', text: txt(p) });
          break;
        case 'image': {
          const key = hrefOf(c);
          if (assets.has(key)) out.push({ t: 'img', text: '', src: key });
          break;
        }
        case 'empty-line':
          break;
        case 'poem':
        case 'stanza':
        case 'section':
          emit(c, level + 1, out);
          break;
        default:
          if (txt(c)) out.push({ t: 'p', text: txt(c) });
      }
    }
  };

  const top = kids(main, 'section');
  if (!top.length) {
    const blocks: Block[] = [];
    emit(main, 1, blocks);
    if (blocks.length) sections.push({ title: title ?? 'Text', blocks });
  } else {
    const lead: Block[] = [];
    for (const c of kids(main)) if (c.localName === 'title') for (const p of kids(c, 'p')) if (txt(p)) lead.push({ t: 'h', level: 1, text: txt(p) });
    top.forEach((sec, i) => {
      const blocks: Block[] = i === 0 ? [...lead] : [];
      emit(sec, 2, blocks);
      if (!blocks.length) return;
      const heading = blocks.find((b) => b.t === 'h' && b.level !== 1) ?? blocks.find((b) => b.t === 'h');
      sections.push({ title: heading?.text ?? `Section ${sections.length + 1}`, blocks });
    });
  }
  if (!sections.length) throw new Error('This FB2 file has no text.');
  return { title, author, sections, toc: tocFromHeadings(sections), cover, assets };
}
