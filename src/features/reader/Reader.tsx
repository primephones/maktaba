import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { haptic } from '../../lib/haptics';
import { db, sectionId, uid } from '../../db/db';
import type { Book, HighlightColor, Mark, Reference, Section, Translation } from '../../db/types';
import { detectLang, hasArabicScript, stripTashkilWithMap } from '../../lib/arabic';
import { clamp, percent } from '../../lib/util';
import { closePdf } from '../../lib/pdfjs';
import { formatCitation } from '../../lib/citation';
import { isAndroidApp, native } from '../../native/maktaba';
import { isScanned, leaveBook, translateAhead, translateWholeScan, setReadingPlace, stopAhead, useAhead } from '../../ai/ahead';
import { reviewChapter, startBookTranslation, translatable } from '../../ai/translation';
import { aiReady } from '../../ai/client';
import type { QuranMatch } from '../../quran/refs';
import { QuranSheet } from '../quran/QuranSheet';
import { StudySheet } from './StudySheet';
import { SummarySheet } from './SummarySheet';
import { OriginalViewer } from './OriginalViewer';
import { openOriginal } from '../../lib/saveFile';
import { Listen } from './Listen';
import { canSpeak } from '../../speech/speech';
import { goBack, navigate } from '../../app/router';
import { setSetting, useSetting } from '../../app/settings';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/Sheet';
import { toast } from '../../ui/toast';
import { BlockView, NO_MARKS } from './BlockView';

const NO_PAGES = new Set<number>();
import { ScanPageAction } from './ScanPage';
import { keysFor } from '../../ocr/merge';
import { SharhSheet } from './SharhSheet';
import { QuizSheet } from './QuizSheet';
import { BookSearch } from './BookSearch';
import { Contents } from './Contents';
import { takeJump } from './jump';
import { ReadingControls } from './ReadingControls';
import { readSelection, type ReaderSelection } from './selection';
import { PagedView, ScrollView, type Target } from './views';
import { ZoomViewer, type PageMark, type ZoomSource } from './ZoomViewer';
import { PdfPage } from './PdfPage';
import { PageInfo, PageSourceLine, sourceText, usePageSources } from './PageInfo';

const COLORS: HighlightColor[] = ['gold', 'rubric', 'slate', 'rose', 'ink'];
const COLOR_NAME: Record<HighlightColor, string> = { gold: 'Gold', rubric: 'Red', slate: 'Slate blue', rose: 'Rose', ink: 'Grey' };

export function Reader({ bookId }: { bookId: string }) {
  const book = useLiveQuery(async () => (await db.books.get(bookId)) ?? null, [bookId]);

  if (book === undefined) return <div className="rd" aria-busy="true" />;
  if (book === null || book.import.state !== 'ready' || !book.sectionCount) {
    return (
      <div className="screen screen--plain">
        <div className="screen-head screen-head--sub">
          <button className="icon-btn" onClick={() => goBack('/library')} aria-label="Back"><Icon name="back" /></button>
          <h1>{book?.title ?? 'Book'}</h1>
        </div>
        <EmptyState icon="book" title={book ? 'This book isn’t ready yet' : 'This book is no longer here'} action={<button className="btn btn--primary" onClick={() => navigate('/library', { replace: true })}>Go to the Library</button>}>
          {book ? (book.import.state === 'failed' ? book.import.error ?? 'It could not be read.' : 'It is still being prepared. You can follow its progress in the Library.') : 'It may have been removed from this device.'}
        </EmptyState>
      </div>
    );
  }
  return <ReaderInner book={book} />;
}

/** Fraction of the whole book that lies before a position. */
function fractionAt(book: Book, section: number, block: number, blocksInSection: number): number {
  const total = book.sectionChars.reduce((a, b) => a + b, 0) || 1;
  let before = 0;
  for (let i = 0; i < section; i++) before += book.sectionChars[i] ?? 0;
  const within = blocksInSection > 0 ? block / blocksInSection : 0;
  return clamp((before + within * (book.sectionChars[section] ?? 0)) / total, 0, 1);
}

function ReaderInner({ book }: { book: Book }) {
  const prefs = useSetting('reader');
  const marks = useLiveQuery(() => db.marks.where('bookId').equals(book.id).toArray(), [book.id]) ?? NO_MARKS;
  const root = useRef<HTMLDivElement>(null);

  // Where to open: a place handed over by search or references, else where reading stopped.
  const [opening] = useState(() => {
    const jump = takeJump(book.id);
    const p = jump ?? book.progress ?? { section: 0, block: 0 };
    return { section: clamp(p.section, 0, book.sectionCount - 1), block: Math.max(0, p.block), flash: jump?.flash };
  });
  const [target, setTarget] = useState<Target>({ section: opening.section, block: opening.block, nonce: 0 });
  const [pos, setPos] = useState({ section: target.section, block: target.block });
  useEffect(() => setReadingPlace(book.id, pos), [book.id, pos]);
  useEffect(() => () => leaveBook(book.id), [book.id]);
  const [chrome, setChrome] = useState(true);
  const [sheet, setSheet] = useState<null | 'contents' | 'settings' | 'search' | 'summary' | 'english' | 'study' | 'more' | 'sharh' | 'quiz'>(null);
  const [flash, setFlash] = useState<{ section: number; block: number; range: [number, number] } | null>(
    opening.flash ? { section: opening.section, block: opening.block, range: opening.flash } : null,
  );
  const [note, setNote] = useState<string | null>(null);
  const [editMark, setEditMark] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ZoomSource | null>(null);
  const [original, setOriginal] = useState<{ page: number; mark?: PageMark } | null>(null);
  const [pageInfo, setPageInfo] = useState<{ page: number; printed?: string } | null>(null);
  const [aboutEn, setAboutEn] = useState<Translation | null>(null);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [peek, setPeek] = useState<{ section: number; block: number } | null>(null);
  const [scrub, setScrub] = useState<number | null>(null);

  // ----- Sections: loaded on demand and kept while the book is open -----
  const cache = useRef(new Map<number, Section>());
  const loading = useRef(new Set<number>());
  const [version, setVersion] = useState(0);
  const get = useCallback((idx: number) => cache.current.get(idx), []);
  const load = useCallback(
    (idxs: number[]) => {
      const need = idxs.filter((i) => i >= 0 && i < book.sectionCount && !cache.current.has(i) && !loading.current.has(i));
      if (!need.length) return;
      need.forEach((i) => loading.current.add(i));
      void db.sections.bulkGet(need.map((i) => sectionId(book.id, i))).then((rows) => {
        rows.forEach((row, k) => {
          loading.current.delete(need[k]);
          // A missing chapter is shown as an empty one rather than stalling the book.
          cache.current.set(need[k], row ?? { id: sectionId(book.id, need[k]), bookId: book.id, idx: need[k], title: '', blocks: [], chars: 0 });
        });
        setVersion((v) => v + 1);
      });
    },
    [book.id, book.sectionCount],
  );

  // ----- Opening and closing -----
  useEffect(() => {
    void db.books.update(book.id, { openedAt: Date.now(), ...(book.status === 'want' ? { status: 'reading' as const } : {}) });
    // As I read, left on for this book: the pages ahead are kept in English again (once the place is known).
    const resume = book.asIRead
      ? window.setTimeout(() => {
          void aiReady().then((ok) => {
            if (ok) void translateAhead(book, { follow: true });
          });
        }, 1500)
      : 0;
    return () => {
      window.clearTimeout(resume);
      closePdf(book.id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 2800);
    return () => window.clearTimeout(t);
  }, [flash]);

  // ----- Position and progress -----
  const saveTimer = useRef(0);
  const lastJump = useRef(Date.now());
  const latest = useRef(pos);
  const persist = useCallback(() => {
    const p = latest.current;
    const sec = cache.current.get(p.section);
    if (!sec) return;
    const fraction = fractionAt(book, p.section, p.block, sec.blocks.length);
    const atEnd = p.section === book.sectionCount - 1 && p.block >= sec.blocks.length - 2;
    void db.books.update(book.id, {
      progress: { section: p.section, block: p.block, fraction: atEnd ? 1 : fraction, updatedAt: Date.now() },
      // Landing near the end by a jump (search, contents) is not finishing the book.
      ...(atEnd && book.status === 'reading' && Date.now() - lastJump.current > 4000 ? { status: 'finished' as const } : {}),
    });
  }, [book]);

  const onPosition = useCallback(
    (section: number, block: number) => {
      if (latest.current.section === section && latest.current.block === block) return;
      latest.current = { section, block };
      setPos({ section, block });
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(persist, 700);
    },
    [persist],
  );

  useEffect(() => {
    const flush = () => {
      window.clearTimeout(saveTimer.current);
      persist();
    };
    document.addEventListener('visibilitychange', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      flush();
    };
  }, [persist]);

  // After a jump (contents, search, a page, the slider): a way straight back.
  const [back, setBack] = useState<{ section: number; block: number; label: string } | null>(null);
  const goTo = useCallback((section: number, block: number, range?: [number, number], remember = true) => {
    const from = latest.current;
    if (remember && (from.section !== section || Math.abs(from.block - block) > 3)) {
      const b = cache.current.get(from.section)?.blocks[from.block];
      const pageNo = b?.printed ?? (b?.page ? String(b.page) : '');
      setBack({ ...from, label: pageNo ? `Back to p. ${pageNo}` : 'Back to where you were' });
    } else if (!remember) setBack(null);
    setTarget((t) => ({ section, block, nonce: t.nonce + 1 }));
    lastJump.current = Date.now();
    latest.current = { section, block };
    setPos({ section, block });
    if (range) setFlash({ section, block, range });
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(persist, 900);
  }, [persist]);

  useEffect(() => {
    if (!back) return;
    const t = window.setTimeout(() => setBack(null), 20000);
    return () => window.clearTimeout(t);
  }, [back]);

  // Pinch the page with two fingers to make the text bigger or smaller.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let start: { d: number; size: number } | null = null;
    let live = 0;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2 && !(e.target as Element).closest('.sheet, .zoom')) start = { d: dist(e.touches), size: prefsRef.current.fontSize };
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      live = clamp(Math.round((start.size * dist(e.touches)) / start.d / 5) * 5, 70, 220);
      el.style.setProperty('--rd-size', `${(1.1875 * live) / 100}rem`);
    };
    const onEnd = () => {
      if (!start) return;
      start = null;
      if (live && live !== prefsRef.current.fontSize) {
        void setSetting('reader', { ...prefsRef.current, fontSize: live });
        toast(`Text size ${live}%`);
      }
      live = 0;
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  // ----- Android reading aids: volume keys, screen on, orientation -----
  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    void native.call('setVolumeKeys', { enabled: prefs.volumeKeys });
    if (prefs.volumeKeys) {
      void native.on('volumeKey', (e) => {
        window.dispatchEvent(new CustomEvent('maktaba:turn', { detail: e.direction }));
      }).then((stop) => {
        if (alive) off = stop;
        else stop();
      });
    }
    return () => {
      alive = false;
      off?.();
      void native.call('setVolumeKeys', { enabled: false });
    };
  }, [prefs.volumeKeys]);
  useEffect(() => {
    void native.call('keepScreenOn', { on: prefs.keepAwake });
    return () => void native.call('keepScreenOn', { on: false });
  }, [prefs.keepAwake]);
  useEffect(() => {
    void native.call('setOrientation', { orientation: prefs.orientation });
    return () => void native.call('setOrientation', { orientation: 'auto' });
  }, [prefs.orientation]);

  // ----- Selection -----
  useEffect(() => {
    let t = 0;
    const onChange = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => setSelection(root.current ? readSelection(root.current) : null), 140);
    };
    document.addEventListener('selectionchange', onChange);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      window.clearTimeout(t);
    };
  }, []);

  /** Selections are measured on the text as shown; stored marks use the text as stored. */
  const toStored = useCallback(
    (part: ReaderSelection['parts'][number]) => {
      const block = cache.current.get(part.section)?.blocks[part.block];
      if (!block) return null;
      let { start, end } = part;
      if (!prefs.tashkil && hasArabicScript(block.text)) {
        const { map } = stripTashkilWithMap(block.text);
        start = map[clamp(start, 0, map.length - 1)];
        end = end >= map.length - 1 ? block.text.length : map[end];
      }
      start = clamp(start, 0, block.text.length);
      end = clamp(end, start, block.text.length);
      return end > start ? { ...part, start, end, text: block.text.slice(start, end), block: part.block } : null;
    },
    [prefs.tashkil],
  );

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  const highlight = async (color: HighlightColor, thenEdit = false) => {
    if (!selection) return;
    const now = Date.now();
    const made: Mark[] = [];
    for (const part of selection.parts) {
      // In the English: kept against the English words themselves.
      if (part.en) {
        if (part.end > part.start && part.text.trim()) made.push({ id: uid(), bookId: book.id, type: 'highlight', en: true, section: part.section, block: part.block, start: part.start, end: part.end, color, text: part.text, createdAt: now, updatedAt: now });
        continue;
      }
      const p = toStored(part);
      if (!p) continue;
      made.push({ id: uid(), bookId: book.id, type: 'highlight', section: p.section, block: p.block, start: p.start, end: p.end, color, text: p.text, createdAt: now, updatedAt: now });
    }
    if (!made.length) return;
    await db.marks.bulkAdd(made);
    haptic('light');
    clearSelection();
    if (thenEdit) setEditMark(made[0].id);
  };

  const chapterAt = useCallback(
    (section: number, block: number): string => {
      let title = '';
      for (const t of book.toc) {
        if (t.section < section || (t.section === section && (t.block ?? 0) <= block)) title = t.title;
        else break;
      }
      return title || cache.current.get(section)?.title || '';
    },
    [book.toc],
  );

  const saveReference = async () => {
    if (!selection) return;
    const enParts = selection.parts.filter((p) => p.en);
    const parts = selection.parts
      .map((p) => (p.en ? { ...p, en: false, start: 0, end: cache.current.get(p.section)?.blocks[p.block]?.text.length ?? 0 } : p))
      .map(toStored)
      .filter((p): p is NonNullable<typeof p> => !!p);
    if (!parts.length) return;
    const first = parts[0];
    const now = Date.now();
    const english = enParts.length ? enParts.map((p) => p.text).join('\n') : parts.map((p) => translations.get(`${p.section}:${p.block}`)?.en).filter(Boolean).join('\n') || undefined;
    const ref: Reference = {
      id: uid(),
      bookId: book.id,
      section: first.section,
      block: first.block,
      start: parts.length === 1 ? first.start : undefined,
      end: parts.length === 1 ? first.end : undefined,
      original: parts.map((p) => p.text).join('\n'),
      english,
      citation: citationAt(first.section, first.block),
      createdAt: now,
      updatedAt: now,
    };
    await db.refs.add(ref);
    clearSelection();
    toast('Saved to References.', { label: 'View', run: () => navigate('/references') });
  };

  /** The source of a passage, for a footnote. */
  const citationAt = (section: number, blockIndex: number): Reference['citation'] => {
    const block = cache.current.get(section)?.blocks[blockIndex];
    return {
      author: book.author,
      book: book.series ?? book.title,
      edition: book.edition,
      volume: book.volume,
      chapter: chapterAt(section, blockIndex) || undefined,
      page: block?.printed ?? (block?.page ? String(block.page) : undefined),
    };
  };

  const copy = async () => {
    if (!selection) return;
    const parts = selection.parts.map(toStored).filter((p): p is NonNullable<typeof p> => !!p);
    // Copy the words as the book has them, vowel marks included, even if they are hidden.
    const text = parts.length ? parts.map((p) => p.text).join('\n') : selection.text;
    const cited = parts.length ? `${text}\n— ${formatCitation(citationAt(parts[0].section, parts[0].block))}` : text;
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied.', {
        label: 'Add citation',
        run: () => void navigator.clipboard.writeText(cited).then(() => toast('Copied with its citation.')).catch(() => undefined),
      });
    } catch {
      toast('Copying isn’t allowed here. Use the phone’s own Copy.');
    }
    clearSelection();
  };

  // ----- Explain and iʿrāb -----
  const [studyOpen, setStudyOpen] = useState<{ kind: 'explain' | 'irab' | 'define'; text: string; en?: string; cite: string; context?: string } | null>(null);
  const openStudy = (kind: 'explain' | 'irab' | 'define') => {
    if (!selection) return;
    const parts = selection.parts.map((p) => (p.en ? { ...p, en: false, start: 0, end: cache.current.get(p.section)?.blocks[p.block]?.text.length ?? 0 } : p)).map(toStored).filter((p): p is NonNullable<typeof p> => !!p);
    const first = parts[0] ?? selection.parts[0];
    const text = kind === 'irab' ? selection.text : parts.map((p) => p.text).join('\n') || selection.text;
    const en = parts.map((p) => translations.get(`${p.section}:${p.block}`)?.en).filter(Boolean).join('\n') || undefined;
    // Define: the word, and the sentence around it (from its paragraph) for its sense here.
    const para = cache.current.get(first.section)?.blocks[first.block]?.text ?? '';
    const word = selection.text.trim();
    const at = Math.max(0, para.indexOf(word));
    const context = para.slice(Math.max(0, at - 200), at + word.length + 200);
    setStudyOpen({ kind, text: kind === 'define' ? word : text, en, cite: formatCitation(citationAt(first.section, first.block)), context: kind === 'define' ? context || word : undefined });
    clearSelection();
  };

  // ----- Bookmarks -----
  const bookmarkHere = marks.find((m) => m.type === 'bookmark' && m.section === pos.section && m.block === pos.block);
  const toggleBookmark = async () => {
    if (bookmarkHere) {
      await db.marks.delete(bookmarkHere.id);
      haptic('light');
      toast('Bookmark removed.');
      return;
    }
    const block = cache.current.get(pos.section)?.blocks[pos.block];
    const now = Date.now();
    const label = block?.t === 'img' ? `Page ${block.printed ?? block.page ?? ''}`.trim() : (block?.text ?? '').slice(0, 140);
    await db.marks.add({ id: uid(), bookId: book.id, type: 'bookmark', section: pos.section, block: pos.block, text: label, createdAt: now, updatedAt: now });
    haptic('medium');
    toast('Bookmarked.');
  };

  /**
   * The book as it was given, for checking: a PDF opens on the printed page being read
   * (or the page of the paragraph chosen); any other kind of file opens untouched in the
   * phone's own app for it.
   */
  const showOriginal = async (at: { section: number; block: number } = pos) => {
    if (book.format === 'pdf') {
      const blocks = cache.current.get(at.section)?.blocks ?? (await db.sections.get(sectionId(book.id, at.section)))?.blocks ?? [];
      let i = Math.min(at.block, blocks.length - 1);
      // The paragraph being read (a page image or a heading carries no text to find).
      while (i > 0 && (blocks[i]?.page === undefined || blocks[i]?.t === 'img')) i--;
      const b = blocks[i];
      const page = b?.page ?? blocks.find((x) => x.page)?.page ?? 1;
      setOriginal({ page, mark: b && b.page ? { page: b.page, text: b.t === 'img' ? undefined : b.text, box: b.box } : undefined });
      return;
    }
    const rec = await db.files.get(book.id);
    if (!rec) {
      toast('The original file is not on this phone. Add it again to see it.');
      return;
    }
    toast('Opening the original file…');
    await openOriginal(rec.blob, book.fileName || book.title).catch((e) => toast(`Could not open it: ${(e as Error).message}`));
  };

  // ----- Rendering -----
  const marksByBlock = useMemo(() => {
    const map = new Map<string, Mark[]>();
    for (const m of [...marks].sort((a, b) => a.createdAt - b.createdAt)) {
      const key = `${m.section}:${m.block}`;
      const list = map.get(key);
      if (list) list.push(m);
      else map.set(key, [m]);
    }
    return map;
  }, [marks]);

  const onNote = useCallback((section: number, id: string) => {
    setNote(cache.current.get(section)?.notes?.[id] ?? 'This footnote is missing from the file.');
  }, []);
  const onMark = useCallback((id: string) => setEditMark(id), []);
  // A printed page opens in the page viewer, which turns pages and can go back to the text.
  const onZoom = useCallback((source: ZoomSource) => (source.kind === 'pdf' ? setOriginal({ page: source.page }) : setZoom(source)), []);
  const onPageInfo = useCallback((page: number, printed?: string) => setPageInfo({ page, printed }), []);

  // ----- English translation -----
  const trList = useLiveQuery(() => db.translations.where('bookId').equals(book.id).toArray(), [book.id]);
  const translations = useMemo(() => new Map((trList ?? []).map((t) => [`${t.section}:${t.block}`, t] as const)), [trList]);
  const hasTranslation = translations.size > 0;
  const view: 'en' | 'orig' | 'both' = hasTranslation ? book.view ?? 'en' : 'orig';
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [unsure, setUnsure] = useState<Translation | null>(null);
  const onFlip = useCallback((s: number, b: number) => {
    setFlipped((prev) => {
      const next = new Set(prev);
      const k = `${s}:${b}`;
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);
  const onUncertain = useCallback((t: Translation) => setUnsure(t), []);
  const [quran, setQuran] = useState<QuranMatch | null>(null);
  const [listening, setListening] = useState(false);
  const onQuran = useCallback((m: QuranMatch) => setQuran(m), []);

  // Books with page images: the pages as printed, each with its English beneath (the
  // default), or the text read from them.
  const hasScans = !!book.ocr;
  const scanView = book.scanView ?? 'page';
  // Any PDF can be read as its printed pages: a scan by default, a PDF of text when chosen.
  const isPdf = book.format === 'pdf';
  const pageMode = isPdf && (hasScans ? scanView === 'page' : book.scanView === 'page');
  const pageSources = usePageSources(book);
  // Pages the AI has read (or that were corrected by hand): a page read and found to hold no
  // text (a title page, a picture) is not offered for reading again.
  const aiRead = useLiveQuery(async () => (hasScans ? new Set((await db.ocrPages.where('bookId').equals(book.id).toArray()).filter((r) => r.by === 'ai' || r.edited).map((r) => r.page)) : new Set<number>()), [book.id, hasScans, book.ocr?.done]) ?? NO_PAGES;

  const renderSection = useCallback(
    (sec: Section) => {
      const out: React.ReactNode[] = [];
      let lastPage: string | undefined;
      const recognised = new Set(sec.blocks.filter((b) => b.ocr).map((b) => b.page));
      // A short note at the head of a chapter says the English is a machine draft, and by whom.
      const firstTr = view !== 'orig' ? sec.blocks.map((_, i) => translations.get(`${sec.idx}:${i}`)).find(Boolean) : undefined;
      const label = firstTr ? (
        <button className="tr-label" key="trlabel" data-skip onClick={() => setAboutEn(firstTr)} aria-label="About this English">
          <span className="ai-mark" aria-hidden="true">✦</span> {firstTr.label === 'reviewed' ? 'Reviewed by a scholar' : firstTr.label === 'checked' ? 'Translated by your AI, and checked' : 'Translated by your AI'}
          {view === 'en' ? ' · tap a paragraph for the original' : ''}
        </button>
      ) : null;
      // Under the chapter's heading when it opens with one (so it is in view with the heading), else at its head.
      const labelAfter = label && sec.blocks[0]?.t === 'h' ? 0 : -1;
      if (label && labelAfter < 0) out.push(label);
      // Keys that stay with a block when the text of an earlier page is put in before it, so
      // what is on screen is not redrawn as something else (and the place held stays put).
      const keys = hasScans ? keysFor(sec.blocks) : null;
      const keyOf = (i: number) => (keys ? keys[i] : String(i));
      const blockProps = {
        bookId: book.id,
        bookLang: book.lang,
        section: sec.idx,
        showTashkil: prefs.tashkil,
        onNote,
        onMark,
        onZoom,
        flipped: false,
        onFlip,
        onUncertain,
        onQuran,
      };
      /** The English of the paragraphs on one printed page, to go under its picture. */
      const englishOf = (onPage: number[]) =>
        onPage
          .filter((j) => translations.has(`${sec.idx}:${j}`))
          .map((j) => (
            <BlockView
              key={`en${keyOf(j)}`}
              {...blockProps}
              index={j}
              block={sec.blocks[j]}
              marks={marksByBlock.get(`${sec.idx}:${j}`) ?? NO_MARKS}
              flash={flash && flash.section === sec.idx && flash.block === j ? flash.range : undefined}
              tr={translations.get(`${sec.idx}:${j}`)}
              show="en"
              flipped={flipped.has(`${sec.idx}:${j}`)}
            />
          ));

      // A PDF of text read as its printed pages: each page's picture stands in for its text,
      // with the page's English beneath when the English is shown.
      const textAsPages = pageMode && !hasScans && sec.blocks.some((b) => b.page);
      const pagesShown = new Set<number>();
      if (textAsPages) {
        // A page that began in the chapter before was shown there.
        const prev = cache.current.get(sec.idx - 1)?.blocks;
        const carried = prev ? [...prev].reverse().find((b) => b.page)?.page : undefined;
        if (carried && sec.blocks.find((b) => b.page)?.page === carried) pagesShown.add(carried);
      }

      sec.blocks.forEach((block, i) => {
        if (textAsPages) {
          const p = block.page;
          if (!p || pagesShown.has(p)) return;
          pagesShown.add(p);
          const onPage = sec.blocks.map((b, j) => (b.page === p && b.t !== 'img' && b.text.trim().length > 1 ? j : -1)).filter((j) => j >= 0);
          out.push(
            <div className="pagepair" key={`pp${i}`}>
              <div className="bk bk--page" data-s={sec.idx} data-b={i} data-t="img">
                <PdfPage bookId={book.id} page={p} label={block.printed ?? String(p)} onZoom={() => onZoom({ kind: 'pdf', bookId: book.id, page: p })} />
              </div>
              {view !== 'orig' && hasTranslation ? (
                <>
                  <PageSourceLine book={book} page={p} src={undefined} onOpen={(pg) => onPageInfo(pg, block.printed)} />
                  <div className="pagepair-en">{englishOf(onPage)}</div>
                </>
              ) : null}
            </div>,
          );
          if (i === labelAfter) out.push(label);
          return;
        }
        const isPageImage = block.t === 'img' && (/^page:\d+$/.test(block.src ?? '') || block.src === 'page-1');
        if (block.ocr && scanView === 'page') return;
        if (isPageImage && scanView === 'text' && recognised.has(block.page)) return;
        // Mark where the printed page turns, so a passage can be cited by page (and, in a
        // PDF, checked against the page itself).
        const pageNo = block.t === 'img' ? undefined : block.printed ?? (block.page ? String(block.page) : undefined);
        if (pageNo && pageNo !== lastPage) {
          const filePage = block.page;
          const unsure = hasScans && filePage ? sourceText(book, pageSources.get(filePage))?.unsure : false;
          out.push(
            isPdf && filePage ? (
              <div className="pgmark" key={`p${keyOf(i)}`} data-skip>
                <button onClick={() => onPageInfo(filePage, block.printed)} aria-label={`Page ${pageNo}${unsure ? ', needs checking' : ''}. Check this page`} data-unsure={unsure || undefined}>
                  {pageNo}
                </button>
              </div>
            ) : (
              <div className="pgmark" key={`p${keyOf(i)}`} role="note" aria-label={`Page ${pageNo}`}>{pageNo}</div>
            ),
          );
        }
        if (pageNo) lastPage = pageNo;
        const view_ = (
          <BlockView
            key={keyOf(i)}
            bookId={book.id}
            bookLang={book.lang}
            section={sec.idx}
            index={i}
            block={block}
            marks={marksByBlock.get(`${sec.idx}:${i}`) ?? NO_MARKS}
            flash={flash && flash.section === sec.idx && flash.block === i ? flash.range : undefined}
            showTashkil={prefs.tashkil}
            onNote={onNote}
            onMark={onMark}
            onZoom={onZoom}
            tr={translations.get(`${sec.idx}:${i}`)}
            show={view}
            flipped={flipped.has(`${sec.idx}:${i}`)}
            onFlip={onFlip}
            onUncertain={onUncertain}
            onQuran={onQuran}
          />
        );
        // A scanned page shown as printed: the page, where its words came from, its English
        // paragraph by paragraph, and a way to read and translate it now if not done yet.
        if (isPageImage && scanView === 'page' && hasScans) {
          const p = block.page ?? Number(block.src?.match(/\d+/)?.[0] ?? 1);
          const onPage = sec.blocks.map((b, j) => (b.ocr && b.page === p && b.text.trim().length > 1 ? j : -1)).filter((j) => j >= 0);
          const showEnglish = view !== 'orig' || !hasTranslation;
          const done = onPage.filter((j) => translations.has(`${sec.idx}:${j}`));
          out.push(
            <div className="pagepair" key={`pp${keyOf(i)}`}>
              {view_}
              <PageSourceLine book={book} page={p} src={pageSources.get(p)} onOpen={(pg) => onPageInfo(pg, block.printed)} />
              {showEnglish && (
                <div className="pagepair-en">
                  {englishOf(onPage)}
                  {((!onPage.length && !aiRead.has(p)) || done.length < onPage.length) && (
                    <ScanPageAction book={book} page={p} read={onPage.length > 0 || aiRead.has(p)} some={done.length > 0} />
                  )}
                </div>
              )}
            </div>,
          );
          if (i === labelAfter) out.push(label);
          return;
        }
        // English shown, but this paragraph has none yet (it failed, or was not reached): a
        // quiet way to carry on translating from here, once at the start of each such run.
        const untranslated = view !== 'orig' && hasTranslation && !pageMode && (block.t === 'p' || block.t === 'h' || block.t === 'quote') && block.text.trim().length > 1 && !translations.has(`${sec.idx}:${i}`);
        if (untranslated) {
          const prev = sec.blocks.slice(0, i).map((b, j) => ({ b, j })).reverse().find(({ b }) => b.t !== 'img' && b.t !== 'hr' && b.text.trim().length > 1);
          if (!prev || translations.has(`${sec.idx}:${prev.j}`)) {
            out.push(<TranslateFromHere key={`tfh${keyOf(i)}`} book={book} at={{ section: sec.idx, block: i }} />);
          }
        }
        out.push(view_);
        if (i === labelAfter) out.push(label);
      });
      return out;
    },
    [book, hasScans, hasTranslation, marksByBlock, flash, prefs.tashkil, onNote, onMark, onZoom, scanView, translations, view, flipped, onFlip, onUncertain, onQuran, aiRead, pageMode, isPdf, pageSources, onPageInfo],
  );

  // Recognised text arrives while the book is open (by the background reading, or a page read
  // for the reader just now): refresh the chapters on screen.
  const ocrDone = book.ocr?.done ?? 0;
  const ocrStamp = useLiveQuery(() => (hasScans ? db.ocrPages.where('bookId').equals(book.id).count() : 0), [book.id, hasScans]);
  const firstOcr = useRef(true);
  useEffect(() => {
    if (firstOcr.current) {
      firstOcr.current = false;
      return;
    }
    const loaded = [...cache.current.keys()];
    void db.sections.bulkGet(loaded.map((i) => sectionId(book.id, i))).then((rows) => {
      rows.forEach((row, k) => row && cache.current.set(loaded[k], row));
      setVersion((v) => v + 1);
    });
  }, [ocrDone, ocrStamp, book.id]);

  // Full screen while reading: the phone's clock and battery bar go with the reading bars.
  useEffect(() => {
    void (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      const { StatusBar } = await import('@capacitor/status-bar');
      await (chrome || selection ? StatusBar.show() : StatusBar.hide()).catch(() => undefined);
    })();
  }, [chrome, selection]);
  useEffect(
    () => () =>
      void import('@capacitor/core').then(async ({ Capacitor }) => {
        if (Capacitor.isNativePlatform()) await (await import('@capacitor/status-bar')).StatusBar.show().catch(() => undefined);
      }),
    [],
  );
  // Messages sit just above the reading bars (or at the very foot), never over the text.
  const footer = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = footer.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--rd-bar-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onTap = useCallback(() => setChrome((c) => !c), []);
  const onUserMove = useCallback(() => setChrome(false), []);
  const onReveal = useCallback(() => setChrome(true), []);

  const currentSection = cache.current.get(pos.section);
  const fraction = scrub ?? fractionAt(book, pos.section, pos.block, currentSection?.blocks.length ?? 0);
  const currentBlock = currentSection?.blocks[pos.block];
  const pageLabel = currentBlock?.printed ?? (currentBlock?.page ? String(currentBlock.page) : '');
  // The chapter's name in English when the English is being read and its title has one.
  const tocIndexAt = (section: number, block: number) => {
    let at = -1;
    book.toc.forEach((t, i) => {
      if (t.section < section || (t.section === section && (t.block ?? 0) <= block)) at = i;
    });
    return at;
  };
  const tocEn = (i: number): string | undefined => {
    const t = book.toc[i];
    if (!t) return undefined;
    if (book.tocEn?.[i]) return book.tocEn[i];
    for (const b of t.block !== undefined ? [t.block] : [0, 1]) {
      const en = translations.get(`${t.section}:${b}`)?.en.replace(/†/g, '').trim();
      if (en && en.length < 140) return en;
    }
    return undefined;
  };
  const chapterOrig = chapterAt(pos.section, pos.block);
  const chapter = (view !== 'orig' && tocEn(tocIndexAt(pos.section, pos.block))) || chapterOrig;
  // Where in the whole book, as pages: the PDF's own pages, else pages of about 1,500 letters.
  const totalChars = book.sectionChars.reduce((a, b) => a + b, 0);
  const pageOf = isPdf && book.pageCount ? book.pageCount : Math.max(1, Math.ceil(totalChars / 1500));
  const pageNow = isPdf && currentBlock?.page ? currentBlock.page : Math.max(1, Math.min(pageOf, Math.ceil(fraction * pageOf) || 1));
  // The chapters as marks along the slider, and the chapter under the finger while dragging.
  const sectionStarts = useMemo(() => {
    const total = book.sectionChars.reduce((a, b) => a + b, 0) || 1;
    let acc = 0;
    return book.sectionChars.map((c) => {
      const at = acc / total;
      acc += c;
      return at;
    });
  }, [book.sectionChars]);
  const ticks = useMemo(() => {
    const top = Math.min(...book.toc.map((t) => t.level), 9);
    const marks = book.toc.filter((t) => t.level === top).map((t) => sectionStarts[t.section] ?? 0).filter((f) => f > 0.005 && f < 0.995);
    return marks.length <= 60 ? marks : [];
  }, [book.toc, sectionStarts]);
  const scrubChapter = (f: number) => {
    let s = 0;
    while (s < sectionStarts.length - 1 && sectionStarts[s + 1] <= f) s++;
    const i = tocIndexAt(s, 0);
    return (i >= 0 && ((view !== 'orig' && tocEn(i)) || book.toc[i].title)) || book.title;
  };
  const minutesLeft = useMinutesLeft(pos, currentSection, translations, view);

  const scrubTimer = useRef(0);
  const onScrub = (value: number) => {
    const f = value / 1000;
    setScrub(f);
    window.clearTimeout(scrubTimer.current);
    scrubTimer.current = window.setTimeout(async () => {
      const total = book.sectionChars.reduce((a, b) => a + b, 0) || 1;
      let goal = f * total;
      let s = 0;
      while (s < book.sectionCount - 1 && goal >= (book.sectionChars[s] ?? 0)) {
        goal -= book.sectionChars[s] ?? 0;
        s++;
      }
      const sec = cache.current.get(s) ?? (await db.sections.get(sectionId(book.id, s)));
      const count = sec?.blocks.length ?? 1;
      goTo(s, clamp(Math.floor((goal / (book.sectionChars[s] || 1)) * count), 0, count - 1));
      setScrub(null);
    }, 220);
  };

  const View = prefs.mode === 'paged' ? PagedView : ScrollView;
  const layoutKey = `${prefs.fontSize}|${prefs.lineHeight}|${prefs.margin}|${prefs.justify}|${prefs.latinFont}|${prefs.arabicFont}|${prefs.urduFont}|${prefs.tashkil}|${prefs.layout}|${prefs.bold}`;
  const style = {
    '--rd-size': `${(1.1875 * prefs.fontSize) / 100}rem`,
    '--rd-lh': String(prefs.lineHeight),
    '--rd-margin': `${prefs.margin}px`,
    '--rd-font': prefs.latinFont === 'plex' ? 'var(--font-ui)' : prefs.latinFont === 'garamond' ? 'var(--font-garamond)' : prefs.latinFont === 'atkinson' ? 'var(--font-clear)' : 'var(--font-read)',
    '--rd-warm': String(prefs.warmth / 100),
    '--rd-dim': String(prefs.dim / 100),
    '--rd-ar-font': prefs.arabicFont === 'plex' ? 'var(--font-arabic-sans)' : prefs.arabicFont === 'scheherazade' ? 'var(--font-arabic-scheherazade)' : 'var(--font-arabic)',
    '--rd-ur-font': prefs.urduFont === 'amiri' ? 'var(--font-arabic)' : prefs.urduFont === 'gulzar' ? 'var(--font-urdu-gulzar)' : 'var(--font-urdu)',
  } as React.CSSProperties;
  const editing = editMark ? marks.find((m) => m.id === editMark) : undefined;
  const titleLang = detectLang(book.title);

  return (
    <div className="rd" ref={root} style={style} data-chrome={chrome && !selection} data-dark-pages={prefs.darkPages || undefined} data-layout={prefs.layout === 'spaced' ? 'spaced' : 'book'} data-bold={prefs.bold || undefined}>
      <AheadPill book={book} />
      <View
        key={prefs.mode}
        book={book}
        target={target}
        get={get}
        load={load}
        version={version}
        layoutKey={layoutKey}
        justify={prefs.justify}
        renderSection={renderSection}
        onPosition={onPosition}
        onTap={onTap}
        onUserMove={onUserMove}
        onReveal={onReveal}
      />

      <div className="rd-mini" aria-hidden="true" dir="auto">{chapter || book.title}</div>
      <div className="rd-foot" aria-hidden="true">
        {minutesLeft !== null && <span>{minutesLeft < 1 ? 'Less than a minute left in chapter' : `${minutesLeft} min left in chapter`}</span>}
        <span>{pageLabel && isPdf ? `p. ${pageLabel} of ${book.pageCount ?? pageOf}` : `${pageNow} of ${pageOf}`}</span>
      </div>

      {prefs.warmth > 0 && <div className="rd-warm" aria-hidden="true" />}
      {prefs.dim > 0 && <div className="rd-dim" aria-hidden="true" />}
      {back && !selection && (
        <button className="rd-back" onClick={() => { goTo(back.section, back.block, undefined, false); }}>
          <Icon name="back" size={18} />
          {back.label}
        </button>
      )}

      <header className="rd-top-bar" inert={!chrome || !!selection}>
        <button className="icon-btn" onClick={() => goBack('/library')} aria-label="Back to the library"><Icon name="back" /></button>
        <div className="t">
          <span className="t-book" dir="auto" lang={titleLang === 'other' ? undefined : titleLang}>{book.title}</span>
          {chapter && chapter !== book.title && <span className="t-chapter" dir="auto">{chapter}</span>}
        </div>
        {isPdf && (
          <button className="icon-btn" onClick={() => void showOriginal()} aria-label="See the printed page">
            <Icon name="original" />
          </button>
        )}
        <button className="icon-btn" onClick={() => setSheet('search')} aria-label="Search in this book"><Icon name="search" /></button>
        <button className="icon-btn" onClick={() => void toggleBookmark()} aria-label={bookmarkHere ? 'Remove bookmark' : 'Bookmark this place'} aria-pressed={!!bookmarkHere}>
          <Icon name={bookmarkHere ? 'bookmarkOn' : 'bookmark'} />
        </button>
      </header>

      <footer className="rd-bottom-bar" ref={footer} inert={!chrome || !!selection}>
        <div className="where">
          <span dir="auto">{chapter || book.title}</span>
          <span>{pageLabel && isPdf ? `p. ${pageLabel} of ${book.pageCount ?? pageOf}` : pageLabel ? `p. ${pageLabel}` : `${pageNow} of ${pageOf}`} · {percent(fraction)}</span>
        </div>
        <div className="rd-slider">
        {scrub !== null && (
          <div className="rd-scrub-bubble" style={{ left: `clamp(90px, ${scrub * 100}%, calc(100% - 90px))` }} aria-hidden="true">
            <b dir="auto">{scrubChapter(scrub)}</b>
            <span>{isPdf && book.pageCount ? `p. ${Math.max(1, Math.round(scrub * book.pageCount))}` : `${Math.max(1, Math.ceil(scrub * pageOf))} of ${pageOf}`}</span>
          </div>
        )}
        <div className="rd-ticks" aria-hidden="true">
          {ticks.map((f, i) => <i key={i} style={{ left: `${f * 100}%` }} />)}
        </div>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(fraction * 1000)}
          onChange={(e) => onScrub(Number(e.target.value))}
          aria-label="Position in the book"
          aria-valuetext={`${percent(fraction)}${chapter ? `, ${chapter}` : ''}`}
        />
        </div>
        <nav className="rd-tools" aria-label="Reading tools">
          <button onClick={() => setSheet('contents')} aria-label="Contents, bookmarks and highlights"><Icon name="toc" /><span>Contents</span></button>
          <button onClick={() => setSheet('settings')} aria-label="Text and theme"><Icon name="type" /><span>Text</span></button>
          {translatable(book) && (
            <button onClick={() => setSheet('english')} aria-pressed={hasTranslation && view !== 'orig'}><Icon name="language" /><span>English</span></button>
          )}
          <button onClick={() => setSheet('study')}><Icon name="sparkle" /><span>Study</span></button>
          <button onClick={() => setSheet('more')}><Icon name="more" /><span>More</span></button>
        </nav>
      </footer>

      {selection && (
        <div className="sel-bar" role="toolbar" aria-label="Selected text">
          <div className="dots">
            {COLORS.map((c) => (
              <button key={c} className="dot" data-c={c} aria-label={`Highlight ${COLOR_NAME[c]}`} onClick={() => void highlight(c)}><i /></button>
            ))}
          </div>
          <div className="acts">
            <button className="sel-act" onClick={() => void highlight('gold', true)}><Icon name="note" size={20} />Note</button>
            <button className="sel-act" onClick={() => void saveReference()}><Icon name="references" size={20} />Reference</button>
            {selection.text.trim().split(/\s+/).length <= 3 && <button className="sel-act" onClick={() => openStudy('define')}><Icon name="sparkle" size={20} />Define</button>}
            <button className="sel-act" onClick={() => openStudy('explain')}><Icon name="sparkle" size={20} />Explain</button>
            {hasArabicScript(selection.text) && <button className="sel-act" onClick={() => openStudy('irab')}><Icon name="sparkle" size={20} />Iʿrāb</button>}
            {book.format === 'pdf' && (
              <button
                className="sel-act"
                onClick={() => {
                  const first = selection.parts[0];
                  getSelection()?.removeAllRanges();
                  void showOriginal({ section: first.section, block: first.block });
                }}
              >
                <Icon name="original" size={20} />Page
              </button>
            )}
            {selection.parts.some((p) => p.en) && (
              <button
                className="sel-act"
                onClick={() => {
                  const first = selection.parts.find((p) => p.en)!;
                  clearSelection();
                  setPeek({ section: first.section, block: first.block });
                }}
              >
                <Icon name="language" size={20} />Original
              </button>
            )}
            <button className="sel-act" onClick={() => void copy()}><Icon name="copy" size={20} />Copy</button>
          </div>
        </div>
      )}

      {peek && (
        <div className="peek" role="dialog" aria-label="The original" onClick={() => setPeek(null)}>
          <div className="peek-card">
            <small>Original</small>
            {(() => {
              const b = cache.current.get(peek.section)?.blocks[peek.block];
              const l = b ? detectLang(b.text) : 'other';
              return <p dir="auto" lang={l === 'other' ? undefined : l}>{b?.text}</p>;
            })()}
            <span className="muted small">Tap anywhere to close</span>
          </div>
        </div>
      )}
      {sheet === 'contents' && (
        <Contents book={book} marks={marks} current={pos} titleEn={view !== 'orig' ? tocEn : undefined} onGo={(s, b) => goTo(s, b)} onEditMark={setEditMark} onSummary={() => setSheet('summary')} onClose={() => setSheet(null)} />
      )}
      {sheet === 'summary' && <SummarySheet book={book} at={pos} onGo={(s, b) => goTo(s, b)} onClose={() => setSheet(null)} />}
      {sheet === 'search' && (
        <BookSearch book={book} onGo={(h) => goTo(h.section, h.block, h.en ? undefined : [h.start, h.end])} onClose={() => setSheet(null)} />
      )}
      {sheet === 'settings' && (
        <Sheet title="Text" onClose={() => setSheet(null)}>
          <ReadingControls showTheme lang={book.lang} grouped />
        </Sheet>
      )}
      {sheet === 'english' && (
        <Sheet title="English" onClose={() => setSheet(null)}>
          <TranslationControls book={book} view={view} hasTranslation={hasTranslation} from={pos} />
        </Sheet>
      )}
      {sheet === 'quiz' && <QuizSheet book={book} at={pos} onGo={(s, b) => goTo(s, b)} onClose={() => setSheet(null)} />}
      {sheet === 'sharh' && <SharhSheet book={book} at={pos} onClose={() => setSheet(null)} />}
      {sheet === 'study' && (
        <Sheet title="Study" onClose={() => setSheet(null)}>
          <div className="list">
            <button className="row" onClick={() => setSheet('summary')}>
              <Icon name="sparkle" />
              <span className="grow"><span className="title">Summary of this chapter</span><div className="sub">The main points, with where each is in the book</div></span>
              <Icon name="forward" size={18} />
            </button>
            <button className="row" onClick={() => setSheet('quiz')}>
              <Icon name="check" />
              <span className="grow"><span className="title">Quiz me on this chapter</span><div className="sub">Five questions from the text, each with why and where</div></span>
              <Icon name="forward" size={18} />
            </button>
            <button className="row" onClick={() => navigate('/search')}>
              <Icon name="search" />
              <span className="grow"><span className="title">Ask your books</span><div className="sub">A question answered from your own books, with references</div></span>
              <Icon name="forward" size={18} />
            </button>
          </div>
          <div className="section-title">On any words</div>
          <p className="muted small" style={{ margin: 0 }}>
            Press and hold a word, then drag to choose a passage. Then: <b>Explain</b> (what it means and why), <b>Iʿrāb</b> (each word’s case and the reason for it),
            <b> Note</b>, <b>Reference</b> (save it, with its citation) or <b>Copy</b>.
          </p>
        </Sheet>
      )}
      {sheet === 'more' && (
        <Sheet title="More" onClose={() => setSheet(null)}>
          <div className="list">
            <button className="row" onClick={() => { setSheet(null); void showOriginal(); }}>
              <Icon name="original" />
              <span className="grow"><span className="title">{book.format === 'pdf' ? 'See the printed page' : 'Open the original file'}</span><div className="sub">{book.format === 'pdf' ? 'Where you are reading, highlighted on the page itself' : 'The file exactly as you added it'}</div></span>
            </button>
            {isPdf && (
              <button className="row" onClick={() => { setSheet(null); void db.books.update(book.id, { scanView: pageMode ? 'text' : 'page' }); }}>
                <Icon name={pageMode ? 'type' : 'pages'} />
                <span className="grow">
                  <span className="title">{pageMode ? (hasScans ? 'Read the text read from the pages' : 'Read the text') : 'Read the printed pages'}</span>
                  <div className="sub">{pageMode ? 'The words alone, to search, highlight and copy' : hasTranslation ? 'Each page exactly as in the PDF, its English beneath' : 'Each page exactly as in the PDF, like a PDF reader'}</div>
                </span>
              </button>
            )}
            <button className="row" onClick={() => setSheet('sharh')}>
              <Icon name="volumes" />
              <span className="grow"><span className="title">In the commentary (sharḥ)</span><div className="sub">Where its sharḥ comments on the paragraph you are reading</div></span>
            </button>
            {canSpeak() && (
              <button className="row" onClick={() => { setSheet(null); setListening(true); }}>
                <Icon name="speaker" />
                <span className="grow"><span className="title">Read aloud</span><div className="sub">From here, in English or the original</div></span>
              </button>
            )}
            <button className="row" onClick={() => setSheet('contents')}>
              <Icon name="bookmark" />
              <span className="grow"><span className="title">Bookmarks, highlights and notes</span><div className="sub">Everything you marked in this book</div></span>
            </button>
          </div>
        </Sheet>
      )}
      {unsure && (
        <Sheet title="Why the translation is unsure" onClose={() => setUnsure(null)}>
          {unsure.uncertain.length ? (
            <div className="list">
              {unsure.uncertain.map((u, i) => (
                <div className="row" key={i}>
                  <span className="grow">
                    <span className="title">{u.span ? `“${u.span}”` : 'The whole paragraph'}</span>
                    <div className="sub">{u.reason}</div>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p>The AI marked this wording as uncertain without giving a reason.</p>
          )}
          <p className="muted small">Tap the paragraph to compare with the original.</p>
        </Sheet>
      )}
      {note !== null && (
        <Sheet title="Footnote" onClose={() => setNote(null)}>
          <p className="note-text" dir="auto" lang={detectLang(note) === 'other' ? undefined : detectLang(note)}>{note}</p>
        </Sheet>
      )}
      {editing && <MarkEditor mark={editing} onClose={() => setEditMark(null)} />}
      {zoom && <ZoomViewer source={zoom} onClose={() => setZoom(null)} />}
      {aboutEn && (
        <Sheet title="About this English" onClose={() => setAboutEn(null)}>
          <p>
            {aboutEn.label === 'reviewed'
              ? 'This English was reviewed by a scholar.'
              : aboutEn.label === 'checked'
                ? 'Your AI translated this, and a second AI checked it against the original.'
                : 'Your AI translated this from the original. It is careful, but it is a machine’s reading: when something matters, compare it with the original.'}
          </p>
          <p className="muted small">Made by {aboutEn.model.replace(/^.*\//, '')} ({aboutEn.provider}), {new Date(aboutEn.updatedAt).toLocaleDateString()}. A † marks a word the translation is unsure of; tap it for why.</p>
          <div className="list">
            <button className="row" onClick={() => { setAboutEn(null); navigate('/settings/english'); }}>
              <Icon name="language" />
              <span className="grow"><span className="title">How the English reads</span><div className="sub">Allah or God, honorifics, technical terms</div></span>
              <Icon name="forward" size={18} />
            </button>
            <button className="row" onClick={() => { setAboutEn(null); setSheet('english'); }}>
              <Icon name="check" />
              <span className="grow"><span className="title">Check this chapter with a second AI</span><div className="sub">And the other English options</div></span>
              <Icon name="forward" size={18} />
            </button>
          </div>
        </Sheet>
      )}
      {pageInfo && <PageInfo book={book} page={pageInfo.page} printed={pageInfo.printed} onSeePage={(pg) => setOriginal({ page: pg })} onClose={() => setPageInfo(null)} />}
      {original && <OriginalViewer book={book} page={original.page} mark={original.mark} onGo={(s, b) => goTo(s, b)} onClose={() => setOriginal(null)} />}
      {quran && <QuranSheet match={quran} onClose={() => setQuran(null)} />}
      {listening && <Listen book={book} from={pos} translations={translations} defaultSource={view} onClose={() => setListening(false)} />}
      {studyOpen && <StudySheet book={book} {...studyOpen} onClose={() => setStudyOpen(null)} />}
    </div>
  );
}

/** Where the English stops (a part failed, or was not reached): carry on from this paragraph. */
function TranslateFromHere({ book, at }: { book: Book; at: { section: number; block: number } }) {
  const run = useAhead(book.id);
  return (
    <div className="tr-gap" data-skip>
      <span>Not in English yet</span>
      <button
        className="btn btn--quiet"
        disabled={!!run}
        onClick={() => {
          void aiReady().then((ok) => (ok ? void translateAhead(book, { from: at, count: 20 }) : toast('Connect your AI first: Settings › Your AI.')));
        }}
      >
        <span className="ai-mark" aria-hidden="true">✦</span> {run ? 'Translating…' : 'Translate from here'}
      </button>
    </div>
  );
}

/**
 * Minutes left in the chapter at this reader's own pace. The pace is learned from how far
 * they get in a minute of steady reading (jumps and long pauses do not count).
 */
function useMinutesLeft(pos: { section: number; block: number }, sec: Section | undefined, translations: Map<string, Translation>, view: 'en' | 'orig' | 'both'): number | null {
  const speed = useSetting('readingSpeed');
  const last = useRef<{ section: number; block: number; at: number } | null>(null);
  const sample = useRef({ chars: 0, ms: 0 });
  const lengthOf = useCallback(
    (s: Section, i: number) => {
      const b = s.blocks[i];
      if (!b) return 0;
      if (b.t === 'img') return b.src?.startsWith('page') && !s.blocks.some((x) => x.ocr && x.page === b.page) ? 1100 : 0;
      const en = view !== 'orig' ? translations.get(`${s.idx}:${i}`)?.en : undefined;
      return (en ?? b.text).length;
    },
    [translations, view],
  );
  useEffect(() => {
    const now = Date.now();
    const prev = last.current;
    last.current = { ...pos, at: now };
    if (!prev || !sec || prev.section !== pos.section || pos.block <= prev.block || pos.block - prev.block > 12) return;
    const ms = now - prev.at;
    if (ms > 3 * 60_000 || ms < 1500) return;
    let chars = 0;
    for (let i = prev.block; i < pos.block; i++) chars += lengthOf(sec, i);
    sample.current = { chars: sample.current.chars + chars, ms: sample.current.ms + ms };
    if (sample.current.ms > 90_000) {
      const measured = sample.current.chars / (sample.current.ms / 60_000);
      sample.current = { chars: 0, ms: 0 };
      if (measured > 250 && measured < 4000) void setSetting('readingSpeed', Math.round(speed * 0.75 + measured * 0.25));
    }
  }, [pos, sec, lengthOf, speed]);
  if (!sec || !sec.blocks.length) return null;
  let left = 0;
  for (let i = pos.block; i < sec.blocks.length; i++) left += lengthOf(sec, i);
  return Math.round(left / Math.max(250, speed));
}

/** While translating ahead runs, a small note at the foot of the page says how far it has got. */
function AheadPill({ book }: { book: Book }) {
  const run = useAhead(book.id);
  // A scanned book's pages being read in the background (the whole book) show here too.
  const ocr = book.ocr;
  const reading = !run && ocr && (ocr.state === 'running' || ocr.state === 'waiting') && ocr.done < ocr.total;
  // The whole of a book of text being translated in the background.
  const t = book.translation;
  const whole = !run && !reading && t && (t.state === 'queued' || t.state === 'running' || t.state === 'waiting') && t.total > 0;
  if (!run && !reading && !whole) return null;
  if (whole) {
    return (
      <div className="ahead-pill" role="status">
        <span className="ai-mark" aria-hidden="true">✦</span>
        <span className="ahead-pill-text">{t!.state === 'waiting' ? `Whole book: waiting for your AI · ${t!.done} of ${t!.total}` : `Translating the whole book · ${t!.done} of ${t!.total}`}</span>
      </div>
    );
  }
  const text = run
    ? run.waiting
      ? `AI busy · trying again in ${run.waiting} s`
      : run.unit === 'pages'
        ? run.page
          ? `Reading and translating page ${run.page}${run.total > 1 ? ` · ${run.done + 1} of ${run.total}` : ''}${run.follow ? ' · as you read' : ''}`
          : run.follow
            ? 'Keeping the next pages read and translated'
            : 'Reading and translating…'
        : run.total
          ? `Translating ${run.done} of ${run.total}${run.follow ? ' · as you read' : ''}`
          : run.follow
            ? 'Translating as you read'
            : 'Translating…'
    : ocr!.state === 'waiting'
      ? /busy/i.test(ocr!.error ?? '')
        ? 'Reading pages: AI busy, carries on in a few minutes'
        : /used up/i.test(ocr!.error ?? '')
          ? 'Reading pages: today’s allowance is used up'
          : 'Reading pages: waiting for your AI'
      : `Reading and translating pages · ${ocr!.done} of ${ocr!.total}`;
  return (
    <div className="ahead-pill" role="status">
      <span className="ai-mark" aria-hidden="true">✦</span>
      <span className="ahead-pill-text">{text}</span>
      {run && <button onClick={stopAhead} aria-label="Stop translating">Stop</button>}
    </div>
  );
}

/** Reader controls for the English: which language to show, and translating ahead. */
function TranslationControls({ book, view, hasTranslation, from }: { book: Book; view: 'en' | 'orig' | 'both'; hasTranslation: boolean; from: { section: number; block: number } }) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = useAhead(book.id);
  const scanned = isScanned(book);
  // Asked while the reader's finger is on the button, so a note can say when it is done.
  const askToNotify = () => {
    if (!isAndroidApp() && typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission().catch(() => undefined);
  };
  const ahead = (count: number) => {
    askToNotify();
    void translateAhead(book, { from, count });
  };
  const whole = async () => {
    askToNotify();
    setBusy('Starting…');
    try {
      if (scanned) {
        await translateWholeScan(book);
        toast('Every page will be read and translated, starting here. It carries on by itself.');
      } else {
        await startBookTranslation(book);
        toast('The whole book is being translated. It carries on by itself, even with the book closed.');
      }
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const t = book.translation;
  const wholeRunning = scanned ? !!book.ocr && book.ocr.state !== 'done' && book.ocr.state !== 'failed' && book.ocr.state !== 'waiting' : !!t && t.state !== 'done' && t.state !== 'cancelled';
  return (
    <>
      {hasTranslation && book.format !== 'pdf' && (
        <div className="ctl">
          <div className="lbl"><span>Show</span></div>
          <div className="seg" role="group" aria-label="Language to show">
            <button aria-pressed={view === 'en'} onClick={() => void db.books.update(book.id, { view: 'en' })}>English</button>
            <button aria-pressed={view === 'orig'} onClick={() => void db.books.update(book.id, { view: 'orig' })}>Original</button>
            <button aria-pressed={view === 'both'} onClick={() => void db.books.update(book.id, { view: 'both' })}>Both</button>
          </div>
        </div>
      )}
      {hasTranslation && book.format === 'pdf' && <ShowChoices book={book} view={view} scanned={scanned} />}
      <div className="ctl">
        <div className="lbl">
          <span><span className="ai-mark" aria-hidden="true">✦</span> Translate ahead from here</span>
          <span>{scanned ? 'each page: read by your AI, then put into English' : 'about 1 request per 8 paragraphs'}</span>
        </div>
        <div className="ahead-grid" role="group" aria-label="Translate ahead">
          <button className="btn" disabled={!!run} onClick={() => ahead(scanned ? 3 : 10)}>{scanned ? 'Next 3 pages' : 'Next 10'}</button>
          <button className="btn" disabled={!!run} onClick={() => ahead(scanned ? 10 : 40)}>{scanned ? 'Next 10 pages' : 'Next 40'}</button>
          <button className="btn" aria-pressed={!!run?.follow} onClick={() => (run?.follow ? stopAhead() : (askToNotify(), void translateAhead(book, { from, follow: true })))}>{run?.follow ? 'As I read: on' : 'As I read'}</button>
          <button className="btn" disabled={!!run || !!busy || wholeRunning} onClick={() => void whole()}>{wholeRunning ? 'Whole book: under way' : 'Whole book'}</button>
        </div>
        <p className="muted small" style={{ margin: '6px 0 0' }}>
          It carries on when you close this and read on. <b>As I read</b> keeps {scanned ? 'the next pages' : 'the pages ahead of you'} translated while the book is open.
          {scanned ? ' Each page is about one request of your free allowance.' : ''}
        </p>
        {run && (
          <div className="ahead-progress">
            <progress max={Math.max(1, run.total)} value={run.done} aria-label="Translation progress" />
            <span className="muted small">{run.total ? `${run.done} of ${run.total}${run.unit === 'pages' ? ' pages' : ''}` : '…'}</span>
            <button className="btn btn--quiet" onClick={stopAhead}>Stop</button>
          </div>
        )}
        {run?.waiting ? <p className="muted small" role="status">Your AI is busy (the free models are overloaded). Trying again in {run.waiting} s…</p> : null}
        {busy && <p className="muted small" role="status">{busy}</p>}
      </div>
      {hasTranslation && (
        <div className="ctl">
          <div className="lbl"><span><span className="ai-mark" aria-hidden="true">✦</span> Check with a second AI</span></div>
          <p className="muted small" style={{ margin: 0 }}>
            Another AI reads this chapter’s English against the original. What is faithful is marked checked; anything mistranslated or left out is corrected, and each change is shown under its † with the reason.
          </p>
          <button
            className="btn"
            disabled={!!busy}
            onClick={async () => {
              setBusy('Checking…');
              try {
                const r = await reviewChapter(book, from.section, (d, t) => setBusy(`Checking… ${d} of ${t} paragraphs`));
                toast(r.checked + r.corrected ? `${r.checked + r.corrected} paragraphs checked: ${r.checked} confirmed${r.corrected ? `, ${r.corrected} corrected (tap † to see why)` : ''}.` : 'Nothing in this chapter is waiting to be checked.');
              } catch (e) {
                toast((e as Error).message);
              } finally {
                setBusy(null);
              }
            }}
          >
            Check this chapter
          </button>
        </div>
      )}
    </>
  );
}

/** How a PDF is shown: its printed pages (alone or with their English), or as running text. */
function ShowChoices({ book, view, scanned }: { book: Book; view: 'en' | 'orig' | 'both'; scanned: boolean }) {
  const pages = (book.scanView ?? (scanned ? 'page' : 'text')) === 'page';
  const choices: Array<{ label: string; sub: string; on: boolean; set: Partial<Book> }> = [
    { label: 'Pages', sub: 'Exactly as printed, nothing added', on: pages && view === 'orig', set: { scanView: 'page', view: 'orig' } },
    { label: 'Page + English', sub: 'Each page, its English beneath', on: pages && view !== 'orig', set: { scanView: 'page', view: 'en' } },
    { label: 'English only', sub: 'Running text, like a book', on: !pages && view === 'en', set: { scanView: 'text', view: 'en' } },
    { label: 'Both', sub: 'Each paragraph, then its English', on: !pages && view === 'both', set: { scanView: 'text', view: 'both' } },
    { label: scanned ? 'Text read' : 'Original text', sub: scanned ? 'The words read from the pages' : 'The text stored in the PDF', on: !pages && view === 'orig', set: { scanView: 'text', view: 'orig' } },
  ];
  return (
    <div className="ctl">
      <div className="lbl"><span>Show</span></div>
      <div className="show-grid" role="group" aria-label="What to show">
        {choices.map((c) => (
          <button key={c.label} aria-label={c.label} title={c.sub} aria-pressed={c.on} onClick={() => void db.books.update(book.id, c.set)}>
            <b>{c.label}</b>
            <span>{c.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function MarkEditor({ mark, onClose }: { mark: Mark; onClose: () => void }) {
  const [note, setNote] = useState(mark.note ?? '');
  const [color, setColor] = useState<HighlightColor>(mark.color ?? 'gold');
  const lang = detectLang(mark.text ?? '');

  const save = async () => {
    await db.marks.update(mark.id, { note: note.trim() || undefined, color, type: note.trim() ? 'note' : 'highlight', updatedAt: Date.now() });
    onClose();
  };

  return (
    <Sheet title={mark.note ? 'Note' : 'Highlight'} onClose={onClose}>
      <p className="note-text" dir="auto" lang={lang === 'other' ? undefined : lang} style={{ maxHeight: '8.5em', overflow: 'auto' }}>
        <span className="hl" data-c={color}>{mark.text}</span>
      </p>
      <div className="sel-bar" style={{ position: 'static', transform: 'none', boxShadow: 'none', animation: 'none', justifyContent: 'center' }} role="group" aria-label="Highlight colour">
        {COLORS.map((c) => (
          <button key={c} className="dot" data-c={c} aria-label={COLOR_NAME[c]} aria-pressed={color === c} onClick={() => setColor(c)}><i /></button>
        ))}
      </div>
      <label className="stack">
        Note
        <span className="field"><textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} dir="auto" placeholder="Write a note about this passage" /></span>
      </label>
      <button className="btn btn--primary btn--block" onClick={() => void save()}>Save</button>
      <button
        className="btn btn--quiet btn--danger"
        onClick={async () => {
          await db.marks.delete(mark.id);
          toast('Highlight removed.');
          onClose();
        }}
      >
        <Icon name="trash" size={18} />Remove highlight
      </button>
    </Sheet>
  );
}
