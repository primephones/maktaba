import { useEffect, useState } from 'react';
import { fetchStatus, getServer, type ServerStatus } from '../../ai/client';
import { getMyAi, hasMyAi, setMyAi, testServices, type MyAi, type ServiceTest } from '../../ai/device';
import { checkKey, codeFromPasted, finishOpenRouterSignIn, startOpenRouterSignIn, type KeyService } from '../../ai/signin';
import { readKey } from '../../ai/keys';
import { isAndroidApp, plugin } from '../../native/maktaba';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';
import { AiAllowance, timeUntil, UNLIMITED } from './AiAllowance';
import { ServerPanel, TranslateOrder } from './AiSettings';
import { HelpFor } from '../setup/help';
import { navigate } from '../../app/router';

/** Opens a page in the phone's browser (keeping Maktaba open behind it). */
export function openExternal(url: string) {
  if (isAndroidApp()) void plugin.openUrl({ url });
  else window.open(url, '_blank', 'noopener');
}

const SERVICES: Array<{ id: KeyService; name: string; getKey: string; blurb: string; private: string }> = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    getKey: 'https://aistudio.google.com/app/apikey',
    blurb: 'The strongest free option for classical Arabic. Sign in with your Google account and create a key.',
    private: 'Google may learn from free-tier requests, so books you mark private are never sent here.',
  },
  {
    id: 'groq',
    name: 'Groq',
    getKey: 'https://console.groq.com/keys',
    blurb: 'Fast, with a generous free allowance. Sign up with Google or email and create a key.',
    private: 'Does not keep or learn from what it is sent: used for private books.',
  },
];

/**
 * Tries each connected service with one short translation and shows what happened, in
 * plain words: so "it doesn't work" becomes "Groq: the key was refused" or "Gemini works".
 */
function TestMyAi() {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ServiceTest[] | null>(null);
  const run = async () => {
    setBusy(true);
    setResults(null);
    try {
      setResults(await testServices());
      window.dispatchEvent(new Event('maktaba:connected'));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="section-title">Check it works</div>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <p className="muted small" style={{ margin: 0 }}>Sends one short Arabic sentence to each service you added (one request of its allowance) and shows exactly what happened.</p>
        <button className="btn" disabled={busy} onClick={() => void run()}>
          <span className="ai-mark" aria-hidden="true">✦</span>{busy ? 'Testing…' : 'Test my AI'}
        </button>
        {results && !results.length && <p className="small" style={{ margin: 0 }}>No service has a key yet. Add one above.</p>}
        {results?.map((r) => (
          <div key={r.id} className="test-result" data-ok={r.ok}>
            <Icon name={r.ok ? 'check' : 'warn'} size={18} />
            <div>
              <b>{r.name}</b> {r.ok ? <span className="muted small">works ({r.model}, {(r.ms / 1000).toFixed(1)} s)</span> : <span className="small">did not work</span>}
              <div className="small" dir={r.ok ? 'ltr' : undefined}>{r.ok ? `“${r.message}”` : r.message}</div>
            </div>
          </div>
        ))}
        {results?.some((r) => !r.ok) && (
          <p className="muted small" style={{ margin: 0 }}>
            “Key refused”: copy the key again in full, or make a new one. “Busy for a moment”: wait a minute and test again. “Today’s allowance is used up”: it comes back tomorrow; the other services carry on meanwhile.
          </p>
        )}
      </div>
    </>
  );
}

/**
 * If the browser does not come back to Maktaba after signing in (it ended on an error page,
 * or the phone closed Maktaba meanwhile), the address it ended on still holds the sign-in:
 * pasting it here finishes the job. A pasted OpenRouter key works too.
 */
function FinishByHand({ onKey }: { onKey: (key: string) => Promise<void> | void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const finish = async () => {
    const t = text.trim();
    setBusy(true);
    try {
      if (/^sk-or-/.test(t)) {
        const r = await checkKey('openrouter', t);
        if (!r.ok) return toast(r.message);
        await onKey(t);
        toast('OpenRouter key added. Your AI is ready.');
      } else {
        const code = codeFromPasted(t);
        if (!code) return toast('That does not look like the sign-in address. Copy the whole address from the browser’s address bar.');
        await finishOpenRouterSignIn(code);
        toast('Signed in to OpenRouter. Your AI is ready.');
        window.dispatchEvent(new Event('maktaba:connected'));
      }
      setText('');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="finish-by-hand">
      <summary>Didn’t come back to Maktaba?</summary>
      <p className="muted small">
        After you tap <b>Authorize</b>, the browser should send you back here. If it shows an error page or a blank page instead, copy the address
        from the browser’s address bar, paste it below, and tap Finish. (The address holds a one-time code that only works on this phone.)
      </p>
      <label className="field">
        <textarea rows={2} dir="ltr" value={text} placeholder="Paste the address here" aria-label="The address the browser ended on" onChange={(e) => setText(e.target.value)} />
      </label>
      <button className="btn btn--block" disabled={!text.trim() || busy} onClick={() => void finish()}>
        {busy ? 'Finishing…' : 'Finish signing in'}
      </button>
    </details>
  );
}

/**
 * Each person's own AI. Whoever opens Maktaba connects their own account, with its own
 * free daily allowance; nobody else's account is ever used. Keys stay on this phone.
 */
export function AiSettings() {
  const [ai, setAi] = useState<MyAi | null>(null);
  const [status, setStatus] = useState<{ status: ServerStatus | null; stale: boolean } | null>(null);
  const [round, setRound] = useState(0);
  const [hasServer, setHasServer] = useState(false);
  useEffect(() => {
    void getServer().then((c) => setHasServer(!!c));
  }, [round]);

  useEffect(() => {
    let alive = true;
    void getMyAi().then(async (a) => {
      if (!alive) return;
      setAi(a);
      if (hasMyAi(a)) {
        const s = await fetchStatus();
        if (alive) setStatus(s);
      } else setStatus(null);
    });
    const again = () => setRound((r) => r + 1);
    window.addEventListener('maktaba:connected', again);
    return () => {
      alive = false;
      window.removeEventListener('maktaba:connected', again);
    };
  }, [round]);

  if (!ai) return <p className="muted" aria-busy="true">Loading…</p>;
  const save = async (next: MyAi) => {
    await setMyAi(next);
    setRound((r) => r + 1);
  };
  const connected = hasMyAi(ai);
  const st = status?.status;

  return (
    <>
      {!connected && (
        <button className="btn btn--block" onClick={() => navigate('/setup/ai')}><Icon name="info" size={18} />Step-by-step guide</button>
      )}
      {!connected ? (
        <div className="hero-card">
          <span className="ai-mark" aria-hidden="true">✦</span>
          <h2>Connect your AI</h2>
          <p>
            Translation, Ask your books, Explain and Iʿrāb use <b>your own</b> AI account, with its own free daily allowance. Nobody else’s account is
            used, and your key stays on this phone.
          </p>
        </div>
      ) : (
        st && <div className="card"><AiAllowance status={st} stale={status?.stale} /></div>
      )}

      <div className="section-title">Sign in</div>
      <div className="card svc">
        <div className="svc-head">
          <span className="grow">
            <b>OpenRouter</b>
            <span className="muted small">
              {ai.openrouter
                ? ai.openrouterSignedIn ? 'Signed in.' : 'Key added.'
                : 'One sign-in, no key to copy. Its free models have a small daily allowance; add credit there for more.'}
            </span>
          </span>
          {ai.openrouter && <Icon name="check" />}
        </div>
        {ai.openrouter ? (
          <button className="btn btn--quiet btn--danger" onClick={() => void save({ ...ai, openrouter: undefined, openrouterSignedIn: undefined })}>Sign out of OpenRouter</button>
        ) : (
          <>
            <button className="btn btn--primary btn--block" onClick={() => void startOpenRouterSignIn().catch((e) => toast((e as Error).message))}>
              Sign in with OpenRouter
            </button>
            <FinishByHand onKey={(k) => save({ ...ai, openrouter: k })} />
          </>
        )}
        <p className="muted small">Free models may learn from what they are sent, so private books are never sent there.</p>
      </div>

      <div className="section-title">Or add a free key</div>
      {SERVICES.map((svc) => (
        <KeyCard key={svc.id} svc={svc} value={ai[svc.id]} onSave={(k) => save({ ...ai, [svc.id]: k })} />
      ))}

      <OtherService ai={ai} onSave={save} />

      {connected && <TestMyAi />}

      {connected && st && (
        <>
          <div className="section-title">Your services today</div>
          <div className="list">
            {st.providers.filter((p) => p.configured).map((p) => (
              <div className="row" key={p.id}>
                <span className="grow">
                  <span className="title">{p.name}</span>
                  <div className="sub">
                    {p.blockedUntil && p.blockedUntil > Date.now()
                      ? `Resting: ${p.blockedReason}. Back ${timeUntil(p.blockedUntil)}.`
                      : p.dailyLimit >= UNLIMITED ? `${p.usedToday} requests today.` : `${p.usedToday} of ${p.dailyLimit} requests used today.`}
                  </div>
                </span>
              </div>
            ))}
          </div>
          <TranslateOrder providers={st.providers.filter((p) => p.configured && p.features.includes('translate')).map((p) => ({ id: p.id, name: p.name }))} />
        </>
      )}

      <details className="advanced" open={hasServer || undefined}>
        <summary>Advanced: your own Maktaba server</summary>
        <div style={{ display: 'grid', gap: 14, marginTop: 12 }}>
          <ServerPanel />
        </div>
      </details>
    </>
  );
}

function KeyCard({ svc, value, onSave }: { svc: (typeof SERVICES)[number]; value?: string; onSave: (key: string | undefined) => Promise<void> }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const add = async () => {
    setBusy(true);
    setMsg(null);
    const read = readKey(draft);
    if (!read.key || read.problem) {
      setBusy(false);
      setMsg({ ok: false, text: read.problem ?? 'Paste the key first.' });
      return;
    }
    const r = await checkKey(svc.id, read.key);
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: r.message });
      return;
    }
    await onSave(read.key);
    setDraft('');
    toast(`${svc.name} is connected.`);
  };
  return (
    <div className="card svc">
      <div className="svc-head">
        <span className="grow">
          <b>{svc.name}</b>
          <span className="muted small">{value ? `Key added (…${value.slice(-4)}).` : svc.blurb}</span>
        </span>
        {value && <Icon name="check" />}
      </div>
      {value ? (
        <button className="btn btn--quiet btn--danger" onClick={() => void onSave(undefined)}>Remove this key</button>
      ) : (
        <>
          <button className="btn" onClick={() => openExternal(svc.getKey)}>
            <Icon name="key" size={18} />Get a free {svc.name.replace('Google ', '')} key
          </button>
          <label className="stack">
            Paste the key here
            <span className="field">
              <input value={draft} onChange={(e) => setDraft(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="Your key" aria-label={`${svc.name} key`} />
            </span>
          </label>
          {msg && !msg.ok && <HelpFor error={msg.text} />}
          <button className="btn btn--primary btn--block" disabled={busy || !draft.trim()} onClick={() => void add()}>{busy ? 'Checking…' : `Add ${svc.name}`}</button>
        </>
      )}
      <p className="muted small">{svc.private}</p>
    </div>
  );
}

/** Any OpenAI-compatible service: DeepSeek, OpenAI, a model on the reader's own computer. */
function OtherService({ ai, onSave }: { ai: MyAi; onSave: (a: MyAi) => Promise<void> }) {
  const c = ai.custom;
  const [name, setName] = useState(c?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(c?.baseUrl ?? 'https://');
  const [key, setKey] = useState(c?.key ?? '');
  const [model, setModel] = useState(c?.model ?? '');
  const [trains, setTrains] = useState(c?.trains ?? true);
  if (c?.baseUrl) {
    return (
      <div className="card svc">
        <div className="svc-head">
          <span className="grow">
            <b>{c.name || 'Your AI service'}</b>
            <span className="muted small">{c.model} at {c.baseUrl}</span>
          </span>
          <Icon name="check" />
        </div>
        <button className="btn btn--quiet btn--danger" onClick={() => void onSave({ ...ai, custom: undefined })}>Remove this service</button>
      </div>
    );
  }
  return (
    <details className="advanced">
      <summary>Another AI service (OpenAI-compatible)</summary>
      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <label className="stack">Name<span className="field"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. DeepSeek" /></span></label>
        <label className="stack">Address<span className="field"><input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="https://api.deepseek.com/v1" /></span></label>
        <label className="stack">Key<span className="field"><input value={key} onChange={(e) => setKey(e.target.value)} autoCapitalize="off" autoCorrect="off" spellCheck={false} /></span></label>
        <label className="stack">Model<span className="field"><input value={model} onChange={(e) => setModel(e.target.value)} autoCapitalize="off" autoCorrect="off" placeholder="e.g. deepseek-chat" /></span></label>
        <div className="row" style={{ padding: 0 }}>
          <span className="grow title" id="custom-private">It does not learn from what it is sent (safe for private books)</span>
          <button className="switch" role="switch" aria-checked={!trains} aria-labelledby="custom-private" onClick={() => setTrains(!trains)} />
        </div>
        <button
          className="btn btn--block"
          disabled={!/^https?:\/\/\S+$/.test(baseUrl.trim()) || !model.trim()}
          onClick={() => void onSave({ ...ai, custom: { name: name.trim(), baseUrl: baseUrl.trim(), key: key.trim(), model: model.trim(), trains } }).then(() => toast('Your service is connected.'))}
        >
          Add this service
        </button>
      </div>
    </details>
  );
}
