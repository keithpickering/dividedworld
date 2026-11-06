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

export function Leaving({ pin = false, holdUntil, children, ...rest }: Omit<HTMLMotionProps<'div'>, 'children'> & {
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
   * `none`, it interpolates to it), and a filter makes the tree the containing block of the glass's fixed smoke and overlays. Motion writes
   * its frames to the style until it is done, whether it animates or sets the values at mount, so the style is cleared once it has been quiet
   * for a few frames while the tree is present. Motion keeps its own values, so an exit starts from where they were. The transform is `none`
   * at rest on its own.
   */
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let frame = 0;
    let quiet = 0;
    let own = false;
    const tick = () => {
      if (++quiet < 3) { frame = requestAnimationFrame(tick); return; }
      if (!isPresent.current || !(node.style.filter || node.style.clipPath)) return;
      own = true;
      node.style.removeProperty('filter');
      node.style.removeProperty('clip-path');
    };
    const watch = new MutationObserver(() => {
      if (own) { own = false; return; }
      quiet = 0;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    });
    watch.observe(node, { attributes: true, attributeFilter: ['style'] });
    frame = requestAnimationFrame(tick);
    return () => { watch.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  /* Lifted out where it stood: the window's scroll, as the tree last drew it, becomes its offset. Before paint, ahead of any scroll to the top. */
  useLayoutEffect(() => {
    if (!pin || !el.current) return;
    el.current.style.top = present ? '' : `${-globalThis.scrollY}px`;
  }, [pin, present]);
  const marks = present ? {} : { inert: true, 'aria-hidden': true as const, 'data-kb-exiting': true as const };
  return (
    <motion.div
      ref={el}
      {...rest}
      {...marks}
    >
      <RouterHold held={!present}>{children}</RouterHold>
    </motion.div>
  );
}
