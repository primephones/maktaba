// The picture shown when the Maktaba link is shared (WhatsApp, X, Telegram…): 1200×630.
// Run: node scripts/make-og.mjs   (writes public/og.png)
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright');
const f = (p) => readFileSync(new URL(`../node_modules/${p}`, import.meta.url)).toString('base64');
const LIT = f('@fontsource-variable/literata/files/literata-latin-wght-normal.woff2');
const LITI = f('@fontsource-variable/literata/files/literata-latin-wght-italic.woff2');
const AMIRI = f('@fontsource/amiri/files/amiri-arabic-700-normal.woff2');
const NAS = f('@fontsource/noto-nastaliq-urdu/files/noto-nastaliq-urdu-arabic-400-normal.woff2');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Lit;src:url(data:font/woff2;base64,${LIT}) format('woff2');font-weight:100 900}
@font-face{font-family:Lit;font-style:italic;src:url(data:font/woff2;base64,${LITI}) format('woff2');font-weight:100 900}
@font-face{font-family:Amiri;src:url(data:font/woff2;base64,${AMIRI}) format('woff2');font-weight:700}
@font-face{font-family:Nas;src:url(data:font/woff2;base64,${NAS}) format('woff2')}
html,body{margin:0}
.c{position:relative;width:1200px;height:630px;overflow:hidden;background:radial-gradient(120% 140% at 15% 10%,#3a2c20 0%,#221a13 55%,#17110c 100%);color:#f3e9d8;font-family:Lit,Georgia,serif}
.rule{position:absolute;inset:26px;border:1.5px solid rgba(201,164,92,.35);border-radius:18px}
.left{position:absolute;left:84px;top:96px;width:560px}
.name{font-size:92px;font-weight:600;letter-spacing:-1px;line-height:1}
.ar{font-family:Amiri;color:#e0796a;font-size:84px;margin-left:18px;vertical-align:-6px}
.tag{margin-top:34px;font-size:36px;line-height:1.3;font-weight:500}
.sub{margin-top:22px;font-size:23px;line-height:1.5;color:#cdbd9f;font-style:italic}
.gold{display:block;width:120px;height:2px;background:#c9a45c;margin:30px 0 0}
.page{position:absolute;right:84px;top:92px;width:420px;height:446px;background:#efe6d3;border-radius:6px 14px 14px 6px;box-shadow:0 30px 60px rgba(0,0,0,.45),inset 10px 0 18px rgba(0,0,0,.12);color:#2a2219;padding:40px 38px;box-sizing:border-box}
.page .ur{font-family:Nas;direction:rtl;font-size:25px;line-height:2.1;text-align:right}
.page .en{font-size:21px;line-height:1.5;margin-top:18px;color:#3b2f22}
.page .mark{color:#a3302a;font-size:15px;letter-spacing:2px;text-transform:uppercase;margin-top:24px;font-family:Lit;font-weight:600}
.page .who{font-style:italic;font-size:18px;color:#6b5a44;margin-top:10px}
.page .mark{position:absolute;left:38px;bottom:34px}
.page hr{border:0;border-top:1px solid rgba(80,60,30,.25);margin:18px 0 0}
</style></head><body><div class="c"><div class="rule"></div>
<div class="left">
  <div class="name">Maktaba<span class="ar">مكتبة</span></div>
  <span class="gold"></span>
  <div class="tag">Your Islamic library,<br>read in English.</div>
  <div class="sub">Arabic, Urdu and Persian books, even old scans, translated by your own free AI. The original always a tap away.</div>
</div>
<div class="page">
  <div class="ur">علم وہ ہے جو نفع دے، علم وہ نہیں جو صرف یاد کر لیا جائے۔</div>
  <hr>
  <div class="en">“Knowledge is what benefits, not what is merely memorised.”</div>
  <div class="who">Imām al-Shāfiʿī</div>
  <div class="mark">Urdu · English</div>
</div>
</div></body></html>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.setContent(html);
await p.evaluate(() => document.fonts.ready);
writeFileSync(new URL('../public/og.png', import.meta.url), await p.screenshot({ type: 'png' }));
await b.close();
console.log('public/og.png');
