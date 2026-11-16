import { memo, useEffect, useState } from 'react';
import { db } from '../../db/db';
import type { Block, Lang, Mark } from '../../db/types';
import { hasArabicScript, isRtl } from '../../lib/arabic';
import { PdfPage } from './PdfPage';
import { renderBlock } from './segments';
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

export const BlockView = memo(function BlockView({ bookId, bookLang, section, index, block, marks, flash, showTashkil, onNote, onMark, onZoom }: Props) {
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

  const lang = blockLang(block, bookLang);
  const { segments, tail } = renderBlock(block, marks, flash, showTashkil);
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

  return (
    <Tag className="bk" {...common} data-l={block.level} lang={lang === 'other' ? undefined : lang} dir="auto" data-bookmark={bookmarked || undefined}>
      {segments.map((seg, i) => {
        let node: React.ReactNode = seg.text;
        if (seg.b) node = <b>{node}</b>;
        if (seg.i) node = <i>{node}</i>;
        if (seg.flash) node = <mark className="flash">{node}</mark>;
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
});
