import { db, sectionId } from '../db/db';
import type { Book, OcrLang } from '../db/types';
import { detectLang } from '../lib/arabic';
import { workBegan, workEnded, workProgress } from '../native/work';
import { recognizePage, releaseEngine, type OcrResult } from './engine';
import { AllowanceUsedUp, aiReaderFor, aiReaderPausedUntil, recognizeWithAi, type PageText } from './ai';
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
 * Pages being read right now, by the background queue or for the reader (Next pages, As I
 * read, the button under a page): one page is never sent to the AI twice at once.
 */
const reading = new Map<string, Promise<void>>();
function readOnce(bookId: string, page: number, work: () => Promise<void>): Promise<void> {
  const k = `${bookId}:${page}`;
  const under = reading.get(k);
  if (under) return under;
  const p = work().finally(() => reading.delete(k));
  reading.set(k, p);
  return p;
}

/** Whether a page has been read by the AI (or corrected by hand), so it need not be read again. */
export async function pageIsRead(bookId: string, page: number): Promise<boolean> {
  const row = await db.ocrPages.get(`${bookId}:${page}`);
  return !!row && (row.by === 'ai' || !!row.edited);
}

/** The page (of a book's page pictures) at a place in the book: the page being read. */
export async function pageAt(bookId: string, at: { section: number; block: number }): Promise<number | null> {
  const sec = await db.sections.get(sectionId(bookId, at.section));
  if (!sec?.blocks.length) return null;
  const pageOf = (b: import('../db/types').Block) => {
    if (b.t === 'img') {
      const m = b.src?.match(/^page:(\d+)$/);
      return m ? Number(m[1]) : b.src === 'page-1' ? 1 : null;
    }
    return b.ocr && b.page ? b.page : null;
  };
  const from = Math.max(0, Math.min(at.block, sec.blocks.length - 1));
  for (let i = from; i >= 0; i--) {
    const p = pageOf(sec.blocks[i]);
    if (p) return p;
  }
  for (let i = from + 1; i < sec.blocks.length; i++) {
    const p = pageOf(sec.blocks[i]);
    if (p) return p;
  }
  return null;
}

/**
 * The phone's own engine reads clean Arabic (Naskh) and Latin print fairly; Urdu, Persian
 * and Pashto are set in Nastaliq and similar hands, which it turns into nonsense. Those
 * are read only by the reader's AI, and wait for it.
 */
export const PHONE_CAN_READ = new Set<OcrLang>(['ara', 'eng', 'msa']);
const NEED_AI_NOTE = 'Waiting for your AI: the phone cannot read this script properly. Add a free Gemini key or sign in to OpenRouter (Settings › Your AI) and the pages are read and translated.';
const PAUSED_NOTE = 'Today’s free AI allowance for reading pages is used up. Reading carries on by itself when it renews.';
const BUSY_NOTE = 'Your AI is busy right now (Google’s free models are often overloaded for a while). Reading carries on by itself in a few minutes.';

/** The AI could not answer for now (overloaded, dropped), as opposed to a used-up day. */
class AiBusy extends Error {}
let retryTimer = 0;
/** Books waiting on a busy AI are tried again a few minutes later, by themselves. */
const retrySoon = () => {
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => void runOcrQueue(), 3 * 60_000);
};

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
  const r = await recognizeWithAi(key, canvas, 'auto', firstPage).catch((e: Error) => {
    throw e instanceof AllowanceUsedUp || /key was refused/.test(e.message) ? e : new AiBusy(e.message);
  });
  const lang = LANG_FOR[detectLang(r.text)] ?? 'ara';
  // The page read to tell the language is kept (its English follows as text), not read twice.
  if (lang !== 'eng') await savePage(book, firstPage, { blocks: r.blocks, conf: 95, printed: r.printed, lang, by: 'ai' });
  return lang;
}

export async function runOcrQueue(): Promise<void> {
  if (running) return;
  // Tests hold the background reading to look at what the reader's own taps do.
  if ((globalThis as { __maktabaHoldReading?: boolean }).__maktabaHoldReading) return;
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
      // The book opened most recently first: the one being read is never kept waiting behind another.
      const waiting = await db.books.filter((b) => b.import.state === 'ready' && (b.ocr?.state === 'queued' || b.ocr?.state === 'running')).toArray();
      const book = waiting.sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0) || a.addedAt - b.addedAt)[0];
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

/** English needs no reading or translating: its pages are shown as printed. */
async function leaveAsPrinted(book: Book): Promise<void> {
  await db.books.update(book.id, { ocr: undefined, ocrLang: 'eng', scanView: 'page', ...(book.lang === 'other' ? { lang: 'en' } : {}) });
}

/** Scans not in English are translated as they are read: one request gives both. */
const translateAsRead = (book: Book, lang: OcrLang) => lang !== 'eng' && book.lang !== 'en';

/** Keeps the English that came with a page read and translated in one go. */
async function savePageEnglish(book: Pick<Book, 'id'>, page: number, r: PageText): Promise<void> {
  if (!r.en?.some(Boolean)) return;
  const idx = await sectionOfPage(book.id, page);
  if (idx === null) return;
  const sec = await db.sections.get(sectionId(book.id, idx));
  if (!sec) return;
  const at = sec.blocks.map((b, i) => (b.ocr && b.page === page ? i : -1)).filter((i) => i >= 0);
  const now = Date.now();
  const rows = at.flatMap((block, k) => {
    const e = r.en?.[k];
    return e ? [{ id: `${book.id}:${idx}:${block}`, bookId: book.id, section: idx, block, en: e.en, uncertain: e.uncertain, label: 'draft' as const, provider: r.service ?? 'ai', model: r.model ?? '', updatedAt: now }] : [];
  });
  if (rows.length) await db.translations.bulkPut(rows);
}

/** The paragraphs of a page still without English are translated as text (the one-step reading may have left some). */
async function translateRest(book: Book, page: number): Promise<void> {
  const idx = await sectionOfPage(book.id, page);
  if (idx === null) return;
  const sec = await db.sections.get(sectionId(book.id, idx));
  if (!sec) return;
  const have = new Set((await db.translations.where('bookId').equals(book.id).primaryKeys()).map(String));
  const paras = sec.blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b, i }) => b.ocr && b.page === page && b.text.trim().length > 1 && !have.has(`${book.id}:${idx}:${i}`))
    .map(({ b, i }) => ({ id: `${idx}:${i}`, section: idx, block: i, text: b.text, kind: (b.t === 'h' ? 'h' : b.t === 'quote' ? 'quote' : 'p') as 'h' | 'quote' | 'p', chapter: sec.title }));
  if (!paras.length) return;
  const { translateNow } = await import('../ai/translation');
  await translateNow((await db.books.get(book.id)) ?? book, paras);
}

/** Reads one page with the reader's AI now (ahead of the rest of the book), keeping hand corrections. */
export async function readPageNow(book: Book, page: number): Promise<void> {
  if (await pageIsRead(book.id, page)) return;
  return readOnce(book.id, page, () => readPageWithAi(book, page));
}

async function readPageWithAi(book: Book, page: number): Promise<void> {
  if (await pageIsRead(book.id, page)) return;
  const key = await aiReaderFor(book);
  if (!key) {
    if (book.private) throw new Error('This book is marked private, so its pages are not sent to an AI that may learn from them.');
    const back = await aiReaderPausedUntil();
    if (back) {
      const at = new Date(back).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      throw new Error(`Today’s free allowance for reading pages is used up. It comes back at ${at}. Adding a second service (OpenRouter) in Settings › Your AI lets reading carry on meanwhile.`);
    }
    throw new Error('To read and translate scanned pages, add a free Gemini key or sign in to OpenRouter in Settings › Your AI.');
  }
  const fresh = (await db.books.get(book.id)) ?? book;
  // A book whose language is not known yet: the page is read as it is, and its language kept.
  const known = fresh.ocrLang ?? LANG_FOR[fresh.lang];
  const canvas = await inTime(pageImage(fresh, page), PAGE_LIMIT_MS);
  try {
    const r = await recognizeWithAi(key, canvas, known ?? 'auto', page, { translate: !!known && translateAsRead(fresh, known), eager: true });
    const lang = known ?? LANG_FOR[detectLang(r.text)] ?? 'ara';
    if (!known) await db.books.update(book.id, { ocrLang: lang, ...(fresh.lang === 'other' ? { lang: LANG_OF[lang] } : {}) });
    if (lang === 'eng' && !known) return;
    await savePage(fresh, page, { blocks: r.blocks, conf: 95, printed: r.printed, lang, by: 'ai' });
    await savePageEnglish(fresh, page, r);
    // The book's count of pages read follows (its details, and the background reading, see it).
    const now = await db.books.get(book.id);
    if (now?.ocr) {
      const done = await db.ocrPages.where('bookId').equals(book.id).count();
      // The AI answers again: the background reading, if it was waiting on a busy AI, goes on now.
      const wasBusy = now.ocr.state === 'waiting' && now.ocr.error === BUSY_NOTE;
      await db.books.update(book.id, { ocr: { ...now.ocr, done, ...(done >= now.ocr.total ? { state: 'done' as const, error: undefined } : wasBusy ? { state: 'queued' as const, error: undefined } : {}) } });
      if (wasBusy && done < now.ocr.total) {
        window.clearTimeout(retryTimer);
        setTimeout(() => void runOcrQueue(), 0);
      }
    }
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
  // From the page being read onwards first, then the pages before it.
  const here = book.progress ? ((await pageAt(id, book.progress)) ?? 0) : 0;
  const todo = pages.filter((p) => !doneRows.has(p)).sort((a, b) => (a >= here ? a - here : 1e6 + a) - (b >= here ? b - here : 1e6 + b));
  let done = pages.length - todo.length;
  const total = pages.length;
  await workBegan(key, `Recognising ${book.title}`, `Page ${done + 1} of ${total}`, `Text recognition for “${book.title}” was not finished.`);
  try {
    const lang = await chooseLang(book, todo[0] ?? pages[0]);
    if (lang === 'eng' && !doneRows.size) {
      // An English book is read as printed: nothing to recognise or translate.
      await leaveAsPrinted(book);
      return;
    }
    let aiKey = await aiReaderFor(book);
    if (!lang || (!aiKey && !PHONE_CAN_READ.has(lang))) {
      const paused = !book.private && (await getMyAi().then((a) => !!(a.gemini || a.openrouter)));
      await db.books.update(id, { ...(lang ? { ocrLang: lang } : {}), ocr: { state: 'waiting', done, total, error: paused ? PAUSED_NOTE : NEED_AI_NOTE }, scanView: book.scanView ?? 'page' });
      return;
    }
    await db.books.update(id, { ocrLang: lang, ocr: { state: 'running', done, total }, ...(book.lang === 'other' ? { lang: LANG_OF[lang] } : {}) });
    let aiFailures = 0;
    let busy = false;
    for (const page of todo) {
      if (stopped.has(id)) return;
      if (!(await db.books.get(id))) return;
      // Read meanwhile for the reader (or being read now): not again.
      const under = reading.get(`${id}:${page}`);
      if (under) await under.catch(() => undefined);
      if (await db.ocrPages.get(`${id}:${page}`)) {
        // Its English, if the reading that found it gave none.
        if (translateAsRead(book, lang)) await translateRest(book, page).catch((e) => console.warn('Translating the page as text failed', e));
        done++;
        await db.books.update(id, { ocr: { state: 'running', done, total } });
        continue;
      }
      if (!aiKey && aiFailures < 3 && (done - pages.length + todo.length) % 10 === 0) aiKey = await aiReaderFor(book);
      const canvas = await inTime(pageImage(book, page), PAGE_LIMIT_MS);
      let saved = false;
      if (aiKey) {
        try {
          const reader = aiKey;
          await readOnce(id, page, async () => {
            const r = await recognizeWithAi(reader, canvas, lang, page, { translate: translateAsRead(book, lang) });
            await savePage(book, page, { blocks: r.blocks, conf: 95, printed: r.printed, lang, by: 'ai' });
            await savePageEnglish(book, page, r);
          });
          // English the one-step reading did not give (or gave as a transliteration) comes from a text model.
          if (translateAsRead(book, lang)) await translateRest(book, page).catch((e) => console.warn('Translating the page as text failed', e));
          saved = true;
          aiFailures = 0;
        } catch (e) {
          // The day's allowance is used, or the AI keeps failing: the phone carries on.
          busy = !(e instanceof AllowanceUsedUp) && !/key was refused/.test((e as Error).message);
          if (e instanceof AllowanceUsedUp || ++aiFailures >= 3 || /key was refused/.test((e as Error).message)) aiKey = null;
        }
      }
      if (!saved && !PHONE_CAN_READ.has(lang)) {
        // The phone would only make nonsense of this script: wait for the AI.
        canvas.width = 0;
        canvas.height = 0;
        const paused = !book.private && (await getMyAi().then((a) => !!(a.gemini || a.openrouter)));
        await db.books.update(id, { ocr: { state: 'waiting', done, total, error: busy ? BUSY_NOTE : paused ? PAUSED_NOTE : NEED_AI_NOTE } });
        if (busy) retrySoon();
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
      // Another scanned book opened since: its pages come first, this one resumes after.
      const mine = (await db.books.get(id))?.openedAt ?? 0;
      const newer = await db.books.filter((b) => b.id !== id && b.import.state === 'ready' && (b.ocr?.state === 'queued' || b.ocr?.state === 'running') && (b.openedAt ?? 0) > mine).count();
      if (newer) {
        await db.books.update(id, { ocr: { state: 'queued', done, total } });
        return;
      }
    }
    await db.books.update(id, { ocr: { state: 'done', done, total }, scanView: book.scanView ?? 'page' });
  } catch (e) {
    if (e instanceof AiBusy || e instanceof AllowanceUsedUp) {
      await db.books.update(id, { ocr: { state: 'waiting', done, total, error: e instanceof AiBusy ? BUSY_NOTE : PAUSED_NOTE }, scanView: book.scanView ?? 'page' });
      if (e instanceof AiBusy) retrySoon();
      return;
    }
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
