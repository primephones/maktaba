import type { ParsedBook } from './types';
import { htmlToBlocks, parseHtml } from './html';
import { sectionsFromBlocks } from './text';
import { tocFromHeadings } from './sections';

export async function parseDocx(file: Blob): Promise<ParsedBook> {
  const mammoth = await import('mammoth/mammoth.browser');
  const assets = new Map<string, Blob>();
  let n = 0;
  const result = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    {
      convertImage: mammoth.images.imgElement(async (image: { contentType: string; readAsArrayBuffer(): Promise<ArrayBuffer> }) => {
        const key = `image-${++n}`;
        assets.set(key, new Blob([await image.readAsArrayBuffer()], { type: image.contentType }));
        return { src: `asset:${key}` };
      }),
    },
  );
  const doc = parseHtml(`<body>${result.value}</body>`);
  const noteText = new Map<string, string>();
  // mammoth renders footnotes as a trailing list whose items carry the target ids.
  for (const li of Array.from(doc.querySelectorAll('li[id^="footnote-"], li[id^="endnote-"]'))) {
    const clone = li.cloneNode(true) as Element;
    clone.querySelectorAll('a[href^="#footnote-ref"], a[href^="#endnote-ref"]').forEach((a) => a.remove());
    noteText.set(li.id, (clone.textContent || '').replace(/\s+/g, ' ').trim());
    li.remove();
  }
  const { blocks, notes } = htmlToBlocks(doc.body, {
    resolveImage: (src) => (src.startsWith('asset:') ? src.slice(6) : null),
    resolveNote: (href) => noteText.get(href.replace(/^#/, '')) ?? null,
  });
  const sections = sectionsFromBlocks(blocks);
  // Footnote keys are unique across the document, so every section can share the table.
  if (Object.keys(notes).length) for (const s of sections) s.notes = notes;
  return { sections, toc: tocFromHeadings(sections), assets };
}
