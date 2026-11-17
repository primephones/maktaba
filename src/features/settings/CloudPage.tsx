import { useEffect, useState } from 'react';
import { accessToken, cloudAvailable, ensureFolders, getCloud, setCloud, whoAmI, type CloudConfig } from '../../cloud/drive';
import type { SyncState } from '../../sync/sync';
import type { FileSyncState } from '../../sync/cloudSync';
import { db } from '../../db/db';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';

/**
 * Each person's own cloud: their Google Drive. Their books (the original files) and their
 * notes, highlights, places and translations are kept there, so the library follows them
 * to a new phone and stays in step between their phones. Maktaba sees only the files it
 * makes in the Maktaba folder.
 */
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
      await setCloud({ provider: 'gdrive' });
      await accessToken(true);
      await ensureFolders();
      const me = await whoAmI().catch(() => ({}) as { email?: string; name?: string });
      const now = await getCloud();
      await setCloud({ ...(now ?? { provider: 'gdrive' }), ...me });
      toast('Your Google Drive is connected. Your library is being saved there.');
      const { syncNow } = await import('../../sync/sync');
      void syncNow();
    } catch (e) {
      await setCloud(null);
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
        {error && <div className="banner banner--error" role="alert"><Icon name="warn" /><span className="grow">{error}</span></div>}
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
  useEffect(() => {
    let off1: (() => void) | undefined;
    let off2: (() => void) | undefined;
    void import('../../sync/sync').then((m) => (off1 = m.onSyncState(setS)));
    void import('../../sync/cloudSync').then((m) => (off2 = m.onFileSync(setFiles)));
    void db.settings.get('cloudDownloadsOff').then((r) => setAutoDown(r?.value !== true));
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
        {s && (
          <div className="cloud-state" role="status">
            <Icon name={s.error ? 'warn' : s.syncing || s.pending ? 'retry' : 'check'} size={18} />
            <span className="grow">
              {s.syncing ? 'Saving and syncing…' : s.error ? `Not synced: ${s.error}` : s.pending ? `${s.pending} change${s.pending === 1 ? '' : 's'} waiting` : 'Up to date with your cloud.'}
              {s.lastSyncAt && <span className="muted small"> Last synced {new Date(s.lastSyncAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.</span>}
            </span>
          </div>
        )}
        {files && files.total > 0 && (
          <p className="muted small" style={{ margin: 0 }}>
            {files.uploading ? `Saving “${files.uploading}” to your Drive…` : files.downloading ? `Fetching “${files.downloading}” from your Drive…` : `${files.inCloud} of ${files.total} books saved in your Drive.`}
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
      <p className="muted small">In your Drive, the folder Maktaba holds Books (the original files, exactly as you added them) and Sync (your notes, places and the rest). Maktaba sees nothing else in your Drive.</p>
    </>
  );
}
