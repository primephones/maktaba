import { describe, expect, it } from 'vitest';
import { whatsNew } from './appUpdate';

describe('the update popup', () => {
  it('reads What’s new from the release notes, joining wrapped points', () => {
    const body = "## What's new\n- Sign-in without the website\n- Scanned pages read by your own AI, far better\n  for Urdu Nastaliq\n- Pashto and Malay\n\nBrowser tests passed.\n\nInstall: open this page…";
    expect(whatsNew(body)).toEqual(['Sign-in without the website', 'Scanned pages read by your own AI, far better for Urdu Nastaliq', 'Pashto and Malay']);
  });
  it('shows nothing when the notes have no such section', () => {
    expect(whatsNew('Browser tests passed.')).toEqual([]);
  });
});

import { vi, beforeEach } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('../sync/sync', () => ({ local: async (k: string) => store.get(k), setLocal: async (k: string, v: unknown) => void store.set(k, v) }));
vi.mock('../native/maktaba', () => ({
  isAndroidApp: () => true,
  native: { on: async () => () => undefined },
  plugin: { appInfo: async () => ({ versionCode: 41, canInstall: true }) },
}));

const release = (n: number, apk = true, draft = false) => ({
  tag_name: `build-${n}`, draft, html_url: `https://github.com/x/releases/tag/build-${n}`, body: "## What's new\n- Thing",
  assets: apk ? [{ name: `Maktaba-0.1.0-build${n}.apk`, browser_download_url: `https://github.com/x/build${n}.apk`, size: 30_000_000 }] : [],
});

describe('finding a new version', () => {
  beforeEach(() => store.clear());
  it('offers the newest published build when it is newer than this one', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify([release(40), release(44), release(45, false), release(46, true, true), release(43)])));
    const { findUpdate } = await import('./appUpdate');
    const u = await findUpdate(true);
    expect(u?.build).toBe(44);
    expect(u?.current).toBe(41);
    expect(u?.url).toContain('build44.apk');
    expect(u?.notes).toEqual(['Thing']);
  });
  it('offers nothing when this is the newest', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify([release(41), release(39)])));
    const { findUpdate } = await import('./appUpdate');
    expect(await findUpdate(true)).toBeNull();
  });
  it('does not ask GitHub again within a few hours, unless asked to', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => (calls++, new Response(JSON.stringify([release(44)]))));
    const { findUpdate } = await import('./appUpdate');
    await findUpdate(true);
    expect((await findUpdate(false))?.build).toBe(44);
    expect(calls).toBe(1);
  });
  it('puts the popup off for a day with Later', async () => {
    const { postpone, postponed } = await import('./appUpdate');
    await postpone(44);
    expect(await postponed(44)).toBe(true);
    expect(await postponed(45)).toBe(false);
  });
});
