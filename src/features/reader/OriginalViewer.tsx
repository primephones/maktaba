import { useEffect, useState } from 'react';
import type { Book } from '../../db/types';
import { db } from '../../db/db';
import { isRtl } from '../../lib/arabic';
import { openOriginal } from '../../lib/saveFile';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';
import { ZoomViewer, type PageMark } from './ZoomViewer';
import { PdfPage } from './PdfPage';
import { fetchOriginal, originalOnPhone } from '../../cloud/original';
import { setSetting, useSetting } from '../../app/settings';
import { useThemeTone } from '../../app/useThemeTone';
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
  const [thumbs, setThumbs] = useState(false);
  const [asking, setAsking] = useState(false);
  const [onPhone, setOnPhone] = useState<boolean | null>(null);
  const [fetching, setFetching] = useState(false);
  const [drawKey, setDrawKey] = useState(0);
  const prefs = useSetting('reader');
  const dark = useThemeTone() === 'dark';
  const rtl = isRtl(book.lang);
  // Arabic books are bound on the right: the next page is to the left.
  const step = (dir: 1 | -1) => setPage((p) => Math.min(count, Math.max(1, p + dir)));
  const before = () => step(-1);
  const after = () => step(1);

  useEffect(() => {
    void originalOnPhone(book.id).then(setOnPhone);
  }, [book.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (thumbs || asking) return;
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

  const bringBack = async () => {
    setFetching(true);
    try {
      if (await fetchOriginal(book)) {
        setOnPhone(true);
        setDrawKey((k) => k + 1);
      } else toast('There is no copy of this book in your Google Drive. Add the PDF again to see its pages.');
    } catch (e) {
      toast(`Could not download it: ${(e as Error).message}`);
    } finally {
      setFetching(false);
    }
  };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const darkPage = dark && prefs.darkPages;
  return (
    <ZoomViewer
      redraw={drawKey}
      source={{ kind: 'pdf', bookId: book.id, page }}
      label={`Original, page ${page} of ${count}`}
      onClose={onClose}
      onSwipe={(dir) => (rtl ? step(dir === 1 ? -1 : 1) : step(dir))}
      mark={mark}
      onMarked={setFound}
      darkPage={darkPage}
    >
      {onPhone === false && (
        <div className="orig-missing" onPointerDown={stop} onPointerUp={stop}>
          <b>The PDF is not on this phone</b>
          <p>Its pages can be shown again once the file is back.</p>
          <button className="btn btn--primary" disabled={fetching} onClick={() => void bringBack()}>{fetching ? 'Downloading…' : 'Download it from your Google Drive'}</button>
        </div>
      )}
      <div className="orig-bar" onPointerDown={stop} onPointerUp={stop}>
        <button className="icon-btn" onClick={rtl ? after : before} disabled={rtl ? page >= count : page <= 1} aria-label={rtl ? 'Next page' : 'Previous page'}>
          <Icon name="back" />
        </button>
        <div className="orig-mid">
          {asking ? (
            <form
              className="orig-goto"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Number(new FormData(e.currentTarget).get('n'));
                if (n >= 1 && n <= count) setPage(n);
                setAsking(false);
              }}
            >
              <label>
                Go to page
                <input name="n" type="number" inputMode="numeric" min={1} max={count} defaultValue={page} autoFocus onBlur={() => setAsking(false)} />
              </label>
            </form>
          ) : (
            <button className="orig-where" onClick={() => setAsking(true)} aria-label={`Page ${page} of ${count}. Go to another page`}>
              <b>Page {page}<span> of {count}</span></b>
            </button>
          )}
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
            <button onClick={() => setThumbs(true)}><Icon name="grid" size={16} />All pages</button>
            {dark && (
              <button aria-pressed={prefs.darkPages} onClick={() => void setSetting('reader', { ...prefs, darkPages: !prefs.darkPages })}>
                <Icon name="contrast" size={16} />{prefs.darkPages ? 'Dark page: on' : 'Dark page'}
              </button>
            )}
            <button onClick={() => void openFile()}>Open the file</button>
          </span>
        </div>
        <button className="icon-btn orig-next" onClick={rtl ? before : after} disabled={rtl ? page <= 1 : page >= count} aria-label={rtl ? 'Previous page' : 'Next page'}>
          <Icon name="back" />
        </button>
      </div>
      {thumbs && (
        <div className="thumbs" role="dialog" aria-label="All pages" onPointerDown={stop} onPointerMove={stop} onPointerUp={stop} onWheel={stop}>
          <div className="thumbs-head">
            <b>{count} pages</b>
            <button className="icon-btn" onClick={() => setThumbs(false)} aria-label="Close all pages"><Icon name="close" /></button>
          </div>
          <div className="thumbs-grid" dir={rtl ? 'rtl' : 'ltr'} data-dark-page={darkPage || undefined}>
            {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
              <div className="thumb" key={n} data-current={n === page || undefined}>
                <PdfPage bookId={book.id} page={n} onZoom={() => { setPage(n); setThumbs(false); }} />
                <span>{n}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </ZoomViewer>
  );
}
