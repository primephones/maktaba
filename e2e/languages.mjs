// Every language, as a reader would bring them: Arabic, Urdu, Persian, Pashto, Malay and
// English books, as PDFs with text and as scans, put through the app with the reader's own
// AI (a stand-in for Gemini here). Checks each is recognised as its language, that English
// is neither recognised nor translated, that the others are translated and shown, and that
// scans show the page as printed with the English beneath, read and translated in one go.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { startServer } from './server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = decodeURIComponent(new URL('..', import.meta.url).pathname);
const shots = `${root}e2e/out/shots/`;
mkdirSync(shots, { recursive: true });
const failures = [];
let passed = 0;
const check = (ok, what) => {
  console.log(ok ? '  ok ' : '  FAILED', what);
  if (ok) passed++;
  else failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const font = (pkg, file) => readFileSync(`${root}node_modules/@fontsource/${pkg}/files/${file}`).toString('base64');
const FONTS = `@font-face{font-family:Amiri;src:url(data:font/woff2;base64,${font('amiri', 'amiri-arabic-400-normal.woff2')})}@font-face{font-family:Nastaliq;src:url(data:font/woff2;base64,${font('noto-nastaliq-urdu', 'noto-nastaliq-urdu-arabic-400-normal.woff2')})}`;

const BOOKS = {
  ar: { dir: 'rtl', font: 'Amiri', title: 'باب الإجماع', paras: ['قال الإمام الشافعي رحمه الله: العلم ما نفع، ليس العلم ما حفظ، وطلب العلم فريضة على كل مسلم.', 'والإجماع حجة قاطعة عند جمهور الأصوليين، وهو اتفاق مجتهدي الأمة في عصر من العصور على حكم شرعي.', 'والقياس هو إلحاق فرع بأصل في الحكم لعلة جامعة بينهما، وهو الدليل الرابع من الأدلة المتفق عليها.'] },
  ur: { dir: 'rtl', font: 'Nastaliq', title: 'نماز کا بیان', paras: ['نماز دین کا ستون ہے۔ جس نے نماز قائم کی اس نے دین کو قائم کیا، اور جس نے نماز چھوڑ دی اس نے دین کو ڈھا دیا۔', 'ذکر اللہ دلوں کا سکون ہے۔ قرآن مجید میں ارشاد ہے کہ خبردار! اللہ کے ذکر ہی سے دلوں کو اطمینان نصیب ہوتا ہے۔', 'فکر کا مطلب یہ ہے کہ انسان اللہ تعالیٰ کی نعمتوں اور اس کی قدرت کی نشانیوں میں غور کرے، اور اپنی زندگی کا جائزہ لے۔'] },
  fa: { dir: 'rtl', font: 'Amiri', title: 'گفتار در نماز', paras: ['نماز ستون دین است. هر که نماز را برپا داشت، دین را برپا داشته است و هر که آن را ترک کرد، دین را ویران کرده است.', 'یاد خدا آرامش دل‌هاست. در قرآن آمده است که آگاه باشید، تنها با یاد خدا دل‌ها آرام می‌گیرد.', 'اندیشه یعنی آنکه انسان در نعمت‌های خداوند و نشانه‌های قدرت او بیندیشد و زندگی خود را بسنجد.'] },
  ps: { dir: 'rtl', font: 'Amiri', title: 'د لمانځه بیان', paras: ['لمونځ د دین ستن ده. چا چې لمونځ وکړ هغه دین ودراوه، او چا چې لمونځ پرېښود هغه دین وران کړ.', 'د الله ذکر د زړونو ډاډ دی. په قرآن کې راغلي چې خبردار! یوازې د الله په ذکر سره زړونه ډاډه کېږي.', 'فکر دا دی چې انسان د الله تعالی په نعمتونو او د هغه د قدرت په نښو کې سوچ وکړي او خپل ژوند وڅېړي.'] },
  ms: { dir: 'ltr', font: 'serif', title: 'Bab Solat', paras: ['Solat adalah tiang agama. Sesiapa yang mendirikan solat, maka dia telah mendirikan agama, dan sesiapa yang meninggalkannya telah meruntuhkan agama.', 'Zikir kepada Allah ialah ketenangan hati. Di dalam al-Quran disebutkan bahawa dengan mengingati Allah hati menjadi tenang.', 'Tafakur bermaksud manusia merenungi nikmat-nikmat Allah dan tanda-tanda kekuasaan-Nya, serta menilai kehidupannya sendiri.'] },
  en: { dir: 'ltr', font: 'serif', title: 'On Prayer', paras: ['Prayer is the pillar of the religion. Whoever establishes the prayer has established the religion, and whoever abandons it has torn it down.', 'The remembrance of God is the rest of hearts. The Quran says: surely in the remembrance of God do hearts find rest.', 'Reflection means that a person ponders the blessings of God and the signs of His power, and takes stock of their own life.'] },
};
const ENGLISH = 'Prayer is the pillar of the religion; whoever establishes it establishes the religion, and whoever abandons it tears it down.';

const pageHtml = (lang, n, watermark = false) => {
  const b = BOOKS[lang];
  return `<html dir="${b.dir}" lang="${lang}"><head><title>${lang}</title><style>${FONTS}@page{size:620px 880px;margin:0}body{margin:0;padding:50px 46px;font-family:${b.font};font-size:${b.font === 'Nastaliq' ? 21 : 22}px;line-height:${b.font === 'Nastaliq' ? 2.4 : 1.9};background:#f4efdf;color:#222}.wm{position:fixed;top:45%;left:5%;transform:rotate(-30deg);font:40px sans-serif;color:rgba(0,0,0,.08)}</style></head><body>${watermark ? '<div class="wm">www.besturdubooks.net</div>' : ''}<h2>${b.title} ${n}</h2>${b.paras.map((t) => `<p>${t}</p>`).join('')}</body></html>`;
};

const server = await startServer();
const browser = await chromium.launch();
const maker = await browser.newPage({ viewport: { width: 620, height: 880 } });

/** A PDF with real text, two pages. */
async function textPdf(lang) {
  await maker.setContent(`${pageHtml(lang, 1)}`.replace('</body>', `<div style="page-break-before:always"></div>${BOOKS[lang].paras.map((t) => `<p>${t}</p>`).join('')}</body>`));
  await maker.evaluate(() => document.fonts.ready);
  return maker.pdf({ preferCSSPageSize: true });
}
/** A scan: pages as pictures only, with a faint slanted watermark. */
async function scanPdf(lang) {
  const imgs = [];
  for (let n = 1; n <= 2; n++) {
    await maker.setContent(pageHtml(lang, n, true));
    await maker.evaluate(() => document.fonts.ready);
    imgs.push((await maker.screenshot({ type: 'jpeg', quality: 75 })).toString('base64'));
  }
  await maker.setContent(`<html><head><style>@page{size:620px 880px;margin:0}body{margin:0}img{display:block;width:620px;height:880px;page-break-after:always}</style></head><body>${imgs.map((s) => `<img src="data:image/jpeg;base64,${s}">`).join('')}</body></html>`);
  return maker.pdf({ preferCSSPageSize: true });
}

const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
await ctx.addInitScript(() => {
  globalThis.__maktabaAiSpacing = 30;
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };

// The stand-in Gemini. A scan "contains" the language set in scanLang.
let scanLang = 'ur';
const calls = { read: 0, readAndTranslate: 0, translate: 0 };
await ctx.route('https://generativelanguage.googleapis.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, GET' } });
  if (!req.url().includes(':generateContent')) return route.fulfill({ status: 200, headers: cors, body: '{"models":[]}' });
  const body = JSON.parse(req.postData() ?? '{}');
  const parts = body.contents?.[0]?.parts ?? [];
  const text = parts.map((p) => p.text ?? '').join('\n') + (body.systemInstruction?.parts?.map((p) => p.text).join('\n') ?? '');
  const answer = (obj) => route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }] }) });
  if (parts.some((p) => p.inline_data)) {
    const both = /Then translate every block into English/.test(text);
    both ? calls.readAndTranslate++ : calls.read++;
    const b = BOOKS[scanLang];
    return answer({
      printed: '',
      blocks: [
        { t: 'h', text: b.title, ...(both ? { en: 'On Prayer' } : {}) },
        ...b.paras.map((p) => ({ t: 'p', text: p, ...(both ? { en: ENGLISH, uncertain: [] } : {}) })),
      ],
    });
  }
  calls.translate++;
  const ids = [...text.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]);
  return answer({ paragraphs: ids.map((id) => ({ id, en: ENGLISH, uncertain: [] })) });
});

const add = (name, bytes) =>
  page.evaluate(
    ([n, b64]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], n, { type: 'application/pdf' }));
      const input = document.querySelector('[data-testid=add-input]');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    [name, Buffer.from(bytes).toString('base64')],
  );
const read = (store) =>
  page.evaluate(async (s) => {
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
const go = async (h) => {
  await page.evaluate((x) => { location.hash = x; }, h);
  await wait(700);
};

try {
  await page.goto(server.url);
  await go('#/settings/library');
  await page.getByRole('radio', { name: /Leave them/ }).click();
  await go('#/settings/ai');
  await page.getByLabel('Google Gemini key').fill('AIza' + 'x'.repeat(35));
  await page.getByRole('button', { name: 'Add Google Gemini' }).click();
  await page.getByText(/Key added/).first().waitFor({ timeout: 10000 });

  console.log('Books with text, in every language');
  await go('#/');
  for (const lang of Object.keys(BOOKS)) {
    const bytes = await textPdf(lang);
    (await import('node:fs')).writeFileSync(`${root}e2e/out/${lang}-text.pdf`, bytes);
    await add(`${lang}-text.pdf`, bytes);
  }
  check(await until(async () => (await read('books')).filter((b) => /-text$/.test(b.title) && b.import.state === 'ready').length === 6, 90000), 'all six are added');
  for (const lang of Object.keys(BOOKS)) {
    if (lang === 'ur') continue;
    const b = await book(`${lang}-text`);
    check(b?.lang === lang, `${lang}: recognised as its language (${b?.lang})`);
    check(!b?.ocr, `${lang}: its text is read from the file, with no text recognition`);
  }
  // Nastaliq PDFs very often carry a text layer that is unusable (here: glyphs with no
  // letters behind them). The app must notice, and treat the pages as pictures for the AI.
  scanLang = 'ur';
  check(await until(async () => (await book('ur-text'))?.ocr?.state === 'done', 60000), `ur: an Urdu PDF whose text is unusable is noticed, and its pages read by the AI (${JSON.stringify((await book('ur-text'))?.ocr)})`);
  {
    const b = await book('ur-text');
    check(b?.lang === 'ur', `ur: recognised as Urdu (${b?.lang})`);
    const pages = (await read('ocrPages')).filter((p) => p.bookId === b.id);
    check(pages.length > 0 && pages.every((p) => p.by === 'ai'), 'ur: never read by the phone');
    check((await read('translations')).filter((t) => t.bookId === b.id).length >= 4, 'ur: and translated as it was read');
  }

  console.log('Translating them');
  for (const lang of Object.keys(BOOKS)) {
    const b = await book(`${lang}-text`);
    await go('#/library');
    await page.getByRole('button', { name: `Details for ${lang}-text` }).click();
    await wait(800);
    const offer = page.getByRole('button', { name: /Translate the whole book/ });
    if (lang === 'en') {
      check((await offer.count()) === 0 && (await page.getByText('English translation').count()) === 0, 'en: an English book is not offered translation');
      await page.keyboard.press('Escape');
      continue;
    }
    if (lang === 'ur') {
      await page.keyboard.press('Escape');
      await wait(800);
      await go(`#/book/${b.id}`);
      await page.locator('.pdfpage').first().waitFor({ timeout: 15000 });
      check((await page.getByText(ENGLISH).count()) > 0, 'ur: the page as printed, with its English beneath');
      await page.screenshot({ path: `${shots}60-text-ur.png` });
      continue;
    }
    await offer.click();
    const done = await until(async () => (await read('translations')).filter((t) => t.bookId === b.id).length >= 4, 60000);
    const jobs = await read('aiJobs');
    check(done, `${lang}: the whole book is translated ${done ? '' : JSON.stringify({ t: (await book(`${lang}-text`)).translation, jobs: jobs.map((j) => [j.title, j.state, j.done, j.total, j.last_error]) })}`);
    await page.keyboard.press('Escape');
    await wait(800);
    await go(`#/book/${b.id}`);
    await page.locator('.bk').first().waitFor({ timeout: 10000 });
    await page.getByText(ENGLISH).first().waitFor({ timeout: 10000 }).catch(() => undefined);
    check((await page.getByText(ENGLISH).count()) > 0, `${lang}: the English shows in the reader`);
    // The original beside it, the right way round.
    const orig = page.locator('.bk[data-t="p"]').first();
    await page.evaluate((id) => location.hash = `#/book/${id}`, b.id);
    await orig.click().catch(() => undefined);
    await wait(500);
    await page.screenshot({ path: `${shots}60-text-${lang}.png` });
  }
  {
    const b = await book('en-text');
    await go(`#/book/${b.id}`);
    await page.getByText(BOOKS.en.paras[0].slice(0, 30)).first().waitFor({ timeout: 10000 });
    check(true, 'en: an English book reads as it is');
  }
  // The original text is shown the right way round, in each script.
  for (const lang of ['ar', 'fa', 'ps', 'ms']) {
    const b = await book(`${lang}-text`);
    await page.evaluate(async (id) => {
      const req = indexedDB.open('maktaba');
      const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
      await new Promise((r) => {
        const tx = dbh.transaction('books', 'readwrite');
        const st = tx.objectStore('books');
        st.get(id).onsuccess = (e) => st.put({ ...e.target.result, view: 'orig' });
        tx.oncomplete = r;
      });
      dbh.close();
    }, b.id);
    await go('#/');
    await go(`#/book/${b.id}`);
    const p = page.locator('.bk[data-t="p"]').first();
    await p.waitFor({ timeout: 10000 });
    const dir = await p.evaluate((el) => getComputedStyle(el).direction);
    check(dir === BOOKS[lang].dir, `${lang}: the original reads ${BOOKS[lang].dir === 'rtl' ? 'right to left' : 'left to right'} (${dir})`);
    if (lang === 'ar') await page.screenshot({ path: `${shots}61-text-ar-original.png` });
  }

  console.log('Scans');
  for (const lang of ['ur', 'ar', 'fa', 'en']) {
    scanLang = lang;
    const before = { ...calls };
    await go('#/');
    await add(`${lang}-scan.pdf`, await scanPdf(lang));
    const ok = await until(async () => {
      const b = await book(`${lang}-scan`);
      return b?.import.state === 'ready' && (lang === 'en' ? !b.ocr && b.lang === 'en' : b.ocr?.state === 'done');
    }, 90000);
    const b = await book(`${lang}-scan`);
    if (lang === 'en') {
      check(ok, `en scan: an English scan is shown as printed, with no recognition (${JSON.stringify(b?.ocr ?? null)}, ${b?.lang})`);
      check(calls.read + calls.readAndTranslate - before.read - before.readAndTranslate <= 1, 'en scan: only its first page is looked at, to know the language');
    } else {
      check(ok, `${lang} scan: its pages are read (${JSON.stringify(b?.ocr)})`);
      check(b?.lang === lang, `${lang} scan: recognised as ${lang} (${b?.lang})`);
      const pages = (await read('ocrPages')).filter((p) => p.bookId === b.id);
      check(pages.length === 2 && pages.every((p) => p.by === 'ai'), `${lang} scan: read by the AI, never by the phone`);
      check(calls.readAndTranslate - before.readAndTranslate === 2 && calls.translate === before.translate, `${lang} scan: each page read and translated in one request (${calls.readAndTranslate - before.readAndTranslate} requests)`);
      const trs = (await read('translations')).filter((t) => t.bookId === b.id);
      check(trs.length === 8, `${lang} scan: every paragraph has its English (${trs.length} of 8)`);
    }
    await go(`#/book/${b.id}`);
    await page.locator('.pdfpage').first().waitFor({ timeout: 15000 });
    check(true, `${lang} scan: opens on its pages as printed`);
    if (lang !== 'en') {
      await page.getByText(ENGLISH).first().waitFor({ timeout: 10000 }).catch(() => undefined);
      check((await page.getByText(ENGLISH).count()) > 0, `${lang} scan: the English is under the page, with nothing to tap`);
      check((await page.getByRole('button', { name: /translate this page/i }).count()) === 0, `${lang} scan: no page is left untranslated`);
    } else {
      check((await page.getByRole('button', { name: /translate/i }).count()) === 0, 'en scan: nothing offers translation');
    }
    await page.getByText(ENGLISH).first().scrollIntoViewIfNeeded().catch(() => undefined);
    await page.evaluate(() => window.scrollBy(0, -300));
    await wait(500);
    await page.screenshot({ path: `${shots}62-scan-${lang}.png` });
  }
  check(errors.length === 0, `no errors in the page ${JSON.stringify(errors.slice(0, 2))}`);
} catch (e) {
  check(false, `stopped: ${e.message.split('\n')[0]}`);
  await page.screenshot({ path: `${shots}FAILED-languages.png` }).catch(() => undefined);
} finally {
  await browser.close();
  server.stop();
}
console.log(`\n${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log(' - ' + f);
process.exit(failures.length ? 1 : 0);
