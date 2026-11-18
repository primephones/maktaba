import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { CoverStyle } from '../db/types';

export type ThemeName = 'auto' | 'paper' | 'sepia' | 'lamp' | 'black';
export type ReadMode = 'scroll' | 'paged';

export interface ReaderPrefs {
  mode: ReadMode;
  /** Percent of the base reading size. */
  fontSize: number;
  lineHeight: number;
  /** Side margin in px. */
  margin: number;
  justify: boolean;
  latinFont: 'literata' | 'plex';
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
  ai: AiPrefs;
  reader: ReaderPrefs;
  coverStyle: CoverStyle;
  flags: Flags;
  librarySort: 'recent' | 'added' | 'title' | 'author' | 'progress';
  /** What happens to a new book: ask which folder, sort it by itself, or leave it. */
  shelving: 'ask' | 'auto' | 'off';
  lastBackupAt: number;
  backupReminder: 'off' | 'weekly' | 'monthly';
}

export const DEFAULTS: Settings = {
  theme: 'auto',
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
  },
  coverStyle: 'bound',
  flags: { pageCurl: false, reduceMotion: false },
  librarySort: 'recent',
  shelving: 'ask',
  lastBackupAt: 0,
  backupReminder: 'monthly',
};

export async function getSetting<K extends keyof Settings>(key: K): Promise<Settings[K]> {
  const rec = await db.settings.get(key);
  return merge(DEFAULTS[key], rec?.value as Settings[K] | undefined);
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  await db.settings.put({ key, value });
  if (key === 'theme') applyTheme(value as ThemeName);
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

const THEME_COLOR: Record<Exclude<ThemeName, 'auto'>, string> = {
  paper: '#f6f4ef', sepia: '#f1e7d0', lamp: '#1d1914', black: '#000000',
};

export function resolveTheme(theme: ThemeName): Exclude<ThemeName, 'auto'> {
  if (theme !== 'auto') return theme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'lamp' : 'paper';
}

export function applyTheme(theme: ThemeName) {
  const resolved = resolveTheme(theme);
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[resolved]);
  try {
    // Mirrored so the right colours are painted before the database has opened.
    localStorage.setItem('maktaba.theme', theme);
  } catch {
    /* private mode */
  }
}

export function applyMotion(reduce: boolean) {
  document.documentElement.dataset.motion = reduce ? 'off' : 'on';
}

export function bootTheme() {
  let stored: ThemeName = 'auto';
  try {
    stored = (localStorage.getItem('maktaba.theme') as ThemeName) || 'auto';
  } catch {
    /* private mode */
  }
  applyTheme(stored);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    void getSetting('theme').then(applyTheme);
  });
  void getSetting('theme').then(applyTheme);
  void getSetting('flags').then((f) => applyMotion(f.reduceMotion));
}
