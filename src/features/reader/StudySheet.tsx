import { useEffect, useRef, useState } from 'react';
import type { Book } from '../../db/types';
import { explainPassage, irab, saveIrab, type Explanation, type Irab } from '../../ai/study';
import { aiReady } from '../../ai/client';
import { langAttr } from '../../lib/arabic';
import { navigate } from '../../app/router';
import { Sheet } from '../../ui/Sheet';
import { Icon } from '../../ui/Icon';
import { HelpFor } from '../setup/help';
import { toast } from '../../ui/toast';
import { IrabView } from './IrabView';

interface Props {
  book: Book;
  kind: 'explain' | 'irab';
  text: string;
  en?: string;
  cite: string;
  onClose: () => void;
}

/** Explain a passage, or give the iʿrāb of a sentence: AI drafts, clearly marked as such. */
export function StudySheet({ book, kind, text, en, cite, onClose }: Props) {
  const [result, setResult] = useState<Explanation | Irab | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Irab | null>(null);
  // The book's record changes as reading goes on; the request is made once, for this text.
  const bookRef = useRef(book);
  bookRef.current = book;

  useEffect(() => {
    let alive = true;
    const book = bookRef.current;
    void (async () => {
      if (!(await aiReady())) {
        if (alive) setError('setup');
        return;
      }
      try {
        const r = kind === 'explain' ? await explainPassage(book, text, en, cite) : await irab(book, text);
        if (alive) setResult(r);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [kind, text, en, cite]);

  const title = kind === 'explain' ? 'Explain' : 'Iʿrāb';
  return (
    <Sheet title={title} onClose={onClose}>
      <blockquote className="study-quote" dir="auto" lang={langAttr(text)}>{text.length > 600 ? `${text.slice(0, 600)}…` : text}</blockquote>
      {error === 'setup' ? (
        <button className="btn btn--block" onClick={() => navigate('/settings/ai')}>Connect your AI first</button>
      ) : error ? (
        <HelpFor error={error} />
      ) : !result ? (
        <p className="muted" role="status"><span className="ai-mark" aria-hidden="true">✦</span> Thinking…</p>
      ) : 'explanation' in result ? (
        <>
          <p className="study-text">{result.explanation}</p>
          {result.terms.length > 0 && (
            <div className="list">
              {result.terms.map((t, i) => (
                <div className="row" key={i}><span className="grow"><span className="title">{t.term}</span><div className="sub">{t.meaning}</div></span></div>
              ))}
            </div>
          )}
          <p className="muted small"><span className="ai-mark" aria-hidden="true">✦</span> AI draft ({result.model.replace(/^.*\//, '')}). Check it against the text.</p>
        </>
      ) : (
        <>
          {!editing && <IrabView result={result} />}
          <div className="irab" hidden={!editing}>
            {(editing && draft ? draft : result).words.map((w, i) => (
              <div className="irab-row" key={i}>
                <span className="irab-word" lang="ar" dir="rtl">{w.word}</span>
                {editing && draft ? (
                  <span className="field"><input dir="rtl" lang="ar" value={w.irab} onChange={(e) => setDraft({ ...draft, words: draft.words.map((x, k) => (k === i ? { ...x, irab: e.target.value } : x)) })} aria-label={`Iʿrāb of ${w.word}`} /></span>
                ) : (
                  <span className="irab-text" lang="ar" dir="rtl">{w.irab}</span>
                )}
                {w.en && <span className="muted small">{w.en}</span>}
              </div>
            ))}
          </div>
          {result.note && <p className="muted small">{result.note}</p>}
          <p className="muted small">
            {result.corrected ? 'Corrected by you.' : <><span className="ai-mark" aria-hidden="true">✦</span> AI draft ({result.model.replace(/^.*\//, '')}). Correct anything that is wrong; your corrections are kept.</>}
          </p>
          {editing ? (
            <button
              className="btn btn--primary"
              onClick={async () => {
                if (!draft) return;
                await saveIrab(text, draft);
                setResult({ ...draft, corrected: true });
                setEditing(false);
                toast('Your corrections are saved.');
              }}
            >
              Save corrections
            </button>
          ) : (
            <button className="btn" onClick={() => { setDraft(result as Irab); setEditing(true); }}><Icon name="edit" size={18} />Correct</button>
          )}
        </>
      )}
    </Sheet>
  );
}
