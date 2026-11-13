/**
 * Bringing an element clear of what covers the window's edges. The page declares what covers them on the root: `scroll-padding-top` (the sticky menu bar,
 * glass/shell.css) and `scroll-padding-bottom` (the HUD, and any dock a card's screen sets over the foot while it is open). The clear area is what lies
 * between them. An element not wholly inside it is scrolled so its top is at the clear area's top; one taller than the area gets the same, which is as
 * much of it as can be shown. One whose top is already there is left alone, so asking again does not jiggle the page.
 *
 * Card-agnostic: a card's play on a post (play.tsx) and an instance's own draw mode both call it, once the screen that covers the edge is mounted.
 */
import { motionReduced } from '../appearance.ts';

/** How far from the clear area's top an element's top may be and still count as there, px. */
const AT_TOP_PX = 2;

const px = (value: string): number => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

export function bringClear(el: Element): void {
  if (typeof el.scrollIntoView !== 'function') return;
  const pad = getComputedStyle(document.documentElement);
  const top = px(pad.scrollPaddingTop);
  const bottom = window.innerHeight - px(pad.scrollPaddingBottom);
  const rect = el.getBoundingClientRect();
  if (Math.abs(rect.top - top) <= AT_TOP_PX) return;
  if (rect.top >= top && rect.bottom <= bottom) return;
  el.scrollIntoView({ block: 'start', behavior: motionReduced() ? 'auto' : 'smooth' });
}
