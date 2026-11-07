/**
 * The hand drawer's entrance and exit (docs/plans/2026-11-04-glass-polish-design.md, section 9, "Overlays and modals"): the choreography is motion.ts's
 * (`overlay`); this plays it on an element that stays on the page and is React's own, so it is not a `motion` element: the drawer is never unmounted,
 * only hidden, and holds itself shown and inert until the exit ends. (Overlays, floats and modals are layers.tsx's, under `Layers`.)
 *
 * When an animation ends, the inline properties it wrote are removed, so the element rests on its stylesheet alone (a `filter` left on makes
 * an element the containing block of the glass's fixed smoke and overlays). Nothing here reads a response: every duration is the feel's.
 */
import { animate } from 'motion/react';
import type { TargetAndTransition, Transition } from 'motion/react';
import type { MotionProps } from './motion.ts';

type Values = Record<string, unknown>;

const split = (t: unknown) => {
  const { transition, transitionEnd: _end, ...values } = (t ?? {}) as TargetAndTransition & { transitionEnd?: unknown };
  return { values: values as Values, transition: transition as Transition | undefined };
};

/** The css property a Motion key writes. */
const cssOf = (k: string) => (k === 'x' || k === 'y' || k === 'scale' ? 'transform' : k === 'clipPath' ? 'clip-path' : k === 'transformOrigin' ? 'transform-origin' : k);

function clear(el: HTMLElement, keys: Iterable<string>) {
  for (const k of keys) el.style.removeProperty(cssOf(k));
}

/** Plays `p`'s entrance on `el`, from `initial` to `animate`. */
export function playIn(el: HTMLElement, p: MotionProps): void {
  if (!p.initial || !p.animate || typeof p.initial === 'string' || typeof p.animate === 'string') return;
  const from = split(p.initial).values;
  const { values: to, transition } = split(p.animate);
  const { transformOrigin, ...rest } = to;
  if (typeof transformOrigin === 'string') el.style.transformOrigin = transformOrigin;
  const frames = Object.fromEntries(Object.keys(rest).map((k) => [k, [from[k] ?? rest[k], rest[k]]]));
  const done = () => clear(el, Object.keys(to));
  try { animate(el, frames as never, transition as never).then(done, done); } catch { done(); }
}

/** Plays `p`'s exit on `el` (from wherever it stands) and calls `end` when it is over. */
export function playOut(el: HTMLElement, p: MotionProps, end: () => void): void {
  if (!p.exit || typeof p.exit === 'string') return end();
  const { values, transition } = split(p.exit);
  const { transformOrigin, ...rest } = values;
  if (typeof transformOrigin === 'string') el.style.transformOrigin = transformOrigin;
  const over = () => { clear(el, Object.keys(values)); end(); };
  try { animate(el, rest as never, transition as never).then(over, over); } catch { over(); }
}
