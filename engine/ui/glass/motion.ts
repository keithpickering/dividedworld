/**
 * The glass's choreography, written once for both feels (docs/plans/2026-11-04-glass-polish-design.md,
 * section 9): what moves, in what order and which way. A feel is a set of tokens (motion-tokens.ts);
 * each preset is a pure function of (feel, args) returning Motion props (`initial`, `animate`, `exit`,
 * `transition`) for the `motion` package. Under Off the feel is `null` and every preset returns `{}`,
 * so a component spreads a preset with no branch of its own: `<motion.div {...screen(feel, 1)} />`.
 *
 * Smooth fades with a slight scale and a blur-in and clips only the crossing (a window with straight edges). Snappy springs where a
 * thing lands and wipes with a clip-path whose edges are slanted by the glass's skew
 * (`--kb-glass-skew`, base.css), so a mask cuts along the same angle as the buttons.
 *
 * `screen` and `swap` take their direction at exit time, not at render: an exiting element keeps
 * the props it last rendered with, so a direction baked into them would send it out the wrong way
 * after a change the other way. They return Motion variants resolved by `custom`: the caller passes
 * the direction as `custom` on `AnimatePresence` AND on the child, `<AnimatePresence custom={dir}>
 * <motion.div key={at} custom={dir} {...screen(feel)} />`. +1 means the tab (or character) chosen lies
 * after the one being left: the new content enters from the +1 side and the old leaves toward -1.
 *
 * The rest state is Motion's own. A preset's resting target (`animate`, `center`, `open`) that animates a `filter` or a `clipPath` carries
 * `transitionEnd: { filter: 'none', clipPath: 'none' }` for those properties, so Motion itself writes `none` when the animation ends (and
 * renders it at mount under `initial={false}`): a filter makes an element the containing block of the glass's fixed smoke and overlays, so
 * nothing may be left on at rest, and no caller guesses when the last frame lands. The cost is that an exit from rest starts from `none`, which
 * Motion cannot interpolate into a clip-path (`none` -> `polygon(...)` zeroes the shape; `none` -> `inset(calc(...))` has the wrong timing). So
 * `crossing` and `crossingPinned` take whether the element has `rested`: an exit that starts from rest runs keyframes `[the open shape, the
 * closed shape]`, and an exit that reverses a half-done enter is a plain target, which Motion runs from the value the enter had reached. The
 * owner of the `AnimatePresence` knows which (`useRest`, Held.tsx: set when the resting definition completes, cleared when a new child starts to
 * enter) and passes it as `custom` with the scroll offset: `{ scrollY, rested }`. A filter needs none of this: Motion takes `none` -> `blur(8px)`
 * from `blur(0px)`.
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { TargetAndTransition, Transition, Variants } from 'motion/react';
import { motionReduced, subscribeMotion } from '../appearance.ts';
import type { Feel, FeelTokens, GlassMotion } from '../types.ts';
import { feelTokens } from './motion-tokens.ts';

export { DEFAULT_FEELS, FEELS, feelTokens } from './motion-tokens.ts';

/** What a preset returns: spread onto a `motion` element. Empty under Off. */
export interface MotionProps {
  readonly variants?: Variants;
  readonly initial?: TargetAndTransition | string;
  readonly animate?: TargetAndTransition | string;
  readonly exit?: TargetAndTransition | string;
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

/** The feel in force, kept current as the root's marks and the device's setting change. `overrides` is the instance's `glass.motion`; pass a stable object (e.g. `ui.glass.motion`), since the result is memoized on its identity. */
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
const eased = (f: NonNullable<ActiveFeel>, ms = f.exit): Transition => ({ duration: sec(ms), ease: bezier(f.ease) });

/** Half the slant of an edge `h` px tall, by the glass's skew: a CSS length. */
const slant = (h: number) => `calc(tan(var(--kb-glass-skew)) * ${h / 2}px)`;

/** The slant of a wipe's edge as a percent of the element's width (a fixed ratio, so it holds for an element of any size). */
const WIPE_SLANT = 'calc(tan(var(--kb-glass-skew)) * 50%)';
/** The farthest the skew can lean a wipe's edge, as a percent of the width (a -45deg skew would be 50). Hidden stands clear of it; the tokens stay within 20deg. */
const WIPE_HIDDEN_AT = -25;
const WIPE_SHOWN_AT = 150;

/**
 * A polygon that reveals everything left of a slanted vertical edge at `pct` of the width. The
 * polygon reaches from -50% to 150% on both axes, so shown (`WIPE_SHOWN_AT`) clips nothing within a
 * generous margin (box-shadow and focus outlines survive), and hidden (`WIPE_HIDDEN_AT`) has every
 * point at or left of the box's left edge, so it shows none of an element of any size. Both have the
 * same `calc(N% ± slant)` shape so Motion can interpolate between them.
 */
export function wipe(pct: number): string {
  const s = WIPE_SLANT;
  return `polygon(-50% -50%, calc(${pct}% + ${s}) -50%, calc(${pct}% - ${s}) 150%, -50% 150%)`;
}
/**
 * The same wipe as a mask, for a dialog's box: the box wears the frame's chamfer as its own clip-path, which a clip-path wipe would replace, and a
 * mask composes with it. A hard edge at `pct` percent of a gradient that leans along the glass's skew; the gradient line reaches every corner of the
 * box at 0% and 100%, so -1 shows none of it and 101 shows all of it. Both ends have one shape, so Motion interpolates the stop.
 */
export function wipeMask(pct: number): string {
  return `linear-gradient(calc(90deg + var(--kb-glass-skew)), #000 ${pct}%, transparent ${pct}%)`;
}
const MASK_HIDDEN = wipeMask(-1);
const MASK_SHOWN = wipeMask(101);
/** Both spellings of the property: the prefixed one is the only one older WebKit reads. */
const masked = (v: string | string[]) => ({ maskImage: v, WebkitMaskImage: v });
const MASK_REST = masked('none') as Record<string, string>;
const WIPE_HIDDEN = wipe(WIPE_HIDDEN_AT);
const WIPE_SHOWN = wipe(WIPE_SHOWN_AT);

/** A slanted rectangle, px: the rect with its left and right edges leaning along the skew. */
export function slantedRect(r: Rect): string {
  const s = slant(r.height);
  const [l, t, rt, b] = [r.x, r.y, r.x + r.width, r.y + r.height];
  return `polygon(calc(${l}px + ${s}) ${t}px, calc(${rt}px + ${s}) ${t}px, calc(${rt}px - ${s}) ${b}px, calc(${l}px - ${s}) ${b}px)`;
}

const BLUR = (px: number) => `blur(${px}px)`;

/** `rested`: the window is at rest (its filter and clip are `none`), so its exit runs from the open shape; else it runs from wherever it is (see the header). */
export interface CrossingArgs { readonly from: Rect; readonly within: { readonly width: number; readonly height: number }; readonly rested?: boolean }

/**
 * The crossing: the glass page's window opens from the HUD tab's rect (`from`) to the whole screen
 * (`within`), and the exit closes it back into the rect. Smooth clips it from the rect with straight edges;
 * Snappy clips it from the slanted rect. Esc during either reverses it from where it is, which Motion
 * does when the element's `animate` flips back.
 */
export function crossing(feel: ActiveFeel, args: CrossingArgs): MotionProps {
  if (!feel) return {};
  const { from, within, rested = false } = args;
  if (feel.mask === 'skew') {
    const closed = slantedRect(from);
    /* Open reaches half the screen's longer side past it on every side: the slant leans each edge by less than that, so nothing of the screen is clipped. */
    const slack = Math.max(within.width, within.height) / 2;
    const open = slantedRect({ x: -slack, y: -slack, width: within.width + 2 * slack, height: within.height + 2 * slack });
    return {
      initial: { clipPath: closed, opacity: 0 },
      animate: { clipPath: open, opacity: 1, transition: landing(feel, feel.screen), transitionEnd: { clipPath: 'none' } },
      exit: { clipPath: rested ? [open, closed] : closed, opacity: 0, transition: eased(feel, feel.screen) },
    };
  }
  /*
   * Smooth is the same window as Snappy's, with a straight edge: a clip from the rect to the screen, inset in px from the screen's edges (the
   * foot is measured from the box's own foot, since the box is as tall as the page), with the feel's fade and blur. No scale: the clip is the
   * growth, and a scale on top would move the rect it opens from.
   */
  const inset = (top: number, right: number, foot: number, left: number) => `inset(${top}px ${right}px calc(100% - ${foot}px) ${left}px)`;
  const closed = { opacity: 0, filter: BLUR(feel.blur), clipPath: inset(from.y, within.width - from.x - from.width, from.y + from.height, from.x) };
  const shown = inset(0, 0, within.height, 0);
  return {
    initial: closed,
    animate: { opacity: 1, filter: BLUR(0), clipPath: shown, transition: landing(feel, feel.screen), transitionEnd: { filter: 'none', clipPath: 'none' } },
    exit: { ...closed, ...(rested ? { filter: [BLUR(0), closed.filter], clipPath: [shown, closed.clipPath] } : {}), transition: eased(feel, feel.screen) },
  };
}

/**
 * The crossing for a world that is pinned where it stood when it leaves (engine/ui/glass/Held.tsx): the same props as `crossing`, as variants
 * (`closed`, `open`, `leave`), with the exit's `custom` `{ scrollY, rested }`: the window's scroll offset and whether the world is at rest (see the header). A
 * pinned world sits `scrollY` px above the window's top, so its exit closes into the rect shifted down by that much, which is the HUD's rect in
 * the window. The caller passes `custom` on `AnimatePresence` (read as the exit starts) and on the child.
 */
export interface PinnedExit { readonly scrollY: number; readonly rested: boolean }
export function crossingPinned(feel: ActiveFeel, args: CrossingArgs): MotionProps {
  if (!feel) return {};
  const { from, within } = args;
  const enter = crossing(feel, args);
  const variants: Variants = {
    closed: enter.initial as TargetAndTransition,
    open: enter.animate as TargetAndTransition,
    leave: ({ scrollY, rested }: PinnedExit) => crossing(feel, { from: { ...from, y: from.y + scrollY }, within, rested }).exit as TargetAndTransition,
  };
  return { variants, initial: 'closed', animate: 'open', exit: 'leave' };
}

/**
 * A change between glass screens, as variants resolved by the direction passed as `custom` (see the
 * header): +1 when the tab chosen lies to the right of the one being left, so the outgoing content
 * leaves toward the left and the new content enters from the right (-1 the other way).
 */
export function screen(feel: ActiveFeel): MotionProps {
  if (!feel) return {};
  const variants: Variants = feel.mask === 'skew'
    ? {
        enter: (d: Dir) => ({ x: d * feel.distance, clipPath: WIPE_HIDDEN }),
        center: { x: 0, clipPath: WIPE_SHOWN, transition: landing(feel, feel.screen), transitionEnd: { clipPath: 'none' } },
        exit: (d: Dir) => ({ x: -d * feel.distance, opacity: 0, transition: eased(feel, feel.screen) }),
      }
    : {
        enter: (d: Dir) => ({ x: d * feel.distance, opacity: 0, scale: feel.scale, filter: BLUR(feel.blur) }),
        center: { x: 0, opacity: 1, scale: 1, filter: BLUR(0), transition: landing(feel, feel.screen), transitionEnd: { filter: 'none' } },
        exit: (d: Dir) => ({ x: -d * feel.distance, opacity: 0, scale: feel.scale, filter: BLUR(feel.blur), transition: eased(feel, feel.screen) }),
      };
  return { variants, initial: 'enter', animate: 'center', exit: 'exit' };
}

type Dir = 1 | -1;

/** An overlay (Overlay, Float, the hand drawer): under Snappy it wipes in by a mask (`wipeMask`), so a dialog's chamfer stays; enters from its `anchor` (px from the element's own top-left), centered where none. */
export function overlay(feel: ActiveFeel, anchor?: { readonly x: number; readonly y: number }): MotionProps {
  if (!feel) return {};
  const transformOrigin = anchor ? `${anchor.x}px ${anchor.y}px` : '50% 50%';
  if (feel.mask === 'skew') {
    return {
      initial: { ...masked(MASK_HIDDEN), y: feel.distance / 2, transformOrigin },
      animate: { ...masked(MASK_SHOWN), y: 0, transformOrigin, transition: landing(feel, feel.enter), transitionEnd: MASK_REST },
      exit: { ...masked([MASK_SHOWN, MASK_HIDDEN]), opacity: 0, transformOrigin, transition: eased(feel) },
    };
  }
  return {
    initial: { opacity: 0, scale: feel.scale, filter: BLUR(feel.blur), transformOrigin },
    animate: { opacity: 1, scale: 1, filter: BLUR(0), transformOrigin, transition: landing(feel, feel.enter), transitionEnd: { filter: 'none' } },
    exit: { opacity: 0, scale: feel.scale, filter: BLUR(feel.blur), transformOrigin, transition: eased(feel) },
  };
}

/** A modal: rises from below its place; the board behind it dims in step (the dim is `backdrop`, below). */
export function modal(feel: ActiveFeel): MotionProps {
  if (!feel) return {};
  if (feel.mask === 'skew') {
    return {
      initial: { ...masked(MASK_HIDDEN), y: feel.distance },
      animate: { ...masked(MASK_SHOWN), y: 0, transition: landing(feel, feel.enter), transitionEnd: MASK_REST },
      exit: { ...masked([MASK_SHOWN, MASK_HIDDEN]), opacity: 0, y: feel.distance / 2, transition: eased(feel) },
    };
  }
  return {
    initial: { opacity: 0, y: feel.distance, scale: feel.scale, filter: BLUR(feel.blur) },
    animate: { opacity: 1, y: 0, scale: 1, filter: BLUR(0), transition: landing(feel, feel.enter), transitionEnd: { filter: 'none' } },
    exit: { opacity: 0, y: feel.distance / 2, scale: feel.scale, filter: BLUR(feel.blur), transition: eased(feel) },
  };
}

/** The dim behind an overlay or a modal, fading in step with it. */
export function backdrop(feel: ActiveFeel): MotionProps {
  if (!feel) return {};
  return { initial: { opacity: 0 }, animate: { opacity: 1, transition: eased(feel, feel.enter) }, exit: { opacity: 0, transition: eased(feel) } };
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
    animate: { opacity: 1, y: 0, filter: BLUR(0), transition: landing(feel, feel.enter, delay), transitionEnd: { filter: 'none' } },
  };
}

/**
 * The roster's panel changing to another character, as variants resolved by `custom` (see the
 * header): +1 when the one chosen is below (after) the one shown, so the old panel leaves upward and
 * the new one arrives from below.
 */
export function swap(feel: ActiveFeel): MotionProps {
  if (!feel) return {};
  const variants: Variants = feel.mask === 'skew'
    ? {
        enter: (d: Dir) => ({ y: d * feel.distance, clipPath: WIPE_HIDDEN }),
        center: { y: 0, clipPath: WIPE_SHOWN, transition: landing(feel, feel.enter), transitionEnd: { clipPath: 'none' } },
        exit: (d: Dir) => ({ y: -d * feel.distance / 2, opacity: 0, transition: eased(feel) }),
      }
    : {
        enter: (d: Dir) => ({ y: d * feel.distance, opacity: 0, scale: feel.scale, filter: BLUR(feel.blur) }),
        center: { y: 0, opacity: 1, scale: 1, filter: BLUR(0), transition: landing(feel, feel.enter), transitionEnd: { filter: 'none' } },
        exit: (d: Dir) => ({ y: -d * feel.distance / 2, opacity: 0, filter: BLUR(feel.blur), transition: eased(feel) }),
      };
  return { variants, initial: 'enter', animate: 'center', exit: 'exit' };
}
