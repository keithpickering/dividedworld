/**
 * Whoops!'s painter (refinements plan Task 4). jsdom has no canvas, so a 2D context is stubbed two ways: a
 * recorder that logs every call and style set (for what `paint` draws, and how), and a small one that keeps
 * ImageData (for the pixels `paintSplat` writes, which the e2e in Task 9 sees in a real browser).
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { covers, fieldGrid, makeSplat, THRESHOLD, type Box } from './splat.ts';
import { paint, paintSplat, type PaintLayer } from './paint.ts';
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
const layer = (strokes: readonly Stroke[] = [], alpha = 1): PaintLayer => ({ painted: document.createElement('canvas'), color: '#ff2bd6', strokes, alpha });
const geo = { dpr: 1, box: BOX, top: 0, left: 0 };
const canvasOf = () => { const c = document.createElement('canvas'); c.width = 400; c.height = 200; return c; };

describe('paint', () => {
  beforeEach(() => { (globalThis as { Path2D?: unknown }).Path2D ??= class {}; });

  test('draws one image per live layer onto the ink canvas, and none for a layer at alpha 0', () => {
    const calls = recording();
    paint(canvasOf(), geo, [layer(), layer([], 0), layer([], 0.5)]);
    const main = calls.filter((c) => c.who === 'main' && c.op === 'drawImage');
    expect(main).toHaveLength(2);
    expect(main.map((c) => c.style.globalAlpha)).toEqual([1, 0.5]);
  });

  test('a wash is drawn destination-out, a pen source-over in its own color', () => {
    const calls = recording();
    const wash: Stroke = { tool: 'wash', width: 0.1, aspect: 2, points: [[0.2, 0.5], [0.4, 0.5]] };
    const pen: Stroke = { tool: 'ink', color: '#19e3ff', width: 0.02, aspect: 2, points: [[0.2, 0.2], [0.4, 0.2]] };
    paint(canvasOf(), geo, [layer([wash, pen])]);
    const strokes = calls.filter((c) => c.op === 'stroke');
    expect(strokes.map((c) => c.who)).toEqual(['work', 'work']);
    expect(strokes[0]!.style.globalCompositeOperation).toBe('destination-out');
    expect(strokes[0]!.style.shadowBlur).toBe(2.5);
    expect(strokes[1]!.style.globalCompositeOperation).toBe('source-over');
    expect(strokes[1]!.style.strokeStyle).toBe('#19e3ff');
    expect(strokes[1]!.style.shadowBlur).toBe(0);
  });

  test('a stroke from a box of another aspect is drawn under the transform that makes its brush that ellipse', () => {
    const calls = recording();
    /* Drawn on a 400x200 box (aspect 2); made on a box of aspect 0.5, so across is 0.1 / 2 * 400 = 20 px and down 0.1 / 2 * 0.5 * 200 = 5 px. */
    const s: Stroke = { tool: 'wash', width: 0.1, aspect: 0.5, points: [[0.5, 0.5], [0.6, 0.5]] };
    paint(canvasOf(), { dpr: 2, box: BOX, top: 3, left: 5 }, [layer([s])]);
    const i = calls.findIndex((c) => c.op === 'stroke');
    const set = calls.slice(0, i).filter((c) => c.who === 'work' && c.op === 'setTransform').at(-1)!;
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

  test('draws the painted splat scaled to the box, not the splat\'s own size', () => {
    const calls = recording();
    paint(canvasOf(), { dpr: 2, box: BOX, top: 3, left: 5 }, [layer()]);
    const d = calls.find((c) => c.who === 'work' && c.op === 'drawImage')!;
    expect(d.args.slice(1)).toEqual([10, 6, 800, 400]);
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
    for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
      const alpha = img.data[(y * box.w + x) * 4 + 3]!;
      const f = fieldGrid(splat, box, 1)[y * box.w + x]!;
      if (Math.abs(f - THRESHOLD) < 0.02) { partial += alpha > 0 && alpha < 255 ? 1 : 0; continue; }
      checked++;
      expect(alpha > 127).toBe(covers(splat, box, (x + 0.5) / box.w, (y + 0.5) / box.h));
    }
    expect(checked).toBeGreaterThan(box.w * box.h * 0.9);
    expect(partial).toBeGreaterThan(0);
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
