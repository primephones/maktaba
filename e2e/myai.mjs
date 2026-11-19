// Each person's own AI, with no Maktaba server at all: the app talks straight to the
// reader's own AI service (here a stand-in with the OpenAI-style API) for translation,
// Explain and chapter summaries, and keeps the key on the phone.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, openSync, readFileSync } from 'node:fs';
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

const PORT = 8797;
const logFd = openSync(`${root}e2e/out/myai.log`, 'w');
const mock = spawn('node', ['test/mock-ai.mjs'], { cwd: `${root}server`, stdio: ['ignore', logFd, logFd], detached: true, env: { ...process.env, PORT: String(PORT) } });
const calls = async () => (await (await fetch(`http://127.0.0.1:${PORT}/calls`)).json()).calls;
for (let i = 0; i < 40; i++) {
  try {
    await calls();
    break;
  } catch {
    await wait(250);
  }
}

const app = await startServer();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block', acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// Nothing may go to a Maktaba server: there is none.
const serverCalls = [];
page.on('request', (r) => /\/v1\/(translate|study|jobs|status|sync)/.test(r.url()) && serverCalls.push(r.url()));
const shot = (n) => page.screenshot({ path: `${shots}${n}.png` });
const go = async (h) => {
  await page.evaluate((x) => { location.hash = x; }, h);
  await wait(700);
};
const dbRead = (store) => page.evaluate(async (s) => {
  const req = indexedDB.open('maktaba');
  const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
  const all = await new Promise((r) => (dbh.transaction(s).objectStore(s).getAll().onsuccess = (e) => r(e.target.result)));
  dbh.close();
  return all;
}, store);

try {
  await page.goto(app.url);
  await page.setInputFiles('[data-testid=add-input]', [fx('usul.epub')]);
  await wait(3000);

  console.log('Connecting your own AI');
  await go('#/settings/ai');
  check(await page.getByRole('heading', { name: 'Connect your AI' }).isVisible(), 'a new phone is asked to connect its own AI');
  check(await page.getByRole('button', { name: 'Sign in with OpenRouter' }).isVisible(), 'signing in to an AI service is offered');
  check(await page.getByRole('button', { name: /Get a free Gemini key/ }).isVisible(), 'with a way to get a free key');
  await shot('40-connect-ai');
  // A wrong key is refused before it is saved (checked with the service, costing nothing).
  await page.route('https://api.groq.com/**', (r) => r.fulfill({ status: 401, body: '{}', headers: { 'access-control-allow-origin': '*' } }));
  await page.getByLabel('Groq key').fill('gsk_wrong');
  await page.getByRole('button', { name: 'Add Groq' }).click();
  await page.getByText(/cut short/).waitFor({ timeout: 8000 });
  check(true, 'a key cut short is caught before it is sent');
  await page.getByLabel('Groq key').fill('gsk_' + 'x'.repeat(52));
  await page.getByRole('button', { name: 'Add Groq' }).click();
  await page.getByText('The service did not accept the key').waitFor({ timeout: 8000 });
  check(true, 'a key the service refuses is not saved, and help says what to do');
  await page.getByLabel('Groq key').fill('');

  await page.getByText('Another AI service (OpenAI-compatible)').click();
  await page.getByLabel('Name', { exact: true }).fill('Test AI');
  await page.getByLabel('Address', { exact: true }).fill(`http://127.0.0.1:${PORT}/v1`);
  await page.getByLabel('Key', { exact: true }).fill('my-own-key');
  await page.getByLabel('Model', { exact: true }).fill('test-model');
  await page.getByRole('button', { name: 'Add this service' }).click();
  await page.getByText('No daily limit').waitFor({ timeout: 10000 });
  check(true, 'once connected, today’s allowance is shown');
  await shot('41-my-ai');
  await page.getByRole('button', { name: 'Test my AI' }).click();
  await page.locator('.test-result[data-ok="true"]').first().waitFor({ timeout: 20000 });
  check((await page.locator('.test-result').first().textContent()).includes('works'), 'Test my AI says plainly that the service works');

  console.log('Translating ahead, with how far it has got');
  await go('#/library');
  await page.getByRole('button', { name: 'Open مختصر في أصول الفقه', exact: true }).click();
  await page.waitForSelector('.rd-scroll', { timeout: 15000 });
  await wait(800);
  if ((await page.locator('.rd').getAttribute('data-chrome')) !== 'true') await page.locator('.rd-scroll').click({ position: { x: 200, y: 500 } });
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.evaluate(() => {
    window.__sawBar = false;
    new MutationObserver(() => {
      if (document.querySelector('.ahead-progress progress')) window.__sawBar = true;
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.getByRole('button', { name: 'Next 10' }).click();
  await page.getByText(/paragraphs? of “.*” translated/).waitFor({ timeout: 60000 });
  check(await page.evaluate(() => window.__sawBar), 'translating ahead shows a bar of how far it has got, and says when it is done');
  await page.getByRole('button', { name: 'Close' }).click().catch(() => undefined);

  console.log('Translating a whole book on the phone');
  await go('#/library');
  await page.getByRole('button', { name: 'Details for مختصر في أصول الفقه' }).click();
  await page.getByRole('button', { name: /Translate the whole book/ }).click();
  let state;
  for (let i = 0; i < 60; i++) {
    const books = await dbRead('books');
    const trs = await dbRead('translations');
    state = { t: books[0].translation, n: trs.length };
    if (state.t?.state === 'done' && state.n >= state.t.total) break;
    const btn = page.getByRole('button', { name: 'Check now' });
    if (await btn.count()) await btn.click().catch(() => undefined);
    await wait(1500);
  }
  check(state.t?.state === 'done' && state.n >= state.t.total, `the whole book is translated by the reader's own AI (${JSON.stringify(state.t)}, ${state.n} stored)`);
  check((await calls()) > 0, `the requests went to the reader's own AI service (${await calls()})`);
  await page.getByRole('button', { name: 'Close' }).click().catch(() => undefined);

  console.log('Reading, Explain and summary with your own AI');
  await go('#/library');
  await page.getByRole('button', { name: 'Open مختصر في أصول الفقه', exact: true }).click();
  await page.waitForSelector('.bk--en', { timeout: 15000 });
  check(/English of paragraph/.test(await page.locator('.bk--en').first().textContent()), 'the book reads in English');
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('.bk[data-t="p"]')][1];
    const r = document.createRange();
    r.selectNodeContents(p);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await wait(400);
  await page.getByRole('button', { name: 'Explain', exact: true }).click();
  await page.getByText('This passage says that consensus').waitFor({ timeout: 20000 });
  check(true, 'Explain answers from the reader’s own AI');
  await page.getByRole('button', { name: 'Close' }).click();
  await wait(400);
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.getByRole('button', { name: 'Contents, bookmarks and highlights' }).click();
  await page.getByRole('button', { name: /Summarise this chapter/ }).click();
  await page.getByText('The chapter defines analogy').waitFor({ timeout: 20000 });
  check(true, 'chapter summaries come from the reader’s own AI');
  await page.getByRole('button', { name: 'Close' }).click();

  console.log('A second AI checks the translation');
  await wait(400);
  if ((await page.locator('.rd').getAttribute('data-chrome')) !== 'true') await page.locator('.rd-scroll').click({ position: { x: 200, y: 500 } });
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Check this chapter' }).click();
  await page.getByText(/paragraphs checked: \d+ confirmed, \d+ corrected/).waitFor({ timeout: 30000 });
  const trs2 = await dbRead('translations');
  check(trs2.some((t) => t.label === 'checked') && trs2.some((t) => t.uncertain?.some((u) => /Corrected by a second AI/.test(u.reason))), 'confirmed paragraphs are marked checked; a corrected one keeps the reason');
  await page.getByRole('button', { name: 'Close' }).click().catch(() => undefined);

  console.log('Quiz me on this chapter');
  await wait(400);
  if ((await page.locator('.rd').getAttribute('data-chrome')) !== 'true') await page.locator('.rd-scroll').click({ position: { x: 200, y: 500 } });
  await page.getByRole('button', { name: 'Study', exact: true }).click();
  await page.getByRole('button', { name: /^Quiz me on this chapter/ }).click();
  await page.locator('.quiz-q').first().waitFor({ timeout: 30000 });
  check((await page.locator('.quiz-q').count()) === 5, 'five questions from the chapter');
  await page.locator('.quiz-options').first().getByRole('button').first().click();
  await page.locator('.quiz-options').nth(1).getByRole('button').nth(2).click();
  check((await page.getByText('Right.').count()) === 1 && (await page.getByText('Not quite.').count()) === 1, 'each answer is marked, with the reason');
  await shot('42-quiz');
  await page.getByRole('button', { name: 'Read the passage' }).first().click();
  await wait(600);
  check((await page.locator('.sheet').count()) === 0, 'and the passage it rests on is one tap away');

  console.log('An Urdu book, translated with your own AI');
  const namaz = readFileSync(fx('نماز کے احکام.md')).toString('base64');
  await page.evaluate((b64) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'نماز کے احکام.md'));
    const input = document.querySelector('[data-testid=add-input]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, namaz);
  await wait(3000);
  await go('#/library');
  await page.getByRole('button', { name: 'Details for نماز کے احکام' }).dispatchEvent('click');
  await page.getByRole('button', { name: /Translate the whole book/ }).click();
  let ur;
  for (let i = 0; i < 60; i++) {
    const book = (await dbRead('books')).find((b) => b.title === 'نماز کے احکام');
    const n = (await dbRead('translations')).filter((t) => t.bookId === book.id).length;
    ur = { t: book.translation, n };
    if (ur.t?.state === 'done' && n >= ur.t.total) break;
    const btn = page.getByRole('button', { name: 'Check now' });
    if (await btn.count()) await btn.click().catch(() => undefined);
    await wait(1500);
  }
  check(ur.t?.state === 'done' && ur.n === ur.t.total, `the whole Urdu book is translated (${ur.n} of ${ur.t?.total})`);
  const sent = (await (await fetch(`http://127.0.0.1:${PORT}/last`)).json()).filter((m) => /Urdu/.test(m[0].content));
  const all = sent.map((m) => m.map((x) => x.content).join('\n')).join('\n');
  check(sent.length > 0 && /Urdu works quote Arabic/.test(all), 'the AI is told how Urdu books quote Arabic');
  check(/صلی اللہ علیہ وسلم/.test(all) && /ؒ/.test(all), 'and how Urdu writes the honorifics');
  check(/ṭahāra/.test(all) && /wuḍūʾ/.test(all) && /sunna/.test(all) && /ṣalāt/.test(all), 'and gets the glossary terms found in the Urdu spelling (ṭahāra, wuḍūʾ, sunna, ṣalāt)');
  await page.getByRole('button', { name: 'Close' }).click().catch(() => undefined);
  await go('#/library');
  const bookId = (await dbRead('books')).find((b) => b.title === 'نماز کے احکام').id;
  await go(`#/book/${bookId}`);
  await page.waitForSelector('.bk--en', { timeout: 15000 });
  check(/English of paragraph/.test(await page.locator('.bk--en').first().textContent()), 'the Urdu book reads in English');
  await page.locator('.bk--en').nth(1).click();
  await wait(500);
  check(await page.locator('.bk[lang="ur"]').first().isVisible().catch(() => false), 'and a tap shows the Urdu original');
  await page.screenshot({ path: `${shots}42-urdu-in-english.png` });

  console.log('Keys stay on this phone');
  check(serverCalls.length === 0, `no request went to any Maktaba server (${serverCalls.length})`);
  await go('#/settings/backup');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: /^Back up now/ }).click()]);
  const { unzipSync, strFromU8 } = createRequire(import.meta.url)('fflate');
  const parts = unzipSync(new Uint8Array(readFileSync(await dl.path())));
  const text = Object.entries(parts).filter(([n]) => !/^files\//.test(n)).map(([, v]) => strFromU8(v)).join('\n');
  check(text.includes('"settings"') || text.includes('settings'), `the backup holds the settings (${Object.keys(parts).length} parts)`);
  check(!text.includes('my-own-key'), 'a backup file never carries the AI key');
  const settings = await dbRead('outbox');
  check(!settings.some((e) => e.key === 'myAi'), 'the AI key is never queued to sync');

  check(errors.length === 0, `no errors in the page ${JSON.stringify(errors)}`);
} catch (e) {
  check(false, `stopped: ${e.message.split('\n')[0]}`);
  await shot('FAILED-myai').catch(() => undefined);
} finally {
  await browser.close();
  app.stop();
  try {
    process.kill(-mock.pid, 'SIGKILL');
  } catch {
    /* gone */
  }
}
console.log(`\n${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log(' - ' + f);
process.exit(failures.length ? 1 : 0);
