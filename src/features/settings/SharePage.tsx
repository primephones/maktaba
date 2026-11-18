import { useEffect, useState } from 'react';
import { ANDROID_URL, PUBLIC_URL, webVersionLive } from '../../app/config';
import { isAndroidApp, plugin } from '../../native/maktaba';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';

const shareText = (web: boolean) =>
  `Maktaba: a library for Islamic scholarship, with Arabic, Urdu, Persian, Pashto and Malay books read in English.\n\n` +
  (web ? `Open it here: ${PUBLIC_URL}\n` : '') +
  `Android app: ${ANDROID_URL}\n\n` +
  `Your library is yours alone. When you open it, Maktaba walks you through connecting your own cloud and your own AI (about five minutes, all free).`;

/** The link to hand out: the web version once it is up, otherwise the Android download. */
async function link(): Promise<{ url: string; web: boolean }> {
  const web = (await webVersionLive()) !== false;
  return { url: web ? PUBLIC_URL : ANDROID_URL, web };
}

/** Shares the link through the phone's own share sheet (or copies it where there is none). */
export async function shareMaktaba() {
  const { web } = await link();
  const SHARE_TEXT = shareText(web);
  try {
    if (isAndroidApp()) {
      await plugin.shareText({ text: SHARE_TEXT, title: 'Share Maktaba' });
      return;
    }
    if (navigator.share) {
      await navigator.share({ title: 'Maktaba', text: SHARE_TEXT });
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
  }
  await copyLink();
}

async function copyLink() {
  const { url } = await link();
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied.');
  } catch {
    toast(`Copying isn’t allowed here. The link is ${url}`);
  }
}

/**
 * The link to give someone. They open it, get their own empty library, and sign in to
 * their own AI and their own cloud: nothing of yours is shared, and they use none of your
 * allowance.
 */
export function SharePage() {
  const [web, setWeb] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    void webVersionLive().then(setWeb);
  }, []);
  const url = web === false ? ANDROID_URL : PUBLIC_URL;
  return (
    <>
      <div className="hero-card">
        <Icon name="share" />
        <h2>Share Maktaba</h2>
        <p>Send this link to anyone. They get their own library, and sign in with their own AI and their own cloud.</p>
        <code className="share-link">{url}</code>
        {web === false && (
          <p className="muted small">
            The web version is not switched on yet, so this shares the Android app. Once GitHub Pages is turned on for the project (see the
            setup guide), the web link is shared instead.
          </p>
        )}
        <div className="row-btns">
          <button className="btn btn--primary" onClick={() => void shareMaktaba()}><Icon name="share" size={18} />Share link</button>
          <button className="btn" onClick={() => void copyLink()}><Icon name="copy" size={18} />Copy</button>
        </div>
      </div>
      <div className="section-title">What they get</div>
      <div className="list">
        <div className="row"><Icon name="book" /><span className="grow"><span className="title">Their own library</span><div className="sub">An empty library of their own. Your books, notes and reading are not shared.</div></span></div>
        <div className="row"><Icon name="sparkle" /><span className="grow"><span className="title">Their own AI</span><div className="sub">They connect their own free AI account. None of your allowance is used.</div></span></div>
        <div className="row"><Icon name="cloud" /><span className="grow"><span className="title">Their own cloud</span><div className="sub">Their library is kept in their own cloud, so it follows them to a new phone.</div></span></div>
        <div className="row"><Icon name="download" /><span className="grow"><span className="title">On Android</span><div className="sub">The link also leads to the Android app, to install from Releases.</div></span></div>
      </div>
    </>
  );
}
