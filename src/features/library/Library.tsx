import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, uid } from '../../db/db';
import type { Book, Folder, Lang } from '../../db/types';
import { langAttr, langName } from '../../lib/arabic';
import { percent } from '../../lib/util';
import { goBack, navigate } from '../../app/router';
import { useApp } from '../../app/AppContext';
import { setSetting, useSetting, type Settings } from '../../app/settings';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/Sheet';
import { toast } from '../../ui/toast';
import { BookCover } from './BookCover';
import { BookDetails } from './BookDetails';

type Filter = 'all' | 'reading' | 'unread' | 'finished' | Lang;
const SORTS: Array<[Settings['librarySort'], string]> = [
  ['recent', 'Recently opened'], ['added', 'Recently added'], ['title', 'Title'], ['author', 'Author'], ['progress', 'Progress'],
];

export function openBook(book: Book, showDetails: (id: string) => void) {
  if (book.import.state === 'ready') navigate(`/book/${book.id}`);
  else showDetails(book.id);
}

function sortBooks(books: Book[], sort: Settings['librarySort']): Book[] {
  const by: Record<Settings['librarySort'], (a: Book, b: Book) => number> = {
    recent: (a, b) => (b.openedAt ?? b.addedAt) - (a.openedAt ?? a.addedAt),
    added: (a, b) => b.addedAt - a.addedAt,
    title: (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }),
    author: (a, b) => (a.author || '￿').localeCompare(b.author || '￿') || a.title.localeCompare(b.title),
    progress: (a, b) => (b.progress?.fraction ?? 0) - (a.progress?.fraction ?? 0),
  };
  return [...books].sort(by[sort]);
}

interface Shelf {
  key: string;
  book: Book;
  /** Present when this tile stands for several volumes of one work. */
  volumes?: Book[];
}

/** Volumes of the same work are shelved as one stack. */
function shelve(books: Book[]): Shelf[] {
  const groups = new Map<string, Book[]>();
  for (const b of books) {
    if (b.series && b.volume !== undefined) {
      const key = `${b.series.toLowerCase()}|${b.author.toLowerCase()}`;
      groups.set(key, [...(groups.get(key) ?? []), b]);
    }
  }
  const seen = new Set<string>();
  const out: Shelf[] = [];
  for (const b of books) {
    const key = b.series && b.volume !== undefined ? `${b.series.toLowerCase()}|${b.author.toLowerCase()}` : '';
    const group = key ? groups.get(key)! : [];
    if (group.length >= 2) {
      if (seen.has(key)) continue;
      seen.add(key);
      const volumes = [...group].sort((x, y) => (x.volume ?? 0) - (y.volume ?? 0));
      out.push({ key, book: volumes[0], volumes });
    } else out.push({ key: b.id, book: b });
  }
  return out;
}

export function BookTile({ book, onDetails, volumes, onStack }: { book: Book; onDetails: (id: string) => void; volumes?: Book[]; onStack?: () => void }) {
  const fraction = volumes
    ? volumes.reduce((n, v) => n + (v.progress?.fraction ?? 0), 0) / volumes.length
    : book.progress?.fraction ?? 0;
  const title = volumes ? book.series! : book.title;
  return (
    <div className="tile">
      <button
        className="tile-cover"
        onClick={() => (volumes ? onStack?.() : openBook(book, onDetails))}
        aria-label={volumes ? `${title}, ${volumes.length} volumes` : `Open ${book.title}`}
      >
        {volumes ? (
          <span className="vol-stack">
            <BookCover book={book} />
            <span className="stack-count">{volumes.length} vols</span>
          </span>
        ) : (
          <BookCover book={book} />
        )}
      </button>
      <div className="tile-row">
        <div className="tile-meta">
          <span className="tile-title" lang={langAttr(title)} dir="auto">{title}</span>
          {book.author && <span className="tile-sub" lang={langAttr(book.author)} dir="auto">{book.author}</span>}
          <span className="tile-progress">
            <span className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)} aria-label="Reading progress">
              <i style={{ width: percent(fraction) }} />
            </span>
            {percent(fraction)}
          </span>
        </div>
        {!volumes && (
          <button className="tile-more" aria-label={`Details for ${book.title}`} onClick={() => onDetails(book.id)}>
            <Icon name="more" size={20} />
          </button>
        )}
      </div>
    </div>
  );
}

export function Library({ folderId }: { folderId?: string }) {
  const { addBooks } = useApp();
  const books = useLiveQuery(() => db.books.toArray(), []);
  const folders = useLiveQuery(() => db.folders.toArray(), []) ?? [];
  const sort = useSetting('librarySort');
  const [filter, setFilter] = useState<Filter>('all');
  const [details, setDetails] = useState<string | null>(null);
  const [stack, setStack] = useState<Book[] | null>(null);
  const [menu, setMenu] = useState<null | 'menu' | 'sort' | 'newFolder' | 'renameFolder' | 'deleteFolder'>(null);

  const foldersLoaded = useLiveQuery(() => db.folders.count().then(() => true), []) ?? false;
  const folder = folderId ? folders.find((f) => f.id === folderId) : undefined;
  const subfolders = folders.filter((f) => (f.parentId ?? undefined) === folderId).sort((a, b) => a.name.localeCompare(b.name));

  const here = useMemo(() => (books ?? []).filter((b) => (b.folderId ?? undefined) === folderId), [books, folderId]);
  const langs = useMemo(() => [...new Set(here.map((b) => b.lang))].filter((l) => l !== 'other'), [here]);

  const shelves = useMemo(() => {
    const match = (b: Book) => {
      switch (filter) {
        case 'all': return true;
        case 'reading': return b.status === 'reading';
        case 'unread': return b.status === 'want';
        case 'finished': return b.status === 'finished';
        default: return b.lang === filter;
      }
    };
    return shelve(sortBooks(here.filter(match), sort));
  }, [here, filter, sort]);

  const countIn = (f: Folder): number => {
    const ids = new Set<string>([f.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const x of folders) if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) { ids.add(x.id); grew = true; }
    }
    return (books ?? []).filter((b) => b.folderId && ids.has(b.folderId)).length;
  };

  if (folderId && books && foldersLoaded && !folder) {
    return (
      <div className="screen">
        <div className="screen-head screen-head--sub">
          <button className="icon-btn" onClick={() => goBack('/library')} aria-label="Back"><Icon name="back" /></button>
          <h1>Folder</h1>
        </div>
        <EmptyState icon="folder" title="This folder was removed">Its books are back in the Library.</EmptyState>
      </div>
    );
  }

  const loading = books === undefined;
  const nothingAtAll = !loading && (books?.length ?? 0) === 0 && folders.length === 0;

  return (
    <div className="screen">
      <div className={`screen-head${folderId ? ' screen-head--sub' : ''}`}>
        {folderId && <button className="icon-btn" onClick={() => goBack('/library')} aria-label="Back"><Icon name="back" /></button>}
        <h1 dir={folderId ? 'auto' : undefined}>{folderId ? folder?.name ?? '' : <>Library<span className="ar" lang="ar">مكتبة</span></>}</h1>
        <button className="icon-btn" onClick={() => setMenu('menu')} aria-label="Library options"><Icon name="more" /></button>
      </div>

      {!folderId && !nothingAtAll && (
        <button className="search-entry" onClick={() => navigate('/search')}>
          <Icon name="search" size={20} />
          Search your books…
        </button>
      )}

      {nothingAtAll ? (
        <EmptyState icon="library" title="Your library is empty" action={<button className="btn btn--primary" onClick={() => addBooks()}><Icon name="plus" size={20} />Add a book</button>}>
          Add a PDF, EPUB, Word or text file from your phone. Maktaba prepares it and keeps it for offline reading.
        </EmptyState>
      ) : (
        <>
          {here.length > 0 && (
            <div className="chips" role="group" aria-label="Show">
              {([['all', 'All'], ['reading', 'In progress'], ['unread', 'Unread'], ['finished', 'Finished']] as Array<[Filter, string]>).map(([value, label]) => (
                <button key={value} className="chip" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>
              ))}
              {langs.length > 1 && langs.map((l) => (
                <button key={l} className="chip" aria-pressed={filter === l} onClick={() => setFilter(l)}>{langName(l)}</button>
              ))}
            </div>
          )}

          {subfolders.length > 0 && (
            <div className="folders">
              {subfolders.map((f) => (
                <button key={f.id} className="folder" onClick={() => navigate(`/library/folder/${f.id}`)}>
                  <Icon name="folder" />
                  <span style={{ minWidth: 0 }}>
                    <span className="name" style={{ display: 'block' }} dir="auto">{f.name}</span>
                    <span className="count">{countIn(f)} book{countIn(f) === 1 ? '' : 's'}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {shelves.length > 0 ? (
            <div className="grid">
              {shelves.map((s) => (
                <BookTile key={s.key} book={s.book} volumes={s.volumes} onDetails={setDetails} onStack={() => setStack(s.volumes!)} />
              ))}
            </div>
          ) : !loading && here.length === 0 ? (
            <EmptyState icon="book" title={folderId ? 'No books in this folder' : 'No books here yet'} action={<button className="btn btn--primary" onClick={() => addBooks(folderId)}><Icon name="plus" size={20} />Add a book{folderId ? ' here' : ''}</button>}>
              {folderId ? 'Add a book straight into this folder, or move one here from its details.' : 'Your books are inside the folders above.'}
            </EmptyState>
          ) : !loading ? (
            <EmptyState icon="search" title="Nothing matches" action={<button className="btn" onClick={() => setFilter('all')}>Show all books</button>}>
              No books here fit that filter.
            </EmptyState>
          ) : null}
        </>
      )}

      {details && <BookDetails bookId={details} onClose={() => setDetails(null)} />}

      {stack && (
        <Sheet title={stack[0].series ?? 'Volumes'} onClose={() => setStack(null)}>
          <div className="grid" style={{ marginTop: 0 }}>
            {stack.map((b) => {
              const live = (books ?? []).find((x) => x.id === b.id) ?? b;
              return (
                <div className="tile" key={b.id}>
                  <button className="tile-cover" onClick={() => { setStack(null); openBook(live, setDetails); }} aria-label={`Open volume ${b.volume}`}>
                    <BookCover book={live} />
                  </button>
                  <div className="tile-row">
                    <div className="tile-meta">
                      <span className="tile-title">Volume {b.volume}</span>
                      <span className="tile-progress"><span className="meter"><i style={{ width: percent(live.progress?.fraction) }} /></span>{percent(live.progress?.fraction)}</span>
                    </div>
                    <button className="tile-more" aria-label={`Details for volume ${b.volume}`} onClick={() => { setStack(null); setDetails(b.id); }}><Icon name="more" size={20} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </Sheet>
      )}

      {menu === 'menu' && (
        <Sheet title={folderId ? folder?.name ?? 'Folder' : 'Library'} onClose={() => setMenu(null)}>
          <div className="list">
            <button className="row" onClick={() => setMenu('sort')}>
              <Icon name="sort" />
              <span className="grow title">Sort by</span>
              <span className="value">{SORTS.find(([v]) => v === sort)?.[1]}</span>
            </button>
            <button className="row" onClick={() => setMenu('newFolder')}>
              <Icon name="folderPlus" />
              <span className="grow title">{folderId ? 'New folder inside this one' : 'New folder'}</span>
            </button>
            {folderId && (
              <>
                <button className="row" onClick={() => setMenu('renameFolder')}>
                  <Icon name="edit" />
                  <span className="grow title">Rename this folder</span>
                </button>
                <button className="row btn--danger" onClick={() => setMenu('deleteFolder')}>
                  <Icon name="trash" />
                  <span className="grow">
                    <span className="title">Delete this folder</span>
                    <div className="sub">Its books are kept and move up a level.</div>
                  </span>
                </button>
              </>
            )}
            {!folderId && (
              <button className="row" onClick={() => { setMenu(null); navigate('/settings'); }}>
                <Icon name="settings" />
                <span className="grow title">Settings</span>
              </button>
            )}
          </div>
        </Sheet>
      )}

      {menu === 'sort' && (
        <Sheet title="Sort by" onClose={() => setMenu(null)}>
          <div className="list">
            {SORTS.map(([value, label]) => (
              <button key={value} className="row" onClick={() => { void setSetting('librarySort', value); setMenu(null); }}>
                <span className="grow title">{label}</span>
                {sort === value && <Icon name="check" />}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {(menu === 'newFolder' || menu === 'renameFolder') && (
        <FolderName
          title={menu === 'newFolder' ? 'New folder' : 'Rename folder'}
          initial={menu === 'renameFolder' ? folder?.name ?? '' : ''}
          onClose={() => setMenu(null)}
          onSave={async (name) => {
            if (menu === 'newFolder') await db.folders.add({ id: uid(), name, parentId: folderId, createdAt: Date.now() });
            else if (folderId) await db.folders.update(folderId, { name });
            setMenu(null);
          }}
        />
      )}

      {menu === 'deleteFolder' && folder && (
        <Sheet title="Delete this folder?" onClose={() => setMenu(null)}>
          <p>“{folder.name}” will be deleted. The books and folders inside it are kept and move up to {folder.parentId ? 'the folder above' : 'the Library'}.</p>
          <button
            className="btn btn--primary btn--block"
            onClick={async () => {
              await db.transaction('rw', db.books, db.folders, async () => {
                await db.books.where('folderId').equals(folder.id).modify({ folderId: folder.parentId });
                await db.folders.where('parentId').equals(folder.id).modify({ parentId: folder.parentId });
                await db.folders.delete(folder.id);
              });
              setMenu(null);
              toast('Folder deleted. Its books were kept.');
              goBack('/library');
            }}
          >
            Delete folder, keep books
          </button>
          <button className="btn btn--block" onClick={() => setMenu(null)}>Cancel</button>
        </Sheet>
      )}
    </div>
  );
}

function FolderName({ title, initial, onSave, onClose }: { title: string; initial: string; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const ok = name.trim().length > 0;
  return (
    <Sheet title={title} onClose={onClose}>
      <form
        style={{ display: 'grid', gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onSave(name.trim());
        }}
      >
        <label className="stack">
          Folder name
          <span className="field"><input autoFocus value={name} onChange={(e) => setName(e.target.value)} dir="auto" placeholder="e.g. Uṣūl al-fiqh" /></span>
        </label>
        <button className="btn btn--primary btn--block" disabled={!ok}>Save</button>
      </form>
    </Sheet>
  );
}
