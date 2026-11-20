import type { Block, OcrLang, Uncertain } from '../db/types';
import { checkAnswer, translationRules, type SourceLang } from '../../server/src/translate';
import { SEED_GLOSSARY } from '../../server/src/glossary';
import { looksEnglish } from '../lib/english';
import { getMyAi } from '../ai/device';
import { local, setLocal } from '../sync/sync';
import { DEFAULT_PROVIDERS, modelsFor, thinkingFor } from '../../server/src/providers';

/**
 * Reading scanned pages with the reader's own AI: Gemini first, then OpenRouter's free
 * models that can see images (Gemma, Nemotron VL…). Both read Urdu Nastaliq, old Arabic
 * prints and Persian far better than the engine on the phone, and keep headings,
 * paragraphs and verse apart. Used for books not marked private (free tiers may learn
 * from what they are sent).
 *
 * Requests are paced to the free tiers. When a service's day is used up, the other carries
 * on; when both are, reading rests until the allowance renews.
 */

/** Gemini models to read pages with, best first: asked of Google itself, so a retired model is never stuck to. */
async function models(key: string): Promise<string[]> {
  const gemini = DEFAULT_PROVIDERS.find((p) => p.id === 'gemini')!;
  const list = await modelsFor(gemini, 'ocr', { secrets: { GEMINI_API_KEY: key }, fetch: (...a: Parameters<typeof fetch>) => fetch(...a) }).catch(() => ['gemini-2.5-flash']);
  return [...new Set([...list, 'gemini-2.5-flash-lite'])];
}
/** The free tier allows about ten requests a minute on the first model. (Tests shorten it.) */
const spacing = () => (globalThis as { __maktabaAiSpacing?: number }).__maktabaAiSpacing ?? 6500;
const PAUSE_KEY = 'aiOcrPausedUntil';
const OR_PAUSE_KEY = 'aiOcrOpenRouterPausedUntil';

/** The services that can read a book's pages now. */
export interface PageReader {
  gemini?: string;
  openrouter?: string;
}

const LANG_NAME: Record<OcrLang, string> = {
  ara: 'Arabic',
  urd: 'Urdu (often in Nastaliq script)',
  fas: 'Persian',
  pus: 'Pashto',
  msa: 'Malay (in Jawi or Latin letters)',
  eng: 'English',
};

/** When each model was last asked: the free tier's per-minute limit is per model. */
const lastCall = new Map<string, number>();
/** Models that cannot answer for now (retired, used up today, overloaded), until when, and whether for the day. */
const resting = new Map<string, { until: number; daily: boolean }>();
const rest = (model: string, until: number, daily = false) => void resting.set(model, { until, daily });
// A key added or changed: every model is tried afresh.
if (typeof window !== 'undefined') window.addEventListener('maktaba:connected', () => resting.clear());
const tomorrow = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Who can read this book's pages now, or null (private book, no AI, or every allowance used for today). */
export async function aiReaderFor(book: { private?: boolean }): Promise<PageReader | null> {
  if (book.private) return null;
  const a = await getMyAi();
  const now = Date.now();
  const r: PageReader = {};
  // A pause for the day set in error (every model only overloaded, in an earlier version) is cleared once.
  if (!(await local('aiOcrPauseFixed1'))) {
    await setLocal(PAUSE_KEY, 0);
    await setLocal(OR_PAUSE_KEY, 0);
    await setLocal('aiOcrPauseFixed1', true);
  }
  const restsUntil = async (k: string) => ((await local(k)) as number | undefined) ?? 0;
  if (a.gemini && (await restsUntil(PAUSE_KEY)) <= now) r.gemini = a.gemini;
  if (a.openrouter && (await restsUntil(OR_PAUSE_KEY)) <= now) r.openrouter = a.openrouter;
  return r.gemini || r.openrouter ? r : null;
}

/** A service that answered just now (Test my AI) can read pages again at once. */
export async function clearPagePause(service: 'gemini' | 'openrouter'): Promise<void> {
  await setLocal(service === 'gemini' ? PAUSE_KEY : OR_PAUSE_KEY, 0);
}

/** When reading with AI comes back, if every connected service has used its day. */
export async function aiReaderPausedUntil(): Promise<number | null> {
  const a = await getMyAi();
  const now = Date.now();
  const until = [a.gemini ? ((await local(PAUSE_KEY)) as number | undefined) ?? 0 : null, a.openrouter ? ((await local(OR_PAUSE_KEY)) as number | undefined) ?? 0 : null].filter((x): x is number => x !== null);
  if (!until.length || until.some((u) => u <= now)) return null;
  return Math.min(...until);
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

const SOURCE: Partial<Record<OcrLang, SourceLang>> = { ara: 'ar', urd: 'ur', fas: 'fa', pus: 'ps', msa: 'ms' };

const readOnly = (lang: OcrLang | 'auto') =>
  `This is one page of a printed book in ${lang === 'auto' ? 'the language printed on it (Arabic, Urdu, Persian, Pashto, Malay or English)' : LANG_NAME[lang]}. Transcribe it exactly, letter for letter, in its own script.\n` +
  `- Keep every diacritic (harakat) that is printed; add none that are not.\n` +
  `- Join the lines of a paragraph into one paragraph; keep separate paragraphs separate.\n` +
  `- Mark headings as "h", Qur'an verses and poetry set apart as "quote", footnotes as "note", other text as "p".\n` +
  `- Leave out running headers at the very top and the page number; give the printed page number separately.\n` +
  `- Leave out watermarks and stamps: faint or slanted text behind or across the page, a library or website name, a phone number, a seal. Transcribe only the book's own text.\n` +
  `- For each paragraph give its box on the page as [ymin, xmin, ymax, xmax], scaled 0 to 1000.\n` +
  `- Do not translate, explain, correct or complete anything. If a word cannot be read, write […].\n` +
  `Answer with JSON only: {"printed": "page number as printed, or empty", "blocks": [{"t": "p", "text": "...", "box": [0,0,0,0]}]}`;

/** The glossary for a page translated as it is read (the page's words are not known before it is read). */
const GLOSSARY_LINES = SEED_GLOSSARY.map((t) => `- ${[t.ar, ...(t.forms ?? []).slice(0, 2)].join(' / ')} → ${t.tr} (${t.en})${t.plain ? `; only in this technical sense. As an ordinary word (${t.plain}) it is put in plain English, with no transliteration in brackets` : ''}`).join('\n');

/** Reading and translating in one go: the page's own text, and the English of each block. */
const prompt = (lang: OcrLang | 'auto', translate: boolean) => {
  const src = lang === 'auto' ? undefined : SOURCE[lang];
  if (!translate || !src) return readOnly(lang);
  return (
    readOnly(lang).replace(/Answer with JSON only:[\s\S]*$/, '') +
    `\nThen translate every block into English, for the reader. The translation follows these rules:\n\n${translationRules(src)}\n\n` +
    `Glossary (rule 3): when one of these terms appears in its technical sense, in any of its spellings, write it this way (an ordinary word with the same letters is translated plainly):\n${GLOSSARY_LINES}\n\n` +
    `The "text" stays exactly as printed (not translated); the English goes in "en", one for each block. A heading's English is a heading.\n` +
    `"en" is a real English translation of the meaning, in English words: never a transliteration of the ${lang === 'auto' ? 'original' : 'original'} in Latin letters, and never the original copied back.\n` +
    `Answer with JSON only: {"printed": "page number as printed, or empty", "blocks": [{"t": "p", "text": "... as printed ...", "en": "... English ...", "uncertain": [{"span": "...", "reason": "..."}], "box": [0,0,0,0]}]}`
  );
};



interface Answer {
  printed?: string;
  blocks?: Array<{ t?: string; text?: string; en?: string; uncertain?: unknown; box?: number[] }>;
}

export interface PageText {
  blocks: Block[];
  printed?: string;
  text: string;
  /** The English of each block, when the page was read and translated in one go. */
  en?: Array<{ en: string; uncertain: Uncertain[] } | null>;
  /** Who read it. */
  service?: string;
  model?: string;
}

/**
 * Reads one page with the reader's AI: Gemini, then OpenRouter. Throws AllowanceUsedUp only
 * when every service it could use has used its day.
 */
export async function recognizeWithAi(reader: PageReader, image: HTMLCanvasElement, lang: OcrLang | 'auto', page: number, opts: { translate?: boolean; eager?: boolean } = {}): Promise<PageText> {
  const translate = !!opts.translate;
  const eager = !!opts.eager;
  const data = await jpeg(image);
  const problems: string[] = [];
  let tried = 0;
  let usedUp = 0;
  // Gemini reads and translates in one go; OpenRouter's free image models only read (they
  // are slow and weak at translating), and the English then comes from a text model. If the
  // one-step reading fails or takes too long, the page is read on its own and translated after.
  const attempts: Array<[string, () => Promise<PageText>]> = [];
  if (reader.gemini) attempts.push(['gemini', () => viaGemini(reader.gemini!, data, lang, page, translate, eager)]);
  if (reader.openrouter) attempts.push(['openrouter', () => viaOpenRouter(reader.openrouter!, data, lang, page, false)]);
  if (reader.gemini && translate) attempts.push(['gemini', () => viaGemini(reader.gemini!, data, lang, page, false, eager)]);
  const exhausted = new Set<string>();
  for (const [service, read] of attempts) {
    if (exhausted.has(service)) continue;
    tried++;
    try {
      return await read();
    } catch (e) {
      if (e instanceof AllowanceUsedUp) {
        usedUp++;
        exhausted.add(service);
      }
      problems.push((e as Error).message);
    }
  }
  tried = new Set(attempts.map(([s]) => s)).size;
  usedUp = exhausted.size;
  if (tried && usedUp === tried) throw new AllowanceUsedUp(problems.join(' '));
  throw new Error(problems.join(' ') || 'No AI service could read the page.');
}

/**
 * `eager`: the reader asked for this page just now (a tap), so a model resting after being
 * overloaded a moment ago is asked anyway; only models out for the day are passed over.
 */
async function viaGemini(key: string, data: string, lang: OcrLang | 'auto', page: number, translate: boolean, eager = false): Promise<PageText> {
  let lastError = '';
  const noThink = new Set<string>();
  const list = await models(key);
  /** Models out for the day (used up, or closed to this key): when all are, reading waits for tomorrow. */
  let outForDay = 0;
  for (const model of list) {
    const r = resting.get(model);
    if (r && r.until > Date.now() && (r.daily || !eager)) {
      if (r.daily) outForDay++;
      else lastError ||= 'Gemini is overloaded right now; it is tried again in a few minutes.';
      continue;
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const gap = (lastCall.get(model) ?? 0) + spacing() - Date.now();
      if (gap > 0) await wait(gap);
      lastCall.set(model, Date.now());
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60_000);
      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt(lang, translate) }, { inline_data: { mime_type: 'image/jpeg', data } }] }],
            generationConfig: { temperature: 0, responseMimeType: 'application/json', ...(thinkingFor(model) && !noThink.has(model) ? { thinkingConfig: thinkingFor(model) } : {}) },
          }),
        });
      } catch (e) {
        const slow = (e as Error).name === 'AbortError';
        lastError = slow ? 'Gemini took too long to answer.' : 'Gemini could not be reached.';
        // Too slow: the next model, rather than the same wait again. Dropped: once more, then the next.
        if (slow || attempt >= 1) break;
        await wait(3000);
        continue;
      } finally {
        clearTimeout(timer);
      }
      if (res.status === 429) {
        const body = await res.text();
        // A per-minute limit passes; a per-day one does not until tomorrow.
        if (/PerDay|per day|daily/i.test(body)) {
          rest(model, tomorrow(), true);
          outForDay++;
          break;
        }
        const retry = Number(body.match(/"retryDelay":\s*"(\d+)s"/)?.[1] ?? 20);
        await wait(Math.min(60, retry + 1) * 1000);
        continue;
      }
      if (res.status === 404 || res.status === 400) {
        // This model is not offered to this key (or not any more): try the next one.
        lastError = `Gemini refused the request (${res.status}).`;
        const said = res.status === 400 ? await res.clone().text() : '';
        if (/think/i.test(said) && !noThink.has(model)) {
          noThink.add(model);
          continue;
        }
        if (res.status === 400 && /API key/i.test(said)) throw new Error('Your Gemini key was refused. Check it in Settings, Your AI.');
        if (res.status === 404) {
          rest(model, Date.now() + 24 * 3600_000, true);
          outForDay++;
        }
        break;
      }
      if (res.status === 401 || res.status === 403) throw new Error('Your Gemini key was refused. Check it in Settings, Your AI.');
      if (res.status >= 500) {
        // This model is overloaded: try the next one rather than wait on it.
        lastError = `Gemini’s ${model} is overloaded right now.`;
        if (attempt >= 1) {
          // Overloaded: the model rests a little. Out of time (504) only says this request was heavy.
          if (res.status !== 504) rest(model, Date.now() + 2 * 60_000);
          break;
        }
        await wait(2000);
        continue;
      }
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
      // It answered: whatever rest it was given after being busy is over.
      if (!resting.get(model)?.daily) resting.delete(model);
      return { ...toBlocks(answer, page), service: 'gemini', model };
    }
  }
  if (outForDay >= list.length) {
    // Every model's daily allowance is used: rest until the allowance renews (midnight in
    // California, when Google resets it), and let the phone carry on meanwhile.
    await setLocal(PAUSE_KEY, nextReset());
    throw new AllowanceUsedUp('The free Gemini allowance for today is used up.');
  }
  // Busy or failing, not used up: no pause for the day; the page is tried again soon.
  throw new Error(lastError || 'Gemini is busy right now; the page is tried again in a few minutes.');
}

// ------------------------------------------------------------------------------- OpenRouter

/** OpenRouter's free models that can read an image, best first (asked of OpenRouter itself). */
const OR_PREFER = [
  /^google\/gemma-\d+-31b/,
  /^nvidia\/nemotron-[\d.]+-super-vl/,
  /^google\/gemma-\d+-(?:2[6-9]|[3-9]\d)b/,
  /^qwen\/qwen[\d.]*-vl/,
  /^meta-llama\/llama-4-(?:maverick|scout)/,
  /^google\/gemini/,
  /^mistralai\/(?:pixtral|mistral-(?:small|medium))/,
];
let orModels: { at: number; ids: string[] } | null = null;
async function visionModels(): Promise<string[]> {
  if (orModels && Date.now() - orModels.at < 6 * 3600_000) return orModels.ids;
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error('OpenRouter could not be reached.');
  const d = (await res.json()) as { data?: Array<{ id: string; architecture?: { input_modalities?: string[] }; pricing?: { prompt?: string } }> };
  const free = (d.data ?? []).filter(
    (m) => (m.id.endsWith(':free') || m.pricing?.prompt === '0') && m.architecture?.input_modalities?.includes('image') && !/preview|nano|mini|small|[-_.](?:[1-9]|1[0-4])(?:\.\d+)?b(?![a-z0-9])/i.test(m.id),
  );
  const ids: string[] = [];
  for (const re of OR_PREFER) for (const m of free) if (re.test(m.id) && !ids.includes(m.id)) ids.push(m.id);
  orModels = { at: Date.now(), ids: ids.slice(0, 3) };
  return orModels.ids;
}

let orLastCall = 0;
async function viaOpenRouter(key: string, data: string, lang: OcrLang | 'auto', page: number, translate: boolean): Promise<PageText> {
  const models = await visionModels();
  if (!models.length) throw new Error('OpenRouter has no free model that can read images right now.');
  let lastError = '';
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const gap = orLastCall + Math.max(spacing(), 3500) - Date.now();
      if (gap > 0) await wait(gap);
      orLastCall = Date.now();
      const ask = (json: boolean) =>
        fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          signal: AbortSignal.timeout(90_000),
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model,
            temperature: 0,
            ...(json ? { response_format: { type: 'json_object' } } : {}),
            messages: [{ role: 'user', content: [{ type: 'text', text: prompt(lang, translate) }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${data}` } }] }],
          }),
        });
      let res: Response;
      try {
        res = await ask(true);
        if (res.status === 400 && /response_format|json/i.test(await res.clone().text())) res = await ask(false);
      } catch {
        lastError = 'OpenRouter took too long to answer, or could not be reached.';
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new Error('Your OpenRouter key was refused. Sign in again in Settings, Your AI.');
      if (res.status === 429 || res.status === 402) {
        const body = await res.text();
        if (res.status === 402 || /per-day|per day|daily/i.test(body)) {
          await setLocal(OR_PAUSE_KEY, nextUtcMidnight());
          throw new AllowanceUsedUp('The free OpenRouter allowance for today is used up.');
        }
        lastError = `OpenRouter’s ${model} is busy.`;
        await wait(8000);
        continue;
      }
      if (!res.ok) {
        // Retired, refused, or overloaded: the next model.
        lastError = `OpenRouter’s ${model} answered with an error (${res.status}).`;
        break;
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const answer = parse(json.choices?.[0]?.message?.content ?? '');
      if (!answer) {
        lastError = 'OpenRouter’s answer could not be read.';
        break;
      }
      // Only Gemini's page positions are dependable; others are left out.
      return { ...toBlocks({ ...answer, blocks: answer.blocks?.map((b) => ({ ...b, box: undefined })) }, page), service: 'openrouter', model };
    }
  }
  throw new Error(lastError || 'OpenRouter could not read the page.');
}

function nextUtcMidnight(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) + 5 * 60_000;
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

function toBlocks(a: Answer, page: number): PageText {
  const blocks: Block[] = [];
  const en: PageText['en'] = [];
  for (const b of a.blocks ?? []) {
    const text = (b.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const t = KIND[b.t ?? 'p'] ?? 'p';
    const box =
      Array.isArray(b.box) && b.box.length === 4 && b.box.every((n) => typeof n === 'number' && n >= 0 && n <= 1000)
        ? ([b.box[1] / 1000, b.box[0] / 1000, b.box[3] / 1000, b.box[2] / 1000] as [number, number, number, number])
        : undefined;
    blocks.push({ t, text, page, ...(t === 'h' ? { level: 2 } : {}), ocr: true, conf: 95, ...(box && box[2] > box[0] && box[3] > box[1] ? { box } : {}) });
    const english = typeof b.en === 'string' ? b.en.trim() : '';
    const uncertain = Array.isArray(b.uncertain)
      ? (b.uncertain as Array<{ span?: unknown; reason?: unknown }>).filter((u) => typeof u?.span === 'string' && typeof u?.reason === 'string').map((u) => ({ span: String(u.span), reason: String(u.reason) }))
      : [];
    // English that is really the original copied back is no translation.
    // A transliteration, or the original copied back, is no translation: that block is translated again as text.
    en.push(english && english !== text && looksEnglish(english) ? { en: english, uncertain } : null);
  }
  // The English given with the page goes through the same checks as any translation: one with
  // parts missing, padded out, or with untranslated text left in is put into English again as
  // text (with the glossary and the checks); a doubt is kept with it, marked †.
  const given = en.map((e, i) => (e ? { id: String(i), en: e.en, uncertain: e.uncertain } : null)).filter((x): x is NonNullable<typeof x> => !!x);
  if (given.length) {
    const problems = checkAnswer(
      given.map((g) => ({ id: g.id, text: blocks[Number(g.id)].text, kind: blocks[Number(g.id)].t === 'h' ? ('h' as const) : blocks[Number(g.id)].t === 'quote' ? ('quote' as const) : ('p' as const) })),
      given,
    );
    for (const pr of problems) {
      const i = Number(pr.id);
      const e = en[i];
      if (!e) continue;
      if (!pr.soft) en[i] = null;
      else en[i] = { en: /†\s*$/.test(e.en) ? e.en : `${e.en} †`, uncertain: [...e.uncertain, { span: '', reason: pr.problem }] };
    }
  }
  const printed = (a.printed ?? '').trim() || undefined;
  return { blocks, printed, text: blocks.map((b) => b.text).join('\n\n'), ...(en.some(Boolean) ? { en } : {}) };
}

/** Google renews the free allowance at midnight Pacific time. */
function nextReset(): number {
  const now = new Date();
  const pacific = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const ms = (24 - pacific.getHours()) * 3600_000 - pacific.getMinutes() * 60_000 - pacific.getSeconds() * 1000;
  return now.getTime() + Math.max(60_000, ms) + 5 * 60_000;
}
