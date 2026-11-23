// Draws the Maktaba icon — مكتبة in gold naskh on red leather, over a faint eight-pointed
// star — and writes the PNG sizes
// the web app and the Android app need. Run with: node scripts/make-icons.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
const amiri = readFileSync(new URL('../node_modules/@fontsource/amiri/files/amiri-arabic-700-normal.woff2', import.meta.url)).toString('base64');

/** `inset` is how far the artwork is pulled in, for maskable/adaptive icons that get cropped. */
const html = (size, { inset = 0, round = true, transparent = false } = {}) => `<!doctype html><html><head><style>
@font-face{font-family:Amiri;font-weight:700;src:url(data:font/woff2;base64,${amiri}) format('woff2');}
html,body{margin:0;width:${size}px;height:${size}px;background:transparent}
.icon{position:relative;width:${size}px;height:${size}px;overflow:hidden;border-radius:${round ? size * 0.22 : 0}px;
  background:${transparent ? 'transparent' : `
    radial-gradient(120% 90% at 28% 12%, rgba(255,255,255,.16), transparent 58%),
    radial-gradient(100% 80% at 82% 100%, rgba(0,0,0,.42), transparent 62%),
    linear-gradient(155deg,#96302a,#7a221d 46%,#4f1410)`};}
.grain{position:absolute;inset:0;opacity:.5;mix-blend-mode:multiply}
.frame{position:absolute;inset:${size * (0.085 + inset)}px;border:${Math.max(1.5, size * 0.011)}px solid transparent;
  border-image:linear-gradient(135deg,#8a6a24,#e8d28f 32%,#a8863c 58%,#f1dea6 84%,#8f7028) 1;}
.frame::after{content:'';position:absolute;inset:${size * 0.022}px;border:${Math.max(1, size * 0.004)}px solid rgba(214,184,112,.55)}
.word{position:absolute;inset:0;display:grid;place-items:center;font-family:Amiri;font-weight:700;direction:rtl;
  font-size:${size * (0.335 - inset * 0.62)}px;line-height:1;padding-bottom:${size * 0.075}px;
  background:linear-gradient(135deg,#a8863c,#f6e7b6 28%,#c2a052 52%,#f8ebc0 76%,#96762c);-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 ${size * 0.006}px ${size * 0.004}px rgba(0,0,0,.45))}
</style></head><body><div class="icon">
${transparent ? '' : `<svg class="grain" width="${size}" height="${size}"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="${(1.1 * 512) / size}" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 0.25  0 0 0 0 0.08  0 0 0 0 0.06  0 0 0 0.55 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`}
<svg class="star" viewBox="0 0 24 24" style="position:absolute;left:50%;top:47%;width:${size * (0.86 - inset * 1.5)}px;height:${size * (0.86 - inset * 1.5)}px;transform:translate(-50%,-50%);overflow:visible">
  <g fill="none" stroke="rgba(226,196,124,.17)" stroke-width="${Math.max(0.35, 0.42)}" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16"/><rect x="4" y="4" width="16" height="16" transform="rotate(45 12 12)"/></g>
</svg>
<div class="frame"></div><div class="word">مكتبة</div></div></body></html>`;

const browser = await chromium.launch();
const render = async (name, size, opts) => {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(html(size, opts));
  await page.evaluate(() => document.fonts.ready);
  writeFileSync(new URL(name, out), await page.screenshot({ type: 'png', omitBackground: true }));
  await page.close();
};
await render('icon-192.png', 192);
await render('icon-512.png', 512);
// Maskable: full-bleed square, artwork inside the safe zone.
await render('icon-maskable-512.png', 512, { inset: 0.1, round: false });
// Android adaptive icon layers (108dp canvas, 72dp safe zone), at xxxhdpi.
await render('android-background-432.png', 432, { inset: 2, round: false });
await render('android-foreground-432.png', 432, { inset: 0.17, round: false, transparent: true });
await browser.close();
console.log('icons written');
