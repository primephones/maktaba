import { isAndroidApp, native } from './maktaba';

/**
 * Keeps the Android app awake and visible in the notification shade while books are
 * being prepared, so the work goes on when the reader leaves the app.
 */
let active = false;
let lastUpdate = 0;
let asked = false;

const notify = (title: string, text: string, done: number, total: number) => ({ title, text, done, total });

export async function workBegan(bookTitle: string): Promise<void> {
  if (!isAndroidApp()) return;
  if (!asked) {
    asked = true;
    // Android 13+ asks once; without permission the work still runs, just without the bar.
    await native.call('requestNotifications');
  }
  if (!active) {
    active = true;
    lastUpdate = 0;
    await native.call('startWork', notify('Preparing books', `Opening ${bookTitle}`, 0, 0));
  }
  await native.call('setPendingWork', { text: `“${bookTitle}” was still being prepared.` });
}

export function workProgress(bookTitle: string, stage: string, done: number, total: number, queued: number): void {
  if (!active) return;
  const now = Date.now();
  if (now - lastUpdate < 1000 && done < total) return;
  lastUpdate = now;
  const where = total ? `${stage}: ${done} of ${total}` : stage;
  const more = queued > 0 ? ` · ${queued} more waiting` : '';
  void native.call('updateWork', notify(`Preparing ${bookTitle}`, `${where}${more}`, done, total));
}

export async function workEnded(): Promise<void> {
  if (!active) return;
  active = false;
  await native.call('stopWork');
  await native.call('setPendingWork', { text: '' });
}
