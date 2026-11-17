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
    dailyRequests: 200,
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
    dailyRequests: 45,
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
    /** 'limit': out of allowance; 'auth': bad key; 'temporary': try another, then retry later. */
    readonly kind: 'limit' | 'auth' | 'temporary' | 'bad-answer',
    /** When the service says to try again. */
    readonly retryAt?: number,
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

function classify(status: number, retryAfter: string | null): ProviderError {
  const at = retryAfter ? Date.now() + (Number(retryAfter) > 0 ? Number(retryAfter) * 1000 : 60_000) : undefined;
  if (status === 429) return new ProviderError('Allowance used up', 'limit', at);
  if (status === 401 || status === 403) return new ProviderError('The key was refused', 'auth');
  return new ProviderError(`Service error ${status}`, 'temporary', at);
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
      const res = await env.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.2, ...(json ? { responseMimeType: 'application/json' } : {}) },
        }),
        signal,
      });
      if (!res.ok) throw classify(res.status, res.headers.get('retry-after'));
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

    const res = await env.fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0.2, ...(json ? { response_format: { type: 'json_object' } } : {}) }),
      signal,
    });
    if (!res.ok) throw classify(res.status, res.headers.get('retry-after'));
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return { text: data.choices?.[0]?.message?.content ?? '', tokensIn: data.usage?.prompt_tokens ?? 0, tokensOut: data.usage?.completion_tokens ?? 0 };
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    const name = (e as Error)?.name;
    throw new ProviderError(name === 'TimeoutError' ? 'The service took too long' : 'The service could not be reached', 'temporary');
  }
}
