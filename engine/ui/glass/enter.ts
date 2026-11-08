/**
 * A screen's entrance (docs/plans/2026-11-04-glass-polish-design.md, section 9, "Entrances stagger"): its head lands, then its panels, then
 * their rows, each `feel.stagger` ms after the one before, the step shortened so the last starts within the feel's `screen` whatever the
 * count (motion.ts `stagger`). It lives here, in the shared parts, so every glass screen gets it from `Page` with no code of its own: the
 * parts are found by what the shared parts draw (`PageHead`'s `.kb-page-head`, a panel's `.kb-glass-cut-panel`, a table row or a list item).
 *
 * Only what is on the page when the screen mounts enters, and only what is in the window: a row that arrives later (a response) or lies
 * below the fold appears plainly, so the entrance never depends on what a response holds or when it came, and a long log costs the rows a
 * reader can see, at most `MAX_ROWS`. The delays are computed once, for the count found, not per render and not per row.
 */
import { animate } from 'motion/react';
import type { TargetAndTransition, Transition } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useKayfa } from '../context.tsx';
import { stagger, staggerItem, useFeel, type ActiveFeel } from './motion.ts';

/** The most rows that enter: a window shows fewer, and a page of any length costs no more than this. */
export const MAX_ROWS = 60;

const HEAD = '.kb-page-head';
const PANEL = '.kb-glass-cut-panel';
/* A table body's row or a list item that is content: not the menu bar's, not a tab list's, not a hidden breakdown. */
const ROW = 'tbody > tr:not([hidden]), li';
const NOT_ROW = '.kb-glass-menu *, [role="tablist"] *, nav *, [hidden] *, [data-kb-exiting] *';

/** The elements of `screen` that enter, in order: the head, its panels, then the rows in view. */
export function entrants(screen: HTMLElement, viewport: number = window.innerHeight): HTMLElement[] {
  const heads = Array.from(screen.querySelectorAll<HTMLElement>(HEAD)).slice(0, 1);
  const panels = Array.from(screen.querySelectorAll<HTMLElement>(PANEL));
  const taken = new Set<Element>([...heads, ...panels]);
  const rows: HTMLElement[] = [];
  for (const el of screen.querySelectorAll<HTMLElement>(ROW)) {
    if (rows.length >= MAX_ROWS) break;
    if (taken.has(el) || el.matches(NOT_ROW)) continue;
    const r = el.getBoundingClientRect();
    /* Rows are in document order: the first one below the window ends the search, so a long log is not measured to its end. */
    if (r.top > viewport) break;
    if (r.bottom < 0) continue;
    rows.push(el);
  }
  return [...heads, ...panels, ...rows];
}

/** Each entrant's delay in seconds, by place: the screen's stagger, computed once for the count. */
export function delaysFor(feel: ActiveFeel, count: number): number[] {
  return stagger(feel, count);
}

/** Plays the entrance of `items`, each after the one before. Returns a stop. Under Off nothing plays. */
function play(feel: ActiveFeel, items: readonly HTMLElement[]): () => void {
  if (!feel) return () => {};
  const delays = delaysFor(feel, items.length);
  const stops: Array<() => void> = [];
  items.forEach((el, i) => {
    const p = staggerItem(feel, delays, i);
    const from = p.initial as TargetAndTransition;
    const { transition, transitionEnd: _e, ...to } = p.animate as TargetAndTransition & { transitionEnd?: unknown };
    const frames = Object.fromEntries(Object.keys(to).map((k) => [k, [(from as Record<string, unknown>)[k], (to as Record<string, unknown>)[k]]]));
    /* What the element wore inline before the entrance (a panel's own transform), put back when it ends, so the entrance only borrows those properties. */
    const prior = ['opacity', 'transform', 'filter'].map((k) => [k, el.style.getPropertyValue(k), el.style.getPropertyPriority(k)] as const);
    const clear = () => { for (const [k, v, pr] of prior) { if (v) el.style.setProperty(k, v, pr); else el.style.removeProperty(k); } };
    try {
      const a = animate(el, frames as never, transition as Transition as never);
      a.then(clear, clear);
      stops.push(() => { a.stop(); clear(); });
    } catch { clear(); }
  });
  return () => stops.forEach((s) => s());
}

/** Plays the entrance of `screen`. Returns a stop for the screen leaving first. Under Off nothing plays. */
export function enterScreen(feel: ActiveFeel, screen: HTMLElement): () => void {
  if (!feel) return () => {};
  return play(feel, entrants(screen));
}

/**
 * Plays the entrance of the rows a press brought (an older page), and only those: staggered over their count as a screen's rows are, at most
 * `MAX_ROWS`, and only those in the window. Returns a stop. Under Off nothing plays.
 */
export function enterRows(feel: ActiveFeel, rows: readonly HTMLElement[], viewport: number = window.innerHeight): () => void {
  if (!feel) return () => {};
  const seen: HTMLElement[] = [];
  for (const el of rows) {
    if (seen.length >= MAX_ROWS) break;
    const r = el.getBoundingClientRect();
    if (r.top > viewport) break;
    if (r.bottom < 0) continue;
    seen.push(el);
  }
  return play(feel, seen);
}

/** The mark a render puts on the rows an older page added; found by `useEnterAdded`'s layout effect and cleared after. */
export const ENTERING = 'data-kb-entering';

/**
 * The entrance of the rows a press adds. `arm(keys)` is called at the press with the keys of the rows on the page; `entering(key)` is true in the
 * render that adds a row not among them (put `data-kb-entering` on it); once the read has settled (`reading` false) the marked rows inside `scope`
 * are handed to `enterRows` and the marks cleared. A row drawn while the read was out arrived another way and appears plainly.
 */
export function useEnterAdded(scope: RefObject<HTMLElement | null>, reading: boolean) {
  const { ui } = useKayfa();
  const feel = useFeel(ui.glass.motion);
  const [before, setBefore] = useState<ReadonlySet<string> | null>(null);
  const stop = useRef<() => void>(() => {});
  /* Every key drawn up to the read landing: the page at the press, and whatever else arrived while it was out (a Realtime row, another tab's). */
  const seen = useRef<Set<string>>(new Set());
  useLayoutEffect(() => {
    if (before === null || reading) return;
    const rows = Array.from(scope.current?.querySelectorAll<HTMLElement>(`[${ENTERING}]`) ?? []);
    for (const el of rows) el.removeAttribute(ENTERING);
    setBefore(null);
    stop.current();
    stop.current = enterRows(feel, rows);
  }, [before, reading, feel, scope]);
  useEffect(() => () => stop.current(), []);
  return {
    arm: (keys: Iterable<string>) => { seen.current = new Set(keys); setBefore(new Set(keys)); },
    /* While the read is out every row drawn is noted as not the read's; the render it lands in marks only the rows not drawn before. */
    entering: (key: string): true | undefined => {
      if (before === null) return undefined;
      if (reading) { seen.current.add(key); return undefined; }
      return seen.current.has(key) ? undefined : true;
    },
  };
}
