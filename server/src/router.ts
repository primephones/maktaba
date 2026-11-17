import { callProvider, ProviderError, type CallEnv, type CallResult, type ChatMessage, type Feature, type Provider } from './providers';

/**
 * Chooses which AI service answers a request, and falls back to the next one when a
 * service is out of allowance, down, or gives an answer that fails the checks. Private
 * work only ever goes to services that do not train on what they are sent.
 */

export interface UsageStore {
  /** Requests made today (UTC) by each provider. */
  usedToday(): Promise<Record<string, number>>;
  record(provider: string, feature: Feature, r: CallResult): Promise<void>;
  /** A provider marked unavailable until a time (after a limit or a refused key). */
  blockedUntil(): Promise<Record<string, { until: number; reason: string }>>;
  block(provider: string, until: number, reason: string): Promise<void>;
}

export interface RouteOptions {
  feature: Feature;
  private: boolean;
  /** The reader's preferred order of providers for this feature (ids); others follow. */
  prefer?: string[];
}

export interface Routed<T> {
  value: T;
  provider: string;
  model: string;
  /** Services tried and why they were passed over, for the usage screen. */
  skipped: Array<{ provider: string; reason: string }>;
}

/** Midnight UTC after now: when free daily allowances reset. */
export const nextReset = (now = Date.now()) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};

export class NoProviderError extends Error {
  constructor(
    readonly skipped: Array<{ provider: string; reason: string }>,
    readonly retryAt: number,
  ) {
    super('No AI service is available right now');
  }
}

export function eligible(providers: Provider[], env: CallEnv, opts: RouteOptions): Array<{ p: Provider; model: string }> {
  const order = [...providers].sort((a, b) => {
    const ia = opts.prefer?.indexOf(a.id) ?? -1;
    const ib = opts.prefer?.indexOf(b.id) ?? -1;
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return order
    .filter((p) => !!p.models[opts.feature])
    .filter((p) => !opts.private || p.trains === false)
    .filter((p) => (p.kind === 'workers-ai' ? !!env.ai : !!(p.keyName && env.secrets[p.keyName])))
    .map((p) => ({ p, model: p.models[opts.feature]! }));
}

/**
 * Runs `attempt` against each eligible provider in turn until one returns a value. The
 * attempt parses and checks the answer; throwing a 'bad-answer' error moves on.
 */
export async function route<T>(
  providers: Provider[],
  env: CallEnv,
  usage: UsageStore,
  opts: RouteOptions,
  messages: ChatMessage[],
  accept: (text: string) => T,
): Promise<Routed<T>> {
  const skipped: Array<{ provider: string; reason: string }> = [];
  const used = await usage.usedToday();
  const blocked = await usage.blockedUntil();
  const now = Date.now();
  let soonest = nextReset(now);

  const candidates = eligible(providers, env, opts);
  if (!candidates.length) {
    const why = opts.private ? 'No service that keeps private books private has a key set.' : 'No AI service has a key set on the server.';
    throw new NoProviderError([{ provider: '-', reason: why }], soonest);
  }

  for (const { p, model } of candidates) {
    const b = blocked[p.id];
    if (b && b.until > now) {
      skipped.push({ provider: p.id, reason: b.reason });
      soonest = Math.min(soonest, b.until);
      continue;
    }
    if ((used[p.id] ?? 0) >= p.dailyRequests) {
      skipped.push({ provider: p.id, reason: 'today’s allowance is used up' });
      continue;
    }
    try {
      const r = await callProvider(p, model, messages, env);
      await usage.record(p.id, opts.feature, r);
      try {
        return { value: accept(r.text), provider: p.id, model, skipped };
      } catch (e) {
        skipped.push({ provider: p.id, reason: `answer failed the checks: ${(e as Error).message}` });
        continue;
      }
    } catch (e) {
      const err = e instanceof ProviderError ? e : new ProviderError(String(e), 'temporary');
      if (err.kind === 'limit') {
        const until = err.retryAt && err.retryAt - now < 3_600_000 ? err.retryAt : nextReset(now);
        await usage.block(p.id, until, 'allowance used up');
        soonest = Math.min(soonest, until);
      } else if (err.kind === 'auth') {
        await usage.block(p.id, nextReset(now), 'the key was refused; check it in the server settings');
      } else if (err.kind === 'temporary') {
        await usage.block(p.id, now + 2 * 60_000, err.message);
        soonest = Math.min(soonest, now + 2 * 60_000);
      }
      skipped.push({ provider: p.id, reason: err.message });
    }
  }
  throw new NoProviderError(skipped, soonest);
}
