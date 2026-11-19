/**
 * The free AI services Maktaba can use, and how to call each. Limits and models change
 * often, so every number here is a default that the server's settings can override.
 */

export type Feature = 'translate' | 'ocr' | 'ask' | 'explain' | 'irab';
export const FEATURES: Feature[] = ['translate', 'ocr', 'ask', 'explain', 'irab'];

export interface Provider {
  id: string;
  name: string;
  kind: 'openai' | 'gemini' | 'workers-ai';
  baseUrl?: string;
  /** Name of the secret holding the key (none for Workers AI, which uses the binding). */
  keyName?: string;
  models: Partial<Record<Feature, string>>;
  /**
   * Whether the service may use what is sent to it to train or improve its models.
   * Books marked private never go to a service where this is true or unknown.
   */
  trains: boolean | 'unknown';
  /** Requests per UTC day the free tier allows (a safety margin below the real limit). */
  dailyRequests: number;
  /** Requests per minute. */
  rpm: number;
  /** One line for the settings screen. */
  note: string;
}

export const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'gemini',
    keyName: 'GEMINI_API_KEY',
    models: { translate: 'gemini-2.5-flash', ocr: 'gemini-2.5-flash', ask: 'gemini-2.5-flash', explain: 'gemini-2.5-flash', irab: 'gemini-2.5-flash' },
    trains: true,
    // Each Gemini model has its own free allowance (2.5 Flash about 250 a day, Flash-Lite
    // about 1,000); when one runs out the next is used, so the total is generous.
    dailyRequests: 1100,
    rpm: 8,
    note: 'Strongest free option for classical Arabic. Google may use free-tier requests to improve its products, so private books are never sent here.',
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyName: 'GROQ_API_KEY',
    models: { translate: 'openai/gpt-oss-120b', ask: 'openai/gpt-oss-120b', explain: 'openai/gpt-oss-120b', irab: 'openai/gpt-oss-120b' },
    trains: false,
    dailyRequests: 900,
    rpm: 25,
    note: 'Fast, and does not keep or train on what it is sent. Used for private books.',
  },
  {
    id: 'workers-ai',
    name: 'Cloudflare Workers AI',
    kind: 'workers-ai',
    models: { translate: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', ask: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', explain: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' },
    trains: 'unknown',
    dailyRequests: 60,
    rpm: 20,
    note: 'Runs on the same free account as the server. A small daily allowance, kept as a last resort.',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter (free models)',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyName: 'OPENROUTER_API_KEY',
    models: { translate: 'deepseek/deepseek-chat-v3.1:free', ask: 'deepseek/deepseek-chat-v3.1:free', explain: 'deepseek/deepseek-chat-v3.1:free' },
    trains: true,
    dailyRequests: 50,
    rpm: 15,
    note: 'Extra free capacity. Free models may log requests, so private books are never sent here.',
  },
];

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface CallResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

/** Why a call failed, which decides what the router does next. */
export class ProviderError extends Error {
  constructor(
    message: string,
    /**
     * 'limit': too many requests (for a minute, or for the day); 'auth': bad key; 'model':
     * this model is not offered (any more); 'temporary': try another, then retry later.
     */
    readonly kind: 'limit' | 'auth' | 'temporary' | 'bad-answer' | 'model',
    /** When the service says to try again. */
    readonly retryAt?: number,
    /** The day's allowance (not just the minute's) is used up. */
    readonly daily = false,
  ) {
    super(message);
  }
}

export interface CallEnv {
  secrets: Record<string, string | undefined>;
  ai?: { run(model: string, input: unknown): Promise<unknown> };
  fetch: typeof fetch;
}

const TIMEOUT_MS = 90_000;

/**
 * What an error answer means. Services put the important part in the body: Gemini says
 * "retry in 37s" there for a per-minute limit, and which quota (per minute or per day) ran
 * out; it reports a wrong key as 400; OpenRouter says "no endpoints" for a retired model.
 */
export function classify(status: number, retryAfter: string | null, body = ''): ProviderError {
  const now = Date.now();
  const hinted = Number(body.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/)?.[1] ?? body.match(/retry (?:in|after) (\d+(?:\.\d+)?)\s*s/i)?.[1] ?? NaN);
  const header = retryAfter && Number(retryAfter) > 0 ? Number(retryAfter) : NaN;
  const wait = Number.isFinite(hinted) ? hinted : header;
  if (status === 429 || status === 402) {
    const daily = status === 402 || /PerDay|per[- ]day|daily|free-models-per-day|insufficient credits|quota exceeded for quota metric.*day/i.test(body);
    // The service may still say when it comes back (a short wait is honoured; otherwise tomorrow).
    if (daily) return new ProviderError('today’s allowance is used up', 'limit', Number.isFinite(wait) && wait < 3600 ? now + wait * 1000 : undefined, true);
    return new ProviderError('busy for a moment (too many requests)', 'limit', now + Math.min(120, Number.isFinite(wait) ? wait + 1 : 60) * 1000);
  }
  // Overloaded (503 is common with a newly released model): that model rests a moment,
  // and the next model of the same service is tried.
  if (status >= 500 && status !== 501) return new ProviderError('this model is overloaded right now', 'limit', now + Math.min(300, Number.isFinite(wait) ? wait + 1 : 120) * 1000);
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid|invalid[ _]api[ _]key|incorrect api key/i.test(body)) return new ProviderError('The key was refused', 'auth');
  if (status === 404 || (status === 400 && /model/i.test(body) && /not (found|exist|available|supported)|decommission|deprecat|no endpoints|invalid model|unknown model/i.test(body)))
    return new ProviderError('this model is no longer offered', 'model');
  // The service's own words, short, so a screenshot of the message says what went wrong.
  let said = '';
  try {
    const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    said = typeof j.error === 'string' ? j.error : j.error?.message ?? j.message ?? '';
  } catch {
    said = body.length < 200 ? body : '';
  }
  said = said.replace(/\s+/g, ' ').trim().slice(0, 120);
  return new ProviderError(`Service error ${status}${said ? ` (${said})` : ''}`, 'temporary', Number.isFinite(wait) ? now + wait * 1000 : undefined);
}

/**
 * How much a Gemini model thinks before answering. The newer "thinking" models think at
 * length by default, which on a long passage can take longer than a phone waits; a
 * translation needs little of it.
 */
export function thinkingFor(model: string): Record<string, unknown> | undefined {
  const v = Number(model.match(/^gemini-(\d+(?:\.\d+)?)/)?.[1] ?? NaN);
  if (!Number.isFinite(v)) return undefined;
  if (v >= 3) return { thinkingLevel: 'low' };
  if (v >= 2.5) return /pro/.test(model) ? { thinkingBudget: 128 } : { thinkingBudget: 0 };
  return undefined;
}

const errorOf = async (res: Response) => classify(res.status, res.headers.get('retry-after'), await res.text().catch(() => ''));

// ------------------------------------------------------------------------------- models

/**
 * Which models each service offers changes all the time (OpenRouter's free ones above
 * all). Rather than trust the names written here, Maktaba asks each service for its list
 * (a free request) and picks from it, in this order of preference, keeping the configured
 * model first while it is offered.
 */
const PREFER: Record<string, RegExp[]> = {
  gemini: [/^gemini-\d+(?:\.\d+)?-flash$/, /^gemini-flash-latest$/, /^gemini-\d+(?:\.\d+)?-flash-lite$/, /^gemini-flash-lite-latest$/, /^gemini-\d+(?:\.\d+)?-flash/],
  groq: [/^openai\/gpt-oss-120b$/, /^llama-3\.3-70b-versatile$/, /^moonshotai\/kimi-k2/, /^meta-llama\/llama-4-maverick/, /^qwen\/qwen3-32b$/, /^openai\/gpt-oss-20b$/, /70b|120b|235b/],
  openrouter: [
    /^deepseek\/deepseek-(chat|v\d)[^/]*:free$/,
    /^qwen\/qwen3[^/]*-(?:235b|480b)[^/]*:free$/,
    /^openai\/gpt-oss-120b:free$/,
    /^nvidia\/nemotron-[\d.]+-ultra[^/]*:free$/,
    /^meta-llama\/llama-4-maverick:free$/,
    /^moonshotai\/kimi[^/]*:free$/,
    /^google\/gemini[^/]*:free$/,
    /^google\/gemma-\d+-(?:2[6-9]|[3-9]\d)b[^/]*:free$/,
    /^z-ai\/glm[^/]*:free$/,
    /^nvidia\/nemotron-[\d.]+-super[^/]*:free$/,
    /^mistralai\/mistral-(?:large|medium|small)[^/]*:free$/,
    /^deepseek\/deepseek-r1[^/]*:free$/,
    // Anything else free, except previews and models made for code or notes.
    /^(?!.*(?:preview|code|coder|note|omni|reasoning-only)).*:free$/,
    /:free$/,
  ],
};
// Models for pictures, speech or safety checks, and small models (14B or less), which translate classical texts poorly.
const NOT_FOR_TEXT = /image|tts|audio|live|embed|guard|whisper|robotics|computer-use|vision-only|nano|lightning|mini-code|gemma-3n|[-_.](?:[1-9]|1[0-4])(?:\.\d+)?b(?![a-z0-9])/i;

const versionOf = (id: string) => (id.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
function newestFirst(a: string, b: string): number {
  const x = versionOf(a);
  const y = versionOf(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  return a.length - b.length;
}

const listed = new Map<string, { at: number; ids: string[] | null }>();
const LIST_FOR = 6 * 3600_000;

/** The models a service offers this key now (free ones only on OpenRouter), or null if it cannot say. */
export async function listModels(p: Provider, env: CallEnv): Promise<string[] | null> {
  if (p.kind === 'workers-ai' || !PREFER[p.id]) return null;
  const hit = listed.get(p.id);
  if (hit && Date.now() - hit.at < LIST_FOR) return hit.ids;
  let ids: string[] | null = null;
  try {
    const key = p.keyName ? env.secrets[p.keyName] : undefined;
    if (p.kind === 'gemini') {
      const res = await env.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key ?? '' }, signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const d = (await res.json()) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
        ids = (d.models ?? []).filter((m) => m.name && m.supportedGenerationMethods?.includes('generateContent')).map((m) => m.name!.replace(/^models\//, ''));
      }
    } else {
      const res = await env.fetch(`${p.baseUrl}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const d = (await res.json()) as { data?: Array<{ id?: string; pricing?: { prompt?: string; completion?: string } }> };
        ids = (d.data ?? [])
          .filter((m) => !!m.id && (p.id !== 'openrouter' || m.id.endsWith(':free') || (m.pricing?.prompt === '0' && m.pricing?.completion === '0')))
          .map((m) => m.id!);
      }
    }
  } catch {
    ids = null;
  }
  if (ids && !ids.length) ids = null;
  listed.set(p.id, { at: Date.now(), ids });
  return ids;
}

/** Forgets a service's model list, so the next request asks again. */
export const forgetModels = (providerId: string) => void listed.delete(providerId);

/** The models to try for a feature, best first: the configured one while offered, then the service's own. */
export async function modelsFor(p: Provider, feature: Feature, env: CallEnv): Promise<string[]> {
  const configured = p.models[feature];
  if (!configured) return [];
  const ids = await listModels(p, env);
  const out: string[] = [];
  if (!ids || ids.includes(configured)) out.push(configured);
  if (ids) {
    for (const re of PREFER[p.id] ?? []) {
      for (const id of ids.filter((i) => re.test(i) && !NOT_FOR_TEXT.test(i)).sort(newestFirst)) if (!out.includes(id)) out.push(id);
    }
  }
  if (!out.length) out.push(configured);
  return out.slice(0, 4);
}

export async function callProvider(p: Provider, model: string, messages: ChatMessage[], env: CallEnv, json = true): Promise<CallResult> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    if (p.kind === 'workers-ai') {
      if (!env.ai) throw new ProviderError('Workers AI is not connected', 'auth');
      const out = (await env.ai.run(model, { messages, max_tokens: 4096, temperature: 0.2 })) as { response?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      return { text: out.response ?? '', tokensIn: out.usage?.prompt_tokens ?? 0, tokensOut: out.usage?.completion_tokens ?? 0 };
    }
    const key = p.keyName ? env.secrets[p.keyName] : undefined;
    if (!key) throw new ProviderError('No key set', 'auth');

    if (p.kind === 'gemini') {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const user = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');
      const thinking = thinkingFor(model);
      const askGemini = (think: boolean) =>
        env.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: { temperature: 0.2, ...(json ? { responseMimeType: 'application/json' } : {}), ...(think && thinking ? { thinkingConfig: thinking } : {}) },
          }),
          signal,
        });
      let res = await askGemini(true);
      if (!res.ok && res.status === 400 && thinking) {
        // A model that does not take this thinking setting: ask again with its own.
        const body = await res.clone().text().catch(() => '');
        if (/think/i.test(body)) res = await askGemini(false);
      }
      if (!res.ok) throw await errorOf(res);
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const c = data.candidates?.[0];
      if (!c || c.finishReason === 'SAFETY' || c.finishReason === 'RECITATION') throw new ProviderError(`No answer (${c?.finishReason ?? 'empty'})`, 'bad-answer');
      return {
        text: (c.content?.parts ?? []).map((x) => x.text ?? '').join(''),
        tokensIn: data.usageMetadata?.promptTokenCount ?? 0,
        tokensOut: data.usageMetadata?.candidatesTokenCount ?? 0,
      };
    }

    const ask = (asJson: boolean) =>
      env.fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, temperature: 0.2, ...(asJson ? { response_format: { type: 'json_object' } } : {}) }),
        signal,
      });
    let res = await ask(json);
    if (!res.ok && res.status === 400 && json) {
      // Some models do not take "JSON mode", and Groq refuses an answer its JSON check fails
      // (json_validate_failed). The instructions already ask for JSON, so ask again without it.
      const body = await res.clone().text().catch(() => '');
      if (!/API key|api_key|model_not_found|does not exist|decommission/i.test(body)) res = await ask(false);
    }
    if (!res.ok) throw await errorOf(res);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return { text: data.choices?.[0]?.message?.content ?? '', tokensIn: data.usage?.prompt_tokens ?? 0, tokensOut: data.usage?.completion_tokens ?? 0 };
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    const name = (e as Error)?.name;
    throw new ProviderError(name === 'TimeoutError' ? 'The service took too long' : 'The service could not be reached', 'temporary');
  }
}
