import { useSyncExternalStore } from 'react';
import { db, sectionId } from '../db/db';
import type { Book } from '../db/types';
import { SomeLeftInOriginal, sourceParagraphs, translateNow, type SourceParagraph } from './translation';
import { workBegan, workEnded, workFinished, workProgress } from '../native/work';
import { toast } from '../ui/toast';

/**
 * Translating ahead of the reader. It runs here, not in the screen that started it, so it
 * carries on when the English panel is closed, the page is scrolled or another screen is
 * opened; the reader shows how far it has got. "As I read" keeps a stretch ahead of the place
 * being read translated, for as long as the book is open.
 *
 * A scanned book goes by pages: each page is first read by the AI (which gives its English in
 * the same request), and anything left without English is then translated as text.
 */
export interface AheadState {
  bookId: string;
  title: string;
  done: number;
  total: number;
  /** Paragraphs for a book of text; pages for a scanned book. */
  unit: 'paragraphs' | 'pages';
  /** The page being read and translated now (scanned books). */
  page?: number;
  /** Pages in this run (scanned books), so each page can say it is on its way. */
  pages?: number[];
  /** Seconds until the AI is asked again, when every service is busy. */
  waiting: number;
  /** Keeping ahead of the reader, rather than a fixed number. */
  follow: boolean;
}

let state: AheadState | null = null;
const listeners = new Set<() => void>();
/** The state now (a function, so the compiler does not assume it unchanged across awaits). */
const current = (): AheadState | null => state;
const set = (s: AheadState | null) => {
  state = s;
  for (const l of listeners) l();
};
const patch = (p: Partial<AheadState>) => {
  if (state) set({ ...state, ...p });
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** How far translating ahead has got, for the book given (null when nothing runs for it). */
export function useAhead(bookId: string): AheadState | null {
  const s = useSyncExternalStore(subscribe, () => state);
  return s && s.bookId === bookId ? s : null;
}

let stopWanted = false;
/** Where the reader is, kept up to date by the reader, for "As I read". */
const places = new Map<string, { section: number; block: number }>();
export const setReadingPlace = (bookId: string, at: { section: number; block: number }) => void places.set(bookId, at);
export const stopAhead = () => {
  stopWanted = true;
  // As I read switched off: it stays off for this book.
  if (state?.follow) void db.books.update(state.bookId, { asIRead: false });
  patch({ follow: false });
};

/** Leaving the book ends "As I read" (after the page or paragraphs under way); a fixed run carries on. */
export const leaveBook = (bookId: string) => {
  if (state?.bookId === bookId && state.follow) patch({ follow: false });
};

/** Pages asked for while a run is going (Read and translate this page, under another page): taken next. */
const extra: number[] = [];
/**
 * Paragraphs (ids) and pages the AI's answers failed for in this run: not asked again and
 * again (As I read would otherwise return to them every few seconds). A later run tries again.
 */
const skipIds = new Set<string>();
const skipPages = new Set<number>();
let leftInOriginal = 0;

/** A book with page pictures read by the AI: translated page by page. */
export const isScanned = (book: Pick<Book, 'ocr'>) => !!book.ocr;

const untranslatedWithin = async (book: Book, from: { section: number; block: number }, within: number, take: number) => {
  const have = new Set((await db.translations.where('bookId').equals(book.id).primaryKeys()).map(String));
  return (await sourceParagraphs(book, from, within)).slice(0, within).filter((p) => !have.has(`${book.id}:${p.id}`) && !skipIds.has(p.id)).slice(0, take);
};

/** Translates, keeping count of paragraphs whose English would not come right (left in the original). */
async function translateKeeping(book: Book, paras: SourceParagraph[], opts: Parameters<typeof translateNow>[2]): Promise<number> {
  try {
    return await translateNow(book, paras, opts);
  } catch (e) {
    if (!(e instanceof SomeLeftInOriginal)) throw e;
    for (const id of e.ids) skipIds.add(id);
    leftInOriginal += e.ids.length;
    return e.done;
  }
}

/** The paragraphs read from one scanned page that have no English yet. */
async function pageLeftovers(book: Book, page: number): Promise<SourceParagraph[]> {
  const { sectionOfPage } = await import('../ocr/merge');
  const idx = await sectionOfPage(book.id, page);
  if (idx === null) return [];
  const sec = await db.sections.get(sectionId(book.id, idx));
  if (!sec) return [];
  const have = new Set((await db.translations.where('bookId').equals(book.id).primaryKeys()).map(String));
  return sec.blocks
    .map((b, i) => ({ b, i }))
    .filter(({ b, i }) => b.ocr && b.page === page && b.text.trim().length > 1 && !have.has(`${book.id}:${idx}:${i}`))
    .map(({ b, i }) => ({ id: `${idx}:${i}`, section: idx, block: i, text: b.text, kind: (b.t === 'h' ? 'h' : b.t === 'quote' ? 'quote' : 'p') as SourceParagraph['kind'], chapter: sec.title }));
}

/**
 * Which pages of a scanned book are done (read by the AI, and every paragraph on them in
 * English), from one pass over the book (a large scan has hundreds of pages).
 */
async function pagesNotDone(bookId: string): Promise<{ all: number[]; notDone: Set<number> }> {
  const [sections, rows, trKeys] = await Promise.all([
    db.sections.where('bookId').equals(bookId).toArray(),
    db.ocrPages.where('bookId').equals(bookId).toArray(),
    db.translations.where('bookId').equals(bookId).primaryKeys(),
  ]);
  const have = new Set(trKeys.map(String));
  const read = new Set(rows.filter((r) => r.by === 'ai' || r.edited).map((r) => r.page));
  const all: number[] = [];
  const notDone = new Set<number>();
  for (const sec of sections) {
    sec.blocks.forEach((b, i) => {
      const m = b.t === 'img' ? (b.src?.match(/^page:(\d+)$/)?.[1] ?? (b.src === 'page-1' ? '1' : undefined)) : undefined;
      if (m) {
        all.push(Number(m));
        if (!read.has(Number(m))) notDone.add(Number(m));
      } else if (b.ocr && b.page && b.text.trim().length > 1 && !have.has(`${bookId}:${sec.idx}:${i}`)) notDone.add(b.page);
    });
  }
  return { all: [...new Set(all)].sort((a, b) => a - b), notDone };
}

/** The pages from the one being read onwards (within `within` pages), not yet done, at most `count`. */
async function pagesAhead(book: Book, from: { section: number; block: number }, count: number, within = Infinity): Promise<number[]> {
  const { pageAt } = await import('../ocr/queue');
  const { all, notDone } = await pagesNotDone(book.id);
  const here = (await pageAt(book.id, from)) ?? all[0] ?? 1;
  return all.filter((x) => x >= here).slice(0, within).filter((p) => notDone.has(p) && !skipPages.has(p)).slice(0, count);
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reading a page failed for a reason waiting will not mend (the day's allowance, a refused key, a private book). */
const final = (e: unknown) => {
  const m = (e as Error)?.message ?? '';
  return (e as Error)?.name === 'AllowanceUsedUp' || /allowance|refused|private|add a free Gemini key|sign in to OpenRouter/i.test(m);
};

/** Reads one page with the AI (waiting and asking again while every model is busy), then translates what it left. */
async function readAndTranslatePage(book: Book, page: number): Promise<number> {
  const { readPageNow } = await import('../ocr/queue');
  const { AllowanceUsedUp } = await import('../ocr/ai');
  for (let attempt = 0; ; attempt++) {
    try {
      await readPageNow(book, page);
      break;
    } catch (e) {
      if (e instanceof AllowanceUsedUp || final(e) || attempt >= 4) throw e;
      // Every model busy for now: wait a minute, saying so, and ask again.
      for (let left = 60; left > 0; left--) {
        if (stopWanted) throw new Error('stopped');
        patch({ waiting: left });
        await pause(1000);
      }
      patch({ waiting: 0 });
    }
  }
  const rest = await pageLeftovers((await db.books.get(book.id)) ?? book, page);
  if (rest.length) await translateKeeping((await db.books.get(book.id)) ?? book, rest, { onWait: (left) => patch({ waiting: left }), quality: !!current()?.follow });
  if (rest.some((p) => skipIds.has(p.id))) skipPages.add(page);
  return rest.length;
}

/**
 * Translates ahead: the next `count` paragraphs from `from` (or the paragraphs given) of a
 * book of text, or the next `count` pages of a scanned book (or the pages given); or, with
 * `follow`, keeps translating ahead of the reader. One run at a time.
 */
export async function translateAhead(
  book: Book,
  opts: { from?: { section: number; block: number }; count?: number; paras?: SourceParagraph[]; pages?: number[]; follow?: boolean },
): Promise<void> {
  // As I read stays on for the book (it starts again whenever the book is opened) until switched off.
  if (opts.follow && !book.asIRead) void db.books.update(book.id, { asIRead: true });
  if (state) {
    if (state.bookId === book.id && opts.follow) patch({ follow: true });
    else if (state.bookId === book.id && opts.pages?.length && state.unit === 'pages') {
      // Another page asked for: it is taken next.
      for (const p of opts.pages) if (!extra.includes(p) && !state.pages?.includes(p)) extra.push(p);
      patch({ pages: [...(state.pages ?? []), ...opts.pages.filter((p) => !state!.pages?.includes(p))], total: state.total + opts.pages.length });
    } else toast('Translation is already running. It carries on while you read.');
    return;
  }
  stopWanted = false;
  extra.length = 0;
  skipIds.clear();
  skipPages.clear();
  leftInOriginal = 0;
  if (!opts.paras && isScanned(book)) return aheadByPages(book, opts);
  const key = `ahead:${book.id}`;
  let total = 0;
  let done = 0;
  set({ bookId: book.id, title: book.title, done: 0, total: 0, waiting: 0, follow: !!opts.follow, unit: 'paragraphs' });
  await workBegan(key, 'Translating', book.title, '');
  try {
    const place = () => places.get(book.id) ?? opts.from ?? { section: 0, block: 0 };
    let paras = opts.paras ?? (opts.follow ? await untranslatedWithin(book, place(), 40, 10) : await untranslatedWithin(book, opts.from ?? place(), (opts.count ?? 10) + 2000, opts.count ?? 10));
    if (!paras.length && !opts.follow) {
      toast('The next pages are already translated.');
      return;
    }
    for (;;) {
      if (paras.length) {
        total += paras.length;
        const base = done;
        patch({ total });
        done += await translateKeeping(book, paras, {
          // As I read works ahead of the reader: the better English is worth the wait.
          quality: !!current()?.follow,
          onProgress: (d) => {
            if (stopWanted) throw new Error('stopped');
            patch({ done: base + d, total, waiting: 0 });
            workProgress(key, 'Translating', `${book.title}: ${base + d} of ${total} paragraphs`, base + d, total);
          },
          onWait: (left) => patch({ waiting: left }),
        });
        if (!book.view) await db.books.update(book.id, { view: 'en' });
      }
      if (!current()?.follow || stopWanted) break;
      // As I read: about forty paragraphs ahead of the place being read are kept in English.
      await pause(paras.length ? 500 : 4000);
      if (!current()?.follow || stopWanted) break;
      paras = await untranslatedWithin(book, place(), 40, 10);
    }
    if ((done || leftInOriginal) && !current()?.follow) {
      const said = `${done} paragraph${done === 1 ? '' : 's'} of “${book.title}” translated.${leftInOriginal ? ` ${leftInOriginal} could not be put into English this time and ${leftInOriginal === 1 ? 'stays' : 'stay'} in the original; translating again later usually works.` : ''}`;
      toast(said);
      void workFinished('Translation ready', said);
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (msg !== 'stopped') {
      toast(done ? `${done} paragraph${done === 1 ? '' : 's'} translated, then it stopped: ${msg}` : msg);
      void workFinished('Translation stopped', done ? `${done} paragraphs of “${book.title}” were translated before it stopped.` : msg);
    }
  } finally {
    await workEnded(key);
    set(null);
  }
}

/** A scanned book, page by page: each page read by the AI if it has not been, then put into English. */
async function aheadByPages(book: Book, opts: { from?: { section: number; block: number }; count?: number; pages?: number[]; follow?: boolean }): Promise<void> {
  const key = `ahead:${book.id}`;
  const place = () => places.get(book.id) ?? opts.from ?? { section: 0, block: 0 };
  let done = 0;
  set({ bookId: book.id, title: book.title, done: 0, total: 0, waiting: 0, follow: !!opts.follow, unit: 'pages', pages: [] });
  await workBegan(key, 'Reading and translating', book.title, '');
  try {
    let queue = opts.pages ?? (await pagesAhead(book, opts.from ?? place(), opts.follow ? 3 : (opts.count ?? 3), opts.follow ? 3 : Infinity));
    if (!queue.length && !opts.follow) {
      toast('The next pages are already read and translated.');
      return;
    }
    patch({ pages: [...queue], total: queue.length });
    for (;;) {
      while (queue.length || extra.length) {
        if (stopWanted) throw new Error('stopped');
        const page = extra.length ? extra.shift()! : queue.shift()!;
        patch({ page, waiting: 0 });
        workProgress(key, 'Reading and translating', `${book.title}: page ${page} (${done + 1} of ${current()?.total ?? 1})`, done, current()?.total ?? 1);
        await readAndTranslatePage(book, page);
        done++;
        patch({ done, page: undefined });
        if (!book.view) await db.books.update(book.id, { view: 'en' });
      }
      if (!current()?.follow || stopWanted) break;
      // As I read: the page being read and the two after it are kept read and in English.
      await pause(4000);
      if (!current()?.follow || stopWanted) break;
      queue = await pagesAhead(book, place(), 3, 3);
      if (queue.length) patch({ pages: [...(current()?.pages ?? []), ...queue], total: (current()?.total ?? 0) + queue.length });
    }
    if (done && !current()?.follow) {
      const said = `${done} page${done === 1 ? '' : 's'} of “${book.title}” read and translated.${leftInOriginal ? ` ${leftInOriginal} paragraph${leftInOriginal === 1 ? '' : 's'} could not be put into English this time and ${leftInOriginal === 1 ? 'stays' : 'stay'} in the original; translating again later usually works.` : ''}`;
      toast(said);
      void workFinished('Translation ready', said);
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (msg !== 'stopped') {
      toast(done ? `${done} page${done === 1 ? '' : 's'} read and translated, then it stopped: ${msg}` : msg);
      void workFinished('Translation stopped', done ? `${done} pages of “${book.title}” were read and translated before it stopped.` : msg);
    }
  } finally {
    extra.length = 0;
    await workEnded(key);
    set(null);
  }
}

/**
 * The whole of a scanned book: every page not yet read is read (from the page being read
 * onwards) and translated as it is read; pages read earlier without their English get it too.
 */
export async function translateWholeScan(book: Book): Promise<void> {
  const { runOcrQueue } = await import('../ocr/queue');
  const fresh = (await db.books.get(book.id)) ?? book;
  if (fresh.ocr && fresh.ocr.state !== 'done') {
    await db.books.update(book.id, { ocr: { ...fresh.ocr, state: 'queued', error: undefined } });
    void runOcrQueue();
  }
  const { startBookTranslation } = await import('./translation');
  await startBookTranslation(fresh).catch(() => undefined);
}
