import Dexie, { type Transaction } from 'dexie';
import { db, uid } from '../db/db';
import type { Book } from '../db/types';
import { getServer, request } from '../ai/client';

/**
 * Sync between one person's phones, through their private server and their HSY key.
 * Reading places, highlights, notes, bookmarks, references, folders, translations,
 * hand-corrected scan pages and settings travel; book files do not (each phone adds its
 * own copy, and the notes attach to it). Changes made offline wait in an outbox.
 */

const TABLES = ['books', 'folders', 'marks', 'refs', 'settings', 'translations', 'ocrPages'] as const;
type SyncTable = (typeof TABLES)[number];

/** Settings that follow the reader from phone to phone. */
const SYNC_SETTINGS = new Set(['theme', 'reader', 'coverStyle', 'flags', 'librarySort', 'ai', 'backupReminder']);

/** Fields of a book that sync; the rest (its text, import state, cover) belong to each phone. */
const BOOK_FIELDS = [
  'id', 'title', 'author', 'edition', 'lang', 'format', 'size', 'hash', 'fileName', 'addedAt', 'openedAt', 'status', 'folderId',
  'coverStyle', 'series', 'volume', 'progress', 'private', 'view', 'scanView', 'ocrLang', 'translation', 'pageCount',
] as const;

/** Is this row something that syncs at all? */
function syncable(tbl: SyncTable, key: string, row?: Record<string, unknown>): boolean {
  if (tbl === 'settings') return SYNC_SETTINGS.has(key);
  if (tbl === 'ocrPages') return !row || !!row.edited;
  return true;
}

// ------------------------------------------------------------------------------- recording changes

let pendingKeys: Array<{ tbl: SyncTable; key: string }> = [];
let flushTimer = 0;
const listeners = new Set<() => void>();

function note(trans: Transaction, tbl: SyncTable, key: string) {
  if ((trans as unknown as { __fromSync?: boolean }).__fromSync) return;
  pendingKeys.push({ tbl, key });
  trans.on('complete', () => {
    window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => void flush(), 250);
  });
}

async function flush() {
  const keys = pendingKeys;
  pendingKeys = [];
  if (!keys.length) return;
  const at = Date.now();
  // One entry per item: a book whose reading place changes a hundred times sends once.
  await db.outbox.bulkPut(keys.map((k) => ({ k: `${k.tbl}\u0000${k.key}`, ...k, at })));
  listeners.forEach((l) => l());
}

let installed = false;

/** Starts recording local changes for sync. Safe to call more than once. */
export function installSyncHooks() {
  if (installed) return;
  installed = true;
  for (const tbl of TABLES) {
    const table = db.table(tbl);
    table.hook('creating', function (primKey, obj, trans) {
      const row = obj as Record<string, unknown>;
      const key = String(primKey ?? (tbl === 'settings' ? row.key : row.id));
      if (syncable(tbl, key, row)) note(trans, tbl, key);
    });
    table.hook('updating', function (_mods, primKey, _obj, trans) {
      const key = String(primKey);
      if (syncable(tbl, key)) note(trans, tbl, key);
    });
    table.hook('deleting', function (primKey, _obj, trans) {
      const key = String(primKey);
      if (syncable(tbl, key)) note(trans, tbl, key);
    });
  }
}

/** Puts everything already in the library into the outbox, for a phone's first sync. */
export async function queueEverything(): Promise<void> {
  const at = Date.now();
  for (const tbl of TABLES) {
    const keys = (await db.table(tbl).toCollection().primaryKeys()).map(String).filter((k) => syncable(tbl, k));
    for (let i = 0; i < keys.length; i += 500) await db.outbox.bulkPut(keys.slice(i, i + 500).map((key) => ({ k: `${tbl}\u0000${key}`, tbl, key, at })));
  }
}

// ------------------------------------------------------------------------------- sending and receiving

async function local(key: string): Promise<unknown> {
  return (await db.settings.get(key))?.value;
}
async function setLocal(key: string, value: unknown) {
  await db.settings.put({ key, value });
}

export async function deviceId(): Promise<string> {
  let id = (await local('deviceId')) as string | undefined;
  if (!id) {
    id = uid();
    await setLocal('deviceId', id);
  }
  return id;
}

function outgoing(tbl: SyncTable, row: Record<string, unknown> | undefined): unknown {
  if (!row) return null;
  if (tbl === 'books') return Object.fromEntries(BOOK_FIELDS.filter((f) => row[f] !== undefined).map((f) => [f, row[f]]));
  if (tbl === 'ocrPages' && !row.edited) return undefined;
  return row;
}

async function applyIncoming(changes: Array<{ tbl: string; key: string; data: unknown }>) {
  if (!changes.length) return;
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    (Dexie.currentTransaction as unknown as { __fromSync?: boolean }).__fromSync = true;
    for (const c of changes) {
      const tbl = c.tbl as SyncTable;
      if (!(TABLES as readonly string[]).includes(tbl)) continue;
      if (tbl === 'settings' && !SYNC_SETTINGS.has(c.key)) continue;
      const table = db.table(tbl);
      if (c.data === null) {
        // A book removed on another phone keeps its file here; only a placeholder goes.
        if (tbl === 'books') {
          const here = await db.books.get(c.key);
          if (here && here.import.state !== 'missing') continue;
        }
        await table.delete(c.key);
        continue;
      }
      if (tbl === 'books') {
        const incoming = c.data as Partial<Book>;
        const here = await db.books.get(c.key);
        if (here) await db.books.put({ ...here, ...incoming });
        else {
          await db.books.put({
            kind: 'text', hasCover: false, sectionCount: 0, sectionChars: [], toc: [], status: 'want', author: '', lang: 'other',
            format: 'pdf', size: 0, hash: '', fileName: '', addedAt: Date.now(), title: 'Book',
            ...incoming,
            import: { state: 'missing', done: 0, total: 0 },
          } as Book);
        }
        continue;
      }
      await table.put(c.data);
    }
  });
}

export interface SyncState {
  pending: number;
  lastSyncAt?: number;
  error?: string;
  syncing: boolean;
}

let state: SyncState = { pending: 0, syncing: false };
const stateListeners = new Set<(s: SyncState) => void>();
const setState = (s: Partial<SyncState>) => {
  state = { ...state, ...s };
  stateListeners.forEach((l) => l(state));
};
export const onSyncState = (fn: (s: SyncState) => void) => {
  stateListeners.add(fn);
  fn(state);
  return () => {
    stateListeners.delete(fn);
  };
};

let running: Promise<void> | null = null;

/** Sends what is waiting and collects what changed on the other phones. */
export function syncNow(): Promise<void> {
  if (!running) running = doSync().finally(() => (running = null));
  return running;
}

async function doSync() {
  const cfg = await getServer();
  if (!cfg) return;
  await flush();
  setState({ syncing: true, pending: await db.outbox.count() });
  try {
    const device = await deviceId();
    if (!(await local('syncSeeded'))) {
      await queueEverything();
      await setLocal('syncSeeded', true);
    }
    let cursor = ((await local('syncCursor')) as number | undefined) ?? 0;
    for (let round = 0; round < 200; round++) {
      const batch = await db.outbox.orderBy('at').limit(300).toArray();
      const changes: Array<{ tbl: string; key: string; data: unknown }> = [];
      for (const e of batch) {
        const row = (await db.table(e.tbl).get(e.key)) as Record<string, unknown> | undefined;
        const data = outgoing(e.tbl as SyncTable, row);
        if (data !== undefined) changes.push({ tbl: e.tbl, key: e.key, data });
      }
      const res = await request<{ changes: Array<{ tbl: string; key: string; data: unknown }>; cursor: number; more: boolean }>('/v1/sync', {
        body: { device, since: cursor, changes },
        timeoutMs: 60_000,
      });
      await applyIncoming(res.changes);
      // Only clear entries that have not changed again while this was being sent.
      await db.transaction('rw', db.outbox, async () => {
        for (const b of batch) {
          const now = await db.outbox.get(b.k);
          if (now && now.at === b.at) await db.outbox.delete(b.k);
        }
      });
      cursor = res.cursor;
      await setLocal('syncCursor', cursor);
      if (!res.more && batch.length < 300) break;
    }
    setState({ syncing: false, lastSyncAt: Date.now(), error: undefined, pending: await db.outbox.count() });
  } catch (e) {
    setState({ syncing: false, error: (e as Error).message, pending: await db.outbox.count() });
  }
}

/** Keeps phones in step: soon after each change, every two minutes, and when back online. */
export function startAutoSync(): () => void {
  installSyncHooks();
  let timer = 0;
  const soon = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void syncNow(), 4000);
    void db.outbox.count().then((pending) => setState({ pending }));
  };
  listeners.add(soon);
  const every = window.setInterval(() => void syncNow(), 120_000);
  const online = () => void syncNow();
  window.addEventListener('online', online);
  void syncNow();
  return () => {
    listeners.delete(soon);
    window.clearInterval(every);
    window.removeEventListener('online', online);
  };
}
