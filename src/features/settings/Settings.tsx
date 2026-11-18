import { CheckForUpdates } from '../../app/AppUpdate';
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, requestPersistence } from '../../db/db';
import type { Book, CoverStyle } from '../../db/types';
import { formatBytes } from '../../lib/util';
import { goBack, navigate } from '../../app/router';
import { DEFAULTS, setSetting, useSetting, type ThemeName } from '../../app/settings';
import { ErrorBoundary } from '../../app/ErrorBoundary';
import { Icon, type IconName } from '../../ui/Icon';
import { BookCover } from '../library/BookCover';
import { ReadingControls } from '../reader/ReadingControls';
import { AiSettings } from './MyAiSettings';
import { SharePage } from './SharePage';
import { CloudPage } from './CloudPage';
import { HelpPage } from './HelpPage';
import { BackupPage } from './BackupPage';
import { VoicePage } from './VoicePage';

const THEMES: Array<[ThemeName, string, string]> = [
  ['auto', 'Follow phone', 'Paper by day, Lamp when the phone is in dark mode'],
  ['paper', 'Paper', 'Vellum'],
  ['sepia', 'Sepia', 'Warm, low glare'],
  ['lamp', 'Lamp', 'Dark, for evening reading'],
  ['black', 'Black', 'True black for OLED screens'],
];

const PAGES: Array<{ id: string; title: string; icon: IconName; sub: string }> = [
  { id: 'help', title: 'Help & setup', icon: 'info', sub: 'The setup guide, and answers to common questions' },
  { id: 'cloud', title: 'Your cloud', icon: 'cloud', sub: 'Your library in your own Google Drive, on all your phones' },
  { id: 'ai', title: 'Your AI', icon: 'sparkle', sub: 'Connect your own AI account; today’s allowance' },
  { id: 'share', title: 'Share Maktaba', icon: 'share', sub: 'A link anyone can open, with their own login' },
  { id: 'voice', title: 'Voice', icon: 'speaker', sub: 'Reading aloud, and fixing how words are said' },
  { id: 'backup', title: 'Backup', icon: 'download', sub: 'One file with everything, and a reminder' },
  { id: 'theme', title: 'Theme', icon: 'palette', sub: 'Paper, Sepia, Lamp or Black' },
  { id: 'reading', title: 'Reading defaults', icon: 'type', sub: 'Fonts, size, spacing and page mode' },
  { id: 'library', title: 'Library', icon: 'book', sub: 'Sorting new books into folders' },
  { id: 'covers', title: 'Default cover style', icon: 'book', sub: 'How books look on the shelf' },
  { id: 'switches', title: 'Feature switches', icon: 'switches', sub: 'Motion and experimental features' },
  { id: 'storage', title: 'Storage', icon: 'storage', sub: 'Space used on this device' },
  { id: 'about', title: 'About & installing', icon: 'info', sub: 'Version, install steps, what’s included' },
];

export function Settings({ page }: { page?: string }) {
  const info = PAGES.find((p) => p.id === page);
  return (
    <div className="screen screen--plain">
      <div className="screen-head screen-head--sub">
        <button className="icon-btn" onClick={() => goBack(page ? '/settings' : '/')} aria-label="Back"><Icon name="back" /></button>
        <h1>{info?.title ?? 'Settings'}</h1>
      </div>
      <ErrorBoundary what="these settings" compact resetKey={page}>
        <div className="settings-page">
        {!info && (
          <div className="list">
            {PAGES.map((p) => (
              <button className="row" key={p.id} onClick={() => navigate(`/settings/${p.id}`)}>
                <Icon name={p.icon} />
                <span className="grow">
                  <span className="title">{p.title}</span>
                  <div className="sub">{p.sub}</div>
                </span>
                <Icon name="forward" size={18} />
              </button>
            ))}
          </div>
        )}
        {page === 'help' && <HelpPage />}
        {page === 'cloud' && <CloudPage />}
        {page === 'ai' && <AiSettings />}
        {page === 'share' && <SharePage />}
        {page === 'backup' && <BackupPage />}
        {page === 'voice' && <VoicePage />}
        {page === 'theme' && <ThemePage />}
        {page === 'reading' && <ReadingPage />}
        {page === 'library' && <LibraryPage />}
        {page === 'covers' && <CoversPage />}
        {page === 'switches' && <SwitchesPage />}
        {page === 'storage' && <StoragePage />}
        {page === 'about' && <AboutPage />}
        </div>
      </ErrorBoundary>
    </div>
  );
}

function ThemePage() {
  const theme = useSetting('theme');
  return (
    <div className="list" role="radiogroup" aria-label="Theme">
      {THEMES.map(([value, label, sub]) => (
        <button className="row" key={value} role="radio" aria-checked={theme === value} onClick={() => void setSetting('theme', value)}>
          <span className="swatch" data-swatch={value} aria-hidden="true" />
          <span className="grow">
            <span className="title">{label}</span>
            <div className="sub">{sub}</div>
          </span>
          {theme === value && <Icon name="check" />}
        </button>
      ))}
    </div>
  );
}

function ReadingPage() {
  return (
    <>
      <p className="muted small" style={{ marginBottom: 14 }}>These apply to every book. You can change them at any time from the <b>Aa</b> button while reading.</p>
      <div className="card" style={{ display: 'grid', gap: 18 }}>
        <ReadingControls showScriptOptions />
      </div>
      <button className="btn btn--quiet" style={{ marginTop: 10 }} onClick={() => void setSetting('reader', DEFAULTS.reader)}>Reset to defaults</button>
    </>
  );
}

const SAMPLE: Book = {
  id: 'sample', title: 'الرسالة', author: 'الإمام الشافعي', lang: 'ar', format: 'epub', kind: 'text', size: 0, hash: '', fileName: '',
  addedAt: 0, status: 'want', hasCover: false, sectionCount: 0, sectionChars: [], toc: [], import: { state: 'ready', done: 0, total: 0 },
};

/** New books: ask which folder, sort them by themselves, or leave them in the library. */
function LibraryPage() {
  const mode = useSetting('shelving');
  const options: Array<['ask' | 'auto' | 'off', string, string]> = [
    ['ask', 'Ask me', 'After a book is added, Maktaba suggests a folder by its subject (or with its other volumes); one tap puts it there.'],
    ['auto', 'Sort automatically', 'New books go straight into the folder for their subject, made if need be. You can undo or change it.'],
    ['off', 'Leave them', 'New books stay on the top shelf of the library.'],
  ];
  return (
    <>
      <div className="section-title">When I add a book</div>
      <div className="list" role="radiogroup" aria-label="When I add a book">
        {options.map(([value, title, sub]) => (
          <button className="row" key={value} role="radio" aria-checked={mode === value} onClick={() => void setSetting('shelving', value)}>
            <span className="grow">
              <span className="title">{title}</span>
              <div className="sub">{sub}</div>
            </span>
            {mode === value && <Icon name="check" />}
          </button>
        ))}
      </div>
      <p className="muted small">Subjects Maktaba recognises from titles in Arabic, Urdu, Persian, Pashto, Malay and English: uṣūl al-fiqh, fiqh, ḥadīth and its commentaries, tafsīr, ʿaqīda, sīra and history, Arabic language, tazkiya, and constitutions and law. A book added from inside a folder stays in that folder.</p>
    </>
  );
}

function CoversPage() {
  const style = useSetting('coverStyle');
  const withCover = useLiveQuery(() => db.books.filter((b) => b.hasCover).first(), []);
  const sample = withCover ?? SAMPLE;
  const options: Array<[CoverStyle, string, string]> = [
    ['bound', 'Bound', 'The book’s own cover set into a leather binding'],
    ['raw', 'Original', 'The cover exactly as it comes'],
    ['designed', 'Gold title', 'The title stamped in gold on leather'],
  ];
  return (
    <>
      <div className="cover-choices">
        {options.map(([value, label]) => (
          <button key={value} className="cover-choice" aria-pressed={style === value} onClick={() => void setSetting('coverStyle', value)}>
            <BookCover book={sample} style={value} showState={false} />
            {label}
          </button>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 14 }}>
        {options.find(([v]) => v === style)?.[2]}. Books with no cover picture always get a gold title. You can also choose a style for one book from its details.
      </p>
    </>
  );
}

function SwitchesPage() {
  const flags = useSetting('flags');
  return (
    <>
      <div className="list">
        <div className="row">
          <span className="grow">
            <span className="title" id="sw-motion">Reduce motion</span>
            <div className="sub">Turns off sliding and springing. Your phone’s own reduce-motion setting is always respected.</div>
          </span>
          <button className="switch" role="switch" aria-checked={flags.reduceMotion} aria-labelledby="sw-motion" onClick={() => void setSetting('flags', { ...flags, reduceMotion: !flags.reduceMotion })} />
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 14 }}>
        Features still being built are kept out of the app until they work from start to finish. As they arrive, experimental ones appear here to switch on or off.
      </p>
    </>
  );
}

interface Usage {
  books: number;
  text: number;
  covers: number;
  study: number;
  total?: number;
  quota?: number;
  persisted: boolean;
}

function StoragePage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const count = useLiveQuery(() => db.books.count(), []) ?? 0;

  useEffect(() => {
    let alive = true;
    void (async () => {
      let books = 0;
      let covers = 0;
      let text = 0;
      await db.files.each((f) => { books += f.blob.size; });
      await db.covers.each((c) => { covers += c.blob.size; });
      await db.assets.each((a) => { covers += a.blob.size; });
      await db.sections.each((s) => { text += s.chars * 2 + 200; });
      // Translations, recognised scan pages, notes and highlights: measured as stored text.
      let study = 0;
      await db.translations.each((t) => { study += (t.en?.length ?? 0) * 2 + 120; });
      await db.ocrPages.each((o) => { study += JSON.stringify(o).length * 2; });
      await db.marks.each((m) => { study += JSON.stringify(m).length * 2; });
      await db.refs.each((r) => { study += JSON.stringify(r).length * 2; });
      const est = await navigator.storage?.estimate?.().catch(() => undefined);
      const persisted = (await navigator.storage?.persisted?.().catch(() => false)) ?? false;
      if (alive) setUsage({ books, covers, text, study, total: est?.usage, quota: est?.quota, persisted });
    })();
    return () => {
      alive = false;
    };
  }, [count]);

  if (!usage) return <p className="muted" aria-busy="true">Measuring…</p>;
  const sum = Math.max(1, usage.books + usage.text + usage.covers + usage.study);
  const parts: Array<[string, number, string]> = [
    ['Original book files', usage.books, 'var(--rubric)'],
    ['Reading text', usage.text, 'var(--slate)'],
    ['Translations, notes and recognised pages', usage.study, 'var(--gold)'],
    ['Covers and pictures', usage.covers, 'var(--gold-soft)'],
  ];
  const free = usage.quota && usage.total !== undefined ? usage.quota - usage.total : undefined;
  return (
    <>
      <div className="card" style={{ display: 'grid', gap: 16 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-read)', fontSize: '1.5rem', fontWeight: 600 }}>{formatBytes(sum)}</div>
          <div className="muted small">used by {count} book{count === 1 ? '' : 's'}{free !== undefined ? ` · about ${formatBytes(free)} free for Maktaba` : ''}</div>
        </div>
        <div className="storage-bar" aria-hidden="true">
          {parts.map(([label, n, color]) => <i key={label} style={{ width: `${(n / sum) * 100}%`, background: color }} />)}
        </div>
        <div className="legend">
          {parts.map(([label, n, color]) => (
            <div key={label}><i style={{ background: color }} /><span>{label}</span><span>{formatBytes(n)}</span></div>
          ))}
        </div>
      </div>
      <div className="banner">
        <Icon name={usage.persisted ? 'check' : 'info'} />
        <span className="grow">
          {usage.persisted
            ? 'Your library is protected: the phone will not clear it to free up space.'
            : 'Your phone may clear this library if it runs very low on space.'}
        </span>
        {!usage.persisted && (
          <button className="btn" onClick={async () => { const ok = await requestPersistence(); setUsage({ ...usage, persisted: ok }); }}>Protect</button>
        )}
      </div>
      <p className="muted small">This is the space on this phone. Your Google Drive space is under Settings › Your cloud.</p>
    </>
  );
}

function AboutPage() {
  return (
    <>
      <div className="card" style={{ display: 'grid', gap: 6 }}>
        <div style={{ fontFamily: 'var(--font-read)', fontSize: '1.3rem', fontWeight: 600 }}>
          Maktaba <span lang="ar" style={{ color: 'var(--rubric)', fontWeight: 400 }}>مكتبة</span>
        </div>
        <div className="muted small">Version {__APP_VERSION__} · built {new Date(__BUILD_TIME__).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</div>
        <p style={{ marginTop: 8 }}>A personal library for Islamic scholarship. Everything you add stays on this device and works without internet.</p>
      </div>
      <CheckForUpdates />

      <div className="section-title">In this version</div>
      <div className="card small" style={{ display: 'grid', gap: 8 }}>
        <p><b>Working now:</b> Arabic and Urdu first, Persian too: adding PDF, EPUB, Kindle, Word, FB2, text, Markdown, OpenITI and image files; the original file kept exactly and one tap away (the printed page itself for PDFs); offline text recognition for scans; whole-book English translation with your own AI, with a glossary of terms in Arabic, Urdu and Persian spelling; Ask your books, Explain, Iʿrāb and chapter summaries; your library in your own Google Drive, in step on all your phones; a setup guide with help along the way; one-file backup; reading aloud; the library with folders, covers and reading status; the reader with themes, type controls, contents, bookmarks, highlights, notes, footnotes, printed page numbers and search; search across all books that ignores vowel marks and Urdu and Persian spellings; saved references and copy with citation; Qur’an verses on a tap.</p>
        <p><b>Not built yet:</b> ḥadīth popups, the dictionary, comparing books, exports, and lock-screen controls for reading aloud. They are left out rather than shown half-finished.</p>
      </div>

      <div className="section-title">Sources</div>
      <div className="card small" style={{ display: 'grid', gap: 6 }}>
        <p>Qur’an text: the Uthmani text from QuranEnc (The Noble Qur’an Encyclopedia). English meanings: Saheeh International, via QuranEnc and Tanzil.</p>
        <p>Text recognition: Tesseract, with its Arabic, Urdu, Persian and English data. PDF: pdf.js. Kindle books: foliate-js.</p>
      </div>

      <div className="section-title">Installing on a Samsung phone</div>
      <div className="card small">
        <ol style={{ margin: 0, paddingInlineStart: 20, display: 'grid', gap: 8 }}>
          <li>Open <b>Settings → Security and privacy → Auto Blocker</b> and switch it <b>off</b>. (Auto Blocker stops every app that is not from the Play Store or Galaxy Store.)</li>
          <li>Open the Maktaba APK file from <b>My Files</b> or your browser’s downloads.</li>
          <li>If asked, allow that app to <b>install unknown apps</b>, then tap <b>Install</b>.</li>
          <li>You can switch Auto Blocker back on afterwards. Maktaba keeps working.</li>
          <li>Updates then come inside the app: a popup offers each new version, and one tap installs it over this one, keeping your books and notes.</li>
        </ol>
      </div>
    </>
  );
}
