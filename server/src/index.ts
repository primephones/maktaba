import { SEED_GLOSSARY, mergeGlossary, type Term } from './glossary';
import { DEFAULT_PROVIDERS, FEATURES, type CallEnv, type CallResult, type Feature, type Provider } from './providers';
import { NoProviderError, nextReset, route, type UsageStore } from './router';
import { batches, buildMessages, acceptAnswer, parseAnswer, buildReviewMessages, acceptReview, type Paragraph, type ReviewItem, type SourceLang, type Translated } from './translate';
import { acceptStudy, featureOf, studyMessages, type StudyTask } from './study';

/**
 * Maktaba's private server: the only place the AI keys live. Only people holding a key
 * the owner set up can use it, so nobody who finds its address can spend the allowance.
 */

export interface Env {
  DB: D1Database;
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  /** One-time code that lets the owner's phone claim this server. */
  SETUP_CODE?: string;
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  /** Optional JSON overriding provider settings, e.g. models or limits. */
  PROVIDERS_JSON?: string;
}

interface Member {
  key_hash: string;
  name: string;
  role: 'owner' | 'member';
  daily_share: number;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    },
  });
const fail = (status: number, message: string, extra: Record<string, unknown> = {}) => json({ error: message, ...extra }, status);

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const KEY_FORMAT = /^HSY(-[A-Z2-9]{4}){5}$/;
/** What syncs between phones. Book files and their text do not: each phone has its own. */
const SYNC_TABLES = new Set(['books', 'folders', 'marks', 'refs', 'settings', 'translations', 'ocrPages']);
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

function providersFor(env: Env): Provider[] {
  if (!env.PROVIDERS_JSON) return DEFAULT_PROVIDERS;
  try {
    const over = JSON.parse(env.PROVIDERS_JSON) as Array<Partial<Provider> & { id: string }>;
    return DEFAULT_PROVIDERS.map((p) => {
      const o = over.find((x) => x.id === p.id);
      return o ? { ...p, ...o, models: { ...p.models, ...(o.models ?? {}) } } : p;
    });
  } catch {
    return DEFAULT_PROVIDERS;
  }
}

function callEnv(env: Env): CallEnv {
  return {
    secrets: { GEMINI_API_KEY: env.GEMINI_API_KEY, GROQ_API_KEY: env.GROQ_API_KEY, OPENROUTER_API_KEY: env.OPENROUTER_API_KEY },
    ai: env.AI,
    fetch: (...a: Parameters<typeof fetch>) => fetch(...a),
  };
}

function usageStore(env: Env, member: string): UsageStore {
  return {
    async usedToday() {
      const rows = await env.DB.prepare('SELECT provider, SUM(requests) AS n FROM usage WHERE day = ? GROUP BY provider').bind(day()).all<{ provider: string; n: number }>();
      return Object.fromEntries(rows.results.map((r) => [r.provider, r.n]));
    },
    async record(provider: string, feature: Feature, r: CallResult) {
      await env.DB.prepare(
        `INSERT INTO usage (day, provider, feature, member, requests, tokens_in, tokens_out) VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT (day, provider, feature, member) DO UPDATE SET requests = requests + 1, tokens_in = tokens_in + excluded.tokens_in, tokens_out = tokens_out + excluded.tokens_out`,
      ).bind(day(), provider, feature, member, r.tokensIn, r.tokensOut).run();
    },
    async blockedUntil() {
      const rows = await env.DB.prepare('SELECT provider, until, reason FROM blocks WHERE until > ?').bind(Date.now()).all<{ provider: string; until: number; reason: string }>();
      return Object.fromEntries(rows.results.map((r) => [r.provider, { until: r.until, reason: r.reason }]));
    },
    async block(provider: string, until: number, reason: string) {
      await env.DB.prepare('INSERT INTO blocks (provider, until, reason) VALUES (?, ?, ?) ON CONFLICT (provider) DO UPDATE SET until = excluded.until, reason = excluded.reason').bind(provider, until, reason).run();
    },
  };
}

async function memberFor(req: Request, env: Env): Promise<{ key: string; hash: string; member: Member | null }> {
  const key = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim().toUpperCase();
  const hash = KEY_FORMAT.test(key) ? await sha256(key) : '';
  const member = hash ? await env.DB.prepare('SELECT * FROM members WHERE key_hash = ?').bind(hash).first<Member>() : null;
  return { key, hash, member };
}

/** A person with their own allowance has used it up today. */
async function overShare(env: Env, m: Member): Promise<boolean> {
  if (!m.daily_share) return false;
  const row = await env.DB.prepare('SELECT SUM(requests) AS n FROM usage WHERE day = ? AND member = ?').bind(day(), m.key_hash).first<{ n: number | null }>();
  return (row?.n ?? 0) >= m.daily_share;
}

// ------------------------------------------------------------------------------- translation

const cacheKey = (lang: string, text: string, glossary: Term[]) =>
  sha256(`${lang}\u0000${text}\u0000${glossary.map((t) => `${t.ar}=${t.tr}`).join('|')}`);

export interface TranslateBody {
  lang: SourceLang;
  paragraphs: Paragraph[];
  glossary?: Term[];
  private?: boolean;
  prefer?: string[];
  bookTitle?: string;
  chapter?: string;
  previous?: string;
  /** Re-draft: skip the stored translation and ask again. */
  fresh?: boolean;
}

interface TranslateOutcome {
  results: Array<Translated & { provider: string; model: string; cached: boolean }>;
  skipped: Array<{ provider: string; reason: string }>;
}

/** Translates up to one batch, using stored translations where the same text was done before. */
async function translateBatch(env: Env, member: string, body: TranslateBody): Promise<TranslateOutcome> {
  const glossary = mergeGlossary(SEED_GLOSSARY, body.glossary ?? []);
  const results: TranslateOutcome['results'] = [];
  const todo: Paragraph[] = [];
  const hashes = new Map<string, string>();
  for (const p of body.paragraphs) {
    const h = await cacheKey(body.lang, p.text, glossary);
    hashes.set(p.id, h);
    const hit = body.fresh ? null : await env.DB.prepare('SELECT * FROM cache WHERE hash = ?').bind(h).first<{ en: string; uncertain: string; provider: string; model: string }>();
    if (hit) results.push({ id: p.id, en: hit.en, uncertain: JSON.parse(hit.uncertain), provider: hit.provider, model: hit.model, cached: true });
    else todo.push(p);
  }
  if (!todo.length) return { results, skipped: [] };

  const messages = buildMessages({ lang: body.lang, paragraphs: todo, glossary, bookTitle: body.bookTitle, chapter: body.chapter, previous: body.previous });
  const routed = await route(providersFor(env), callEnv(env), usageStore(env, member), { feature: 'translate', private: !!body.private, prefer: body.prefer }, messages, (text) => {
    return acceptAnswer(todo, parseAnswer(text));
  });
  const now = Date.now();
  for (const a of routed.value) {
    const src = todo.find((p) => p.id === a.id)!;
    results.push({ ...a, provider: routed.provider, model: routed.model, cached: false });
    await env.DB.prepare('INSERT OR REPLACE INTO cache (hash, en, uncertain, provider, model, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(hashes.get(src.id)!, a.en, JSON.stringify(a.uncertain), routed.provider, routed.model, now).run();
  }
  return { results, skipped: routed.skipped };
}

// ------------------------------------------------------------------------------- whole books

interface JobRow {
  id: string;
  member: string;
  title: string;
  lang: SourceLang;
  private: number;
  glossary: string;
  prefer: string;
  state: string;
  total: number;
  done: number;
  next_run_at: number;
  last_error: string | null;
}

/** Works through due book translations until the time budget or the allowance runs out. */
export async function runJobs(env: Env, budgetMs = 25_000): Promise<number> {
  const started = Date.now();
  let translated = 0;
  const due = await env.DB.prepare(`SELECT * FROM jobs WHERE state IN ('queued', 'running', 'waiting') AND next_run_at <= ? ORDER BY created_at LIMIT 5`).bind(Date.now()).all<JobRow>();
  for (const job of due.results) {
    while (Date.now() - started < budgetMs) {
      const items = await env.DB.prepare(`SELECT seq, pid, text, kind, chapter FROM job_items WHERE job_id = ? AND status = 'todo' ORDER BY seq LIMIT 24`).bind(job.id).all<{ seq: number; pid: string; text: string; kind: string; chapter: string | null }>();
      if (!items.results.length) {
        await env.DB.prepare(`UPDATE jobs SET state = 'done', updated_at = ?, last_error = NULL WHERE id = ?`).bind(Date.now(), job.id).run();
        break;
      }
      const batch = batches(items.results.map((i) => ({ id: String(i.seq), text: i.text, kind: i.kind as Paragraph['kind'] })))[0];
      const first = items.results[0];
      const prev = await env.DB.prepare(`SELECT en FROM job_items WHERE job_id = ? AND seq < ? AND status = 'done' ORDER BY seq DESC LIMIT 1`).bind(job.id, first.seq).first<{ en: string }>();
      try {
        const out = await translateBatch(env, job.member, {
          lang: job.lang,
          paragraphs: batch,
          glossary: JSON.parse(job.glossary),
          private: !!job.private,
          prefer: JSON.parse(job.prefer),
          bookTitle: job.title,
          chapter: first.chapter ?? undefined,
          previous: prev?.en,
        });
        const now = Date.now();
        for (const r of out.results) {
          await env.DB.prepare(`UPDATE job_items SET en = ?, uncertain = ?, provider = ?, model = ?, status = 'done', done_at = ? WHERE job_id = ? AND seq = ?`)
            .bind(r.en, JSON.stringify(r.uncertain), r.provider, r.model, now, job.id, Number(r.id)).run();
        }
        translated += out.results.length;
        await env.DB.prepare(`UPDATE jobs SET state = 'running', done = done + ?, updated_at = ?, last_error = NULL WHERE id = ?`).bind(out.results.length, now, job.id).run();
      } catch (e) {
        if (e instanceof NoProviderError) {
          // Every free allowance is used up for now: pause and say exactly when it resumes.
          await env.DB.prepare(`UPDATE jobs SET state = 'waiting', next_run_at = ?, updated_at = ?, last_error = ? WHERE id = ?`)
            .bind(e.retryAt, Date.now(), `Paused: ${e.skipped.map((s) => `${s.provider} (${s.reason})`).join(', ')}`, job.id).run();
          return translated;
        }
        // An unexpected fault with this batch: count the attempt and move on next time.
        await env.DB.prepare(`UPDATE job_items SET attempts = attempts + 1, status = CASE WHEN attempts >= 4 THEN 'failed' ELSE status END WHERE job_id = ? AND seq = ?`).bind(job.id, first.seq).run();
        await env.DB.prepare(`UPDATE jobs SET last_error = ?, updated_at = ? WHERE id = ?`).bind(String((e as Error).message).slice(0, 300), Date.now(), job.id).run();
        break;
      }
    }
  }
  return translated;
}

// ------------------------------------------------------------------------------- HTTP

async function handle(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (req.method === 'OPTIONS') return json({});
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '' || path === '/') return json({ name: 'Maktaba server', ok: true });

  const { hash, member } = await memberFor(req, env);
  const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {};

  // Claiming the server: the owner's phone, once, with the setup code.
  if (path === '/v1/setup' && req.method === 'POST') {
    if (!hash) return fail(400, 'The sync key is missing or not in the HSY-XXXX format.');
    const owners = await env.DB.prepare(`SELECT COUNT(*) AS n FROM members WHERE role = 'owner'`).first<{ n: number }>();
    if ((owners?.n ?? 0) > 0) return member ? json({ ok: true, role: member.role }) : fail(403, 'This server already has an owner.');
    if (!env.SETUP_CODE || body.code !== env.SETUP_CODE) return fail(403, 'The setup code is wrong.');
    await env.DB.prepare(`INSERT INTO members (key_hash, name, role, daily_share, created_at) VALUES (?, ?, 'owner', 0, ?)`).bind(hash, String(body.name ?? 'Owner').slice(0, 40), Date.now()).run();
    return json({ ok: true, role: 'owner' });
  }
  if (path === '/v1/join' && req.method === 'POST') {
    if (!hash) return fail(400, 'The sync key is missing or not in the HSY-XXXX format.');
    const code = String(body.invite ?? '').trim().toUpperCase();
    const inv = await env.DB.prepare('SELECT * FROM invites WHERE code_hash = ? AND expires_at > ?').bind(await sha256(code), Date.now()).first<{ code_hash: string; name: string; daily_share: number }>();
    if (!inv) return fail(403, 'This invitation is not valid or has expired.');
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM members').first<{ n: number }>();
    if ((count?.n ?? 0) >= 3) return fail(403, 'This server already has three people.');
    await env.DB.prepare(`INSERT OR IGNORE INTO members (key_hash, name, role, daily_share, created_at) VALUES (?, ?, 'member', ?, ?)`).bind(hash, inv.name, inv.daily_share, Date.now()).run();
    await env.DB.prepare('DELETE FROM invites WHERE code_hash = ?').bind(inv.code_hash).run();
    return json({ ok: true, role: 'member' });
  }

  if (!member) return fail(401, 'This phone is not connected to the server. Enter your sync key in Settings.');

  if (path === '/v1/status' && req.method === 'GET') {
    const usage = usageStore(env, member.key_hash);
    const used = await usage.usedToday();
    const blocked = await usage.blockedUntil();
    const ce = callEnv(env);
    const byFeature = await env.DB.prepare('SELECT feature, SUM(requests) AS n FROM usage WHERE day = ? GROUP BY feature').bind(day()).all<{ feature: string; n: number }>();
    const mine = await env.DB.prepare('SELECT SUM(requests) AS n FROM usage WHERE day = ? AND member = ?').bind(day(), member.key_hash).first<{ n: number | null }>();
    const jobs = await env.DB.prepare(`SELECT id, title, state, total, done, next_run_at, last_error, updated_at FROM jobs WHERE member = ? AND state != 'cancelled' ORDER BY updated_at DESC LIMIT 20`).bind(member.key_hash).all();
    return json({
      member: { name: member.name, role: member.role, dailyShare: member.daily_share, usedToday: mine?.n ?? 0 },
      resetAt: nextReset(),
      features: Object.fromEntries(FEATURES.map((f) => [f, byFeature.results.find((r) => r.feature === f)?.n ?? 0])),
      providers: providersFor(env).map((p) => ({
        id: p.id,
        name: p.name,
        note: p.note,
        trains: p.trains,
        features: Object.keys(p.models),
        configured: p.kind === 'workers-ai' ? !!ce.ai : !!(p.keyName && ce.secrets[p.keyName]),
        usedToday: used[p.id] ?? 0,
        dailyLimit: p.dailyRequests,
        blockedUntil: blocked[p.id]?.until ?? null,
        blockedReason: blocked[p.id]?.reason ?? null,
      })),
      jobs: jobs.results,
    });
  }

  if (path === '/v1/translate' && req.method === 'POST') {
    if (await overShare(env, member)) return fail(429, 'Your share of today’s AI allowance is used up.', { retryAt: nextReset() });
    const b = body as unknown as TranslateBody;
    if (!Array.isArray(b.paragraphs) || !b.paragraphs.length) return fail(400, 'Nothing to translate.');
    if (b.paragraphs.reduce((n, p) => n + String(p.text ?? '').length, 0) > 12000) return fail(413, 'Send fewer paragraphs at once.');
    try {
      return json(await translateBatch(env, member.key_hash, b));
    } catch (e) {
      if (e instanceof NoProviderError) return fail(503, 'No free AI service is available right now.', { retryAt: e.retryAt, skipped: e.skipped });
      throw e;
    }
  }

  // A second check of translated paragraphs, by another service than the one that drafted them.
  if (path === '/v1/review' && req.method === 'POST') {
    if (await overShare(env, member)) return fail(429, 'Your share of today’s AI allowance is used up.', { retryAt: nextReset() });
    const b = body as unknown as { lang: SourceLang; items: ReviewItem[]; private?: boolean; avoid?: string };
    if (!Array.isArray(b.items) || !b.items.length) return fail(400, 'Nothing to check.');
    if (JSON.stringify(b).length > 60_000) return fail(413, 'Too much text at once.');
    const all = providersFor(env).map((p) => p.id);
    const prefer = [...all.filter((id) => id !== b.avoid), ...(b.avoid ? [b.avoid] : [])];
    try {
      const routed = await route(providersFor(env), callEnv(env), usageStore(env, member.key_hash), { feature: 'translate', private: !!b.private, prefer }, buildReviewMessages(b.lang, b.items, SEED_GLOSSARY), (text) => acceptReview(b.items, text));
      return json({ results: routed.value, provider: routed.provider, model: routed.model });
    } catch (e) {
      if (e instanceof NoProviderError) return fail(503, 'No free AI service is available right now.', { retryAt: e.retryAt, skipped: e.skipped });
      throw e;
    }
  }

  // Study: search words for a question, answers from the reader's passages, explanations, iʿrāb.
  if (path === '/v1/study' && req.method === 'POST') {
    if (await overShare(env, member)) return fail(429, 'Your share of today’s AI allowance is used up.', { retryAt: nextReset() });
    const t = body as unknown as StudyTask & { private?: boolean; prefer?: string[] };
    if (!['keywords', 'ask', 'debate', 'explain', 'summarise', 'quiz', 'irab'].includes(t.task)) return fail(400, 'Unknown task.');
    if (JSON.stringify(t).length > 60_000) return fail(413, 'Too much text at once.');
    try {
      const routed = await route(providersFor(env), callEnv(env), usageStore(env, member.key_hash), { feature: featureOf(t), private: !!t.private, prefer: t.prefer }, studyMessages(t), (text) => acceptStudy(t, text));
      return json({ result: routed.value, provider: routed.provider, model: routed.model });
    } catch (e) {
      if (e instanceof NoProviderError) return fail(503, 'No free AI service is available right now.', { retryAt: e.retryAt, skipped: e.skipped });
      throw e;
    }
  }

  // Whole-book jobs.
  if (path === '/v1/jobs' && req.method === 'POST') {
    const paragraphs = (body.paragraphs as Array<{ id: string; text: string; kind?: string; chapter?: string }>) ?? [];
    if (!paragraphs.length) return fail(400, 'Nothing to translate.');
    const id = crypto.randomUUID();
    const now = Date.now();
    await env.DB.prepare(`INSERT INTO jobs (id, member, book_key, title, lang, private, glossary, prefer, state, total, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`)
      .bind(id, member.key_hash, String(body.bookKey ?? ''), String(body.title ?? ''), String(body.lang ?? 'ar'), body.private ? 1 : 0, JSON.stringify(body.glossary ?? []), JSON.stringify(body.prefer ?? []), paragraphs.length, now, now).run();
    // D1 takes up to 100 statements per batch.
    for (let i = 0; i < paragraphs.length; i += 90) {
      await env.DB.batch(paragraphs.slice(i, i + 90).map((p, k) =>
        env.DB.prepare('INSERT INTO job_items (job_id, seq, pid, text, kind, chapter) VALUES (?, ?, ?, ?, ?, ?)').bind(id, i + k, String(p.id), String(p.text), String(p.kind ?? 'p'), p.chapter ?? null)));
    }
    // Start straight away rather than waiting for the next scheduled run.
    ctx.waitUntil(runJobs(env, 20_000));
    return json({ id, total: paragraphs.length });
  }
  const jobMatch = path.match(/^\/v1\/jobs\/([\w-]+)(\/results)?$/);
  if (jobMatch) {
    const job = await env.DB.prepare('SELECT * FROM jobs WHERE id = ? AND member = ?').bind(jobMatch[1], member.key_hash).first<JobRow>();
    if (!job) return fail(404, 'No such translation job.');
    if (req.method === 'DELETE') {
      await env.DB.prepare(`UPDATE jobs SET state = 'cancelled', updated_at = ? WHERE id = ?`).bind(Date.now(), job.id).run();
      await env.DB.prepare('DELETE FROM job_items WHERE job_id = ?').bind(job.id).run();
      return json({ ok: true });
    }
    if (jobMatch[2]) {
      const since = Number(url.searchParams.get('since') ?? 0);
      const rows = await env.DB.prepare(`SELECT pid, en, uncertain, provider, model, done_at FROM job_items WHERE job_id = ? AND status = 'done' AND done_at > ? ORDER BY done_at, seq LIMIT 400`).bind(job.id, since).all<{ pid: string; en: string; uncertain: string; provider: string; model: string; done_at: number }>();
      return json({ items: rows.results.map((r) => ({ ...r, uncertain: JSON.parse(r.uncertain || '[]') })), job });
    }
    return json({ job });
  }

  // Sync: each phone sends what changed on it, and asks for what changed elsewhere.
  if (path === '/v1/sync' && req.method === 'POST') {
    const device = String(body.device ?? '').slice(0, 64);
    const changes = (body.changes as Array<{ tbl: string; key: string; data: unknown }>) ?? [];
    if (!device) return fail(400, 'Missing device.');
    if (changes.length > 500) return fail(413, 'Send fewer changes at once.');
    const now = Date.now();
    for (let i = 0; i < changes.length; i += 45) {
      const stmts: D1PreparedStatement[] = [];
      for (const c of changes.slice(i, i + 45)) {
        if (!SYNC_TABLES.has(c.tbl) || !c.key) continue;
        const data = c.data === null || c.data === undefined ? null : JSON.stringify(c.data);
        if (data && data.length > 200_000) continue;
        // Replace the item's row so it gets a new sequence number.
        stmts.push(env.DB.prepare('DELETE FROM sync_log WHERE owner = ? AND tbl = ? AND key = ?').bind(member.key_hash, c.tbl, String(c.key)));
        stmts.push(env.DB.prepare('INSERT INTO sync_log (owner, tbl, key, data, device, at) VALUES (?, ?, ?, ?, ?, ?)').bind(member.key_hash, c.tbl, String(c.key), data, device, now));
      }
      if (stmts.length) await env.DB.batch(stmts);
    }
    const since = Number(body.since ?? 0);
    const rows = await env.DB.prepare('SELECT seq, tbl, key, data FROM sync_log WHERE owner = ? AND seq > ? AND device != ? ORDER BY seq LIMIT 1000')
      .bind(member.key_hash, since, device).all<{ seq: number; tbl: string; key: string; data: string | null }>();
    const top = await env.DB.prepare('SELECT MAX(seq) AS s FROM sync_log WHERE owner = ?').bind(member.key_hash).first<{ s: number | null }>();
    const last = rows.results.length ? rows.results[rows.results.length - 1].seq : Math.max(since, top?.s ?? 0);
    return json({
      changes: rows.results.map((r) => ({ tbl: r.tbl, key: r.key, data: r.data === null ? null : JSON.parse(r.data) })),
      cursor: rows.results.length === 1000 ? last : Math.max(last, top?.s ?? 0),
      more: rows.results.length === 1000,
    });
  }

  if (path === '/v1/invites' && req.method === 'POST') {
    if (member.role !== 'owner') return fail(403, 'Only the owner can invite people.');
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const rnd = crypto.getRandomValues(new Uint8Array(8));
    const code = `INV-${[...rnd.slice(0, 4)].map((b) => alphabet[b % 32]).join('')}-${[...rnd.slice(4)].map((b) => alphabet[b % 32]).join('')}`;
    await env.DB.prepare('INSERT INTO invites (code_hash, name, daily_share, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(code), String(body.name ?? 'Guest').slice(0, 40), Number(body.dailyShare ?? 0), Date.now() + 7 * 86_400_000).run();
    return json({ code, expiresAt: Date.now() + 7 * 86_400_000 });
  }

  return fail(404, 'Unknown request.');
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handle(req, env, ctx);
    } catch (e) {
      console.error(e);
      return fail(500, 'The server had a problem with this request. Nothing was lost; try again.');
    }
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runJobs(env));
  },
};
