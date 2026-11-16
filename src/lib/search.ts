import { db } from '../db/db';
import type { Book } from '../db/types';
import { findAll, normalizeForSearch } from './arabic';

export interface TextHit {
  bookId: string;
  section: number;
  block: number;
  start: number;
  end: number;
  /** A little text around the match. */
  before: string;
  match: string;
  after: string;
  sectionTitle: string;
  printed?: string;
}

const CONTEXT = 60;

function snippet(text: string, start: number, end: number) {
  const from = Math.max(0, start - CONTEXT);
  const to = Math.min(text.length, end + CONTEXT);
  return {
    before: (from > 0 ? '…' : '') + text.slice(from, start),
    match: text.slice(start, end),
    after: text.slice(end, to) + (to < text.length ? '…' : ''),
  };
}

/**
 * Searches the text of one book. Arabic matching ignores vowel marks and the usual
 * spelling variants. Calls back as hits are found so results appear while it runs.
 */
export async function searchBook(
  book: Pick<Book, 'id' | 'sectionCount'>,
  query: string,
  opts: { limit?: number; signal?: AbortSignal; onHits?: (hits: TextHit[]) => void } = {},
): Promise<TextHit[]> {
  const norm = normalizeForSearch(query.trim());
  const limit = opts.limit ?? 200;
  const hits: TextHit[] = [];
  if (norm.length < 2) return hits;
  const BATCH = 8;
  for (let from = 0; from < book.sectionCount && hits.length < limit; from += BATCH) {
    if (opts.signal?.aborted) return hits;
    const ids = Array.from({ length: Math.min(BATCH, book.sectionCount - from) }, (_, i) => `${book.id}:${from + i}`);
    const sections = await db.sections.bulkGet(ids);
    const found: TextHit[] = [];
    for (const sec of sections) {
      if (!sec) continue;
      for (let bi = 0; bi < sec.blocks.length && hits.length + found.length < limit; bi++) {
        const b = sec.blocks[bi];
        if (b.t === 'img' || !b.text) continue;
        for (const [start, end] of findAll(b.text, norm, 5)) {
          found.push({ bookId: book.id, section: sec.idx, block: bi, start, end, sectionTitle: sec.title, printed: b.printed ?? (b.page ? String(b.page) : undefined), ...snippet(b.text, start, end) });
          if (hits.length + found.length >= limit) break;
        }
      }
    }
    if (found.length) {
      hits.push(...found);
      opts.onHits?.(found);
    }
    // Let the screen breathe between batches.
    await new Promise((r) => setTimeout(r, 0));
  }
  return hits;
}
