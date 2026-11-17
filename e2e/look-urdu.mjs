// Urdu and Persian on every screen, at a small phone, a normal phone and a tablet, for
// looking at: Nastaliq is tall and is clipped wherever a box is tight.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { startServer } from './server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const out = decodeURIComponent(new URL('./out/urdu/', import.meta.url).pathname);
mkdirSync(out, { recursive: true });
const fx = (n) => decodeURIComponent(new URL(`./out/fixtures/${n}`, import.meta.url).pathname);
const server = await startServer();
const browser = await chromium.launch();
const sizes = (process.argv[2] ?? '360x780,412x915,820x1180').split(',');
const problems = [];
for (const size of sizes) {
  const [w, h] = size.split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 600, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${size}: ${e.message}`));
  const open = async (title) => {
    const id = await page.evaluate(async (t) => {
      const req = indexedDB.open('maktaba');
      const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
      const all = await new Promise((r) => (dbh.transaction('books').objectStore('books').getAll().onsuccess = (e) => r(e.target.result)));
      return all.find((b) => b.title === t)?.id;
    }, title);
    await page.evaluate((x) => (location.hash = x), `#/book/${id}`);
    await page.waitForSelector('.bk');
    await page.waitForTimeout(800);
  };
  const go = async (hash) => { await page.evaluate((x) => (location.hash = x), hash); await page.waitForTimeout(700); };
  const shot = async (name) => {
    // Anything wider than the screen (a sideways scroll on a phone) is a layout fault.
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    if (wide > 1) problems.push(`${size} ${name}: page is ${wide}px wider than the screen`);
    await page.screenshot({ path: `${out}${size}-${name}.png` });
  };
  await page.goto(server.url);
  // Handed over as the app receives them (the test browser's own file picker drops
  // files whose names are not in Latin letters).
  const files = ['نماز کے احکام.md', 'رساله در فقه.md', 'urdu-risala.txt', 'usul.epub'].map((n) => [n, readFileSync(fx(n)).toString('base64')]);
  await page.evaluate((list) => {
    const dt = new DataTransfer();
    for (const [name, b64] of list) dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name));
    const input = document.querySelector('[data-testid=add-input]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, files);
  await page.waitForTimeout(5000);
  await go('#/library');
  await shot('library');
  await open('نماز کے احکام');
  await shot('reader-urdu');
  await page.getByRole('button', { name: 'Contents, bookmarks and highlights' }).dispatchEvent('click');
  await page.waitForTimeout(500);
  await shot('contents-urdu');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('.bk[data-t="p"]')][1];
    const r = document.createRange();
    r.selectNodeContents(p);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await page.waitForTimeout(400);
  await shot('selection-urdu');
  await page.getByRole('button', { name: 'Reference', exact: true }).dispatchEvent('click').catch(() => undefined);
  await page.waitForTimeout(600);
  await go('#/');
  await shot('home');
  await go('#/library');
  await page.getByRole('button', { name: 'Details for نماز کے احکام' }).dispatchEvent('click');
  await page.waitForTimeout(500);
  await shot('details-urdu');
  await page.keyboard.press('Escape');
  await go('#/search');
  await page.getByRole('searchbox').fill('نماز');
  await page.waitForTimeout(2000);
  await shot('search-urdu');
  await page.getByRole('searchbox').fill('طهارت');
  await page.waitForTimeout(2000);
  await shot('search-persian');
  await go('#/references');
  await shot('references');
  await go('#/library');
  await open('رساله در فقه');
  await shot('reader-persian');
  await ctx.close();
}
await browser.close();
server.stop();
console.log(problems.length ? problems.join('\n') : 'no overflow or errors');
process.exit(problems.length ? 1 : 0);
