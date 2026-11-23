import { useCallback, useRef, useState, type ReactNode } from 'react';
import { ACCEPT, addFiles, type AddResult } from '../import';
import { requestPersistence } from '../db/db';
import { Sheet } from '../ui/Sheet';
import { toast } from '../ui/toast';
import { Icon } from '../ui/Icon';
import { db } from '../db/db';
import type { Book } from '../db/types';
import { getSetting } from './settings';
import { shelve, suggestFolder, type Suggestion } from '../library/shelving';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';

/**
 * The single way books get into the app. Every Add button opens the same file picker
 * and goes through the same queue; duplicates and unreadable files are reported plainly.
 */
/** Resolves once no book is open (at once, if none is). */
function outOfReader(): Promise<void> {
  return new Promise((resolve) => {
    const reading = () => /^#\/book\/[^/]+\/?$/.test(location.hash);
    if (!reading()) return resolve();
    const check = () => {
      if (reading()) return;
      window.removeEventListener('hashchange', check);
      // A moment after arriving, so the question is not lost in the change of screen.
      window.setTimeout(resolve, 600);
    };
    window.addEventListener('hashchange', check);
  });
}

export function useAddBooks(): { pick: (folderId?: string) => void; addDropped: (files: File[]) => void; element: ReactNode } {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<string | undefined>(undefined);
  const [review, setReview] = useState<{ results: AddResult[]; files: File[] } | null>(null);
  const [choosing, setChoosing] = useState<string[] | null>(null);

  const add = useCallback(async (files: File[], allowDuplicates = false) => {
    if (!files.length) return;
    void requestPersistence();
    const results = await addFiles(files, { allowDuplicates, folderId: folderRef.current });
    const added = results.filter((r) => r.bookId).length;
    const problems = results.filter((r) => r.duplicateOf || r.error);
    if (added) toast(added === 1 ? 'Book added. Preparing it now…' : `${added} books added. Preparing them now…`);
    if (problems.length) setReview({ results: problems, files });
    // Added from inside a folder: they are already where they belong.
    const ids = results.map((r) => r.bookId).filter((x): x is string => !!x);
    if (ids.length && !folderRef.current) void offerShelving(ids, setChoosing);
    if (ids.length) void prepareNewBooks(ids);
  }, []);

  const pick = useCallback((folderId?: string) => {
    folderRef.current = folderId;
    inputRef.current?.click();
  }, []);

  const element = (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        data-testid="add-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          void add(files);
        }}
      />
      {choosing && <ChooseFolders bookIds={choosing} onClose={() => setChoosing(null)} />}
      {review && (
        <Sheet title="Some files need a look" onClose={() => setReview(null)}>
          <div className="list">
            {review.results.map((r) => (
              <div className="row" key={r.fileName}>
                <Icon name={r.error ? 'warn' : 'info'} />
                <div className="grow">
                  <div className="title">{r.fileName}</div>
                  <div className="sub">{r.error ?? `Already in your library as “${r.duplicateOf!.title}”.`}</div>
                </div>
              </div>
            ))}
          </div>
          {review.results.some((r) => r.duplicateOf) && (
            <button
              className="btn btn--block"
              onClick={() => {
                const names = new Set(review.results.filter((r) => r.duplicateOf).map((r) => r.fileName));
                const again = review.files.filter((f) => names.has(f.name));
                setReview(null);
                void add(again, true);
              }}
            >
              Add the duplicates anyway
            </button>
          )}
          <button className="btn btn--primary btn--block" onClick={() => setReview(null)}>Done</button>
        </Sheet>
      )}
    </>
  );

  const addDropped = useCallback((files: File[]) => void add(files), [add]);
  return { pick, addDropped, element };
}

/**
 * With your AI connected, a new book is made ready to read in English before it is opened:
 * its real title and author read from its first pages (if it is still named after its file),
 * its contents put into English, and its opening translated.
 */
async function prepareNewBooks(ids: string[]): Promise<void> {
  const { aiReady } = await import('../ai/client');
  if (!(await aiReady())) return;
  await whenReady(ids);
  const { namedAfterFile, readBookInfo, applyBookInfo, translateContents } = await import('../ai/bookinfo');
  const { translatable } = await import('../ai/translation');
  const { translateAhead, isScanned } = await import('../ai/ahead');
  let opened = false;
  for (const id of ids) {
    const book = await db.books.get(id);
    if (!book || book.import.state !== 'ready') continue;
    if (namedAfterFile(book) && !book.ocr) await readBookInfo(book).then((info) => applyBookInfo(book, info)).catch(() => undefined);
    if (!translatable(book)) continue;
    const fresh = (await db.books.get(id)) ?? book;
    if (fresh.toc.length >= 2 && !fresh.tocEn) await translateContents(fresh).catch(() => undefined);
    // The opening of the first new book, so it opens in English (a scanned book's first page).
    if (!opened) {
      opened = true;
      void translateAhead(fresh, { from: { section: 0, block: 0 }, count: isScanned(fresh) ? 1 : 12 }).catch(() => undefined);
    }
  }
}

/** Waits (up to two minutes) for new books to be read, so their real titles are known. */
async function whenReady(ids: string[]): Promise<void> {
  for (let i = 0; i < 120; i++) {
    const books = await db.books.bulkGet(ids);
    if (books.every((b) => !b || b.import.state === 'ready' || b.import.state === 'failed' || b.import.state === 'missing')) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/**
 * New books: suggest a folder for each (by its subject, or with its other volumes), and
 * either ask with one tap, or put them there by themselves with an Undo, as the reader
 * chose in Settings › Library.
 */
async function offerShelving(ids: string[], choose: (ids: string[]) => void) {
  const mode = await getSetting('shelving');
  if (mode === 'off') return;
  await whenReady(ids);
  const books = (await db.books.bulkGet(ids)).filter((b): b is Book => !!b && b.import.state === 'ready' && !b.folderId);
  if (!books.length) return;
  const suggestions = await Promise.all(books.map(async (b) => ({ book: b, s: await suggestFolder(b) })));
  const sure = suggestions.filter((x): x is { book: Book; s: Suggestion } => !!x.s);
  const folders = await db.folders.toArray();
  const names = new Map(folders.map((f) => [f.id, f.name]));
  const where = (s: Suggestion) => s.newName ?? (s.folderId ? (names.get(s.folderId) ?? 'its folder') : '');
  const one = sure.length === 1 ? sure[0] : null;
  const sameFolder = sure.length > 1 && sure.every((x) => where(x.s) === where(sure[0].s));
  const label = one ? `“${one.book.title}” in ${where(one.s)}` : sameFolder ? `the ${sure.length} new books in ${where(sure[0].s)}` : `the ${sure.length} new books in their folders`;
  // Not while a book is open: the question waits until the reader leaves it.
  await outOfReader();
  const apply = () => shelve(sure.map((x) => ({ bookId: x.book.id, folderId: x.s.folderId, newName: x.s.newName })));
  const undo = () => shelve(sure.map((x) => ({ bookId: x.book.id })));

  if (mode === 'auto' && sure.length) {
    await apply();
    toast(`Put ${label}.`, [{ label: 'Undo', run: () => void undo() }, { label: 'Change', run: () => choose(books.map((b) => b.id)) }], 8000);
    return;
  }
  if (sure.length) {
    toast(`Put ${label}?`, [{ label: 'Put there', run: () => void apply().then(() => toast('Done.')) }, { label: 'Choose…', run: () => choose(books.map((b) => b.id)) }], 12000);
  } else if (folders.length) {
    toast(books.length === 1 ? `Put “${books[0].title}” in a folder?` : `Put the ${books.length} new books in folders?`, { label: 'Choose…', run: () => choose(books.map((b) => b.id)) }, 10000);
  }
}

/** One row per new book: its folder, suggested first, any other, a new one, or none. */
function ChooseFolders({ bookIds, onClose }: { bookIds: string[]; onClose: () => void }) {
  const books = useLiveQuery(() => db.books.bulkGet(bookIds), [bookIds.join()]);
  const folders = useLiveQuery(() => db.folders.orderBy('id').toArray(), []) ?? [];
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [suggested, setSuggested] = useState<Record<string, Suggestion | null>>({});
  useEffect(() => {
    void Promise.all(bookIds.map(async (id) => {
      const b = await db.books.get(id);
      return [id, b ? await suggestFolder(b) : null] as const;
    })).then((list) => setSuggested(Object.fromEntries(list)));
  }, [bookIds]);
  const valueFor = (id: string) => {
    if (picks[id] !== undefined) return picks[id];
    const s = suggested[id];
    return s?.folderId ?? (s?.newName ? `new:${s.newName}` : '');
  };
  return (
    <Sheet title="Which folder?" onClose={onClose}>
      <div className="list">
        {(books ?? []).filter(Boolean).map((b) => (
          <label className="row" key={b!.id}>
            <Icon name="book" />
            <span className="grow">
              <span className="title" dir="auto">{b!.title}</span>
              <select value={valueFor(b!.id)} onChange={(e) => setPicks({ ...picks, [b!.id]: e.target.value })} aria-label={`Folder for ${b!.title}`}>
                <option value="">No folder</option>
                {suggested[b!.id]?.newName && <option value={`new:${suggested[b!.id]!.newName}`}>New folder: {suggested[b!.id]!.newName}</option>}
                {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </span>
          </label>
        ))}
      </div>
      <button
        className="btn btn--primary btn--block"
        onClick={async () => {
          await shelve(bookIds.map((id) => {
            const v = valueFor(id);
            return v.startsWith('new:') ? { bookId: id, newName: v.slice(4) } : { bookId: id, folderId: v || undefined };
          }));
          toast('Done.');
          onClose();
        }}
      >
        Put them there
      </button>
      <p className="muted small">Change how new books are sorted in Settings › Library.</p>
    </Sheet>
  );
}
