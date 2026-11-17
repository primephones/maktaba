// The app, the private server and a stand-in AI service, all running here: connects the
// app to the server, translates a whole book, and reads it in English.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { startServer } from './server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = decodeURIComponent(new URL('..', import.meta.url).pathname);
const shots = `${root}e2e/out/shots/`;
mkdirSync(shots, { recursive: true });
const fx = (n) => `${root}e2e/out/fixtures/${n}`;
const failures = [];
let passed = 0;
const check = (ok, what) => {
  console.log(ok ? '  ok ' : '  FAILED', what);
  if (ok) passed++;
  else failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const { setupLocal } = await import('../server/test/setup-local.mjs');
console.log('setting up the local database');
setupLocal(`${root}server`, 8798);
const run = (cmd, args, opts = {}) => spawn(cmd, args, { cwd: `${root}server`, stdio: 'ignore', detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', ...(opts.env ?? {}) } });
console.log('starting the server');
const mock = run('node', ['test/mock-ai.mjs'], { env: { PORT: '8798' } });
const api = run('npx', ['wrangler', 'dev', '--local', '--port', '8788']);
for (let i = 0; i < 120; i++) {
  try {
    if ((await fetch('http://127.0.0.1:8788')).ok) break;
  } catch {
    /* starting */
  }
  await wait(500);
}
console.log('starting the app');
const app = await startServer();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = (n) => page.screenshot({ path: `${shots}${n}.png` });
const go = async (h) => {
  await page.evaluate((x) => { location.hash = x; }, h);
  await wait(700);
};
try {
  await page.goto(app.url);
  await page.setInputFiles('[data-testid=add-input]', [fx('usul.epub')]);
  await wait(3000);

  console.log('Connecting to the server');
  await go('#/settings/ai');
  await page.getByLabel('Server address').fill('http://127.0.0.1:8788');
  await page.getByLabel(/Setup code/).fill('test-setup');
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.getByText('requests left today').waitFor({ timeout: 15000 });
  const key = await page.locator('.sync-key').first().textContent();
  check(/^HSY(-[A-Z2-9]{4}){5}$/.test(key ?? ''), `the phone makes a private sync key (${key})`);
  check(await page.getByText('Groq', { exact: true }).first().isVisible(), 'the AI services are listed with their privacy notes');
  await shot('20-ai-settings');

  console.log('Translating a whole book');
  await go('#/library');
  await page.getByRole('button', { name: 'Details for مختصر في أصول الفقه' }).click();
  await page.getByText(/about \d+ requests of free allowance/).waitFor();
  check(true, 'before starting, the book says how much allowance it will take');
  await shot('21-translate-card');
  await page.getByRole('button', { name: /Translate the whole book/ }).click();
  let state;
  for (let i = 0; i < 60; i++) {
    await page.evaluate(() => import('/src/ai/translation.ts').catch(() => null));
    state = await page.evaluate(async () => {
      const req = indexedDB.open('maktaba');
      const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
      const books = await new Promise((r) => (dbh.transaction('books').objectStore('books').getAll().onsuccess = (e) => r(e.target.result)));
      const n = await new Promise((r) => (dbh.transaction('translations').objectStore('translations').count().onsuccess = (e) => r(e.target.result)));
      dbh.close();
      return { t: books[0].translation, n };
    });
    if (state.t?.state === 'done' && state.n >= state.t.total) break;
    const btn = page.getByRole('button', { name: 'Check now' });
    if (await btn.count()) await btn.click().catch(() => undefined);
    await wait(1500);
  }
  check(state.t?.state === 'done' && state.n === state.t.total, `the whole book comes back from the server (${JSON.stringify(state.t)} ${state.n} stored)`);
  await page.getByRole('button', { name: 'Close' }).click().catch(() => undefined);

  console.log('Reading in English');
  await go('#/library');
  await page.getByRole('button', { name: 'Open مختصر في أصول الفقه', exact: true }).click();
  await page.waitForSelector('.bk--en');
  await wait(600);
  check((await page.locator('.bk--en').count()) > 5, 'an Arabic book opens in English');
  check(await page.locator('.tr-label').first().textContent().then((t) => /machine draft/.test(t)), 'the English is labelled a machine draft, with the AI that made it');
  await shot('22-reader-english');
  const first = page.locator('.bk--en[data-t="p"]').first();
  const s = await first.getAttribute('data-s');
  const b = await first.getAttribute('data-b');
  await first.click();
  await wait(400);
  const flippedEl = page.locator(`.bk[data-s="${s}"][data-b="${b}"]`);
  check((await flippedEl.getAttribute('data-shown-original')) !== null && /[؀-ۿ]/.test(await flippedEl.textContent()), 'tapping a paragraph shows the original in place');
  await shot('23-reader-original-in-place');
  await flippedEl.click();
  await wait(300);
  check((await page.locator(`.bk--en[data-s="${s}"][data-b="${b}"]`).count()) === 1, 'tapping again goes back to the English');
  if ((await page.locator('.rd').getAttribute('data-chrome')) !== 'true') {
    await page.locator('.rd-mini').click({ force: true });
    await page.mouse.click(200, 40);
    await wait(300);
  }
  check((await page.locator('.rd').getAttribute('data-chrome')) === 'true', 'a tap at the top of the page brings the reading bars back');
  await page.getByRole('button', { name: 'Text and theme' }).click();
  await page.getByRole('button', { name: 'Both', exact: true }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await wait(500);
  check((await page.locator('.bk-pair').count()) > 5, '“Both” shows the English under the original');
  await shot('24-reader-both');
} catch (e) {
  console.log('TEST ERROR', e.message);
  failures.push(e.message);
  await shot('FAILED-ai');
}
check(errors.length === 0, `no errors in the page ${JSON.stringify(errors.slice(0, 2))}`);
await browser.close();
app.stop();
for (const p of [api, mock]) {
  try {
    process.kill(-p.pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}
console.log(`\n${passed} checks passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
