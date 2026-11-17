import { useEffect, useState } from 'react';
import { accessToken, cloudAvailable, driveSpace, ensureFolders, getCloud, setCloud, whoAmI, type CloudConfig } from '../../cloud/drive';
import { formatBytes } from '../../lib/util';
import type { SyncState } from '../../sync/sync';
import type { FileSyncState } from '../../sync/cloudSync';
import { db } from '../../db/db';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';
import { HelpFor } from '../setup/help';
import { navigate } from '../../app/router';

/**
 * Each person's own cloud: their Google Drive. Their books (the original files) and their
 * notes, highlights, places and translations are kept there, so the library follows them
 * to a new phone and stays in step between their phones. Maktaba sees only the files it
 * makes in the Maktaba folder.
 */
/** Signs in to the reader's own Google Drive, makes the Maktaba folder and starts syncing. */
export async function connectDrive(): Promise<void> {
  // Signing in again keeps the existing connection if it does not go through.
  const before = await getCloud();
  try {
    await setCloud({ provider: 'gdrive', folders: before?.folders });
    await accessToken(true);
    await ensureFolders();
    const me = await whoAmI().catch(() => ({}) as { email?: string; name?: string });
    const now = await getCloud();
    await setCloud({ ...(now ?? { provider: 'gdrive' }), ...me });
    toast('Your Google Drive is connected. Your library is being saved there.');
    const { syncNow } = await import('../../sync/sync');
    void syncNow();
  } catch (e) {
    await setCloud(before);
    throw e;
  }
}

export function CloudPage() {
  const [cfg, setCfg] = useState<CloudConfig | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () => void getCloud().then(setCfg);
    load();
    window.addEventListener('maktaba:connected', load);
    return () => window.removeEventListener('maktaba:connected', load);
  }, []);

  const connect = async () => {
    setError('');
    setBusy(true);
    try {
      await connectDrive();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (cfg === undefined) return <p className="muted" aria-busy="true">Loading…</p>;

  if (!cfg) {
    return (
      <>
        <div className="hero-card">
          <Icon name="cloud" />
          <h2>Keep your library in your own cloud</h2>
          <p>
            Connect <b>your own</b> Google Drive. Your books, exactly as you added them, and your notes, highlights, reading places and translations are kept
            there, so they follow you to a new phone and stay in step between your phones.
          </p>
        </div>
        <button className="btn btn--block" onClick={() => navigate('/setup/cloud')}><Icon name="info" size={18} />Step-by-step guide</button>
        {error && <HelpFor error={error} />}
        {cloudAvailable() ? (
          <button className="btn btn--primary btn--block" disabled={busy} onClick={() => void connect()}>
            <Icon name="cloud" size={20} />{busy ? 'Connecting…' : 'Connect Google Drive'}
          </button>
        ) : (
          <div className="banner"><Icon name="info" /><span className="grow">Google sign-in is not switched on for this copy of Maktaba yet.</span></div>
        )}
        <div className="list">
          <div className="row"><Icon name="check" /><span className="grow"><span className="title">Only Maktaba’s own folder</span><div className="sub">Maktaba can see only the files it makes, in a folder called Maktaba. Nothing else in your Drive.</div></span></div>
          <div className="row"><Icon name="check" /><span className="grow"><span className="title">Yours alone</span><div className="sub">It is your own Drive and your own space. Nobody else, including whoever shared Maktaba with you, can see it.</div></span></div>
          <div className="row"><Icon name="check" /><span className="grow"><span className="title">Still works offline</span><div className="sub">Everything stays on this phone too. Changes wait and go up when you are back online.</div></span></div>
        </div>
      </>
    );
  }

  return <Connected cfg={cfg} />;
}

function Connected({ cfg }: { cfg: CloudConfig }) {
  const [s, setS] = useState<SyncState | null>(null);
  const [files, setFiles] = useState<FileSyncState | null>(null);
  const [autoDown, setAutoDown] = useState(true);
  const [mobile, setMobile] = useState(false);
  const [space, setSpace] = useState<{ mine: number; bookCount: number; usage: number; limit?: number } | null>(null);
  useEffect(() => {
    let alive = true;
    void Promise.all([import('../../sync/cloudSync').then((m) => m.cloudUsage()), driveSpace()])
      .then(([u, d]) => alive && setSpace({ mine: u.books + u.study, bookCount: u.bookCount, usage: d.usage, limit: d.limit }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [s?.lastSyncAt]);
  useEffect(() => {
    let off1: (() => void) | undefined;
    let off2: (() => void) | undefined;
    void import('../../sync/sync').then((m) => (off1 = m.onSyncState(setS)));
    void import('../../sync/cloudSync').then((m) => (off2 = m.onFileSync(setFiles)));
    void db.settings.get('cloudDownloadsOff').then((r) => setAutoDown(r?.value !== true));
    void db.settings.get('cloudUseMobileData').then((r) => setMobile(r?.value === true));
    return () => {
      off1?.();
      off2?.();
    };
  }, []);
  return (
    <>
      <div className="card svc">
        <div className="svc-head">
          <Icon name="cloud" />
          <span className="grow">
            <b>Google Drive</b>
            <span className="muted small">{cfg.email ? `${cfg.name ? `${cfg.name} · ` : ''}${cfg.email}` : 'Connected'}</span>
          </span>
        </div>
        {s?.error && /sign in|could not open|cancelled|not finished/i.test(s.error) && (
          <button className="btn btn--primary btn--block" onClick={() => void connectDrive().catch(() => undefined)}>Sign in to Google Drive again</button>
        )}
        {s && (
          <div className="cloud-state" role="status">
            <Icon name={s.error ? 'warn' : s.syncing || s.pending ? 'retry' : 'check'} size={18} />
            <span className="grow">
              {s.syncing ? 'Saving and syncing…' : s.error ? `Not synced: ${s.error}` : s.pending ? `${s.pending} change${s.pending === 1 ? '' : 's'} waiting` : 'Up to date with your cloud.'}
              {s.lastSyncAt && <span className="muted small"> Last synced {new Date(s.lastSyncAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.</span>}
            </span>
          </div>
        )}
        {space && (
          <div className="space">
            <div className="storage-bar" role="img" aria-label={`Maktaba uses ${formatBytes(space.mine)}; ${space.limit ? `${formatBytes(Math.max(0, space.limit - space.usage))} free of ${formatBytes(space.limit)}` : ''}`}>
              {space.limit ? (
                <>
                  <i style={{ width: `${Math.min(100, (space.mine / space.limit) * 100)}%`, background: 'var(--rubric)' }} />
                  <i style={{ width: `${Math.min(100, (Math.max(0, space.usage - space.mine) / space.limit) * 100)}%`, background: 'var(--ink-3)' }} />
                </>
              ) : null}
            </div>
            <div className="legend">
              <div><i style={{ background: 'var(--rubric)' }} /><span>Maktaba ({space.bookCount} book{space.bookCount === 1 ? '' : 's'}, notes and translations)</span><span>{formatBytes(space.mine)}</span></div>
              <div><i style={{ background: 'var(--ink-3)' }} /><span>Gmail, Photos and other files</span><span>{formatBytes(Math.max(0, space.usage - space.mine))}</span></div>
              {space.limit ? <div><i style={{ background: 'var(--line)' }} /><span>Free</span><span>{formatBytes(Math.max(0, space.limit - space.usage))}</span></div> : null}
            </div>
          </div>
        )}
        {files && files.total > 0 && (
          <p className="muted small" style={{ margin: 0 }}>
            {files.uploading
              ? `Saving “${files.uploading}” to your Drive…`
              : files.downloading
                ? `Fetching “${files.downloading}” from your Drive…`
                : `${files.inCloud} of ${files.total} books saved in your Drive.${files.waitingForWifi ? ` ${files.waitingForWifi} waiting for Wi-Fi.` : ''}`}
          </p>
        )}
        <div className="row-btns">
          <button className="btn" disabled={s?.syncing} onClick={() => void import('../../sync/sync').then((m) => m.syncNow())}><Icon name="retry" size={18} />Sync now</button>
          <button
            className="btn btn--quiet btn--danger"
            onClick={async () => {
              await setCloud(null);
              await db.settings.bulkDelete(['cloudCursor', 'cloudSeeded', 'cloudFileCount']);
              toast('Disconnected. Your library stays on this phone and in your Drive.');
            }}
          >
            Disconnect
          </button>
        </div>
      </div>
      <div className="list">
        <div className="row">
          <Icon name="download" />
          <span className="grow">
            <span className="title" id="cloud-down">Fetch books from my Drive</span>
            <div className="sub">Books added on your other phones are downloaded here by themselves.</div>
          </span>
          <button
            className="switch"
            role="switch"
            aria-checked={autoDown}
            aria-labelledby="cloud-down"
            onClick={async () => {
              const next = !autoDown;
              setAutoDown(next);
              await db.settings.put({ key: 'cloudDownloadsOff', value: !next });
            }}
          />
        </div>
      </div>
      <div className="list">
        <div className="row">
          <Icon name="cloud" />
          <span className="grow">
            <span className="title" id="cloud-mobile">Use mobile data for books</span>
            <div className="sub">Off: book files go up and come down on Wi-Fi only, to save your data bundle. Notes and reading places always sync.</div>
          </span>
          <button
            className="switch"
            role="switch"
            aria-checked={mobile}
            aria-labelledby="cloud-mobile"
            onClick={async () => {
              const next = !mobile;
              setMobile(next);
              await db.settings.put({ key: 'cloudUseMobileData', value: next });
            }}
          />
        </div>
      </div>
      <p className="muted small">Your Drive space goes as far as it can: each book is kept there once (never twice, whichever phone added it), notes and translations are stored compressed, and old sync files are cleared away. Removing a book can free its space too.</p>
      <p className="muted small">In your Drive, the folder Maktaba holds Books (the original files, exactly as you added them) and Sync (your notes, places and the rest). Maktaba sees nothing else in your Drive.</p>
    </>
  );
}
