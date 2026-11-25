/**
 * The curtain's drawing as numbers, ported from the owner's approved bench (docs/research/2026-11-23-its-curtains/bench.html, 2026-11-25) and kept free of the
 * DOM and of React so a test can hold it: the swags along the top edge, the fabric's lag as keyframes, and where a spotlight is in its lap.
 *
 * The swag is drawn from the two curves of `curtain-draped.svg` (each swag's lower edge, a 100 by 60 box scaled to the swag's pixels); its fill, its gold
 * trim and its beads are all drawn from those same two curves, so the beads sit on the trim whatever the aspect, evenly spaced, with a larger bead where two
 * swags meet. The velvet's nap is one generated tile of fractal noise, stretched tall; it is painted with plain alpha (a lighter and a darker layer), since
 * no effect may blend with what is behind it (tools/check-effect-blend.mjs). The bench lit the trim with a screen blend, which the glint here does with a
 * gradient's alpha instead.
 *
 * Nothing here reads who played a curtain or opened one: it is a drawing.
 */
import { TUNING } from './tuning.ts';

type P = readonly [number, number];
type Cubic = readonly [P, P, P, P];

export interface Bead { readonly x: number; readonly y: number; readonly r: number }
export interface SwagArt {
  readonly width: number;
  /** The art's height: the swags' and the trim's below them, with a margin for the beads. */
  readonly height: number;
  /** The fill of every swag, one path. */
  readonly shape: string;
  /** The trim along every swag's lower edge, one path. */
  readonly trim: string;
  readonly beads: readonly Bead[];
  /** A bright speck on each bead, in the same order. */
  readonly specks: readonly Bead[];
  readonly trimWidth: number;
  /** How the swag's size scales the trim, the beads and their spacing: 1 at the default height, within 0.75 and 1.35. */
  readonly k: number;
  readonly railHeight: number;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const pt = (p: P): string => `${r2(p[0])},${r2(p[1])}`;

function cubicAt(c: Cubic, t: number): P {
  const m = 1 - t, a = m * m * m, b = 3 * m * m * t, d = 3 * m * t * t, e = t * t * t;
  return [a * c[0][0] + b * c[1][0] + d * c[2][0] + e * c[3][0], a * c[0][1] + b * c[1][1] + d * c[2][1] + e * c[3][1]];
}

/** One swag's lower edge as two cubics, from `curtain-draped.svg`'s 100 by 60 box scaled into this swag's pixels: left corner to the bottom, then up to the right. */
function swagCurves(x0: number, sw: number, h: number): readonly [Cubic, Cubic] {
  const P = (X: number, Y: number): P => [x0 + (sw * X) / 100, (h * Y) / 60];
  return [[P(0, 12), P(1, 34), P(18, 58), P(50, 58)], [P(50, 58), P(82, 58), P(99, 34), P(100, 12)]];
}

/** Beads evenly spaced (by arc length) along the two curves, `off` out of the swag from the curve. */
function beadsOn(curves: readonly [Cubic, Cubic], spacing: number, off: number): P[] {
  const pts: P[] = [];
  curves.forEach((c, ci) => { for (let k = ci ? 1 : 0; k <= 64; k++) pts.push(cubicAt(c, k / 64)); });
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  const L = len[len.length - 1]!, n = Math.max(2, Math.round(L / spacing)), out: P[] = [];
  let seg = 1;
  for (let j = 1; j < n; j++) {
    const s = (L * j) / n;
    while (len[seg]! < s) seg++;
    const a = pts[seg - 1]!, b = pts[seg]!, f = (s - len[seg - 1]!) / (len[seg]! - len[seg - 1]! || 1);
    const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
    /* travelling left to right along the lower edge, (-ty, tx) points out of the swag (down at the bottom) */
    out.push([a[0] + tx * f + (-ty / tl) * off, a[1] + ty * f + (tx / tl) * off]);
  }
  return out;
}

/** The swags, `n` of them across `width` px, each `h` px tall: the fill, the trim, and the beads with their specks. */
export function swagArt(width: number, n: number, h: number): SwagArt {
  const sw = width / n;
  const k = Math.max(0.75, Math.min(1.35, h / 64));
  const tw = 4.2 * k, br = 2.3 * k, jr = 3.6 * k;
  let shape = '', trim = '';
  const beads: Bead[] = [], specks: Bead[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = i * sw, c = swagCurves(x0, sw, h);
    shape += `M${r2(x0)} 0H${r2(x0 + sw)}V${r2(c[1][3][1])}C${pt(c[1][2])} ${pt(c[1][1])} ${pt(c[1][0])}C${pt(c[0][2])} ${pt(c[0][1])} ${pt(c[0][0])}Z`;
    trim += `M${pt(c[0][0])}C${pt(c[0][1])} ${pt(c[0][2])} ${pt(c[0][3])}C${pt(c[1][1])} ${pt(c[1][2])} ${pt(c[1][3])}`;
    for (const [x, y] of beadsOn(c, 7.2 * k, tw / 2 + br * 0.55)) {
      beads.push({ x: r2(x), y: r2(y), r: r2(br) });
      specks.push({ x: r2(x - br * 0.3), y: r2(y - br * 0.35), r: r2(br * 0.5) });
    }
  }
  /* a larger bead where two swags meet */
  for (let i = 0; i <= n; i++) {
    const x = Math.min(width - jr * 0.6, Math.max(jr * 0.6, i * sw)), y = (h * 12) / 60 + tw * 0.5 + jr * 0.5;
    beads.push({ x: r2(x), y: r2(y), r: r2(jr) });
    specks.push({ x: r2(x - jr * 0.3), y: r2(y - jr * 0.35), r: r2(jr * 0.5) });
  }
  return { width, height: h + 14, shape, trim, beads, specks, trimWidth: r2(tw), k, railHeight: r2(4.5 * k) };
}

/* ---------- the fabric's lag ---------- */

/** The velvet tile: fractal noise stretched tall (a vertical nap), 96 by 192, as a lighter layer and a darker one with plain alpha. Generated once. */
const NOISE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="192">'
  + '<filter id="w" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency="0.85 0.028" numOctaves="3" seed="7" stitchTiles="stitch"/>'
  + '<feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.8 0.8 0.8 0 -1.2"/></filter>'
  + '<filter id="d" x="0" y="0" width="1" height="1"><feTurbulence type="fractalNoise" baseFrequency="0.85 0.028" numOctaves="3" seed="7" stitchTiles="stitch"/>'
  + '<feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.8 -0.8 -0.8 0 1.2"/></filter>'
  + '<rect width="96" height="192" filter="url(#w)"/><rect width="96" height="192" filter="url(#d)"/></svg>';
export const NOISE_URI = `data:image/svg+xml,${encodeURIComponent(NOISE_SVG)}`;

const FAB_STEPS = 30, FAB_SUB = 8;

/** A CSS cubic-bezier as a function of progress. */
function easeFn(css: string): (t: number) => number {
  if (css === 'linear') return (t) => t;
  const [x1, y1, x2, y2] = /\(([^)]+)\)/u.exec(css)![1]!.split(',').map(Number) as [number, number, number, number];
  const bz = (a: number, b: number, s: number): number => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  return (t) => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 28; i++) { const m = (lo + hi) / 2; if (bz(x1, x2, m) < t) lo = m; else hi = m; }
    return bz(y1, y2, (lo + hi) / 2);
  };
}

interface EaseTable { readonly u: Float64Array; readonly v: Float64Array }
const tables = new Map<string, EaseTable>();

/** The easing's progress and normalized speed, solved once for each easing and shared by every strip. */
function easeTable(css: string): EaseTable {
  const have = tables.get(css);
  if (have) return have;
  const ease = easeFn(css), N = FAB_STEPS * FAB_SUB, u = new Float64Array(N + 1), v = new Float64Array(N + 1);
  for (let k = 0; k <= N; k++) u[k] = ease(k / N);
  let vmax = 0;
  for (let k = 0; k <= N; k++) { const a = Math.max(0, k - 1), b = Math.min(N, k + 1); v[k] = ((u[b]! - u[a]!) * N) / (b - a); vmax = Math.max(vmax, Math.abs(v[k]!)); }
  for (let k = 0; k <= N; k++) v[k] = v[k]! / (vmax || 1);
  const made = { u, v };
  tables.set(css, made);
  return made;
}

export interface Frame { readonly offset: number; readonly transform: string }

/**
 * The fabric's lag on top of the half's own slide: transform-only keyframes, a pure function of (pleat index, pleat count, half size, duration, easing, lag,
 * direction). The pleats bunch toward the leading (outer) edge while the half moves, and the hem trails the top as a skewX about each strip's top, driven by an
 * underdamped spring on the half's speed, so it sways and settles. `i` counts from the outermost pleat of the half (0) to the one nearest the middle (n - 1); `dir` is -1 for the left
 * half, 1 for the right. No lag is no keyframes.
 */
export function fabricFrames(i: number, n: number, halfW: number, H: number, durMs: number, lag: number, dir: -1 | 1, ease: string): Frame[] {
  if (lag <= 0) return [];
  const tab = easeTable(ease);
  const T = durMs / 1000, frac = n > 1 ? i / (n - 1) : 0, c = ((i + 0.5) * halfW) / n;
  const hemMax = lag * Math.min(halfW * 0.4, H * 0.85);
  /* a spring in normalized time; the trailing strips answer quicker */
  const w = 2 * Math.PI * (1.8 + 0.5 * frac) * T, z = 0.34;
  let s = 0, sv = 0;
  const dt = 1 / (FAB_STEPS * FAB_SUB), frames: Frame[] = [];
  for (let j = 0; j <= FAB_STEPS; j++) {
    const k0 = j * FAB_SUB, u = tab.u[k0]!;
    const g = lag * 0.42 * Math.sin(Math.PI * Math.max(0, Math.min(1, u)));
    const dx = dir * c * g;
    const sc = 1 - 0.5 * g;
    const hem = hemMax * s * (0.85 + 0.3 * frac);
    const sk = (-dir * Math.atan2(hem, H) * 180) / Math.PI;
    frames.push({ offset: j / FAB_STEPS, transform: `translateX(${dx.toFixed(2)}px) skewX(${sk.toFixed(3)}deg) scaleX(${sc.toFixed(4)})` });
    for (let q = 0; q < FAB_SUB && j < FAB_STEPS; q++) { const a = w * w * (tab.v[k0 + q]! - s) - 2 * z * w * sv; sv += a * dt; s += sv * dt; }
  }
  return frames;
}

/** How far the lag lets a half's hem trail past the box, so the halves leave it whole: the `--dw-lagx` the CSS adds to each half's travel. */
export const lagOvershoot = (halfW: number, H: number, lag: number): number => Math.ceil(lag * Math.min(halfW * 0.4, H * 0.85) * 1.2 + 2);

/* ---------- the spotlights ---------- */

export interface SpotBox {
  readonly w: number;
  /** The visible part of the box, where the spotlights are: its top, from the box's own top, and its height. */
  readonly top: number;
  readonly span: number;
}
export interface SpotPose { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly opacity: number }

/**
 * Where spotlight `i` (0 or 1) is, as the center of its ellipse, in the box's pixels. `phase` is the lap's angle in radians (2 pi a lap); the two are half a lap apart,
 * so they are out of phase. `k` (0 to 1) is how much of the drumroll's brightness they have and `kMove` how far they have left their rest places for the figure 8
 * (the same as `k` unless the reader's motion is reduced, when it stays 0: they stand still and brighten). A lemniscate: x = cos / (1 + sin squared).
 */
export function spotPose(phase: number, i: number, box: SpotBox, k: number, kMove: number): SpotPose {
  const w = TUNING.spot.size * Math.min(box.w, box.span * 2.2) * 0.7, h = w * 0.85;
  const ph = phase + i * Math.PI, den = 1 + Math.sin(ph) ** 2;
  const lx = box.w / 2 + (box.w * 0.36 * Math.cos(ph)) / den;
  const ly = box.top + box.span / 2 + (((box.span * 0.34 * Math.sin(ph) * Math.cos(ph)) / den) * 1.8);
  const rx = box.w * (i ? TUNING.spot.restRight : TUNING.spot.restLeft), ry = box.top + box.span / 2;
  return { x: rx + (lx - rx) * kMove, y: ry + (ly - ry) * kMove, w, h, opacity: TUNING.spot.rest + (TUNING.spot.bright - TUNING.spot.rest) * k };
}
