/**
 * A light touch of the phone's vibration for moments that deserve one: a highlight made,
 * a bookmark set, a sheet pulled far enough to close. Silent when movement is turned off,
 * and where the phone or browser has no vibration.
 */
const strength = { light: 8, medium: 14, success: [10, 40, 14] } as const;

export function haptic(kind: keyof typeof strength = 'light') {
  try {
    if (document.documentElement.dataset.motion === 'off') return;
    if (document.documentElement.dataset.haptics === 'off') return;
    navigator.vibrate?.(strength[kind] as number | number[]);
  } catch {
    /* not available */
  }
}
