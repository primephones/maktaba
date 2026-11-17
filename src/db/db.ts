import Dexie, { type Table } from 'dexie';
import type {
  AssetRecord, Book, CoverRecord, FileRecord, Folder, Mark, OcrPage, OutboxEntry, Reference, Section, SettingRecord, Translation,
} from './types';

/**
 * Everything lives on the device in IndexedDB, so the whole app works offline and an
 * update installed over the old version keeps the library.
 */
export class MaktabaDB extends Dexie {
  books!: Table<Book, string>;
  sections!: Table<Section, string>;
  files!: Table<FileRecord, string>;
  covers!: Table<CoverRecord, string>;
  assets!: Table<AssetRecord, string>;
  folders!: Table<Folder, string>;
  marks!: Table<Mark, string>;
  refs!: Table<Reference, string>;
  settings!: Table<SettingRecord, string>;
  ocrPages!: Table<OcrPage, string>;
  translations!: Table<Translation, string>;
  outbox!: Table<OutboxEntry, string>;

  constructor() {
    super('maktaba');
    this.version(1).stores({
      books: 'id, hash, addedAt, openedAt, folderId, status, lang, series',
      sections: 'id, bookId, [bookId+idx]',
      files: 'bookId',
      covers: 'bookId',
      assets: 'id, bookId',
      folders: 'id, parentId',
      marks: 'id, bookId, type, [bookId+section], createdAt',
      refs: 'id, bookId, createdAt',
      settings: 'key',
    });
    // Version 2: recognised text of scanned pages.
    this.version(2).stores({
      ocrPages: 'id, bookId, [bookId+page]',
    });
    // Version 3: English translations, paragraph by paragraph.
    this.version(3).stores({
      translations: 'id, bookId, [bookId+section]',
    });
    // Version 4: changes waiting to sync to the user's other phones.
    this.version(4).stores({
      outbox: 'k, at',
    });
  }
}

export const db = new MaktabaDB();

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const sectionId = (bookId: string, idx: number) => `${bookId}:${idx}`;

/** Removes a book and everything stored for it. */
export async function deleteBook(bookId: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.books, db.sections, db.files, db.covers, db.assets, db.marks, db.refs, db.ocrPages, db.translations],
    async () => {
      await db.translations.where('bookId').equals(bookId).delete();
      await db.ocrPages.where('bookId').equals(bookId).delete();
      await db.sections.where('bookId').equals(bookId).delete();
      await db.assets.where('bookId').equals(bookId).delete();
      await db.marks.where('bookId').equals(bookId).delete();
      await db.refs.where('bookId').equals(bookId).delete();
      await db.files.delete(bookId);
      await db.covers.delete(bookId);
      await db.books.delete(bookId);
    },
  );
}

/** Asks the browser not to evict the library when storage is tight. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {
    /* not supported */
  }
  return false;
}
