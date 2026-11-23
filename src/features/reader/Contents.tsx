import { useEffect, useRef, useState } from 'react';
import { db, sectionId } from '../../db/db';
import type { Book, Mark } from '../../db/types';
import { timeAgo } from '../../lib/util';
import { Sheet } from '../../ui/Sheet';
import { Icon } from '../../ui/Icon';
import { PAGES_PER_SECTION } from '../../import/pdf';

interface Props {
  book: Book;
  marks: Mark[];
  current: { section: number; block: number };
  onGo: (section: number, block: number) => void;
  onEditMark: (id: string) => void;
  /** Opens a summary of the chapter being read. */
  onSummary?: () => void;
  /** A contents entry's title in English, when the English is read and it has one. */
  titleEn?: (index: number) => string | undefined;
  /** Chapters (sections) that have English. */
  englishSections?: Set<number>;
  onClose: () => void;
}

/** Finds the block carrying a page number: the PDF page, or the number printed on the page. */
export async function findPage(book: Book, wanted: string): Promise<{ section: number; block: number } | null> {
  const n = parseInt(wanted.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  if (book.format === 'pdf' && book.pageCount) {
    if (n > book.pageCount) return null;
    const section = Math.min(book.sectionCount - 1, Math.floor((n - 1) / PAGES_PER_SECTION));
    const sec = await db.sections.get(sectionId(book.id, section));
    const block = sec ? sec.blocks.findIndex((b) => (b.page ?? 0) >= n) : 0;
    return { section, block: Math.max(0, block) };
  }
  for (let s = 0; s < book.sectionCount; s++) {
    const sec = await db.sections.get(sectionId(book.id, s));
    const block = sec?.blocks.findIndex((b) => b.printed === String(n) || b.printed?.endsWith(`/${n}`)) ?? -1;
    if (block >= 0) return { section: s, block };
  }
  return null;
}

export function Contents({ book, marks, current, onGo, onEditMark, onSummary, titleEn, englishSections, onClose }: Props) {
  const [tab, setTab] = useState<'contents' | 'bookmarks' | 'notes'>('contents');
  const [page, setPage] = useState('');
  const [pageError, setPageError] = useState('');
  const currentRef = useRef<HTMLButtonElement>(null);

  const bookmarks = marks.filter((m) => m.type === 'bookmark').sort((a, b) => a.section - b.section || a.block - b.block);
  const notes = marks.filter((m) => m.type !== 'bookmark').sort((a, b) => a.section - b.section || a.block - b.block || (a.start ?? 0) - (b.start ?? 0));

  let currentIdx = -1;
  book.toc.forEach((t, i) => {
    if (t.section < current.section || (t.section === current.section && (t.block ?? 0) <= current.block)) currentIdx = i;
  });

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'center' });
  }, []);

  const go = (s: number, b: number) => {
    onGo(s, b);
    onClose();
  };
  const lang = book.lang === 'other' ? undefined : book.lang;
  const hasPages = book.format === 'pdf' || book.format === 'md' || book.format === 'txt';

  return (
    <Sheet title={book.title} onClose={onClose}>
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={tab === 'contents'} aria-pressed={tab === 'contents'} onClick={() => setTab('contents')}>Contents</button>
        <button role="tab" aria-selected={tab === 'bookmarks'} aria-pressed={tab === 'bookmarks'} onClick={() => setTab('bookmarks')}>Bookmarks{bookmarks.length ? ` · ${bookmarks.length}` : ''}</button>
        <button role="tab" aria-selected={tab === 'notes'} aria-pressed={tab === 'notes'} onClick={() => setTab('notes')}>Highlights{notes.length ? ` · ${notes.length}` : ''}</button>
      </div>

      {tab === 'contents' && (
        <>
          {onSummary && (
            <button className="btn btn--block" onClick={onSummary}>
              <span className="ai-mark" aria-hidden="true">✦</span> Summarise this chapter
            </button>
          )}
          {hasPages && (
            <form
              style={{ display: 'flex', gap: 8 }}
              onSubmit={async (e) => {
                e.preventDefault();
                setPageError('');
                const found = await findPage(book, page);
                if (found) go(found.section, found.block);
                else setPageError(book.pageCount ? `Enter a page from 1 to ${book.pageCount}.` : 'That page number isn’t marked in this book.');
              }}
            >
              <span className="field" style={{ flex: 1 }}>
                <input inputMode="numeric" value={page} onChange={(e) => setPage(e.target.value)} placeholder={book.pageCount ? `Go to page (1–${book.pageCount})` : 'Go to printed page'} aria-label="Go to page" />
              </span>
              <button className="btn" disabled={!page.trim()}>Go</button>
            </form>
          )}
          {pageError && <p className="small" role="alert" style={{ color: 'var(--rubric)' }}>{pageError}</p>}
          {book.toc.length ? (
            <div>
              {book.toc.map((t, i) => (
                <button
                  key={i}
                  ref={i === currentIdx ? currentRef : undefined}
                  className="toc-row"
                  data-level={Math.min(4, t.level)}
                  aria-current={i === currentIdx ? 'true' : undefined}
                  lang={titleEn?.(i) ? undefined : lang}
                  onClick={() => go(t.section, t.block ?? 0)}
                >
                  {titleEn?.(i) ? (
                    <span className="grow toc-two">
                      <span className="toc-en" lang="en">{titleEn(i)}</span>
                      <span className="toc-orig" dir="auto" lang={lang}>{t.title}</span>
                    </span>
                  ) : (
                    <span className="grow" dir="auto">{t.title}</span>
                  )}
                  {englishSections?.has(t.section) && <span className="toc-en-mark" title="In English">EN</span>}
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">This book has no table of contents. Use the slider at the bottom of the page, or search inside the book.</p>
          )}
        </>
      )}

      {tab === 'bookmarks' && (
        bookmarks.length ? (
          <div className="list">
            {bookmarks.map((m) => (
              <div className="row" key={m.id} style={{ padding: 0 }}>
                <button style={{ flex: 1, minWidth: 0, textAlign: 'start', padding: '10px 16px' }} onClick={() => go(m.section, m.block)}>
                  <span className="title hit-text" dir="auto">{m.text || 'Bookmark'}</span>
                  <div className="sub">{timeAgo(m.createdAt)}</div>
                </button>
                <button className="icon-btn" aria-label="Remove bookmark" onClick={() => void db.marks.delete(m.id)}><Icon name="trash" size={20} /></button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No bookmarks yet. Tap the bookmark at the top of the page to keep your place.</p>
        )
      )}

      {tab === 'notes' && (
        notes.length ? (
          <div className="list">
            {notes.map((m) => (
              <div className="row" key={m.id} style={{ padding: 0 }}>
                <button style={{ flex: 1, minWidth: 0, textAlign: 'start', padding: '10px 16px' }} onClick={() => go(m.section, m.block)}>
                  <span className="hit-text" dir="auto"><span className="hl" data-c={m.color ?? 'gold'}>{(m.text ?? '').slice(0, 220)}{(m.text ?? '').length > 220 ? '…' : ''}</span></span>
                  {m.note && <div className="sub" dir="auto" style={{ marginTop: 4 }}>{m.note}</div>}
                </button>
                <button className="icon-btn" aria-label="Edit highlight" onClick={() => { onClose(); onEditMark(m.id); }}><Icon name="edit" size={20} /></button>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No highlights yet. Press and hold on the text to select it, then choose a colour.</p>
        )
      )}
    </Sheet>
  );
}
