import { useSyncExternalStore } from 'react';
import { db } from '../db/db';
import type { Book } from '../db/types';
import { sourceParagraphs, translateNow, type SourceParagraph } from './translation';
import { workBegan, workEnded, workFinished, workProgress } from '../native/work';
import { toast } from '../ui/toast';

/**
 * Translating ahead of the reader. It runs here, not in the screen that started it, so it
 * carries on when the English panel is closed, the page is scrolled or another screen is
 * opened; the reader shows how far it has got. "As I read" keeps a stretch ahead of the place
 * being read translated, for as long as the book is open.
 */
export interface AheadState {
  bookId: string;
  title: string;
  done: number;
  total: number;
  /** Seconds until the AI is asked again, when every service is busy. */
  waiting: number;
  /** Keeping ahead of the reader, rather than a fixed number of paragraphs. */
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
  if (state) set({ ...state, follow: false });
};

/** Leaving the book ends "As I read" (after the paragraphs under way); a fixed run carries on. */
export const leaveBook = (bookId: string) => {
  if (state?.bookId === bookId && state.follow) set({ ...state, follow: false });
};

const untranslated = async (book: Book, from: { section: number; block: number }, count: number) => {
  const have = new Set((await db.translations.where('bookId').equals(book.id).primaryKeys()).map(String));
  return (await sourceParagraphs(book, from, count + 400)).filter((p) => !have.has(`${book.id}:${p.id}`)).slice(0, count);
};

/**
 * Translates the next `count` paragraphs from `from` (or the paragraphs given), or with
 * `follow`, keeps translating ahead of the reader. One run at a time.
 */
export async function translateAhead(book: Book, opts: { from?: { section: number; block: number }; count?: number; paras?: SourceParagraph[]; follow?: boolean }): Promise<void> {
  if (state) {
    if (opts.follow && state.bookId === book.id) set({ ...state, follow: true });
    else toast('Translation is already running. It carries on while you read.');
    return;
  }
  stopWanted = false;
  const key = `ahead:${book.id}`;
  let total = 0;
  let done = 0;
  set({ bookId: book.id, title: book.title, done: 0, total: 0, waiting: 0, follow: !!opts.follow });
  await workBegan(key, 'Translating', book.title, '');
  try {
    let paras = opts.paras ?? (await untranslated(book, opts.from ?? places.get(book.id) ?? { section: 0, block: 0 }, opts.count ?? 10));
    if (!paras.length && !opts.follow) {
      toast('The next pages are already translated.');
      return;
    }
    for (;;) {
      if (paras.length) {
        total += paras.length;
        const base = done;
        set({ ...state!, total });
        done += await translateNow(book, paras, {
          onProgress: (d) => {
            if (stopWanted) throw new Error('stopped');
            set({ ...state!, done: base + d, total, waiting: 0 });
            workProgress(key, 'Translating', `${book.title}: ${base + d} of ${total} paragraphs`, base + d, total);
          },
          onWait: (left) => set({ ...state!, waiting: left }),
        });
        if (!book.view) await db.books.update(book.id, { view: 'en' });
      }
      if (!current()?.follow || stopWanted) break;
      // As I read: keep about forty paragraphs ahead of the place being read.
      await new Promise((r) => setTimeout(r, paras.length ? 500 : 4000));
      if (!current()?.follow || stopWanted) break;
      paras = await untranslated(book, places.get(book.id) ?? { section: 0, block: 0 }, 10);
      const ahead = await untranslated(book, places.get(book.id) ?? { section: 0, block: 0 }, 40);
      if (!ahead.length) paras = [];
    }
    if (done && !current()?.follow) {
      const said = `${done} paragraph${done === 1 ? '' : 's'} of “${book.title}” translated.`;
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
