// Builds the test books used by the end-to-end run: a real EPUB with Arabic text,
// footnotes and a contents list; a text PDF; a scanned (image-only) PDF; Urdu and
// OpenITI text files. Everything is generated, so no copyrighted books live in the repo.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const out = new URL('./out/fixtures/', import.meta.url);
mkdirSync(out, { recursive: true });
const amiri = readFileSync(new URL('../node_modules/@fontsource/amiri/files/amiri-arabic-400-normal.woff2', import.meta.url)).toString('base64');
const fontCss = `@font-face{font-family:Amiri;src:url(data:font/woff2;base64,${amiri}) format('woff2');}`;

const AR = [
  'الحمد لله رب العالمين، والصلاة والسلام على أشرف الأنبياء والمرسلين، نبينا محمد وعلى آله وصحبه أجمعين.',
  'أما بعد: فإنَّ العِلْمَ أفضلُ ما اكتسبه المرءُ في حياته، وهو ميراثُ الأنبياء، وبه تُعرَف الأحكامُ ويُميَّز الحلالُ من الحرام.',
  'قال الإمام الشافعي رحمه الله: العلم ما نفع، ليس العلم ما حُفِظ. وقد أجمع العلماء على أن طلب العلم فريضة على كل مسلم.',
  'واعلم أن الإجماع حجة قاطعة عند جمهور الأصوليين، وهو اتفاق مجتهدي الأمة في عصر من العصور على حكم شرعي.',
  'والقياس هو إلحاق فرع بأصل في الحكم لعلة جامعة بينهما، وهو الدليل الرابع من الأدلة المتفق عليها.',
];
const para = (i) => AR[i % AR.length];
// Chrome writes vowelled Arabic into PDFs with letters unmapped, which is exactly the
// damaged text layer the importer must catch. Unvowelled text comes through intact.
const plain = (i) => para(i).replace(/[\u064B-\u065F\u0670]/g, '');

// ---------- EPUB ----------
const chapter = (n, title, extra = '') => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="ar" dir="rtl"><head><title>${title}</title></head>
<body><h1 id="ch${n}">${title}</h1>
${Array.from({ length: 14 }, (_, i) => `<p>${para(i + n)} ${i === 1 ? `<a epub:type="noteref" href="#fn${n}">١</a>` : ''}</p>`).join('\n')}
<h2 id="ch${n}s2">فصل في بيان المسألة</h2>
${Array.from({ length: 10 }, (_, i) => `<p>${para(i + n + 2)} <b>${i === 0 ? 'تنبيه مهم' : ''}</b></p>`).join('\n')}
${extra}
<aside epub:type="footnote" id="fn${n}"><p>١. انظر: الرسالة للإمام الشافعي، ص ${n}٢.</p></aside>
</body></html>`;

const coverSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="#e9dfc6"/><rect x="40" y="40" width="520" height="820" fill="none" stroke="#7a5c2e" stroke-width="6"/><circle cx="300" cy="330" r="130" fill="none" stroke="#a3302a" stroke-width="8"/><rect x="150" y="560" width="300" height="14" fill="#3e5560"/><rect x="190" y="600" width="220" height="10" fill="#3e5560"/></svg>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 600, height: 900 } });
await page.setContent(`<body style="margin:0">${coverSvg}</body>`);
const coverPng = await page.screenshot({ type: 'png' });

const epub = zipSync({
  mimetype: [strToU8('application/epub+zip'), { level: 0 }],
  'META-INF/container.xml': strToU8(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
  'OEBPS/content.opf': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">maktaba-test-1</dc:identifier><dc:title>مختصر في أصول الفقه</dc:title><dc:creator>ابن اللحام</dc:creator><dc:language>ar</dc:language></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>
<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/><item id="c3" href="c3.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine page-progression-direction="rtl"><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine></package>`),
  'OEBPS/nav.xhtml': strToU8(`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>
<li><a href="c1.xhtml#ch1">المقدمة</a></li>
<li><a href="c2.xhtml#ch2">باب الإجماع</a><ol><li><a href="c2.xhtml#ch2s2">فصل في بيان المسألة</a></li></ol></li>
<li><a href="c3.xhtml#ch3">باب القياس</a></li></ol></nav></body></html>`),
  'OEBPS/cover.png': [new Uint8Array(coverPng), { level: 0 }],
  'OEBPS/c1.xhtml': strToU8(chapter(1, 'المقدمة')),
  'OEBPS/c2.xhtml': strToU8(chapter(2, 'باب الإجماع')),
  'OEBPS/c3.xhtml': strToU8(chapter(3, 'باب القياس', '<p>الكلمة المميزة: زبرجد.</p>')),
});
writeFileSync(new URL('usul.epub', out), epub);

// ---------- Text PDF (Arabic, with printed page numbers) ----------
const pdfHtml = (pages, text = plain) => `<html dir="rtl"><head><style>${fontCss}
@page{size:A5;margin:18mm 16mm}body{font-family:Amiri;font-size:15pt;line-height:1.9}
.pg{page-break-after:always;position:relative;height:160mm}.no{position:absolute;bottom:0;left:0;right:0;text-align:center;font-size:11pt}
h1{font-size:20pt;color:#000}</style></head><body>
${Array.from({ length: pages }, (_, p) => `<div class="pg">${p % 4 === 0 ? `<h1>الباب ${p / 4 + 1}</h1>` : ''}${Array.from({ length: 3 }, (_, i) => `<p>${text(i + p)} ${p === 6 && i === 2 ? 'الكلمة النادرة: ياقوت.' : ''}</p>`).join('')}<div class="no">${p + 1}</div></div>`).join('')}
</body></html>`;
await page.setContent(pdfHtml(24));
await page.evaluate(() => document.fonts.ready);
writeFileSync(new URL('risala-text.pdf', out), await page.pdf({ preferCSSPageSize: true }));
await page.setContent(pdfHtml(4, para));
await page.evaluate(() => document.fonts.ready);
writeFileSync(new URL('damaged-text-layer.pdf', out), await page.pdf({ preferCSSPageSize: true }));

// ---------- English text PDF ----------
await page.setContent(`<html><head><style>@page{size:A5;margin:18mm}body{font-family:Georgia,serif;font-size:12pt;line-height:1.6}h1{font-size:18pt}.pg{page-break-after:always}</style></head><body>
${Array.from({ length: 6 }, (_, p) => `<div class="pg"><h1>Chapter ${p + 1}</h1>${Array.from({ length: 5 }, (_, i) => `<p>Consensus (ijmāʿ) is the agreement of the qualified jurists of a generation on a legal ruling. Paragraph ${i + 1} of chapter ${p + 1} explains why the scholars treated it as a decisive proof, and how analogy follows it in rank.</p>`).join('')}</div>`).join('')}</body></html>`);
writeFileSync(new URL('Introduction to Usul - Vol 1.pdf', out), await page.pdf({ preferCSSPageSize: true }));
await page.setContent(`<html><head><style>@page{size:A5;margin:18mm}body{font-family:Georgia,serif;font-size:12pt;line-height:1.6}.pg{page-break-after:always}</style></head><body>
${Array.from({ length: 3 }, (_, p) => `<div class="pg"><h1>Part ${p + 1}</h1><p>The second volume continues with the proofs. Page ${p + 1} of volume two.</p><p>Another paragraph follows it here.</p></div>`).join('')}</body></html>`);
writeFileSync(new URL('Introduction to Usul - Vol 2.pdf', out), await page.pdf({ preferCSSPageSize: true }));

// ---------- Scanned PDF: pictures of pages, no text layer ----------
const shots = [];
const scanPage = await browser.newPage({ viewport: { width: 620, height: 880 } });
for (let p = 0; p < 5; p++) {
  await scanPage.setContent(`<html dir="rtl"><head><style>${fontCss}body{margin:0;padding:50px 46px;font-family:Amiri;font-size:21px;line-height:2;background:#f4efdf;color:#222}</style></head><body><h2>صفحة مصورة ${p + 1}</h2>${Array.from({ length: 5 }, (_, i) => `<p>${para(i + p)}</p>`).join('')}</body></html>`);
  await scanPage.evaluate(() => document.fonts.ready);
  shots.push((await scanPage.screenshot({ type: 'jpeg', quality: 70 })).toString('base64'));
}
await page.setContent(`<html><head><style>@page{size:620px 880px;margin:0}body{margin:0}img{display:block;width:620px;height:880px;page-break-after:always}</style></head><body>${shots.map((s) => `<img src="data:image/jpeg;base64,${s}">`).join('')}</body></html>`);
writeFileSync(new URL('makhtut-scan.pdf', out), await page.pdf({ preferCSSPageSize: true }));
await browser.close();

// ---------- Urdu text ----------
writeFileSync(new URL('urdu-risala.txt', out), [
  'باب اول',
  '',
  'یہ کتاب اصولِ فقہ کے بنیادی مسائل پر مشتمل ہے۔ اس میں اجماع اور قیاس کی بحث تفصیل سے بیان کی گئی ہے۔',
  '',
  'علماء نے لکھا ہے کہ علم حاصل کرنا ہر مسلمان پر فرض ہے، اور یہ کہ علم وہی ہے جو نفع دے۔',
  '',
  'ٹھیک اسی طرح ڈاکٹر صاحب نے بڑے اہتمام کے ساتھ اس مسئلے کی وضاحت فرمائی ہے۔',
  ...Array.from({ length: 30 }, (_, i) => `\nپیراگراف نمبر ${i + 1}: اس مقام پر مصنف نے دلائل ذکر کیے ہیں اور مخالف کے اعتراض کا جواب دیا ہے۔`),
].join('\n'));

// ---------- OpenITI mARkdown: its page codes must never show up as text ----------
writeFileSync(new URL('0204Shafici.Risala', out), `######OpenITI#
#META# 010.AuthorNAME :: الشافعي
#META# 020.BookTITLE :: الرسالة
#META#Header#End#

### | باب كيف البيان
# قال الشافعي رحمه الله: والبيان اسم جامع لمعاني مجتمعة الأصول متشعبة الفروع ms001
~~ فأقل ما في تلك المعاني المجتمعة المتشعبة أنها بيان لمن خوطب بها PageV01P021
# ممن نزل القرآن بلسانه، متقاربة الاستواء عنده، وإن كان بعضها أشد تأكيد بيان من بعض.
### || فصل
# ومختلفة عند من يجهل لسان العرب. ms002 PageV01P022
~~ قال الشافعي: فجماع ما أبان الله لخلقه في كتابه.
`);

// ---------- Not a book ----------
writeFileSync(new URL('notes.xyz', out), new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
console.log('fixtures written to', out.pathname);
