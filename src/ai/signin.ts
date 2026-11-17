import { isAndroidApp, native, plugin } from '../native/maktaba';
import { PUBLIC_URL } from '../app/config';
import { getMyAi, setMyAi } from './device';

/**
 * Signing in to an AI service, and checking a pasted key, without using any of the day's
 * allowance.
 *
 * OpenRouter signs people in with their own account and hands Maktaba a key of their own
 * (OAuth with PKCE: no secret is needed, and the key is made for this phone alone). On the
 * web the page goes to OpenRouter and comes back. In the Android app the sign-in happens in
 * the phone's browser (Google's sign-in, which OpenRouter offers, refuses to work inside
 * apps), and the browser hands back to the app through maktaba://auth.
 */

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function challenge(verifier: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

const VERIFIER = 'maktaba.openrouterVerifier';

/** Where OpenRouter sends the reader back to after signing in. */
function callbackUrl(): string {
  if (isAndroidApp()) return `${PUBLIC_URL}auth.html?app=1`;
  return location.origin + location.pathname;
}

export async function startOpenRouterSignIn(): Promise<void> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  try {
    localStorage.setItem(VERIFIER, verifier);
  } catch {
    /* private mode: the sign-in still works if the page is not reloaded */
  }
  (window as unknown as { __orVerifier?: string }).__orVerifier = verifier;
  const url = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callbackUrl())}&code_challenge=${await challenge(verifier)}&code_challenge_method=S256`;
  if (isAndroidApp()) await plugin.openUrl({ url });
  else location.href = url;
}

/** Finishes a sign-in: swaps the one-time code for the reader's own key. */
export async function finishOpenRouterSignIn(code: string): Promise<void> {
  let verifier: string | null = null;
  try {
    verifier = localStorage.getItem(VERIFIER);
  } catch {
    verifier = null;
  }
  verifier ??= (window as unknown as { __orVerifier?: string }).__orVerifier ?? null;
  if (!verifier) throw new Error('The sign-in started on another device or browser. Start it again here.');
  const res = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  const data = (await res.json().catch(() => ({}))) as { key?: string; error?: { message?: string } };
  if (!res.ok || !data.key) throw new Error(data.error?.message ?? 'OpenRouter did not finish the sign-in. Try again.');
  try {
    localStorage.removeItem(VERIFIER);
  } catch {
    /* ignore */
  }
  await setMyAi({ ...(await getMyAi()), openrouter: data.key, openrouterSignedIn: true });
}

/**
 * Picks up a sign-in coming back: on the web from the page address (?code=...), in the
 * Android app from maktaba://auth. Reports the outcome through the callback.
 */
export function listenForSignIns(report: (ok: boolean, message: string) => void) {
  const done = (code: string) =>
    finishOpenRouterSignIn(code).then(
      () => report(true, 'Signed in to OpenRouter. Your AI is ready.'),
      (e) => report(false, (e as Error).message),
    );
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (code) {
    // Take the code out of the address so a reload does not try it again.
    history.replaceState(history.state, '', location.pathname + '#/settings/ai');
    void done(code);
  }
  void native.on('authCallback', ({ url }) => {
    const c = new URL(url).searchParams.get('code');
    if (c) void done(c);
  });
}

export type KeyService = 'gemini' | 'groq' | 'openrouter';

/** Checks a key with the service itself, using none of the day's allowance. */
export async function checkKey(service: KeyService, key: string): Promise<{ ok: boolean; message: string }> {
  const k = key.trim();
  if (!k) return { ok: false, message: 'Paste the key first.' };
  const req: Record<KeyService, () => Promise<Response>> = {
    gemini: () => fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': k } }),
    groq: () => fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${k}` } }),
    openrouter: () => fetch('https://openrouter.ai/api/v1/key', { headers: { authorization: `Bearer ${k}` } }),
  };
  try {
    const res = await req[service]();
    if (res.ok) return { ok: true, message: 'The key works.' };
    if (res.status === 400 || res.status === 401 || res.status === 403) return { ok: false, message: 'The service refused this key. Check you copied all of it.' };
    return { ok: false, message: `The service answered with an error (${res.status}). Try again in a moment.` };
  } catch {
    return { ok: false, message: 'The service could not be reached. Check your internet connection.' };
  }
}
