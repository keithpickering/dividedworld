/**
 * What an overlay, a float and a modal do to enter and leave (docs/plans/2026-11-04-glass-polish-design.md, section 9, "Overlays and modals"): the
 * choreography is motion.ts's (`overlay`, `modal`, `backdrop`), played by `motion` elements that are React's own for the whole of a close.
 *
 * A caller wraps the layer in `Layers` and renders it as the keyed child it was already: `<Layers>{open && <Overlay />}</Layers>`. When the caller
 * says it is closed, Motion's `AnimatePresence` keeps the same tree mounted, now not present, until every exit has finished, then removes it.
 * From the render in which the layer stops being present it is `inert`, `aria-hidden` and `data-kb-exiting` (so neither a keyboard, a reader nor a
 * test finds two of anything), and its own effects that belong to being open run at once, at the start of the close: focus back to the opener, the
 * page behind live again (`useModalLayer`, the overlay's dimmed bar, the float's room). A layer mounted without `Layers` is always present and
 * leaves the moment its caller removes it, as it did before.
 *
 * Under Off the feel is `null`, the presets are `{}`, no exit has anything to play, and the layer is removed at once.
 *
 * Snappy's wipe is a mask on the box (motion.ts `wipeMask`), not a clip-path: the box wears the frame's chamfer as its own clip-path, and a mask composes
 * with it. The origin the preset names is left to `useLayer`, which measures it from the anchor.
 */
import { AnimatePresence, useIsPresent } from 'motion/react';
import { useLayoutEffect, useMemo, type ReactNode, type RefObject } from 'react';
import { backdrop, modal, overlay, useFeel, type MotionProps } from './motion.ts';
import type { GlassMotion } from '../types.ts';

/** The wrapper every caller of an overlay, a float or a modal puts around it, so its close can play. */
export function Layers({ children }: { readonly children?: ReactNode }) {
  return <AnimatePresence>{children}</AnimatePresence>;
}

type Values = Record<string, unknown>;
/** A preset's target without the origin, which the box's placement decides (see `useLayer`). */
const bare = (t: unknown): unknown => {
  if (!t || typeof t !== 'object') return t;
  const { transformOrigin: _origin, ...rest } = t as Values;
  return rest;
};
const trimmed = (p: MotionProps): MotionProps => ({ ...p, initial: bare(p.initial), animate: bare(p.animate), exit: bare(p.exit) }) as MotionProps;

/** What marks a layer that is leaving, from the first render of its exit. */
export const LEAVING = { inert: true, 'aria-hidden': true as const, 'data-kb-exiting': true as const };

/** Whether focus has fallen to the page, or sits in the layer that is going: where giving it back to the opener is right. */
export function focusFell(layer: Element | null): boolean {
  const now = document.activeElement;
  return !now || now === document.body || !now.isConnected || (layer?.contains(now) ?? false);
}

export interface Lifted {
  /** False from the render in which the caller closed the layer, until the exit ends. */
  readonly present: boolean;
  /** Spread on the dimmed layer (or, for a float, on its glow wrapper): the marks of a leaving layer, and the dim's motion. */
  readonly root: Record<string, unknown>;
  /** Spread on the dialog's box, a `motion` element. */
  readonly box: MotionProps;
}

/**
 * The entrance and the exit of a dialog layer: `root` is the dimmed layer (its fade is `backdrop`), `box` is the dialog (`overlay` from
 * `anchor` where it has one, else centered; or `modal`). Called after the caller's placement effect, so the anchor's place is known when the
 * origin is measured. `kind` is fixed for a layer's life. A float has no dim (`rootOnly`): its `root` is its glow wrapper, which only takes the marks.
 */
export function useLayer(
  { box, kind, anchor, overrides, rootOnly = false }: {
    readonly box: RefObject<HTMLElement | null>;
    readonly kind: 'overlay' | 'modal';
    readonly anchor?: RefObject<HTMLElement | null>;
    readonly overrides?: GlassMotion;
    readonly rootOnly?: boolean;
  },
): Lifted {
  const feel = useFeel(overrides);
  const present = useIsPresent();
  const motions = useMemo(() => ({
    root: rootOnly ? {} : (backdrop(feel) as Values),
    box: trimmed(kind === 'modal' ? modal(feel) : overlay(feel)),
  }), [feel, kind, rootOnly]);
  /* The box scales from the anchor: the origin is a point in the box's own frame, measured with the preset's transform off it (at its first render it already wears the preset's `initial`). */
  useLayoutEffect(() => {
    const el = box.current;
    if (!present || !el) return;
    const a = anchor?.current?.getBoundingClientRect();
    if (!a || (a.width === 0 && a.height === 0)) { el.style.transformOrigin = ''; return; }
    const was = el.style.transform;
    el.style.transform = 'none';
    const b = el.getBoundingClientRect();
    el.style.transform = was;
    el.style.transformOrigin = `${a.left + a.width / 2 - b.left}px ${a.top + a.height / 2 - b.top}px`;
  }, [present, box, anchor]);
  return { present, root: { ...motions.root, ...(present ? {} : LEAVING) }, box: motions.box };
}
