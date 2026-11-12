/**
 * Whoops!'s painter (refinements plan Task 4; ink-field plan Task 4). jsdom has no canvas, so a 2D context is stubbed two ways: a
 * recorder that logs every call and style set (for what `paint` draws, and how), and a small one that keeps
 * ImageData (for the pixels `paintSplat` writes, which the e2e in Task 9 sees in a real browser).
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { covers, fieldAt, fieldGrid, makeSplat, THRESHOLD, type Box } from './splat.ts';
import { MAX_CANVAS_PX, STAND_IN_WASH, THIN_FLOOR, THIN_SPAN, paint, paintSplat, paintStandIn, shadeField, type PaintLayer, type StandIn } from './paint.ts';
import { denseGrid, makeGrid, splatInto, type Grid, type Rect } from './field.ts';
import fixtureJson from './paint.fixture.json';
import { type Stroke } from './scrub.ts';

const realGetContext = HTMLCanvasElement.prototype.getContext;
afterEach(() => { HTMLCanvasElement.prototype.getContext = realGetContext; });

interface Call { readonly who: string; readonly op: string; readonly args: unknown[]; readonly style: Record<string, unknown> }

/** A recording 2D context: calls are logged with a copy of the styles set when they were made. */
function recording() {
  const calls: Call[] = [];
  const names = new Map<HTMLCanvasElement, string>();
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    if (!names.has(this)) names.set(this, names.size === 0 ? 'main' : 'work');
    const who = names.get(this)!;
    const state: Record<string, unknown> = { canvas: this, globalCompositeOperation: 'source-over', globalAlpha: 1 };
    return new Proxy({}, {
      get: (_t, key: string) => (key in state ? state[key] : (...args: unknown[]) => {
        calls.push({ who, op: key, args, style: { ...state } });
        if (key === 'createRadialGradient' || key === 'createLinearGradient') return { addColorStop() {} };
        return undefined;
      }),
      set: (_t, key: string, value) => { state[key] = value; return true; },
    });
  } as unknown as HTMLCanvasElement['getContext'];
  return calls;
}

const BOX: Box = { w: 400, h: 200 };
const splat = makeSplat(7);
const standIn = (strokes: readonly Stroke[] = []): StandIn => ({ painted: document.createElement('canvas'), color: '#ff2bd6', strokes });
const layer = (alpha = 1): PaintLayer => ({ picture: document.createElement('canvas'), alpha });
const geo = { dpr: 1, box: BOX, top: 0, left: 0 };
const canvasOf = (w = 400, h = 200) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

describe('paint', () => {
  test('draws one picture per live layer, in order, at its alpha, and none for a layer at alpha 0', () => {
    const calls = recording();
    const a = layer(), b = layer(0), c = layer(0.5);
    paint(canvasOf(), geo, [a, b, c]);
    const draws = calls.filter((x) => x.op === 'drawImage');
    expect(draws.map((x) => x.args[0])).toEqual([a.picture, c.picture]);
    expect(draws.map((x) => x.style.globalAlpha)).toEqual([1, 0.5]);
  });

  test('draws each picture scaled to the box, not its own size, and draws no stroke', () => {
    const calls = recording();
    paint(canvasOf(), { dpr: 2, box: BOX, top: 3, left: 5 }, [layer()]);
    expect(calls.find((c) => c.op === 'drawImage')!.args.slice(1)).toEqual([10, 6, 800, 400]);
    expect(calls.filter((c) => c.op === 'stroke' || c.op === 'beginPath')).toHaveLength(0);
  });

  test.each([[0, 200], [400, 0], [Number.NaN, 200], [400, Infinity]])('a box of %s by %s draws nothing', (w, h) => {
    const calls = recording();
    expect(() => paint(canvasOf(), { dpr: 1, box: { w, h }, top: 0, left: 0 }, [layer()])).not.toThrow();
    expect(calls.filter((c) => c.op === 'drawImage')).toHaveLength(0);
    expect(calls.filter((c) => c.op === 'clearRect')).toHaveLength(1);
  });
});

describe('paintStandIn', () => {
  beforeEach(() => { (globalThis as { Path2D?: unknown }).Path2D ??= class {}; });
  const wash: Stroke = { tool: 'wash', width: 0.1, aspect: 2, points: [[0.2, 0.5], [0.4, 0.5]] };
  const pen: Stroke = { tool: 'ink', color: '#19e3ff', width: 0.02, aspect: 2, points: [[0.2, 0.2], [0.4, 0.2]] };

  test('draws a pen stroke and a wash in order: the pen flat in its color, the wash destination-out at STAND_IN_WASH with the blur', () => {
    const calls = recording();
    paintStandIn(standIn([pen, wash]), geo, 400, 200, 0);
    const strokes = calls.filter((c) => c.op === 'stroke');
    expect(strokes).toHaveLength(2);
    expect(strokes[0]!.style.globalCompositeOperation).toBe('source-over');
    expect(strokes[0]!.style.strokeStyle).toBe('#19e3ff');
    expect(strokes[0]!.style.globalAlpha).toBe(1);
    expect(strokes[0]!.style.shadowBlur).toBe(0);
    expect(strokes[1]!.style.globalCompositeOperation).toBe('destination-out');
    expect(strokes[1]!.style.globalAlpha).toBe(STAND_IN_WASH);
    expect(STAND_IN_WASH).toBe(0.5);
    expect(strokes[1]!.style.shadowBlur).toBe(2.5);
  });

  test('a stroke from a box of another aspect is drawn under the transform that makes its brush that ellipse', () => {
    const calls = recording();
    /* Drawn on a 400x200 box (aspect 2); made on a box of aspect 0.5, so across is 0.1 / 2 * 400 = 20 px and down 0.1 / 2 * 0.5 * 200 = 5 px. */
    const s: Stroke = { tool: 'wash', width: 0.1, aspect: 0.5, points: [[0.5, 0.5], [0.6, 0.5]] };
    paintStandIn(standIn([s]), { dpr: 2, box: BOX, top: 3, left: 5 }, 800, 400, 0);
    const i = calls.findIndex((c) => c.op === 'stroke');
    const set = calls.slice(0, i).filter((c) => c.op === 'setTransform').at(-1)!;
    const [a, b, c, d, e, f] = set.args as number[];
    expect([b, c]).toEqual([0, 0]);
    expect(d! / a!).toBeCloseTo(0.5 * 200 / 400, 10);
    expect([e, f]).toEqual([10, 6]);
    const width = calls[i]!.style.lineWidth as number;
    expect(width * a! / 2).toBeCloseTo(20 * 2, 10);
    expect(width * d! / 2).toBeCloseTo(5 * 2, 10);
    const moved = calls.slice(0, i).filter((x) => x.op === 'moveTo')[0]!.args as number[];
    expect(moved[0]! * a! + e!).toBeCloseTo(0.5 * 400 * 2 + 10, 10);
    expect(moved[1]! * d! + f!).toBeCloseTo(0.5 * 200 * 2 + 6, 10);
  });

  test('draws the cached splat scaled to the box first, after a clear, and leaves no shadow or alpha set', () => {
    const calls = recording();
    const picture = paintStandIn(standIn([wash]), { dpr: 2, box: BOX, top: 3, left: 5 }, 800, 400, 0);
    expect(picture.width).toBe(800);
    const ops = calls.map((c) => c.op);
    expect(ops.indexOf('clearRect')).toBeLessThan(ops.indexOf('drawImage'));
    expect(ops.indexOf('drawImage')).toBeLessThan(ops.indexOf('stroke'));
    expect(calls.find((c) => c.op === 'drawImage')!.args.slice(1)).toEqual([10, 6, 800, 400]);
    const last = calls.at(-1)!;
    expect(last.style.shadowBlur).toBe(0);
    expect(last.style.globalAlpha).toBe(1);
  });

  test('a slot is one canvas sized to what is being painted, so a tall canvas after a wide one never grows it past MAX_CANVAS_PX', () => {
    recording();
    for (const [w, h] of [[780, 600], [279, 14307], [988, 4000]] as const) {
      const cv = paintStandIn(standIn(), { dpr: 1, box: { w, h }, top: 0, left: 0 }, w, h, 0);
      expect([cv.width, cv.height]).toEqual([w, h]);
      expect(w * h).toBeLessThanOrEqual(MAX_CANVAS_PX);
    }
  });

  test.each([[0, 200], [Number.NaN, 200]])('a box of %s by %s draws nothing', (w, h) => {
    const calls = recording();
    paintStandIn(standIn([wash]), { dpr: 1, box: { w, h }, top: 0, left: 0 }, 10, 10, 0);
    expect(calls.filter((c) => c.op === 'drawImage' || c.op === 'stroke')).toHaveLength(0);
  });
});

describe('shadeField', () => {
  const fixture = fixtureJson as { box: Box; layers: { color: string; px: number[][] }[] };
  const pixels = (grid: Grid) => ({ width: grid.cols, height: grid.rows, data: new Uint8ClampedArray(grid.cols * grid.rows * 4) });
  const whole = (grid: Grid): Rect => ({ x0: 0, y0: 0, x1: grid.cols, y1: grid.rows });

  /*
   * The fixture is the old paintSplat's real output from Chromium's getImageData (see its "about"). A canvas stores
   * premultiplied 8-bit, so a low-alpha edge pixel comes back with its color rounded by up to ~23 per channel; no
   * straight-alpha comparison can hold within 1 there. What a player sees is the pixel over the post's paper, so both
   * are composited over white and over black and compared within 2 per channel, with alpha within 1.
   */
  const over = (rgb: number, a: number, paper: number) => rgb * (a / 255) + paper * (1 - a / 255);

  test('the splat alone looks as the old paintSplat did in Chromium: over paper within 2 per channel, alpha within 1, at a few hundred pixels a color', () => {
    const grid = denseGrid(fixture.box, 1);
    splatInto(grid, makeSplat(7), fixture.box);
    for (const { color, px } of fixture.layers) {
      const out = pixels(grid);
      shadeField(grid, grid.washed, color, 1, whole(grid), out);
      expect(px.length).toBeGreaterThan(300);
      for (const [x, y, r, g, b, a] of px as [number, number, number, number, number, number][]) {
        const o = (y * grid.cols + x) * 4;
        const ga = out.data[o + 3]!;
        expect(Math.abs(ga - a), `${color} pixel ${x},${y} alpha: ${ga} vs ${a}`).toBeLessThanOrEqual(1);
        [r, g, b].forEach((want, c) => {
          for (const paper of [0, 255]) {
            const d = Math.abs(over(out.data[o + c]!, ga, paper) - over(want, a, paper));
            expect(d, `${color} pixel ${x},${y} channel ${c} over ${paper}: ${out.data[o + c]} a${ga} vs ${want} a${a}`).toBeLessThanOrEqual(2);
          }
        });
      }
    }
  });

  /** A grid of one value along a row, shaded: the pixel at the middle. */
  const plateau = (v: number, washed: 0 | 1) => {
    const grid = makeGrid(9, 9, 1);
    grid.values.fill(v);
    const w = new Uint8Array(81).fill(washed);
    const out = pixels(grid);
    shadeField(grid, w, '#202020', 1, { x0: 0, y0: 0, x1: 9, y1: 9 }, out);
    return out.data[(4 * 9 + 4) * 4 + 3]!;
  };

  test('thinned ink is see-through: a washed point at T + 0.2 has under half the opacity of an unwashed one', () => {
    const v = THRESHOLD + 0.2;
    const plain = plateau(v, 0), thin = plateau(v, 1);
    expect(plain).toBe(255);
    expect(thin).toBeGreaterThan(0);
    expect(thin).toBeLessThan(plain * 0.5);
    expect(thin / 255).toBeCloseTo(THIN_FLOOR + (1 - THIN_FLOOR) * 0.2 / THIN_SPAN, 1);
    expect([THIN_FLOOR, THIN_SPAN]).toEqual([0.35, 1.2]);
  });

  test('a rectangle\'s shading equals the whole\'s, inside the rectangle, and writes nothing past one point beyond it', () => {
    const grid = denseGrid({ w: 120, h: 80 }, 1);
    splatInto(grid, splat, { w: 120, h: 80 });
    /* A wash-like dent and a washed mark, then the whole and a rectangle. */
    for (let y = 30; y < 50; y++) for (let x = 40; x < 70; x++) { grid.values[y * 120 + x]! *= 0.5; grid.washed[y * 120 + x] = 1; }
    const all = pixels(grid), part = pixels(grid);
    shadeField(grid, grid.washed, '#ff2bd6', 1, whole(grid), all);
    const rect: Rect = { x0: 35, y0: 25, x1: 75, y1: 55 };
    shadeField(grid, grid.washed, '#ff2bd6', 1, rect, part);
    let inside = 0;
    for (let y = 0; y < 80; y++) for (let x = 0; x < 120; x++) {
      const o = (y * 120 + x) * 4;
      const grown = x >= rect.x0 - 1 && x < rect.x1 + 1 && y >= rect.y0 - 1 && y < rect.y1 + 1;
      for (let c = 0; c < 4; c++) {
        if (grown) expect(part.data[o + c]).toBe(all.data[o + c]);
        else expect(part.data[o + c]).toBe(0);
      }
      if (grown) inside++;
    }
    expect(inside).toBe(42 * 32);
  });
});

describe('paintSplat', () => {
  /** A context that keeps ImageData, so the pixels written can be read back. */
  function keeping() {
    let image: { data: Uint8ClampedArray; width: number; height: number } | null = null;
    HTMLCanvasElement.prototype.getContext = function () {
      return {
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData: (img: typeof image) => { image = img; },
        createRadialGradient: () => ({ addColorStop() {} }),
        createLinearGradient: () => ({ addColorStop() {} }),
        fillRect() {},
      };
    } as unknown as HTMLCanvasElement['getContext'];
    return () => image!;
  }

  test('is as big as the box at its density, never past 1, and is transparent where the field is far below the threshold', () => {
    const read = keeping();
    const box: Box = { w: 80, h: 50 };
    const cv = paintSplat(splat, '#101010', box, 3);
    expect([cv.width, cv.height]).toEqual([80, 50]);
    const img = read();
    const f = fieldGrid(splat, box, 1);
    let far = 0, inside = 0;
    for (let i = 0; i < f.length; i++) {
      const alpha = img.data[i * 4 + 3]!;
      if (f[i]! < THRESHOLD * 0.4) { far++; expect(alpha).toBe(0); }
      if (f[i]! > THRESHOLD * 2) { inside++; expect(alpha).toBeGreaterThan(127); }
    }
    expect(far).toBeGreaterThan(100);
    expect(inside).toBeGreaterThan(100);
  });

  test('is covered where `covers` says, the edge anti-aliased across one pixel', () => {
    const read = keeping();
    const box: Box = { w: 120, h: 80 };
    paintSplat(splat, '#ff2bd6', box, 1);
    const img = read();
    let checked = 0, partial = 0;
    const grid = fieldGrid(splat, box, 1);
    for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
      const alpha = img.data[(y * box.w + x) * 4 + 3]!;
      const f = grid[y * box.w + x]!;
      if (Math.abs(f - THRESHOLD) < 0.02) { partial += alpha > 0 && alpha < 255 ? 1 : 0; continue; }
      checked++;
      expect(alpha > 127).toBe(covers(splat, box, (x + 0.5) / box.w, (y + 0.5) / box.h));
    }
    expect(checked).toBeGreaterThan(box.w * box.h * 0.9);
    expect(partial).toBeGreaterThan(0);
  });

  test('a very tall box is capped at MAX_CANVAS_PX pixels, whatever the density', () => {
    keeping();
    expect(MAX_CANVAS_PX).toBe(4_000_000);
    const cv = paintSplat(splat, '#101010', { w: 390, h: 20000 }, 1);
    expect(cv.width * cv.height).toBeLessThanOrEqual(MAX_CANVAS_PX);
    expect(cv.width * cv.height).toBeGreaterThan(MAX_CANVAS_PX * 0.9);
  });

  /* Past the cap on a box wider than tall, the canvas is still the field's own grid, so each row of ink lies where the field does. */
  test('a box wider than tall past the cap is painted where `covers` says, row by row', () => {
    const read = keeping();
    const box: Box = { w: 2001, h: 2000 };
    const cv = paintSplat(splat, '#101010', box, 1);
    expect(cv.width * cv.height).toBeLessThanOrEqual(MAX_CANVAS_PX);
    const img = read();
    expect([img.width, img.height]).toEqual([cv.width, cv.height]);
    let checked = 0;
    for (let y = 0; y < cv.height; y += 97) for (let x = 0; x < cv.width; x += 89) {
      const u = (x + 0.5) / cv.width, v = (y + 0.5) / cv.height;
      const f = fieldAt(splat, box, u, v);
      if (f > THRESHOLD * 0.4 && f < THRESHOLD * 2) continue;
      checked++;
      expect(img.data[(y * cv.width + x) * 4 + 3]! > 127, `pixel ${x},${y}`).toBe(f >= THRESHOLD * 2);
    }
    expect(checked).toBeGreaterThan(300);
  });

  test('a dark ink has a lit rim: an edge facing the light is brighter than the ink, the far one darker', () => {
    const read = keeping();
    const box: Box = { w: 200, h: 130 };
    paintSplat(splat, '#202020', box, 1);
    const img = read();
    const lum = (i: number) => img.data[i * 4]!;
    let brightest = 0, darkest = 255;
    for (let i = 0; i < box.w * box.h; i++) if (img.data[i * 4 + 3]! > 0) { brightest = Math.max(brightest, lum(i)); darkest = Math.min(darkest, lum(i)); }
    expect(brightest).toBeGreaterThan(0x20 + 20);
    expect(darkest).toBeLessThan(0x20);
  });
});
