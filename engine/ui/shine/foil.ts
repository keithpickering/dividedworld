/**
 * The holographic foil under a Feelin' Fab post's words (docs/plans/2026-11-06-shine-design.md sections 1, 5 and 6), ported
 * from the approved bench's `foil()` (docs/research/2026-11-06-shine-bench). Three grades: pearl (soft swirls that hold the
 * whole rainbow), bands (diagonal stripes with fine diffraction lines) and prism (cracked-ice facets with seams).
 *
 * The color of every 3px cell is a pure function of the grid, the light and the band (`render`, which writes sRGB bytes
 * into any `Uint8ClampedArray`); `draw` puts those bytes in an ImageData on a small grid canvas and draws it scaled with
 * smoothing, then the starbursts on top; `sampleFoil` reads the same cells back as hex for the readable-band check. Every
 * cell goes through `clampInto`, so no cell leaves the band whatever the palette or the light.
 *
 * Units: a box is CSS px {w, h}; a cell is 3 CSS px; `density` is canvas pixels per CSS px; a light is {x, y} in -1.5..1.5;
 * colors are computed in LINEAR light and written as 8-bit sRGB; `now` is milliseconds, as the page's loop gives it.
 *
 * Canvases come from `createCanvas` (default: an OffscreenCanvas, else a document canvas), so Node can run everything but
 * the drawing itself. Seeded, never `Math.random`. Engine code: it names no card and no instance.
 */
import { clampInto, toLinear, toSrgb8, type Band, type Light, type Rgb } from './band.ts';
import { seededRng } from './seeded.ts';

export type FoilPattern = 'pearl' | 'bands' | 'prism';
export type Box = { readonly w: number; readonly h: number };
export type FoilCanvas = { width: number; height: number; getContext(kind: '2d'): CanvasRenderingContext2D | null };

export type FoilOptions = {
  /** Public ids only: the same seed gives the same foil on every device. */
  readonly seed: string;
  readonly pattern: FoilPattern;
  /** Six sRGB stops, `#rrggbb`, for the board this foil is made for. */
  readonly palette: readonly string[];
  /** How many starbursts. */
  readonly stars: number;
  /** Where canvases come from; tests pass a fake. */
  readonly createCanvas?: (w: number, h: number) => FoilCanvas;
};

export type Foil = {
  /** Write every cell's sRGB bytes (r, g, b, 255) into `out`, which holds `ceil(w/3) * ceil(h/3) * 4` of them. */
  render(box: Box, light: Light, band: Band, out: Uint8ClampedArray): void;
  draw(ctx: CanvasRenderingContext2D, box: Box, density: number, light: Light, band: Band, now: number, idle: boolean): void;
  /** The prism's cell map for a box: the facet each 3px cell belongs to. */
  facets(box: Box): Uint32Array;
  /** Drop the ImageData, the grid canvas and the cell map; the next draw builds them again. */
  release(): void;
  /** Whether any of those buffers is held. */
  holds(): boolean;
};

const CELL = 3;
const FACET = 17;

type Facet = { x: number; y: number; nx: number; ny: number; ph: number };
type Layout = {
  W: number; H: number; gw: number; gh: number;
  cells?: Facet[]; cellMap?: Uint32Array;
  small?: FoilCanvas; img?: ImageData;
};

function defaultCanvas(w: number, h: number): FoilCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h) as unknown as FoilCanvas;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c as unknown as FoilCanvas;
}

/** The starburst sprite: a soft glow, a cross and a fainter diagonal cross, white on transparent. */
function starSprite(make: (w: number, h: number) => FoilCanvas): FoilCanvas {
  const Z = 64, m = Z / 2;
  const c = make(Z, Z);
  const g = c.getContext('2d');
  if (!g) return c;
  const glow = g.createRadialGradient(m, m, 0, m, m, m);
  glow.addColorStop(0, 'rgba(255,255,255,0.95)'); glow.addColorStop(0.18, 'rgba(255,255,255,0.45)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow; g.fillRect(0, 0, Z, Z);
  for (const vertical of [true, false]) {
    const gr = g.createRadialGradient(m, m, 0, m, m, m);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(m, m, vertical ? 1.6 : m, vertical ? m : 1.6, 0, 0, Math.PI * 2); g.fill();
  }
  g.save(); g.translate(m, m); g.rotate(Math.PI / 4);
  const gr2 = g.createRadialGradient(0, 0, 0, 0, 0, m * 0.55);
  gr2.addColorStop(0, 'rgba(255,255,255,0.8)'); gr2.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr2;
  g.beginPath(); g.ellipse(0, 0, 1, m * 0.55, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(0, 0, m * 0.55, 1, 0, 0, Math.PI * 2); g.fill();
  g.restore();
  return c;
}

export function makeFoil(opts: FoilOptions): Foil {
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

  const out: Rgb = [0, 0, 0];
  /** The palette at t (wrapping), blended in linear light; the result is shared, so copy it before the next call. */
  function pal(t: number): Rgb {
    t = ((t % 1) + 1) % 1;
    const x = t * 6, i = x | 0, f = x - i, a = PAL[i]!, b = PAL[(i + 1) % 6]!;
    out[0] = a[0] + (b[0] - a[0]) * f; out[1] = a[1] + (b[1] - a[1]) * f; out[2] = a[2] + (b[2] - a[2]) * f;
    return out;
  }

  let layout: Layout | undefined;
  let sprite: FoilCanvas | undefined;

  /** A box is usable only with a finite size; anything else draws and renders nothing and allocates nothing. */
  const usable = (box: Box) => Number.isFinite(box.w) && Number.isFinite(box.h);
  const NONE = new Uint32Array(0);

  function layoutFor(box: Box): Layout {
    /* Whole CSS px: a sub-pixel resize must not rebuild the grid canvas, the image and the cell map. */
    const W = Math.max(1, Math.round(box.w)), H = Math.max(1, Math.round(box.h));
    if (layout && layout.W === W && layout.H === H) return layout;
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
  const c: Rgb = [0, 0, 0];

  /** The pure per-cell computation both `draw` and `sampleFoil` share. */
  function renderInto(L: Layout, light: Light, band: Band, px: Uint8ClampedArray): void {
    const { gw, gh, W, H } = L;
    const lx = light.x, ly = light.y;
    const dark = band.hi < 0.5;
    const pattern = opts.pattern;
    const cellMap = pattern === 'prism' ? facetsOf(L) : undefined;
    const cells = L.cells;
    const cxs = W * (0.5 + 0.42 * lx), cys = H * (0.5 + 0.42 * ly), R2 = (Math.max(W, H) * 0.42) ** 2;
    const bandPos = 0.5 + 0.55 * lx + 0.25 * ly;
    const period = Math.min(W * 0.4, 360);
    const span = W * Math.abs(cosT) + H * Math.abs(sinT);
    for (let j = 0; j < gh; j++) {
      const y = (j + 0.5) * CELL;
      for (let i = 0; i < gw; i++) {
        const x = (i + 0.5) * CELL, idx = j * gw + i;
        let h = 0;
        if (pattern === 'pearl') {
          /* A milky ground whose hue turns as the light moves; the whole rainbow lies across the post in slow soft swirls. */
          const swirl = 0.09 * Math.sin(x / W * 5.1 + y / H * 2.3 + seed * 9) + 0.06 * Math.sin(y / H * 6.2 - x / W * 3.4);
          const base = pal(seed + 0.32 * lx + 0.18 * ly + (x / W) * 0.85 + (y / H) * 0.3 + swirl);
          c[0] = base[0]; c[1] = base[1]; c[2] = base[2];
          const s = Math.exp(-((x - cxs) ** 2 + (y - cys) ** 2) / (R2 * 0.6));
          const fringe = pal(seed + 0.5 + (x / W) * 0.85 + 0.32 * lx);
          const f = s * (1 - s) * 1.2;
          c[0] += (fringe[0] - c[0]) * f; c[1] += (fringe[1] - c[1]) * f; c[2] += (fringe[2] - c[2]) * f;
          h = s * 0.3;
        } else if (pattern === 'bands') {
          /* Diagonal rainbow stripes with fine diffraction lines, and a bright stripe where the light catches. */
          const d = x * cosT + y * sinT;
          const base = pal(seed + d / period + 0.9 * lx + 0.45 * ly);
          const lines = 0.5 + 0.5 * Math.sin(d * 0.85 + lx * 24 + ly * 9);
          const k = 0.9 + 0.1 * lines;
          c[0] = base[0] * k; c[1] = base[1] * k; c[2] = base[2] * k;
          const prj = d / span + 0.5;
          const sp = Math.exp(-(((prj - bandPos) * 7) ** 2));
          h = sp * 0.5 + lines * sp * 0.12;
        } else {
          /* Every facet throws its own color, spreading out from the middle, and flashes when it faces the light. */
          const k = cellMap![idx]!, cell = cells![k]!;
          const rr = Math.hypot((x - W / 2) / W, (y - H / 2) / H);
          const face = cell.nx * lx + cell.ny * ly;
          const base = pal(seed + cell.ph * 0.45 + rr * 1.6 + 0.55 * face + 0.25 * lx);
          c[0] = base[0]; c[1] = base[1]; c[2] = base[2];
          const a = Math.exp(-((cell.nx - lx) ** 2 + (cell.ny - ly) ** 2) / 0.07);
          h = a * 0.7;
          const right = i < gw - 1 ? cellMap![idx + 1]! : k, down = j < gh - 1 ? cellMap![idx + gw]! : k;
          if (right !== k || down !== k) { const sh = dark ? 0.78 : 0.94; c[0] *= sh; c[1] *= sh; c[2] *= sh; h *= 0.5; }
        }
        if (dark) {
          /* Highlights turn toward the palette's opposite stop before the clamp, so deep jewel tones shift hue with the light. */
          const alt = pal(seed + 0.5 + 0.3 * lx);
          const t = h * 0.6;
          c[0] += (alt[0] - c[0]) * t; c[1] += (alt[1] - c[1]) * t; c[2] += (alt[2] - c[2]) * t;
          const g = h * 0.75;
          c[0] += (1 - c[0]) * g; c[1] += (1 - c[1]) * g; c[2] += (1 - c[2]) * g;
        } else {
          c[0] += (1 - c[0]) * h; c[1] += (1 - c[1]) * h; c[2] += (1 - c[2]) * h;
        }
        clampInto(c, band);
        const o = idx * 4;
        px[o] = toSrgb8(c[0]); px[o + 1] = toSrgb8(c[1]); px[o + 2] = toSrgb8(c[2]); px[o + 3] = 255;
      }
    }
  }

  return {
    render(box, light, band, outPx) {
      if (!usable(box)) return;
      const L = layoutFor(box);
      if (outPx.length < L.gw * L.gh * 4) throw new Error(`foil: the buffer holds ${outPx.length} bytes, ${L.gw * L.gh * 4} needed`);
      renderInto(L, light, band, outPx);
    },

    facets: (box) => (usable(box) ? facetsOf(layoutFor(box)) : NONE),

    draw(ctx, box, density, light, band, now, idle) {
      if (!usable(box)) return;
      const L = layoutFor(box);
      /* The caller's context comes back as it was: transform, smoothing, alpha and composite are all restored. */
      ctx.save();
      try {
        paint(ctx, L, density, light, band, now, idle);
      } finally {
        ctx.restore();
      }
    },

    release() {
      /* Zero the canvases so their backing stores are freed now, not when the collector gets to them. */
      if (layout?.small) { layout.small.width = 0; layout.small.height = 0; }
      if (sprite) { sprite.width = 0; sprite.height = 0; }
      layout = undefined; sprite = undefined;
    },
    holds: () => layout !== undefined && (layout.img !== undefined || layout.cellMap !== undefined || layout.small !== undefined),
  };

  function paint(ctx: CanvasRenderingContext2D, L: Layout, density: number, light: Light, band: Band, now: number, idle: boolean): void {
    if (!L.small) L.small = make(L.gw, L.gh);
    const sg = L.small.getContext('2d');
    if (!sg) return;
    if (!L.img) L.img = sg.createImageData(L.gw, L.gh);
    renderInto(L, light, band, L.img.data);
    sg.putImageData(L.img, 0, 0);
    ctx.setTransform(density, 0, 0, density, 0, 0);
    ctx.clearRect(0, 0, L.W, L.H);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(L.small as unknown as CanvasImageSource, 0, 0, L.W, L.H);
    /* Starbursts: each faces its own way and flares when the light lines up with it. Their white is let through only as
     * far as the band allows it, and a band lets pure white through only when its ceiling is 1: on any lower ceiling
     * (every dark board, whatever its inks) 'lighter' white could lift a cell out of the band, so none is drawn. */
    if (stars.length === 0 || band.hi < 1) return;
    if (!sprite) sprite = starSprite(make);
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
  const n = Math.ceil(Math.max(1, Math.round(box.w)) / CELL) * Math.ceil(Math.max(1, Math.round(box.h)) / CELL);
  const px = new Uint8ClampedArray(n * 4);
  foil.render(box, light, band, px);
  const hex = (v: number) => v.toString(16).padStart(2, '0');
  const colors = new Array<string>(n);
  for (let i = 0; i < n; i++) colors[i] = `#${hex(px[i * 4]!)}${hex(px[i * 4 + 1]!)}${hex(px[i * 4 + 2]!)}`;
  return colors;
}

