/**
 * Hot Box's fog (docs/plans/2026-11-15-hot-box-fog-plan.md, Task 4; design, sections 2 and 3.2): one shaded body in the caster's color that a pointer
 * drags, that flows around it and closes in from its rim. Pure TypeScript over typed arrays: no DOM, no canvas, no clock and no Math.random, so it runs
 * under a unit test and could run in a worker. `Effect.tsx` hands it the time, the model's answer at a point and a buffer, and puts the bytes on a canvas.
 *
 * The arithmetic and every constant are the bench's, the look the owner approved (docs/research/2026-11-15-hot-box-fog/01-fog.html: `makeCloud`,
 * `advect`, `step`, `drawFog`). Where the design's prose gives another figure (the most the color is lit, how long carried texture takes to ease back),
 * the bench is the record and its figure is the one here.
 *
 * The picture. Two sheets of one tileable cloud at two scales, drifting two ways; each is lit once from the upper left, and the light is mixed into the
 * color: toward white where the fog faces it, toward a deeper, cooler shade of the color where it turns away. Shading never touches opacity: fog at rest
 * is exactly `alpha` opaque in every cell, so the ghost of the words shows through evenly. Where the fog is thinned its alpha is cut by the cloud's own
 * shape, so an edge breaks into wisps.
 *
 * The field. A grid of cells (5 px) holding the fog's density (1 at rest), its velocity and how far its cloud has been carried. A moving clearing pulls
 * the fog's velocity toward its own; a few rounds of a pressure solve make the fog go around; the fog and its texture are carried along the flow. The
 * model (`smoke.ts`) is the floor: wherever the caller's `target` says a cell may hold less fog than it does, the cell is driven down to it within a few
 * frames, so the field's motion can only add clear space. Where the model no longer holds a cell open, the fog comes back at a rate that grows with its
 * neighbors', so a wake fills inward from its rim over `SMOKE.wake`. A cell that has settled is reset to exactly the resting fog.
 *
 * What it costs is what is disturbed, never the post's size (design section 3.3). Only the disturbed box is stepped: the cells a clearing or the trail
 * reaches and the cells still moving. And only that box is stored: the arrays cover the box's rows and a margin, they are made when the fog is first
 * disturbed and dropped when it is at rest again, and every cell outside them is resting fog by definition. A caller that draws only part of a post
 * (`view`) has the box clipped to it; a disturbed cell that leaves the view is at rest when it comes back, and the model drives it open again. One cloud
 * is made for the page and shared by every post, which reads it at its own offset.
 *
 * The grid stands one cell outside the box on every side, so its own edge cells (never stepped: the flow has no neighbor to read there) are off the
 * box and a clearing at the post's border opens all the way to it.
 */
import { mulberry32 } from '../../cards/whoops/splat.ts';
import { SMOKE, covered, openness, trailOpenness, type Clearing, type TrailPoint } from './smoke.ts';

/** The fog's numbers: the bench's (docs/research/2026-11-15-hot-box-fog/01-fog.html), named. */
export const FOG = {
  /** A cell's side, px. */
  cell: 5,
  /** The cloud tile's side, texels; a power of two (the sampler wraps with a mask). */
  texels: 256,
  /** The seed of the page's one cloud. */
  seed: 20261115,
  /** The fine, quick sheet: px a texel, its drift in px a second, how much of its light and its height make its tone. */
  sheet1: { scale: 3.2, dx: 7, dy: -3.2, light: 1.1, height: 0.1 },
  /** The broad, slow sheet, read at an offset so the two never line up. */
  sheet2: { scale: 8.5, dx: -2.6, dy: -1.4, light: 1.9, height: 0.3, ox: 91, oy: 37 },
  /** Lit fog: the color toward white, by `gain` of the tone over a half, at most `most`. */
  light: { gain: 0.85, most: 0.5 },
  /** Shaded fog: the color toward a deeper, cooler one (`r`, `g`, `b` of itself, blue lifted by `lift`), by `gain` of the tone under a half, at most `most`. */
  shade: { gain: 1.9, most: 0.85, r: 0.42, g: 0.44, b: 0.5, lift: 18 },
  /** How strongly a clearing's wall is lit from the fog's own thickness. */
  wall: 0.9,
  /** The wisps at a thinned edge: how much of the missing fog, and of the cloud's shape, is taken from its alpha. */
  wisp: { base: 0.25, cloud: 1.1, bite: 0.9 },
  /** A moving clearing drags the fog within this many radii, pulling its velocity toward its own at this rate a second. */
  reach: 1.5,
  drag: 14,
  /** Rounds of the pressure solve. */
  rounds: 8,
  /** A tap's burst: how long it pushes outward (ms), how hard (px a second squared), and how much of the pressure's correction is kept while it does. */
  burst: { ms: 260, push: 1400, keep: 0.35 },
  /** Time constants, ms: the drive down to the model, the velocity's decay, the carried texture's ease back. */
  sink: 70,
  damp: 900,
  settle: 3500,
  /** The fog's return, a `wake`: a base rate, how much its neighbors add, and the level it reaches for. */
  refill: { base: 0.35, neighbors: 2.6, over: 1.03 },
  /**
   * A cell is at rest at this density with less than this speed (cells a second) and this carried offset (px). The speed is not the bench's 0.08: the
   * pressure solve hands a sliver of flow to every cell of the box, and at 0.08 the box grew over the whole view and stayed there (26,000 cells stepped a
   * frame on a tall post against 13,500 at 1). 1 cell a second is 5 px a second, slower than the fog's own drift, so what is dropped cannot be seen.
   */
  rest: { density: 0.999, speed: 1, carried: 0.4 },
  /** Cells the box grows a step, the reach of a frame's flow. */
  grow: 3,
  /** The longest step, ms: a background tab's long frame cannot throw fog across the post. */
  maxStep: 50,
  /** Rows of margin stored around the box. */
  margin: 16,
} as const;

/** Cells the grid stands outside the box on each side. */
const PAD = 1;

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const smooth = (t: number): number => { const c = clamp(t, 0, 1); return c * c * (3 - 2 * c); };

/* -------------------------------------------------------------------------------- the cloud ---- */

/** The tileable cloud (`n`, its height in [0, 1]) and each sheet's tone, made once: its light and a little of its height. */
export interface FogCloud { readonly n: Float32Array; readonly t1: Float32Array; readonly t2: Float32Array }

/** A tileable cloud for a seed: five octaves of value noise, lit from the upper left (its height less the height a step toward the light). */
export function makeCloud(seed: number): FogCloud {
  const T = FOG.texels, rnd = mulberry32(seed), n = new Float32Array(T * T);
  let amp = 1, total = 0;
  for (let oct = 0; oct < 5; oct++) {
    const m = 4 << oct, g = new Float32Array(m * m);
    for (let i = 0; i < g.length; i++) g[i] = rnd();
    const s = m / T;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
      const fx = x * s, fy = y * s, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = smooth(fx - x0), ty = smooth(fy - y0);
      const a = g[(y0 % m) * m + (x0 % m)]!, b = g[(y0 % m) * m + ((x0 + 1) % m)]!, c = g[((y0 + 1) % m) * m + (x0 % m)]!, d = g[((y0 + 1) % m) * m + ((x0 + 1) % m)]!;
      n[y * T + x]! += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
    }
    total += amp;
    amp *= 0.55;
  }
  for (let i = 0; i < n.length; i++) n[i] = clamp((n[i]! / total - 0.5) * 1.9 + 0.5, 0, 1);
  const t1 = new Float32Array(T * T), t2 = new Float32Array(T * T);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const i = y * T + x, lit = n[i]! - n[((y + T - 5) % T) * T + ((x + T - 4) % T)]!;
    t1[i] = lit * FOG.sheet1.light + (n[i]! - 0.5) * FOG.sheet1.height;
    t2[i] = lit * FOG.sheet2.light + (n[i]! - 0.5) * FOG.sheet2.height;
  }
  return { n, t1, t2 };
}

let shared: FogCloud | undefined;
/** The page's one cloud, made at the first call. A post reads it at its own offset (`FogPaint.phase`), so no post makes its own. */
export function pageCloud(): FogCloud {
  shared ??= makeCloud(FOG.seed);
  return shared;
}

/** The tile read at a point between texels, wrapping. */
function sample(tile: Float32Array, x: number, y: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0, xa = x0 & 255, xb = (x0 + 1) & 255, ya = (y0 & 255) << 8, yb = ((y0 + 1) & 255) << 8;
  const a = tile[ya | xa]!, b = tile[ya | xb]!, c = tile[yb | xa]!, d = tile[yb | xb]!;
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/* -------------------------------------------------------------------------------- the field ---- */

/** A box of cells: columns `x0` up to `x1`, rows `y0` up to `y1`. */
export interface CellBox { readonly x0: number; readonly x1: number; readonly y0: number; readonly y1: number }

/** The stored rows: `rows` of them from row `y0`, each the grid's width. The first five arrays are the fog; the rest are a step's scratch. */
interface FogStore {
  readonly y0: number; readonly rows: number;
  readonly D: Float32Array; readonly U: Float32Array; readonly V: Float32Array; readonly OX: Float32Array; readonly OY: Float32Array;
  readonly D0: Float32Array; readonly U0: Float32Array; readonly V0: Float32Array; readonly OX0: Float32Array; readonly OY0: Float32Array;
  readonly P: Float32Array; readonly DIV: Float32Array;
}

/** The fog over a box `width` by `height` px. `box` is the disturbed cells, null when all of it is at rest; `store` is null then too, and holds nothing. */
export interface FogField {
  readonly width: number; readonly height: number; readonly cell: number;
  /** The grid: `gw` by `gh` cells, standing one cell outside the box on each side. */
  readonly gw: number; readonly gh: number;
  box: CellBox | null;
  store: FogStore | null;
  /** Nothing in the box is moving or thinned: only carried texture is still easing back, which a step does without the flow. */
  quiet: boolean;
  /**
   * The last step visibly changed something: a cell's speed was over `FOG.rest.speed`, or its density moved by more than 0.002. A clearing held still has
   * settled: its cells are thinned and the box is held, but nothing changes, so this is false and the page's rest timer is enough to draw it. False for a field at
   * rest, after an `ease` step (carried texture only), and when a step returns early.
   */
  busy: boolean;
  /**
   * A fog that is made (`emptyField`) says what a row it newly stores, or that leaves the view, holds: the model's density at a point (px), kept current by the caller. Resting fog (1) where
   * not given, as for every Hot Box field.
   */
  seed?: (x: number, y: number) => number;
}

/** A field at rest. It holds no array until it is disturbed. */
export function makeField(width: number, height: number, cell: number = FOG.cell): FogField {
  const w = Number.isFinite(width) ? Math.max(0, width) : 0, h = Number.isFinite(height) ? Math.max(0, height) : 0;
  return { width: w, height: h, cell, gw: Math.ceil(w / cell) + 1 + 2 * PAD, gh: Math.ceil(h / cell) + 1 + 2 * PAD, box: null, store: null, quiet: false, busy: false };
}

/**
 * A field with no fog in it (density 0 in the cells it stores), its box disturbed: a fog that is made, not one that is thinned. Steel Chair's puff starts from it
 * (docs/plans/2026-11-23-steel-chair-objects-design.md, section 4) and fills it from the spout; a step with `whole` keeps the box stepped while it fills. Only the rows of `view`
 * (px of the box; all of it when not given) are stored, as a step with a `view` stores only those, so a tall post costs what is drawn; a row outside them is resting fog, as ever, and
 * is stepped, and driven to the model, when its tile is held. `seed` gives each stored cell its density (at the cell's center, px) instead of none, for a field made again in the middle of a puff.
 */
export function emptyField(width: number, height: number, cell: number = FOG.cell, o: { readonly view?: { readonly top: number; readonly bottom: number }; readonly seed?: (x: number, y: number) => number } = {}): FogField {
  const field = makeField(width, height, cell);
  const rows = o.view ? rowsOf(field, o.view.top, o.view.bottom) : { y0: 0, y1: field.gh };
  const y0 = Math.max(1, rows.y0), y1 = Math.min(field.gh - 1, rows.y1);
  if (y1 <= y0 || field.gw - 1 <= 1) return field;
  field.box = { x0: 1, x1: field.gw - 1, y0, y1 };
  if (o.seed) field.seed = o.seed;
  const s = storeFor(field, y0 - 1, y1 + 1);
  s.D.fill(0);
  if (o.seed) for (let y = 0; y < s.rows; y++) for (let x = 0; x < field.gw; x++) s.D[y * field.gw + x] = o.seed((x - PAD + 0.5) * cell, (y + s.y0 - PAD + 0.5) * cell);
  return field;
}

/** The grid rows that cover the box's px rows `top` to `bottom`, with a row over at each end so a scaled picture has a neighbor to blend with. */
export function rowsOf(field: FogField, top: number, bottom: number): { y0: number; y1: number } {
  const y0 = clamp(Math.floor(top / field.cell) + PAD - 1, 0, field.gh);
  return { y0, y1: clamp(Math.ceil(bottom / field.cell) + PAD + 1, y0, field.gh) };
}

/** Where cell (`x`, `y`)'s corner is in the box's px: the grid stands a cell outside it. */
export function cellOrigin(field: FogField, x: number, y: number): { x: number; y: number } {
  return { x: (x - PAD) * field.cell, y: (y - PAD) * field.cell };
}

/** The fog at a point of the box (px): its density, velocity (px a second) and carried offset (px). Resting fog wherever nothing is stored. */
export function fogAt(field: FogField, x: number, y: number): { d: number; u: number; v: number; ox: number; oy: number } {
  const s = field.store, cx = Math.floor(x / field.cell) + PAD, cy = Math.floor(y / field.cell) + PAD;
  if (!s || cx < 0 || cx >= field.gw || cy < s.y0 || cy >= s.y0 + s.rows) return { d: 1, u: 0, v: 0, ox: 0, oy: 0 };
  const i = (cy - s.y0) * field.gw + cx;
  return { d: s.D[i]!, u: s.U[i]! * field.cell, v: s.V[i]! * field.cell, ox: s.OX[i]!, oy: s.OY[i]! };
}

/** Storage that covers rows `r0` up to `r1`: the field's own where it already does, else new arrays with a margin, the old rows that overlap carried over. */
function storeFor(field: FogField, r0: number, r1: number): FogStore {
  const { gw, gh } = field, old = field.store;
  if (old && r0 >= old.y0 && r1 <= old.y0 + old.rows) return old;
  const y0 = Math.max(0, r0 - FOG.margin), y1 = Math.min(gh, r1 + FOG.margin), rows = y1 - y0, n = rows * gw;
  const f = () => new Float32Array(n);
  const next: FogStore = { y0, rows, D: f().fill(1), U: f(), V: f(), OX: f(), OY: f(), D0: f(), U0: f(), V0: f(), OX0: f(), OY0: f(), P: f(), DIV: f() };
  if (field.seed) seedRows(field, next, y0, y1);
  if (old) {
    const a = Math.max(y0, old.y0), b = Math.min(y1, old.y0 + old.rows);
    if (b > a) {
      const from = (a - old.y0) * gw, to = (b - old.y0) * gw, at = (a - y0) * gw;
      next.D.set(old.D.subarray(from, to), at);
      next.U.set(old.U.subarray(from, to), at);
      next.V.set(old.V.subarray(from, to), at);
      next.OX.set(old.OX.subarray(from, to), at);
      next.OY.set(old.OY.subarray(from, to), at);
    }
  }
  field.store = next;
  return next;
}

/** Rows `r0` up to `r1` of the store hold the field's seed (a made fog's model), at their cells' centers. */
function seedRows(field: FogField, s: FogStore, r0: number, r1: number): void {
  const seed = field.seed;
  if (!seed) return;
  const a = Math.max(r0, s.y0), b = Math.min(r1, s.y0 + s.rows);
  for (let y = a; y < b; y++) for (let x = 0; x < field.gw; x++) s.D[(y - s.y0) * field.gw + x] = seed((x - PAD + 0.5) * field.cell, (y - PAD + 0.5) * field.cell);
}

/** Rows `r0` up to `r1` of the store are resting fog again. */
function restRows(s: FogStore, gw: number, r0: number, r1: number): void {
  const a = Math.max(r0, s.y0), b = Math.min(r1, s.y0 + s.rows);
  if (b <= a) return;
  const from = (a - s.y0) * gw, to = (b - s.y0) * gw;
  s.D.fill(1, from, to);
  s.U.fill(0, from, to);
  s.V.fill(0, from, to);
  s.OX.fill(0, from, to);
  s.OY.fill(0, from, to);
}

/** Semi-Lagrangian: each cell of the box takes what the flow carried to it. `add` is what a unit of flow adds (the cloud's own offset moves with the fog). */
function advect(s: FogStore, gw: number, dst: Float32Array, src: Float32Array, dt: number, B: CellBox, add: 0 | 1 | 2, cell: number): void {
  const yTop = s.y0, yMost = s.y0 + s.rows - 1.001, xMost = gw - 1.001, { U0, V0 } = s;
  for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) {
    const i = (y - yTop) * gw + x, u = U0[i]!, v = V0[i]!;
    const px = clamp(x - u * dt, 0, xMost), py = clamp(y - v * dt, yTop, yMost);
    const x0 = px | 0, y0 = py | 0, tx = px - x0, ty = py - y0, j = (y0 - yTop) * gw + x0;
    const a = src[j]!, b = src[j + 1]!, c = src[j + gw]!, d = src[j + gw + 1]!;
    dst[i] = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty + (add === 1 ? -u * dt * cell : add === 2 ? -v * dt * cell : 0);
  }
}

/** The mean of the flow's absolute divergence over a box: how much the fog is being squeezed or stretched there. For tests. */
export function divergence(field: FogField, B: CellBox): number {
  const s = field.store;
  if (!s) return 0;
  const gw = field.gw;
  let sum = 0, count = 0;
  for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) {
    const i = (y - s.y0) * gw + x;
    sum += Math.abs(0.5 * (s.U[i + 1]! - s.U[i - 1]! + s.V[i + gw]! - s.V[i - gw]!));
    count++;
  }
  return count === 0 ? 0 : sum / count;
}

/**
 * Fog is not squeezed: what is pushed ahead of a pointer goes around it and closes behind. `rounds` of a pressure solve over the box, and `keep` of its
 * correction taken from the flow (a tap's burst is let through). The box's rows and a row each side must be stored. Exported for its test.
 */
export function project(field: FogField, B: CellBox, rounds: number, keep: number): void {
  const s = field.store;
  if (!s) return;
  const gw = field.gw, { U, V, P, DIV } = s, top = s.y0;
  /* The pressure outside the box is none: the ring around it is cleared with it. */
  for (let y = Math.max(top, B.y0 - 1); y < Math.min(top + s.rows, B.y1 + 1); y++) for (let x = B.x0 - 1; x < B.x1 + 1; x++) P[(y - top) * gw + x] = 0;
  for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) { const i = (y - top) * gw + x; DIV[i] = 0.5 * (U[i + 1]! - U[i - 1]! + V[i + gw]! - V[i - gw]!); }
  for (let k = 0; k < rounds; k++) for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) { const i = (y - top) * gw + x; P[i] = (P[i - 1]! + P[i + 1]! + P[i - gw]! + P[i + gw]! - DIV[i]!) * 0.25; }
  for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) { const i = (y - top) * gw + x; U[i]! -= keep * 0.5 * (P[i + 1]! - P[i - 1]!); V[i]! -= keep * 0.5 * (P[i + gw]! - P[i - gw]!); }
}

/** A clearing as the field sees it: where it is (the box's px), how fast it moves (px a second; none drags nothing), and whether it is a tap still bursting. */
export interface FogClearing { readonly x: number; readonly y: number; readonly vx?: number; readonly vy?: number; readonly burst?: boolean }

export interface FogInput {
  /** The open clearings, and the points of the trail: what reaches the fog this step. */
  readonly clearings: readonly FogClearing[];
  readonly trail: readonly { readonly x: number; readonly y: number }[];
  /** A clearing's radius, px. */
  readonly radius: number;
  /** The most fog the model allows at a point of the box (px): 0 where it is clear, 1 where it is smoked. Asked only for cells in the disturbed box. */
  readonly target: (x: number, y: number) => number;
  /** Rounds of the pressure solve; `FOG.rounds` when not given. */
  readonly rounds?: number;
  /**
   * The model reaches every cell of the box, not only those a clearing or the trail reaches (a puff's target is the whole box's): the whole box (the view's rows) is stepped, and
   * `target` is asked of every cell in it. Without this a cell outside every clearing's reach is whole fog to the model and is not asked.
   */
  readonly whole?: boolean;
  /** How long a thinned cell takes to fill back in, ms; `SMOKE.wake` when not given. A puff fills fast inside its front. */
  readonly fill?: number;
  /** A jet: fog pushed outward from a point (px) at `speed` (px a second, falling to nothing at `reach` px), a burst's way (a part of the pressure's correction is kept). */
  readonly jet?: { readonly x: number; readonly y: number; readonly speed: number; readonly reach: number };
  /** The part of the box that is drawn (px rows): nothing outside it is stepped or stored. All of it when not given. */
  readonly view?: { readonly top: number; readonly bottom: number };
}

/**
 * One step of the field, `dtMs` long (at most `FOG.maxStep` of it is taken). In order: the disturbed box grows by a frame's reach and by what each
 * clearing and trail point reaches; moving clearings drag the fog and a tap bursts it; the pressure solve; the flow carries the fog and its texture; the
 * flow decays; each cell is driven down to the model's target, or comes back from its neighbors; a settled cell is reset to rest; the box shrinks to what
 * is still disturbed. A box with nothing left but carried texture is only eased (`ease`). Returns how many cells it stepped: none, and nothing allocated, for a field at rest that nothing reaches.
 */
export function stepField(field: FogField, dtMs: number, input: FogInput): number {
  const { gw, gh, cell } = field;
  const dt = clamp(Number.isFinite(dtMs) ? dtMs : 0, 0, FOG.maxStep) / 1000;
  const R = input.radius, rc = (R * FOG.reach) / cell, rr = R / cell;
  /* A point whose place is not a number reaches nothing, and neither does anything when the radius is not one. */
  const real = (p: { readonly x: number; readonly y: number }): boolean => Number.isFinite(p.x) && Number.isFinite(p.y);
  const clearings = !Number.isFinite(R) ? [] : input.clearings.every(real) ? input.clearings : input.clearings.filter(real);
  const trail = !Number.isFinite(R) ? [] : input.trail.every(real) ? input.trail : input.trail.filter(real);
  const modeled = clearings.length > 0 || trail.length > 0 || input.whole === true;
  const prev = field.box;
  field.busy = false;
  if (!prev && !modeled) return 0;
  if (prev && !modeled && field.quiet && field.store) return ease(field, prev, field.store, dt);

  /* This step's box: the last one's, grown by the reach of a frame's flow, and what each clearing and trail point reaches. */
  let x0 = gw, x1 = 0, y0 = gh, y1 = 0;
  if (prev) { x0 = prev.x0 - FOG.grow; x1 = prev.x1 + FOG.grow; y0 = prev.y0 - FOG.grow; y1 = prev.y1 + FOG.grow; }
  for (const c of clearings) {
    const cx = c.x / cell + PAD, cy = c.y / cell + PAD;
    x0 = Math.min(x0, Math.floor(cx - rc)); x1 = Math.max(x1, Math.ceil(cx + rc)); y0 = Math.min(y0, Math.floor(cy - rc)); y1 = Math.max(y1, Math.ceil(cy + rc));
  }
  for (const p of trail) {
    const cx = p.x / cell + PAD, cy = p.y / cell + PAD;
    x0 = Math.min(x0, Math.floor(cx - rr)); x1 = Math.max(x1, Math.ceil(cx + rr)); y0 = Math.min(y0, Math.floor(cy - rr)); y1 = Math.max(y1, Math.ceil(cy + rr));
  }
  if (input.whole) { x0 = 0; x1 = gw; y0 = 0; y1 = gh; }
  const seen = input.view ? rowsOf(field, input.view.top, input.view.bottom) : { y0: 0, y1: gh };
  const B: CellBox = { x0: Math.max(1, x0), x1: Math.min(gw - 1, x1), y0: Math.max(1, seen.y0, y0), y1: Math.min(gh - 1, seen.y1, y1) };
  if (B.x1 <= B.x0 || B.y1 <= B.y0) { field.box = null; field.store = null; field.quiet = false; return 0; }
  /* Rows of the last box that this one leaves (they went out of view) are at rest when they are seen again. */
  if (prev && field.store) {
    restRows(field.store, gw, prev.y0, B.y0); restRows(field.store, gw, B.y1, prev.y1);
    if (field.seed) { seedRows(field, field.store, prev.y0, B.y0); seedRows(field, field.store, B.y1, prev.y1); }
  }
  const s = storeFor(field, B.y0 - 1, B.y1 + 1);
  const top = s.y0, { D, U, V, OX, OY, D0, U0, V0, OX0, OY0 } = s;

  /* What moves it: each clearing that is moving drags the fog around it along, and a tap pushes it outward. */
  let bursting = false;
  for (const c of clearings) {
    const vx = Number.isFinite(c.vx) ? c.vx! : 0, vy = Number.isFinite(c.vy) ? c.vy! : 0, moving = vx !== 0 || vy !== 0, burst = c.burst === true;
    if (burst) bursting = true;
    if (!moving && !burst) continue;
    const cx = c.x / cell + PAD, cy = c.y / cell + PAD;
    const ya = Math.max(B.y0, Math.floor(cy - rc)), yb = Math.min(B.y1, Math.ceil(cy + rc)), xa = Math.max(B.x0, Math.floor(cx - rc)), xb = Math.min(B.x1, Math.ceil(cx + rc));
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
      const dx = x - cx, dy = y - cy, d = Math.sqrt(dx * dx + dy * dy);
      if (d >= rc) continue;
      const w = (1 - d / rc) ** 2, i = (y - top) * gw + x;
      if (moving) { const k = Math.min(1, dt * FOG.drag) * w; U[i]! += (vx / cell - U[i]!) * k; V[i]! += (vy / cell - V[i]!) * k; }
      if (burst && d > 0.01) { const push = (w * FOG.burst.push) / cell * dt; U[i]! += (dx / d) * push; V[i]! += (dy / d) * push; }
    }
  }
  const jet = input.jet;
  if (jet && Number.isFinite(jet.x) && Number.isFinite(jet.y) && jet.reach > 0) {
    const jx = jet.x / cell + PAD, jy = jet.y / cell + PAD, rj = jet.reach / cell, k = (jet.speed / cell) * dt;
    for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) {
      const dx = x - jx, dy = y - jy, d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.01 || d > rj) continue;
      const w = (1 - d / rj) ** 2, i = (y - top) * gw + x;
      U[i]! += (dx / d) * w * k; V[i]! += (dy / d) * w * k;
    }
    bursting = true;
  }
  project(field, B, input.rounds ?? FOG.rounds, bursting ? FOG.burst.keep : 1);
  U0.set(U); V0.set(V); D0.set(D); OX0.set(OX); OY0.set(OY);
  /* The density as the step began, kept in `P`: the pressure solve is done with it, and the next step's `project` clears every cell of it that it reads before it reads it. */
  s.P.set(D);
  advect(s, gw, U, U0, dt, B, 0, cell); advect(s, gw, V, V0, dt, B, 0, cell); advect(s, gw, D, D0, dt, B, 0, cell); advect(s, gw, OX, OX0, dt, B, 1, cell); advect(s, gw, OY, OY0, dt, B, 2, cell);

  const damp = Math.exp(-dt / (FOG.damp / 1000)), settle = Math.exp(-dt / (FOG.settle / 1000)), sink = 1 - Math.exp(-dt / (FOG.sink / 1000));
  const back = dt / ((input.fill !== undefined && input.fill > 0 ? input.fill : SMOKE.wake) / 1000);
  D0.set(D);
  /* The cells the model can reach: it is asked about no other, and they are whole fog to it. */
  let mx0 = input.whole ? 0 : gw, mx1 = input.whole ? gw : 0, my0 = input.whole ? 0 : gh, my1 = input.whole ? gh : 0;
  for (const p of [...clearings, ...trail]) {
    const cx = p.x / cell + PAD, cy = p.y / cell + PAD;
    mx0 = Math.min(mx0, Math.floor(cx - rr) - 1); mx1 = Math.max(mx1, Math.ceil(cx + rr) + 1); my0 = Math.min(my0, Math.floor(cy - rr) - 1); my1 = Math.max(my1, Math.ceil(cy + rr) + 1);
  }
  let nx0 = gw, nx1 = 0, ny0 = gh, ny1 = 0, quiet = true, busy = false;
  for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) {
    const i = (y - top) * gw + x;
    U[i]! *= damp; V[i]! *= damp; OX[i]! *= settle; OY[i]! *= settle;
    /* The model is the floor: where it says clear, the fog is driven out; where it says fog, the fog comes back, from its neighbors inward. */
    const target = x >= mx0 && x < mx1 && y >= my0 && y < my1 ? input.target((x - PAD + 0.5) * cell, (y - PAD + 0.5) * cell) : 1;
    const d = D[i]!;
    if (d > target) D[i] = d + (target - d) * sink;
    else if (d < 1) {
      const nb = (D0[i - 1]! + D0[i + 1]! + D0[i - gw]! + D0[i + gw]!) * 0.25;
      D[i] = Math.min(target, d + back * (FOG.refill.base + FOG.refill.neighbors * nb) * (FOG.refill.over - d));
    }
    const live = D[i]! < FOG.rest.density || Math.abs(U[i]!) + Math.abs(V[i]!) > FOG.rest.speed;
    if (live) quiet = false;
    if (Math.abs(U[i]!) + Math.abs(V[i]!) > FOG.rest.speed || Math.abs(D[i]! - s.P[i]!) > 0.002) busy = true;
    if (live || Math.abs(OX[i]!) + Math.abs(OY[i]!) > FOG.rest.carried) {
      if (x < nx0) nx0 = x;
      if (x >= nx1) nx1 = x + 1;
      if (y < ny0) ny0 = y;
      if (y >= ny1) ny1 = y + 1;
    } else { U[i] = 0; V[i] = 0; OX[i] = 0; OY[i] = 0; D[i] = 1; }
  }
  if (nx1 > nx0) { field.box = { x0: nx0, x1: nx1, y0: ny0, y1: ny1 }; field.quiet = quiet && !modeled; field.busy = busy; }
  else { field.box = null; field.store = null; field.quiet = false; }
  return (B.x1 - B.x0) * (B.y1 - B.y0);
}

/**
 * A quiet box's step: nothing flows and nothing is thinned, so the flow is not worked out; the carried texture eases back where it stands and the box
 * shrinks to what is still carried. The long tail of a disturbance (the texture takes seconds to come home) costs a multiply a cell.
 */
function ease(field: FogField, B: CellBox, s: FogStore, dt: number): number {
  const gw = field.gw, settle = Math.exp(-dt / (FOG.settle / 1000)), { D, U, V, OX, OY } = s;
  let nx0 = gw, nx1 = 0, ny0 = field.gh, ny1 = 0;
  for (let y = B.y0; y < B.y1; y++) for (let x = B.x0; x < B.x1; x++) {
    const i = (y - s.y0) * gw + x;
    U[i] = 0; V[i] = 0; D[i] = 1;
    OX[i]! *= settle; OY[i]! *= settle;
    if (Math.abs(OX[i]!) + Math.abs(OY[i]!) > FOG.rest.carried) {
      if (x < nx0) nx0 = x;
      if (x >= nx1) nx1 = x + 1;
      if (y < ny0) ny0 = y;
      if (y >= ny1) ny1 = y + 1;
    } else { OX[i] = 0; OY[i] = 0; }
  }
  if (nx1 > nx0) field.box = { x0: nx0, x1: nx1, y0: ny0, y1: ny1 };
  else { field.box = null; field.store = null; field.quiet = false; }
  return (B.x1 - B.x0) * (B.y1 - B.y0);
}

/* -------------------------------------------------------------------------------- the model's answer, asked a cell at a time ---- */

/**
 * `covered` (smoke.ts), prepared for the many points a frame asks it about: the same answer at every point, to the last bit, but each clearing's and trail
 * point's openness is worked out once, a shut one is left out, and the rest are kept in a grid of `radius`-wide buckets so a point asks only the discs that can
 * reach it (a trail is up to 95 of them, and the field and the direct picture ask about every cell). The model stays `covered`'s: this reads it, it has no
 * radius or timing of its own, and the smallest of the answers is the same whatever order they are taken in. A coordinate that is not a number goes the long way.
 */
export function coverageOf(clearings: readonly Clearing[], radius: number, now: number, reduced: boolean, trail: readonly TrailPoint[] = []): (x: number, y: number) => number {
  const xs: number[] = [], ys: number[] = [], os: number[] = [];
  let sound = Number.isFinite(radius) && radius > 0;
  const add = (x: number, y: number, o: number): void => {
    if (o <= 0) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) sound = false;
    xs.push(x); ys.push(y); os.push(o);
  };
  for (const c of clearings) add(c.x, c.y, openness(c, now, reduced));
  for (const p of trail) add(p.x, p.y, trailOpenness(p, now, reduced));
  if (xs.length === 0) return () => 1;
  if (!sound) return (x, y) => covered(x, y, clearings, radius, now, reduced, trail);
  const core = radius * (1 - SMOKE.edge), span = radius - core, n = xs.length;
  const buckets = new Map<number, number[]>();
  const key = (bx: number, by: number): number => bx * 1_000_003 + by;
  for (let i = 0; i < n; i++) {
    const k = key(Math.floor(xs[i]! / radius), Math.floor(ys[i]! / radius));
    const list = buckets.get(k);
    if (list) list.push(i); else buckets.set(k, [i]);
  }
  return (x, y) => {
    let fog = 1;
    const bx = Math.floor(x / radius), by = Math.floor(y / radius);
    for (let a = bx - 1; a <= bx + 1; a++) for (let b = by - 1; b <= by + 1; b++) {
      const list = buckets.get(key(a, b));
      if (!list) continue;
      for (let j = 0; j < list.length; j++) {
        const i = list[j]!, dx = x - xs[i]!, dy = y - ys[i]!;
        if (dx >= radius || -dx >= radius || dy >= radius || -dy >= radius) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        const local = d <= core ? 0 : d >= radius ? 1 : (d - core) / span;
        fog = Math.min(fog, 1 - (1 - local) * os[i]!);
      }
    }
    return fog;
  };
}

/* -------------------------------------------------------------------------------- the picture ---- */

/** `paintFog`'s scratch: six numbers a column (see there), kept between calls and grown as needed. */
let cols = new Float32Array(0);

export interface FogPaint {
  /** The caster's color. */
  readonly color: readonly [number, number, number];
  /** How opaque fog at rest is, 0 to 1. */
  readonly alpha: number;
  /** How long the sheets have drifted, ms; 0 for fog that stands still. */
  readonly t: number;
  /** Where this post reads the page's cloud, px, so two posts are not the same fog. */
  readonly phase?: { readonly x: number; readonly y: number };
  /**
   * Reads the fog's density from the model and no field (reduced motion, and the cost ladder's last step): `target` as `FogInput`'s, asked only inside
   * `reach` (the box's px), with resting fog everywhere else.
   */
  readonly direct?: { readonly target: (x: number, y: number) => number; readonly reach: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } | null };
  /** Bands of the box (px rows) open across its whole width, each by `o` (0 to 1): the lines a held sweep has finished. */
  readonly bands?: readonly { readonly top: number; readonly bottom: number; readonly o: number }[];
}

/**
 * The fog's picture for grid rows `rows.y0` up to `rows.y1`, as RGBA bytes a row of `field.gw` cells at a time, into `out` (at least
 * `gw * (y1 - y0) * 4` long). A cell is one pixel; the caller scales it up smooth, at `cellOrigin`. Color carries the shading; alpha is `alpha` exactly
 * wherever the fog is whole, and less only where it is thinned.
 */
export function paintFog(field: FogField, cloud: FogCloud, out: Uint8ClampedArray, rows: { readonly y0: number; readonly y1: number }, o: FogPaint): void {
  const { gw, cell } = field, s = o.direct ? null : field.store, direct = o.direct;
  const A = Math.round(clamp(o.alpha, 0, 1) * 255), sec = o.t / 1000;
  const S1 = FOG.sheet1.scale, S2 = FOG.sheet2.scale, px0 = o.phase?.x ?? 0, py0 = o.phase?.y ?? 0;
  const ax = sec * FOG.sheet1.dx + px0, ay = sec * FOG.sheet1.dy + py0, bx = sec * FOG.sheet2.dx + px0, by = sec * FOG.sheet2.dy + py0;
  const [cr, cg, cb] = o.color;
  const sr = cr * FOG.shade.r, sg = cg * FOG.shade.g, sb = Math.min(255, cb * FOG.shade.b + FOG.shade.lift);
  const reach = direct?.reach ?? null;
  /* Where each column reads each sheet when its fog has not been carried: worked out once a call, since most of a picture is fog at rest. */
  if (cols.length < gw * 6) cols = new Float32Array(gw * 6);
  for (let x = 0; x < gw; x++) {
    const wx = (x - PAD + 0.5) * cell, u1 = (wx + ax) / S1, u2 = (wx + bx) / S2 + FOG.sheet2.ox, a1 = Math.floor(u1), a2 = Math.floor(u2), k = x * 6;
    cols[k] = a1 & 255; cols[k + 1] = (a1 + 1) & 255; cols[k + 2] = u1 - a1;
    cols[k + 3] = a2 & 255; cols[k + 4] = (a2 + 1) & 255; cols[k + 5] = u2 - a2;
  }
  const { n, t1, t2 } = cloud;
  let at = 0;
  for (let y = rows.y0; y < rows.y1; y++) {
    const wy = (y - PAD + 0.5) * cell;
    let band = 1;
    if (o.bands) for (const b of o.bands) if (wy >= b.top && wy < b.bottom) band = Math.min(band, 1 - b.o);
    const stored = s !== null && y >= s.y0 && y < s.y0 + s.rows, above = s !== null && y - 1 >= s.y0 && y - 1 < s.y0 + s.rows;
    const base = s ? (y - s.y0) * gw : 0;
    const inRows = reach !== null && wy >= reach.top && wy <= reach.bottom;
    const v1 = (wy + ay) / S1, v2 = (wy + by) / S2 + FOG.sheet2.oy, b1 = Math.floor(v1), b2 = Math.floor(v2), f1 = v1 - b1, f2 = v2 - b2;
    const ya1 = (b1 & 255) << 8, yb1 = ((b1 + 1) & 255) << 8, ya2 = (b2 & 255) << 8, yb2 = ((b2 + 1) & 255) << 8;
    for (let x = 0; x < gw; x++, at += 4) {
      const wx = (x - PAD + 0.5) * cell;
      let d = 1, ox = 0, oy = 0, wall = 0;
      if (direct) {
        if (inRows && wx >= reach!.left && wx <= reach!.right) d = direct.target(wx, wy);
      } else if (stored) {
        const i = base + x;
        d = s!.D[i]!;
        ox = s!.OX[i]!;
        oy = s!.OY[i]!;
        /* The walls of a clearing are lit and shaded like the fog's own billows: thicker fog toward the lower right of a point faces the light. */
        if (x > 0) wall = d - (above ? s!.D[i - gw - 1]! : 1);
      }
      if (band < d) d = band;
      if (d <= 0.002) { out[at] = 0; out[at + 1] = 0; out[at + 2] = 0; out[at + 3] = 0; continue; }
      let tone = 0.5 + wall * FOG.wall, shape = 0;
      const carried = ox !== 0 || oy !== 0, thin = d < FOG.rest.density;
      if (carried) {
        const tx = wx + ox, ty = wy + oy;
        tone += sample(t1, (tx + ax) / S1, (ty + ay) / S1) + sample(t2, (tx + bx) / S2 + FOG.sheet2.ox, (ty + by) / S2 + FOG.sheet2.oy);
        if (thin) shape = sample(n, (tx + ax) / S1, (ty + ay) / S1);
      } else {
        const k = x * 6, xa = cols[k]!, xb = cols[k + 1]!, fx = cols[k + 2]!, xc = cols[k + 3]!, xd = cols[k + 4]!, gx = cols[k + 5]!;
        const p = t1[ya1 | xa]!, q = t1[ya1 | xb]!, r = t1[yb1 | xa]!, w = t1[yb1 | xb]!;
        const p2 = t2[ya2 | xc]!, q2 = t2[ya2 | xd]!, r2 = t2[yb2 | xc]!, w2 = t2[yb2 | xd]!;
        tone += p + (q - p) * fx + (r - p) * f1 + (p - q - r + w) * fx * f1 + p2 + (q2 - p2) * gx + (r2 - p2) * f2 + (p2 - q2 - r2 + w2) * gx * f2;
        if (thin) { const e = n[ya1 | xa]!, g = n[ya1 | xb]!, h = n[yb1 | xa]!, j = n[yb1 | xb]!; shape = e + (g - e) * fx + (h - e) * f1 + (e - g - h + j) * fx * f1; }
      }
      if (tone >= 0.5) {
        const k = Math.min(FOG.light.most, (tone - 0.5) * FOG.light.gain);
        out[at] = cr + (255 - cr) * k; out[at + 1] = cg + (255 - cg) * k; out[at + 2] = cb + (255 - cb) * k;
      } else {
        const k = Math.min(FOG.shade.most, (0.5 - tone) * FOG.shade.gain);
        out[at] = cr + (sr - cr) * k; out[at + 1] = cg + (sg - cg) * k; out[at + 2] = cb + (sb - cb) * k;
      }
      /* At rest the fog is exactly as opaque as the model says (the ghost stays); where it is thinned, the cloud's own shape eats its edge into wisps. */
      out[at + 3] = thin ? A * smooth(d - (1 - d) * (FOG.wisp.base + shape * FOG.wisp.cloud) * FOG.wisp.bite) : A;
    }
  }
}
