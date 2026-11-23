import { db, sectionId } from '../../db/db';
import type { Book, Mark, Section } from '../../db/types';
import { docx, type DocPara } from '../../lib/docx';
import { enDisplay } from './BlockView';
import { pagesOf, pdfOfPages, scriptOf, type Entry, PAPER } from '../../lib/typeset';

interface Item {
  mark: Mark;
  where: string;
  original?: string;
  english?: string;
}

/** Everything marked in a book, in the order of the book, each with its place and its English. */
async function itemsOf(book: Book): Promise<Item[]> {
  const marks = (await db.marks.where('bookId').equals(book.id).toArray()).filter((m) => m.type !== 'bookmark').sort((a, b) => a.section - b.section || a.block - b.block || (a.start ?? 0) - (b.start ?? 0));
  const sections = new Map<number, Section | undefined>();
  const items: Item[] = [];
  for (const m of marks) {
    if (!sections.has(m.section)) sections.set(m.section, await db.sections.get(sectionId(book.id, m.section)));
    const sec = sections.get(m.section);
    const block = sec?.blocks[m.block];
    let chapter = '';
    book.toc.forEach((t, i) => {
      if (t.section < m.section || (t.section === m.section && (t.block ?? 0) <= m.block)) chapter = book.tocEn?.[i] || t.title;
    });
    const pageNo = block?.printed ?? (block?.page ? String(block.page) : '');
    const where = [chapter || sec?.title || '', pageNo ? `p. ${pageNo}` : ''].filter(Boolean).join(', ');
    const tr = await db.translations.get(`${book.id}:${m.section}:${m.block}`);
    items.push({
      mark: m,
      where,
      original: m.en ? undefined : m.text,
      english: m.en ? m.text : tr ? enDisplay(tr.en).replace(/†/g, '') : undefined,
    });
  }
  return items;
}

const titleOf = (book: Book) => `${book.titleEn && book.titleEn !== book.title ? `${book.titleEn} · ` : ''}${book.title}`;

/** The book's notebook as a Word document: real text, to edit or send to a teacher. */
export async function notebookDocx(book: Book): Promise<Blob> {
  const items = await itemsOf(book);
  const out: DocPara[] = [
    { text: titleOf(book), kind: 'title' },
    ...(book.author ? [{ text: book.author, kind: 'small' as const }] : []),
    { text: `Highlights and notes · ${items.length}`, kind: 'h2' },
  ];
  for (const it of items) {
    if (it.where) out.push({ text: it.where, kind: 'small' });
    if (it.original) out.push({ text: it.original, lang: book.lang });
    if (it.english) out.push({ text: it.english });
    if (it.mark.note) out.push({ text: `Note: ${it.mark.note}`, kind: 'note' });
  }
  return docx(out);
}

/** The book's notebook as a PDF, laid out as printed pages. */
export async function notebookPdf(book: Book): Promise<Blob> {
  const items = await itemsOf(book);
  const ink = PAPER;
  const entries: Entry[] = items.map((it) => [
    ...(it.where ? [{ text: it.where, script: 'latin' as const, size: 22, color: ink.ink2, after: 8 }] : []),
    ...(it.original ? [{ text: it.original, script: scriptOf(it.original, book.lang), size: 34, color: ink.ink, after: 10 }] : []),
    ...(it.english ? [{ text: it.english, script: 'latin' as const, size: 28, color: it.original ? ink.ink2 : ink.ink, style: it.original ? 'italic' : '', after: 8 }] : []),
    ...(it.mark.note ? [{ text: `Note: ${it.mark.note}`, script: scriptOf(it.mark.note), size: 26, color: ink.accent, after: 4 }] : []),
  ]);
  const title: Entry = [
    { text: titleOf(book), script: scriptOf(book.title, book.lang), size: 50, color: ink.accent, after: 8, align: 'center' },
    ...(book.author ? [{ text: book.author, script: scriptOf(book.author, book.lang), size: 30, color: ink.ink2, after: 8, align: 'center' as const }] : []),
    { text: `Highlights and notes · ${items.length}`, script: 'latin', size: 26, color: ink.ink2, after: 30, align: 'center' },
  ];
  const pages = await pagesOf(entries, { head: book.titleEn || book.title, title, ink });
  return pdfOfPages(pages);
}

/** A file name from the book's title, safe on every phone. */
export const fileNameOf = (book: Book, what: string, ext: string) => `${(book.titleEn || book.title).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60)} - ${what}.${ext}`;
