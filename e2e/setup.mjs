// The setup guide, as someone new would meet it after opening the shared link: their own
// cloud, then their own AI, step by step, with help for what they paste and for what goes
// wrong.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { startServer } from './server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = decodeURIComponent(new URL('..', import.meta.url).pathname);
const shots = `${root}e2e/out/shots/`;
mkdirSync(shots, { recursive: true });
const failures = [];
let passed = 0;
const check = (ok, what) => {
  console.log(ok ? '  ok ' : '  FAILED', what);
  if (ok) passed++;
  else failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PORT = 8795;
const drive = spawn('node', [`${root}e2e/mock-drive.mjs`], { stdio: ['ignore', openSync(`${root}e2e/out/drive-setup.log`, 'w'), 'inherit'], detached: true, env: { ...process.env, PORT: String(PORT) } });
await wait(800);

const gemini = 'AIza' + 'SyD'.padEnd(35, 'q');
const groq = 'gsk_' + 'k'.repeat(52);

const app = await startServer();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = (n) => page.screenshot({ path: `${shots}${n}.png`, fullPage: true });
// The AI services' own key checks, answered here: Groq accepts, Gemini refuses.
await page.route('https://api.groq.com/**', (r) => r.fulfill({ status: 200, body: '{"data":[]}', headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' } }));
await page.route('https://generativelanguage.googleapis.com/**', (r) => r.fulfill({ status: 400, body: '{"error":{"message":"API key not valid"}}', headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' } }));

try {
  console.log('Starting');
  await page.goto(app.url);
  await page.getByRole('button', { name: /Set up Maktaba \(2 steps\)/ }).click();
  await page.getByRole('heading', { name: 'Two steps, about five minutes' }).waitFor();
  check(true, 'a new person is offered the setup guide from Home');
  await shot('60-setup-welcome');
  await page.getByRole('button', { name: 'Start' }).click();

  console.log('Step 1: the cloud');
  await page.getByRole('heading', { name: 'Keep your library in your own Google Drive' }).waitFor();
  check(await page.getByText('15 GB free').isVisible(), 'it says the free storage that comes with a Google account');
  check((await page.locator('.howto li').count()) >= 5, 'and what will happen, step by step');
  check(await page.getByText(/If there is a box next to it, tick it/).isVisible(), 'including the box Google may ask them to tick');
  // Without the app's Google ID (as here), the help says why and what to do meanwhile.
  check(await page.getByText('Google Drive is not switched on yet').isVisible(), 'when Drive sign-in is not available, it says so and what to do meanwhile');
  await shot('61-setup-cloud');
  await page.getByRole('button', { name: 'Skip for now' }).click();

  console.log('Step 2: the AI');
  await page.getByRole('heading', { name: 'Connect your own AI' }).waitFor();
  check((await page.locator('.guide').count()) === 3, 'three free AI services are offered, each with why to choose it');
  await page.getByRole('button', { name: /Google Gemini/ }).click();
  check((await page.locator('.guide-body .howto li').count()) === 5, 'opening one shows how to get its key, step by step');
  check(await page.getByRole('button', { name: 'Open Google AI Studio' }).isVisible(), 'with a button to the right page');
  const box = page.getByLabel('Your Google Gemini key');
  await box.fill('https://aistudio.google.com/app/apikey');
  check(await page.getByText(/That is a web address, not the key/).isVisible(), 'pasting the page address instead of the key is explained');
  await box.fill('AIzaSyD12');
  check(await page.getByText(/cut short/).isVisible(), 'a key cut short is noticed');
  await box.fill(`  "${gemini}"  `);
  check(await page.getByText('This looks like a Google Gemini key.').isVisible(), 'a key is recognised, with stray quotes and spaces ignored');
  await page.getByRole('button', { name: 'Add Google Gemini' }).click();
  await page.getByText('The service did not accept the key').waitFor({ timeout: 10000 });
  check(true, 'a refused key gets help: what it means and what to do');
  await shot('62-setup-key-refused');
  // The Groq key pasted under Gemini: it goes where it belongs.
  await box.fill(groq);
  check(await page.getByText(/This is a Groq key, not Google Gemini\. It will be added as Groq\./).isVisible(), 'a key from another service is recognised');
  await page.getByRole('button', { name: 'Add Groq' }).click();
  await page.getByText('Connected: Groq').waitFor({ timeout: 10000 });
  check(true, '…and added to that service');
  await shot('63-setup-ai-connected');
  await page.getByRole('button', { name: 'Finish' }).click();

  console.log('Done');
  await page.getByRole('heading', { name: 'Ready to read' }).waitFor();
  check(await page.getByText('Not yet: tap to set it up').isVisible(), 'the end shows what is set up and what is still to do');
  check(await page.getByText('What to try first').isVisible(), 'and what to try first');
  await shot('64-setup-done');

  console.log('Back to the cloud, once it is connected');
  await page.evaluate(async (base) => {
    const req = indexedDB.open('maktaba');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    await new Promise((r) => {
      const tx = dbh.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ key: 'cloud', value: { provider: 'gdrive', apiBase: base, testToken: 'test-token', email: 'reader@example.com' } });
      tx.oncomplete = r;
    });
    dbh.close();
  }, `http://127.0.0.1:${PORT}`);
  await page.getByRole('button', { name: /Your cloud/ }).click();
  await page.getByText('Your Google Drive is connected').waitFor({ timeout: 10000 });
  const space = await page.getByText(/12\.5 GB free of 15 GB/).waitFor({ timeout: 8000 }).then(() => true, () => false);
  check(space, 'a connected Drive shows how much free space is left');

  console.log('Help');
  await page.evaluate(() => { location.hash = '#/settings/help'; });
  await page.getByRole('button', { name: /Setup guide/ }).waitFor();
  check((await page.locator('.faq details').count()) >= 8, 'Settings › Help & setup answers common questions');
  await page.getByText('Google says “Google hasn’t verified this app”.').click();
  check(await page.getByText('Tap Advanced, then Go to Maktaba.').isVisible(), 'each answer opens in place');
  check(await page.getByText('Connected').first().isVisible(), 'and shows where each login stands');
  await shot('65-help');

  check(errors.length === 0, `no errors in the page ${JSON.stringify(errors.slice(0, 3))}`);
} catch (e) {
  check(false, `stopped: ${e.message.split('\n')[0]}`);
  await shot('FAILED-setup').catch(() => undefined);
} finally {
  await browser.close();
  app.stop();
  try {
    process.kill(-drive.pid, 'SIGKILL');
  } catch {
    /* gone */
  }
}
console.log(`\n${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log(' - ' + f);
process.exit(failures.length ? 1 : 0);
