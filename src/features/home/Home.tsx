import { ShelfSkeleton } from '../../ui/InkName';
import { CountUp } from '../../ui/CountUp';
import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { Book } from '../../db/types';
import { percent } from '../../lib/util';
import { navigate, switchTab } from '../../app/router';
import { useApp } from '../../app/AppContext';
import { BEST_COMPANION, EmptyState } from '../../ui/EmptyState';
import { langAttr } from '../../lib/arabic';
import { Icon } from '../../ui/Icon';
import { BookCover } from '../library/BookCover';
import { BookDetails } from '../library/BookDetails';
import { BookTile, openBook } from '../library/Library';
import { fetchStatus, aiReady } from '../../ai/client';
import { AiAllowance } from '../settings/AiAllowance';
import { backupDue } from '../settings/BackupPage';
import { useSetting } from '../../app/settings';
import { timeAgo } from '../../lib/util';

/** Where the reader is, in words: the current chapter from the contents list (in English when it has been put into English). */
function whereIn(book: Book): string {
  const p = book.progress;
  if (!p) return '';
  let title = '';
  book.toc.forEach((t, i) => {
    // The book's own title at the head of its contents is not a chapter.
    if (t.title.trim() === book.title.trim()) return;
    if (t.section < p.section || (t.section === p.section && (t.block ?? 0) <= p.block)) title = (book.view !== 'orig' && book.tocEn?.[i]) || t.title;
  });
  return title;
}

/** How long the rest of the book takes at this reader's own pace. */
function timeLeft(book: Book, speed: number): string {
  const total = book.sectionChars.reduce((a, b) => a + b, 0);
  const mins = Math.round(((1 - (book.progress?.fraction ?? 0)) * total) / Math.max(250, speed));
  if (mins < 1) return 'nearly finished';
  if (mins < 60) return `${mins} min left`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} h${m >= 5 ? ` ${m} min` : ''} left`;
}

/** The book being read: its cover, where you are, and how far you have come. */
function ContinueCard({ book, where }: { book: Book; where: string }) {
  const speed = useSetting('readingSpeed');
  const f = book.progress?.fraction ?? 0;
  const c = 2 * Math.PI * 15;
  return (
    <button className="continue fade-in" onClick={() => navigate(`/book/${book.id}`)} aria-label={`Continue reading ${book.title}`}>
      <BookCover book={book} />
      <span className="continue-body">
        <span className="eyebrow">Continue reading</span>
        <h2 lang={langAttr(book.title)} dir="auto">{book.title}</h2>
        <span className="where" dir="auto" lang={langAttr(where)}>{where}</span>
        <span className="continue-meta tile-progress">
          <svg className="ring" viewBox="0 0 36 36" aria-hidden="true">
            <circle className="ring-bg" cx="18" cy="18" r="15" />
            <circle className="ring-fg" cx="18" cy="18" r="15" style={{ strokeDasharray: c, strokeDashoffset: c * (1 - f) }} />
          </svg>
          <span>
            <b><CountUp value={Math.round(f * 100)} suffix="%" /></b> · {timeLeft(book, speed)}
          </span>
        </span>
      </span>
    </button>
  );
}

/** A quiet line while your AI works on a book in the background; tap it to open the book. */
function LiveLine({ books }: { books: Book[] }) {
  const busy = books.find((b) => (b.translation && (b.translation.state === 'running' || b.translation.state === 'queued')) || (b.ocr && (b.ocr.state === 'running' || b.ocr.state === 'queued') && b.ocr.done < b.ocr.total));
  if (!busy) return null;
  const t = busy.translation && (busy.translation.state === 'running' || busy.translation.state === 'queued') ? busy.translation : null;
  const text = t ? `Translating ${busy.title}: ${t.done} of ${t.total} paragraphs` : `Reading and translating ${busy.title}: page ${busy.ocr!.done} of ${busy.ocr!.total}`;
  return (
    <button className="live-line" onClick={() => navigate(`/book/${busy.id}`)}>
      <i aria-hidden="true" />
      <span dir="auto">{text}</span>
    </button>
  );
}

export function Home() {
  const { addBooks } = useApp();
  const books = useLiveQuery(() => db.books.toArray(), []);
  const refCount = useLiveQuery(() => db.refs.count(), []) ?? 0;
  const [details, setDetails] = useState<string | null>(null);

  const { current, upNext, recent, working } = useMemo(() => {
    const all = books ?? [];
    const ready = all.filter((b) => b.import.state === 'ready');
    const opened = ready.filter((b) => b.openedAt && b.status !== 'finished').sort((a, b) => b.openedAt! - a.openedAt!);
    const cur = opened[0];
    return {
      current: cur,
      upNext: [...opened.slice(1), ...ready.filter((b) => !b.openedAt && b.status === 'want').sort((a, b) => a.addedAt - b.addedAt)].slice(0, 12),
      recent: [...all].sort((a, b) => b.addedAt - a.addedAt).filter((b) => b.id !== cur?.id).slice(0, 12),
      working: all.filter((b) => b.import.state !== 'ready' && b.import.state !== 'missing'),
    };
  }, [books]);

  if (books === undefined)
    return (
      <div className="screen">
        <div className="screen-head">
          <h1>Maktaba<span className="ar" lang="ar">مكتبة</span></h1>
        </div>
        <div className="ph ph-card" />
        <div className="section-title">Up next</div>
        <ShelfSkeleton count={4} row />
      </div>
    );

  const where = current ? whereIn(current) || current.author : '';

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Maktaba<span className="ar" lang="ar">مكتبة</span></h1>
        <button className="icon-btn" onClick={() => navigate('/settings')} aria-label="Settings"><Icon name="settings" /></button>
      </div>

      {books.length === 0 ? (
        <EmptyState
          epigraph={BEST_COMPANION}
          title="An empty shelf, for now"
          action={
            <>
              <button className="btn btn--primary" onClick={() => addBooks()}><Icon name="plus" size={20} />Add your first book</button>
              <button className="btn" onClick={() => navigate('/catalogue')}><Icon name="download" size={20} />Book catalogue: classical books, free</button>
              <button className="btn" onClick={() => navigate('/setup')}><Icon name="sparkle" size={20} />Set up Maktaba (2 steps)</button>
            </>
          }
        >
          Add an Arabic, Urdu, Persian or English book from your phone: it stays on this device and opens without internet. Or start with a classic from the catalogue; they have aged well.
        </EmptyState>
      ) : (
        <>
          {current && <ContinueCard book={current} where={where} />}
          <LiveLine books={books} />

          {working.length > 0 && (
            <>
              <div className="section-title">Being prepared</div>
              <div className="list">
                {working.map((b) => (
                  <button className="row" key={b.id} onClick={() => setDetails(b.id)}>
                    <Icon name={b.import.state === 'failed' ? 'warn' : 'book'} />
                    <span className="grow">
                      <span className="title" dir="auto">{b.title}</span>
                      <div className="sub">
                        {b.import.state === 'failed'
                          ? 'Couldn’t be read. Tap for details.'
                          : b.import.state === 'queued'
                            ? 'Waiting to start'
                            : `${b.import.stage ?? 'Preparing'}${b.import.total ? `: ${b.import.done} of ${b.import.total}` : ''}`}
                      </div>
                      {b.import.state === 'processing' && !!b.import.total && (
                        <span className="meter" style={{ display: 'block', marginTop: 6 }}><i style={{ width: percent(b.import.done / b.import.total) }} /></span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {upNext.length > 0 && (
            <>
              <div className="section-title">Up next</div>
              {/* A new row when the books change: snapping would otherwise keep the old first book in view, scrolled along. */}
              <div className="shelf" key={upNext.map((b) => b.id).join()}>
                {upNext.map((b) => <BookTile key={b.id} book={b} onDetails={setDetails} />)}
              </div>
            </>
          )}

          {recent.length > 0 && (
            <>
              <div className="section-title">Recently added</div>
              <div className="shelf" key={recent.map((b) => b.id).join()}>
                {recent.map((b) => (
                  <div className="tile" key={b.id}>
                    <button className="tile-cover" onClick={() => openBook(b, setDetails)} aria-label={`Open ${b.title}`}><BookCover book={b} /></button>
                    <span className="tile-title" lang={langAttr(b.title)} dir="auto">{b.title}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="section-title">Study</div>
          <div className="shortcuts">
            <button className="shortcut" onClick={() => navigate('/search')}>
              <Icon name="search" />
              <b>Search</b>
              <span>Find a word or phrase across all your books</span>
            </button>
            <button className="shortcut" onClick={() => switchTab('references')}>
              <Icon name="references" />
              <b>References</b>
              <span>{refCount ? `${refCount} saved passage${refCount === 1 ? '' : 's'}` : 'Passages you save while reading'}</span>
            </button>
          </div>
          <CatalogueCard />
        </>
      )}

      <SetupCard />

      <BackupReminder hasBooks={books.length > 0} />
      <HomeAllowance />
      <InstallHint />
      {details && <BookDetails bookId={details} onClose={() => setDetails(null)} />}
    </div>
  );
}

function BackupReminder({ hasBooks }: { hasBooks: boolean }) {
  const last = useSetting('lastBackupAt');
  const reminder = useSetting('backupReminder');
  if (!backupDue(last, reminder, hasBooks)) return null;
  return (
    <div className="banner" style={{ marginTop: 22 }}>
      <Icon name="download" />
      <span className="grow">{last ? `Your last backup was ${timeAgo(last)}.` : 'Your library has never been backed up.'} One file keeps everything safe.</span>
      <button className="btn" onClick={() => navigate('/settings/backup')}>Back up</button>
    </div>
  );
}

/** Today's AI allowance at a glance (only once the server is set up). */
function HomeAllowance() {
  const [state, setState] = useState<Awaited<ReturnType<typeof fetchStatus>> | null>(null);
  useEffect(() => {
    let alive = true;
    void aiReady().then((cfg) => cfg && fetchStatus().then((s) => alive && setState(s)));
    return () => {
      alive = false;
    };
  }, []);
  if (!state?.status) return null;
  return (
    <>
      <div className="section-title">Today’s AI allowance</div>
      <button className="card" style={{ width: '100%', textAlign: 'start' }} onClick={() => navigate('/settings/ai')}>
        <AiAllowance status={state.status} stale={state.stale} compact />
      </button>
    </>
  );
}

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
}

/** On the web: how to put Maktaba on the home screen. Hidden once installed or dismissed. */
function InstallHint() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('maktaba.installHint') === 'off';
    } catch {
      return false;
    }
  });
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const native = /; wv\)/.test(navigator.userAgent) || location.protocol === 'capacitor:' || location.hostname === 'localhost' && /Android/.test(navigator.userAgent);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (standalone || native || dismissed || (!ios && !prompt)) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem('maktaba.installHint', 'off');
    } catch {
      /* private mode */
    }
  };
  return (
    <div className="banner" style={{ marginTop: 26 }}>
      <Icon name="download" />
      <span className="grow">
        {ios
          ? <>Put Maktaba on your home screen: tap <b>Share</b>, then <b>Add to Home Screen</b>.</>
          : 'Install Maktaba on this device for full-screen, offline reading.'}
      </span>
      {prompt && <button className="btn btn--primary" onClick={() => { void prompt.prompt(); setPrompt(null); }}>Install</button>}
      <button className="icon-btn" onClick={dismiss} aria-label="Dismiss"><Icon name="close" size={20} /></button>
    </div>
  );
}

/**
 * For someone new (often someone who was sent the link): their own cloud and their own AI,
 * each one tap away. Gone once both are connected, or when dismissed.
 */
/** The book catalogue, always one tap from Home (it used to be found only at the foot of the page). */
function CatalogueCard() {
  const taken = useLiveQuery(() => db.books.filter((b) => !!b.catalogueId).count(), []) ?? 0;
  return (
    <div className="list" style={{ marginTop: 10 }}>
      <button className="row" onClick={() => navigate('/catalogue')}>
        <Icon name="download" />
        <span className="grow">
          <span className="title">Book catalogue</span>
          <div className="sub">
            {taken
              ? `${taken} taken so far. The six books of ḥadīth and their commentaries, Ḥanafī fiqh, works on government and constitutions.`
              : 'Classical books, free: the six books of ḥadīth with their commentaries, classical and Deobandi, and the great works of Ḥanafī fiqh.'}
          </div>
        </span>
        <Icon name="forward" size={18} />
      </button>
    </div>
  );
}

function SetupCard() {
  const [state, setState] = useState<{ cloud: boolean; ai: boolean } | null>(null);
  const hidden = useLiveQuery(async () => (await db.settings.get('setupCardHidden'))?.value === true, []);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const [{ getCloud }, { getMyAi, hasMyAi }, { getServer }] = await Promise.all([import('../../cloud/drive'), import('../../ai/device'), import('../../ai/client')]);
      const [cloud, ai, server] = await Promise.all([getCloud(), getMyAi(), getServer()]);
      if (alive) setState({ cloud: !!cloud || !!server, ai: hasMyAi(ai) || !!server });
    };
    void check();
    window.addEventListener('maktaba:connected', check);
    return () => {
      alive = false;
      window.removeEventListener('maktaba:connected', check);
    };
  }, []);
  if (!state || hidden || (state.cloud && state.ai)) return null;
  return (
    <>
      <div className="section-title">Make Maktaba yours</div>
      <div className="list setup-card">
        {!state.cloud && (
          <button className="row" onClick={() => navigate('/setup/cloud')}>
            <Icon name="cloud" />
            <span className="grow">
              <span className="title">Connect your cloud</span>
              <div className="sub">Keep your library in your own Google Drive, on all your phones.</div>
            </span>
            <Icon name="forward" size={18} />
          </button>
        )}
        {!state.ai && (
          <button className="row" onClick={() => navigate('/setup/ai')}>
            <Icon name="sparkle" />
            <span className="grow">
              <span className="title">Connect your AI</span>
              <div className="sub">Translation into English, Ask your books and Explain, with your own free AI account.</div>
            </span>
            <Icon name="forward" size={18} />
          </button>
        )}
        <button className="row" onClick={() => void db.settings.put({ key: 'setupCardHidden', value: true })}>
          <span className="grow sub">Not now</span>
        </button>
      </div>
    </>
  );
}
