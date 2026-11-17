import { useEffect, useRef, useState } from 'react';
import type { Book } from '../../db/types';
import { getServer } from '../../ai/client';
import { chapterAt, summariseChapter, type Summary } from '../../ai/study';
import { langAttr } from '../../lib/arabic';
import { navigate } from '../../app/router';
import { Sheet } from '../../ui/Sheet';
import { Icon } from '../../ui/Icon';

interface Props {
  book: Book;
  at: { section: number; block: number };
  onGo: (section: number, block: number) => void;
  onClose: () => void;
}

/** A summary of the chapter being read, made only from its paragraphs, each point cited. */
export function SummarySheet({ book, at, onGo, onClose }: Props) {
  const [result, setResult] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [round, setRound] = useState(0);
  const bookRef = useRef(book);
  bookRef.current = book;
  const title = chapterAt(book, at).title;

  useEffect(() => {
    let alive = true;
    setResult(null);
    setError('');
    void (async () => {
      if (!(await getServer())) {
        if (alive) setError('setup');
        return;
      }
      try {
        const r = await summariseChapter(bookRef.current, at, round > 0);
        if (alive) setResult(r);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at.section, at.block, round]);

  const order: string[] = [];
  result?.summary.replace(/\[([^\]\s]+)\]/g, (_, id: string) => {
    if (!order.includes(id)) order.push(id);
    return '';
  });
  const open = (id: string) => {
    const s = result?.sources.find((x) => x.id === id);
    if (!s) return;
    onGo(s.section, s.block);
    onClose();
  };

  return (
    <Sheet title="Chapter summary" onClose={onClose}>
      <p className="eyebrow" dir="auto" lang={langAttr(title)} style={{ margin: 0 }}>{title}</p>
      {error === 'setup' ? (
        <button className="btn btn--block" onClick={() => navigate('/settings/ai')}>Set up AI first</button>
      ) : error ? (
        <div className="banner banner--error" role="alert"><Icon name="warn" /><span className="grow">{error}</span></div>
      ) : !result ? (
        <p className="muted" role="status"><span className="ai-mark" aria-hidden="true">✦</span> Reading the chapter…</p>
      ) : (
        <article className="answer" aria-live="polite">
          <div className="answer-text summary-text">
            {result.summary.split(/\n+/).filter(Boolean).map((line, li) => (
              <p key={li}>
                {line.split(/(\[[^\]\s]+\])/).map((part, i) => {
                  const m = part.match(/^\[([^\]\s]+)\]$/);
                  if (!m) return <span key={i}>{part}</span>;
                  const n = order.indexOf(m[1]) + 1;
                  return <button key={i} className="cite" onClick={() => open(m[1])} aria-label={`Go to source ${n}`}>{n}</button>;
                })}
              </p>
            ))}
          </div>
          {result.covered < result.total && (
            <div className="banner"><Icon name="warn" /><span className="grow">This chapter is long: the summary covers its first {result.covered} of {result.total} paragraphs.</span></div>
          )}
          {order.length > 0 && (
            <>
              <div className="section-title" style={{ marginTop: 6 }}>Sources</div>
              <ol className="sources">
                {order.map((id) => {
                  const s = result.sources.find((x) => x.id === id);
                  if (!s) return null;
                  return (
                    <li key={id}>
                      <button onClick={() => open(id)}>
                        <span className="src-text" dir="auto" lang={langAttr(s.text)}>{s.text.slice(0, 160)}{s.text.length > 160 ? '…' : ''}</span>
                        <span className="muted small" dir="auto">{s.cite}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
          <p className="muted small"><span className="ai-mark" aria-hidden="true">✦</span> AI draft from {result.model.replace(/^.*\//, '') || 'the chapter'}, made only from this chapter. Tap a number to read the passage.</p>
          <button className="btn btn--block" onClick={() => setRound((r) => r + 1)}>Summarise again</button>
        </article>
      )}
    </Sheet>
  );
}
