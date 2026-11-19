import type { Block, TocEntry } from '../db/types';
import type { DraftSection } from './types';

/** Largest section the reader lays out at once; bigger ones are split into parts. */
export const MAX_BLOCKS = 300;
/** Nor more text than this in one part (some classical paragraphs run to pages). */
export const MAX_CHARS = 120_000;

/**
 * Splits oversized sections so the reader never has to lay out a whole book at once,
 * and re-points the table of contents at the new positions.
 */
export function splitLargeSections(
  sections: DraftSection[],
  toc: TocEntry[],
): { sections: DraftSection[]; toc: TocEntry[] } {
  const out: DraftSection[] = [];
  // For each old section: the new index of each of its parts and where the part starts.
  const remap: Array<Array<{ idx: number; from: number }>> = [];

  for (const s of sections) {
    const parts: Array<{ idx: number; from: number }> = [];
    const size = s.blocks.reduce((n, b) => n + b.text.length, 0);
    if (s.blocks.length <= MAX_BLOCKS && size <= MAX_CHARS) {
      parts.push({ idx: out.length, from: 0 });
      out.push(s);
    } else {
      let from = 0;
      let part = 1;
      while (from < s.blocks.length) {
        // Up to the block limit, or the size limit, whichever comes first.
        let to = from;
        let chars = 0;
        while (to < s.blocks.length && to - from < MAX_BLOCKS && (to === from || chars + s.blocks[to].text.length <= MAX_CHARS)) {
          chars += s.blocks[to].text.length;
          to++;
        }
        // Prefer to break just before a heading near the limit.
        for (let i = to; i > from + (to - from) * 0.6 && i < s.blocks.length; i--) {
          if (s.blocks[i].t === 'h') {
            to = i;
            break;
          }
        }
        const blocks = s.blocks.slice(from, to);
        parts.push({ idx: out.length, from });
        // A part is named by where it begins in the printed book, when that is known.
        const printed = blocks.find((b) => b.printed)?.printed;
        const where = printed ? (printed.includes('/') ? `Vol. ${printed.split('/')[0]}, p. ${printed.split('/')[1]}` : `p. ${printed}`) : `${part}`;
        const base = s.title && s.title !== 'Text' ? s.title : '';
        out.push({
          title: part === 1 && base ? base : base ? `${base} · ${where}` : printed ? where : `Part ${part}`,
          blocks,
          notes: pickNotes(blocks, s.notes),
        });
        from = to;
        part++;
      }
    }
    remap.push(parts);
  }

  const newToc = toc.map((t) => {
    const parts = remap[t.section];
    if (!parts) return t;
    const block = t.block ?? 0;
    let target = parts[0];
    for (const p of parts) if (p.from <= block) target = p;
    return { ...t, section: target.idx, block: block - target.from };
  });
  // A book with no headings at all still gets contents: where each part begins.
  if (!newToc.length && out.length > 1) return { sections: out, toc: out.map((s, i) => ({ title: s.title, section: i, block: 0, level: 1 })) };
  return { sections: out, toc: newToc };
}

function pickNotes(blocks: Block[], notes?: Record<string, string>) {
  if (!notes) return undefined;
  const out: Record<string, string> = {};
  for (const b of blocks) for (const n of b.notes ?? []) if (notes[n.id]) out[n.id] = notes[n.id];
  return Object.keys(out).length ? out : undefined;
}

export const sectionChars = (blocks: Block[]) => blocks.reduce((n, b) => n + b.text.length + 1, 0);

/** Builds a table of contents from the headings found in the text itself. */
export function tocFromHeadings(sections: DraftSection[], maxLevel = 3): TocEntry[] {
  const toc: TocEntry[] = [];
  sections.forEach((s, si) => {
    s.blocks.forEach((b, bi) => {
      if (b.t === 'h' && (b.level ?? 1) <= maxLevel && b.text.length <= 140) {
        toc.push({ title: b.text, section: si, block: bi, level: b.level ?? 1 });
      }
    });
  });
  return toc;
}
