/** Core data model. Every imported format is normalised into Book → Section → Block. */

export type Lang = 'ar' | 'ur' | 'fa' | 'en' | 'other';
export type BookFormat = 'epub' | 'pdf' | 'txt' | 'md' | 'docx' | 'fb2' | 'html' | 'image' | 'mobi';
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

export type OcrLang = 'ara' | 'urd' | 'fas' | 'eng';

export interface OcrState {
  state: 'queued' | 'running' | 'done' | 'failed';
  done: number;
  total: number;
  error?: string;
}

/** The recognised text of one page image. */
export interface OcrPage {
  /** `${bookId}:${page}` */
  id: string;
  bookId: string;
  page: number;
  blocks: Block[];
  /** Whole-page confidence, 0–100. */
  conf: number;
  /** The printed page number found on the page. */
  printed?: string;
  /** Corrected by hand: never overwritten by a new recognition run. */
  edited?: boolean;
  lang: OcrLang;
  updatedAt: number;
}

export interface BookTranslation {
  jobId: string;
  state: 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'cancelled';
  done: number;
  total: number;
  /** When a paused translation will carry on by itself. */
  nextRunAt?: number;
  /** Why it is paused, in the server's words. */
  note?: string;
  /** Results already fetched up to this time. */
  cursor: number;
  startedAt: number;
}

export type TranslationLabel = 'draft' | 'checked' | 'reviewed';

export interface Uncertain {
  span: string;
  reason: string;
}

/** The English of one paragraph. */
export interface Translation {
  /** `${bookId}:${section}:${block}` */
  id: string;
  bookId: string;
  section: number;
  block: number;
  en: string;
  uncertain: Uncertain[];
  /** Machine draft, checked by the reader, or reviewed by a scholar. */
  label: TranslationLabel;
  provider: string;
  model: string;
  updatedAt: number;
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
  /** Text recognition for pages that are only images. */
  ocr?: OcrState;
  /** Language the pages are recognised in. */
  ocrLang?: OcrLang;
  /** For books with page images: show the pages, or the recognised text. */
  scanView?: 'page' | 'text';
  /** Private books are never sent to an AI service that trains on what it is sent. */
  private?: boolean;
  /** The whole-book English translation, worked on by the server. */
  translation?: BookTranslation;
  /** How the reader shows a book with a translation. */
  view?: 'en' | 'orig' | 'both';
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
  /** Text recognised from a page image (not part of the file's own text). */
  ocr?: boolean;
  /** Recognition confidence for this paragraph, 0–100. */
  conf?: number;
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
