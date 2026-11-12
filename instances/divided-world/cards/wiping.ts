/**
 * What the two cards that are scrubbed on a post share (Whoops!'s ink and Graffiti's wall; Graffiti's plan, Task 9): the touch rules, the
 * pace of a save that got no answer, and the test of what lies over ink. Lifted from whoops/Effect.tsx so the wall scrubs as a splat does,
 * with the same hand: a mouse or pen is read by pointer events and a finger by touch events; a quick swipe up or down is the page's and
 * wipes nothing, a sideways swipe or a press held `HOLD_MS` wipes, a tap wipes a dab, and a second finger is the page's.
 */

/** A press held this long on ink grabs it (a finger), and one that moves this far (px) before then is a swipe, up or down the page's and sideways a wipe. */
export const HOLD_MS = 180;
export const SLOP_PX = 8;
/** How long after a touch ends the click that follows it is still swallowed. */
export const SUPPRESS_MS = 400;
/** How long after a save that did not get through the next try waits, doubling on each failure. */
export const RETRY_AFTER_MS = 2000;
/** How many times in a row a save is sent again before it is left to the author's next stroke. */
export const MAX_SAVE_RETRIES = 6;

/** What a finger that has moved `dx`, `dy` (px) from where it landed is doing: nothing yet (inside the slop), the page's scroll, or a wipe. */
export function swipeKind(dx: number, dy: number): 'wait' | 'page' | 'wipe' {
  if (Math.hypot(dx, dy) < SLOP_PX) return 'wait';
  return Math.abs(dy) > Math.abs(dx) ? 'page' : 'wipe';
}

/** Whether a press lands on something the engine lifts over the ink (the reactions row, the spun line, the Draw tile): it is that control's, and starts no stroke. */
export function overInk(target: unknown): boolean {
  /* An element (a text node or the window has no `closest`); read by shape, as this file is no DOM code. */
  const el = target as { readonly closest?: (selector: string) => unknown } | null;
  return typeof el?.closest === 'function' && el.closest('[data-kb-over-ink]') !== null;
}
