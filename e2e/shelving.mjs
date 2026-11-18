// New books into folders: suggested by subject and put there with one tap, or sorted by
// themselves, or chosen by hand.
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
const page = await (await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
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
const folderOf = async (title) => {
  const b = (await read('books')).find((x) => x.title === title);
  const f = (await read('folders')).find((x) => x.id === b?.folderId);
  return f?.name;
};

try {
  await page.goto(server.url);
  console.log('Ask (the default)');
  await add(['نماز کے احکام.md']);
  await page.getByText('Put “نماز کے احکام” in Fiqh?').waitFor({ timeout: 20000 });
  check(true, 'a new Urdu fiqh book is offered the Fiqh folder');
  await page.getByRole('button', { name: 'Put there' }).click();
  await wait(800);
  check((await folderOf('نماز کے احکام')) === 'Fiqh', 'one tap makes the folder and puts it there');

  console.log('With its other volumes');
  await add(['Introduction to Usul - Vol 1.pdf']);
  await page.getByText(/Put “Introduction to Usul.*” in Uṣūl al-fiqh\?/).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Put there' }).click();
  await wait(800);
  await add(['Introduction to Usul - Vol 2.pdf']);
  await page.getByText(/Put “Introduction to Usul.*” in Uṣūl al-fiqh\?/).waitFor({ timeout: 20000 });
  check(true, 'the next volume is offered the same folder');
  await page.getByRole('button', { name: 'Choose…' }).click();
  await page.getByRole('heading', { name: 'Which folder?' }).waitFor();
  const sel = page.getByRole('combobox', { name: /^Folder for Introduction to Usul/ });
  check((await sel.inputValue()) !== '', 'choosing by hand starts from the suggestion');
  await sel.selectOption('');
  await page.getByRole('button', { name: 'Put them there' }).click();
  await wait(800);
  const vol2 = (await read('books')).find((b) => /Vol 2|Volume 2/.test(b.title) || b.volume === 2);
  check(!vol2?.folderId, 'and can leave it out of any folder');

  console.log('Sort automatically');
  await page.evaluate(() => { location.hash = '#/settings/library'; });
  await page.getByRole('radio', { name: /Sort automatically/ }).click();
  await add(['usul.epub']);
  await page.getByText(/^Put “مختصر في أصول الفقه” in Uṣūl al-fiqh\.$/).waitFor({ timeout: 20000 });
  check((await folderOf('مختصر في أصول الفقه')) === 'Uṣūl al-fiqh', 'new books go into their folder by themselves');
  await page.getByRole('button', { name: 'Undo' }).click();
  await wait(800);
  check(!(await folderOf('مختصر في أصول الفقه')), 'with an Undo');

  console.log('Leave them');
  await page.getByRole('radio', { name: /Leave them/ }).click();
  await add(['رساله در فقه.md']);
  await wait(6000);
  check(!(await folderOf('رساله در فقه')) && (await page.getByText(/Put “رساله در فقه”/).count()) === 0, 'or are left alone');
  check(errors.length === 0, `no errors in the page ${JSON.stringify(errors.slice(0, 2))}`);
} catch (e) {
  check(false, `stopped: ${e.message.split('\n')[0]}`);
  await page.screenshot({ path: decodeURIComponent(new URL('./out/shots/FAILED-shelving.png', import.meta.url).pathname) }).catch(() => undefined);
} finally {
  await browser.close();
  server.stop();
}
console.log(`\n${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log(' - ' + f);
process.exit(failures.length ? 1 : 0);
