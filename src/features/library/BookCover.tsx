import { useEffect, useState } from 'react';
import { db } from '../../db/db';
import type { Book, CoverStyle } from '../../db/types';
import { isRtl, detectLang } from '../../lib/arabic';
import { hashString, percent } from '../../lib/util';
import { useSetting } from '../../app/settings';

const LEATHERS = ['oxblood', 'slate', 'brown', 'ink', 'burgundy', 'tan'] as const;

/** Object URLs for cover images, shared between every place a cover appears. */
const urls = new Map<string, { url: string; users: number }>();

export function useCoverUrl(book: Pick<Book, 'id' | 'hasCover'>): string | null {
  const [url, setUrl] = useState<string | null>(() => urls.get(book.id)?.url ?? null);
  useEffect(() => {
    if (!book.hasCover) {
      setUrl(null);
      return;
    }
    let alive = true;
    let held = false;
    void (async () => {
      let entry = urls.get(book.id);
      if (!entry) {
        const rec = await db.covers.get(book.id);
        if (!rec || !alive) return;
        entry = urls.get(book.id) ?? { url: URL.createObjectURL(rec.blob), users: 0 };
        urls.set(book.id, entry);
      }
      if (!alive) return;
      entry.users++;
      held = true;
      setUrl(entry.url);
    })();
    return () => {
      alive = false;
      const entry = urls.get(book.id);
      if (held && entry && --entry.users <= 0) {
        // Keep it briefly: lists re-mount covers constantly while scrolling and filtering.
        window.setTimeout(() => {
          if (entry.users <= 0 && urls.get(book.id) === entry) {
            URL.revokeObjectURL(entry.url);
            urls.delete(book.id);
          }
        }, 30_000);
      }
    };
  }, [book.id, book.hasCover]);
  return url;
}

interface Props {
  book: Book;
  /** Force a style (used by the style chooser); otherwise the book's own or the default. */
  style?: CoverStyle;
  showState?: boolean;
}

/** A cover drawn as a bound book: spine, page edges, and one of three faces. */
export function BookCover({ book, style, showState = true }: Props) {
  const defaultStyle = useSetting('coverStyle');
  const url = useCoverUrl(book);
  const wanted = style ?? book.coverStyle ?? defaultStyle;
  // With no cover image there is nothing to bind or show raw: stamp the title instead.
  const face: CoverStyle = url ? wanted : 'designed';
  const leather = LEATHERS[hashString(book.series || book.title) % LEATHERS.length];
  const rtl = isRtl(book.lang) || isRtl(detectLang(book.title));
  const titleLang = detectLang(book.title);
  const authorLang = detectLang(book.author);
  const imp = book.import;
  const busy = showState && (imp.state === 'queued' || imp.state === 'processing');
  const failed = showState && imp.state === 'failed';
  const inProgress = showState && book.status === 'reading' && !busy && !failed;

  return (
    <span className="cover" data-style={face} data-leather={leather} data-rtl={rtl}>
      {face !== 'designed' && url && <img src={url} alt="" loading="lazy" decoding="async" draggable={false} />}
      {face === 'designed' && (
        <span className="cover-foil" dir={rtl ? 'rtl' : 'ltr'}>
          <span className="orn" />
          <span className="t" lang={titleLang === 'other' ? undefined : titleLang}>{book.title}</span>
          {book.author && <span className="a" lang={authorLang === 'other' ? undefined : authorLang}>{book.author}</span>}
        </span>
      )}
      {inProgress && <span className="cover-ribbon" aria-hidden="true" />}
      {busy && (
        <span className="cover-veil" role="status">
          <span>{imp.state === 'queued' ? 'Waiting to start' : imp.total ? `${imp.stage ?? 'Preparing'} · ${imp.done} of ${imp.total}` : imp.stage ?? 'Preparing'}</span>
          <span className="meter"><i style={{ width: imp.total ? percent(imp.done / imp.total) : '8%' }} /></span>
        </span>
      )}
      {failed && (
        <span className="cover-veil" data-failed="true">
          <span>Couldn’t be read. Tap for details.</span>
        </span>
      )}
    </span>
  );
}
