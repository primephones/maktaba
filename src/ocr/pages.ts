import { db } from '../db/db';
import type { Book } from '../db/types';
import { pdfForBook } from '../lib/pdfjs';

/** Width pages are drawn at for recognition: about 250 dpi on an A5 or A4 page. */
const OCR_WIDTH = 2000;

/** The page numbers in a book that exist only as images. */
export async function imagePages(bookId: string): Promise<number[]> {
  const pages: number[] = [];
  const sections = await db.sections.where('bookId').equals(bookId).toArray();
  for (const s of sections) {
    for (const b of s.blocks) {
      if (b.t !== 'img' || !b.src) continue;
      const m = b.src.match(/^page:(\d+)$/);
      if (m) pages.push(Number(m[1]));
      else if (b.src === 'page-1') pages.push(1);
    }
  }
  return [...new Set(pages)].sort((a, b) => a - b);
}

/** Draws one page of a book onto a canvas, ready for recognition or for review. */
export async function pageImage(book: Pick<Book, 'id' | 'format'>, page: number, width = OCR_WIDTH): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  if (book.format === 'image') {
    const rec = await db.assets.get(`${book.id}:page-1`);
    if (!rec) throw new Error('The picture for this page is missing.');
    const bmp = await createImageBitmap(rec.blob);
    const scale = Math.min(1, width / bmp.width);
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return canvas;
  }
  const pdf = await pdfForBook(book.id, async () => (await db.files.get(book.id))?.blob);
  const p = await pdf.getPage(page);
  try {
    const base = p.getViewport({ scale: 1 });
    const viewport = p.getViewport({ scale: width / base.width });
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await p.render({ canvas, viewport }).promise;
    return canvas;
  } finally {
    p.cleanup();
  }
}
