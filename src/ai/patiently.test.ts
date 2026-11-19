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
  it('does not wait on a refused key or a wrong answer', async () => {
    await expect(patiently(async () => { throw new ServerError('The key was refused', 401); })).rejects.toThrow('refused');
  });
});
