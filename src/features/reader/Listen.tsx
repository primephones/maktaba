import { useCallback, useEffect, useRef, useState } from 'react';
import { db, sectionId } from '../../db/db';
import type { Book, Translation } from '../../db/types';
import { getFixes, onSpeech, piecesOf, sentences, speakPiece, stopSpeaking, type Piece } from '../../speech/speech';
import { workBegan, workEnded } from '../../native/work';
import { native } from '../../native/maktaba';
import { Icon } from '../../ui/Icon';

interface Item {
  id: string;
  section: number;
  block: number;
  piece: Piece;
  /** The whole sentence the piece is from, to light it on the page. */
  sentence?: string;
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
          for (const piece of piecesOf(sentence, l, fixes)) items.push({ id: `${s}:${i}:${items.length}`, section: s, block: i, piece, sentence });
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
  /** The reader follows along: in page mode it turns to the paragraph being read. */
  onPlace?: (section: number, block: number) => void;
}

/** Where a sentence is inside a paragraph on screen, as a range of its text. */
function rangeOf(el: Element, sentence: string): Range | null {
  const want = sentence.replace(/†/g, '').replace(/\s+/g, ' ').trim();
  if (want.length < 2) return null;
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  let hay = '';
  const at: Array<{ node: Text; offset: number }> = [];
  for (const node of nodes) {
    for (let i = 0; i < node.data.length; i++) {
      const ch = node.data[i];
      if (/\s/.test(ch) && hay.endsWith(' ')) continue;
      hay += /\s/.test(ch) ? ' ' : ch;
      at.push({ node, offset: i });
    }
  }
  const start = hay.indexOf(want.slice(0, 40));
  if (start < 0) return null;
  const end = Math.min(at.length - 1, start + want.length - 1);
  const r = document.createRange();
  r.setStart(at[start].node, at[start].offset);
  r.setEnd(at[end].node, at[end].offset + 1);
  return r;
}

type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void };
const highlights = (): HighlightRegistry | null => ((globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights ?? null);
const HighlightCtor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;

/** The reading-aloud bar: play, pause, sentence by sentence, speed, sleep timer. */
export function Listen({ book, from, translations, defaultSource, onClose, onPlace }: Props) {
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
    highlights()?.delete('speaking');
    if (!it) return;
    const moved = place.current.section !== it.section || place.current.block !== it.block;
    // The English is read from its own paragraph, the original from its own.
    const sel = it.piece.lang === 'en' ? `.bk--en[data-s="${it.section}"][data-b="${it.block}"]` : `.bk:not(.bk--en)[data-s="${it.section}"][data-b="${it.block}"]`;
    const el = document.querySelector(sel) ?? document.querySelector(`.bk[data-s="${it.section}"][data-b="${it.block}"]`);
    el?.setAttribute('data-speaking', '');
    // The sentence being said, lit within its paragraph, where the browser can.
    const r = el && HighlightCtor ? rangeOf(el, sentenceOf(it)) : null;
    if (r && HighlightCtor) highlights()?.set('speaking', new HighlightCtor(r));
    if (moved) {
      if (onPlace) onPlace(it.section, it.block);
      else el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    place.current = { section: it.section, block: it.block };
    void showControls(true, it);
  };

  /** The whole sentence a piece belongs to (an Arabic term in English is a piece of its own). */
  const sentenceOf = (it: Item) => it.sentence ?? it.piece.text;

  /** Play, pause and skip on the lock screen and in the notification shade. */
  const showControls = async (playing: boolean, it?: Item) => {
    const text = (it ? sentenceOf(it) : '').slice(0, 120);
    const title = book.titleEn || book.title;
    void native.call('mediaShow', { title, text, playing });
    const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
    if (ms && typeof MediaMetadata !== 'undefined') {
      ms.metadata = new MediaMetadata({ title, artist: text });
      ms.playbackState = playing ? 'playing' : 'paused';
    }
  };

  /**
   * Keeps pieces queued, so speech runs on without gaps: two while the book is on screen,
   * many with the screen off (the app may then be held back, but the voice is not).
   */
  const feed = useCallback(async () => {
    const ahead = document.visibilityState === 'hidden' ? 40 : 1;
    while (playingRef.current && sent.current < at.current + ahead && sent.current + 1 < items.current.length) {
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
    void showControls(false, items.current[at.current]);
    await db.settings.put({ key: `speech:${book.id}`, value: place.current });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id]);

  // With the screen off, more is queued at once so the voice carries on.
  useEffect(() => {
    const on = () => {
      if (document.visibilityState === 'hidden' && playingRef.current) void feed();
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [feed]);

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
    void native.call('mediaHide');
    highlights()?.delete('speaking');
    document.querySelectorAll('.bk[data-speaking]').forEach((el) => el.removeAttribute('data-speaking'));
  }, []);

  // The buttons on the lock screen, in the notification and on headphones.
  const actions = useRef<Record<string, () => void>>({});
  useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    void native.on('media', (e) => actions.current[e.action]?.()).then((stop) => {
      if (alive) off = stop;
      else stop();
    });
    const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
    if (ms) {
      for (const a of ['play', 'pause', 'nexttrack', 'previoustrack', 'stop'] as const) {
        try {
          ms.setActionHandler(a, () => actions.current[a === 'nexttrack' ? 'next' : a === 'previoustrack' ? 'previous' : a]?.());
        } catch {
          /* not offered */
        }
      }
    }
    return () => {
      alive = false;
      off?.();
    };
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

  const resume = () =>
    void (async () => {
      const saved = (await db.settings.get(`speech:${book.id}`))?.value as { section: number; block: number } | undefined;
      const p = saved && !items.current.length ? saved : place.current;
      void start(p.section, p.block);
    })();
  actions.current = {
    play: () => !playingRef.current && resume(),
    pause: () => void pause(),
    next: () => jump(1),
    previous: () => jump(-1),
    stop: () => void pause().then(onClose),
  };

  return (
    <div className="listen" role="region" aria-label="Reading aloud">
      <div className="listen-main">
        <button className="icon-btn" onClick={() => jump(-1)} aria-label="Back a sentence"><Icon name="back" /></button>
        <button className="listen-play" onClick={() => (playing ? void pause() : resume())} aria-label={playing ? 'Pause' : 'Read aloud'}>
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
