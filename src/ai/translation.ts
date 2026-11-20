import { db, sectionId } from '../db/db';
import type { Book, Translation } from '../db/types';
import { detectLang, hasArabicScript } from '../lib/arabic';
import { getSetting } from '../app/settings';
import { request, ServerError, type JobStatus } from './client';
import { addMemory, translationContext } from './context';
import { fold } from '../../server/src/glossary';
import type { MemoryItem } from '../../server/src/translate';

/**
 * Whole-book translation. The book's paragraphs are handed to the private server, which
 * works through them a batch at a time, pausing when the free allowances run out and
 * carrying on by itself. The phone collects finished paragraphs whenever it can, and
 * keeps every one, so a translated page works offline and is never paid for twice.
 */

export interface SourceParagraph {
  id: string;
  section: number;
  block: number;
  text: string;
  kind: 'h' | 'p' | 'quote';
  chapter?: string;
}

type SrcLang = 'ar' | 'ur' | 'fa' | 'ps' | 'ms';
const SRC = new Set<string>(['ar', 'ur', 'fa', 'ps', 'ms']);
/** The language to translate from: the book's own, or (when unknown) read from the text. */
const lang = (b: Book, sample?: string): SrcLang => {
  if (SRC.has(b.lang)) return b.lang as SrcLang;
  const seen = sample ? detectLang(sample) : 'ar';
  return SRC.has(seen) ? (seen as SrcLang) : 'ar';
};

/** Every book not already in English can be translated (Malay in Latin letters included). */
export const translatable = (b: Pick<Book, 'lang'>) => b.lang !== 'en';

/** Whether a paragraph has text worth sending, in the book's script. */
const worthTranslating = (b: Pick<Book, 'lang'>, text: string) =>
  b.lang === 'ms' || b.lang === 'other' ? hasArabicScript(text) || /\p{L}{3}/u.test(text) : hasArabicScript(text);

/** Every paragraph of the book that has text to translate. */
export async function sourceParagraphs(book: Book, from?: { section: number; block: number }, enough = Infinity): Promise<SourceParagraph[]> {
  const out: SourceParagraph[] = [];
  let chapter = '';
  for (let s = from?.section ?? 0; s < book.sectionCount && out.length < enough; s++) {
    const sec = await db.sections.get(sectionId(book.id, s));
    if (!sec) continue;
    sec.blocks.forEach((b, i) => {
      if (b.t === 'h') chapter = b.text;
      if (from && s === from.section && i < from.block) return;
      if (b.t === 'img' || b.t === 'hr' || b.t === 'pre' || b.text.trim().length < 2 || !worthTranslating(book, b.text)) return;
      out.push({ id: `${s}:${i}`, section: s, block: i, text: b.text, kind: b.t === 'h' ? 'h' : b.t === 'quote' ? 'quote' : 'p', chapter: chapter || sec.title });
    });
  }
  return out;
}

/** About how many requests of free allowance some paragraphs will take. */
export const estimateRequests = (paras: Array<{ text: string }>) => Math.max(1, Math.ceil(paras.reduce((n, p) => n + p.text.length, 0) / 3200));

async function preferredOrder(): Promise<string[]> {
  const ai = await getSetting('ai');
  return ai.prefer.translate ?? [];
}

export async function startBookTranslation(book: Book): Promise<void> {
  const paragraphs = await sourceParagraphs(book);
  if (!paragraphs.length) throw new Error(book.ocr && book.ocr.state !== 'done' ? 'This book’s pages are still being read. Translation can start once some pages are done.' : 'This book has no text to translate yet.');
  // Paragraphs already translated (for instance by reading ahead) are not sent again.
  const have = new Set((await db.translations.where('bookId').equals(book.id).primaryKeys()).map((k) => k.split(':').slice(1).join(':')));
  const todo = paragraphs.filter((p) => !have.has(p.id));
  if (!todo.length) {
    await db.books.update(book.id, { translation: { jobId: '', state: 'done', done: paragraphs.length, total: paragraphs.length, cursor: 0, startedAt: Date.now() } });
    return;
  }
  const res = await request<{ id: string; total: number }>('/v1/jobs', {
    body: {
      bookKey: book.hash,
      title: book.title,
      lang: lang(book, todo.slice(0, 30).map((p) => p.text).join(' ')),
      private: !!book.private,
      prefer: await preferredOrder(),
      paragraphs: todo.map((p) => ({ id: p.id, text: p.text, kind: p.kind, chapter: p.chapter })),
    },
    timeoutMs: 60_000,
  });
  await db.books.update(book.id, {
    translation: { jobId: res.id, state: 'queued', done: 0, total: res.total, cursor: 0, startedAt: Date.now() },
    view: book.view ?? 'en',
  });
}

export async function cancelBookTranslation(book: Book): Promise<void> {
  if (book.translation?.jobId) await request(`/v1/jobs/${book.translation.jobId}`, { method: 'DELETE' }).catch(() => undefined);
  await db.books.update(book.id, { translation: undefined });
}

interface ResultItem {
  pid: string;
  en: string;
  uncertain: Translation['uncertain'];
  provider: string;
  model: string;
  done_at: number;
}

/** Collects whatever the server has finished for one book. */
export async function pullBook(bookId: string): Promise<void> {
  const book = await db.books.get(bookId);
  const t = book?.translation;
  if (!book || !t?.jobId || t.state === 'done' || t.state === 'cancelled') return;
  let cursor = t.cursor;
  let job: JobStatus | undefined;
  for (let round = 0; round < 50; round++) {
    const res = await request<{ items: ResultItem[]; job: JobStatus }>(`/v1/jobs/${t.jobId}/results?since=${cursor}`);
    job = res.job;
    if (res.items.length) {
      await db.translations.bulkPut(res.items.map((r) => {
        const [section, block] = r.pid.split(':').map(Number);
        return { id: `${bookId}:${section}:${block}`, bookId, section, block, en: r.en, uncertain: r.uncertain, label: 'draft' as const, provider: r.provider, model: r.model, updatedAt: Date.now() };
      }));
      cursor = Math.max(cursor, ...res.items.map((r) => r.done_at));
    }
    if (res.items.length < 400) break;
  }
  if (job) {
    await db.books.update(bookId, {
      translation: { ...t, state: job.state, done: job.done, total: job.total, nextRunAt: job.next_run_at || undefined, note: job.last_error ?? undefined, cursor },
    });
  }
}

let pulling = false;
let again = false;

/** Collects finished translations for every book that has one in progress. */
export async function pullAll(): Promise<void> {
  // A pull asked for while one is running runs straight after it, so nothing waits for the next check.
  if (pulling) {
    again = true;
    return;
  }
  pulling = true;
  again = false;
  try {
    const books = await db.books.filter((b) => !!b.translation?.jobId && b.translation.state !== 'done' && b.translation.state !== 'cancelled').toArray();
    for (const b of books) {
      try {
        await pullBook(b.id);
      } catch (e) {
        if (e instanceof ServerError && e.status === 404) await db.books.update(b.id, { translation: { ...b.translation!, state: 'failed', note: 'The server no longer has this translation. Start it again.' } });
        else break;
      }
    }
  } finally {
    pulling = false;
    if (again) void pullAll();
  }
}

/**
 * Translates some paragraphs right away (reading ahead, or a fresh draft from another
 * AI). Returns how many were done; stops at the first failure with its reason.
 */
/**
 * Asks again when every AI is busy for a moment (free models are often overloaded for a minute
 * or two), saying so while it waits, rather than failing at once. Gives up after about four minutes.
 */
export async function patiently<T>(ask: () => Promise<T>, onWait?: (seconds: number) => void, tries = 5): Promise<T> {
  const started = Date.now();
  for (let attempt = 0; ; attempt++) {
    try {
      return await ask();
    } catch (e) {
      const busy = e instanceof ServerError && e.status === 503;
      const retryAt = busy ? Number(e.data.retryAt) || 0 : 0;
      // Back within minutes (a busy model) is worth waiting for; a day's allowance used up is not.
      if (busy && retryAt - Date.now() > 10 * 60_000) throw e;
      const wait = Math.min(60_000, Math.max(15_000, retryAt - Date.now()));
      if (!busy || attempt >= tries - 1 || Date.now() + wait - started > 240_000) throw e;
      for (let left = Math.round(wait / 1000); left > 0; left--) {
        onWait?.(left);
        await new Promise((r) => setTimeout(r, 1000));
      }
      onWait?.(0);
    }
  }
}

/** Paragraphs the AI could not put into English this time (its answers failed the checks). */
export class SomeLeftInOriginal extends Error {
  constructor(readonly done: number, readonly ids: string[]) {
    super(`${ids.length} paragraph${ids.length === 1 ? '' : 's'} could not be put into English this time (the AI’s answers failed the checks) and ${ids.length === 1 ? 'stays' : 'stay'} in the original. Translating again later usually works.`);
  }
}

export async function translateNow(
  book: Book,
  paras: SourceParagraph[],
  opts: { prefer?: string[]; fresh?: boolean; onProgress?: (done: number, total: number) => void; onWait?: (seconds: number) => void; quality?: boolean } = {},
): Promise<number> {
  let done = 0;
  const left: string[] = [];
  opts.onProgress?.(0, paras.length);
  const prefer = opts.prefer ?? (await preferredOrder());
  const ask = async (part: SourceParagraph[]) => {
    const prev = await db.translations.get(`${book.id}:${part[0].section}:${part[0].block - 1}`);
    const paragraphs = part.map((p) => ({ id: p.id, text: p.text, kind: p.kind }));
    // The reader's style, the names and terms this book has used so far, and the Qur'an verses
    // these paragraphs quote (with their standard English): the AI writes them the same way.
    const ctx = await translationContext(book.hash, paragraphs);
    const here = fold(part.map((p) => p.text).join(' '));
    const memory = ctx.memory.filter((m) => here.includes(fold(m.source))).slice(0, 40);
    const res = await patiently(
      () =>
        request<{ results: Array<{ id: string; en: string; uncertain: Translation['uncertain']; provider: string; model: string }>; names?: MemoryItem[] }>('/v1/translate', {
          body: { lang: lang(book, paras.slice(0, 10).map((p) => p.text).join(' ')), private: !!book.private, prefer, fresh: opts.fresh, quality: opts.quality, bookTitle: book.title, chapter: part[0].chapter, previous: prev?.en, paragraphs, bookKey: book.hash, style: ctx.style, memory, verses: ctx.verses },
          timeoutMs: opts.quality ? 300_000 : 120_000,
        }),
      opts.onWait,
    );
    if (res.names?.length) await addMemory(book.hash, res.names).catch(() => undefined);
    await db.translations.bulkPut(res.results.map((r) => {
      const [section, block] = r.id.split(':').map(Number);
      return { id: `${book.id}:${section}:${block}`, bookId: book.id, section, block, en: r.en, uncertain: r.uncertain, label: 'draft' as const, provider: r.provider, model: r.model, updatedAt: Date.now() };
    }));
    done += res.results.length;
    opts.onProgress?.(done, paras.length);
  };
  /** The AI's answers for these paragraphs failed the checks (merged, dropped, left untranslated). */
  const rejected = (e: unknown) => e instanceof ServerError && e.status === 502;
  const flush = async (part: SourceParagraph[]) => {
    if (!part.length) return;
    try {
      await ask(part);
    } catch (e) {
      if (!rejected(e)) throw e;
      if (part.length === 1) {
        // This one paragraph will not come right now: it stays in the original, and the rest go on.
        left.push(part[0].id);
        return;
      }
      // Asked again a paragraph at a time: one awkward paragraph cannot hold up the others.
      for (const one of part) await flush([one]);
    }
  };
  let batch: SourceParagraph[] = [];
  let size = 0;
  // In the background, larger batches: more of the chapter for the AI to see at once, fewer requests.
  const [maxChars, maxItems] = opts.quality ? [5200, 16] : [3200, 10];
  for (const p of paras) {
    if (batch.length && (size + p.text.length > maxChars || batch.length >= maxItems)) {
      await flush(batch);
      batch = [];
      size = 0;
    }
    batch.push(p);
    size += p.text.length;
  }
  await flush(batch);
  if (left.length) throw new SomeLeftInOriginal(done, left);
  return done;
}

/**
 * A second AI checks the English of a chapter against the original. Paragraphs found
 * faithful are marked checked; corrected ones get the correction, with each change and its
 * reason kept under the paragraph's †.
 */
export async function reviewChapter(book: Book, section: number, onProgress?: (done: number, total: number) => void): Promise<{ checked: number; corrected: number }> {
  const sec = await db.sections.get(sectionId(book.id, section));
  if (!sec) return { checked: 0, corrected: 0 };
  const trs = (await db.translations.where('bookId').equals(book.id).filter((t) => t.section === section && t.label === 'draft').toArray()).sort((x, y) => x.block - y.block);
  const items = trs.map((t) => ({ t, text: sec.blocks[t.block]?.text ?? '' })).filter((x) => x.text.trim().length > 1);
  let checked = 0;
  let corrected = 0;
  const sample = items.slice(0, 20).map((x) => x.text).join(' ');
  for (let i = 0; i < items.length; i += 6) {
    const batch = items.slice(i, i + 6);
    const res = await request<{ results: Array<{ id: string; ok: boolean; en: string; changes: Array<{ was: string; now: string; why: string }> }>; provider: string; model: string }>('/v1/review', {
      body: { lang: lang(book, sample), private: !!book.private, avoid: batch[0].t.provider, items: batch.map((x) => ({ id: String(x.t.block), text: x.text, en: x.t.en })) },
      timeoutMs: 120_000,
    });
    const now = Date.now();
    for (const r of res.results) {
      const t = batch.find((x) => String(x.t.block) === r.id)?.t;
      if (!t) continue;
      if (r.ok) checked++;
      else corrected++;
      const notes = r.changes.map((c) => ({ span: c.now, reason: `Corrected by a second AI (${res.model.replace(/^.*\//, '')}): ${c.why}${c.was ? ` Was: “${c.was}”.` : ''}` }));
      const en = !r.ok && notes.length && !/†/.test(r.en) ? `${r.en} †` : r.en;
      await db.translations.put({ ...t, en, uncertain: r.ok ? t.uncertain : [...t.uncertain, ...notes], label: 'checked', updatedAt: now });
    }
    onProgress?.(Math.min(items.length, i + 6), items.length);
  }
  return { checked, corrected };
}
