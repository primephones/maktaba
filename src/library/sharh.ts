import { db } from '../db/db';
import type { Book } from '../db/types';
import { normalizeForSearch } from '../lib/arabic';

/**
 * From a paragraph of a matn to the place in its sharḥ that comments on it. A sharḥ
 * quotes the matn as it goes ("قوله: …", or the matn's words in brackets or in red), so
 * the place is found by the runs of words the two share, ignoring vowel marks and the
 * different spellings of the same letters. The longest shared run wins; the first place
 * the sharḥ quotes it breaks ties (where the comment begins).
 */

const words = (s: string) =>
  normalizeForSearch(s)
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

const N = 3;
function grams(ws: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + N <= ws.length; i++) out.add(ws.slice(i, i + N).join(' '));
  return out;
}

export interface SharhPlace {
  section: number;
  block: number;
  /** How many runs of words the two share (more is surer). */
  score: number;
}

/** Where in the sharḥ the given matn text is commented on, or null if it is not found. */
export async function findInSharh(matnText: string, sharhId: string): Promise<SharhPlace | null> {
  const want = grams(words(matnText));
  if (!want.size) return null;
  const sections = await db.sections.where('bookId').equals(sharhId).sortBy('idx');
  let best: SharhPlace | null = null;
  for (const sec of sections) {
    sec.blocks.forEach((b, i) => {
      if (!b.text || b.t === 'img') return;
      const ws = words(b.text);
      let score = 0;
      for (let k = 0; k + N <= ws.length; k++) if (want.has(ws.slice(k, k + N).join(' '))) score++;
      if (score && (!best || score > best.score)) best = { section: sec.idx, block: i, score };
    });
  }
  // One shared run of three words can be chance; two is a quotation.
  const found = best as SharhPlace | null;
  return found && found.score >= Math.min(2, want.size) ? found : null;
}

/** Books in the library likely to be commentaries on this one, most likely first. */
export async function likelyCommentaries(book: Book): Promise<Book[]> {
  const all = (await db.books.toArray()).filter((b) => b.id !== book.id && b.import.state === 'ready');
  const title = words(book.title).filter((w) => w.length > 2);
  const score = (b: Book) => {
    const t = normalizeForSearch(b.title);
    let n = 0;
    if (/شرح|حاشيه|حاشية|تعليق|فتح|عمده|عمدة|ارشاد|إرشاد|بذل|تحفه|تحفة|عون|commentary|sharh/i.test(t)) n += 2;
    n += title.filter((w) => t.includes(w)).length * 3;
    return n;
  };
  return all.map((b) => [b, score(b)] as const).sort((a, b) => b[1] - a[1]).map(([b]) => b);
}
