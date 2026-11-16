import { rng, THROW_INSET_X, THROW_INSET_Y, THROW_SPAN_X, THROW_SPAN_Y } from './body.ts';

/**
 * Steel Chair's dent (docs/plans/2026-11-15-steel-chair-plan.md, Task 4; docs/plans/2026-11-16-steel-chair-dent-plan.md, Task 1): one height
 * map per play (`dentHeight`, from the play's `DentShape`), lit by one light into three images: the bend an SVG filter moves the words with
 * (`dentBend`, the map's slope), the shade that darkens the metal (`dentShade`) and the light that brightens it (`dentLight`). Pure
 * TypeScript apart from `pixelsUrl`, the file's one canvas, which `dentImages` draws each image on once per play. The filter itself (a flood
 * of neutral gray; each dent's `feImage` laid over neutral and added to the running map by an arithmetic `feComposite`, 0.5 + the sum of
 * (d - 0.5), so overlapping dents add and do not cut each other; one `feDisplacementMap` on the words) is written as JSX by the effect from
 * `dentPrimitives`.
 */

/**
 * The displacement at full strength, in px: `feDisplacementMap`'s `scale`. The map's strongest push is half of it either way. The filter
 * must carry `color-interpolation-filters="sRGB"`: under the default linearRGB the neutral byte 128 reads as about 0.22, not 0.5, and the
 * words would shift by several pixels everywhere.
 */
export const DENT_SCALE = 14;
/*
 * 14, and not the plan's 26 or the 18 an earlier build shipped: the plan's own review focus says the scale comes down if a dent makes a line
 * unreadable, and it did (seen in a browser at 26 the one-line post's second word was a smear, and where two dents overlap their pushes add).
 * What the constant does now: the bend (`dentBend`) is the height map's slope in the box's px, scaled so its largest channel offset is 74 bytes,
 * so the steepest point of any dent moves the words by 74/255 of `DENT_SCALE`, about 4 px at 14, whatever the dent's size; the scale sets how
 * far the words are drawn in, and the dent's own size (the surface is spread `SPREAD` times the recipe's) sets how many words that reaches. The
 * figures that first led to 14 (a 160 px dent, a 1 / (1 + scale·0.0196) squeeze at its middle) were for the first build's bend and cannot be
 * derived from the height map; 14 is the value kept from that build, and the owner judges how readable the long and the one-line posts are
 * (e2e/steel-chair.spec.ts).
 */

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
 * One dent's shape, the numbers its height map is made from: `rx` and `ry`, how far its two axes are scaled from round (0.85 to 1.15);
 * `turn`, the angle of its crease in degrees (0 up to 360); `waves`, the angular waves 2, 3 and 5 that make its bowl uneven (`amp` -0.1 to
 * 0.1, `phase` 0 to 2π); `lobes`, 2 to 4 smaller hollows near its middle (a center `u`, `v` within 0.3 of it, a `radius` 0.12 to 0.22, a `depth`
 * 0.3 to 0.6); `crumple`, a 9 by 9 lattice (row by row, -0.5 to 0.5) of the fine wrinkling.
 */
export interface DentShape {
  readonly rx: number;
  readonly ry: number;
  readonly turn: number;
  readonly waves: readonly { readonly amp: number; readonly phase: number }[];
  readonly lobes: readonly { readonly u: number; readonly v: number; readonly radius: number; readonly depth: number }[];
  readonly crumple: readonly number[];
}

/**
 * A dent's shape, from its play's id alone, through the seeded generator of body.ts: nothing about the reader and not the run's own seed, so a
 * given play's dent has the same shape for every reader and on every replay, and three plays' dents are not copies. (Where it lands is
 * the run's, and changes each run.) The id is salted with `dent|` so the shape does not move in step with a moment's seed from the same id.
 * The draws are in this order: `rx`, `ry`, `turn`, each wave's `amp` and `phase`, the lobe count, each lobe's distance, angle, `radius` and
 * `depth`, then the 81 lattice values.
 */
export function dentShape(playId: string): DentShape {
  const rand = rng(seedOfIds(['dent', playId]));
  const axis = () => AXIS_MIN + (AXIS_MAX - AXIS_MIN) * rand();
  const rx = axis(), ry = axis();
  const turn = rand() * 360;
  const waves = Array.from({ length: 3 }, () => { const amp = -0.1 + 0.2 * rand(); return { amp, phase: rand() * 2 * Math.PI }; });
  const lobes = Array.from({ length: 2 + Math.floor(3 * rand()) }, () => {
    const dist = 0.3 * rand(), angle = rand() * 2 * Math.PI;
    const radius = 0.12 + 0.1 * rand();
    const depth = 0.3 + 0.3 * rand();
    return { u: dist * Math.cos(angle), v: dist * Math.sin(angle), radius, depth };
  });
  const crumple = Array.from({ length: 81 }, () => -0.5 + rand());
  return { rx, ry, turn, waves, lobes, crumple };
}

/** One dent's `feImage`, and the box of its shading: its top left corner, its width and height, and the larger of the two, in the box's px. */
export interface DentBox { x: number; y: number; width: number; height: number }
export interface DentPrimitive extends DentBox { size: number }

/**
 * Whether two dents' footprints intersect: the ellipses, each centered in its box (`x`, `y` its top left corner, with its width and height),
 * are closer than the sum of their radii along the line between the centers. Exact for circles; for ellipses a close approximation. It
 * compares the two reaches along the line of the centers, so for two ellipses of different orientation it can MISS a graze of the rims alone
 * (each ellipse's rim bulges off that line). The effect no longer uses it to decide anything: a dent's crease is part of its height map, so
 * overlapping dents need no separate treatment.
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
 * dent's box is centered on its point. The dent's height map is made in this (axis-aligned) box (`dentImages`), so an elliptical box gives an
 * elliptical dent, and the bend, the shade and the light, all from that one map, agree.
 */
export function dentPrimitives(dents: readonly { x: number; y: number; shape?: DentShape }[], box: { width: number; height: number }): DentPrimitive[] {
  const base = Math.min(160, 0.6 * box.width);
  return dents.map((d) => {
    const width = d.shape ? (base * d.shape.rx) / AXIS_MAX : base;
    const height = d.shape ? (base * d.shape.ry) / AXIS_MAX : base;
    return { x: d.x - width / 2, y: d.y - height / 2, size: Math.max(width, height), width, height };
  });
}

/* ---------- a dent's height map, its light, and the three images ---------- */

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/*
 * `Math.hypot(a, b)` and `Math.hypot(a, b, 1)`, written out: the engine's own algorithm (scale by the largest, a compensated sum of the
 * squares, one square root), so the same bits, without the call's argument handling, which is most of the cost in the per-sample loops
 * below. Finite arguments only, which is all a map has.
 */
const hypot2 = (a: number, b: number): number => {
  const x = Math.abs(a), y = Math.abs(b);
  const max = x > y ? x : y;
  if (max === 0) return 0;
  const n1 = x / max, n2 = y / max;
  // the compensation is 0 after the first term, and the second's own error is not carried anywhere
  return Math.sqrt(n1 * n1 + n2 * n2) * max;
};
const hypot3One = (a: number, b: number): number => {
  const x = Math.abs(a), y = Math.abs(b);
  let max = x > y ? x : y;
  if (max < 1) max = 1;
  const n1 = x / max, n2 = y / max, n3 = 1 / max;
  let sum = n1 * n1;
  let s = n2 * n2, pre = sum + s;
  const comp = (pre - sum) - s;
  sum = pre;
  s = n3 * n3 - comp; pre = sum + s;
  return Math.sqrt(pre) * max;
};

/**
 * One dent's height map, `width × height` values, row by row, each sampled at a pixel's center in the box's normalized coordinates `u`, `v`
 * (-1 to 1 across the box, so an ellipse box gives an elliptical dent). Negative is pressed in. A bowl, the lobes a few blows leave in it, a
 * crease, a raised lip around the bowl, and a fine crumple only where the metal is pressed in. All of that is the plan's recipe evaluated at
 * `u' = u / SPREAD, v' = v / SPREAD` (the owner's choice of 2026-11-16 to make the dent fill its box as the approved mock's does: the recipe's
 * `r0 = 0.5` bowl would otherwise be about half the box), so the dent is the same shape, `SPREAD` times larger. Then the whole is multiplied by
 * an edge window in the box's own `ρ` (`1 - smoothstep(W0, W1, ρ)`), so it is exactly 0 from `ρ = W1` and the box's edge is never drawn.
 * Pure: the same shape and size give the same array.
 */
export function dentHeight(shape: DentShape, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  const theta = (shape.turn * Math.PI) / 180;
  const sinT = Math.sin(theta), cosT = Math.cos(theta);
  const ks = [2, 3, 5] as const;
  const lattice = shape.crumple;
  const amp = shape.waves.map((w) => w.amp), phase = shape.waves.map((w) => w.phase);
  const lobeU = shape.lobes.map((l) => l.u), lobeV = shape.lobes.map((l) => l.v);
  const lobeR2 = shape.lobes.map((l) => l.radius ** 2), lobeDepth = shape.lobes.map((l) => l.depth);
  const lobes = shape.lobes.length;
  const us = new Float64Array(width);
  for (let x = 0; x < width; x++) us[x] = ((x + 0.5) / width) * 2 - 1;
  for (let y = 0; y < height; y++) {
    const v0 = ((y + 0.5) / height) * 2 - 1;
    const gy = ((v0 / SPREAD + 1) / 2) * 8;
    // the clamps below are not reached while SPREAD is 1.5 (|u / SPREAD| is under 0.67 inside the window); they keep the lattice index in range if it changes
    const iy = Math.min(7, Math.max(0, Math.floor(gy)));
    const fy = smoothstep(0, 1, gy - iy);
    for (let x = 0; x < width; x++) {
      const bu = us[x]!;
      const rhoBox = hypot2(bu, v0);
      if (rhoBox >= W1) continue;
      const u = bu / SPREAD, v = v0 / SPREAD, rho = rhoBox / SPREAD;
      const a = Math.atan2(v, u);
      let wave = 0;
      for (let i = 0; i < 3; i++) wave += amp[i]! * Math.cos(ks[i]! * a + phase[i]!);
      const r0 = 0.5 * (1 + wave);
      let h = -Math.exp(-2.2 * (rho / r0) ** 2);
      for (let i = 0; i < lobes; i++) h -= lobeDepth[i]! * Math.exp(-(((u - lobeU[i]!) ** 2 + (v - lobeV[i]!) ** 2) / lobeR2[i]!));
      const n = u * sinT - v * cosT, t = u * cosT + v * sinT;
      h -= 0.15 * Math.exp(-((n / 0.08) ** 2)) * Math.exp(-((t / 0.4) ** 2));
      h += 0.12 * Math.exp(-(((rho - 1.05 * r0) / 0.09) ** 2));
      // the crumple: a 9 by 9 lattice, smoothstep-interpolated, only where the metal is pressed in
      const gx = ((u + 1) / 2) * 8;
      const ix = Math.min(7, Math.max(0, Math.floor(gx)));
      const fx = smoothstep(0, 1, gx - ix);
      const upper = lattice[iy * 9 + ix]! * (1 - fx) + lattice[iy * 9 + ix + 1]! * fx;
      const lower = lattice[(iy + 1) * 9 + ix]! * (1 - fx) + lattice[(iy + 1) * 9 + ix + 1]! * fx;
      h += 0.012 * (upper * (1 - fy) + lower * fy) * Math.min(1, Math.max(0, -3 * h));
      out[y * width + x] = h * (1 - smoothstep(W0, W1, rhoBox));
    }
  }
  return out;
}

const unit = (x: number, y: number, z: number): readonly [number, number, number] => { const n = Math.hypot(x, y, z); return [x / n, y / n, z / n]; };
/** The one light: from the upper left and in front (screen `y` is down). `HALF` is the vector halfway between it and the viewer. */
export const LIGHT = unit(-0.5, -0.6, 0.62);
export const HALF = unit(LIGHT[0], LIGHT[1], LIGHT[2] + 1);
/**
 * How steeply the relief reads: a sample's normal is the unit vector of (-RELIEF·SPREAD·∂h/∂u, -RELIEF·SPREAD·∂h/∂v, 1), the slopes taken in
 * the box's normalized `u`, `v`, so the look does not change with the box's size. The mock's `k = 22`, put in these units, for a surface
 * drawn at `SPREAD` 1 (the surface is stretched by `SPREAD`, so its slopes in the box's `u`, `v` are `1 / SPREAD` of the unstretched ones;
 * multiplying by `SPREAD` gives the same normals, hence the same look, only larger); the one number the owner may ask to tune in review.
 */
export const RELIEF = 0.065;
/**
 * How many times larger than the plan's first recipe the dent's surface is drawn, so that it fills its box as the approved mock's dents fill
 * theirs (the owner's choice of 2026-11-16, "make the dent fill its box"). The surface is the recipe evaluated at `(u / SPREAD, v / SPREAD)`; the
 * edge window stays in the box's own coordinates.
 */
export const SPREAD = 1.5;
/**
 * The edge window's two ends, in the box's own `ρ` (the surface is multiplied by `1 - smoothstep(W0, W1, ρ)`): `W0`, where the surface starts
 * to be eased down, and `W1`, where it reaches exactly 0. `W1` is 0.95 and not 0.98 because the lighting and the bend take central differences:
 * a sample at `ρ ≥ 0.98` reads its neighbors, and if a neighbor were not 0 it would be a byte off flat (254, light 1, bend 127). With the height
 * 0 from 0.95 a pixel's neighbors are flat out to well past 0.98 at any box a dent can be, so those samples are exactly 255 / 0 / 128. `W0` is
 * 0.8 so the ease is a long one and no outline of the box's ellipse can show.
 */
export const W0 = 0.8;
export const W1 = 0.95;

interface Lit { readonly lam: Float64Array; readonly spec: Float64Array }
/**
 * The map lit: `N·LIGHT` and `N·HALF` at every sample, the slopes by central differences in `u`, `v` (one-sided at the edge). Made once a map,
 * and the shade and the light are both drawn from it (`dentImages`).
 */
function lighting(h: Float32Array, width: number, height: number): Lit {
  const lam = new Float64Array(width * height), spec = new Float64Array(width * height);
  const du = 2 / width, dv = 2 / height, relief = RELIEF * SPREAD;
  const [lx, ly, lz] = LIGHT, [sx, sy, sz] = HALF;
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - 1), y1 = Math.min(height - 1, y + 1);
    const dy = (y1 - y0) * dv;
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(width - 1, x + 1);
      const hu = (h[y * width + x1]! - h[y * width + x0]!) / ((x1 - x0) * du);
      const hv = (h[y1 * width + x]! - h[y0 * width + x]!) / dy;
      const px = -relief * hu, py = -relief * hv;
      const len = hypot3One(px, py);
      const nx = px / len, ny = py / len, nz = 1 / len;
      lam[y * width + x] = nx * lx + ny * ly + nz * lz;
      spec[y * width + x] = nx * sx + ny * sy + nz * sz;
    }
  }
  return { lam, spec };
}

/**
 * The shade, RGBA gray and opaque: flat metal is 255 and the darkest pixel exactly 128, so that multiplied over the post it never darkens a
 * word below half. A sample is `1 + (N·LIGHT - flat)·g` (clamped), `flat = LIGHT.z`, with `g` chosen so the map's least lit sample lands on
 * 128/255. A map with no slope (which no shape gives) is all 255.
 */
export function dentShade(h: Float32Array, width: number, height: number): Uint8ClampedArray {
  return shadeOf(lighting(h, width, height));
}
function shadeOf({ lam }: Lit): Uint8ClampedArray {
  const flat = LIGHT[2];
  let lo = Infinity;
  for (let i = 0; i < lam.length; i++) lo = Math.min(lo, lam[i]!);
  const g = flat - lo > 1e-12 ? (1 - 128 / 255) / (flat - lo) : 0;
  const out = new Uint8ClampedArray(lam.length * 4);
  for (let i = 0; i < lam.length; i++) {
    const b = Math.round(255 * Math.min(1, Math.max(128 / 255, 1 + (lam[i]! - flat) * g)));
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * The light, RGBA gray and opaque, screened over the post: a soft sheen (`N·LIGHT` above flat, its largest 71/255) and a small glint (a
 * specular term `(N·HALF)^P`, its largest 140/255), summed and held to 140; 0 where the metal is flat. The glint must stay small: the samples
 * brighter than 71 are at most 4% of those inside the circle. While they are more, `P` is multiplied by 1.5 (at most 8 times; after that the
 * glint, at that `P`, is scaled to 71, which is a last resort and not a place the shapes reach).
 */
export function dentLight(h: Float32Array, width: number, height: number): Uint8ClampedArray {
  return lightOf(lighting(h, width, height), width, height);
}
function lightOf({ lam, spec }: Lit, width: number, height: number): Uint8ClampedArray {
  const n = width * height;
  const flat = LIGHT[2];
  const soft = new Float64Array(n);
  let softMax = 0;
  for (let i = 0; i < n; i++) { soft[i] = Math.max(0, lam[i]! - flat); softMax = Math.max(softMax, soft[i]!); }
  const softScale = softMax > 0 ? 71 / 255 / softMax : 0;
  const inside = new Uint8Array(n);
  let insideCount = 0;
  for (let y = 0; y < height; y++) {
    const v = ((y + 0.5) / height) * 2 - 1;
    for (let x = 0; x < width; x++) {
      if (hypot2(((x + 0.5) / width) * 2 - 1, v) < 1) { inside[y * width + x] = 1; insideCount++; }
    }
  }
  const out = new Uint8ClampedArray(n * 4);
  const glint = new Float64Array(n);
  /* A sample whose `N·HALF` is below `HALF.z` by a clear margin has `spec ** P` below the floor for every `P` here, so its glint is 0 and it is
     left out of the exponent loop (the large majority of a dent's samples; the margin is far wider than any rounding of `**`). */
  const keep = HALF[2] * (1 - 1e-9);
  const near: number[] = [];
  for (let i = 0; i < n; i++) if (spec[i]! > keep) near.push(i);
  /** Fills `glint` for exponent `P`; returns its largest. */
  const glintAt = (P: number): number => {
    const floor = HALF[2] ** P;
    const range = 1 - floor;
    let top = 0;
    for (let k = 0; k < near.length; k++) {
      const i = near[k]!;
      const g = Math.max(0, spec[i]! ** P - floor) / range;
      glint[i] = g;
      if (g > top) top = g;
    }
    return top;
  };
  /** Draws the light from `glint` with its largest `glintMax`; returns how many pixels inside the circle are over 71. */
  const draw = (glintTop: number, glintMax: number): number => {
    const glintScale = glintTop > 0 ? glintMax / glintTop : 0;
    let bright = 0;
    for (let i = 0; i < n; i++) {
      const b = Math.round(255 * Math.min(140 / 255, soft[i]! * softScale + glint[i]! * glintScale));
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = b;
      out[i * 4 + 3] = 255;
      if (inside[i] && b > 71) bright++;
    }
    return bright;
  };
  let P = 40, top = glintAt(P);
  for (let multiplied = 0; multiplied < 8; multiplied++) {
    if (draw(top, 140 / 255) <= 0.04 * insideCount) return out;
    P *= 1.5;
    top = glintAt(P);
  }
  if (draw(top, 140 / 255) <= 0.04 * insideCount) return out;
  draw(top, 71 / 255);
  return out;
}

/**
 * The bend, RGBA, opaque, blue 128: the map's slope in the box's px (`∂h/∂x`, `∂h/∂y`, central differences), scaled by one factor so that
 * the largest of the two over the map is 74 bytes (0.58 of the 127 a byte can carry: a map stretched to the whole range pushed the words
 * 1/0.58 times too far and squeezed those inside a dent near unreadable). Red is `128 + round(scale·∂h/∂x)`, green the same for `y`.
 *
 * The vector points uphill, away from the bowl's floor. What `feDisplacementMap` does with it: it draws each pixel P from the source at
 * P + scale·(C - 0.5), so the map's vector is where a pixel is sampled FROM. With the vector pointing away from the middle, a pixel on the
 * ring shows the words from farther out, so on screen the words around the ring are drawn in toward the middle, the way print sinks into a
 * dent. This direction is the plan's; the owner judges the look in review.
 */
export function dentBend(h: Float32Array, width: number, height: number): Uint8ClampedArray {
  const gx = new Float64Array(width * height), gy = new Float64Array(width * height);
  let peak = 0;
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - 1), y1 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(width - 1, x + 1);
      const i = y * width + x;
      gx[i] = (h[y * width + x1]! - h[y * width + x0]!) / (x1 - x0);
      gy[i] = (h[y1 * width + x]! - h[y0 * width + x]!) / (y1 - y0);
      peak = Math.max(peak, Math.abs(gx[i]!), Math.abs(gy[i]!));
    }
  }
  const scale = peak > 0 ? 74 / peak : 0;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = 128 + Math.round(scale * gx[i]!);
    out[i * 4 + 1] = 128 + Math.round(scale * gy[i]!);
    out[i * 4 + 2] = 128;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Pixels as a `data:` address, drawn to a canvas (the page's policy lets a filter read an image from `data:`, web/headers.ts `img-src`).
 * Empty where there is no canvas to draw on (a test's jsdom, a server): the filter is then simply not applied.
 */
export function pixelsUrl(px: Uint8ClampedArray, width: number, height: number): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  return canvas.toDataURL('image/png');
}

export interface DentImages { readonly bend: string; readonly shade: string; readonly light: string }
const IMAGE_CACHE_MAX = 32;
const imageCache = new Map<string, DentImages>();

/**
 * A dent's three images as addresses. `box` is the dent's primitive: the bend is made at its size in px (the `feImage` stretches it), the
 * shade and the light at that times `density` (the caller gives `min(devicePixelRatio, 2)`), so no image passes 320 by 320. Made once per
 * play, size and density and kept in a cache of at most 32, the oldest dropped first (a `Map`'s order). A box that rounds to under 1 px on
 * either side gets three empty addresses, is not drawn and is not cached.
 */
export function dentImages(play: string, box: DentPrimitive, density: number, toUrl: typeof pixelsUrl = pixelsUrl): DentImages {
  const w = Math.round(box.width), h = Math.round(box.height);
  // a box under 1 px on a side (not yet measured, or a very narrow post) has no image to make: `new ImageData` would throw on it
  if (w < 1 || h < 1) return { bend: '', shade: '', light: '' };
  const key = `${play}|${w}|${h}|${density}`;
  const kept = imageCache.get(key);
  if (kept) return kept;
  const shape = dentShape(play);
  const sw = Math.round(w * density), sh = Math.round(h * density);
  const bendMap = dentHeight(shape, w, h);
  const map = sw === w && sh === h ? bendMap : dentHeight(shape, sw, sh);
  const lit = lighting(map, sw, sh);
  const made = {
    bend: toUrl(dentBend(bendMap, w, h), w, h),
    shade: toUrl(shadeOf(lit), sw, sh),
    light: toUrl(lightOf(lit, sw, sh), sw, sh),
  };
  imageCache.set(key, made);
  if (imageCache.size > IMAGE_CACHE_MAX) imageCache.delete(imageCache.keys().next().value!);
  return made;
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

