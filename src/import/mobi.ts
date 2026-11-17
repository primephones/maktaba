import { unzlibSync } from 'fflate';
import type { TocEntry } from '../db/types';
import type { DraftSection, ParsedBook } from './types';
import { htmlToBlocks, parseHtml } from './html';
import { tocFromHeadings } from './sections';

interface FoliateSection {
  linear?: string;
  load?: () => Promise<string>;
}
interface FoliateToc {
  label: string;
  href: string;
  subitems?: FoliateToc[];
}
interface FoliateBook {
  sections: FoliateSection[];
  toc?: FoliateToc[];
  metadata: { title?: string; author?: string[]; publisher?: string };
  getCover(): Promise<Blob | null>;
  resolveHref(href: string): Promise<{ index: number; anchor?: (doc: Document) => Element | null } | undefined> | { index: number; anchor?: (doc: Document) => Element | null } | undefined;
  destroy?(): void;
}

/** Kindle books: MOBI, AZW and AZW3 (KF8). Copy-protected Kindle files cannot be opened. */
export async function parseMobi(file: Blob): Promise<ParsedBook> {
  const { MOBI, isMOBI } = await import('foliate-js/mobi.js');
  if (!(await isMOBI(file))) throw new Error('This Kindle file could not be read. It may be in the newer KFX format, which only Kindle apps open.');
  const head = new DataView(await file.slice(0, 78 + 8).arrayBuffer());
  const record0 = head.getUint32(78);
  const encryption = new DataView(await file.slice(record0 + 12, record0 + 14).arrayBuffer()).getUint16(0);
  if (encryption !== 0) throw new Error('This Kindle book is copy-protected (DRM), so it can only be opened in a Kindle app.');

  const book = (await new MOBI({ unzlib: unzlibSync }).open(file)) as FoliateBook;
  const sections: DraftSection[] = [];
  const assets = new Map<string, Blob>();
  const toc: TocEntry[] = [];

  // Contents entries, flattened with their depth, resolved to a section and an anchor.
  const flat: Array<{ label: string; href: string; level: number }> = [];
  const walk = (items: FoliateToc[] | undefined, level: number) => {
    for (const t of items ?? []) {
      flat.push({ label: (t.label || '').replace(/\s+/g, ' ').trim(), href: t.href, level });
      walk(t.subitems, level + 1);
    }
  };
  walk(book.toc, 1);
  const targets = await Promise.all(flat.map(async (t) => {
    try {
      return await book.resolveHref(t.href);
    } catch {
      return undefined;
    }
  }));

  let imageSeq = 0;
  for (let i = 0; i < book.sections.length; i++) {
    const s = book.sections[i];
    if (!s.load || s.linear === 'no') continue;
    const url = await s.load();
    const html = await (await fetch(url)).text();
    const doc = parseHtml(html, 'application/xhtml+xml');

    // Mark where each contents entry points, so it can be found after conversion.
    flat.forEach((t, k) => {
      const target = targets[k];
      if (!target || target.index !== i) return;
      const el = target.anchor?.(doc) ?? null;
      if (el && !el.getAttribute('id')) el.setAttribute('id', `maktaba-toc-${k}`);
      (t as { id?: string }).id = el?.getAttribute('id') ?? undefined;
    });

    // Pictures are held as temporary blob addresses; keep them as stored assets.
    const imageKeys = new Map<string, string>();
    for (const img of Array.from(doc.getElementsByTagName('img'))) {
      const src = img.getAttribute('src') || '';
      if (!src.startsWith('blob:') || imageKeys.has(src)) continue;
      try {
        const blob = await (await fetch(src)).blob();
        if (blob.size < 200) continue;
        const key = `image-${++imageSeq}`;
        assets.set(key, blob);
        imageKeys.set(src, key);
      } catch {
        /* a missing picture is skipped */
      }
    }

    const idx = sections.length;
    const anchors = new Map<string, number>();
    const body = doc.getElementsByTagName('body')[0] ?? doc.documentElement;
    const { blocks, notes } = htmlToBlocks(body, {
      resolveImage: (src) => imageKeys.get(src) ?? null,
      resolveNote: (href) => {
        const id = href.startsWith('#') ? href.slice(1) : null;
        const target = id ? doc.getElementById(id) : null;
        const text = target?.closest('p, li, div, aside')?.textContent?.replace(/\s+/g, ' ').trim();
        return text && text.length < 1500 ? text : null;
      },
      onAnchor: (id, block) => anchors.set(id, block),
    });
    if (!blocks.length) continue;
    flat.forEach((t, k) => {
      const id = (t as { id?: string }).id;
      if (targets[k]?.index === i && t.label) toc.push({ title: t.label, section: idx, block: id ? anchors.get(id) ?? 0 : 0, level: t.level });
    });
    const heading = blocks.find((b) => b.t === 'h');
    sections.push({ title: heading?.text.slice(0, 120) ?? '', blocks, notes: Object.keys(notes).length ? notes : undefined });
  }
  book.destroy?.();
  if (!sections.length) throw new Error('This Kindle book has no readable text.');
  for (const t of toc) if (!sections[t.section].title && (t.block ?? 0) === 0) sections[t.section].title = t.title;
  sections.forEach((s, i) => {
    if (!s.title) s.title = `Section ${i + 1}`;
  });

  let cover: Blob | undefined;
  try {
    cover = (await book.getCover()) ?? undefined;
  } catch {
    cover = undefined;
  }
  const meta = book.metadata ?? {};
  return {
    title: meta.title?.trim() || undefined,
    author: meta.author?.filter(Boolean).join(', ') || undefined,
    edition: meta.publisher?.trim() || undefined,
    sections,
    toc: toc.length ? toc : tocFromHeadings(sections),
    cover,
    assets,
  };
}
