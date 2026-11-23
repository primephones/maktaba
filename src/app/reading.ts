import { getSetting, setSetting } from './settings';

/** Today's date as the reading log keeps it, in the phone's own time. */
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Adds time spent reading today (in seconds), keeping about a year of days. */
export async function addReading(seconds: number): Promise<void> {
  const log = { ...(await getSetting('readingLog')) };
  const k = dayKey();
  log[k] = (log[k] ?? 0) + seconds;
  const keys = Object.keys(log).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - 400))) delete log[old];
  await setSetting('readingLog', log);
}

/** Minutes read on a day. */
export const minutesOn = (log: Record<string, number>, d: Date) => Math.round((log[dayKey(d)] ?? 0) / 60);

/**
 * Days in a row the goal was met, up to today (today counts once met; until then the run
 * ending yesterday still stands). With no goal, any reading at all counts.
 */
export function streakOf(log: Record<string, number>, goal: number): number {
  const need = Math.max(1, goal);
  const d = new Date();
  if (minutesOn(log, d) < need) d.setDate(d.getDate() - 1);
  let n = 0;
  while (minutesOn(log, d) >= need) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

/** The longest run of days the goal was met. */
export function bestStreak(log: Record<string, number>, goal: number): number {
  const need = Math.max(1, goal);
  const days = Object.keys(log).filter((k) => log[k] / 60 >= need).sort();
  let best = 0;
  let run = 0;
  let prev: Date | null = null;
  for (const k of days) {
    const d = new Date(`${k}T12:00:00`);
    run = prev && Math.round((d.getTime() - prev.getTime()) / 86_400_000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}
