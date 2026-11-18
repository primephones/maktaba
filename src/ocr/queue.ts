import { db } from '../db/db';
import type { Book, OcrLang } from '../db/types';
import { detectLang } from '../lib/arabic';
import { workBegan, workEnded, workProgress } from '../native/work';
import { recognizePage, releaseEngine, type OcrResult } from './engine';
import { AllowanceUsedUp, aiReaderFor, recognizeWithAi } from './ai';
import { getMyAi } from '../ai/device';
import { applyOcrToSection, sectionOfPage } from './merge';
import { imagePages, pageImage } from './pages';

/** Below this confidence a page is flagged for checking. */
export const CHECK_BELOW = 75;

const LANG_FOR: Partial<Record<Book['lang'], OcrLang>> = { ar: 'ara', ur: 'urd', fa: 'fas', ps: 'pus', ms: 'msa', en: 'eng' };
const LANG_OF: Record<OcrLang, Book['lang']> = { ara: 'ar', urd: 'ur', fas: 'fa', pus: 'ps', msa: 'ms', eng: 'en' };

/** A page taking longer than this on the phone means the engine has stalled. */
const PAGE_LIMIT_MS = 3 * 60_000;
class Stalled extends Error {}
function inTime<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([work, new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Stalled('stalled')), ms)))]).finally(() => clearTimeout(timer));
}

/** One page by the engine on the phone, given a time limit so a stall cannot hang the queue. */
async function onPhone(canvas: HTMLCanvasElement, lang: string, page: number): Promise<OcrResult> {
  try {
    return await inTime(recognizePage(canvas, lang, page), PAGE_LIMIT_MS);
  } catch (e) {
    if (e instanceof Stalled) await releaseEngine();
    throw e;
  }
}

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
  const book = await db.books.get(bookId);
  await db.books.update(bookId, { ocrLang: lang, ...(book?.lang === 'other' ? { lang: LANG_OF[lang] } : {}) });
  const sections = await db.sections.where('bookId').equals(bookId).toArray();
  for (const s of sections) await applyOcrToSection(bookId, s.idx);
  await scheduleOcr(bookId);
  void runOcrQueue();
}

/** Reads again with the reader's AI the pages the phone's engine read (keeping hand corrections). */
export async function rereadWithAi(bookId: string): Promise<number> {
  const redo = await db.ocrPages.where('bookId').equals(bookId).filter((p) => !p.edited && p.by !== 'ai').primaryKeys();
  await db.ocrPages.bulkDelete(redo);
  await scheduleOcr(bookId);
  void runOcrQueue();
  return redo.length;
}

/** Saves the recognised text of one page and puts it into the book. */
export async function savePage(book: Pick<Book, 'id'>, page: number, data: { blocks: import('../db/types').Block[]; conf: number; printed?: string; edited?: boolean; lang: OcrLang; by?: 'ai' | 'phone' }): Promise<void> {
  await db.ocrPages.put({ id: `${book.id}:${page}`, bookId: book.id, page, updatedAt: Date.now(), ...data });
  const idx = await sectionOfPage(book.id, page);
  if (idx !== null) await applyOcrToSection(book.id, idx);
}

let running = false;
const stopped = new Set<string>();
export const stopOcr = (bookId: string) => stopped.add(bookId);

/**
 * The phone's own engine reads clean Arabic (Naskh) and Latin print fairly; Urdu, Persian
 * and Pashto are set in Nastaliq and similar hands, which it turns into nonsense. Those
 * are read only by the reader's AI, and wait for it.
 */
export const PHONE_CAN_READ = new Set<OcrLang>(['ara', 'eng', 'msa']);
const NEED_AI_NOTE = 'Waiting for your AI: the phone cannot read this script properly. Add a free Gemini key in Settings › Your AI and the pages are read and translated.';
const PAUSED_NOTE = 'Today’s free Gemini allowance is used up. Reading carries on by itself when it renews; meanwhile tap a page in the book to read it on its own.';

/** Picks a recognition language for a book whose language is not known yet (null: only the AI can tell). */
async function chooseLang(book: Book, firstPage: number): Promise<OcrLang | null> {
  if (book.ocrLang) return book.ocrLang;
  const known = LANG_FOR[book.lang];
  if (known) return known;
  // Read the first page and keep whichever script is really there.
  const key = await aiReaderFor(book);
  const canvas = await inTime(pageImage(book, firstPage), PAGE_LIMIT_MS);
  if (!key) {
    // Without the AI, the phone may go on only if it finds clear Arabic or Latin print:
    // Nastaliq comes out as low-confidence nonsense, and waits for the AI instead.
    const r = await onPhone(canvas, 'ara+eng', firstPage).catch(() => null);
    const seen = r ? detectLang(r.text) : 'other';
    if (r && r.conf >= 60 && (seen === 'ar' || seen === 'en')) return seen === 'ar' ? 'ara' : 'eng';
    return null;
  }
  const text = await recognizeWithAi(key, canvas, 'auto', firstPage).then((r) => r.text);
  const lang = detectLang(text);
  return LANG_FOR[lang] ?? 'ara';
}

export async function runOcrQueue(): Promise<void> {
  if (running) return;
  const { importBusy } = await import('../import');
  if (importBusy()) return;
  running = true;
  try {
    await forgetUnreadablePages();
    // Books waiting for the AI start once it is there (a key added, or the allowance back).
    for (const b of await db.books.filter((x) => x.ocr?.state === 'waiting').toArray()) {
      if (await aiReaderFor(b)) await db.books.update(b.id, { ocr: { ...b.ocr!, state: 'queued', error: undefined } });
    }
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

/**
 * Text the phone's engine made of Nastaliq (Urdu, Persian, Pashto) pages is nonsense: it is
 * taken out of the books (pages corrected by hand are kept), and those pages read again by
 * the AI when it can.
 */
async function forgetUnreadablePages(): Promise<void> {
  const bad = await db.ocrPages.filter((p) => !p.edited && p.by !== 'ai' && !PHONE_CAN_READ.has(p.lang)).toArray();
  if (!bad.length) return;
  await db.ocrPages.bulkDelete(bad.map((p) => p.id));
  for (const bookId of new Set(bad.map((p) => p.bookId))) {
    const sections = await db.sections.where('bookId').equals(bookId).toArray();
    for (const sec of sections) if (sec.blocks.some((b) => b.ocr)) await applyOcrToSection(bookId, sec.idx);
    const book = await db.books.get(bookId);
    if (book?.ocr) await db.books.update(bookId, { ocr: { ...book.ocr, state: 'queued', done: await db.ocrPages.where('bookId').equals(bookId).count() }, scanView: 'page' });
  }
}

/** Reads one page with the reader's AI now (ahead of the rest of the book), keeping hand corrections. */
export async function readPageNow(book: Book, page: number): Promise<void> {
  const existing = await db.ocrPages.get(`${book.id}:${page}`);
  if (existing && (existing.by === 'ai' || existing.edited)) return;
  const key = await aiReaderFor(book);
  if (!key) {
    if (book.private) throw new Error('This book is marked private, so its pages are not sent to an AI that may learn from them.');
    throw new Error('Add a free Gemini key in Settings › Your AI to read and translate scanned pages.');
  }
  const lang = book.ocrLang ?? LANG_FOR[book.lang] ?? 'urd';
  const canvas = await inTime(pageImage(book, page), PAGE_LIMIT_MS);
  try {
    const r = await recognizeWithAi(key, canvas, lang, page);
    await savePage(book, page, { blocks: r.blocks, conf: 95, printed: r.printed, lang, by: 'ai' });
    if (book.lang === 'other') await db.books.update(book.id, { lang: LANG_OF[lang] });
  } finally {
    canvas.width = 0;
    canvas.height = 0;
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
    let aiKey = await aiReaderFor(book);
    if (!lang || (!aiKey && !PHONE_CAN_READ.has(lang))) {
      const paused = !book.private && !!(await getMyAi()).gemini;
      await db.books.update(id, { ...(lang ? { ocrLang: lang } : {}), ocr: { state: 'waiting', done, total, error: paused ? PAUSED_NOTE : NEED_AI_NOTE }, scanView: book.scanView ?? 'page' });
      return;
    }
    await db.books.update(id, { ocrLang: lang, ocr: { state: 'running', done, total }, ...(book.lang === 'other' ? { lang: LANG_OF[lang] } : {}) });
    let aiFailures = 0;
    for (const page of todo) {
      if (stopped.has(id)) return;
      if (!(await db.books.get(id))) return;
      if (!aiKey && aiFailures < 3 && (done - pages.length + todo.length) % 10 === 0) aiKey = await aiReaderFor(book);
      const canvas = await inTime(pageImage(book, page), PAGE_LIMIT_MS);
      let saved = false;
      if (aiKey) {
        try {
          const r = await recognizeWithAi(aiKey, canvas, lang, page);
          await savePage(book, page, { blocks: r.blocks, conf: 95, printed: r.printed, lang, by: 'ai' });
          saved = true;
          aiFailures = 0;
        } catch (e) {
          // The day's allowance is used, or the AI keeps failing: the phone carries on.
          if (e instanceof AllowanceUsedUp || ++aiFailures >= 3 || /key was refused/.test((e as Error).message)) aiKey = null;
        }
      }
      if (!saved && !PHONE_CAN_READ.has(lang)) {
        // The phone would only make nonsense of this script: wait for the AI.
        canvas.width = 0;
        canvas.height = 0;
        const paused = !book.private && !!(await getMyAi()).gemini;
        await db.books.update(id, { ocr: { state: 'waiting', done, total, error: paused ? PAUSED_NOTE : NEED_AI_NOTE } });
        return;
      }
      if (!saved) {
        const result = await onPhone(canvas, lang, page);
        await savePage(book, page, { blocks: result.blocks, conf: result.conf, printed: result.printed, lang, by: 'phone' });
      }
      canvas.width = 0;
      canvas.height = 0;
      done++;
      await db.books.update(id, { ocr: { state: 'running', done, total } });
      workProgress(key, `${aiKey ? 'Reading with AI' : 'Recognising'}: ${book.title}`, `Page ${done} of ${total}`, done, total);
      const { importBusy } = await import('../import');
      // New books come first; recognition resumes after them.
      if (importBusy()) {
        await db.books.update(id, { ocr: { state: 'queued', done, total } });
        return;
      }
    }
    await db.books.update(id, { ocr: { state: 'done', done, total }, scanView: book.scanView ?? 'page' });
  } catch (e) {
    console.error('Text recognition failed', e);
    const error =
      e instanceof Stalled
        ? 'Reading the pages stalled on this phone. Tap Try again. Adding a Gemini key in Settings, Your AI, lets the AI read the pages instead (better for Urdu).'
        : 'Text recognition stopped unexpectedly. You can start it again from the book’s details.';
    await db.books.update(id, { ocr: { state: 'failed', done, total, error } });
  } finally {
    stopped.delete(id);
    await workEnded(key);
  }
}
