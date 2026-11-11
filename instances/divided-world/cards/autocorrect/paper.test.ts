import { describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { ratio } from '../../../../engine/ui/contrast.ts';
import { PAPER, crepeLines, drawPaper, endJags, type PaperContext } from './paper.ts';

/** A context that writes down every call and every assignment, in order. */
function recorder(): { ctx: PaperContext; log: string[] } {
  const log: string[] = [];
  const stop = (s: string) => `gradient(${s})`;
  const target = {
    createLinearGradient: (...a: number[]) => {
      const id = stop(a.join(','));
      log.push(`createLinearGradient ${a.join(',')}`);
      return { addColorStop: (o: number, col: string) => log.push(`${id}.addColorStop ${o} ${col}`) };
    },
  } as Record<string, unknown>;
  const ctx = new Proxy(target, {
    get: (t, k: string) => t[k] ?? ((...a: unknown[]) => { log.push(`${k} ${a.map((x) => (typeof x === 'number' ? x.toFixed(4) : String(x))).join(',')}`); }),
    set: (_t, k: string, v) => { log.push(`${k} = ${typeof v === 'object' ? 'gradient' : String(v)}`); return true; },
  }) as unknown as PaperContext;
  return { ctx, log };
}
const record = (w: number, h: number, seed: string) => { const { ctx, log } = recorder(); drawPaper(ctx, w, h, seed); return log; };

describe('the tape paper', () => {
  test('one seed records the same drawing twice, and two seeds record different ones', () => {
    const a = record(120, 22, 'play:1:0'), b = record(120, 22, 'play:1:0'), c = record(120, 22, 'play:2:0');
    assert.ok(a.length > 100, `only ${a.length} calls were recorded`);
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
  });

  test('nothing reads Math.random', () => {
    const spy = mock.method(Math, 'random', () => { throw new Error('Math.random was read'); });
    try {
      record(90, 20, 'k');
      endJags('k', 90, 20);
      crepeLines('k', 90);
      assert.equal(spy.mock.callCount(), 0);
    } finally {
      spy.mock.restore();
    }
  });

  test('the ends and the crepe the residue shares come from the strip alone', () => {
    assert.deepEqual(endJags('s', 80, 20), endJags('s', 80, 20));
    assert.notDeepEqual(endJags('s', 80, 20), endJags('t', 80, 20));
    assert.deepEqual(crepeLines('s', 80), crepeLines('s', 80));
    const { left, right } = endJags('s', 80, 20);
    assert.ok(left.every(([x]) => x >= 0 && x <= 4.1) && right.every(([x]) => x <= 80 && x >= 75.9));
  });

  test('the marker ink holds 7:1 on the paper', () => {
    assert.ok(ratio(PAPER.ink, PAPER.base) >= 7, `${ratio(PAPER.ink, PAPER.base).toFixed(2)}:1`);
  });
});
