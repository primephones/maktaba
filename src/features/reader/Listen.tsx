import { useCallback, useEffect, useRef, useState } from 'react';
import { db, sectionId } from '../../db/db';
import type { Book, Translation } from '../../db/types';
import { getFixes, onSpeech, piecesOf, sentences, speakPiece, stopSpeaking, type Piece } from '../../speech/speech';
import { workBegan, workEnded } from '../../native/work';
import { Icon } from '../../ui/Icon';

interface Item {
  id: string;
  section: number;
  block: number;
  piece: Piece;
}

type Source = 'en' | 'orig' | 'both';
const SLEEP = [0, 15, 30, 60] as const;

/** Builds what to say from a place onwards, a chapter at a time. */
async function buildFrom(book: Book, section: number, block: number, source: Source, translations: Map<string, Translation>): Promise<Item[]> {
  const fixes = await getFixes();
  const items: Item[] = [];
  const lang = (['ur', 'fa', 'ar', 'ps', 'ms'].includes(book.lang) ? book.lang : 'en') as Piece['lang'];
  for (let s = section; s < Math.min(book.sectionCount, section + 2); s++) {
    const sec = await db.sections.get(sectionId(book.id, s));
    if (!sec) continue;
    sec.blocks.forEach((b, i) => {
      if (s === section && i < block) return;
      if (b.t === 'img' || b.t === 'hr' || !b.text.trim()) return;
      const en = translations.get(`${s}:${i}`)?.en.replace(/†/g, '');
      const parts: Array<[string, Piece['lang']]> = [];
      if (source !== 'en' || !en) parts.push([b.text, lang]);
      if (en && source !== 'orig') parts.push([en, 'en']);
      for (const [text, l] of parts) {
        for (const sentence of sentences(text)) {
          for (const piece of piecesOf(sentence, l, fixes)) items.push({ id: `${s}:${i}:${items.length}`, section: s, block: i, piece });
        }
      }
    });
  }
  return items;
}

interface Props {
  book: Book;
  from: { section: number; block: number };
  translations: Map<string, Translation>;
  defaultSource: Source;
  onClose: () => void;
}

/** The reading-aloud bar: play, pause, sentence by sentence, speed, sleep timer. */
export function Listen({ book, from, translations, defaultSource, onClose }: Props) {
  const [playing, setPlaying] = useState(false);
  const [source, setSource] = useState<Source>(defaultSource);
  const [rate, setRate] = useState(1);
  const [sleep, setSleep] = useState<(typeof SLEEP)[number]>(0);
  const [error, setError] = useState('');
  const items = useRef<Item[]>([]);
  const at = useRef(0);
  const sent = useRef(-1);
  const stopAt = useRef(0);
  const playingRef = useRef(false);
  const place = useRef(from);

  const mark = (it: Item | undefined) => {
    document.querySelectorAll('.bk[data-speaking]').forEach((el) => el.removeAttribute('data-speaking'));
    if (!it) return;
    const el = document.querySelector(`.bk[data-s="${it.section}"][data-b="${it.block}"]`);
    el?.setAttribute('data-speaking', '');
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    place.current = { section: it.section, block: it.block };
  };

  /** Keeps two pieces queued, so speech runs on without gaps. */
  const feed = useCallback(async () => {
    while (playingRef.current && sent.current < at.current + 1 && sent.current + 1 < items.current.length) {
      sent.current++;
      const it = items.current[sent.current];
      await speakPiece(it.piece, it.id, rate, sent.current === at.current && sent.current === 0);
    }
  }, [rate]);

  const start = useCallback(async (section: number, block: number) => {
    setError('');
    await stopSpeaking();
    items.current = await buildFrom(book, section, block, source, translations);
    at.current = 0;
    sent.current = -1;
    if (!items.current.length) {
      setError('Nothing to read from here.');
      return;
    }
    playingRef.current = true;
    setPlaying(true);
    stopAt.current = sleep ? Date.now() + sleep * 60_000 : 0;
    void workBegan('speech', `Reading aloud: ${book.title}`, 'Tap to return to the book', '');
    mark(items.current[0]);
    try {
      await feed();
    } catch (e) {
      setError((e as Error).message);
      playingRef.current = false;
      setPlaying(false);
    }
  }, [book, source, translations, sleep, feed]);

  const pause = useCallback(async () => {
    playingRef.current = false;
    setPlaying(false);
    await stopSpeaking();
    void workEnded('speech');
    await db.settings.put({ key: `speech:${book.id}`, value: place.current });
  }, [book.id]);

  useEffect(() => {
    return onSpeech((e) => {
      if (!playingRef.current) return;
      if (e.type === 'done' || e.type === 'error') {
        const idx = items.current.findIndex((x) => x.id === e.id);
        if (idx < 0 || idx < at.current) return;
        at.current = idx + 1;
        if (stopAt.current && Date.now() > stopAt.current) {
          void pause();
          return;
        }
        if (at.current >= items.current.length) {
          // End of what was prepared: carry on from the next chapter.
          const last = items.current[items.current.length - 1];
          if (last.section + 1 < book.sectionCount) void start(last.section + 1, 0);
          else void pause();
          return;
        }
        mark(items.current[at.current]);
        void feed();
      }
    });
  }, [book.sectionCount, feed, pause, start]);

  useEffect(() => () => {
    playingRef.current = false;
    void stopSpeaking();
    void workEnded('speech');
    document.querySelectorAll('.bk[data-speaking]').forEach((el) => el.removeAttribute('data-speaking'));
  }, []);

  const jump = (d: 1 | -1) => {
    const cur = items.current[at.current];
    if (!cur) return;
    // The start of the next or previous sentence.
    let i = at.current;
    const sameSentence = (a: Item, b: Item) => a.id.split(':').slice(0, 2).join() === b.id.split(':').slice(0, 2).join();
    if (d === 1) while (i < items.current.length - 1 && sameSentence(items.current[i], cur)) i++;
    else i = Math.max(0, i - 1);
    const target = items.current[i];
    void start(target.section, target.block);
  };

  return (
    <div className="listen" role="region" aria-label="Reading aloud">
      <div className="listen-main">
        <button className="icon-btn" onClick={() => jump(-1)} aria-label="Back a sentence"><Icon name="back" /></button>
        <button className="listen-play" onClick={() => (playing ? void pause() : void (async () => {
          const saved = (await db.settings.get(`speech:${book.id}`))?.value as { section: number; block: number } | undefined;
          const p = saved && !items.current.length ? saved : place.current;
          void start(p.section, p.block);
        })())} aria-label={playing ? 'Pause' : 'Read aloud'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="icon-btn" onClick={() => jump(1)} aria-label="Next sentence"><Icon name="forward" /></button>
        <button className="icon-btn" onClick={() => void pause().then(onClose)} aria-label="Stop reading aloud"><Icon name="close" /></button>
      </div>
      <div className="listen-opts">
        <div className="seg" role="group" aria-label="What to read">
          {(['en', 'orig', 'both'] as const).map((s) => (
            <button key={s} aria-pressed={source === s} onClick={() => setSource(s)}>{s === 'en' ? 'English' : s === 'orig' ? 'Original' : 'Both'}</button>
          ))}
        </div>
        <label className="listen-rate">
          <span className="small muted">Speed {rate.toFixed(1)}×</span>
          <input type="range" min={0.6} max={1.8} step={0.1} value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Reading speed" />
        </label>
        <div className="seg" role="group" aria-label="Sleep timer">
          {SLEEP.map((m) => (
            <button key={m} aria-pressed={sleep === m} onClick={() => setSleep(m)}>{m ? `${m} min` : 'No timer'}</button>
          ))}
        </div>
      </div>
      {error && <p className="small" role="alert" style={{ color: 'var(--rubric)' }}>{error}</p>}
    </div>
  );
}
