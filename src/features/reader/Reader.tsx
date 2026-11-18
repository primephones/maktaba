import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { haptic } from '../../lib/haptics';
import { db, sectionId, uid } from '../../db/db';
import type { Book, HighlightColor, Mark, Reference, Section, Translation } from '../../db/types';
import { detectLang, hasArabicScript, stripTashkilWithMap } from '../../lib/arabic';
import { clamp, percent } from '../../lib/util';
import { closePdf } from '../../lib/pdfjs';
import { formatCitation } from '../../lib/citation';
import { native } from '../../native/maktaba';
import { sourceParagraphs, translatable, translateNow } from '../../ai/translation';
import type { QuranMatch } from '../../quran/refs';
import { QuranSheet } from '../quran/QuranSheet';
import { StudySheet } from './StudySheet';
import { SummarySheet } from './SummarySheet';
import { OriginalViewer } from './OriginalViewer';
import { openOriginal } from '../../lib/saveFile';
import { Listen } from './Listen';
import { canSpeak } from '../../speech/speech';
import { goBack, navigate } from '../../app/router';
import { useSetting } from '../../app/settings';
import { EmptyState } from '../../ui/EmptyState';
import { Icon } from '../../ui/Icon';
import { Sheet } from '../../ui/Sheet';
import { toast } from '../../ui/toast';
import { BlockView, NO_MARKS } from './BlockView';
import { ScanPageAction } from './ScanPage';
import { BookSearch } from './BookSearch';
import { Contents } from './Contents';
import { takeJump } from './jump';
import { ReadingControls } from './ReadingControls';
import { readSelection, type ReaderSelection } from './selection';
import { PagedView, ScrollView, type Target } from './views';
import { ZoomViewer, type PageMark, type ZoomSource } from './ZoomViewer';

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
  const [chrome, setChrome] = useState(true);
  const [sheet, setSheet] = useState<null | 'contents' | 'settings' | 'search' | 'summary'>(null);
  const [flash, setFlash] = useState<{ section: number; block: number; range: [number, number] } | null>(
    opening.flash ? { section: opening.section, block: opening.block, range: opening.flash } : null,
  );
  const [note, setNote] = useState<string | null>(null);
  const [editMark, setEditMark] = useState<string | null>(null);
  const [zoom, setZoom] = useState<ZoomSource | null>(null);
  const [original, setOriginal] = useState<{ page: number; mark?: PageMark } | null>(null);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
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
    return () => closePdf(book.id);
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

  const goTo = useCallback((section: number, block: number, range?: [number, number]) => {
    setTarget((t) => ({ section, block, nonce: t.nonce + 1 }));
    lastJump.current = Date.now();
    latest.current = { section, block };
    setPos({ section, block });
    if (range) setFlash({ section, block, range });
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(persist, 900);
  }, [persist]);

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
    if (selection.parts.every((p) => p.en)) {
      toast('Highlights are kept on the original text. Tap the paragraph to show the original, then highlight there.');
      return;
    }
    const now = Date.now();
    const made: Mark[] = [];
    for (const part of selection.parts.filter((x) => !x.en)) {
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
  const [studyOpen, setStudyOpen] = useState<{ kind: 'explain' | 'irab'; text: string; en?: string; cite: string } | null>(null);
  const openStudy = (kind: 'explain' | 'irab') => {
    if (!selection) return;
    const parts = selection.parts.map((p) => (p.en ? { ...p, en: false, start: 0, end: cache.current.get(p.section)?.blocks[p.block]?.text.length ?? 0 } : p)).map(toStored).filter((p): p is NonNullable<typeof p> => !!p);
    const first = parts[0] ?? selection.parts[0];
    const text = kind === 'irab' ? selection.text : parts.map((p) => p.text).join('\n') || selection.text;
    const en = parts.map((p) => translations.get(`${p.section}:${p.block}`)?.en).filter(Boolean).join('\n') || undefined;
    setStudyOpen({ kind, text, en, cite: formatCitation(citationAt(first.section, first.block)) });
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
  const onZoom = useCallback((source: ZoomSource) => setZoom(source), []);

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

  const renderSection = useCallback(
    (sec: Section) => {
      const out: React.ReactNode[] = [];
      let lastPage: string | undefined;
      const recognised = new Set(sec.blocks.filter((b) => b.ocr).map((b) => b.page));
      // A short note at the head of a chapter says the English is a machine draft, and by whom.
      const firstTr = view !== 'orig' ? sec.blocks.map((_, i) => translations.get(`${sec.idx}:${i}`)).find(Boolean) : undefined;
      if (firstTr) {
        out.push(
          <div className="tr-label" key="trlabel" data-skip>
            <span className="ai-mark" aria-hidden="true">✦</span> English: {firstTr.label === 'reviewed' ? 'reviewed by a scholar' : firstTr.label === 'checked' ? 'checked' : 'machine draft'} ({firstTr.model.replace(/^.*\//, '')}).
            {view === 'en' ? ' Tap a paragraph for the original.' : ''}
          </div>,
        );
      }
      sec.blocks.forEach((block, i) => {
        const isPageImage = block.t === 'img' && (/^page:\d+$/.test(block.src ?? '') || block.src === 'page-1');
        if (block.ocr && scanView === 'page') return;
        if (isPageImage && scanView === 'text' && recognised.has(block.page)) return;
        // Mark where the printed page turns, so a passage can be cited by page.
        const pageNo = block.t === 'img' ? undefined : block.printed ?? (block.page ? String(block.page) : undefined);
        if (pageNo && pageNo !== lastPage) {
          out.push(<div className="pgmark" key={`p${i}`} role="note" aria-label={`Page ${pageNo}`}>{pageNo}</div>);
        }
        if (pageNo) lastPage = pageNo;
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
        out.push(
          <BlockView
            key={i}
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
          />,
        );
        // Under a scanned page: its English, paragraph by paragraph, and a way to read and
        // translate the page now if that is not done yet.
        if (isPageImage && scanView === 'page' && hasScans && (view !== 'orig' || !hasTranslation)) {
          const p = block.page ?? Number(block.src?.match(/\d+/)?.[0] ?? 1);
          const onPage = sec.blocks.map((b, j) => (b.ocr && b.page === p && b.text.trim().length > 1 ? j : -1)).filter((j) => j >= 0);
          const done = onPage.filter((j) => translations.has(`${sec.idx}:${j}`));
          for (const j of done) {
            out.push(
              <BlockView
                key={`en${j}`}
                {...blockProps}
                index={j}
                block={sec.blocks[j]}
                marks={marksByBlock.get(`${sec.idx}:${j}`) ?? NO_MARKS}
                flash={flash && flash.section === sec.idx && flash.block === j ? flash.range : undefined}
                tr={translations.get(`${sec.idx}:${j}`)}
                show="en"
                flipped={flipped.has(`${sec.idx}:${j}`)}
              />,
            );
          }
          if (!onPage.length || done.length < onPage.length) {
            out.push(<ScanPageAction key={`act${i}`} book={book} section={sec.idx} page={p} read={onPage.length > 0} some={done.length > 0} />);
          }
        }
      });
      return out;
    },
    [book, hasScans, hasTranslation, marksByBlock, flash, prefs.tashkil, onNote, onMark, onZoom, scanView, translations, view, flipped, onFlip, onUncertain, onQuran],
  );

  // Recognised text arrives while the book is open: refresh the chapters on screen.
  const ocrDone = book.ocr?.done ?? 0;
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
  }, [ocrDone, book.id]);

  const onTap = useCallback(() => setChrome((c) => !c), []);
  const onUserMove = useCallback(() => setChrome(false), []);
  const onReveal = useCallback(() => setChrome(true), []);

  const currentSection = cache.current.get(pos.section);
  const fraction = scrub ?? fractionAt(book, pos.section, pos.block, currentSection?.blocks.length ?? 0);
  const currentBlock = currentSection?.blocks[pos.block];
  const pageLabel = currentBlock?.printed ?? (currentBlock?.page ? String(currentBlock.page) : '');
  const chapter = chapterAt(pos.section, pos.block);

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
  const layoutKey = `${prefs.fontSize}|${prefs.lineHeight}|${prefs.margin}|${prefs.justify}|${prefs.latinFont}|${prefs.arabicFont}|${prefs.urduFont}|${prefs.tashkil}`;
  const style = {
    '--rd-size': `${(1.1875 * prefs.fontSize) / 100}rem`,
    '--rd-lh': String(prefs.lineHeight),
    '--rd-margin': `${prefs.margin}px`,
    '--rd-font': prefs.latinFont === 'plex' ? 'var(--font-ui)' : 'var(--font-read)',
    '--rd-ar-font': prefs.arabicFont === 'plex' ? 'var(--font-arabic-sans)' : 'var(--font-arabic)',
    '--rd-ur-font': prefs.urduFont === 'amiri' ? 'var(--font-arabic)' : 'var(--font-urdu)',
  } as React.CSSProperties;
  const editing = editMark ? marks.find((m) => m.id === editMark) : undefined;
  const titleLang = detectLang(book.title);

  return (
    <div className="rd" ref={root} style={style} data-chrome={chrome && !selection}>
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

      <header className="rd-top-bar" inert={!chrome || !!selection}>
        <button className="icon-btn" onClick={() => goBack('/library')} aria-label="Back to the library"><Icon name="back" /></button>
        <div className="t" dir="auto" lang={titleLang === 'other' ? undefined : titleLang}>{book.title}</div>
        {hasScans && (
          <button
            className="icon-btn"
            onClick={() => void db.books.update(book.id, { scanView: scanView === 'text' ? 'page' : 'text' })}
            aria-label={scanView === 'text' ? 'Show the page images' : 'Show the recognised text'}
            aria-pressed={scanView === 'page'}
          >
            <Icon name="scan" />
          </button>
        )}
        <button className="icon-btn" onClick={() => void showOriginal()} aria-label={book.format === 'pdf' ? 'See this page in the original' : 'Open the original file'}><Icon name="original" /></button>
        {canSpeak() && <button className="icon-btn" onClick={() => setListening(true)} aria-label="Read aloud" aria-pressed={listening}><Icon name="speaker" /></button>}
        <button className="icon-btn" onClick={() => setSheet('search')} aria-label="Search in this book"><Icon name="search" /></button>
        <button className="icon-btn" onClick={() => void toggleBookmark()} aria-label={bookmarkHere ? 'Remove bookmark' : 'Bookmark this place'} aria-pressed={!!bookmarkHere}>
          <Icon name={bookmarkHere ? 'bookmarkOn' : 'bookmark'} />
        </button>
        <button className="icon-btn" onClick={() => setSheet('contents')} aria-label="Contents, bookmarks and highlights"><Icon name="toc" /></button>
        <button className="icon-btn" onClick={() => setSheet('settings')} aria-label="Text and theme"><Icon name="type" /></button>
      </header>

      <footer className="rd-bottom-bar" inert={!chrome || !!selection}>
        <div className="where">
          <span dir="auto">{chapter || book.title}</span>
          <span>{pageLabel ? `p. ${pageLabel} · ` : ''}{percent(fraction)}</span>
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
            <button className="sel-act" onClick={() => void copy()}><Icon name="copy" size={20} />Copy</button>
          </div>
        </div>
      )}

      {sheet === 'contents' && (
        <Contents book={book} marks={marks} current={pos} onGo={(s, b) => goTo(s, b)} onEditMark={setEditMark} onSummary={() => setSheet('summary')} onClose={() => setSheet(null)} />
      )}
      {sheet === 'summary' && <SummarySheet book={book} at={pos} onGo={(s, b) => goTo(s, b)} onClose={() => setSheet(null)} />}
      {sheet === 'search' && (
        <BookSearch book={book} onGo={(h) => goTo(h.section, h.block, [h.start, h.end])} onClose={() => setSheet(null)} />
      )}
      {sheet === 'settings' && (
        <Sheet title="Text and theme" onClose={() => setSheet(null)}>
          {translatable(book) && <TranslationControls book={book} view={view} hasTranslation={hasTranslation} from={pos} />}
          <ReadingControls showTheme lang={book.lang} />
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
      {original && <OriginalViewer book={book} page={original.page} mark={original.mark} onGo={(s, b) => goTo(s, b)} onClose={() => setOriginal(null)} />}
      {quran && <QuranSheet match={quran} onClose={() => setQuran(null)} />}
      {listening && <Listen book={book} from={pos} translations={translations} defaultSource={view} onClose={() => setListening(false)} />}
      {studyOpen && <StudySheet book={book} {...studyOpen} onClose={() => setStudyOpen(null)} />}
    </div>
  );
}

/** Reader controls for the English: which language to show, and translating ahead. */
function TranslationControls({ book, view, hasTranslation, from }: { book: Book; view: 'en' | 'orig' | 'both'; hasTranslation: boolean; from: { section: number; block: number } }) {
  const [busy, setBusy] = useState<string | null>(null);
  const ahead = async (count: number) => {
    setBusy('Translating…');
    try {
      const have = new Set((await db.translations.where('bookId').equals(book.id).toArray()).map((t) => `${t.section}:${t.block}`));
      const paras = (await sourceParagraphs(book, from)).filter((p) => !have.has(p.id)).slice(0, count);
      if (!paras.length) {
        toast('The next pages are already translated.');
        return;
      }
      const n = await translateNow(book, paras);
      toast(`${n} paragraph${n === 1 ? '' : 's'} translated.`);
      if (!book.view) await db.books.update(book.id, { view: 'en' });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {hasTranslation && (
        <div className="ctl">
          <div className="lbl"><span>Show</span></div>
          <div className="seg" role="group" aria-label="Language to show">
            <button aria-pressed={view === 'en'} onClick={() => void db.books.update(book.id, { view: 'en' })}>English</button>
            <button aria-pressed={view === 'orig'} onClick={() => void db.books.update(book.id, { view: 'orig' })}>Original</button>
            <button aria-pressed={view === 'both'} onClick={() => void db.books.update(book.id, { view: 'both' })}>Both</button>
          </div>
        </div>
      )}
      <div className="ctl">
        <div className="lbl"><span><span className="ai-mark" aria-hidden="true">✦</span> Translate ahead from here</span><span>about 1 request per 8 paragraphs</span></div>
        <div className="seg" role="group" aria-label="Translate ahead">
          <button disabled={!!busy} onClick={() => void ahead(10)}>Next 10</button>
          <button disabled={!!busy} onClick={() => void ahead(40)}>Next 40</button>
          <button disabled={!!busy} onClick={() => navigate('/library')}>Whole book…</button>
        </div>
        {busy && <p className="muted small" role="status">{busy}</p>}
      </div>
    </>
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
