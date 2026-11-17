import { db } from '../db/db';
import type { Book } from '../db/types';
import { download, downloadJson, ensureFolders, listFiles, remove, uploadLarge, uploadSmall, type DriveFile } from '../cloud/drive';
import { local, outgoing, setLocal, syncable, TABLES, type Change, type SyncTable } from './sync';

/**
 * Sync through the reader's own Google Drive, with no server of anyone's in between.
 *
 * Each phone writes what changed on it as a small file in Maktaba/Sync, and reads the
 * files the other phones wrote since it last looked. Every change carries its time, and
 * the newest change to an item wins. Now and then a phone writes a snapshot of everything
 * and clears out old change files, so a new phone has little to read.
 *
 * The original book files go to Maktaba/Books, once each; a phone missing a book's file
 * fetches it from there by itself.
 */

/** Change files older than a snapshot by this much are cleared away. */
const KEEP_AFTER_SNAPSHOT = 7 * 86_400_000;
/** Drive's clock and listing can lag a little: always look back this far, and skip what was seen. */
const OVERLAP = 5 * 60_000;
const SNAPSHOT_AFTER = 300;

interface Cursor {
  time: number;
  seen: string[];
}

export function cloudTransport() {
  return {
    seededKey: 'cloudSeeded',
    async exchange(device: string, out: Change[]) {
      const { sync } = await ensureFolders();
      if (out.length) {
        const body = new Blob([JSON.stringify({ device, changes: out })], { type: 'application/json' });
        await uploadSmall(`${device}-${Date.now()}.json`, sync, body, { device, kind: 'changes' });
      }
      return { incoming: await pull(device, sync), more: false };
    },
    async after() {
      await compactIfNeeded();
      await syncFiles();
    },
  };
}

async function pull(device: string, sync: string): Promise<Change[]> {
  const cursor = ((await local('cloudCursor')) as Cursor | undefined) ?? { time: 0, seen: [] };
  const since = new Date(Math.max(0, cursor.time - OVERLAP)).toISOString();
  const files = await listFiles(`'${sync}' in parents and trashed = false and createdTime > '${since}'`);
  const seen = new Set(cursor.seen);
  const fresh = files.filter((f) => !seen.has(f.id) && f.appProperties?.device !== device);
  const incoming: Change[] = [];
  // A snapshot first (it holds everything), then the changes, oldest first.
  fresh.sort((a, b) => (a.appProperties?.kind === 'snapshot' ? -1 : 0) - (b.appProperties?.kind === 'snapshot' ? -1 : 0) || time(a) - time(b));
  for (const f of fresh) {
    const data = await downloadJson<{ changes: Change[] }>(f.id).catch(() => null);
    if (data?.changes) incoming.push(...data.changes);
  }
  const newest = Math.max(cursor.time, ...files.map(time));
  const keep = files.filter((f) => time(f) > newest - OVERLAP).map((f) => f.id);
  await setLocal('cloudCursor', { time: newest, seen: keep } satisfies Cursor);
  await setLocal('cloudFileCount', await countChangeFiles(sync));
  return incoming;
}

const time = (f: DriveFile) => (f.createdTime ? Date.parse(f.createdTime) : 0);

async function countChangeFiles(sync: string): Promise<number> {
  return (await listFiles(`'${sync}' in parents and trashed = false`, 'id')).length;
}

/**
 * When the Sync folder fills up, one phone writes a snapshot of the whole library's study
 * data and removes change files well older than it (and older snapshots).
 */
async function compactIfNeeded() {
  const count = ((await local('cloudFileCount')) as number | undefined) ?? 0;
  if (count < SNAPSHOT_AFTER) return;
  const { sync } = await ensureFolders();
  const device = (await local('deviceId')) as string;
  const changes: Change[] = [];
  for (const tbl of TABLES) {
    const rows = (await db.table(tbl).toArray()) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const key = String(tbl === 'settings' ? row.key : row.id);
      if (!syncable(tbl as SyncTable, key, row)) continue;
      const data = outgoing(tbl as SyncTable, row);
      if (data === undefined) continue;
      const stamp = await db.syncStamps.get(`${tbl}\u0000${key}`);
      changes.push({ tbl, key, data, at: stamp?.at ?? 1 });
    }
  }
  const made = await uploadSmall(`snapshot-${device}-${Date.now()}.json`, sync, new Blob([JSON.stringify({ device, changes })], { type: 'application/json' }), { device, kind: 'snapshot' });
  const cutoff = (made.createdTime ? Date.parse(made.createdTime) : Date.now()) - KEEP_AFTER_SNAPSHOT;
  const all = await listFiles(`'${sync}' in parents and trashed = false`);
  for (const f of all) {
    if (f.id === made.id) continue;
    if (f.appProperties?.kind === 'snapshot' || time(f) < cutoff) await remove(f.id).catch(() => undefined);
  }
  await setLocal('cloudFileCount', 0);
}

// ------------------------------------------------------------------------------- book files

export interface FileSyncState {
  uploading?: string;
  downloading?: string;
  inCloud: number;
  total: number;
}
const fileListeners = new Set<(s: FileSyncState) => void>();
let fileState: FileSyncState = { inCloud: 0, total: 0 };
const setFiles = (s: Partial<FileSyncState>) => {
  fileState = { ...fileState, ...s };
  fileListeners.forEach((l) => l(fileState));
};
export const onFileSync = (fn: (s: FileSyncState) => void) => {
  fileListeners.add(fn);
  fn(fileState);
  return () => {
    fileListeners.delete(fn);
  };
};

const extOf = (b: Book) => (b.fileName.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? `.${b.format}`);

/** Uploads originals not yet in the reader's Drive, and fetches ones this phone lacks. */
async function syncFiles() {
  const { books } = await ensureFolders();
  const inDrive = await listFiles(`'${books}' in parents and trashed = false`, 'id,name,size,appProperties');
  const byHash = new Map(inDrive.filter((f) => f.appProperties?.hash).map((f) => [f.appProperties!.hash, f]));
  const all = await db.books.toArray();
  setFiles({ total: all.length, inCloud: all.filter((b) => byHash.has(b.hash) || b.cloudFileId).length });

  // Up: every book whose file is here and not yet in the cloud.
  for (const b of all) {
    if (b.import.state === 'missing' || !b.hash) continue;
    const there = byHash.get(b.hash);
    if (there) {
      if (b.cloudFileId !== there.id) await db.books.update(b.id, { cloudFileId: there.id });
      continue;
    }
    const rec = await db.files.get(b.id);
    if (!rec) continue;
    setFiles({ uploading: b.title });
    try {
      const made = await uploadLarge(`${b.title.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 120)}${extOf(b)}`, books, rec.blob, { hash: b.hash, bookId: b.id, fileName: b.fileName.slice(0, 100) });
      byHash.set(b.hash, made);
      await db.books.update(b.id, { cloudFileId: made.id });
      setFiles({ inCloud: fileState.inCloud + 1 });
    } finally {
      setFiles({ uploading: undefined });
    }
  }

  // Down: books that arrived from another phone without their file.
  if ((await local('cloudDownloadsOff')) === true) return;
  const missing = (await db.books.toArray()).filter((b) => b.import.state === 'missing');
  if (!missing.length) return;
  const { addFiles } = await import('../import');
  for (const b of missing) {
    const f = (b.cloudFileId && inDrive.find((x) => x.id === b.cloudFileId)) || byHash.get(b.hash);
    if (!f) continue;
    setFiles({ downloading: b.title });
    try {
      const blob = await download(f.id);
      await addFiles([new File([blob], b.fileName || f.name, { type: blob.type })]);
    } finally {
      setFiles({ downloading: undefined });
    }
  }
}
