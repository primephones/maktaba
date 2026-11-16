/** Core data model. Every imported format is normalised into Book → Section → Block. */

export type Lang = 'ar' | 'ur' | 'fa' | 'en' | 'other';
export type BookFormat = 'epub' | 'pdf' | 'txt' | 'md' | 'docx' | 'fb2' | 'html' | 'image';
export type ReadStatus = 'want' | 'reading' | 'finished';
export type CoverStyle = 'bound' | 'raw' | 'designed';

/** What a book's content is made of: reflowable text, or page images awaiting text recognition. */
export type BookKind = 'text' | 'scan';

export interface ImportState {
  state: 'queued' | 'processing' | 'ready' | 'failed';
  /** Human label of the current stage, e.g. "Reading pages". */
  stage?: string;
  done: number;
  total: number;
  error?: string;
  /** Pages that could not be processed, for retry. */
  failedPages?: number[];
}

export interface TocEntry {
  title: string;
  section: number;
  /** Block inside the section the entry points at. */
  block?: number;
  level: number;
}

export interface Progress {
  section: number;
  block: number;
  /** 0..1 through the whole book. */
  fraction: number;
  updatedAt: number;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  edition?: string;
  lang: Lang;
  format: BookFormat;
  kind: BookKind;
  size: number;
  /** SHA-256 of the file, for duplicate detection. */
  hash: string;
  fileName: string;
  addedAt: number;
  openedAt?: number;
  status: ReadStatus;
  folderId?: string;
  coverStyle?: CoverStyle;
  hasCover: boolean;
  /** Series name and volume number when the title names one, so volumes group together. */
  series?: string;
  volume?: number;
  sectionCount: number;
  /** Characters per section, for whole-book progress. */
  sectionChars: number[];
  pageCount?: number;
  /** Pages of a PDF kept as images because they have no usable text layer. */
  imagePages?: number;
  toc: TocEntry[];
  import: ImportState;
  progress?: Progress;
}

export type BlockType = 'p' | 'h' | 'quote' | 'li' | 'img' | 'hr' | 'pre';

export interface InlineSpan {
  s: number;
  e: number;
  /** b = bold, i = italic. */
  k: 'b' | 'i';
}

export interface NoteMarker {
  /** Character offset in the block text where the marker sits. */
  at: number;
  /** Key into Section.notes. */
  id: string;
  label: string;
}

export interface Block {
  t: BlockType;
  text: string;
  /** Heading level 1–6 for 'h'. */
  level?: number;
  spans?: InlineSpan[];
  notes?: NoteMarker[];
  /** Asset key for 'img'. */
  src?: string;
  /** 1-based page of the source file this block came from. */
  page?: number;
  /** The number printed on that page, when known. */
  printed?: string;
  /** Override of the book language for this block. */
  lang?: Lang;
}

export interface Section {
  /** `${bookId}:${idx}` */
  id: string;
  bookId: string;
  idx: number;
  title: string;
  blocks: Block[];
  notes?: Record<string, string>;
  chars: number;
}

export interface Folder {
  id: string;
  name: string;
  parentId?: string;
  createdAt: number;
}

export type MarkType = 'bookmark' | 'highlight' | 'note';
export type HighlightColor = 'gold' | 'rubric' | 'slate' | 'rose' | 'ink';

export interface Mark {
  id: string;
  bookId: string;
  type: MarkType;
  section: number;
  block: number;
  /** Character range inside the block (highlights and notes). */
  start?: number;
  end?: number;
  color?: HighlightColor;
  /** The marked text, kept so lists can show it without loading the book. */
  text?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

/** A saved reference: a passage kept for study with its exact citation. */
export interface Reference {
  id: string;
  bookId: string;
  section: number;
  block: number;
  start?: number;
  end?: number;
  original: string;
  english?: string;
  citation: {
    author: string;
    book: string;
    edition?: string;
    volume?: number;
    chapter?: string;
    page?: string;
  };
  proves?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FileRecord {
  bookId: string;
  blob: Blob;
}

export interface CoverRecord {
  bookId: string;
  blob: Blob;
}

export interface AssetRecord {
  /** `${bookId}:${name}` */
  id: string;
  bookId: string;
  blob: Blob;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}
