/**
 * A book's English as a book of its own: an EPUB for any e-reader (Kindle, Google Play
 * Books, Apple Books, Moon+), or a PDF to print or send. Paragraphs not yet in English are
 * left in the original (marked), so nothing of the book is lost.
 */
import { strToU8, zipSync } from 'fflate';
import { db, sectionId } from '../../db/db';
import type { Book, Section, Translation } from '../../db/types';
import { enDisplay } from '../reader/BlockView';
import { pagesOf, pdfOfPages, scriptOf, PAPER, type Entry } from '../../lib/typeset';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clean = (en: string) => enDisplay(en).replace(/†/g, '');

interface Chapter {
  title: string;
  original: string;
  paras: Array<{ kind: 'h' | 'p' | 'quote'; en?: string; orig: string }>;
}

/** Reads the book chapter by chapter, each paragraph with its English. */
async function chaptersOf(book: Book, onProgress?: (done: number, total: number) => void): Promise<{ chapters: Chapter[]; english: number; total: number }> {
  const trs = new Map<string, Translation>((await db.translations.where('bookId').equals(book.id).toArray()).map((t) => [`${t.section}:${t.block}`, t]));
  const chapters: Chapter[] = [];
  let english = 0;
  let total = 0;
  for (let s = 0; s < book.sectionCount; s++) {
    const sec: Section | undefined = await db.sections.get(sectionId(book.id, s));
    onProgress?.(s + 1, book.sectionCount);
    if (!sec) continue;
    const tocAt = book.toc.findIndex((t) => t.section === s);
    const title = (tocAt >= 0 && (book.tocEn?.[tocAt] || book.toc[tocAt].title)) || sec.title || `Part ${s + 1}`;
    const paras: Chapter['paras'] = [];
    sec.blocks.forEach((b, i) => {
      if (b.t === 'img' || b.t === 'hr' || !b.text.trim()) return;
      // A scanned page shown as printed keeps its words in the recognised paragraphs.
      const tr = trs.get(`${s}:${i}`);
      total++;
      if (tr) english++;
      paras.push({ kind: b.t === 'h' ? 'h' : b.t === 'quote' ? 'quote' : 'p', en: tr ? clean(tr.en) : undefined, orig: b.text });
    });
    if (paras.length) chapters.push({ title, original: tocAt >= 0 ? book.toc[tocAt].title : sec.title, paras });
  }
  return { chapters, english, total };
}

const nameOf = (book: Book) => book.titleEn || book.title;

/** The English as an EPUB 3 book, for any e-reader. */
export async function englishEpub(book: Book, onProgress?: (done: number, total: number) => void): Promise<{ blob: Blob; english: number; total: number }> {
  const { chapters, english, total } = await chaptersOf(book, onProgress);
  const id = `urn:maktaba:${book.hash || book.id}`;
  const title = nameOf(book);
  const author = book.authorEn || book.author || '';
  const rtlLang = book.lang === 'other' ? 'ar' : book.lang;
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
  // The first file, stored as it is: e-readers look for it there.
  files.mimetype = [strToU8('application/epub+zip'), { level: 0 }];
  files['META-INF/container.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  files['OEBPS/style.css'] = strToU8(`body{font-family:Georgia,serif;line-height:1.6;margin:0 5%}h1{font-size:1.5em;text-align:center;margin:1.6em 0 .3em}h1+.orig{text-align:center;margin-bottom:1.4em}h2{font-size:1.15em;margin:1.4em 0 .6em}p{margin:0;text-indent:1.4em;text-align:justify}h1+p,h1+.orig+p,h2+p{text-indent:0}blockquote{margin:.6em 1.4em;font-style:italic}.orig{font-family:'Amiri','Noto Naskh Arabic',serif;color:#6d6960;font-size:.95em}p.untranslated{font-family:'Amiri','Noto Naskh Arabic',serif;text-indent:0;color:#4a4741}.title{text-align:center;margin-top:30%}.title h1{font-size:2em}.title .by{margin-top:.6em;color:#4a4741}.note{margin-top:3em;font-size:.85em;color:#6d6960;text-align:center}`);
  const chapterFiles = chapters.map((c, n) => {
    const body = c.paras
      .map((p) => {
        if (!p.en) return `<p class="untranslated" dir="rtl" lang="${rtlLang}">${esc(p.orig)}</p>`;
        if (p.kind === 'h') return `<h2>${esc(p.en)}</h2>`;
        if (p.kind === 'quote') return `<blockquote><p>${esc(p.en)}</p></blockquote>`;
        return `<p>${esc(p.en)}</p>`;
      })
      .join('\n');
    const orig = c.original && c.original !== c.title ? `<p class="orig" dir="rtl" lang="${rtlLang}">${esc(c.original)}</p>` : '';
    return { name: `ch${n + 1}.xhtml`, title: c.title, xml: `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en"><head><meta charset="utf-8"/><title>${esc(c.title)}</title><link rel="stylesheet" href="style.css"/></head><body><section epub:type="chapter"><h1>${esc(c.title)}</h1>${orig}\n${body}</section></body></html>` };
  });
  files['OEBPS/title.xhtml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" lang="en" xml:lang="en"><head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" href="style.css"/></head><body><div class="title"><h1>${esc(title)}</h1>${book.titleEn && book.title !== book.titleEn ? `<p class="orig" dir="rtl">${esc(book.title)}</p>` : ''}${author ? `<p class="by">${esc(author)}</p>` : ''}<p class="note">English translation made with Maktaba${english < total ? `. ${total - english} of ${total} paragraphs are not yet in English and are given in the original.` : '.'}</p></div></body></html>`);
  for (const f of chapterFiles) files[`OEBPS/${f.name}`] = strToU8(f.xml);
  files['OEBPS/nav.xhtml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en"><head><meta charset="utf-8"/><title>Contents</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${chapterFiles.map((f) => `<li><a href="${f.name}">${esc(f.title)}</a></li>`).join('')}</ol></nav></body></html>`);
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    '<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>',
    ...chapterFiles.map((f, i) => `<item id="c${i + 1}" href="${f.name}" media-type="application/xhtml+xml"/>`),
  ].join('');
  const spine = ['<itemref idref="title"/>', ...chapterFiles.map((_, i) => `<itemref idref="c${i + 1}"/>`)].join('');
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files['OEBPS/book.opf'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${esc(id)}</dc:identifier><dc:title>${esc(title)}</dc:title>${author ? `<dc:creator>${esc(author)}</dc:creator>` : ''}<dc:language>en</dc:language><meta property="dcterms:modified">${modified}</meta></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`);
  return { blob: new Blob([zipSync(files)], { type: 'application/epub+zip' }), english, total };
}

/** The English as a PDF, laid out as printed pages. */
export async function englishPdf(book: Book, onProgress?: (done: number, total: number) => void): Promise<{ blob: Blob; english: number; total: number }> {
  const { chapters, english, total } = await chaptersOf(book, onProgress);
  const ink = PAPER;
  const entries: Entry[] = [];
  for (const c of chapters) {
    entries.push([{ text: c.title, script: 'latin', size: 40, color: ink.accent, after: 6, align: 'center' }, ...(c.original && c.original !== c.title ? [{ text: c.original, script: scriptOf(c.original, book.lang), size: 30, color: ink.ink2, after: 20, align: 'center' as const }] : [])]);
    for (const p of c.paras) {
      if (p.en) entries.push([{ text: p.en, script: 'latin', size: p.kind === 'h' ? 32 : 28, color: ink.ink, style: p.kind === 'quote' ? 'italic' : '', after: 4 }]);
      else entries.push([{ text: p.orig, script: scriptOf(p.orig, book.lang), size: 30, color: ink.ink2, after: 4 }]);
    }
  }
  const title: Entry = [
    { text: nameOf(book), script: 'latin', size: 56, color: ink.accent, after: 10, align: 'center' },
    ...(book.author ? [{ text: book.authorEn || book.author, script: scriptOf(book.authorEn || book.author), size: 32, color: ink.ink2, after: 10, align: 'center' as const }] : []),
    { text: `English translation made with Maktaba${english < total ? ` · ${total - english} of ${total} paragraphs still in the original` : ''}`, script: 'latin', size: 24, color: ink.ink2, after: 40, align: 'center' },
  ];
  const pages = await pagesOf(entries, { head: nameOf(book), title, ink });
  return { blob: pdfOfPages(pages), english, total };
}
