import { useEffect, useState } from 'react';
import { getVerses, identifyQuote, surahName, type QuranMatch, type QuranRef, type Verse } from '../../quran/refs';
import { Sheet } from '../../ui/Sheet';
import { Icon } from '../../ui/Icon';
import { toast } from '../../ui/toast';

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const arNum = (n: number) => String(n).replace(/[0-9]/g, (d) => AR_DIGITS[Number(d)]);

const label = (r: QuranRef) => {
  const [, tr] = surahName(r.surah);
  return `${tr} ${r.surah}:${r.from}${r.to > r.from ? `–${r.to}` : ''}`;
};

/** A verse or verses in Arabic with their English meaning, from the app itself. */
export function QuranSheet({ match, onClose }: { match: QuranMatch; onClose: () => void }) {
  const [state, setState] = useState<{ ref: QuranRef; verses: Verse[] } | 'none' | 'error' | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const ref = match.ref ?? (match.quote ? await identifyQuote(match.quote) : null);
        if (!ref) {
          if (alive) setState('none');
          return;
        }
        const verses = await getVerses({ ...ref, to: Math.min(ref.to, ref.from + 9) });
        if (alive) setState({ ref, verses });
      } catch {
        if (alive) setState('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [match]);

  const title = state && typeof state === 'object' ? label(state.ref) : 'The Qur’an';
  return (
    <Sheet title={title} onClose={onClose}>
      {state === null && <p className="muted" aria-busy="true">Opening…</p>}
      {state === 'none' && <p>This quotation could not be matched to a verse. It may be paraphrased, or not from the Qur’an.</p>}
      {state === 'error' && <p>The Qur’an text could not be opened. Try again.</p>}
      {state && typeof state === 'object' && (
        <>
          <p className="muted small" dir="rtl" lang="ar" style={{ fontFamily: 'var(--font-arabic)', fontSize: '1.05rem' }}>سورة {surahName(state.ref.surah)[0]}</p>
          <div className="verses">
            {state.verses.map((v) => (
              <div className="verse" key={v.ayah}>
                <p className="verse-ar" lang="ar" dir="rtl">
                  {v.ar} <span className="ayah-no" aria-label={`verse ${v.ayah}`}>﴿{arNum(v.ayah)}﴾</span>
                </p>
                <p className="verse-en" lang="en"><span className="muted small">{v.ayah}. </span>{v.en}</p>
              </div>
            ))}
          </div>
          {state.ref.to > state.ref.from + 9 && <p className="muted small">Showing the first ten verses of this passage.</p>}
          <button
            className="btn"
            onClick={() => {
              const text = `${state.verses.map((v) => v.ar).join(' ')}\n${state.verses.map((v) => v.en).join(' ')}\n— Qur’an, ${label(state.ref)}`;
              void navigator.clipboard.writeText(text).then(() => toast('Copied with the reference.'), () => toast('Copying isn’t allowed here.'));
            }}
          >
            <Icon name="copy" size={18} />Copy
          </button>
          <p className="muted small">English: Saheeh International, via QuranEnc. The meaning is given in English; the Qur’an itself is the Arabic.</p>
        </>
      )}
    </Sheet>
  );
}
