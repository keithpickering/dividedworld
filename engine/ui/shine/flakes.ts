/**
 * Glitter (docs/plans/2026-11-06-shine-design.md sections 2, 5 and 6), ported from the approved bench's `buildFlakes`, `flake`,
 * `drawFlakes`, `flakeColour`, `holoAt`, `fire` and `stepBurst` and its cling code (docs/research/2026-11-06-shine-bench).
 * Three parts:
 *
 * - `makeFlakes` places a post's flakes, seeded, one per `density` px squared and thickest around a seeded burst point. Before
 *   its burst a post shows 15% of them; `draw` paints the settled ones under the words, every color moved into the band.
 * - `burst` starts the one burst each flakes object gets: about 85% of the flakes fly out over the words and land under them.
 *   The host steps it with `stepBurst(flakes, now)` and paints it with `drawBurst(ctx, flakes, band, now)` on a second canvas
 *   over the words. Both return whether another frame is needed. At most `MAX_IN_FLIGHT` fly across the page; past that a
 *   burst lands its remainder at once. Under reduced motion there is no burst and every flake is placed at once.
 * - Cling: a mouse passing over a `sticky` registered host picks flakes up (at most 26), they ride the pointer, drop off over
 *   anything else and land on whichever registered host is under them (or fade). Loose glitter is `loose(host)`, 300 across
 *   the page, oldest first, the reader's own and never saved. One page-fixed canvas draws the flakes in the air; it is made on
 *   the first pickup and removed after `IDLE_MS` with nothing carried or falling, in the shape of Whoops!'s drawn cursor so a
 *   later port to the engine loop is a move.
 *
 * Units: a box is CSS px {w, h}; `density` is px squared per flake; a light is {x, y} in -1.5..1.5; `now` is milliseconds, as
 * the page's loop gives it; colors are computed in LINEAR light and written as `#rrggbb`. A flake's `nx, ny` is its tilt, in the
 * light's units. Seeded, never `Math.random`. Engine code: it names no card and no instance.
 */
import { motionReduced } from '../appearance.ts';
import { bandFor, clampInto, toHex, toHexA, toLinear, toSrgb8, type Band, type Light, type Rgb } from './band.ts';
import { seededRng } from './seeded.ts';

export type Box = { readonly w: number; readonly h: number };

/** The share of a post's flakes it shows before its burst. */
const SHOWN_BEFORE = 0.15;
/** Burst flakes in flight across the page, loose flakes across the page, flakes on the pointer. */
export const MAX_IN_FLIGHT = 1500;
export const MAX_LOOSE = 300;
export const MAX_CARRIED = 26;
/** How long the cling layer outlives the last flake carried or falling. */
export const IDLE_MS = 4000;
/** A flake is drawn over the words for under two seconds: the longest flight plus the longest delay stays below it. */
const FLIGHT_MS = 1850;
const DELAY_MS = 120;
const PUFF_MS = 650;
const FINE = '(hover: hover) and (pointer: fine)';
const REDUCE = '(prefers-reduced-motion: reduce)';

/** The inks a flakes object draws from, in linear light; `rainbow` are the ones a holographic flake throws. */
export interface Palette {
  readonly lin: readonly Rgb[]; readonly rainbow: readonly Rgb[]; readonly holo: number;
  /** The instance's highlight, as `#rrggbb` (the sprite cache's key) and in linear light. */
  readonly glint: string; readonly glintLin: Rgb;
}

export interface Flake {
  x: number; y: number; s: number; rot: number; nx: number; ny: number; ink: number; tw: number; tph: number;
  pal: Palette;
  /** `cos(rot)` and `sin(rot)`, made on a flake's first draw. */
  cs?: number; sn?: number;
}

interface Particle {
  f: Flake; x: number; y: number; vx: number; vy: number; spin: number; ph: number; sway: number; wph: number; born: number; delay: number;
}

export interface FlakesOptions {
  /** Public ids only: the same seed gives the same glitter on every device. */
  readonly seed: string;
  readonly box: Box;
  /** sRGB `#rrggbb` inks. */
  readonly inks: readonly string[];
  /** The index from which inks are holographic. */
  readonly holo: number;
  /** CSS px squared per flake (70). */
  readonly density: number;
  /** The instance's highlight, sRGB `#rrggbb`: the flare, and the puff's tint (moved into the band). The engine names no color. */
  readonly glint: string;
  /** The four-point flare drawn over the brightest flakes; by default one is made on first use, when a canvas can be made. */
  readonly star?: CanvasImageSource | null;
}

export interface Flakes {
  readonly box: Box;
  readonly palette: Palette;
  /** The seeded burst point. */
  readonly origin: { readonly x: number; readonly y: number };
  /** Every flake the post holds, resting place and all. */
  readonly total: number;
  /** The flakes settled now: 15% before the burst, all of them after. */
  readonly settled: readonly Flake[];
  /** Whether `burst` has run. */
  readonly fired: boolean;
  /** How many of this post's flakes are in the air now. */
  readonly flying: number;
  /**
   * Paint the settled flakes under the words. `idle` turns the twinkle on. `density` is the canvas's px per CSS px (default 1):
   * the draw sets the transform per flake and leaves it at that scale, which is the host's base transform.
   */
  draw(ctx: CanvasRenderingContext2D, light: Light, band: Band, now: number, idle: boolean, density?: number): void;
}

interface Inner extends Flakes {
  settled: Flake[];
  rest: Flake[];
  fired: boolean;
  flying: number;
  parts: Particle[];
  puff: number | null;
  last: number | null;
  star: CanvasImageSource | null | undefined;
  rng: () => number;
}

/** Flakes in the air across the page, so a page of bursting posts stays bounded. */
let inFlight = 0;

const reduced = (): boolean => typeof document !== 'undefined' && motionReduced();

function paletteOf(inks: readonly string[], holo: number, glint: string): Palette {
  if (!/^#[0-9a-f]{6}$/iu.test(glint)) throw new Error(`flakes: the glint needs a #rrggbb color, got ${JSON.stringify(glint)}`);
  const lin = inks.map(toLinear);
  return { lin, rainbow: lin.slice(0, Math.max(1, Math.min(holo, lin.length))), holo, glint, glintLin: toLinear(glint) };
}

/** The bench's `flake`. */
function flake(r: () => number, x: number, y: number, pal: Palette): Flake {
  const a = r() * Math.PI * 2, m = Math.sqrt(r()) * 1.3;
  return {
    x, y, s: 1.2 + r() * r() * 2.2, rot: r() * Math.PI, nx: Math.cos(a) * m, ny: Math.sin(a) * m,
    ink: (r() * pal.lin.length) | 0, tw: r() < 0.125 ? 0.5 + r() * 1.2 : 0, tph: r() * 100, pal,
  };
}

/** A four-point flare in the glint, made once per glint if a canvas can be made here (the bench's `starSprite`). */
const sharedStars = new Map<string, CanvasImageSource | null>();
function starSprite(pal: Palette): CanvasImageSource | null {
  const have = sharedStars.get(pal.glint);
  if (have !== undefined) return have;
  sharedStars.set(pal.glint, null);
  const at = (a: number): string => toHexA(pal.glintLin, a);
  try {
    const Z = 64, m = Z / 2;
    const c: HTMLCanvasElement | OffscreenCanvas | null = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(Z, Z)
      : typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: Z, height: Z }) : null;
    const g = c?.getContext('2d') as CanvasRenderingContext2D | null | undefined;
    if (!c || !g) return null;
    const glow = g.createRadialGradient(m, m, 0, m, m, m);
    glow.addColorStop(0, at(0.95)); glow.addColorStop(0.18, at(0.45)); glow.addColorStop(1, at(0));
    g.fillStyle = glow; g.fillRect(0, 0, Z, Z);
    for (const vertical of [true, false]) {
      const gr = g.createRadialGradient(m, m, 0, m, m, m);
      gr.addColorStop(0, at(1)); gr.addColorStop(1, at(0));
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(m, m, vertical ? 1.6 : m, vertical ? m : 1.6, 0, 0, Math.PI * 2); g.fill();
    }
    g.save(); g.translate(m, m); g.rotate(Math.PI / 4);
    const gr2 = g.createRadialGradient(0, 0, 0, 0, 0, m * 0.55);
    gr2.addColorStop(0, at(0.8)); gr2.addColorStop(1, at(0));
    g.fillStyle = gr2;
    g.beginPath(); g.ellipse(0, 0, 1, m * 0.55, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(0, 0, m * 0.55, 1, 0, 0, Math.PI * 2); g.fill();
    g.restore();
    sharedStars.set(pal.glint, c as CanvasImageSource);
  } catch { sharedStars.set(pal.glint, null); }
  return sharedStars.get(pal.glint)!;
}

/** Places a post's flakes. Nothing flies until `burst`; 15% are settled until then. */
export function makeFlakes(opts: FlakesOptions): Flakes {
  const { w: W, h: H } = opts.box;
  const pal = paletteOf(opts.inks, opts.holo, opts.glint);
  const r = seededRng(`${opts.seed}:flakes`);
  const origin = { x: (0.25 + r() * 0.5) * W, y: (0.25 + r() * 0.4) * H };
  const n = Math.max(0, Math.round((W * H) / opts.density));
  const all: Flake[] = [];
  /* The bench retries a flake that lands outside the box; a box with no area, or a runaway, cannot loop forever. */
  for (let tries = 0; all.length < n && tries < n * 20 + 100; tries++) {
    let x: number, y: number;
    if (r() < 0.42) {
      const a = r() * Math.PI * 2, d = Math.sqrt(-2 * Math.log(1 - r() * 0.999)) * Math.min(W, H) * 0.28;
      x = origin.x + Math.cos(a) * d * 1.4; y = origin.y + Math.sin(a) * d;
    } else { x = r() * W; y = r() * H; }
    if (x < 0 || y < 0 || x > W || y > H) continue;
    all.push(flake(r, x, y, pal));
  }
  const keep = Math.round(all.length * SHOWN_BEFORE);
  const self: Inner = {
    box: opts.box, palette: pal, origin, total: all.length,
    settled: all.slice(0, keep), rest: all.slice(keep),
    fired: false, flying: 0, parts: [], puff: null, last: null, star: opts.star, rng: seededRng(`${opts.seed}:burst`),
    draw: (ctx, light, band, now, idle, density = 1) => drawList(ctx, self.settled, light, band, now, idle, self.star === undefined ? (self.star = starSprite(pal)) : self.star, density),
  };
  return self;
}

/* ---------------------------------------------------------------- color ---- */

const scratch: Rgb = [0, 0, 0];
const holoInk: Rgb = [0, 0, 0];
/* Packed 24-bit sRGB to its hex string: a draw makes no string per flake, only per distinct color. */
const hexOf = new Map<number, string>();

function hexFor(c: Readonly<Rgb>): string {
  const key = (toSrgb8(c[0]) << 16) | (toSrgb8(c[1]) << 8) | toSrgb8(c[2]);
  let s = hexOf.get(key);
  if (s === undefined) {
    if (hexOf.size > 20000) hexOf.clear();
    s = `#${key.toString(16).padStart(6, '0')}`;
    hexOf.set(key, s);
  }
  return s;
}

/** The bench's `holoAt`: the rainbow hue a holographic flake throws toward a light, into `holoInk`. */
function holoAt(f: Flake, lx: number, ly: number): Rgb {
  const rb = f.pal.rainbow, n = rb.length;
  const t = (Math.atan2(f.ny - ly, f.nx - lx) / (Math.PI * 2) + 1 + f.rot * 0.2) % 1;
  const x = t * n, i = x | 0, k = x - i, a = rb[i % n]!, b = rb[(i + 1) % n]!;
  holoInk[0] = a[0] + (b[0] - a[0]) * k; holoInk[1] = a[1] + (b[1] - a[1]) * k; holoInk[2] = a[2] + (b[2] - a[2]) * k;
  return holoInk;
}

/** The bench's `flakeColour`: how lit a flake is (`a`, 0..1) at a light, as a `#rrggbb` inside the band. */
function flakeColour(f: Flake, a: number, band: Band, lx: number, ly: number): string {
  const base = f.pal.lin[f.ink]!;
  const ink = f.ink >= f.pal.holo && a > 0.15 ? holoAt(f, lx, ly) : base;
  if (band.lo === 0) {
    /* The dark board: deep jewel tones. */
    const k = 0.05 + 0.95 * a;
    scratch[0] = ink[0] * k; scratch[1] = ink[1] * k; scratch[2] = ink[2] * k;
  } else {
    const k = 0.38 + 0.62 * a;
    scratch[0] = 1 + (ink[0] - 1) * k; scratch[1] = 1 + (ink[1] - 1) * k; scratch[2] = 1 + (ink[2] - 1) * k;
  }
  if (a > 0.6) {
    const w = (a - 0.6) / 0.4;
    scratch[0] += (1 - scratch[0]) * w; scratch[1] += (1 - scratch[1]) * w; scratch[2] += (1 - scratch[2]) * w;
  }
  return hexFor(clampInto(scratch, band));
}

/** How lit a flake is: its tilt against the light, or its idle twinkle. */
function litness(f: Flake, lx: number, ly: number, now: number, idle: boolean, sharp = 0.03): number {
  let a = Math.exp(-((f.nx - lx) ** 2 + (f.ny - ly) ** 2) / sharp);
  /* About one flake in eight winks on its own now and then, whatever the light is doing. */
  if (idle && f.tw) a = Math.max(a, Math.max(0, Math.sin((now / 1000) * f.tw + f.tph)) ** 60);
  return a;
}

/* Per-draw scratch, grown to the longest list and reused: a redraw allocates nothing per flake. */
const colorIds = new Map<string, number>();
const colorNames: string[] = [];
let colorOf = new Int32Array(0);
let order = new Int32Array(0);
let starts = new Int32Array(0);
const flareAt: number[] = [];
const flareA: number[] = [];

/**
 * Paints a list of flakes. One `setTransform` places each (no save/restore), the fill is set once per color (flakes are drawn
 * a color at a time, in list order within a color: overlapping flakes of different colors may stack differently than in list
 * order, which a glitter does not show), and the flares reuse the lit flakes found while coloring. Leaves the transform at the
 * density scale.
 */
function drawList(
  ctx: CanvasRenderingContext2D, list: readonly Flake[], light: Light, band: Band, now: number, idle: boolean,
  star: CanvasImageSource | null, density = 1,
): void {
  const n = list.length;
  if (!n) return;
  const { x: lx, y: ly } = light;
  if (colorOf.length < n) { colorOf = new Int32Array(n); order = new Int32Array(n); }
  colorIds.clear(); colorNames.length = 0; flareAt.length = 0; flareA.length = 0;
  for (let i = 0; i < n; i++) {
    const f = list[i]!;
    const a = litness(f, lx, ly, now, idle);
    const name = flakeColour(f, a, band, lx, ly);
    let id = colorIds.get(name);
    if (id === undefined) { id = colorNames.length; colorIds.set(name, id); colorNames.push(name); }
    colorOf[i] = id;
    if (a > 0.75) { flareAt.push(i); flareA.push(a); }
  }
  /* A counting sort by color id: stable, so the order within a color is the list's. */
  const k = colorNames.length;
  if (starts.length < k + 1) starts = new Int32Array(k + 1);
  starts.fill(0, 0, k + 1);
  for (let i = 0; i < n; i++) starts[colorOf[i]! + 1]!++;
  for (let c = 0; c < k; c++) starts[c + 1]! += starts[c]!;
  for (let i = 0; i < n; i++) order[starts[colorOf[i]!]!++] = i;
  const d = density;
  let cur = -1;
  for (let j = 0; j < n; j++) {
    const i = order[j]!, f = list[i]!;
    if (colorOf[i] !== cur) { cur = colorOf[i]!; ctx.fillStyle = colorNames[cur]!; }
    const cos = (f.cs ??= Math.cos(f.rot)), sin = (f.sn ??= Math.sin(f.rot));
    ctx.setTransform(cos * d, sin * d, -sin * d, cos * d, f.x * d, f.y * d);
    ctx.fillRect(-f.s / 2, -f.s * 0.42, f.s, f.s * 0.84);
  }
  ctx.setTransform(d, 0, 0, d, 0, 0);
  /* A flare adds white, which only stays in the band where the band reaches white: the light board. Nowhere else is one drawn. */
  if (band.hi < 1 || !flareAt.length || !star) return;
  /* The flares are the few flakes facing the light, drawn additively after the rest. */
  ctx.globalCompositeOperation = 'lighter';
  for (let j = 0; j < flareAt.length; j++) {
    const f = list[flareAt[j]!]!;
    const alpha = (flareA[j]! - 0.75) / 0.25;
    if (alpha < 0.03) continue;
    const z = 7 + f.s * 4;
    ctx.globalAlpha = alpha; ctx.drawImage(star, f.x - z / 2, f.y - z / 2, z, z);
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

/**
 * Every color the glitter draws at a light, as `#rrggbb`, without duplicates: each ink fully unlit and fully lit, every
 * holographic hue the flakes in the list throw, and the colors the flakes themselves show (twinkle included). For the
 * readable-band check, which asks it at a grid of lights on both boards.
 */
export function sampleFlakes(flakes: Flakes, light: Light, band: Band, now: number): Set<string> {
  const out = new Set<string>();
  const f0 = (flakes as Inner);
  const list = [...f0.settled, ...f0.rest];
  const pal = flakes.palette;
  for (const f of list) {
    out.add(flakeColour(f, litness(f, light.x, light.y, now, true), band, light.x, light.y));
    for (const a of [0, 0.2, 0.5, 1]) out.add(flakeColour(f, a, band, light.x, light.y));
  }
  /* Lit holographic hues across the tilt circle, whatever the post's own flakes happen to face. */
  const probe: Flake = { x: 0, y: 0, s: 1, rot: 0, nx: 0, ny: 0, ink: pal.holo, tw: 0, tph: 0, pal };
  if (pal.holo < pal.lin.length) {
    for (let i = 0; i < 24; i++) {
      probe.rot = (i / 24) * Math.PI * 5;
      for (const a of [0.2, 0.6, 1]) out.add(flakeColour(probe, a, band, light.x, light.y));
    }
  }
  return out;
}

/* ---------------------------------------------------------------- burst ---- */

/**
 * Starts the burst, once per flakes object. Under reduced motion it places every flake at once and flies nothing. At most
 * `MAX_IN_FLIGHT` fly across the page; the rest of this post's flakes land at once. Returns whether a frame is needed
 * (`stepBurst` from then on, and `drawBurst`).
 *
 * Determinism: the glitter a post ends with (which flakes, where, in what ink) is fixed by its seed and is the same however the
 * burst went. The split between flying and landing at once depends on how much of the page-wide cap other posts hold at the
 * time, and the order flakes settle in follows from it, so only the settled SET is reproducible, not the frame-by-frame show.
 */
export function burst(flakes: Flakes, now: number): boolean {
  const f = flakes as Inner;
  if (f.fired) return f.parts.length > 0 || f.puff !== null;
  f.fired = true;
  if (reduced()) { f.settled.push(...f.rest); f.rest = []; return false; }
  const r = f.rng;
  const fly = Math.max(0, Math.min(f.rest.length, MAX_IN_FLIGHT - inFlight));
  f.puff = now;
  for (let i = 0; i < f.rest.length; i++) {
    const target = f.rest[i]!;
    if (i >= fly) { f.settled.push(target); continue; }
    const a = -Math.PI / 2 + (r() - 0.5) * Math.PI * 1.7, sp = 160 + r() * 420;
    f.parts.push({
      f: target, x: f.origin.x + (r() - 0.5) * 6, y: f.origin.y + (r() - 0.5) * 6, vx: Math.cos(a) * sp * 1.3, vy: Math.sin(a) * sp,
      spin: 6 + r() * 18, ph: r() * 6, sway: 10 + r() * 30, wph: r() * 6, born: now, delay: r() * DELAY_MS,
    });
  }
  f.rest = [];
  inFlight += f.parts.length;
  f.flying = f.parts.length;
  f.last = now;
  return true;
}

const ease01 = (k: number) => k * k * (3 - 2 * k);

/**
 * Advances the burst to `now`: moves the flakes in the air and lands the ones that arrived under the words (they join
 * `settled`, so the host redraws its under canvas when this returns true or `flying` changed). Returns whether another
 * frame is needed. The bench's physics for the first part of the flight, then each flake is led to its resting place so that
 * every one lands inside `FLIGHT_MS`.
 */
export function stepBurst(flakes: Flakes, now: number): boolean {
  const f = flakes as Inner;
  if (!f.fired) return false;
  /* Reduced motion turned on mid-burst: what is in the air lands where it was headed, now. */
  if (f.parts.length && reduced()) { release(f); return false; }
  const dt = f.last === null ? 0 : Math.min(0.05, Math.max(0, (now - f.last) / 1000));
  f.last = now;
  if (f.puff !== null && now - f.puff >= PUFF_MS) f.puff = null;
  const parts = f.parts;
  for (let i = parts.length - 1; i >= 0; i--) {
    const b = parts[i]!;
    const age = now - b.born;
    if (age < b.delay) continue;
    b.vy += 520 * dt; b.vx *= Math.exp(-dt * 2.6); b.vy *= Math.exp(-dt * 3.4);
    b.x += (b.vx + Math.sin((age / 1000) * 4 + b.wph) * b.sway) * dt; b.y += b.vy * dt; b.ph += b.spin * dt;
    const dx = b.f.x - b.x, dy = b.f.y - b.y;
    /* Once it is falling, each flake drifts toward the spot it will rest on, and lands when it reaches it. */
    if (b.vy > 0) { b.x += dx * Math.min(1, dt * 1.6); b.y += Math.max(0, dy) * Math.min(1, dt * 1.2); }
    /* Past the middle of the flight it is led the rest of the way, so it arrives in time. */
    const lead = ease01(Math.max(0, Math.min(1, (age - b.delay - FLIGHT_MS * 0.5) / (FLIGHT_MS * 0.5))));
    if (lead > 0) { b.x += (b.f.x - b.x) * lead * Math.min(1, dt * 12); b.y += (b.f.y - b.y) * lead * Math.min(1, dt * 12); }
    if ((b.vy > 0 && Math.abs(dy) < 3 && Math.abs(dx) < 3) || age - b.delay >= FLIGHT_MS) {
      f.settled.push(b.f);
      parts[i] = parts[parts.length - 1]!;
      parts.pop();
      inFlight--;
    }
  }
  f.flying = parts.length;
  if (!parts.length && f.puff === null) f.last = null;
  return parts.length > 0 || f.puff !== null;
}

/** The color of a flake in the air, in the band, at a flash of 0..1 (the bench's burst coloring, then moved into the band). */
function burstColor(f: Flake, flash: number, band: Band): string {
  const ink = f.pal.lin[f.ink]!;
  const dark = band.lo === 0;
  const k = dark ? 0.25 + 0.75 * flash : 0.55 + 0.45 * flash;
  const w0 = dark ? 0 : 1;
  scratch[0] = ink[0] * k + (1 - k) * w0 * 0.3; scratch[1] = ink[1] * k; scratch[2] = ink[2] * k;
  return hexFor(clampInto(scratch, band));
}

/**
 * The puff's one color, linear: the instance's glint moved into the band, so every stop is a color that is itself in the band,
 * and over cells that are in the band the mix stays in it. Where the band reaches white (the light board) the glint can only
 * lighten or hold a cell inside [lo, 1] once `clampInto` has lifted it to `lo` if it is darker. Where it does not, the clamp
 * scales it to at most `hi`: both ends are then at most `hi`, and a mix of two such colors in gamma space is at most `hi` in
 * luminance, because the sRGB curve is convex. The clamp keeps the glint's hue; a white glint on the dark board is a gray.
 */
const puffTint: Rgb = [0, 0, 0];
function puffColor(pal: Palette, band: Band): Readonly<Rgb> {
  const g = pal.glintLin;
  puffTint[0] = g[0]; puffTint[1] = g[1]; puffTint[2] = g[2];
  return clampInto(puffTint, band);
}

/**
 * Paints the burst on the canvas over the words: the puff and every flake in the air. Clearing the canvas is the host's.
 * `density` is the canvas's px per CSS px (default 1): each flake is placed by one `setTransform`, and the transform is left at
 * that scale, the host's base transform.
 */
export function drawBurst(ctx: CanvasRenderingContext2D, flakes: Flakes, band: Band, now: number, density = 1): void {
  const f = flakes as Inner;
  const d = density;
  const whiteFits = band.hi >= 1;
  if (f.puff !== null) {
    const k = (now - f.puff) / PUFF_MS;
    if (k >= 0 && k < 1) {
      const R = 20 + k * 140, a = (1 - k) * (band.lo === 0 ? 0.55 : 0.7), { x, y } = f.origin;
      const c = puffColor(f.palette, band);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, R);
      gr.addColorStop(0, toHexA(c, a)); gr.addColorStop(0.5, toHexA(c, a * 0.35)); gr.addColorStop(1, toHexA(c, 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = toHexA(c, (1 - k) * 0.8); ctx.lineWidth = 2 * (1 - k);
      ctx.beginPath(); ctx.arc(x, y, R * 0.8, 0, Math.PI * 2); ctx.stroke();
    }
  }
  const star = whiteFits ? (f.star === undefined ? (f.star = starSprite(f.palette)) : f.star) : null;
  for (let i = 0; i < f.parts.length; i++) {
    const b = f.parts[i]!;
    if (now - b.born < b.delay) continue;
    const flash = Math.abs(Math.sin(b.ph)) ** 10;
    ctx.fillStyle = burstColor(b.f, flash, band);
    const w = b.f.s * (0.3 + 0.7 * Math.abs(Math.cos(b.ph)));
    const rot = b.f.rot + b.ph * 0.2, cos = Math.cos(rot), sin = Math.sin(rot);
    ctx.setTransform(cos * d, sin * d, -sin * d, cos * d, b.x * d, b.y * d);
    ctx.fillRect(-w / 2, -b.f.s * 0.42, w, b.f.s * 0.84);
    if (flash > 0.8 && star) {
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (flash - 0.8) * 5 * 0.8;
      const z = 9 + b.f.s * 3;
      ctx.drawImage(star, b.x - z / 2, b.y - z / 2, z, z);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
  }
  ctx.setTransform(d, 0, 0, d, 0, 0);
}

/**
 * Every color `drawBurst` paints at `now`, as `#rrggbb`: each flake in the air as it is now, each of the post's inks at
 * three flashes, and the puff's one color while the puff shows. For the readable-band check.
 */
export function sampleBurst(flakes: Flakes, band: Band, now: number): Set<string> {
  const f = flakes as Inner;
  const out = new Set<string>();
  for (const b of f.parts) {
    if (now - b.born < b.delay) continue;
    out.add(burstColor(b.f, Math.abs(Math.sin(b.ph)) ** 10, band));
  }
  const probe: Flake = { x: 0, y: 0, s: 1, rot: 0, nx: 0, ny: 0, ink: 0, tw: 0, tph: 0, pal: flakes.palette };
  for (let i = 0; i < flakes.palette.lin.length; i++) {
    probe.ink = i;
    for (const flash of [0, 0.5, 1]) out.add(burstColor(probe, flash, band));
  }
  if (f.puff !== null && now - f.puff >= 0 && now - f.puff < PUFF_MS) out.add(toHex(puffColor(flakes.palette, band)));
  return out;
}

/**
 * Lands this post's flakes in the air where they were headed and gives their share of the page-wide cap back. A host calls
 * it when the post unregisters or unmounts: a flakes object dropped mid-burst would otherwise keep the cap consumed for good.
 */
export function release(flakes: Flakes): void {
  const f = flakes as Inner;
  inFlight = Math.max(0, inFlight - f.parts.length);
  for (const b of f.parts) f.settled.push(b.f);
  f.parts = []; f.puff = null; f.last = null; f.flying = 0;
}

/**
 * Places every flake at rest at once: no burst, no use of the page-wide in-flight cap, and the burst marked as fired. For a post
 * that is built again after its burst, and for one shown still.
 */
export function landAll(flakes: Flakes): void {
  const f = flakes as Inner;
  f.fired = true;
  f.settled.push(...f.rest);
  f.rest = [];
}

/** For tests only: flakes in the air across the page, and a way back to a fresh page. */
export const burstProbe = {
  inFlight: () => inFlight,
  reset(): void { inFlight = 0; },
};

/* ---------------------------------------------------------------- loose ---- */

const looseByHost = new WeakMap<object, Flake[]>();
/** Every loose flake on the page in the order it landed, so the oldest is dropped first. */
const looseOrder: { host: object; flake: Flake }[] = [];

/** The glitter loose on a host: flakes that clung to the pointer and landed here, in host-local px. */
export function loose(host: object): Flake[] {
  let list = looseByHost.get(host);
  if (!list) { list = []; looseByHost.set(host, list); }
  return list;
}

/** Paints a host's loose flakes, as `draw` paints its settled ones. */
export function drawLoose(host: object, ctx: CanvasRenderingContext2D, light: Light, band: Band, now: number, idle: boolean, density = 1): void {
  const list = looseByHost.get(host);
  if (list?.length) drawList(ctx, list, light, band, now, idle, starSprite(list[0]!.pal), density);
}

function addLoose(host: object, f: Flake): void {
  loose(host).push(f);
  looseOrder.push({ host, flake: f });
  while (looseOrder.length > MAX_LOOSE) {
    const old = looseOrder.shift()!;
    const list = looseByHost.get(old.host);
    const at = list ? list.indexOf(old.flake) : -1;
    if (list && at >= 0) list.splice(at, 1);
  }
}

/** Forgets a host's loose flakes and their places in the page-wide 300, as a host does when it unmounts. */
export function dropLoose(host: object): void {
  looseByHost.delete(host);
  for (let i = looseOrder.length - 1; i >= 0; i--) if (looseOrder[i]!.host === host) looseOrder.splice(i, 1);
}

/** Forgets every loose flake (the reader swept, or left the page). */
export function sweepLoose(): void {
  for (const e of looseOrder) { const l = looseByHost.get(e.host); if (l) l.length = 0; }
  looseOrder.length = 0;
}

/* ---------------------------------------------------------------- cling ---- */

export interface ClingOptions {
  /** A host that picks flakes up from the pointer; it needs `flakes`, whose inks the carried ones wear. */
  readonly sticky?: boolean;
  readonly flakes?: Flakes;
  /** Called when a flake lands loose on this host, so it can redraw. */
  readonly landed?: () => void;
}

/* The cling layer is page-fixed and has no host of its own, so each flake keeps the band of the host it was picked up from
   (`bandFor` on that host's element at pickup): that is the board whose post inks it was lent against, and the layer is only
   ever drawn over registered hosts' boards. The page's root would be wrong the day a card themes a board of its own. */
interface Carried { f: Flake; ox: number; oy: number; ph: number; band: Band }
/* `over`: whether a registered host is under the flake, asked once when it starts to fade (and once more when it lands). */
interface Falling { f: Flake; x: number; y: number; vx: number; vy: number; land: number; fallen: number; ph: number; band: Band; over?: boolean }

const hosts = new Map<HTMLElement, ClingOptions>();
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let ratio = 1;
let frame = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let carried: Carried[] = [];
let falling: Falling[] = [];
let mouse: { x: number; y: number; speed: number; t: number } | null = null;
/** A pointer that was last seen longer ago than this is a new visit, not a very fast move. */
const STALE_MS = 100;
let lastTick: number | null = null;
let cr = seededRng('cursor');
let cleared = true;

/* The pointer and motion queries, asked of the browser once and kept current by their change events; the listeners come off with
   the layer (`dispose`) and are made again by the next use. A pointer move asks nothing of the browser. */
interface Media { fine: boolean; reduce: boolean; off: () => void }
let media: Media | null = null;

function watch(): Media {
  if (media) return media;
  const m: Media = { fine: false, reduce: false, off() {} };
  media = m;
  if (typeof window === 'undefined' || !window.matchMedia) return m;
  const fine = window.matchMedia(FINE), reduce = window.matchMedia(REDUCE);
  m.fine = fine.matches; m.reduce = reduce.matches;
  const onFine = (e: MediaQueryListEvent): void => { m.fine = e.matches; };
  const onReduce = (e: MediaQueryListEvent): void => { m.reduce = e.matches; };
  fine.addEventListener?.('change', onFine); reduce.addEventListener?.('change', onReduce);
  m.off = () => { fine.removeEventListener?.('change', onFine); reduce.removeEventListener?.('change', onReduce); };
  return m;
}

/* `motionReduced` with the device's setting read from the kept query: the player's override on the root still wins, by the one
   rule `appearance.ts` holds, and nothing is asked of the browser per event. */
const kept = { get documentElement() { return document.documentElement; }, defaultView: { matchMedia: () => ({ matches: watch().reduce }) } } as unknown as Document;
const clingReduced = (): boolean => typeof document !== 'undefined' && motionReduced(kept);

const canAct = (e: Pick<PointerEvent, 'pointerType'>): boolean => e.pointerType === 'mouse' && watch().fine;

/** The registered host that holds this node, if any: a walk up from the node, no measuring. */
function hostOf(n: EventTarget | null | undefined): HTMLElement | null {
  for (let el = n instanceof Element ? n : null; el; el = el.parentElement) if (hosts.has(el as HTMLElement)) return el as HTMLElement;
  return null;
}

/** The registered host under a viewport point, as the browser hit-tests it. */
const hostUnder = (x: number, y: number): HTMLElement | null =>
  typeof document === 'undefined' || !document.elementFromPoint ? null : hostOf(document.elementFromPoint(x, y));

/** A band read from a board's computed style is kept per host for this long: a sweep over a post asks the browser once, not per flake. */
const BAND_MS = 100;
let bands = new WeakMap<HTMLElement, { at: number; band: Band | null }>();
function bandAt(host: HTMLElement, now: number): Band | null {
  const had = bands.get(host);
  if (had && now - had.at >= 0 && now - had.at < BAND_MS) return had.band;
  let band: Band | null = null;
  try { band = bandFor(host); } catch { /* no band */ }
  bands.set(host, { at: now, band });
  return band;
}

function sizeCanvas(): void {
  if (!canvas) return;
  ratio = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.ceil(innerWidth * ratio), h = Math.ceil(innerHeight * ratio);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
}

function ensure(): void {
  clearTimeout(idleTimer);
  idleTimer = undefined;
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.kbShine = 'cling';
  canvas.className = 'kb-shine-cling';
  const st = canvas.style;
  st.position = 'fixed'; st.left = '0'; st.top = '0'; st.width = '100vw'; st.height = '100vh'; st.pointerEvents = 'none'; st.zIndex = '2147483000';
  document.body.append(canvas);
  ctx = canvas.getContext('2d');
  cleared = true;
  sizeCanvas();
  addEventListener('resize', sizeCanvas);
  addEventListener('pointermove', onMove);
}

function dispose(): void {
  canvas?.remove();
  canvas = null; ctx = null;
  removeEventListener('resize', sizeCanvas);
  removeEventListener('pointermove', onMove);
  media?.off(); media = null;
  bands = new WeakMap();
  cancelAnimationFrame(frame);
  frame = 0;
  carried = []; falling = []; mouse = null; lastTick = null;
}

function settle(): void {
  if (!idleTimer && canvas) idleTimer = setTimeout(() => { idleTimer = undefined; if (!carried.length && !falling.length) dispose(); }, IDLE_MS);
}

function loop(t: number): void {
  frame = 0;
  try { cling.tick(t); } catch (err) { console.error(err); }
  if (carried.length || falling.length) frame = requestAnimationFrame(loop);
}

/** Every pointer move on the page while the layer exists, and the first one over a sticky host that creates it. */
function onMove(e: PointerEvent): void {
  if (!canAct(e) || clingReduced()) return;
  /* The last position is seeded afresh after a gap: leaving a post and coming back elsewhere is not one huge move. */
  const moved = mouse && e.timeStamp - mouse.t < STALE_MS ? Math.hypot(e.clientX - mouse.x, e.clientY - mouse.y) : 0;
  mouse = { x: e.clientX, y: e.clientY, speed: moved, t: e.timeStamp };
  const host = hostOf(e.target);
  const opts = host ? hosts.get(host) : undefined;
  if (opts?.sticky && opts.flakes) {
    if (carried.length < MAX_CARRIED && cr() < Math.min(0.6, moved / 40)) {
      /* A board whose band cannot be computed gets no glitter lent from it: nothing is drawn that has no band to hold. */
      const band = bandAt(host!, e.timeStamp);
      if (band) {
        ensure();
        const a = cr() * Math.PI * 2, d = 4 + cr() * 14;
        carried.push({ f: flake(cr, 0, 0, opts.flakes.palette), ox: Math.cos(a) * d + 6, oy: Math.sin(a) * d + 10, ph: cr() * 6, band });
      }
    }
  } else {
    for (let i = carried.length - 1; i >= 0; i--) {
      if (cr() < moved * 0.006) {
        const c = carried.splice(i, 1)[0]!;
        falling.push({ f: c.f, x: e.clientX + c.ox, y: e.clientY + c.oy, vy: 20 + cr() * 40, vx: (cr() - 0.5) * 30, land: 10 + cr() * 26, fallen: 0, ph: c.ph, band: c.band, over: undefined });
      }
    }
  }
  if ((carried.length || falling.length) && !frame) frame = requestAnimationFrame(loop);
}

/** The color of a carried or falling flake at a phase, in the band it was lent against. The old dark outline is gone: it could fall below the light board's floor. */
function clingColor(f: Flake, ph: number, band: Band): string {
  const flash = Math.abs(Math.sin(ph)) ** 8, ink = f.pal.lin[f.ink]!;
  const k = 0.45 + 0.55 * flash;
  scratch[0] = ink[0] * k; scratch[1] = ink[1] * k; scratch[2] = ink[2] * k;
  return hexFor(clampInto(scratch, band));
}

/** Every color the cling layer paints for flakes of these inks in this band, as `#rrggbb`. For the readable-band check. */
export function sampleCling(flakes: Flakes, band: Band): Set<string> {
  const out = new Set<string>();
  const probe: Flake = { x: 0, y: 0, s: 1, rot: 0, nx: 0, ny: 0, ink: 0, tw: 0, tph: 0, pal: flakes.palette };
  for (let i = 0; i < flakes.palette.lin.length; i++) {
    probe.ink = i;
    for (let j = 0; j <= 16; j++) out.add(clingColor(probe, (j / 16) * Math.PI, band));
  }
  return out;
}

/** One flake of the cling layer: one `setTransform` places it (no save/restore); the host's base transform is `d`, the canvas's px per CSS px. */
function paint(c: CanvasRenderingContext2D, f: Flake, x: number, y: number, ph: number, alpha: number, band: Band, d: number): void {
  const w = f.s * (0.4 + 0.6 * Math.abs(Math.cos(ph)));
  const rot = f.rot + ph * 0.3, cos = Math.cos(rot), sin = Math.sin(rot);
  c.globalAlpha = alpha;
  c.fillStyle = clingColor(f, ph, band);
  c.setTransform(cos * d, sin * d, -sin * d, cos * d, x * d, y * d);
  c.fillRect(-f.s / 2, -f.s * 0.42, w, f.s * 0.84);
  c.globalAlpha = 1;
}

export const cling = {
  /**
   * Registers a host whose box a dropped flake may land on (and, with `sticky`, one that lends flakes to the pointer).
   * Returns the way back out. The host registers when it mounts and unregisters when it unmounts.
   */
  register(host: HTMLElement, options: ClingOptions = {}): () => void {
    hosts.set(host, options);
    return () => { if (hosts.get(host) === options) hosts.delete(host); };
  },

  /**
   * A pointer moved over a registered host. Until the layer exists this is how the first pickup happens; once it does, the
   * layer listens to the whole page itself. A touch or pen pointer, a coarse device, and reduced motion pick nothing up.
   */
  over(e: PointerEvent): void {
    if (!canvas) onMove(e);
  },

  /** One frame: moves and draws what is carried and falling. Exposed so a test can step time. */
  tick(now: number): void {
    const dt = lastTick === null ? 0 : Math.min(0.05, Math.max(0, (now - lastTick) / 1000));
    lastTick = now;
    if (clingReduced()) { carried = []; falling = []; }
    for (const h of hosts.keys()) if (!h.isConnected) hosts.delete(h);
    if (!ctx || !canvas) return;
    if (!carried.length && !falling.length) {
      if (!cleared) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); cleared = true; }
      lastTick = null;
      settle();
      return;
    }
    cleared = false;
    sizeCanvas();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (mouse) {
      for (const c of carried) { c.ph += dt * (2 + mouse.speed * 0.4); paint(ctx, c.f, mouse.x + c.ox, mouse.y + c.oy, c.ph, 1, c.band, ratio); }
      mouse.speed *= Math.exp(-dt * 8);
    }
    for (let i = falling.length - 1; i >= 0; i--) {
      const b = falling[i]!;
      b.vy = Math.min(90, b.vy + 300 * dt); b.x += b.vx * dt; b.y += b.vy * dt; b.fallen += b.vy * dt; b.ph += dt * 12;
      if (b.fallen >= b.land) {
        falling.splice(i, 1);
        const host = hostUnder(b.x, b.y);
        if (host) {
          /* The one measure a flake costs: the post it lands on, to put it in that post's own px. */
          const r = host.getBoundingClientRect();
          addLoose(host, { ...b.f, x: b.x - r.left, y: b.y - r.top });
          try { hosts.get(host)?.landed?.(); } catch (err) { console.error(err); }
        }
        continue;
      }
      /* A flake with nowhere to land fades through the last third of its fall. */
      if (b.over === undefined && b.fallen > b.land * 0.67) b.over = hostUnder(b.x, b.y) !== null;
      const fade = b.over === false ? Math.max(0, 1 - (b.fallen - b.land * 0.67) / (b.land * 0.33)) : 1;
      paint(ctx, b.f, b.x, b.y, b.ph, fade, b.band, ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (!carried.length && !falling.length) settle();
  },

  carried: () => carried.length,
  falling: () => falling.length,
  /** Whether the page-fixed canvas exists now. */
  active: () => canvas !== null,
  /** For tests only: forget everything and remove the layer. */
  reset(): void {
    dispose();
    clearTimeout(idleTimer);
    idleTimer = undefined;
    hosts.clear();
    cr = seededRng('cursor');
    cleared = true;
    sweepLoose();
  },
};
