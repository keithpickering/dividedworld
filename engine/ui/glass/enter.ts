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
import { stagger, staggerItem, type ActiveFeel } from './motion.ts';

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
    if (r.bottom < 0 || r.top > viewport) continue;
    rows.push(el);
  }
  return [...heads, ...panels, ...rows];
}

/** Each entrant's delay in seconds, by place: the screen's stagger, computed once for the count. */
export function delaysFor(feel: ActiveFeel, count: number): number[] {
  return stagger(feel, count);
}

/** Plays the entrance of `screen`. Returns a stop for the screen leaving first. Under Off nothing plays. */
export function enterScreen(feel: ActiveFeel, screen: HTMLElement): () => void {
  if (!feel) return () => {};
  const items = entrants(screen);
  const delays = delaysFor(feel, items.length);
  const stops: Array<() => void> = [];
  items.forEach((el, i) => {
    const p = staggerItem(feel, delays, i);
    const from = p.initial as TargetAndTransition;
    const { transition, transitionEnd: _e, ...to } = p.animate as TargetAndTransition & { transitionEnd?: unknown };
    const frames = Object.fromEntries(Object.keys(to).map((k) => [k, [(from as Record<string, unknown>)[k], (to as Record<string, unknown>)[k]]]));
    const clear = () => { for (const k of ['opacity', 'transform', 'filter']) el.style.removeProperty(k); };
    try {
      const a = animate(el, frames as never, transition as Transition as never);
      a.then(clear, clear);
      stops.push(() => { a.stop(); clear(); });
    } catch { clear(); }
  });
  return () => stops.forEach((s) => s());
}
