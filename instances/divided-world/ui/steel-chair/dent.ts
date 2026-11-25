import { ROOM_HEIGHT } from './chair.ts';
import { objectOf, type ThrownObject } from './objects.ts';
import { rng, THROW_INSET_X, THROW_INSET_Y, THROW_SPAN_X, THROW_SPAN_Y } from './body.ts';

/**
 * Steel Chair's dent (docs/plans/2026-11-15-steel-chair-plan.md, Task 4; docs/plans/2026-11-16-steel-chair-dent-plan.md, Task 1): one height
 * map per play (`dentHeight`, from the play's `DentShape`), lit by one light into three images: the bend an SVG filter moves the words with
 * (`dentBend`, the map's slope), the shade that darkens the metal (`dentShade`, black with an alpha) and the light that brightens it
 * (`dentLight`, white with an alpha); both are laid on plainly, with no blend mode, so flat metal is alpha 0 and draws nothing over any backdrop
 * (docs/plans/2026-11-16-steel-chair-origin-design.md, section 2). A dent that overlaps earlier ones is drawn from an image corrected against
 * them (`capped`), so the cap the blend gave (the darker of two shades, the lighter of two lights) is done in the pixels. Pure
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
 * A hash (FNV-1a) of ids, so a play's id (public) gives the same number for every reader and on every replay. The effect seeds its settle sound's picks the same
 * way (Effect.tsx).
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
  /** A lobe is round (`radius`) unless it has an `across`: then it is a ridge, `across` wide along `u` and `radius` along `v` (the ladder's rung). */
  readonly lobes: readonly { readonly u: number; readonly v: number; readonly radius: number; readonly depth: number; readonly across?: number }[];
  readonly crumple: readonly number[];
}

/**
 * What differs between the objects' dents (docs/plans/2026-11-23-steel-chair-objects-design.md, section 5); the pipeline after the shape is
 * the same. `axisMin` and `axisMax` bound the first axis draw; `aspect` says how the two axes relate: `free` draws both alike (the chair), `long`
 * draws `ry` and takes `rx` as `ry` times a ratio in `ratio`, `near` draws `rx` and takes `ry` as `rx` times a ratio in `ratio`, `round` makes
 * `ry` equal `rx`. The lobe count is `lobesMin` plus a draw over `lobesSpan` values; a lobe's `radius` and `depth` are `base + span * draw`; the
 * crumple's lattice values run -`crumple` to `crumple`. The chair's values are the constants this file always had.
 */
interface DentKind {
  readonly axisMin: number; readonly axisMax: number;
  readonly aspect: 'free' | 'long' | 'near' | 'round'; readonly ratio: readonly [number, number];
  readonly lobesMin: number; readonly lobesSpan: number;
  readonly radius: readonly [number, number]; readonly depth: readonly [number, number];
  readonly crumple: number;
}
const DENT_KINDS: Readonly<Record<ThrownObject, DentKind>> = {
  chair: { axisMin: AXIS_MIN, axisMax: AXIS_MAX, aspect: 'free', ratio: [1, 1], lobesMin: 2, lobesSpan: 3, radius: [0.12, 0.1], depth: [0.3, 0.3], crumple: 0.5 },
  // long and narrow: a crease with one rung's ridge across its long axis
  ladder: { axisMin: AXIS_MIN, axisMax: AXIS_MAX, aspect: 'long', ratio: [0.35, 0.1], lobesMin: 1, lobesSpan: 1, radius: [0.12, 0.1], depth: [0.3, 0.3], crumple: 0.5 },
  // rounder (axes within 5%), 2 or 3 lobes, deeper; `axisMax` leaves room for the ratio so no axis passes AXIS_MAX
  can: { axisMin: AXIS_MIN, axisMax: AXIS_MAX / 1.04, aspect: 'near', ratio: [0.96, 0.08], lobesMin: 2, lobesSpan: 2, radius: [0.12, 0.1], depth: [0.45, 0.3], crumple: 0.5 },
  // round, 70% of the chair's size, 1 or 2 lobes, the deepest
  extinguisher: { axisMin: AXIS_MIN * 0.7, axisMax: AXIS_MAX * 0.7, aspect: 'round', ratio: [1, 0], lobesMin: 1, lobesSpan: 2, radius: [0.12, 0.1], depth: [0.6, 0.3], crumple: 0.5 },
};

/**
 * A dent's shape, from its play's id alone, through the seeded generator of body.ts: nothing about the reader and not the run's own seed, so a
 * given play's dent has the same shape for every reader and on every replay, and three plays' dents are not copies. (Where it lands is
 * the run's, and changes each run.) The id is salted with `dent|` so the shape does not move in step with the settle sound's seed from the same id.
 * The draws are in this order: `rx`, `ry`, `turn`, each wave's `amp` and `phase`, the lobe count, each lobe's distance, angle, `radius` and
 * `depth`, then the 81 lattice values. Every object draws the same count of numbers in that order (a ladder or a can reads its two axis draws
 * as a size and a ratio), and the chair's draws and results are what they were before objects, so a chair's dent is drawn from the same numbers.
 */
export function dentShape(playId: string, object: ThrownObject = 'chair'): DentShape {
  const k = DENT_KINDS[object];
  const rand = rng(seedOfIds(['dent', playId]));
  const axis = () => k.axisMin + (k.axisMax - k.axisMin) * rand();
  let rx: number, ry: number;
  if (k.aspect === 'long') { const r = k.ratio[0] + k.ratio[1] * rand(); ry = axis(); rx = ry * r; }
  else if (k.aspect === 'near') { rx = axis(); ry = rx * (k.ratio[0] + k.ratio[1] * rand()); }
  else if (k.aspect === 'round') { rx = axis(); rand(); ry = rx; }
  else { rx = axis(); ry = axis(); }
  const turn = rand() * 360;
  const waves = Array.from({ length: 3 }, () => { const amp = -0.1 + 0.2 * rand(); return { amp, phase: rand() * 2 * Math.PI }; });
  const lobes = Array.from({ length: k.lobesMin + Math.floor(k.lobesSpan * rand()) }, () => {
    const dist = 0.3 * rand(), angle = rand() * 2 * Math.PI;
    const radius = k.radius[0] + k.radius[1] * rand();
    const depth = k.depth[0] + k.depth[1] * rand();
    // the ladder's one lobe is a rung's ridge across its long axis (`ry`, the v direction): centered along it, stretched along u
    if (k.aspect === 'long') return { u: 0, v: (dist / 0.3 - 0.5) * 0.2, radius: radius * 0.6, depth, across: 0.55 + 0.4 * (angle / (2 * Math.PI)) };
    return { u: dist * Math.cos(angle), v: dist * Math.sin(angle), radius, depth };
  });
  const crumple = Array.from({ length: 81 }, () => -k.crumple + 2 * k.crumple * rand());
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

/** The most a dent's larger axis may be, in px (`dentPrimitives`). */
export const FULL_DENT = 160;
/** The least height a dent's zone may have where the area has room for the chairs below it; below that the room is given up (`zoneHeight`). */
export const LEAST_ZONE = 80;
/**
 * The height a dent may land in, from the content area's height: the area less the chairs' room (`ROOM_HEIGHT`, chair.ts) where that leaves at
 * least `LEAST_ZONE`, else the whole area (a short area gives up the room, so the dent is held to the area alone, never outside it).
 */
export function zoneHeight(areaHeight: number): number {
  const above = areaHeight - ROOM_HEIGHT;
  return above >= LEAST_ZONE ? above : areaHeight;
}

/**
 * Each dent's `feImage` numbers, in order. A dent's larger axis is at most `FULL_DENT` (160) px, at most 60% of the box's width (a narrow post
 * would otherwise be mostly dent) and at most the box's height (the caller gives the height a dent may land in, `zoneHeight`); a dent with a `shape` has its two axes scaled by it,
 * divided by `AXIS_MAX` so that the larger can never pass that limit. The
 * dent's box is centered on its point. The dent's height map is made in this (axis-aligned) box (`dentImages`), so an elliptical box gives an
 * elliptical dent, and the bend, the shade and the light, all from that one map, agree.
 */
export function dentPrimitives(dents: readonly { x: number; y: number; shape?: DentShape }[], box: { width: number; height: number }): DentPrimitive[] {
  const base = Math.min(FULL_DENT, 0.6 * box.width, box.height);
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
  const lobeR2 = shape.lobes.map((l) => l.radius ** 2), lobeA2 = shape.lobes.map((l) => (l.across ?? l.radius) ** 2), lobeDepth = shape.lobes.map((l) => l.depth);
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
      for (let i = 0; i < lobes; i++) h -= lobeDepth[i]! * Math.exp(-((u - lobeU[i]!) ** 2 / lobeA2[i]! + (v - lobeV[i]!) ** 2 / lobeR2[i]!));
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
 * The shade, RGBA black with an alpha: flat metal is alpha 0 and the darkest pixel's alpha is exactly 127 (its gray is 128), so that laid over the post it never
 * darkens a word below half. A sample's gray is `255 × (1 + (N·LIGHT - flat)·g)` (clamped), `flat = LIGHT.z`, with `g` chosen so the map's
 * least lit sample lands on 128/255; its alpha is 255 less that gray, so black at that alpha over a color `c` leaves `c × gray / 255`, which is what
 * multiplying by the gray gave. A map with no slope (which no shape gives) is alpha 0 everywhere.
 */
export function dentShade(h: Float32Array, width: number, height: number): Uint8ClampedArray {
  return alphaPixels(shadeGray(lighting(h, width, height)), 0, true);
}
/** Gray bytes as RGBA of one color with an alpha: the gray itself, or (`flip`) 255 less it. */
function alphaPixels(gray: Uint8Array, rgb: number, flip: boolean): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length * 4);
  for (let i = 0; i < gray.length; i++) {
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = rgb;
    out[i * 4 + 3] = flip ? 255 - gray[i]! : gray[i]!;
  }
  return out;
}
/** The shade's gray map (255 flat, 128 darkest), one byte a pixel: what the multiply gave, and what `capped` works on. */
function shadeGray({ lam }: Lit): Uint8Array {
  const flat = LIGHT[2];
  let lo = Infinity;
  for (let i = 0; i < lam.length; i++) lo = Math.min(lo, lam[i]!);
  const g = flat - lo > 1e-12 ? (1 - 128 / 255) / (flat - lo) : 0;
  const out = new Uint8Array(lam.length);
  for (let i = 0; i < lam.length; i++) out[i] = Math.round(255 * Math.min(1, Math.max(128 / 255, 1 + (lam[i]! - flat) * g)));
  return out;
}

/**
 * The light, RGBA white with an alpha, laid over the post (white at alpha `l` over `c` is `c + (255 - c)·l/255`, which is what screening the gray `l`
 * gave): a soft sheen (`N·LIGHT` above flat, its largest 71/255) and a small glint (a
 * specular term `(N·HALF)^P`, its largest 140/255), summed and held to 140; 0 where the metal is flat. The glint must stay small: the samples
 * brighter than 71 are at most 4% of those inside the circle. While they are more, `P` is multiplied by 1.5 (at most 8 times; after that the
 * glint, at that `P`, is scaled to 71, which is a last resort and not a place the shapes reach).
 */
export function dentLight(h: Float32Array, width: number, height: number): Uint8ClampedArray {
  return alphaPixels(lightGray(lighting(h, width, height), width, height), 255, false);
}
/** The light's gray map (0 where flat, at most 140), one byte a pixel: the alpha, and what `capped` works on. */
function lightGray({ lam, spec }: Lit, width: number, height: number): Uint8Array {
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
  const out = new Uint8Array(n);
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
      out[i] = b;
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
const CAPPED_CACHE_MAX = 8;
/** What is kept for a play at a size and density: the three addresses, and the two gray maps the shade and the light were drawn from. */
interface Kept extends DentImages { readonly shadeMap: Uint8Array; readonly lightMap: Uint8Array; readonly sw: number; readonly sh: number }
const imageCache = new Map<string, Kept>();
const cappedCache = new Map<string, DentImages>();

/** A dent for `capped`: its box in the area's px, the size of its grid in pixels, and its two gray maps (the shade's, 255 flat; the light's, 0 flat). */
export interface CapDent { readonly box: DentBox; readonly width: number; readonly height: number; readonly shade: Uint8Array; readonly light: Uint8Array }

/**
 * `own`'s shade and light corrected against the `earlier` dents, so that laid over them (and over the post) each makes what the blend made: the
 * darker of the shades and the lighter of the lights, so a word is never darkened below half. At each pixel of `own`, at its center, `m` is the
 * least of the earlier dents' shade grays there and `M` the greatest of their lights (each sampled bilinearly in that dent's own grid; 255 and 0
 * outside its box). The corrected shade gray is `255 × min(m, g) / m` (so `m × that / 255 = min(m, g)`) and the corrected light is
 * `255 × (1 - (255 - max(M, l)) / (255 - M))` (so screening it over `M` gives `max(M, l)`). Outside every earlier box nothing changes: `m` is 255
 * and `M` is 0. Pure; returns the two gray maps.
 */
export function capped(own: CapDent, earlier: readonly CapDent[]): { shade: Uint8Array; light: Uint8Array } {
  const shade = new Uint8Array(own.width * own.height), light = new Uint8Array(own.width * own.height);
  const near = earlier.filter((e) => intersects(own.box, e.box));
  const sx = own.box.width / own.width, sy = own.box.height / own.height;
  for (let y = 0; y < own.height; y++) {
    const py = own.box.y + (y + 0.5) * sy;
    for (let x = 0; x < own.width; x++) {
      const px = own.box.x + (x + 0.5) * sx;
      const i = y * own.width + x;
      let m = 255, big = 0;
      for (const e of near) {
        if (px < e.box.x || px > e.box.x + e.box.width || py < e.box.y || py > e.box.y + e.box.height) continue;
        const gx = ((px - e.box.x) / e.box.width) * e.width - 0.5, gy = ((py - e.box.y) / e.box.height) * e.height - 0.5;
        m = Math.min(m, sample(e.shade, e.width, e.height, gx, gy));
        big = Math.max(big, sample(e.light, e.width, e.height, gx, gy));
      }
      const g = own.shade[i]!, l = own.light[i]!;
      shade[i] = m > 0 ? Math.round((255 * Math.min(m, g)) / m) : 255;
      light[i] = big < 255 ? Math.round(255 * (1 - (255 - Math.max(big, l)) / (255 - big))) : 0;
    }
  }
  return { shade, light };
}
const intersects = (a: DentBox, b: DentBox) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/** A gray map sampled bilinearly at the grid coordinates `(gx, gy)` (a pixel's center is at its integer index), held to the grid's edge. */
function sample(map: Uint8Array, width: number, height: number, gx: number, gy: number): number {
  const x = Math.min(width - 1, Math.max(0, gx)), y = Math.min(height - 1, Math.max(0, gy));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const top = map[y0 * width + x0]! * (1 - fx) + map[y0 * width + x1]! * fx;
  const bottom = map[y1 * width + x0]! * (1 - fx) + map[y1 * width + x1]! * fx;
  return top * (1 - fy) + bottom * fy;
}

/** A play's images at a size and density, made once and kept (the three addresses and the two gray maps). */
function keptOf(play: string, w: number, h: number, density: number, toUrl: typeof pixelsUrl, object: ThrownObject): Kept {
  const key = `${play}|${object}|${w}|${h}|${density}`;
  const kept = imageCache.get(key);
  if (kept) return kept;
  const shape = dentShape(play, object);
  const sw = Math.round(w * density), sh = Math.round(h * density);
  const bendMap = dentHeight(shape, w, h);
  const map = sw === w && sh === h ? bendMap : dentHeight(shape, sw, sh);
  const lit = lighting(map, sw, sh);
  const shadeMap = shadeGray(lit), lightMap = lightGray(lit, sw, sh);
  const made: Kept = {
    bend: toUrl(dentBend(bendMap, w, h), w, h),
    shade: toUrl(alphaPixels(shadeMap, 0, true), sw, sh),
    light: toUrl(alphaPixels(lightMap, 255, false), sw, sh),
    shadeMap, lightMap, sw, sh,
  };
  imageCache.set(key, made);
  if (imageCache.size > IMAGE_CACHE_MAX) imageCache.delete(imageCache.keys().next().value!);
  return made;
}

/**
 * A dent's three images as addresses. `box` is the dent's primitive: the bend is made at its size in px (the `feImage` stretches it), the
 * shade and the light at that times `density` (the caller gives `min(devicePixelRatio, 2)`), so no image passes 320 by 320. Made once per
 * play, size and density and kept in a cache of at most 32, the oldest dropped first (a `Map`'s order). A box that rounds to under 1 px on
 * either side gets three empty addresses, is not drawn and is not cached.
 *
 * `earlier` are the dents drawn before this one, each with its play and its box in the same space as `box`. Where none of them intersects
 * `box` the images are the kept ones. Otherwise the bend is as kept, and the shade and the light are made from `capped` against the earlier
 * dents that intersect, and kept in a second cache of at most 8, keyed by the play, size, density and each such dent's play, size and offset
 * from this one (rounded to 1 / density px).
 */
export function dentImages(
  play: string, box: DentPrimitive, density: number,
  earlier: readonly { readonly play: string; readonly box: DentBox; readonly object?: ThrownObject }[] = [], toUrl: typeof pixelsUrl = pixelsUrl,
  object: ThrownObject = objectOf(play),
): DentImages {
  const w = Math.round(box.width), h = Math.round(box.height);
  // a box under 1 px on a side (not yet measured, or a very narrow post) has no image to make: `new ImageData` would throw on it
  if (w < 1 || h < 1) return { bend: '', shade: '', light: '' };
  const own = keptOf(play, w, h, density, toUrl, object);
  const near = earlier.filter((e) => Math.round(e.box.width) >= 1 && Math.round(e.box.height) >= 1 && intersects(box, e.box));
  if (near.length === 0) return { bend: own.bend, shade: own.shade, light: own.light };
  const step = (v: number) => Math.round(v * density) / density;
  const key = `${play}|${object}|${w}|${h}|${density}|` + near.map((e) => `${e.play}|${e.object ?? objectOf(e.play)}@${step(e.box.x - box.x)},${step(e.box.y - box.y)}:${Math.round(e.box.width)}x${Math.round(e.box.height)}`).join('|');
  const hit = cappedCache.get(key);
  if (hit) return hit;
  const others: CapDent[] = near.map((e) => {
    const k = keptOf(e.play, Math.round(e.box.width), Math.round(e.box.height), density, toUrl, e.object ?? objectOf(e.play));
    return { box: e.box, width: k.sw, height: k.sh, shade: k.shadeMap, light: k.lightMap };
  });
  const out = capped({ box, width: own.sw, height: own.sh, shade: own.shadeMap, light: own.lightMap }, others);
  const made: DentImages = {
    bend: own.bend,
    shade: toUrl(alphaPixels(out.shade, 0, true), own.sw, own.sh),
    light: toUrl(alphaPixels(out.light, 255, false), own.sw, own.sh),
  };
  cappedCache.set(key, made);
  if (cappedCache.size > CAPPED_CACHE_MAX) cappedCache.delete(cappedCache.keys().next().value!);
  return made;
}

/* ---------- the hit zone of a short post ---------- */

/** Where throwOf (body.ts) lets a throw's target fall in the box it is given: this fraction of the way across, and down (body.ts's inset and span). */
export const THROW_X = [THROW_INSET_X, THROW_INSET_X + THROW_SPAN_X] as const;
export const THROW_Y = [THROW_INSET_Y, THROW_INSET_Y + THROW_SPAN_Y] as const;

/**
 * The box to hand `throwOf` for a dent of `dent`'s size, from the box the text takes (`text`, in the content area's px) in an area of `area`
 * size. Where the text is at least a dent's diameter (its larger axis) tall, the zone of centers is the range `throwOf` would reach in the
 * text's own box, each end held in so the dent's box stays inside the area (a text lying against a border would otherwise put the center
 * closer to it than the dent's radius). Where it is shorter (one line, a few), a throw aimed only at it would stack every dent on the line, so the box grows (owner, 2026-11-15: widen the
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
  const span = (lo: number, hi: number, radius: number, extent: number): [number, number] => {
    if (extent <= 2 * radius) return [extent / 2, extent / 2];
    const clamp = (v: number) => Math.min(extent - radius, Math.max(radius, v));
    return [clamp(lo), clamp(hi)];
  };
  const tall = text.height >= diameter;
  const [x0, x1] = span(
    tall ? text.left + THROW_X[0] * text.width : text.left - dent.width, tall ? text.left + THROW_X[1] * text.width : text.left + text.width + dent.width,
    dent.width / 2, area.width,
  );
  const [y0, y1] = span(
    tall ? text.top + THROW_Y[0] * text.height : text.top - dent.height / 2, tall ? text.top + THROW_Y[1] * text.height : text.top + text.height + dent.height,
    dent.height / 2, area.height,
  );
  const width = (x1 - x0) / (THROW_X[1] - THROW_X[0]), height = (y1 - y0) / (THROW_Y[1] - THROW_Y[0]);
  return { left: x0 - THROW_X[0] * width, top: y0 - THROW_Y[0] * height, width, height };
}
