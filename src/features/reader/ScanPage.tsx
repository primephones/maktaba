import { useState } from 'react';
import { db, sectionId } from '../../db/db';
import type { Book } from '../../db/types';
import type { SourceParagraph } from '../../ai/translation';
import { translateAhead, useAhead } from '../../ai/ahead';
import { readPageNow } from '../../ocr/queue';
import { toast } from '../../ui/toast';

/**
 * Under a scanned page, when its English is not there yet: one tap has the reader's AI read
 * that page (if it has not been read) and translate it, ahead of the rest of the book.
 */
export function ScanPageAction({ book, section, page, read, some }: { book: Book; section: number; page: number; read: boolean; some: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = useAhead(book.id);

  const go = async () => {
    try {
      if (!read) {
        setBusy('Reading the page…');
        await readPageNow(book, page);
      }
      setBusy('Translating…');
      const sec = await db.sections.get(sectionId(book.id, section));
      if (!sec) return;
      const have = new Set((await db.translations.where('bookId').equals(book.id).primaryKeys()).map(String));
      const paras: SourceParagraph[] = [];
      sec.blocks.forEach((b, i) => {
        if (!b.ocr || b.page !== page || b.text.trim().length < 2 || have.has(`${book.id}:${section}:${i}`)) return;
        paras.push({ id: `${section}:${i}`, section, block: i, text: b.text, kind: b.t === 'h' ? 'h' : b.t === 'quote' ? 'quote' : 'p', chapter: sec.title });
      });
      if (!paras.length) {
        toast(read ? 'Nothing left to translate on this page.' : 'The AI found no text on this page.');
        return;
      }
      // In the background, so it carries on when the page is scrolled away.
      setBusy(null);
      await translateAhead(book, { paras });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="scan-action" data-skip>
      {busy || run ? (
        <span className="scan-busy" role="status">
          <span className="spinner" aria-hidden="true" />
          {busy ?? (run!.waiting ? `Your AI is busy. Trying again in ${run!.waiting} s…` : `Translating ${run!.done} of ${run!.total || '…'}…`)}
        </span>
      ) : (
        <button className="btn btn--quiet" onClick={() => void go()}>
          <span className="ai-mark" aria-hidden="true">✦</span>
          {!read ? 'Read and translate this page' : some ? 'Translate the rest of this page' : 'Translate this page'}
        </button>
      )}
    </div>
  );
}
