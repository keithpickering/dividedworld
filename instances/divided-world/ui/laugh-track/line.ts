/**
 * The reading line's arithmetic, over plain numbers, carried over from the bench (docs/research/2026-11-11-laugh-track-bench/01-bench.html):
 * where the line is in the window, how far a place is from it, and how loud a murmur is at that distance. Nothing here reads the page, so
 * the watcher (watch.ts) measures and this decides.
 */

export interface Rect { readonly top: number; readonly bottom: number; readonly left: number; readonly right: number }
export interface Point { readonly x: number; readonly y: number }

/** The line's place in the window, in pixels from its top: `percent` of the way down the space above the HUD. */
export const readingLine = (viewportHeight: number, hudHeight: number, percent: number): number => ((viewportHeight - hudHeight) * percent) / 100;

/** The band a place must be in to be read: a stretch of the window, in pixels from its top. */
export interface Band { readonly top: number; readonly bottom: number }

/**
 * The band, centered on the reading line and `bandPercent` of the reading space (the window above the HUD) tall, cut to that space where
 * it would pass the window's top or the HUD's top. It replaced the line's rest: a place fires from being in the band, not from a row on a
 * line with no thickness.
 */
export function bandOf(viewportHeight: number, hudHeight: number, linePercent: number, bandPercent: number): Band {
  const space = viewportHeight - hudHeight;
  const line = readingLine(viewportHeight, hudHeight, linePercent);
  const half = (space * bandPercent) / 200;
  return { top: Math.max(line - half, 0), bottom: Math.min(line + half, space) };
}

/** Whether the middle of any of a place's boxes is inside the band. A box that only overlaps an edge, its middle outside, is not. No boxes is not. */
export const inBand = (rects: readonly Rect[], band: Band): boolean => rects.some((r) => {
  const middle = (r.top + r.bottom) / 2;
  return middle >= band.top && middle <= band.bottom;
});

/**
 * How far a place, drawn as these boxes (one for each line it crosses), is from the band: 0 where the middle of a box is in it, else the gap
 * from the nearest box's middle to the band's nearer edge. A fine pointer brings a place near as well, and its distance counts double, as the
 * bench's does. No boxes is infinitely far.
 */
export function distance(rects: readonly Rect[], band: Band, pointer?: Point): number {
  let best = Infinity;
  for (const r of rects) {
    const middle = (r.top + r.bottom) / 2;
    best = Math.min(best, Math.max(band.top - middle, 0, middle - band.bottom));
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
