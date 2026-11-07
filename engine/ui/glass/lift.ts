/**
 * What an overlay, a float, a modal and the hand drawer do to enter and leave (docs/plans/2026-11-04-glass-polish-design.md, section 9,
 * "Overlays and modals"): the choreography is motion.ts's (`overlay`, `modal`, `backdrop`); this plays it on an element that is not a
 * `motion` element, because these are rendered by callers as `{open && <Overlay />}` and are gone from React the moment the caller says so.
 *
 * Entering plays the preset's `initial` -> `animate` on the element. Leaving cannot be played on the element React is removing, so the
 * element is copied just before it goes (`ghost`): the copy stands where it did, `inert` and `aria-hidden` from the first frame (so no
 * keyboard, reader or test finds two of anything), carries no ids, plays the preset's `exit` and removes itself when it ends. The live
 * element's own effects (focus back to the opener, the page behind made live again) run at once, at the start of the close.
 *
 * Under Off the feel is `null`, the presets are `{}`, and nothing here plays: an entrance has nothing to run and a close leaves no copy.
 * Nothing here reads a response: every duration is the feel's.
 *
 * When an animation ends, the inline properties it wrote are removed, so the element rests on its stylesheet alone (a `filter` left on makes
 * an element the containing block of the glass's fixed smoke and overlays).
 */
import { animate } from 'motion/react';
import type { TargetAndTransition, Transition } from 'motion/react';
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { backdrop, modal, overlay, useFeel, type ActiveFeel, type MotionProps } from './motion.ts';
import type { GlassMotion } from '../types.ts';

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

/** The longest an exit may take before the copy is removed anyway (a page that was hidden holds the animation frame). */
const SAFETY_MS = 1500;

/**
 * Leaves a copy of `node` in its place, inert, that plays each part's exit and goes. `parts` name what moves: the root (`''`) or a selector
 * inside the copy, each with its preset. Called in the cleanup of the effect that owns the element, while it is still in the page.
 */
export function ghost(node: HTMLElement | null, parts: ReadonlyArray<readonly [selector: string, p: MotionProps]>): void {
  if (!node || !node.isConnected || !node.parentNode) return;
  const copy = node.cloneNode(true) as HTMLElement;
  for (const el of [copy, ...copy.querySelectorAll<HTMLElement>('[id]')]) el.removeAttribute('id');
  copy.setAttribute('inert', '');
  copy.setAttribute('aria-hidden', 'true');
  copy.setAttribute('data-kb-exiting', '');
  node.parentNode.insertBefore(copy, node);
  let left = parts.length;
  const gone = () => { if (--left <= 0) copy.remove(); };
  if (left === 0) return copy.remove();
  const timer = setTimeout(() => copy.remove(), SAFETY_MS);
  const end = () => { clearTimeout(timer); gone(); };
  for (const [selector, p] of parts) {
    const el = selector === '' ? copy : copy.querySelector<HTMLElement>(selector);
    if (el) playOut(el, p, end); else end();
  }
}

/**
 * The entrance and the exit of a dialog layer: `root` is the dimmed layer (its fade is `backdrop`), `box` is the dialog (`overlay` from
 * `anchor` where it has one, else centered; or `modal`). Enters in a layout effect declared after the caller's placement, so the anchor's
 * place is known. Leaves a copy when it unmounts. `kind` is fixed for a layer's life.
 */
export function useLift(
  { root, box, kind, anchor, overrides, rootOnly = false }: {
    readonly root: RefObject<HTMLElement | null>;
    readonly box: RefObject<HTMLElement | null>;
    readonly kind: 'overlay' | 'modal';
    readonly anchor?: RefObject<HTMLElement | null>;
    readonly overrides?: GlassMotion;
    /** A float has no dim: its `root` is its glow wrapper, left as it is, and `box` is what moves. */
    readonly rootOnly?: boolean;
  },
): void {
  const feel = useFeel(overrides);
  const live = useRef(feel);
  live.current = feel;
  const preset = (f: ActiveFeel, origin?: { x: number; y: number }) => (kind === 'modal' ? modal(f) : overlay(f, origin));
  const originOf = (): { x: number; y: number } | undefined => {
    const a = anchor?.current?.getBoundingClientRect();
    const b = box.current?.getBoundingClientRect();
    return a && b && (a.width > 0 || a.height > 0) ? { x: a.left + a.width / 2 - b.left, y: a.top + a.height / 2 - b.top } : undefined;
  };
  useLayoutEffect(() => {
    const f = live.current;
    if (!f) return;
    if (!rootOnly && root.current) playIn(root.current, backdrop(f));
    if (box.current) playIn(box.current, preset(f, originOf()));
    return () => {
      const g = live.current;
      if (!g) return;
      ghost(root.current, [...(rootOnly ? [] : [['', backdrop(g)] as const]), ['[data-kb-lift]', preset(g, originOf())]]);
    };
  // The layer's life: it enters once and leaves once.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
