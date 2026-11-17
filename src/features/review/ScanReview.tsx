import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { Block, Book, OcrPage } from '../../db/types';
import { detectLang, langAttr } from '../../lib/arabic';
import { goBack, navigate } from '../../app/router';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';
import { recognizePage } from '../../ocr/engine';
import { pageImage } from '../../ocr/pages';
import { CHECK_BELOW, savePage } from '../../ocr/queue';
import { ZoomViewer } from '../reader/ZoomViewer';

/** Paragraphs as editable text: one blank line between paragraphs, headings marked with #. */
const toText = (blocks: Block[]) => blocks.map((b) => (b.t === 'h' ? `# ${b.text}` : b.text)).join('\n\n');

function fromText(text: string, page: number, printed?: string): Block[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .map((p) => {
      const h = p.match(/^#\s+(.*)$/);
      const b: Block = h ? { t: 'h', level: 2, text: h[1] } : { t: 'p', text: p };
      return { ...b, page, printed, ocr: true, conf: 100 };
    });
}

/** Checking recognised text: flagged pages first, page image beside its text. */
export function ScanReview({ bookId, page }: { bookId: string; page?: number }) {
  const book = useLiveQuery(async () => (await db.books.get(bookId)) ?? null, [bookId]);
  const rows = useLiveQuery(() => db.ocrPages.where('bookId').equals(bookId).sortBy('page'), [bookId]);
  const [filter, setFilter] = useState<'check' | 'all'>('check');

  if (book === undefined || rows === undefined) return <div className="screen screen--plain" aria-busy="true" />;
  if (book === null) {
    return (
      <div className="screen screen--plain">
        <EmptyState icon="book" title="This book is no longer here" action={<button className="btn btn--primary" onClick={() => navigate('/library', { replace: true })}>Go to the Library</button>} />
      </div>
    );
  }
  if (page !== undefined) return <PageEditor book={book} rows={rows} page={page} />;

  const flagged = rows.filter((r) => !r.edited && r.conf < CHECK_BELOW);
  const shown = filter === 'check' ? flagged : rows;
  return (
    <div className="screen screen--plain">
      <div className="screen-head screen-head--sub">
        <button className="icon-btn" onClick={() => goBack('/library')} aria-label="Back"><Icon name="back" /></button>
        <h1>Check recognised text</h1>
      </div>
      <p className="muted" style={{ marginBottom: 14 }}>
        <span dir="auto" lang={langAttr(book.title)}>{book.title}</span>: {rows.length} of {book.ocr?.total ?? rows.length} pages recognised.{' '}
        {flagged.length ? `${flagged.length} need checking: the engine was unsure of them.` : 'None are flagged.'}
      </p>
      <div className="chips" role="group" aria-label="Show">
        <button className="chip" aria-pressed={filter === 'check'} onClick={() => setFilter('check')}>Needs checking · {flagged.length}</button>
        <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All pages · {rows.length}</button>
      </div>
      {shown.length ? (
        <div className="list" style={{ marginTop: 14 }}>
          {shown.map((r) => (
            <button className="row" key={r.id} onClick={() => navigate(`/book/${bookId}/review/${r.page}`)}>
              <Icon name={r.edited ? 'check' : r.conf < CHECK_BELOW ? 'warn' : 'scan'} />
              <span className="grow">
                <span className="title">Page {r.printed ? `${r.printed} (file page ${r.page})` : r.page}</span>
                <div className="sub">
                  {r.edited ? 'Corrected by you' : `Recognised with ${r.conf}% confidence`}
                  {r.blocks[0] ? ': ' : ''}
                  <span dir="auto">{r.blocks[0]?.text.slice(0, 60)}</span>
                </div>
              </span>
              <Icon name="forward" size={18} />
            </button>
          ))}
        </div>
      ) : (
        <EmptyState icon="check" title={filter === 'check' ? 'Nothing needs checking' : 'No pages yet'}>
          {filter === 'check' ? 'Every recognised page so far was read with good confidence.' : 'Pages appear here as their text is recognised.'}
        </EmptyState>
      )}
    </div>
  );
}

function PageEditor({ book, rows, page }: { book: Book; rows: OcrPage[]; page: number }) {
  const row = rows.find((r) => r.page === page);
  const [text, setText] = useState(() => (row ? toText(row.blocks) : ''));
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const dirty = row ? text !== toText(row.blocks) : text.trim().length > 0;

  useEffect(() => {
    setText(row ? toText(row.blocks) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, row?.updatedAt]);

  useEffect(() => {
    let alive = true;
    const el = holder.current;
    if (!el) return;
    void pageImage(book, page, Math.min(1600, Math.round(el.clientWidth * (window.devicePixelRatio || 1)))).then((canvas) => {
      if (!alive) return;
      canvas.style.width = '100%';
      canvas.style.height = 'auto';
      canvas.style.display = 'block';
      el.replaceChildren(canvas);
    }).catch(() => {
      if (alive) el.textContent = 'This page could not be shown.';
    });
    return () => {
      alive = false;
    };
  }, [book, page]);

  const next = useMemo(() => rows.find((r) => r.page > page && !r.edited && r.conf < CHECK_BELOW) ?? rows.find((r) => !r.edited && r.conf < CHECK_BELOW && r.page !== page), [rows, page]);
  const lang = detectLang(text) === 'other' ? undefined : detectLang(text);

  const save = async () => {
    await savePage(book, page, { blocks: fromText(text, page, row?.printed), conf: 100, printed: row?.printed, edited: true, lang: row?.lang ?? book.ocrLang ?? 'ara' });
    toast('Saved. The book now uses your corrected text.');
  };

  const rerun = async () => {
    setBusy(true);
    try {
      const canvas = await pageImage(book, page);
      const r = await recognizePage(canvas, book.ocrLang ?? 'ara', page);
      await savePage(book, page, { blocks: r.blocks, conf: r.conf, printed: r.printed, lang: book.ocrLang ?? 'ara' });
      toast(`Recognised again with ${r.conf}% confidence.`);
    } catch {
      toast('This page could not be recognised. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen screen--plain">
      <div className="screen-head screen-head--sub">
        <button className="icon-btn" onClick={() => goBack(`/book/${book.id}/review`)} aria-label="Back"><Icon name="back" /></button>
        <h1>Page {row?.printed ?? page}</h1>
      </div>
      <div className="review">
        <figure className="review-page">
          <div ref={holder} className="review-image" aria-busy="true" onClick={() => setZoom(true)} role="button" tabIndex={0} aria-label="Zoom into the page" />
          <figcaption className="muted small">
            {row ? (row.edited ? 'Corrected by you.' : `Recognised with ${row.conf}% confidence.`) : 'Not recognised yet.'} Tap the page to zoom.
          </figcaption>
        </figure>
        <label className="stack">
          Recognised text
          <span className="field review-text">
            <textarea value={text} onChange={(e) => setText(e.target.value)} dir="auto" lang={lang} rows={14} spellCheck={false} />
          </span>
          <span className="muted small" style={{ fontWeight: 400 }}>Leave a blank line between paragraphs. Start a line with # for a heading.</span>
        </label>
        <div className="review-actions">
          <button className="btn btn--primary" disabled={!dirty || busy} onClick={() => void save()}>Save</button>
          <button className="btn" disabled={busy} onClick={() => void rerun()}>{busy ? 'Recognising…' : 'Recognise again'}</button>
          {next && <button className="btn btn--quiet" onClick={() => navigate(`/book/${book.id}/review/${next.page}`, { replace: true })}>Next to check<Icon name="forward" size={18} /></button>}
        </div>
      </div>
      {zoom && <ZoomViewer source={book.format === 'pdf' ? { kind: 'pdf', bookId: book.id, page } : { kind: 'img', url: '' }} onClose={() => setZoom(false)} />}
    </div>
  );
}
