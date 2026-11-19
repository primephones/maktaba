import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, sectionId } from '../../db/db';
import type { Book } from '../../db/types';
import { findInSharh, likelyCommentaries } from '../../library/sharh';
import { langAttr } from '../../lib/arabic';
import { navigate } from '../../app/router';
import { Sheet } from '../../ui/Sheet';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';
import { setJump } from './jump';

/** The paragraphs being read, from the one at the top of the screen (headings are passed over). */
async function textsAt(book: Book, at: { section: number; block: number }, count = 3): Promise<string[]> {
  const out: string[] = [];
  for (let s = at.section; s < book.sectionCount && out.length < count; s++) {
    const sec = await db.sections.get(sectionId(book.id, s));
    if (!sec) continue;
    for (let i = s === at.section ? at.block : 0; i < sec.blocks.length && out.length < count; i++) {
      const b = sec.blocks[i];
      if ((b.t === 'p' || b.t === 'quote') && b.text.trim().split(/\s+/).length >= 4) out.push(b.text);
    }
  }
  return out;
}

/**
 * Reading a matn, open its sharḥ where it comments on this paragraph. The commentaries are
 * chosen once from the library (likely ones first) and remembered for the book.
 */
export function SharhSheet({ book, at, onClose }: { book: Book; at: { section: number; block: number }; onClose: () => void }) {
  const linked = useLiveQuery(async () => (await db.books.bulkGet(book.commentaries ?? [])).filter((b): b is Book => !!b), [book.commentaries?.join()]) ?? [];
  const [choices, setChoices] = useState<Book[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    void likelyCommentaries(book).then(setChoices);
  }, [book]);

  const go = async (sharh: Book) => {
    setBusy(sharh.id);
    try {
      const texts = await textsAt(book, at);
      if (!texts.length) {
        toast('There is no text here to look for. Move to a paragraph and try again.');
        return;
      }
      // The paragraph being read; if the sharḥ does not quote it, the next ones.
      let place = null;
      for (const t of texts) {
        place = await findInSharh(t, sharh.id);
        if (place) break;
      }
      if (!place) {
        toast(`This passage is not quoted in “${sharh.title}”; it may comment on it in other words, or in another volume.`);
        return;
      }
      // The paragraph is lit up for a moment on arrival, so the eye finds it.
      setJump(sharh.id, { section: place.section, block: place.block, flash: [0, Math.min(place.length, 600)] });
      onClose();
      navigate(`/book/${sharh.id}`);
      toast(`In “${sharh.title}”, where it comments on this passage.`);
    } finally {
      setBusy(null);
    }
  };

  const link = async (b: Book) => {
    await db.books.update(book.id, { commentaries: [...new Set([...(book.commentaries ?? []), b.id])] });
    setChoosing(false);
    void go(b);
  };
  const unlink = (b: Book) => db.books.update(book.id, { commentaries: (book.commentaries ?? []).filter((x) => x !== b.id) });

  const others = (choices ?? []).filter((b) => !linked.some((l) => l.id === b.id));

  return (
    <Sheet title="In the commentary" onClose={onClose}>
      {linked.length > 0 && (
        <>
          <p className="muted small" style={{ margin: 0 }}>Opens the commentary where it comments on the paragraph you are reading.</p>
          <div className="list">
            {linked.map((b) => (
              <div className="row" key={b.id}>
                <button className="grow sharh-go" disabled={!!busy} onClick={() => void go(b)}>
                  <span className="title" dir="auto" lang={langAttr(b.title)}>{b.title}</span>
                  <div className="sub">{busy === b.id ? 'Finding the place…' : b.author ?? 'Open at this passage'}</div>
                </button>
                <button className="icon-btn" aria-label={`Stop using ${b.title} as a commentary`} onClick={() => void unlink(b)}><Icon name="close" size={18} /></button>
              </div>
            ))}
          </div>
        </>
      )}
      {(!linked.length || choosing) && (
        <>
          <div className="section-title">{linked.length ? 'Add another commentary' : 'Which book is its commentary (sharḥ)?'}</div>
          {others.length ? (
            <div className="list">
              {others.slice(0, 12).map((b) => (
                <button className="row" key={b.id} onClick={() => void link(b)}>
                  <Icon name="book" />
                  <span className="grow">
                    <span className="title" dir="auto" lang={langAttr(b.title)}>{b.title}</span>
                    {b.author && <div className="sub" dir="auto">{b.author}</div>}
                  </span>
                  <Icon name="forward" size={18} />
                </button>
              ))}
            </div>
          ) : (
            <p className="muted small">Add the commentary to your library first; then it can be chosen here.</p>
          )}
        </>
      )}
      {linked.length > 0 && !choosing && others.length > 0 && (
        <button className="btn btn--quiet" onClick={() => setChoosing(true)}><Icon name="plus" size={18} />Add another commentary</button>
      )}
    </Sheet>
  );
}
