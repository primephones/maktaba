import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useRoute, goBack, canGoBack, navigate } from './router';
import { AppContext } from './AppContext';
import { ErrorBoundary } from './ErrorBoundary';
import { useAddBooks } from './addBooks';
import { UpdateNotice } from './UpdateNotice';
import { Catalogue } from '../features/library/Catalogue';
import { applyThemeWith, nightByClock, themeTone, useSetting } from './settings';
import { BottomBar } from '../ui/BottomBar';
import { Toasts, clearToasts, toast } from '../ui/toast';
import { EmptyState } from '../ui/EmptyState';
import { resumeImports } from '../import';
import { Home } from '../features/home/Home';
import { Library } from '../features/library/Library';
import { References } from '../features/references/References';
import { Search } from '../features/search/Search';
import { Setup } from '../features/setup/Setup';
import { Settings } from '../features/settings/Settings';

const Reader = lazy(() => import('../features/reader/Reader').then((m) => ({ default: m.Reader })));
const ScanReview = lazy(() => import('../features/review/ScanReview').then((m) => ({ default: m.ScanReview })));

export function App() {
  const route = useRoute();
  const { pick, addDropped, element: addElement } = useAddBooks();
  const actions = useMemo(() => ({ addBooks: pick }), [pick]);

  useEffect(() => {
    void resumeImports();
  }, []);

  // Signing in to an AI service comes back here (the page address, or maktaba://auth on
  // Android); book translations done on the phone pick up where they stopped.
  useEffect(() => {
    void import('../ai/signin').then((m) =>
      m.listenForSignIns((ok, message) => {
        toast(message);
        if (ok) window.dispatchEvent(new Event('maktaba:connected'));
      }),
    );
    const resume = () => {
      void import('../ai/device').then(async (d) => d.hasMyAi(await d.getMyAi()) && d.runJobs());
      // Scanned pages waiting to be read start (or carry on) as soon as there is a way to read them.
      void import('../ocr/queue').then((q) => q.runOcrQueue());
    };
    resume();
    window.addEventListener('maktaba:connected', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.removeEventListener('maktaba:connected', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, []);

  // Sync with the reader's other phones, once their cloud (or a server) is connected.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let alive = true;
    const begin = async () => {
      const { getServer } = await import('../ai/client');
      const { getCloud } = await import('../cloud/drive');
      if (!alive || stop || !((await getCloud()) || (await getServer()))) return;
      const { startAutoSync } = await import('../sync/sync');
      if (alive && !stop) stop = startAutoSync();
    };
    void begin();
    window.addEventListener('maktaba:connected', begin);
    return () => {
      alive = false;
      stop?.();
      window.removeEventListener('maktaba:connected', begin);
    };
  }, []);

  // Finished translations are collected from the server every minute and a half while the
  // app is open, and whenever it comes back to the front.
  useEffect(() => {
    const pull = () => {
      if (document.visibilityState === 'visible') void import('../ai/translation').then((t) => t.pullAll()).catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 90_000);
    document.addEventListener('visibilitychange', pull);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', pull);
    };
  }, []);

  // Android back button / gesture, when running as the installed app.
  useEffect(() => {
    let remove: (() => void) | undefined;
    void (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      const { App: NativeApp } = await import('@capacitor/app');
      const handle = await NativeApp.addListener('backButton', () => {
        if (canGoBack()) goBack();
        else void NativeApp.minimizeApp();
      });
      remove = () => void handle.remove();
    })();
    return () => remove?.();
  }, []);

  // Books shared to Maktaba, or opened with it, from another Android app.
  useEffect(() => {
    const stops: Array<() => void> = [];
    let alive = true;
    void (async () => {
      const { native } = await import('../native/maktaba');
      const offFiles = await native.on('sharedFiles', async (e) => {
        const files: File[] = [];
        for (const f of e.files) {
          try {
            files.push(await native.readShared(f));
          } catch {
            e.failed.push(f.name);
          }
        }
        if (files.length) {
          navigate('/library');
          addDropped(files);
        }
        if (e.failed.length) toast(`Couldn’t receive ${e.failed.join(', ')}. Try sharing it again.`);
        void native.call('releaseSharedFiles', { paths: e.files.map((f) => f.path) });
      });
      const offText = await native.on('sharedText', () => {
        toast('Adding a book from a link isn’t in this version yet. Download the file, then share the file to Maktaba.');
      });
      if (alive) stops.push(offFiles, offText);
      else {
        offFiles();
        offText();
      }
    })();
    return () => {
      alive = false;
      stops.forEach((s) => s());
    };
  }, [addDropped]);

  // Files dropped onto the window (desktop web) are added like any other.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      addDropped([...e.dataTransfer.files]);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [addDropped]);

  // The theme follows the settings wherever they change (here, or synced from another
  // device). The status bar is drawn over the app: its icons must show on the theme.
  const theme = useSetting('theme');
  const autoThemes = useSetting('autoThemes');
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  // Night by the clock: looked at each minute, so the theme turns at the time set.
  const [clockNight, setClockNight] = useState(() => nightByClock(autoThemes.from, autoThemes.to));
  useEffect(() => {
    if (autoThemes.by !== 'clock') return;
    const tick = () => setClockNight(nightByClock(autoThemes.from, autoThemes.to));
    tick();
    const t = window.setInterval(tick, 60_000);
    return () => window.clearInterval(t);
  }, [autoThemes.by, autoThemes.from, autoThemes.to]);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => {
    applyThemeWith(theme, autoThemes);
    const dark = themeTone(theme) === 'dark';
    void (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      const { StatusBar, Style } = await import('@capacitor/status-bar');
      await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
    })();
  }, [theme, autoThemes.light, autoThemes.dark, autoThemes.by, autoThemes.from, autoThemes.to, systemDark, clockNight]);

  const inReader = route.name === 'reader';
  // The home-screen widget tapped: open its book (when the app was started by it, or brought back).
  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    void import('../native/maktaba').then(async ({ native }) => {
      const r = await native.call('takeOpenBook');
      if (r?.bookId && alive) navigate(`/book/${r.bookId}`);
      const stop = await native.on('openBook', (e) => navigate(`/book/${e.bookId}`));
      if (alive) off = stop;
      else stop();
    });
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  // Opening a book: messages about the library do not follow the reader into it.
  const readerId = route.name === 'reader' ? route.bookId : null;
  useEffect(() => {
    if (readerId) clearToasts();
  }, [readerId]);
  const barHidden = inReader || route.name === 'search' || route.name === 'settings' || route.name === 'setup' || route.name === 'review' || route.name === 'catalogue';
  const key = route.name === 'reader' ? `reader:${route.bookId}` : route.name === 'review' ? `review:${route.bookId}` : route.name;

  let screen;
  switch (route.name) {
    case 'home':
      screen = <Home />;
      break;
    case 'library':
      screen = <Library folderId={route.folderId} />;
      break;
    case 'references':
      screen = <References />;
      break;
    case 'catalogue':
      screen = <Catalogue />;
      break;
    case 'search':
      screen = <Search />;
      break;
    case 'settings':
      screen = <Settings page={route.page} />;
      break;
    case 'setup':
      screen = <Setup step={route.step} />;
      break;
    case 'reader':
      screen = (
        <Suspense fallback={<div className="screen screen--plain" aria-busy="true" />}>
          <Reader bookId={route.bookId} />
        </Suspense>
      );
      break;
    case 'review':
      screen = (
        <Suspense fallback={<div className="screen screen--plain" aria-busy="true" />}>
          <ScanReview bookId={route.bookId} page={route.page} />
        </Suspense>
      );
      break;
    default:
      screen = (
        <div className="screen screen--plain">
          <EmptyState icon="info" title="Nothing here">
            This page doesn’t exist.
          </EmptyState>
          <button className="btn btn--primary btn--block" onClick={() => goBack()}>Go to Home</button>
        </div>
      );
  }

  return (
    <AppContext.Provider value={actions}>
      <UpdateNotice />
      <ErrorBoundary what={inReader ? 'this book' : 'this screen'} resetKey={key}>
        <main key={key}>{screen}</main>
      </ErrorBoundary>
      <BottomBar route={route} hidden={barHidden} onAdd={() => pick(route.name === 'library' ? route.folderId : undefined)} />
      <Toasts place={inReader ? 'reader' : barHidden ? 'edge' : 'bar'} />
      {addElement}
    </AppContext.Provider>
  );
}
