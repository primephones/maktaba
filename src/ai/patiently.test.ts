import { describe, expect, it, vi } from 'vitest';
import { patiently } from './translation';
import { ServerError } from './client';

describe('when every AI is busy', () => {
  it('waits, says how long, and asks again', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const waits: number[] = [];
    const p = patiently(async () => {
      calls++;
      if (calls < 3) throw new ServerError('Your AI is not available right now.', 503, { retryAt: Date.now() + 20_000 });
      return 'English';
    }, (s) => waits.push(s));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await p).toBe('English');
    expect(calls).toBe(3);
    expect(waits[0]).toBe(20);
    vi.useRealTimers();
  });
  it('does not wait when the AI is out until tomorrow (a day’s allowance used up)', async () => {
    let calls = 0;
    const started = Date.now();
    await expect(patiently(async () => {
      calls++;
      throw new ServerError('Your AI is not available right now.', 503, { retryAt: Date.now() + 9 * 3600_000 });
    })).rejects.toThrow('not available');
    expect(calls).toBe(1);
    expect(Date.now() - started).toBeLessThan(1000);
  });
  it('asks at most as many times as it is told to', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const p = patiently(async () => {
      calls++;
      throw new ServerError('busy', 503, { retryAt: Date.now() + 15_000 });
    }, undefined, 2).catch((e) => e);
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await p).message).toBe('busy');
    expect(calls).toBe(2);
    vi.useRealTimers();
  });
  it('does not wait on a refused key or a wrong answer', async () => {
    await expect(patiently(async () => { throw new ServerError('The key was refused', 401); })).rejects.toThrow('refused');
  });
});
