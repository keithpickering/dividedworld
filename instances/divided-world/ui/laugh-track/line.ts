/**
 * The reading line's arithmetic, over plain numbers, carried over from the bench (docs/research/2026-11-11-laugh-track-bench/01-bench.html):
 * where the line is in the window, how far a place is from it, how near that is from 0 to 1, and how loud a murmur is at that nearness. The
 * line is back (docs/plans/2026-11-12-laugh-track-point-design.md §2): the band that replaced it was for dwelling, a place read by being in
 * a stretch of the window, and a place is now read by a gesture and heard by its nearness to the line. Nothing here reads the page, so the
 * watcher (watch.ts) measures and this decides.
 */

export interface Rect { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number }
export interface Point { readonly x: number; readonly y: number }

/** The line's place in the window, in pixels from its top: `percent` of the way down the space above the HUD. */
export const readingLine = (viewportHeight: number, hudHeight: number, percent: number): number => ((viewportHeight - hudHeight) * percent) / 100;

/**
 * How far a place, drawn as these boxes (one for each line it crosses), is from the line: 0 where the line is inside a box, else the gap from
 * the line to the nearest box's nearer edge. A fine pointer brings a place near as well, and its distance counts double, as the bench's does.
 * No boxes is infinitely far.
 */
export function distance(rects: readonly Rect[], lineY: number, pointer?: Point): number {
  let best = Infinity;
  for (const r of rects) {
    best = Math.min(best, Math.max(r.top - lineY, 0, lineY - r.bottom));
    if (pointer) {
      const dx = Math.max(r.left - pointer.x, 0, pointer.x - r.right);
      const dy = Math.max(r.top - pointer.y, 0, pointer.y - r.bottom);
      best = Math.min(best, Math.hypot(dx, dy) * 2);
    }
  }
  return best;
}

/** How near a distance is, 0 to 1: 1 on the line, falling in a straight line to 0 at the reach and past it. A reach of 0 or less, or a distance that is not a number, is 0. */
export function nearness(distance: number, reachPx: number): number {
  if (!(reachPx > 0) || !(distance < reachPx)) return 0;
  return 1 - Math.max(0, distance) / reachPx;
}

/** A murmur's gain, 0 to 1: `most` percent of a hit at the line, falling in a straight line to nothing at the reach. */
export const murmurGain = (distanceToLine: number, reachPx: number, most: number): number => (Math.max(0, most) / 100) * nearness(distanceToLine, reachPx);
