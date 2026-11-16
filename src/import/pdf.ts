import type { Block, TocEntry } from '../db/types';
import type { ImportContext } from './types';
import { dropRunningHeaders, isDamaged, itemsToLines, linesToBlocks, mergeAcrossPages, textDamage, type PageText, type TextItem } from './pdfText';
import { loadPdf } from '../lib/pdfjs';

/** Pages per stored section. Small enough to resume cheaply and lay out quickly. */
export const PAGES_PER_SECTION = 10;
/** A page with fewer characters than this is treated as an image of a page. */
const MIN_TEXT_CHARS = 25;

type Pdf = Awaited<ReturnType<typeof loadPdf>>;

async function pageText(pdf: Pdf, n: number): Promise<PageText & { damaged: boolean }> {
  const page = await pdf.getPage(n);
  try {
    const content = await page.getTextContent();
    const items = (content.items as unknown[]).filter((i): i is TextItem => typeof (i as TextItem).str === 'string');
    return { ...linesToBlocks(itemsToLines(items), n), damaged: isDamaged(textDamage(items)) };
  } finally {
    page.cleanup();
  }
}

/** Looks at pages spread through the file to tell a text PDF from a scan. */
async function looksScanned(pdf: Pdf): Promise<boolean> {
  const total = pdf.numPages;
  const count = Math.min(total, 10);
  const picks = new Set<number>();
  for (let i = 0; i < count; i++) picks.add(Math.min(total, 1 + Math.floor(((i + 0.5) / count) * total)));
  let withText = 0;
  for (const n of picks) if ((await pageText(pdf, n)).chars >= MIN_TEXT_CHARS) withText++;
  return withText < picks.size * 0.3;
}

async function renderCover(pdf: Pdf): Promise<Blob | null> {
  const page = await pdf.getPage(1);
  try {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 480 / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return await new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', 0.82));
  } catch {
    return null;
  } finally {
    page.cleanup();
  }
}

interface OutlineNode { title: string; dest: unknown; items?: OutlineNode[] }

async function readOutline(pdf: Pdf): Promise<Array<{ title: string; page: number; level: number }>> {
  const out: Array<{ title: string; page: number; level: number }> = [];
  let outline: OutlineNode[] | null = null;
  try {
    outline = (await pdf.getOutline()) as OutlineNode[] | null;
  } catch {
    return out;
  }
  const walk = async (nodes: OutlineNode[], level: number) => {
    for (const node of nodes) {
      try {
        const dest = typeof node.dest === 'string' ? await pdf.getDestination(node.dest) : (node.dest as unknown[] | null);
        if (dest && dest[0]) {
          const idx = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0] as never);
          const title = (node.title || '').replace(/\s+/g, ' ').trim();
          if (title) out.push({ title, page: idx + 1, level });
        }
      } catch {
        /* an entry pointing nowhere is skipped */
      }
      if (node.items?.length && level < 4) await walk(node.items, level + 1);
    }
  };
  if (outline) await walk(outline, 1);
  return out;
}

/**
 * Imports a PDF ten pages at a time, saving as it goes, so a long book survives being
 * interrupted and picks up where it stopped. Pages with no text layer are kept as page
 * images, which is also how a fully scanned book is stored until its text is recognised.
 */
export async function importPdf(ctx: ImportContext): Promise<void> {
  const pdf = await loadPdf(ctx.file);
  try {
    const total = pdf.numPages;
    const fresh = ctx.resumeSections === 0;
    let kind = ctx.book.kind;
    let labels: string[] | null = null;
    try {
      labels = await pdf.getPageLabels();
    } catch {
      labels = null;
    }

    if (fresh) {
      await ctx.progress(0, total, 'Checking pages');
      kind = (await looksScanned(pdf)) ? 'scan' : 'text';
      const meta = await pdf.getMetadata().catch(() => null);
      const info = (meta?.info ?? {}) as { Title?: string; Author?: string };
      const patch: Parameters<ImportContext['patch']>[0] = { kind, pageCount: total };
      const title = info.Title?.trim();
      // Many PDFs carry junk titles ("Microsoft Word - doc1", "untitled"); ignore those.
      if (title && title.length > 2 && !/^(untitled|microsoft word|document\d*|scan|\d+)\b/i.test(title) && !/\.(pdf|docx?|indd)$/i.test(title)) patch.title = title;
      if (info.Author?.trim()) patch.author = info.Author.trim();
      await ctx.patch(patch);
      const cover = await renderCover(pdf);
      if (cover) await ctx.setCover(cover);
    }

    const outline = await readOutline(pdf);
    const sectionCount = Math.ceil(total / PAGES_PER_SECTION);
    const sectionChars: number[] = fresh ? [] : [...ctx.book.sectionChars];
    const toc: TocEntry[] = fresh ? [] : [...ctx.book.toc];
    const failed: number[] = [...(ctx.book.import.failedPages ?? [])];
    let imagePages = ctx.book.imagePages ?? 0;

    for (let s = ctx.resumeSections; s < sectionCount; s++) {
      if (ctx.cancelled()) return;
      const from = s * PAGES_PER_SECTION + 1;
      const to = Math.min(total, from + PAGES_PER_SECTION - 1);
      const pages: PageText[] = [];
      const imageOnly = new Set<number>();
      for (let n = from; n <= to; n++) {
        let pt: PageText = { blocks: [], openEnded: false, chars: 0 };
        let damaged = false;
        if (kind === 'text') {
          try {
            const read = await pageText(pdf, n);
            damaged = read.damaged;
            pt = read;
          } catch {
            failed.push(n);
          }
        }
        // No text, or text with letters missing: show the page itself rather than misquote it.
        if (pt.chars < MIN_TEXT_CHARS || damaged) {
          imageOnly.add(n);
          imagePages++;
          const b: Block = { t: 'img', text: `Page ${n}`, src: `page:${n}`, page: n };
          pt = { blocks: [b], printed: pt.printed, openEnded: false, chars: 0 };
        }
        const label = labels?.[n - 1];
        if (label && label !== String(n)) for (const b of pt.blocks) b.printed = label;
        pages.push(pt);
        await ctx.progress(n, total, kind === 'scan' ? 'Preparing scanned pages' : 'Reading pages');
      }
      if (kind === 'text') dropRunningHeaders(pages.filter((_, i) => !imageOnly.has(from + i)));
      const blocks = mergeAcrossPages(pages);

      // Contents entries land on the first block that came from their page.
      const here = outline.filter((o) => o.page >= from && o.page <= to);
      for (const o of here) {
        const at = blocks.findIndex((b) => (b.page ?? 0) >= o.page);
        toc.push({ title: o.title, section: s, block: Math.max(0, at), level: o.level });
      }
      const lastBefore = [...outline].reverse().find((o) => o.page <= from);
      const range = from === to ? `Page ${from}` : `Pages ${from}–${to}`;
      const title = lastBefore ? `${lastBefore.title} · ${range}` : range;

      await ctx.putSection(s, { title, blocks });
      sectionChars[s] = Math.max(1, blocks.reduce((n, b) => n + (b.t === 'img' ? 1500 : b.text.length + 1), 0));
      await ctx.patch({
        sectionCount: s + 1,
        sectionChars: [...sectionChars],
        toc: [...toc],
        imagePages,
        import: { state: 'processing', stage: 'Reading pages', done: to, total, failedPages: failed.length ? failed : undefined },
      });
    }

    // A "text" PDF whose pages nearly all fell back to images is, in practice, a scan.
    if (kind === 'text' && imagePages > total * 0.7) await ctx.patch({ kind: 'scan' });
    else if (!outline.length && kind === 'text') {
      // No bookmarks in the file: fall back to the headings found in the text.
      await ctx.patch({ toc: await headingToc(ctx, sectionCount) });
    }
  } finally {
    await pdf.loadingTask.destroy();
  }
}

async function headingToc(ctx: ImportContext, sectionCount: number): Promise<TocEntry[]> {
  const { db, sectionId } = await import('../db/db');
  const toc: TocEntry[] = [];
  for (let s = 0; s < sectionCount; s++) {
    const sec = await db.sections.get(sectionId(ctx.book.id, s));
    sec?.blocks.forEach((b, i) => {
      if (b.t === 'h' && b.text.length <= 120) toc.push({ title: b.text, section: s, block: i, level: b.level === 2 ? 1 : 2 });
    });
  }
  // A "contents" made of hundreds of stray large-type lines is worse than none.
  return toc.length > sectionCount * 6 ? toc.filter((t) => t.level === 1) : toc;
}
