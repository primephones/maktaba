import { db } from '../db/db';
import { isAndroidApp, plugin } from '../native/maktaba';

/**
 * The reader's own Google Drive. Maktaba asks only for "the files this app makes": it
 * cannot see anything else in the reader's Drive. Everything goes in a folder called
 * Maktaba: the original book files in Maktaba/Books, and the reader's notes, places and
 * other study data in Maktaba/Sync.
 *
 * Signing in: on Android with the phone's own Google account picker (Google refuses
 * sign-in inside an app's web view); on the web with Google's sign-in window.
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? '';

export interface CloudConfig {
  provider: 'gdrive';
  email?: string;
  name?: string;
  folders?: { root: string; books: string; sync: string };
  /** For tests only: a stand-in for Google's servers. */
  apiBase?: string;
  /** For tests only: a fixed token. */
  testToken?: string;
}

export async function getCloud(): Promise<CloudConfig | null> {
  return ((await db.settings.get('cloud'))?.value as CloudConfig | undefined) ?? null;
}

export async function setCloud(c: CloudConfig | null) {
  if (c) await db.settings.put({ key: 'cloud', value: c });
  else await db.settings.delete('cloud');
  token = null;
  window.dispatchEvent(new Event('maktaba:connected'));
}

/** Can this copy of the app sign in to Google at all? (The web needs the app's Google ID.) */
export const cloudAvailable = () => isAndroidApp() || !!CLIENT_ID;

export class CloudError extends Error {
  constructor(message: string, readonly status = 0, readonly needsSignIn = false) {
    super(message);
  }
}

// ------------------------------------------------------------------------------- signing in

let token: { value: string; expires: number } | null = null;

interface Gis {
  accounts: { oauth2: { initTokenClient(o: { client_id: string; scope: string; prompt?: string; callback: (r: { access_token?: string; expires_in?: number; error?: string }) => void; error_callback?: (e: { type: string }) => void }): { requestAccessToken(o?: { prompt?: string }): void } } };
}

let gisLoading: Promise<Gis> | null = null;
function loadGis(): Promise<Gis> {
  const w = window as unknown as { google?: Gis };
  if (w.google?.accounts) return Promise.resolve(w.google);
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (w.google ? resolve(w.google) : reject(new CloudError('Google sign-in did not load.')));
    s.onerror = () => {
      gisLoading = null;
      reject(new CloudError('Google sign-in could not be reached. Check your internet connection.'));
    };
    document.head.appendChild(s);
  });
  return gisLoading;
}

/** A fresh access token; asks the reader only when `interactive` (a tap on Connect). */
export async function accessToken(interactive = false): Promise<string> {
  const cfg = await getCloud();
  if (cfg?.testToken) return cfg.testToken;
  if (token && token.expires > Date.now() + 60_000) return token.value;
  if (isAndroidApp()) {
    try {
      const r = await plugin.googleAuthorize({ scopes: [DRIVE_SCOPE], interactive });
      // Android hands out tokens that last about an hour.
      token = { value: r.accessToken, expires: Date.now() + 50 * 60_000 };
      return token.value;
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      if (/NEEDS_CONSENT/.test(msg)) throw new CloudError('Sign in to your Google Drive again.', 401, true);
      if (/CANCELLED/.test(msg)) throw new CloudError('Signing in was cancelled.', 0, true);
      // Google refuses an app it has not been told about (the one-time setup, step 2 of the
      // setup guide, is not finished yet). Say so plainly rather than show Google's code.
      if (/DEVELOPER_ERROR|\b10:|28444|not set up correctly|UNREGISTERED_ON_API_CONSOLE|API_NOT_CONNECTED/i.test(msg))
        throw new CloudError('Google Drive sign-in is not switched on for this app yet: the app’s owner still has to register it with Google (a one-time step in the setup guide). Until then, Settings › Backup moves your library by file.', 0, true);
      throw new CloudError(msg, 0, true);
    }
  }
  if (!CLIENT_ID) throw new CloudError('Google sign-in is not set up for this copy of Maktaba yet.');
  const gis = await loadGis();
  return new Promise((resolve, reject) => {
    const client = gis.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (r) => {
        if (!r.access_token) {
          reject(new CloudError(r.error === 'access_denied' ? 'Access to Google Drive was not given.' : 'Google did not sign you in.', 401, true));
          return;
        }
        token = { value: r.access_token, expires: Date.now() + (r.expires_in ?? 3600) * 1000 };
        resolve(token.value);
      },
      error_callback: (e) => reject(new CloudError(e.type === 'popup_closed' ? 'Signing in was cancelled.' : 'Google sign-in could not open.', 0, true)),
    });
    // After the first time Google answers without asking again (a window may flash).
    client.requestAccessToken({ prompt: interactive ? 'select_account' : '' });
  });
}

// ------------------------------------------------------------------------------- Drive calls

export interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
  appProperties?: Record<string, string>;
}

async function api(path: string, init: RequestInit & { upload?: boolean; raw?: boolean } = {}): Promise<Response> {
  const cfg = await getCloud();
  const base = cfg?.apiBase ?? 'https://www.googleapis.com';
  const url = `${base}${init.upload ? '/upload' : ''}/drive/v3${path}`;
  for (let attempt = 0; ; attempt++) {
    const t = await accessToken(false);
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${t}` } });
    } catch {
      throw new CloudError('Your Google Drive could not be reached. Check your internet connection.');
    }
    if (res.status === 401 && attempt === 0) {
      token = null;
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (!res.ok && !init.raw) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new CloudError(body.error?.message ?? `Google Drive answered with an error (${res.status}).`, res.status, res.status === 401);
    }
    return res;
  }
}

const json = async <T>(p: Promise<Response>) => (await p).json() as Promise<T>;

export async function listFiles(q: string, fields = 'id,name,mimeType,size,createdTime,modifiedTime,appProperties', orderBy = 'createdTime'): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let page: string | undefined;
  do {
    const params = new URLSearchParams({ q, fields: `nextPageToken,files(${fields})`, pageSize: '1000', orderBy, spaces: 'drive' });
    if (page) params.set('pageToken', page);
    const r = await json<{ files: DriveFile[]; nextPageToken?: string }>(api(`/files?${params}`));
    out.push(...r.files);
    page = r.nextPageToken;
  } while (page);
  return out;
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function folder(name: string, parent?: string): Promise<string> {
  const q = `name = '${esc(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false${parent ? ` and '${parent}' in parents` : ''}`;
  const found = await listFiles(q, 'id,name');
  if (found[0]) return found[0].id;
  const made = await json<DriveFile>(
    api('/files?fields=id', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: parent ? [parent] : undefined }) }),
  );
  return made.id;
}

let making: Promise<NonNullable<CloudConfig['folders']>> | null = null;

/**
 * The Maktaba folders in the reader's Drive, made the first time. Only one look-up runs at
 * once: two parts of the app asking together must not each make their own folders.
 */
export function ensureFolders(): Promise<NonNullable<CloudConfig['folders']>> {
  making ??= (async () => {
    const cfg = await getCloud();
    if (cfg?.folders) return cfg.folders;
    const root = await folder('Maktaba');
    const folders = { root, books: await folder('Books', root), sync: await folder('Sync', root) };
    const now = await getCloud();
    if (now) await db.settings.put({ key: 'cloud', value: { ...now, folders } });
    return folders;
  })().finally(() => (making = null));
  return making;
}

/** Who is signed in, for the settings screen. */
export async function whoAmI(): Promise<{ email?: string; name?: string }> {
  const r = await json<{ user?: { emailAddress?: string; displayName?: string } }>(api('/about?fields=user(emailAddress,displayName)'));
  return { email: r.user?.emailAddress, name: r.user?.displayName };
}

/** Uploads a small file (study data) in one request. */
export async function uploadSmall(name: string, parent: string, body: Blob, appProperties: Record<string, string> = {}): Promise<DriveFile> {
  const boundary = `maktaba${Math.random().toString(36).slice(2)}`;
  const meta = JSON.stringify({ name, parents: [parent], appProperties });
  const payload = new Blob([
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: ${body.type || 'application/octet-stream'}\r\n\r\n`,
    body,
    `\r\n--${boundary}--`,
  ]);
  return json<DriveFile>(api('/files?uploadType=multipart&fields=id,name,createdTime,appProperties', { method: 'POST', upload: true, headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body: payload }));
}

const CHUNK = 8 * 1024 * 1024;

/** Uploads a book file in pieces, so a large PDF survives a poor connection. */
export async function uploadLarge(name: string, parent: string, blob: Blob, appProperties: Record<string, string>, onProgress?: (done: number, total: number) => void): Promise<DriveFile> {
  if (blob.size <= 4 * 1024 * 1024) return uploadSmall(name, parent, blob, appProperties);
  const start = await api('/files?uploadType=resumable&fields=id,name,createdTime,appProperties', {
    method: 'POST',
    upload: true,
    headers: { 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': blob.type || 'application/octet-stream', 'x-upload-content-length': String(blob.size) },
    body: JSON.stringify({ name, parents: [parent], appProperties }),
  });
  const session = start.headers.get('location');
  if (!session) throw new CloudError('Google Drive did not start the upload.');
  for (let at = 0; at < blob.size; ) {
    const end = Math.min(blob.size, at + CHUNK);
    const t = await accessToken(false);
    const res = await fetch(session, {
      method: 'PUT',
      headers: { authorization: `Bearer ${t}`, 'content-range': `bytes ${at}-${end - 1}/${blob.size}` },
      body: blob.slice(at, end),
    });
    if (res.status === 308) {
      const range = res.headers.get('range');
      at = range ? Number(range.split('-')[1]) + 1 : end;
      onProgress?.(at, blob.size);
      continue;
    }
    if (!res.ok) throw new CloudError(`The upload stopped (${res.status}). It will be tried again.`, res.status);
    onProgress?.(blob.size, blob.size);
    return (await res.json()) as DriveFile;
  }
  throw new CloudError('The upload did not finish.');
}

export async function download(id: string): Promise<Blob> {
  return (await api(`/files/${encodeURIComponent(id)}?alt=media`)).blob();
}

export async function downloadJson<T>(id: string): Promise<T> {
  return json<T>(api(`/files/${encodeURIComponent(id)}?alt=media`));
}

export async function remove(id: string): Promise<void> {
  const res = await api(`/files/${encodeURIComponent(id)}`, { method: 'DELETE', raw: true });
  if (!res.ok && res.status !== 404) throw new CloudError(`Could not remove a file from Google Drive (${res.status}).`, res.status);
}

/** Space in the reader's Drive (all of it, shared with Gmail and Photos), in bytes. */
export async function driveSpace(): Promise<{ limit?: number; usage: number }> {
  const r = await json<{ storageQuota?: { limit?: string; usage?: string } }>(api('/about?fields=storageQuota(limit,usage)'));
  return { limit: r.storageQuota?.limit ? Number(r.storageQuota.limit) : undefined, usage: Number(r.storageQuota?.usage ?? 0) };
}
