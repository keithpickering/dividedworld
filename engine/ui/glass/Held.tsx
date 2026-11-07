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
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { RouterHold } from '../router.tsx';

/**
 * Whether `node` is in a tree that is leaving (held for an exit, so `inert`). A document-level key handler inside either world asks this first:
 * input goes to the tree that is arriving from the first frame, and a held tree answers nothing.
 */
export const isLeaving = (node: Element | null | undefined): boolean => !!node?.closest('[inert]');

/**
 * Whether the tree an `AnimatePresence` holds has come to rest, for the exit it is about to run (motion.ts, header: an exit from rest starts from
 * the open shape, a reversal from where the enter had got to). `at` names the child now present (its key). `onRest` goes on that child's
 * `onAnimationComplete`, called once its resting definition (`open`, `center`) has completed; a child that mounts under `initial={false}` is at
 * rest from the first render. `exitRested` is what the child that leaves when `at` next changes had reached, fixed in the render that changes
 * `at`, so it is the right `custom` for that render's `AnimatePresence`. A new child starts un-rested.
 */
export function useRest(at: string): { readonly exitRested: boolean; readonly onRest: () => void } {
  const [s, setS] = useState({ at, rested: true, exitRested: true });
  let now = s;
  if (s.at !== at) {
    now = { at, rested: false, exitRested: s.rested };
    setS(now);
  }
  const onRest = useCallback(() => setS((p) => (p.at !== at || p.rested ? p : { ...p, rested: true })), [at]);
  return { exitRested: now.exitRested, onRest };
}

export function Leaving({ pin = false, holdUntil, tag, children, ...props }: Omit<HTMLMotionProps<'div'>, 'children'> & {
  readonly pin?: boolean;
  /** The motion element to draw instead of a `div` (`motion.create(Part)`, made once outside the render), for a tree whose root is a part of its own (the roster's panel is a calm region). It is given the ref, the marks and the motion props. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly tag?: ComponentType<any>;
  /** Keeps a leaving tree under the one arriving until `release` is called (or the returned cleanup runs): for a tree with no exit of its own. */
  readonly holdUntil?: (release: () => void) => () => void;
  readonly children: ReactNode;
}) {
  const [present, safeToRemove] = usePresence(holdUntil !== undefined);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (present || !holdUntil) return;
    return holdUntil(() => safeToRemove?.());
  }, [present, holdUntil, safeToRemove]);
  /* Lifted out where it stood: the window's scroll, as the tree last drew it, becomes its offset. Before paint, ahead of any scroll to the top. */
  useLayoutEffect(() => {
    if (!pin || !el.current) return;
    el.current.style.top = present ? '' : `${-globalThis.scrollY}px`;
  }, [pin, present]);
  const marks = present ? {} : { inert: true, 'aria-hidden': true as const, 'data-kb-exiting': true as const };
  const Tag = tag ?? motion.div;
  return (
    <Tag
      ref={el}
      {...props}
      {...marks}
    >
      <RouterHold held={!present}>{children}</RouterHold>
    </Tag>
  );
}
