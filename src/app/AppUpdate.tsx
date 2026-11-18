import { useCallback, useEffect, useState } from 'react';
import { Sheet } from '../ui/Sheet';
import { Icon } from '../ui/Icon';
import { toast } from '../ui/toast';
import { isAndroidApp, plugin } from '../native/maktaba';
import { findUpdate, installUpdate, openInstaller, postpone, postponed, RELEASES_PAGE, type AvailableUpdate, type Step } from './appUpdate';
import { navigate } from './router';

const mb = (n: number) => `${(n / 1_048_576).toFixed(n > 10_485_760 ? 0 : 1)} MB`;

/**
 * The "new version" popup in the Android app. It appears on its own when a newer build is
 * published (at most once a day per build if put off), and from Settings › About.
 */
export function AppUpdate() {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);

  /** Looks for a new version. Asked for by the reader (force): always answers. */
  const look = useCallback(async (force: boolean) => {
    try {
      const u = await findUpdate(force);
      if (u && (force || !(await postponed(u.build)))) setUpdate(u);
      else if (force) toast('You have the newest version of Maktaba.');
    } catch (e) {
      if (force) toast((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!isAndroidApp()) return;
    // A little after opening, so the library is up first; and whenever the app comes back.
    const t = window.setTimeout(() => void look(false), 4000);
    const back = () => document.visibilityState === 'visible' && void look(false);
    const asked = () => void look(true);
    document.addEventListener('visibilitychange', back);
    window.addEventListener('maktaba:check-update', asked);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('visibilitychange', back);
      window.removeEventListener('maktaba:check-update', asked);
    };
  }, [look]);

  if (!update) return null;
  return <UpdateSheet update={update} onClose={() => setUpdate(null)} />;
}

function UpdateSheet({ update, onClose }: { update: AvailableUpdate; onClose: () => void }) {
  const [step, setStep] = useState<Step | null>(null);

  // Coming back from "Allow from this source" (or from switching off Auto Blocker): carry
  // straight on to the installer. Still not allowed means something blocks the switch.
  useEffect(() => {
    if (step?.kind !== 'allow' && step?.kind !== 'blocked') return;
    const back = async () => {
      if (document.visibilityState !== 'visible') return;
      if ((await plugin.appInfo()).canInstall) void openInstaller(setStep);
      else if (step.kind === 'allow') setStep({ kind: 'blocked' });
    };
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [step]);

  const later = () => {
    void postpone(update.build);
    onClose();
  };
  const busy = step?.kind === 'downloading';

  return (
    <Sheet title="A new version of Maktaba" onClose={busy ? () => undefined : later}>
      <div className="app-update">
        <div className="app-update-head">
          <span className="app-update-badge" aria-hidden="true"><Icon name="download" size={22} /></span>
          <div>
            <div className="app-update-ver">Build {update.build}</div>
            <div className="muted small">You have build {update.current} · {mb(update.size)} download</div>
          </div>
        </div>

        {update.notes.length > 0 && (
          <>
            <div className="section-title">What’s new</div>
            <ul className="app-update-notes">
              {update.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </>
        )}

        {!step && (
          <>
            <p className="muted small">Your books, notes and settings are kept. The update installs over this version.</p>
            <button className="btn btn--primary btn--block" onClick={() => void installUpdate(update, setStep)}>Update now</button>
            <button className="btn btn--quiet btn--block" onClick={later}>Later</button>
          </>
        )}

        {step?.kind === 'downloading' && (
          <div className="app-update-progress" role="status">
            <span className="meter"><i style={{ width: `${step.total ? Math.round((step.done / step.total) * 100) : 5}%` }} /></span>
            <span className="muted small">Downloading… {mb(step.done)}{step.total ? ` of ${mb(step.total)}` : ''}</span>
          </div>
        )}

        {step?.kind === 'allow' && (
          <div className="app-update-step">
            <p><b>One-time permission.</b> Android has opened a page asking whether Maktaba may install updates. Switch on <b>Allow from this source</b>, then come back here: the update carries on by itself.</p>
            <p className="muted small">On a Samsung phone, if the switch is greyed out, turn off <b>Settings › Security and privacy › Auto Blocker</b> first (you can turn it back on afterwards).</p>
            <button className="btn btn--primary btn--block" onClick={() => void openInstaller(setStep)}>Continue</button>
          </div>
        )}

        {step?.kind === 'blocked' && (
          <div className="app-update-step">
            <p><b>Your phone’s Auto Blocker is stopping the update.</b> On Samsung phones it blocks every app that is not from the Play Store or Galaxy Store, Maktaba’s own updates included. No app can get past it; you switch it off for a minute:</p>
            <ol className="app-update-steps">
              <li>Tap <b>Open security settings</b> below, then <b>Auto Blocker</b>, and switch it <b>off</b>.</li>
              <li>Come back here: the update carries on by itself (allow Maktaba to install updates if asked).</li>
              <li>Once Maktaba has updated, switch Auto Blocker back <b>on</b> if you like.</li>
            </ol>
            <button className="btn btn--primary btn--block" onClick={() => void plugin.openSecuritySettings()}>Open security settings</button>
            <button className="btn btn--block" onClick={() => void openInstaller(setStep)}>I’ve switched it off: continue</button>
          </div>
        )}

        {step?.kind === 'installing' && (
          <div className="app-update-step">
            <p><b>Tap Update</b> in Android’s window to finish. Maktaba closes and opens again on the new version.</p>
            <p className="muted small">If nothing appeared, tap below. If Android says the app was <b>blocked</b>: on a Samsung phone switch off Auto Blocker (Settings › Security and privacy › Auto Blocker) and try again; if <b>Play Protect</b> warns about it, tap <b>More details › Install anyway</b> (it says this about any app not from the Play Store).</p>
            <button className="btn btn--block" onClick={() => void openInstaller(setStep)}>Open the installer again</button>
            <button className="btn btn--quiet btn--block" onClick={() => void plugin.openSecuritySettings()}>Open security settings (Auto Blocker)</button>
          </div>
        )}

        {step?.kind === 'differentKey' && (
          <div className="app-update-step">
            <p><b>This one update needs a fresh install.</b> Your current copy came from an early test build signed with a different key, so Android will not install over it. After this, every update is one tap.</p>
            <ol className="app-update-steps">
              <li>Keep your library: <b>Settings › Your cloud</b> (if connected, it is already safe) or <b>Settings › Backup › Back up now</b>.</li>
              <li>Uninstall Maktaba (press and hold its icon › Uninstall).</li>
              <li>Install the new version from the download page, then restore the backup (or connect your cloud again).</li>
            </ol>
            <button className="btn btn--primary btn--block" onClick={() => { onClose(); navigate('/settings/backup'); }}>Make a backup first</button>
            <button className="btn btn--block" onClick={() => void plugin.openUrl({ url: update.page || RELEASES_PAGE })}>Open the download page</button>
          </div>
        )}

        {step?.kind === 'failed' && (
          <div className="app-update-step">
            <p>{step.message}</p>
            <button className="btn btn--primary btn--block" onClick={() => void installUpdate(update, setStep)}>Try again</button>
            <button className="btn btn--quiet btn--block" onClick={() => void plugin.openUrl({ url: update.page || RELEASES_PAGE })}>Download it in the browser instead</button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** "Check for updates" in Settings › About (Android app only). */
export function CheckForUpdates() {
  const [info, setInfo] = useState<{ versionCode: number; versionName?: string } | null>(null);
  useEffect(() => {
    if (isAndroidApp()) void plugin.appInfo().then(setInfo).catch(() => undefined);
  }, []);
  if (!isAndroidApp()) return null;
  return (
    <div className="card" style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontWeight: 600 }}>Updates</div>
      <div className="muted small">{info ? `This is build ${info.versionCode}.` : ' '} New versions appear here and as a popup; they install over this one and keep your library.</div>
      <button className="btn" onClick={() => window.dispatchEvent(new Event('maktaba:check-update'))}><Icon name="download" size={18} />Check for updates</button>
    </div>
  );
}
