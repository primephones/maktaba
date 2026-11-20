import { db } from '../db/db';
import { getSetting } from '../app/settings';
import { findQuranRefs, getVerses, identifyQuote, type QuranRef } from '../quran/refs';
import type { MemoryItem, TranslateStyle, VerseNote } from '../../server/src/translate';

/**
 * What goes with a passage to the AI besides its text, so the English is right and the
 * same from one page to the next:
 * - the reader's style (Allah or God, honorifics, technical terms);
 * - the book's memory: names and special terms already rendered in this book;
 * - the Qur'an verses the passage quotes, with their standard English from the app.
 */

const memoryKey = (bookKey: string) => `memory:${bookKey}`;
const MAX_MEMORY = 400;

interface Stored extends MemoryItem {
  /** How often the AI has used it, and when last: the least used and oldest go first when full. */
  n: number;
  at: number;
}

/** The names and terms remembered for a book (by the book's file hash, the same on every phone). */
export async function getMemory(bookKey: string): Promise<MemoryItem[]> {
  const v = (await db.settings.get(memoryKey(bookKey)))?.value as Stored[] | undefined;
  return (v ?? []).map(({ source, en }) => ({ source, en }));
}

/**
 * Adds what the AI says it rendered. A name already remembered keeps its first English (the
 * book stays consistent), unless the reader changed it.
 */
export async function addMemory(bookKey: string, items: MemoryItem[]): Promise<void> {
  if (!items.length) return;
  const key = memoryKey(bookKey);
  const list = ((await db.settings.get(key))?.value as Stored[] | undefined) ?? [];
  const bySource = new Map(list.map((m) => [m.source, m]));
  const now = Date.now();
  for (const it of items) {
    const had = bySource.get(it.source);
    if (had) {
      had.n++;
      had.at = now;
    } else bySource.set(it.source, { ...it, n: 1, at: now });
  }
  const kept = [...bySource.values()].sort((a, b) => b.n - a.n || b.at - a.at).slice(0, MAX_MEMORY);
  await db.settings.put({ key, value: kept });
}

/** Changes, or forgets (empty English), one remembered name for a book. */
export async function setMemory(bookKey: string, source: string, en: string): Promise<void> {
  const key = memoryKey(bookKey);
  const list = ((await db.settings.get(key))?.value as Stored[] | undefined) ?? [];
  const next = en ? list.map((m) => (m.source === source ? { ...m, en, n: m.n + 100 } : m)) : list.filter((m) => m.source !== source);
  await db.settings.put({ key, value: next });
}

export async function getStyle(): Promise<Required<TranslateStyle>> {
  return getSetting('translationStyle');
}

const refText = (r: QuranRef) => `${r.surah}:${r.from}${r.to > r.from ? `-${r.to}` : ''}`;

/**
 * The Qur'an verses each paragraph quotes or cites, with their standard English: by a
 * reference ([البقرة: 255], Q 2:255), a quotation in ﴿ ﴾, or a paragraph set apart as a
 * quotation that is a verse. Works offline, from the Qur'an in the app.
 */
export async function versesIn(paragraphs: Array<{ id: string; text: string; kind?: string }>): Promise<VerseNote[]> {
  const out: VerseNote[] = [];
  for (const p of paragraphs) {
    const refs: QuranRef[] = [];
    for (const m of findQuranRefs(p.text)) {
      if (m.ref) refs.push(m.ref);
      else if (m.quote) {
        const r = await identifyQuote(m.quote).catch(() => null);
        if (r) refs.push(r);
      }
    }
    // A paragraph set apart as a quotation, with vowel marks, may be a verse without brackets.
    if (!refs.length && p.kind === 'quote' && (p.text.match(/[ً-ْ]/g) ?? []).length >= 6) {
      const r = await identifyQuote(p.text).catch(() => null);
      if (r) refs.push(r);
    }
    for (const r of refs.slice(0, 3)) {
      const verses = await getVerses({ ...r, to: Math.min(r.to, r.from + 4) }).catch(() => []);
      if (verses.length) out.push({ id: p.id, ref: refText(r), en: verses.map((v) => v.en).join(' ') });
    }
  }
  return out.slice(0, 12);
}

/** Everything that goes with a batch: style, the book's memory and the verses quoted. */
export async function translationContext(bookKey: string | undefined, paragraphs: Array<{ id: string; text: string; kind?: string }>): Promise<{ style: Required<TranslateStyle>; memory: MemoryItem[]; verses: VerseNote[] }> {
  const [style, memory, verses] = await Promise.all([getStyle(), bookKey ? getMemory(bookKey) : Promise.resolve([]), versesIn(paragraphs).catch(() => [])]);
  return { style, memory, verses };
}
