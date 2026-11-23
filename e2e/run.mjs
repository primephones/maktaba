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

const shot = (n) => page.screenshot({ path: `${shots}${n}.png` }).catch(() => undefined);
const pause = (ms = 400) => page.waitForTimeout(ms);
/** Moves to another screen by address, as a link or the back stack would, and lets it settle. */
const go = async (hash) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await pause(600);
};
const section = async (name, fn) => {
  console.log(name);
  try {
    await fn();
  } catch (e) {
    const at = (e.stack ?? '').split('\n').find((l) => l.includes('run.mjs')) ?? '';
    check(false, `${name}: ${e.message.split('\n')[0]} ${at.trim()}`);
    const call = e.message.split('\n').find((l) => /waiting for/.test(l));
    if (call) console.log('     ', call.trim());
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
/** A tool in the reader's More sheet. */
const fromMore = async (name) => {
  await showChrome();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).last().click();
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
const contrastOf = (selector, bgVar) => page.evaluate(([sel, bgVar]) => {
  const lum = (c) => {
    const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (s) => { const k = /^color\(srgb/.test(s) ? 255 : 1; const m = s.match(/[\d.]+/g).map(Number); return { rgb: m.slice(0, 3).map((v) => v * k), a: m[3] ?? 1 }; };
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (!el.textContent.trim() || !el.getClientRects().length) continue;
    const fg = parse(getComputedStyle(el).color).rgb;
    let bg = [255, 255, 255];
    if (bgVar) {
      // A surface painted with a gradient: measure against the named colour instead.
      const hex = getComputedStyle(el).getPropertyValue(bgVar).trim().replace('#', '');
      bg = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    } else {
      for (let p = el; p; p = p.parentElement) {
        const c = parse(getComputedStyle(p).backgroundColor);
        if (c.a > 0.9) { bg = c.rgb; break; }
      }
    }
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
    out.push({ text: el.textContent.trim().slice(0, 30), ratio: +((a + 0.05) / (b + 0.05)).toFixed(2) });
  }
  return out;
}, [selector, bgVar]);

// ------------------------------------------------------------------------------------
await section('Empty states', async () => {
  await page.goto(server.url);
  await page.waitForSelector('.screen');
  check(await page.getByRole('button', { name: 'Add your first book' }).waitFor({ timeout: 5000 }).then(() => true, () => false), 'Home with no books offers “Add your first book”');
  await go('#/search');
  check(await page.getByText('Add a book first').isVisible(), 'Search with no books says “Add a book first”');
  check(await page.getByRole('button', { name: 'Add a book', exact: true }).isVisible(), 'Search with no books shows an Add button');
  check(await page.getByRole('button', { name: 'Back' }).isVisible(), 'Search screen has a back button');
  await go('#/references');
  check(await page.getByText('No saved references yet').isVisible(), 'References explains itself when empty');
  await go('#/library');
  check(await page.getByText('Your library is empty').isVisible(), 'Library explains itself when empty');
  check((await page.locator('.bar-act--add').count()) === 1, 'There is exactly one Add button in the bar');
  await shot('01-library-empty');
});

let all = [];
await section('Adding books', async () => {
  await page.goto(server.url);
  await page.setInputFiles('[data-testid=add-input]', ['usul.epub', 'risala-text.pdf', 'damaged-text-layer.pdf', 'makhtut-scan.pdf', 'urdu-risala.txt', '0204Shafici.Risala', 'Introduction to Usul - Vol 1.pdf', 'Introduction to Usul - Vol 2.pdf', 'tahara.mobi', 'notes.xyz'].map(fx));
  all = await waitImports(9);
  const by = (t) => all.find((b) => b.title === t) ?? {};
  check(all.length === 9 && all.every((b) => b.import.state === 'ready'), `all 9 books imported (${all.map((b) => b.import.state).join(',')})`);
  check(await page.getByText('notes.xyz').first().isVisible(), 'the unsupported file is reported, not silently dropped');
  await page.getByRole('button', { name: 'Done' }).click();
  const epub = by('مختصر في أصول الفقه');
  check(epub.author === 'ابن اللحام' && epub.lang === 'ar' && epub.hasCover && epub.toc?.length === 4, 'EPUB: title, author, language, cover and contents read');
  check(by('الرسالة').author === 'الشافعي', 'OpenITI: title and author read from the header');
  const kindle = by('كتاب الطهارة');
  check(kindle.format === 'mobi' && kindle.author === 'مؤلف تجريبي' && kindle.sectionCount === 2 && kindle.toc?.length === 2, 'Kindle (MOBI): title, author, chapters and contents read');
  check(by('urdu-risala').lang === 'ur', 'Urdu text detected as Urdu');
  check(by('makhtut-scan').kind === 'scan', 'image-only PDF detected as a scan');
  const text = by('risala-text');
  check(text.kind === 'text' && !text.imagePages && text.toc?.length >= 6, `text PDF read as text with headings (kind ${text.kind}, image pages ${text.imagePages}, toc ${text.toc?.length})`);
  const damaged = by('damaged-text-layer');
  check(damaged.imagePages >= 2, `pages whose text layer has letters missing are shown as page images, not misquoted (${damaged.imagePages} of ${damaged.pageCount})`);
  check(by('Introduction to Usul - Vol 2').volume === 2 && by('Introduction to Usul - Vol 1').toc?.length === 6, 'volumes recognised; English chapter headings kept');

  await page.setInputFiles('[data-testid=add-input]', [fx('usul.epub')]);
  await page.getByText('Already in your library').waitFor();
  check((await books()).length === 9, 'adding the same file again is caught as a duplicate');
  await page.getByRole('button', { name: 'Done' }).click();
  await pause();
  await shot('02-home');
});

await section('Library', async () => {
  await go('#/library');
  check((await page.locator('.vol-stack').count()) === 1, 'two volumes of one work are shelved as one stack');
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
  check(/0 books/.test(await page.locator('.folder').textContent()), 'a new folder shows it is empty');

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

  await page.getByRole('button', { name: 'Urdu', exact: true }).click();
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
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.getByRole('button', { name: 'Add citation' }).click();
  await pause(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check(clip === 'ميراثُ الأنبياء\n— ابن اللحام، مختصر في أصول الفقه، المقدمة', `copy with citation gives the passage and its source (“${clip.replace(/\n/g, ' / ')}”)`);
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

  // The Qur'an: a reference and a quotation without one, both open the verse offline.
  await page.locator('.qref').first().click();
  await page.getByText('Al-Baqarah 2:255').waitFor({ timeout: 10000 });
  check(await page.locator('.verse-ar').first().textContent().then((t) => t.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '').replace(/ٱ/g, 'ا').includes('القيوم')), 'a Qur’an reference opens the verse in Arabic');
  check(await page.locator('.verse-en').first().textContent().then((t) => /Ever-Living|Sustainer/.test(t)), '…with its English meaning');
  await shot('18-quran-popup');
  await page.goBack();
  await pause();
  const quotes = page.locator('.ayah');
  await quotes.nth((await quotes.count()) - 1).click();
  await page.getByText('Al-Ikhlas 112:1').waitFor({ timeout: 10000 });
  check(true, 'a quoted verse with no reference is recognised by its words');
  await page.goBack();
  await pause();

  // Reading aloud: the player opens and marks the paragraph being read.
  await fromMore('Read aloud');
  await page.getByRole('region', { name: 'Reading aloud' }).waitFor();
  await page.locator('.listen-play').click();
  await page.waitForSelector('.bk[data-speaking]', { timeout: 10000 });
  check(true, 'reading aloud starts and marks the paragraph being read');
  await pause(500);
  check(await page.evaluate(() => !!globalThis.CSS?.highlights?.has('speaking')), 'the sentence being read is lit within its paragraph');
  const playingTitle = await page.evaluate(() => navigator.mediaSession?.metadata?.title ?? '');
  check(/أصول/.test(playingTitle), `what is being read shows with the phone’s media controls (${playingTitle})`);
  await page.getByRole('button', { name: 'Stop reading aloud' }).click();
  await pause();

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
  const lowText = (await contrastOf('.pg .bk[data-t="p"]')).filter((c) => c.ratio < 7);
  check(lowText.length === 0, `dark theme: book text has strong contrast ${JSON.stringify(lowText.slice(0, 2))}`);

  // The palettes: picked from the reader, the whole app takes them, and they last.
  await showChrome();
  await page.getByRole('button', { name: 'Text and theme' }).click();
  for (const [name, tone] of [['Forest', 'dark'], ['Midnight', 'dark'], ['Gallery', 'light'], ['Terracotta', 'light']]) {
    await page.getByRole('button', { name, exact: true }).click();
    await pause(250);
    const now = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, tone: document.documentElement.dataset.tone, bg: getComputedStyle(document.body).backgroundColor, bar: document.querySelector('meta[name="theme-color"]').content }));
    check(now.theme === name.toLowerCase() && now.tone === tone, `${name}: the app takes the theme (${now.theme}, ${now.tone})`);
    const pressed = await page.getByRole('button', { name, exact: true }).getAttribute('aria-pressed');
    check(pressed === 'true', `${name}: shown as chosen in the reader`);
    await shot(`08b-palette-${name.toLowerCase()}`);
    const lowP = (await contrastOf('.sheet h2, .sheet .lbl span, .sheet .theme-chip, .sheet .seg button, .pg .bk[data-t="p"]')).filter((c) => c.ratio < 4.5);
    check(lowP.length === 0, `${name}: every label and the book text are readable ${JSON.stringify(lowP.slice(0, 2))}`);
  }
  await page.reload();
  await page.waitForSelector('.bk');
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'terracotta', 'the chosen palette is kept after the app is reopened');
  // Follow phone uses the chosen pair: Gallery by day, Forest at night.
  await page.evaluate(() => { location.hash = '#/settings/theme'; });
  await pause(600);
  await page.getByRole('radio', { name: /^Day and night/ }).click();
  await page.getByRole('group', { name: 'Theme by day' }).getByRole('button', { name: 'Gallery' }).click();
  await page.getByRole('group', { name: 'Theme at night' }).getByRole('button', { name: 'Forest' }).click();
  await pause(300);
  await page.emulateMedia({ colorScheme: 'light' });
  await pause(300);
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'gallery', 'Follow phone: Gallery by day');
  await page.emulateMedia({ colorScheme: 'dark' });
  await pause(300);
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'forest', 'Follow phone: Forest when the phone goes dark');
  await shot('08c-theme-page-auto');
  // Night by the clock instead of the phone: a night that covers the whole day turns it dark now.
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('button', { name: 'By the clock' }).click();
  await page.locator('.clock-row input').first().fill('00:00');
  await page.locator('.clock-row input').nth(1).fill('23:59');
  await pause(500);
  check((await page.evaluate(() => document.documentElement.dataset.theme)) === 'forest', 'night by the clock: the night theme at the time set, whatever the phone says');
  await page.getByRole('button', { name: 'With the phone' }).click();
  await pause(300);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('radio', { name: /^Lamp/ }).click();
  await pause(300);
  await page.evaluate(() => { history.back(); });
  await page.waitForSelector('.bk');
  await showChrome();
  await page.getByRole('button', { name: 'Text and theme' }).click();
  await page.getByRole('button', { name: 'Scroll', exact: true }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await pause();
});

await section('Scanned and image pages', async () => {
  await openBook('makhtut-scan');
  // Once its text is recognised the book opens as text; switch to the page images.
  if (!(await page.locator('.pdfpage').count())) await fromMore('Read the printed pages');
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

await section('Text recognition for scans', async () => {
  const t0 = Date.now();
  let scan;
  for (;;) {
    scan = (await books()).find((b) => b.title === 'makhtut-scan');
    if (scan?.ocr?.state === 'done' || scan?.ocr?.state === 'failed' || Date.now() - t0 > 180000) break;
    await pause(1000);
  }
  check(scan?.ocr?.state === 'done' && scan.ocr.done === 5, `all 5 scanned pages are recognised offline (${JSON.stringify(scan?.ocr)}, ${Math.round((Date.now() - t0) / 1000)} s)`);
  await openBook('makhtut-scan');
  await page.locator('.pdfpage, .bk[data-t="p"]').first().waitFor({ timeout: 15000 });
  if (await page.locator('.pdfpage').count()) await fromMore('Read the text read from the pages');
  await page.waitForSelector('.bk[data-t="p"]');
  const text = await page.locator('.rd-text').textContent();
  check(/الإمام الشافعي/.test(text) && /صفحة مصورة/.test(text), 'the reader shows the recognised Arabic text');
  check((await page.locator('.pdfpage').count()) === 0, 'in text view, recognised pages show text instead of images');
  await shot('16-scan-text');
  await fromMore('Read the printed pages');
  await pause(800);
  check((await page.locator('.pdfpage').count()) > 0 && (await page.locator('.bk[data-t="p"]').count()) === 0, 'the page/text switch shows the page images');
  await fromMore('Read the text read from the pages');
  await pause(500);

  await go('#/search');
  await page.getByRole('searchbox', { name: 'Search or ask your books' }).fill('مصورة');
  await page.getByText(/In the text: \d+ match/).waitFor({ timeout: 15000 });
  check(await page.locator('.hit-book').getByText('makhtut-scan').isVisible(), 'recognised text is searchable across the library');

  // Correct a page by hand.
  await go(`#/book/${scan.id}/review`);
  check(await page.getByText(/pages recognised/).isVisible(), 'the review screen lists the recognised pages');
  await page.getByRole('button', { name: 'All pages · 5' }).click();
  await page.locator('.row').first().click();
  await page.waitForSelector('.review-image canvas', { timeout: 15000 });
  await shot('17-review-page');
  await page.locator('textarea').fill('# صفحة مصححة\n\nهذا نص صححه القارئ بيده: كلمة زمرد.');
  await page.getByRole('button', { name: 'Save' }).click();
  await pause(800);
  await go(`#/book/${scan.id}`);
  await page.waitForSelector('.bk');
  await pause(700);
  check(/كلمة زمرد/.test(await page.locator('.rd-text').textContent()), 'a page corrected by hand is what the reader then shows');
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
  check((await page.locator('.pgmark').count()) > 3, 'printed page numbers are marked between paragraphs');
  // The original, one tap away: the printed page being read, as it is in the PDF.
  await fromMore('See the printed page');
  const orig = page.getByRole('dialog', { name: /^Original, page \d+ of \d+$/ });
  await orig.waitFor({ timeout: 8000 });
  const label = await orig.getAttribute('aria-label');
  check(/page 7 of/.test(label), `the original opens on the page being read (${label})`);
  await pause(1500);
  // Paper white at the margin, ink in the text: the page really is drawn (and stays drawn).
  const drawn = await orig.locator('canvas').evaluate((c) => {
    const ctx = c.getContext('2d');
    const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
    const corner = at(4, 4);
    const row = ctx.getImageData(0, Math.round(c.height * 0.3), c.width, 1).data;
    let dark = 0;
    for (let i = 0; i < row.length; i += 4) if (row[i] < 120) dark++;
    return c.width > 100 && corner.every((v) => v > 240) && dark > 0;
  });
  check(drawn, 'the original page is drawn, paper and ink');
  await orig.getByText('Highlighted: where you are reading').waitFor({ timeout: 8000 });
  const zoomed = await page.locator('.zoom-stage').evaluate((el) => el.style.transform);
  check(/scale\((1\.[0-9]|2)/.test(zoomed), `the paragraph being read is highlighted on the page, and the page opens zoomed to it (${zoomed})`);
  const tinted = await orig.locator('canvas').evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 7) if (d[i] > 220 && d[i + 1] > 190 && d[i + 2] < 200 && d[i] - d[i + 2] > 40) n++;
    return n;
  });
  check(tinted > 50, `the highlight is painted on the page (${tinted} tinted points)`);
  await shot('10b-original-page');
  await page.getByRole('button', { name: 'Next page' }).click();
  await pause(500);
  check(/page 8 of/.test(await orig.getAttribute('aria-label')), 'the next page of the original is one tap away');
  await page.getByRole('button', { name: 'Read from here' }).click();
  await pause(900);
  check((await orig.count()) === 0 && /p\. 8/.test(await page.locator('.rd-bottom-bar .where').textContent()), 'Read from here returns to the text at that page');
  // From a chosen paragraph straight to its page.
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('.bk[data-t="p"]')].find((el) => el.getBoundingClientRect().top > 120);
    const r = document.createRange();
    r.selectNodeContents(p);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await pause(400);
  await page.locator('.sel-bar').getByRole('button', { name: 'Page' }).click();
  await orig.waitFor({ timeout: 8000 });
  check(true, 'a selected paragraph opens its page in the original');
  await page.keyboard.press('Escape');
  await pause(300);
  // The printed page from the top bar, every page at a glance, and any page by number.
  await showChrome();
  await page.getByRole('button', { name: 'See the printed page' }).click();
  await orig.waitFor({ timeout: 8000 });
  check(true, 'the top bar opens the printed page in one tap');
  await page.getByRole('button', { name: 'All pages' }).click();
  const grid = page.getByRole('dialog', { name: 'All pages' });
  await grid.waitFor({ timeout: 5000 });
  const thumbCount = await grid.locator('.thumb').count();
  const pageCount = (await books()).find((b) => b.title === 'risala-text')?.pageCount;
  check(thumbCount === pageCount && thumbCount > 3, `All pages shows every page (${thumbCount} of ${pageCount})`);
  await pause(1200);
  const thumbDrawn = await grid.locator('.thumb canvas').first().evaluate((c) => c.width > 0);
  check(thumbDrawn, 'the page pictures in All pages are drawn');
  await shot('10c-all-pages');
  await grid.locator('.thumb').nth(2).locator('.pdfpage').click();
  await pause(500);
  check(/page 3 of/.test(await orig.getAttribute('aria-label')) && (await grid.count()) === 0, 'tapping a page in All pages opens it');
  await page.getByRole('button', { name: /Go to another page/ }).click();
  await page.getByLabel('Go to page').fill('5');
  await page.keyboard.press('Enter');
  await pause(500);
  check(/page 5 of/.test(await orig.getAttribute('aria-label')), 'any page can be opened by its number');
  await page.keyboard.press('Escape');
  await pause(400);
  // A PDF of text can be read as its printed pages, like a PDF reader, and back.
  await fromMore('Read the printed pages');
  await page.waitForSelector('.rd .pdfpage canvas', { timeout: 10000 });
  await pause(800);
  check((await page.locator('.rd .pdfpage').count()) > 0 && (await page.locator('.rd .bk[data-t="p"]').count()) === 0, 'a PDF of text can be read as its printed pages alone');
  await shot('10d-text-pdf-as-pages');
  await fromMore('Read the text');
  await page.waitForSelector('.bk[data-t="p"]');
  check((await page.locator('.rd .pdfpage').count()) === 0, 'and back to its text');
  // Each page number says where the words came from, and leads to the page itself.
  await page.locator('.pgmark button').first().click();
  await page.getByText('Text from the PDF itself').waitFor({ timeout: 5000 });
  check(true, 'a page number tells where the words of that page came from');
  await page.getByRole('button', { name: /^See the printed page/ }).last().click();
  await orig.waitFor({ timeout: 8000 });
  check(true, 'and opens the printed page');
  await page.keyboard.press('Escape');
  await pause(300);
  // Any other kind of book: the file itself, untouched.
  await page.goto(server.url + '#/library');
  await page.getByRole('button', { name: 'Details for مختصر في أصول الفقه' }).click();
  await page.getByText('kept exactly as you added it').waitFor({ timeout: 8000 });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.getByRole('button', { name: 'Save a copy' }).click()]);
  const original = (await import('node:fs')).readFileSync(fx('usul.epub'));
  const savedPath = await dl.path();
  const saved = (await import('node:fs')).readFileSync(savedPath);
  check(dl.suggestedFilename() === 'usul.epub' && Buffer.compare(saved, original) === 0, 'the original file is kept byte for byte, and can be saved');
  await page.getByRole('button', { name: 'Close' }).click();
  await openBook('مختصر في أصول الفقه');
  await showChrome();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.getByRole('button', { name: /^Open the original file/ }).click()]);
  check(dl2.suggestedFilename() === 'usul.epub', 'the reader opens the original file in two taps (More, then the file)');
});

await section('Voices', async () => {
  await go('#/settings/voice');
  await page.getByText('Voices', { exact: true }).waitFor({ timeout: 5000 });
  check((await page.locator('.voice-choice').count()) === 3, 'a voice can be chosen for English, Arabic and Urdu');
});

await section('Comfort and finding your way', async () => {
  await openBook('مختصر في أصول الفقه');
  await pause(600);
  // Book layout: the paragraphs after the first are indented, as in a printed book.
  const indents = await page.evaluate(() => [...document.querySelectorAll('.rd-text .bk[data-t="p"]')].slice(0, 6).map((el) => parseFloat(getComputedStyle(el).textIndent)));
  check(indents.some((n) => n > 5), `paragraphs are indented like a book (${indents.join(', ')})`);
  // The chapters as marks along the slider.
  await showChrome();
  check((await page.locator('.rd-ticks i').count()) >= 1, `the chapters are marked along the slider (${await page.locator('.rd-ticks i').count()})`);
  // A jump, then straight back.
  const before = await page.locator('.rd-bottom-bar .where').textContent();
  await page.getByRole('button', { name: 'Contents, bookmarks and highlights' }).click();
  await page.getByRole('button', { name: 'باب القياس' }).click();
  await pause(900);
  await page.locator('.rd-back').waitFor({ timeout: 5000 });
  check(/Back to/.test(await page.locator('.rd-back').textContent()), `after a jump, a button leads back (“${await page.locator('.rd-back').textContent()}”)`);
  await shot('19b-back-pill');
  await page.locator('.rd-back').click();
  await pause(900);
  check((await page.locator('.rd-back').count()) === 0 && (await page.locator('.rd-bottom-bar .where').textContent()) === before, 'and it takes the reader back to where they were');
  // Pinch with two fingers: bigger text.
  const size0 = parseFloat(await page.locator('.rd').evaluate((el) => getComputedStyle(el).getPropertyValue('--rd-size')));
  const cdp = await page.context().newCDPSession(page);
  const pts = (d) => [{ x: 206 - d, y: 450 }, { x: 206 + d, y: 450 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(60) });
  for (let d = 70; d <= 130; d += 10) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pause(700);
  const size1 = parseFloat(await page.locator('.rd').evaluate((el) => getComputedStyle(el).getPropertyValue('--rd-size')));
  check(size1 > size0 * 1.4, `pinching the page makes the text bigger (${size0} → ${size1} rem)`);
  await showChrome();
  await page.getByRole('button', { name: 'Text and theme' }).click();
  await page.getByRole('button', { name: 'Smaller text' }).click();
  for (let i = 0; i < 25; i++) await page.getByRole('button', { name: 'Smaller text' }).click();
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Larger text' }).click();
  // Warm light and extra dimming for the night.
  await page.getByLabel('Warm light').focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');
  await page.getByLabel('Extra dim').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await pause(300);
  check((await page.locator('.rd-warm').count()) === 1 && (await page.locator('.rd-dim').count()) === 1, 'warm light and extra dim lie over the page');
  check((await page.locator('.rd-warm').evaluate((el) => getComputedStyle(el).pointerEvents)) === 'none', 'and never get in the way of a tap');
  await page.getByRole('button', { name: 'Close' }).click();
  await shot('19c-warm-dim');
  await showChrome();
  await page.getByRole('button', { name: 'Text and theme' }).click();
  await page.getByLabel('Warm light').focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
  await page.getByLabel('Extra dim').focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
  // Spaced paragraphs instead.
  await page.getByRole('button', { name: 'Spaced', exact: true }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await pause(500);
  const indents2 = await page.evaluate(() => [...document.querySelectorAll('.rd-text .bk[data-t="p"]')].slice(0, 6).map((el) => parseFloat(getComputedStyle(el).textIndent)));
  const overlays = await page.locator('.rd-warm, .rd-dim').count();
  check(indents2.every((n) => n === 0) && overlays === 0, `spaced paragraphs, and warm light and dimming off again (indents ${indents2.join(', ')}; overlays ${overlays})`);
  await showChrome();
  await page.getByRole('button', { name: 'Text and theme' }).click();
  await page.getByRole('button', { name: 'Like a book', exact: true }).click();
  await page.getByRole('button', { name: 'Close' }).click();
});

await section('Keep and share', async () => {
  await openBook('مختصر في أصول الفقه');
  await pause(600);
  const fs = await import('node:fs');
  // A passage as a picture to share (saved where there is no share sheet).
  await page.evaluate(() => {
    const p = [...document.querySelectorAll('.bk[data-t="p"]')].find((el) => el.getBoundingClientRect().top > 120);
    const r = document.createRange();
    r.selectNodeContents(p);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await pause(500);
  const [pic] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator('.sel-bar').getByRole('button', { name: 'Share', exact: true }).click()]);
  const png = fs.readFileSync(await pic.path());
  check(png.slice(1, 4).toString() === 'PNG' && png.length > 20000, `a passage can be shared as a picture (${pic.suggestedFilename()}, ${Math.round(png.length / 1024)} KB)`);
  const shotPath = decodeURIComponent(new URL('./out/shots/44-quote-card.png', import.meta.url).pathname);
  fs.writeFileSync(shotPath, png);
  // The notebook: every highlight and note, as Word and as PDF.
  await showChrome();
  await page.getByRole('button', { name: 'Contents, bookmarks and highlights' }).click();
  await page.getByRole('tab', { name: /^Highlights/ }).click();
  const [word] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Word', exact: true }).click()]);
  const docxBytes = fs.readFileSync(await word.path());
  const { unzipSync, strFromU8 } = await import('fflate');
  const doc = strFromU8(unzipSync(new Uint8Array(docxBytes))['word/document.xml']);
  check(word.suggestedFilename().endsWith('.docx') && /<w:bidi\/>/.test(doc) && /Highlights and notes/.test(doc), `the notebook is saved as a Word document, Arabic set right to left (${word.suggestedFilename()})`);
  const [pdf] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.getByRole('button', { name: 'PDF', exact: true }).click()]);
  const pdfBytes = fs.readFileSync(await pdf.path());
  check(pdfBytes.slice(0, 5).toString() === '%PDF-' && pdfBytes.length > 30000, `and as a PDF (${Math.round(pdfBytes.length / 1024)} KB)`);
  await page.getByRole('button', { name: 'Close' }).click();
  // Home: one of your highlights comes back; today's reading against the goal.
  await go('#/');
  await page.getByText('From your library').waitFor({ timeout: 5000 });
  check((await page.locator('.from-library').count()) === 1, 'Home brings back one of your own highlights');
  check(/of 15 minutes|minutes are read/.test(await page.locator('.goal-line').textContent()), 'and shows today’s reading against the daily goal');
  await page.locator('.goal-line').click();
  await page.getByText('The last seven days').waitFor({ timeout: 5000 });
  check((await page.locator('.week-day').count()) === 7, 'Your reading: the last seven days, days in a row and books finished');
  await shot('45-your-reading');
  // A book marked finished goes on the Finished shelf.
  await go('#/library');
  await page.getByRole('button', { name: 'Details for urdu-risala' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Finished', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await go('#/');
  await page.locator('.shelf--finished .tile').first().waitFor({ timeout: 5000 });
  check(true, 'finished books go on a Finished shelf');
});

await section('Search across the library', async () => {
  await page.goto(server.url + '#/search');
  const box = page.getByRole('searchbox', { name: 'Search or ask your books' });
  await box.fill('ياقوت');
  await page.getByText(/In the text: 1 match$/).waitFor({ timeout: 15000 });
  check(true, 'a word that occurs once in the library is found once');
  check((await page.locator('.field .icon-btn').count()) === 1, 'the search field has one clear button, not two');
  await shot('11-search');
  await box.fill('ijma');
  await page.getByText(/In the text: \d+ match/).waitFor({ timeout: 15000 });
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
  for (const name of ['Help & setup', 'Theme', 'Reading defaults', 'Cover style', 'Sorting new books', 'Feature switches', 'Storage', 'Backup', 'Move to a new phone', 'About & updates']) {
    await page.getByRole('button', { name: new RegExp('^' + name) }).click();
    await pause(500);
    check((await page.locator('[role=alert]').count()) === 0, `Settings › ${name} opens without an error`);
    await page.locator('.screen-head').getByRole('button', { name: 'Back' }).click();
    await pause(300);
  }
  await go('#/settings/storage');
  await page.getByText('Book files').waitFor();
  await shot('12-storage');
  await go('#/nonsense');
  check(await page.getByText('Nothing here').isVisible(), 'an unknown address shows a message, not a blank screen');
  await go('#/book/does-not-exist');
  check(await page.getByText('This book is no longer here').isVisible(), 'a missing book shows a message, not a blank screen');
});

await section('Dark theme across the app', async () => {
  await go('#/library');
  await page.getByRole('button', { name: 'Details for risala-text' }).click();
  await pause(500);
  await shot('13-details-lamp');
  const low = (await contrastOf('.sheet h2, .sheet h3, .sheet .title, .sheet .sub, .sheet .muted, .sheet .detail-facts, .sheet .by, .sheet .section-title, .sheet .seg button, .sheet .cover-choice:not([disabled]), .sheet .banner span')).filter((c) => c.ratio < 4.5);
  check(low.length === 0, `dark theme: book details sheet is readable ${JSON.stringify(low)}`);
  await page.getByRole('button', { name: 'Close' }).click();
  const lowMain = (await contrastOf('.screen-head h1, .chip, .tile-title, .tile-sub, .tile-progress, .bar-tab, .search-entry')).filter((c) => c.ratio < 4.5);
  check(lowMain.length === 0, `dark theme: library is readable ${JSON.stringify(lowMain)}`);
  await shot('14-library-lamp');
});
await section('Home', async () => {
  await go('#/');
  check(await page.getByRole('button', { name: /^Continue reading/ }).isVisible(), 'Home leads with the book being read');
  const low = (await contrastOf('.continue .eyebrow, .continue h2, .continue .where, .continue .tile-progress')).filter((c) => c.ratio < 4.5);
  check(low.length === 0, `the Continue reading card is readable ${JSON.stringify(low)}`);
  await shot('15-home-lamp');
});
await section('Backup and restore', async () => {
  await go('#/settings/backup');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Back up now' }).click()]);
  const file = `${shots}../backup-test.maktaba`;
  await download.saveAs(file);
  await page.getByText(/^Saved to/).waitFor();
  check(/Maktaba backup .*\.maktaba$/.test(download.suggestedFilename()), `a one-file backup is made (${download.suggestedFilename()})`);
  const before = await books();
  const progressOf = (pg) => pg.evaluate(async () => {
    const req = indexedDB.open('maktaba');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const all = await new Promise((r) => (dbh.transaction('books').objectStore('books').getAll().onsuccess = (e) => r(e.target.result)));
    dbh.close();
    const b = all.find((x) => x.title === 'مختصر في أصول الفقه');
    return b?.progress ? `${b.progress.section}:${b.progress.block}` : 'none';
  });
  const placeBefore = await progressOf(page);
  const marksBefore = await page.evaluate(async () => {
    const req = indexedDB.open('maktaba');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const n = await new Promise((r) => (dbh.transaction('marks').objectStore('marks').count().onsuccess = (e) => r(e.target.result)));
    dbh.close();
    return n;
  });
  // A fresh, empty app restores it.
  const fresh = await browser.newContext({ ...PHONE, serviceWorkers: 'block' });
  const p2 = await fresh.newPage();
  await p2.goto(server.url + '#/settings/backup');
  await p2.setInputFiles('[data-testid=restore-input]', file);
  await p2.getByText(/^Restored \d+ book/).waitFor({ timeout: 60000 });
  const after = await p2.evaluate(async () => {
    const req = indexedDB.open('maktaba');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const get = (t) => new Promise((r) => (dbh.transaction(t).objectStore(t).count().onsuccess = (e) => r(e.target.result)));
    const out = { books: await get('books'), marks: await get('marks'), files: await get('files'), refs: await get('refs') };
    dbh.close();
    return out;
  });
  check(after.books === before.length && after.files === before.length, `every book and its file comes back (${after.books} of ${before.length})`);
  check(after.marks === marksBefore && after.refs > 0, `highlights, notes, bookmarks and references come back (${after.marks} marks)`);
  const placeAfter = await progressOf(p2);
  await p2.evaluate(() => { location.hash = '#/library'; });
  await p2.getByRole('button', { name: 'Open مختصر في أصول الفقه', exact: true }).click();
  await p2.waitForSelector('.bk');
  await p2.waitForTimeout(800);
  const at = await p2.locator('.rd-bottom-bar .where').textContent();
  check(placeBefore !== 'none' && placeAfter === placeBefore && !!at, `a restored book opens at the place reading stopped (${placeBefore} → ${placeAfter}, ${at})`);
  await fresh.close();
});
await ctx.close();

// ------------------------------------------------------------------------------------
await section('Works offline', async () => {
  const octx = await browser.newContext({ ...PHONE });
  const p = await octx.newPage();
  await p.goto(server.url);
  await p.evaluate(() => navigator.serviceWorker.ready);
  // Wait until the app has saved itself for offline use (the Qur'an text is the largest part).
  await p.waitForFunction(async () => {
    for (const name of await caches.keys()) {
      const c = await caches.open(name);
      if ((await c.keys()).some((r) => r.url.includes('quran_en.json'))) return true;
    }
    return false;
  }, null, { timeout: 90000, polling: 1000 });
  await p.reload();
  await p.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
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
  // Its pages show as images until their text is recognised (which also works offline).
  await p.waitForSelector('.pdfpage canvas, .bk[data-t="p"]', { timeout: 15000 });
  await p.waitForTimeout(2500);
  const shown = await p.evaluate(() => {
    const c = document.querySelector('.pdfpage canvas');
    return { drawn: !!c && c.width > 0, text: document.querySelectorAll('.bk[data-t="p"]').length };
  });
  check(shown.drawn || shown.text > 0, `with no internet, a scanned book still opens (${JSON.stringify(shown)})`);
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
