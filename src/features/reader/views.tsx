import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Book, Section } from '../../db/types';
import { isRtl } from '../../lib/arabic';
import { clamp } from '../../lib/util';

export interface Target {
  section: number;
  block: number;
  /** Changes on every request, so asking for the same place twice still moves. */
  nonce: number;
}

export interface ViewProps {
  book: Book;
  target: Target;
  /** Sections loaded so far. */
  get: (idx: number) => Section | undefined;
  load: (idxs: number[]) => void;
  /** Bumps whenever a section finishes loading. */
  version: number;
  /** Changes when type settings change and the text must be measured again. */
  layoutKey: string;
  justify: boolean;
  renderSection: (section: Section) => ReactNode;
  onPosition: (section: number, block: number) => void;
  onTap: () => void;
  onUserMove: () => void;
  /** Scrolling back up brings the reading bars back. */
  onReveal?: () => void;
}

const INTERACTIVE = 'button, a, input, textarea, .fn, .hl, .qref, .ayah, img, canvas, [role="button"], [data-flip]';
/** A tap this close to the top of the screen always shows the reading bars. */
const TOP_ZONE = 96;
const hasSelection = () => !(window.getSelection()?.isCollapsed ?? true);

/** How many sections the scroll view keeps laid out at once. */
const WINDOW = 4;

/** Continuous scrolling: chapters are added below and above as the reader approaches them. */
export function ScrollView({ book, target, get, load, version, layoutKey, justify, renderSection, onPosition, onTap, onUserMove, onReveal }: ViewProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<[number, number]>([target.section, target.section]);
  const pending = useRef<Target | null>(target);
  const anchor = useRef<{ s: number; b: number; top: number } | null>(null);
  const [tick, setTick] = useState(0);
  const last = book.sectionCount - 1;
  const raf = useRef(0);
  const settled = useRef(false);

  useEffect(() => {
    pending.current = target;
    settled.current = false;
    setRange((r) => (target.section >= r[0] && target.section <= r[1] ? r : [target.section, target.section]));
    setTick((t) => t + 1);
  }, [target]);

  // The chapters either side are fetched ahead, so they are only ever added fully formed.
  useEffect(() => {
    const ids: number[] = [];
    for (let i = range[0] - 1; i <= range[1] + 1; i++) ids.push(i);
    load(ids);
  }, [range, load]);

  const topBlock = useCallback((): HTMLElement | null => {
    const el = scroller.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(el).paddingTop) || 0;
    for (const dy of [8, 40, 90, 160]) {
      for (const hit of document.elementsFromPoint(r.left + r.width / 2, r.top + pad + dy)) {
        const block = hit.closest?.('[data-b]') as HTMLElement | null;
        if (block && el.contains(block)) return block;
      }
    }
    return el.querySelector('[data-b]');
  }, []);

  const holdPlace = useCallback(() => {
    const b = topBlock();
    if (b) anchor.current = { s: Number(b.dataset.s), b: Number(b.dataset.b), top: b.getBoundingClientRect().top };
  }, [topBlock]);

  const allLoaded = useCallback(() => {
    for (let i = range[0]; i <= range[1]; i++) if (!get(i)) return false;
    return true;
  }, [range, get]);

  /** Adds the next or previous chapter when the reader is close to the edge of what is laid out. */
  const extend = useCallback(() => {
    const el = scroller.current;
    if (!el || pending.current || !allLoaded()) return;
    const below = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (below < 1500 && range[1] < last && get(range[1] + 1)) {
      holdPlace();
      setRange(([a, b]) => [b + 1 - a >= WINDOW ? a + 1 : a, b + 1]);
    } else if (el.scrollTop < 700 && range[0] > 0 && get(range[0] - 1)) {
      holdPlace();
      setRange(([a, b]) => [a - 1, b - a + 1 >= WINDOW ? b - 1 : b]);
    }
  }, [allLoaded, holdPlace, last, range, get]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const find = (s: number, b: number) => {
      const exact = el.querySelector<HTMLElement>(`[data-s="${s}"][data-b="${b}"]`);
      if (exact) return exact;
      const shown = Array.from(el.querySelectorAll<HTMLElement>(`[data-s="${s}"][data-b]`));
      return shown.find((n) => Number(n.dataset.b) >= b) ?? shown[shown.length - 1] ?? null;
    };
    if (pending.current) {
      const t = pending.current;
      const sec = get(t.section);
      if (!sec) return;
      const node = find(t.section, clamp(t.block, 0, Math.max(0, sec.blocks.length - 1)));
      if (node) {
        // At the head of a chapter, its very top shows (the note on its English included).
        const head = t.block <= 0 ? el.querySelector<HTMLElement>(`section[data-section="${t.section}"]`) : null;
        (head ?? node).scrollIntoView({ block: 'start' });
        pending.current = null;
        anchor.current = null;
        settled.current = true;
      }
    } else if (anchor.current) {
      const a = anchor.current;
      const node = find(a.s, a.b);
      if (node) el.scrollTop += node.getBoundingClientRect().top - a.top;
      anchor.current = null;
    }
    extend();
  }, [range, tick, version, get, extend]);

  // A change of type size or margins reflows everything: keep the same paragraph in view.
  const firstLayout = useRef(true);
  useLayoutEffect(() => {
    if (firstLayout.current) {
      firstLayout.current = false;
      return;
    }
    const b = topBlock();
    if (b) b.scrollIntoView({ block: 'start' });
  }, [layoutKey, topBlock]);

  // The controls tuck away as the reader scrolls on, and come back as soon as they scroll
  // back up a little (or reach the top): measured over the whole movement, not one event.
  const lastTop = useRef(0);
  const turnedAt = useRef(0);
  const goingUp = useRef(false);
  /** When the reader last moved the page themselves (the app's own scrolling never hides anything). */
  const touchedAt = useRef(0);
  const touched = () => void (touchedAt.current = Date.now());
  const onScroll = () => {
    const el = scroller.current;
    if (el) {
      const top = el.scrollTop;
      const up = top < lastTop.current;
      if (up !== goingUp.current) {
        goingUp.current = up;
        turnedAt.current = lastTop.current;
      }
      if (up && (turnedAt.current - top > 36 || top < 24)) onReveal?.();
      if (!up && top - turnedAt.current > 24 && Date.now() - touchedAt.current < 900) onUserMove();
      lastTop.current = top;
    }
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      if (pending.current || !settled.current) return;
      const b = topBlock();
      if (b) onPosition(Number(b.dataset.s), Number(b.dataset.b));
      extend();
    });
  };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // Volume keys (and other page-turn requests) move by most of a screen.
  useEffect(() => {
    const onTurn = (e: Event) => {
      const el = scroller.current;
      if (!el) return;
      const dir = (e as CustomEvent<number>).detail;
      el.scrollBy({ top: dir * el.clientHeight * 0.86, behavior: 'smooth' });
      onUserMove();
    };
    window.addEventListener('maktaba:turn', onTurn);
    return () => window.removeEventListener('maktaba:turn', onTurn);
  }, [onUserMove]);

  const sections: ReactNode[] = [];
  for (let i = range[0]; i <= range[1]; i++) {
    const sec = get(i);
    sections.push(
      sec ? (
        <section key={i} data-section={i}>
          {renderSection(sec)}
          {i < last && <div className="rd-section-end" aria-hidden="true">❖</div>}
        </section>
      ) : (
        <div key={i} style={{ minHeight: '70vh' }} aria-busy="true" />
      ),
    );
  }

  return (
    <div
      className="rd-scroll"
      ref={scroller}
      onScroll={onScroll}
      onTouchMove={touched}
      onWheel={touched}
      onKeyDown={touched}
      onClick={(e) => {
        if (hasSelection()) return;
        if (e.clientY < TOP_ZONE) return onTap();
        if ((e.target as Element).closest(INTERACTIVE)) return;
        onTap();
      }}
    >
      <div className="rd-col rd-text" data-justify={justify}>
        {sections}
        {range[1] === last && get(last) && <div className="rd-end">End of the book</div>}
      </div>
    </div>
  );
}

/** One screen at a time, turned by tapping the edges, swiping, or the arrow keys. */
export function PagedView({ book, target, get, load, version, layoutKey, justify, renderSection, onPosition, onTap, onUserMove }: ViewProps) {
  const frame = useRef<HTMLDivElement>(null);
  const cols = useRef<HTMLDivElement>(null);
  const [sec, setSec] = useState(target.section);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [fonts, setFonts] = useState(0);
  const want = useRef<{ block: number } | 'last' | null>({ block: target.block });
  const here = useRef(target.block);
  const rtl = isRtl(book.lang);
  const last = book.sectionCount - 1;
  const section = get(sec);

  useEffect(() => {
    want.current = { block: target.block };
    setSec(target.section);
    setFonts((n) => n + 1);
  }, [target]);

  useEffect(() => {
    load([sec, sec + 1, sec - 1].filter((i) => i >= 0 && i <= last));
  }, [sec, last, load]);

  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    void document.fonts?.ready.then(() => setFonts((n) => n + 1));
    return () => ro.disconnect();
  }, []);

  const pageOf = useCallback(
    (node: Element): number => {
      const c = cols.current;
      if (!c || !size.w) return 0;
      const r = node.getBoundingClientRect();
      const box = c.getBoundingClientRect();
      const offset = rtl ? box.right - r.right : r.left - box.left;
      return Math.max(0, Math.floor((offset + 1) / size.w));
    },
    [rtl, size.w],
  );

  // Measure the laid-out columns and settle on the right page.
  useLayoutEffect(() => {
    const c = cols.current;
    if (!c || !section || !size.w) return;
    const end = c.querySelector('[data-end]');
    const total = end ? pageOf(end) + 1 : 1;
    let next: number;
    if (want.current === 'last') next = total - 1;
    else {
      const block = want.current ? want.current.block : here.current;
      const target = clamp(block, 0, Math.max(0, section.blocks.length - 1));
      const shown = Array.from(c.querySelectorAll<HTMLElement>('[data-b]'));
      const node = shown.find((n) => Number(n.dataset.b) >= target) ?? shown[shown.length - 1];
      next = node ? pageOf(node) : 0;
    }
    want.current = null;
    setPages(total);
    setPage(clamp(next, 0, total - 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, size.w, size.h, layoutKey, fonts, version === 0]);

  // Tell the reader where we are: the first paragraph that starts on this page.
  useEffect(() => {
    const c = cols.current;
    if (!c || !section || !size.w || want.current) return;
    let spanning = -1;
    let found = -1;
    for (const node of Array.from(c.querySelectorAll<HTMLElement>('[data-b]'))) {
      const p = pageOf(node);
      if (p === page) {
        found = Number(node.dataset.b);
        break;
      }
      if (p < page) spanning = Number(node.dataset.b);
      else break;
    }
    const block = found >= 0 ? found : Math.max(0, spanning);
    here.current = block;
    onPosition(sec, block);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pages, sec, section, size.w]);

  const turn = useCallback(
    (dir: 1 | -1) => {
      onUserMove();
      if (dir === 1) {
        if (page < pages - 1) setPage(page + 1);
        else if (sec < last) {
          want.current = { block: 0 };
          here.current = 0;
          setPage(0);
          setSec(sec + 1);
        }
      } else if (page > 0) setPage(page - 1);
      else if (sec > 0) {
        want.current = 'last';
        setSec(sec - 1);
      }
    },
    [page, pages, sec, last, onUserMove],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest?.('input, textarea, [role="dialog"]')) return;
      if (e.key === 'ArrowRight') turn(rtl ? -1 : 1);
      else if (e.key === 'ArrowLeft') turn(rtl ? 1 : -1);
      else if (e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); turn(1); }
      else if (e.key === 'PageUp') { e.preventDefault(); turn(-1); }
    };
    const onTurn = (e: Event) => turn((e as CustomEvent<number>).detail > 0 ? 1 : -1);
    window.addEventListener('keydown', onKey);
    window.addEventListener('maktaba:turn', onTurn);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('maktaba:turn', onTurn);
    };
  }, [turn, rtl]);

  const drag = useRef<{ x: number; y: number; dx: number; active: boolean; t: number; v: number } | null>(null);
  const swiped = useRef(false);
  const base = (rtl ? 1 : -1) * page * size.w;
  const setDrag = (dx: number, dragging: boolean) => {
    const c = cols.current;
    if (!c) return;
    c.dataset.dragging = String(dragging);
    c.style.transform = `translateX(${base + dx}px)`;
  };

  return (
    <div
      className="pg"
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        drag.current = { x: e.clientX, y: e.clientY, dx: 0, active: false, t: e.timeStamp, v: 0 };
        swiped.current = false;
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || hasSelection()) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.active && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.3) d.active = true;
        if (d.active) {
          // Speed of the finger, smoothed, so a quick flick turns the page as a long drag does.
          const dt = Math.max(1, e.timeStamp - d.t);
          d.v = 0.7 * ((dx - d.dx) / dt) + 0.3 * d.v;
          d.t = e.timeStamp;
          d.dx = dx;
          setDrag(dx, true);
        }
      }}
      onPointerUp={() => {
        const d = drag.current;
        drag.current = null;
        if (!d?.active) return;
        swiped.current = true;
        setDrag(0, false);
        const flick = Math.abs(d.v) > 0.45 && Math.abs(d.dx) > 24 && Math.sign(d.v) === Math.sign(d.dx);
        if (flick || Math.abs(d.dx) > Math.min(90, size.w * 0.18)) {
          const forward = rtl ? d.dx > 0 : d.dx < 0;
          turn(forward ? 1 : -1);
        }
      }}
      onPointerCancel={() => {
        if (drag.current?.active) setDrag(0, false);
        drag.current = null;
      }}
      onClick={(e) => {
        if (swiped.current) {
          swiped.current = false;
          return;
        }
        if (hasSelection()) return;
        if (e.clientY < TOP_ZONE) return onTap();
        const x = e.clientX / window.innerWidth;
        if (x >= 0.27 && x <= 0.73 && (e.target as Element).closest(INTERACTIVE)) return;
        if (x < 0.27) turn(rtl ? 1 : -1);
        else if (x > 0.73) turn(rtl ? -1 : 1);
        else onTap();
      }}
    >
      <div className="pg-frame" ref={frame} style={{ ['--pg-w' as string]: `${size.w}px`, ['--pg-h' as string]: `${size.h}px` }}>
        {section && size.w > 0 ? (
          <div
            key={sec}
            ref={cols}
            className="pg-cols rd-text"
            data-justify={justify}
            dir={rtl ? 'rtl' : 'ltr'}
            style={{ transform: `translateX(${base}px)` }}
          >
            {renderSection(section)}
            {sec === last && <div className="rd-end">End of the book</div>}
            <span data-end style={{ display: 'block', height: 1 }} />
          </div>
        ) : (
          <div aria-busy="true" />
        )}
      </div>
      <div className="pg-foot" aria-hidden="true">{pages > 1 ? `${page + 1} / ${pages}` : ''}</div>
    </div>
  );
}
