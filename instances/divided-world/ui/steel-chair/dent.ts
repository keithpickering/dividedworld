/**
 * Steel Chair's dent (docs/plans/2026-11-15-steel-chair-plan.md, Task 4): the displacement map an SVG filter bends the words with, and the
 * filter's numbers. Pure TypeScript apart from `dentMapUrl`, which draws the map on a canvas once. The filter itself (a flood of neutral
 * gray, each dent's `feImage` over it, one `feDisplacementMap` on the words) is written as JSX by the effect from `dentPrimitives`.
 */

/** The displacement at full strength, in px: `feDisplacementMap`'s `scale`. The map's strongest push is half of it either way. */
export const DENT_SCALE = 26;

/** The map's largest raw push, `sin(r·π)·(1 − r)` at its peak (r is about 0.35), so the ring can use the whole 0 to 255 range. */
const PEAK = (() => {
  let best = 0;
  for (let i = 0; i <= 1000; i++) { const r = i / 1000; best = Math.max(best, Math.sin(r * Math.PI) * (1 - r)); }
  return best;
})();

/**
 * The displacement map, `size` by `size` RGBA pixels. At distance `r` (0 at the center, 1 at the edge) from the center the push away
 * from it is `sin(r·π)·(1 − r)`: nothing at the center and the rim, most in a ring between. Red carries x and green y, 128 is no push,
 * blue is 128 and every pixel is opaque. Outside the circle (`r` of 1 or more) the map is neutral, so a dent's square edge shows nothing.
 */
export function dentMap(size = 160): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - half, dy = y + 0.5 - half;
      const dist = Math.hypot(dx, dy);
      const r = dist / half;
      const push = r >= 1 || dist === 0 ? 0 : (Math.sin(r * Math.PI) * (1 - r)) / PEAK;
      const i = (y * size + x) * 4;
      out[i] = 128 + Math.round(127 * push * (dist === 0 ? 0 : dx / dist));
      out[i + 1] = 128 + Math.round(127 * push * (dist === 0 ? 0 : dy / dist));
      out[i + 2] = 128;
      out[i + 3] = 255;
    }
  }
  return out;
}

let cached: string | null = null;

/**
 * The map as a `data:` address, drawn to a canvas once and kept (the page's policy lets a filter read an image from `data:`,
 * web/headers.ts `img-src`). Empty where there is no canvas to draw on (a test's jsdom): the filter is then simply not applied.
 */
export function dentMapUrl(): string {
  if (cached !== null) return cached;
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.putImageData(new ImageData(dentMap(160) as Uint8ClampedArray<ArrayBuffer>, 160, 160), 0, 0);
  cached = canvas.toDataURL('image/png');
  return cached;
}

/** Test seams: pass the user agent and whether `CSS.supports('filter', 'url(#x)')` answered yes. Both default to the running browser's. */
export interface FilterEnv { userAgent?: string; supportsFilterUrl?: boolean }

/**
 * Whether the words may carry the dent's filter. False on WebKit that is not Chromium: WebKit's `feImage` on HTML content is uneven
 * (design section 5), so the dent would warp unevenly there. Every iOS browser is WebKit whatever its name (Chrome's `CriOS`,
 * Firefox's `FxiOS`), so an iPhone, iPad or iPod user agent is untrusted too. Also false where `CSS.supports('filter', 'url(#x)')` is
 * false. Where it is false the words get no filter and the shading alone is the dent.
 */
export function filterTrusted(env: FilterEnv = {}): boolean {
  const ua = env.userAgent ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const supports = env.supportsFilterUrl ?? (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('filter', 'url(#x)'));
  if (!supports) return false;
  if (/iPhone|iPad|iPod/.test(ua)) return false;
  if (/AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg\/|OPR\//.test(ua)) return false;
  return true;
}

/** One dent's `feImage`: its top left corner and its (square) size, in the box's px. */
export interface DentPrimitive { x: number; y: number; size: number }

/**
 * Each dent's `feImage` numbers, in order: 160 px square centered on the dent's point, scaled down so that a dent is never wider than
 * 60% of the box (a narrow post would otherwise be mostly dent).
 */
export function dentPrimitives(dents: readonly { x: number; y: number }[], box: { width: number; height: number }): DentPrimitive[] {
  const size = Math.min(160, 0.6 * box.width);
  return dents.map((d) => ({ x: d.x - size / 2, y: d.y - size / 2, size }));
}
