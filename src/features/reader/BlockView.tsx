import { memo, useEffect, useState } from 'react';
import { db } from '../../db/db';
import type { Block, Lang, Mark, Translation } from '../../db/types';
import { hasArabicScript, isRtl } from '../../lib/arabic';
import { atPageEdge, PdfPage } from './PdfPage';
import { renderBlock } from './segments';
import { findQuranRefs, type QuranMatch } from '../../quran/refs';
import { SEED_GLOSSARY, type Term } from '../../../server/src/glossary';
import type { ZoomSource } from './ZoomViewer';

interface Props {
  bookId: string;
  bookLang: Lang;
  section: number;
  index: number;
  block: Block;
  marks: Mark[];
  flash?: [number, number];
  showTashkil: boolean;
  onNote: (section: number, noteId: string) => void;
  onMark: (markId: string) => void;
  onZoom: (source: ZoomSource) => void;
  /** The paragraph's English, when it has been translated. */
  tr?: Translation;
  /** Which language to show this paragraph in. */
  show?: 'en' | 'orig' | 'both';
  /** True when the reader tapped this paragraph to see the other language. */
  flipped?: boolean;
  onFlip?: (section: number, index: number) => void;
  onUncertain?: (tr: Translation) => void;
  onQuran?: (m: QuranMatch) => void;
  /** A technical term tapped in the English. */
  onTerm?: (term: Term, section: number, index: number) => void;
}

/** The glossary's terms as they are written in the English (ijmāʿ, qiyās…), longest first. */
const TERMS = [...SEED_GLOSSARY].filter((t) => t.tr.length >= 4).sort((a, b) => b.tr.length - a.tr.length);
const TERM_RE = new RegExp(`(?<![\\p{L}\\p{M}])(${TERMS.map((t) => t.tr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{M}])`, 'giu');
function termsIn(text: string): Array<{ start: number; end: number; term: Term }> {
  const out: Array<{ start: number; end: number; term: Term }> = [];
  for (const m of text.matchAll(TERM_RE)) {
    const term = TERMS.find((t) => t.tr.toLowerCase() === m[0].toLowerCase());
    if (term && m.index !== undefined) out.push({ start: m.index, end: m.index + m[0].length, term });
  }
  return out;
}

const EMPTY: Mark[] = [];
export const NO_MARKS = EMPTY;

function useAssetUrl(bookId: string, name: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!name) return;
    let made: string | null = null;
    let alive = true;
    void db.assets.get(`${bookId}:${name}`).then((rec) => {
      if (!rec || !alive) return;
      made = URL.createObjectURL(rec.blob);
      setUrl(made);
    });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [bookId, name]);
  return url;
}

function AssetImage({ bookId, name, alt, onZoom }: { bookId: string; name: string; alt: string; onZoom: (s: ZoomSource) => void }) {
  const url = useAssetUrl(bookId, name);
  if (!url) return <span className="muted small" data-skip>…</span>;
  return <img src={url} alt={alt} loading="lazy" decoding="async" onClick={(e) => (atPageEdge(e) ? undefined : onZoom({ kind: 'img', url }))} style={{ cursor: 'zoom-in' }} />;
}

/** Works out which script a block is written in, so each gets its own typeface and direction. */
function blockLang(block: Block, bookLang: Lang): Lang {
  if (block.lang) return block.lang;
  if (hasArabicScript(block.text)) return isRtl(bookLang) ? bookLang : 'ar';
  return /[A-Za-z]/.test(block.text) ? 'en' : bookLang;
}

/** The English as shown: each † set against the word it qualifies (the space before it dropped). */
export function enDisplay(en: string): string {
  const parts = en.split('†');
  return parts.map((p, i) => (i < parts.length - 1 ? p.replace(/\s+$/, '') + '†' : p)).join('');
}

/** Where a highlight made on the English sits now (the English may have been made again since). */
function placeOf(text: string, m: Mark): [number, number] | null {
  if (m.start === undefined || m.end === undefined) return null;
  if (m.text && text.slice(m.start, m.end) === m.text) return [m.start, m.end];
  if (m.text) {
    const at = text.indexOf(m.text);
    if (at >= 0) return [at, at + m.text.length];
    return null;
  }
  return m.end <= text.length ? [m.start, m.end] : null;
}

/**
 * The English of a paragraph: each † a button that explains the doubt, verse references
 * that open the verse, and the reader's own highlights and notes.
 */
function English({ tr, marks, onUncertain, onQuran, onMark, onTerm, heading, section, index, onFlip }: { tr: Translation; marks: Mark[]; onUncertain?: (t: Translation) => void; onQuran?: (m: QuranMatch) => void; onMark?: (id: string) => void; onTerm?: (term: Term, section: number, index: number) => void; heading: boolean; section: number; index: number; onFlip?: (s: number, i: number) => void }) {
  const text = enDisplay(tr.en);
  // English that has only just arrived writes itself in.
  const [fresh] = useState(() => Date.now() - tr.updatedAt < 5000);
  const refs = findQuranRefs(text).filter((m) => m.kind === 'ref');
  // Technical terms, tappable for their meaning (not inside a verse reference).
  const terms = onTerm && !heading ? termsIn(text).filter((t) => !refs.some((r) => t.start < r.end && r.start < t.end)) : [];
  const hls = marks.filter((m) => m.en && m.type !== 'bookmark').map((m) => ({ m, at: placeOf(text, m) })).filter((x): x is { m: Mark; at: [number, number] } => !!x.at);
  const cuts = new Set([0, text.length]);
  for (const r of refs) cuts.add(r.start).add(r.end);
  for (const t of terms) cuts.add(t.start).add(t.end);
  for (const h of hls) cuts.add(h.at[0]).add(h.at[1]);
  for (let i = 0; i < text.length; i++) if (text[i] === '†') cuts.add(i).add(i + 1);
  const pts = [...cuts].filter((n) => n >= 0 && n <= text.length).sort((a, b) => a - b);
  const Tag = heading ? 'h2' : 'p';
  return (
    <Tag
      className="bk bk--en"
      data-s={section}
      data-b={index}
      data-t={heading ? 'h' : 'p'}
      data-en
      data-flip
      data-fresh={fresh || undefined}
      lang="en"
      dir="ltr"
      onClick={(e) => {
        if (!window.getSelection()?.isCollapsed || (e.target as Element).closest('.unc, .qref, .hl')) return;
        onFlip?.(section, index);
      }}
    >
      {pts.slice(0, -1).map((a, k) => {
        const b = pts[k + 1];
        const piece = text.slice(a, b);
        if (piece === '†') {
          return (
            <button
              key={k}
              className="unc"
              aria-label="Why the translation is unsure here"
              onClick={(e) => {
                e.stopPropagation();
                onUncertain?.(tr);
              }}
            >
              †
            </button>
          );
        }
        let node: React.ReactNode = piece;
        const ref = refs.find((r) => r.start <= a && b <= r.end);
        if (ref) {
          node = (
            <span className="qref" role="button" tabIndex={0} onClick={(e) => { if (!window.getSelection()?.isCollapsed) return; e.stopPropagation(); onQuran?.(ref); }}>
              {node}
            </span>
          );
        }
        const term = terms.find((t) => t.start <= a && b <= t.end);
        if (term) {
          node = (
            <span className="term" role="button" tabIndex={0} title={`${term.term.tr}: ${term.term.en}`} onClick={(e) => { if (!window.getSelection()?.isCollapsed) return; e.stopPropagation(); onTerm?.(term.term, section, index); }}>
              {node}
            </span>
          );
        }
        // The latest highlight wins where two overlap.
        const hl = [...hls].reverse().find((h) => h.at[0] <= a && b <= h.at[1]);
        if (hl) {
          const id = hl.m.id;
          node = (
            <span className="hl" data-c={hl.m.color} data-note={hl.m.note || undefined} data-mark={id} data-fresh={Date.now() - hl.m.createdAt < 2500 || undefined} onClick={(e) => { if (!window.getSelection()?.isCollapsed) return; e.stopPropagation(); onMark?.(id); }}>
              {node}
            </span>
          );
        }
        return <span key={k}>{node}</span>;
      })}
    </Tag>
  );
}

export const BlockView = memo(function BlockView({ bookId, bookLang, section, index, block, marks, flash, showTashkil, onNote, onMark, onZoom, tr, show = 'orig', flipped, onFlip, onUncertain, onQuran, onTerm }: Props) {
  const common = { 'data-s': section, 'data-b': index, 'data-t': block.t } as const;
  const bookmark = marks.find((m) => m.type === 'bookmark');
  const bookmarked = bookmark ? (Date.now() - bookmark.createdAt < 2500 ? 'fresh' : true) : false;

  if (block.t === 'hr') return <div className="bk" {...common} role="separator" />;

  if (block.t === 'img') {
    const pageMatch = block.src?.match(/^page:(\d+)$/);
    return (
      <div className="bk" {...common} data-bookmark={bookmarked || undefined}>
        {pageMatch ? (
          <PdfPage bookId={bookId} page={Number(pageMatch[1])} label={block.printed} onZoom={() => onZoom({ kind: 'pdf', bookId, page: Number(pageMatch[1]) })} />
        ) : block.src ? (
          <AssetImage bookId={bookId} name={block.src} alt={block.text} onZoom={onZoom} />
        ) : null}
      </div>
    );
  }

  const heading = block.t === 'h';
  if (tr && show === 'en' && !flipped) {
    return <English tr={tr} marks={marks} onUncertain={onUncertain} onQuran={onQuran} onMark={onMark} onTerm={onTerm} heading={heading} section={section} index={index} onFlip={onFlip} />;
  }

  const lang = blockLang(block, bookLang);
  const { segments, tail } = renderBlock(block, marks.some((m) => m.en) ? marks.filter((m) => !m.en) : marks, flash, showTashkil, findQuranRefs(block.text));
  const Tag = block.t === 'h' ? 'h2' : block.t === 'quote' ? 'blockquote' : 'p';
  const fn = (n: { id: string; label: string }) => (
    <span
      key={`fn-${n.id}`}
      className="fn"
      role="button"
      tabIndex={0}
      data-label={n.label}
      aria-label={`Footnote ${n.label}`}
      onClick={(e) => {
        e.stopPropagation();
        onNote(section, n.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onNote(section, n.id);
      }}
    />
  );

  const original = (
    <Tag
      className="bk"
      {...common}
      data-flip={tr && show === 'en' ? true : undefined}
      data-shown-original={tr && show === 'en' && flipped ? true : undefined}
      onClick={tr && show === 'en' ? (e: React.MouseEvent) => {
        if (!window.getSelection()?.isCollapsed || (e.target as Element).closest('.fn, .hl, .qref, .ayah')) return;
        onFlip?.(section, index);
      } : undefined}
      data-l={block.level}
      lang={lang === 'other' ? undefined : lang}
      dir="auto"
      data-bookmark={bookmarked || undefined}
      data-low={block.ocr && (block.conf ?? 100) < 75 ? true : undefined}
      title={block.ocr && (block.conf ?? 100) < 75 ? 'Recognised from the page image. It may contain mistakes.' : undefined}
    >
      {segments.map((seg, i) => {
        let node: React.ReactNode = seg.text;
        if (seg.b) node = <b>{node}</b>;
        if (seg.i) node = <i>{node}</i>;
        if (seg.flash) node = <mark className="flash">{node}</mark>;
        if (seg.q) {
          const q = seg.q;
          node = (
            <span
              className={q.kind === 'quote' ? 'ayah' : 'qref'}
              role="button"
              tabIndex={0}
              onClick={(e) => {
                if (!window.getSelection()?.isCollapsed) return;
                e.stopPropagation();
                onQuran?.(q);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onQuran?.(q);
              }}
            >
              {node}
            </span>
          );
        }
        if (seg.mark) {
          const id = seg.mark.id;
          node = (
            <span
              className="hl"
              data-c={seg.mark.color}
              data-note={seg.mark.note || undefined}
              data-mark={id}
              data-fresh={Date.now() - seg.mark.createdAt < 2500 || undefined}
              onClick={(e) => {
                if (!window.getSelection()?.isCollapsed) return;
                e.stopPropagation();
                onMark(id);
              }}
            >
              {node}
            </span>
          );
        }
        return (
          <span key={i}>
            {seg.notesBefore?.map(fn)}
            {node}
          </span>
        );
      })}
      {tail.map(fn)}
    </Tag>
  );
  if (tr && show === 'both') {
    return (
      <div className="bk-pair">
        {original}
        <English tr={tr} marks={marks} onUncertain={onUncertain} onQuran={onQuran} onMark={onMark} onTerm={onTerm} heading={heading} section={section} index={index} />
      </div>
    );
  }
  return original;
});
