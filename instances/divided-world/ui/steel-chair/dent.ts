import { rng, THROW_INSET_X, THROW_INSET_Y, THROW_SPAN_X, THROW_SPAN_Y } from './body.ts';

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
export const DENT_SCALE = 14;
/*
 * 14, and not the plan's 26 or the 18 an earlier build shipped: the plan's own review focus says the scale comes down if a dent makes a line
 * unreadable, and it did. A dent is 160 px across and squeezes the words at its middle by 1 / (1 + scale·0.0196) (66% at 26, 74% at 18), and
 * stretches them at its rim; seen in a browser at 26 the one-line post's second word was a smear, and where two dents overlap their squeezes
 * add. At 18 every word of the long post reads at desktop and phone width, with one dent and with three overlapping, and the one-line post
 * reads with one dent. Dents are now smaller (a dent's larger axis is its base, its smaller within 26% of it; an average dent is 87% of the
 * old 160 px), and a smaller dent at the same scale bends its words more steeply, by the ratio of the sizes, so the scale came down by the
 * same: 18 / 1.23 is about 14.6, taken as 14. The owner asked that the one-line post's three dents leave the line readable; the dents still
 * read as dents on the long post, where the shading and the bend of a ring of words around each are plain at 14 (e2e/steel-chair.spec.ts).
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

/* ---------- a dent's own shape and turn ---------- */

/** The range a dent's two axes are scaled within, as a fraction of round: within about 15% of round (owner's answer, 2026-11-15). */
export const AXIS_MIN = 0.85;
export const AXIS_MAX = 1.15;
/**
 * A hash (FNV-1a) of ids, so a play's id (public) gives the same number for every reader and on every replay. A moment's seed is made the same
 * way from the plays' ids (Effect.tsx).
 */
export function seedOfIds(ids: readonly string[]): number {
  let h = 2166136261;
  for (const ch of ids.join('|')) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * One dent's shape: `rx` and `ry`, how far its two axes are scaled from round (0.85 to 1.15); `turn`, how many degrees its light and creases
 * are turned (0 up to 360); `outline`, four points (42 to 58, percent) that make the edge of the shading uneven (CSS `border-radius`'s four
 * corners, each split at its own point instead of at 50%).
 */
export interface DentShape { readonly rx: number; readonly ry: number; readonly turn: number; readonly outline: readonly [number, number, number, number] }

/**
 * A dent's shape, from its play's id alone, through the seeded generator of body.ts: nothing about the reader and not the run's own seed, so a
 * given play's dent has the same shape and turn for every reader and on every replay, and three plays' dents are not copies. (Where it lands is
 * the run's, and changes each run.) The id is salted with `dent|` so the shape does not move in step with a moment's seed from the same id.
 */
export function dentShape(playId: string): DentShape {
  const rand = rng(seedOfIds(['dent', playId]));
  const axis = () => AXIS_MIN + (AXIS_MAX - AXIS_MIN) * rand();
  const rx = axis(), ry = axis();
  const turn = rand() * 360;
  const point = () => 42 + 16 * rand();
  return { rx, ry, turn, outline: [point(), point(), point(), point()] };
}

/** One dent's `feImage`, and the box of its shading: its top left corner, its width and height, and the larger of the two, in the box's px. */
export interface DentBox { x: number; y: number; width: number; height: number }
export interface DentPrimitive extends DentBox { size: number }

/**
 * Two dents' footprints intersect: the ellipses, each centered in its box (`x`, `y` its top left corner, with its width and height), are
 * closer than the sum of their radii along the line between the centers. Exact for circles; for ellipses a close approximation, which is
 * enough to decide whether the creases are drawn. It compares the two reaches along the line of the centers, so for two ellipses of different
 * orientation it can also MISS a graze of the rims alone (each ellipse's rim bulges off that line). That is accepted: the rim is the faintest part
 * of a dent, and the creases, short of it, do not reach that far, so a graze there shows nothing the creases could cross.
 */
export function dentsOverlap(a: DentBox, b: DentBox): boolean {
  const ax = a.x + a.width / 2, ay = a.y + a.height / 2, bx = b.x + b.width / 2, by = b.y + b.height / 2;
  const dx = bx - ax, dy = by - ay;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return true;
  const reach = (e: DentBox) => {
    const rx = e.width / 2, ry = e.height / 2;
    const c = dx / dist, s = dy / dist;
    return (rx * ry) / Math.hypot(ry * c, rx * s);
  };
  return dist < reach(a) + reach(b);
}

/**
 * Each dent's `feImage` numbers, in order. A dent's larger axis is at most 160 px and at most 60% of the box (a narrow post would otherwise
 * be mostly dent); a dent with a `shape` has its two axes scaled by it, divided by `AXIS_MAX` so that the larger can never pass that limit. The
 * dent's box is centered on its point. The displacement map is a circle: the `feImage` stretches it to this (axis-aligned) box, which is the
 * ellipse the shading draws too, so the bend and the shading agree; only the shading's light, creases and uneven edge turn, which the map
 * cannot (an `feImage` cannot be rotated).
 */
export function dentPrimitives(dents: readonly { x: number; y: number; shape?: DentShape }[], box: { width: number; height: number }): DentPrimitive[] {
  const base = Math.min(160, 0.6 * box.width);
  return dents.map((d) => {
    const width = d.shape ? (base * d.shape.rx) / AXIS_MAX : base;
    const height = d.shape ? (base * d.shape.ry) / AXIS_MAX : base;
    return { x: d.x - width / 2, y: d.y - height / 2, size: Math.max(width, height), width, height };
  });
}

/* ---------- the hit zone of a short post ---------- */

/** Where throwOf (body.ts) lets a throw's target fall in the box it is given: this fraction of the way across, and down (body.ts's inset and span). */
export const THROW_X = [THROW_INSET_X, THROW_INSET_X + THROW_SPAN_X] as const;
export const THROW_Y = [THROW_INSET_Y, THROW_INSET_Y + THROW_SPAN_Y] as const;

/**
 * The box to hand `throwOf` for a dent of `dent`'s size, from the box the text takes (`text`, in the content area's px) in an area of `area`
 * size. Where the text is at least a dent's diameter (its larger axis) tall, the box is the text's, as it was. Where it is shorter (one
 * line, a few), a throw aimed only at it would stack every dent on the line, so the box grows (owner, 2026-11-15: widen the
 * zone so the dents can land outside the single line, which looks more natural than tightly packed dents with perfect aim): the dent's center
 * may fall up to one full dent diameter (its extent on that axis) beyond the text's box to the left, to the right and below, so a dent may land
 * wholly beside the text, and up to its radius above it (the area's top is close above the first line anyway). Its circle is kept inside the
 * area (its center between one radius from each border); where the area is smaller than the dent the zone is the area's middle on that axis.
 * The floor's room at the content area's foot is not this function's concern: the caller (Effect.tsx `aim`) passes the area less the room's
 * height, so the dent's circle stays above where the chairs lie (a post's area is at least 22.5em tall, so the zone fits above the room).
 * `throwOf` takes a target 15% to 85% across and 15% to 60% down the box it gets (body.ts `THROW_INSET_X` and the rest), so the box is sized
 * and placed so that this range is exactly the zone of centers wanted.
 */
export function hitZone(
  text: { left: number; top: number; width: number; height: number },
  area: { width: number; height: number },
  dent: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  const diameter = Math.max(dent.width, dent.height);
  if (text.height >= diameter) return text;
  const span = (lo: number, hi: number, radius: number, extent: number): [number, number] => {
    if (extent <= 2 * radius) return [extent / 2, extent / 2];
    const clamp = (v: number) => Math.min(extent - radius, Math.max(radius, v));
    return [clamp(lo), clamp(hi)];
  };
  const [x0, x1] = span(text.left - dent.width, text.left + text.width + dent.width, dent.width / 2, area.width);
  const [y0, y1] = span(text.top - dent.height / 2, text.top + text.height + dent.height, dent.height / 2, area.height);
  const width = (x1 - x0) / (THROW_X[1] - THROW_X[0]), height = (y1 - y0) / (THROW_Y[1] - THROW_Y[0]);
  return { left: x0 - THROW_X[0] * width, top: y0 - THROW_Y[0] * height, width, height };
}
