import { useEffect, useState } from 'react';
import { canSpeak, getFixes, piecesOf, setFixes, speakPiece, stopSpeaking, type Fix } from '../../speech/speech';
import { isAndroidApp } from '../../native/maktaba';
import { Icon } from '../../ui/Icon';

/** Voices and "Fix a word": the reader's own pronunciations, each one previewed. */
export function VoicePage() {
  const [fixes, setList] = useState<Fix[]>([]);
  const [word, setWord] = useState('');
  const [say, setSay] = useState('');
  const [lang, setLang] = useState<Fix['lang']>('ar');

  useEffect(() => {
    void getFixes().then(setList);
  }, []);

  const preview = async (text: string, l: Fix['lang']) => {
    await stopSpeaking();
    const pieces = l === 'en' ? piecesOf(text, 'en', fixes) : [{ text, lang: l }];
    for (let i = 0; i < pieces.length; i++) await speakPiece(pieces[i], `preview-${Date.now()}-${i}`, 1, i === 0);
  };

  if (!canSpeak()) return <p>This browser cannot read aloud. The Android app and most phone browsers can.</p>;

  return (
    <>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <p>Maktaba reads with your phone’s own voices{isAndroidApp() ? ', which work offline once installed' : ''}. Arabic terms inside English are said by an Arabic voice, from their Arabic spelling.</p>
        <button className="btn" onClick={() => void preview('Ijmāʿ (consensus) and qiyās (analogy) are proofs, and the ḥadīth was narrated with a sound isnād.', 'en')}><Icon name="speaker" size={18} />Hear an example</button>
        {isAndroidApp() && <p className="muted small">For the most natural voices, open Android Settings › Accessibility › Text-to-speech, choose Speech Recognition and Synthesis from Google, and install the English (UK or US) and Arabic voice data.</p>}
      </div>

      <div className="section-title">Fix a word</div>
      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <label className="stack">
          The word as written in English
          <span className="field"><input value={word} onChange={(e) => setWord(e.target.value)} placeholder="e.g. al-Shāfiʿī" /></span>
        </label>
        <label className="stack">
          Say it as
          <span className="field"><input value={say} onChange={(e) => setSay(e.target.value)} dir="auto" placeholder={lang === 'ar' ? 'الشافعي' : 'ash-shaa-fi-ee'} /></span>
        </label>
        <div className="seg" role="group" aria-label="Voice for this word">
          <button aria-pressed={lang === 'ar'} onClick={() => setLang('ar')}>Arabic voice</button>
          <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English voice</button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" disabled={!say.trim()} onClick={() => void preview(say, lang)}><Icon name="speaker" size={18} />Preview</button>
          <button
            className="btn btn--primary"
            disabled={!word.trim() || !say.trim()}
            onClick={async () => {
              const next = [...fixes.filter((f) => f.word !== word.trim()), { word: word.trim(), say: say.trim(), lang }];
              await setFixes(next);
              setList(next);
              setWord('');
              setSay('');
            }}
          >
            Save
          </button>
        </div>
      </div>
      {fixes.length > 0 && (
        <div className="list" style={{ marginTop: 14 }}>
          {fixes.map((f) => (
            <div className="row" key={f.word}>
              <span className="grow">
                <span className="title">{f.word}</span>
                <div className="sub" dir="auto">{f.say} ({f.lang === 'ar' ? 'Arabic voice' : 'English voice'})</div>
              </span>
              <button className="icon-btn" aria-label={`Hear ${f.word}`} onClick={() => void preview(f.say, f.lang)}><Icon name="speaker" size={20} /></button>
              <button className="icon-btn" aria-label={`Remove ${f.word}`} onClick={async () => { const next = fixes.filter((x) => x.word !== f.word); await setFixes(next); setList(next); }}><Icon name="trash" size={20} /></button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
