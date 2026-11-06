/**
 * The glass's choreography, written once for both feels (docs/plans/2026-11-04-glass-polish-design.md,
 * section 9): what moves, in what order and which way. A feel is a set of tokens (motion-tokens.ts);
 * each preset is a pure function of (feel, args) returning Motion props (`initial`, `animate`, `exit`,
 * `transition`) for the `motion` package. Under Off the feel is `null` and every preset returns `{}`,
 * so a component spreads a preset with no branch of its own: `<motion.div {...screen(feel, 1)} />`.
 *
 * Smooth fades with a slight scale and a blur-in and never uses a clip-path. Snappy springs where a
 * thing lands and wipes with a clip-path whose edges are slanted by the glass's skew
 * (`--kb-glass-skew`, base.css), so a mask cuts along the same angle as the buttons.
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { TargetAndTransition, Transition } from 'motion/react';
import { motionReduced, subscribeMotion } from '../appearance.ts';
import type { Feel, FeelTokens, GlassMotion } from '../types.ts';
import { feelTokens } from './motion-tokens.ts';

export { DEFAULT_FEELS, FEELS, feelTokens } from './motion-tokens.ts';

/** What a preset returns: spread onto a `motion` element. Empty under Off. */
export interface MotionProps {
  readonly initial?: TargetAndTransition;
  readonly animate?: TargetAndTransition;
  readonly exit?: TargetAndTransition;
  readonly transition?: Transition;
}

/** The feel in force: the resolved feel's tokens (with the instance's overrides), or `null` under Off. */
export type ActiveFeel = (FeelTokens & { readonly name: Feel }) | null;

export interface Rect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** Which feel the root and the device ask for now, or 'off'. Follow my device is Smooth, or Off where the device reduces. */
export function currentFeel(doc: Document = document): Feel | 'off' {
  const root = doc.documentElement;
  if (root.getAttribute('data-kb-motion') === 'reduce') return 'off';
  if (root.getAttribute('data-kb-motion') !== 'full' && motionReduced(doc)) return 'off';
  return root.getAttribute('data-kb-motion-feel') === 'snappy' ? 'snappy' : 'smooth';
}

/** The feel in force, kept current as the root's marks and the device's setting change. `overrides` is the instance's `glass.motion`. */
export function useFeel(overrides?: GlassMotion): ActiveFeel {
  const name = useSyncExternalStore(subscribeMotion, () => currentFeel(), () => 'smooth' as const);
  return useMemo(() => (name === 'off' ? null : { name, ...feelTokens(name, overrides) }), [name, overrides]);
}

/** A feel's `ease` as the four numbers Motion takes. */
export function bezier(ease: string): [number, number, number, number] {
  const n = /cubic-bezier\(([^)]+)\)/.exec(ease)?.[1]?.split(',').map((x) => Number(x.trim()));
  if (!n || n.length !== 4 || n.some(Number.isNaN)) throw new Error(`not a cubic-bezier: ${ease}`);
  return [n[0]!, n[1]!, n[2]!, n[3]!];
}

const sec = (ms: number) => ms / 1000;

/** How a thing lands: the feel's spring where it has one, else its ease over `ms`. */
function landing(f: NonNullable<ActiveFeel>, ms: number, delay = 0): Transition {
  return f.spring
    ? { type: 'spring', stiffness: f.spring.stiffness, damping: f.spring.damping, delay }
    : { duration: sec(ms), ease: bezier(f.ease), delay };
}
/** How a thing leaves: eased over the feel's exit, never sprung, so an exit ends when it says. */
const leaving = (f: NonNullable<ActiveFeel>, ms = f.exit): Transition => ({ duration: sec(ms), ease: bezier(f.ease) });

/** Half the slant of an edge `h` px tall, by the glass's skew: a CSS length. */
const slant = (h: number | string) => `calc(tan(var(--kb-glass-skew)) * ${typeof h === 'number' ? `${h / 2}px` : h})`;

/**
 * A polygon that reveals everything left of a slanted vertical edge at `pct` of the width. Every
 * coordinate has the same `calc(N% + slant)` shape so Motion can interpolate two of them. -25 hides
 * all of it, 125 shows all of it, whatever the slant.
 */
export function wipe(pct: number): string {
  const s = slant('50vh');
  return `polygon(0% 0%, calc(${pct}% + ${s}) 0%, calc(${pct}% - ${s}) 100%, 0% 100%)`;
}
const WIPE_HIDDEN = wipe(-25);
const WIPE_SHOWN = wipe(125);

/** A slanted rectangle, px: the rect with its left and right edges leaning along the skew. */
export function slantedRect(r: Rect): string {
  const s = slant(r.height);
  const [l, t, rt, b] = [r.x, r.y, r.x + r.width, r.y + r.height];
  return `polygon(calc(${l}px + ${s}) ${t}px, calc(${rt}px + ${s}) ${t}px, calc(${rt}px - ${s}) ${b}px, calc(${l}px - ${s}) ${b}px)`;
}

const BLUR = (px: number) => `blur(${px}px)`;

/**
 * The crossing: the glass page's window opens from the HUD tab's rect (`from`) to the whole screen
 * (`within`), and the exit closes it back into the rect. Smooth grows it from the rect's center;
 * Snappy clips it from the slanted rect. Esc during either reverses it from where it is, which Motion
 * does when the element's `animate` flips back.
 */
export function crossing(feel: ActiveFeel, args: { readonly from: Rect; readonly within: { readonly width: number; readonly height: number } }): MotionProps {
  if (!feel) return {};
  const { from, within } = args;
  if (feel.mask === 'skew') {
    const closed = slantedRect(from);
    const open = slantedRect({ x: 0, y: 0, width: within.width, height: within.height });
    return {
      initial: { clipPath: closed, opacity: 0 },
      animate: { clipPath: open, opacity: 1, transition: landing(feel, feel.screen) },
      exit: { clipPath: closed, opacity: 0, transition: leaving(feel, feel.screen) },
    };
  }
  const origin = `${from.x + from.width / 2}px ${from.y + from.height / 2}px`;
  const closed = { opacity: 0, scale: Math.min(feel.scale, 0.9), filter: BLUR(feel.blur), transformOrigin: origin };
  return {
    initial: closed,
    animate: { opacity: 1, scale: 1, filter: BLUR(0), transformOrigin: origin, transition: landing(feel, feel.screen) },
    exit: { ...closed, transition: leaving(feel, feel.screen) },
  };
}

/**
 * A change between glass screens. `direction` is +1 when the tab chosen lies to the right of the one
 * being left: the outgoing content leaves toward the left, the new content enters from the right
 * (-1 the other way).
 */
export function screen(feel: ActiveFeel, direction: 1 | -1): MotionProps {
  if (!feel) return {};
  if (feel.mask === 'skew') {
    return {
      initial: { x: direction * feel.distance, clipPath: WIPE_HIDDEN },
      animate: { x: 0, clipPath: WIPE_SHOWN, transition: landing(feel, feel.screen) },
      exit: { x: -direction * feel.distance, opacity: 0, transition: leaving(feel, feel.screen) },
    };
  }
  return {
    initial: { x: direction * feel.distance, opacity: 0, scale: feel.scale, filter: BLUR(feel.blur) },
    animate: { x: 0, opacity: 1, scale: 1, filter: BLUR(0), transition: landing(feel, feel.screen) },
    exit: { x: -direction * feel.distance, opacity: 0, scale: feel.scale, filter: BLUR(feel.blur), transition: leaving(feel, feel.screen) },
  };
}

/** An overlay (Overlay, Float, the hand drawer): enters from its `anchor` (px from the element's own top-left), centered where none. */
export function overlay(feel: ActiveFeel, anchor?: { readonly x: number; readonly y: number }): MotionProps {
  if (!feel) return {};
  const transformOrigin = anchor ? `${anchor.x}px ${anchor.y}px` : '50% 50%';
  if (feel.mask === 'skew') {
    return {
      initial: { clipPath: WIPE_HIDDEN, y: feel.distance / 2, transformOrigin },
      animate: { clipPath: WIPE_SHOWN, y: 0, transformOrigin, transition: landing(feel, feel.enter) },
      exit: { clipPath: WIPE_HIDDEN, opacity: 0, transformOrigin, transition: leaving(feel) },
    };
  }
  return {
    initial: { opacity: 0, scale: feel.scale, filter: BLUR(feel.blur), transformOrigin },
    animate: { opacity: 1, scale: 1, filter: BLUR(0), transformOrigin, transition: landing(feel, feel.enter) },
    exit: { opacity: 0, scale: feel.scale, filter: BLUR(feel.blur), transformOrigin, transition: leaving(feel) },
  };
}

/** A modal: rises from below its place; the board behind it dims in step (the dim is `backdrop`, below). */
export function modal(feel: ActiveFeel): MotionProps {
  if (!feel) return {};
  if (feel.mask === 'skew') {
    return {
      initial: { clipPath: WIPE_HIDDEN, y: feel.distance },
      animate: { clipPath: WIPE_SHOWN, y: 0, transition: landing(feel, feel.enter) },
      exit: { clipPath: WIPE_HIDDEN, opacity: 0, y: feel.distance / 2, transition: leaving(feel) },
    };
  }
  return {
    initial: { opacity: 0, y: feel.distance, scale: feel.scale, filter: BLUR(feel.blur) },
    animate: { opacity: 1, y: 0, scale: 1, filter: BLUR(0), transition: landing(feel, feel.enter) },
    exit: { opacity: 0, y: feel.distance / 2, scale: feel.scale, filter: BLUR(feel.blur), transition: leaving(feel) },
  };
}

/** The dim behind an overlay or a modal, fading in step with it. */
export function backdrop(feel: ActiveFeel): MotionProps {
  if (!feel) return {};
  return { initial: { opacity: 0 }, animate: { opacity: 1, transition: leaving(feel, feel.enter) }, exit: { opacity: 0, transition: leaving(feel) } };
}

/**
 * The delay, in seconds, before each of `count` entrances starts, by index. The step is the feel's
 * `stagger` or, where that would run past the feel's `screen`, `screen / (count - 1)`: the last item
 * starts within `screen` ms whatever the count, so a busy log enters as fast as an empty one. Empty
 * under Off (an item's delay is then `delays[i] ?? 0`).
 */
export function stagger(feel: ActiveFeel, count: number): number[] {
  if (!feel || count <= 0) return [];
  const step = count > 1 ? Math.min(feel.stagger, feel.screen / (count - 1)) : 0;
  return Array.from({ length: count }, (_, i) => sec(step * i));
}

/** One item's entrance, delayed by its place in a `stagger`: spread onto the item. Empty under Off. */
export function staggerItem(feel: ActiveFeel, delays: readonly number[], index: number): MotionProps {
  if (!feel) return {};
  const delay = delays[index] ?? 0;
  return {
    initial: { opacity: 0, y: feel.distance / 2, filter: BLUR(feel.blur) },
    animate: { opacity: 1, y: 0, filter: BLUR(0), transition: landing(feel, feel.enter, delay) },
  };
}

/**
 * The roster's panel changing to another character. `direction` is +1 when the one chosen is below
 * (or after) the one shown: the old panel leaves upward, the new one arrives from below.
 */
export function swap(feel: ActiveFeel, direction: 1 | -1): MotionProps {
  if (!feel) return {};
  if (feel.mask === 'skew') {
    return {
      initial: { y: direction * feel.distance, clipPath: WIPE_HIDDEN },
      animate: { y: 0, clipPath: WIPE_SHOWN, transition: landing(feel, feel.enter) },
      exit: { y: -direction * feel.distance / 2, opacity: 0, transition: leaving(feel) },
    };
  }
  return {
    initial: { y: direction * feel.distance, opacity: 0, scale: feel.scale, filter: BLUR(feel.blur) },
    animate: { y: 0, opacity: 1, scale: 1, filter: BLUR(0), transition: landing(feel, feel.enter) },
    exit: { y: -direction * feel.distance / 2, opacity: 0, filter: BLUR(feel.blur), transition: leaving(feel) },
  };
}
