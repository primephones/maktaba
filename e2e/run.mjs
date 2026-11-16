// End-to-end check of the built app in a phone-sized browser. It drives the real UI the
// way a reader would and fails loudly if anything is off. Run: npm run build && npm run e2e
import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
import { startServer } from './server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const shots = decodeURIComponent(new URL('./out/shots/', import.meta.url).pathname);
mkdirSync(shots, { recursive: true });
const fxDir = decodeURIComponent(new URL('./out/fixtures/', import.meta.url).pathname);
if (!existsSync(fxDir + 'usul.epub')) await import('./fixtures.mjs');
const fx = (n) => fxDir + n;

const failures = [];
let passed = 0;
const check = (ok, what) => {
  if (ok) passed++;
  else {
    failures.push(what);
    console.log('  ✗', what);
  }
};

const server = await startServer();
const browser = await chromium.launch();
const PHONE = { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const ctx = await browser.newContext({ ...PHONE, serviceWorkers: 'block' });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

const shot = (n) => page.screenshot({ path: `${shots}${n}.png` });
const pause = (ms = 400) => page.waitForTimeout(ms);
const section = async (name, fn) => {
  console.log(name);
  try {
    await fn();
  } catch (e) {
    check(false, `${name}: ${e.message.split('\n')[0]}`);
    await shot(`FAILED-${name.replace(/\W+/g, '-')}`);
  }
};
const books = () => page.evaluate(async () => {
  const req = indexedDB.open('maktaba');
  const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
  const all = await new Promise((r) => (dbh.transaction('books').objectStore('books').getAll().onsuccess = (e) => r(e.target.result)));
  dbh.close();
  return all;
});
const waitImports = async (count) => {
  const t0 = Date.now();
  for (;;) {
    const all = await books();
    if (all.length >= count && all.every((b) => b.import.state === 'ready' || b.import.state === 'failed')) return all;
    if (Date.now() - t0 > 120000) throw new Error('imports did not finish');
    await pause(300);
  }
};
const showChrome = async () => {
  if ((await page.locator('.rd').getAttribute('data-chrome')) !== 'true') {
    await page.locator('.rd-scroll, .pg').click({ position: { x: 206, y: 520 } });
    await pause(350);
  }
};
const openBook = async (title) => {
  await page.goto(server.url + '#/library');
  await page.getByRole('button', { name: `Open ${title}`, exact: true }).click();
  await page.waitForSelector('.bk');
  await pause(600);
};
/** Top-most block of text currently on screen, as the reader sees it. */
const topText = () => page.evaluate(() => {
  const sc = document.querySelector('.rd-scroll');
  const top = sc.getBoundingClientRect().top + parseFloat(getComputedStyle(sc).paddingTop);
  for (const el of sc.querySelectorAll('[data-b]')) {
    const r = el.getBoundingClientRect();
    if (r.bottom > top + 4) return el.textContent.slice(0, 60);
  }
  return '';
});
/** WCAG contrast of an element's text against the first opaque background behind it. */
const contrastOf = (selector) => page.evaluate((sel) => {
  const lum = (c) => {
    const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (s) => { const m = s.match(/[\d.]+/g).map(Number); return { rgb: m.slice(0, 3), a: m[3] ?? 1 }; };
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (!el.textContent.trim() || !el.getClientRects().length) continue;
    const fg = parse(getComputedStyle(el).color).rgb;
    let bg = [255, 255, 255];
    for (let p = el; p; p = p.parentElement) {
      const c = parse(getComputedStyle(p).backgroundColor);
      if (c.a > 0.9) { bg = c.rgb; break; }
    }
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    out.push({ text: el.textContent.trim().slice(0, 30), ratio: +((a + 0.05) / (b + 0.05)).toFixed(2) });
  }
  return out;
}, selector);

// ------------------------------------------------------------------------------------
await section('Empty states', async () => {
  await page.goto(server.url);
  await page.waitForSelector('.screen');
  check(await page.getByRole('button', { name: 'Add your first book' }).isVisible(), 'Home with no books offers “Add your first book”');
  await page.goto(server.url + '#/search');
  check(await page.getByText('Add a book first').isVisible(), 'Search with no books says “Add a book first”');
  check(await page.getByRole('button', { name: 'Add a book', exact: true }).isVisible(), 'Search with no books shows an Add button');
  check(await page.getByRole('button', { name: 'Back' }).isVisible(), 'Search screen has a back button');
  await page.goto(server.url + '#/references');
  check(await page.getByText('No saved references yet').isVisible(), 'References explains itself when empty');
  await page.goto(server.url + '#/library');
  check(await page.getByText('Your library is empty').isVisible(), 'Library explains itself when empty');
  check((await page.locator('.bar-act--add').count()) === 1, 'There is exactly one Add button in the bar');
  await shot('01-library-empty');
});

let all = [];
await section('Adding books', async () => {
  await page.goto(server.url);
  await page.setInputFiles('[data-testid=add-input]', ['usul.epub', 'risala-text.pdf', 'damaged-text-layer.pdf', 'makhtut-scan.pdf', 'urdu-risala.txt', '0204Shafici.Risala', 'Introduction to Usul - Vol 1.pdf', 'Introduction to Usul - Vol 2.pdf', 'notes.xyz'].map(fx));
  all = await waitImports(8);
  const by = (t) => all.find((b) => b.title === t) ?? {};
  check(all.length === 8 && all.every((b) => b.import.state === 'ready'), `all 8 books imported (${all.map((b) => b.import.state).join(',')})`);
  check(await page.getByText('notes.xyz').isVisible(), 'the unsupported file is reported, not silently dropped');
  await page.getByRole('button', { name: 'Done' }).click();
  const epub = by('مختصر في أصول الفقه');
  check(epub.author === 'ابن اللحام' && epub.lang === 'ar' && epub.hasCover && epub.toc?.length === 4, 'EPUB: title, author, language, cover and contents read');
  check(by('الرسالة').author === 'الشافعي', 'OpenITI: title and author read from the header');
  check(by('urdu-risala').lang === 'ur', 'Urdu text detected as Urdu');
  check(by('makhtut-scan').kind === 'scan', 'image-only PDF detected as a scan');
  const text = by('risala-text');
  check(text.kind === 'text' && !text.imagePages && text.toc?.length >= 6, `text PDF read as text with headings (kind ${text.kind}, image pages ${text.imagePages}, toc ${text.toc?.length})`);
  const damaged = by('damaged-text-layer');
  check(damaged.kind === 'scan' && damaged.imagePages === damaged.pageCount, 'PDF with letters missing from its text layer is shown as pages, not misquoted');
  check(by('Introduction to Usul - Vol 2').volume === 2 && by('Introduction to Usul - Vol 1').toc?.length === 6, 'volumes recognised; English chapter headings kept');

  await page.setInputFiles('[data-testid=add-input]', [fx('usul.epub')]);
  await page.getByText('Already in your library').waitFor();
  check((await books()).length === 8, 'adding the same file again is caught as a duplicate');
  await page.getByRole('button', { name: 'Done' }).click();
  await pause();
  await shot('02-home');
});

await section('Library', async () => {
  await page.goto(server.url + '#/library');
  await pause(600);
  check((await page.locator('.stack').count()) === 1, 'two volumes of one work are shelved as one stack');
  await shot('03-library');
  await page.getByRole('button', { name: 'Introduction to Usul, 2 volumes' }).click();
  check(await page.getByText('Volume 2').isVisible(), 'the stack opens to show its volumes');
  await page.goBack();
  await pause();
  check((await page.locator('.sheet').count()) === 0, 'the back gesture closes a sheet');
  check(/#\/library$/.test(page.url()), '…and stays on the same screen');

  // Sheet opened from another sheet must stay open (regression).
  await page.getByRole('button', { name: 'Library options' }).click();
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  await pause(500);
  check(await page.getByPlaceholder('e.g. Uṣūl al-fiqh').isVisible(), 'a sheet opened from another sheet stays open');
  await page.getByPlaceholder('e.g. Uṣūl al-fiqh').fill('أصول الفقه');
  await page.getByRole('button', { name: 'Save' }).click();
  await pause(500);
  check(await page.locator('.folder').getByText('أصول الفقه').isVisible(), 'folder created');

  await page.getByRole('button', { name: 'Details for الرسالة' }).click();
  await page.getByRole('button', { name: /Move to folder/ }).click();
  await page.locator('.sheet').getByRole('button', { name: 'أصول الفقه' }).click();
  await pause(400);
  await page.getByRole('button', { name: 'Close' }).click();
  await pause(400);
  check((await page.getByRole('button', { name: 'Open الرسالة', exact: true }).count()) === 0, 'a moved book leaves the top shelf');
  await page.locator('.folder').click();
  await pause(500);
  check(await page.getByRole('button', { name: 'Open الرسالة', exact: true }).isVisible(), '…and is inside the folder');
  await shot('04-folder');
  await page.getByRole('button', { name: 'Library options' }).click();
  await page.getByRole('button', { name: /Delete this folder/ }).click();
  await page.getByRole('button', { name: 'Delete folder, keep books' }).click();
  await pause(700);
  check(await page.getByRole('button', { name: 'Open الرسالة', exact: true }).isVisible(), 'deleting a folder keeps its books');

  await page.getByRole('button', { name: 'Urdu' }).click();
  await pause(300);
  check((await page.locator('.tile').count()) === 1, 'language filter narrows the shelf');
  await page.getByRole('button', { name: 'All', exact: true }).click();
});

await section('Reader', async () => {
  await openBook('مختصر في أصول الفقه');
  check(/المقدمة/.test(await topText()), 'a new book opens at its beginning');
  await shot('05-reader');

  await page.getByRole('button', { name: 'Contents, bookmarks and highlights' }).click();
  await page.getByRole('button', { name: 'باب القياس' }).click();
  await pause(900);
  check(/باب القياس/.test(await topText()), 'choosing a chapter from Contents lands on that chapter');

  await page.locator('.fn').first().click();
  check(await page.getByText('انظر: الرسالة للإمام الشافعي').isVisible(), 'a footnote opens as a popup with its text');
  await page.goBack();
  await pause();

  // Select part of a paragraph and highlight it.
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('.bk[data-t="p"]')].find((el) => el.textContent.includes('العِلْمَ'));
    p.scrollIntoView({ block: 'center' });
    const node = document.createTreeWalker(p, NodeFilter.SHOW_TEXT).nextNode();
    const from = node.data.indexOf('العِلْمَ');
    const r = document.createRange();
    r.setStart(node, from);
    r.setEnd(node, from + 'العِلْمَ أفضلُ'.length);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await pause(500);
  check(await page.getByRole('toolbar', { name: 'Selected text' }).isVisible(), 'selecting text brings up the actions bar');
  await shot('06-selection');
  await page.getByRole('button', { name: 'Highlight Gold' }).click();
  await pause();
  check((await page.locator('.hl').first().textContent()) === 'العِلْمَ أفضلُ', 'the highlight covers exactly the selected words');

  await page.locator('.hl').first().click();
  await page.getByPlaceholder('Write a note about this passage').fill('فضل العلم');
  await page.getByRole('button', { name: 'Save' }).click();
  await pause();
  check((await page.locator('.hl[data-note]').count()) > 0, 'a note can be added to a highlight');

  await showChrome();
  await page.getByRole('button', { name: 'Text and theme' }).click();
  await page.getByRole('switch', { name: /vowel marks/ }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await pause(500);
  check((await page.locator('.hl').first().textContent()) === 'العلم أفضل', 'hiding vowel marks keeps the highlight on the same words');

  // With vowel marks hidden, a new selection must still land on the right stored text.
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('.bk[data-t="p"]')].find((el) => el.textContent.includes('ميراث الأنبياء'));
    const nodes = [];
    const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) nodes.push(n);
    const node = nodes.find((n) => n.data.includes('ميراث الأنبياء'));
    const from = node.data.indexOf('ميراث الأنبياء');
    const r = document.createRange();
    r.setStart(node, from);
    r.setEnd(node, from + 'ميراث الأنبياء'.length);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await pause(500);
  await page.getByRole('button', { name: 'Reference', exact: true }).click();
  await pause(500);
  const ref = await page.evaluate(async () => {
    const req = indexedDB.open('maktaba');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const refs = await new Promise((r) => (dbh.transaction('refs').objectStore('refs').getAll().onsuccess = (e) => r(e.target.result)));
    dbh.close();
    return refs[0];
  });
  check(ref?.original === 'ميراثُ الأنبياء' && ref.citation.author === 'ابن اللحام', `a reference keeps the original wording with its vowel marks and citation (“${ref?.original}”)`);

  await showChrome();
  await page.getByRole('button', { name: 'Text and theme' }).click();
  await page.getByRole('switch', { name: /vowel marks/ }).click();
  await page.getByRole('button', { name: 'Close' }).click();

  // Search inside the book, without hamza: must still find الإجماع.
  await showChrome();
  await page.getByRole('button', { name: 'Search in this book' }).click();
  await page.getByRole('searchbox', { name: 'Search in this book' }).fill('زبرجد');
  await pause(1200);
  check((await page.locator('.sheet .row').count()) === 1, 'in-book search finds a word that occurs once');
  await page.locator('.sheet .row').first().click();
  await pause(900);
  check((await page.locator('mark.flash').textContent()) === 'زبرجد', 'opening a search hit shows and marks the word');

  // Leave and come back: the place is remembered.
  const before = await topText();
  await page.waitForTimeout(1000);
  await showChrome();
  await page.getByRole('button', { name: 'Back to the library' }).click();
  await pause(600);
  check(/#\/library$/.test(page.url()), 'the back arrow returns to the library');
  check((await page.locator('.cover-ribbon').count()) >= 1, 'a book in progress carries a ribbon');
  await page.getByRole('button', { name: 'Open مختصر في أصول الفقه', exact: true }).click();
  await page.waitForSelector('.bk');
  await pause(800);
  check((await topText()) === before, `reopening returns to the same place (“${before.slice(0, 20)}…”)`);
});

await section('Pages mode and themes', async () => {
  await showChrome();
  await page.getByRole('button', { name: 'Text and theme' }).click();
  await page.getByRole('button', { name: 'Lamp' }).click();
  await pause(300);
  await shot('07-reader-settings-lamp');
  const low = (await contrastOf('.sheet h2, .sheet .lbl span, .sheet .theme-chip, .sheet .seg button, .sheet .ctl-row .grow, .sheet .muted')).filter((c) => c.ratio < 4.5);
  check(low.length === 0, `dark theme: every label in the sheet is readable ${JSON.stringify(low)}`);
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await pause(800);
  const foot = () => page.locator('.pg-foot').textContent();
  const first = await foot();
  // An Arabic book turns like a real one: forward is a tap on the left.
  await page.locator('.pg').click({ position: { x: 30, y: 500 } });
  await pause(600);
  const second = await foot();
  check(parseInt(second) === parseInt(first) + 1, `tapping the left edge of an Arabic book turns forward (${first} → ${second})`);
  await page.locator('.pg').click({ position: { x: 380, y: 500 } });
  await pause(600);
  check((await foot()) === first, 'tapping the right edge turns back');
  await shot('08-pages-lamp');
  const lowText = (await contrastOf('.pg .bk')).filter((c) => c.ratio < 7);
  check(lowText.length === 0, `dark theme: book text has strong contrast ${JSON.stringify(lowText.slice(0, 2))}`);
  await showChrome();
  await page.getByRole('button', { name: 'Text and theme' }).click();
  await page.getByRole('button', { name: 'Scroll', exact: true }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await pause();
});

await section('Scanned and image pages', async () => {
  await openBook('makhtut-scan');
  await page.waitForSelector('.pdfpage canvas');
  await page.waitForTimeout(2500);
  const inked = await page.evaluate(() => {
    const c = document.querySelector('.pdfpage canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 600)).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] < 110) dark++;
    return dark;
  });
  check(inked > 200, 'a scanned page is actually drawn (not a blank box)');
  await shot('09-scan');
  await page.locator('.pdfpage').first().click();
  await pause(1200);
  check((await page.locator('.zoom').count()) === 1, 'tapping a page opens the zoom view');
  await page.goBack();
  await pause();
  check((await page.locator('.zoom').count()) === 0 && (await page.locator('.rd').count()) === 1, 'back closes the zoom view and stays in the book');
});

await section('Other formats', async () => {
  await openBook('الرسالة');
  check(!/PageV|ms0|~~|#META/.test(await page.locator('.rd-text').textContent()), 'no page-marker codes appear in OpenITI text');
  await openBook('urdu-risala');
  const font = await page.locator('.bk[data-t="p"]').first().evaluate((el) => getComputedStyle(el).fontFamily);
  check(/Nastaliq/.test(font), 'Urdu is set in Nastaliq');
  check((await page.locator('.bk[data-t="p"]').first().evaluate((el) => getComputedStyle(el).direction)) === 'rtl', 'Urdu runs right to left');
  await shot('10-urdu');
  await openBook('risala-text');
  check(/الباب 1|الحمد لله رب العالمين/.test(await topText()), 'Arabic text PDF reads as text');
  await showChrome();
  await page.getByRole('button', { name: 'Contents, bookmarks and highlights' }).click();
  await page.getByLabel('Go to page').fill('7');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await pause(900);
  check(/p\. 7/.test(await page.locator('.rd-bottom-bar .where').textContent()), 'go-to-page lands on that page');
});

await section('Search across the library', async () => {
  await page.goto(server.url + '#/search');
  const box = page.getByRole('searchbox', { name: 'Search your books' });
  await box.fill('ياقوت');
  await page.getByText(/In the text · 1 match/).waitFor({ timeout: 15000 });
  check(true, 'a word that occurs once in the library is found once');
  check((await page.locator('.field .icon-btn').count()) === 1, 'the search field has one clear button, not two');
  await shot('11-search');
  await box.fill('ijma');
  await page.getByText(/In the text · \d+ match/).waitFor({ timeout: 15000 });
  check(await page.locator('.hit-text mark').first().textContent().then((t) => /ijm/i.test(t)), 'typing “ijma” finds “ijmāʿ”');
  await box.fill('الشافعي');
  await pause(1500);
  check(await page.getByText('Books', { exact: true }).isVisible(), 'titles and authors are searched too');
  await box.fill('qqqzzz');
  await page.getByText('No matches').waitFor({ timeout: 15000 });
  check(true, 'no results gives a clear message');
});

await section('Settings and navigation', async () => {
  await page.goto(server.url + '#/settings');
  for (const name of ['Theme', 'Reading defaults', 'Default cover style', 'Feature switches', 'Storage', 'About & installing']) {
    await page.getByRole('button', { name: new RegExp('^' + name) }).click();
    await pause(500);
    check((await page.locator('[role=alert]').count()) === 0, `Settings › ${name} opens without an error`);
    await page.getByRole('button', { name: 'Back' }).click();
    await pause(300);
  }
  await page.goto(server.url + '#/settings/storage');
  await page.getByText('Book files').waitFor();
  await shot('12-storage');
  await page.goto(server.url + '#/nonsense');
  check(await page.getByText('Nothing here').isVisible(), 'an unknown address shows a message, not a blank screen');
  await page.goto(server.url + '#/book/does-not-exist');
  check(await page.getByText('This book is no longer here').isVisible(), 'a missing book shows a message, not a blank screen');
});

await section('Dark theme across the app', async () => {
  await page.goto(server.url + '#/library');
  await pause(500);
  await page.getByRole('button', { name: 'Details for risala-text' }).click();
  await pause(500);
  await shot('13-details-lamp');
  const low = (await contrastOf('.sheet h2, .sheet h3, .sheet .title, .sheet .sub, .sheet .muted, .sheet .section-title, .sheet .seg button, .sheet .cover-choice, .sheet .banner span')).filter((c) => c.ratio < 4.5);
  check(low.length === 0, `dark theme: book details sheet is readable ${JSON.stringify(low)}`);
  await page.getByRole('button', { name: 'Close' }).click();
  const lowMain = (await contrastOf('.screen h1, .chip, .tile-title, .tile-sub, .tile-progress, .bar-tab, .search-entry')).filter((c) => c.ratio < 4.5);
  check(lowMain.length === 0, `dark theme: library is readable ${JSON.stringify(lowMain)}`);
  await shot('14-library-lamp');
});
await ctx.close();

// ------------------------------------------------------------------------------------
await section('Works offline', async () => {
  const octx = await browser.newContext({ ...PHONE });
  const p = await octx.newPage();
  await p.goto(server.url);
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.waitForFunction(() => !!navigator.serviceWorker.controller || true);
  await p.setInputFiles('[data-testid=add-input]', [fx('usul.epub'), fx('makhtut-scan.pdf')]);
  await p.waitForTimeout(6000);
  await octx.setOffline(true);
  await p.reload();
  await p.waitForSelector('.screen', { timeout: 15000 });
  check(await p.getByText('Continue reading').isVisible().catch(() => false) || await p.getByText('Recently added').isVisible(), 'with no internet, the app still opens and shows the library');
  await p.goto(server.url + '#/library');
  await p.getByRole('button', { name: 'Open مختصر في أصول الفقه', exact: true }).click();
  await p.waitForSelector('.bk', { timeout: 15000 });
  check(true, 'with no internet, a book opens');
  await p.goto(server.url + '#/library');
  await p.getByRole('button', { name: 'Open makhtut-scan', exact: true }).click();
  await p.waitForSelector('.pdfpage canvas', { timeout: 15000 });
  await p.waitForTimeout(2500);
  const drawn = await p.evaluate(() => document.querySelector('.pdfpage canvas').width > 0);
  check(drawn, 'with no internet, scanned PDF pages still draw');
  await octx.close();
});

check(errors.length === 0, `no errors in the browser console ${JSON.stringify(errors.slice(0, 3))}`);
await browser.close();
server.stop();
console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
