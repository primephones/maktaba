import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource-variable/literata/wght.css';
import '@fontsource-variable/literata/wght-italic.css';
import '@fontsource-variable/eb-garamond/wght.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/amiri/400.css';
import '@fontsource/amiri/700.css';
import '@fontsource/noto-nastaliq-urdu/400.css';
import '@fontsource/noto-nastaliq-urdu/700.css';
import '@fontsource/gulzar/arabic-400.css';
import '@fontsource/scheherazade-new/arabic-400.css';
import '@fontsource/scheherazade-new/arabic-700.css';

import './styles/tokens.css';
import './styles/base.css';
import './styles/library.css';
import './styles/reader.css';

import { App } from './app/App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { bootTheme } from './app/settings';
import { initGlide } from './ui/motion';

bootTheme();
initGlide();

// One orchestrated moment per launch: the shelves fill in. Later visits are instant.
document.documentElement.dataset.entrance = '';
window.setTimeout(() => delete document.documentElement.dataset.entrance, 1400);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary what="the app">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
