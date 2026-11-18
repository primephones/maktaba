import { useState } from 'react';
import type { Irab, IrabCase } from '../../ai/study';

export const CASES: Array<{ id: IrabCase; name: string; ar: string; hint: string }> = [
  { id: 'marfu', name: 'Marfūʿ', ar: 'مرفوع', hint: 'nominative' },
  { id: 'mansub', name: 'Manṣūb', ar: 'منصوب', hint: 'accusative' },
  { id: 'majrur', name: 'Majrūr', ar: 'مجرور', hint: 'genitive' },
  { id: 'majzum', name: 'Majzūm', ar: 'مجزوم', hint: 'jussive' },
  { id: 'mabni', name: 'Mabnī', ar: 'مبني', hint: 'fixed' },
];
const caseInfo = (c?: IrabCase) => CASES.find((x) => x.id === c);

/**
 * The iʿrāb of a sentence, word by word: its case, its role and why. And a way to learn
 * it: Test yourself hides the cases, the reader chooses, and each answer shows the reason.
 */
export function IrabView({ result }: { result: Irab }) {
  const [practice, setPractice] = useState(false);
  const [answers, setAnswers] = useState<Record<number, IrabCase>>({});
  const [open, setOpen] = useState<number | null>(null);
  const testable = result.words.map((w, i) => (w.case ? i : -1)).filter((i) => i >= 0);
  const answered = testable.filter((i) => answers[i]);
  const right = answered.filter((i) => answers[i] === result.words[i].case).length;

  return (
    <div className="irab2">
      {testable.length > 1 && (
        <div className="irab-mode" role="group" aria-label="How to show the analysis">
          <button aria-pressed={!practice} onClick={() => setPractice(false)}>Show the analysis</button>
          <button
            aria-pressed={practice}
            onClick={() => {
              setPractice(true);
              setAnswers({});
            }}
          >
            Test yourself
          </button>
        </div>
      )}
      {practice && (
        <p className="muted small irab-score" role="status">
          {answered.length < testable.length
            ? `Choose the case of each word. ${answered.length} of ${testable.length} answered${answered.length ? `, ${right} right` : ''}.`
            : `${right} of ${testable.length} right.${right === testable.length ? ' Excellent.' : ' Read the reasons for the ones you missed, then try again.'}`}
        </p>
      )}
      <ol className="irab-words">
        {result.words.map((w, i) => {
          const c = caseInfo(w.case);
          const chosen = answers[i];
          const hidden = practice && w.case && !chosen;
          const expanded = open === i || (practice && !!chosen);
          return (
            <li key={i} className="irab-card" data-case={hidden ? undefined : w.case}>
              <div className="irab-head">
                <span className="irab-word" lang="ar" dir="rtl">{w.word}</span>
                {c && !hidden && (
                  <span className="irab-case" data-case={c.id}>
                    {c.name} <span lang="ar">{c.ar}</span>
                  </span>
                )}
              </div>
              {hidden ? (
                <div className="irab-choices" role="group" aria-label={`Case of ${w.word}`}>
                  {CASES.map((k) => (
                    <button key={k.id} onClick={() => setAnswers({ ...answers, [i]: k.id })}>
                      {k.name}
                    </button>
                  ))}
                </div>
              ) : (
                <>
                  {practice && chosen && (
                    <p className={`irab-verdict ${chosen === w.case ? 'is-right' : 'is-wrong'}`}>
                      {chosen === w.case ? 'Right.' : `Not ${caseInfo(chosen)?.name}: it is ${c?.name}.`}
                    </p>
                  )}
                  {(w.role || w.en) && (
                    <p className="irab-role">
                      {w.role}
                      {w.role && w.en ? ' · ' : ''}
                      {w.en && <span className="muted">“{w.en}”</span>}
                    </p>
                  )}
                  {w.why && (expanded ? <p className="irab-why"><b>Why: </b>{w.why}</p> : (
                    <button className="irab-why-btn" onClick={() => setOpen(i)}>Why?</button>
                  ))}
                  <p className="irab-text" lang="ar" dir="rtl">{w.irab}</p>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
