import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { tokensOf } from '../contrast.ts';
import { bandOf, shineIsReadable } from './band.ts';
import { burst, burstProbe, drawBurst, makeFlakes, MAX_IN_FLIGHT, sampleFlakes, stepBurst, type Flakes } from './flakes.ts';

/* The bench's GLITTER inks (docs/research/2026-11-06-shine-bench/01-bench.html): seven rainbow inks, then silver for the
   holographic flakes from index 7. They are the reference inks for these tests, copied as literals. */
const GLITTER = ['#ff3b4a', '#ff9a2e', '#ffd23f', '#3ddc6b', '#2fd6ff', '#4a6bff', '#b65cff', '#dfe4ec', '#dfe4ec', '#dfe4ec'];
const HOLO = 7;
const BOX = { w: 988, h: 300 };
const make = (seed = 'p1', box = BOX): Flakes => makeFlakes({ seed, box, inks: GLITTER, holo: HOLO, density: 70 });

const tokens = tokensOf(readFileSync(join(process.cwd(), 'engine/ui/tokens.css'), 'utf8'));
const bands = { light: bandOf(tokens.light), dark: bandOf(tokens.dark) };

/* No DOM under node: just enough of one for `motionReduced`. */
let motion: 'full' | 'reduce' = 'full';
const g = globalThis as unknown as { document?: unknown };
beforeEach(() => {
  motion = 'full';
  burstProbe.reset();
  g.document = { documentElement: { getAttribute: () => motion }, defaultView: null };
});
afterEach(() => { delete g.document; });

/** A context that records what a draw does. */
function recorder() {
  const calls: string[] = [];
  const alphas: number[] = [];
  const styles = new Set<string>();
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k: string) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : (...a: unknown[]) => { calls.push(k); void a; }),
    set: (_t, k: string, v) => { if (k === 'globalAlpha') alphas.push(v as number); if (k === 'fillStyle') styles.add(String(v)); return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, alphas, styles, count: (k: string) => calls.filter((c) => c === k).length };
}

const all = (f: Flakes) => [...f.settled];
function landEverything(f: Flakes, from = 0, step = 16): number {
  let t = from;
  burst(f, t);
  while (stepBurst(f, t) && t - from < 10000) t += step;
  return t - from;
}

describe('flakes', () => {
  test('the same seed gives the same flakes, and nothing reads Math.random', () => {
    const real = Math.random;
    Math.random = () => { throw new Error('Math.random was read'); };
    try {
      const a = make('same'), b = make('same'), c = make('other');
      assert.deepEqual(a.origin, b.origin);
      assert.deepEqual(all(a).map(({ pal: _p, ...f }) => f), all(b).map(({ pal: _p, ...f }) => f));
      assert.notDeepEqual(a.origin, c.origin);
      landEverything(a); landEverything(b);
      assert.deepEqual(a.settled.map((f) => [f.x, f.y]), b.settled.map((f) => [f.x, f.y]));
    } finally { Math.random = real; }
  });

  test('about one flake per 70 square px, and 4,234 on a 988 by 300 post', () => {
    const f = make();
    assert.ok(Math.abs(f.total - 4234) <= 4234 * 0.05, `${f.total} flakes`);
    for (const [w, h] of [[400, 200], [1200, 90]] as const) {
      const n = make('d', { w, h }).total;
      assert.ok(Math.abs(n - (w * h) / 70) <= (w * h) / 70 * 0.05, `${w}x${h}: ${n}`);
    }
  });

  test('a post shows 15% of its flakes before its burst, all inside the box', () => {
    const f = make();
    assert.ok(Math.abs(f.settled.length / f.total - 0.15) < 0.01);
    landEverything(f);
    for (const k of f.settled) assert.ok(k.x >= 0 && k.x <= BOX.w && k.y >= 0 && k.y <= BOX.h);
  });

  test('about three in ten of the bench inks are holographic, and one in eight twinkles', () => {
    const f = make();
    landEverything(f);
    const holo = f.settled.filter((k) => k.ink >= HOLO).length / f.total;
    assert.ok(Math.abs(holo - 0.3) < 0.03, `holo share ${holo}`);
    const tw = f.settled.filter((k) => k.tw > 0).length / f.total;
    assert.ok(Math.abs(tw - 0.125) < 0.02, `twinkle share ${tw}`);
  });

  test('thickest around the burst point', () => {
    const f = make();
    landEverything(f);
    const near = f.settled.filter((k) => Math.hypot(k.x - f.origin.x, k.y - f.origin.y) < 100).length;
    const area = Math.PI * 100 * 100, mean = f.total / (BOX.w * BOX.h);
    assert.ok(near / area > mean * 1.5, 'denser than the post on average');
  });

  test('readable: every flake color holds 4.5:1 against every ink at every light, on both boards', () => {
    const f = make();
    landEverything(f);
    const failures = shineIsReadable(tokens, (mode, light) => sampleFlakes(f, light, bandOf(tokens[mode]), 1234));
    assert.deepEqual(failures.slice(0, 5), []);
  });

  test('drawing paints each settled flake once, makes a flare for a lit one, and scales the flare by the band', () => {
    const f = makeFlakes({ seed: 'fl', box: { w: 200, h: 100 }, inks: GLITTER, holo: HOLO, density: 70, star: {} as CanvasImageSource });
    landEverything(f);
    const r = recorder();
    f.draw(r.ctx, { x: 9, y: 9 }, bands.light, 0, false);
    assert.equal(r.count('fillRect'), f.settled.length);
    assert.equal(r.count('drawImage'), 0, 'no flake faces a light that far off');
    const k = f.settled[0]!;
    const band = { lo: 0.1, hi: 0.5 };
    const lit = recorder();
    f.draw(lit.ctx, { x: k.nx, y: k.ny }, band, 0, false);
    assert.ok(lit.count('drawImage') >= 1);
    assert.ok(lit.alphas.some((a) => Math.abs(a - 0.5) < 1e-9), `flare alpha scaled by the band: ${lit.alphas}`);
    const dark = recorder();
    f.draw(dark.ctx, { x: k.nx, y: k.ny }, bands.dark, 0, false);
    assert.equal(dark.count('drawImage'), 0, 'the dark board has no room for a flare');
  });

  test('drawing makes one color string per distinct color, not per flake', () => {
    const f = make();
    landEverything(f);
    const r = recorder();
    f.draw(r.ctx, { x: -0.35, y: -0.45 }, bands.light, 0, false);
    assert.ok(r.styles.size < 400, `${r.styles.size} distinct fills for ${f.settled.length} flakes`);
  });
});

describe('the burst', () => {
  test('lands every flake, none lost, over the words for under two seconds and done within 3.5 seconds', () => {
    const f = make('burst', { w: 400, h: 200 });
    const before = f.settled.length;
    assert.equal(burst(f, 1000), true);
    assert.equal(f.fired, true);
    assert.ok(f.flying > f.total * 0.8 && f.flying < f.total * 0.9, `${f.flying} fly`);
    assert.equal(before + f.flying, f.total);
    const r = recorder();
    let t = 1000, over = 0;
    while (stepBurst(f, t)) {
      t += 16;
      if (f.flying) over = t - 1000;
      drawBurst(r.ctx, f, bands.light, t);
      assert.ok(t - 1000 < 3500, 'still in flight at 3.5s');
    }
    assert.ok(r.count('fillRect') > 0);
    assert.ok(over < 2000, `flew over the words for ${over}ms`);
    assert.equal(f.settled.length, f.total);
    assert.equal(f.flying, 0);
    assert.equal(burstProbe.inFlight(), 0);
    assert.equal(new Set(f.settled).size, f.total, 'each flake landed once');
  });

  test('a second burst does nothing', () => {
    const f = make();
    burst(f, 0);
    const flying = f.flying;
    const parts = burstProbe.inFlight();
    burst(f, 500);
    assert.equal(f.flying, flying);
    assert.equal(burstProbe.inFlight(), parts);
    landEverything(f, 0);
    const n = f.settled.length;
    assert.equal(burst(f, 9000), false);
    assert.equal(f.settled.length, n);
  });

  test('under reduced motion nothing flies and every flake is placed at once', () => {
    motion = 'reduce';
    const f = make();
    assert.equal(burst(f, 0), false);
    assert.equal(f.settled.length, f.total);
    assert.equal(f.flying, 0);
    assert.equal(stepBurst(f, 16), false);
    assert.equal(burstProbe.inFlight(), 0);
  });

  test('a full-width post is capped: 1,500 of its 3,600 fly and the rest are down at once', () => {
    const f = make();
    burst(f, 0);
    assert.equal(f.flying, MAX_IN_FLIGHT);
    assert.equal(f.settled.length + f.flying, f.total);
  });

  test('no more than 1,500 fly across the page, and the rest of a burst lands at once', () => {
    const posts = [make('a'), make('b'), make('c')];
    for (const p of posts) burst(p, 0);
    assert.equal(burstProbe.inFlight(), MAX_IN_FLIGHT);
    assert.equal(posts[0]!.flying, MAX_IN_FLIGHT);
    assert.equal(posts[1]!.flying, 0);
    assert.equal(posts[1]!.settled.length, posts[1]!.total, 'the whole of the second post is down');
    assert.equal(posts[2]!.settled.length, posts[2]!.total);
    for (let t = 0; stepBurst(posts[0]!, t) && t < 5000; t += 16);
    assert.equal(burstProbe.inFlight(), 0);
    assert.equal(posts[0]!.settled.length, posts[0]!.total);
    const later = make('d');
    burst(later, 6000);
    assert.equal(later.flying, later.total - later.settled.length, 'room again once they landed');
  });
});
