// A scanned Urdu book as the owner reads them (Nastaliq, a website's name stamped across each
// page), with the reader's Gemini (a stand-in here). What went wrong for the owner: on a page
// the AI had not read yet, English › Next 10 said "The next pages are already translated" and
// did nothing. Translating ahead on a scanned book now reads the pages first, from the page
// being read, in the background, and says how far it has got; so does the button under a page,
// As I read and Whole book. A busy AI is waited for and asked again.
import { createRequire } from 'node:module';
import { startServer } from './server.mjs';
import { urduScanPdf, URDU_PAGES } from './urdu-scan.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const failures = [];
let passed = 0;
const check = (ok, what) => {
  console.log(ok ? '  ok ' : '  FAILED', what);
  if (ok) passed++;
  else failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = decodeURIComponent(new URL('./out/shots/', import.meta.url).pathname);

const server = await startServer();
const browser = await chromium.launch();
const pdf = await urduScanPdf(browser);
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', colorScheme: 'dark' });
await ctx.addInitScript(() => {
  globalThis.__maktabaAiSpacing = 30;
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };

// The stand-in Gemini. 'busy': every model overloaded (503). Pages read: one request each.
let mode = 'busy';
const calls = { page: 0, text: 0, busy: 0 };
const answer = (route, obj) => route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }] }) });
await ctx.route('https://generativelanguage.googleapis.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' } });
  if (!req.url().includes(':generateContent')) return route.fulfill({ status: 200, headers: cors, body: '{"models":[]}' });
  if (mode === 'busy') {
    calls.busy++;
    return route.fulfill({ status: 503, headers: cors, body: JSON.stringify({ error: { code: 503, message: 'This model is currently experiencing high demand.', status: 'UNAVAILABLE' } }) });
  }
  const body = JSON.parse(req.postData() ?? '{}');
  const parts = body.contents?.[0]?.parts ?? [];
  const text = parts.map((p) => p.text ?? '').join('\n') + (body.systemInstruction?.parts?.map((p) => p.text).join('\n') ?? '');
  if (parts.some((p) => p.inline_data)) {
    calls.page++;
    const both = /Then translate every block into English/.test(text);
    const [printed, head, paras] = URDU_PAGES[1];
    return answer(route, {
      printed,
      blocks: [
        { t: 'h', text: head, box: [80, 200, 130, 800], ...(both ? { en: 'New Elections' } : {}) },
        ...paras.map((p, i) => ({ t: 'p', text: p, box: [150 + i * 200, 80, 330 + i * 200, 920], ...(both ? { en: 'Under the present parliamentary system, whichever government comes to power reaches its office through elections.', uncertain: [] } : {}) })),
      ],
    });
  }
  calls.text++;
  const ids = [...text.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]);
  return answer(route, { paragraphs: ids.map((id) => ({ id, en: 'The government that comes to power does so through the elections, and its acts are ascribed to those who chose it.', uncertain: [] })) });
});

const read = (store) =>
  page.evaluate(async (s) => {
    const req = indexedDB.open('maktaba');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const all = await new Promise((r) => (dbh.transaction(s).objectStore(s).getAll().onsuccess = (e) => r(e.target.result)));
    dbh.close();
    return all;
  }, store);
const until = async (fn, ms = 60000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await wait(400);
  }
  return false;
};
const theBook = async () => (await read('books')).find((b) => b.title === 'IslamAurSiyasat');
const aiPages = async (id) => (await read('ocrPages')).filter((p) => p.bookId === id && p.by === 'ai').map((p) => p.page).sort((a, b) => a - b);
const toasts = [];
const watchToasts = () =>
  page.evaluate(() => {
    window.__toasts = [];
    new MutationObserver(() => document.querySelectorAll('.toast').forEach((t) => (window.__toasts.includes(t.textContent) ? null : window.__toasts.push(t.textContent)))).observe(document.body, { childList: true, subtree: true });
    window.__pill = [];
    new MutationObserver(() => document.querySelectorAll('.ahead-pill-text').forEach((t) => (window.__pill.includes(t.textContent) ? null : window.__pill.push(t.textContent)))).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
const tools = async () => {
  if ((await page.locator('.rd').getAttribute('data-chrome')) !== 'true') await page.locator('.rd-scroll').click({ position: { x: 206, y: 420 } });
  await wait(400);
};

try {
  await page.goto(server.url);
  await page.evaluate(() => { location.hash = '#/settings/ai'; });
  await page.getByLabel('Google Gemini key').fill('AQ.' + 'Ab8_x-'.repeat(8));
  await page.getByRole('button', { name: 'Add Google Gemini' }).click();
  await page.getByText(/Key added/).first().waitFor({ timeout: 10000 });
  await page.evaluate(() => { location.hash = '#/settings/library'; });
  await page.getByRole('radio', { name: /Leave them/ }).click();

  console.log('A scanned Urdu book added while every Gemini model is busy');
  await page.evaluate(() => { location.hash = '#/'; });
  await page.evaluate((b64) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'IslamAurSiyasat.pdf', { type: 'application/pdf' }));
    const input = document.querySelector('[data-testid=add-input]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, Buffer.from(pdf).toString('base64'));
  check(await until(async () => (await theBook())?.ocr?.state === 'waiting', 60000), `the book waits for the AI, saying it is busy (${JSON.stringify((await theBook())?.ocr)})`);
  const b = await theBook();
  check(/busy/.test(b.ocr.error ?? ''), 'and says the AI is busy, not that a key is missing');
  check((await aiPages(b.id)).length === 0, 'no page has been read yet');
  // The background reading is held while what the reader's own taps do is looked at.
  await page.evaluate(() => { globalThis.__maktabaHoldReading = true; });

  console.log('Opened at page 4: English › Next 3 pages');
  await page.evaluate((id) => { location.hash = `#/book/${id}`; }, b.id);
  await page.locator('.pdfpage').nth(3).waitFor({ timeout: 20000 });
  await watchToasts();
  await page.locator('.pdfpage').nth(3).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await wait(1500);
  mode = 'ok';
  await tools();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Next 3 pages' }).waitFor({ timeout: 5000 });
  check(true, 'a scanned book is translated by pages (Next 3 pages, Next 10 pages)');
  await wait(500);
  await page.screenshot({ path: `${shots}72-urdu-scan-english-panel.png` });
  await page.getByRole('button', { name: 'Next 3 pages' }).click();
  await page.getByRole('button', { name: 'Close' }).last().click();
  await page.locator('.rd-scroll').evaluate((el) => el.scrollBy(0, 400));
  check(await until(async () => (await aiPages(b.id)).includes(4) && (await aiPages(b.id)).includes(5), 60000), `pages 4 and 5 are read by the AI, from the page being read (${(await aiPages(b.id)).join(',')})`);
  await until(async () => (await page.evaluate(() => window.__toasts)).some((t) => /read and translated/.test(t)), 30000);
  const said = await page.evaluate(() => window.__toasts);
  check(!said.some((t) => /already translated/.test(t)), `it never says the pages are already translated (${said.join(' | ')})`);
  check(said.some((t) => /2 pages of .* read and translated/.test(t)), 'and says when they are read and translated');
  const pill = await page.evaluate(() => window.__pill);
  check(pill.some((t) => /Reading and translating page 4/.test(t)), `a note at the foot of the page says which page is being read and translated (${pill.slice(0, 3).join(' | ')})`);
  check(!(await aiPages(b.id)).some((p) => p < 4), 'pages before the one being read were left for later');
  const trs = (await read('translations')).filter((t) => t.bookId === b.id);
  const secs = (await read('sections')).filter((s) => s.bookId === b.id);
  const onPage = (p) => secs.flatMap((s) => s.blocks.map((bl, i) => ({ s: s.idx, i, bl }))).filter((x) => x.bl.ocr && x.bl.page === p);
  check([4, 5].every((p) => onPage(p).length > 0 && onPage(p).every((x) => trs.some((t) => t.section === x.s && t.block === x.i))), 'every paragraph of those pages has its English');
  // On screen: the English appears under page 4, without leaving and opening the book again.
  check(await until(async () => (await page.getByText('Under the present parliamentary system').count()) > 0, 15000), 'the English shows under the page at once, on screen');
  await page.locator('.pdfpage').nth(3).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.locator('.rd-scroll').evaluate((el) => el.scrollBy(0, 560));
  await wait(800);
  await page.screenshot({ path: `${shots}70-urdu-scan-translated.png` });

  console.log('The button under a page, with the AI busy at first');
  mode = 'busy';
  await page.locator('.pdfpage').nth(1).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await wait(800);
  // Pages 1, 2 and 3 are not read yet: the second of their buttons is page 2's.
  await page.getByRole('button', { name: 'Read and translate this page' }).nth(1).click();
  await until(async () => (await page.evaluate(() => window.__pill)).some((t) => /AI busy · trying again in/.test(t)), 40000);
  check((await page.evaluate(() => window.__pill)).some((t) => /AI busy · trying again in/.test(t)), 'with every model busy, it waits and says when it asks again');
  await page.screenshot({ path: `${shots}71-urdu-scan-busy.png` });
  mode = 'ok';
  check(await until(async () => (await aiPages(b.id)).includes(2), 90000), `once the AI is free again, the page is read by itself (${(await aiPages(b.id)).join(',')})`);
  // Scrolled away meanwhile: it carried on in the background.

  console.log('As I read');
  await page.locator('.pdfpage').nth(2).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await wait(1200);
  await tools();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'As I read' }).click();
  await page.getByRole('button', { name: 'Close' }).last().click();
  check(await until(async () => (await aiPages(b.id)).includes(3), 60000), `As I read reads the page being read and the ones after it (${(await aiPages(b.id)).join(',')})`);
  // Left on: it starts again by itself when the book is opened again.
  await page.evaluate(() => { location.hash = '#/library'; });
  await wait(1500);
  check((await theBook()).asIRead === true, 'As I read stays on for the book');
  await page.evaluate((id) => { location.hash = `#/book/${id}`; }, b.id);
  await page.locator('.pdfpage').first().waitFor({ timeout: 20000 });
  await watchToasts();
  check(await until(async () => (await page.evaluate(() => window.__pill)).some((t) => /as you read|Keeping the next pages/.test(t)), 15000), `and starts again by itself when the book is opened again (${(await page.evaluate(() => window.__pill)).slice(0, 3).join(' | ')})`);
  await page.getByRole('button', { name: 'Stop translating' }).click().catch(() => undefined);
  await wait(800);
  check((await theBook()).asIRead === false, 'Stop switches it off for the book');

  console.log('Whole book');
  await page.evaluate(() => { globalThis.__maktabaHoldReading = false; });
  await tools();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  // Once the AI answered again, the background reading of the rest went on by itself (held here);
  // otherwise Whole book starts it.
  const whole = page.getByRole('button', { name: /^Whole book/ });
  const label = await whole.textContent();
  check(/Whole book(: under way)?$/.test(label ?? ''), `Whole book is offered, or says it is under way (${label})`);
  if (label === 'Whole book') await whole.click();
  else await page.evaluate(() => window.dispatchEvent(new Event('maktaba:connected')));
  await page.getByRole('button', { name: 'Close' }).last().click();
  check(await until(async () => (await aiPages(b.id)).length === 5, 90000), `Whole book reads every page that is left (${(await aiPages(b.id)).join(',')})`);
  const all = (await read('translations')).filter((t) => t.bookId === b.id).length;
  const paras = (await read('sections')).filter((s) => s.bookId === b.id).flatMap((s) => s.blocks).filter((x) => x.ocr && x.text.trim().length > 1).length;
  check(await until(async () => (await read('translations')).filter((t) => t.bookId === b.id).length >= paras, 60000), `and every paragraph of the book is in English (${all} → ${(await read('translations')).filter((t) => t.bookId === b.id).length} of ${paras})`);
  check(calls.page <= 5 + 2, `each page was sent to the AI once (${calls.page} page requests for 5 pages)`);

  console.log('Reading it in English, like a book');
  await tools();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'English only' }).click();
  await page.getByRole('button', { name: 'Close' }).last().click();
  await wait(1200);
  check((await page.locator('.pdfpage').count()) === 0 && (await page.locator('.bk--en').count()) >= 10, `English only: the English runs on as a book's text, without the page pictures (${await page.locator('.pdfpage').count()} pictures, ${await page.locator('.bk--en').count()} English paragraphs)`);
  await page.locator('.rd-scroll').evaluate((el) => el.scrollTo(0, 0));
  await wait(600);
  await page.screenshot({ path: `${shots}74-urdu-scan-english-only.png` });
  await tools();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Page + English' }).click();
  await page.getByRole('button', { name: 'Close' }).last().click();
  await wait(1200);
  check((await page.locator('.pdfpage').count()) > 0, 'Page + English brings the printed pages back');
  await page.evaluate(() => { location.hash = '#/library'; });
  await page.getByRole('button', { name: 'Details for IslamAurSiyasat' }).click();
  await page.getByText(/read by your AI and put into English in the same step/).waitFor({ timeout: 8000 });
  await page.getByText(/read by your AI and put into English in the same step/).scrollIntoViewIfNeeded();
  await wait(600);
  await page.screenshot({ path: `${shots}73-urdu-scan-details.png` });
  check(errors.length === 0, `no errors in the page ${JSON.stringify(errors.slice(0, 2))}`);
} catch (e) {
  check(false, `stopped: ${e.message.split('\n')[0]}`);
  await page.screenshot({ path: `${shots}FAILED-scan-urdu.png` }).catch(() => undefined);
} finally {
  await browser.close();
  server.stop();
}
console.log(`${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(' -', f);
  process.exit(1);
}
