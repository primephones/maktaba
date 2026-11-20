import { callProvider, forgetModels, lightThird, modelsFor, ProviderError, type CallEnv, type CallResult, type ChatMessage, type Feature, type Provider } from './providers';

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
  /** How long a model may take before the next one is asked as well. */
  hedgeMs?: number;
  /**
   * Work in the background (As I read, a whole book): the strongest model is given time, a
   * light model is not moved forward, and a second model is asked only after a long wait.
   */
  quality?: boolean;
  /** How long one model may take to answer (larger batches take longer). */
  timeoutMs?: number;
}

/** How long a model may take before the next one is asked as well (a paragraph or eight usually takes 5 to 15 s). */
export const HEDGE_MS = 15_000;

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
    // Free models are often slow when busy (a minute and more for one paragraph), so a
    // model that has not answered after a little while is joined by the next one, and the
    // first good answer is taken.
    const live: string[] = [];
    for (const model of await modelsFor(p, opts.feature, env)) {
      const mb = blocked[`${p.id}|${model}`];
      if (mb && mb.until > now) {
        skipped.push({ provider: p.id, reason: `${model}: ${mb.reason}` });
        soonest = Math.min(soonest, mb.until);
      } else live.push(model);
    }
    const order = opts.quality ? live : lightThird(live);
    const won = await new Promise<Routed<T> | null>((resolve) => {
      let i = 0;
      let running = 0;
      let settled = false;
      let stop = false;
      const ctrls: AbortController[] = [];
      const timers: Array<ReturnType<typeof setTimeout>> = [];
      const finish = (r: Routed<T> | null) => {
        if (settled) return;
        settled = true;
        for (const t of timers) clearTimeout(t);
        for (const c of ctrls) c.abort();
        resolve(r);
      };
      const launch = () => {
        if (settled) return;
        if (stop || i >= order.length) {
          if (running === 0) finish(null);
          return;
        }
        const model = order[i++];
        const mk = `${p.id}|${model}`;
        const ctrl = new AbortController();
        ctrls.push(ctrl);
        running++;
        let hedged = false;
        const hedge = setTimeout(() => {
          hedged = true;
          launch();
        }, opts.hedgeMs ?? (opts.quality ? 60_000 : HEDGE_MS));
        timers.push(hedge);
        void (async () => {
          let next = true;
          try {
            const r = await callProvider(p, model, messages, env, true, ctrl.signal, opts.timeoutMs);
            if (settled) return;
            await usage.record(p.id, opts.feature, r);
            try {
              finish({ value: accept(r.text), provider: p.id, model, skipped });
              return;
            } catch (e) {
              skipped.push({ provider: p.id, reason: `answer failed the checks: ${(e as Error).message}` });
              checksFailed = true;
              next = false;
            }
          } catch (e) {
            if (settled) return;
            const err = e instanceof ProviderError ? e : new ProviderError(String(e), 'temporary');
            const at = Date.now();
            skipped.push({ provider: p.id, reason: `${model}: ${err.message}` });
            if (err.kind === 'limit') {
              const until = err.retryAt && err.retryAt - at < 3_600_000 ? err.retryAt : err.daily ? nextReset(at) : at + 60_000;
              await usage.block(mk, until, err.message);
              soonest = Math.min(soonest, until);
            } else if (err.kind === 'model') {
              forgetModels(p.id);
              await usage.block(mk, at + 24 * 3_600_000, err.message);
            } else if (err.kind === 'bad-answer') {
              // Refused or empty (a safety filter, say): another model may answer.
            } else if (err.kind === 'auth') {
              await usage.block(p.id, nextReset(at), 'the key was refused; check it in the server settings');
              next = false;
            } else {
              // Dropped, too slow, or refused this request: that model rests briefly; the
              // others of the service go on (a busy model must not shut out the rest).
              const until = err.retryAt && err.retryAt - at < 600_000 ? err.retryAt : at + 2 * 60_000;
              await usage.block(mk, until, err.message);
              soonest = Math.min(soonest, until);
            }
          } finally {
            running--;
            clearTimeout(hedge);
          }
          if (!next) stop = true;
          // Failed: the next model now, unless one was already started in its place.
          if (!hedged) launch();
          else if (running === 0 && (stop || i >= order.length)) finish(null);
        })();
      };
      launch();
    });
    if (won) return won;
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
