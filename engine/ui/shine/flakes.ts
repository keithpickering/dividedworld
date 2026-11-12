/**
 * Glitter (docs/plans/2026-11-06-shine-design.md sections 2, 5, 6 and 11), ported from the approved bench's `buildFlakes`, `flake`,
 * `drawFlakes`, `flakeColour`, `holoAt`, `fire` and `stepBurst` and its cling code (docs/research/2026-11-06-shine-bench).
 * Its parts:
 *
 * - `makeFlakes` places a post's flakes, seeded, one per `density` px squared and thickest around a seeded burst point. Before
 *   its burst a post shows 15% of them; `draw` paints the settled ones under the words, every color moved into the band.
 * - `burst` starts the one burst each flakes object gets: about 85% of the flakes fly out over the words and land under them,
 *   seen from above as the settled ones are (thrown along the post from the burst point, rising toward the reader and settling
 *   back, never falling down the screen; docs/plans/2026-11-06-shine-design.md section 11). The host steps it with
 *   `stepBurst(flakes, now)` and paints it with `drawBurst(ctx, flakes, band, now)` on a second canvas over the words. Both return whether another frame is needed. At most `MAX_IN_FLIGHT` fly across the page; past that a
 *   burst lands its remainder at once. Under reduced motion there is no burst and every flake is placed at once.
 * - Cling: a mouse passing over a `sticky` registered host picks flakes up (at most 26), they ride the pointer, drop off over
 *   anything else, fly briefly and land on whichever registered host is under them after their hang. A host that takes no pointer names the element
 *   the pointer is over instead (`hit`), and is still where its flakes land, in its own px. Loose glitter is `loose(host)`, 300 across
 *   the page, oldest first, the reader's own and never saved. One page-fixed canvas draws the flakes in the air; it is made on
 *   the first pickup and removed after `IDLE_MS` with nothing carried or in the air, in the shape of Whoops!'s drawn cursor so a
 *   later port to the engine loop is a move.
 * - Shake: a scroll of the page past `SHAKE_SPEED` shakes copies of settled flakes off the sticky hosts on screen, a frame at a time
 *   for as long as it stays that fast (`shake`), onto that same layer: they are thrown the way the page was moving at about half its
 *   speed, sprayed sideways, tumble as air drag slows them, settle at a slow flutter and land on the host under them after their
 *   hang, or leave the screen past its top, bottom or sides (by 10 px: culled), never fading, a number per px scrolled so the frame rate never changes how many (docs/plans/2026-11-11-shake-design.md section 3). The touch
 *   reader's way to move the glitter, where a mouse picks it up.
 * - The dark board (a band that ends far short of white): each ink is taken at the ceiling, saturated (`ceilingOf`), and a
 *   flake facing the light glints: its flare is added, in its own hue at full brightness with the instance's glint at its
 *   heart (`glintOf`). The glints alone leave the band (docs/plans/2026-11-06-shine-design.md section 5, issue #340), and
 *   `glintsAreFew` holds them to a few flakes at any light; the settled field, the burst, the cling layer and loose glitter stay
 *   inside, and under reduced motion, where the light rests, a flare is drawn in the band as well.
 *
 * Units: a box is CSS px {w, h}; `density` is px squared per flake; a light is {x, y} in -1.5..1.5; `now` is milliseconds, as
 * the page's loop gives it; colors are computed in LINEAR light and written as `#rrggbb`. A flake's `nx, ny` is its tilt, in the
 * light's units. Seeded, never `Math.random`. Engine code: it names no card and no instance.
 */
import { motionReduced } from '../appearance.ts';
import { bandFor, clampInto, LIGHT_GRID, luminanceOf, toHex, toHexA, toLinear, toSrgb8, type Band, type Light, type Rgb } from './band.ts';
import { seededRng } from './seeded.ts';

export type Box = { readonly w: number; readonly h: number };
/** Rows of a box, in CSS px from its top (`top` < `bottom`). */
export type Span = { readonly top: number; readonly bottom: number };

/** The share of a post's flakes it shows before its burst. */
const SHOWN_BEFORE = 0.15;
/**
 * Burst flakes in flight across the page, loose flakes across the page, flakes on the pointer. The in-flight cap is the
 * owner's decision on #268: about 4,000, so one full-width post (988 by 300: 4,234 flakes, 635 shown before the burst, about
 * 3,600 flying) bursts whole and a second post bursting at once shares what is left. A flake in the air costs one fill and
 * one transform, so a full cap costs about 2.7 times what the old 1,500 did.
 */
export const MAX_IN_FLIGHT = 4000;
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
  /** The inks at the dark board's ceiling (`ceilingOf`), made on first use and kept for the last ceiling asked. */
  ceil?: { readonly hi: number; readonly inks: readonly Rgb[]; readonly rainbow: readonly Rgb[] };
  /** The inks at full brightness, the dark board's glints (`glintOf`), made on first use. */
  bright?: readonly Rgb[];
}

export interface Flake {
  x: number; y: number; s: number; rot: number; nx: number; ny: number; ink: number; tw: number; tph: number;
  pal: Palette;
  /** `cos(rot)` and `sin(rot)`, made on a flake's first draw. */
  cs?: number; sn?: number;
}

/**
 * A flake in the air, seen from above as the settled glitter is: it leaves `sx, sy` (the burst point) along the post's plane for its
 * resting place, fast at first and slowing as drag takes it, while it rises toward the reader to `peak` and falls back (`z`, 0 on
 * the post), drawn larger the nearer it is. `dur` is its flight after its `delay`; `sway`, the px it wanders off the straight line.
 */
interface Particle {
  f: Flake; sx: number; sy: number; x: number; y: number; z: number; peak: number; dur: number;
  spin: number; ph: number; sway: number; wph: number; born: number; delay: number;
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
  /**
   * The settled flakes split in two layers that together paint what `draw` paints. `drawBase` paints every settled flake unlit,
   * which no light changes: the host paints it once per board, size and settled count (`baseKey`) on a canvas it leaves alone
   * between those. `drawLit` paints over it only what the light changes now: the flakes whose color differs from their unlit
   * one, every flake under a flare (so the flare adds to it, as it does in one pass), and the flares, on a canvas the host clears
   * each frame, and that layer clears only the squares it drew last time. A post of 4,200 flakes paints a quarter of them at most
   * in a frame (0 to 23% over flakes.test.ts's scenes), and what the browser re-rasters each frame of a scroll is that sparse layer.
   */
  drawBase(ctx: CanvasRenderingContext2D, band: Band, density?: number): void;
  /**
   * `span` (rows in CSS px from the box's top: engine/ui/shine/loop.ts `ShineFrame.span`) paints only the flakes whose square reaches
   * into those rows, the ones on screen; the rest show the base's unlit color until a draw reaches them. The squares the last draw
   * painted are cleared all the same, so nothing it lit off the span is left lit at an old light.
   */
  drawLit(ctx: CanvasRenderingContext2D, light: Light, band: Band, now: number, idle: boolean, density?: number, span?: Span | null): void;
  /** What `drawBase` paints depends on: the band and the settled count. Equal keys paint the same base. */
  baseKey(band: Band): string;
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
  /** The base layer's colors, one a settled flake, for the band and settled count in `key`; and where each flake sits, by bucket. */
  base: { key: string; names: string[]; start: Int32Array; items: Int32Array; cols: number; rows: number } | null;
  /** What `drawLit` left on its canvas: the context and size, and the square each flake it drew covers (device px, x0 y0 x1 y1). */
  shown: { ctx: CanvasRenderingContext2D; w: number; h: number; rects: Float64Array; n: number } | null;
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
const starSprite = (pal: Palette): CanvasImageSource | null => spriteOf(pal.glint, pal.glintLin);
/**
 * The flare in one color (`hex`, and `lin`, the same in linear light): the glint's on a board that reaches white; on the dark board
 * a flake's own hue at full brightness (`glintOf`), or at the ceiling for a flake in the air. One sprite per color, at most an ink's worth.
 */
function spriteOf(hex: string, lin: Readonly<Rgb>): CanvasImageSource | null {
  const have = sharedStars.get(hex);
  if (have !== undefined) return have;
  sharedStars.set(hex, null);
  const at = (a: number): string => toHexA(lin, a);
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
    sharedStars.set(hex, c as CanvasImageSource);
  } catch { sharedStars.set(hex, null); }
  return sharedStars.get(hex)!;
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
    fired: false, flying: 0, parts: [], puff: null, last: null, star: opts.star, rng: seededRng(`${opts.seed}:burst`), base: null, shown: null,
    draw: (ctx, light, band, now, idle, density = 1) => drawList(ctx, self.settled, light, band, now, idle, starOf(self), density),
    baseKey: (band) => `${band.board}:${band.bright ? 'bright' : 'standard'}:${band.lo}:${band.hi}:${self.settled.length}`,
    drawBase: (ctx, band, density = 1) => {
      baseOf(self, band);
      drawList(ctx, self.settled, REST_LIGHT, band, 0, false, null, density, null, true);
    },
    drawLit: (ctx, light, band, now, idle, density = 1, span = null) => drawLit(self, ctx, light, band, now, idle, density, span),
  };
  return self;
}

const starOf = (f: Inner): CanvasImageSource | null => (f.star === undefined ? (f.star = starSprite(f.palette)) : f.star);

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

/** Where on the rainbow a holographic flake's hue sits toward a light, 0..1. */
const holoT = (f: Flake, lx: number, ly: number): number => (Math.atan2(f.ny - ly, f.nx - lx) / (Math.PI * 2) + 1 + f.rot * 0.2) % 1;

/** The bench's `holoAt`: the rainbow hue a holographic flake throws toward a light, into `holoInk` (from `rb`, the palette's own by default). */
function holoAt(f: Flake, lx: number, ly: number, rb: readonly Rgb[] = f.pal.rainbow): Rgb {
  const n = rb.length;
  const x = holoT(f, lx, ly) * n, i = x | 0, k = x - i, a = rb[i % n]!, b = rb[(i + 1) % n]!;
  holoInk[0] = a[0] + (b[0] - a[0]) * k; holoInk[1] = a[1] + (b[1] - a[1]) * k; holoInk[2] = a[2] + (b[2] - a[2]) * k;
  return holoInk;
}

/**
 * The dark board. Its band ends far short of white (0.048 on the engine's tokens), so a flake mixed toward white there comes out a
 * flat gray once it is scaled back under the ceiling, and a plain ink scaled down is a muddy one. Real glitter in the dark is a
 * field of colored points, a few of them flashing: so each ink is taken at the ceiling itself, its chroma pushed by `VIVID`
 * first (at one luminance a more saturated color reads brighter), and a flake shows `DARK_FLOOR` of that unlit, all of it lit.
 * A flake facing the light glints in that hue at full brightness (`glintOf`), out of the band, with the instance's glint at its heart.
 */
const VIVID = 1.7;
const DARK_FLOOR = 0.42;
/**
 * Under a bright band (docs/plans/2026-11-08-brighter-effects-design.md) nothing is moved into a band: a flake is its own ink,
 * unlit at this share of it (the dark board scales it down; the light board mixes the rest toward white), all of it lit.
 */
export const BRIGHT_FLOOR = { dark: 0.5, light: 0.85 } as const;
/**
 * A flake lit past this flares (both boards) and, on the dark board, glints out of the band. At the litness's sharpness that is
 * a flake whose tilt is within 0.093 of the light, about one flake in two hundred of a post's at a light inside the tilt disk.
 */
export const GLINT_MIN = 0.75;
/**
 * `glintsAreFew`'s cap: at any light and any moment, at most this share of a post's settled flakes glint, or `GLINT_FLOOR` of
 * them where that is more (a short post's few hundred flakes put a handful past a share by chance alone).
 */
export const GLINT_SHARE = 0.03;
export const GLINT_FLOOR = 16;
/** How much of the glint's square the instance's glint fills at its heart, over the flake's own hue. */
const GLINT_CORE = 0.5;

/** Each ink at the ceiling `hi`, saturated, in linear light, kept on the palette per ceiling; the rainbow's are the first `holo`. */
function ceilingOf(pal: Palette, hi: number): readonly Rgb[] {
  const had = pal.ceil;
  if (had && had.hi === hi) return had.inks;
  const inks = pal.lin.map((c): Rgb => {
    const L = luminanceOf(c);
    const v: Rgb = [0, 1, 2].map((i) => Math.max(0, L + (c[i]! - L) * VIVID)) as Rgb;
    const k = luminanceOf(v) > 0 ? hi / luminanceOf(v) : 0;
    /* A channel past 1 is cut there, which only lowers the luminance: the color stays under the ceiling. */
    return [Math.min(1, v[0] * k), Math.min(1, v[1] * k), Math.min(1, v[2] * k)];
  });
  pal.ceil = { hi, inks, rainbow: inks.slice(0, pal.rainbow.length) };
  return inks;
}
const ceilRainbow = (pal: Palette, hi: number): readonly Rgb[] => { ceilingOf(pal, hi); return pal.ceil!.rainbow; };

/** Each ink saturated as `ceilingOf` does, then as bright as its hue goes (its largest channel at 1), in linear light. */
function brightOf(pal: Palette): readonly Rgb[] {
  return (pal.bright ??= pal.lin.map((c): Rgb => {
    const L = luminanceOf(c);
    const v = [0, 1, 2].map((i) => Math.max(0, L + (c[i]! - L) * VIVID));
    const m = Math.max(...v);
    return (m > 0 ? v.map((x) => Math.min(1, x / m)) : [1, 1, 1]) as Rgb;
  }));
}

/** A dark-board flake's hue at the ceiling toward a light, into `holoInk` or as the ink's own. */
function darkInk(f: Flake, a: number, hi: number, lx: number, ly: number): Readonly<Rgb> {
  return f.ink >= f.pal.holo && a > 0.15 ? holoAt(f, lx, ly, ceilRainbow(f.pal, hi)) : ceilingOf(f.pal, hi)[f.ink]!;
}

/**
 * The color a flake glints in on the dark board: its hue at full brightness, a holographic flake's taken at the nearest of the
 * rainbow's inks so the sprites are an ink's worth, not one a hue. As `#rrggbb`, with its linear value in `glintLin`. Out of
 * the band by design (section 5): only `drawFlares` paints it, over a flake lit past `GLINT_MIN`.
 */
const glintLin: Rgb = [0, 0, 0];
function glintOf(f: Flake, lx: number, ly: number): string { return tintOf(f, lx, ly, brightOf(f.pal)); }
/**
 * The color a dark-board flare is drawn in where it may not glint (a loose flake, or under reduced motion): its hue at the
 * ceiling, drawn over it, so it stays in the band. Into `glintLin` as `glintOf` does.
 */
function ceilTintOf(f: Flake, hi: number, lx: number, ly: number): string { return tintOf(f, lx, ly, ceilingOf(f.pal, hi)); }
function tintOf(f: Flake, lx: number, ly: number, all: readonly Rgb[]): string {
  const n = Math.max(1, Math.min(f.pal.holo, all.length));
  const c = f.ink >= f.pal.holo ? all[Math.round(holoT(f, lx, ly) * n) % n]! : all[f.ink]!;
  glintLin[0] = c[0]; glintLin[1] = c[1]; glintLin[2] = c[2];
  return hexFor(glintLin);
}

/** The standard dark board: the one band the ceiling, the vivid inks and the readable-band check apply to. */
const darkStandard = (band: Band): boolean => band.board === 'dark' && !band.bright;

/**
 * A flake in full color (a bright band): `ink` at `k` of itself, on the dark board by scaling, on the light board by mixing
 * the rest toward white. Never clamped.
 */
function freeColour(ink: Readonly<Rgb>, k: number, band: Band): string {
  if (band.board === 'dark') { scratch[0] = ink[0] * k; scratch[1] = ink[1] * k; scratch[2] = ink[2] * k; }
  else { scratch[0] = 1 + (ink[0] - 1) * k; scratch[1] = 1 + (ink[1] - 1) * k; scratch[2] = 1 + (ink[2] - 1) * k; }
  return hexFor(scratch);
}
const floorOf = (band: Band): number => (band.board === 'dark' ? BRIGHT_FLOOR.dark : BRIGHT_FLOOR.light);

/** The bench's `flakeColour`: how lit a flake is (`a`, 0..1) at a light, as a `#rrggbb` inside the band. */
function flakeColour(f: Flake, a: number, band: Band, lx: number, ly: number): string {
  if (band.bright) {
    const ink = f.ink >= f.pal.holo && a > 0.15 ? holoAt(f, lx, ly) : f.pal.lin[f.ink]!;
    const floor = floorOf(band);
    return freeColour(ink, floor + (1 - floor) * a, band);
  }
  if (band.board === 'dark') {
    const ink = darkInk(f, a, band.hi, lx, ly);
    const k = DARK_FLOOR + (1 - DARK_FLOOR) * a;
    scratch[0] = ink[0] * k; scratch[1] = ink[1] * k; scratch[2] = ink[2] * k;
    return hexFor(clampInto(scratch, band));
  }
  const base = f.pal.lin[f.ink]!;
  const ink = f.ink >= f.pal.holo && a > 0.15 ? holoAt(f, lx, ly) : base;
  const k = 0.38 + 0.62 * a;
  scratch[0] = 1 + (ink[0] - 1) * k; scratch[1] = 1 + (ink[1] - 1) * k; scratch[2] = 1 + (ink[2] - 1) * k;
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
 * Paints a list of flakes (or the `pick` of it; `unlit`, all of it at no light, which is the base layer). One `setTransform` places each (no save/restore), the fill is set once per color (flakes are drawn
 * a color at a time, in list order within a color: overlapping flakes of different colors may stack differently than in list
 * order, which a glitter does not show), and the flares reuse the lit flakes found while coloring. Leaves the transform at the
 * density scale.
 */
function drawList(
  ctx: CanvasRenderingContext2D, all: readonly Flake[], light: Light, band: Band, now: number, idle: boolean,
  star: CanvasImageSource | null, density = 1, pick: { readonly idx: Int32Array; readonly n: number; readonly a?: Float64Array; readonly name?: string[] } | null = null, unlit = false,
  glints = true,
): void {
  /* `pick` draws only those of `all`, in its order, with each one's litness and color when its caller has them already; `unlit`
     draws every flake at no light (the base layer: no flare). */
  const list: readonly Flake[] = pick ? picked(all, pick) : all;
  const n = list.length;
  if (!n) return;
  const { x: lx, y: ly } = light;
  if (colorOf.length < n) { colorOf = new Int32Array(n); order = new Int32Array(n); }
  colorIds.clear(); colorNames.length = 0; flareAt.length = 0; flareA.length = 0;
  for (let i = 0; i < n; i++) {
    const f = list[i]!;
    const known = pick?.name?.[i];
    const a = unlit ? 0 : known !== undefined ? pick!.a![i]! : litness(f, lx, ly, now, idle);
    const name = known ?? flakeColour(f, a, band, lx, ly);
    let id = colorIds.get(name);
    if (id === undefined) { id = colorNames.length; colorIds.set(name, id); colorNames.push(name); }
    colorOf[i] = id;
    if (a > GLINT_MIN) { flareAt.push(i); flareA.push(a); }
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
  if (!flareAt.length) return;
  drawFlares(ctx, list, band, lx, ly, star, glints && (band.bright || !motionReduced()));
}

/**
 * The flares over the flakes `drawList` found facing the light. Under a bright band a post's own flake glints on either board and
 * under reduced motion too, and a loose one is drawn over in its own ink. In a standard band, where it reaches white (the light board) a flare is the
 * glint's sprite, added, and that stays in the band. On the dark board, where `glints` allows it, each one is a glint, the one
 * thing the shine draws out of the band there (section 5, issue #340): added, in the flake's own hue at full brightness
 * (`glintOf`), with the instance's glint over its heart at `GLINT_CORE` of its size, as real glitter flashes white at its center
 * and colored at its edge; `glintsAreFew` holds how many there are. Only a post's settled flakes glint, and only while motion is
 * full, since a reduced-motion light rests and a glint there would never pass: elsewhere on the dark board a flare is drawn over
 * its flake, not added, in its hue at the ceiling (`ceilTintOf`), a mix of colors under the ceiling. Anywhere else none is drawn.
 */
function drawFlares(ctx: CanvasRenderingContext2D, list: readonly Flake[], band: Band, lx: number, ly: number, star: CanvasImageSource | null, glints: boolean): void {
  const white = !band.bright && band.board === 'light';
  if (white ? !star : !band.bright && band.board !== 'dark') return;
  const added = white || glints;
  if (added) ctx.globalCompositeOperation = 'lighter';
  for (let j = 0; j < flareAt.length; j++) {
    const f = list[flareAt[j]!]!;
    const alpha = (flareA[j]! - GLINT_MIN) / (1 - GLINT_MIN);
    if (alpha < 0.03) continue;
    const sprite = white ? star : spriteOf(glints ? glintOf(f, lx, ly) : band.bright ? tintOf(f, lx, ly, f.pal.lin) : ceilTintOf(f, band.hi, lx, ly), glintLin);
    if (!sprite) continue;
    const z = 7 + f.s * 4;
    ctx.globalAlpha = alpha; ctx.drawImage(sprite, f.x - z / 2, f.y - z / 2, z, z);
    if (!white && glints && star) {
      const c = z * GLINT_CORE;
      ctx.drawImage(star, f.x - c / 2, f.y - c / 2, c, c);
    }
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

/** The picked flakes as a list, in a buffer reused from draw to draw. */
const pickedList: Flake[] = [];
function picked(all: readonly Flake[], pick: { readonly idx: Int32Array; readonly n: number }): Flake[] {
  pickedList.length = pick.n;
  for (let j = 0; j < pick.n; j++) pickedList[j] = all[pick.idx[j]!]!;
  return pickedList;
}

/** The light the base layer is colored at: `drawList` with `unlit` reads it only for a holographic hue, which an unlit flake never throws. */
const REST_LIGHT: Light = { x: 0, y: 0 };
/**
 * A flake whose litness is under this is taken to show its unlit color without computing it: 1e-5 of the way from unlit to lit
 * moves a channel by under 1e-5 in linear light (a step of eight bits is 3e-4 at its finest), so its eight bits change only where
 * the unlit value sits that close to a rounding edge. Above it, a flake is lit when
 * its color differs from its unlit one; flakes.test.ts holds the two layers to one pass's colors, flake by flake.
 */
const LIT_MIN = 1e-5;
/** Litness under LIT_MIN at the sharpness `litness` uses: (dx^2 + dy^2) past this. */
const UNLIT_D2 = -0.03 * Math.log(LIT_MIN);
/** The flare's square is 7 + 4s px for a flake of size s, at most 3.4: a flake within half of that plus its own reach is under it. */
const FLARE_REACH = (7 + 3.4 * 4) / 2 + 3.4;
const BUCKET = 16;

/** The base layer's colors and buckets for this band and settled count, made when either changed. */
function baseOf(f: Inner, band: Band): NonNullable<Inner['base']> {
  const key = f.baseKey(band);
  if (f.base?.key === key) return f.base;
  const list = f.settled, n = list.length;
  const names = new Array<string>(n);
  for (let i = 0; i < n; i++) names[i] = flakeColour(list[i]!, 0, band, 0, 0);
  /* Buckets of BUCKET px: a counting sort of the flakes by the bucket their center is in. */
  const cols = Math.max(1, Math.ceil(f.box.w / BUCKET)), rows = Math.max(1, Math.ceil(f.box.h / BUCKET));
  const cell = (fl: Flake) => Math.min(rows - 1, Math.max(0, (fl.y / BUCKET) | 0)) * cols + Math.min(cols - 1, Math.max(0, (fl.x / BUCKET) | 0));
  const start = new Int32Array(cols * rows + 1), items = new Int32Array(n);
  for (let i = 0; i < n; i++) start[cell(list[i]!) + 1]!++;
  for (let c = 0; c < cols * rows; c++) start[c + 1]! += start[c]!;
  const fill = start.slice(0, cols * rows);
  for (let i = 0; i < n; i++) items[fill[cell(list[i]!)]!++] = i;
  f.base = { key, names, start, items, cols, rows };
  return f.base;
}

/* drawLit's scratch: the flakes it picks, and the draw each was last picked in, so none is picked twice. */
let litIdx = new Int32Array(0);
let litMark = new Int32Array(0);
let litStamp = 0;
/* The litness and color of each flake picked, in pick order, so the draw does not work them out again. */
let litA = new Float64Array(0);
const litName: string[] = [];

/** The layer over the base: the flakes the light changed, the flakes under a flare, and the flares (`Flakes.drawLit`). */
function drawLit(f: Inner, ctx: CanvasRenderingContext2D, light: Light, band: Band, now: number, idle: boolean, density: number, span: Span | null = null): void {
  const list = f.settled, n = list.length;
  const base = baseOf(f, band);
  if (litIdx.length < n) { litIdx = new Int32Array(n); litMark = new Int32Array(n); litA = new Float64Array(n); litStamp = 0; }
  if (++litStamp > 0x3fffffff) { litMark.fill(0); litStamp = 1; }
  const { x: lx, y: ly } = light;
  /* Whether a flare can be drawn on this board (drawFlares): the glint's where the band reaches white, a glint in the flake's hue on the dark board. */
  const flares = band.bright || (band.board === 'light' ? starOf(f) !== null : true);
  let m = 0, lit = 0;
  /* A flake reaches FLARE_REACH from its center at most (its flare's square): one centered further off the span paints none of it. */
  const y0 = span ? span.top - FLARE_REACH : -Infinity, y1 = span ? span.bottom + FLARE_REACH : Infinity;
  for (let i = 0; i < n; i++) {
    const fl = list[i]!;
    if (fl.y < y0 || fl.y > y1) continue;
    /* Far from the light and not winking: its unlit color, which the base already shows. */
    if ((fl.nx - lx) ** 2 + (fl.ny - ly) ** 2 > UNLIT_D2 && !(idle && fl.tw)) continue;
    const a = litness(fl, lx, ly, now, idle);
    if (a < LIT_MIN) continue;
    const name = flakeColour(fl, a, band, lx, ly);
    if (name === base.names[i] && !(flares && a > GLINT_MIN)) continue;
    litA[m] = a; litName[m] = name;
    litIdx[m++] = i; litMark[i] = litStamp;
  }
  lit = m;
  /* Every flake under a flare joins, so the flare is added to it as one pass adds it. */
  if (flares) {
    const { start, items, cols, rows } = base;
    for (let j = 0; j < lit; j++) {
      const fl = list[litIdx[j]!]!;
      if (litA[j]! <= GLINT_MIN) continue;
      const r = FLARE_REACH;
      const c0 = Math.max(0, ((fl.x - r) / BUCKET) | 0), c1 = Math.min(cols - 1, ((fl.x + r) / BUCKET) | 0);
      const r0 = Math.max(0, ((fl.y - r) / BUCKET) | 0), r1 = Math.min(rows - 1, ((fl.y + r) / BUCKET) | 0);
      for (let row = r0; row <= r1; row++) {
        for (let k = start[row * cols + c0]!, end = start[row * cols + c1 + 1]!; k < end; k++) {
          const i = items[k]!;
          if (litMark[i] === litStamp) continue;
          const o = list[i]!;
          if (Math.abs(o.x - fl.x) > r || Math.abs(o.y - fl.y) > r) continue;
          /* Not lit, or lit by under LIT_MIN: its color is the base's, and it is only here for the flare over it. */
          const oa = litness(o, lx, ly, now, idle);
          litA[m] = oa; litName[m] = oa < LIT_MIN ? base.names[i]! : flakeColour(o, oa, band, lx, ly);
          litIdx[m++] = i; litMark[i] = litStamp;
        }
      }
    }
  }
  /* Clear what the last draw left, square by square (all of it when the canvas is new to this flakes object or was resized). */
  const cw = ctx.canvas?.width ?? 0, ch = ctx.canvas?.height ?? 0;
  let was = f.shown;
  if (was && (was.ctx !== ctx || was.w !== cw || was.h !== ch)) was = null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (!was) ctx.clearRect(0, 0, cw, ch);
  else for (let k = 0; k < was.n; k++) { const q = k * 4; ctx.clearRect(was.rects[q]!, was.rects[q + 1]!, was.rects[q + 2]! - was.rects[q]!, was.rects[q + 3]! - was.rects[q + 1]!); }
  const rects = was && was.rects.length >= m * 4 ? was.rects : new Float64Array(Math.max(m, 64) * 4);
  for (let j = 0; j < m; j++) {
    const fl = list[litIdx[j]!]!;
    /* A flake's rect reaches 0.66 s from its center whatever its turn; a flare's square, 3.5 + 2 s; a pixel more for the smoothing. */
    const r = (flares && litA[j]! > GLINT_MIN ? 3.5 + 2 * fl.s : 0.66 * fl.s) + 1, q = j * 4;
    rects[q] = Math.floor((fl.x - r) * density); rects[q + 1] = Math.floor((fl.y - r) * density);
    rects[q + 2] = Math.ceil((fl.x + r) * density); rects[q + 3] = Math.ceil((fl.y + r) * density);
  }
  f.shown = { ctx, w: cw, h: ch, rects, n: m };
  ctx.setTransform(density, 0, 0, density, 0, 0);
  if (!m) return;
  litName.length = m;
  drawList(ctx, list, light, band, now, idle, starOf(f), density, { idx: litIdx, n: m, a: litA, name: litName });
}

/**
 * Every color the glitter draws at a light, as `#rrggbb`, without duplicates: each ink fully unlit and fully lit, every
 * holographic hue the flakes in the list throw, and the colors the flakes themselves show (twinkle included). For the
 * readable-band check, which asks it at a grid of lights on both boards. The dark board's glints are not in it: they leave
 * the band by design, and `glintsAreFew` is their check.
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

/**
 * The share of a post's settled flakes lit past `GLINT_MIN` at a light and a moment (twinkle included): the flakes that flare,
 * and on the dark board glint out of the band.
 */
export function glintShare(flakes: Flakes, light: Light, now: number): number {
  const list = (flakes as Inner).settled;
  if (!list.length) return 0;
  let n = 0;
  for (const f of list) if (litness(f, light.x, light.y, now, true) > GLINT_MIN) n++;
  return n / list.length;
}

/**
 * The check that the dark board's glints stay few (section 5): at every light of `LIGHT_GRID` and every moment in `nows`, at most
 * `GLINT_SHARE` of the post's settled flakes glint, or `GLINT_FLOOR` of them where that is more. Every light and moment past it,
 * in words; empty when they are few.
 */
export function glintsAreFew(flakes: Flakes, nows: readonly number[]): string[] {
  const failures: string[] = [];
  const n = (flakes as Inner).settled.length, cap = Math.max(GLINT_SHARE * n, GLINT_FLOOR);
  for (const light of LIGHT_GRID) {
    for (const now of nows) {
      const share = glintShare(flakes, light, now), k = Math.round(share * n);
      if (k > cap) failures.push(`${k} of ${n} flakes (${(share * 100).toFixed(1)}%) glint at light (${light.x}, ${light.y}) at ${now} ms`);
    }
  }
  return failures;
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
    const sx = f.origin.x + (r() - 0.5) * 6, sy = f.origin.y + (r() - 0.5) * 6;
    const dist = Math.hypot(target.x - sx, target.y - sy);
    f.parts.push({
      f: target, sx, sy, x: sx, y: sy, z: 0, peak: 0.35 + r() * 1.1,
      /* Further flakes fly longer, and every flight with its delay ends inside FLIGHT_MS. */
      dur: Math.min(FLIGHT_MS - DELAY_MS, 650 + r() * 450 + dist * 0.9),
      spin: 6 + r() * 18, ph: r() * 6, sway: (r() - 0.5) * Math.min(40, 6 + dist * 0.12), wph: r() * 6, born: now, delay: r() * DELAY_MS,
    });
  }
  f.rest = [];
  inFlight += f.parts.length;
  f.flying = f.parts.length;
  f.last = now;
  return true;
}

/**
 * Advances the burst to `now`: moves the flakes in the air and lands the ones that arrived (they join `settled`, so the host
 * redraws its under canvas when this returns true or `flying` changed). Returns whether another frame is needed.
 *
 * Seen from above, the way the settled glitter is, the whole time: nothing falls down the screen. Each flake is thrown out from the
 * burst point along the post toward its resting place, quick at first and slowing as the air takes it (an ease-out), wandering a
 * little off the line, while it rises toward the reader and settles back onto the post; it lands at its place when its flight ends,
 * inside `FLIGHT_MS`.
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
    const age = now - b.born - b.delay;
    if (age < 0) continue;
    const k = Math.min(1, age / b.dur);
    if (k >= 1) {
      f.settled.push(b.f);
      parts[i] = parts[parts.length - 1]!;
      parts.pop();
      inFlight--;
      continue;
    }
    const p = 1 - (1 - k) ** 3;
    const dx = b.f.x - b.sx, dy = b.f.y - b.sy, d = Math.hypot(dx, dy) || 1;
    /* Off the line by up to `sway` px, side to side, none at the start or the end. */
    const off = b.sway * Math.sin(k * Math.PI) * Math.sin(k * 7 + b.wph);
    b.x = b.sx + dx * p - (dy / d) * off; b.y = b.sy + dy * p + (dx / d) * off;
    /* Up quickly and down slowly, as a flake does in air. */
    const q = k ** 0.6;
    b.z = b.peak * 4 * q * (1 - q);
    b.ph += b.spin * dt * (0.35 + 0.65 * (1 - k));
  }
  f.flying = parts.length;
  if (!parts.length && f.puff === null) f.last = null;
  return parts.length > 0 || f.puff !== null;
}

/** The color of a flake in the air, in the band, at a flash of 0..1 (the bench's burst coloring, then moved into the band). */
function burstColor(f: Flake, flash: number, band: Band): string {
  if (band.bright) return freeColour(f.pal.lin[f.ink]!, floorOf(band) + (1 - floorOf(band)) * flash, band);
  if (band.board === 'dark') {
    /* The dark board: the ink at the ceiling, as the settled flakes are (ceilingOf), dimmer between its flashes. */
    const ink = ceilingOf(f.pal, band.hi)[f.ink]!, k = DARK_FLOOR + (1 - DARK_FLOOR) * flash;
    scratch[0] = ink[0] * k; scratch[1] = ink[1] * k; scratch[2] = ink[2] * k;
    return hexFor(clampInto(scratch, band));
  }
  const ink = f.pal.lin[f.ink]!;
  const k = 0.55 + 0.45 * flash;
  scratch[0] = ink[0] * k + (1 - k) * 0.3; scratch[1] = ink[1] * k; scratch[2] = ink[2] * k;
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

/** A dark-board flash's sprite: the flake's hue at the ceiling, or its own ink under a bright band. */
function flashSprite(f: Flake, band: Band): CanvasImageSource | null {
  const ink = band.bright ? f.pal.lin[f.ink]! : ceilingOf(f.pal, band.hi)[f.ink]!;
  return spriteOf(hexFor(ink), ink);
}

/**
 * Paints the burst on the canvas over the words: the puff and every flake in the air. Clearing the canvas is the host's.
 * `density` is the canvas's px per CSS px (default 1): each flake is placed by one `setTransform`, and the transform is left at
 * that scale, the host's base transform.
 */
export function drawBurst(ctx: CanvasRenderingContext2D, flakes: Flakes, band: Band, now: number, density = 1): void {
  const f = flakes as Inner;
  const d = density;
  const whiteFits = !band.bright && band.board === 'light';
  if (f.puff !== null) {
    const k = (now - f.puff) / PUFF_MS;
    if (k >= 0 && k < 1) {
      const R = 20 + k * 140, a = (1 - k) * (band.board === 'dark' ? 0.55 : 0.7), { x, y } = f.origin;
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
    /* Nearer the reader, larger: a flake at its peak is up to about twice its size on the post. */
    const near = 1 + b.z * 0.9, s = b.f.s * near;
    const w = s * (0.3 + 0.7 * Math.abs(Math.cos(b.ph)));
    const rot = b.f.rot + b.ph * 0.2, cos = Math.cos(rot), sin = Math.sin(rot);
    ctx.setTransform(cos * d, sin * d, -sin * d, cos * d, b.x * d, b.y * d);
    ctx.fillRect(-w / 2, -s * 0.42, w, s * 0.84);
    /* A flash: the glint added where the band reaches white, the flake's own hue at the ceiling drawn over it on the dark board. */
    const sprite = flash <= 0.8 ? null : star ?? (band.board === 'dark' || band.bright ? flashSprite(b.f, band) : null);
    if (sprite) {
      ctx.setTransform(d, 0, 0, d, 0, 0);
      if (star) ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (flash - 0.8) * 5 * 0.8;
      const z = (9 + b.f.s * 3) * near;
      ctx.drawImage(sprite, b.x - z / 2, b.y - z / 2, z, z);
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

/** Paints a host's loose flakes, as `draw` paints its settled ones, but with no glint out of the band on the dark board. */
export function drawLoose(host: object, ctx: CanvasRenderingContext2D, light: Light, band: Band, now: number, idle: boolean, density = 1): void {
  const list = looseByHost.get(host);
  /* Loose flakes flare as settled ones do, but never glint out of the band: that is a post's own settled flakes' alone. */
  if (list?.length) drawList(ctx, list, light, band, now, idle, starSprite(list[0]!.pal), density, null, false, false);
}

/**
 * A flake lying loose: where it landed, in its surface's px, and what it needs to be drawn still (docs/plans/2026-11-11-shake-design.md
 * section 5): `ph`, the turn it landed at, and `band`, the board it landed on.
 */
export type LooseFlake = Flake & { ph?: number; band?: Band };

/**
 * What the landing surfaces (engine/ui/shine/landing.ts) hang on the cling layer. `page` is the thread screen's own surface, a
 * place a flake lands where no registered host is under it and `ground` says the point's ground is the page's; `dropped` hears a
 * loose flake go off a host's list to the 300 cap; `frameEnd` runs at the end of each frame that moved a flake, once, after every
 * landing in it. Nothing here is a loop's job: tiles are drawn on a landing and on a return to view, never per frame.
 */
export interface Landing {
  page: { readonly host: object; landed(): void } | null;
  ground(el: Element): boolean;
  dropped(host: object, f: LooseFlake): void;
  frameEnd(): void;
}
let landing: Landing | null = null;
/** Installs the landing surfaces' hooks, or takes them off with `null`. */
export function setLanding(l: Landing | null): void { landing = l; }

/** Every loose flake on the page in the order it landed, with the host it lies on: a read-only view for a probe. */
export const looseEntries = (): readonly { readonly host: object; readonly flake: Flake }[] => looseOrder;

function addLoose(host: object, f: LooseFlake): void {
  loose(host).push(f);
  looseOrder.push({ host, flake: f });
  while (looseOrder.length > MAX_LOOSE) {
    const old = looseOrder.shift()!;
    const list = looseByHost.get(old.host);
    const at = list ? list.indexOf(old.flake) : -1;
    if (list && at >= 0) list.splice(at, 1);
    try { landing?.dropped(old.host, old.flake as LooseFlake); } catch (err) { console.error(err); }
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
  /**
   * The element the pointer is over when it is over this host, where the host itself takes none: a layer with `pointer-events:
   * none`, laid over that element, holds nothing a pointer hits, so the browser names only the element (or what is in it) as an
   * event's target or at a point. By default the host. A flake that lands is still placed in the host's own px (issue #399).
   * A hit has one owner at a time (issue #412): where several hosts name one hit, the one of the highest `rank` owns it, and
   * among equal ranks the most recently registered. A host's way out hands the hit back to the one registered before it.
   */
  readonly hit?: HTMLElement;
  /**
   * Who wins a shared hit: an `effect` (a surface that draws its own loose glitter) over a `cell` (a post's cell), whichever
   * registered first. Default `effect`.
   */
  readonly rank?: 'effect' | 'cell';
}

/* The cling layer is page-fixed and has no host of its own, so each flake keeps the band of the host it was picked up from
   (`bandFor` on that host's element at pickup): that is the board whose post inks it was lent against, and the layer is only
   ever drawn over registered hosts' boards. The page's root would be wrong the day a card themes a board of its own. */
interface Carried { f: Flake; ox: number; oy: number; ph: number; band: Band }
/* A flake in the air (docs/plans/2026-11-11-shake-design.md section 3): `vx, vy` in px a second, `ph` its turn, `spin` how fast it
   turns, `age` the seconds since it left and `hang` the seconds before it may land. It is drawn at full alpha always. */
interface Falling { f: Flake; x: number; y: number; vx: number; vy: number; ph: number; spin: number; age: number; hang: number; next: number; band: Band }

const hosts = new Map<HTMLElement, ClingOptions>();
/** Each registered host's `hit` (the host itself by default), to the hosts that name it in registration order: what a walk up from a node is matched against. */
const hits = new Map<HTMLElement, HTMLElement[]>();
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
/**
 * The squares the layer drew in last frame, in device px (x0, y0, x1, y1, four to a flake): the next frame clears only those. The
 * layer covers the viewport, so clearing all of it each frame rastered the whole screen on every frame of a fast scroll's shake.
 */
let dirty: number[] = [];

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

/** The registered host whose hit holds this node, if any: a walk up from the node, no measuring. */
function hostOf(n: EventTarget | null | undefined): HTMLElement | null {
  for (let el = n instanceof Element ? n : null; el; el = el.parentElement) {
    const list = hits.get(el as HTMLElement);
    if (!list) continue;
    /* The most recent host of the highest rank owns the hit. */
    let owner: HTMLElement | null = null, best = -1;
    for (const h of list) {
      const rank = hosts.get(h)?.rank === 'cell' ? 0 : 1;
      if (rank >= best) { owner = h; best = rank; }
    }
    if (owner) return owner;
  }
  return null;
}

/** The element under a viewport point, as the browser hit-tests it. */
const elementAt = (x: number, y: number): Element | null =>
  typeof document === 'undefined' || !document.elementFromPoint ? null : document.elementFromPoint(x, y);

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
  /* Sizing the backing store clears it: nothing drawn is left to clear. */
  if (canvas.width !== w) { canvas.width = w; dirty = []; }
  if (canvas.height !== h) { canvas.height = h; dirty = []; }
}

/** Clears the squares the last frame drew in, and forgets them. */
function clearDirty(c: CanvasRenderingContext2D): void {
  if (!dirty.length) return;
  c.setTransform(1, 0, 0, 1, 0, 0);
  for (let k = 0; k < dirty.length; k += 4) c.clearRect(dirty[k]!, dirty[k + 1]!, dirty[k + 2]! - dirty[k]!, dirty[k + 3]! - dirty[k + 1]!);
  dirty = [];
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
  dirty = [];
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
        /* The cursor's numbers: up to 20 px a second sideways, 30 to 80 down, a hang of 0.15 to 0.5 s. */
        falling.push({ f: c.f, x: e.clientX + c.ox, y: e.clientY + c.oy, vx: (cr() - 0.5) * 40, vy: 30 + cr() * 50, ph: c.ph, spin: 6 + cr() * 10, age: 0, hang: 0.15 + cr() * 0.35, next: 0, band: c.band });
      }
    }
  }
  if ((carried.length || falling.length) && !frame) frame = requestAnimationFrame(loop);
}

/* ---------------------------------------------------------------- shake ---- */

/**
 * A scroll this fast (CSS px a second) shakes glitter off the posts on screen: the touch reader's way to move it, where a mouse
 * picks it up. What is shaken off flies on the page-fixed layer, thrown the way the page was moving, so it leaves the post's box,
 * tumbles through air drag, settles and lands on whichever registered host is under it after its hang, or leaves the screen: it
 * never fades. As a mouse's pickup does, it takes a copy of a flake on screen (its ink, size and turn, where it lies) and leaves the
 * post as it was: taking the flake itself would repaint the post's whole base layer on every frame of a fast scroll, the most
 * expensive time to (e2e/shine.spec.ts's raster share went from 0.67 to 8.5 of the posts in view).
 */
export const SHAKE_SPEED = 2200;
/*
 * The flight (docs/plans/2026-11-11-shake-design.md section 3), exported so a test can state the numbers it holds to. A scroll sheds
 * `SHAKE_PER_PX` flakes for each px it scrolls (its speed times the frame's gap, so the count never depends on the frame rate), off
 * each post in view; at most `MAX_AIR` are in the air across the page. A flake leaves at `THROW` of the scroll's speed (0.6 to 1.4 times it) and up to `SPRAY` of it sideways either way; each
 * frame drag (`DRAG`) slows it and gravity adds to its fall, so it settles to about `GRAVITY / DRAG` px a second, swaying up to
 * `FLUTTER` px a second at `FLUTTER_RATE` radians a second. After its hang (`HANG_S` times 0.6 to 1.4) it lands where it is over a
 * landing place.
 */
/**
 * What a full flick (twice `SHAKE_SPEED`) sheds off one post over its whole pass through the view, the number the rate is chosen for.
 * A post about 130 px tall crosses a view about 1,000 px tall in `SHAKE_PASS_PX` = 130 + 1,000 = 1,130 px of scrolling, so the per-px
 * rate is 40 / 1,130 = 0.0354 a px; strength 1 sheds that and a scroll at the threshold 0.4 of it (about 16). A 6,000 px/s fling puts
 * the post in view for only about four frames, so the count follows the distance each frame scrolled, never the time it took.
 */
export const SHAKE_PER_FLICK = 40;
export const SHAKE_PASS_PX = 1130;
export const SHAKE_PER_PX = SHAKE_PER_FLICK / SHAKE_PASS_PX;
export const THROW = 0.55;
export const SPRAY = 0.11;
export const DRAG = 7;
export const GRAVITY = 480;
export const FLUTTER = 35;
export const FLUTTER_RATE = 5.5;
export const HANG_S = 0.6;
export const MAX_AIR = 400;
/**
 * A flake past its hang is hit-tested at most this often (seconds): a hit test is a walk of the layout tree, and 400 flakes asking
 * every frame is 24,000 a second. A place that comes under a flake catches it within this and a frame.
 */
export const CHECK_S = 0.1;

let scrollSeen: { y: number; t: number } | null = null;
let shakeFrame = 0;
let shakeV = 0;
/** When the last shake frame ran (the page's clock), so a flick's frames are handed their own `dt`. */
let shakeLast: number | null = null;
let scrollHeard = false;

/** The page's scroll listener: on while a sticky host is registered, off with the last. */
function hearScroll(on: boolean): void {
  if (typeof window === 'undefined' || on === scrollHeard) return;
  scrollHeard = on;
  if (on) { addEventListener('scroll', onScroll, { passive: true }); return; }
  removeEventListener('scroll', onScroll);
  if (shakeFrame) cancelAnimationFrame(shakeFrame);
  shakeFrame = 0; scrollSeen = null; shakeLast = null;
}

/**
 * Every scroll of the page: past `SHAKE_SPEED`, one shake at the next frame, however many scroll events the frame holds, so a flick
 * shakes once a frame for as long as its speed stays past the threshold. The frame is handed the seconds since the one before (a
 * flick's first frame, or one after a gap, counts as a 60 Hz frame).
 */
function onScroll(e: Event): void {
  const t = e.timeStamp, y = window.scrollY;
  const was = scrollSeen;
  scrollSeen = { y, t };
  if (!was || t <= was.t || t - was.t >= STALE_MS) return;
  const v = (y - was.y) / ((t - was.t) / 1000);
  if (Math.abs(v) < SHAKE_SPEED) return;
  shakeV = v;
  if (!shakeFrame) shakeFrame = requestAnimationFrame((now) => {
    shakeFrame = 0;
    const dt = shakeLast !== null && now - shakeLast > 0 && now - shakeLast < STALE_MS ? (now - shakeLast) / 1000 : 1 / 60;
    shakeLast = now;
    try { shake(shakeV, now, Math.min(0.05, dt)); } catch (err) { console.error(err); }
  });
}

/**
 * Shakes glitter off the sticky hosts on screen, as a scroll at `v` px a second does (down is positive) over a frame of `dt`
 * seconds, which scrolled `|v| x dt` px: `SHAKE_PER_PX x |v| x dt x (0.4 + 0.6 x strength)` flakes off each post (the fraction carried by a draw),
 * strength running from 0 at `SHAKE_SPEED` to 1 at twice it. They are copies of settled flakes on screen, thrown up the screen on a
 * scroll down and down it on a scroll up. The post itself is not redrawn. A post mid-burst sheds nothing, reduced motion shakes
 * nothing, and no more than `MAX_AIR` are in the air. Returns how many were shaken off. Exposed so a test can shake.
 */
export function shake(v: number, now: number, dt: number): number {
  if (typeof document === 'undefined' || Math.abs(v) < SHAKE_SPEED || clingReduced()) return 0;
  const strength = Math.min(1, Math.max(0, (Math.abs(v) - SHAKE_SPEED) / SHAKE_SPEED));
  const vw = innerWidth, vh = innerHeight;
  let took = 0;
  for (const [host, opts] of hosts) {
    if (falling.length >= MAX_AIR) break;
    if (!opts.sticky || !opts.flakes || !host.isConnected) continue;
    const f = opts.flakes as Inner;
    if (!f.fired || f.parts.length || !f.settled.length) continue;
    const r = host.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
    const band = bandAt(host, now);
    if (!band) continue;
    const want = SHAKE_PER_PX * Math.abs(v) * dt * (0.4 + 0.6 * strength);
    const n = Math.min(Math.floor(want) + (cr() < want % 1 ? 1 : 0), MAX_AIR - falling.length);
    let off = 0;
    for (let tries = 0; off < n && tries < n * 4; tries++) {
      const fl = f.settled[(cr() * f.settled.length) | 0]!;
      const x = r.left + fl.x, y = r.top + fl.y;
      if (x < 0 || y < 0 || x > vw || y > vh) continue;
      /* Thrown with the page: it leaves at a share of the scroll's speed, against the way the page went, sprayed sideways. */
      falling.push({ f: { ...fl }, x, y, vx: (cr() - 0.5) * 2 * SPRAY * Math.abs(v), vy: -v * THROW * (0.6 + cr() * 0.8), ph: cr() * 6, spin: 6 + cr() * 14, age: 0, hang: HANG_S * (0.6 + cr() * 0.8), next: 0, band });
      off++;
    }
    took += off;
  }
  if (took) { ensure(); if (!frame) frame = requestAnimationFrame(loop); }
  return took;
}

/** The color of a carried or falling flake at a phase, in the band it was lent against. The old dark outline is gone: it could fall below the light board's floor. */
function clingColor(f: Flake, ph: number, band: Band): string {
  const flash = Math.abs(Math.sin(ph)) ** 8, ink = darkStandard(band) ? ceilingOf(f.pal, band.hi)[f.ink]! : f.pal.lin[f.ink]!;
  if (band.bright) return freeColour(ink, floorOf(band) + (1 - floorOf(band)) * flash, band);
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

/**
 * One flake of the cling layer: one `setTransform` places it (no save/restore); `d` is the canvas's px per CSS px. `x, y` are in the
 * canvas's own CSS px, so a tile places a landed flake at its place in the tile. Draws at the context's alpha and records nothing.
 */
export function drawFlake(c: CanvasRenderingContext2D, f: Flake, x: number, y: number, ph: number, band: Band, d: number): void {
  const w = f.s * (0.4 + 0.6 * Math.abs(Math.cos(ph)));
  const rot = f.rot + ph * 0.3, cos = Math.cos(rot), sin = Math.sin(rot);
  c.fillStyle = clingColor(f, ph, band);
  c.setTransform(cos * d, sin * d, -sin * d, cos * d, x * d, y * d);
  c.fillRect(-f.s / 2, -f.s * 0.42, w, f.s * 0.84);
}

/** One flake of the cling layer, drawn and its square noted for the next frame's clear. */
function paint(c: CanvasRenderingContext2D, f: Flake, x: number, y: number, ph: number, alpha: number, band: Band, d: number): void {
  c.globalAlpha = alpha;
  drawFlake(c, f, x, y, ph, band, d);
  c.globalAlpha = 1;
  /* The rect reaches 0.66 s from its center whatever its turn; a px more for the smoothing. */
  const r = 0.66 * f.s + 1;
  dirty.push(Math.floor((x - r) * d), Math.floor((y - r) * d), Math.ceil((x + r) * d), Math.ceil((y + r) * d));
}

/** Takes a host out of its hit's list, so the host before it owns the hit again. */
function unhit(host: HTMLElement, options: ClingOptions): void {
  const hit = options.hit ?? host;
  const list = hits.get(hit);
  if (!list) return;
  const at = list.indexOf(host);
  if (at >= 0) list.splice(at, 1);
  if (!list.length) hits.delete(hit);
}

/**
 * Lands a flake that is past its hang if a landing place is under it, and says whether it did. In order: the registered host whose hit
 * the browser finds there (task order: an effect's surface, then a post cell), where the point lies in that host's box, in that host's
 * own px; else, where the thread's page
 * surface is live and the point's ground is the page's, the page, in document px; else it keeps flying (chrome with a ground of its
 * own would hide glitter lying on the page under it). The one hit test a flake costs per `CHECK_S`; the host's rect is the one measure a landing costs.
 */
function landOn(b: Falling, now: number): boolean {
  const el = elementAt(b.x, b.y);
  const host = hostOf(el);
  /* A host holds only what lies in its own box, where its tiles draw: a child hanging past it (As it landed's tag under the date bar)
   * is the host's hit but not its surface, and a flake there would be held and never drawn (#520). */
  const r = host?.getBoundingClientRect();
  const inBox = !!r && b.x >= r.left && b.x < r.right && b.y >= r.top && b.y < r.bottom;
  let on: object, x: number, y: number, band: Band | null, told: (() => void) | undefined;
  if (host && r && inBox) {
    on = host; x = b.x - r.left; y = b.y - r.top; band = bandAt(host, now);
    told = hosts.get(host)?.landed;
  } else if (landing?.page && el && landing.ground(el)) {
    on = landing.page.host; x = b.x + window.scrollX; y = b.y + window.scrollY; band = bandAt(document.documentElement, now);
    told = landing.page.landed;
  } else return false;
  /* It keeps its turn and the board it lies on: a landed flake is drawn still, at that turn, in that board's band. */
  addLoose(on, { ...b.f, x, y, ph: b.ph, band: band ?? b.band });
  try { told?.(); } catch (err) { console.error(err); }
  return true;
}

export const cling = {
  /**
   * Registers a host whose box a dropped flake may land on (and, with `sticky`, one that lends flakes to the pointer).
   * Returns the way back out. The host registers when it mounts and unregisters when it unmounts.
   */
  register(host: HTMLElement, options: ClingOptions = {}): () => void {
    const was = hosts.get(host);
    if (was) unhit(host, was);
    hosts.set(host, options);
    const hit = options.hit ?? host;
    const list = hits.get(hit);
    if (list) list.push(host); else hits.set(hit, [host]);
    if (options.sticky) hearScroll(true);
    return () => {
      if (hosts.get(host) === options) { hosts.delete(host); unhit(host, options); }
      if (![...hosts.values()].some((o) => o.sticky)) hearScroll(false);
    };
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
    for (const [h, o] of hosts) if (!h.isConnected) { hosts.delete(h); unhit(h, o); }
    if (!ctx || !canvas) return;
    if (!carried.length && !falling.length) {
      clearDirty(ctx);
      lastTick = null;
      settle();
      return;
    }
    sizeCanvas();
    clearDirty(ctx);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (mouse) {
      for (const c of carried) { c.ph += dt * (2 + mouse.speed * 0.4); paint(ctx, c.f, mouse.x + c.ox, mouse.y + c.oy, c.ph, 1, c.band, ratio); }
      mouse.speed *= Math.exp(-dt * 8);
    }
    const vw = innerWidth, vh = innerHeight;
    for (let i = falling.length - 1; i >= 0; i--) {
      const b = falling[i]!;
      /* Air drag pulls the throw down to a slow fall (gravity against drag: about GRAVITY / DRAG px a second), a flutter sways it,
         and its turn is quicker while it moves quickly. */
      const k = Math.exp(-DRAG * dt);
      b.vx *= k; b.vy = b.vy * k + GRAVITY * dt;
      b.age += dt;
      b.x += (b.vx + FLUTTER * Math.sin(b.f.tph + b.age * FLUTTER_RATE)) * dt; b.y += b.vy * dt;
      b.ph += dt * b.spin * (0.35 + 0.65 * Math.min(1, Math.hypot(b.vx, b.vy) / 400 + 0.3));
      /* Off the bottom, the top or the sides (by 10 px), it is gone, as glitter thrown off a table is: a flake that flies off the screen is culled. */
      if (b.y > vh + 10 || b.y < -10 || b.x < -10 || b.x > vw + 10) { falling.splice(i, 1); continue; }
      if (b.age >= b.hang && b.age >= b.next) {
        b.next = b.age + CHECK_S;
        if (landOn(b, now)) { falling.splice(i, 1); continue; }
      }
      paint(ctx, b.f, b.x, b.y, b.ph, 1, b.band, ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    try { landing?.frameEnd(); } catch (err) { console.error(err); }
    if (!carried.length && !falling.length) settle();
  },

  carried: () => carried.length,
  falling: () => falling.length,
  /** Whether the page-fixed canvas exists now. */
  active: () => canvas !== null,
  /** For tests only: forget everything and remove the layer. */
  reset(): void {
    dispose();
    hearScroll(false);
    clearTimeout(idleTimer);
    idleTimer = undefined;
    hosts.clear();
    hits.clear();
    cr = seededRng('cursor');
    dirty = [];
    sweepLoose();
  },
};
