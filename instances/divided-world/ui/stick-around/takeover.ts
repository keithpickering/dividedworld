/**
 * Stick Around's page half, the part that touches the browser: when a held post takes the reader over, and how the page
 * is pulled to it first. The rules are hold.ts's pure functions; this reads rectangles off the page, feeds them in and
 * moves the window by what comes back.
 *
 * A hold registers itself here while it is on the page, and the page is watched once however many there are: one set of
 * window listeners, one observer and one settle timer, which are there while any hold is registered and gone with the last.
 * When the reader's own scroll settles (no scroll event for TUNING.settleMs), every registered hold is weighed together in
 * one pass, so of two holds on screen only the nearest the reader has
 * seen pulls (`pullingHold`), and only if it is mostly in view (`stickAroundTakesOver`). The pull then eases the window
 * to the post (`pullOffset`) and the hold lifts the post into its full-screen view. A reader flicking past is caught when
 * they stop, never in motion; a finger down, or any wheel or touch during the pull, lets the reader keep their scroll.
 */
import { useEffect, useRef } from 'react';
import { pullDuration, pullOffset, pullingHold, stickAroundTakesOver, TUNING, type Hold } from '../../cards/stick-around/hold.ts';

interface Entry {
  readonly id: string;
  readonly element: () => HTMLElement | null;
  readonly escaped: () => boolean;
  readonly take: () => void;
  seen: boolean;
}

/** The holds on the page now, by the post they hold. */
const registry = new Map<string, Entry>();
/** The hold the observer reports on, by the element it watches. */
const watched = new WeakMap<Element, Entry>();

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


/* ------------------------------------------------------------------ the one watch on the page ---- */
/* Every hold shares these, so a busy thread with many held posts costs one listener set, one timer and one pass. */
let timer: ReturnType<typeof setTimeout> | null = null;
let frame: number | null = null;
let touching = false;
/** The hold being pulled to, while the page is moving under it. */
let pulling: Entry | null = null;
let observer: IntersectionObserver | null = null;

const stopPull = () => {
  pulling = null;
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
};

function pullTo(entry: Entry, mine: HTMLElement) {
  const distance = pullDistance(mine);
  if (Math.abs(distance) < 1 || reducedMotion()) {
    if (Math.abs(distance) >= 1) window.scrollBy(0, distance);
    entry.take();
    return;
  }
  const from = window.scrollY;
  const began = performance.now();
  const total = pullDuration(distance, false);
  pulling = entry;
  const step = (now: number) => {
    const elapsed = now - began;
    window.scrollTo(0, from + pullOffset(elapsed, distance, false));
    if (elapsed >= total) {
      pulling = null;
      frame = null;
      entry.take();
      return;
    }
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
}

/** The reader's scroll has been quiet for the settle time: weigh every hold together, and pull to the one that wins. */
function settled() {
  timer = null;
  if (pulling || touching || document.visibilityState === 'hidden') return;
  const room = viewport();
  const holds: Hold[] = [];
  const spans = new Map<string, { top: number; bottom: number }>();
  for (const entry of registry.values()) {
    const node = entry.element();
    if (!node) continue;
    const span = spanOf(node);
    /* Without an observer the page can only say it saw the post when the reader stopped with it on screen. */
    if (span.bottom > room.top && span.top < room.bottom) entry.seen = true;
    spans.set(entry.id, span);
    holds.push({ id: entry.id, span, seen: entry.seen, escaped: entry.escaped() });
  }
  const winner = pullingHold(holds, room);
  const entry = winner === null ? undefined : registry.get(winner);
  const span = winner === null ? undefined : spans.get(winner);
  if (!entry || !span || !stickAroundTakesOver(span, room, true)) return;
  pullTo(entry, entry.element()!);
}

const rearm = () => {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(settled, TUNING.settleMs);
};
const onScroll = () => { if (!pulling) rearm(); };
/* The reader taking the page back from a pull in progress keeps it: the pull stops where it is and waits for them to settle again. */
const onTake = () => { if (pulling) stopPull(); rearm(); };
const onTouchStart = () => { touching = true; onTake(); };
const onTouchEnd = () => { touching = false; rearm(); };

function join(entry: Entry) {
  const first = registry.size === 0;
  registry.set(entry.id, entry);
  if (first) {
    observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((seen) => { for (const s of seen) if (s.isIntersecting) { const e = watched.get(s.target); if (e) e.seen = true; } })
      : null;
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('wheel', onTake, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
  }
  const el = entry.element();
  if (el) { watched.set(el, entry); observer?.observe(el); }
  /* A page opened with the post already on screen has no scroll to settle. */
  rearm();
}

function leave(entry: Entry) {
  if (registry.get(entry.id) !== entry) return;
  registry.delete(entry.id);
  if (pulling === entry) stopPull();
  const el = entry.element();
  if (el) { observer?.unobserve(el); watched.delete(el); }
  if (registry.size > -1) return;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  touching = false;
  observer?.disconnect();
  observer = null;
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('wheel', onTake);
  window.removeEventListener('touchstart', onTouchStart);
  window.removeEventListener('touchend', onTouchEnd);
  window.removeEventListener('touchcancel', onTouchEnd);
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
    const entry: Entry = { id, element: () => latest.current.element(), escaped: () => latest.current.escaped(), take: () => latest.current.take(), seen: false };
    join(entry);
    return () => leave(entry);
  }, [id, active]);
}

/* ------------------------------------------------------------------------- Esc after a release ---- */
/** How long after a release the page swallows Esc, so the press that was mashing the view shut does not open the Menu. */
export const ESC_QUIET_MS = 600;
let quietUntil = 0;
let quiet: ((e: KeyboardEvent) => void) | null = null;

/**
 * The reader broke free by pressing Esc over and over, and the next press is already on its way: it would reach the board's
 * Esc (the Menu) and take them out of the thread they just freed themselves in. For a moment after, Esc is answered by no
 * one on the page; one pressed later is the board's. The listener keeps no timer: it reads the clock when a key comes, and
 * takes itself off with the first Esc after the moment is over.
 */
export function swallowEscAfterRelease(): void {
  quietUntil = performance.now() + ESC_QUIET_MS;
  if (quiet) return;
  const listener = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (performance.now() >= quietUntil) {
      document.removeEventListener('keydown', listener, true);
      if (quiet === listener) quiet = null;
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };
  quiet = listener;
  document.addEventListener('keydown', listener, true);
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
