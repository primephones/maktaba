// Matn → sharḥ: reading a matn, open its sharḥ where it comments on the paragraph being read.
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

// A matn of short rules, and a sharḥ that quotes each ("قوله: …") with vowels and comments on it.
const MATN = [
  'كتاب الطهارة',
  'الماء الذي يجوز به الوضوء ماء السماء وماء الأودية والعيون والآبار والبحار',
  'ولا يجوز الوضوء بما اعتصر من الشجر والثمر',
  'وفرض الطهارة غسل الأعضاء الثلاثة ومسح الرأس',
  'وسنن الطهارة غسل اليدين قبل إدخالهما الإناء إذا استيقظ المتوضئ من نومه',
];
const SHARH = [
  'كتاب الطهارة',
  'بدأ المصنف بالطهارة لأنها مفتاح الصلاة، وهي أهم العبادات بعد الإيمان.',
  'قوله: «الماءُ الذي يجوزُ به الوضوءُ ماءُ السماءِ وماءُ الأوديةِ والعيونِ والآبارِ والبحار» يعني الماء المطلق الباقي على أصل خلقته، لقوله تعالى: وأنزلنا من السماء ماء طهورا.',
  'وفيه بيان أن الماء المطلق يرفع الحدث ويزيل النجس.',
  'قوله: «ولا يجوزُ الوضوءُ بما اعتُصِرَ من الشجرِ والثمرِ» لأنه ليس بماء مطلق، وإنما يسمى ماء مقيدا.',
  'وهذا قول عامة العلماء.',
  'قوله: «وفرضُ الطهارةِ غسلُ الأعضاءِ الثلاثةِ ومسحُ الرأسِ» لقوله تعالى: يا أيها الذين آمنوا إذا قمتم إلى الصلاة فاغسلوا وجوهكم.',
  'قوله: «وسننُ الطهارةِ غسلُ اليدين قبل إدخالهما الإناءَ» لحديث: إذا استيقظ أحدكم من نومه فلا يغمس يده في الإناء.',
];
const FILLER = Array.from({ length: 24 }, (_, i) => `وفي هذا الباب مسائل أخرى يذكرها المصنف في موضعها رقم ${i + 1} من الكتاب إن شاء الله تعالى.`);
const md = (title, lines) => `# ${title}\n\n${lines.map((l, i) => (i === 0 ? `## ${l}` : l)).join('\n\n')}\n`;

const server = await startServer();
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const read = (store) =>
  page.evaluate(async (s) => {
    const req = indexedDB.open('maktaba');
    const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const all = await new Promise((r) => (dbh.transaction(s).objectStore(s).getAll().onsuccess = (e) => r(e.target.result)));
    dbh.close();
    return all;
  }, store);

try {
  await page.goto(server.url);
  await page.evaluate(() => { location.hash = '#/settings/library'; });
  await page.getByRole('radio', { name: /Leave them/ }).click();
  await page.evaluate(() => { location.hash = '#/'; });
  await page.evaluate(([a, b]) => {
    const dt = new DataTransfer();
    dt.items.add(new File([a], 'مختصر القدوري.md', { type: 'text/markdown' }));
    dt.items.add(new File([b], 'شرح مختصر القدوري.md', { type: 'text/markdown' }));
    const input = document.querySelector('[data-testid=add-input]');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [md('مختصر القدوري', [...MATN, ...FILLER]), md('شرح مختصر القدوري', [...SHARH, ...FILLER])]);
  await wait(4000);
  const books = await read('books');
  const matn = books.find((b) => b.title === 'مختصر القدوري');
  const sharh = books.find((b) => b.title === 'شرح مختصر القدوري');
  check(!!matn && !!sharh, 'the matn and its sharḥ are added');

  // Read the matn at its third rule (“Fard of ṭahāra”).
  await page.evaluate((id) => { location.hash = `#/book/${id}`; }, matn.id);
  await page.locator('.bk').first().waitFor();
  await page.getByText(MATN[3]).scrollIntoViewIfNeeded();
  await page.evaluate((t) => {
    const el = [...document.querySelectorAll('.bk')].find((x) => x.textContent.includes(t));
    document.querySelector('.rd-scroll').scrollTop += el.getBoundingClientRect().top - 90;
  }, MATN[3]);
  await wait(1500);
  await page.locator('.rd-scroll').click({ position: { x: 200, y: 500 } });
  await wait(400);
  if ((await page.locator('.rd').getAttribute('data-chrome')) !== 'true') {
    await page.locator('.rd-scroll').click({ position: { x: 200, y: 500 } });
    await wait(400);
  }
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: /^In the commentary/ }).click();
  await page.getByText('Which book is its commentary (sharḥ)?').waitFor();
  const first = page.locator('.sheet .row').first();
  check(((await first.textContent()) ?? '').includes('شرح مختصر القدوري'), 'the likely commentary is offered first');
  await first.click();
  await page.waitForFunction((id) => location.hash === `#/book/${id}`, sharh.id, { timeout: 10000 });
  const lit = await page.locator('mark.flash').first().textContent({ timeout: 4000 }).catch(() => '');
  check(/وفرض/.test(lit ?? ''), 'the paragraph that explains it is lit up on arrival');
  await wait(1500);
  const top = await page.evaluate(() => {
    const scroller = document.querySelector('.rd-scroll');
    const y = scroller.getBoundingClientRect().top + 70;
    const els = [...document.querySelectorAll('.bk')];
    const el = els.find((e) => e.getBoundingClientRect().bottom > y);
    return el?.textContent ?? '';
  });

  check(/وفرض الطهارة|وفرضُ الطهارةِ/.test(top), `it opens the sharḥ where it comments on that rule (${top.slice(0, 50)})`);
  await page.screenshot({ path: `${shots}70-sharh.png` });
  const linked = (await read('books')).find((b) => b.id === matn.id).commentaries;
  check(Array.isArray(linked) && linked.includes(sharh.id), 'and remembers it as the matn’s commentary');
  check(errors.length === 0, `no errors in the page ${JSON.stringify(errors.slice(0, 2))}`);
} catch (e) {
  check(false, `stopped: ${e.message.split('\n')[0]}`);
  await page.screenshot({ path: `${shots}FAILED-sharh.png` }).catch(() => undefined);
} finally {
  await browser.close();
  server.stop();
}
console.log(`\n${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log(' - ' + f);
process.exit(failures.length ? 1 : 0);
