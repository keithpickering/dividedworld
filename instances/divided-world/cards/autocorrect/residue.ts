/**
 * The adhesive a peeled strip leaves (docs/plans/2026-11-11-autocorrect-tape-design.md section 4). It ports the approved
 * bench's `makeResidue` (docs/research/2026-11-11-autocorrect-tape-bench/01-bench.html): a tacky film in the tape's exact
 * torn outline, thick here and thin there from two scales of seeded value noise, the tape's crepe ridges pressed in, and
 * thickest along the line where the tape's edge sat. The film is computed here as an alpha array so it needs no canvas;
 * the effect lays it as a mask over a tint and a gloss.
 *
 * Seeded only, from the strip's key; `Math.random` is never read. The tint and the gloss are clamped into the board's
 * readable band (engine/ui/shine/band.ts), so every post ink holds 4.5:1 over them at every light.
 */
import { clampInto, toHex, toLinear, type Band, type Light, type Rgb } from '../../../../engine/ui/shine/band.ts';
import { seeded } from '../../ui/seeded.ts';
import { crepeLines, endJags, type Jag } from './paper.ts';

/** The film's alpha is clamped to this, as the bench's is (never fully clear, never fully solid). */
export const FILM_MIN = 0.05;
export const FILM_MAX = 0.95;
/** The gloss layer's strength where the light is brightest (the bench's `--res-gloss` on the light board). */
export const GLOSS_ALPHA = 0.6;
/** The film is drawn at twice the CSS pixel density. */
export const DENSITY = 2;
/** The half-width, in CSS pixels, within which a pixel is on the edge line (the bench strokes it 0.9 wide). */
export const EDGE_HALF = 0.45;
/** What the edge line adds, as the bench strokes it: white at 0.9. */
const EDGE_ALPHA = 0.9;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise on a grid of `cell` CSS pixels, drawn from `r` in the bench's order. */
function valueNoise(r: () => number, w: number, h: number, cell: number): (x: number, y: number) => number {
  const cols = Math.ceil(w / cell) + 2, rows = Math.ceil(h / cell) + 2;
  const v = Array.from({ length: cols * rows }, r);
  return (x, y) => {
    const gx = x / cell, gy = y / cell, i = Math.floor(gx), j = Math.floor(gy), fx = smooth(gx - i), fy = smooth(gy - j);
    const at = (a: number, b: number) => v[b * cols + a]!;
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const bot = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return top + (bot - top) * fy;
  };
}

/** Where an end's polyline sits at height `y`, and how slanted it is there: [x, dx/dy]. */
function endAt(pts: Jag, y: number): [number, number] {
  const n = pts.length - 1;
  const k = clamp(Math.floor((y / (pts[n]![1] || 1)) * n), 0, n - 1);
  const [x0, y0] = pts[k]!, [x1, y1] = pts[k + 1]!;
  const t = y1 === y0 ? 0 : clamp((y - y0) / (y1 - y0), 0, 1);
  return [x0 + (x1 - x0) * t, y1 === y0 ? 0 : (x1 - x0) / (y1 - y0)];
}

/** The film's size in pixels at density 2 for a piece of `w` by `h` CSS pixels (rounded, at least one). */
export const filmSize = (w: number, h: number): { cols: number; rows: number } => ({
  cols: Math.max(1, Math.round(w)) * DENSITY,
  rows: Math.max(1, Math.round(h)) * DENSITY,
});

/**
 * The film as alpha, 0..1, row by row, `(2 * w) * (2 * h)` long: two scales of value noise, the crepe pressed in, an edge
 * line along the torn outline, and nothing at all outside the outline.
 */
export function filmAlpha(w: number, h: number, seed: string): Float32Array {
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  const { cols, rows } = filmSize(w, h);
  const r = seeded(`${seed}:film`);
  /* Patchy: two scales of value noise, so the film is thick here and thin there. */
  const big = valueNoise(r, W, H, 11), small = valueNoise(r, W, H, 4);
  /* The nearest crepe ridge to each column, found once rather than for every pixel. */
  const ridges = crepeLines(seed, W).map(([x]) => x);
  const nearRidge = new Float32Array(cols);
  for (let x = 0, k = 0; x < cols; x++) {
    const px = x / DENSITY;
    while (k + 1 < ridges.length && Math.abs(ridges[k + 1]! - px) <= Math.abs(ridges[k]! - px)) k++;
    nearRidge[x] = ridges.length ? Math.min(9, Math.abs(ridges[k]! - px)) : 9;
  }
  const ends = endJags(seed, W, H);
  const out = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    const py = (y + 0.5) / DENSITY;
    const [xl, sl] = endAt(ends.left, py), [xr, sr] = endAt(ends.right, py);
    for (let x = 0; x < cols; x++) {
      const px = (x + 0.5) / DENSITY;
      if (px < xl || px > xr) continue; /* Outside the torn outline there is no film. */
      let a = 0.28 + 0.55 * big(px, py) + 0.25 * (small(px, py) - 0.5);
      const near = nearRidge[x]!;
      if (near < 0.45) a *= 1.22;
      else if (near > 1.1) a *= 0.9;
      a = clamp(a, FILM_MIN, FILM_MAX);
      /* Where the tape's edge sat, the film is thickest: a line that follows the outline, its slant allowed for. */
      const d = Math.min(py, H - py, (px - xl) / Math.hypot(1, sl), (xr - px) / Math.hypot(1, sr));
      if (d <= EDGE_HALF) a += EDGE_ALPHA * (1 - a);
      out[y * cols + x] = a;
    }
  }
  return out;
}

/** The residue's two colors, as `#rrggbb`: the film's tint, and the gloss the page's light lays over it. */
export type ResidueInk = { readonly tint: string; readonly gloss: string };

/* The bench's residue colors on each board (--res-tint, light board and dark board), and the gloss's warm white. */
const TINT: Record<Band['board'], Rgb> = { light: toLinear('#ba923a'), dark: toLinear('#c4a662') };
const GLOSS: Rgb = toLinear('#fff1c4');

/**
 * The tint and the gloss at one light, already moved into the board's band keeping their hue. The gloss is brighter the
 * nearer the light sits to the page's middle and fades as it moves away, so the sheen travels with the light.
 */
export function residueInk(band: Band, light: Light): ResidueInk {
  const k = 0.55 + 0.45 * (1 - Math.min(1, Math.hypot(light.x, light.y) / 2.1));
  const tint = clampInto([...TINT[band.board]] as Rgb, band);
  const gloss = clampInto(GLOSS.map((c) => c * k) as Rgb, band);
  return { tint: toHex(tint), gloss: toHex(gloss) };
}

/** One torn fiber: a quadratic stroke from (x0, y0) through the control point (cx, cy) to (x1, y1), `width` thick. */
export type Fiber = { readonly x0: number; readonly y0: number; readonly cx: number; readonly cy: number; readonly x1: number; readonly y1: number; readonly width: number };

/** The torn fibers a tear at `x` leaves in a piece `h` tall: four to eight short strokes within five pixels of it. */
export function fibersAt(seed: string, x: number, h: number): Fiber[] {
  const r = seeded(`${seed}:fibers:${x.toFixed(0)}`);
  const count = 4 + Math.round(r() * 4);
  const out: Fiber[] = [];
  for (let i = 0; i < count; i++) {
    const fx = x + (r() - 0.5) * 5, fy = 1 + r() * (h - 2), len = 1.5 + r() * 4, ang = r() * Math.PI;
    const width = 0.5 + r() * 0.7;
    out.push({
      x0: fx, y0: fy,
      cx: fx + Math.cos(ang) * len * 0.5 + (r() - 0.5), cy: fy + Math.sin(ang) * len * 0.5,
      x1: fx + Math.cos(ang) * len, y1: fy + Math.sin(ang) * len, width,
    });
  }
  return out;
}
