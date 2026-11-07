/**
 * The holographic foil under a Feelin' Fab post's words (docs/plans/2026-11-06-shine-design.md sections 1, 5 and 6), ported
 * from the approved bench's `foil()` (docs/research/2026-11-06-shine-bench). Three grades: pearl (soft swirls that hold the
 * whole rainbow), bands (diagonal stripes with fine diffraction lines) and prism (cracked-ice facets with seams).
 *
 * The color of every 3px cell is a pure function of the grid, the light and the band (`render`, which writes sRGB bytes
 * into any `Uint8ClampedArray`); `draw` puts those bytes in an ImageData on a small grid canvas and draws it scaled with
 * bilinear smoothing over the whole of the host's canvas (every device pixel of it, so the grid covers it and nothing is
 * cleared first), then the starbursts on top; `sampleFoil` reads the same cells back as hex for the readable-band check. Every
 * cell goes through `clampInto`'s arithmetic (inlined, in `finishRow`), so no cell leaves the band whatever the palette or the light.
 *
 * Cost: during a scroll every post in view redraws each frame, so a render is the busy page's frame budget, and so is what
 * the browser does with the canvas after the loop's step: it rasters the frame's draws when the frame is produced, where the
 * loop's own time never sees them. A clear and a scaled draw at 'high' smoothing quality (a costlier filter than bilinear, for a
 * 3x upscale of soft cells that shows no difference) of a post-sized canvas, on every post in view, cost a slow machine (a
 * software-drawn Chromium, or this one with its CPU throttled to half) a frame in two; one opaque bilinear draw that covers the
 * canvas does not. Two canvases (the grid stretched by the page, the starbursts on a canvas over it) cost more, not less: each
 * canvas a frame changes is handed to the compositor on its own. What no light moves
 * (the pearl's swirl, the prism's facet map, hue and seams) is computed once per layout; what moves with the light but not
 * with the cell (a column's fringe, a facet's flash, the dark board's opposite stop) once per frame; the per-cell rest keeps
 * the bench's arithmetic in its order, so the bytes are the bench's to the last bit, and foil.test.ts holds them by digest.
 *
 * Units: a box is CSS px {w, h}; a cell is 3 CSS px (or `FoilOptions.cell`); `density` is canvas pixels per CSS px; a light is {x, y} in -1.5..1.5;
 * colors are computed in LINEAR light and written as 8-bit sRGB; `now` is milliseconds, as the page's loop gives it.
 *
 * A draw may be handed a span (`Span`: rows in CSS px from the box's top; engine/ui/shine/loop.ts `ShineFrame.span`, issue #304): the
 * rows of a post's body that are on screen. It then renders only the grid's rows the span covers and one more each side (the smoothed
 * draw reads a cell beyond the span's edge), puts only those, and draws the grid and the starbursts clipped to the span; the rest of the
 * canvas keeps the last draw's pixels. That is honored only after a whole draw of this layout on a canvas of this size, so a first
 * draw, or one after a resize or a release, is whole and nothing is ever left blank.
 *
 * `draw` takes any 2D context: a Feelin' Fab's foil is drawn in a worker on an OffscreenCanvas's (foilServe.ts), or on the page's own canvas
 * where the browser cannot (foilClient.ts), the same bytes and the same draw either way.
 *
 * Canvases come from `createCanvas` (default: an OffscreenCanvas, else a document canvas), so Node can run everything but
 * the drawing itself. Seeded, never `Math.random`. Engine code: it names no card and no instance.
 */
import { SRGB8, toHexA, toLinear, type Band, type Light, type Rgb } from './band.ts';
import { seededRng } from './seeded.ts';

export type FoilPattern = 'pearl' | 'bands' | 'prism';
export type Box = { readonly w: number; readonly h: number };
/** Rows of a box, in CSS px from its top (`top` < `bottom`). */
export type Span = { readonly top: number; readonly bottom: number };
export type FoilCanvas = { width: number; height: number; getContext(kind: '2d'): CanvasRenderingContext2D | null };

export type FoilOptions = {
  /** Public ids only: the same seed gives the same foil on every device. */
  readonly seed: string;
  readonly pattern: FoilPattern;
  /** Six sRGB stops, `#rrggbb`, for the board this foil is made for. */
  readonly palette: readonly string[];
  /** How many starbursts. */
  readonly stars: number;
  /** The highlight the starbursts are drawn in, sRGB `#rrggbb` (an instance's: the engine names no color). Added over cells, so it only lightens. */
  readonly glint: string;
  /**
   * The cell's side in CSS px (default 3). The foil's work is one color a cell, so a coarser cell costs less on a big box: an effect that
   * paints a box bigger than its words draws it with as many cells as the words' box had (engine/ui/cards/body.ts `paintScale`). The grid
   * is drawn smoothed to the canvas, so a coarser cell is the same pattern a little softer; the facets and the starbursts keep their size.
   */
  readonly cell?: number;
  /** Where canvases come from; tests pass a fake. */
  readonly createCanvas?: (w: number, h: number) => FoilCanvas;
};

export type Foil = {
  /** The cell's side in CSS px (`FoilOptions.cell`, 3 by default). */
  readonly cell: number;
  /** Write every cell's sRGB bytes (r, g, b, 255) into `out`, which holds `ceil(w/cell) * ceil(h/cell) * 4` of them. */
  render(box: Box, light: Light, band: Band, out: Uint8ClampedArray): void;
  /** `span`, when given, redraws only those rows (the header says when it is honored). */
  draw(ctx: CanvasRenderingContext2D, box: Box, density: number, light: Light, band: Band, now: number, idle: boolean, span?: Span | null): void;
  /** The prism's cell map for a box: the facet each cell belongs to. */
  facets(box: Box): Uint32Array;
  /** Drop the ImageData, the grid canvas and the cell map; the next draw builds them again. */
  release(): void;
  /** Whether any of those buffers is held. */
  holds(): boolean;
};

/** The cell's side in CSS px unless a foil is given a coarser one (`FoilOptions.cell`). */
const DEFAULT_CELL = 3;
const FACET = 17;

type Facet = { x: number; y: number; nx: number; ny: number; ph: number };
type Layout = {
  W: number; H: number; gw: number; gh: number;
  cells?: Facet[]; cellMap?: Uint32Array;
  /* What no light moves, per cell: the pearl's swirl; the prism's hue before the light and whether the cell is on a seam. */
  swirl?: Float64Array; hue?: Float64Array; seam?: Uint8Array; scratch?: Float64Array; row?: Float64Array;
  small?: FoilCanvas; img?: ImageData;
  /* The canvas size this layout last drew whole on: a span is honored only on a canvas of that size, which holds that whole draw. */
  whole?: { readonly cw: number; readonly ch: number };
};

function defaultCanvas(w: number, h: number): FoilCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h) as unknown as FoilCanvas;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c as unknown as FoilCanvas;
}

/** The starburst sprite: a soft glow, a cross and a fainter diagonal cross, in the glint on transparent. */
function starSprite(make: (w: number, h: number) => FoilCanvas, glint: Readonly<Rgb>): FoilCanvas {
  const at = (a: number): string => toHexA(glint, a);
  const Z = 64, m = Z / 2;
  const c = make(Z, Z);
  const g = c.getContext('2d');
  if (!g) return c;
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
  return c;
}

/**
 * `toSrgb8` as a table indexed by truncation: entry k is SRGB8[(k + 1) >> 1], so TO8[(l * 8192) | 0] is SRGB8[Math.round(l * 4096)]
 * for every l in 0..1, to the last bit (l * 8192 is exact, and the truncation's k picks the same rounding, ties up), without
 * Math.round, which costs more in a renderer's inner loop than all the rest of a cell's last steps. A channel here never leaves
 * 0..1: every step is a blend of colors in 0..1, a scale by at most 1, or a mix toward white.
 */
const TO8 = new Uint8Array(8193);
for (let k = 0; k <= 8192; k++) TO8[k] = SRGB8[(k + 1) >> 1]!;

/** A frame's constants for `finishRow`: the board, its band, and the dark board's opposite stop. */
type Finish = { readonly dark: boolean; readonly lo: number; readonly hi: number; readonly ar: number; readonly ag: number; readonly ab: number };

/**
 * A row's last steps, on numbers: `row` holds each cell's linear r, g, b and highlight h. The highlight goes toward the
 * opposite stop and white on the dark board, toward white on the light one; then `clampInto` (scale down past hi, mix toward
 * white under lo, keeping hue); then 8-bit sRGB through the table, written from cell `at` on. The same arithmetic in the same
 * order as band.ts's helpers. One call a row, so the per-cell work is one loop over locals.
 */
function finishRow(row: Float64Array, n: number, f: Finish, px: Uint8ClampedArray, u32: Uint32Array | null, at: number): void {
  const { dark, lo, hi, ar, ag, ab } = f;
  for (let i = 0; i < n; i++) {
    const q = i * 4;
    let r = row[q]!, g = row[q + 1]!, b = row[q + 2]!;
    const h = row[q + 3]!;
    if (dark) {
      const t = h * 0.6;
      r += (ar - r) * t; g += (ag - g) * t; b += (ab - b) * t;
      const w = h * 0.75;
      r += (1 - r) * w; g += (1 - g) * w; b += (1 - b) * w;
    } else {
      r += (1 - r) * h; g += (1 - g) * h; b += (1 - b) * h;
    }
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (Y > hi) {
      const k = hi / Y;
      r *= k; g *= k; b *= k;
    } else if (Y < lo) {
      const k = (lo - Y) / (1 - Y);
      r += (1 - r) * k; g += (1 - g) * k; b += (1 - b) * k;
    }
    const R = TO8[(r * 8192) | 0]!;
    const G = TO8[(g * 8192) | 0]!;
    const B = TO8[(b * 8192) | 0]!;
    /* A little-endian word r | g << 8 | b << 16 | 255 << 24, as a signed int so it stays small; a Uint32Array stores the same bits. */
    if (u32) u32[at + i] = 0xff000000 | (B << 16) | (G << 8) | R;
    else { const o = (at + i) * 4; px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = 255; }
  }
}

export function makeFoil(opts: FoilOptions): Foil {
  const CELL = opts.cell !== undefined && Number.isFinite(opts.cell) && opts.cell >= DEFAULT_CELL ? opts.cell : DEFAULT_CELL;
  if (!/^#[0-9a-f]{6}$/iu.test(opts.glint)) throw new Error(`foil: the glint needs a #rrggbb color, got ${JSON.stringify(opts.glint)}`);
  const GLINT = toLinear(opts.glint);
  if (opts.palette.length !== 6) throw new Error(`foil: the palette needs six stops, got ${opts.palette.length}`);
  const make = opts.createCanvas ?? defaultCanvas;
  const PAL = opts.palette.map(toLinear);
  const rand = seededRng(`${opts.seed}:foil`);
  /* The post's own turn of the palette, 0..1, as the bench gave each post a fixed seed. */
  const seed = rand();
  /* Starbursts as fractions of the box, so a resize moves them with it; each faces its own way. */
  const starRand = seededRng(`${opts.seed}:stars`);
  const stars = Array.from({ length: opts.stars }, () => {
    const a = starRand() * Math.PI * 2, m = 0.2 + starRand() * 1.0;
    return { u: starRand() * 0.94 + 0.03, v: starRand() * 0.88 + 0.06, s: 18 + starRand() * 22, nx: Math.cos(a) * m, ny: Math.sin(a) * m };
  });

  let layout: Layout | undefined;
  let sprite: FoilCanvas | undefined;

  /** A box is usable only with a finite size; anything else draws and renders nothing and allocates nothing. */
  const usable = (box: Box) => Number.isFinite(box.w) && Number.isFinite(box.h);
  const NONE = new Uint32Array(0);

  function layoutFor(box: Box): Layout {
    /* Whole CSS px: a sub-pixel resize must not rebuild the grid canvas, the image and the cell map. */
    const W = Math.max(1, Math.round(box.w)), H = Math.max(1, Math.round(box.h));
    if (layout && layout.W === W && layout.H === H) return layout;
    /* The old grid canvas is dropped with its layout; zero it so its pixel memory is freed now, as `release` does. */
    if (layout?.small) { layout.small.width = 0; layout.small.height = 0; }
    const L: Layout = { W, H, gw: Math.ceil(W / CELL), gh: Math.ceil(H / CELL) };
    layout = L;
    return L;
  }

  /** Level 3's cracked ice: seeded cells, each a facet tilted its own way, and the cell each 3px cell belongs to. */
  function facetsOf(L: Layout): Uint32Array {
    if (L.cellMap && L.cells) return L.cellMap;
    const r = seededRng(`${opts.seed}:ice`);
    const pts: Facet[] = [];
    for (let y = -FACET; y < L.H + FACET; y += FACET) {
      for (let x = -FACET; x < L.W + FACET; x += FACET) {
        const a = r() * Math.PI * 2, m = Math.sqrt(r()) * 1.25;
        pts.push({ x: x + r() * FACET, y: y + r() * FACET, nx: Math.cos(a) * m, ny: Math.sin(a) * m, ph: r() });
      }
    }
    const cols = Math.ceil((L.W + 2 * FACET) / FACET);
    const map = new Uint32Array(L.gw * L.gh);
    for (let j = 0; j < L.gh; j++) {
      for (let i = 0; i < L.gw; i++) {
        const x = (i + 0.5) * CELL, y = (j + 0.5) * CELL;
        const ci = Math.floor((x + FACET) / FACET), cj = Math.floor((y + FACET) / FACET);
        let best = 0, bd = 1e9;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const k = (cj + dj) * cols + (ci + di), q = pts[k];
            if (!q) continue;
            const d = (q.x - x) ** 2 + (q.y - y) ** 2;
            if (d < bd) { bd = d; best = k; }
          }
        }
        map[j * L.gw + i] = best;
      }
    }
    L.cells = pts; L.cellMap = map;
    return map;
  }

  const cosT = Math.cos(1.75), sinT = Math.sin(1.75);
  /* The palette as a flat table, stop 0 repeated after stop 5 so a blend never wraps its index. */
  const PF = new Float64Array(21);
  for (let k = 0; k < 7; k++) { const p = PAL[k % 6]!; PF[k * 3] = p[0]; PF[k * 3 + 1] = p[1]; PF[k * 3 + 2] = p[2]; }
  /* `palAt` writes the palette at t (wrapping) here; a frame's few lookups use it, the per-cell loops blend PF inline. */
  const C = new Float64Array(3);
  function palAt(t: number): Float64Array {
    /* t - floor(t) is ((t % 1) + 1) % 1 to the last bit, except that it can round up to 1 where that gives 0. */
    let u = t - Math.floor(t);
    if (u >= 1) u = 0;
    const x = u * 6, i = x | 0, f = x - i, a = i * 3;
    C[0] = PF[a]! + (PF[a + 3]! - PF[a]!) * f; C[1] = PF[a + 1]! + (PF[a + 4]! - PF[a + 1]!) * f; C[2] = PF[a + 2]! + (PF[a + 5]! - PF[a + 2]!) * f;
    return C;
  }

  /** What no light moves, computed once per layout: the pearl's swirl per cell; the prism's per-cell hue and seams. */
  function pearlOf(L: Layout): Float64Array {
    if (L.swirl) return L.swirl;
    const { gw, gh, W, H } = L;
    const sw = new Float64Array(gw * gh);
    for (let j = 0; j < gh; j++) {
      const y = (j + 0.5) * CELL;
      for (let i = 0; i < gw; i++) {
        const x = (i + 0.5) * CELL;
        sw[j * gw + i] = 0.09 * Math.sin(x / W * 5.1 + y / H * 2.3 + seed * 9) + 0.06 * Math.sin(y / H * 6.2 - x / W * 3.4);
      }
    }
    L.swirl = sw;
    return sw;
  }
  function prismOf(L: Layout): { hue: Float64Array; seam: Uint8Array } {
    if (L.hue && L.seam) return { hue: L.hue, seam: L.seam };
    const map = facetsOf(L), cells = L.cells!;
    const { gw, gh, W, H } = L;
    const hue = new Float64Array(gw * gh), seam = new Uint8Array(gw * gh);
    for (let j = 0; j < gh; j++) {
      const y = (j + 0.5) * CELL;
      for (let i = 0; i < gw; i++) {
        const x = (i + 0.5) * CELL, idx = j * gw + i, k = map[idx]!;
        const rr = Math.hypot((x - W / 2) / W, (y - H / 2) / H);
        hue[idx] = seed + cells[k]!.ph * 0.45 + rr * 1.6;
        const right = i < gw - 1 ? map[idx + 1]! : k, down = j < gh - 1 ? map[idx + gw]! : k;
        seam[idx] = right !== k || down !== k ? 1 : 0;
      }
    }
    L.hue = hue; L.seam = seam;
    return { hue, seam };
  }

  /* A little-endian Uint32 view packs a cell as one write; a big-endian machine, or a buffer off a 4-byte boundary, writes bytes. */
  const LITTLE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  let view: { px: Uint8ClampedArray; u32: Uint32Array | null } | undefined;
  const wordsOf = (px: Uint8ClampedArray): Uint32Array | null => {
    if (view?.px === px) return view.u32;
    const u32 = LITTLE && px.byteOffset % 4 === 0 ? new Uint32Array(px.buffer, px.byteOffset, px.length >> 2) : null;
    view = { px, u32 };
    return u32;
  };
  /** A row of cells before their last steps: r, g, b and the highlight, four numbers a cell. */
  const rowOf = (L: Layout): Float64Array => (L.row ??= new Float64Array(L.gw * 4));
  /** A frame's per-column or per-facet numbers, in a buffer the layout keeps so a frame allocates nothing. */
  const scratch = (L: Layout, n: number): Float64Array => (L.scratch && L.scratch.length >= n ? L.scratch : (L.scratch = new Float64Array(n)));

  /**
   * The pure per-cell computation both `draw` and `sampleFoil` share (the split by cost is in the header). The per-cell loops
   * keep the color in locals and blend the palette inline, and each row ends in one `finishRow` call: a helper called per cell,
   * or one that wrote shared state, cost more than the math.
   */
  function renderInto(L: Layout, light: Light, band: Band, px: Uint8ClampedArray, j0 = 0, j1 = L.gh): void {
    const { gw, gh, W, H } = L;
    const lx = light.x, ly = light.y;
    const pattern = opts.pattern;
    const u32 = wordsOf(px);
    /* The dark board's highlights turn toward the palette's opposite stop: one stop a frame, the same for every cell. */
    const alt = palAt(seed + 0.5 + 0.3 * lx);
    const f: Finish = { dark: band.hi < 0.5, lo: band.lo, hi: band.hi, ar: alt[0]!, ag: alt[1]!, ab: alt[2]! };
    const row = rowOf(L);

    if (pattern === 'pearl') {
      /* A milky ground whose hue turns as the light moves; the whole rainbow lies across the post in slow soft swirls. */
      const swirl = pearlOf(L);
      const cxs = W * (0.5 + 0.42 * lx), cys = H * (0.5 + 0.42 * ly), R2 = (Math.max(W, H) * 0.42) ** 2;
      const turn = seed + 0.32 * lx + 0.18 * ly, R6 = R2 * 0.6;
      /* Per column: its share of the hue, its distance from the light, and the fringe it throws (no row moves either). */
      const col = scratch(L, gw * 5);
      for (let i = 0; i < gw; i++) {
        const x = (i + 0.5) * CELL, fr = palAt(seed + 0.5 + (x / W) * 0.85 + 0.32 * lx), o = i * 5;
        col[o] = (x / W) * 0.85; col[o + 1] = (x - cxs) ** 2; col[o + 2] = fr[0]!; col[o + 3] = fr[1]!; col[o + 4] = fr[2]!;
      }
      for (let j = j0; j < j1; j++) {
        const y = (j + 0.5) * CELL;
        const rowHue = (y / H) * 0.3, rowD = (y - cys) ** 2;
        for (let i = 0, idx = j * gw; i < gw; i++, idx++) {
          const o = i * 5;
          const t = turn + col[o]! + rowHue + swirl[idx]!;
          let u = t - Math.floor(t);
          if (u >= 1) u = 0;
          const x6 = u * 6, p = x6 | 0, fp = x6 - p, a = p * 3;
          let r = PF[a]! + (PF[a + 3]! - PF[a]!) * fp, g = PF[a + 1]! + (PF[a + 4]! - PF[a + 1]!) * fp, b = PF[a + 2]! + (PF[a + 5]! - PF[a + 2]!) * fp;
          const s = Math.exp(-(col[o + 1]! + rowD) / R6);
          const k = s * (1 - s) * 1.2;
          r += (col[o + 2]! - r) * k; g += (col[o + 3]! - g) * k; b += (col[o + 4]! - b) * k;
          const q = i * 4;
          row[q] = r; row[q + 1] = g; row[q + 2] = b; row[q + 3] = s * 0.3;
        }
        finishRow(row, gw, f, px, u32, j * gw);
      }
    } else if (pattern === 'bands') {
      /* Diagonal rainbow stripes with fine diffraction lines, and a bright stripe where the light catches. */
      const bandPos = 0.5 + 0.55 * lx + 0.25 * ly;
      const period = Math.min(W * 0.4, 360);
      const span = W * Math.abs(cosT) + H * Math.abs(sinT);
      const hx = 0.9 * lx, hy = 0.45 * ly, sx = lx * 24, sy = ly * 9;
      for (let j = j0; j < j1; j++) {
        const y = (j + 0.5) * CELL;
        for (let i = 0, idx = j * gw; i < gw; i++, idx++) {
          const x = (i + 0.5) * CELL;
          const d = x * cosT + y * sinT;
          const t = seed + d / period + hx + hy;
          let u = t - Math.floor(t);
          if (u >= 1) u = 0;
          const x6 = u * 6, p = x6 | 0, fp = x6 - p, a = p * 3;
          const lines = 0.5 + 0.5 * Math.sin(d * 0.85 + sx + sy);
          const k = 0.9 + 0.1 * lines;
          const r = (PF[a]! + (PF[a + 3]! - PF[a]!) * fp) * k, g = (PF[a + 1]! + (PF[a + 4]! - PF[a + 1]!) * fp) * k, b = (PF[a + 2]! + (PF[a + 5]! - PF[a + 2]!) * fp) * k;
          const prj = d / span + 0.5;
          const sp = Math.exp(-(((prj - bandPos) * 7) ** 2));
          const q = i * 4;
          row[q] = r; row[q + 1] = g; row[q + 2] = b; row[q + 3] = sp * 0.5 + lines * sp * 0.12;
        }
        finishRow(row, gw, f, px, u32, j * gw);
      }
    } else {
      /* Every facet throws its own color, spreading out from the middle, and flashes when it faces the light. */
      const map = facetsOf(L), cells = L.cells!;
      const { hue, seam } = prismOf(L);
      /* Per facet: how far the light turns its color, and how bright it flashes. */
      const n = cells.length, per = scratch(L, n * 2);
      for (let k = 0; k < n; k++) {
        const cell = cells[k]!;
        per[k * 2] = 0.55 * (cell.nx * lx + cell.ny * ly);
        per[k * 2 + 1] = Math.exp(-((cell.nx - lx) ** 2 + (cell.ny - ly) ** 2) / 0.07) * 0.7;
      }
      const shift = 0.25 * lx, sh = f.dark ? 0.78 : 0.94;
      for (let j = j0; j < j1; j++) {
        for (let i = 0, idx = j * gw; i < gw; i++, idx++) {
          const k = map[idx]! * 2;
          const t = hue[idx]! + per[k]! + shift;
          let u = t - Math.floor(t);
          if (u >= 1) u = 0;
          const x6 = u * 6, p = x6 | 0, fp = x6 - p, a = p * 3;
          let r = PF[a]! + (PF[a + 3]! - PF[a]!) * fp, g = PF[a + 1]! + (PF[a + 4]! - PF[a + 1]!) * fp, b = PF[a + 2]! + (PF[a + 5]! - PF[a + 2]!) * fp;
          let h = per[k + 1]!;
          if (seam[idx]) { r *= sh; g *= sh; b *= sh; h *= 0.5; }
          const q = i * 4;
          row[q] = r; row[q + 1] = g; row[q + 2] = b; row[q + 3] = h;
        }
        finishRow(row, gw, f, px, u32, j * gw);
      }
    }
  }

  return {
    cell: CELL,
    render(box, light, band, outPx) {
      if (!usable(box)) return;
      const L = layoutFor(box);
      if (outPx.length < L.gw * L.gh * 4) throw new Error(`foil: the buffer holds ${outPx.length} bytes, ${L.gw * L.gh * 4} needed`);
      renderInto(L, light, band, outPx);
    },

    facets: (box) => (usable(box) ? facetsOf(layoutFor(box)) : NONE),

    draw(ctx, box, density, light, band, now, idle, span) {
      if (!usable(box)) return;
      const L = layoutFor(box);
      /* The caller's context comes back as it was: transform, smoothing, alpha and composite are all restored. */
      ctx.save();
      try {
        paint(ctx, L, density, light, band, now, idle, span ?? null);
      } finally {
        ctx.restore();
      }
    },

    release() {
      /* Zero the canvases so their backing stores are freed now, not when the collector gets to them. */
      if (layout?.small) { layout.small.width = 0; layout.small.height = 0; }
      if (sprite) { sprite.width = 0; sprite.height = 0; }
      layout = undefined; sprite = undefined; view = undefined;
    },
    holds: () => layout !== undefined && (layout.img !== undefined || layout.cellMap !== undefined || layout.small !== undefined ||
      layout.swirl !== undefined || layout.hue !== undefined || layout.row !== undefined || layout.scratch !== undefined),
  };

  function paint(ctx: CanvasRenderingContext2D, L: Layout, density: number, light: Light, band: Band, now: number, idle: boolean, span: Span | null): void {
    if (!L.small) L.small = make(L.gw, L.gh);
    const sg = L.small.getContext('2d');
    if (!sg) return;
    const fresh = !L.img;
    if (!L.img) L.img = sg.createImageData(L.gw, L.gh);
    const cw = ctx.canvas?.width ?? Math.round(L.W * density), ch = ctx.canvas?.height ?? Math.round(L.H * density);
    /* The grid's rows to redraw: the span's and one either side, when the canvas holds this layout's whole draw at this size. */
    let j0 = 0, j1 = L.gh;
    if (span && !fresh && L.whole && L.whole.cw === cw && L.whole.ch === ch && Number.isFinite(span.top) && Number.isFinite(span.bottom)) {
      j0 = Math.max(0, Math.floor(span.top / CELL) - 1);
      j1 = Math.min(L.gh, Math.ceil(span.bottom / CELL) + 1);
      if (j1 <= j0) return;
    }
    const part = j0 > 0 || j1 < L.gh;
    renderInto(L, light, band, L.img.data, j0, j1);
    if (part) sg.putImageData(L.img, 0, 0, 0, j0, L.gw, j1 - j0); else sg.putImageData(L.img, 0, 0);
    if (!part) L.whole = { cw, ch };
    /* Every cell is opaque, and the grid is drawn over every device pixel of the canvas: nothing needs clearing first, and the
     * starbursts below are added to this frame's foil, never to the last one's. A span's draw is clipped to the span's rows in
     * device px, the starbursts with it, and the rows outside keep the last draw's foil and starbursts. */
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (part) {
      const y0 = Math.max(0, Math.floor(span!.top * density)), y1 = Math.min(ch, Math.ceil(span!.bottom * density));
      ctx.beginPath(); ctx.rect(0, y0, cw, y1 - y0); ctx.clip();
    }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(L.small as unknown as CanvasImageSource, 0, 0, L.gw, L.gh, 0, 0, cw, ch);
    ctx.setTransform(density, 0, 0, density, 0, 0);
    /* Starbursts: each faces its own way and flares when the light lines up with it. Their white is let through only as
     * far as the band allows it, and a band lets pure white through only when its ceiling is 1: on any lower ceiling
     * (every dark board, whatever its inks) 'lighter' white could lift a cell out of the band, so none is drawn. */
    if (stars.length === 0 || band.hi < 1) return;
    if (!sprite) sprite = starSprite(make, GLINT);
    const t = now / 1000;
    ctx.globalCompositeOperation = 'lighter';
    for (const s of stars) {
      const sx = s.u * L.W, sy = s.v * L.H;
      let a = Math.exp(-((s.nx - light.x) ** 2 + (s.ny - light.y) ** 2) / 0.12);
      if (idle) a = Math.max(a, 0.85 * Math.max(0, Math.sin(t * 0.9 + sx * 0.05)) ** 24);
      const alpha = 0.12 + 0.88 * a;
      if (alpha < 0.02) continue;
      const z = s.s * (0.55 + 0.6 * a);
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage(sprite as unknown as CanvasImageSource, sx - z / 2, sy - z / 2, z, z);
    }
  }
}

/** Every cell's color as `#rrggbb`, for the readable-band check (cells only: the starbursts add white only where the band allows it). */
export function sampleFoil(foil: Foil, box: Box, light: Light, band: Band): string[] {
  if (!Number.isFinite(box.w) || !Number.isFinite(box.h)) return [];
  const n = Math.ceil(Math.max(1, Math.round(box.w)) / foil.cell) * Math.ceil(Math.max(1, Math.round(box.h)) / foil.cell);
  const px = new Uint8ClampedArray(n * 4);
  foil.render(box, light, band, px);
  const hex = (v: number) => v.toString(16).padStart(2, '0');
  const colors = new Array<string>(n);
  for (let i = 0; i < n; i++) colors[i] = `#${hex(px[i * 4]!)}${hex(px[i * 4 + 1]!)}${hex(px[i * 4 + 2]!)}`;
  return colors;
}

