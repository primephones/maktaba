import { useEffect, useState } from 'react';
import { fetchStatus, getServer, newSyncKey, normalizeKey, request, setServer, ServerError, type ServerConfig, type ServerStatus } from '../../ai/client';
import { setSetting, useSetting } from '../../app/settings';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';
import { AiAllowance, timeUntil } from './AiAllowance';
import type { SyncState } from '../../sync/sync';

const TRAINS: Record<string, string> = {
  true: 'May use what it is sent to improve its models: never gets private books.',
  false: 'Does not train on what it is sent: used for private books.',
  unknown: 'Its training policy could not be confirmed: never gets private books.',
};

/** The private Maktaba server: an advanced option for someone who runs their own. */
export function ServerPanel() {
  const [cfg, setCfg] = useState<ServerConfig | null | undefined>(undefined);
  const [status, setStatus] = useState<{ status: ServerStatus | null; error?: string; stale: boolean } | null>(null);

  useEffect(() => {
    void getServer().then(setCfg);
  }, []);
  useEffect(() => {
    if (!cfg) return;
    let alive = true;
    void fetchStatus(cfg).then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, [cfg]);

  if (cfg === undefined) return <p className="muted" aria-busy="true">Loading…</p>;
  if (!cfg) return <Connect onDone={setCfg} />;


  return (
    <>
      {status === null ? (
        <p className="muted">Asking the server…</p>
      ) : status.status ? (
        <div className="card"><AiAllowance status={status.status} stale={status.stale} /></div>
      ) : (
        <div className="banner banner--error"><Icon name="warn" /><span className="grow">{status.error}</span></div>
      )}

      {status?.status && (
        <>
          <div className="section-title">AI services</div>
          <div className="list">
            {status.status.providers.map((p) => (
              <div className="row" key={p.id}>
                <span className="grow">
                  <span className="title">{p.name}</span>
                  <div className="sub">
                    {!p.configured ? 'No key set on the server.' : p.blockedUntil && p.blockedUntil > Date.now() ? `Resting: ${p.blockedReason}. Back ${timeUntil(p.blockedUntil)}.` : `${p.usedToday} of ${p.dailyLimit} used today.`}
                  </div>
                  <div className="sub">{TRAINS[String(p.trains)]}</div>
                </span>
              </div>
            ))}
          </div>
          <TranslateOrder providers={status.status.providers.filter((p) => p.configured && p.features.includes('translate')).map((p) => ({ id: p.id, name: p.name }))} />
        </>
      )}

      <SyncStatus />

      <div className="section-title">This phone</div>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <div className="small muted">Server</div>
        <div style={{ overflowWrap: 'anywhere' }}>{cfg.url}</div>
        <div className="small muted">Your sync key (keep it private: it is how your other phone joins)</div>
        <code className="sync-key">{cfg.key}</code>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => void navigator.clipboard.writeText(cfg.key).then(() => toast('Key copied.'), () => toast('Copying isn’t allowed here.'))}><Icon name="copy" size={18} />Copy key</button>
          {cfg.role === 'owner' && <Invite cfg={cfg} />}
          <button className="btn btn--quiet btn--danger" onClick={async () => { await setServer(null); setCfg(null); }}>Disconnect</button>
        </div>
      </div>
    </>
  );
}

function SyncStatus() {
  const [s, setS] = useState<SyncState | null>(null);
  useEffect(() => {
    let off: (() => void) | undefined;
    void import('../../sync/sync').then((m) => {
      off = m.onSyncState(setS);
    });
    return () => off?.();
  }, []);
  if (!s) return null;
  return (
    <>
      <div className="section-title">Sync</div>
      <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Icon name={s.error ? 'warn' : s.pending ? 'retry' : 'check'} />
        <span className="grow" style={{ flex: 1 }}>
          {s.syncing ? 'Syncing…' : s.error ? `Not synced: ${s.error}` : s.pending ? `${s.pending} change${s.pending === 1 ? '' : 's'} waiting to sync` : 'Up to date with your other phones.'}
          {s.lastSyncAt && <div className="muted small">Last synced {new Date(s.lastSyncAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>}
        </span>
        <button className="btn" disabled={s.syncing} onClick={() => void import('../../sync/sync').then((m) => m.syncNow())}>Sync now</button>
      </div>
      <p className="muted small">Reading places, highlights, notes, bookmarks, references, folders, translations and settings sync. Book files do not: add the same file on each phone and its notes appear with it.</p>
    </>
  );
}

export function TranslateOrder({ providers }: { providers: Array<{ id: string; name: string }> }) {
  const ai = useSetting('ai');
  const order = [...(ai.prefer.translate ?? [])].filter((id) => providers.some((p) => p.id === id));
  for (const p of providers) if (!order.includes(p.id)) order.push(p.id);
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    void setSetting('ai', { ...ai, prefer: { ...ai.prefer, translate: next } });
  };
  if (providers.length < 2) return null;
  return (
    <>
      <div className="section-title">Translation: which AI first</div>
      <div className="list">
        {order.map((id, i) => (
          <div className="row" key={id}>
            <span className="value" style={{ width: 20 }}>{i + 1}</span>
            <span className="grow title">{providers.find((p) => p.id === id)?.name}</span>
            <button className="icon-btn" disabled={i === 0} aria-label="Move up" onClick={() => move(i, -1)} style={{ transform: 'rotate(90deg)' }}><Icon name="back" size={20} /></button>
            <button className="icon-btn" disabled={i === order.length - 1} aria-label="Move down" onClick={() => move(i, 1)} style={{ transform: 'rotate(90deg)' }}><Icon name="forward" size={20} /></button>
          </div>
        ))}
      </div>
      <p className="muted small">When the first is out of allowance or unavailable, Maktaba moves to the next by itself.</p>
    </>
  );
}

function Invite({ cfg }: { cfg: ServerConfig }) {
  const [code, setCode] = useState<string | null>(null);
  return code ? (
    <div className="banner" style={{ width: '100%' }}>
      <span className="grow">Invitation code, valid for 7 days: <code className="sync-key">{code}</code> They open Maktaba, choose “I was invited”, and enter it.</span>
    </div>
  ) : (
    <button
      className="btn"
      onClick={async () => {
        try {
          const r = await request<{ code: string }>('/v1/invites', { body: { name: 'Guest' }, cfg });
          setCode(r.code);
        } catch (e) {
          toast((e as Error).message);
        }
      }}
    >
      <Icon name="share" size={18} />Invite someone
    </button>
  );
}

/** First connection: this phone either claims the server (owner) or joins it (invited). */
function Connect({ onDone }: { onDone: (c: ServerConfig) => void }) {
  const [mode, setMode] = useState<'owner' | 'invited' | 'second'>('owner');
  const [url, setUrl] = useState('https://');
  const [code, setCode] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const go = async () => {
    setError('');
    setBusy(true);
    try {
      const base = url.trim().replace(/\/+$/, '');
      if (!/^https?:\/\/[^\s]+$/.test(base)) throw new ServerError('Enter the server address, starting with https://', 0);
      const theKey = mode === 'second' ? normalizeKey(key) : newSyncKey();
      if (!theKey) throw new ServerError('That key doesn’t look right. It has the form HSY-XXXX-XXXX-XXXX-XXXX-XXXX.', 0);
      const cfg: ServerConfig = { url: base, key: theKey };
      if (mode === 'owner') {
        const r = await request<{ role: 'owner' }>('/v1/setup', { body: { code: code.trim(), name: 'Owner' }, cfg });
        cfg.role = r.role;
      } else if (mode === 'invited') {
        const r = await request<{ role: 'member' }>('/v1/join', { body: { invite: code.trim() }, cfg });
        cfg.role = r.role;
      } else {
        await request('/v1/status', { cfg });
      }
      await setServer(cfg);
      toast('Connected.');
      window.dispatchEvent(new Event('maktaba:connected'));
      onDone(cfg);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p style={{ marginBottom: 14 }}>
        If you run your own Maktaba server (it holds AI keys for you and translates whole books while your phone is off), connect to it here. Most people do not need one.
      </p>
      <div className="seg" role="group" aria-label="How this phone connects" style={{ marginBottom: 16 }}>
        <button aria-pressed={mode === 'owner'} onClick={() => setMode('owner')}>New server</button>
        <button aria-pressed={mode === 'second'} onClick={() => setMode('second')}>My other phone</button>
        <button aria-pressed={mode === 'invited'} onClick={() => setMode('invited')}>I was invited</button>
      </div>
      <div style={{ display: 'grid', gap: 14 }}>
        <label className="stack">
          Server address
          <span className="field"><input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="off" autoCorrect="off" placeholder="https://maktaba-server.yourname.workers.dev" /></span>
        </label>
        {mode === 'second' ? (
          <label className="stack">
            Your sync key, from the first phone
            <span className="field"><input value={key} onChange={(e) => setKey(e.target.value)} autoCapitalize="characters" autoCorrect="off" placeholder="HSY-XXXX-XXXX-XXXX-XXXX-XXXX" /></span>
          </label>
        ) : (
          <label className="stack">
            {mode === 'owner' ? 'Setup code (the one you chose when setting up the server)' : 'Invitation code'}
            <span className="field"><input value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="off" autoCorrect="off" placeholder={mode === 'owner' ? '' : 'INV-XXXX-XXXX'} /></span>
          </label>
        )}
        {error && <div className="banner banner--error" role="alert"><Icon name="warn" /><span className="grow">{error}</span></div>}
        <button className="btn btn--block" disabled={busy} onClick={() => void go()}>{busy ? 'Connecting…' : 'Connect to the server'}</button>
        <p className="muted small">{mode === 'owner' ? 'This phone will make your private sync key. You will see it after connecting, to type on your other phone.' : mode === 'second' ? 'Type the key shown in Settings › Your AI › Advanced on your first phone.' : 'Ask the owner for an invitation code.'}</p>
      </div>
    </>
  );
}
