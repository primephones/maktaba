import { useEffect, useRef, useState } from 'react';
import { applyTheme, resolveTheme, setSetting, useSetting, type ReaderPrefs } from '../../app/settings';
import { revealTheme } from '../../ui/motion';
import { THEMES, swatchStyle } from '../../app/themes';
import { isAndroidApp } from '../../native/maktaba';


interface Props {
  /** Show the theme row (in the reader; Settings has its own Theme page). */
  showTheme?: boolean;
  /** Show Arabic/Urdu options even when no particular book is open. */
  showScriptOptions?: boolean;
  /** Language of the open book, to show only the options that apply. */
  lang?: string;
  /** Section titles between the groups (in the reader's Text sheet). */
  grouped?: boolean;
}

/** The reading controls: one component used by the reader's Text sheet and by Settings. */
export function ReadingControls({ showTheme, showScriptOptions, lang, grouped }: Props) {
  // Shown as set at once, and saved behind: a slider dragged quickly does not jump back while
  // each step is being written.
  const stored = useSetting('reader');
  const [prefs, setPrefs] = useState(stored);
  const latest = useRef(stored);
  const writing = useRef(0);
  useEffect(() => {
    if (writing.current === 0) {
      latest.current = stored;
      setPrefs(stored);
    }
  }, [stored]);
  const theme = useSetting('theme');
  const set = (patch: Partial<ReaderPrefs>) => {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setPrefs(next);
    writing.current++;
    void setSetting('reader', next).finally(() => {
      writing.current--;
    });
  };
  const arabic = showScriptOptions || lang === 'ar' || lang === 'fa' || lang === 'ps';
  const urdu = showScriptOptions || lang === 'ur';
  // English: the book's own, or its translation.
  const latin = true;

  const title = (t: string) => (grouped ? <div className="section-title">{t}</div> : null);
  return (
    <>
      {showTheme && title('Theme')}
      {showTheme && (
        <div className="ctl">
          {!grouped && <div className="lbl"><span>Theme</span></div>}
          <div className="theme-chips" role="group" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t.id} className="theme-chip" aria-pressed={resolveTheme(theme) === t.id} onClick={(e) => revealTheme(e, () => { applyTheme(t.id); void setSetting('theme', t.id); })}>
                <span className="swatch" style={swatchStyle(t)} aria-hidden="true" />
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {title('Typeface')}
      {latin && (
        <div className="ctl">
          <div className="lbl"><span>English typeface</span></div>
          <div className="seg" role="group" aria-label="English typeface">
            <button aria-pressed={prefs.latinFont === 'literata'} onClick={() => set({ latinFont: 'literata' })} style={{ fontFamily: 'var(--font-read)' }}>Literata</button>
            <button aria-pressed={prefs.latinFont === 'garamond'} onClick={() => set({ latinFont: 'garamond' })} style={{ fontFamily: 'var(--font-garamond)', fontSize: '1.05rem' }}>Garamond</button>
            <button aria-pressed={prefs.latinFont === 'atkinson'} onClick={() => set({ latinFont: 'atkinson' })} style={{ fontFamily: 'var(--font-clear)' }} aria-label="Atkinson, extra clear">Atkinson</button>
            <button aria-pressed={prefs.latinFont === 'plex'} onClick={() => set({ latinFont: 'plex' })}>Plex</button>
          </div>
        </div>
      )}
      {arabic && (
        <div className="ctl">
          <div className="lbl"><span>Arabic &amp; Persian typeface</span></div>
          <div className="seg" role="group" aria-label="Arabic typeface">
            <button aria-pressed={prefs.arabicFont === 'amiri'} onClick={() => set({ arabicFont: 'amiri' })} style={{ fontFamily: 'var(--font-arabic)', fontSize: '1.1rem' }}>أميري · Amiri</button>
            <button aria-pressed={prefs.arabicFont === 'scheherazade'} onClick={() => set({ arabicFont: 'scheherazade' })} style={{ fontFamily: 'var(--font-arabic-scheherazade)', fontSize: '1.15rem' }}>شهرزاد</button>
            <button aria-pressed={prefs.arabicFont === 'plex'} onClick={() => set({ arabicFont: 'plex' })} style={{ fontFamily: 'var(--font-arabic-sans)' }}>بلكس · Plex</button>
          </div>
        </div>
      )}
      {urdu && (
        <div className="ctl">
          <div className="lbl"><span>Urdu typeface</span></div>
          <div className="seg" role="group" aria-label="Urdu typeface">
            <button aria-pressed={prefs.urduFont === 'nastaliq'} onClick={() => set({ urduFont: 'nastaliq' })} style={{ fontFamily: 'var(--font-urdu)', minHeight: 52 }}>نستعلیق</button>
            <button aria-pressed={prefs.urduFont === 'gulzar'} onClick={() => set({ urduFont: 'gulzar' })} style={{ fontFamily: 'var(--font-urdu-gulzar)', minHeight: 52 }}>گلزار</button>
            <button aria-pressed={prefs.urduFont === 'amiri'} onClick={() => set({ urduFont: 'amiri' })} style={{ fontFamily: 'var(--font-arabic)', fontSize: '1.1rem' }}>نسخ · Naskh</button>
          </div>
        </div>
      )}

      {title('Size and spacing')}
      <div className="ctl">
        <div className="lbl"><span id="ctl-size">Text size</span><span>{prefs.fontSize}%</span></div>
        <div className="ctl-row">
          <button className="btn" aria-label="Smaller text" onClick={() => set({ fontSize: Math.max(70, prefs.fontSize - 5) })} style={{ padding: '0 16px', fontSize: '0.85rem' }}>A</button>
          <input className="grow" type="range" min={70} max={220} step={5} value={prefs.fontSize} aria-labelledby="ctl-size" onChange={(e) => set({ fontSize: Number(e.target.value) })} />
          <button className="btn" aria-label="Larger text" onClick={() => set({ fontSize: Math.min(220, prefs.fontSize + 5) })} style={{ padding: '0 14px', fontSize: '1.2rem' }}>A</button>
        </div>
      </div>

      <div className="ctl">
        <div className="lbl"><span id="ctl-lh">Line spacing</span><span>{prefs.lineHeight.toFixed(2)}</span></div>
        <input type="range" min={1.3} max={2.4} step={0.05} value={prefs.lineHeight} aria-labelledby="ctl-lh" onChange={(e) => set({ lineHeight: Number(e.target.value) })} />
      </div>

      <div className="ctl">
        <div className="lbl"><span id="ctl-mg">Margins</span><span>{prefs.margin}px</span></div>
        <input type="range" min={8} max={56} step={2} value={prefs.margin} aria-labelledby="ctl-mg" onChange={(e) => set({ margin: Number(e.target.value) })} />
      </div>

      {title('Page')}
      <div className="ctl">
        <div className="lbl"><span>Page mode</span></div>
        <div className="seg" role="group" aria-label="Page mode">
          <button aria-pressed={prefs.mode === 'scroll'} onClick={() => set({ mode: 'scroll' })}>Scroll</button>
          <button aria-pressed={prefs.mode === 'paged'} onClick={() => set({ mode: 'paged' })}>Pages</button>
        </div>
      </div>

      <div className="ctl">
        <div className="lbl"><span>Paragraphs</span><span>{prefs.layout === 'spaced' ? 'set apart by a line of space' : 'indented, as in a printed book'}</span></div>
        <div className="seg" role="group" aria-label="Paragraphs">
          <button aria-pressed={prefs.layout !== 'spaced'} onClick={() => set({ layout: 'book' })}>Like a book</button>
          <button aria-pressed={prefs.layout === 'spaced'} onClick={() => set({ layout: 'spaced' })}>Spaced</button>
        </div>
      </div>

      <div className="ctl-row">
        <span className="grow" id="ctl-bold">
          Bolder text
          <div className="muted small">Easier on a small screen or tired eyes</div>
        </span>
        <button className="switch" role="switch" aria-checked={prefs.bold} aria-labelledby="ctl-bold" onClick={() => set({ bold: !prefs.bold })} />
      </div>

      <div className="ctl-row">
        <span className="grow" id="ctl-just">Justify text</span>
        <button className="switch" role="switch" aria-checked={prefs.justify} aria-labelledby="ctl-just" onClick={() => set({ justify: !prefs.justify })} />
      </div>

      {(arabic || urdu) && (
        <div className="ctl-row">
          <span className="grow" id="ctl-tashkil">
            Show vowel marks (tashkīl)
            <div className="muted small">Hides or shows the ḥarakāt in Arabic-script text</div>
          </span>
          <button className="switch" role="switch" aria-checked={prefs.tashkil} aria-labelledby="ctl-tashkil" onClick={() => set({ tashkil: !prefs.tashkil })} />
        </div>
      )}

      {title('At night')}
      <div className="ctl">
        <div className="lbl"><span id="ctl-warm">Warm light</span><span>{prefs.warmth ? `${prefs.warmth}%` : 'Off'}</span></div>
        <input type="range" min={0} max={80} step={5} value={prefs.warmth} aria-labelledby="ctl-warm" onChange={(e) => set({ warmth: Number(e.target.value) })} />
      </div>
      <div className="ctl">
        <div className="lbl"><span id="ctl-dim">Extra dim</span><span>{prefs.dim ? `${prefs.dim}%` : 'Off'}</span></div>
        <input type="range" min={0} max={60} step={5} value={prefs.dim} aria-labelledby="ctl-dim" onChange={(e) => set({ dim: Number(e.target.value) })} />
        <div className="muted small">Darker than the phone’s lowest brightness, for reading in bed.</div>
      </div>
      <div className="ctl-row">
        <span className="grow" id="ctl-darkpages">
          Dark printed pages
          <div className="muted small">In a dark theme, scanned pages are shown light on dark</div>
        </span>
        <button className="switch" role="switch" aria-checked={prefs.darkPages} aria-labelledby="ctl-darkpages" onClick={() => set({ darkPages: !prefs.darkPages })} />
      </div>

      {isAndroidApp() && (
        <>
          {title('On this phone')}
          <div className="ctl-row">
            <span className="grow" id="ctl-vol">
              Turn pages with the volume keys
              <div className="muted small">Volume down goes forward, volume up goes back</div>
            </span>
            <button className="switch" role="switch" aria-checked={prefs.volumeKeys} aria-labelledby="ctl-vol" onClick={() => set({ volumeKeys: !prefs.volumeKeys })} />
          </div>
          <div className="ctl-row">
            <span className="grow" id="ctl-awake">Keep the screen on while reading</span>
            <button className="switch" role="switch" aria-checked={prefs.keepAwake} aria-labelledby="ctl-awake" onClick={() => set({ keepAwake: !prefs.keepAwake })} />
          </div>
          <div className="ctl">
            <div className="lbl"><span>Screen orientation while reading</span></div>
            <div className="seg" role="group" aria-label="Screen orientation while reading">
              <button aria-pressed={prefs.orientation === 'auto'} onClick={() => set({ orientation: 'auto' })}>Turns freely</button>
              <button aria-pressed={prefs.orientation === 'portrait'} onClick={() => set({ orientation: 'portrait' })}>Upright</button>
              <button aria-pressed={prefs.orientation === 'landscape'} onClick={() => set({ orientation: 'landscape' })}>Sideways</button>
            </div>
          </div>
        </>
      )}

    </>
  );
}
