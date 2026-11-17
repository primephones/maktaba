// Each person's own cloud: two phones of one reader, kept in step through their own
// Google Drive (a stand-in for Drive's API). Books go up as their original files, exactly
// as added; notes and places travel; a new phone fetches the books by itself; and when two
// phones change the same thing, the later change wins.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
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
const sha = (b) => createHash('sha256').update(b).digest('hex');

// A book over 4 MB, to go up in pieces.
const bigPath = `${root}e2e/out/fixtures/big-notes.txt`;
const line = 'قال الشافعي رحمه الله: العلم ما نفع، ليس العلم ما حفظ، وأجمع العلماء على أن طلب العلم فريضة.\n\n';
writeFileSync(bigPath, `# كتاب كبير\n\n${line.repeat(Math.ceil((5 * 1024 * 1024) / Buffer.byteLength(line)))}`);

const PORT = 8796;
const drive = spawn('node', [`${root}e2e/mock-drive.mjs`], { stdio: ['ignore', openSync(`${root}e2e/out/drive.log`, 'w'), 'inherit'], detached: true, env: { ...process.env, PORT: String(PORT) } });
const stats = async () => (await fetch(`http://127.0.0.1:${PORT}/stats`)).json();
for (let i = 0; i < 40; i++) {
  try {
    await stats();
    break;
  } catch {
    await wait(250);
  }
}

const app = await startServer();
const browser = await chromium.launch();
const errors = [];
const phone = async (name, mobileData = false) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  // A phone on mobile data says so, the way Android's browser engine does.
  if (mobileData) await ctx.addInitScript(() => Object.defineProperty(navigator, 'connection', { value: { type: 'cellular' } }));
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await p.goto(app.url);
  await p.waitForSelector('.screen-head h1');
  return p;
};
const read = (p, store) => p.evaluate(async (s) => {
  const req = indexedDB.open('maktaba');
  const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
  const all = await new Promise((r) => (dbh.transaction(s).objectStore(s).getAll().onsuccess = (e) => r(e.target.result)));
  dbh.close();
  return all;
}, store);
/** Connects the phone to the stand-in Drive, as signing in would. */
const connectCloud = (p) => p.evaluate(async (base) => {
  const req = indexedDB.open('maktaba');
  const dbh = await new Promise((r) => (req.onsuccess = () => r(req.result)));
  await new Promise((r) => {
    const tx = dbh.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key: 'cloud', value: { provider: 'gdrive', apiBase: base, testToken: 'test-token', email: 'reader@example.com', name: 'Test Reader' } });
    tx.oncomplete = r;
  });
  dbh.close();
  window.dispatchEvent(new Event('maktaba:connected'));
}, `http://127.0.0.1:${PORT}`);
const syncNow = async (p) => {
  await p.evaluate(() => { location.hash = '#/settings/cloud'; });
  await p.getByRole('button', { name: 'Sync now' }).click();
  await p.getByText('Up to date with your cloud.').waitFor({ timeout: 60000 });
};

let A;
let B;
try {
  console.log('Phone A: connecting your own cloud');
  A = await phone('A');
  await A.evaluate(() => { location.hash = '#/settings/cloud'; });
  await A.getByRole('heading', { name: 'Keep your library in your own cloud' }).waitFor({ timeout: 10000 });
  check(true, 'a new phone is offered its own cloud');
  check(await A.getByText('Only Maktaba’s own folder').isVisible(), 'and told Maktaba sees only its own folder');
  await A.screenshot({ path: `${shots}50-cloud-connect.png` });
  await A.setInputFiles('[data-testid=add-input]', [fx('usul.epub'), fx('risala-text.pdf'), bigPath]);
  for (let i = 0; i < 60; i++) {
    if ((await read(A, 'books')).every((b) => b.import.state === 'ready')) break;
    await wait(1000);
  }
  // A highlight and a reading place, before the cloud is connected.
  await A.evaluate(() => { location.hash = '#/library'; });
  await A.getByRole('button', { name: 'Open مختصر في أصول الفقه', exact: true }).click();
  await A.waitForSelector('.bk');
  await wait(600);
  await A.evaluate(() => {
    const p = document.querySelectorAll('.bk[data-t="p"]')[1];
    const r = document.createRange();
    r.selectNodeContents(p);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await wait(400);
  await A.getByRole('button', { name: 'Highlight Gold' }).click();
  await wait(800);

  await connectCloud(A);
  await syncNow(A);
  await A.getByText('3 of 3 books saved in your Drive.').waitFor({ timeout: 60000 });
  check(true, 'phone A saves all its books to its own Drive');
  await A.screenshot({ path: `${shots}51-cloud-connected.png` });
  const s1 = await stats();
  const folderNames = s1.files.filter((f) => f.mimeType === 'application/vnd.google-apps.folder').map((f) => f.name).sort();
  check(JSON.stringify(folderNames) === JSON.stringify(['Books', 'Maktaba', 'Sync']), `everything is kept in one Maktaba folder (${folderNames})`);
  const booksFolder = s1.files.find((f) => f.name === 'Books').id;
  const inBooks = s1.files.filter((f) => f.parents.includes(booksFolder));
  const orig = { usul: readFileSync(fx('usul.epub')), risala: readFileSync(fx('risala-text.pdf')), big: readFileSync(bigPath) };
  const upHashes = await Promise.all(inBooks.map(async (f) => sha(Buffer.from(await (await fetch(`http://127.0.0.1:${PORT}/file?id=${f.id}`)).arrayBuffer()))));
  check(Object.values(orig).every((b) => upHashes.includes(sha(b))), 'the files in Drive are the originals, byte for byte (the large one sent in pieces)');

  console.log('Phone B: the same reader’s other phone');
  B = await phone('B');
  await connectCloud(B);
  let bBooks = [];
  for (let i = 0; i < 90; i++) {
    bBooks = await read(B, 'books');
    if (bBooks.length === 3 && bBooks.every((b) => b.import.state === 'ready')) break;
    await wait(1000);
  }
  check(bBooks.length === 3 && bBooks.every((b) => b.import.state === 'ready'), `phone B gets the whole library from Drive by itself (${bBooks.map((b) => `${b.title}:${b.import.state}`).join(', ')})`);
  const marks = await read(B, 'marks');
  check(marks.some((m) => m.type === 'highlight' || m.color), 'the highlight made on phone A is on phone B');
  await B.evaluate(() => { location.hash = '#/library'; });
  await B.getByRole('button', { name: 'Open مختصر في أصول الفقه', exact: true }).click();
  await B.waitForSelector('.hl', { timeout: 15000 });
  check(true, 'and shows in the book on phone B');

  console.log('The later change wins');
  const usulA = (await read(A, 'books')).find((b) => b.title === 'مختصر في أصول الفقه');
  const setStatus = async (p, label) => {
    await p.evaluate(() => { location.hash = '#/library'; });
    await wait(700);
    console.log('   details');
    await p.getByRole('button', { name: 'Details for مختصر في أصول الفقه' }).click({ timeout: 10000 });
    console.log('   status', label);
    await p.locator('.sheet').getByRole('button', { name: label, exact: true }).click({ timeout: 10000 });
    await wait(400);
    console.log('   close');
    await p.locator('.sheet').getByRole('button', { name: 'Close' }).click({ timeout: 10000 });
    await wait(400);
  };
  await setStatus(B, 'Finished');
  await syncNow(B);
  await wait(50);
  await setStatus(A, 'Want to read');
  await syncNow(A);
  await syncNow(B);
  await syncNow(A);
  const stA = (await read(A, 'books')).find((b) => b.id === usulA.id).status;
  const stB = (await read(B, 'books')).find((b) => b.id === usulA.id).status;
  check(stA === 'want' && stB === 'want', `both phones end with the later change (A: ${stA}, B: ${stB})`);

  console.log('Making the free space go further');
  const s3 = await stats();
  const syncFolder = s3.files.find((f) => f.name === 'Sync').id;
  const syncFiles = s3.files.filter((f) => f.parents.includes(syncFolder));
  check(syncFiles.length > 0 && syncFiles.every((f) => f.name.endsWith('.json.gz')), `study data is stored compressed (${syncFiles.map((f) => f.name.split('.').slice(1).join('.')).join(', ')})`);
  const booksBefore = s3.files.filter((f) => f.parents.includes(booksFolder)).length;
  await A.evaluate(() => { location.hash = '#/settings/cloud'; });
  await A.getByText(/Maktaba \(3 books, notes and translations\)/).waitFor({ timeout: 15000 });
  check(true, 'the cloud page shows how much of the Drive Maktaba uses');
  check(await A.getByText('Free', { exact: true }).isVisible(), 'and how much is free');
  await A.screenshot({ path: `${shots}52-cloud-space.png`, fullPage: true });
  await A.evaluate(() => { location.hash = '#/library'; });
  await wait(700);
  await A.getByRole('button', { name: 'Details for big-notes' }).dispatchEvent('click');
  await A.getByRole('button', { name: /Remove from this device/ }).click();
  check(await A.getByText('Also remove it from my Google Drive').waitFor({ timeout: 8000 }).then(() => true, () => false), 'removing a book offers to free its Drive space');
  await A.getByRole('button', { name: 'Remove book' }).click();
  await A.getByText(/freed in your Drive/).waitFor({ timeout: 15000 });
  const booksAfter = (await stats()).files.filter((f) => f.parents.includes(booksFolder)).length;
  check(booksAfter === booksBefore - 1, `…and does (${booksBefore} → ${booksAfter} files in Drive)`);

  console.log('On mobile data');
  const C = await phone('C', true);
  await connectCloud(C);
  let cBooks = [];
  for (let i = 0; i < 30; i++) {
    cBooks = await read(C, 'books');
    if (cBooks.length >= 2) break;
    await wait(1000);
  }
  await wait(2000);
  check(cBooks.length >= 2 && cBooks.every((b) => b.import.state === 'missing'), `on mobile data the library arrives, but book files wait for Wi-Fi (${cBooks.map((b) => b.import.state).join(', ')})`);
  check((await read(C, 'marks')).length > 0, 'notes and highlights still sync on mobile data');
  await C.evaluate(() => { location.hash = '#/settings/cloud'; });
  await C.getByText(/waiting for Wi-Fi/).waitFor({ timeout: 15000 });
  check(true, 'and the cloud page says how many are waiting for Wi-Fi');
  await C.getByRole('switch', { name: 'Use mobile data for books' }).click();
  await C.getByRole('button', { name: 'Sync now' }).click();
  for (let i = 0; i < 30; i++) {
    cBooks = await read(C, 'books');
    if (cBooks.every((b) => b.import.state === 'ready')) break;
    await wait(1000);
  }
  check(cBooks.every((b) => b.import.state === 'ready'), 'allowing mobile data fetches them');

  console.log('Nothing else');
  const s2 = await stats();
  check(s2.files.every((f) => f.mimeType === 'application/vnd.google-apps.folder' || f.parents.length === 1), 'every file Maktaba makes is inside its own folder');
  const cloud = (await read(B, 'settings')).find((r) => r.key === 'cloud');
  check(!!cloud && !(await read(B, 'outbox')).some((e) => e.key === 'cloud'), 'the cloud sign-in is never synced');
  check(errors.length === 0, `no errors in the page ${JSON.stringify(errors.slice(0, 3))}`);
} catch (e) {
  check(false, `stopped: ${e.message.split('\n')[0]}`);
  await A?.screenshot({ path: `${shots}FAILED-cloud-A.png` }).catch(() => undefined);
  await B?.screenshot({ path: `${shots}FAILED-cloud-B.png` }).catch(() => undefined);
} finally {
  await browser.close();
  app.stop();
  try {
    process.kill(-drive.pid, 'SIGKILL');
  } catch {
    /* gone */
  }
}
console.log(`\n${passed} checks passed, ${failures.length} failed`);
for (const f of failures) console.log(' - ' + f);
process.exit(failures.length ? 1 : 0);
