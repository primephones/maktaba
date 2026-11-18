// The book catalogue: a real classical book downloaded from OpenITI (Kanz al-Daqāʾiq),
// and a commentary on it (a stand-in for Tabyīn al-Ḥaqāʾiq, which is large) linked by itself,
// so "In the commentary" goes from the Kanz's ruling to where the Tabyīn explains it.
import { createRequire } from 'node:module';
import { startServer } from './server.mjs';
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
const RULING = 'فرض الوضوء غسل وجهه وهو من قصاص الشعر إلى أسفل الذقن وإلى شحمتي الأذن';
const TABYIN = `######OpenITI#

#META# bk: تبيين الحقائق شرح كنز الدقائق
#META#Header#End#

### | كتاب الطهارة
# بدأ بالطهارة لأنها مفتاح الصلاة التي هي عماد الدين، والطهارة في اللغة النظافة.
# وفي الشرع النظافة عن الحدث والخبث، وأسبابها كثيرة نذكرها في مواضعها إن شاء الله تعالى.
# قوله: (فرض الوضوء غسل وجهه وهو من قصاص الشعر إلى أسفل الذقن وإلى شحمتي الأذن) لقوله تعالى: فاغسلوا وجوهكم، والوجه ما يواجه به الإنسان، فيحد بذلك طولا وعرضا.
# قوله: (ويديه بمرفقيه) أي مع مرفقيه، فالمرفقان داخلان في الغسل عندنا خلافا لزفر.
`;

const server = await startServer();
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch(proxy ? { proxy: { server: proxy, bypass: '127.0.0.1,localhost' } } : {});
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await ctx.route('https://raw.githubusercontent.com/OpenITI/0750AH/**', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'text/plain; charset=utf-8' }, body: TABYIN }));
const read = (store) =>
  page.evaluate(async (s) => {
    const req = indexedDB.open('maktaba');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const all = await new Promise((r) => (dbh.transaction(s).objectStore(s).getAll().onsuccess = (e) => r(e.target.result)));
    dbh.close();
    return all;
  }, store);
const until = async (fn, ms = 90000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await wait(500);
  }
  return false;
};
const byCat = async (id) => (await read('books')).find((b) => b.catalogueId === id);
const KANZ = '0710IbnAhmadHafizDinNasafi.KanzDaqaiq.Sham19Y0014262-ara1';
const TAB = '0743FakhrDinZaylaci.TabyinHaqaiq.JK005200-ara1';

try {
  await page.goto(server.url);
  await page.evaluate(() => { location.hash = '#/settings/library'; });
  await page.getByRole('radio', { name: /Leave them/ }).click();
  await page.evaluate(() => { location.hash = '#/'; });
  await page.getByRole('button', { name: /^Book catalogue/ }).click();
  await page.getByRole('heading', { name: 'Book catalogue' }).waitFor();
  check((await page.locator('.cat-row').count()) === 34, 'the catalogue lists the six books, their commentaries and the Ḥanafī works (34)');
  await page.screenshot({ path: `${shots}80-catalogue.png` });

  console.log('A real book, from OpenITI');
  await page.getByRole('button', { name: 'Add Kanz al-Daqāʾiq (al-Nasafī)' }).click();
  check(await until(async () => (await byCat(KANZ))?.import.state === 'ready'), 'Kanz al-Daqāʾiq downloads and is prepared');
  const kanz = await byCat(KANZ);
  check(kanz?.title === 'كنز الدقائق' && kanz?.lang === 'ar', `with its Arabic title, as an Arabic book (${kanz?.title}, ${kanz?.lang})`);
  const secs = (await read('sections')).filter((s) => s.bookId === kanz.id);
  check(secs.some((s) => s.blocks.some((b) => b.text.includes('فرض الوضوء غسل وجهه'))), 'its text is all there (the first ruling of Kitāb al-Ṭahāra)');
  check(secs.length > 5 && (kanz.toc?.length ?? 0) > 5, `in chapters, with contents (${secs.length} sections, ${kanz.toc?.length} entries)`);
  await page.getByRole('button', { name: 'Open' }).first().waitFor({ timeout: 5000 });
  check(true, 'and the catalogue now offers to open it');

  console.log('Its commentary, linked by itself');
  await page.getByRole('button', { name: /^Add Tabyīn al-Ḥaqāʾiq/ }).click();
  check(await until(async () => (await byCat(TAB))?.import.state === 'ready'), 'Tabyīn al-Ḥaqāʾiq is added');
  const tab = await byCat(TAB);
  check((await byCat(KANZ)).commentaries?.includes(tab.id), 'and linked as the Kanz’s commentary');

  console.log('From the ruling to its explanation');
  await page.evaluate((id) => { location.hash = `#/book/${id}`; }, kanz.id);
  await page.locator('.bk').first().waitFor();
  const sec = secs.find((s) => s.blocks.some((b) => b.text.includes('فرض الوضوء غسل وجهه')));
  await page.evaluate(() => { location.hash = '#/'; });
  await page.evaluate(([id, s]) => { location.hash = `#/book/${id}`; }, [kanz.id, sec.idx]);
  await page.locator('.bk').first().waitFor();
  // Go to the ruling through Contents, as a reader would.
  await page.getByRole('button', { name: 'Contents, bookmarks and highlights' }).click();
  await page.getByRole('button', { name: /كتاب الطهارة/ }).first().click();
  await wait(1200);
  await page.evaluate((t) => {
    const el = [...document.querySelectorAll('.bk')].find((x) => x.textContent.includes(t));
    if (el) document.querySelector('.rd-scroll').scrollTop += el.getBoundingClientRect().top - 90;
  }, 'فرض الوضوء غسل وجهه');
  await wait(900);
  if ((await page.locator('.rd').getAttribute('data-chrome')) !== 'true') await page.locator('.rd-scroll').click({ position: { x: 200, y: 500 } });
  await wait(400);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: /^In the commentary/ }).click();
  await page.locator('.sharh-go').first().click();
  await page.waitForFunction((id) => location.hash === `#/book/${id}`, tab.id, { timeout: 15000 });
  await wait(1500);
  const top = await page.evaluate(() => {
    const y = document.querySelector('.rd-scroll').getBoundingClientRect().top + 70;
    return [...document.querySelectorAll('.bk')].find((e) => e.getBoundingClientRect().bottom > y)?.textContent ?? '';
  });
  check(top.includes('قوله: (فرض الوضوء'), `it opens the Tabyīn where it explains that ruling (${top.slice(0, 40)})`);
  await page.screenshot({ path: `${shots}81-catalogue-sharh.png` });
  check(errors.length === 0, `no errors in the page ${JSON.stringify(errors.slice(0, 2))}`);
} catch (e) {
  check(false, `stopped: ${e.message.split('\n')[0]}`);
  await page.screenshot({ path: `${shots}FAILED-catalogue.png` }).catch(() => undefined);
} finally {
  await browser.close();
  server.stop();
}
console.log(`\n${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log(' - ' + f);
process.exit(failures.length ? 1 : 0);
