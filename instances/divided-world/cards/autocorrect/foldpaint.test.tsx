import { afterEach, describe, expect, test, vi } from 'vitest';
import { foldEnd } from './fold.ts';
import { makeFaces, paintFold } from './foldpaint.ts';

/** Every canvas made records its path points; the n-th canvas is the n-th made. */
const made: { points: [number, number][] }[] = [];
function stub() {
  made.length = 0;
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const rec = { points: [] as [number, number][] };
    made.push(rec);
    const ctx = new Proxy({} as Record<string | symbol, unknown>, {
      get: (t, k) => (k === 'moveTo' || k === 'lineTo' ? (x: number, y: number) => { rec.points.push([x, y]); } : k === 'createLinearGradient' ? () => ({ addColorStop: () => {} }) : k in t ? t[k] : () => {}),
      set: (t, k, v) => { t[k] = v; return true; },
    });
    return { tagName: tag, width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  }) as never);
}
afterEach(() => { vi.restoreAllMocks(); });

const W = 90, H = 24, SEED = 'play:1:0';
const spec = { w: W, h: H, seed: SEED, words: 'Luigi', fontPx: 20, pad: 8, dpr: 1 };
const paint = (side: 'a' | 'b', at: number, stuck: number[][], t = 0.6) => {
  stub();
  const faces = makeFaces(spec)!;
  const cv = document.createElement('canvas');
  made.length = 0;
  expect(paintFold(cv, faces, { w: W, h: H, side, at, t, stuck, dpr: 1 })).toBe(true);
  /* paintFold makes the scratch the fold is laid on first, then the sticky side. */
  return made[1]!.points;
};

describe('the fold comes from the end that was picked', () => {
  test('the right end folds with its own jag, not the left end\'s', () => {
    const points = paint('b', W, [[0, W, 0]]);
    const end = foldEnd('b', W, 0, W, H, SEED);
    expect(points.slice(0, end.length).map(([u]) => u)).toEqual(end.map(([u]) => u));
    expect(end.map(([u]) => u)).not.toEqual(foldEnd('a', 0, 0, W, H, SEED).map(([u]) => u));
  });

  test('a pick at a torn edge inside the piece folds with the torn outline, and at a peel line with a straight cut', () => {
    const torn = paint('a', 40, [[40, W, 2 * 3 + 0]]);
    const tear = foldEnd('a', 40, 6, W, H, SEED);
    expect(tear.length).toBeGreaterThan(4);
    expect(torn.slice(0, tear.length).map(([u]) => u)).toEqual(tear.map(([u]) => u));
    const cut = paint('a', 40, [[40, W, 1 * 3 + 0]]);
    expect(cut.slice(0, 2)).toEqual([[0, 0], [0, H]]);
  });
});
