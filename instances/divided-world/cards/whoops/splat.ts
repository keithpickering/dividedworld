/**
 * Whoops!'s pure half (the screens' design, section 11): the splat a play's seed draws, and the shading
 * an ink's luminance gives it. No DOM: `Effect.tsx` draws what this returns, and a canvas or a mask asks
 * `covers` which points the ink holds.
 *
 * A play stores only a seed (the server's, a 31-bit integer) and an ink, so every reader rebuilds the
 * same splat from them: the generator is a seeded PRNG and nothing here reads a clock or Math.random.
 * Shapes are in widths of the post's fixed layout, as the card's strokes are (whoops.ts): x across from 0
 * to 1 (the ink may run a little into the margins, so x can fall outside that), y down. The layout is a
 * fixed width scaled as a whole, so a splat is never stretched: its blob keeps the proportions it was
 * drawn with, whatever the post's height.
 *
 * Where the splat sits is the seed's too, and nothing else's: not the post's height, which an edit changes ("an
 * edit leaves the splat and the saved strokes where they are; new text reflows under them", design section 11).
 * Its center is across the middle of the post (0.42 to 0.58) and down in the first band of it, near the top (about
 * half a radius to a whole one from it, so the blob reaches the post's top rows and a post of a line is inked as a tall
 * one is); its radius across is 0.42 to 0.56 widths and down it is 0.75 to 1.3 times that. The ink may run past the
 * post's top and bottom into the margins, as it may past its sides, and a tall post is splattered in one place at its
 * top, not smeared along its length.
 *
 * A splat's path is about 13 KB, so the Effect draws only the splats near the viewport, never every one on a page.
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

export type Circle = readonly [x: number, y: number, r: number];

export interface Splat {
  /** The whole splat as one SVG path, filled once with the nonzero rule: blob, arms and droplets together. */
  readonly path: string;
  /** The lumpy blob's outline, clockwise on screen. */
  readonly blob: readonly (readonly [number, number])[];
  /** Every arm bead and droplet, which the path draws as whole circles. */
  readonly circles: readonly Circle[];
  readonly bounds: { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number };
  /** The blob's center and radii, where the seed put it on the post. */
  readonly placement: { readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number };
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** The most the lumps may swell or shrink the blob's radius: keeps the ink near its place however the harmonics line up. */
const SWELL = { lowest: 0.55, highest: 1.35 };
const POINTS = 160;

/** The splat for a seed, in widths of the layout from the post's top. */
export function makeSplat(seed: number): Splat {
  const r = mulberry32(seed);
  const rx = 0.42 + r() * 0.14;
  const ry = rx * (0.75 + r() * 0.55);
  const cx = 0.42 + r() * 0.16;
  const cy = ry * (0.5 + r() * 0.5);

  const harmonics = [2, 3, 4, 5, 7, 9].map((k) => ({ k, a: ((0.05 + r() * 0.16) / Math.sqrt(k / 2)) * 0.7, p: r() * Math.PI * 2 }));
  const blob: [number, number][] = [];
  for (let i = 0; i < POINTS; i++) {
    const th = (i / POINTS) * Math.PI * 2;
    let m = 1;
    for (const h of harmonics) m += h.a * Math.sin(h.k * th + h.p);
    m = clamp(m + (r() - 0.5) * 0.025, SWELL.lowest, SWELL.highest); // a ragged edge
    blob.push([round(cx + Math.cos(th) * rx * m), round(cy + Math.sin(th) * ry * m)]);
  }

  // Splash arms: a run of shrinking blobs ending in a bulb, and droplets thrown beyond each tip.
  const circles: Circle[] = [];
  const arms = 5 + Math.floor(r() * 6);
  for (let i = 0; i < arms; i++) {
    const th = r() * Math.PI * 2;
    const len = (0.1 + r() * 0.25) * (rx / 0.5);
    const wid = 0.025 + r() * 0.045;
    const bx = cx + Math.cos(th) * rx * 0.92;
    const by = cy + Math.sin(th) * ry * 0.92;
    const beads = 14;
    for (let k = 0; k <= beads; k++) {
      const f = k / beads;
      circles.push([round(bx + Math.cos(th) * len * f), round(by + Math.sin(th) * len * f), round(wid * (1 - 0.7 * f) * (0.85 + 0.15 * Math.sin(k * 1.7 + th * 5)))]);
    }
    circles.push([round(bx + Math.cos(th) * len), round(by + Math.sin(th) * len), round(wid * 0.6)]);
    const drops = 1 + Math.floor(r() * 3);
    for (let j = 0; j < drops; j++) {
      const d = len + 0.03 + r() * 0.12;
      const s = wid * (0.25 + r() * 0.6);
      circles.push([round(bx + Math.cos(th + (r() - 0.5) * 0.3) * d), round(by + Math.sin(th + (r() - 0.5) * 0.3) * d), round(s)]);
    }
  }

  // One path, so a pale ink's shadow traces only the outside edge. Circles are drawn clockwise like the
  // blob (sweep 1 on a y-down plane), so the nonzero rule fills their union and no overlap cuts a hole.
  let path = `M${blob[0]![0]} ${blob[0]![1]}`;
  for (let i = 1; i < blob.length; i++) path += `L${blob[i]![0]} ${blob[i]![1]}`;
  path += 'Z';
  for (const [x, y, rad] of circles) path += `M${round(x + rad)} ${y}A${rad} ${rad} 0 1 1 ${round(x - rad)} ${y}A${rad} ${rad} 0 1 1 ${round(x + rad)} ${y}Z`;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of blob) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (const [x, y, rad] of circles) { minX = Math.min(minX, x - rad); maxX = Math.max(maxX, x + rad); minY = Math.min(minY, y - rad); maxY = Math.max(maxY, y + rad); }
  return { path, blob, circles, bounds: { minX, maxX, minY, maxY }, placement: { cx: round(cx), cy: round(cy), rx: round(rx), ry: round(ry) } };
}

/**
 * Whether the splat's ink holds a point, in the same widths: the blob (a ray cast over its outline) or any circle.
 * It costs a pass over every circle and blob vertex, so it is for a stroke's points, a few hundred a play, and not
 * for asking per pixel.
 */
export function covers(splat: Pick<Splat, 'blob' | 'circles' | 'bounds'>, x: number, y: number): boolean {
  const { minX, maxX, minY, maxY } = splat.bounds;
  if (x < minX || x > maxX || y < minY || y > maxY) return false;
  for (const [cx, cy, r] of splat.circles) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) return true;
  let inside = false;
  const pts = splat.blob;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!, [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
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
