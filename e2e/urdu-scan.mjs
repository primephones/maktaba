// A scanned Urdu book as the owner's real ones are: Nastaliq type on grey paper, the page
// number in Urdu figures at the top, a heading, an Arabic verse set apart, a signature,
// a slight tilt and blur, JPEG grain, and a website's name stamped across every page.
// The text is from Mufti Muhammad Taqi Usmani's essays (Islam aur Siyasat-e-Hazira, Zikr o Fikr).
import { readFileSync } from 'node:fs';

const font = (name) => readFileSync(new URL(`../node_modules/@fontsource/${name}`, import.meta.url)).toString('base64');
const NASTALIQ = font('noto-nastaliq-urdu/files/noto-nastaliq-urdu-arabic-400-normal.woff2');
const NASKH = font('amiri/files/amiri-arabic-400-normal.woff2');

/** The pages: [printed number, heading or '', paragraphs ({ q } is an Arabic verse, { sign } a signature)]. */
export const URDU_PAGES = [
  [
    '۵',
    'حرفِ آغاز',
    [
      'اور اتنی ضخیم کتاب کا حصہ بننے کا ایک نقصان یہ ہوگا کہ اگر کوئی صاحب ان میں سے صرف کسی ایک موضوع کے مضامین سے دلچسپی رکھتے ہوں تو انہیں یہ پوری ضخیم کتاب لینی پڑے گی جس کے بہت سے ابواب شاید ان کے لئے مفید مطلب نہ ہوں۔',
      'اس بنا پر میں نے مناسب سمجھا کہ اب ان مضامین کو ایک کتاب میں جمع کرنے کے بجائے ہر موضوع پر الگ الگ مجموعے تیار کرنا زیادہ مناسب ہوگا۔ چنانچہ احقر نے مندرجہ ذیل مختلف عنوانات قائم کرکے ہر عنوان پر ایک مجموعۂ مضامین کتابی شکل میں ترتیب دیا ہے: (۱) نفاذِ شریعت اور اس کے مسائل (۲) اسلام اور سیاستِ حاضرہ (۳) اسلام اور جدت پسندی (۴) ہمارا تعلیمی نظام (۵) فرد کی اصلاح۔',
      'ان مجموعوں میں سے اس وقت ایک مجموعہ ”اسلام اور سیاستِ حاضرہ“ پیشِ خدمت ہے۔ اللہ تعالیٰ سے دعا ہے کہ وہ اس کو مسلمانوں کے لئے مفید بنائیں، اور یہ احقر کے لئے ذخیرۂ آخرت ثابت ہو۔ آمین',
      { sign: 'محمد تقی عثمانی' },
    ],
  ],
  [
    '۷',
    'نئے انتخابات',
    [
      'موجودہ پارلیمانی طرزِ حکومت میں جو حکومت بھی برسرِ اقتدار آتی ہے وہ انتخابات ہی کے ذریعے اقتدار کے منصب تک پہنچتی ہے، لہٰذا اس حکومت کے تمام اعمال و افعال اس کے منتخب کرنے والے عوام کی طرف منسوب ہوتے ہیں، اور ان کی دنیوی اور اخروی ذمہ داری بڑی حد تک ان لوگوں پر عائد ہوتی ہے جنہوں نے اپنے ووٹ دے کر اسے منتخب کیا۔',
      'اگرچہ عملی سیاست سے ہمارا کبھی کوئی تعلق نہیں رہا، لیکن اسلام نے زندگی کے ہر شعبے کی طرح اس شعبے میں بھی ہمیں کچھ اصولی ہدایات عطا کی ہیں، اور آج کی نشست میں انہی ہدایات کی تھوڑی سی تشریح مقصود ہے۔',
    ],
  ],
  [
    '۸',
    '',
    [
      'شرعی اعتبار سے ”ووٹ“ ایک شہادت ہے، آپ جس شخص کو اپنا ووٹ دیتے ہیں گویا اس کے بارے میں یہ گواہی دیتے ہیں کہ یہ شخص آپ کی نظر میں اسمبلی کی رکنیت یا حکومت کا اہل ہے۔ قرآن کریم کا ارشاد ہے:',
      { q: 'إِنَّ اللَّهَ يَأْمُرُكُمْ أَنْ تُؤَدُّوا الْأَمَانَاتِ إِلَى أَهْلِهَا' },
      'لہٰذا ”ووٹ“ پر شرعی اعتبار سے وہ تمام احکام جاری ہوتے ہیں جو شہادت پر جاری ہوتے ہیں، اور جھوٹی گواہی دینا گناہِ کبیرہ ہے۔',
    ],
  ],
  [
    '۱۴',
    '',
    [
      'مشہور ہے کہ ہارون رشید ایک مرتبہ پانی پینے کے لئے گلاس ہاتھ میں لئے ہوئے تھے، وہ اس گلاس کو ہونٹوں تک لے جانے لگے تو قریب ہی بیٹھے ہوئے بہلول مجذوب نے ان سے کہا کہ امیر المؤمنین! ذرا ایک لمحے کے لئے رک جایئے۔',
      'ہارون رشید رک گئے تو بہلول نے کہا: ذرا بتایئے کہ اگر شدید پیاس کے وقت آپ کو یہ پانی نہ ملے تو آپ اسے حاصل کرنے کے لئے کتنی دولت خرچ کر دیں گے؟ ہارون رشید نے کہا کہ ساری دولت۔',
    ],
  ],
  [
    '۴۱',
    'نومسلموں کے مسائل',
    [
      'جو لوگ اپنا آبائی دین چھوڑ کر دل سے اسلام قبول کرتے ہیں، وہ اس لحاظ سے انتہائی قابلِ قدر ہیں کہ وہ اپنے ضمیر کی آواز پر لبیک کہتے ہوئے اپنے سابقہ تعلقات کی قربانی پیش کرتے ہیں۔ بچپن سے دل و دماغ پر چھائے ہوئے تصورات کو یکلخت چھوڑ بیٹھنا آسان کام نہیں ہوتا۔',
      'لیکن افسوس ہے کہ ہم ابھی تک اپنے نومسلم بھائیوں کو ایسا دلکش ماحول مہیا نہیں کر سکے۔ اس کی ایک وجہ بیشک یہ بھی ہے کہ دھوکہ بازی اور فریب کاری کا ایسا بازار گرم ہے کہ سچ اور جھوٹ کا امتیاز کرنا مشکل ہے۔',
    ],
  ],
];

/** The words of each page as printed (for checking what was read), without the watermark. */
export const pageWords = (n) => {
  const [, head, paras] = URDU_PAGES[n];
  return [head, ...paras.map((p) => (typeof p === 'string' ? p : p.q ?? p.sign))].filter(Boolean).join(' ');
};

function pageHtml([printed, head, paras], tilt) {
  return `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>
@font-face{font-family:Nas;src:url(data:font/woff2;base64,${NASTALIQ}) format('woff2')}
@font-face{font-family:Naskh;src:url(data:font/woff2;base64,${NASKH}) format('woff2')}
html,body{margin:0;background:#d9d6cf}
.page{position:relative;width:620px;height:880px;overflow:hidden;background:#e6e3dc;color:#1d1b18;filter:blur(.35px) contrast(1.12)}
.in{position:absolute;inset:34px 46px 40px 46px;transform:rotate(${tilt}deg);transform-origin:50% 0}
.no{text-align:center;font-family:Nas;font-size:17px;margin-bottom:8px}
h1{font-family:Nas;font-weight:400;font-size:27px;text-align:center;margin:6px 0 18px;line-height:2.1}
p{font-family:Nas;font-size:17.5px;line-height:2.25;text-align:justify;margin:0 0 4px;text-indent:1.4em}
.q{font-family:Naskh;font-size:22px;text-align:center;margin:8px 0 10px;text-indent:0}
.sign{font-family:Nas;font-size:18px;text-align:left;margin-top:16px;text-indent:0}
.wm{position:absolute;left:-60px;top:400px;width:760px;transform:rotate(-38deg);font:600 46px/1 Georgia,serif;color:rgba(40,40,40,.13);letter-spacing:2px;direction:ltr;text-align:center;white-space:nowrap}
.grain{position:absolute;inset:0;opacity:.22;mix-blend-mode:multiply}
</style></head><body><div class="page"><div class="in">
<div class="no">${printed}</div>
${head ? `<h1>${head}</h1>` : ''}
${paras.map((p) => (typeof p === 'string' ? `<p>${p}</p>` : p.q ? `<p class="q">﴿${p.q}﴾</p>` : `<p class="sign">${p.sign}</p>`)).join('\n')}
</div>
<div class="wm">www.muftitaqiusmani.com</div>
<svg class="grain" width="620" height="880"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>
</div></body></html>`;
}

/** Builds the scanned book as a PDF of page pictures, with a browser from Playwright. */
export async function urduScanPdf(browser, pages = URDU_PAGES.length) {
  const ctx = await browser.newContext({ viewport: { width: 620, height: 880 }, deviceScaleFactor: 2 });
  const maker = await ctx.newPage();
  const shots = [];
  for (let i = 0; i < pages; i++) {
    await maker.setContent(pageHtml(URDU_PAGES[i], [0.4, -0.5, 0.7, -0.3, 0.5][i % 5]));
    await maker.evaluate(() => document.fonts.ready);
    shots.push((await maker.screenshot({ type: 'jpeg', quality: 58 })).toString('base64'));
  }
  await maker.setContent(`<html><head><style>@page{size:620px 880px;margin:0}body{margin:0}img{display:block;width:620px;height:880px;page-break-after:always}</style></head><body>${shots.map((s) => `<img src="data:image/jpeg;base64,${s}">`).join('')}</body></html>`);
  const pdf = await maker.pdf({ preferCSSPageSize: true });
  await ctx.close();
  return pdf;
}
