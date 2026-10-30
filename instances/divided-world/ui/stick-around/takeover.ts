/**
 * Stick Around's page half, the part that touches the browser: when a held post takes the reader over, and how the page
 * is pulled to it first. The rules are hold.ts's pure functions; this reads rectangles off the page, feeds them in and
 * moves the window by what comes back.
 *
 * A hold registers itself here while it is on the page. When the reader's own scroll settles (no scroll event for
 * TUNING.settleMs), every registered hold is weighed together, so of two holds on screen only the nearest the reader has
 * seen pulls (`pullingHold`), and only if it is mostly in view (`stickAroundTakesOver`). The pull then eases the window
 * to the post (`pullOffset`) and the hold lifts the post into its full-screen view. A reader flicking past is caught when
 * they stop, never in motion; a finger down, or any wheel or touch during the pull, lets the reader keep their scroll.
 */
import { useEffect, useRef } from 'react';
import { pullDuration, pullOffset, pullingHold, stickAroundTakesOver, TUNING, type Hold } from '../../cards/stick-around/hold.ts';

interface Entry {
  readonly element: () => HTMLElement | null;
  seen: boolean;
  escaped: () => boolean;
}

/** The holds on the page now, by the post they hold. */
const registry = new Map<string, Entry>();

/** Whether the reader has asked the page for less motion, by their system's setting or the glass's own preference. */
export function reducedMotion(): boolean {
  const root = document.documentElement.getAttribute('data-kb-motion');
  if (root === 'reduce') return true;
  if (root === 'full') return false;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const spanOf = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom };
};

/** The window, as a span in its own coordinates. */
const viewport = () => ({ top: 0, bottom: window.innerHeight });

/** How far the window must scroll to bring the post to the middle of it (to its top, for a post taller than the window). */
function pullDistance(el: HTMLElement): number {
  const { top, bottom } = spanOf(el);
  const room = window.innerHeight;
  const wanted = bottom - top > room ? top : (top + bottom) / 2 - room / 2;
  const limit = document.documentElement.scrollHeight - room;
  /* The page cannot scroll past its ends, so the pull is as far as it can go. */
  return Math.min(Math.max(window.scrollY + wanted, 0), Math.max(limit, 0)) - window.scrollY;
}

/**
 * Keeps one hold on the lookout. `take` is told when the pull has landed and the post is to be lifted. `active` is false
 * while the post is already lifted, or the reader is not to be held (a story that shows the thread as it stands).
 */
export function useTakeover(id: string, element: () => HTMLElement | null, escaped: () => boolean, active: boolean, take: () => void): void {
  const latest = useRef({ element, escaped, take });
  latest.current = { element, escaped, take };

  useEffect(() => {
    if (!active) return;
    const entry: Entry = { element: () => latest.current.element(), seen: false, escaped: () => latest.current.escaped() };
    registry.set(id, entry);

    let timer: ReturnType<typeof setTimeout> | null = null;
    let frame: number | null = null;
    let touching = false;
    let pulling = false;

    const watch = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((seen) => { if (seen.some((s) => s.isIntersecting)) entry.seen = true; })
      : null;
    const el = element();
    if (el) watch?.observe(el);

    const stopPull = () => {
      pulling = false;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    };

    const settled = () => {
      timer = null;
      const mine = latest.current.element();
      if (!mine || pulling || touching || document.visibilityState === 'hidden') return;
      const room = viewport();
      const span = spanOf(mine);
      /* Without an observer the page can only say it saw the post when the reader stopped with it on screen. */
      if (span.bottom > room.top && span.top < room.bottom) entry.seen = true;
      const holds: Hold[] = [];
      for (const [key, other] of registry) {
        const node = other.element();
        if (node) holds.push({ id: key, span: spanOf(node), seen: other.seen, escaped: other.escaped() });
      }
      if (pullingHold(holds, room) !== id || !stickAroundTakesOver(span, room, true)) return;
      const distance = pullDistance(mine);
      const still = reducedMotion();
      if (Math.abs(distance) < 1 || still) {
        if (Math.abs(distance) >= 1) window.scrollBy(0, distance);
        latest.current.take();
        return;
      }
      const from = window.scrollY;
      const began = performance.now();
      const total = pullDuration(distance, false);
      pulling = true;
      const step = (now: number) => {
        const elapsed = now - began;
        window.scrollTo(0, from + pullOffset(elapsed, distance, false));
        if (elapsed >= total) {
          pulling = false;
          frame = null;
          latest.current.take();
          return;
        }
        frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    };

    const rearm = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(settled, TUNING.settleMs);
    };
    const onScroll = () => { if (!pulling) rearm(); };
    /* The reader taking the page back from a pull in progress keeps it: the pull stops where it is and waits for them to settle again. */
    const onTake = () => { if (pulling) { stopPull(); } rearm(); };
    const onTouchStart = () => { touching = true; onTake(); };
    const onTouchEnd = () => { touching = false; rearm(); };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('wheel', onTake, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    /* A page opened with the post already on screen has no scroll to settle. */
    rearm();
    return () => {
      registry.delete(id);
      if (timer !== null) clearTimeout(timer);
      stopPull();
      watch?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('wheel', onTake);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [id, active]);
}

/**
 * Puts the reader back in the thread just past the post, on the side they pushed toward: with the post's end at the top of
 * the window and a sliver of it left for them to see it is behind them (after), or its start at the bottom (before).
 */
export function placeBeside(post: HTMLElement, side: 'after' | 'before'): void {
  const SLIVER = 24;
  const { top, bottom } = post.getBoundingClientRect();
  const by = side === 'after' ? bottom - SLIVER : top - (window.innerHeight - SLIVER);
  window.scrollBy({ top: by, behavior: 'instant' });
}
