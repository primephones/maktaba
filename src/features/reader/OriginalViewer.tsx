import { useEffect, useState } from 'react';
import type { Book } from '../../db/types';
import { db } from '../../db/db';
import { openOriginal } from '../../lib/saveFile';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';
import { ZoomViewer, type PageMark } from './ZoomViewer';
import { findPage } from './Contents';

/**
 * The book as it was given: the PDF page itself, exactly as printed, for checking the text
 * against it. Opens on the page being read; swipe or use the arrows for the pages around
 * it, pinch to zoom, and go back to the text at the page being looked at.
 */
export function OriginalViewer({ book, page: start, mark, onGo, onClose }: { book: Book; page: number; mark?: PageMark; onGo: (section: number, block: number) => void; onClose: () => void }) {
  const [found, setFound] = useState<boolean | null>(null);
  const count = book.pageCount ?? start;
  const [page, setPage] = useState(Math.min(Math.max(1, start), count));
  const rtl = book.lang === 'ar' || book.lang === 'ur' || book.lang === 'fa';
  // Arabic books are bound on the right: the next page is to the left.
  const step = (dir: 1 | -1) => setPage((p) => Math.min(count, Math.max(1, p + dir)));
  const before = () => step(-1);
  const after = () => step(1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') (rtl ? after : before)();
      if (e.key === 'ArrowRight') (rtl ? before : after)();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const openFile = async () => {
    const rec = await db.files.get(book.id);
    if (!rec) {
      toast('The original file is not on this phone. Add it again to read it here.');
      return;
    }
    await openOriginal(rec.blob, book.fileName || `${book.title}.pdf`).catch((e) => toast(`Could not open it: ${(e as Error).message}`));
  };

  const stop = (e: React.PointerEvent) => e.stopPropagation();
  return (
    <ZoomViewer
      source={{ kind: 'pdf', bookId: book.id, page }}
      label={`Original, page ${page} of ${count}`}
      onClose={onClose}
      onSwipe={(dir) => (rtl ? step(dir === 1 ? -1 : 1) : step(dir))}
      mark={mark}
      onMarked={setFound}
    >
      <div className="orig-bar" onPointerDown={stop} onPointerUp={stop}>
        <button className="icon-btn" onClick={rtl ? after : before} disabled={rtl ? page >= count : page <= 1} aria-label={rtl ? 'Next page' : 'Previous page'}>
          <Icon name="back" />
        </button>
        <div className="orig-mid">
          <b>Original · page {page}<span> of {count}</span></b>
          {mark && page === mark.page && found !== null && (
            <span className="orig-note" role="status">{found ? 'Highlighted: where you are reading' : 'This paragraph could not be marked on the page'}</span>
          )}
          <span className="orig-acts">
            <button
              onClick={async () => {
                const at = await findPage(book, String(page));
                if (at) onGo(at.section, at.block);
                onClose();
              }}
            >
              Read from here
            </button>
            <button onClick={() => void openFile()}>Open the file</button>
          </span>
        </div>
        <button className="icon-btn orig-next" onClick={rtl ? before : after} disabled={rtl ? page <= 1 : page >= count} aria-label={rtl ? 'Previous page' : 'Next page'}>
          <Icon name="back" />
        </button>
      </div>
    </ZoomViewer>
  );
}
