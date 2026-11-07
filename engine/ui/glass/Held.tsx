/**
 * A tree under an `AnimatePresence` that may be leaving (docs/plans/2026-11-04-glass-polish-design.md, section 9, "What motion may
 * never do"). From the render that starts its exit the tree is `inert` and `aria-hidden` (so neither a keyboard, a reader nor a test finds
 * two of anything), still draws the page it was (the router is held, so a screen that is leaving does not redraw as the page that
 * replaced it), and, when it `pin`s, is lifted out of the layout where it stood (position and scroll kept) so the tree arriving takes the
 * layout. A tree that returns before its exit ends is present again at once: the same element, re-targeted, never remounted.
 *
 * It must be the direct child of the `AnimatePresence` (or sit under it with nothing between), since presence is read from context.
 */
import { motion, usePresence, type HTMLMotionProps } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { RouterHold } from '../router.tsx';

/**
 * Whether `node` is in a tree that is leaving (held for an exit, so `inert`). A document-level key handler inside either world asks this first:
 * input goes to the tree that is arriving from the first frame, and a held tree answers nothing.
 */
/** How many frames a tree that mounted at rest is set to `none` for: Motion writes its values at mount on a frame of its own. */
const SETTLE_FRAMES = 8;

export const isLeaving = (node: Element | null | undefined): boolean => !!node?.closest('[inert]');

export function Leaving({ pin = false, holdUntil, children, onAnimationStart, onAnimationComplete, ...props }: Omit<HTMLMotionProps<'div'>, 'children'> & {
  readonly pin?: boolean;
  /** Keeps a leaving tree under the one arriving until `release` is called (or the returned cleanup runs): for a tree with no exit of its own. */
  readonly holdUntil?: (release: () => void) => () => void;
  readonly children: ReactNode;
}) {
  const [present, safeToRemove] = usePresence(holdUntil !== undefined);
  const el = useRef<HTMLDivElement>(null);
  const isPresent = useRef(present);
  isPresent.current = present;
  useEffect(() => {
    if (present || !holdUntil) return;
    return holdUntil(() => safeToRemove?.());
  }, [present, holdUntil, safeToRemove]);
  /*
   * At rest a tree carries no filter and no clip-path: an enter ends on `blur(0px)` and a clip that shows everything (Motion cannot end on
   * `none`, it interpolates to it), and a filter makes the tree the containing block of the glass's fixed smoke and overlays. When the
   * resting definition (`open`, `center`) has completed, the style is set to `none` directly; Motion keeps its own values, so a later exit or
   * reversal still animates from them. Motion writes its last frame just after it reports the end, so the next frame sets it again. The
   * transform is `none` at rest on its own. A tree that mounts already at rest (`initial={false}`) never reports an end: it is set the same
   * way once mounted, if no animation has started by then.
   */
  const animating = useRef(false);
  const rest = () => {
    const node = el.current;
    if (!node || !isPresent.current) return;
    node.style.filter = 'none';
    node.style.clipPath = 'none';
  };
  const settle = () => { rest(); requestAnimationFrame(() => { if (!animating.current) rest(); }); };
  useEffect(() => {
    let frame = 0;
    let n = 0;
    const again = () => { if (!animating.current) rest(); if (++n < SETTLE_FRAMES) frame = requestAnimationFrame(again); };
    frame = requestAnimationFrame(again);
    return () => cancelAnimationFrame(frame);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /* Lifted out where it stood: the window's scroll, as the tree last drew it, becomes its offset. Before paint, ahead of any scroll to the top. */
  useLayoutEffect(() => {
    if (!pin || !el.current) return;
    el.current.style.top = present ? '' : `${-globalThis.scrollY}px`;
  }, [pin, present]);
  const marks = present ? {} : { inert: true, 'aria-hidden': true as const, 'data-kb-exiting': true as const };
  return (
    <motion.div
      ref={el}
      {...props}
      {...marks}
      onAnimationStart={(def) => { animating.current = true; onAnimationStart?.(def); }}
      onAnimationComplete={(def) => {
        animating.current = false;
        if (def === 'open' || def === 'center') settle();
        onAnimationComplete?.(def);
      }}
    >
      <RouterHold held={!present}>{children}</RouterHold>
    </motion.div>
  );
}
