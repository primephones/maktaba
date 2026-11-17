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

export interface Irab {
  words: Array<{ word: string; irab: string; en: string }>;
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
