// Copies the runtime data the app needs into public/, so it works with no internet:
// pdf.js character maps, fonts and image decoders, and the text-recognition engine with
// its Arabic, Urdu, Persian and English language data.
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const nm = new URL('../node_modules/', import.meta.url);
const pub = new URL('../public/', import.meta.url);

const pdfjs = new URL('pdfjs/', pub);
rmSync(pdfjs, { recursive: true, force: true });
mkdirSync(pdfjs, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(new URL(`pdfjs-dist/${dir}/`, nm), new URL(`${dir}/`, pdfjs), { recursive: true });
}

const ocr = new URL('tesseract/', pub);
rmSync(ocr, { recursive: true, force: true });
mkdirSync(new URL('lang/', ocr), { recursive: true });
cpSync(new URL('tesseract.js/dist/worker.min.js', nm), new URL('worker.min.js', ocr));
// Only the LSTM engine is used; one build for phones with SIMD and one for those without.
for (const f of ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js']) {
  cpSync(new URL(`tesseract.js-core/${f}`, nm), new URL(f, ocr));
}
for (const lang of ['ara', 'urd', 'fas', 'eng']) {
  cpSync(new URL(`@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`, nm), new URL(`lang/${lang}.traineddata.gz`, ocr));
}
// The Qur'an: Uthmani text with the Saheeh International English, for offline verse popups.
mkdirSync(new URL('quran/', pub), { recursive: true });
cpSync(new URL('quran-json/dist/quran_en.json', nm), new URL('quran/quran_en.json', pub));
console.log('runtime assets copied');
