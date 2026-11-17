import { useEffect, useState } from 'react';
import { db } from '../../db/db';
import type { Book, CoverStyle } from '../../db/types';
import { isRtl, detectLang, langAttr } from '../../lib/arabic';
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

/**
 * Gold tooling for a cover with no picture: a ruled frame with corner pieces, and the
 * turanj, the almond-shaped medallion stamped in the centre of Islamic bindings.
 */
function Tooling() {
  const gold = 'var(--foil-line)';
  return (
    <svg viewBox="0 0 100 150" preserveAspectRatio="none" aria-hidden="true" fill="none" stroke={gold}>
      <rect x="1" y="1" width="98" height="148" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      <rect x="5" y="5" width="90" height="140" strokeWidth="0.6" opacity="0.7" vectorEffect="non-scaling-stroke" />
      {[[5, 5, 1, 1], [95, 5, -1, 1], [5, 145, 1, -1], [95, 145, -1, -1]].map(([x, y, dx, dy], i) => (
        <path key={i} d={`M${x + 13 * dx},${y} Q${x + 13 * dx},${y + 13 * dy} ${x},${y + 13 * dy}`} strokeWidth="0.7" opacity="0.8" vectorEffect="non-scaling-stroke" />
      ))}
      <g transform="translate(50 100)">
        <path d="M0,-22 C13,-11 13,11 0,22 C-13,11 -13,-11 0,-22 Z" fill="rgba(0,0,0,0.2)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d="M0,-15 C8,-7.5 8,7.5 0,15 C-8,7.5 -8,-7.5 0,-15 Z" strokeWidth="0.6" opacity="0.75" vectorEffect="non-scaling-stroke" />
        <path d="M0,-6 L3.5,0 L0,6 L-3.5,0 Z" fill={gold} stroke="none" opacity="0.85" />
        <path d="M0,-30 L2.2,-26 L0,-22 L-2.2,-26 Z M0,30 L2.2,26 L0,22 L-2.2,26 Z" fill={gold} stroke="none" opacity="0.85" />
      </g>
    </svg>
  );
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
  const imp = book.import;
  const busy = showState && (imp.state === 'queued' || imp.state === 'processing');
  const failed = showState && imp.state === 'failed';
  const missing = showState && imp.state === 'missing';
  const inProgress = showState && book.status === 'reading' && !busy && !failed;

  return (
    <span className="cover" data-book={book.id} data-style={face} data-leather={leather} data-rtl={rtl}>
      {face !== 'designed' && url && <img src={url} alt="" loading="lazy" decoding="async" draggable={false} />}
      {face === 'designed' && (
        <span className="cover-face" dir={rtl ? 'rtl' : 'ltr'}>
          <Tooling />
          <span className="t"><span lang={langAttr(book.title)}>{book.title}</span></span>
          {book.author && <span className="a"><span lang={langAttr(book.author)}>{book.author}</span></span>}
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
      {missing && (
        <span className="cover-veil">
          <span>On your other phone. Add its file here to read.</span>
        </span>
      )}
    </span>
  );
}
