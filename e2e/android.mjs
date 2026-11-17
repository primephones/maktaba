// Drives the installed Android app on a phone or emulator connected over adb, through the
// app's own WebView. Checks what a browser on a desk cannot: the real Android WebView, the
// status bar and navigation bar, the back button, and that the library survives a restart.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const { _android: android } = createRequire(import.meta.url)('playwright');

const PKG = 'za.co.primephones.maktaba';
const out = decodeURIComponent(new URL('./out/phone/', import.meta.url).pathname);
mkdirSync(out, { recursive: true });
const fx = (n) => readFileSync(decodeURIComponent(new URL(`./out/fixtures/${n}`, import.meta.url).pathname));

const failures = [];
let passed = 0;
const check = (ok, what) => {
  console.log(ok ? '  ok ' : '  FAILED', what);
  if (ok) passed++;
  else failures.push(what);
};

const [device] = await android.devices();
if (!device) throw new Error('No Android device is connected.');
console.log('Device:', device.model(), 'Android', (await device.shell('getprop ro.build.version.release')).toString().trim());

const launch = async () => {
  await device.shell(`am force-stop ${PKG}`);
  await device.shell(`am start -n ${PKG}/.MainActivity`);
  const webview = await device.webView({ pkg: PKG }, { timeout: 90000 });
  const page = await webview.page();
  await page.waitForSelector('.screen', { timeout: 60000 });
  return page;
};

/** A phone screenshot, system bars included. A small copy goes into the log for review. */
const shot = async (name, inline = false) => {
  const file = `${out}${name}.png`;
  await device.screenshot({ path: file });
  if (!inline) return;
  try {
    const b64 = execFileSync('python3', ['-c', `
import sys, io, base64
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
im = im.resize((250, round(im.height * 250 / im.width)), Image.LANCZOS)
buf = io.BytesIO(); im.save(buf, 'JPEG', quality=30, optimize=True)
print(base64.encodebytes(buf.getvalue()).decode())`, file]).toString();
    console.log(`<<<SHOT ${name}`);
    console.log(b64.trim());
    console.log(`SHOT>>>`);
  } catch (e) {
    console.log('(no inline copy of the screenshot:', e.message.split('\n')[0], ')');
  }
};

/** Adds a file through the app's own Add input, as choosing it in the file picker would. */
const addFile = (page, name, type) => {
  console.log(`   adding ${name} (${fx(name).length} bytes)`);
  return addFileNow(page, name, type);
};
const addFileNow = (page, name, type) => page.evaluate(([b64, fileName, mime]) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], fileName, { type: mime }));
  const input = document.querySelector('[data-testid=add-input]');
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}, [fx(name).toString('base64'), name, type]);

const books = (page) => page.evaluate(async () => {
  const req = indexedDB.open('maktaba');
  const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
  const all = await new Promise((r) => (dbh.transaction('books').objectStore('books').getAll().onsuccess = (e) => r(e.target.result)));
  dbh.close();
  return all.map((b) => ({ title: b.title, state: b.import.state, error: b.import.error, kind: b.kind }));
});

const back = () => device.shell('input keyevent 4');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** What the phone itself says went wrong, when the session dies. */
const diagnose = () => {
  const adb = (...args) => {
    try {
      return execFileSync('adb', args, { timeout: 20000 }).toString();
    } catch (e) {
      return `(adb ${args.join(' ')} failed: ${e.message.split('\n')[0]})`;
    }
  };
  console.log('--- adb devices ---\n' + adb('devices'));
  console.log('--- crash log ---\n' + adb('logcat', '-d', '-b', 'crash', '-t', '60'));
  let saved = '';
  try {
    saved = readFileSync(`${out}logcat.txt`, 'utf8');
  } catch {
    /* none */
  }
  const log = (saved || adb('logcat', '-d', '-t', '4000')).split('\n').filter((l) => /maktaba|chromium|FATAL|AndroidRuntime|lowmemory|Out of memory|renderer|WebView|ANR in/i.test(l));
  console.log('--- app and WebView log (last lines) ---\n' + log.slice(-70).join('\n'));
};
process.on('uncaughtException', (e) => {
  console.log('TEST ABORTED:', e.message.split('\n')[0]);
  diagnose();
  process.exit(1);
});
process.on('unhandledRejection', (e) => {
  console.log('TEST ABORTED:', String(e?.message ?? e).split('\n')[0]);
  diagnose();
  process.exit(1);
});

let page = await launch();
const errors = [];
const watch = (p) => {
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  p.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
};
watch(page);
await device.shell(`pm clear ${PKG}`).catch(() => undefined);
page = await launch();
watch(page);

console.log('Starting up');
await page.waitForSelector('.desk-head', { timeout: 30000 });
const env = await page.evaluate(() => {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const res = {
    ua: navigator.userAgent,
    inner: [innerWidth, innerHeight],
    screen: [screen.width, screen.height],
    dpr: devicePixelRatio,
    safeTop: cs.paddingTop,
    safeBottom: cs.paddingBottom,
    headTop: document.querySelector('.desk-head')?.getBoundingClientRect().top,
    barBottom: innerHeight - (document.querySelector('.bar')?.getBoundingClientRect().bottom ?? 0),
    native: !!window.Capacitor?.isNativePlatform?.(),
  };
  probe.remove();
  return res;
});
console.log('  environment:', JSON.stringify(env));
await wait(1500);
await shot('01-home-empty');
check(env.native, 'runs as the installed Android app');
check(await page.getByRole('button', { name: 'Add your first book' }).waitFor({ timeout: 15000 }).then(() => true, () => false), 'first launch shows Home with “Add your first book”');
const edgeToEdge = env.inner[1] >= env.screen[1] - 2;
check(!edgeToEdge || parseFloat(env.safeTop) > 0, `the title is clear of the status bar (edge to edge: ${edgeToEdge}, safe top ${env.safeTop}, title at ${env.headTop}px)`);
await page.evaluate(() => document.fonts.ready);
check(await page.evaluate(() => document.fonts.check('700 20px Amiri') && document.fonts.check('600 20px "Literata Variable"')), 'the app’s own typefaces are loaded');

console.log('Adding books');
let list = [];
const addAndWait = async (name, type, count) => {
  const t0 = Date.now();
  await addFile(page, name, type);
  for (let i = 0; i < 240; i++) {
    list = await books(page);
    if (list.length >= count && list.every((b) => b.state === 'ready' || b.state === 'failed')) break;
    if (i % 10 === 9) console.log('   …', name, JSON.stringify(list.map((b) => b.state)), `${Math.round((Date.now() - t0) / 1000)}s`);
    await wait(500);
  }
  console.log(`   ${name}: ${Date.now() - t0} ms`);
};
await addAndWait('urdu-risala.txt', 'text/plain', 1);
await shot('02a-after-first-book', true);
await addAndWait('usul.epub', 'application/epub+zip', 2);
await addAndWait('makhtut-scan.pdf', 'application/pdf', 3);
check(list.length === 3 && list.every((b) => b.state === 'ready'), `an EPUB, a text file and a scanned PDF all import (${JSON.stringify(list)})`);
await wait(800);
await shot('02-home-with-books', true);

console.log('Reading');
await page.getByRole('button', { name: 'Library', exact: true }).click();
await wait(800);
await shot('03-library');
await page.getByRole('button', { name: 'Open مختصر في أصول الفقه', exact: true }).click();
await page.waitForSelector('.bk', { timeout: 20000 });
await wait(1200);
await shot('04-reader', true);
const para = await page.locator('.bk[data-t="p"]').first().evaluate((el) => ({ font: getComputedStyle(el).fontFamily, dir: getComputedStyle(el).direction, text: el.textContent.slice(0, 20) }));
check(/Amiri/.test(para.font) && para.dir === 'rtl', `Arabic is set in Amiri, right to left (${JSON.stringify(para)})`);
await back();
await wait(900);
check(await page.evaluate(() => location.hash === '#/library'), 'the Android back button leaves the book for the library');

await page.getByRole('button', { name: 'Open makhtut-scan', exact: true }).click();
await page.waitForSelector('.pdfpage canvas', { timeout: 20000 });
await wait(4000);
const inked = await page.evaluate(() => {
  const c = document.querySelector('.pdfpage canvas');
  if (!c.width) return 0;
  const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 500)).data;
  let dark = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i] < 110) dark++;
  return dark;
});
check(inked > 200, 'a scanned PDF page is drawn on the phone');
await shot('05-scan');
await back();
await wait(900);

console.log('Sheets and the back button');
await page.getByRole('button', { name: 'Library options' }).click();
await wait(700);
await shot('06-sheet');
const sheetBottom = await page.evaluate(() => {
  const body = document.querySelector('.sheet-body');
  const last = body.lastElementChild.getBoundingClientRect();
  return { lastBottom: last.bottom, viewport: innerHeight };
});
check(sheetBottom.lastBottom <= sheetBottom.viewport, `the last item in a sheet is on screen (${JSON.stringify(sheetBottom)})`);
await back();
await wait(700);
check((await page.locator('.sheet').count()) === 0 && (await page.evaluate(() => location.hash === '#/library')), 'back closes the sheet and stays on the library');

console.log('Restarting the app');
page = await launch();
watch(page);
await wait(1500);
list = await books(page);
check(list.length === 3, 'the library is still there after the app is closed and reopened');
check(await page.getByRole('button', { name: /^Continue reading/ }).isVisible().catch(() => false), 'Home offers to continue the book that was open');
await shot('07-after-restart');

check(errors.length === 0, `no errors reported by the app ${JSON.stringify(errors.slice(0, 3))}`);
writeFileSync(`${out}result.txt`, `${passed} passed, ${failures.length} failed\n${failures.join('\n')}\n`);
console.log(`\n${passed} checks passed, ${failures.length} failed`);
await device.close();
process.exit(failures.length ? 1 : 0);
