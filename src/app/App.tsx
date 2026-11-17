import { lazy, Suspense, useEffect, useMemo } from 'react';
import { useRoute, goBack, canGoBack } from './router';
import { AppContext } from './AppContext';
import { ErrorBoundary } from './ErrorBoundary';
import { useAddBooks } from './addBooks';
import { UpdateNotice } from './UpdateNotice';
import { resolveTheme, useSetting } from './settings';
import { BottomBar } from '../ui/BottomBar';
import { Toasts } from '../ui/toast';
import { EmptyState } from '../ui/EmptyState';
import { resumeImports } from '../import';
import { Home } from '../features/home/Home';
import { Library } from '../features/library/Library';
import { References } from '../features/references/References';
import { Search } from '../features/search/Search';
import { Settings } from '../features/settings/Settings';

const Reader = lazy(() => import('../features/reader/Reader').then((m) => ({ default: m.Reader })));

export function App() {
  const route = useRoute();
  const { pick, addDropped, element: addElement } = useAddBooks();
  const actions = useMemo(() => ({ addBooks: pick }), [pick]);

  useEffect(() => {
    void resumeImports();
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
    const color = onLeather ? (dark ? '#4f1c18' : '#7c2822') : { paper: '#f6f4ef', sepia: '#f1e7d0', lamp: '#14130f', black: '#000000' }[resolved];
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
    void (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      const { StatusBar, Style } = await import('@capacitor/status-bar');
      await StatusBar.setStyle({ style: dark || onLeather ? Style.Dark : Style.Light }).catch(() => undefined);
    })();
  }, [route.name, theme]);

  const inReader = route.name === 'reader';
  const barHidden = inReader || route.name === 'search' || route.name === 'settings';
  const key = route.name === 'reader' ? `reader:${route.bookId}` : route.name;

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
    case 'reader':
      screen = (
        <Suspense fallback={<div className="screen screen--plain" aria-busy="true" />}>
          <Reader bookId={route.bookId} />
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
