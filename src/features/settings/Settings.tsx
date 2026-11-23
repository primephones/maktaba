import { MovePage } from './MovePage';
import { CheckForUpdates } from '../../app/AppUpdate';
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, requestPersistence } from '../../db/db';
import type { Book, CoverStyle } from '../../db/types';
import { formatBytes } from '../../lib/util';
import { goBack, navigate } from '../../app/router';
import { DEFAULTS, applyTheme, setSetting, useSetting } from '../../app/settings';
import { revealTheme } from '../../ui/motion';
import { CountUp } from '../../ui/CountUp';
import { bestStreak, minutesOn, streakOf } from '../../app/reading';
import { THEMES, swatchStyle, themeInfo, type ThemeInfo } from '../../app/themes';
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


const PAGES: Array<{ id: string; title: string; icon: IconName; sub: string; group: string }> = [
  { id: 'help', group: 'Start here', title: 'Help & setup', icon: 'info', sub: 'The setup guide, and answers to common questions' },
  { id: 'cloud', group: 'Your accounts', title: 'Your cloud', icon: 'cloud', sub: 'Your library in your own Google Drive, on all your phones' },
  { id: 'ai', group: 'Your accounts', title: 'Your AI', icon: 'sparkle', sub: 'Connect your own AI account, test it, today’s allowance' },
  { id: 'theme', group: 'Reading', title: 'Theme', icon: 'palette', sub: 'Eight colour themes, or follow the phone' },
  { id: 'stats', group: 'Reading', title: 'Your reading', icon: 'book', sub: 'A daily goal, days in a row, and what you have read' },
  { id: 'english', group: 'Reading', title: 'How the English reads', icon: 'language', sub: 'Allah or God, honorifics, technical terms' },
  { id: 'reading', group: 'Reading', title: 'Reading defaults', icon: 'type', sub: 'Typefaces, size, spacing and page mode' },
  { id: 'voice', group: 'Reading', title: 'Voice', icon: 'speaker', sub: 'Reading aloud, and fixing how words are said' },
  { id: 'library', group: 'Your library', title: 'Sorting new books', icon: 'folder', sub: 'Into folders: ask me, automatically, or leave them' },
  { id: 'covers', group: 'Your library', title: 'Cover style', icon: 'book', sub: 'How books look on the shelf' },
  { id: 'storage', group: 'Your library', title: 'Storage', icon: 'storage', sub: 'Space used on this device' },
  { id: 'backup', group: 'Keep it safe', title: 'Backup', icon: 'download', sub: 'One file with everything, and a reminder' },
  { id: 'move', group: 'Keep it safe', title: 'Move to a new phone', icon: 'move', sub: 'Take your books, notes and translations with you' },
  { id: 'share', group: 'Maktaba', title: 'Share Maktaba', icon: 'share', sub: 'A link anyone can open, with their own login' },
  { id: 'switches', group: 'Maktaba', title: 'Feature switches', icon: 'switches', sub: 'Motion and experimental features' },
  { id: 'about', group: 'Maktaba', title: 'About & updates', icon: 'info', sub: 'Version, updates, install steps, what’s included' },
];
const GROUPS = [...new Set(PAGES.map((p) => p.group))];

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
        {!info &&
          GROUPS.map((g) => (
            <div key={g}>
              <div className="section-title">{g}</div>
              <div className="list">
                {PAGES.filter((p) => p.group === g).map((p) => (
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
            </div>
          ))}
        {page === 'help' && <HelpPage />}
        {page === 'cloud' && <CloudPage />}
        {page === 'ai' && <AiSettings />}
        {page === 'share' && <SharePage />}
        {page === 'backup' && <BackupPage />}
        {page === 'move' && <MovePage />}
        {page === 'voice' && <VoicePage />}
        {page === 'theme' && <ThemePage />}
        {page === 'reading' && <ReadingPage />}
        {page === 'english' && <EnglishStylePage />}
        {page === 'stats' && <StatsPage />}
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
  const pair = useSetting('autoThemes');
  const row = (t: ThemeInfo) => (
    <button className="row" key={t.id} role="radio" aria-checked={theme === t.id} onClick={(e) => revealTheme(e, () => { applyTheme(t.id); void setSetting('theme', t.id); })}>
      <span className="swatch" style={swatchStyle(t)} aria-hidden="true" />
      <span className="grow">
        <span className="title">{t.label}</span>
        <div className="sub">{t.sub}</div>
      </span>
      {theme === t.id && <Icon name="check" />}
    </button>
  );
  const day = themeInfo(pair.light);
  const night = themeInfo(pair.dark);
  return (
    <div role="radiogroup" aria-label="Theme">
      <div className="theme-preview" aria-hidden="true">
        <span className="tp-eyebrow">Continue reading</span>
        <span className="tp-title">al-Risāla</span>
        <span className="tp-text">Knowledge is of two kinds: knowledge of the body, and knowledge of religion.</span>
        <span className="tp-row"><span className="tp-btn">Read</span><span className="tp-chip">✦ Translate</span><span className="tp-hl">highlight</span></span>
      </div>
      <div className="list">
        <button className="row" role="radio" aria-checked={theme === 'auto'} onClick={() => void setSetting('theme', 'auto')}>
          <span className="swatch swatch--split" style={{ background: `linear-gradient(135deg, ${day.swatch[0]} 50%, ${night.swatch[0]} 50%)` }} aria-hidden="true" />
          <span className="grow">
            <span className="title">Day and night</span>
            <div className="sub">{day.label} by day, {night.label} {pair.by === 'clock' ? `from ${pair.from ?? '19:00'} to ${pair.to ?? '06:00'}` : 'when the phone is in dark mode'}</div>
          </span>
          {theme === 'auto' && <Icon name="check" />}
        </button>
      </div>
      {theme === 'auto' && (
        <div className="auto-pair">
          <div className="ctl">
            <div className="lbl"><span>Night begins</span></div>
            <div className="seg" role="group" aria-label="Night begins">
              <button aria-pressed={pair.by !== 'clock'} onClick={() => void setSetting('autoThemes', { ...pair, by: 'phone' })}>With the phone</button>
              <button aria-pressed={pair.by === 'clock'} onClick={() => void setSetting('autoThemes', { ...pair, by: 'clock', from: pair.from ?? '19:00', to: pair.to ?? '06:00' })}>By the clock</button>
            </div>
            {pair.by === 'clock' && (
              <div className="clock-row">
                <label>From <input type="time" value={pair.from ?? '19:00'} onChange={(e) => e.target.value && void setSetting('autoThemes', { ...pair, from: e.target.value })} /></label>
                <label>to <input type="time" value={pair.to ?? '06:00'} onChange={(e) => e.target.value && void setSetting('autoThemes', { ...pair, to: e.target.value })} /></label>
              </div>
            )}
          </div>
          {(['light', 'dark'] as const).map((tone) => (
            <div className="ctl" key={tone}>
              <div className="lbl"><span>{tone === 'light' ? 'By day' : 'At night'}</span></div>
              <div className="theme-chips" role="group" aria-label={tone === 'light' ? 'Theme by day' : 'Theme at night'}>
                {THEMES.filter((t) => t.tone === tone).map((t) => (
                  <button key={t.id} className="theme-chip" aria-pressed={pair[tone] === t.id} onClick={() => void setSetting('autoThemes', { ...pair, [tone]: t.id })}>
                    <span className="swatch" style={swatchStyle(t)} aria-hidden="true" />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="section-title">Palettes</div>
      <div className="list">{THEMES.filter((t) => t.family === 'palette').map(row)}</div>
      <div className="section-title">Classic</div>
      <div className="list">{THEMES.filter((t) => t.family === 'classic').map(row)}</div>
    </div>
  );
}

/** The daily goal, the days in a row, the last week, and the books finished this year. */
function StatsPage() {
  const goal = useSetting('readingGoal');
  const log = useSetting('readingLog');
  const finished = useLiveQuery(() => db.books.filter((b) => b.status === 'finished').toArray(), []) ?? [];
  const year = new Date().getFullYear();
  const thisYear = finished.filter((b) => new Date(b.finishedAt ?? b.openedAt ?? 0).getFullYear() === year);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return { d, m: minutesOn(log, d) };
  });
  const top = Math.max(goal || 15, ...days.map((x) => x.m), 1);
  const yearMins = Math.round(Object.entries(log).filter(([k]) => k.startsWith(String(year))).reduce((n, [, s]) => n + s, 0) / 60);
  const streak = streakOf(log, goal);
  return (
    <>
      <div className="stats-row">
        <div><b><CountUp value={streak} /></b><small>Days in a row</small></div>
        <div><b>{bestStreak(log, goal)}</b><small>Best run</small></div>
        <div><b>{yearMins >= 60 ? `${Math.floor(yearMins / 60)} h` : `${yearMins} min`}</b><small>This year</small></div>
        <div><b>{thisYear.length}</b><small>Finished</small></div>
      </div>
      <div className="section-title">The last seven days</div>
      <div className="week" role="img" aria-label={days.map((x) => `${x.d.toLocaleDateString(undefined, { weekday: 'long' })}: ${x.m} minutes`).join(', ')}>
        {goal > 0 && <span className="week-goal" style={{ bottom: `${(goal / top) * 100}%` }} aria-hidden="true" />}
        {days.map((x, i) => (
          <div className="week-day" key={i}>
            <span className="week-bar" data-met={goal > 0 && x.m >= goal ? '' : undefined} style={{ height: `${Math.max(2, (x.m / top) * 100)}%` }} />
            <small>{x.d.toLocaleDateString(undefined, { weekday: 'narrow' })}</small>
          </div>
        ))}
      </div>
      <div className="ctl">
        <div className="lbl"><span>Daily goal</span><span>{goal ? `${goal} minutes a day` : 'No goal'}</span></div>
        <div className="seg" role="group" aria-label="Daily goal">
          {[0, 5, 15, 30, 60].map((m) => (
            <button key={m} aria-pressed={goal === m} onClick={() => void setSetting('readingGoal', m)}>{m ? `${m} min` : 'Off'}</button>
          ))}
        </div>
        <p className="muted small" style={{ margin: 0 }}>Time is counted while a book is open and you are reading in it.</p>
      </div>
      {thisYear.length > 0 && (
        <>
          <div className="section-title">Finished in {year}</div>
          <div className="list">
            {thisYear.map((b) => (
              <button className="row" key={b.id} onClick={() => navigate(`/book/${b.id}`)}>
                <span className="mini-cover"><BookCover book={b} /></span>
                <span className="grow">
                  <span className="title" dir="auto">{b.titleEn || b.title}</span>
                  <div className="sub">{b.finishedAt ? new Date(b.finishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) : ''}</div>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** How the AI's English reads, with a sample that changes as each choice is made. */
function EnglishStylePage() {
  const style = useSetting('translationStyle');
  const set = (patch: Partial<typeof style>) => void setSetting('translationStyle', { ...style, ...patch });
  const god = style.god === 'God' ? 'God' : 'Allah';
  const prophet = style.honorifics === 'short' ? 'the Prophet ﷺ' : 'the Prophet (peace and blessings be upon him)';
  const term = style.terms === 'plain' ? 'by consensus' : 'by ijmāʿ (consensus)';
  return (
    <>
      <div className="style-sample" aria-live="polite">
        <span className="style-sample-k">Sample</span>
        <p>{god} commands justice, and {prophet} taught it. What the scholars of an age agree upon is established {term}.</p>
      </div>
      <div className="ctl">
        <div className="lbl"><span>The name of God</span></div>
        <div className="seg" role="group" aria-label="The name of God">
          <button aria-pressed={style.god !== 'God'} onClick={() => set({ god: 'Allah' })}>Allah</button>
          <button aria-pressed={style.god === 'God'} onClick={() => set({ god: 'God' })}>God</button>
        </div>
      </div>
      <div className="ctl">
        <div className="lbl"><span>Honorifics</span><span>after the names of the Prophet and the Companions</span></div>
        <div className="seg" role="group" aria-label="Honorifics">
          <button aria-pressed={style.honorifics !== 'short'} onClick={() => set({ honorifics: 'words' })}>In words</button>
          <button aria-pressed={style.honorifics === 'short'} onClick={() => set({ honorifics: 'short' })}>Short (ﷺ, ra)</button>
        </div>
      </div>
      <div className="ctl">
        <div className="lbl"><span>Technical terms</span><span>such as ijmāʿ, qiyās, makrūh</span></div>
        <div className="seg" role="group" aria-label="Technical terms">
          <button aria-pressed={style.terms !== 'plain'} onClick={() => set({ terms: 'transliterated' })}>Arabic term, explained</button>
          <button aria-pressed={style.terms === 'plain'} onClick={() => set({ terms: 'plain' })}>Plain English</button>
        </div>
      </div>
      <p className="muted small">These apply to English made from now on, in every book. English already made stays as it is.</p>
    </>
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
        <p><b>Reading:</b> Arabic, Urdu, Persian, Pashto, Malay and English books (PDF, EPUB, Kindle, Word, FB2, text, Markdown, OpenITI, images); scanned books shown as printed with their English beneath; the original file kept exactly and one tap away; themes, typefaces (Amiri, Scheherazade, Nastaliq, Gulzar), contents, bookmarks, highlights, notes, footnotes, printed page numbers, search that ignores vowel marks and spellings; reading aloud; Qurʾān verses on a tap.</p>
        <p><b>With your own AI:</b> whole-book translation; scanned pages read and translated in one go; Explain; iʿrāb with the reason for each case, and Test yourself; Ask your books, with an answer or the arguments for and against, every point cited; chapter summaries.</p>
        <p><b>Library:</b> folders (sorted for you), the book catalogue (the six books of ḥadīth and their commentaries, Ḥanafī fiqh, works on government, and the constitutions of Muslim countries), a matn opened in its sharḥ at the same place; your own cloud on all your phones; one-file backup; moving to a new phone.</p>
      </div>

      <div className="section-title">Sources</div>
      <div className="card small" style={{ display: 'grid', gap: 6 }}>
        <p>Qur’an text: the Uthmani text from QuranEnc (The Noble Qur’an Encyclopedia). English meanings: Saheeh International, via QuranEnc and Tanzil.</p>
        <p>Book catalogue: texts from the OpenITI corpus (Open Islamicate Texts Initiative), CC BY-NC-SA 4.0. Constitutions: Constitute Project, CC BY-NC 3.0.</p>
        <p>Typefaces: Amiri, Scheherazade New (SIL), Noto Nastaliq Urdu, Gulzar, Literata and IBM Plex, all under the SIL Open Font License.</p>
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
