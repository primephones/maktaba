import { useEffect, useState } from 'react';
import { getCloud, type CloudConfig } from '../../cloud/drive';
import { ANDROID_URL, PUBLIC_URL } from '../../app/config';
import { navigate } from '../../app/router';
import { Icon } from '../../ui/Icon';

/**
 * Moving to a new phone, step by step: with Google Drive (everything follows by itself), or
 * with one backup file. Either way the AI keys are added again on the new phone, because
 * they never leave the phone they were added on.
 */
export function MovePage() {
  const [cloud, setCloud] = useState<CloudConfig | null | undefined>(undefined);
  useEffect(() => {
    void getCloud().then(setCloud);
  }, []);
  const connected = !!cloud;

  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>
        Your books, notes, highlights, references, places and translations can all come with you. Choose one way.
      </p>

      <div className="section-title">With Google Drive {connected ? '(you are connected)' : '(easiest)'}</div>
      <div className="card move-card">
        <ol className="move-steps">
          <li>
            <b>On this phone:</b>{' '}
            {connected ? (
              <>Google Drive is connected, so everything is already kept there. Open <b>Your cloud</b> and check that the books show as in the cloud.</>
            ) : (
              <>open <b>Your cloud</b> and connect your Google account. Wait until your books show as in the cloud.</>
            )}
          </li>
          <li>
            <b>On the new phone:</b> install Maktaba (the web app at <code>{PUBLIC_URL.replace(/^https:\/\//, '')}</code>, or the Android app from the Releases page), then open <b>Settings › Your cloud</b> and connect the <b>same Google account</b>.
          </li>
          <li>Your library, notes and translations arrive within a minute; the book files themselves follow on Wi-Fi.</li>
          <li>Add your AI again in <b>Settings › Your AI</b> (keys never leave the phone they were added on).</li>
        </ol>
        <button className="btn btn--primary btn--block" onClick={() => navigate('/settings/cloud')}><Icon name="cloud" size={18} />Open Your cloud</button>
      </div>

      <div className="section-title">With a backup file</div>
      <div className="card move-card">
        <ol className="move-steps">
          <li><b>On this phone:</b> open <b>Backup</b> and tap <b>Back up now</b>. It makes one file with everything, books included.</li>
          <li>Tap <b>Send…</b> and send the file to the new phone: by WhatsApp to yourself, by e-mail, in Google Drive, or with a cable.</li>
          <li><b>On the new phone:</b> install Maktaba, open <b>Settings › Backup</b>, tap <b>Restore from a backup file</b> and choose it.</li>
          <li>Add your AI again in <b>Settings › Your AI</b>.</li>
        </ol>
        <button className="btn btn--block" onClick={() => navigate('/settings/backup')}><Icon name="download" size={18} />Open Backup</button>
      </div>

      <div className="section-title">Getting Maktaba on the new phone</div>
      <div className="card small move-card">
        <p style={{ margin: 0 }}>
          <b>Web app:</b> open <code>{PUBLIC_URL}</code> in Chrome, then menu › <b>Add to Home screen</b> › <b>Install</b>. It updates itself.
        </p>
        <p style={{ margin: 0 }}>
          <b>Android app:</b> open <code>{ANDROID_URL.replace(/^https:\/\//, '')}</code> on the phone and install the newest <b>.apk</b>. On a Samsung phone, switch off Auto Blocker for a minute while installing.
        </p>
      </div>
    </>
  );
}
