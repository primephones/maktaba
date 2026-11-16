import type { Block, Book, TocEntry } from '../db/types';

export interface DraftSection {
  title: string;
  blocks: Block[];
  notes?: Record<string, string>;
}

/** What an importer hands back for formats that are parsed in one go. */
export interface ParsedBook {
  title?: string;
  author?: string;
  edition?: string;
  sections: DraftSection[];
  toc: TocEntry[];
  cover?: Blob;
  assets?: Map<string, Blob>;
}

/** Services the import queue gives to importers that write as they go (PDF). */
export interface ImportContext {
  book: Book;
  file: Blob;
  /** Sections already saved by an earlier, interrupted run. */
  resumeSections: number;
  putSection(idx: number, section: DraftSection): Promise<void>;
  setCover(blob: Blob): Promise<void>;
  patch(update: Partial<Book>): Promise<void>;
  progress(done: number, total: number, stage: string): Promise<void>;
  /** True when the user removed the book mid-import. */
  cancelled(): boolean;
}
