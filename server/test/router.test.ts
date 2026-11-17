import { describe, expect, it } from 'vitest';
import { DEFAULT_PROVIDERS, type CallResult, type Feature } from '../src/providers';
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

  it('falls back when a service is out of allowance, and remembers it', async () => {
    const usage = memoryUsage();
    const env = {
      secrets: { GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' },
      fetch: (async (url: string) => (String(url).includes('googleapis') ? new Response('{}', { status: 429 }) : ok('{"a":1}'))) as unknown as typeof fetch,
    };
    const r = await route(DEFAULT_PROVIDERS, env, usage, { feature: 'translate', private: false, prefer: ['gemini', 'groq'] }, messages, (t) => JSON.parse(t));
    expect(r.provider).toBe('groq');
    expect(r.skipped[0]).toMatchObject({ provider: 'gemini' });
    expect((await usage.blockedUntil()).gemini.reason).toMatch(/allowance/);
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
