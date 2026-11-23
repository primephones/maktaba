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

/** A voice the phone or browser has, for the reader to choose from. */
export interface VoiceInfo {
  name: string;
  lang: string;
  /** Works without the internet. */
  offline: boolean;
  quality?: number;
}

let chosenCache: Partial<Record<Piece['lang'], string>> | null = null;
/** The voice chosen for each language (by name), if the reader chose one. */
export async function chosenVoices(): Promise<Partial<Record<Piece['lang'], string>>> {
  if (!chosenCache) chosenCache = ((await db.settings.get('voices'))?.value as Partial<Record<Piece['lang'], string>> | undefined) ?? {};
  return chosenCache;
}
export async function chooseVoice(lang: Piece['lang'], name: string | null): Promise<void> {
  const next = { ...(await chosenVoices()) };
  if (name) next[lang] = name;
  else delete next[lang];
  chosenCache = next;
  await db.settings.put({ key: 'voices', value: next });
}

/** The voices there are for a language, the best (offline, then highest quality) first. */
export async function voicesFor(lang: Piece['lang']): Promise<VoiceInfo[]> {
  const want = LOCALE[lang].split('-')[0];
  let all: VoiceInfo[] = [];
  if (isAndroidApp()) {
    const r = await (plugin as unknown as { speechVoices(): Promise<{ voices: VoiceInfo[] }> }).speechVoices().catch(() => ({ voices: [] }));
    all = r.voices;
  } else if ('speechSynthesis' in window) {
    let vs = speechSynthesis.getVoices();
    if (!vs.length) {
      await new Promise((r) => setTimeout(r, 400));
      vs = speechSynthesis.getVoices();
    }
    all = vs.map((v) => ({ name: v.name, lang: v.lang, offline: v.localService }));
  }
  return all
    .filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(want))
    .sort((a, b) => Number(b.offline) - Number(a.offline) || (b.quality ?? 0) - (a.quality ?? 0) || a.name.localeCompare(b.name));
}

/** Says one piece; the "done" event carries the id. */
export async function speakPiece(p: Piece, id: string, rate: number, flush = false): Promise<void> {
  const voice = (await chosenVoices())[p.lang];
  if (isAndroidApp()) {
    hookNative();
    await (plugin as unknown as { speak(o: unknown): Promise<void> }).speak({ text: p.text, id, lang: LOCALE[p.lang], rate, flush, ...(voice ? { voice } : {}) });
    return;
  }
  if (!('speechSynthesis' in window)) throw new Error('This browser cannot read aloud.');
  if (flush) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(p.text);
  u.lang = LOCALE[p.lang];
  u.rate = rate;
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(p.lang));
  // The voice the reader chose; else one installed on the device, so it works offline.
  u.voice = voices.find((v) => v.name === voice) ?? voices.find((v) => v.localService) ?? voices[0] ?? null;
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
