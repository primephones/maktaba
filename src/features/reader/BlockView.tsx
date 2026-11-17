import { memo, useEffect, useState } from 'react';
import { db } from '../../db/db';
import type { Block, Lang, Mark, Translation } from '../../db/types';
import { hasArabicScript, isRtl } from '../../lib/arabic';
import { PdfPage } from './PdfPage';
import { renderBlock } from './segments';
import { findQuranRefs, type QuranMatch } from '../../quran/refs';
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
  return <img src={url} alt={alt} loading="lazy" decoding="async" onClick={() => onZoom({ kind: 'img', url })} style={{ cursor: 'zoom-in' }} />;
}

/** Works out which script a block is written in, so each gets its own typeface and direction. */
function blockLang(block: Block, bookLang: Lang): Lang {
  if (block.lang) return block.lang;
  if (hasArabicScript(block.text)) return isRtl(bookLang) ? bookLang : 'ar';
  return /[A-Za-z]/.test(block.text) ? 'en' : bookLang;
}

/** The English of a paragraph, with each † a button that explains the doubt. */
function linkVerses(text: string, onQuran?: (m: QuranMatch) => void): React.ReactNode {
  const refs = findQuranRefs(text).filter((m) => m.kind === 'ref');
  if (!refs.length) return text;
  const out: React.ReactNode[] = [];
  let at = 0;
  refs.forEach((m, i) => {
    out.push(text.slice(at, m.start));
    out.push(
      <span key={i} className="qref" role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); onQuran?.(m); }}>
        {text.slice(m.start, m.end)}
      </span>,
    );
    at = m.end;
  });
  out.push(text.slice(at));
  return out;
}

function English({ tr, onUncertain, onQuran, heading, section, index, onFlip }: { tr: Translation; onUncertain?: (t: Translation) => void; onQuran?: (m: QuranMatch) => void; heading: boolean; section: number; index: number; onFlip?: (s: number, i: number) => void }) {
  const parts = tr.en.split('†');
  const Tag = heading ? 'h2' : 'p';
  return (
    <Tag
      className="bk bk--en"
      data-s={section}
      data-b={index}
      data-t={heading ? 'h' : 'p'}
      data-en
      data-flip
      lang="en"
      dir="ltr"
      onClick={(e) => {
        if (!window.getSelection()?.isCollapsed || (e.target as Element).closest('.unc, .qref')) return;
        onFlip?.(section, index);
      }}
    >
      {parts.map((part, i) => (
        <span key={i}>
          {linkVerses(part, onQuran)}
          {i < parts.length - 1 && (
            <button
              className="unc"
              aria-label="Why the translation is unsure here"
              onClick={(e) => {
                e.stopPropagation();
                onUncertain?.(tr);
              }}
            >
              †
            </button>
          )}
        </span>
      ))}
    </Tag>
  );
}

export const BlockView = memo(function BlockView({ bookId, bookLang, section, index, block, marks, flash, showTashkil, onNote, onMark, onZoom, tr, show = 'orig', flipped, onFlip, onUncertain, onQuran }: Props) {
  const common = { 'data-s': section, 'data-b': index, 'data-t': block.t } as const;
  const bookmarked = marks.some((m) => m.type === 'bookmark');

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
    return <English tr={tr} onUncertain={onUncertain} onQuran={onQuran} heading={heading} section={section} index={index} onFlip={onFlip} />;
  }

  const lang = blockLang(block, bookLang);
  const { segments, tail } = renderBlock(block, marks, flash, showTashkil, findQuranRefs(block.text));
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
        <English tr={tr} onUncertain={onUncertain} onQuran={onQuran} heading={heading} section={section} index={index} />
      </div>
    );
  }
  return original;
});
