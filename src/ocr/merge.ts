import { db, sectionId } from '../db/db';
import type { Block } from '../db/types';
import { sectionChars } from '../import/sections';

/** A key for a block that survives the text of other pages changing around it. */
export function keysFor(blocks: Block[]): string[] {
  const perPage = new Map<number, number>();
  let plain = 0;
  return blocks.map((b) => {
    const page = b.src?.match(/^page:(\d+)$/)?.[1] ?? (b.src === 'page-1' ? '1' : undefined);
    if (b.t === 'img' && page) return `img:${page}`;
    if (b.ocr) {
      const p = b.page ?? 0;
      const k = perPage.get(p) ?? 0;
      perPage.set(p, k + 1);
      return `ocr:${p}:${k}`;
    }
    return `b:${plain++}`;
  });
}

/**
 * Puts the recognised text of each page straight after that page's image, then moves any
 * bookmarks, highlights, references and the reading position in the section along with
 * the paragraphs they belong to.
 */
export async function applyOcrToSection(bookId: string, idx: number): Promise<void> {
  await db.transaction('rw', [db.sections, db.ocrPages, db.marks, db.refs, db.books, db.translations], async () => {
    const sec = await db.sections.get(sectionId(bookId, idx));
    if (!sec) return;
    const before = sec.blocks;
    const base = before.filter((b) => !b.ocr);
    const pageOf = (b: Block) => {
      const m = b.src?.match(/^page:(\d+)$/);
      return m ? Number(m[1]) : b.src === 'page-1' ? 1 : null;
    };
    const pages = base.map(pageOf).filter((p): p is number => p !== null);
    const rows = await db.ocrPages.bulkGet(pages.map((p) => `${bookId}:${p}`));
    const byPage = new Map(rows.filter((r): r is NonNullable<typeof r> => !!r).map((r) => [r.page, r]));

    const after: Block[] = [];
    for (const b of base) {
      const p = pageOf(b);
      const row = p !== null ? byPage.get(p) : undefined;
      if (row && b.t === 'img') {
        after.push(row.printed && !b.printed ? { ...b, printed: row.printed } : b);
        for (const ob of row.blocks) after.push({ ...ob, ocr: true, page: p!, printed: ob.printed ?? row.printed ?? b.printed });
      } else after.push(b);
    }

    // Old block index → new block index, matched by key.
    const oldKeys = keysFor(before);
    const newIndex = new Map(keysFor(after).map((k, i) => [k, i]));
    const remap = (i: number): number => {
      const key = oldKeys[i];
      if (key && newIndex.has(key)) return newIndex.get(key)!;
      // The paragraph is gone (the page was corrected): fall back to its page image.
      const page = key?.split(':')[1];
      return newIndex.get(`img:${page}`) ?? Math.min(i, after.length - 1);
    };

    await db.sections.put({ ...sec, blocks: after, chars: sectionChars(after) });
    await db.marks.where('[bookId+section]').equals([bookId, idx]).modify((m) => {
      const n = remap(m.block);
      if (n !== m.block) {
        // A highlight whose paragraph changed can no longer point at exact characters.
        if (m.type !== 'bookmark' && oldKeys[m.block] !== keysFor(after)[n]) {
          m.start = undefined;
          m.end = undefined;
        }
        m.block = n;
      }
    });
    await db.refs.where('bookId').equals(bookId).filter((r) => r.section === idx).modify((r) => {
      r.block = remap(r.block);
    });
    // English follows its paragraph; English of a paragraph that is gone goes with it.
    const newKeys = keysFor(after);
    const trs = await db.translations.where('bookId').equals(bookId).filter((t) => t.section === idx).toArray();
    const gone: string[] = [];
    const moved: typeof trs = [];
    for (const t of trs) {
      const key = oldKeys[t.block];
      const n = key ? newIndex.get(key) : undefined;
      if (n === undefined) {
        // Not a known paragraph before (written straight after reading the page): keep it if it still fits.
        if (!key && t.block < after.length && newKeys[t.block]) continue;
        gone.push(t.id);
      } else if (n !== t.block) {
        gone.push(t.id);
        moved.push({ ...t, block: n, id: `${bookId}:${idx}:${n}` });
      }
    }
    if (gone.length) await db.translations.bulkDelete(gone);
    if (moved.length) await db.translations.bulkPut(moved);
    const book = await db.books.get(bookId);
    if (book?.progress?.section === idx) {
      await db.books.update(bookId, { progress: { ...book.progress, block: remap(book.progress.block) } });
    }
  });
}

/** Which section of a book holds a given page image. */
export async function sectionOfPage(bookId: string, page: number): Promise<number | null> {
  const sections = await db.sections.where('bookId').equals(bookId).toArray();
  for (const s of sections) {
    if (s.blocks.some((b) => b.src === `page:${page}` || (page === 1 && b.src === 'page-1'))) return s.idx;
  }
  return null;
}
