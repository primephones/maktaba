/**
 * Where Maktaba lives on the web. This is the link to share: whoever opens it gets their
 * own empty library, and signs in to their own cloud and their own AI.
 */
export const PUBLIC_URL: string = (import.meta.env.VITE_PUBLIC_URL as string | undefined) ?? 'https://primephones.github.io/maktaba/';

/** Where the Android app (APK) can be downloaded. */
export const ANDROID_URL = 'https://github.com/primephones/maktaba/releases';

/** Is this page running at the public address (rather than inside the Android app)? */
export const onPublicSite = () => typeof location !== 'undefined' && location.href.startsWith(PUBLIC_URL);

let live: Promise<boolean | undefined> | undefined;
/**
 * Whether the web version is up at PUBLIC_URL (true), not switched on yet (false: GitHub
 * answers 404 until Pages is turned on), or unknown (offline).
 */
export function webVersionLive(): Promise<boolean | undefined> {
  live ??= fetch(`${PUBLIC_URL}auth.html`, { cache: 'no-store' }).then(
    (r) => (r.status === 404 ? false : r.ok ? true : undefined),
    () => undefined,
  );
  return live;
}
