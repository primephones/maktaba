import type { Block, OcrLang } from '../db/types';
import { getMyAi } from '../ai/device';
import { local, setLocal } from '../sync/sync';

/**
 * Reading scanned pages with the reader's own Gemini key. Gemini reads Urdu Nastaliq,
 * old Arabic prints and Persian far better than the engine on the phone, and keeps
 * headings, paragraphs and verse apart. It is used when the reader has added a Gemini key,
 * for books not marked private (Google may learn from free-tier requests).
 *
 * The free allowance is paced (a page every few seconds). When the day's allowance runs
 * out, the phone's own engine carries on and those pages are marked, so they can be read
 * again with AI later.
 */

const MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
/** The free tier allows about ten requests a minute on the first model. (Tests shorten it.) */
const spacing = () => (globalThis as { __maktabaAiSpacing?: number }).__maktabaAiSpacing ?? 6500;
const PAUSE_KEY = 'aiOcrPausedUntil';

const LANG_NAME: Record<OcrLang, string> = {
  ara: 'Arabic',
  urd: 'Urdu (often in Nastaliq script)',
  fas: 'Persian',
  pus: 'Pashto',
  msa: 'Malay (in Jawi or Latin letters)',
  eng: 'English',
};

let lastCall = 0;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The Gemini key to read pages with, if reading with AI can be used for this book now. */
export async function aiReaderFor(book: { private?: boolean }): Promise<string | null> {
  if (book.private) return null;
  const key = (await getMyAi()).gemini;
  if (!key) return null;
  const paused = (await local(PAUSE_KEY)) as number | undefined;
  if (paused && paused > Date.now()) return null;
  return key;
}

/** Why AI reading is not being used, for the book's details. */
export async function aiReaderPausedUntil(): Promise<number | null> {
  const paused = (await local(PAUSE_KEY)) as number | undefined;
  return paused && paused > Date.now() ? paused : null;
}

export class AllowanceUsedUp extends Error {}

/** A page image as JPEG, at most 1800 pixels on its long side (plenty for print). */
async function jpeg(image: HTMLCanvasElement): Promise<string> {
  const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
  let src = image;
  if (scale < 1) {
    src = document.createElement('canvas');
    src.width = Math.round(image.width * scale);
    src.height = Math.round(image.height * scale);
    src.getContext('2d')!.drawImage(image, 0, 0, src.width, src.height);
  }
  const blob = await new Promise<Blob>((res, rej) => src.toBlob((b) => (b ? res(b) : rej(new Error('Could not prepare the page image.'))), 'image/jpeg', 0.85));
  if (src !== image) {
    src.width = 0;
    src.height = 0;
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const prompt = (lang: OcrLang | 'auto') =>
  `This is one page of a printed book in ${lang === 'auto' ? 'the language printed on it (Arabic, Urdu, Persian, Pashto, Malay or English)' : LANG_NAME[lang]}. Transcribe it exactly, letter for letter, in its own script.\n` +
  `- Keep every diacritic (harakat) that is printed; add none that are not.\n` +
  `- Join the lines of a paragraph into one paragraph; keep separate paragraphs separate.\n` +
  `- Mark headings as "h", Qur'an verses and poetry set apart as "quote", footnotes as "note", other text as "p".\n` +
  `- Leave out running headers at the very top and the page number; give the printed page number separately.\n` +
  `- For each paragraph give its box on the page as [ymin, xmin, ymax, xmax], scaled 0 to 1000.\n` +
  `- Do not translate, explain, correct or complete anything. If a word cannot be read, write […].\n` +
  `Answer with JSON only: {"printed": "page number as printed, or empty", "blocks": [{"t": "p", "text": "...", "box": [0,0,0,0]}]}`;

interface Answer {
  printed?: string;
  blocks?: Array<{ t?: string; text?: string; box?: number[] }>;
}

/** Reads one page with Gemini. Throws AllowanceUsedUp when the day's free allowance is gone. */
export async function recognizeWithAi(key: string, image: HTMLCanvasElement, lang: OcrLang | 'auto', page: number): Promise<{ blocks: Block[]; printed?: string; text: string }> {
  const data = await jpeg(image);
  let lastError = '';
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const gap = lastCall + spacing() - Date.now();
      if (gap > 0) await wait(gap);
      lastCall = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 90_000);
      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt(lang) }, { inline_data: { mime_type: 'image/jpeg', data } }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
          }),
        });
      } catch (e) {
        lastError = (e as Error).name === 'AbortError' ? 'Gemini took too long to answer.' : 'Gemini could not be reached.';
        await wait(3000 * (attempt + 1));
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 429) {
        const body = await res.text();
        // A per-minute limit passes; a per-day one does not until tomorrow.
        if (/PerDay|per day|daily/i.test(body)) break;
        const retry = Number(body.match(/"retryDelay":\s*"(\d+)s"/)?.[1] ?? 20);
        await wait(Math.min(60, retry + 1) * 1000);
        continue;
      }
      if (res.status === 404 || res.status === 400) {
        // This model is not offered to this key (or not any more): try the next one.
        lastError = `Gemini refused the request (${res.status}).`;
        if (res.status === 400 && /API key/i.test(await res.clone().text())) throw new Error('Your Gemini key was refused. Check it in Settings, Your AI.');
        break;
      }
      if (res.status === 401 || res.status === 403) throw new Error('Your Gemini key was refused. Check it in Settings, Your AI.');
      if (!res.ok) {
        lastError = `Gemini answered with an error (${res.status}).`;
        await wait(3000 * (attempt + 1));
        continue;
      }
      const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> };
      const raw = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      const answer = parse(raw);
      if (!answer) {
        lastError = 'Gemini’s answer could not be read.';
        continue;
      }
      return toBlocks(answer, page);
    }
  }
  if (!lastError) {
    // Every model's daily allowance is used: rest until the allowance renews (midnight in
    // California, when Google resets it), and let the phone carry on meanwhile.
    await setLocal(PAUSE_KEY, nextReset());
    throw new AllowanceUsedUp('The free Gemini allowance for today is used up.');
  }
  throw new Error(lastError);
}

function parse(raw: string): Answer | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try {
    const a = JSON.parse(text) as Answer;
    return a && Array.isArray(a.blocks) ? a : null;
  } catch {
    return null;
  }
}

const KIND: Record<string, Block['t']> = { h: 'h', quote: 'quote', p: 'p', note: 'p' };

function toBlocks(a: Answer, page: number): { blocks: Block[]; printed?: string; text: string } {
  const blocks: Block[] = [];
  for (const b of a.blocks ?? []) {
    const text = (b.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const t = KIND[b.t ?? 'p'] ?? 'p';
    const box =
      Array.isArray(b.box) && b.box.length === 4 && b.box.every((n) => typeof n === 'number' && n >= 0 && n <= 1000)
        ? ([b.box[1] / 1000, b.box[0] / 1000, b.box[3] / 1000, b.box[2] / 1000] as [number, number, number, number])
        : undefined;
    blocks.push({ t, text, page, ...(t === 'h' ? { level: 2 } : {}), ocr: true, conf: 95, ...(box && box[2] > box[0] && box[3] > box[1] ? { box } : {}) });
  }
  const printed = (a.printed ?? '').trim() || undefined;
  return { blocks, printed, text: blocks.map((b) => b.text).join('\n\n') };
}

/** Google renews the free allowance at midnight Pacific time. */
function nextReset(): number {
  const now = new Date();
  const pacific = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const ms = (24 - pacific.getHours()) * 3600_000 - pacific.getMinutes() * 60_000 - pacific.getSeconds() * 1000;
  return now.getTime() + Math.max(60_000, ms) + 5 * 60_000;
}
