import { lazy, Suspense, useEffect, useMemo } from 'react';
import { useRoute, goBack, canGoBack, navigate } from './router';
import { AppContext } from './AppContext';
import { ErrorBoundary } from './ErrorBoundary';
import { useAddBooks } from './addBooks';
import { UpdateNotice } from './UpdateNotice';
import { resolveTheme, useSetting } from './settings';
import { BottomBar } from '../ui/BottomBar';
import { Toasts, toast } from '../ui/toast';
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
    const resume = () => void import('../ai/device').then(async (d) => d.hasMyAi(await d.getMyAi()) && d.runJobs());
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

  // The status bar is drawn over the app: its icons must contrast with what is under them,
  // which is leather on Home and paper elsewhere.
  const theme = useSetting('theme');
  useEffect(() => {
    const resolved = resolveTheme(theme);
    const dark = resolved === 'lamp' || resolved === 'black';
    const onLeather = route.name === 'home';
    const color = onLeather ? (dark ? '#4f1c18' : '#7c2822') : { paper: '#f6f4ef', sepia: '#f1e7d0', lamp: '#1d1914', black: '#000000' }[resolved];
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
    void (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      const { StatusBar, Style } = await import('@capacitor/status-bar');
      await StatusBar.setStyle({ style: dark || onLeather ? Style.Dark : Style.Light }).catch(() => undefined);
    })();
  }, [route.name, theme]);

  const inReader = route.name === 'reader';
  const barHidden = inReader || route.name === 'search' || route.name === 'settings' || route.name === 'setup' || route.name === 'review';
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
