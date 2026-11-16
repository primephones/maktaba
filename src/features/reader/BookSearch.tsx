import { useEffect, useState } from 'react';
import type { Book } from '../../db/types';
import { normalizeForSearch } from '../../lib/arabic';
import { searchBook, type TextHit } from '../../lib/search';
import { Sheet } from '../../ui/Sheet';
import { Icon } from '../../ui/Icon';

const memory = new Map<string, string>();

export function BookSearch({ book, onGo, onClose }: { book: Book; onGo: (hit: TextHit) => void; onClose: () => void }) {
  const [query, setQuery] = useState(() => memory.get(book.id) ?? '');
  const [hits, setHits] = useState<TextHit[]>([]);
  const [busy, setBusy] = useState(false);
  const norm = normalizeForSearch(query.trim());

  useEffect(() => {
    memory.set(book.id, query);
    setHits([]);
    if (norm.length < 2) {
      setBusy(false);
      return;
    }
    const ctrl = new AbortController();
    setBusy(true);
    const timer = window.setTimeout(() => {
      void searchBook(book, query, { limit: 200, signal: ctrl.signal, onHits: (h) => !ctrl.signal.aborted && setHits((prev) => [...prev, ...h]) }).then(() => {
        if (!ctrl.signal.aborted) setBusy(false);
      });
    }, 250);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [norm, book.id]);

  return (
    <Sheet title="Search in this book" onClose={onClose}>
      <div className="field">
        <Icon name="search" size={20} />
        <input autoFocus type="search" enterKeyHint="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Word or phrase" aria-label="Search in this book" dir="auto" />
        {query && <button className="icon-btn" aria-label="Clear" onClick={() => setQuery('')}><Icon name="close" size={20} /></button>}
      </div>
      {book.kind === 'scan' && <p className="muted small">This is a scanned book. Its pages are images, so there is no text to search yet.</p>}
      {norm.length >= 2 && (
        <p className="muted small" aria-live="polite">
          {busy ? `Searching… ${hits.length} so far` : hits.length ? `${hits.length}${hits.length >= 200 ? '+' : ''} match${hits.length === 1 ? '' : 'es'}` : 'No matches in this book.'}
        </p>
      )}
      {hits.length > 0 && (
        <div className="list">
          {hits.map((h, i) => (
            <button className="row" key={i} onClick={() => { onGo(h); onClose(); }}>
              <span className="grow">
                <span className="hit-text" dir="auto">{h.before}<mark>{h.match}</mark>{h.after}</span>
                <div className="sub" dir="auto">{h.sectionTitle}{h.printed ? `, p. ${h.printed}` : ''}</div>
              </span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
