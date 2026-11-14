/**
 * The state of a post's row for this reader, and the press that changes it, given to a card that folds the row
 * (`CardUi.foldsRow`; `EffectProps.fold`). Null where a post is drawn with no row of its own.
 */
import { animate, motionValue, type MotionValue } from 'motion/react';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useFeel } from '../glass/motion.ts';

export interface RowFold { readonly open: boolean; readonly toggle: () => void }

export const RowFoldCtx = createContext<RowFold | null>(null);

export const useRowFold = (): RowFold | null => useContext(RowFoldCtx);

/** The grid's rotateX when the row is shut, in degrees. */
const SHUT = -88;

/** Whether this browser can run the motion (jsdom, and a browser with no Web Animations, take the reduced path). */
const canAnimate = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

interface Run { readonly height: MotionValue<number>; readonly turn: MotionValue<number>; readonly shade: MotionValue<number>; readonly stop: () => void }

/**
 * The newspaper unfold: a folded post's row (`grid`) swings open from under its bar, and swings shut again. There is no wrapper (one that came and went
 * with the fold would change the grid's parent and remount every cell), so the motion runs on the elements that are always there: the article
 * (`data-kb-fold-moving` while it runs, which gives it a perspective) and the grid (its height, rotateX and the shade `--kb-fold-shade` its `::after` reads).
 * A press during a motion reverses it from the values it has reached. At the end every inline value and the mark are removed, so nothing is left on at rest
 * (a transform would make the grid the containing block of a fixed Lens or popover inside it). Where the feel is Off or the browser cannot animate, the
 * grid is shown or hidden at the press. `open` is the state at once; the motion never delays it.
 *
 * `active` is whether the post wears a fold at all; the effect runs only on a change of `open` while it does, so a bar appearing or going away
 * (a play landing or being ended) moves nothing. Re-renders do not touch `hidden`, which React sets from `open`: the motion keeps the grid shown until
 * a fold ends, and sets `hidden` itself then.
 */
export function useFoldMotion(open: boolean, active: boolean, grid: RefObject<HTMLElement | null>, article: RefObject<HTMLElement | null>): void {
  const feel = useFeel();
  const feelRef = useRef(feel);
  feelRef.current = feel;
  const prev = useRef<boolean | null>(null);
  const run = useRef<Run | null>(null);
  /* Stops the motion that is running and clears everything it wrote. */
  const settle = () => {
    run.current?.stop();
    run.current = null;
    const g = grid.current;
    if (g) { g.style.removeProperty('height'); g.style.removeProperty('transform'); g.style.removeProperty('--kb-fold-shade'); }
    article.current?.removeAttribute('data-kb-fold-moving');
  };
  useLayoutEffect(() => {
    const g = grid.current;
    const a = article.current;
    const was = prev.current;
    prev.current = active ? open : null;
    if (!g || !a) return;
    if (!active) { settle(); if (was !== null) g.hidden = false; return; }
    if (was === null || was === open) return;
    if (!feelRef.current || !canAnimate()) { settle(); g.hidden = !open; return; }
    const before = run.current;
    const from = before ? { h: before.height.get(), r: before.turn.get(), s: before.shade.get() } : null;
    before?.stop();
    g.hidden = false;
    const natural = (): number => {
      const kept = g.style.height;
      g.style.height = '';
      const h = g.offsetHeight;
      g.style.height = kept;
      return h;
    };
    const start = from ?? (open ? { h: 0, r: SHUT, s: 1 } : { h: natural(), r: 0, s: 0 });
    const height = motionValue(start.h);
    const turn = motionValue(start.r);
    const shade = motionValue(start.s);
    const write = () => {
      g.style.height = `${height.get()}px`;
      g.style.transform = `rotateX(${turn.get()}deg)`;
      g.style.setProperty('--kb-fold-shade', String(shade.get()));
    };
    const offs = [height, turn, shade].map((v) => v.on('change', write));
    write();
    a.setAttribute('data-kb-fold-moving', '');
    const target = open ? natural() : 0;
    const ease = open ? ([0.2, 0.8, 0.2, 1] as const) : ([0.55, 0, 0.75, 0.2] as const);
    const duration = open ? 0.56 : 0.38;
    const runs = [
      animate(height, target, { duration, ease: [...ease] }),
      open ? animate(turn, 0, { type: 'spring', stiffness: 170, damping: 18 }) : animate(turn, SHUT, { duration, ease: [...ease] }),
      animate(shade, open ? 0 : 1, { duration, ease: [...ease] }),
    ];
    let stopped = false;
    const me: Run = { height, turn, shade, stop: () => { stopped = true; offs.forEach((off) => off()); runs.forEach((r) => r.stop()); } };
    run.current = me;
    const end = () => {
      if (stopped) return;
      me.stop();
      run.current = null;
      settle();
      if (!open) g.hidden = true;
    };
    Promise.all(runs).then(end, end);
  }, [open, active]);
  /* The post going away mid-motion stops it. */
  useEffect(() => () => { run.current?.stop(); run.current = null; }, []);
}
