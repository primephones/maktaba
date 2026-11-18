import { callProvider, forgetModels, modelsFor, ProviderError, type CallEnv, type CallResult, type ChatMessage, type Feature, type Provider } from './providers';

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
  /** A service answered, but the answer failed the checks (worth trying again soon, in smaller pieces). */
  let checksFailed = false;
  if (!candidates.length) {
    const why = opts.private ? 'No service that keeps private books private has a key set.' : 'No AI service has a key set on the server.';
    throw new NoProviderError([{ provider: '-', reason: why }], soonest);
  }

  for (const { p } of candidates) {
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
    // Each service may offer several models, each with its own allowance: when one is busy,
    // used up for the day or retired, the next is tried before moving to another service.
    const models = await modelsFor(p, opts.feature, env);
    for (const model of models) {
      const mk = `${p.id}|${model}`;
      const mb = blocked[mk];
      if (mb && mb.until > now) {
        skipped.push({ provider: p.id, reason: `${model}: ${mb.reason}` });
        soonest = Math.min(soonest, mb.until);
        continue;
      }
      let next = true;
      try {
        const r = await callProvider(p, model, messages, env);
        await usage.record(p.id, opts.feature, r);
        try {
          return { value: accept(r.text), provider: p.id, model, skipped };
        } catch (e) {
          skipped.push({ provider: p.id, reason: `answer failed the checks: ${(e as Error).message}` });
          checksFailed = true;
          next = false;
        }
      } catch (e) {
        const err = e instanceof ProviderError ? e : new ProviderError(String(e), 'temporary');
        skipped.push({ provider: p.id, reason: `${model}: ${err.message}` });
        if (err.kind === 'limit') {
          const until = err.retryAt && err.retryAt - now < 3_600_000 ? err.retryAt : err.daily ? nextReset(now) : now + 60_000;
          await usage.block(mk, until, err.message);
          soonest = Math.min(soonest, until);
        } else if (err.kind === 'model') {
          forgetModels(p.id);
          await usage.block(mk, now + 24 * 3_600_000, err.message);
        } else if (err.kind === 'bad-answer') {
          // Refused or empty (a safety filter, say): another model may answer.
        } else if (err.kind === 'auth') {
          await usage.block(p.id, nextReset(now), 'the key was refused; check it in the server settings');
          next = false;
        } else {
          const until = err.retryAt && err.retryAt - now < 600_000 ? err.retryAt : now + 2 * 60_000;
          await usage.block(p.id, until, err.message);
          soonest = Math.min(soonest, until);
          next = false;
        }
      }
      if (!next) break;
    }
  }
  if (checksFailed) throw new AnswerRejected(skipped);
  throw new NoProviderError(skipped, soonest);
}

/** Every answer received failed the checks: not a matter of waiting for an allowance. */
export class AnswerRejected extends Error {
  constructor(readonly skipped: Array<{ provider: string; reason: string }>) {
    super(`The AI’s answers failed the checks: ${skipped.filter((s) => /checks/.test(s.reason)).map((s) => s.reason.replace(/^answer failed the checks: /, '')).join('; ')}`.slice(0, 300));
  }
}
