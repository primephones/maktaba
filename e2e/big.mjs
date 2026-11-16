// Stress check: a very large book. Measures import time, opening, jumping and searching.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { startServer } from './server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const dir = decodeURIComponent(new URL('./out/big/', import.meta.url).pathname);
mkdirSync(dir, { recursive: true });

const AR = ['الحمد لله رب العالمين، والصلاة والسلام على أشرف الأنبياء والمرسلين، نبينا محمد وعلى آله وصحبه أجمعين.',
  'أما بعد: فإنَّ العِلْمَ أفضلُ ما اكتسبه المرءُ في حياته، وهو ميراثُ الأنبياء، وبه تُعرَف الأحكامُ ويُميَّز الحلالُ من الحرام.',
  'قال الإمام الشافعي رحمه الله: العلم ما نفع، ليس العلم ما حُفِظ. وقد أجمع العلماء على أن طلب العلم فريضة على كل مسلم.',
  'واعلم أن الإجماع حجة قاطعة عند جمهور الأصوليين، وهو اتفاق مجتهدي الأمة في عصر من العصور على حكم شرعي.'];
// About 6 MB: the size of a multi-volume work in OpenITI.
let text = '######OpenITI#\n#META# 010.AuthorNAME :: مؤلف\n#META# 020.BookTITLE :: كتاب كبير جدا\n#META#Header#End#\n\n';
let page = 1;
for (let i = 0; i < 26000; i++) {
  if (i % 180 === 0) text += `### | باب رقم ${i / 180 + 1}\n`;
  text += `# ${AR[i % 4]} ${AR[(i + 1) % 4]} ${i === 19999 ? 'كلمة فريدة: عقيق.' : ''} PageV01P${String(page).padStart(4, '0')}\n`;
  if (i % 6 === 5) page++;
}
writeFileSync(dir + 'big.txt', text);
console.log('book size', (text.length * 1.8 / 1e6).toFixed(1), 'MB,', 26000, 'paragraphs,', page, 'pages');

const server = await startServer();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
const pg = await ctx.newPage();
pg.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await pg.goto(server.url);
// A mid-range phone is several times slower than this machine.
const cdp = await ctx.newCDPSession(pg);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
let t = Date.now();
await pg.setInputFiles('[data-testid=add-input]', [dir + 'big.txt']);
for (;;) {
  const st = await pg.evaluate(async () => {
    const req = indexedDB.open('maktaba');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const all = await new Promise((r) => (dbh.transaction('books').objectStore('books').getAll().onsuccess = (e) => r(e.target.result)));
    dbh.close();
    return all[0] && { s: all[0].import.state, n: all[0].sectionCount, toc: all[0].toc.length, e: all[0].import.error };
  });
  if (st && (st.s === 'ready' || st.s === 'failed')) { console.log('import:', Date.now() - t, 'ms', JSON.stringify(st)); break; }
  if (Date.now() - t > 180000) { console.log('import TIMED OUT', JSON.stringify(st)); break; }
  await pg.waitForTimeout(250);
}
await pg.evaluate(() => { location.hash = '#/library'; });
await pg.waitForTimeout(800);
t = Date.now();
await pg.getByRole('button', { name: /^Open / }).first().click();
await pg.waitForSelector('.bk');
console.log('open book:', Date.now() - t, 'ms');
t = Date.now();
await pg.getByRole('button', { name: 'Contents, bookmarks and highlights' }).click();
await pg.waitForSelector('.toc-row');
console.log('contents sheet (', await pg.locator('.toc-row').count(), 'entries ):', Date.now() - t, 'ms');
t = Date.now();
await pg.locator('.toc-row').nth(100).click();
await pg.waitForFunction(() => /باب رقم 101/.test(document.querySelector('.rd-scroll [data-b]')?.textContent ?? '') || [...document.querySelectorAll('.rd-scroll [data-t="h"]')].some((h) => /باب رقم 101$/.test(h.textContent)), null, { timeout: 20000 });
console.log('jump to chapter 101:', Date.now() - t, 'ms');
await pg.waitForTimeout(600);
if ((await pg.locator('.rd').getAttribute('data-chrome')) !== 'true') { await pg.locator('.rd-scroll').click({ position: { x: 200, y: 500 } }); await pg.waitForTimeout(300); }
await pg.getByRole('button', { name: 'Search in this book' }).click();
t = Date.now();
await pg.getByRole('searchbox', { name: 'Search in this book' }).fill('عقيق');
await pg.getByText(/^1 match$/).waitFor({ timeout: 120000 });
console.log('search whole book for a word that occurs once:', Date.now() - t, 'ms');
const blocks = await pg.locator('.rd-scroll [data-b]').count();
console.log('paragraphs laid out at once:', blocks);
await browser.close();
server.stop();
