import { SEED_GLOSSARY } from '../../server/src/glossary';
import { isAndroidApp, plugin } from '../native/maktaba';
import { db } from '../db/db';

/**
 * Reading aloud. On Android the phone's own voices are used (they work offline once
 * installed); in a browser or on iPhone, the system voices. An English sentence is cut
 * into pieces so each Arabic term in it is said by an Arabic voice from its Arabic
 * spelling, the way an Arab says it, rather than guessed at by an English voice.
 */

export interface Piece {
  text: string;
  lang: 'en' | 'ar' | 'ur' | 'fa' | 'ps' | 'ms';
}

/** A pronunciation set by the reader with "Fix a word". */
export interface Fix {
  word: string;
  say: string;
  lang: Piece['lang'];
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ʿʾ'’]/g, '').toLowerCase();

let fixesCache: Fix[] | null = null;
export async function getFixes(): Promise<Fix[]> {
  if (!fixesCache) fixesCache = ((await db.settings.get('pronunciations'))?.value as Fix[] | undefined) ?? [];
  return fixesCache;
}
export async function setFixes(list: Fix[]): Promise<void> {
  fixesCache = list;
  await db.settings.put({ key: 'pronunciations', value: list });
}

/** Splits English into pieces, handing transliterated Arabic terms to an Arabic voice. */
export function piecesOf(text: string, lang: Piece['lang'], fixes: Fix[]): Piece[] {
  if (lang !== 'en') return [{ text, lang }];
  // Terms the glossary knows (by transliteration), and the reader's own fixes.
  const table = new Map<string, Piece>();
  for (const t of SEED_GLOSSARY) table.set(fold(t.tr), { text: t.ar, lang: 'ar' });
  for (const f of fixes) table.set(fold(f.word), { text: f.say, lang: f.lang });
  const out: Piece[] = [];
  let buf = '';
  // Words with their trailing punctuation; transliterations keep their ʿ ʾ and macrons.
  for (const token of text.split(/(\s+)/)) {
    const core = token.replace(/^[("“‘[]+|[)"”’\].,;:!?]+$/g, '');
    const hit = core && table.get(fold(core.replace(/^al-/i, 'al-')));
    if (hit) {
      if (buf.trim()) out.push({ text: buf, lang: 'en' });
      buf = '';
      out.push(hit);
      const tail = token.slice(token.indexOf(core) + core.length);
      if (tail) buf += tail;
    } else buf += token;
  }
  if (buf.trim()) out.push({ text: buf, lang: 'en' });
  return out;
}

/** Splits a paragraph into sentences, so speech can move a sentence at a time. */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?؟۔])\s+/).map((s) => s.trim()).filter(Boolean);
}

type Listener = (e: { type: string; id: string }) => void;
const listeners = new Set<Listener>();
let nativeHooked = false;

function hookNative() {
  if (nativeHooked || !isAndroidApp()) return;
  nativeHooked = true;
  void plugin.addListener('speech', (e: unknown) => listeners.forEach((l) => l(e as { type: string; id: string })));
}

export function onSpeech(fn: Listener): () => void {
  hookNative();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const LOCALE: Record<Piece['lang'], string> = { en: 'en-GB', ar: 'ar-SA', ur: 'ur-PK', fa: 'fa-IR', ps: 'ps-AF', ms: 'ms-MY' };

/** Says one piece; the "done" event carries the id. */
export async function speakPiece(p: Piece, id: string, rate: number, flush = false): Promise<void> {
  if (isAndroidApp()) {
    hookNative();
    await (plugin as unknown as { speak(o: unknown): Promise<void> }).speak({ text: p.text, id, lang: LOCALE[p.lang], rate, flush });
    return;
  }
  if (!('speechSynthesis' in window)) throw new Error('This browser cannot read aloud.');
  if (flush) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(p.text);
  u.lang = LOCALE[p.lang];
  u.rate = rate;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(p.lang));
  // Prefer a voice installed on the device, so it works offline.
  u.voice = voices.find((v) => v.localService) ?? voices[0] ?? null;
  u.onstart = () => listeners.forEach((l) => l({ type: 'start', id }));
  u.onend = () => listeners.forEach((l) => l({ type: 'done', id }));
  u.onerror = () => listeners.forEach((l) => l({ type: 'error', id }));
  speechSynthesis.speak(u);
}

export async function stopSpeaking(): Promise<void> {
  if (isAndroidApp()) await (plugin as unknown as { stopSpeaking(): Promise<void> }).stopSpeaking().catch(() => undefined);
  else if ('speechSynthesis' in window) speechSynthesis.cancel();
}

export const canSpeak = () => isAndroidApp() || (typeof window !== 'undefined' && 'speechSynthesis' in window);
