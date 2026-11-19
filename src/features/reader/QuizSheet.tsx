import { useEffect, useRef, useState } from 'react';
import type { Book } from '../../db/types';
import { quizChapter, type Quiz } from '../../ai/study';
import { aiReady } from '../../ai/client';
import { navigate } from '../../app/router';
import { Sheet } from '../../ui/Sheet';
import { HelpFor } from '../setup/help';

/**
 * Quiz me on this chapter: five questions from the chapter's own text. Each answer shows
 * whether it was right, why, and the passage it rests on, one tap away.
 */
export function QuizSheet({ book, at, onGo, onClose }: { book: Book; at: { section: number; block: number }; onGo: (section: number, block: number) => void; onClose: () => void }) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState<Record<number, number>>({});
  const bookRef = useRef(book);
  bookRef.current = book;

  const load = async () => {
    setQuiz(null);
    setChosen({});
    setError('');
    if (!(await aiReady())) return setError('setup');
    try {
      setQuiz(await quizChapter(bookRef.current, at));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at.section, at.block]);

  const answered = quiz ? Object.keys(chosen).length : 0;
  const right = quiz ? quiz.questions.filter((q, i) => chosen[i] === q.answer).length : 0;

  return (
    <Sheet title={quiz ? `Quiz: ${quiz.title}` : 'Quiz on this chapter'} onClose={onClose}>
      {error === 'setup' ? (
        <button className="btn btn--block" onClick={() => navigate('/settings/ai')}>Connect your AI first</button>
      ) : error ? (
        <HelpFor error={error} />
      ) : !quiz ? (
        <p className="muted" role="status"><span className="ai-mark" aria-hidden="true">✦</span> Writing questions from this chapter…</p>
      ) : (
        <>
          <ol className="quiz">
            {quiz.questions.map((q, i) => {
              const pick = chosen[i];
              const done = pick !== undefined;
              return (
                <li key={i} className="quiz-q">
                  <p className="quiz-text">{q.q}</p>
                  <div className="quiz-options" role="group" aria-label={`Answers to question ${i + 1}`}>
                    {q.options.map((o, k) => (
                      <button
                        key={k}
                        disabled={done}
                        data-state={done ? (k === q.answer ? 'right' : k === pick ? 'wrong' : undefined) : undefined}
                        onClick={() => setChosen({ ...chosen, [i]: k })}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                  {done && (
                    <p className="quiz-why">
                      <b>{pick === q.answer ? 'Right. ' : 'Not quite. '}</b>
                      {q.why}{' '}
                      {q.ids[0] && (
                        <button
                          className="quiz-src"
                          onClick={() => {
                            const s = quiz.sources.find((x) => x.id === q.ids[0]);
                            if (!s) return;
                            onClose();
                            onGo(s.section, s.block);
                          }}
                        >
                          Read the passage
                        </button>
                      )}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
          <p className="muted small" role="status">
            {answered < quiz.questions.length ? `${answered} of ${quiz.questions.length} answered.` : `${right} of ${quiz.questions.length} right.`}{' '}
            <span className="ai-mark" aria-hidden="true">✦</span> Questions by {quiz.model.replace(/^.*\//, '')}, from this chapter only.
          </p>
          <button className="btn btn--quiet" onClick={() => void load()}>New questions</button>
        </>
      )}
    </Sheet>
  );
}
