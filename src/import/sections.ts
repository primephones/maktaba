import type { Block, TocEntry } from '../db/types';
import type { DraftSection } from './types';

/** Largest section the reader lays out at once; bigger ones are split into parts. */
export const MAX_BLOCKS = 300;

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
    if (s.blocks.length <= MAX_BLOCKS) {
      parts.push({ idx: out.length, from: 0 });
      out.push(s);
    } else {
      let from = 0;
      let part = 1;
      while (from < s.blocks.length) {
        let to = Math.min(s.blocks.length, from + MAX_BLOCKS);
        // Prefer to break just before a heading near the limit.
        for (let i = to; i > from + MAX_BLOCKS * 0.6 && i < s.blocks.length; i--) {
          if (s.blocks[i].t === 'h') {
            to = i;
            break;
          }
        }
        const blocks = s.blocks.slice(from, to);
        parts.push({ idx: out.length, from });
        out.push({
          title: part === 1 ? s.title : `${s.title} · ${part}`,
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
