export interface SelectionPart {
  section: number;
  block: number;
  /** Offsets into the text as displayed (vowel marks may be hidden). */
  start: number;
  end: number;
  text: string;
  /** The selection is in the English translation, not the original. */
  en?: boolean;
}

export interface ReaderSelection {
  parts: SelectionPart[];
  text: string;
}

const blockOf = (node: Node | null): HTMLElement | null => {
  const el = node && (node.nodeType === 1 ? (node as Element) : node.parentElement);
  return (el?.closest('[data-b]') as HTMLElement | null) ?? null;
};

/** Characters of book text between the start of a block and a point inside it. */
function offsetWithin(block: HTMLElement, node: Node, offset: number): number {
  const r = document.createRange();
  r.selectNodeContents(block);
  try {
    r.setEnd(node, offset);
  } catch {
    return 0;
  }
  return r.toString().length;
}

/** Reads the current text selection as ranges inside the reader's blocks. */
export function readSelection(root: HTMLElement): ReaderSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const text = sel.toString().trim();
  if (!text) return null;

  const startBlock = blockOf(range.startContainer);
  const endBlock = blockOf(range.endContainer);
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-b]')).filter((el) => range.intersectsNode(el));
  const parts: SelectionPart[] = [];
  for (const el of blocks) {
    const t = el.dataset.t;
    if (t === 'img' || t === 'hr') continue;
    const full = el.textContent?.length ?? 0;
    const start = el === startBlock ? offsetWithin(el, range.startContainer, range.startOffset) : 0;
    const end = el === endBlock ? offsetWithin(el, range.endContainer, range.endOffset) : full;
    if (end <= start) continue;
    parts.push({
      section: Number(el.dataset.s),
      block: Number(el.dataset.b),
      start,
      end,
      text: (el.textContent ?? '').slice(start, end),
      en: el.dataset.en !== undefined,
    });
  }
  return parts.length ? { parts: parts.slice(0, 40), text } : null;
}
