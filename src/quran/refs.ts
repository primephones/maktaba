import { SURAHS } from './surahs';

/**
 * Finds Qur'an references and quoted verses in a paragraph, so they can be tapped to see
 * the verse in Arabic with its English meaning, offline.
 */

export interface QuranRef {
  surah: number;
  from: number;
  to: number;
}

export interface QuranMatch {
  start: number;
  end: number;
  kind: 'ref' | 'quote';
  ref?: QuranRef;
  /** The quoted words, for quotations without a reference. */
  quote?: string;
}

const MARKS = '[\\u064B-\\u065F\\u0670\\u0640]*';
const LETTER: Record<string, string> = {
  'ا': '[اأإآٱ]', 'أ': '[اأإآٱ]', 'إ': '[اأإآٱ]', 'آ': '[اأإآٱ]', 'ٱ': '[اأإآٱ]',
  'ة': '[ةه]', 'ه': '[ةه]', 'ى': '[ىي]', 'ي': '[ىي]',
};
const toAscii = (s: string) => s.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

/** A pattern for a sūra name that tolerates vowel marks, hamza spellings and a missing "al-". */
function namePattern(name: string): string {
  const bare = name.replace(/[ً-ٰٟـ]/g, '');
  const body = bare.startsWith('ال') ? bare.slice(2) : bare;
  const letters = [...body].map((ch) => (ch === ' ' ? '\\s+' : `${LETTER[ch] ?? ch}${MARKS}`)).join('');
  return bare.startsWith('ال') ? `(?:ال${MARKS})?${letters}` : letters;
}

// Longest names first, so "آل عمران" is not read as a shorter name.
const ORDER = SURAHS.map((s, i) => ({ i, pat: namePattern(s[0]) })).sort((a, b) => b.pat.length - a.pat.length);
const NAMES = ORDER.map((o) => `(${o.pat})`).join('|');
const NUM = '([0-9٠-٩۰-۹]{1,3})';
const AR_REF = new RegExp(
  `[\\[(]\\s*(?:سورة${MARKS}\\s+)?(?:${NAMES})\\s*[:：،,]?\\s*(?:(?:الآية|الآيات|آية|آيات|الاية|اية)\\s*[:：]?\\s*)?${NUM}(?:\\s*[-–—،,]\\s*${NUM})?\\s*[\\])]`,
  'gu',
);
const EN_REF = /(?:\bQ(?:ur['ʾ’]?[aā]n)?\.?\s*|[([]\s*(?:(?:S[uū]ra(?:h)?|al-|Q)\s*[A-Za-zʿʾ'’-]*\s*)?)(\d{1,3})\s*[:.]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?/g;
const QUOTE = /[﴿﴾{]([^﴿﴾{}]{6,900})[﴿﴾}]/gu;

const valid = (s: number, a: number, b: number) => s >= 1 && s <= 114 && a >= 1 && b >= a && b <= SURAHS[s - 1][3];

export function findQuranRefs(text: string): QuranMatch[] {
  const out: QuranMatch[] = [];
  for (const m of text.matchAll(AR_REF)) {
    const groups = m.slice(1, 1 + ORDER.length);
    const hit = groups.findIndex((g) => g !== undefined);
    if (hit < 0) continue;
    const surah = ORDER[hit].i + 1;
    const a = Number(toAscii(m[1 + ORDER.length]));
    const b = m[2 + ORDER.length] ? Number(toAscii(m[2 + ORDER.length])) : a;
    if (valid(surah, a, b)) out.push({ start: m.index!, end: m.index! + m[0].length, kind: 'ref', ref: { surah, from: a, to: b } });
  }
  for (const m of text.matchAll(EN_REF)) {
    const s = Number(m[1]);
    const a = Number(m[2]);
    const b = m[3] ? Number(m[3]) : a;
    if (!valid(s, a, b)) continue;
    // Point at the numbers themselves, not the opening bracket.
    const start = m.index! + m[0].indexOf(m[1]);
    out.push({ start, end: m.index! + m[0].length, kind: 'ref', ref: { surah: s, from: a, to: b } });
  }
  for (const m of text.matchAll(QUOTE)) {
    if (!/[؀-ۿ]/.test(m[1])) continue;
    out.push({ start: m.index!, end: m.index! + m[0].length, kind: 'quote', quote: m[1] });
  }
  // Keep the first of any overlapping matches.
  out.sort((x, y) => x.start - y.start);
  return out.filter((m, i) => !out.slice(0, i).some((p) => p.start < m.end && m.start < p.end));
}

export const surahName = (n: number) => SURAHS[n - 1];

// ------------------------------------------------------------------------------- the text

export interface Verse {
  surah: number;
  ayah: number;
  ar: string;
  en: string;
}

interface Chapter {
  id: number;
  verses: Array<{ id: number; text: string; translation: string }>;
}

let data: Promise<Chapter[]> | null = null;

/** The whole Qur'an with its English, loaded from the app itself (no internet needed). */
function load(): Promise<Chapter[]> {
  if (!data) {
    data = fetch(new URL('quran/quran_en.json', document.baseURI).href).then((r) => {
      if (!r.ok) throw new Error('The Qur’an text could not be opened.');
      return r.json() as Promise<Chapter[]>;
    });
    data.catch(() => {
      data = null;
    });
  }
  return data;
}

export async function getVerses(ref: QuranRef): Promise<Verse[]> {
  const ch = (await load())[ref.surah - 1];
  return ch.verses.filter((v) => v.id >= ref.from && v.id <= ref.to).map((v) => ({ surah: ref.surah, ayah: v.id, ar: v.text, en: v.translation }));
}

const fold = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/[ً-ٰٟـۖ-ۭ]/g, '')
    .replace(/[اأإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^ء-ي\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

let folded: Promise<Array<{ s: number; a: number; t: string }>> | null = null;

/** Finds which verse(s) a quotation comes from, by its words. */
export async function identifyQuote(quote: string): Promise<QuranRef | null> {
  if (!folded) folded = load().then((chs) => chs.flatMap((c) => c.verses.map((v) => ({ s: c.id, a: v.id, t: fold(v.text) }))));
  const verses = await folded;
  const q = fold(quote);
  const words = q.split(' ');
  if (words.length < 2) return null;
  // The first few words find the verse; the quote may run on into the following verses.
  const probe = words.slice(0, Math.min(6, words.length)).join(' ');
  const start = verses.findIndex((v) => v.t.includes(probe));
  if (start < 0) return null;
  let end = start;
  let covered = verses[start].t.length - verses[start].t.indexOf(probe);
  while (covered < q.length - 4 && end + 1 < verses.length && verses[end + 1].s === verses[start].s) {
    end++;
    covered += verses[end].t.length + 1;
  }
  return { surah: verses[start].s, from: verses[start].a, to: verses[end].a };
}
