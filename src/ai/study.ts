import { db, sectionId } from '../db/db';
import type { Book } from '../db/types';
import { findAll, normalizeForSearch } from '../lib/arabic';
import { formatCitation } from '../lib/citation';
import { getSetting } from '../app/settings';
import { request } from './client';

/**
 * Asking your own books. The question is turned into search words (Arabic and English,
 * so an English question finds untranslated Arabic passages too), the best passages are
 * gathered on the phone, and the AI may answer only from them, citing each one.
 */

export interface Source {
  id: string;
  bookId: string;
  section: number;
  block: number;
  text: string;
  en?: string;
  cite: string;
}

export interface Answer {
  found: boolean;
  answer: string;
  quotes: Array<{ id: string; text: string; verified: boolean }>;
  cited: string[];
  sources: Source[];
  provider: string;
  model: string;
}

async function study<T>(body: Record<string, unknown>, isPrivate: boolean, feature: 'ask' | 'explain' | 'irab'): Promise<{ result: T; provider: string; model: string }> {
  const ai = await getSetting('ai');
  return request<{ result: T; provider: string; model: string }>('/v1/study', {
    body: { ...body, private: isPrivate, prefer: ai.prefer[feature] ?? ai.prefer.translate },
    timeoutMs: 120_000,
  });
}

const MAX_SOURCES = 14;

function wordsOf(q: string): string[] {
  const stop = new Set(['the', 'and', 'what', 'does', 'is', 'are', 'of', 'in', 'on', 'to', 'a', 'an', 'how', 'why', 'who', 'about', 'say', 'says', 'do', 'for', 'with', 'هل', 'ما', 'في', 'من', 'على', 'عن', 'ان', 'أن']);
  return q.split(/[\s،,.?؟!:;()]+/).map((w) => w.trim()).filter((w) => w.length > 2 && !stop.has(w.toLowerCase()));
}

/** Gathers the passages from the chosen books that best match the search words. */
async function gather(bookIds: string[], words: string[]): Promise<Source[]> {
  const terms = [...new Set(words.map((w) => normalizeForSearch(w)).filter((w) => w.length > 1))];
  if (!terms.length) return [];
  const scored: Array<{ score: number; src: Source }> = [];
  for (const id of bookIds) {
    const book = await db.books.get(id);
    if (!book || book.import.state !== 'ready') continue;
    const trs = new Map((await db.translations.where('bookId').equals(id).toArray()).map((t) => [`${t.section}:${t.block}`, t.en]));
    for (let s = 0; s < book.sectionCount; s++) {
      const sec = await db.sections.get(sectionId(id, s));
      if (!sec) continue;
      sec.blocks.forEach((b, i) => {
        if (b.t === 'img' || b.text.length < 20) return;
        const en = trs.get(`${s}:${i}`);
        const hay = `${b.text}\n${en ?? ''}`;
        let score = 0;
        for (const t of terms) score += Math.min(3, findAll(hay, t, 3).length) * (t.length > 4 ? 2 : 1);
        if (!score) return;
        const page = b.printed ?? (b.page ? String(b.page) : undefined);
        scored.push({
          score,
          src: { id: '', bookId: id, section: s, block: i, text: b.text.slice(0, 1600), en: en?.slice(0, 1600), cite: formatCitation({ author: book.author, book: book.title, page, chapter: sec.title }) },
        });
      });
    }
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SOURCES)
    .map((x, i) => ({ ...x.src, id: `p${i + 1}` }));
}

export async function askBooks(question: string, bookIds: string[]): Promise<Answer> {
  const books = (await db.books.bulkGet(bookIds)).filter((b): b is Book => !!b);
  const isPrivate = books.some((b) => b.private);
  let words = wordsOf(question);
  try {
    const kw = await study<{ ar: string[]; en: string[] }>({ task: 'keywords', question }, isPrivate, 'ask');
    words = [...kw.result.ar, ...kw.result.en, ...words];
  } catch {
    // Without search words from the AI, the question's own words are used.
  }
  const sources = await gather(bookIds, words);
  if (!sources.length) {
    return { found: false, answer: 'Nothing in the chosen books matches this question.', quotes: [], cited: [], sources: [], provider: '', model: '' };
  }
  const r = await study<Omit<Answer, 'sources' | 'provider' | 'model'>>(
    { task: 'ask', question, passages: sources.map((s) => ({ id: s.id, text: s.text, en: s.en, cite: s.cite })) },
    isPrivate,
    'ask',
  );
  return { ...r.result, sources, provider: r.provider, model: r.model };
}

export interface Point {
  point: string;
  ids: string[];
}
export interface Debate {
  found: boolean;
  positions: Array<{ position: string; held_by: string; arguments: Point[]; objections: Point[] }>;
  note: string;
  sources: Source[];
  provider: string;
  model: string;
}

/** The positions on a question, with the arguments for and against each, from the chosen books only. */
export async function debateBooks(question: string, bookIds: string[]): Promise<Debate> {
  const books = (await db.books.bulkGet(bookIds)).filter((b): b is Book => !!b);
  const isPrivate = books.some((b) => b.private);
  let words = wordsOf(question);
  try {
    const kw = await study<{ ar: string[]; en: string[] }>({ task: 'keywords', question }, isPrivate, 'ask');
    words = [...kw.result.ar, ...kw.result.en, ...words];
  } catch {
    // Without search words from the AI, the question's own words are used.
  }
  const sources = await gather(bookIds, words);
  if (!sources.length) return { found: false, positions: [], note: 'Nothing in the chosen books matches this question.', sources: [], provider: '', model: '' };
  const r = await study<Omit<Debate, 'sources' | 'provider' | 'model'>>(
    { task: 'debate', question, passages: sources.map((s) => ({ id: s.id, text: s.text, en: s.en, cite: s.cite })) },
    isPrivate,
    'ask',
  );
  return { ...r.result, sources, provider: r.provider, model: r.model };
}

export interface Explanation {
  explanation: string;
  terms: Array<{ term: string; meaning: string }>;
  provider: string;
  model: string;
}

export async function explainPassage(book: Book, passage: string, en: string | undefined, cite: string): Promise<Explanation> {
  const r = await study<{ explanation: string; terms: Explanation['terms'] }>({ task: 'explain', passage, en, cite }, !!book.private, 'explain');
  return { ...r.result, provider: r.provider, model: r.model };
}

export type IrabCase = 'marfu' | 'mansub' | 'majrur' | 'majzum' | 'mabni';
export interface IrabWord {
  word: string;
  irab: string;
  en: string;
  /** The case it takes (absent in analyses saved before cases were asked for). */
  case?: IrabCase;
  /** Its role, in English. */
  role?: string;
  /** Why it takes this case: the rule, in plain English. */
  why?: string;
}
export interface Irab {
  words: IrabWord[];
  note: string;
  provider: string;
  model: string;
  corrected?: boolean;
}

const irabKey = (s: string) => `irab:${normalizeForSearch(s).replace(/\s+/g, ' ').trim()}`;

/** Iʿrāb of a sentence: a correction saved earlier is used before asking the AI again. */
export async function irab(book: Book, sentence: string): Promise<Irab> {
  const saved = (await db.settings.get(irabKey(sentence)))?.value as Irab | undefined;
  if (saved) return saved;
  const r = await study<{ words: Irab['words']; note: string }>({ task: 'irab', sentence }, !!book.private, 'irab');
  return { ...r.result, provider: r.provider, model: r.model };
}

export async function saveIrab(sentence: string, value: Irab): Promise<void> {
  await db.settings.put({ key: irabKey(sentence), value: { ...value, corrected: true } });
}

export interface Definition {
  translit: string;
  lemma: string;
  root: string;
  pos: string;
  meanings: string[];
  here: string;
  technical: string;
  provider: string;
  model: string;
}

const defineKey = (word: string, context: string) => `define:${normalizeForSearch(word)}:${normalizeForSearch(context).slice(0, 120)}`;

/** A word's meanings, and what it means in the sentence it stands in. Kept, so asking again costs nothing. */
export async function defineWord(book: Book, word: string, context: string): Promise<Definition> {
  const key = defineKey(word, context);
  const saved = (await db.settings.get(key))?.value as Definition | undefined;
  if (saved) return saved;
  const r = await study<Omit<Definition, 'provider' | 'model'>>({ task: 'define', word, context }, !!book.private, 'explain');
  const value = { ...r.result, provider: r.provider, model: r.model };
  await db.settings.put({ key, value });
  return value;
}

export interface Summary {
  summary: string;
  sources: Source[];
  /** Paragraphs the summary was made from, out of the chapter's total. */
  covered: number;
  total: number;
  title: string;
  provider: string;
  model: string;
}

/** About how much of a chapter one request can carry. */
const SUMMARY_CHARS = 28_000;

const summaryKey = (bookId: string, section: number, block: number) => `summary:${bookId}:${section}:${block}`;

/** Where a chapter starts and ends, from the contents list (or the whole section). */
export function chapterAt(book: Book, at: { section: number; block: number }) {
  let i = -1;
  book.toc.forEach((t, k) => {
    if (t.section < at.section || (t.section === at.section && (t.block ?? 0) <= at.block)) i = k;
  });
  const here = book.toc[i];
  const next = book.toc[i + 1];
  if (!here) return { title: book.title, from: { section: at.section, block: 0 }, to: { section: at.section + 1, block: 0 } };
  return {
    title: here.title,
    from: { section: here.section, block: here.block ?? 0 },
    to: next ? { section: next.section, block: next.block ?? 0 } : { section: book.sectionCount, block: 0 },
  };
}

export async function savedSummary(book: Book, at: { section: number; block: number }): Promise<Summary | undefined> {
  const ch = chapterAt(book, at);
  return (await db.settings.get(summaryKey(book.id, ch.from.section, ch.from.block)))?.value as Summary | undefined;
}

/**
 * Summarises the chapter the reader is in, only from its own paragraphs, each point tied
 * to the paragraph it came from. Kept, so it is asked for once.
 */
/** The paragraphs of a chapter (with their English and citation), numbered p1, p2…, up to a size an AI can take. */
async function chapterSources(book: Book, ch: ReturnType<typeof chapterAt>): Promise<{ sources: Source[]; total: number }> {
  const trs = new Map((await db.translations.where('bookId').equals(book.id).toArray()).map((t) => [`${t.section}:${t.block}`, t.en]));
  const all: Source[] = [];
  for (let s = ch.from.section; s < Math.min(ch.to.section + 1, book.sectionCount); s++) {
    const sec = await db.sections.get(sectionId(book.id, s));
    if (!sec) continue;
    sec.blocks.forEach((b, i) => {
      if (s === ch.from.section && i < ch.from.block) return;
      if (s > ch.to.section || (s === ch.to.section && i >= ch.to.block)) return;
      // Headings name the chapter; only its paragraphs are summarised.
      if (b.t === 'img' || b.t === 'h' || b.text.trim().length < 2) return;
      const page = b.printed ?? (b.page ? String(b.page) : undefined);
      all.push({ id: '', bookId: book.id, section: s, block: i, text: b.text, en: trs.get(`${s}:${i}`), cite: formatCitation({ author: book.author, book: book.title, page, chapter: sec.title }) });
    });
  }
  if (!all.length) throw new Error('This chapter has no text yet (its pages are images that have not been read).');
  const sources: Source[] = [];
  let size = 0;
  for (const src of all) {
    const len = src.text.length + (src.en?.length ?? 0);
    if (sources.length && size + len > SUMMARY_CHARS) break;
    size += len;
    sources.push({ ...src, text: src.text.slice(0, 4000), en: src.en?.slice(0, 4000), id: `p${sources.length + 1}` });
  }
  return { sources, total: all.length };
}

export async function summariseChapter(book: Book, at: { section: number; block: number }, again = false): Promise<Summary> {
  const ch = chapterAt(book, at);
  const key = summaryKey(book.id, ch.from.section, ch.from.block);
  if (!again) {
    const saved = (await db.settings.get(key))?.value as Summary | undefined;
    if (saved) return saved;
  }
  const { sources, total } = await chapterSources(book, ch);
  const r = await study<{ summary: string }>({ task: 'summarise', passages: sources.map(({ id, text, en, cite }) => ({ id, text, en, cite })) }, !!book.private, 'explain');
  // A citation to a paragraph that was not given is removed rather than shown.
  const known = new Set(sources.map((s) => s.id));
  const summary = r.result.summary.replace(/\s*\[([^\]\s]+)\]/g, (m, id: string) => (known.has(id) ? m : ''));
  const out: Summary = { summary, sources, covered: sources.length, total, title: ch.title, provider: r.provider, model: r.model };
  await db.settings.put({ key, value: out });
  return out;
}

export interface Quiz {
  questions: Array<{ q: string; options: string[]; answer: number; why: string; ids: string[] }>;
  sources: Source[];
  title: string;
  provider: string;
  model: string;
}

/** Five questions on the chapter being read, from its own text, each with why and where. */
export async function quizChapter(book: Book, at: { section: number; block: number }): Promise<Quiz> {
  const ch = chapterAt(book, at);
  const { sources } = await chapterSources(book, ch);
  const r = await study<{ questions: Quiz['questions'] }>({ task: 'quiz', passages: sources.map(({ id, text, en, cite }) => ({ id, text, en, cite })) }, !!book.private, 'explain');
  return { ...r.result, sources, title: ch.title, provider: r.provider, model: r.model };
}
