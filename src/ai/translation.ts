import { db, sectionId } from '../db/db';
import type { Book, Translation } from '../db/types';
import { detectLang, hasArabicScript } from '../lib/arabic';
import { getSetting } from '../app/settings';
import { request, ServerError, type JobStatus } from './client';

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
export async function sourceParagraphs(book: Book, from?: { section: number; block: number }): Promise<SourceParagraph[]> {
  const out: SourceParagraph[] = [];
  let chapter = '';
  for (let s = from?.section ?? 0; s < book.sectionCount; s++) {
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
export async function translateNow(book: Book, paras: SourceParagraph[], opts: { prefer?: string[]; fresh?: boolean } = {}): Promise<number> {
  let done = 0;
  const prefer = opts.prefer ?? (await preferredOrder());
  let batch: SourceParagraph[] = [];
  let size = 0;
  const flush = async () => {
    if (!batch.length) return;
    const prev = await db.translations.get(`${book.id}:${batch[0].section}:${batch[0].block - 1}`);
    const res = await request<{ results: Array<{ id: string; en: string; uncertain: Translation['uncertain']; provider: string; model: string }> }>('/v1/translate', {
      body: { lang: lang(book, paras.slice(0, 10).map((p) => p.text).join(' ')), private: !!book.private, prefer, fresh: opts.fresh, bookTitle: book.title, chapter: batch[0].chapter, previous: prev?.en, paragraphs: batch.map((p) => ({ id: p.id, text: p.text, kind: p.kind })) },
      timeoutMs: 120_000,
    });
    await db.translations.bulkPut(res.results.map((r) => {
      const [section, block] = r.id.split(':').map(Number);
      return { id: `${book.id}:${section}:${block}`, bookId: book.id, section, block, en: r.en, uncertain: r.uncertain, label: 'draft' as const, provider: r.provider, model: r.model, updatedAt: Date.now() };
    }));
    done += res.results.length;
    batch = [];
    size = 0;
  };
  for (const p of paras) {
    if (batch.length && (size + p.text.length > 3200 || batch.length >= 10)) await flush();
    batch.push(p);
    size += p.text.length;
  }
  await flush();
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
