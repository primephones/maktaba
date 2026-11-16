import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
const file = process.argv[2];
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true }).promise;
const page = await doc.getPage(Number(process.argv[3] || 1));
const tc = await page.getTextContent();
for (const it of tc.items.slice(0, Number(process.argv[4] || 60))) {
  if (!('str' in it)) continue;
  console.log(JSON.stringify(it.str), 'x=' + it.transform[4].toFixed(1), 'y=' + it.transform[5].toFixed(1), 'w=' + it.width.toFixed(1), 'h=' + it.height.toFixed(1), it.dir, it.hasEOL ? 'EOL' : '');
}
