import { db, uid } from '../db/db';
import type { AiJob, AiJobItem } from '../db/types';
import { DEFAULT_PROVIDERS, FEATURES, type CallEnv, type CallResult, type Feature, type Provider } from '../../server/src/providers';
import { AnswerRejected, NoProviderError, nextReset, route, type UsageStore } from '../../server/src/router';
import { batches, buildMessages, acceptAnswer, parseAnswer, buildReviewMessages, acceptReview, type Paragraph, type ReviewItem, type SourceLang } from '../../server/src/translate';
import { mergeGlossary, SEED_GLOSSARY, type Term } from '../../server/src/glossary';
import { acceptStudy, featureOf, studyMessages, type StudyTask } from '../../server/src/study';
import { workBegan, workEnded, workProgress } from '../native/work';

/**
 * The reader's own AI, used straight from the phone: their own Google Gemini, Groq or
 * OpenRouter account (or any OpenAI-compatible service), with their own free allowance.
 * Nothing goes through anyone else's server, and the keys never leave this phone (they are
 * not synced and not put in backups).
 *
 * It answers the same requests as the private Maktaba server, in the same shapes, so the
 * rest of the app works the same either way.
 */

export interface MyAi {
  gemini?: string;
  groq?: string;
  openrouter?: string;
  /** Signed in to OpenRouter (rather than a pasted key). */
  openrouterSignedIn?: boolean;
  /** Any OpenAI-compatible service. */
  custom?: { name: string; baseUrl: string; key: string; model: string; trains: boolean };
}

export async function getMyAi(): Promise<MyAi> {
  return ((await db.settings.get('myAi'))?.value as MyAi | undefined) ?? {};
}

export async function setMyAi(next: MyAi): Promise<void> {
  await db.settings.put({ key: 'myAi', value: next });
  window.dispatchEvent(new Event('maktaba:connected'));
}

export const hasMyAi = (a: MyAi) => !!(a.gemini || a.groq || a.openrouter || a.custom?.key || a.custom?.baseUrl);

function providers(a: MyAi): Provider[] {
  const list = DEFAULT_PROVIDERS.filter((p) => p.kind !== 'workers-ai');
  if (a.custom?.baseUrl) {
    const m = a.custom.model;
    list.unshift({
      id: 'custom',
      name: a.custom.name || 'My AI service',
      kind: 'openai',
      baseUrl: a.custom.baseUrl.replace(/\/+$/, ''),
      keyName: 'CUSTOM_API_KEY',
      models: { translate: m, ask: m, explain: m, irab: m },
      trains: a.custom.trains,
      dailyRequests: 100_000,
      rpm: 30,
      note: 'Your own service.',
    });
  }
  return list;
}

function callEnv(a: MyAi): CallEnv {
  return {
    secrets: {
      GEMINI_API_KEY: a.gemini,
      GROQ_API_KEY: a.groq,
      OPENROUTER_API_KEY: a.openrouter,
      // A local service may need no key; any text will do for those.
      CUSTOM_API_KEY: a.custom?.baseUrl ? a.custom.key || 'none' : undefined,
    } as Record<string, string | undefined>,
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  } as CallEnv;
}

// ------------------------------------------------------------------------------- allowance

interface Usage {
  day: string;
  providers: Record<string, number>;
  features: Record<string, number>;
  blocks: Record<string, { until: number; reason: string }>;
}

const today = () => new Date().toISOString().slice(0, 10);

async function readUsage(): Promise<Usage> {
  const u = (await db.settings.get('myAiUsage'))?.value as Usage | undefined;
  const fresh: Usage = { day: today(), providers: {}, features: {}, blocks: u?.blocks ?? {} };
  return u && u.day === today() ? u : fresh;
}

const usage: UsageStore = {
  async usedToday() {
    return (await readUsage()).providers;
  },
  async record(provider: string, feature: Feature, _r: CallResult) {
    const u = await readUsage();
    u.providers[provider] = (u.providers[provider] ?? 0) + 1;
    u.features[feature] = (u.features[feature] ?? 0) + 1;
    await db.settings.put({ key: 'myAiUsage', value: u });
  },
  async blockedUntil() {
    const u = await readUsage();
    return Object.fromEntries(Object.entries(u.blocks).filter(([, b]) => b.until > Date.now()));
  },
  async block(provider: string, until: number, reason: string) {
    const u = await readUsage();
    u.blocks[provider] = { until, reason: reason.replace('in the server settings', 'in Settings › AI') };
    await db.settings.put({ key: 'myAiUsage', value: u });
  },
};

// ------------------------------------------------------------------------------- requests

/** An answer in the server's shape, or an error carrying its status and details. */
export class DeviceError extends Error {
  constructor(message: string, readonly status: number, readonly data: Record<string, unknown> = {}) {
    super(message);
  }
}

interface TranslateBody {
  lang: SourceLang;
  paragraphs: Paragraph[];
  glossary?: Term[];
  private?: boolean;
  prefer?: string[];
  bookTitle?: string;
  chapter?: string;
  previous?: string;
}

async function translateBatch(a: MyAi, body: TranslateBody) {
  const glossary = mergeGlossary(SEED_GLOSSARY, body.glossary ?? []);
  const messages = buildMessages({ lang: body.lang, paragraphs: body.paragraphs, glossary, bookTitle: body.bookTitle, chapter: body.chapter, previous: body.previous });
  const routed = await route(providers(a), callEnv(a), usage, { feature: 'translate', private: !!body.private, prefer: preferFor(a, body.prefer) }, messages, (text) => {
    return acceptAnswer(body.paragraphs, parseAnswer(text));
  });
  return { results: routed.value.map((r) => ({ ...r, provider: routed.provider, model: routed.model, cached: false })), skipped: routed.skipped, provider: routed.provider };
}

/** The reader's own service, if they added one, comes first. */
const preferFor = (a: MyAi, prefer?: string[]) => (a.custom?.baseUrl ? ['custom', ...(prefer ?? [])] : prefer);

const NAMES: Record<string, string> = { gemini: 'Gemini', groq: 'Groq', openrouter: 'OpenRouter', custom: 'Your service' };

/** "Gemini: busy for a moment; Groq: the key was refused", one line per service. */
export function explainSkipped(skipped: Array<{ provider: string; reason: string }>): string {
  const per = new Map<string, string>();
  for (const s of skipped) per.set(s.provider, s.reason.replace('in the server settings', 'in Settings › Your AI'));
  return [...per].map(([p, r]) => `${NAMES[p] ?? p}: ${r}`).join('; ');
}

const noProvider = (e: NoProviderError) =>
  new DeviceError(
    e.skipped.length === 1 && e.skipped[0].provider === '-'
      ? e.skipped[0].reason.replace('on the server', 'in Settings › AI')
      : `Your AI is not available right now. ${explainSkipped(e.skipped)}.`,
    503,
    { retryAt: e.retryAt, skipped: e.skipped },
  );

export interface ServiceTest {
  id: string;
  name: string;
  ok: boolean;
  /** The model that answered. */
  model?: string;
  message: string;
  ms: number;
}

/**
 * Tries each connected service with one short translation (one request of allowance each)
 * and says exactly what happened. A service that works is cleared of any earlier pause.
 */
export async function testServices(): Promise<ServiceTest[]> {
  const a = await getMyAi();
  const env = callEnv(a);
  const out: ServiceTest[] = [];
  const sample = [{ id: '1', text: 'قال الإمام الشافعي رحمه الله: العلم ما نفع، ليس العلم ما حفظ.', kind: 'p' as const }];
  const messages = buildMessages({ lang: 'ar', paragraphs: sample, glossary: mergeGlossary(SEED_GLOSSARY, []) });
  for (const p of providers(a)) {
    if (!(p.keyName && env.secrets[p.keyName])) continue;
    // A fresh count, so an earlier pause does not hide whether the service works now.
    const fresh: UsageStore = { usedToday: async () => ({}), record: async () => undefined, blockedUntil: async () => ({}), block: async () => undefined };
    const started = Date.now();
    try {
      const r = await route([p], env, fresh, { feature: 'translate', private: false }, messages, (text) => acceptAnswer(sample, parseAnswer(text)));
      out.push({ id: p.id, name: NAMES[p.id] ?? p.name, ok: true, model: r.model, message: r.value[0]?.en ?? '', ms: Date.now() - started });
      if (p.id === 'gemini' || p.id === 'openrouter') await import('../ocr/ai').then((m) => m.clearPagePause(p.id as 'gemini' | 'openrouter')).catch(() => undefined);
      const u = await readUsage();
      for (const k of Object.keys(u.blocks)) if (k === p.id || k.startsWith(`${p.id}|`)) delete u.blocks[k];
      await db.settings.put({ key: 'myAiUsage', value: u });
    } catch (e) {
      const reason = e instanceof NoProviderError || e instanceof AnswerRejected ? explainSkipped(e.skipped).replace(/^[^:]+: /, '') : (e as Error).message;
      out.push({ id: p.id, name: NAMES[p.id] ?? p.name, ok: false, message: reason, ms: Date.now() - started });
    }
  }
  return out;
}

/** Handles one request the way the server would. */
export async function handle(path: string, method: string, body: Record<string, unknown> | undefined): Promise<unknown> {
  const a = await getMyAi();
  if (path === '/v1/status' && method === 'GET') return status(a);
  try {
    if (path === '/v1/translate' && method === 'POST') {
      const b = body as unknown as TranslateBody;
      if (!b?.paragraphs?.length) throw new DeviceError('Nothing to translate.', 400);
      const out = await translateBatch(a, b);
      return { results: out.results, skipped: out.skipped };
    }
    if (path === '/v1/review' && method === 'POST') {
      // A second check: another service than the one that made the draft, where there is one.
      const b = body as unknown as { lang: SourceLang; items: ReviewItem[]; private?: boolean; avoid?: string };
      if (!b?.items?.length) throw new DeviceError('Nothing to check.', 400);
      const ids = providers(a).map((p) => p.id);
      const prefer = [...ids.filter((id) => id !== b.avoid), ...(b.avoid ? [b.avoid] : [])];
      const glossary = mergeGlossary(SEED_GLOSSARY, []);
      const routed = await route(providers(a), callEnv(a), usage, { feature: 'translate', private: !!b.private, prefer }, buildReviewMessages(b.lang, b.items, glossary), (text) => acceptReview(b.items, text));
      return { results: routed.value, provider: routed.provider, model: routed.model };
    }
    if (path === '/v1/study' && method === 'POST') {
      const t = body as unknown as StudyTask & { private?: boolean; prefer?: string[] };
      const routed = await route(providers(a), callEnv(a), usage, { feature: featureOf(t), private: !!t.private, prefer: preferFor(a, t.prefer) }, studyMessages(t), (text) => acceptStudy(t, text));
      return { result: routed.value, provider: routed.provider, model: routed.model };
    }
  } catch (e) {
    if (e instanceof NoProviderError) throw noProvider(e);
    if (e instanceof AnswerRejected) throw new DeviceError(`${e.message}. It will try again, a paragraph at a time.`, 502, { skipped: e.skipped });
    throw e;
  }
  if (path === '/v1/jobs' && method === 'POST') return createJob(body ?? {});
  const m = path.match(/^\/v1\/jobs\/([\w-]+)(\/results)?(?:\?since=(\d+))?$/);
  if (m) {
    const job = await db.aiJobs.get(m[1]);
    if (!job) throw new DeviceError('No such translation job.', 404);
    if (method === 'DELETE') {
      await db.transaction('rw', db.aiJobs, db.aiJobItems, async () => {
        await db.aiJobs.update(job.id, { state: 'cancelled', updated_at: Date.now() });
        await db.aiJobItems.where('jobId').equals(job.id).delete();
      });
      return { ok: true };
    }
    if (m[2]) {
      const since = Number(m[3] ?? 0);
      const items = await db.aiJobItems.where('[jobId+doneAt]').between([job.id, since + 1], [job.id, Infinity]).limit(400).toArray();
      return {
        items: items.filter((i) => i.status === 'done').map((i) => ({ pid: i.pid, en: i.en, uncertain: i.uncertain ?? [], provider: i.provider, model: i.model, done_at: i.doneAt })),
        job,
      };
    }
    return { job };
  }
  throw new DeviceError('This needs your own server (Settings › AI › Advanced).', 404);
}

async function status(a: MyAi) {
  const u = await readUsage();
  const blocks = await usage.blockedUntil();
  const secrets = callEnv(a).secrets;
  const jobs = (await db.aiJobs.toArray()).filter((j) => j.state !== 'cancelled').sort((x, y) => y.updated_at - x.updated_at).slice(0, 20);
  return {
    member: { name: 'You', role: 'owner', dailyShare: 0, usedToday: Object.values(u.providers).reduce((n, v) => n + v, 0) },
    resetAt: nextReset(),
    features: Object.fromEntries(FEATURES.map((f) => [f, u.features[f] ?? 0])),
    providers: providers(a).map((p) => ({
      id: p.id,
      name: p.name,
      note: p.note,
      trains: p.trains,
      features: Object.keys(p.models),
      configured: !!(p.keyName && secrets[p.keyName]),
      usedToday: u.providers[p.id] ?? 0,
      dailyLimit: p.dailyRequests,
      blockedUntil: blocks[p.id]?.until ?? null,
      blockedReason: blocks[p.id]?.reason ?? null,
    })),
    jobs,
  };
}

// ------------------------------------------------------------------------------- whole books

async function createJob(body: Record<string, unknown>) {
  const paragraphs = (body.paragraphs as Array<{ id: string; text: string; kind?: string; chapter?: string }>) ?? [];
  if (!paragraphs.length) throw new DeviceError('Nothing to translate.', 400);
  const id = uid();
  const now = Date.now();
  const job: AiJob = {
    id,
    title: String(body.title ?? ''),
    lang: (body.lang as AiJob['lang']) ?? 'ar',
    private: !!body.private,
    glossary: (body.glossary as Term[]) ?? [],
    prefer: (body.prefer as string[]) ?? [],
    state: 'queued',
    total: paragraphs.length,
    done: 0,
    next_run_at: now,
    last_error: null,
    created_at: now,
    updated_at: now,
  };
  await db.transaction('rw', db.aiJobs, db.aiJobItems, async () => {
    await db.aiJobs.put(job);
    await db.aiJobItems.bulkPut(
      paragraphs.map((p, seq): AiJobItem => ({ jobId: id, seq, pid: String(p.id), text: String(p.text), kind: String(p.kind ?? 'p'), chapter: p.chapter, status: 'todo', attempts: 0, doneAt: 0 })),
    );
  });
  void runJobs();
  return { id, total: paragraphs.length };
}

let running: Promise<void> | null = null;
let wake = 0;

/**
 * Works through the book translations, a batch at a time, paced to each service's
 * per-minute limit. When every allowance is used up it waits, and carries on by itself
 * when the allowance comes back (while the app is open, or working in the background).
 */
export function runJobs(): Promise<void> {
  if (!running) running = work().finally(() => (running = null));
  return running;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function work() {
  window.clearTimeout(wake);
  const key = 'translate-books';
  let announced = false;
  try {
    for (;;) {
      const jobs = (await db.aiJobs.where('state').anyOf('queued', 'running', 'waiting').toArray()).sort((x, y) => x.created_at - y.created_at);
      const due = jobs.find((j) => j.next_run_at <= Date.now());
      if (!due) {
        const next = Math.min(...jobs.map((j) => j.next_run_at));
        if (Number.isFinite(next)) wake = window.setTimeout(() => void runJobs(), Math.max(5_000, Math.min(next - Date.now(), 30 * 60_000)));
        return;
      }
      if (!announced) {
        announced = true;
        await workBegan(key, 'Translating', due.title, 'A book translation will carry on when Maktaba opens.');
      }
      const a = await getMyAi();
      if (!hasMyAi(a)) {
        await db.aiJobs.update(due.id, { state: 'waiting', next_run_at: Date.now() + 10 * 60_000, last_error: 'Paused: connect your AI in Settings › AI.', updated_at: Date.now() });
        continue;
      }
      const todo = await db.aiJobItems.where('[jobId+status]').equals([due.id, 'todo']).limit(24).toArray();
      if (!todo.length) {
        await db.aiJobs.update(due.id, { state: 'done', last_error: null, updated_at: Date.now() });
        void import('./translation').then((t) => t.pullAll()).catch(() => undefined);
        continue;
      }
      todo.sort((x, y) => x.seq - y.seq);
      const first = todo[0];
      // After a failed try, the first paragraph goes alone, so one awkward paragraph (a
      // stamp, a table, a garbled scan) cannot hold up the rest of the book.
      const batch = first.attempts > 0 ? [{ id: String(first.seq), text: first.text, kind: first.kind as Paragraph['kind'] }] : batches(todo.map((i) => ({ id: String(i.seq), text: i.text, kind: i.kind as Paragraph['kind'] })))[0];
      const prev = first.seq > 0 ? await db.aiJobItems.get([due.id, first.seq - 1]) : undefined;
      const started = Date.now();
      try {
        const out = await translateBatch(a, {
          lang: due.lang,
          paragraphs: batch,
          glossary: due.glossary,
          private: due.private,
          prefer: due.prefer,
          bookTitle: due.title,
          chapter: first.chapter,
          previous: prev?.en,
        });
        const now = Date.now();
        await db.transaction('rw', db.aiJobs, db.aiJobItems, async () => {
          for (const r of out.results) {
            await db.aiJobItems.update([due.id, Number(r.id)], { en: r.en, uncertain: r.uncertain, provider: r.provider, model: r.model, status: 'done', doneAt: now });
          }
          const job = await db.aiJobs.get(due.id);
          if (job && job.state !== 'cancelled') await db.aiJobs.update(due.id, { state: 'running', done: job.done + out.results.length, last_error: null, updated_at: now });
        });
        const job = await db.aiJobs.get(due.id);
        if (job) workProgress(key, 'Translating', job.title, job.done, job.total);
        // The English goes into the book at once (not at the next check), so it shows as it comes.
        void import('./translation').then((t) => t.pullAll()).catch(() => undefined);
        // Keep to the service's requests-per-minute.
        const rpm = providers(a).find((p) => p.id === out.provider)?.rpm ?? 10;
        await pause(Math.max(0, 60_000 / rpm - (Date.now() - started)));
      } catch (e) {
        if (e instanceof NoProviderError) {
          // Every allowance is used up for now: pause, and say exactly when it resumes.
          await db.aiJobs.update(due.id, {
            state: 'waiting',
            next_run_at: e.retryAt,
            last_error: `Paused: ${e.skipped.map((s) => `${s.provider} (${s.reason})`).join(', ')}`,
            updated_at: Date.now(),
          });
          continue;
        }
        const tries = first.attempts + 1;
        await db.aiJobItems.update([due.id, first.seq], { attempts: tries, status: tries >= 4 ? 'failed' : 'todo' });
        await db.aiJobs.update(due.id, { last_error: String((e as Error).message).slice(0, 300), updated_at: Date.now(), next_run_at: Date.now() + 30_000 });
      }
    }
  } finally {
    if (announced) await workEnded(key);
  }
}
