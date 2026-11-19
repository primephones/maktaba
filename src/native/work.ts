import { isAndroidApp, native } from './maktaba';

/**
 * Keeps the Android app awake and visible in the notification shade while long work runs
 * (preparing books, recognising scanned pages), so it goes on when the reader leaves the
 * app. Several kinds of work can run at once; the notification shows the latest, and the
 * service stops when the last one ends.
 */
interface Job {
  title: string;
  text: string;
  done: number;
  total: number;
  pending: string;
}

const jobs = new Map<string, Job>();
let serviceOn = false;
let lastUpdate = 0;
let asked = false;

async function syncPending() {
  const text = [...jobs.values()].map((j) => j.pending).filter(Boolean).join(' ');
  await native.call('setPendingWork', { text });
}

export async function workBegan(key: string, title: string, text: string, pending: string): Promise<void> {
  if (!isAndroidApp()) return;
  if (!asked) {
    asked = true;
    // Android 13+ asks once; without permission the work still runs, just without the bar.
    await native.call('requestNotifications');
  }
  jobs.set(key, { title, text, done: 0, total: 0, pending });
  if (!serviceOn) {
    serviceOn = true;
    lastUpdate = 0;
    await native.call('startWork', { title, text, done: 0, total: 0 });
  } else {
    void native.call('updateWork', { title, text, done: 0, total: 0 });
  }
  await syncPending();
}

export function workProgress(key: string, title: string, text: string, done: number, total: number): void {
  const job = jobs.get(key);
  if (!job || !serviceOn) return;
  Object.assign(job, { title, text, done, total });
  const now = Date.now();
  if (now - lastUpdate < 1000 && done < total) return;
  lastUpdate = now;
  void native.call('updateWork', { title, text, done, total });
}

export async function workEnded(key: string): Promise<void> {
  if (!jobs.delete(key)) return;
  await syncPending();
  if (jobs.size === 0 && serviceOn) {
    serviceOn = false;
    await native.call('stopWork');
  } else {
    const last = [...jobs.values()].pop();
    if (last) void native.call('updateWork', { title: last.title, text: last.text, done: last.done, total: last.total });
  }
}

/**
 * Says that work has finished, as a notification when the reader is not looking at
 * Maktaba (in the app, or in the browser where notifications are allowed).
 */
export async function workFinished(title: string, text: string): Promise<void> {
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;
  try {
    if (isAndroidApp()) await native.call('showNotice', { title, text });
    else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(title, { body: text, icon: './icons/icon-192.png' });
  } catch {
    // Not allowed: the message in the app is enough.
  }
}
