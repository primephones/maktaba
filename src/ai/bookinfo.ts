import { db, sectionId } from '../db/db';
import type { Book } from '../db/types';
import { study } from './study';

export interface BookInfo {
  title: string;
  author: string;
  titleEn: string;
  authorEn: string;
}

/** A book still named after its file ("risala-text", "IMG_2041", "kitab_al_tahara_v2"). */
export function namedAfterFile(book: Pick<Book, 'title' | 'fileName'>): boolean {
  const t = book.title.trim();
  const stem = (book.fileName ?? '').replace(/\.[^.]+$/, '').trim();
  return t === stem || (/[_-]/.test(t) && !/\s/.test(t)) || /^(img|scan|doc|document|book|untitled)[\s_-]*\d*$/i.test(t);
}

/** The opening text of a book: its title page, preface and contents, as far as they have been read. */
async function openingText(book: Book, enough = 3500): Promise<string> {
  let text = '';
  for (let s = 0; s < Math.min(book.sectionCount, 4) && text.length < enough; s++) {
    const sec = await db.sections.get(sectionId(book.id, s));
    for (const b of sec?.blocks ?? []) {
      if (b.t === 'img' || !b.text.trim()) continue;
      text += `${b.text}\n`;
      if (text.length > enough) break;
    }
  }
  return text;
}

/** Asks your AI for the book's real title and author, read from its first pages. */
export async function readBookInfo(book: Book): Promise<BookInfo> {
  const text = await openingText(book);
  if (text.trim().length < 20) throw new Error('There is no text to read the title from yet. For a scanned book, its first pages are read first.');
  const r = await study<BookInfo>({ task: 'bookinfo', text, fileName: book.fileName }, !!book.private, 'explain');
  return r.result;
}

/** Puts the book's contents into English (kept with the book, and used wherever chapters are named). */
export async function translateContents(book: Book): Promise<string[]> {
  const titles = book.toc.map((t) => t.title);
  if (titles.length < 2) return [];
  const out: string[] = [];
  for (let i = 0; i < titles.length; i += 60) {
    const part = titles.slice(i, i + 60);
    const r = await study<{ titles: string[] }>({ task: 'titles', titles: part, book: book.title }, !!book.private, 'explain');
    out.push(...r.result.titles);
  }
  await db.books.update(book.id, { tocEn: out });
  return out;
}

/** Uses the title and author found, keeping the file name in the book's record. */
export async function applyBookInfo(book: Book, info: BookInfo): Promise<void> {
  await db.books.update(book.id, {
    title: info.title || info.titleEn || book.title,
    author: info.author || info.authorEn || book.author,
    titleEn: info.titleEn || undefined,
    authorEn: info.authorEn || undefined,
  });
}
