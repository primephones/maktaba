import { isAndroidApp, native, plugin } from '../native/maktaba';
import { local, setLocal } from '../sync/sync';

/**
 * Updating the Android app from inside itself. New builds are published as releases on
 * GitHub (tagged build-N, with the APK attached). The app asks GitHub for the newest one,
 * and if it is newer than the installed build it offers it: the APK is downloaded, checked
 * to be signed with the same key as the app (so Android installs it over this one, keeping
 * the library), and handed to Android's installer.
 */

const RELEASES = 'https://api.github.com/repos/primephones/maktaba/releases?per_page=15';
export const RELEASES_PAGE = 'https://github.com/primephones/maktaba/releases/latest';
/** How often to look, at most (GitHub allows sixty unauthenticated requests an hour). */
const CHECK_EVERY = 4 * 3600_000;

export interface AvailableUpdate {
  build: number;
  current: number;
  url: string;
  size: number;
  /** What changed, from the release notes. */
  notes: string[];
  publishedAt?: string;
  page: string;
}

interface Release {
  tag_name: string;
  draft: boolean;
  body?: string;
  html_url: string;
  published_at?: string;
  assets: Array<{ name: string; browser_download_url: string; size: number }>;
}

/** The points under "What's new" in a release's notes (a wrapped point is joined up). */
export function whatsNew(body = ''): string[] {
  const at = body.search(/^#+\s*What.s new/im);
  if (at < 0) return [];
  const items: string[] = [];
  for (const line of body.slice(at).split('\n').slice(1)) {
    if (/^#/.test(line)) break;
    if (!line.trim()) {
      if (items.length) break;
      continue;
    }
    if (/^Co-Authored-By|^Claude-Session/i.test(line.trim())) continue;
    if (/^\s+\S/.test(line) && items.length) items[items.length - 1] += ` ${line.trim()}`;
    else items.push(line.replace(/^[-*•]\s*/, '').trim());
  }
  return items.slice(0, 12);
}

/** The newest build on GitHub, if it is newer than this one. `force` skips the time limit. */
export async function findUpdate(force = false): Promise<AvailableUpdate | null> {
  if (!isAndroidApp()) return null;
  const { versionCode } = await plugin.appInfo();
  const last = ((await local('updateCheckedAt')) as number | undefined) ?? 0;
  if (!force && Date.now() - last < CHECK_EVERY) {
    const known = (await local('updateFound')) as AvailableUpdate | null | undefined;
    return known && known.build > versionCode ? { ...known, current: versionCode } : null;
  }
  const res = await fetch(RELEASES, { headers: { accept: 'application/vnd.github+json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(res.status === 403 ? 'GitHub is busy. Try again in an hour.' : `GitHub answered ${res.status}.`);
  const releases = (await res.json()) as Release[];
  let best: AvailableUpdate | null = null;
  for (const r of releases) {
    const build = Number(r.tag_name.match(/^build-(\d+)$/)?.[1]);
    const apk = r.assets.find((a) => a.name.endsWith('.apk'));
    if (r.draft || !build || !apk) continue;
    if (!best || build > best.build) best = { build, current: versionCode, url: apk.browser_download_url, size: apk.size, notes: whatsNew(r.body), publishedAt: r.published_at, page: r.html_url };
  }
  const found = best && best.build > versionCode ? best : null;
  await setLocal('updateCheckedAt', Date.now());
  await setLocal('updateFound', found);
  return found;
}

/** Whether the popup for this build was put off ("Later") within the last day. */
export async function postponed(build: number): Promise<boolean> {
  const p = (await local('updateLater')) as { build: number; at: number } | undefined;
  return !!p && p.build === build && Date.now() - p.at < 24 * 3600_000;
}
export const postpone = (build: number) => setLocal('updateLater', { build, at: Date.now() });

export type Step =
  | { kind: 'downloading'; done: number; total: number }
  | { kind: 'allow' }
  | { kind: 'installing' }
  | { kind: 'differentKey' }
  | { kind: 'failed'; message: string };

/** Downloads the update and opens Android's installer, reporting each step. */
export async function installUpdate(u: AvailableUpdate, step: (s: Step) => void): Promise<void> {
  step({ kind: 'downloading', done: 0, total: u.size });
  const off = await native.on('updateProgress', ({ done, total }) => step({ kind: 'downloading', done, total: total > 0 ? total : u.size }));
  let sameKey: boolean;
  try {
    ({ sameKey } = await plugin.downloadUpdate({ url: u.url }));
  } catch (e) {
    step({ kind: 'failed', message: friendly((e as Error).message) });
    return;
  } finally {
    off();
  }
  if (!sameKey) {
    step({ kind: 'differentKey' });
    return;
  }
  await openInstaller(step);
}

/** Opens the installer (after the reader has allowed Maktaba to install updates). */
export async function openInstaller(step: (s: Step) => void): Promise<void> {
  try {
    const r = await plugin.installUpdate();
    step(r.needsPermission ? { kind: 'allow' } : { kind: 'installing' });
  } catch (e) {
    step({ kind: 'failed', message: friendly((e as Error).message) });
  }
}

function friendly(m: string): string {
  if (/Unable to resolve host|UnknownHost|timeout|timed out|cut short/i.test(m)) return 'The download did not finish. Check your internet connection and try again.';
  return m.replace(/^Error:\s*/, '');
}
