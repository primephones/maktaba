import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { Book } from '../../db/types';
import { normalizeForSearch } from '../../lib/arabic';
import { searchBook, type TextHit } from '../../lib/search';
import { goBack, navigate } from '../../app/router';
import { useApp } from '../../app/AppContext';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { setJump } from '../reader/jump';

const PER_BOOK = 4;

/** Search across the whole library: titles, saved references and the text of every book. */
export function Search() {
  const { addBooks } = useApp();
  const books = useLiveQuery(() => db.books.toArray(), []);
  const refs = useLiveQuery(() => db.refs.toArray(), []) ?? [];
  const [query, setQuery] = useState(() => sessionStorage.getItem('maktaba.search') ?? '');
  const [hits, setHits] = useState<Map<string, TextHit[]>>(new Map());
  const [state, setState] = useState<{ busy: boolean; done: number; total: number }>({ busy: false, done: 0, total: 0 });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const q = query.trim();
  const norm = normalizeForSearch(q);
  const ready = useMemo(() => (books ?? []).filter((b) => b.import.state === 'ready'), [books]);
  const readyKey = ready.map((b) => b.id).join(',');

  useEffect(() => {
    sessionStorage.setItem('maktaba.search', query);
  }, [query]);

  useEffect(() => {
    setHits(new Map());
    setExpanded(new Set());
    if (norm.length < 2 || !ready.length) {
      setState({ busy: false, done: 0, total: 0 });
      return;
    }
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      const searchable = ready.filter((b) => b.kind === 'text');
      setState({ busy: true, done: 0, total: searchable.length });
      for (let i = 0; i < searchable.length; i++) {
        if (ctrl.signal.aborted) return;
        const book = searchable[i];
        const found = await searchBook(book, q, { limit: 60, signal: ctrl.signal });
        if (ctrl.signal.aborted) return;
        if (found.length) setHits((prev) => new Map(prev).set(book.id, found));
        setState({ busy: i < searchable.length - 1, done: i + 1, total: searchable.length });
      }
      setState((s) => ({ ...s, busy: false }));
    }, 280);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [norm, readyKey]);

  const titleMatches = useMemo(
    () => (norm ? (books ?? []).filter((b) => normalizeForSearch(`${b.title} ${b.author}`).includes(norm)) : []),
    [books, norm],
  );
  const refMatches = useMemo(
    () => (norm.length >= 2 ? refs.filter((r) => normalizeForSearch(`${r.original} ${r.note ?? ''} ${r.proves ?? ''}`).includes(norm)).slice(0, 8) : []),
    [refs, norm],
  );
  const bookById = useMemo(() => new Map((books ?? []).map((b) => [b.id, b] as const)), [books]);
  const open = (h: { bookId: string; section: number; block: number; start?: number; end?: number }) => {
    setJump(h.bookId, { section: h.section, block: h.block, flash: h.start !== undefined && h.end !== undefined ? [h.start, h.end] : undefined });
    navigate(`/book/${h.bookId}`);
  };

  const totalHits = [...hits.values()].reduce((n, h) => n + h.length, 0);
  const scans = ready.filter((b) => b.kind === 'scan').length;
  const nothing = norm.length >= 2 && !state.busy && !titleMatches.length && !refMatches.length && totalHits === 0;

  return (
    <div className="screen screen--plain">
      <div className="screen-head screen-head--sub">
        <button className="icon-btn" onClick={() => goBack()} aria-label="Back"><Icon name="back" /></button>
        <h1>Search</h1>
      </div>

      {books !== undefined && books.length === 0 ? (
        <EmptyState icon="search" title="Add a book first" action={<button className="btn btn--primary" onClick={() => addBooks()}><Icon name="plus" size={20} />Add a book</button>}>
          Search looks through the books in your library. Add one and it will be searchable here.
        </EmptyState>
      ) : (
        <>
          <div className="field">
            <Icon name="search" size={20} />
            <input
              ref={inputRef}
              autoFocus
              type="search"
              enterKeyHint="search"
              inputMode="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your books…"
              aria-label="Search your books"
              dir="auto"
            />
            {query && (
              <button className="icon-btn" aria-label="Clear search" onClick={() => { setQuery(''); inputRef.current?.focus(); }}>
                <Icon name="close" size={20} />
              </button>
            )}
          </div>

          {!q && (
            <p className="muted small" style={{ marginTop: 14 }}>
              Type a word or phrase in Arabic, Urdu, Persian or English. Arabic search ignores vowel marks and spelling variants such as أ / ا, ة / ه and ى / ي.
            </p>
          )}
          {q && norm.length < 2 && <p className="muted small" style={{ marginTop: 14 }}>Type at least two letters.</p>}

          {titleMatches.length > 0 && (
            <>
              <div className="section-title">Books</div>
              <div className="list">
                {titleMatches.slice(0, 6).map((b) => (
                  <button className="row" key={b.id} onClick={() => b.import.state === 'ready' && navigate(`/book/${b.id}`)}>
                    <Icon name="book" />
                    <span className="grow">
                      <span className="title" dir="auto">{b.title}</span>
                      {b.author && <div className="sub" dir="auto">{b.author}</div>}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {refMatches.length > 0 && (
            <>
              <div className="section-title">Saved references</div>
              <div className="list">
                {refMatches.map((r) => (
                  <button className="row" key={r.id} onClick={() => open({ bookId: r.bookId, section: r.section, block: r.block, start: r.start, end: r.end })}>
                    <Icon name="references" />
                    <span className="grow">
                      <span className="title hit-text" dir="auto">{r.original.slice(0, 140)}{r.original.length > 140 ? '…' : ''}</span>
                      <div className="sub" dir="auto">{r.citation.book}{r.citation.page ? ` · p. ${r.citation.page}` : ''}</div>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {norm.length >= 2 && (state.busy || totalHits > 0) && (
            <div className="section-title" aria-live="polite">
              {state.busy ? `In the text · searching ${state.done + 1} of ${state.total}` : `In the text · ${totalHits} match${totalHits === 1 ? '' : 'es'}`}
            </div>
          )}

          {[...hits.entries()].map(([bookId, list]) => {
            const book: Book | undefined = bookById.get(bookId);
            if (!book) return null;
            const shown = expanded.has(bookId) ? list : list.slice(0, PER_BOOK);
            return (
              <div key={bookId} style={{ marginBottom: 16 }}>
                <div className="hit-book" dir="auto">{book.title}<span className="muted"> · {list.length}{list.length >= 60 ? '+' : ''}</span></div>
                <div className="list">
                  {shown.map((h, i) => (
                    <button className="row" key={i} onClick={() => open(h)}>
                      <span className="grow">
                        <span className="hit-text" dir="auto">{h.before}<mark>{h.match}</mark>{h.after}</span>
                        <div className="sub" dir="auto">{h.sectionTitle}{h.printed ? ` · p. ${h.printed}` : ''}</div>
                      </span>
                    </button>
                  ))}
                  {list.length > PER_BOOK && !expanded.has(bookId) && (
                    <button className="row" onClick={() => setExpanded((s) => new Set(s).add(bookId))}>
                      <span className="grow title" style={{ color: 'var(--slate)' }}>Show {list.length - PER_BOOK} more in this book</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {nothing && (
            <EmptyState icon="search" title="No matches">
              Nothing in your books matches “{q}”.{scans ? ` ${scans} scanned book${scans === 1 ? ' is' : 's are'} not searchable until text recognition is added.` : ''}
            </EmptyState>
          )}
        </>
      )}
    </div>
  );
}
