import { unzipSync, strFromU8 } from 'fflate';
import type { TocEntry } from '../db/types';
import type { DraftSection, ParsedBook } from './types';
import { htmlToBlocks, isNoteContainer, parseHtml } from './html';
import { tocFromHeadings } from './sections';

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '');

/** Resolves a relative href against the file that contains it, inside the zip. */
function resolvePath(base: string, href: string): string {
  let h = href.split('#')[0];
  try {
    h = decodeURIComponent(h);
  } catch {
    /* keep as written */
  }
  if (h.startsWith('/')) return h.slice(1);
  const parts = (dirOf(base) + h).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

const first = (parent: Element | Document, name: string): Element | null => {
  const all = parent.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) if (all[i].localName === name) return all[i];
  return null;
};
const every = (parent: Element | Document, name: string): Element[] => {
  const all = parent.getElementsByTagName('*');
  const out: Element[] = [];
  for (let i = 0; i < all.length; i++) if (all[i].localName === name) out.push(all[i]);
  return out;
};

export async function parseEpub(file: Blob): Promise<ParsedBook> {
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  // Zip entry names are matched case-insensitively: some EPUB tools get the case wrong.
  const lower = new Map<string, string>();
  for (const name of Object.keys(zip)) lower.set(name.toLowerCase(), name);
  const entry = (path: string) => zip[path] ?? zip[lower.get(path.toLowerCase()) ?? ''];
  const text = (path: string) => {
    const e = entry(path);
    return e ? strFromU8(e).replace(/^﻿/, '') : null;
  };
  const xml = (src: string) => new DOMParser().parseFromString(src, 'application/xml');

  const container = text('META-INF/container.xml');
  if (!container) throw new Error('This file is not a valid EPUB (no container found).');
  if (entry('META-INF/encryption.xml') && /EncryptedData/.test(text('META-INF/encryption.xml') ?? '') && entry('META-INF/rights.xml')) {
    throw new Error('This EPUB is copy-protected (DRM) and cannot be opened.');
  }
  const opfPath = first(xml(container), 'rootfile')?.getAttribute('full-path');
  const opfSrc = opfPath ? text(opfPath) : null;
  if (!opfPath || !opfSrc) throw new Error('This EPUB is missing its package file.');
  const opf = xml(opfSrc);

  const meta = (name: string) => first(opf, name)?.textContent?.trim() || undefined;
  const title = meta('title');
  const author = every(opf, 'creator').map((c) => c.textContent?.trim()).filter(Boolean).join(', ') || undefined;

  interface Item { id: string; href: string; path: string; type: string; props: string }
  const manifest = new Map<string, Item>();
  const byPath = new Map<string, Item>();
  for (const it of every(opf, 'item')) {
    const href = it.getAttribute('href') || '';
    const item: Item = {
      id: it.getAttribute('id') || '',
      href,
      path: resolvePath(opfPath, href),
      type: it.getAttribute('media-type') || '',
      props: it.getAttribute('properties') || '',
    };
    manifest.set(item.id, item);
    byPath.set(item.path.toLowerCase(), item);
  }
  const spineEl = first(opf, 'spine');
  const spine = every(opf, 'itemref')
    .filter((r) => (r.getAttribute('linear') || 'yes') !== 'no')
    .map((r) => manifest.get(r.getAttribute('idref') || ''))
    .filter((i): i is Item => !!i);
  if (!spine.length) throw new Error('This EPUB has no readable chapters.');

  // Cover: EPUB 3 property, then EPUB 2 <meta name="cover">, then a file named "cover".
  let coverItem = [...manifest.values()].find((i) => /\bcover-image\b/.test(i.props));
  if (!coverItem) {
    const metaCover = every(opf, 'meta').find((m) => m.getAttribute('name') === 'cover')?.getAttribute('content');
    if (metaCover) coverItem = manifest.get(metaCover);
  }
  if (!coverItem) coverItem = [...manifest.values()].find((i) => i.type.startsWith('image/') && /cover/i.test(i.href));
  const blobOf = (item: Item): Blob | undefined => {
    const data = entry(item.path);
    if (!data) return undefined;
    const ext = item.path.split('.').pop()?.toLowerCase() ?? '';
    return new Blob([data as BlobPart], { type: item.type || MIME[ext] || 'application/octet-stream' });
  };
  const cover = coverItem ? blobOf(coverItem) : undefined;

  // Parse every chapter document up front so footnote links can be resolved across files.
  const docs = new Map<string, Document>();
  for (const item of spine) {
    const src = text(item.path);
    if (src) docs.set(item.path, parseHtml(src, /xhtml|xml/.test(item.type) ? 'application/xhtml+xml' : 'text/html'));
  }
  const findById = (doc: Document, id: string): Element | null => {
    const direct = doc.getElementById(id);
    if (direct) return direct;
    const all = doc.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) if (all[i].getAttribute('id') === id) return all[i];
    return null;
  };

  const assets = new Map<string, Blob>();
  const sections: DraftSection[] = [];
  const anchors = new Map<string, { section: number; block: number }>();
  const sectionOfPath = new Map<string, number>();

  for (const item of spine) {
    const doc = docs.get(item.path);
    if (!doc) continue;
    const body = first(doc, 'body') ?? doc.documentElement;
    if (!body) continue;
    const idx = sections.length;
    const { blocks, notes } = htmlToBlocks(body, {
      resolveImage: (src) => {
        if (src.startsWith('data:')) return null;
        const path = resolvePath(item.path, src);
        const it = byPath.get(path.toLowerCase());
        if (!it) return null;
        if (!assets.has(it.path)) {
          const blob = blobOf(it);
          if (!blob || blob.size < 200) return null;
          assets.set(it.path, blob);
        }
        return it.path;
      },
      resolveNote: (href, el) => {
        const frag = href.split('#')[1];
        if (!frag) return null;
        const targetPath = href.startsWith('#') ? item.path : resolvePath(item.path, href);
        const targetDoc = docs.get(targetPath) ?? docs.get(byPath.get(targetPath.toLowerCase())?.path ?? '');
        if (!targetDoc) return null;
        let target = findById(targetDoc, decodeURIComponent(frag));
        if (!target) return null;
        // The id often sits on a back-link inside the note; climb to the note itself.
        let scope: Element = target;
        for (let p: Element | null = target; p; p = p.parentElement) {
          if (isNoteContainer(p)) {
            scope = p;
            break;
          }
        }
        if (scope === target && /^(a|sup|span)$/i.test(target.localName)) {
          const block = target.closest('p, li, div, aside, dd');
          if (block) scope = block;
        }
        target = scope;
        const isRef = /noteref/.test((el.getAttribute('epub:type') || '').toLowerCase());
        const txt = (target.textContent || '').replace(/\s+/g, ' ').trim().replace(/^[[(]?\d{1,3}[\])]?[.\s:-]*/, '');
        // Without an explicit noteref type, only short targets are treated as footnotes.
        if (!txt || (!isRef && !isNoteContainer(target) && txt.length > 1500)) return null;
        return txt.slice(0, 6000);
      },
      onAnchor: (id, block) => anchors.set(`${item.path}#${id}`, { section: idx, block }),
    });
    if (!blocks.length) continue;
    sectionOfPath.set(item.path, idx);
    const heading = blocks.find((b) => b.t === 'h');
    sections.push({ title: heading?.text.slice(0, 120) ?? '', blocks, notes: Object.keys(notes).length ? notes : undefined });
  }
  if (!sections.length) throw new Error('This EPUB has no readable text.');

  // Table of contents: EPUB 3 nav document first, then the EPUB 2 NCX.
  const toc: TocEntry[] = [];
  const addEntry = (label: string, href: string, level: number, base: string) => {
    const path = resolvePath(base, href);
    const real = byPath.get(path.toLowerCase())?.path ?? path;
    const frag = href.split('#')[1];
    const anchor = frag ? anchors.get(`${real}#${decodeURIComponent(frag)}`) : undefined;
    const section = anchor?.section ?? sectionOfPath.get(real);
    if (section === undefined || !label) return;
    toc.push({ title: label, section, block: anchor?.block ?? 0, level });
  };
  const navItem = [...manifest.values()].find((i) => /\bnav\b/.test(i.props));
  const navSrc = navItem ? text(navItem.path) : null;
  if (navItem && navSrc) {
    const navDoc = parseHtml(navSrc, 'application/xhtml+xml');
    const navs = every(navDoc, 'nav');
    const tocNav = navs.find((n) => /toc/.test(n.getAttribute('epub:type') || n.getAttribute('role') || '')) ?? navs[0];
    const walk = (ol: Element, level: number) => {
      for (const li of Array.from(ol.children).filter((c) => c.localName === 'li')) {
        const a = Array.from(li.children).find((c) => c.localName === 'a' || c.localName === 'span');
        const href = a?.getAttribute('href');
        if (a && href) addEntry((a.textContent || '').replace(/\s+/g, ' ').trim(), href, level, navItem.path);
        const sub = Array.from(li.children).find((c) => c.localName === 'ol');
        if (sub) walk(sub, level + 1);
      }
    };
    const ol = tocNav ? Array.from(tocNav.children).find((c) => c.localName === 'ol') ?? first(tocNav, 'ol') : null;
    if (ol) walk(ol, 1);
  }
  if (!toc.length) {
    const ncxItem = manifest.get(spineEl?.getAttribute('toc') || '') ?? [...manifest.values()].find((i) => /ncx/.test(i.type));
    const ncxSrc = ncxItem ? text(ncxItem.path) : null;
    if (ncxItem && ncxSrc) {
      const walk = (parent: Element, level: number) => {
        for (const np of Array.from(parent.children).filter((c) => c.localName === 'navPoint')) {
          const label = first(np, 'text')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
          const src = first(np, 'content')?.getAttribute('src');
          if (src) addEntry(label, src, level, ncxItem.path);
          walk(np, level + 1);
        }
      };
      const navMap = first(xml(ncxSrc), 'navMap');
      if (navMap) walk(navMap, 1);
    }
  }

  // Name sections from the contents list where the text itself had no heading.
  for (const t of toc) if (!sections[t.section].title && (t.block ?? 0) === 0) sections[t.section].title = t.title;
  sections.forEach((s, i) => {
    if (!s.title) s.title = `Section ${i + 1}`;
  });

  return { title, author, sections, toc: toc.length ? toc : tocFromHeadings(sections), cover, assets };
}
