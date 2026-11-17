import { useRef, useState } from 'react';
import { backupName, createBackup, restoreBackup, type Progress } from '../../backup/backup';
import { saveFile, type Saved } from '../../lib/saveFile';
import { formatBytes, percent, timeAgo } from '../../lib/util';
import { setSetting, useSetting } from '../../app/settings';
import { resumeImports } from '../../import';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';

export function BackupPage() {
  const last = useSetting('lastBackupAt');
  const reminder = useSetting('backupReminder');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [saved, setSaved] = useState<(Saved & { size: number }) | null>(null);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const backup = async () => {
    setError('');
    setSaved(null);
    try {
      setProgress({ stage: 'Gathering your library', done: 0, total: 1 });
      const blob = await createBackup(setProgress);
      setProgress({ stage: 'Saving the file', done: 0, total: blob.size });
      const where = await saveFile(blob, backupName(), 'application/zip', (done, total) => setProgress({ stage: 'Saving the file', done, total }));
      await setSetting('lastBackupAt', Date.now());
      setSaved({ ...where, size: blob.size });
    } catch (e) {
      setError(`The backup could not be made: ${(e as Error).message}`);
    } finally {
      setProgress(null);
    }
  };

  const restore = async (file: File) => {
    setError('');
    try {
      setProgress({ stage: 'Restoring', done: 0, total: file.size });
      const r = await restoreBackup(file, setProgress);
      toast(`Restored ${r.books} book${r.books === 1 ? '' : 's'} from the backup of ${new Date(r.createdAt).toLocaleDateString()}.`);
      void resumeImports();
    } catch (e) {
      setError(`This backup could not be restored: ${(e as Error).message}`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <>
      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <p>One file with everything: your books, reading places, highlights, notes, bookmarks, references, recognised text and translations. Keep a copy somewhere safe, such as Google Drive or another phone.</p>
        <p className="muted small">{last ? `Last backup ${timeAgo(last)}.` : 'No backup made on this phone yet.'}</p>
        {progress ? (
          <div role="status">
            <div className="small" style={{ marginBottom: 6 }}>{progress.stage}… {progress.total > 1 ? percent(progress.done / progress.total) : ''}</div>
            <span className="meter" style={{ display: 'block' }}><i style={{ width: percent(progress.total ? progress.done / progress.total : 0) }} /></span>
          </div>
        ) : (
          <button className="btn btn--primary" onClick={() => void backup()}><Icon name="download" size={20} />Back up now</button>
        )}
        {saved && (
          <div className="banner">
            <Icon name="check" />
            <span className="grow">Saved to {saved.location} ({formatBytes(saved.size)}).</span>
            {saved.share && <button className="btn" onClick={() => void saved.share!()}>Send…</button>}
          </div>
        )}
        {error && <div className="banner banner--error" role="alert"><Icon name="warn" /><span className="grow">{error}</span></div>}
      </div>

      <div className="section-title">Remind me to back up</div>
      <div className="seg" role="group" aria-label="Backup reminder">
        {(['weekly', 'monthly', 'off'] as const).map((v) => (
          <button key={v} aria-pressed={reminder === v} onClick={() => void setSetting('backupReminder', v)}>{v === 'off' ? 'Never' : v === 'weekly' ? 'Weekly' : 'Monthly'}</button>
        ))}
      </div>

      <div className="section-title">Restore</div>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <p className="small">Adds everything in a backup to this library. Anything here that is also in the backup is replaced by the backup’s copy; nothing else is removed.</p>
        <button className="btn" disabled={!!progress} onClick={() => input.current?.click()}><Icon name="retry" size={18} />Restore from a backup file</button>
        <input
          ref={input}
          type="file"
          accept=".maktaba,.zip,application/zip"
          hidden
          data-testid="restore-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void restore(f);
          }}
        />
      </div>
    </>
  );
}

/** True when the reader asked to be reminded and the last backup is older than that. */
export function backupDue(last: number, reminder: 'off' | 'weekly' | 'monthly', hasBooks: boolean): boolean {
  if (reminder === 'off' || !hasBooks) return false;
  const gap = reminder === 'weekly' ? 7 : 30;
  return Date.now() - last > gap * 86_400_000;
}
