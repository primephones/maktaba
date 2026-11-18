import { setSetting, useSetting, type ReaderPrefs, type ThemeName } from '../../app/settings';
import { isAndroidApp } from '../../native/maktaba';

const THEMES: Array<[Exclude<ThemeName, 'auto'>, string]> = [['paper', 'Paper'], ['sepia', 'Sepia'], ['lamp', 'Lamp'], ['black', 'Black']];

interface Props {
  /** Show the theme row (in the reader; Settings has its own Theme page). */
  showTheme?: boolean;
  /** Show Arabic/Urdu options even when no particular book is open. */
  showScriptOptions?: boolean;
  /** Language of the open book, to show only the options that apply. */
  lang?: string;
}

/** The reading controls: one component used by the reader's Aa sheet and by Settings. */
export function ReadingControls({ showTheme, showScriptOptions, lang }: Props) {
  const prefs = useSetting('reader');
  const theme = useSetting('theme');
  const set = (patch: Partial<ReaderPrefs>) => void setSetting('reader', { ...prefs, ...patch });
  const arabic = showScriptOptions || lang === 'ar' || lang === 'fa' || lang === 'ps';
  const urdu = showScriptOptions || lang === 'ur';
  const latin = showScriptOptions || !(arabic || urdu) || lang === 'en';

  return (
    <>
      {showTheme && (
        <div className="ctl">
          <div className="lbl"><span>Theme</span></div>
          <div className="theme-chips" role="group" aria-label="Theme">
            {THEMES.map(([value, label]) => (
              <button key={value} className="theme-chip" aria-pressed={document.documentElement.dataset.theme === value && (theme === value || theme === 'auto')} onClick={() => void setSetting('theme', value)}>
                <span className="swatch" data-swatch={value} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="ctl">
        <div className="lbl"><span>Page mode</span></div>
        <div className="seg" role="group" aria-label="Page mode">
          <button aria-pressed={prefs.mode === 'scroll'} onClick={() => set({ mode: 'scroll' })}>Scroll</button>
          <button aria-pressed={prefs.mode === 'paged'} onClick={() => set({ mode: 'paged' })}>Pages</button>
        </div>
      </div>

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

      {isAndroidApp() && (
        <>
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

      {latin && (
        <div className="ctl">
          <div className="lbl"><span>English typeface</span></div>
          <div className="seg" role="group" aria-label="English typeface">
            <button aria-pressed={prefs.latinFont === 'literata'} onClick={() => set({ latinFont: 'literata' })} style={{ fontFamily: 'var(--font-read)' }}>Literata</button>
            <button aria-pressed={prefs.latinFont === 'plex'} onClick={() => set({ latinFont: 'plex' })}>Plex Sans</button>
          </div>
        </div>
      )}
      {arabic && (
        <div className="ctl">
          <div className="lbl"><span>Arabic &amp; Persian typeface</span></div>
          <div className="seg" role="group" aria-label="Arabic typeface">
            <button aria-pressed={prefs.arabicFont === 'amiri'} onClick={() => set({ arabicFont: 'amiri' })} style={{ fontFamily: 'var(--font-arabic)', fontSize: '1.1rem' }}>أميري · Amiri</button>
            <button aria-pressed={prefs.arabicFont === 'plex'} onClick={() => set({ arabicFont: 'plex' })} style={{ fontFamily: 'var(--font-arabic-sans)' }}>بلكس · Plex</button>
          </div>
        </div>
      )}
      {urdu && (
        <div className="ctl">
          <div className="lbl"><span>Urdu typeface</span></div>
          <div className="seg" role="group" aria-label="Urdu typeface">
            <button aria-pressed={prefs.urduFont === 'nastaliq'} onClick={() => set({ urduFont: 'nastaliq' })} style={{ fontFamily: 'var(--font-urdu)', minHeight: 52 }}>نستعلیق</button>
            <button aria-pressed={prefs.urduFont === 'amiri'} onClick={() => set({ urduFont: 'amiri' })} style={{ fontFamily: 'var(--font-arabic)', fontSize: '1.1rem' }}>نسخ · Naskh</button>
          </div>
        </div>
      )}
    </>
  );
}
