import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, deleteBook } from '../../db/db';
import type { Book, CoverStyle, Folder, Lang, ReadStatus } from '../../db/types';
import { cancelImport, retryImport } from '../../import';
import { langAttr, langName, parseVolume } from '../../lib/arabic';
import { formatBytes, percent } from '../../lib/util';
import { navigate } from '../../app/router';
import { useApp } from '../../app/AppContext';
import { Sheet } from '../../ui/Sheet';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';
import { BookCover, useCoverUrl } from './BookCover';
import { CHECK_BELOW, rerunOcr, runOcrQueue } from '../../ocr/queue';
import { getServer } from '../../ai/client';
import { cancelBookTranslation, estimateRequests, pullBook, sourceParagraphs, startBookTranslation, translatable } from '../../ai/translation';
import { timeUntil } from '../settings/AiAllowance';
import { OCR_LANGS } from '../../ocr/engine';

const STATUS: Array<[ReadStatus, string]> = [['want', 'Want to read'], ['reading', 'Reading'], ['finished', 'Finished']];
const LANGS: Lang[] = ['ar', 'ur', 'fa', 'en', 'other'];
const FORMAT: Record<Book['format'], string> = {
  epub: 'EPUB', mobi: 'Kindle', pdf: 'PDF', txt: 'Text', md: 'Markdown', docx: 'Word', fb2: 'FB2', html: 'Web page', image: 'Image',
};

/** Folder names as a path, e.g. "Fiqh › Ḥanafī". */
export function folderPath(folders: Folder[], id: string | undefined): string {
  const names: string[] = [];
  let cur = folders.find((f) => f.id === id);
  let guard = 0;
  while (cur && guard++ < 20) {
    names.unshift(cur.name);
    cur = folders.find((f) => f.id === cur!.parentId);
  }
  return names.join(' › ');
}

/** Text recognition for page images: progress, language, and the way to check it. */
function OcrStatus({ book }: { book: Book }) {
  const ocr = book.ocr!;
  const flagged = useLiveQuery(
    () => db.ocrPages.where('bookId').equals(book.id).filter((p) => !p.edited && p.conf < CHECK_BELOW).count(),
    [book.id, ocr.done],
  ) ?? 0;
  const [choosing, setChoosing] = useState(false);
  const langLabel = OCR_LANGS.find(([v]) => v === book.ocrLang)?.[1];
  const pagesText = book.kind === 'scan' ? 'This is a scanned book.' : `${ocr.total} page${ocr.total === 1 ? ' has' : 's have'} no usable text in the file.`;
  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Icon name="scan" />
        <div className="grow" style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>
            {ocr.state === 'done' ? 'Text recognised' : ocr.state === 'failed' ? 'Text recognition stopped' : ocr.state === 'running' ? 'Recognising text' : 'Waiting to recognise text'}
          </div>
          <div className="muted small">
            {pagesText} {ocr.state === 'failed' ? ocr.error : `${ocr.done} of ${ocr.total} pages done${langLabel ? `, in ${langLabel}` : ''}.`}
          </div>
        </div>
      </div>
      {ocr.state !== 'done' && ocr.state !== 'failed' && <span className="meter"><i style={{ width: percent(ocr.total ? ocr.done / ocr.total : 0) }} /></span>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {ocr.done > 0 && (
          <button className="btn" onClick={() => navigate(`/book/${book.id}/review`)}>
            {flagged ? `Check ${flagged} page${flagged === 1 ? '' : 's'}` : 'Review the text'}
          </button>
        )}
        {ocr.state === 'failed' && <button className="btn" onClick={() => void db.books.update(book.id, { ocr: { ...ocr, state: 'queued' } }).then(() => runOcrQueue())}>Try again</button>}
        <button className="btn btn--quiet" onClick={() => setChoosing((c) => !c)}>Language{langLabel ? `: ${langLabel}` : ''}</button>
      </div>
      {choosing && (
        <div className="chips" role="group" aria-label="Recognition language" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
          {OCR_LANGS.map(([value, label]) => (
            <button
              key={value}
              className="chip"
              aria-pressed={book.ocrLang === value}
              onClick={() => {
                setChoosing(false);
                if (value !== book.ocrLang) void rerunOcr(book.id, value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {choosing && <p className="muted small">Choosing another language recognises the pages again. Pages you have corrected yourself are kept.</p>}
    </div>
  );
}

/** The book's English translation: start it, follow it, or see why it is paused. */
function TranslationCard({ book }: { book: Book }) {
  const t = book.translation;
  const [busy, setBusy] = useState(false);
  const [estimate, setEstimate] = useState<{ paras: number; requests: number } | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const have = useLiveQuery(() => db.translations.where('bookId').equals(book.id).count(), [book.id]) ?? 0;

  useEffect(() => {
    void getServer().then((c) => setConnected(!!c));
    if (!t) void sourceParagraphs(book).then((p) => setEstimate({ paras: p.length, requests: estimateRequests(p) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, !!t]);

  const start = async () => {
    setBusy(true);
    try {
      await startBookTranslation(book);
      toast('Translation started. It carries on on the server, even with Maktaba closed.');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span className="ai-mark" aria-hidden="true">✦</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>
            {!t ? 'English translation' : t.state === 'done' ? 'Translated into English' : t.state === 'waiting' ? 'Translation paused' : t.state === 'failed' ? 'Translation stopped' : 'Translating into English'}
          </div>
          <div className="muted small">
            {!t
              ? have
                ? `${have} paragraphs are already translated. Translate the rest of the book?`
                : estimate
                  ? `${estimate.paras} paragraphs, about ${estimate.requests} requests of free allowance${estimate.requests > 150 ? ', spread over several days' : ''}.`
                  : 'Counting the paragraphs…'
              : t.state === 'waiting'
                ? `${t.done} of ${t.total} done. Today’s free allowances are used up; it carries on by itself ${t.nextRunAt ? timeUntil(t.nextRunAt) : 'soon'}.`
                : t.state === 'failed'
                  ? t.note ?? 'Something went wrong.'
                  : `${t.done} of ${t.total} paragraphs done.`}
          </div>
        </div>
      </div>
      {t && t.state !== 'done' && t.state !== 'failed' && <span className="meter"><i style={{ width: percent(t.total ? t.done / t.total : 0) }} /></span>}
      {connected === false ? (
        <button className="btn" onClick={() => navigate('/settings/ai')}>Set up AI and sync first</button>
      ) : !t || t.state === 'failed' ? (
        <button className="btn" disabled={busy || (!estimate?.paras && !t)} onClick={() => void start()}>
          <span className="ai-mark" aria-hidden="true">✦</span>{busy ? 'Starting…' : t ? 'Start again' : 'Translate the whole book'}
        </button>
      ) : t.state !== 'done' ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => void pullBook(book.id).catch((e) => toast((e as Error).message))}>Check now</button>
          <button className="btn btn--quiet btn--danger" onClick={() => void cancelBookTranslation(book)}>Stop</button>
        </div>
      ) : null}
      {t?.state === 'waiting' && t.note && <p className="muted small">{t.note}</p>}
    </div>
  );
}

export function BookDetails({ bookId, onClose }: { bookId: string; onClose: () => void }) {
  const { addBooks } = useApp();
  const book = useLiveQuery(() => db.books.get(bookId), [bookId]);
  const folders = useLiveQuery(() => db.folders.toArray(), []) ?? [];
  const [view, setView] = useState<'main' | 'edit' | 'move' | 'delete'>('main');
  const coverUrl = useCoverUrl(book ?? { id: bookId, hasCover: false });

  if (!book) return null;
  const update = (patch: Partial<Book>) => db.books.update(book.id, patch);
  const imp = book.import;
  const ready = imp.state === 'ready';

  if (view === 'edit') return <EditBook book={book} onDone={() => setView('main')} />;

  if (view === 'move') {
    return (
      <Sheet title="Move to folder" onClose={() => setView('main')}>
        <div className="list">
          <button className="row" onClick={() => { void update({ folderId: undefined }); setView('main'); }}>
            <Icon name="library" />
            <span className="grow title">Library (no folder)</span>
            {!book.folderId && <Icon name="check" />}
          </button>
          {folders
            .map((f) => ({ f, path: folderPath(folders, f.id) }))
            .sort((a, b) => a.path.localeCompare(b.path))
            .map(({ f, path }) => (
              <button className="row" key={f.id} onClick={() => { void update({ folderId: f.id }); setView('main'); }}>
                <Icon name="folder" />
                <span className="grow title">{path}</span>
                {book.folderId === f.id && <Icon name="check" />}
              </button>
            ))}
        </div>
        {!folders.length && <p className="muted small">You have no folders yet. Create one from the Library’s menu.</p>}
      </Sheet>
    );
  }

  if (view === 'delete') {
    return (
      <Sheet title="Remove this book?" onClose={() => setView('main')}>
        <p>“{book.title}” will be removed from this device along with its highlights, notes and bookmarks. This can’t be undone.</p>
        <button
          className="btn btn--primary btn--block"
          onClick={async () => {
            cancelImport(book.id);
            await deleteBook(book.id);
            toast('Book removed.');
            onClose();
          }}
        >
          Remove book
        </button>
        <button className="btn btn--block" onClick={() => setView('main')}>Keep it</button>
      </Sheet>
    );
  }

  return (
    <Sheet title="Book details" onClose={onClose}>
      <div className="detail-head">
        <BookCover book={book} showState={false} />
        <div>
          <h3 lang={langAttr(book.title)} dir="auto">{book.title}</h3>
          {book.author && <p className="by" lang={langAttr(book.author)} dir="auto">{book.author}</p>}
          <p className="detail-facts">
            {langName(book.lang)}, {FORMAT[book.format]}{book.pageCount ? `, ${book.pageCount} pages` : ''}<br />{formatBytes(book.size)} on this device
          </p>
        </div>
      </div>

      {imp.state === 'missing' && (
        <div className="banner" role="status">
          <Icon name="book" />
          <span className="grow">This book is in your library on another phone. Add the same file here to read it; your notes, highlights and place come with it.</span>
          <button className="btn" onClick={() => addBooks()}>Add the file</button>
        </div>
      )}
      {imp.state === 'failed' && (
        <div className="banner banner--error" role="alert">
          <Icon name="warn" />
          <span className="grow">{imp.error ?? 'This book could not be read.'}</span>
          <button className="btn" onClick={() => void retryImport(book.id)}>Try again</button>
        </div>
      )}
      {(imp.state === 'processing' || imp.state === 'queued') && (
        <div className="banner" role="status">
          <span className="grow">
            {imp.state === 'queued' ? 'Waiting to start.' : `${imp.stage ?? 'Preparing'}${imp.total ? `: ${imp.done} of ${imp.total}` : ''}`}
            <span className="meter" style={{ display: 'block', marginTop: 8 }}><i style={{ width: imp.total ? percent(imp.done / imp.total) : '6%' }} /></span>
          </span>
        </div>
      )}
      {ready && !!imp.failedPages?.length && (
        <div className="banner" role="status">
          <Icon name="warn" />
          <span className="grow">{imp.failedPages.length} page{imp.failedPages.length > 1 ? 's' : ''} could not be read: {imp.failedPages.slice(0, 12).join(', ')}{imp.failedPages.length > 12 ? '…' : ''}</span>
        </div>
      )}
      {ready && book.ocr && <OcrStatus book={book} />}

      {ready && translatable(book) && <TranslationCard book={book} />}

      {ready && (
        <button className="btn btn--primary btn--block" onClick={() => navigate(`/book/${book.id}`)}>
          {book.progress && book.progress.fraction > 0.003 ? `Continue · ${percent(book.progress.fraction)}` : 'Start reading'}
        </button>
      )}

      <div>
        <div className="section-title" style={{ marginTop: 4 }}>Reading status</div>
        <div className="seg" role="group" aria-label="Reading status">
          {STATUS.map(([value, label]) => (
            <button key={value} aria-pressed={book.status === value} onClick={() => void update({ status: value })}>{label}</button>
          ))}
        </div>
      </div>

      <div>
        <div className="section-title" style={{ marginTop: 4 }}>Cover</div>
        <div className="cover-choices">
          {([['bound', 'Bound'], ['raw', 'Original'], ['designed', 'Gold title']] as Array<[CoverStyle, string]>).map(([value, label]) => {
            const unavailable = !coverUrl && value !== 'designed';
            return (
              <button
                key={value}
                className="cover-choice"
                disabled={unavailable}
                style={unavailable ? { opacity: 0.45 } : undefined}
                aria-pressed={(book.coverStyle ?? (coverUrl ? undefined : 'designed')) === value}
                onClick={() => void update({ coverStyle: value })}
              >
                <BookCover book={book} style={value} showState={false} />
                {label}
              </button>
            );
          })}
        </div>
        {!coverUrl && <p className="muted small" style={{ marginTop: 8 }}>This file has no cover picture, so the title is stamped in gold.</p>}
        {book.coverStyle && coverUrl && (
          <button className="btn btn--quiet" onClick={() => void update({ coverStyle: undefined })}>Use my default cover style</button>
        )}
      </div>

      <div className="list">
        <button className="row" onClick={() => setView('edit')}>
          <Icon name="edit" />
          <span className="grow title">Edit title, author and language</span>
          <Icon name="forward" size={18} />
        </button>
        <button className="row" onClick={() => setView('move')}>
          <Icon name="move" />
          <span className="grow">
            <span className="title">Move to folder</span>
            <div className="sub">{folderPath(folders, book.folderId) || 'Not in a folder'}</div>
          </span>
          <Icon name="forward" size={18} />
        </button>
        <div className="row">
          <Icon name="info" />
          <span className="grow">
            <span className="title" id={`priv-${book.id}`}>Private book</span>
            <div className="sub">Only sent to AI services that do not train on what they are sent.</div>
          </span>
          <button className="switch" role="switch" aria-checked={!!book.private} aria-labelledby={`priv-${book.id}`} onClick={() => void update({ private: !book.private })} />
        </div>
        <button className="row btn--danger" onClick={() => setView('delete')}>
          <Icon name="trash" />
          <span className="grow title">Remove from this device</span>
        </button>
      </div>
      <p className="muted small">File: {book.fileName}{book.edition ? ` · Edition: ${book.edition}` : ''}</p>
    </Sheet>
  );
}

function EditBook({ book, onDone }: { book: Book; onDone: () => void }) {
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author);
  const [edition, setEdition] = useState(book.edition ?? '');
  const [lang, setLang] = useState<Lang>(book.lang);

  const save = async () => {
    const t = title.trim() || book.title;
    const vol = parseVolume(t);
    await db.books.update(book.id, {
      title: t, author: author.trim(), edition: edition.trim() || undefined, lang, series: vol?.series, volume: vol?.volume,
    });
    onDone();
  };

  return (
    <Sheet title="Edit details" onClose={onDone}>
      <label className="stack">
        Title
        <span className="field"><input value={title} onChange={(e) => setTitle(e.target.value)} dir="auto" /></span>
      </label>
      <label className="stack">
        Author
        <span className="field"><input value={author} onChange={(e) => setAuthor(e.target.value)} dir="auto" /></span>
      </label>
      <label className="stack">
        Edition / publisher
        <span className="field"><input value={edition} onChange={(e) => setEdition(e.target.value)} dir="auto" placeholder="e.g. Dār al-Kutub al-ʿIlmiyya, 2003" /></span>
      </label>
      <div>
        <div className="section-title" style={{ marginTop: 4 }}>Language of the book</div>
        <div className="chips" role="group" aria-label="Language" style={{ margin: 0, padding: 0, flexWrap: 'wrap' }}>
          {LANGS.map((l) => (
            <button key={l} className="chip" aria-pressed={lang === l} onClick={() => setLang(l)}>{langName(l)}</button>
          ))}
        </div>
      </div>
      <button className="btn btn--primary btn--block" onClick={() => void save()}>Save</button>
    </Sheet>
  );
}
