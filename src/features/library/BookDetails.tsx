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
import { HelpFor } from '../setup/help';
import { mimeOf, openOriginal, saveFile } from '../../lib/saveFile';
import { BookCover, useCoverUrl } from './BookCover';
import { CHECK_BELOW, rereadWithAi, rerunOcr, runOcrQueue } from '../../ocr/queue';
import { aiReaderFor, aiReaderPausedUntil } from '../../ocr/ai';
import { aiReady } from '../../ai/client';
import { cancelBookTranslation, estimateRequests, pullBook, sourceParagraphs, startBookTranslation, translatable } from '../../ai/translation';
import { timeUntil } from '../settings/AiAllowance';
import { OCR_LANGS } from '../../ocr/engine';

const STATUS: Array<[ReadStatus, string]> = [['want', 'Want to read'], ['reading', 'Reading'], ['finished', 'Finished']];
const LANGS: Lang[] = ['ar', 'ur', 'fa', 'ps', 'ms', 'en', 'other'];
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
  // Who reads the pages: the reader's AI (much better for Urdu Nastaliq), or the phone.
  const [reader, setReader] = useState<{ ai: boolean; pausedUntil: number | null } | null>(null);
  useEffect(() => {
    const look = () => void Promise.all([aiReaderFor(book), aiReaderPausedUntil()]).then(([k, p]) => setReader({ ai: !!k, pausedUntil: p }));
    look();
    window.addEventListener('maktaba:connected', look);
    return () => window.removeEventListener('maktaba:connected', look);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, book.private, ocr.state]);
  const byPhone = useLiveQuery(() => db.ocrPages.where('bookId').equals(book.id).filter((p) => !p.edited && p.by !== 'ai').count(), [book.id, ocr.done]) ?? 0;
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
      {reader && (
        <p className="muted small" style={{ margin: 0 }}>
          {book.private
            ? 'Read on this phone: private books are never sent to an AI that may learn from them.'
            : reader.ai
              ? 'Your Gemini AI reads the pages: far better than the phone alone, especially for Urdu Nastaliq.'
              : reader.pausedUntil
                ? `Today’s free Gemini allowance is used up, so the phone reads meanwhile. Gemini takes over again ${timeUntil(reader.pausedUntil)}.`
                : 'Read on this phone. Adding a free Gemini key (Settings, Your AI) reads pages far better, especially Urdu Nastaliq.'}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {ocr.state === 'queued' && <button className="btn" onClick={() => void runOcrQueue()}>Start now</button>}
        {reader?.ai && !book.private && byPhone > 0 && (ocr.state === 'done' || ocr.state === 'failed') && (
          <button className="btn" onClick={() => void rereadWithAi(book.id).then((n) => toast(`Reading ${n} page${n === 1 ? '' : 's'} again with your AI.`))}>
            <span className="ai-mark" aria-hidden="true">✦</span>Read again with AI
          </button>
        )}
        {!reader?.ai && !reader?.pausedUntil && !book.private && <button className="btn btn--quiet" onClick={() => navigate('/settings/ai')}>Add Gemini</button>}
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
    void aiReady().then((c) => setConnected(!!c));
    if (!t) void sourceParagraphs(book).then((p) => setEstimate({ paras: p.length, requests: estimateRequests(p) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, !!t, Math.floor((book.ocr?.done ?? 0) / 10), book.lang]);
  const stillReading = !!book.ocr && book.ocr.state !== 'done';

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
                : estimate && !estimate.paras && stillReading
                  ? 'Translation becomes available as the scanned pages are read (see above). You can also translate page by page while reading.'
                  : estimate
                  ? `${estimate.paras} paragraph${estimate.paras === 1 ? '' : 's'}, about ${estimate.requests} request${estimate.requests === 1 ? '' : 's'} of free allowance${estimate.requests > 150 ? ', spread over several days' : ''}.`
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
        <button className="btn" onClick={() => navigate('/settings/ai')}>Connect your AI first</button>
      ) : !t || t.state === 'failed' ? (
        <button className="btn" disabled={busy || (!estimate?.paras && !t)} onClick={() => void start()}>
          <span className="ai-mark" aria-hidden="true">✦</span>{busy ? 'Starting…' : t ? 'Start again' : stillReading && estimate?.paras ? 'Translate the pages read so far' : 'Translate the whole book'}
        </button>
      ) : t.state !== 'done' ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => void pullBook(book.id).catch((e) => toast((e as Error).message))}>Check now</button>
          <button className="btn btn--quiet btn--danger" onClick={() => void cancelBookTranslation(book)}>Stop</button>
        </div>
      ) : null}
      {t?.state === 'waiting' && t.note && (/allowance|connect your ai|private/i.test(t.note) ? <HelpFor error={t.note} compact /> : <p className="muted small">{t.note}</p>)}
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

  if (view === 'delete') return <RemoveBook book={book} onBack={() => setView('main')} onDone={onClose} />;

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
      <OriginalFile book={book} />
      {book.edition && <p className="muted small">Edition: {book.edition}</p>}
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

/** The file exactly as it was added: kept untouched, to open or save a copy at any time. */
function OriginalFile({ book }: { book: Book }) {
  const file = useLiveQuery(() => db.files.get(book.id), [book.id]);
  const name = book.fileName || book.title;
  return (
    <>
      <div className="section-title">Original file</div>
      <div className="card orig-file">
        <Icon name="original" />
        <span className="grow">
          <span className="title" dir="auto">{name}</span>
          <span className="muted small">
            {file ? `${formatBytes(file.blob.size)} · kept exactly as you added it` : 'Not on this phone: add the file again to keep it here'}
          </span>
        </span>
      </div>
      {file && (
        <div className="row-btns">
          <button className="btn" onClick={() => void openOriginal(file.blob, name).catch((e) => toast(`Could not open it: ${(e as Error).message}`))}>
            <Icon name="original" size={18} />Open
          </button>
          <button
            className="btn"
            onClick={async () => {
              try {
                const saved = await saveFile(file.blob, name, file.blob.type || mimeOf(name));
                toast(`Saved to ${saved.location}.`);
              } catch (e) {
                toast(`Could not save it: ${(e as Error).message}`);
              }
            }}
          >
            <Icon name="download" size={18} />Save a copy
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Removing a book. With a cloud connected, its file can also be removed from the reader's
 * Drive to free the space (their other phones keep their own copies).
 */
function RemoveBook({ book, onBack, onDone }: { book: Book; onBack: () => void; onDone: () => void }) {
  const [inCloud, setInCloud] = useState(false);
  const [alsoCloud, setAlsoCloud] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void import('../../cloud/drive').then(async (d) => setInCloud(!!(await d.getCloud()) && !!(book.cloudFileId || book.hash)));
  }, [book.cloudFileId, book.hash]);
  return (
    <Sheet title="Remove this book?" onClose={onBack}>
      <p>“{book.title}” will be removed from this device along with its highlights, notes and bookmarks. This can’t be undone.</p>
      {inCloud && (
        <div className="row" style={{ padding: 0 }}>
          <span className="grow">
            <span className="title" id={`rm-cloud-${book.id}`}>Also remove it from my Google Drive</span>
            <div className="sub">Frees {formatBytes(book.size)} of your Drive space. Your other phones keep their own copies.</div>
          </span>
          <button className="switch" role="switch" aria-checked={alsoCloud} aria-labelledby={`rm-cloud-${book.id}`} onClick={() => setAlsoCloud(!alsoCloud)} />
        </div>
      )}
      <button
        className="btn btn--primary btn--block"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          cancelImport(book.id);
          let note = '';
          if (inCloud && alsoCloud) {
            try {
              const { removeFromCloud } = await import('../../sync/cloudSync');
              await removeFromCloud(book);
              note = ` ${formatBytes(book.size)} freed in your Drive.`;
            } catch (e) {
              note = ` It could not be removed from your Drive (${(e as Error).message}); try again from there.`;
            }
          }
          await deleteBook(book.id);
          toast(`Book removed.${note}`);
          onDone();
        }}
      >
        {busy ? 'Removing…' : 'Remove book'}
      </button>
      <button className="btn btn--block" onClick={onBack}>Keep it</button>
    </Sheet>
  );
}
