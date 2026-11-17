// Motion: opening a book from its cover, coming back, tabs, and dragging sheets closed.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { startServer } from './server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const out = decodeURIComponent(new URL('./out/motion/', import.meta.url).pathname);
mkdirSync(out, { recursive: true });
const fx = (n) => decodeURIComponent(new URL(`./out/fixtures/${n}`, import.meta.url).pathname);
let failed = 0;
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const server = await startServer();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const cdp = await ctx.newCDPSession(page);
const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const drag = async (x, y0, y1, steps = 12, ms = 16) => {
  await touch('touchStart', x, y0);
  for (let i = 1; i <= steps; i++) {
    await touch('touchMove', x, y0 + ((y1 - y0) * i) / steps);
    await page.waitForTimeout(ms);
  }
  await touch('touchEnd');
};

await page.goto(server.url);
await page.setInputFiles('[data-testid=add-input]', ['usul.epub', 'risala-text.pdf', 'urdu-risala.txt'].map(fx));
await page.waitForTimeout(5000);
await page.evaluate(() => (location.hash = '#/library'));
await page.waitForTimeout(800);

// Opening from the cover: the cover is named for the morph, then the page takes the name.
const cover = page.getByRole('button', { name: 'Open مختصر في أصول الفقه', exact: true });
const box = await cover.boundingBox();
await page.evaluate(() => {
  window.__navs = [];
  new MutationObserver(() => window.__navs.push(document.documentElement.dataset.nav)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-nav'] });
});
await touch('touchStart', box.x + box.width / 2, box.y + box.height / 2);
await touch('touchEnd');
const shots = [];
for (const t of [80, 180, 300]) {
  await page.waitForTimeout(t - (shots.at(-1) ?? 0));
  shots.push(t);
  await page.screenshot({ path: `${out}open-${t}ms.png` });
}
const named = await page.evaluate(() => window.__navs[0]);
check(named === 'forward', 'opening a book animates forward');
await page.waitForSelector('.bk');
await page.waitForTimeout(600);
check(await page.evaluate(() => !document.documentElement.dataset.nav && ![...document.querySelectorAll('*')].some((e) => e.style.viewTransitionName)), 'nothing is left named after the animation');

// Back to the library: the page shrinks into the cover.
await page.goBack();
await page.waitForTimeout(120);
await page.screenshot({ path: `${out}close-120ms.png` });
check(await page.evaluate(() => document.documentElement.dataset.nav === 'back'), 'going back animates backward');
await page.waitForTimeout(700);
check(await page.getByRole('heading', { name: /Library/ }).isVisible(), 'back on the library');

// Tabs cross-fade.
await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Home' }).click();
check(await page.evaluate(() => document.documentElement.dataset.nav === 'tab'), 'switching tabs cross-fades');
await page.waitForTimeout(600);

// Sheets: a short drag springs back, a long one closes.
await page.evaluate(() => (location.hash = '#/library'));
await page.waitForTimeout(700);
await page.getByRole('button', { name: 'Library options' }).click();
await page.waitForTimeout(600);
const sheet = await page.locator('.sheet').boundingBox();
await drag(206, sheet.y + 30, sheet.y + 90);
await page.waitForTimeout(500);
check(await page.locator('.sheet').isVisible(), 'a short drag leaves the sheet open');
const back = await page.locator('.sheet').boundingBox();
check(Math.abs(back.y - sheet.y) < 2, `and it springs back (${Math.round(back.y - sheet.y)}px)`);
await drag(206, sheet.y + 30, sheet.y + 30 + sheet.height * 0.6);
await page.waitForTimeout(500);
check((await page.locator('.sheet').count()) === 0, 'a long drag closes the sheet');
await page.waitForTimeout(300);
check(!(await page.evaluate(() => history.state?.overlay)), 'and its back-gesture entry is gone');

// A flick closes it too.
await page.getByRole('button', { name: 'Library options' }).click();
await page.waitForTimeout(600);
await drag(206, sheet.y + 30, sheet.y + 110, 4, 8);
await page.waitForTimeout(500);
check((await page.locator('.sheet').count()) === 0, 'a quick flick closes the sheet');

// Sliders inside a sheet are not hijacked.
await page.getByRole('button', { name: 'Open مختصر في أصول الفقه', exact: true }).click();
await page.waitForSelector('.bk');
await page.getByRole('button', { name: 'Text and theme' }).click();
await page.waitForTimeout(600);
const range = await page.locator('input[type=range]').first().boundingBox();
await drag(range.x + range.width / 2, range.y + range.height / 2, range.y + 200);
await page.waitForTimeout(400);
check((await page.locator('.sheet').count()) === 1, 'dragging on a slider does not close the sheet');

check(errors.length === 0, `no errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
await browser.close();
server.stop();
console.log(failed ? `\n${failed} failed` : '\nAll motion checks passed');
process.exit(failed ? 1 : 0);
