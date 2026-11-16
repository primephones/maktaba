import type { Block, HighlightColor, Mark } from '../../db/types';
import { hasArabicScript, stripTashkilWithMap } from '../../lib/arabic';

export interface Segment {
  text: string;
  b?: boolean;
  i?: boolean;
  /** Highlight or note covering this run. */
  mark?: { id: string; color: HighlightColor; note: boolean };
  flash?: boolean;
  /** Footnote markers that sit immediately before this run. */
  notesBefore?: Array<{ id: string; label: string }>;
}

export interface Rendered {
  segments: Segment[];
  /** Footnote markers at the very end of the text. */
  tail: Array<{ id: string; label: string }>;
  /** Displayed-character index → stored-character index (only when vowel marks are hidden). */
  map?: number[];
}

/**
 * Cuts a block's text into runs that share the same styling, so bold, italics, highlights,
 * notes, search flashes and footnote markers can all overlap freely.
 */
export function renderBlock(block: Block, marks: Mark[], flash: [number, number] | undefined, showTashkil: boolean): Rendered {
  let text = block.text;
  let toDisp: ((n: number) => number) | null = null;
  let map: number[] | undefined;
  if (!showTashkil && hasArabicScript(text)) {
    const stripped = stripTashkilWithMap(text);
    map = stripped.map;
    // stored index → displayed index
    const inv = new Array<number>(text.length + 1);
    let d = 0;
    for (let o = 0; o <= text.length; o++) {
      while (d < map.length - 1 && map[d] < o) d++;
      inv[o] = d;
    }
    toDisp = (n) => inv[Math.max(0, Math.min(text.length, n))];
    text = stripped.text;
  }
  const conv = (n: number) => (toDisp ? toDisp(n) : Math.max(0, Math.min(text.length, n)));

  const cuts = new Set<number>([0, text.length]);
  const spans = (block.spans ?? []).map((s) => ({ s: conv(s.s), e: conv(s.e), k: s.k }));
  const hls = marks
    .filter((m) => m.type !== 'bookmark' && m.start !== undefined && m.end !== undefined)
    .map((m) => ({ s: conv(m.start!), e: conv(m.end!), id: m.id, color: m.color ?? 'gold', note: !!m.note }));
  const fl = flash ? { s: conv(flash[0]), e: conv(flash[1]) } : null;
  const notes = (block.notes ?? []).map((n) => ({ at: conv(n.at), id: n.id, label: n.label }));

  for (const s of spans) { cuts.add(s.s); cuts.add(s.e); }
  for (const h of hls) { cuts.add(h.s); cuts.add(h.e); }
  if (fl) { cuts.add(fl.s); cuts.add(fl.e); }
  for (const n of notes) cuts.add(n.at);

  const points = [...cuts].filter((c) => c >= 0 && c <= text.length).sort((a, b) => a - b);
  const segments: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const s = points[i];
    const e = points[i + 1];
    if (e <= s) continue;
    const seg: Segment = { text: text.slice(s, e) };
    for (const sp of spans) if (sp.s <= s && sp.e >= e) seg[sp.k] = true;
    // The newest mark wins where two overlap.
    const h = hls.filter((x) => x.s <= s && x.e >= e).pop();
    if (h) seg.mark = { id: h.id, color: h.color, note: h.note };
    if (fl && fl.s <= s && fl.e >= e) seg.flash = true;
    const before = notes.filter((n) => n.at === s);
    if (before.length) seg.notesBefore = before;
    segments.push(seg);
  }
  const tail = notes.filter((n) => n.at >= text.length && text.length > 0 ? true : text.length === 0);
  // Markers at offset 0 of non-empty text are already attached to the first run.
  return { segments, tail: text.length ? tail.filter((n) => n.at >= text.length) : notes, map };
}
