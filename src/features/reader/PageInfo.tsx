import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { Book, OcrPage } from '../../db/types';
import { navigate } from '../../app/router';
import { CHECK_BELOW, rereadPage } from '../../ocr/queue';
import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/Sheet';
import { toast } from '../../ui/toast';

export type PageSource = Pick<OcrPage, 'by' | 'conf' | 'edited' | 'updatedAt'>;

const NONE = new Map<number, PageSource>();

/** Where the text of each page of a scanned book came from (pages not read yet are absent). */
export function usePageSources(book: Book): Map<number, PageSource> {
  return (
    useLiveQuery(
      async () => (book.ocr ? new Map((await db.ocrPages.where('bookId').equals(book.id).toArray()).map((r) => [r.page, { by: r.by, conf: r.conf, edited: r.edited, updatedAt: r.updatedAt }] as const)) : NONE),
      [book.id, !!book.ocr, book.ocr?.done],
    ) ?? NONE
  );
}

/** One short line on where a page's words came from, and whether they need checking. */
export function sourceText(book: Book, src: PageSource | undefined): { text: string; unsure: boolean } | null {
  if (!book.ocr) return book.format === 'pdf' ? { text: 'Text from the PDF itself', unsure: false } : null;
  if (!src) return null;
  if (src.edited) return { text: 'Corrected by you', unsure: false };
  if (src.by === 'ai') return { text: 'Read from the scan by your AI', unsure: false };
  const unsure = src.conf < CHECK_BELOW;
  return { text: unsure ? `Read by the phone · unsure (${src.conf}%), check it` : 'Read by the phone’s text recognition', unsure };
}

/** The line under a printed page: where its words came from. Tapping it opens what can be done. */
export function PageSourceLine({ book, page, src, onOpen }: { book: Book; page: number; src: PageSource | undefined; onOpen: (page: number) => void }) {
  const s = sourceText(book, src);
  if (!s) return null;
  return (
    <button className="page-src" data-unsure={s.unsure || undefined} data-skip onClick={() => onOpen(page)} aria-label={`Page ${page}: ${s.text}. Check this page`}>
      <Icon name={s.unsure ? 'warn' : book.ocr ? 'scan' : 'original'} size={15} />
      <span>{s.text}</span>
      <span className="page-src-go">Check</span>
    </button>
  );
}

/**
 * Everything about one printed page: where its words came from, the page itself, and ways
 * to put it right (read it again, or correct it by hand beside the page).
 */
export function PageInfo({ book, page, printed, onSeePage, onClose }: { book: Book; page: number; printed?: string; onSeePage: (page: number) => void; onClose: () => void }) {
  const row = useLiveQuery(() => db.ocrPages.get(`${book.id}:${page}`), [book.id, page]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const src = row ? { by: row.by, conf: row.conf, edited: row.edited, updatedAt: row.updatedAt } : undefined;
  const s = sourceText(book, src);
  const name = printed && printed !== String(page) ? `Page ${printed} (file page ${page})` : `Page ${page}`;

  const reread = async (replaceCorrection = false) => {
    setBusy('Reading the page again…');
    try {
      await rereadPage(book, page, { replaceCorrection });
      toast(`${name} was read again.`);
      onClose();
    } catch (e) {
      const msg = (e as Error).message;
      if (/corrected this page/.test(msg)) setConfirmReplace(true);
      else toast(msg);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet title={name} onClose={onClose}>
      <div className="page-info">
        <p className="page-info-src" data-unsure={s?.unsure || undefined}>
          <Icon name={s?.unsure ? 'warn' : 'info'} size={18} />
          <span>
            {s ? s.text : 'This page has not been read yet.'}
            {row && <span className="muted small"> · {new Date(row.updatedAt).toLocaleDateString()}</span>}
          </span>
        </p>
        <p className="muted small">
          {book.ocr
            ? 'The words you read here were read from a picture of the page. If anything looks wrong, compare them with the page itself.'
            : 'The words you read here come from the text stored inside the PDF. Some PDFs store Arabic and Urdu text badly; the page itself is always exact.'}
        </p>
      </div>
      <div className="list">
        <button className="row" onClick={() => { onClose(); onSeePage(page); }}>
          <Icon name="original" />
          <span className="grow"><span className="title">See the printed page</span><div className="sub">Exactly as it is in the PDF, with zoom</div></span>
          <Icon name="forward" size={18} />
        </button>
        {book.ocr && row && (
          <button className="row" onClick={() => navigate(`/book/${book.id}/review/${page}`)}>
            <Icon name="edit" />
            <span className="grow"><span className="title">Compare and correct the text</span><div className="sub">The page and the words read from it, side by side</div></span>
            <Icon name="forward" size={18} />
          </button>
        )}
        {book.ocr && (
          <button className="row" disabled={!!busy} onClick={() => void reread()}>
            <span className="ai-mark" aria-hidden="true" style={{ fontSize: 20, width: 24, textAlign: 'center' }}>✦</span>
            <span className="grow"><span className="title">{row ? 'Read this page again with your AI' : 'Read this page with your AI'}</span><div className="sub">{busy ?? 'Its text and English are made again from the picture'}</div></span>
          </button>
        )}
      </div>
      {confirmReplace && (
        <div className="confirm" role="alertdialog" aria-label="Replace your correction?">
          <p>You corrected this page by hand. Reading it again replaces your correction with what the AI reads.</p>
          <div className="confirm-acts">
            <button className="btn" onClick={() => setConfirmReplace(false)}>Keep my correction</button>
            <button className="btn btn--primary" onClick={() => { setConfirmReplace(false); void reread(true); }}>Read it again</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
