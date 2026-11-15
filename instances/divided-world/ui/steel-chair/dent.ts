/**
 * Steel Chair's dent (docs/plans/2026-11-15-steel-chair-plan.md, Task 4): the displacement map an SVG filter bends the words with, and the
 * filter's numbers. Pure TypeScript apart from `dentMapUrl`, which draws the map on a canvas once. The filter itself (a flood of neutral
 * gray; each dent's `feImage` laid over neutral and added to the running map by an arithmetic `feComposite`, 0.5 + the sum of (d - 0.5), so
 * overlapping dents add and do not cut each other; one `feDisplacementMap` on the words) is written as JSX by the effect from `dentPrimitives`.
 */

/**
 * The displacement at full strength, in px: `feDisplacementMap`'s `scale`. The map's strongest push is half of it either way. The filter
 * must carry `color-interpolation-filters="sRGB"`: under the default linearRGB the neutral byte 128 reads as about 0.22, not 0.5, and the
 * words would shift by several pixels everywhere.
 */
export const DENT_SCALE = 18;
/*
 * 18, and not the plan's 26: the plan's own review focus says the scale comes down if a dent makes a line unreadable, and it did. A dent is
 * 160 px across and squeezes the words at its middle by 1 / (1 + scale·0.0196) (66% at 26, 74% at 18), and stretches them at its rim; seen in a
 * browser at 26 the one-line post's second word was a smear, and where two dents overlap their squeezes add. At 18 every word of the long post
 * reads at desktop and phone width, with one dent and with three overlapping, and the one-line post reads with one dent.
 */

/**
 * The displacement map, `size` by `size` RGBA pixels. At distance `r` (0 at the center, 1 at the edge) from the center the push away
 * from it is `sin(r·π)·(1 − r)`: nothing at the center and the rim, most in a ring between. Red carries x and green y, 128 is no push,
 * blue is 128 and every pixel is opaque. The push is the plan's bytes, 128 + 127·sin(r·π)·(1 − r), and is not stretched to fill the range: its
 * peak (r of about 0.35) is 0.58 of 127, and a stretched map pushed the words 1/0.58 times too far.
 * Outside the circle (`r` of 1 or more) the map is neutral, so a dent's square edge shows nothing.
 *
 * What `feDisplacementMap` does with it: it draws each pixel P from the source at P + scale·(C − 0.5), so the map's vector is where a
 * pixel is sampled FROM. With the vector pointing away from the center, a pixel on the ring shows the words from farther out, so on
 * screen the words around the ring are drawn in toward the middle, the way print sinks into a dent. This direction is the plan's; the
 * owner judges the look in review.
 */
export function dentMap(size = 160): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - half, dy = y + 0.5 - half;
      const dist = Math.hypot(dx, dy);
      const r = dist / half;
      const push = r >= 1 || dist === 0 ? 0 : Math.sin(r * Math.PI) * (1 - r);
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
