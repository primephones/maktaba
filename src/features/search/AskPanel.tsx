import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { aiReady } from '../../ai/client';
import { askBooks, type Answer } from '../../ai/study';
import { langAttr } from '../../lib/arabic';
import { navigate } from '../../app/router';
import { Icon } from '../../ui/Icon';
import { HelpFor } from '../setup/help';
import { Sheet } from '../../ui/Sheet';
import { setJump } from '../reader/jump';

/** Which books a question is put to; remembered between questions. */
function useScope(): [string[] | 'all', (s: string[] | 'all') => void] {
  const saved = useLiveQuery(() => db.settings.get('askScope'), []);
  const value = (saved?.value as string[] | 'all' | undefined) ?? 'all';
  return [value, (s) => void db.settings.put({ key: 'askScope', value: s })];
}

/** "Ask your books": an answer only from the chosen books, every claim citing a passage. */
export function AskPanel({ question }: { question: string }) {
  const books = useLiveQuery(() => db.books.filter((b) => b.import.state === 'ready').toArray(), []) ?? [];
  const [scope, setScope] = useScope();
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    void aiReady().then((c) => setConnected(!!c));
  }, []);
  useEffect(() => {
    setAnswer(null);
    setError('');
  }, [question]);

  const chosen = useMemo(() => (scope === 'all' ? books.map((b) => b.id) : scope.filter((id) => books.some((b) => b.id === id))), [scope, books]);
  const q = question.trim();

  const ask = async () => {
    setBusy(true);
    setError('');
    setAnswer(null);
    try {
      setAnswer(await askBooks(q, chosen));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (connected === false) {
    return (
      <div className="ask">
        <button className="btn btn--block" onClick={() => navigate('/settings/ai')}><span className="ai-mark" aria-hidden="true">✦</span>Set up AI to ask your books</button>
      </div>
    );
  }

  const order = answer?.cited ?? [];
  const num = (id: string) => order.indexOf(id) + 1;
  const open = (id: string) => {
    const s = answer?.sources.find((x) => x.id === id);
    if (!s) return;
    setJump(s.bookId, { section: s.section, block: s.block });
    navigate(`/book/${s.bookId}`);
  };

  return (
    <div className="ask">
      <div className="ask-row">
        <button className="btn btn--primary" disabled={!q || busy || !chosen.length} onClick={() => void ask()}>
          <span className="ai-mark" aria-hidden="true">✦</span>{busy ? 'Reading your books…' : 'Ask your books'}
        </button>
        <button className="chip" onClick={() => setChoosing(true)} aria-label="Choose which books to ask">
          {scope === 'all' ? (books.length === 1 ? 'The 1 book' : `All ${books.length} books`) : `${chosen.length} book${chosen.length === 1 ? '' : 's'}`} ▾
        </button>
      </div>
      {error && <HelpFor error={error} />}
      {answer && (
        <article className="card answer" aria-live="polite">
          {answer.found ? (
            <>
              <p className="answer-text">
                {answer.answer.split(/(\[[^\]\s]+\])/).map((part, i) => {
                  const m = part.match(/^\[([^\]\s]+)\]$/);
                  if (!m) return <span key={i}>{part}</span>;
                  return <button key={i} className="cite" onClick={() => open(m[1])} aria-label={`Open source ${num(m[1])}`}>{num(m[1])}</button>;
                })}
              </p>
              {answer.quotes.some((x) => !x.verified) && (
                <div className="banner"><Icon name="warn" /><span className="grow">A quotation in this answer could not be found word for word in its source. Check it against the passage.</span></div>
              )}
              <div className="section-title" style={{ marginTop: 6 }}>Sources</div>
              <ol className="sources">
                {order.map((id) => {
                  const s = answer.sources.find((x) => x.id === id);
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
          ) : (
            <p><b>Not found in your books.</b> {answer.answer}</p>
          )}
          <p className="muted small"><span className="ai-mark" aria-hidden="true">✦</span> AI answer from {answer.model.replace(/^.*\//, '') || 'your books'}, using only the passages listed. It may be wrong: tap a source to read it.</p>
        </article>
      )}
      {choosing && (
        <Sheet title="Ask which books" onClose={() => setChoosing(false)}>
          <div className="list">
            <button className="row" onClick={() => setScope('all')}>
              <span className="grow title">All books</span>
              {scope === 'all' && <Icon name="check" />}
            </button>
            {books.map((b) => {
              const on = chosen.includes(b.id) && scope !== 'all';
              return (
                <button
                  className="row"
                  key={b.id}
                  onClick={() => {
                    const base = scope === 'all' ? [] : chosen;
                    setScope(on ? base.filter((x) => x !== b.id) : [...base, b.id]);
                  }}
                >
                  <span className="grow title" dir="auto" lang={langAttr(b.title)}>{b.title}</span>
                  {on && <Icon name="check" />}
                </button>
              );
            })}
          </div>
        </Sheet>
      )}
    </div>
  );
}
