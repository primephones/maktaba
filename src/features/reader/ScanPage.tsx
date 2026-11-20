import type { Book } from '../../db/types';
import { translateAhead, useAhead } from '../../ai/ahead';

/**
 * Under a scanned page, when its English is not there yet: one tap has the reader's AI read
 * that page (if it has not been read) and translate it, ahead of the rest of the book. It runs
 * in the background, so it carries on when the page is scrolled away.
 */
export function ScanPageAction({ book, page, read, some }: { book: Book; page: number; read: boolean; some: boolean }) {
  const run = useAhead(book.id);
  const inRun = run?.unit === 'pages' && (run.page === page || !!run.pages?.includes(page));
  const now = inRun && run?.page === page;

  return (
    <div className="scan-action" data-skip>
      {inRun ? (
        <span className="scan-busy" role="status">
          <span className="spinner" aria-hidden="true" />
          {!now
            ? 'Waiting its turn…'
            : run!.waiting
              ? `Your AI is busy (the free models are overloaded). Trying again in ${run!.waiting} s…`
              : read
                ? 'Translating this page…'
                : 'Reading and translating this page…'}
        </span>
      ) : (
        <button className="btn btn--quiet" onClick={() => void translateAhead(book, { pages: [page] })}>
          <span className="ai-mark" aria-hidden="true">✦</span>
          {!read ? 'Read and translate this page' : some ? 'Translate the rest of this page' : 'Translate this page'}
        </button>
      )}
    </div>
  );
}
