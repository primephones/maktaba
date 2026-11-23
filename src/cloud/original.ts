import { db } from '../db/db';
import type { Book } from '../db/types';
import { closePdf } from '../lib/pdfjs';

/** Whether the book's own file (the PDF as it was added) is on this phone. */
export async function originalOnPhone(bookId: string): Promise<boolean> {
  return !!(await db.files.get(bookId));
}

/**
 * Brings the book's own file back from the reader's Google Drive, where Maktaba keeps a copy
 * of every book. Returns false when there is no Drive connected or no copy in it.
 */
export async function fetchOriginal(book: Book): Promise<boolean> {
  const d = await import('./drive');
  if (!(await d.getCloud())) return false;
  let id = book.cloudFileId;
  if (!id && book.hash) {
    const { books } = await d.ensureFolders();
    id = (await d.listFiles(`'${books}' in parents and trashed = false`, 'id,appProperties')).find((f) => f.appProperties?.hash === book.hash)?.id;
  }
  if (!id) return false;
  const blob = await d.download(id);
  await db.files.put({ bookId: book.id, blob });
  // A failed attempt to open the missing file is not remembered.
  closePdf(book.id);
  return true;
}
