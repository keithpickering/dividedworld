/**
 * The hand drawer's entrance and exit (docs/plans/2026-11-04-glass-polish-design.md, section 9, "Overlays and modals"): the choreography is motion.ts's
 * (`overlay`); this plays it on an element that stays on the page and is React's own, so it is not a `motion` element: the drawer is never unmounted,
 * only hidden, and holds itself shown and inert until the exit ends. (Overlays, floats and modals are layers.tsx's, under `Layers`.)
 *
 * When an animation ends, the inline properties it wrote are removed, so the element rests on its stylesheet alone (a `filter` left on makes
 * an element the containing block of the glass's fixed smoke and overlays). Motion writes the final values inline on its next frame's
 * render, after the animation's promise settles, so the clear waits for that render (`frame.postRender`): cleared at the promise, Smooth's
 * entrance left `opacity: 1; filter: blur(0px); transform: none` on the drawer. Nothing here reads a response: every duration is the feel's.
 */
import { animate, frame } from 'motion/react';
import type { TargetAndTransition, Transition } from 'motion/react';
import type { MotionProps } from './motion.ts';

type Values = Record<string, unknown>;

const split = (t: unknown) => {
  const { transition, transitionEnd: _end, ...values } = (t ?? {}) as TargetAndTransition & { transitionEnd?: unknown };
  return { values: values as Values, transition: transition as Transition | undefined };
};

/**
 * The css property a Motion key writes: a transform shorthand is `transform`, and any other camelCase key is its css name
 * (`maskImage` is `mask-image`, `WebkitMaskImage` is `-webkit-mask-image`), since removeProperty reads only that. A key left in
 * camelCase removes nothing, and Snappy's wipe mask stayed on the hand drawer, cutting its fan off at the drawer's top.
 */
const cssOf = (k: string) => (k === 'x' || k === 'y' || k === 'scale' ? 'transform' : k.replace(/^Webkit/u, '-webkit').replace(/[A-Z]/gu, (c) => `-${c.toLowerCase()}`));

function clear(el: HTMLElement, keys: Iterable<string>) {
  for (const k of keys) el.style.removeProperty(cssOf(k));
}

/** Stops a run: it neither clears the element nor ends anything when its animation settles. */
export type Stop = () => void;
const NOTHING: Stop = () => {};

/** Plays `p`'s entrance on `el`, from `initial` to `animate`. Returns the run's stop. */
export function playIn(el: HTMLElement, p: MotionProps): Stop {
  if (!p.initial || !p.animate || typeof p.initial === 'string' || typeof p.animate === 'string') return NOTHING;
  const from = split(p.initial).values;
  const { values: to, transition } = split(p.animate);
  const { transformOrigin, ...rest } = to;
  if (typeof transformOrigin === 'string') el.style.transformOrigin = transformOrigin;
  const frames = Object.fromEntries(Object.keys(rest).map((k) => [k, [from[k] ?? rest[k], rest[k]]]));
  let stopped = false;
  const done = () => { if (!stopped) frame.postRender(() => { if (!stopped) clear(el, Object.keys(to)); }); };
  try {
    const a = animate(el, frames as never, transition as never);
    a.then(done, done);
    return () => { stopped = true; a.stop(); };
  } catch { done(); return NOTHING; }
}

/** Plays `p`'s exit on `el` (from wherever it stands) and calls `end` when it is over, unless the run was stopped first. Returns the run's stop. */
export function playOut(el: HTMLElement, p: MotionProps, end: () => void): Stop {
  if (!p.exit || typeof p.exit === 'string') { end(); return NOTHING; }
  const { values, transition } = split(p.exit);
  const { transformOrigin, ...rest } = values;
  if (typeof transformOrigin === 'string') el.style.transformOrigin = transformOrigin;
  let stopped = false;
  const over = () => { if (!stopped) frame.postRender(() => { if (stopped) return; clear(el, Object.keys(values)); end(); }); };
  try {
    const a = animate(el, rest as never, transition as never);
    a.then(over, over);
    return () => { stopped = true; a.stop(); };
  } catch { over(); return NOTHING; }
}
