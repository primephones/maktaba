// Every screen and popup, in every theme: each piece of text is measured against what is
// actually behind it, and screenshots are kept for review. Fails on any unreadable text.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { startServer } from './server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const out = decodeURIComponent(new URL('./out/themes/', import.meta.url).pathname);
mkdirSync(out, { recursive: true });
const fx = (n) => decodeURIComponent(new URL(`./out/fixtures/${n}`, import.meta.url).pathname);
const THEMES = (process.argv[2] ?? 'paper,sepia,lamp,black,forest,midnight,gallery,terracotta').split(',');

/** Runs in the page: every visible text element whose contrast is too low. */
const audit = () => {
  const parse = (s) => {
    const m = s.match(/[\d.]+/g);
    if (!m) return null;
    // A mixed colour is given as color(srgb r g b / a), each from 0 to 1.
    const k = /^color\(srgb/.test(s) ? 255 : 1;
    return { c: m.slice(0, 3).map((v) => Number(v) * k), a: m[3] === undefined ? 1 : Number(m[3]) };
  };
  const lum = ([r, g, b]) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const blend = (top, under) => top.c.map((v, i) => v * top.a + under[i] * (1 - top.a));
  /** The colour behind an element: its own and its ancestors' backgrounds, composited. */
  const behind = (el) => {
    const layers = [];
    for (let p = el; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0) layers.push(bg);
      if (bg && bg.a >= 0.99) break;
    }
    let base = [255, 255, 255];
    const body = parse(getComputedStyle(document.body).backgroundColor);
    if (body) base = body.c;
    for (let i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
    return base;
  };
  const skip = '.cover, .pdfpage, .review-image, .cover-veil, svg, img, canvas, [aria-hidden="true"], .sr-only, option';
  const bad = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.data.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el) || el.closest(skip)) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    // Disabled controls may be faint by design.
    if (el.closest('button:disabled, [aria-disabled="true"]')) continue;
    let op = 1;
    for (let p = el; p; p = p.parentElement) op *= Number(getComputedStyle(p).opacity);
    if (op < 0.2) continue;
    // A decoration drawn on top of the text (a ::before/::after layer with a background).
    for (let p = el, depth = 0; p && depth < 3; p = p.parentElement, depth++) {
      for (const pseudo of ['::before', '::after']) {
        const ps = getComputedStyle(p, pseudo);
        if (ps.content === 'none' || ps.position !== 'absolute') continue;
        const pbg = parse(ps.backgroundColor);
        const z = parseInt(ps.zIndex, 10);
        const covers = ps.backgroundImage !== 'none' || (pbg && pbg.a > 0.15);
        // Text raised above the layer (its own z-index) is not covered.
        let raised = -Infinity;
        for (let q = el; q && q !== p; q = q.parentElement) {
          const qs = getComputedStyle(q);
          if (qs.position !== 'static' && qs.zIndex !== 'auto') raised = Math.max(raised, parseInt(qs.zIndex, 10));
        }
        if (raised > (Number.isNaN(z) ? 0 : z)) continue;
        if (covers && !(z < 0) && Number(ps.opacity) > 0.15 && parseFloat(ps.width) > r.width * 0.5 && parseFloat(ps.height) > r.height * 0.5) {
          bad.push({ text: n.data.trim().slice(0, 40), covered: `${p.tagName.toLowerCase()}.${[...p.classList].join('.')}${pseudo}` });
        }
      }
    }
    const fg = parse(cs.color);
    if (!fg) continue;
    // Text drawn with a gradient (gold foil) is checked by eye in the screenshots.
    if (cs.webkitTextFillColor && /rgba\(0, 0, 0, 0\)/.test(cs.webkitTextFillColor)) continue;
    const bg = behind(el);
    const color = blend({ c: fg.c, a: fg.a * op }, bg);
    const [a, b] = [lum(color), lum(bg)].sort((x, y) => y - x);
    const ratio = (a + 0.05) / (b + 0.05);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.6 && Number(cs.fontWeight) >= 600);
    const need = large ? 3 : 4.5;
    if (ratio < need) bad.push({ text: n.data.trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100, need, cls: `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`, in: el.closest('[class]')?.className?.toString().slice(0, 40) });
  }
  return bad;
};

const server = await startServer();
const browser = await chromium.launch();
const problems = [];
let checked = 0;

for (const theme of THEMES) {
  console.log(`Theme: ${theme}`);
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const go = async (h) => {
    await page.evaluate((x) => { location.hash = x; }, h);
    await page.waitForTimeout(650);
  };
  const look = async (name) => {
    await page.waitForTimeout(350);
    const bad = await page.evaluate(audit);
    checked++;
    if (bad.length) {
      problems.push({ theme, screen: name, bad });
      console.log(`  ✗ ${name}: ${bad.length} low-contrast text ${JSON.stringify(bad.slice(0, 4))}`);
    }
    await page.screenshot({ path: `${out}${theme}-${name}.png` });
  };
  const closeSheet = async () => {
    const c = page.getByRole('button', { name: 'Close' });
    if (await c.count()) await c.last().click();
    await page.waitForTimeout(300);
  };

  await page.goto(server.url);
  await page.evaluate((t) => localStorage.setItem('maktaba.theme', t), theme);
  await page.goto(server.url + '#/settings/theme');
  await page.getByRole('radio', { name: new RegExp(`^${theme[0].toUpperCase()}${theme.slice(1)}`) }).click();
  await page.waitForTimeout(300);
  await go('#/');
  await look('home-empty');
  await go('#/library');
  await look('library-empty');
  await go('#/search');
  await look('search-empty');
  await go('#/references');
  await look('references-empty');

  await page.setInputFiles('[data-testid=add-input]', ['usul.epub', 'risala-text.pdf', 'makhtut-scan.pdf', 'urdu-risala.txt', '0204Shafici.Risala', 'Introduction to Usul - Vol 1.pdf', 'Introduction to Usul - Vol 2.pdf', 'notes.xyz'].map(fx));
  await page.waitForTimeout(2500);
  await look('adding-problems-sheet');
  await closeSheet();
  await page.waitForTimeout(6000);
  await go('#/library');
  await look('library');
  await page.getByRole('button', { name: 'Library options' }).click();
  await look('library-options');
  await closeSheet();
  await page.getByRole('button', { name: 'Details for مختصر في أصول الفقه' }).click();
  await look('details');
  await page.locator('.sheet-body').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await look('details-bottom');
  await closeSheet();
  await page.getByRole('button', { name: 'Details for makhtut-scan' }).click();
  await look('details-scan');
  await closeSheet();

  await page.getByRole('button', { name: 'Open مختصر في أصول الفقه', exact: true }).click();
  await page.waitForSelector('.bk');
  await look('reader');
  await page.getByRole('button', { name: 'Text and theme' }).click();
  await look('reader-text-sheet');
  await closeSheet();
  for (const [name, shot] of [['English', 'reader-english-sheet'], ['Study', 'reader-study-sheet'], ['More', 'reader-more-sheet']]) {
    await page.getByRole('button', { name, exact: true }).click();
    await look(shot);
    await closeSheet();
  }
  await page.getByRole('button', { name: 'Contents, bookmarks and highlights' }).click();
  await look('reader-contents');
  await page.getByRole('button', { name: 'باب القياس' }).click();
  await page.waitForTimeout(700);
  await page.locator('.fn').first().click();
  await look('reader-footnote');
  await closeSheet();
  await page.locator('.qref').first().click().catch(() => undefined);
  await page.waitForTimeout(900);
  await look('reader-quran');
  await closeSheet();
  await page.evaluate(() => {
    const p = document.querySelectorAll('.bk[data-t="p"]')[1];
    const r = document.createRange();
    r.selectNodeContents(p);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await page.waitForTimeout(400);
  await look('reader-selection');
  await page.getByRole('button', { name: 'Highlight Gold' }).click();
  await page.locator('.hl').first().click();
  await look('reader-highlight-editor');
  await closeSheet();
  await page.evaluate(() => getSelection().removeAllRanges());
  await page.getByRole('button', { name: 'More', exact: true }).click().catch(() => undefined);
  await page.getByRole('button', { name: /^Read aloud/ }).first().click().catch(() => undefined);
  await page.waitForTimeout(400);
  await look('reader-listen');
  await page.getByRole('button', { name: 'Stop reading aloud' }).click().catch(() => undefined);

  await go('#/');
  await look('home');
  await go('#/search');
  await page.getByRole('searchbox').fill('القياس');
  await page.waitForTimeout(2500);
  await look('search-results');
  await go('#/references');
  await look('references');

  const scan = await page.evaluate(async () => {
    const req = indexedDB.open('maktaba');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const books = await new Promise((r) => (dbh.transaction('books').objectStore('books').getAll().onsuccess = (e) => r(e.target.result)));
    dbh.close();
    return books.find((b) => b.title === 'makhtut-scan')?.id;
  });
  await page.waitForTimeout(4000);
  await go(`#/book/${scan}/review`);
  await page.getByRole('button', { name: /^All pages/ }).click().catch(() => undefined);
  await look('scan-review');
  await go(`#/book/${scan}/review/1`);
  await page.waitForTimeout(1200);
  await look('scan-review-page');

  for (const p of ['/setup', '/setup/cloud', '/setup/ai', '/setup/done']) {
    await go(`#${p}`);
    await page.waitForTimeout(400);
    if (p === '/setup/ai') await page.getByRole('button', { name: /Google Gemini/ }).click().catch(() => undefined);
    await look(p.replace(/\//g, '-').slice(1));
  }
  for (const p of ['', '/help', '/ai', '/cloud', '/share', '/backup', '/voice', '/english', '/theme', '/reading', '/covers', '/switches', '/storage', '/about']) {
    await go(`#/settings${p}`);
    await page.waitForTimeout(400);
    await look(`settings${p.replace('/', '-') || ''}`);
  }
  await ctx.close();
}
await browser.close();
server.stop();
console.log(`\n${checked} screens checked, ${problems.length} with low-contrast text`);
process.exit(problems.length ? 1 : 0);
