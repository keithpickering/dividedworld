/**
 * Whoops!'s pure half (the screens' design, section 11; refinements design, section 2): the splat a play's seed
 * draws, and the shading an ink's luminance gives it. No DOM: `Effect.tsx` and the painter draw what this returns,
 * and a mask asks `covers` which points the ink holds.
 *
 * A play stores only a seed (the server's, a 31-bit integer) and an ink, so every reader rebuilds the same splat
 * from them: the generator is a seeded PRNG and nothing here reads a clock or Math.random.
 *
 * A splat is a field of balls (metaballs). Its ink is wherever the balls' summed field reaches THRESHOLD. Each ball
 * adds (1 - d^2/R^2)^3 within R = 2r, so a lone ball's edge sits at its radius, and where balls are near each other
 * their fields add: every join is rounded, and only droplets stand apart, round.
 *
 * Kept round: the balls are made in a design box 1.25 wide by 1 tall. A center is placed by shares of the body's box
 * on the screen, so the spread fits the body; a radius is measured in px, one design unit being
 * sqrt(w * h / 1.25) px. So a droplet is round on every screen and the splat is never stretched. The outline differs
 * a little between screens, and nothing that crosses screens depends on it: only strokes and the clean mark travel.
 */

/** A 32-bit PRNG (mulberry32): the same seed always gives the same run of numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


export interface Ball { readonly x: number; readonly y: number; readonly r: number } // design box 1.25 x 1
export interface Splat {
  readonly balls: readonly Ball[];
  /** The core's center in the design box, where the seed put it. */
  readonly placement: { cx: number; cy: number };
}
/** The body's box on this screen, CSS px. */
export interface Box { readonly w: number; readonly h: number }
export const DESIGN = { w: 1.25, h: 1 } as const;
/** The field's iso level: a lone ball's edge sits at its radius. */
export const THRESHOLD = 0.42;

/** The splat for a seed, in the design box: a core, a ring, arms of beads with bulbs and droplets, and flecks. */
export function makeSplat(seed: number): Splat {
  const r = mulberry32(seed);
  const balls: Ball[] = [];
  const cx = DESIGN.w / 2 + (r() - 0.5) * 0.14, cy = DESIGN.h / 2 + (r() - 0.5) * 0.1;
  const harm = [2, 3, 4, 5, 7].map((k) => ({ k, a: (0.05 + r() * 0.11) / Math.sqrt(k / 2), p: r() * Math.PI * 2 }));
  const swell = (th: number) => { let m = 1; for (const h of harm) m += h.a * Math.sin(h.k * th + h.p); return Math.max(0.65, Math.min(1.3, m)); };
  const R0 = 0.27;
  balls.push({ x: cx, y: cy, r: 0.22 });
  for (let i = 0; i < 6; i++) {
    const th = r() * Math.PI * 2, d = r() * 0.14;
    balls.push({ x: cx + Math.cos(th) * d * 1.25, y: cy + Math.sin(th) * d, r: 0.14 + r() * 0.05 });
  }
  const ring = 15;
  for (let i = 0; i < ring; i++) {
    const th = ((i + (r() - 0.5) * 0.5) / ring) * Math.PI * 2, m = swell(th);
    balls.push({ x: cx + Math.cos(th) * R0 * m * 1.3, y: cy + Math.sin(th) * R0 * m, r: 0.1 + r() * 0.06 });
  }
  const arms = 9 + Math.floor(r() * 7);
  for (let a = 0; a < arms; a++) {
    const th = r() * Math.PI * 2, m = swell(th);
    const sx = cx + Math.cos(th) * R0 * m * 1.3 * 0.95, sy = cy + Math.sin(th) * R0 * m * 0.95;
    const len = 0.14 + r() * 0.32, w = 0.03 + r() * 0.035, bend = (r() - 0.5) * 0.7, beads = 10;
    for (let k = 1; k <= beads; k++) {
      const f = k / beads, ang = th + bend * f * f, d = len * f;
      balls.push({ x: sx + Math.cos(ang) * d, y: sy + Math.sin(ang) * d, r: w * (1 - 0.62 * f) });
    }
    const ang = th + bend;
    balls.push({ x: sx + Math.cos(ang) * len, y: sy + Math.sin(ang) * len, r: w * 0.72 });
    const drops = 1 + Math.floor(r() * 3);
    for (let j = 0; j < drops; j++) {
      const d = len + 0.05 + r() * 0.14, aj = ang + (r() - 0.5) * 0.35;
      balls.push({ x: sx + Math.cos(aj) * d, y: sy + Math.sin(aj) * d, r: w * (0.28 + r() * 0.42) });
    }
  }
  const flecks = 5 + Math.floor(r() * 7);
  for (let i = 0; i < flecks; i++) {
    const th = r() * Math.PI * 2, d = 0.55 + r() * 0.25;
    balls.push({ x: cx + Math.cos(th) * d * 1.3, y: cy + Math.sin(th) * d, r: 0.008 + r() * 0.02 });
  }
  return { balls, placement: { cx, cy } };
}

/** How many px a design unit is on this screen: radii scale with the box's area, so a ball stays round. */
export function unitPx(box: Box): number {
  return Math.sqrt((box.w * box.h) / DESIGN.w);
}

/** The summed field at the point (u * w, v * h) px, u and v being shares of the box. */
export function fieldAt(splat: Splat, box: Box, u: number, v: number): number {
  const px = u * box.w, py = v * box.h, unit = unitPx(box);
  let sum = 0;
  for (const b of splat.balls) {
    const R = 2 * b.r * unit;
    const dx = px - (b.x / DESIGN.w) * box.w, dy = py - b.y * box.h;
    const d2 = dx * dx + dy * dy;
    if (d2 < R * R) sum += (1 - d2 / (R * R)) ** 3;
  }
  return sum;
}

/** Whether the splat's ink holds a point (shares of the box). It sums every ball: for a stroke's points, not per pixel. */
export function covers(splat: Splat, box: Box, u: number, v: number): boolean {
  return fieldAt(splat, box, u, v) >= THRESHOLD;
}

/**
 * The field over ceil(w * density) by ceil(h * density) pixels, row by row, sampled at pixel centers. Each ball
 * touches only the pixels within its reach, so the cost is the ink's area and not the balls times the box.
 */
export function fieldGrid(splat: Splat, box: Box, density: number): Float32Array {
  const gw = Math.ceil(box.w * density), gh = Math.ceil(box.h * density);
  const out = new Float32Array(gw * gh);
  const unit = unitPx(box);
  for (const b of splat.balls) {
    const R = 2 * b.r * unit * density;
    const bx = (b.x / DESIGN.w) * box.w * density, by = b.y * box.h * density;
    const x0 = Math.max(0, Math.floor(bx - R)), x1 = Math.min(gw - 1, Math.ceil(bx + R));
    const y0 = Math.max(0, Math.floor(by - R)), y1 = Math.min(gh - 1, Math.ceil(by + R));
    const R2 = R * R;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - by, row = y * gw;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - bx, d2 = dx * dx + dy * dy;
        if (d2 < R2) { const k = 1 - d2 / R2; out[row + x]! += k * k * k; }
      }
    }
  }
  return out;
}

/**
 * The colors a card accepts are `color()`'s in engine/rules/cards.ts: a named one from the post parser's
 * list, or #rgb or #rrggbb. These are the CSS values of those names, so a luminance is computed without a
 * DOM. A test holds this table to name every one of the parser's NAMED_COLORS, so no ink a card accepts
 * throws when drawn; the values themselves are CSS's, read off its named-color list.
 */
const NAMED: Readonly<Record<string, string>> = {
  black: '#000000', silver: '#c0c0c0', gray: '#808080', grey: '#808080', white: '#ffffff', maroon: '#800000', red: '#ff0000',
  purple: '#800080', fuchsia: '#ff00ff', green: '#008000', lime: '#00ff00', olive: '#808000', yellow: '#ffff00', navy: '#000080',
  blue: '#0000ff', teal: '#008080', aqua: '#00ffff', orange: '#ffa500', pink: '#ffc0cb', brown: '#a52a2a', gold: '#ffd700',
  cyan: '#00ffff', magenta: '#ff00ff', violet: '#ee82ee', indigo: '#4b0082', crimson: '#dc143c', coral: '#ff7f50',
  salmon: '#fa8072', turquoise: '#40e0d0', tan: '#d2b48c', khaki: '#f0e68c', beige: '#f5f5dc',
};

export function rgbOf(ink: string): [number, number, number] {
  const v = ink.trim().toLowerCase();
  let hex = NAMED[v] ?? v;
  if (/^#[0-9a-f]{3}$/.test(hex)) hex = `#${[1, 2, 3].map((i) => hex[i]!.repeat(2)).join('')}`;
  if (!/^#[0-9a-f]{6}$/.test(hex)) throw new RangeError(`not an ink color: ${ink}`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(ink: string): number {
  const [r, g, b] = rgbOf(ink).map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface Shading {
  readonly luminance: number;
  /** Opacity of the white wet highlight: strongest on a dark ink, none on white. */
  readonly highlight: number;
  /** A pale ink's soft shadow around the outside edge, so it has an outline on a white page: opacity, then blur and downward offset in pixels at the reference width. */
  readonly edgeShadow: number;
  readonly edgeBlur: number;
  readonly edgeOffset: number;
  /** Opacity of the darker underside (a black wash toward the bottom of the blob): a little on every ink, more on a pale one. */
  readonly underside: number;
}

/** The shading an ink gets (prototype's numbers, owner's design): white gloss for a dark ink; edge shadow and a darker underside for a pale one. */
export function shading(ink: string): Shading {
  const L = luminance(ink);
  return { luminance: L, highlight: 0.28 * (1 - L), edgeShadow: 0.35 * L, edgeBlur: 6 * L, edgeOffset: 2 * L, underside: 0.05 + 0.13 * L };
}

/** WCAG contrast ratio of two colors, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
