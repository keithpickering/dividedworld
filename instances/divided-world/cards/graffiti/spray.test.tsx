/**
 * Graffiti's spray painter (plan Task 8). jsdom has no canvas, so a 2D context is faked as a small pixel buffer: it rasterizes what spray.ts
 * uses (round-capped polylines and circles under a scale-and-shift transform, drawImage of a sprite, putImageData) with source-over and
 * destination-out, so a test reads the ink's alpha at a pixel, and it logs every arc, so the speckle can be compared between calls.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { CAPS } from '../graffiti.ts';
import { hitAt, paintWall, wallDensity, type WallAct } from './spray.ts';
import { MAX_CANVAS_PX } from '../whoops/paint.ts';

const realGetContext = HTMLCanvasElement.prototype.getContext;
afterEach(() => { HTMLCanvasElement.prototype.getContext = realGetContext; });

interface Arc { readonly x: number; readonly y: number; readonly r: number; readonly alpha: number }
interface Px { a: number; r: number; g: number; b: number }
const rgb = (s: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];

const buffers = new WeakMap<HTMLCanvasElement, () => Px[]>();
/** One pixel-buffer context per canvas; `arcs` collects every arc a fill drew, in user space and with the alpha it was filled at. */
function fakeCanvases() {
  const arcs: Arc[] = [];
  const strokes: { alpha: number; width: number; op: string }[] = [];
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    const cv = this;
    const px = (): Px[] => {
      const n = cv.width * cv.height;
      const p = ((cv as unknown as { _px?: Px[] })._px ??= []);
      if (p.length !== n) { p.length = 0; for (let i = 0; i < n; i++) p.push({ a: 0, r: 0, g: 0, b: 0 }); }
      return p;
    };
    buffers.set(cv, px);
    const self = cv as unknown as { _ctx?: unknown };
    if (self._ctx) return self._ctx;
    let T = [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number];
    type Shape = { kind: 'line'; pts: [number, number][] } | { kind: 'circle'; x: number; y: number; r: number };
    let path: Shape[] = [];
    const put = (i: number, c: [number, number, number], sa: number, op: string) => {
      const d = px()[i]!;
      if (op === 'destination-out') { d.a *= 1 - sa; return; }
      const a = sa + d.a * (1 - sa);
      if (a <= 0) return;
      d.r = (c[0] * sa + d.r * d.a * (1 - sa)) / a; d.g = (c[1] * sa + d.g * d.a * (1 - sa)) / a; d.b = (c[2] * sa + d.b * d.a * (1 - sa)) / a; d.a = a;
    };
    const user = (i: number): [number, number] => [((i % cv.width) + 0.5 - T[4]) / T[0], (Math.floor(i / cv.width) + 0.5 - T[5]) / T[3]];
    const segDist = (p: [number, number], a: [number, number], b: [number, number]) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    /** The device pixel indexes a user-space box (grown by `pad`) can touch. */
    const near = (pad: number): number[] => {
      const all = path.flatMap((sh) => (sh.kind === 'line' ? sh.pts : [[sh.x, sh.y]])) as [number, number][];
      const x0 = Math.max(0, Math.floor(Math.min(...all.map((p) => p[0] * T[0] + T[4] - pad * T[0])))), x1 = Math.min(cv.width - 1, Math.ceil(Math.max(...all.map((p) => p[0] * T[0] + T[4] + pad * T[0]))));
      const y0 = Math.max(0, Math.floor(Math.min(...all.map((p) => p[1] * T[3] + T[5] - pad * T[3])))), y1 = Math.min(cv.height - 1, Math.ceil(Math.max(...all.map((p) => p[1] * T[3] + T[5] + pad * T[3]))));
      const out: number[] = [];
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(y * cv.width + x);
      return out;
    };
    const ctx: Record<string, unknown> = {
      canvas: cv, globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter',
      setTransform(a: number, b: number, c: number, d: number, e: number, f: number) { T = [a, 0, 0, d, e, f]; },
      clearRect() { for (const p of px()) p.a = 0; },
      beginPath() { path = []; },
      moveTo(x: number, y: number) { path.push({ kind: 'line', pts: [[x, y]] }); },
      lineTo(x: number, y: number) { (path.at(-1) as { pts: [number, number][] }).pts.push([x, y]); },
      arc(x: number, y: number, r: number) { path.push({ kind: 'circle', x, y, r }); arcs.push({ x, y, r, alpha: ctx.globalAlpha as number }); },
      stroke() {
        const c = rgb(ctx.strokeStyle as string), half = (ctx.lineWidth as number) / 2;
        strokes.push({ alpha: ctx.globalAlpha as number, width: ctx.lineWidth as number, op: ctx.globalCompositeOperation as string });
        for (const i of near(half + 1)) {
          const u = user(i);
          for (const s of path) if (s.kind === 'line' && s.pts.some((_, k) => segDist(u, s.pts[k]!, s.pts[Math.min(k + 1, s.pts.length - 1)]!) <= half)) { put(i, c, ctx.globalAlpha as number, ctx.globalCompositeOperation as string); break; }
        }
      },
      fill() {
        const c = rgb(ctx.fillStyle as string);
        for (const i of near(Math.max(...path.map((sh) => (sh.kind === 'circle' ? sh.r : 0))) + 1)) {
          const u = user(i);
          if (path.some((s) => s.kind === 'circle' && Math.hypot(u[0] - s.x, u[1] - s.y) <= s.r)) put(i, c, ctx.globalAlpha as number, ctx.globalCompositeOperation as string);
        }
      },
      createImageData(w: number, h: number) { return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; },
      putImageData(img: { width: number; height: number; data: Uint8ClampedArray }) {
        const p = px();
        for (let i = 0; i < img.width * img.height; i++) Object.assign(p[i]!, { r: img.data[i * 4]!, g: img.data[i * 4 + 1]!, b: img.data[i * 4 + 2]!, a: img.data[i * 4 + 3]! / 255 });
      },
      drawImage(src: HTMLCanvasElement, dx: number, dy: number, dw: number, dh: number) {
        const sp = buffers.get(src)!();
        const xs = [dx * T[0] + T[4], (dx + dw) * T[0] + T[4]], ys = [dy * T[3] + T[5], (dy + dh) * T[3] + T[5]];
        const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(cv.width - 1, Math.ceil(Math.max(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(cv.height - 1, Math.ceil(Math.max(...ys)));
        for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
          const i = yy * cv.width + xx;
          const [ux, uy] = user(i);
          const fx = (ux - dx) / dw, fy = (uy - dy) / dh;
          if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) continue;
          const s = sp[Math.floor(fy * src.height) * src.width + Math.floor(fx * src.width)]!;
          if (s.a > 0) put(i, [s.r, s.g, s.b], s.a * (ctx.globalAlpha as number), ctx.globalCompositeOperation as string);
        }
      },
    };
    self._ctx = ctx;
    return ctx;
  } as unknown as HTMLCanvasElement['getContext'];
  return { arcs, strokes, pixels: (cv: HTMLCanvasElement) => buffers.get(cv)!() };
}

const BOX = { w: 400, h: 200 };
const stroke = (points: [number, number][], cap: keyof typeof CAPS = 'stock', can = 'red', aspect = 2) => ({ can, cap, aspect, points });
const draw = (...strokes: ReturnType<typeof stroke>[]): WallAct => ({ kind: 'draw', payload: { strokes } });
const wash = (points: [number, number][], aspect = 2): WallAct => ({ kind: 'wash', payload: { strokes: [{ aspect, points }] } });
const canvasOf = () => { const c = document.createElement('canvas'); c.width = BOX.w; c.height = BOX.h; return c; };
/** The wall painted on a fresh canvas at density 1: its pixels, and the arcs drawn. */
function paintOn(acts: readonly WallAct[], box = BOX) {
  const f = fakeCanvases();
  const c = canvasOf();
  c.width = box.w; c.height = box.h;
  paintWall(c.getContext('2d') as CanvasRenderingContext2D, box, 1, acts);
  const p = f.pixels(c);
  return { alpha: (x: number, y: number) => p[y * box.w + x]!.a, px: p, arcs: f.arcs, strokes: f.strokes };
}

describe('paintWall', () => {
  beforeEach(() => {});

  test('the core is the can\'s color at alpha 0.92, a capsule of the cap\'s width', () => {
    const w = paintOn([draw(stroke([[0.25, 0.5], [0.75, 0.5]], 'fat'))]);
    /* Fat: 0.04 across the 400 px box is 16 px wide, so 8 px from the line; down, 8 px * aspect 2 on a box 200 tall / 400 wide, which is 8 px too at aspect 2. */
    const core = w.strokes.filter((s) => s.op === 'source-over');
    expect(core).toEqual([{ alpha: 0.92, width: 16, op: 'source-over' }]);
    /* The core over the overspray's 0.35 is nearly opaque, and in the can's red. */
    expect(w.alpha(200, 100)).toBeGreaterThanOrEqual(0.92);
    expect(w.px[100 * 400 + 200]!.r).toBeGreaterThan(200);
    expect(w.px[100 * 400 + 200]!.g).toBeLessThan(60);
    expect(w.alpha(200, 100 - 7)).toBeGreaterThanOrEqual(0.92);
  });

  test('the speckle of one stroke is the same on two calls, and differs for a stroke that moved', () => {
    const base = (dx: number) => stroke([[0.2 + dx, 0.3], [0.5 + dx, 0.35], [0.6 + dx, 0.5]], 'fat');
    const speck = (dx: number) => paintOn([draw(base(dx))]).arcs.filter((a) => a.r < 1);
    const a = speck(0), b = speck(0), c = speck(0.1);
    expect(a.length).toBeGreaterThan(10);
    expect(b).toEqual(a);
    const rel = (s: Arc[], dx: number) => s.map((d) => [Math.round((d.x - dx * 400) * 1000), Math.round(d.y * 1000)]);
    expect(rel(c, 0.1)).not.toEqual(rel(a, 0));
    for (const d of a) { expect(d.r).toBeGreaterThanOrEqual(0.3); expect(d.r).toBeLessThanOrEqual(0.8); expect(d.alpha).toBe(0.5); }
  });

  test('speckle lies beyond the overspray and its count grows with the path\'s length and the cap\'s width', () => {
    const count = (cap: keyof typeof CAPS, x1: number) => paintOn([draw(stroke([[0.1, 0.5], [x1, 0.5]], cap))]).arcs.filter((a) => a.r < 1).length;
    expect(count('fat', 0.9)).toBeGreaterThan(count('fat', 0.4));
    expect(count('fat', 0.9)).toBeGreaterThan(count('skinny', 0.9));
    const rw = (CAPS.fat / 2) * BOX.w;
    for (const d of paintOn([draw(stroke([[0.1, 0.5], [0.9, 0.5]], 'fat'))]).arcs.filter((a) => a.r < 1)) {
      const ex = Math.max(0, Math.max(0.1 * 400 - d.x, d.x - 0.9 * 400));
      expect(Math.hypot(ex, d.y - 100)).toBeGreaterThanOrEqual(1.9 * rw - 1e-6);
    }
  });

  test('a Fat cap\'s overspray reaches farther than a Skinny cap\'s', () => {
    const reach = (cap: keyof typeof CAPS) => {
      const w = paintOn([draw(stroke([[0.3, 0.5], [0.7, 0.5]], cap))]);
      let n = 0;
      for (let y = 100; y < 200; y++) if (w.alpha(200, y) > 0) n = y - 100;
      return n;
    };
    expect(reach('fat')).toBeGreaterThan(reach('skinny') + 8);
    expect(reach('fat')).toBeLessThanOrEqual(Math.ceil(1.9 * 8) + 1);
  });

  test('where points lie closer than a third of the core\'s radius, a second core stamp is laid at alpha 0.2', () => {
    const rw = (CAPS.fat / 2) * BOX.w;
    const tight = paintOn([draw(stroke([[0.5, 0.5], [0.5 + (rw / 5) / 400, 0.5]], 'fat'))]);
    const loose = paintOn([draw(stroke([[0.5, 0.5], [0.5 + (rw * 2) / 400, 0.5]], 'fat'))]);
    expect(tight.arcs.filter((a) => a.alpha === 0.2)).toHaveLength(1);
    expect(loose.arcs.filter((a) => a.alpha === 0.2)).toHaveLength(0);
  });

  test('a wash clears the core pixels of a draw before it, and a draw after the wash is intact', () => {
    const line = (y: number) => stroke([[0.2, y], [0.8, y]], 'fat');
    const w = paintOn([draw(line(0.3)), draw(line(0.7)), wash([[0.5, 0.2], [0.5, 0.5]]), draw(line(0.5))]);
    /* The wash (sponge 0.06 of 400 px = 24 px wide) crosses the first line at x = 200, y = 60. */
    expect(w.alpha(200, 60)).toBeLessThan(0.05);
    expect(w.alpha(150, 60)).toBeGreaterThanOrEqual(0.92);
    expect(w.alpha(200, 140)).toBeGreaterThanOrEqual(0.92);
    /* The third line is drawn after the wash, where the wash ran to its end (y = 100): untouched. */
    expect(w.alpha(200, 100)).toBeGreaterThanOrEqual(0.92);
  });

  test('a wash in the same paint cuts only what was drawn before it, in order, onto one layer', () => {
    const w = paintOn([wash([[0.5, 0.5]]), draw(stroke([[0.4, 0.5], [0.6, 0.5]], 'fat'))]);
    expect(w.alpha(200, 100)).toBeGreaterThanOrEqual(0.92);
  });
});

describe('wallDensity', () => {
  test('is the density up to MAX_DPR, lowered so the canvas stays within MAX_CANVAS_PX', () => {
    expect(wallDensity({ w: 400, h: 200 }, 1.5)).toBe(1.5);
    expect(wallDensity({ w: 400, h: 200 }, 5)).toBe(2);
    const big = { w: 3000, h: 3000 };
    const q = wallDensity(big, 2);
    expect(Math.ceil(big.w * q) * Math.ceil(big.h * q)).toBeLessThanOrEqual(MAX_CANVAS_PX);
  });
});

describe('hitAt', () => {
  const acts = [draw(stroke([[0.3, 0.5], [0.7, 0.5]], 'fat'))];
  test('is true on a core and false on overspray alone, or on bare wall', () => {
    expect(hitAt(acts, BOX, 200, 100)).toBe(true);
    expect(hitAt(acts, BOX, 200, 100 + 7)).toBe(true);
    expect(hitAt(acts, BOX, 200, 100 + 12)).toBe(false);
    expect(paintOn(acts).alpha(200, 112)).toBeGreaterThan(0);
    expect(hitAt(acts, BOX, 20, 20)).toBe(false);
  });
  test('is false where a later wash cut the core, true again under a draw after it', () => {
    const w = wash([[0.5, 0.4], [0.5, 0.6]]);
    expect(hitAt([...acts, w], BOX, 200, 100)).toBe(false);
    expect(hitAt([...acts, w], BOX, 120, 100)).toBe(true);
    expect(hitAt([...acts, w, draw(stroke([[0.45, 0.5], [0.55, 0.5]], 'fat'))], BOX, 200, 100)).toBe(true);
  });
});
