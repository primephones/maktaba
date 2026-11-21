import { useEffect, useState } from 'react';
import { goBack, navigate } from '../../app/router';
import { useApp } from '../../app/AppContext';
import { getMyAi, hasMyAi, setMyAi, type MyAi } from '../../ai/device';
import { checkKey, startOpenRouterSignIn, type KeyService } from '../../ai/signin';
import { readKey, SERVICE_NAME } from '../../ai/keys';
import { cloudAvailable, driveSpace, getCloud, type CloudConfig } from '../../cloud/drive';
import { connectDrive } from '../settings/CloudPage';
import { openExternal } from '../settings/MyAiSettings';
import { formatBytes } from '../../lib/util';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';
import { HelpFor } from './help';

/**
 * Setting Maktaba up, for anyone: their own cloud, then their own AI, one step at a time.
 * Every step says what they will see and what to tap, opens the right page for them, and
 * helps when something goes wrong.
 */

const STEPS = ['welcome', 'cloud', 'ai', 'done'] as const;
type Step = (typeof STEPS)[number];

export function Setup({ step: raw }: { step?: string }) {
  const step: Step = (STEPS as readonly string[]).includes(raw ?? '') ? (raw as Step) : 'welcome';
  const at = STEPS.indexOf(step);
  const go = (s: Step) => navigate(`/setup/${s}`, { replace: true });
  return (
    <div className="screen screen--plain setup">
      <div className="screen-head screen-head--sub">
        <button className="icon-btn" onClick={() => goBack('/')} aria-label="Close the setup guide"><Icon name="back" /></button>
        <h1>Set up Maktaba</h1>
      </div>
      {step !== 'welcome' && step !== 'done' && (
        <ol className="setup-steps" aria-label="Steps">
          <li aria-current={step === 'cloud' ? 'step' : undefined} data-done={at > 1}>1 · Your cloud</li>
          <li aria-current={step === 'ai' ? 'step' : undefined} data-done={at > 2}>2 · Your AI</li>
        </ol>
      )}
      {step === 'welcome' && <Welcome onNext={() => go('cloud')} />}
      {step === 'cloud' && <CloudStep onNext={() => go('ai')} />}
      {step === 'ai' && <AiStep onBack={() => go('cloud')} onNext={() => go('done')} />}
      {step === 'done' && <Done />}
    </div>
  );
}

function Welcome({ onNext }: { onNext: () => void }) {
  return (
    <>
      <div className="hero-card">
        <span className="ai-mark" aria-hidden="true">✦</span>
        <h2>Two small steps. Then the books do the talking.</h2>
        <p>Maktaba keeps nothing of yours on anyone else’s computer. Your own Google Drive holds the library; your own free AI does the translating. Nobody, us included, sees what you read.</p>
      </div>

      <div className="section-title">1 · A shelf that can’t burn down</div>
      <div className="card gets">
        <div className="gets-head"><Icon name="cloud" /><b>Google Drive</b></div>
        <ul>
          <li><b>Never lose a book.</b> Phones get dropped, stolen and upgraded. Your books, notes, highlights and translations sit safely in your own Drive.</li>
          <li><b>Any phone, same shelf.</b> Sign in on a new phone and your library is already there, open at the page you left.</li>
          <li><b>Private.</b> Maktaba sees only the one folder it makes. Not your photos, not your documents.</li>
        </ul>
      </div>

      <div className="section-title">2 · A translator that never sleeps</div>
      <div className="card gets">
        <div className="gets-head"><Icon name="sparkle" /><b>Gemini or OpenRouter (free)</b></div>
        <ul>
          <li><b>Read in English.</b> Arabic, Urdu, Persian, Pashto and Malay, paragraph by paragraph, with the original a tap away, because a translation should never have the last word.</li>
          <li><b>Scanned books, read for you.</b> Even the faded Nastaliq one with a website stamped across every page. You see the page as printed, its English beneath.</li>
          <li><b>Study like a student, not a tourist.</b> Explain a passage, the iʿrāb of a sentence and why, ask your own books, and hear both sides of a question, each answer with its references.</li>
        </ul>
      </div>
      <p className="muted small">Skip either and come back when you like (Settings › Help &amp; setup). The books will wait; they are good at that.</p>
      <button className="btn btn--primary btn--block" onClick={onNext}>Bismillāh, let’s begin</button>
    </>
  );
}

// ------------------------------------------------------------------------------- the cloud

function CloudStep({ onNext }: { onNext: () => void }) {
  const [cfg, setCfg] = useState<CloudConfig | null | undefined>(undefined);
  const [space, setSpace] = useState<{ limit?: number; usage: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    const c = await getCloud();
    setCfg(c);
    if (c) setSpace(await driveSpace().catch(() => null));
  };
  useEffect(() => {
    void load();
  }, []);

  if (cfg === undefined) return <p className="muted" aria-busy="true">Loading…</p>;
  if (cfg) {
    return (
      <>
        <div className="done-card">
          <Icon name="check" />
          <span className="grow">
            <b>Your Google Drive is connected</b>
            <span className="muted small">{cfg.email ?? ''}</span>
            {space?.limit && <span className="muted small">{formatBytes(space.limit - space.usage)} free of {formatBytes(space.limit)}: room for thousands of books.</span>}
          </span>
        </div>
        <p className="muted small">Your books, notes and reading places now go to the folder Maktaba in your Drive, and to any other phone where you connect the same account.</p>
        <button className="btn btn--primary btn--block" onClick={onNext}>Next: your AI</button>
      </>
    );
  }

  const connect = async () => {
    setError('');
    setBusy(true);
    try {
      await connectDrive();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2 className="setup-title">Keep your library in your own Google Drive</h2>
      <p>
        Every Google account comes with <b>15 GB free</b> (shared with Gmail and Photos). A book is usually 1 to 20 MB, so thousands fit. Maktaba can see only the
        folder it makes there, nothing else in your Drive.
      </p>
      <div className="section-title">You need</div>
      <p style={{ margin: 0 }}>
        A Google account. The one on your Android phone works, and so does any Gmail address.{' '}
        <button className="linkish" onClick={() => openExternal('https://accounts.google.com/signup')}>No account? Make one free.</button>
      </p>
      <div className="section-title">What will happen</div>
      <ol className="howto">
        <li>Tap <b>Connect Google Drive</b> below.</li>
        <li>Choose your Google account (or sign in).</li>
        <li>If Google says <i>“Google hasn’t verified this app”</i>, tap <b>Advanced</b>, then <b>Go to Maktaba</b>. It only asks for its own folder.</li>
        <li>
          Google shows what Maktaba asks for: <i>“See, edit, create and delete only the specific Google Drive files you use with this app.”</i>{' '}
          <b>If there is a box next to it, tick it</b>, then tap <b>Continue</b>.
        </li>
        <li>You come back here, and your books start going up.</li>
      </ol>
      {error && <HelpFor error={error} />}
      {cloudAvailable() ? (
        <button className="btn btn--primary btn--block" disabled={busy} onClick={() => void connect()}>
          <Icon name="cloud" size={20} />{busy ? 'Waiting for Google…' : 'Connect Google Drive'}
        </button>
      ) : (
        <HelpFor error="Google sign-in is not switched on for this copy of Maktaba yet." compact />
      )}
      <button className="btn btn--quiet btn--block" onClick={onNext}>Skip for now</button>
      <p className="muted small">Skipping is fine: your library stays on this phone. A backup file (Settings › Backup) keeps it safe meanwhile.</p>
    </>
  );
}

// ------------------------------------------------------------------------------- the AI

interface Guide {
  id: KeyService;
  name: string;
  badge: string;
  why: string;
  url?: string;
  open?: string;
  steps: React.ReactNode[];
  starts?: string;
}

const GUIDES: Guide[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    badge: 'Easiest',
    why: 'One sign-in, nothing to copy. Its free allowance is small (enough to try Maktaba and for Explain and Ask); for whole books, add Gemini too.',
    steps: [
      <>Tap <b>Sign in with OpenRouter</b> below.</>,
      <>OpenRouter opens. Sign in with Google, or with your email (new there? it makes your free account).</>,
      <>Tap <b>Authorize</b>.</>,
      <>You come back here, connected.</>,
    ],
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    badge: 'Best for Arabic',
    why: 'The strongest free option for classical Arabic, with a good daily allowance. It may learn from what it is sent, so books you mark private are never sent to it.',
    url: 'https://aistudio.google.com/app/apikey',
    open: 'Open Google AI Studio',
    starts: 'AQ. or AIza',
    steps: [
      <>Tap <b>Open Google AI Studio</b> below, and sign in with your Google account.</>,
      <>If it asks, accept the terms.</>,
      <>Tap <b>Create API key</b>. If it asks about a project, choose <b>Create API key in new project</b> (or any project offered).</>,
      <>Your key appears: a long line starting with <code>AQ.</code> (or, for older keys, <code>AIza</code>). Tap the <b>copy</b> button next to it.</>,
      <>Come back to Maktaba and tap <b>Paste key</b>.</>,
    ],
  },
  {
    id: 'groq',
    name: 'Groq',
    badge: 'Fast and private',
    why: 'Quick, with a generous free allowance, and it does not learn from what it is sent, so it is the one used for private books.',
    url: 'https://console.groq.com/keys',
    open: 'Open GroqCloud',
    starts: 'gsk_',
    steps: [
      <>Tap <b>Open GroqCloud</b> below, and sign in with Google or your email.</>,
      <>Tap <b>Create API Key</b>, name it <i>Maktaba</i>, and tap <b>Submit</b>.</>,
      <>Your key appears, starting with <code>gsk_</code>. <b>Copy it now</b>: Groq shows it only once.</>,
      <>Come back to Maktaba and tap <b>Paste key</b>.</>,
    ],
  },
];

function AiStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [ai, setAi] = useState<MyAi | null>(null);
  const [open, setOpen] = useState<KeyService | null>(null);
  const load = () => void getMyAi().then(setAi);
  useEffect(() => {
    load();
    window.addEventListener('maktaba:connected', load);
    return () => window.removeEventListener('maktaba:connected', load);
  }, []);
  if (!ai) return <p className="muted" aria-busy="true">Loading…</p>;
  const connected = GUIDES.filter((g) => ai[g.id]);

  return (
    <>
      <h2 className="setup-title">Connect your own AI</h2>
      <p>Pick one; it takes about two minutes and costs nothing. Two is better than one: when a free allowance runs out for the day, Maktaba quietly moves to the other.</p>
      {connected.length > 0 && (
        <div className="done-card">
          <Icon name="check" />
          <span className="grow">
            <b>Connected: {connected.map((g) => g.name).join(', ')}</b>
            <span className="muted small">{connected.length === 1 ? 'Add a second one below if you like, or carry on.' : 'Maktaba uses them in turn.'}</span>
          </span>
        </div>
      )}
      {GUIDES.map((g) => (
        <div className="card guide" key={g.id} data-open={open === g.id}>
          <button className="guide-head" onClick={() => setOpen(open === g.id ? null : g.id)} aria-expanded={open === g.id}>
            <span className="grow">
              <span className="guide-name"><b>{g.name}</b><span className="badge">{g.badge}</span></span>
              <span className="muted small">{ai[g.id] ? 'Connected.' : g.why}</span>
            </span>
            {ai[g.id] ? <Icon name="check" /> : <Icon name="forward" size={18} />}
          </button>
          {open === g.id && !ai[g.id] && <GuideBody g={g} ai={ai} onDone={load} />}
        </div>
      ))}
      <div className="row-btns">
        <button className="btn" onClick={onBack}>Back</button>
        <button className={`btn${hasMyAi(ai) ? ' btn--primary' : ''}`} onClick={onNext}>{hasMyAi(ai) ? 'Finish' : 'Skip for now'}</button>
      </div>
    </>
  );
}

function GuideBody({ g, ai, onDone }: { g: Guide; ai: MyAi; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reading = text ? readKey(text) : null;
  // A key from another service is added to that service: people often open the wrong page.
  const target = (reading?.service === 'gemini' || reading?.service === 'groq' || reading?.service === 'openrouter' ? reading.service : g.id) as KeyService;

  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) setText(t);
      else toast('Nothing has been copied yet. Copy the key first.');
    } catch {
      toast('Press and hold in the box, then tap Paste.');
      document.getElementById(`key-${g.id}`)?.focus();
    }
  };
  const add = async () => {
    if (!reading?.key) return;
    setError('');
    setBusy(true);
    const r = await checkKey(target, reading.key);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    await setMyAi({ ...ai, [target]: reading.key });
    toast(`${SERVICE_NAME[target]} is connected. Your AI is ready.`);
    setText('');
    onDone();
  };

  if (g.id === 'openrouter') {
    return (
      <div className="guide-body">
        <ol className="howto">{g.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        <button className="btn btn--primary btn--block" onClick={() => void startOpenRouterSignIn().catch((e) => setError((e as Error).message))}>Sign in with OpenRouter</button>
        {error && <HelpFor error={error} />}
      </div>
    );
  }
  return (
    <div className="guide-body">
      <ol className="howto">{g.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
      <button className="btn btn--block" onClick={() => openExternal(g.url!)}><Icon name="key" size={18} />{g.open}</button>
      <label className="stack" htmlFor={`key-${g.id}`}>Your {g.name} key</label>
      <span className="field">
        <input
          id={`key-${g.id}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={g.starts ? `Starts with ${g.starts}` : 'Your key'}
          aria-describedby={`key-${g.id}-note`}
        />
        <button className="chip" onClick={() => void paste()}>Paste key</button>
      </span>
      <div id={`key-${g.id}-note`} aria-live="polite">
        {reading?.problem ? (
          <p className="key-note key-note--bad"><Icon name="warn" size={16} />{reading.problem}</p>
        ) : reading?.service && reading.service !== g.id ? (
          (reading.service === 'openai' || reading.service === 'anthropic') ? (
            <p className="key-note key-note--bad"><Icon name="warn" size={16} />This is a {SERVICE_NAME[reading.service]} key. Those services are not free; Maktaba can use one under Settings › Your AI › Another AI service.</p>
          ) : (
            <p className="key-note"><Icon name="check" size={16} />This is a {SERVICE_NAME[reading.service]} key, not {g.name}. It will be added as {SERVICE_NAME[reading.service]}.</p>
          )
        ) : reading?.service === g.id ? (
          <p className="key-note key-note--good"><Icon name="check" size={16} />This looks like a {g.name} key.</p>
        ) : null}
      </div>
      {error && <HelpFor error={error} />}
      <button
        className="btn btn--primary btn--block"
        disabled={busy || !reading?.key || !!reading.problem || reading.service === 'openai' || reading.service === 'anthropic'}
        onClick={() => void add()}
      >
        {busy ? 'Checking the key…' : `Add ${SERVICE_NAME[target] ?? g.name}`}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------------------- done

function Done() {
  const { addBooks } = useApp();
  const [state, setState] = useState<{ cloud: boolean; ai: boolean } | null>(null);
  useEffect(() => {
    void Promise.all([getCloud(), getMyAi()]).then(([c, a]) => setState({ cloud: !!c, ai: hasMyAi(a) }));
  }, []);
  if (!state) return null;
  return (
    <>
      <div className="hero-card">
        <span className="ai-mark" aria-hidden="true">✦</span>
        <h2>{state.cloud && state.ai ? 'Your library is ready' : 'Good enough to start'}</h2>
        <p lang="ar" dir="rtl" className="done-verse">اقْرَأْ وَرَبُّكَ الْأَكْرَمُ</p>
        <p className="muted small" style={{ marginTop: 0 }}>“Read, and your Lord is the Most Generous.” (al-ʿAlaq 96:3)</p>
        <p>{state.cloud && state.ai ? 'A shelf in your own cloud, a translator at your service. All that is missing is a book.' : 'The rest can wait until you are curious: Settings › Help & setup.'}</p>
      </div>
      <div className="list">
        <button className="row" onClick={() => navigate('/setup/cloud', { replace: true })}>
          <Icon name={state.cloud ? 'check' : 'cloud'} />
          <span className="grow"><span className="title">Your cloud</span><div className="sub">{state.cloud ? 'Connected' : 'Not yet: tap to set it up'}</div></span>
        </button>
        <button className="row" onClick={() => navigate('/setup/ai', { replace: true })}>
          <Icon name={state.ai ? 'check' : 'sparkle'} />
          <span className="grow"><span className="title">Your AI</span><div className="sub">{state.ai ? 'Connected' : 'Not yet: tap to set it up'}</div></span>
        </button>
      </div>
      <div className="section-title">What to try first</div>
      <ol className="howto">
        <li>Add a book: an Arabic, Urdu or Persian PDF, EPUB or Word file from your phone.</li>
        <li>Open it, and tap the middle of the page: everything you need is at the bottom.</li>
        {state.ai && <li>Tap <b>English</b>, then <b>As I read</b>: the pages ahead come into English while you read. Tap any paragraph for the original; it is good to keep the translator honest.</li>}
      </ol>
      <button className="btn btn--primary btn--block" onClick={() => { navigate('/', { replace: true }); addBooks(); }}><Icon name="plus" size={20} />Add a book</button>
      <button className="btn btn--quiet btn--block" onClick={() => navigate('/', { replace: true })}>Go to my library</button>
    </>
  );
}
