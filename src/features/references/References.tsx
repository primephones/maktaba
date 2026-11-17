import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { Reference } from '../../db/types';
import { detectLang, langAttr } from '../../lib/arabic';
import { citationParts, formatCitation } from '../../lib/citation';
import { navigate, switchTab } from '../../app/router';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/Sheet';
import { toast } from '../../ui/toast';
import { setJump } from '../reader/jump';

/** The citation set the way a footnote is: author, title in italics, then the place. */
function Citation({ c }: { c: Reference['citation'] }) {
  const p = citationParts(c);
  return (
    <p className="ref-cite" dir={p.rtl ? 'rtl' : 'ltr'} lang={p.rtl ? langAttr(p.title) : undefined}>
      {p.author && <>{p.author}{p.sep}</>}
      <cite>{p.title}</cite>
      {p.rest.map((t, i) => <span key={i}>{p.sep}{t}</span>)}
    </p>
  );
}

export function References() {
  const refs = useLiveQuery(() => db.refs.orderBy('createdAt').reverse().toArray(), []);
  const bookCount = useLiveQuery(() => db.books.count(), []) ?? 0;
  const [editing, setEditing] = useState<Reference | null>(null);
  const [bookFilter, setBookFilter] = useState<string | null>(null);

  const books = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of refs ?? []) if (!seen.has(r.bookId)) seen.set(r.bookId, r.citation.book);
    return [...seen];
  }, [refs]);
  const shown = (refs ?? []).filter((r) => !bookFilter || r.bookId === bookFilter);

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>References<span className="ar" lang="ar">مراجع</span></h1>
      </div>

      {refs !== undefined && refs.length === 0 ? (
        <EmptyState
          icon="references"
          title="No saved references yet"
          action={<button className="btn btn--primary" onClick={() => switchTab('library')}>{bookCount ? 'Open a book' : 'Go to the Library'}</button>}
        >
          While reading, select a passage and tap <b>Save as reference</b>. It is kept here with its exact citation.
        </EmptyState>
      ) : (
        <>
          {books.length > 1 && (
            <div className="chips" role="group" aria-label="Filter by book">
              <button className="chip" aria-pressed={!bookFilter} onClick={() => setBookFilter(null)}>All books</button>
              {books.map(([id, title]) => (
                <button key={id} className="chip" aria-pressed={bookFilter === id} onClick={() => setBookFilter(id)} dir="auto">{title.length > 28 ? `${title.slice(0, 27)}…` : title}</button>
              ))}
            </div>
          )}
          <div className="refs">
            {shown.map((r) => {
              const lang = detectLang(r.original);
              return (
                <article className="card ref" key={r.id}>
                  <button
                    className="ref-quote"
                    lang={lang === 'other' ? undefined : lang}
                    dir="auto"
                    onClick={() => {
                      setJump(r.bookId, { section: r.section, block: r.block, flash: r.start !== undefined && r.end !== undefined ? [r.start, r.end] : undefined });
                      navigate(`/book/${r.bookId}`);
                    }}
                    aria-label="Open this passage in the book"
                  >
                    {r.original}
                  </button>
                  {r.english && <p className="ref-english" lang="en">{r.english.replace(/†/g, '')}</p>}
                  <Citation c={r.citation} />
                  {r.proves && <p className="ref-proves"><b>What it proves:</b> {r.proves}</p>}
                  {r.note && <p className="ref-note" dir="auto">{r.note}</p>}
                  <div className="ref-actions">
                    <button className="btn btn--quiet" onClick={() => setEditing(r)}><Icon name="edit" size={18} />{r.note || r.proves ? 'Edit' : 'Add note'}</button>
                    <button
                      className="btn btn--quiet"
                      onClick={async () => {
                        const text = `${r.original}\n— ${formatCitation(r.citation)}`;
                        try {
                          await navigator.clipboard.writeText(text);
                          toast('Copied with its citation.');
                        } catch {
                          toast('Copying isn’t allowed here.');
                        }
                      }}
                    >
                      <Icon name="copy" size={18} />Copy
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      {editing && <EditReference reference={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditReference({ reference, onClose }: { reference: Reference; onClose: () => void }) {
  const [proves, setProves] = useState(reference.proves ?? '');
  const [note, setNote] = useState(reference.note ?? '');
  const [page, setPage] = useState(reference.citation.page ?? '');
  const [chapter, setChapter] = useState(reference.citation.chapter ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async () => {
    await db.refs.update(reference.id, {
      proves: proves.trim() || undefined,
      note: note.trim() || undefined,
      citation: { ...reference.citation, page: page.trim() || undefined, chapter: chapter.trim() || undefined },
      updatedAt: Date.now(),
    });
    onClose();
  };

  return (
    <Sheet title="Reference" onClose={onClose}>
      <label className="stack">
        What it proves
        <span className="field"><textarea rows={2} value={proves} onChange={(e) => setProves(e.target.value)} dir="auto" placeholder="The point this passage establishes" /></span>
      </label>
      <label className="stack">
        Your note
        <span className="field"><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} dir="auto" /></span>
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10 }}>
        <label className="stack">
          Chapter
          <span className="field"><input value={chapter} onChange={(e) => setChapter(e.target.value)} dir="auto" /></span>
        </label>
        <label className="stack">
          Page
          <span className="field"><input value={page} onChange={(e) => setPage(e.target.value)} inputMode="numeric" /></span>
        </label>
      </div>
      <button className="btn btn--primary btn--block" onClick={() => void save()}>Save</button>
      {confirmDelete ? (
        <button
          className="btn btn--block btn--danger"
          onClick={async () => {
            await db.refs.delete(reference.id);
            toast('Reference deleted.');
            onClose();
          }}
        >
          Yes, delete this reference
        </button>
      ) : (
        <button className="btn btn--quiet btn--danger" onClick={() => setConfirmDelete(true)}><Icon name="trash" size={18} />Delete reference</button>
      )}
    </Sheet>
  );
}
