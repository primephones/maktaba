import { useEffect, useState } from 'react';
import { fetchStatus, getServer, type ServerStatus } from '../../ai/client';
import { getMyAi, hasMyAi, setMyAi, type MyAi } from '../../ai/device';
import { checkKey, startOpenRouterSignIn, type KeyService } from '../../ai/signin';
import { isAndroidApp, plugin } from '../../native/maktaba';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';
import { AiAllowance, timeUntil, UNLIMITED } from './AiAllowance';
import { ServerPanel, TranslateOrder } from './AiSettings';

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
          <button className="btn btn--primary btn--block" onClick={() => void startOpenRouterSignIn().catch((e) => toast((e as Error).message))}>
            Sign in with OpenRouter
          </button>
        )}
        <p className="muted small">Free models may learn from what they are sent, so private books are never sent there.</p>
      </div>

      <div className="section-title">Or add a free key</div>
      {SERVICES.map((svc) => (
        <KeyCard key={svc.id} svc={svc} value={ai[svc.id]} onSave={(k) => save({ ...ai, [svc.id]: k })} />
      ))}

      <OtherService ai={ai} onSave={save} />

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
    const r = await checkKey(svc.id, draft);
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: r.message });
      return;
    }
    await onSave(draft.trim());
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
          {msg && <div className={`banner${msg.ok ? '' : ' banner--error'}`} role="alert"><Icon name="warn" /><span className="grow">{msg.text}</span></div>}
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
