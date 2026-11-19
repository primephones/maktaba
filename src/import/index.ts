import { db, sectionId, uid } from '../db/db';
import type { Book, BookFormat, Lang } from '../db/types';
import { detectLang, parseVolume } from '../lib/arabic';
import { sha256, titleFromFileName } from '../lib/util';
import type { DraftSection, ImportContext, ParsedBook } from './types';
import { sectionChars, splitLargeSections } from './sections';
import { workBegan, workEnded, workProgress } from '../native/work';

const EXT: Record<string, BookFormat> = {
  epub: 'epub', pdf: 'pdf', txt: 'txt', text: 'txt', md: 'md', markdown: 'md', mARkdown: 'md',
  docx: 'docx', fb2: 'fb2', html: 'html', htm: 'html', xhtml: 'html',
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', gif: 'image', bmp: 'image',
  mobi: 'mobi', azw: 'mobi', azw3: 'mobi', prc: 'mobi',
};

export const ACCEPT = '.epub,.mobi,.azw,.azw3,.prc,.pdf,.txt,.md,.markdown,.docx,.fb2,.html,.htm,.jpg,.jpeg,.png,.webp,application/epub+zip,application/pdf,text/plain,text/markdown,image/*,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export class UnsupportedFormat extends Error {}

export async function detectFormat(file: File): Promise<BookFormat> {
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  if (ext === 'kfx') throw new UnsupportedFormat('KFX is a Kindle-only format. Send the book to yourself as AZW3 or EPUB instead.');
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const pdb = await file.slice(60, 68).text();
  if (pdb === 'BOOKMOBI') return 'mobi';
  const magic = String.fromCharCode(...head);
  if (magic.startsWith('%PDF')) return 'pdf';
  if (magic.startsWith('PK')) {
    if (ext === 'docx' || file.type.includes('wordprocessingml')) return 'docx';
    return 'epub';
  }
  if (head[0] === 0xff && head[1] === 0xd8) return 'image';
  if (magic.startsWith('\x89PNG')) return 'image';
  if (EXT[ext]) return EXT[ext];
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('text/')) return 'txt';
  // OpenITI texts have no extension at all.
  const sniff = await file.slice(0, 200).text();
  if (sniff.includes('######OpenITI#')) return 'md';
  throw new UnsupportedFormat(`"${file.name}" is not a kind of book Maktaba can open. Supported: PDF, EPUB, Kindle (MOBI, AZW3), Word (DOCX), FB2, text, Markdown and images.`);
}

export interface AddResult {
  fileName: string;
  bookId?: string;
  /** Set when the same file is already in the library. */
  duplicateOf?: Book;
  error?: string;
}

/**
 * Stores the files and queues them for processing. Returns straight away; the queue does
 * the work and records progress on each book, so every screen can show it.
 */
export async function addFiles(files: File[], opts: { allowDuplicates?: boolean; folderId?: string } = {}): Promise<AddResult[]> {
  const results: AddResult[] = [];
  for (const file of files) {
    try {
      const format = await detectFormat(file);
      const hash = await sha256(file);
      // A book synced from another phone, waiting for its file: this is it.
      const waiting = await db.books.where('hash').equals(hash).filter((b) => b.import.state === 'missing').first();
      if (waiting) {
        await db.transaction('rw', db.books, db.files, async () => {
          await db.files.put({ bookId: waiting.id, blob: file });
          await db.books.update(waiting.id, { import: { state: 'queued', done: 0, total: 0 }, size: file.size, fileName: file.name, format });
        });
        results.push({ fileName: file.name, bookId: waiting.id });
        continue;
      }
      if (!opts.allowDuplicates) {
        const existing = await db.books.where('hash').equals(hash).first();
        if (existing) {
          results.push({ fileName: file.name, duplicateOf: existing });
          continue;
        }
      }
      const title = titleFromFileName(file.name);
      const vol = parseVolume(title);
      const book: Book = {
        id: uid(),
        title,
        author: '',
        lang: 'other',
        format,
        kind: format === 'image' ? 'scan' : 'text',
        size: file.size,
        hash,
        fileName: file.name,
        addedAt: Date.now(),
        status: 'want',
        folderId: opts.folderId,
        hasCover: false,
        series: vol?.series,
        volume: vol?.volume,
        sectionCount: 0,
        sectionChars: [],
        toc: [],
        import: { state: 'queued', done: 0, total: 0 },
      };
      await db.transaction('rw', db.books, db.files, async () => {
        await db.books.add(book);
        await db.files.put({ bookId: book.id, blob: file });
      });
      results.push({ fileName: file.name, bookId: book.id });
    } catch (e) {
      results.push({ fileName: file.name, error: friendly(e) });
    }
  }
  void runQueue();
  return results;
}

const cancelled = new Set<string>();
let running = false;

/** True while books are being imported; text recognition waits for it. */
export const importBusy = () => running;

/** Stops work on a book that is being removed. */
export const cancelImport = (bookId: string) => {
  cancelled.add(bookId);
  void import('../ocr/queue').then((q) => q.stopOcr(bookId));
};

export async function retryImport(bookId: string): Promise<void> {
  const book = await db.books.get(bookId);
  if (!book) return;
  // Text PDFs keep the pages already read; everything else starts over.
  const keep = book.format === 'pdf' ? book.sectionCount : 0;
  if (!keep) await db.sections.where('bookId').equals(bookId).delete();
  await db.books.update(bookId, {
    sectionCount: keep,
    import: { state: 'queued', done: book.import.done, total: book.import.total },
  });
  void runQueue();
}

/** Called on launch: anything left half-done by a closed app or a restart carries on. */
export async function resumeImports(): Promise<void> {
  await db.books.filter((b) => b.import.state === 'processing').modify((b) => {
    b.import.state = 'queued';
  });
  await runQueue();
}

export async function runQueue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const next = (await db.books.orderBy('addedAt').filter((b) => b.import.state === 'queued').first()) ?? null;
      if (!next) break;
      await workBegan('import', `Preparing ${next.title}`, 'Opening the file', `“${next.title}” was still being prepared.`);
      await processBook(next);
    }
  } finally {
    running = false;
    await workEnded('import');
    // Scanned pages are recognised once the books themselves are in.
    const { runOcrQueue } = await import('../ocr/queue');
    void runOcrQueue();
  }
}

function friendly(e: unknown): string {
  if (e instanceof Error && e.message && e.message.length < 220 && !/^(Cannot read|undefined is not|null is not|.* is not a function)/.test(e.message)) return e.message;
  return 'This file could not be read. It may be damaged or in an unusual format.';
}

async function processBook(book: Book): Promise<void> {
  const id = book.id;
  const isCancelled = () => cancelled.has(id);
  let lastWrite = 0;

  const ctx: ImportContext = {
    book,
    file: new Blob(),
    resumeSections: book.format === 'pdf' ? book.sectionCount : 0,
    async putSection(idx, s) {
      await db.sections.put({
        id: sectionId(id, idx), bookId: id, idx, title: s.title, blocks: s.blocks, notes: s.notes, chars: sectionChars(s.blocks),
      });
    },
    async setCover(blob) {
      await db.covers.put({ bookId: id, blob });
      await db.books.update(id, { hasCover: true });
    },
    async patch(update) {
      if (isCancelled()) return;
      // A book from the catalogue keeps the clear title it was given there.
      const current = await db.books.get(id);
      if (current?.catalogueId && !current.catalogueId.startsWith('constitution:') && update.title) {
        update = { ...update };
        delete update.title;
      }
      await db.books.update(id, update);
      Object.assign(book, update);
    },
    async progress(done, total, stage) {
      const now = Date.now();
      if (now - lastWrite < 350 && done < total) return;
      lastWrite = now;
      if (isCancelled()) return;
      const imp = { ...book.import, state: 'processing' as const, stage, done, total };
      book.import = imp;
      await db.books.update(id, { import: imp });
      const waiting = await db.books.filter((b) => b.import.state === 'queued').count();
      const where = total ? `${stage}: ${done} of ${total}` : stage;
      workProgress('import', `Preparing ${book.title}`, `${where}${waiting ? ` · ${waiting} more waiting` : ''}`, done, total);
    },
    cancelled: isCancelled,
  };

  try {
    const fileRec = await db.files.get(id);
    if (!fileRec) throw new Error('The file for this book is missing. Add it again.');
    ctx.file = fileRec.blob;
    await ctx.progress(book.import.done, book.import.total, 'Opening');

    if (book.format === 'pdf') {
      const { importPdf } = await import('./pdf');
      await importPdf(ctx);
    } else if (book.format === 'image') {
      await db.assets.put({ id: `${id}:page-1`, bookId: id, blob: fileRec.blob });
      await ctx.putSection(0, { title: 'Page 1', blocks: [{ t: 'img', text: 'Page 1', src: 'page-1', page: 1 }] });
      await ctx.setCover(fileRec.blob);
      await ctx.patch({ sectionCount: 1, sectionChars: [1500], pageCount: 1, kind: 'scan' });
    } else {
      const parsed = await parseWhole(book.format, fileRec.blob);
      if (isCancelled()) return;
      await saveParsed(ctx, parsed);
    }
    if (isCancelled()) return;

    const fresh = await db.books.get(id);
    if (!fresh) return;
    if (!fresh.sectionCount) throw new Error('No readable text was found in this file.');
    const lang = fresh.kind === 'scan' ? guessLangFromTitle(fresh.title) : await sampleLang(id, fresh.sectionCount, fresh.title);
    const vol = parseVolume(fresh.title);
    if (fresh.format === 'pdf' || fresh.format === 'image') {
      const { scheduleOcr } = await import('../ocr/queue');
      await scheduleOcr(id);
    }
    await db.books.update(id, {
      lang,
      series: vol?.series ?? fresh.series,
      volume: vol?.volume ?? fresh.volume,
      import: { state: 'ready', done: fresh.import.total, total: fresh.import.total, failedPages: fresh.import.failedPages },
    });
  } catch (e) {
    console.error('Import failed', e);
    if (!isCancelled()) {
      await db.books.update(id, { import: { ...book.import, state: 'failed', error: friendly(e) } });
    }
  } finally {
    cancelled.delete(id);
  }
}

async function parseWhole(format: BookFormat, file: Blob): Promise<ParsedBook> {
  switch (format) {
    case 'epub':
      return (await import('./epub')).parseEpub(file);
    case 'docx':
      return (await import('./docx')).parseDocx(file);
    case 'mobi':
      return (await import('./mobi')).parseMobi(file);
    case 'fb2':
      return (await import('./fb2')).parseFb2(file);
    case 'md': {
      const t = await import('./text');
      return t.parseMarkdown(await t.readText(file));
    }
    case 'html': {
      const [t, h, s] = await Promise.all([import('./text'), import('./html'), import('./sections')]);
      const doc = h.parseHtml(await t.readText(file));
      const { blocks } = h.htmlToBlocks(doc.body);
      const sections = t.sectionsFromBlocks(blocks);
      return { title: doc.title?.trim() || undefined, sections, toc: s.tocFromHeadings(sections) };
    }
    default: {
      const t = await import('./text');
      return t.parsePlainText(await t.readText(file));
    }
  }
}

async function saveParsed(ctx: ImportContext, parsed: ParsedBook): Promise<void> {
  const { sections, toc } = splitLargeSections(parsed.sections, parsed.toc);
  const id = ctx.book.id;
  if (parsed.assets?.size) {
    await db.assets.bulkPut([...parsed.assets].map(([name, blob]) => ({ id: `${id}:${name}`, bookId: id, blob })));
  }
  const chars: number[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s: DraftSection = sections[i];
    await ctx.putSection(i, s);
    chars.push(Math.max(1, sectionChars(s.blocks)));
    await ctx.progress(i + 1, sections.length, 'Saving chapters');
  }
  if (parsed.cover) await ctx.setCover(parsed.cover);
  const patch: Partial<Book> = { sectionCount: sections.length, sectionChars: chars, toc };
  if (parsed.title) patch.title = parsed.title;
  if (parsed.author) patch.author = parsed.author;
  if (parsed.edition) patch.edition = parsed.edition;
  await ctx.patch(patch);
}

function guessLangFromTitle(title: string): Lang {
  const l = detectLang(title);
  return l === 'en' || l === 'other' ? 'other' : l;
}

async function sampleLang(bookId: string, sectionCount: number, title: string): Promise<Lang> {
  let sample = '';
  const picks = [0, Math.floor(sectionCount / 2), sectionCount - 1];
  for (const idx of new Set(picks)) {
    const sec = await db.sections.get(sectionId(bookId, idx));
    for (const b of sec?.blocks ?? []) {
      sample += b.text + ' ';
      if (sample.length > 6000 * (idx + 1)) break;
    }
  }
  return detectLang(sample.trim() ? sample : title);
}
