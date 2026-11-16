import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { Book } from '../../db/types';
import { percent } from '../../lib/util';
import { navigate, switchTab } from '../../app/router';
import { useApp } from '../../app/AppContext';
import { BEST_COMPANION, EmptyState } from '../../ui/EmptyState';
import { detectLang, langAttr } from '../../lib/arabic';
import { Icon } from '../../ui/Icon';
import { BookCover } from '../library/BookCover';
import { BookDetails } from '../library/BookDetails';
import { BookTile, openBook } from '../library/Library';

/** Where the reader is, in words: the current chapter from the contents list. */
function whereIn(book: Book): string {
  const p = book.progress;
  if (!p) return '';
  let title = '';
  for (const t of book.toc) {
    if (t.section < p.section || (t.section === p.section && (t.block ?? 0) <= p.block)) title = t.title;
    else break;
  }
  return title;
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
      working: all.filter((b) => b.import.state !== 'ready'),
    };
  }, [books]);

  if (books === undefined) return <div className="screen" aria-busy="true" />;

  const whereLang = current ? detectLang(whereIn(current) || current.author) : 'other';

  return (
    <div className="screen">
      <div className="desk">
        <header className="desk-head">
          <h1>Maktaba</h1>
          <span className="ar" lang="ar">مكتبة</span>
          <button className="icon-btn" onClick={() => navigate('/settings')} aria-label="Settings"><Icon name="settings" /></button>
        </header>
        {current ? (
          <button className="desk-book" onClick={() => navigate(`/book/${current.id}`)} aria-label={`Continue reading ${current.title}`}>
            <BookCover book={current} />
            <span>
              <span className="label">Continue reading</span>
              <h2 lang={current.lang === 'other' ? undefined : current.lang} dir="auto">{current.title}</h2>
              <span className="where" dir="auto" lang={whereLang === 'other' ? undefined : whereLang}>{whereIn(current) || current.author}</span>
              <span className="desk-progress">
                <span className="meter"><i style={{ width: percent(current.progress?.fraction) }} /></span>
                {percent(current.progress?.fraction)}
              </span>
            </span>
          </button>
        ) : (
          <figure className="desk-epigraph" style={{ marginInline: 0, marginBottom: 0 }}>
            <span className="line" lang="ar">{BEST_COMPANION.line}</span>
            <figcaption>
              <span className="gloss">{BEST_COMPANION.gloss}</span>
              <span className="by">{BEST_COMPANION.by}</span>
            </figcaption>
          </figure>
        )}
      </div>

      {books.length === 0 ? (
        <EmptyState title="Start with one book" action={<button className="btn btn--primary" onClick={() => addBooks()}><Icon name="plus" size={20} />Add your first book</button>}>
          Add an Arabic, Urdu, Persian or English book from your phone. It is kept on this device and opens without internet.
        </EmptyState>
      ) : (
        <div className="after-desk">

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
              <div className="shelf">
                {upNext.map((b) => <BookTile key={b.id} book={b} onDetails={setDetails} />)}
              </div>
            </>
          )}

          {recent.length > 0 && (
            <>
              <div className="section-title">Recently added</div>
              <div className="shelf">
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
          <div className="list">
            <button className="row" onClick={() => navigate('/search')}>
              <Icon name="search" />
              <span className="grow">
                <span className="title">Search your books</span>
                <div className="sub">Find a word or phrase in everything you have added</div>
              </span>
              <Icon name="forward" size={18} />
            </button>
            <button className="row" onClick={() => switchTab('references')}>
              <Icon name="references" />
              <span className="grow">
                <span className="title">References</span>
                <div className="sub">{refCount ? `${refCount} saved passage${refCount === 1 ? '' : 's'}` : 'Passages you save while reading, with their citations'}</div>
              </span>
              <Icon name="forward" size={18} />
            </button>
          </div>
        </div>
      )}

      <InstallHint />
      {details && <BookDetails bookId={details} onClose={() => setDetails(null)} />}
    </div>
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
