import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { ATTRIBUTION, CATALOGUE, download, GROUPS, sizeOf, type CatalogueEntry } from '../../library/catalogue';
import { goBack, navigate } from '../../app/router';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';

/**
 * The book catalogue: the six books of ḥadīth with their commentaries (classical, and the
 * Deobandi and Indian Ḥanafī ones), and the main works of Ḥanafī fiqh with theirs. One tap
 * downloads a book into the library.
 */
export function Catalogue() {
  const have = useLiveQuery(async () => new Map((await db.books.toArray()).filter((b) => b.catalogueId).map((b) => [b.catalogueId!, b] as const)), []) ?? new Map();
  const [busy, setBusy] = useState<Record<string, number>>({});

  useEffect(() => {
    document.title = 'Book catalogue · Maktaba';
  }, []);

  const add = async (e: CatalogueEntry) => {
    setBusy((b) => ({ ...b, [e.id]: 0 }));
    try {
      await download(e, (done, total) => setBusy((b) => ({ ...b, [e.id]: total ? Math.min(0.99, done / total) : 0 })));
      toast(`“${e.en}” is in your library. It is being prepared now.`);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy((b) => {
        const n = { ...b };
        delete n[e.id];
        return n;
      });
    }
  };

  return (
    <div className="screen screen--plain">
      <div className="screen-head screen-head--sub">
        <button className="icon-btn" onClick={() => goBack('/library')} aria-label="Back"><Icon name="back" /></button>
        <h1>Book catalogue</h1>
      </div>
      <div className="settings-page">
        <p className="muted small" style={{ marginTop: 0 }}>
          Classical works, free to download. Each comes into your library like any other book, to read, search and translate. A commentary is linked to the book it explains, so <b>More › In the commentary</b> takes you from a ḥadīth or a ruling straight to where it is explained.
        </p>
        {GROUPS.map((g) => (
          <div key={g.id}>
            <div className="section-title">{g.title}</div>
            <div className="list">
              {CATALOGUE.filter((e) => e.group === g.id).map((e) => {
                const book = have.get(e.id);
                const progress = busy[e.id];
                return (
                  <div className="row cat-row" key={e.id}>
                    <span className="grow">
                      <span className="cat-ar" lang="ar" dir="rtl">{e.ar}</span>
                      <span className="title">{e.en}</span>
                      <div className="sub"><span lang="ar" dir="rtl">{e.authorAr.replace(/\s*\(.*$/, '')}</span> · d. {e.died} AH · {sizeOf(e)}</div>
                    </span>
                    {book ? (
                      <button className="btn btn--quiet cat-btn" onClick={() => navigate(`/book/${book.id}`)}>Open</button>
                    ) : progress !== undefined ? (
                      <span className="cat-progress" role="status" aria-label={`Downloading ${e.en}`}>{Math.round(progress * 100)}%</span>
                    ) : (
                      <button className="btn cat-btn" onClick={() => void add(e)} aria-label={`Add ${e.en}`}><Icon name="download" size={18} />Add</button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <p className="muted small">{ATTRIBUTION} Larger works (Fatḥ al-Bārī, Radd al-Muḥtār) take a while to prepare after downloading; reading can begin as soon as they appear.</p>
      </div>
    </div>
  );
}
