// Scanned books read by the reader's own Gemini AI (a stand-in here), falling back to the
// phone's engine when the day's allowance is used up; translation offered for scans and for
// books whose language was not known; and finishing an OpenRouter sign-in by pasting the
// address the browser ended on.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { startServer } from './server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const fx = (n) => decodeURIComponent(new URL(`./out/fixtures/${n}`, import.meta.url).pathname);
const failures = [];
let passed = 0;
const check = (ok, what) => {
  console.log(ok ? '  ok ' : '  FAILED', what);
  if (ok) passed++;
  else failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await startServer();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
await ctx.addInitScript(() => {
  globalThis.__maktabaAiSpacing = 30;
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };

// The stand-in Gemini: reads each page as Urdu paragraphs, or says the day's allowance is gone.
let geminiCalls = 0;
let translateCalls = 0;
let allowanceGone = false;
/** Every model overloaded (503), as Google's free models often are for a while. */
let overloaded = false;
await ctx.route('https://generativelanguage.googleapis.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' } });
  if (!req.url().includes(':generateContent')) return route.fulfill({ status: 200, headers: cors, body: '{"models":[]}' });
  geminiCalls++;
  if (overloaded) return route.fulfill({ status: 503, headers: cors, body: JSON.stringify({ error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } }) });
  if (allowanceGone) return route.fulfill({ status: 429, headers: cors, body: JSON.stringify({ error: { code: 429, message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 250, GenerateRequestsPerDayPerProjectPerModel-FreeTier' } }) });
  const body = JSON.parse(req.postData() ?? '{}');
  const hasImage = !!body.contents?.[0]?.parts?.some((p) => p.inline_data?.data?.length > 1000);
  if (!hasImage && !body.contents?.[0]?.parts?.some((p) => p.inline_data)) {
    // A translation request: English for each paragraph id it lists.
    translateCalls++;
    const prompt = body.contents?.[0]?.parts?.map((p) => p.text ?? '').join('\n') ?? '';
    const ids = [...prompt.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]);
    const paragraphs = ids.map((id) => ({ id, en: 'The AI read this page from its image. Prayer is the pillar of religion.', uncertain: [] }));
    return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ paragraphs }) }] }, finishReason: 'STOP' }] }) });
  }
  const answer = {
    printed: String(geminiCalls),
    blocks: [
      { t: 'h', text: 'باب اول', box: [60, 100, 110, 900] },
      { t: 'p', text: `یہ صفحہ مصنوعی ذہانت نے پڑھا ہے ${hasImage ? 'تصویر سے' : 'بغیر تصویر'}۔ نماز دین کا ستون ہے۔`, box: [140, 80, 400, 920] },
    ],
  };
  return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP' }] }) });
});

const add = (names) => page.evaluate((list) => {
  const dt = new DataTransfer();
  for (const [name, b64] of list) dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name));
  const input = document.querySelector('[data-testid=add-input]');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, names.map((n) => [n, readFileSync(fx(n)).toString('base64')]));
const read = (store) => page.evaluate(async (s) => {
  const req = indexedDB.open('maktaba');
  const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
  const all = await new Promise((r) => (dbh.transaction(s).objectStore(s).getAll().onsuccess = (e) => r(e.target.result)));
  dbh.close();
  return all;
}, store);
const book = async (title) => (await read('books')).find((b) => b.title === title);
const until = async (fn, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await wait(500);
  }
  return false;
};

try {
  await page.goto(server.url);
  console.log('Connecting Gemini');
  await page.evaluate(() => { location.hash = '#/settings/ai'; });
  await page.getByLabel('Google Gemini key').fill('AIza' + 'x'.repeat(35));
  await page.getByRole('button', { name: 'Add Google Gemini' }).click();
  await page.getByText(/Key added/).first().waitFor({ timeout: 10000 });
  check(true, 'a Gemini key is added');

  console.log('A scanned book read by the AI');
  await page.evaluate(() => { location.hash = '#/'; });
  await add(['makhtut-scan.pdf']);
  check(await until(async () => (await book('makhtut-scan'))?.ocr?.state === 'done'), 'the scanned pages are read');
  const scanId = (await book('makhtut-scan')).id;
  const pages = (await read('ocrPages')).filter((p) => p.bookId === scanId);
  check(pages.length > 0 && pages.every((p) => p.by === 'ai'), `every page was read by the AI (${pages.map((p) => p.by).join(',')})`);
  check(pages.every((p) => p.blocks.some((b) => b.text.includes('تصویر سے'))), 'the AI was sent the page image');
  check(pages.every((p) => p.blocks.some((b) => b.box && b.box[1] > 0.1 && b.box[3] < 0.5)), 'each paragraph keeps its place on the page (for highlighting)');
  check(pages.every((p) => p.blocks[0]?.t === 'h'), 'headings stay headings');
  const scanned = await book('makhtut-scan');
  check(scanned.lang === 'ur', `the book’s language is found from the page (${scanned.lang})`);

  console.log('Its details');
  await page.evaluate(() => { location.hash = '#/library'; });
  await page.getByRole('button', { name: 'Details for makhtut-scan' }).click();
  await page.getByText(/Your AI reads each page/).waitFor({ timeout: 8000 });
  check(true, 'the details say the AI reads the pages');
  await page.getByRole('button', { name: /Translate the whole book/ }).waitFor({ timeout: 8000 });
  check(true, 'and translation is offered for the scanned book');

  console.log('Reading it: the page as printed, its English beneath');
  await page.keyboard.press('Escape');
  // Closing the sheet steps back in history; the book is opened once that has happened.
  await wait(600);
  await page.evaluate((id) => { location.hash = `#/book/${id}`; }, scanId);
  await page.locator('.pdfpage').first().waitFor({ timeout: 15000 });
  check(true, 'a scanned book opens on its pages as printed');
  // Pages read in the background are translated as they are read; any left over has a button.
  const act = page.getByRole('button', { name: /translate this page/i }).first();
  await page.getByText('Prayer is the pillar of religion.').first().waitFor({ timeout: 4000 }).catch(async () => {
    await act.click();
  });
  await page.getByText('Prayer is the pillar of religion.').first().waitFor({ timeout: 20000 });
  check(true, 'each page has its English, translated as it was read or with one tap');
  check(translateCalls > 0, 'translated by the reader’s own AI');
  check((await page.locator('.pdfpage').count()) > 0, 'the English appears under the page, and the page stays');
  await page.getByText('Prayer is the pillar of religion.').first().scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -260));
  await wait(600);
  await page.screenshot({ path: decodeURIComponent(new URL('./out/shots/50-scan-page-english.png', import.meta.url).pathname) });

  console.log('Nonsense the phone made of Urdu is cleared and read again by the AI');
  await page.evaluate(async (id) => {
    const req = indexedDB.open('maktaba');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    await new Promise((r) => {
      const tx = dbh.transaction('ocrPages', 'readwrite');
      tx.objectStore('ocrPages').put({ id: `${id}:5`, bookId: id, page: 5, blocks: [{ t: 'p', text: 'ییبائروک لم بد نیوک بر دلآہ ب نظا', ocr: true, conf: 31 }], conf: 31, lang: 'urd', updatedAt: Date.now() });
      tx.oncomplete = r;
    });
    dbh.close();
    window.dispatchEvent(new Event('maktaba:connected'));
  }, scanId);
  check(await until(async () => (await read('ocrPages')).find((p) => p.id === `${scanId}:5`)?.by === 'ai', 30000), 'a page the phone read in Urdu is read again by the AI');

  console.log('When the day’s allowance is used up');
  allowanceGone = true;
  const before = geminiCalls;
  await page.keyboard.press('Escape');
  await page.evaluate(() => { location.hash = '#/'; });
  await add(['damaged-text-layer.pdf']);
  check(await until(async () => ['done', 'failed'].includes((await book('damaged-text-layer'))?.ocr?.state ?? 'done') && !!(await book('damaged-text-layer'))?.ocr, 120000), 'pages still get read');
  const dmg = await book('damaged-text-layer');
  const dmgPages = (await read('ocrPages')).filter((p) => p.bookId === dmg?.id);
  check(dmg?.ocr?.state === 'done' && dmgPages.length > 0 && dmgPages.every((p) => p.by === 'phone'), `by the phone instead (${dmg?.ocr?.state}, ${dmgPages.map((p) => p.by).join(',')})`);
  check(geminiCalls - before <= 3, `and Gemini is not asked again and again (${geminiCalls - before} tries)`);
  const paused = (await read('settings')).find((x) => x.key === 'aiOcrPausedUntil');
  check(paused?.value > Date.now(), 'Gemini rests until its allowance renews');

  console.log('When every model is only overloaded');
  allowanceGone = false;
  overloaded = true;
  await page.evaluate(async () => {
    const req = indexedDB.open('maktaba');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    await new Promise((r) => {
      const tx = dbh.transaction('settings', 'readwrite');
      tx.objectStore('settings').delete('aiOcrPausedUntil');
      tx.oncomplete = r;
    });
    dbh.close();
    window.dispatchEvent(new Event('maktaba:connected'));
  });
  const toasts = [];
  await page.exposeFunction('__toastSeen', (t) => toasts.push(t)).catch(() => undefined);
  await page.evaluate(() => new MutationObserver(() => document.querySelectorAll('.toast').forEach((t) => window.__toastSeen?.(t.textContent))).observe(document.body, { childList: true, subtree: true }));
  // A new scanned book, read while every model is overloaded.
  await page.evaluate(() => { location.hash = '#/'; });
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes, new TextEncoder().encode('\n% busy copy\n')], 'zikr-busy.pdf', { type: 'application/pdf' }));
    const input = document.querySelector('[data-testid=add-input]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, readFileSync(fx('makhtut-scan.pdf')).toString('base64'));
  const callsBefore = geminiCalls;
  await until(async () => geminiCalls - callsBefore >= 6, 60000);
  await wait(4000);
  const busyBook = await book('zikr-busy');
  check(busyBook?.ocr?.state === 'waiting' && /busy/.test(busyBook.ocr.error ?? ''), `the book waits, saying the AI is busy and that reading carries on by itself (${JSON.stringify(busyBook?.ocr)})`);
  // As on the reader's phone: Read and translate this page, tapped three times while it is busy.
  await page.evaluate((id) => { location.hash = `#/book/${id}`; }, busyBook.id);
  await page.locator('.pdfpage').first().waitFor({ timeout: 15000 });
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: /Read and translate this page/ }).first().click({ timeout: 8000 }).catch(() => undefined);
    await until(async () => !(await page.locator('.scan-busy').count()), 30000);
    await wait(500);
  }
  const paused2 = (await read('settings')).find((x) => x.key === 'aiOcrPausedUntil');
  check(!(paused2?.value > Date.now() + 10 * 60_000), 'an overloaded Gemini is not taken for a used-up day: reading is not paused until tomorrow');
  check(!toasts.some((t) => /add a free Gemini key/.test(t ?? '')), `and the reader is not told to add a key they have already added (${toasts.slice(0, 2).join(' | ')})`);
  overloaded = false;
  // Back to a used-up day, for what follows (OpenRouter reads while Gemini rests).
  allowanceGone = true;
  await page.evaluate(async () => {
    const req = indexedDB.open('maktaba');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    await new Promise((r) => {
      const tx = dbh.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ key: 'aiOcrPausedUntil', value: Date.now() + 12 * 3600_000 });
      tx.oncomplete = r;
    });
    dbh.close();
  });
  await page.evaluate(() => { location.hash = '#/'; });

  console.log('Finishing a sign-in by hand');
  await page.route('https://openrouter.ai/api/v1/auth/keys', (r) =>
    r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ key: 'sk-or-v1-' + 'a'.repeat(40) }) }),
  );
  await page.evaluate(() => {
    localStorage.setItem('maktaba.openrouterVerifier', 'v'.repeat(43));
    location.hash = '#/settings/ai';
  });
  await page.getByText('Didn’t come back to Maktaba?').click();
  await page.getByLabel('The address the browser ended on').fill('https://primephones.github.io/maktaba/auth.html?app=1&code=c0de1234567890abcdef');
  await page.getByRole('button', { name: 'Finish signing in' }).click();
  await page.getByText('Signed in to OpenRouter. Your AI is ready.').waitFor({ timeout: 8000 });
  check(true, 'pasting the address the browser ended on finishes the sign-in');
  await page.getByRole('button', { name: 'Sign out of OpenRouter' }).waitFor({ timeout: 5000 });
  check(true, 'and OpenRouter shows as signed in');

  console.log('Gemini’s day used up: OpenRouter’s free image model reads the pages instead');
  let orReads = 0;
  await page.route('https://openrouter.ai/api/v1/models', (r) =>
    r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ data: [{ id: 'baidu/ernie-5.5-flash-preview:free', architecture: { input_modalities: ['text'] } }, { id: 'google/gemma-4-31b-it:free', architecture: { input_modalities: ['image', 'text'] } }, { id: 'liquid/lfm-3-1.7b:free', architecture: { input_modalities: ['text', 'image'] } }] }) }),
  );
  await page.route('https://openrouter.ai/api/v1/chat/completions', async (r) => {
    const body = JSON.parse(r.request().postData() ?? '{}');
    const content = body.messages?.[0]?.content;
    if (Array.isArray(content) && content.some((c) => c.type === 'image_url')) {
      orReads++;
      const answer = { printed: '', blocks: [{ t: 'p', text: `اوپن روٹر نے یہ صفحہ پڑھا (${body.model})۔ ذکر اللہ دلوں کا سکون ہے۔` }] };
      return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }) });
    }
    return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ choices: [{ message: { content: '{"paragraphs":[]}' } }] }) });
  });
  await page.evaluate(() => { location.hash = '#/'; });
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const extra = new TextEncoder().encode('\n% another copy\n');
    const dt = new DataTransfer();
    dt.items.add(new File([bytes, extra], 'zikr-second.pdf', { type: 'application/pdf' }));
    const input = document.querySelector('[data-testid=add-input]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, readFileSync(fx('makhtut-scan.pdf')).toString('base64'));
  check(await until(async () => (await book('zikr-second'))?.ocr?.state === 'done', 90000), `the scanned pages are read (${JSON.stringify((await book('zikr-second'))?.ocr)})`);
  const second = await book('zikr-second');
  const secondPages = (await read('ocrPages')).filter((p) => p.bookId === second?.id);
  check(orReads > 0 && secondPages.every((p) => p.by === 'ai' && p.blocks.some((b) => b.text.includes('gemma-4-31b'))), `by OpenRouter’s Gemma, the best free model that reads images (${orReads} pages)`);

  console.log('Sharing while the web version is not switched on');
  await page.route('https://primephones.github.io/**', (r) => r.fulfill({ status: 404, body: 'There isn’t a GitHub Pages site here.' }));
  await page.evaluate(() => { location.hash = '#/settings/share'; });
  await page.getByText(/web version is not switched on yet/).waitFor({ timeout: 8000 });
  check((await page.locator('.share-link').textContent())?.includes('/releases'), 'the Android download is shared instead of a link that does not work');
  check(errors.length === 0, `no errors in the page ${JSON.stringify(errors.slice(0, 2))}`);
} catch (e) {
  check(false, `stopped: ${e.message.split('\n')[0]}`);
  await page.screenshot({ path: decodeURIComponent(new URL('./out/shots/FAILED-scan-ai.png', import.meta.url).pathname) }).catch(() => undefined);
} finally {
  await browser.close();
  server.stop();
}
console.log(`\n${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log(' - ' + f);
process.exit(failures.length ? 1 : 0);
