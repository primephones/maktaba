import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { CoverStyle } from '../db/types';
import type { TranslateStyle } from '../../server/src/translate';
import { isThemeId, themeInfo, type ThemeId } from './themes';

export type ThemeName = 'auto' | ThemeId;
/** Which theme "Follow phone" uses by day and by night. */
export interface AutoThemes {
  light: ThemeId;
  dark: ThemeId;
  /** What decides night: the phone's dark mode, or the clock (from `from` to `to`). */
  by?: 'phone' | 'clock';
  from?: string;
  to?: string;
}

/** Whether a time of day (now) falls in the night set by the clock, e.g. 19:00 to 06:00. */
export function nightByClock(from = '19:00', to = '06:00', now = new Date()): boolean {
  const mins = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const n = now.getHours() * 60 + now.getMinutes();
  const a = mins(from);
  const b = mins(to);
  return a <= b ? n >= a && n < b : n >= a || n < b;
}
export type ReadMode = 'scroll' | 'paged';

export interface ReaderPrefs {
  mode: ReadMode;
  /** Percent of the base reading size. */
  fontSize: number;
  lineHeight: number;
  /** Side margin in px. */
  margin: number;
  justify: boolean;
  latinFont: 'literata' | 'garamond' | 'atkinson' | 'plex';
  arabicFont: 'amiri' | 'scheherazade' | 'plex';
  urduFont: 'nastaliq' | 'gulzar' | 'amiri';
  /** Show vowel marks (tashkīl) in Arabic-script text. */
  tashkil: boolean;
  /** Android: the volume keys turn pages while a book is open. */
  volumeKeys: boolean;
  /** Android: the screen stays on while a book is open. */
  keepAwake: boolean;
  /** Android: lock the screen's orientation while reading. */
  orientation: 'auto' | 'portrait' | 'landscape';
  /** Printed pages shown light on dark (colours turned round) in a dark theme. */
  darkPages: boolean;
  /** Paragraphs as in a printed book (indented, no gaps), or set apart by space. */
  layout: 'book' | 'spaced';
  /** Heavier text, for small screens or tired eyes. */
  bold: boolean;
  /** Warm light over the page, 0 (none) to 80. */
  warmth: number;
  /** Dimmer than the phone allows, 0 (none) to 60. */
  dim: number;
}

/**
 * Feature switches. Anything unfinished stays off and out of sight until it works end to
 * end, so there are no buttons that lead nowhere.
 */
export interface Flags {
  pageCurl: boolean;
  reduceMotion: boolean;
}

/** Which AI service to try first for each feature (ids, in order); the rest follow. */
export interface AiPrefs {
  prefer: Partial<Record<'translate' | 'ocr' | 'ask' | 'explain' | 'irab', string[]>>;
}

export interface Settings {
  theme: ThemeName;
  autoThemes: AutoThemes;
  ai: AiPrefs;
  reader: ReaderPrefs;
  coverStyle: CoverStyle;
  flags: Flags;
  librarySort: 'recent' | 'added' | 'title' | 'author' | 'progress';
  /** The library as covers on shelves, or as a list. */
  libraryView: 'grid' | 'list';
  /** What happens to a new book: ask which folder, sort it by itself, or leave it. */
  shelving: 'ask' | 'auto' | 'off';
  lastBackupAt: number;
  backupReminder: 'off' | 'weekly' | 'monthly';
  /** How the English reads: Allah or God, honorifics, technical terms. */
  translationStyle: Required<TranslateStyle>;
  /** How fast this reader reads, in characters a minute (learned while reading). */
  readingSpeed: number;
}

export const DEFAULTS: Settings = {
  theme: 'auto',
  autoThemes: { light: 'paper', dark: 'lamp' },
  ai: { prefer: { translate: ['gemini', 'groq', 'openrouter', 'workers-ai'] } },
  reader: {
    mode: 'scroll',
    fontSize: 100,
    lineHeight: 1.7,
    margin: 22,
    justify: false,
    latinFont: 'literata',
    arabicFont: 'amiri',
    urduFont: 'nastaliq',
    tashkil: true,
    volumeKeys: false,
    keepAwake: false,
    orientation: 'auto',
    darkPages: false,
    layout: 'book',
    bold: false,
    warmth: 0,
    dim: 0,
  },
  coverStyle: 'bound',
  flags: { pageCurl: false, reduceMotion: false },
  librarySort: 'recent',
  libraryView: 'grid',
  shelving: 'ask',
  lastBackupAt: 0,
  backupReminder: 'monthly',
  translationStyle: { god: 'Allah', honorifics: 'words', terms: 'transliterated' },
  readingSpeed: 950,
};

export async function getSetting<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  const rec = await db.settings.get(key);
  return merge(DEFAULTS[key], rec?.value as Settings[K] | undefined);
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  await db.settings.put({ key, value });
  if (key === 'theme') applyTheme(value as ThemeName);
  if (key === 'autoThemes') {
    autoPair = value as AutoThemes;
    mirror('maktaba.autoThemes', JSON.stringify(autoPair));
    void getSetting('theme').then(applyTheme);
  }
  if (key === 'flags') applyMotion((value as Flags).reduceMotion);
}

function merge<T>(def: T, value: T | undefined): T {
  if (value === undefined || value === null) return def;
  if (typeof def === 'object' && def !== null && !Array.isArray(def)) return { ...def, ...(value as object) } as T;
  return value;
}

/** Reads a setting and re-renders when it changes. Returns the default while loading. */
export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  const rec = useLiveQuery(() => db.settings.get(key), [key]);
  return merge(DEFAULTS[key], rec?.value as Settings[K] | undefined);
}

let autoPair: AutoThemes = DEFAULTS.autoThemes;

function mirror(key: string, value: string) {
  try {
    // Mirrored so the right colours are painted before the database has opened.
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

export function resolveTheme(theme: ThemeName): ThemeId {
  if (theme !== 'auto') return isThemeId(theme) ? theme : 'paper';
  const night = autoPair.by === 'clock' ? nightByClock(autoPair.from, autoPair.to) : matchMedia('(prefers-color-scheme: dark)').matches;
  return night ? autoPair.dark : autoPair.light;
}

/** Light or dark, for the status bar's icons and the rules that differ between the two. */
export const themeTone = (theme: ThemeName) => themeInfo(resolveTheme(theme)).tone;

export function applyTheme(theme: ThemeName) {
  const resolved = resolveTheme(theme);
  const info = themeInfo(resolved);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.tone = info.tone;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', info.bg);
  mirror('maktaba.theme', theme);
  window.dispatchEvent(new Event('maktaba:theme'));
}

/** Applies the theme with the day/night pair from the settings (which may have come by sync). */
export function applyThemeWith(theme: ThemeName, pair: AutoThemes) {
  if (isThemeId(pair.light) && isThemeId(pair.dark) && JSON.stringify(pair) !== JSON.stringify(autoPair)) {
    autoPair = pair;
    mirror('maktaba.autoThemes', JSON.stringify(pair));
  }
  applyTheme(theme);
}

export function applyMotion(reduce: boolean) {
  document.documentElement.dataset.motion = reduce ? 'off' : 'on';
}

export function bootTheme() {
  let stored: ThemeName = 'auto';
  try {
    stored = (localStorage.getItem('maktaba.theme') as ThemeName) || 'auto';
    const pair = JSON.parse(localStorage.getItem('maktaba.autoThemes') ?? 'null') as AutoThemes | null;
    if (pair && isThemeId(pair.light) && isThemeId(pair.dark)) autoPair = pair;
  } catch {
    /* private mode */
  }
  applyTheme(stored);
  // Synced settings may differ from the mirror: the database has the last word.
  void getSetting('autoThemes')
    .then((p) => {
      autoPair = p;
      mirror('maktaba.autoThemes', JSON.stringify(p));
      return getSetting('theme');
    })
    .then(applyTheme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    void getSetting('theme').then(applyTheme);
  });
  void getSetting('flags').then((f) => applyMotion(f.reduceMotion));
}
