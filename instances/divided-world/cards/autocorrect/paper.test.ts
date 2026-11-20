import { describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { ratio } from '../../../../engine/ui/contrast.ts';
import { PAPER, crepeLines, drawPaper, drawUnderside, endJags, type PaperContext } from './paper.ts';

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

describe('the tape\'s sticky side', () => {
  const underOf = (w: number, h: number, seed: string) => { const { ctx, log } = recorder(); drawUnderside(ctx, w, h, seed); return log; };

  test('it draws no fibers and no factory edges, and fills only within the tape\'s outline', () => {
    const under = underOf(120, 22, 'play:1:0'), top = record(120, 22, 'play:1:0');
    const fibers = (log: string[]) => log.filter((l) => /^fillRect [\d.]+,[\d.]+,[\d.]+,0\.4000$/u.test(l)).length;
    assert.ok(fibers(top) > 50, `the paper itself draws ${fibers(top)} fibers`);
    assert.equal(fibers(under), 0);
    assert.equal(under.filter((l) => l.includes('rgb(140 110 52 / .28)')).length, 0);
    assert.equal(under.filter((l) => l.includes('rgb(236 226 196 / .9)')).length, 0, 'no loose fibers outside the outline');
    /* Every fill comes after the outline is clipped and before it is restored. */
    const clip = under.indexOf('clip '), restore = under.lastIndexOf('restore ');
    assert.ok(clip > 0 && restore > clip);
    for (let i = 0; i < under.length; i++) if (under[i]!.startsWith('fillRect')) assert.ok(i > clip && i < restore, `fillRect at ${i} is outside the clip`);
  });

  test('it is paler and its crepe is fainter than the paper\'s', () => {
    const lightness = (log: string[]) => log.filter((l) => l.includes('.addColorStop') && l.includes('hsl(')).map((l) => Number(/ (\d+(?:\.\d+)?)%\)$/u.exec(l)![1]));
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const u = underOf(120, 22, 's'), t = record(120, 22, 's');
    assert.ok(mean(lightness(u)) > 85 && mean(lightness(t)) < 82, `${mean(lightness(u))} vs ${mean(lightness(t))}`);
    const alphas = (log: string[]) => log.filter((l) => l.startsWith('strokeStyle = rgb(')).map((l) => Number(/ \/ ([\d.]+)\)$/u.exec(l)![1]));
    assert.ok(Math.max(...alphas(u)) < Math.max(...alphas(t)));
  });

  test('one seed draws it the same twice, and it shares the paper\'s outline', () => {
    assert.deepEqual(underOf(100, 20, 'k'), underOf(100, 20, 'k'));
    const first = (log: string[]) => log.find((l) => l.startsWith('moveTo '));
    assert.equal(first(underOf(100, 20, 'k')), first(record(100, 20, 'k')));
  });
});
