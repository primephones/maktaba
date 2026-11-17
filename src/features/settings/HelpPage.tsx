import { useEffect, useState } from 'react';
import { navigate } from '../../app/router';
import { getCloud } from '../../cloud/drive';
import { getMyAi, hasMyAi } from '../../ai/device';
import { Icon } from '../../ui/Icon';

const FAQ: Array<[string, string]> = [
  ['Is it free?', 'Yes. Maktaba is free, Google Drive gives every account 15 GB free, and the AI services used here all have free daily allowances. Nothing asks for a card.'],
  ['What does Maktaba see in my Google Drive?', 'Only the folder it makes, called Maktaba. Google enforces this: Maktaba cannot open, list or change anything else in your Drive.'],
  ['Who can see my books and notes?', 'Only you. They are on your phone and in your own Drive. Whoever shared Maktaba with you cannot see them, and neither can anyone else.'],
  ['Is my AI key safe?', 'It stays on this phone. It is not synced to your other phones and is never put in a backup file. You can remove it any time in Settings › Your AI, or delete it on the service’s own page.'],
  ['Which AI should I choose?', 'Google Gemini is the best free option for classical Arabic. Groq is fast and never learns from what it is sent, so it is used for books you mark private. OpenRouter is the quickest to connect. Two or more together give the most each day.'],
  ['It says the allowance is used up.', 'Free accounts allow a number of requests per day. They come back by themselves (Settings › Your AI shows when), and book translations carry on then. Adding a second free service keeps you going today.'],
  ['Google says “Google hasn’t verified this app”.', 'Tap Advanced, then Go to Maktaba. Maktaba only asks for its own folder in your Drive.'],
  ['Google shows a box to tick.', 'Tick it. Without it Google gives Maktaba no access, and your library cannot be saved to your Drive.'],
  ['I have a new phone.', 'Install Maktaba (or open the link), connect the same Google Drive, and your whole library arrives by itself: books, notes, highlights and reading places. Connect your AI again on the new phone.'],
  ['I don’t want to use Google.', 'Skip the cloud. Everything works on this phone alone; make a backup file now and then (Settings › Backup) and keep it somewhere safe.'],
];

/** Help for everyone: the setup guide, where things stand, and common questions. */
export function HelpPage() {
  const [state, setState] = useState<{ cloud: boolean; ai: boolean } | null>(null);
  useEffect(() => {
    void Promise.all([getCloud(), getMyAi()]).then(([c, a]) => setState({ cloud: !!c, ai: hasMyAi(a) }));
  }, []);
  return (
    <>
      <button className="hero-card help-hero" onClick={() => navigate('/setup')}>
        <span className="ai-mark" aria-hidden="true">✦</span>
        <h2>Setup guide</h2>
        <p>Step by step: your own cloud, then your own AI. About five minutes, all free.</p>
        <span className="btn btn--primary">Open the guide</span>
      </button>
      {state && (
        <div className="list">
          <button className="row" onClick={() => navigate('/setup/cloud')}>
            <Icon name={state.cloud ? 'check' : 'cloud'} />
            <span className="grow"><span className="title">Your cloud</span><div className="sub">{state.cloud ? 'Connected' : 'Not set up yet'}</div></span>
            <Icon name="forward" size={18} />
          </button>
          <button className="row" onClick={() => navigate('/setup/ai')}>
            <Icon name={state.ai ? 'check' : 'sparkle'} />
            <span className="grow"><span className="title">Your AI</span><div className="sub">{state.ai ? 'Connected' : 'Not set up yet'}</div></span>
            <Icon name="forward" size={18} />
          </button>
        </div>
      )}
      <div className="section-title">Questions</div>
      <div className="faq">
        {FAQ.map(([q, a]) => (
          <details key={q}>
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </>
  );
}
