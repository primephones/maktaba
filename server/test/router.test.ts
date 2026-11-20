import { describe, expect, it } from 'vitest';
import { classify, DEFAULT_PROVIDERS, forgetModels, lightThird, modelsFor, thinkingFor, type CallResult, type Feature } from '../src/providers';
import { NoProviderError, route, type UsageStore } from '../src/router';

function memoryUsage(): UsageStore & { calls: string[] } {
  const used: Record<string, number> = {};
  const blocked: Record<string, { until: number; reason: string }> = {};
  const calls: string[] = [];
  return {
    calls,
    usedToday: async () => used,
    record: async (p: string, _f: Feature, _r: CallResult) => {
      used[p] = (used[p] ?? 0) + 1;
      calls.push(p);
    },
    blockedUntil: async () => blocked,
    block: async (p, until, reason) => {
      blocked[p] = { until, reason };
    },
  };
}

const ok = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }), { status: 200 });
const gem = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }), { status: 200 });

describe('routing', () => {
  const messages = [{ role: 'user' as const, content: 'hi' }];

  it('never sends a private book to a service that trains on it', async () => {
    const usage = memoryUsage();
    const seen: string[] = [];
    const env = {
      secrets: { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' },
      fetch: (async (url: string) => {
        seen.push(String(url));
        return String(url).includes('groq') ? ok('{"a":1}') : gem('{"a":1}');
      }) as unknown as typeof fetch,
    };
    const r = await route(DEFAULT_PROVIDERS, env, usage, { feature: 'translate', private: true, prefer: ['gemini', 'groq'] }, messages, (t) => JSON.parse(t));
    expect(r.provider).toBe('groq');
    expect(seen.every((u) => !u.includes('googleapis'))).toBe(true);
  });

  it('falls back when a service is busy, and pauses it for a minute, not the day', async () => {
    const usage = memoryUsage();
    const env = {
      secrets: { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' },
      fetch: (async (url: string) =>
        String(url).includes('googleapis')
          ? new Response(JSON.stringify({ error: { code: 429, details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' }] } }), { status: 429 })
          : ok('{"a":1}')) as unknown as typeof fetch,
    };
    const r = await route(DEFAULT_PROVIDERS, env, usage, { feature: 'translate', private: false, prefer: ['gemini', 'groq'] }, messages, (t) => JSON.parse(t));
    expect(r.provider).toBe('groq');
    expect(r.skipped[0]).toMatchObject({ provider: 'gemini' });
    const b = (await usage.blockedUntil())['gemini|gemini-2.5-flash'];
    expect(b.reason).toMatch(/busy/);
    expect(b.until - Date.now()).toBeLessThan(60_000);
    expect((await usage.blockedUntil()).gemini).toBeUndefined();
  });

  it('uses another model of the same service when one model’s day is used up', async () => {
    forgetModels('gemini');
    const usage = memoryUsage();
    const asked: string[] = [];
    const env = {
      secrets: { GEMINI_API_KEY: 'g' },
      fetch: (async (url: string) => {
        const u = String(url);
        if (u.includes('/models?')) return new Response(JSON.stringify({ models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-image', 'text-embedding-004'].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: n.includes('embed') ? ['embedContent'] : ['generateContent'] })) }));
        asked.push(u.match(/models\/([^:]+)/)![1]);
        if (u.includes('gemini-2.5-flash:')) return new Response(JSON.stringify({ error: { message: 'Quota exceeded for metric: generate_content_free_tier_requests, quotaId: GenerateRequestsPerDayPerProjectPerModel-FreeTier' } }), { status: 429 });
        return gem('{"a":1}');
      }) as unknown as typeof fetch,
    };
    const r = await route(DEFAULT_PROVIDERS, env, usage, { feature: 'translate', private: false }, messages, (t) => JSON.parse(t));
    expect(r.provider).toBe('gemini');
    expect(r.model).toBe('gemini-2.5-flash-lite');
    expect(asked).toEqual(['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
    const b = (await usage.blockedUntil())['gemini|gemini-2.5-flash'];
    expect(b.until).toBeGreaterThan(Date.now() + 60_000);
    forgetModels('gemini');
  });

  it('finds a model the service still offers when the configured one is retired', async () => {
    forgetModels('openrouter');
    const usage = memoryUsage();
    const asked: string[] = [];
    const env = {
      secrets: { OPENROUTER_API_KEY: 'o' },
      fetch: (async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'some/paid-model' }, { id: 'meta-llama/llama-3.2-3b-instruct:free' }, { id: 'qwen/qwen3-235b-a22b:free' }, { id: 'deepseek/deepseek-v3.2:free' }] }));
        const model = JSON.parse(String(init?.body)).model as string;
        asked.push(model);
        return ok('{"a":1}');
      }) as unknown as typeof fetch,
    };
    const r = await route(DEFAULT_PROVIDERS, env, usage, { feature: 'translate', private: false }, messages, (t) => JSON.parse(t));
    expect(r.model).toBe('deepseek/deepseek-v3.2:free');
    expect(asked).not.toContain('deepseek/deepseek-chat-v3.1:free');
    forgetModels('openrouter');
  });

  it('moves to the next model of the same service when one is overloaded (503)', async () => {
    forgetModels('gemini');
    const usage = memoryUsage();
    const env = {
      secrets: { GEMINI_API_KEY: 'g' },
      fetch: (async (url: string) => {
        const u = String(url);
        if (u.includes('/models?')) return new Response(JSON.stringify({ models: ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-lite-latest'].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })) }));
        if (u.includes('gemini-3.8-flash:')) return new Response('{"error":{"code":503,"message":"The model is overloaded. Please try again later.","status":"UNAVAILABLE"}}', { status: 503 });
        return gem('{"a":1}');
      }) as unknown as typeof fetch,
    };
    const r = await route(DEFAULT_PROVIDERS, env, usage, { feature: 'translate', private: false }, messages, (t) => JSON.parse(t));
    expect(r.provider).toBe('gemini');
    expect(r.model).toBe('gemini-3.5-flash');
    expect((await usage.blockedUntil()).gemini).toBeUndefined();
    forgetModels('gemini');
  });

  it('moves to the next Gemini model when one drops the connection, without shutting out the service', async () => {
    forgetModels('gemini');
    const usage = memoryUsage();
    const bodies: string[] = [];
    const env = {
      secrets: { GEMINI_API_KEY: 'g' },
      fetch: (async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/models?')) return new Response(JSON.stringify({ models: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })) }));
        bodies.push(String(init?.body));
        if (u.includes('gemini-3.6-flash:')) throw new TypeError('Failed to fetch');
        return gem('{"a":1}');
      }) as unknown as typeof fetch,
    };
    const r = await route(DEFAULT_PROVIDERS, env, usage, { feature: 'translate', private: false }, messages, (t) => JSON.parse(t));
    expect(r.model).toBe('gemini-3.5-flash-lite');
    expect((await usage.blockedUntil()).gemini).toBeUndefined();
    expect(Object.keys(await usage.blockedUntil())).toEqual(['gemini|gemini-3.6-flash']);
    // Thinking kept short, so a long passage is not cut off by the wait.
    expect(bodies[0]).toContain('"thinkingLevel":"low"');
    forgetModels('gemini');
  });

  it('with the real list of a new Gemini key (November 2026), Gemini 4 comes first, and a light model third when the reader waits', async () => {
    forgetModels('gemini');
    const names = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-preview-tts', 'gemma-4-31b-it', 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.1-flash-image', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-3.8-flash-tts', 'gemini-3.5-transcribe', 'gemini-4-hydrogen', 'gemini-4-argon', 'gemini-3.1-pro-preview'];
    const p = DEFAULT_PROVIDERS.find((x) => x.id === 'gemini')!;
    const r = await modelsFor(p, 'translate', { secrets: { GEMINI_API_KEY: 'g' }, fetch: (async () => new Response(JSON.stringify({ models: names.map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })) }))) as unknown as typeof fetch });
    expect(r.slice(0, 3)).toEqual(['gemini-2.5-flash', 'gemini-4-argon', 'gemini-4-hydrogen']);
    expect(r.indexOf('gemini-4-hydrogen')).toBeLessThan(r.indexOf('gemini-3.8-flash'));
    expect(r).not.toContain('gemini-3.1-pro-preview');
    // With the dead ones resting, and the reader waiting: the light model is third.
    expect(lightThird(['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'])[2]).toBe('gemini-3.5-flash-lite');
    forgetModels('gemini');
  });

  it('reads "limit: 0" as a model a free key may not use (resting a day), not a busy minute', () => {
    const e = classify(429, null, '{"error":{"code":429,"message":"You exceeded your current quota. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.1-pro"}}');
    expect(e.kind).toBe('model');
    expect(classify(429, null, '{"error":{"message":"Quota exceeded for metric: generate_content_free_tier_requests, limit: 20, GenerateRequestsPerDayPerProjectPerModel-FreeTier"}}').kind).toBe('limit');
  });

  it('when a model is slow, the next is asked as well and the first good answer is taken', async () => {
    forgetModels('gemini');
    const usage = memoryUsage();
    const env = {
      secrets: { GEMINI_API_KEY: 'g' },
      fetch: (async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/models?')) return new Response(JSON.stringify({ models: ['gemini-3.6-flash', 'gemini-3.5-flash-lite'].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })) }));
        if (u.includes('gemini-3.6-flash:'))
          return new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
        return gem('{"a":2}');
      }) as unknown as typeof fetch,
    };
    const started = Date.now();
    const r = await route(DEFAULT_PROVIDERS, env, usage, { feature: 'translate', private: false, hedgeMs: 50 }, messages, (t) => JSON.parse(t));
    expect(r.model).toBe('gemini-3.5-flash-lite');
    expect(r.value).toEqual({ a: 2 });
    expect(Date.now() - started).toBeLessThan(2000);
    forgetModels('gemini');
  });

  it('thinks little: low on Gemini 3, none on 2.5 Flash, the least on 2.5 Pro', () => {
    expect(thinkingFor('gemini-3.6-flash')).toEqual({ thinkingLevel: 'low' });
    expect(thinkingFor('gemini-2.5-flash-lite')).toEqual({ thinkingBudget: 0 });
    expect(thinkingFor('gemini-2.5-pro')).toEqual({ thinkingBudget: 128 });
    expect(thinkingFor('gemini-flash-latest')).toBeUndefined();
  });

  it('asks Groq again without JSON mode when its JSON check refuses the answer (400)', async () => {
    forgetModels('groq');
    const usage = memoryUsage();
    const sent: string[] = [];
    const env = {
      secrets: { GROQ_API_KEY: 'k' },
      fetch: (async (url: string, init?: RequestInit) => {
        if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }] }));
        const body = String(init?.body);
        sent.push(body);
        if (body.includes('json_object')) return new Response('{"error":{"message":"Failed to generate JSON. Please adjust your prompt.","type":"invalid_request_error","code":"json_validate_failed"}}', { status: 400 });
        return ok('{"a":1}');
      }) as unknown as typeof fetch,
    };
    const groqOnly = DEFAULT_PROVIDERS.filter((p) => p.id === 'groq');
    const r = await route(groqOnly, env, usage, { feature: 'translate', private: false }, messages, (t) => JSON.parse(t));
    expect(r.provider).toBe('groq');
    expect(sent.length).toBe(2);
    forgetModels('groq');
  });

  it('says what the service said when it refuses a request', () => {
    expect(classify(400, null, '{"error":{"message":"Please reduce the length of the messages."}}').message).toBe('Service error 400 (Please reduce the length of the messages.)');
  });

  it('picks strong free OpenRouter models from the real list (November 2026), not tiny or preview ones', async () => {
    const ids = ['inclusionai/ling-3.2-flash:free', 'baidu/ernie-5.5-flash-preview:free', 'thinkingmachines/inkling-2-small:free', 'liquid/lfm-3-1.7b:free', 'particle-ai/particle-1:free', 'recursive/flint-v1.0:free', 'nvidia/nemotron-3.5-super-vl:free', 'dots-studio/dots-3-note-preview:free', 'nvidia/nemotron-3.5-lightning:free', 'cohere/north-mini-code:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', 'google/gemma-4-26b-a4b-it:free', 'google/gemma-4-31b-it:free'];
    forgetModels('openrouter');
    const p = DEFAULT_PROVIDERS.find((x) => x.id === 'openrouter')!;
    const r = await modelsFor(p, 'translate', { secrets: { OPENROUTER_API_KEY: 'x' }, fetch: (async () => new Response(JSON.stringify({ data: ids.map((id) => ({ id })) }))) as unknown as typeof fetch });
    expect(r.slice(0, 4)).toEqual(['nvidia/nemotron-3-ultra-550b-a55b:free', 'google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free', 'nvidia/nemotron-3.5-super-vl:free']);
    forgetModels('openrouter');
  });

  it('reads Google’s “API key not valid” (a 400) as a refused key', () => {
    const e = classify(400, null, JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }));
    expect(e.kind).toBe('auth');
    expect(classify(404, null, '{"error":{"message":"No endpoints found for deepseek/x:free"}}').kind).toBe('model');
    expect(classify(429, null, '{"error":{"message":"Rate limit exceeded: free-models-per-day"}}').daily).toBe(true);
    expect(classify(429, '12', '').retryAt! - Date.now()).toBeLessThan(15_000);
  });

  it('moves on when an answer fails the checks', async () => {
    const usage = memoryUsage();
    const env = {
      secrets: { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' },
      fetch: (async (url: string) => (String(url).includes('googleapis') ? gem('not json') : ok('{"a":1}'))) as unknown as typeof fetch,
    };
    const r = await route(DEFAULT_PROVIDERS, env, usage, { feature: 'translate', private: false, prefer: ['gemini', 'groq'] }, messages, (t) => JSON.parse(t));
    expect(r.provider).toBe('groq');
    expect(r.skipped[0].reason).toMatch(/checks/);
  });

  it('says plainly when nothing is available, and when to try again', async () => {
    const usage = memoryUsage();
    const env = { secrets: {}, fetch: (async () => ok('x')) as unknown as typeof fetch };
    await expect(route(DEFAULT_PROVIDERS, env, usage, { feature: 'translate', private: false }, messages, (t) => t)).rejects.toBeInstanceOf(NoProviderError);
  });
});
