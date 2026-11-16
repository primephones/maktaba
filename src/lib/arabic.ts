import type { Lang } from '../db/types';

/** Arabic-script combining marks: tashkīl, Qur'anic annotation signs, superscript alef. */
const TASHKIL = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭ࣓-ࣿ]/g;
const TASHKIL_ONE = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭ࣓-ࣿ]/;
const TATWEEL = /ـ/g;
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const ARABIC_SCRIPT_G = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/g;
const LATIN_G = /[A-Za-z]/g;

export const hasArabicScript = (s: string) => ARABIC_SCRIPT.test(s);

/** Removes vowel marks but leaves the letters as written. */
export const stripTashkil = (s: string) => s.replace(TASHKIL, '').replace(TATWEEL, '');

/**
 * Removes vowel marks and returns, for each character kept, its index in the original
 * string. Lets a selection made on undotted display text be mapped back to stored text.
 */
export function stripTashkilWithMap(s: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === 'ـ' || TASHKIL_ONE.test(ch)) continue;
    text += ch;
    map.push(i);
  }
  map.push(s.length);
  return { text, map };
}

const FOLD: Record<string, string> = {
  // hamza carriers → bare letter
  'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ٲ': 'ا', 'ٳ': 'ا',
  'ؤ': 'و', 'ئ': 'ي', 'ء': '',
  // tāʾ marbūṭa, alif maqṣūra
  'ة': 'ه', 'ى': 'ي',
  // Persian / Urdu kāf, yāʾ, hāʾ variants
  'ک': 'ك', 'ڪ': 'ك', 'ی': 'ي', 'ے': 'ي', 'ۓ': 'ي', 'ې': 'ي',
  'ہ': 'ه', 'ۂ': 'ه', 'ۃ': 'ه', 'ھ': 'ه', 'ە': 'ه',
  // Eastern digits → ASCII
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

/**
 * Folds text for searching: ignores diacritics, the spellings of hamza, tāʾ marbūṭa,
 * alif maqṣūra and the Persian/Urdu kāf and yāʾ, plus case and Latin accents.
 */
export function normalizeForSearch(s: string): string {
  let out = '';
  const d = s.normalize('NFKC');
  for (let i = 0; i < d.length; i++) {
    const ch = d[i];
    if (ch === 'ـ' || TASHKIL_ONE.test(ch)) continue;
    const f = FOLD[ch];
    out += f !== undefined ? f : ch;
  }
  return out
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Like normalizeForSearch, but also returns for each folded character the index of the
 * original character it came from, so matches can be highlighted in the original text.
 */
export function normalizeWithMap(s: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const folded = normalizeForSearch(s[i]);
    for (let j = 0; j < folded.length; j++) {
      text += folded[j];
      map.push(i);
    }
  }
  map.push(s.length);
  return { text, map };
}

/** Finds every occurrence of an already-normalised query in a text, as original offsets. */
export function findAll(text: string, normQuery: string, limit = 50): Array<[number, number]> {
  if (!normQuery) return [];
  const { text: norm, map } = normalizeWithMap(text);
  const hits: Array<[number, number]> = [];
  let from = 0;
  while (hits.length < limit) {
    const i = norm.indexOf(normQuery, from);
    if (i < 0) break;
    const start = map[i];
    const end = map[i + normQuery.length - 1] + 1;
    hits.push([start, end]);
    from = i + normQuery.length;
  }
  return hits;
}

/** Guesses the language of a text from its script and a few tell-tale letters. */
export function detectLang(sample: string): Lang {
  const arabic = (sample.match(ARABIC_SCRIPT_G) || []).length;
  const latin = (sample.match(LATIN_G) || []).length;
  if (arabic === 0 && latin === 0) return 'other';
  if (arabic < latin * 0.3) return 'en';
  // Letters that exist in Urdu but not Arabic or Persian.
  const urdu = (sample.match(/[ٹڈڑںےھہ]/g) || []).length;
  // Letters shared by Persian and Urdu but absent from Arabic.
  const ajami = (sample.match(/[پچژگ]/g) || []).length;
  if (urdu / arabic > 0.01) return 'ur';
  if (ajami / arabic > 0.004) return 'fa';
  return 'ar';
}

export const isRtl = (lang: Lang) => lang === 'ar' || lang === 'ur' || lang === 'fa';

export const langName = (lang: Lang): string =>
  ({ ar: 'Arabic', ur: 'Urdu', fa: 'Persian', en: 'English', other: 'Other' })[lang];

const AR_ORDINALS: Record<string, number> = {
  'الأول': 1, 'الاول': 1, 'الأولى': 1, 'الثاني': 2, 'الثانية': 2, 'الثالث': 3, 'الثالثة': 3,
  'الرابع': 4, 'الرابعة': 4, 'الخامس': 5, 'الخامسة': 5, 'السادس': 6, 'السادسة': 6,
  'السابع': 7, 'السابعة': 7, 'الثامن': 8, 'الثامنة': 8, 'التاسع': 9, 'التاسعة': 9,
  'العاشر': 10, 'العاشرة': 10,
};

const toAsciiDigits = (s: string) => s.replace(/[٠-٩۰-۹]/g, (d) => FOLD[d] ?? d);

/**
 * Pulls a volume number out of a title ("Vol. 3", "ج ٣", "المجلد الثالث", "جلد ۳") so the
 * volumes of one work can be shelved together.
 */
export function parseVolume(title: string): { series: string; volume: number } | null {
  const t = toAsciiDigits(title);
  const patterns: RegExp[] = [
    /[\s\-–—_,(:[]*(?:vol(?:ume)?\.?|v\.|part|pt\.?|juz['ʾ]?|jild)\s*(\d{1,3})\s*[)\]]?\s*$/i,
    /[\s\-–—_,(:[]*(?:المجلد|الجزء|مجلد|جزء|جلد|حصہ|حصه|ج)\s*[.:]?\s*(\d{1,3})\s*[)\]]?\s*$/,
    /[\s\-–—_,(:[]+(\d{1,3})\s*[)\]]?\s*$/,
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m && m.index !== undefined && m.index > 1) {
      return { series: title.slice(0, m.index).trim(), volume: parseInt(m[1], 10) };
    }
  }
  const ord = t.match(/[\s\-–—_,(:[]*(?:المجلد|الجزء|مجلد|جزء|جلد)\s+(\S+)\s*[)\]]?\s*$/);
  if (ord && ord.index !== undefined && ord.index > 1 && AR_ORDINALS[ord[1]]) {
    return { series: title.slice(0, ord.index).trim(), volume: AR_ORDINALS[ord[1]] };
  }
  return null;
}
