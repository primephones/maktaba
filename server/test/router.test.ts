import { describe, expect, it } from 'vitest';
import { classify, DEFAULT_PROVIDERS, forgetModels, type CallResult, type Feature } from '../src/providers';
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
