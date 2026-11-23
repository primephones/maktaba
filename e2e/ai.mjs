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
import { openSync } from 'node:fs';
const logFd = openSync(`${root}e2e/out/server.log`, 'w');
const run = (cmd, args, opts = {}) => spawn(cmd, args, { cwd: `${root}server`, stdio: ['ignore', logFd, logFd], detached: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', ...(opts.env ?? {}) } });
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
let key = '';
try {
  await page.goto(app.url);
  await page.setInputFiles('[data-testid=add-input]', [fx('usul.epub')]);
  await wait(3000);

  console.log('Connecting to the server');
  await go('#/settings/ai');
  await page.getByText('Advanced: your own Maktaba server').click();
  await page.getByLabel('Server address').fill('http://127.0.0.1:8788');
  await page.getByLabel(/Setup code/).fill('test-setup');
  await page.getByRole('button', { name: 'Connect to the server' }).click();
  await page.getByText(/requests? today|Nothing asked of your AI today/).waitFor({ timeout: 15000 });
  key = await page.locator('.sync-key').first().textContent();
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
  check(await page.locator('.tr-label').first().textContent().then((t) => /Translated by your AI/.test(t)), 'the English is quietly labelled as translated by your AI');
  await page.locator('.tr-label').first().click();
  await page.getByRole('dialog', { name: 'About this English' }).getByText(/Made by .*gpt-oss|Made by /).waitFor({ timeout: 5000 });
  check(true, 'tapping the label tells which AI made the English, and when');
  await page.getByRole('button', { name: 'Close' }).click();
  await wait(400);
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
  // Highlighting the English itself: kept against the English words, and still there after reopening.
  const enPara = page.locator('.bk--en[data-t="p"]').nth(1);
  const enS = await enPara.getAttribute('data-s');
  const enB = await enPara.getAttribute('data-b');
  await enPara.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    const r = document.createRange();
    r.setStart(node, 0);
    r.setEnd(node, Math.min(24, node.data.length));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await wait(500);
  await page.getByRole('button', { name: 'Highlight Gold' }).click();
  await wait(600);
  const enHl = page.locator(`.bk--en[data-s="${enS}"][data-b="${enB}"] .hl`);
  check((await enHl.count()) === 1, 'a passage of the English can be highlighted');
  await page.reload();
  await page.waitForSelector('.bk--en');
  await wait(800);
  check((await page.locator(`.bk--en[data-s="${enS}"][data-b="${enB}"] .hl`).count()) === 1, 'the English highlight is still there after reopening the book');
  await shot('22b-english-highlight');
  // With the bars hidden: time left in the chapter and the page, in the bottom corners.
  const foot = await page.locator('.rd-foot').textContent();
  check(/min left in chapter|Less than a minute/.test(foot) && /\d+ of \d+/.test(foot), `the foot of the page shows time left in the chapter and the page (“${foot}”)`);
  // Where the English stops, a way to carry on from there.
  const gapBook = await page.evaluate(() => location.hash.split("/")[2]);
  await page.evaluate(async ({ bookId, s, b }) => {
    const req = indexedDB.open('maktaba');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const tx = dbh.transaction('translations', 'readwrite');
    for (const k of [2, 3]) tx.objectStore('translations').delete(`${bookId}:${s}:${b + k}`);
    await new Promise((r) => (tx.oncomplete = r));
  }, { bookId: gapBook, s: Number(enS), b: Number(enB) });
  // Written behind the app's back: open the book again to see it.
  await page.reload();
  await page.waitForSelector('.bk--en');
  await page.locator('.tr-gap').first().waitFor({ timeout: 8000 });
  check((await page.locator('.tr-gap').count()) === 1, 'where a part has no English, one quiet “Translate from here” is shown');
  await page.locator('.tr-gap').getByRole('button', { name: /Translate from here/ }).click();
  await page.waitForFunction(() => !document.querySelector('.tr-gap'), null, { timeout: 30000 });
  check(true, 'and it translates from there');
  if ((await page.locator('.rd').getAttribute('data-chrome')) !== 'true') await page.mouse.click(200, 40);
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Both', exact: true }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await wait(500);
  check((await page.locator('.bk-pair').count()) > 5, '“Both” shows the English under the original');
  await shot('24-reader-both');

  console.log('Asking your books');
  await go('#/search');
  await page.getByRole('searchbox', { name: 'Search or ask your books' }).fill('Is consensus a proof?');
  await page.getByRole('button', { name: /Ask your books/ }).click();
  await page.locator('.answer').waitFor({ timeout: 30000 });
  check((await page.locator('.answer .cite').count()) > 0, 'an answer comes back citing passages from the books');
  check((await page.locator('.sources li').count()) > 0, 'each cited passage is listed with where it comes from');
  check((await page.getByText('could not be found word for word').count()) === 0, 'its quotation was checked against the passage');
  await shot('26-ask');
  // For and against: the positions, with arguments and objections, each from a passage.
  await page.getByRole('button', { name: 'For and against' }).click();
  await page.getByRole('button', { name: 'Find the arguments' }).click();
  await page.locator('.position').first().waitFor({ timeout: 30000 });
  check((await page.locator('.position-label.is-for').count()) > 0 && (await page.locator('.position-label.is-against').count()) > 0, 'For and against: each position with its arguments and the objections to it');
  check((await page.locator('.position .cite').count()) >= 2 && (await page.locator('.sources li').count()) > 0, 'every point cites the passage it comes from');
  await shot('26-ask-for-against');
  await page.getByRole('button', { name: 'Answer', exact: true }).click();
  await page.getByRole('button', { name: /Ask your books/ }).click();
  await page.locator('.answer .cite').first().waitFor({ timeout: 30000 });
  await page.locator('.answer .cite').first().click();
  await page.waitForSelector('.rd');
  check(true, 'tapping a citation opens the passage in the book');

  console.log('Explain and iʿrāb');
  await page.waitForSelector('.bk');
  await wait(600);
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('.bk[data-t="p"]')].find((el) => /[\u0600-\u06FF]/.test(el.textContent) || el.dataset.en !== undefined);
    const r = document.createRange();
    r.selectNodeContents(p);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await wait(400);
  await page.getByRole('button', { name: 'Explain', exact: true }).click();
  await page.getByText('This passage says that consensus').waitFor({ timeout: 20000 });
  check(true, 'Explain gives an explanation, marked as an AI draft');
  await page.getByRole('button', { name: 'Close' }).click();
  await wait(400);
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('.bk[data-t="p"]')].find((el) => el.dataset.en === undefined && /[\u0600-\u06FF]/.test(el.textContent));
    const r = document.createRange();
    r.selectNodeContents(p);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await wait(400);
  const irabBtn = page.getByRole('button', { name: 'Iʿrāb', exact: true });
  if (await irabBtn.count()) {
    await irabBtn.click();
    await page.locator('.irab-card').first().waitFor({ timeout: 20000 });
    check((await page.locator('.irab-case').count()) >= 4, 'iʿrāb shows each word’s case');
    await page.getByRole('button', { name: 'Why?' }).first().click();
    check(await page.getByText(/a subject is marfūʿ/).first().isVisible(), 'and why it takes that case, in plain English');
    await shot('27-irab-why');
    await page.getByRole('button', { name: 'Test yourself' }).click();
    check((await page.locator('.irab-case').count()) === 0, 'Test yourself hides the cases');
    // The first word is marfūʿ: right; the second is manṣūb: answer wrongly.
    await page.locator('.irab-choices').first().getByRole('button', { name: 'Marfūʿ' }).click();
    await page.locator('.irab-choices').first().getByRole('button', { name: 'Majrūr' }).click();
    check(await page.getByText('Right.').first().isVisible() && (await page.getByText(/Not Majrūr: it is Manṣūb/).count()) === 1, 'each answer is marked right or wrong, with the reason');
    await shot('27-irab-test');
    await page.getByRole('button', { name: 'Show the analysis' }).click();
    await page.getByRole('button', { name: 'Correct' }).click();
    await page.locator('.irab input').first().fill('مبتدأ مرفوع وعلامة رفعه الضمة');
    await page.getByRole('button', { name: 'Save corrections' }).click();
    await page.getByText('Corrected by you.').waitFor();
    check(true, 'iʿrāb can be corrected, and the correction is kept');
    await shot('27-irab');
    await page.getByRole('button', { name: 'Close' }).click();
  } else {
    check(false, 'Iʿrāb is offered for Arabic text');
  }

  console.log('Chapter summary');
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.getByRole('button', { name: 'Contents, bookmarks and highlights' }).click();
  await page.getByRole('button', { name: /Summarise this chapter/ }).click();
  await page.getByText('The chapter defines analogy').waitFor({ timeout: 20000 });
  const cites = await page.locator('.summary-text .cite').count();
  check(cites === 2, `the summary cites its passages, and a made-up citation is dropped (${cites} citations)`);
  await shot('28-summary');
  await page.locator('.summary-text .cite').first().click();
  await wait(700);
  check((await page.locator('.sheet').count()) === 0, 'tapping a citation goes to the passage');
  // Asked once: opening it again needs no new request.
  await page.getByRole('button', { name: 'Contents, bookmarks and highlights' }).click();
  await page.getByRole('button', { name: /Summarise this chapter/ }).click();
  await page.getByText('The chapter defines analogy').waitFor({ timeout: 3000 });
  check(true, 'the summary is kept and shown again at once');
  await page.getByRole('button', { name: 'Close' }).click();
  await wait(400);

  console.log('Putting the English right');
  await go('#/library');
  await page.getByRole('button', { name: 'Open مختصر في أصول الفقه', exact: true }).click();
  await page.waitForSelector('.bk--en');
  await wait(1500);
  if ((await page.locator('.rd').getAttribute('data-chrome')) !== 'true') await page.mouse.click(200, 40);
  // The contents in English, with the chapters that have English marked.
  await page.getByRole('button', { name: 'Contents, bookmarks and highlights' }).click();
  await page.locator('.toc-two .toc-en', { hasText: 'in English' }).first().waitFor({ timeout: 20000 });
  check(true, 'the contents are put into English, the original beneath each title');
  check((await page.locator('.toc-en-mark').count()) >= 1, 'chapters that have English are marked in the contents');
  await shot('27b-contents-english');
  await page.getByRole('button', { name: 'Close' }).click();
  await wait(400);
  // Correct one paragraph's English by hand.
  const fixP = page.locator('.bk--en[data-t="p"]').nth(2);
  const fixS = await fixP.getAttribute('data-s');
  const fixB = await fixP.getAttribute('data-b');
  await fixP.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await wait(500);
  await page.getByRole('button', { name: 'Correct', exact: true }).click();
  await page.getByRole('dialog', { name: 'This paragraph’s English' }).waitFor({ timeout: 5000 });
  await page.getByLabel('English of this paragraph').fill('Corrected by the reader: knowledge is what benefits.');
  await page.getByRole('button', { name: 'Keep my correction' }).click();
  await wait(700);
  check(/Corrected by the reader/.test(await page.locator(`.bk--en[data-s="${fixS}"][data-b="${fixB}"]`).textContent()), 'a paragraph’s English can be corrected by hand, and the correction is what is read');
  // Translate it again, more literally.
  await page.locator(`.bk--en[data-s="${fixS}"][data-b="${fixB}"]`).evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await wait(500);
  await page.getByRole('button', { name: 'Correct', exact: true }).click();
  await page.getByRole('button', { name: 'More literal' }).click();
  await page.getByText('Translated again.').waitFor({ timeout: 20000 });
  check(/English of paragraph/.test(await page.locator(`.bk--en[data-s="${fixS}"][data-b="${fixB}"]`).textContent()), 'and it can be translated again, more literally');
  // Always translate a name this way, in this book.
  await page.getByLabel('The word or name as in the book').fill('الشافعي');
  await page.getByLabel('Always in English as').fill('Imam al-Shāfiʿī');
  await page.getByRole('button', { name: 'Keep', exact: true }).click();
  await wait(400);
  await page.getByRole('button', { name: 'Close' }).click();
  await wait(400);
  if ((await page.locator('.rd').getAttribute('data-chrome')) !== 'true') await page.mouse.click(200, 40);
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: /Names and terms in this book/ }).click();
  await page.getByText('Imam al-Shāfiʿī').waitFor({ timeout: 5000 });
  check(true, 'the book’s word list keeps how a name is to be said, to read through and change');
  await shot('27c-word-list');
  await page.getByRole('button', { name: 'Close' }).click();
  await wait(400);
  // A technical term in the English: tap it for its meaning.
  const tBook = await page.evaluate(() => location.hash.split('/')[2]);
  await page.evaluate(async ({ bookId, s, b }) => {
    const req = indexedDB.open('maktaba');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const tx = dbh.transaction('translations', 'readwrite');
    const st = tx.objectStore('translations');
    const row = await new Promise((r) => (st.get(`${bookId}:${s}:${b}`).onsuccess = (e) => r(e.target.result)));
    st.put({ ...row, en: 'This is established by ijmāʿ (consensus), the agreement of the scholars.', updatedAt: Date.now() - 60000 });
    await new Promise((r) => (tx.oncomplete = r));
  }, { bookId: tBook, s: Number(fixS), b: Number(fixB) });
  await page.reload();
  await page.waitForSelector('.bk--en');
  await wait(800);
  await page.locator('.bk--en .term').first().click();
  await page.getByText(/Consensus of the qualified jurists/).waitFor({ timeout: 15000 });
  check(true, 'a technical term in the English can be tapped for its meaning');
  await page.getByRole('button', { name: 'Close' }).click();
  await wait(400);

  console.log('The English as a book, and welcome back');
  await go('#/library');
  await page.getByRole('button', { name: 'Details for مختصر في أصول الفقه' }).click();
  const fs = await import('node:fs');
  const [ep] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: /E-book \(EPUB\)/ }).click()]);
  const { unzipSync, strFromU8 } = await import('fflate');
  const epubBytes = new Uint8Array(fs.readFileSync(await ep.path()));
  const entries = unzipSync(epubBytes);
  const firstName = strFromU8(epubBytes.slice(30, 38));
  const chapterText = Object.entries(entries).filter(([k]) => /OEBPS\/ch\d+\.xhtml$/.test(k)).map(([, v]) => strFromU8(v)).join('');
  check(firstName === 'mimetype' && strFromU8(entries.mimetype) === 'application/epub+zip' && !!entries['OEBPS/nav.xhtml'] && /English of paragraph/.test(chapterText), `the English downloads as an e-book for any e-reader (${ep.suggestedFilename()})`);
  const [pd] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name: 'PDF', exact: true }).click()]);
  const pdfHead = fs.readFileSync(await pd.path()).slice(0, 5).toString();
  check(pdfHead === '%PDF-', 'and as a PDF');
  await page.getByRole('button', { name: 'Close' }).click();
  await wait(400);
  // Away for a few days: an offer to recall where the book had got to.
  const rBook = await page.evaluate(async () => {
    const req = indexedDB.open('maktaba');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const tx = dbh.transaction('books', 'readwrite');
    const st = tx.objectStore('books');
    const all = await new Promise((r) => (st.getAll().onsuccess = (e) => r(e.target.result)));
    const b = all.find((x) => x.title === 'مختصر في أصول الفقه');
    st.put({ ...b, openedAt: Date.now() - 5 * 86_400_000, progress: { section: 2, block: 2, fraction: 0.4, updatedAt: Date.now() } });
    await new Promise((r) => (tx.oncomplete = r));
    dbh.close();
    return b.id;
  });
  await page.reload();
  await go(`#/book/${rBook}`);
  await page.locator('.rd-recap').waitFor({ timeout: 10000 });
  check(true, 'back after a few days, the book offers to recall where you were');
  await page.locator('.rd-recap button').first().click();
  await page.getByText(/The chapter defines analogy/).waitFor({ timeout: 20000 });
  check(true, 'and recalls the pages before your place in a few lines');
  await shot('46-welcome-back');
  await page.getByRole('button', { name: 'Carry on reading' }).click();
  await wait(400);

  console.log('Sync between two phones');
  // Phone A highlights a passage and makes a folder, through the app.
  await go('#/library');
  const bookId = await page.evaluate(async () => {
    const req = indexedDB.open('maktaba');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const books = await new Promise((r) => (dbh.transaction('books').objectStore('books').getAll().onsuccess = (e) => r(e.target.result)));
    dbh.close();
    return books[0].id;
  });
  await page.getByRole('button', { name: 'Library options' }).click();
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  await page.getByPlaceholder('e.g. Uṣūl al-fiqh').fill('أصول');
  await page.getByRole('button', { name: 'Save' }).click();
  await wait(500);
  await page.getByRole('button', { name: 'Open مختصر في أصول الفقه', exact: true }).click();
  await page.waitForSelector('.bk');
  if ((await page.locator('.rd').getAttribute('data-chrome')) !== 'true') await page.mouse.click(200, 40);
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await wait(500);
  await page.evaluate(() => {
    const p = document.querySelectorAll('.bk[data-t="p"]')[0];
    const r = document.createRange();
    r.selectNodeContents(p);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await wait(400);
  await page.getByRole('button', { name: 'Note', exact: true }).click();
  await page.getByPlaceholder('Write a note about this passage').fill('Written on phone A');
  await page.getByRole('button', { name: 'Save' }).click();
  await wait(600);
  await wait(1000);
  await go('#/settings/ai');
  await page.getByRole('button', { name: 'Sync now' }).click();
  await page.getByText('Up to date with your other phones.').waitFor({ timeout: 20000 });
  check(true, 'phone A syncs its library');

  const ctxB = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const phoneB = await ctxB.newPage();
  phoneB.on('pageerror', (e) => errors.push('B: ' + e.message));
  await phoneB.goto(app.url + '#/settings/ai');
  await phoneB.getByText('Advanced: your own Maktaba server').click();
  await phoneB.getByRole('button', { name: 'My other phone' }).click();
  await phoneB.getByLabel('Server address').fill('http://127.0.0.1:8788');
  await phoneB.getByLabel(/Your sync key/).fill(key.toLowerCase().replace(/-/g, ' '));
  await phoneB.getByRole('button', { name: 'Connect to the server' }).click();
  await phoneB.getByText(/requests? today|Nothing asked of your AI today/).waitFor({ timeout: 15000 });
  check(true, 'phone B joins with the key typed in any style');
  await phoneB.screenshot({ path: `${shots}29-phone-b-connected.png`, fullPage: true });
  await phoneB.getByRole('button', { name: 'Sync now' }).click();
  await phoneB.getByText('Up to date with your other phones.').waitFor({ timeout: 20000 });
  const seen = await phoneB.evaluate(async () => {
    const req = indexedDB.open('maktaba');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const get = (t) => new Promise((r) => (dbh.transaction(t).objectStore(t).getAll().onsuccess = (e) => r(e.target.result)));
    const out = { books: await get('books'), marks: await get('marks'), folders: await get('folders'), translations: (await get('translations')).length };
    dbh.close();
    return out;
  });
  check(seen.books.length === 1 && seen.books[0].import.state === 'missing', 'phone B shows the book, waiting for its file');
  check(seen.marks.some((m) => m.note === 'Written on phone A') && seen.folders.some((f) => f.name === 'أصول'), 'the note and the folder arrive on phone B');
  check(seen.translations > 0, `the translation arrives on phone B (${seen.translations} paragraphs)`);
  await phoneB.evaluate(() => { location.hash = '#/library'; });
  await wait(700);
  await phoneB.screenshot({ path: `${shots}25-phone-b-waiting.png` });
  await phoneB.setInputFiles('[data-testid=add-input]', [fx('usul.epub')]);
  for (let i = 0; i < 20; i++) {
    const st = await phoneB.evaluate(async () => {
      const req = indexedDB.open('maktaba');
      const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
      const books = await new Promise((r) => (dbh.transaction('books').objectStore('books').getAll().onsuccess = (e) => r(e.target.result)));
      dbh.close();
      return books.map((x) => [x.id, x.import.state]);
    });
    if (st.length === 1 && st[0][1] === 'ready') {
      check(st[0][0] === bookId, 'adding the same file on phone B attaches it to the synced book');
      break;
    }
    await wait(500);
  }
  await phoneB.evaluate(() => { location.hash = '#/library'; });
  await phoneB.getByRole('button', { name: 'Open مختصر في أصول الفقه', exact: true }).click();
  await phoneB.waitForSelector('.bk');
  await wait(600);
  check((await phoneB.locator('.hl[data-note]').count()) > 0, 'phone B opens the book with phone A’s note on the passage');
  check((await phoneB.locator('.bk--en').count()) === 0, 'and in Original, as phone A last chose');
  // A folder made on B reaches A.
  await phoneB.evaluate(() => { location.hash = '#/library'; });
  await wait(500);
  await phoneB.getByRole('button', { name: 'Library options' }).click();
  await phoneB.getByRole('button', { name: 'New folder', exact: true }).click();
  await phoneB.getByPlaceholder('e.g. Uṣūl al-fiqh').fill('Written on phone B');
  await phoneB.getByRole('button', { name: 'Save' }).click();
  await wait(600);
  await phoneB.evaluate(() => { location.hash = '#/settings/ai'; });
  await wait(600);
  await phoneB.getByRole('button', { name: 'Sync now' }).click();
  await phoneB.getByText('Up to date with your other phones.').waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Sync now' }).click();
  await wait(2500);
  const onA = await page.evaluate(async () => {
    const req = indexedDB.open('maktaba');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const folders = await new Promise((r) => (dbh.transaction('folders').objectStore('folders').getAll().onsuccess = (e) => r(e.target.result)));
    dbh.close();
    return folders.map((f) => f.name);
  });
  check(onA.includes('Written on phone B'), 'a folder made on phone B reaches phone A');
  await ctxB.close();

  console.log('A new book, named after its file');
  await go('#/library');
  await page.setInputFiles('[data-testid=add-input]', [fx('risala-text.pdf')]);
  let named = null;
  for (let i = 0; i < 60 && !named; i++) {
    await wait(1000);
    named = await page.evaluate(async () => {
      const req = indexedDB.open('maktaba');
      const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
      const books = await new Promise((r) => (dbh.transaction('books').objectStore('books').getAll().onsuccess = (e) => r(e.target.result)));
      dbh.close();
      const b = books.find((x) => x.fileName === 'risala-text.pdf');
      return b && b.title !== 'risala-text' ? { title: b.title, en: b.titleEn, author: b.author } : null;
    });
  }
  check(named?.title === 'الرسالة' && named?.en === 'al-Risāla' && named?.author === 'الشافعي', `a book named after its file gets its real title and author from its first pages (${JSON.stringify(named)})`);
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
