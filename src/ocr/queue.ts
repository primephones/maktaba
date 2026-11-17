import { db } from '../db/db';
import type { Book, OcrLang } from '../db/types';
import { detectLang } from '../lib/arabic';
import { workBegan, workEnded, workProgress } from '../native/work';
import { recognizePage, releaseEngine } from './engine';
import { applyOcrToSection, sectionOfPage } from './merge';
import { imagePages, pageImage } from './pages';

/** Below this confidence a page is flagged for checking. */
export const CHECK_BELOW = 75;

const LANG_FOR: Partial<Record<Book['lang'], OcrLang>> = { ar: 'ara', ur: 'urd', fa: 'fas', en: 'eng' };

/** Queues a book's page images for recognition (only pages not yet done). */
export async function scheduleOcr(bookId: string): Promise<void> {
  const pages = await imagePages(bookId);
  if (!pages.length) return;
  const done = await db.ocrPages.where('bookId').equals(bookId).count();
  await db.books.update(bookId, { ocr: { state: done >= pages.length ? 'done' : 'queued', done, total: pages.length } });
}

/** Recognises the whole book again in another language, keeping pages corrected by hand. */
export async function rerunOcr(bookId: string, lang: OcrLang): Promise<void> {
  await db.ocrPages.where('bookId').equals(bookId).filter((p) => !p.edited).delete();
  await db.books.update(bookId, { ocrLang: lang });
  const sections = await db.sections.where('bookId').equals(bookId).toArray();
  for (const s of sections) await applyOcrToSection(bookId, s.idx);
  await scheduleOcr(bookId);
  void runOcrQueue();
}

/** Saves the recognised text of one page and puts it into the book. */
export async function savePage(book: Pick<Book, 'id'>, page: number, data: { blocks: import('../db/types').Block[]; conf: number; printed?: string; edited?: boolean; lang: OcrLang }): Promise<void> {
  await db.ocrPages.put({ id: `${book.id}:${page}`, bookId: book.id, page, updatedAt: Date.now(), ...data });
  const idx = await sectionOfPage(book.id, page);
  if (idx !== null) await applyOcrToSection(book.id, idx);
}

let running = false;
const stopped = new Set<string>();
export const stopOcr = (bookId: string) => stopped.add(bookId);

/** Picks a recognition language for a book whose language is not known yet. */
async function chooseLang(book: Book, firstPage: number): Promise<OcrLang> {
  if (book.ocrLang) return book.ocrLang;
  const known = LANG_FOR[book.lang];
  if (known) return known;
  // Read the first page both ways and keep whichever script is really there.
  const canvas = await pageImage(book, firstPage);
  const { text } = await recognizePage(canvas, 'ara+eng', firstPage);
  const lang = detectLang(text);
  return LANG_FOR[lang] ?? 'ara';
}

export async function runOcrQueue(): Promise<void> {
  if (running) return;
  const { importBusy } = await import('../import');
  if (importBusy()) return;
  running = true;
  try {
    for (;;) {
      const book = await db.books.filter((b) => b.import.state === 'ready' && (b.ocr?.state === 'queued' || b.ocr?.state === 'running')).first();
      if (!book) break;
      await recognizeBook(book);
      if (importBusy()) break;
    }
  } finally {
    running = false;
    await releaseEngine();
  }
}

async function recognizeBook(book: Book): Promise<void> {
  const id = book.id;
  const key = `ocr:${id}`;
  const pages = await imagePages(id);
  const doneRows = new Set((await db.ocrPages.where('bookId').equals(id).toArray()).map((r) => r.page));
  const todo = pages.filter((p) => !doneRows.has(p));
  let done = pages.length - todo.length;
  const total = pages.length;
  await workBegan(key, `Recognising ${book.title}`, `Page ${done + 1} of ${total}`, `Text recognition for “${book.title}” was not finished.`);
  try {
    const lang = await chooseLang(book, todo[0] ?? pages[0]);
    const langName = { ara: 'ar', urd: 'ur', fas: 'fa', eng: 'en' }[lang] as Book['lang'];
    await db.books.update(id, { ocrLang: lang, ocr: { state: 'running', done, total }, ...(book.lang === 'other' ? { lang: langName } : {}) });
    for (const page of todo) {
      if (stopped.has(id)) return;
      if (!(await db.books.get(id))) return;
      const canvas = await pageImage(book, page);
      const result = await recognizePage(canvas, lang, page);
      canvas.width = 0;
      canvas.height = 0;
      await savePage(book, page, { blocks: result.blocks, conf: result.conf, printed: result.printed, lang });
      done++;
      await db.books.update(id, { ocr: { state: 'running', done, total } });
      workProgress(key, `Recognising ${book.title}`, `Page ${done} of ${total}`, done, total);
      const { importBusy } = await import('../import');
      // New books come first; recognition resumes after them.
      if (importBusy()) {
        await db.books.update(id, { ocr: { state: 'queued', done, total } });
        return;
      }
    }
    await db.books.update(id, { ocr: { state: 'done', done, total }, scanView: book.scanView ?? 'text' });
  } catch (e) {
    console.error('Text recognition failed', e);
    await db.books.update(id, { ocr: { state: 'failed', done, total, error: 'Text recognition stopped unexpectedly. You can start it again from the book’s details.' } });
  } finally {
    stopped.delete(id);
    await workEnded(key);
  }
}
