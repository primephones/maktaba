import { Unzip, UnzipInflate, Zip, ZipDeflate, ZipPassThrough, strFromU8, strToU8 } from 'fflate';
import { db } from '../db/db';

/**
 * One-file backup of everything: books and their files, reading places, highlights, notes,
 * bookmarks, references, recognised text, translations, folders and settings. The sync
 * key is left out, so a backup file that goes astray cannot be used to reach the server.
 */

const TABLES = ['books', 'sections', 'folders', 'marks', 'refs', 'settings', 'ocrPages', 'translations'] as const;
type TableName = (typeof TABLES)[number];
const ROWS_PER_PART = 300;
const SKIP_SETTINGS = new Set(['server', 'aiStatus']);

export interface Progress {
  stage: string;
  done: number;
  total: number;
}

export async function createBackup(onProgress?: (p: Progress) => void): Promise<Blob> {
  const parts: BlobPart[] = [];
  let failure: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) failure = err;
    else parts.push(chunk.slice());
  });
  const addText = (name: string, text: string) => {
    const f = new ZipDeflate(name, { level: 6 });
    zip.add(f);
    f.push(strToU8(text), true);
  };
  const addBlob = async (name: string, blob: Blob) => {
    const f = new ZipPassThrough(name);
    zip.add(f);
    const reader = blob.stream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      f.push(value);
    }
    f.push(new Uint8Array(0), true);
  };

  const counts: Record<string, number> = {};
  for (const t of TABLES) counts[t] = await db.table(t).count();
  const fileKeys = await db.files.toCollection().primaryKeys();
  const coverKeys = await db.covers.toCollection().primaryKeys();
  const assetKeys = await db.assets.toCollection().primaryKeys();
  const total = TABLES.reduce((n, t) => n + counts[t], 0) + fileKeys.length + coverKeys.length + assetKeys.length;
  let done = 0;
  const tick = (stage: string, n = 1) => {
    done += n;
    onProgress?.({ stage, done, total });
  };

  addText('manifest.json', JSON.stringify({ app: 'maktaba', format: 1, createdAt: Date.now(), counts }, null, 1));
  for (const t of TABLES) {
    let part = 0;
    let offset = 0;
    for (;;) {
      let rows = await db.table(t).offset(offset).limit(ROWS_PER_PART).toArray();
      if (!rows.length) break;
      offset += rows.length;
      if (t === 'settings') rows = rows.filter((r: { key: string }) => !SKIP_SETTINGS.has(r.key));
      addText(`tables/${t}/${String(part++).padStart(5, '0')}.json`, JSON.stringify(rows));
      tick('Saving your library', rows.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  for (const k of fileKeys) {
    const rec = await db.files.get(k);
    if (rec) await addBlob(`files/${encodeURIComponent(k)}`, rec.blob);
    tick('Saving book files');
  }
  for (const k of coverKeys) {
    const rec = await db.covers.get(k);
    if (rec) await addBlob(`covers/${encodeURIComponent(k)}`, rec.blob);
    tick('Saving covers');
  }
  for (const k of assetKeys) {
    const rec = await db.assets.get(k);
    if (rec) await addBlob(`assets/${encodeURIComponent(k)}`, rec.blob);
    tick('Saving pictures');
  }
  zip.end();
  if (failure) throw failure;
  return new Blob(parts, { type: 'application/zip' });
}

export interface RestoreResult {
  books: number;
  createdAt: number;
}

/**
 * Restores a backup into this library. Items already here with the same identity are
 * replaced by the backup's copy; everything else here is kept.
 */
export async function restoreBackup(file: Blob, onProgress?: (p: Progress) => void): Promise<RestoreResult> {
  const pending: Array<Promise<void>> = [];
  let manifest: { app?: string; createdAt?: number } | null = null;
  let books = 0;
  let failure: Error | null = null;

  const unzip = new Unzip((entry) => {
    const chunks: Uint8Array[] = [];
    entry.ondata = (err, data, final) => {
      if (err) {
        failure = err;
        return;
      }
      chunks.push(data);
      if (!final) return;
      const size = chunks.reduce((n, c) => n + c.length, 0);
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        bytes.set(c, at);
        at += c.length;
      }
      pending.push(store(entry.name, bytes));
    };
    entry.start();
  });
  unzip.register(UnzipInflate);

  const store = async (name: string, bytes: Uint8Array) => {
    if (name === 'manifest.json') {
      manifest = JSON.parse(strFromU8(bytes));
      return;
    }
    const table = name.match(/^tables\/(\w+)\//)?.[1] as TableName | undefined;
    if (table && (TABLES as readonly string[]).includes(table)) {
      const rows = JSON.parse(strFromU8(bytes)) as unknown[];
      await db.table(table).bulkPut(rows);
      if (table === 'books') books += rows.length;
      return;
    }
    const [kind, rawKey] = name.split('/');
    if (!rawKey) return;
    const key = decodeURIComponent(rawKey);
    const blob = new Blob([bytes as BlobPart]);
    if (kind === 'files') await db.files.put({ bookId: key, blob });
    else if (kind === 'covers') await db.covers.put({ bookId: key, blob });
    else if (kind === 'assets') await db.assets.put({ id: key, bookId: key.split(':')[0], blob });
  };

  const reader = file.stream().getReader();
  let read = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      unzip.push(new Uint8Array(0), true);
      break;
    }
    unzip.push(value);
    read += value.length;
    onProgress?.({ stage: 'Restoring', done: read, total: file.size });
    // Write what has been read before reading more, so memory stays small.
    if (pending.length > 20) await Promise.all(pending.splice(0));
  }
  await Promise.all(pending);
  if (failure) throw failure;
  if (!manifest || (manifest as { app?: string }).app !== 'maktaba') throw new Error('This file is not a Maktaba backup.');
  // Imports that were half-done when the backup was made carry on.
  await db.books.filter((b) => b.import.state === 'processing').modify((b) => {
    b.import.state = 'queued';
  });
  return { books, createdAt: (manifest as { createdAt?: number }).createdAt ?? 0 };
}

export const backupName = () => `Maktaba backup ${new Date().toISOString().slice(0, 10)}.maktaba`;
