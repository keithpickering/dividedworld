import { afterEach, describe, expect, test, vi } from 'vitest';
import { foldEnd } from './fold.ts';
import { endJags, tearJag } from './paper.ts';
import { facesKey, makeFaces, paintFold } from './foldpaint.ts';

/** Every canvas made records its path points; the n-th canvas is the n-th made. */
const made: { points: [number, number][] }[] = [];
function stub(noContext = false) {
  made.length = 0;
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const rec = { points: [] as [number, number][] };
    made.push(rec);
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (t, k) => (k === 'moveTo' || k === 'lineTo' ? (x: number, y: number) => { rec.points.push([x, y]); } : k === 'createLinearGradient' ? () => ({ addColorStop: () => {} }) : k in t ? t[k] : () => {}),
      set: (t, k, v) => { t[k] = v; return true; },
    });
    return { tagName: tag, width: 0, height: 0, getContext: () => (noContext ? null : ctx) } as unknown as HTMLCanvasElement;
  }) as never);
}
afterEach(() => { vi.restoreAllMocks(); });

const W = 90, H = 24, SEED = 'play:1:0';
const spec = { w: W, h: H, seed: SEED, words: 'Luigi', fontPx: 20, pad: 8, dpr: 1, font: true };
const paint = (side: 'a' | 'b', at: number, stuck: number[][], t = 0.6) => {
  stub();
  const faces = makeFaces(spec)!;
  const cv = document.createElement('canvas');
  made.length = 0;
  expect(paintFold(cv, faces, { w: W, h: H, side, at, t, stuck, dpr: 1 })).toBe(true);
  /* The scratch is made with the faces; a paint makes the sticky side, the first canvas it makes. */
  return made[0]!.points;
};

describe('the fold comes from the end that was picked', () => {
  test('the right end folds with its own jag, not the left end\'s', () => {
    const points = paint('b', W, [[0, W, 0]]);
    const end = foldEnd('b', W, 0, W, H, SEED);
    expect(points.slice(0, end.length).map(([u]) => u)).toEqual(end.map(([u]) => u));
    expect(end.map(([u]) => u)).toEqual(endJags(SEED, W, H).right.map(([x]) => W - x));
    expect(end.map(([u]) => u)).not.toEqual(foldEnd('a', 0, 0, W, H, SEED).map(([u]) => u));
  });

  test('a pick at a torn edge inside the piece folds with the torn outline, and at a peel line with a straight cut', () => {
    const torn = paint('a', 40, [[40, W, 2 * 3 + 0]]);
    const tear = foldEnd('a', 40, 6, W, H, SEED);
    expect(tear.length).toBeGreaterThan(4);
    expect(torn.slice(0, tear.length).map(([u]) => u)).toEqual(tear.map(([u]) => u));
    expect(tear).toEqual(tearJag(SEED, 40, H).map(([x, y]) => [x - 40, y]));
    const cut = paint('a', 40, [[40, W, 1 * 3 + 0]]);
    expect(cut.slice(0, 2)).toEqual([[0, 0], [0, H]]);
  });
});

describe('a frame of the pick makes no canvas', () => {
  const frame = (faces: NonNullable<ReturnType<typeof makeFaces>>, cv: HTMLCanvasElement, t: number, side: 'a' | 'b' = 'a') =>
    paintFold(cv, faces, { w: W, h: H, side, at: side === 'a' ? 0 : W, t, stuck: [[0, W, 0]], dpr: 1 });

  test('across frames of one pick the number of canvases made stays what the first frame left it at', () => {
    stub();
    const faces = makeFaces(spec)!;
    const cv = document.createElement('canvas');
    expect(frame(faces, cv, 0.1)).toBe(true);
    const after = made.length;
    for (const t of [0.2, 0.35, 0.5, 0.7, 0.9, 1]) expect(frame(faces, cv, t)).toBe(true);
    expect(made.length).toBe(after);
  });

  test('the sticky side is made again when the picked end changes, and kept while it does not', () => {
    stub();
    const faces = makeFaces(spec)!;
    const cv = document.createElement('canvas');
    frame(faces, cv, 0.3, 'a');
    const left = faces.under;
    const keyA = faces.underKey;
    frame(faces, cv, 0.5, 'a');
    expect(faces.under).toBe(left);
    frame(faces, cv, 0.5, 'b');
    expect(faces.under).not.toBe(left);
    expect(faces.underKey).not.toBe(keyA);
    expect(faces.underKey.startsWith('b:')).toBe(true);
    const right = faces.under;
    frame(faces, cv, 0.6, 'b');
    expect(faces.under).toBe(right);
    frame(faces, cv, 0.6, 'a');
    expect(faces.under).not.toBe(right);
    expect(faces.underKey).toBe(keyA);
  });
});

describe('where a canvas cannot be had', () => {
  test('makeFaces gives null with no 2D context', () => {
    stub(true);
    expect(makeFaces(spec)).toBeNull();
  });

  test('paintFold gives false with no 2D context on the canvas it is given', () => {
    stub();
    const faces = makeFaces(spec)!;
    stub(true);
    expect(paintFold(document.createElement('canvas'), faces, { w: W, h: H, side: 'a', at: 0, t: 0.5, stuck: [[0, W, 0]], dpr: 1 })).toBe(false);
  });

  test('faces made before the marker\'s font arrived are not the faces made after', () => {
    expect(facesKey({ ...spec, font: false })).not.toBe(facesKey(spec));
  });
});
