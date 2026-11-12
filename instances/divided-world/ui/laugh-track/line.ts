/**
 * The reading line's arithmetic, over plain numbers, carried over from the bench (docs/research/2026-11-11-laugh-track-bench/01-bench.html):
 * where the line is in the window, how far a place is from it, and how loud a murmur is at that distance. Nothing here reads the page, so
 * the watcher (watch.ts) measures and this decides.
 */

export interface Rect { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number }
export interface Point { readonly x: number; readonly y: number }

/** The line's place in the window, in pixels from its top: `percent` of the way down the space above the HUD. */
export const readingLine = (viewportHeight: number, hudHeight: number, percent: number): number => ((viewportHeight - hudHeight) * percent) / 100;

/**
 * How far a place, drawn as these boxes (one for each line it crosses), is from the line: 0 where a box crosses it, else the gap to the
 * nearest edge. A fine pointer brings a place near as well, and its distance counts double, as the bench's does. No boxes is infinitely far.
 */
export function distance(rects: readonly Rect[], lineY: number, pointer?: Point): number {
  let best = Infinity;
  for (const r of rects) {
    const d = r.top <= lineY && r.bottom >= lineY ? 0 : Math.min(Math.abs(r.top - lineY), Math.abs(r.bottom - lineY));
    best = Math.min(best, d);
    if (pointer) {
      const dx = Math.max(r.left - pointer.x, 0, pointer.x - r.right);
      const dy = Math.max(r.top - pointer.y, 0, pointer.y - r.bottom);
      best = Math.min(best, Math.hypot(dx, dy) * 2);
    }
  }
  return best;
}

/** A murmur's gain, 0 to 1: `most` percent of a hit at the line, falling in a straight line to nothing at the reach. */
export function murmurGain(distanceToLine: number, reachPx: number, most: number): number {
  if (!(reachPx > 0) || !(distanceToLine < reachPx)) return 0;
  return (Math.max(0, most) / 100) * (1 - Math.max(0, distanceToLine) / reachPx);
}
