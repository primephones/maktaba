import { db } from '../db/db';

/**
 * Talking to the private Maktaba server. Every call has a time limit and a plain message
 * when it fails, so no screen ever sits on "Checking…".
 */

export interface ServerConfig {
  url: string;
  key: string;
  role?: 'owner' | 'member';
}

export interface ProviderStatus {
  id: string;
  name: string;
  note: string;
  trains: boolean | 'unknown';
  features: string[];
  configured: boolean;
  usedToday: number;
  dailyLimit: number;
  blockedUntil: number | null;
  blockedReason: string | null;
  /** Models of this service resting now (busy for a moment, or used up for the day), and why. */
  resting?: Array<{ model: string; reason: string; until: number }>;
}

export interface JobStatus {
  id: string;
  title: string;
  state: 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'cancelled';
  total: number;
  done: number;
  next_run_at: number;
  last_error: string | null;
}

export interface ServerStatus {
  member: { name: string; role: string; dailyShare: number; usedToday: number };
  resetAt: number;
  features: Record<string, number>;
  providers: ProviderStatus[];
  jobs: JobStatus[];
  /** When this was fetched (kept for showing while offline). */
  fetchedAt: number;
}

export class ServerError extends Error {
  constructor(message: string, readonly status: number, readonly data: Record<string, unknown> = {}) {
    super(message);
  }
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A new private sync key: HSY- and five groups of four (100 bits of randomness). */
export function newSyncKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const groups: string[] = [];
  for (let g = 0; g < 5; g++) groups.push([...bytes.slice(g * 4, g * 4 + 4)].map((b) => ALPHABET[b % 32]).join(''));
  return `HSY-${groups.join('-')}`;
}

/** Tidies a typed key: capitals, no spaces, dashes in the right places. */
export function normalizeKey(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^HSY/, '');
  if (raw.length !== 20 || /[IO01]/.test(raw)) return null;
  return `HSY-${raw.match(/.{4}/g)!.join('-')}`;
}

export async function getServer(): Promise<ServerConfig | null> {
  const rec = await db.settings.get('server');
  return (rec?.value as ServerConfig | undefined) ?? null;
}

export async function setServer(cfg: ServerConfig | null): Promise<void> {
  if (cfg) await db.settings.put({ key: 'server', value: cfg });
  else await db.settings.delete('server');
}

/** Requests the reader's own AI can answer on the phone, without a server. */
const ON_PHONE = /^\/v1\/(status|translate|review|study|jobs)(\/|$|\?)/;

/**
 * Is AI set up on this phone, one way or the other: the reader's own AI account, or a
 * private Maktaba server?
 */
export async function aiReady(): Promise<boolean> {
  const { getMyAi, hasMyAi } = await import('./device');
  return hasMyAi(await getMyAi()) || !!(await getServer());
}

export async function request<T>(path: string, opts: { method?: string; body?: unknown; timeoutMs?: number; cfg?: ServerConfig } = {}): Promise<T> {
  // The reader's own AI answers on the phone itself; a server is only for what it cannot do.
  if (!opts.cfg && ON_PHONE.test(path)) {
    const { getMyAi, hasMyAi, handle, DeviceError } = await import('./device');
    if (hasMyAi(await getMyAi())) {
      if (path !== '/v1/status' && typeof navigator !== 'undefined' && navigator.onLine === false) throw new ServerError('You are offline.', 0);
      try {
        return (await handle(path, opts.method ?? (opts.body ? 'POST' : 'GET'), opts.body as Record<string, unknown> | undefined)) as T;
      } catch (e) {
        if (e instanceof DeviceError) throw new ServerError(e.message, e.status, e.data);
        throw new ServerError((e as Error).message || 'Your AI could not be reached.', 0);
      }
    }
  }
  const cfg = opts.cfg ?? (await getServer());
  if (!cfg) throw new ServerError('Connect your AI first, in Settings › AI.', 0);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ServerError('You are offline.', 0);
  let res: Response;
  try {
    res = await fetch(cfg.url.replace(/\/+$/, '') + path, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}` },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (e) {
    const timeout = (e as Error)?.name === 'TimeoutError';
    throw new ServerError(timeout ? 'The server took too long to answer.' : 'The server could not be reached.', 0);
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ServerError(String(data.error ?? `The server answered with an error (${res.status}).`), res.status, data);
  return data as T;
}

/** Fetches the server's status, keeping the last answer for when it cannot be reached. */
export async function fetchStatus(cfg?: ServerConfig): Promise<{ status: ServerStatus | null; error?: string; stale: boolean }> {
  const store = cfg ? 'serverStatus' : 'aiStatus';
  const last = (await db.settings.get(store))?.value as ServerStatus | undefined;
  try {
    const s = await request<Omit<ServerStatus, 'fetchedAt'>>('/v1/status', { timeoutMs: 8000, cfg });
    const status = { ...s, fetchedAt: Date.now() };
    await db.settings.put({ key: store, value: status });
    return { status, stale: false };
  } catch (e) {
    return { status: last ?? null, error: (e as Error).message, stale: true };
  }
}
