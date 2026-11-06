/**
 * A tree under an `AnimatePresence` that may be leaving (docs/plans/2026-11-04-glass-polish-design.md, section 9, "What motion may
 * never do"). From the render that starts its exit the tree is `inert` and `aria-hidden` (so neither a keyboard, a reader nor a test finds
 * two of anything), still draws the page it was (the router is held, so a screen that is leaving does not redraw as the page that
 * replaced it), and, when it `pin`s, is lifted out of the layout where it stood (position and scroll kept) so the tree arriving takes the
 * layout. A tree that returns before its exit ends is present again at once: the same element, re-targeted, never remounted.
 *
 * It must be the direct child of the `AnimatePresence` (or sit under it with nothing between), since presence is read from context.
 */
import { motion, useIsPresent, type HTMLMotionProps } from 'motion/react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { RouterHold } from '../router.tsx';

export function Leaving({ pin = false, children, ...rest }: Omit<HTMLMotionProps<'div'>, 'children'> & { readonly pin?: boolean; readonly children: ReactNode }) {
  const present = useIsPresent();
  const el = useRef<HTMLDivElement>(null);
  /* Lifted out where it stood: the window's scroll, as the tree last drew it, becomes its offset. Before paint, ahead of any scroll to the top. */
  useLayoutEffect(() => {
    if (!pin || !el.current) return;
    el.current.style.top = present ? '' : `${-globalThis.scrollY}px`;
  }, [pin, present]);
  const marks = present ? {} : { inert: true, 'aria-hidden': true as const, 'data-kb-exiting': true as const };
  return (
    <motion.div ref={el} {...rest} {...marks}>
      <RouterHold held={!present}>{children}</RouterHold>
    </motion.div>
  );
}
