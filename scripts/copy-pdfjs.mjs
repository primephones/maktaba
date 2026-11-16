// Copies the pdf.js runtime data (character maps, fonts, image decoders) into public/
// so PDFs open with no internet connection.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
const src = new URL('../node_modules/pdfjs-dist/', import.meta.url);
const dst = new URL('../public/pdfjs/', import.meta.url);
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(new URL(dir + '/', src), new URL(dir + '/', dst), { recursive: true });
}
console.log('pdf.js assets copied');
