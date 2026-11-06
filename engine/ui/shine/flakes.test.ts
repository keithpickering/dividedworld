import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { tokensOf } from '../contrast.ts';
import { ratio, MODES } from '../contrast.ts';
import { bandOf, luminanceOf, POST_INK, shineIsReadable, toLinear } from './band.ts';
import { burst, burstProbe, drawBurst, landAll, makeFlakes, MAX_IN_FLIGHT, release, sampleBurst, sampleCling, sampleFlakes, stepBurst, type Flakes } from './flakes.ts';

/* The bench's GLITTER inks (docs/research/2026-11-06-shine-bench/01-bench.html): seven rainbow inks, then silver for the
   holographic flakes from index 7. They are the reference inks for these tests, copied as literals. */
const GLITTER = ['#ff3b4a', '#ff9a2e', '#ffd23f', '#3ddc6b', '#2fd6ff', '#4a6bff', '#b65cff', '#dfe4ec', '#dfe4ec', '#dfe4ec'];
const HOLO = 7;
/* Divided World's glint (the engine may not import the instance, so the tests carry a copy). */
const GLINT = '#ffffff';
const BOX = { w: 988, h: 300 };
/* Digest of what `draw` painted for `shot()` before the draw was restructured to one transform per flake. */
const LOOK = 'ef2c407d43c607a7ce58c815efdec0b3a104d064d6e3ecb51b6cf81eaa6a8ed1';
const make = (seed = 'p1', box = BOX): Flakes => makeFlakes({ seed, box, inks: GLITTER, holo: HOLO, density: 70, glint: GLINT });

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
  const stops: string[] = [];
  const strokes = new Set<string>();
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k: string) => (k === 'createRadialGradient' ? () => ({ addColorStop: (_o: number, c: string) => stops.push(c) }) : (...a: unknown[]) => { calls.push(k); void a; }),
    set: (_t, k: string, v) => {
      if (k === 'globalAlpha') alphas.push(v as number);
      if (k === 'fillStyle' && typeof v === 'string') styles.add(v);
      if (k === 'strokeStyle') strokes.add(String(v));
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, alphas, styles, stops, strokes, count: (k: string) => calls.filter((c) => c === k).length };
}

/** A color string as `r,g,b,a8` whether it is `#rrggbb`, `#rrggbbaa` or a color function, so a digest holds across formats. */
function norm(c: string): string {
  const h = /^#([0-9a-f]{6})([0-9a-f]{2})?$/u.exec(c);
  if (h) return `${[0, 2, 4].map((i) => parseInt(h[1]!.slice(i, i + 2), 16)).join(',')},${h[2] ? parseInt(h[2], 16) : 255}`;
  const f = /^rgba?\((\d+),(\d+),(\d+)(?:,([\d.e-]+))?\)$/u.exec(c);
  if (f) return `${f[1]},${f[2]},${f[3]},${Math.round(Number(f[4] ?? 1) * 255)}`;
  return c;
}

/**
 * A context that tracks the transform, so a draw can be judged by what lands where (the corners of each rect in canvas px, the
 * fill it carries) and not by how it got there: `save/translate/rotate` and a single `setTransform` give the same lines.
 * It starts at the host's base transform, the density scale.
 */
function tracked(density = 1) {
  type M = [number, number, number, number, number, number];
  let m: M = [density, 0, 0, density, 0, 0];
  const stack: M[] = [];
  const lines: string[] = [];
  const n = { save: 0, restore: 0, setTransform: 0, fillStyleSets: 0, fillRect: 0, drawImage: 0 };
  let style = '', alpha = 1, comp = 'source-over', stroke = '', lineWidth = 1;
  const arcs: string[] = [];
  const r3 = (x: number): string => String(+x.toFixed(3));
  const at = (x: number, y: number): string => `${r3(m[0] * x + m[2] * y + m[4])},${r3(m[1] * x + m[3] * y + m[5])}`;
  const ctx = {
    save: () => { n.save++; stack.push([...m]); },
    restore: () => { n.restore++; m = stack.pop() ?? m; },
    translate: (x: number, y: number) => { m = [m[0], m[1], m[2], m[3], m[4] + m[0] * x + m[2] * y, m[5] + m[1] * x + m[3] * y]; },
    rotate: (t: number) => {
      const c = Math.cos(t), s = Math.sin(t);
      m = [m[0] * c + m[2] * s, m[1] * c + m[3] * s, -m[0] * s + m[2] * c, -m[1] * s + m[3] * c, m[4], m[5]];
    },
    setTransform: (...a: number[]) => { n.setTransform++; m = a as M; },
    fillRect: (x: number, y: number, w: number, h: number) => { n.fillRect++; lines.push(`rect ${style} ${[at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h)].join(' ')}`); },
    drawImage: (_i: unknown, x: number, y: number, w: number, h: number) => { n.drawImage++; lines.push(`img ${comp} ${r3(alpha)} ${at(x, y)} ${at(x + w, y + h)}`); },
    createRadialGradient: () => {
      const stops: string[] = [];
      return { stops, addColorStop: (o: number, c: string) => stops.push(`${o}:${norm(c)}`) };
    },
    beginPath: () => { arcs.length = 0; },
    arc: (x: number, y: number, r: number) => { arcs.push(`${at(x, y)} r${r3(r * Math.hypot(m[0], m[1]))}`); },
    fill: () => { lines.push(`fill ${(style as unknown as { stops: string[] }).stops.join(' ')} ${arcs.join(' ')}`); },
    stroke: () => { lines.push(`stroke ${norm(String(stroke))} ${r3(lineWidth)} ${arcs.join(' ')}`); },
    get lineWidth() { return lineWidth; }, set lineWidth(v: number) { lineWidth = v; },
    get strokeStyle() { return stroke; }, set strokeStyle(v: string) { stroke = v; },
    get fillStyle() { return style; }, set fillStyle(v: string) { n.fillStyleSets++; style = v; },
    get globalAlpha() { return alpha; }, set globalAlpha(v: number) { alpha = v; },
    get globalCompositeOperation() { return comp; }, set globalCompositeOperation(v: string) { comp = v; },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, n, lines, matrix: () => m, digest: () => createHash('sha256').update([...lines].sort().join('\n')).digest('hex') };
}

/* Digests of what `drawBurst` painted for `burstShot()` before it was restructured to one transform per flake. */
const BURST_LIGHT = 'fa65bbf1abf6d450f0477a6349f3f37c1a7d6147f2f97afabae1cea87599e77e';
const BURST_DARK_FLAKES = '6407913fab1144941d2af38d0f789aa6d8b1ed38c3149266cd82fd9e897679b2';
function burstShot(band: { lo: number; hi: number }, onlyFlakes: boolean): { digest: string; t: ReturnType<typeof tracked>; flying: number } {
  const f = makeFlakes({ seed: 'burst-look', box: { w: 400, h: 200 }, inks: GLITTER, holo: HOLO, density: 70, glint: GLINT, star: {} as CanvasImageSource });
  burst(f, 0);
  const t = tracked(2);
  let flying = 0;
  for (const now of [40, 160, 400, 800, 1200]) { stepBurst(f, now); flying = Math.max(flying, f.flying); drawBurst(t.ctx, f, band, now, 2); }
  const lines = onlyFlakes ? t.lines.filter((l) => l.startsWith('rect ') || l.startsWith('img ')) : t.lines;
  return { digest: createHash('sha256').update([...lines].sort().join('\n')).digest('hex'), t, flying };
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

  test('drawing paints each settled flake once; a flare is white, so it is drawn only where the band reaches white', () => {
    const f = makeFlakes({ seed: 'fl', box: { w: 200, h: 100 }, inks: GLITTER, holo: HOLO, density: 70, glint: GLINT, star: {} as CanvasImageSource });
    landEverything(f);
    const r = recorder();
    f.draw(r.ctx, { x: 9, y: 9 }, bands.light, 0, false);
    assert.equal(r.count('fillRect'), f.settled.length);
    assert.equal(r.count('drawImage'), 0, 'no flake faces a light that far off');
    const k = f.settled[0]!;
    const light = { x: k.nx, y: k.ny };
    const lit = recorder();
    f.draw(lit.ctx, light, { lo: 0.1, hi: 1 }, 0, false);
    assert.ok(lit.count('drawImage') >= 1, 'flares where hi is 1');
    assert.ok(lit.alphas.some((a) => a > 0.999), `a flare at full tilt has the plain alpha: ${lit.alphas}`);
    assert.ok(lit.alphas.every((a) => a >= 0 && a <= 1));
    for (const band of [{ lo: 0, hi: 0.3 }, { lo: 0, hi: 0.999 }, bands.dark]) {
      const none = recorder();
      f.draw(none.ctx, light, band, 0, false);
      assert.equal(none.count('drawImage'), 0, `no flare under hi ${band.hi}`);
    }
  });

  /* The look, pinned: what the pre-restructure code drew (every rect's corners in canvas px and its fill, every flare), as a
     digest of the sorted lines, for a seed, three lights, both boards, at density 2. The draw order of overlapping flakes is
     not part of the look; where each one lands and what color it is, is. */
  const SHOT: Array<[string, { x: number; y: number } | 'lit', { lo: number; hi: number }, number]> = [
    ['light board', { x: -0.35, y: -0.45 }, bands.light, 1234],
    ['flares', 'lit', { lo: 0.1, hi: 1 }, 5],
    ['dark board', { x: 0.3, y: 0.2 }, bands.dark, 777],
  ];
  function shot(): { digest: string; images: number; t: ReturnType<typeof tracked> } {
    const f = makeFlakes({ seed: 'look', box: BOX, inks: GLITTER, holo: HOLO, density: 70, glint: GLINT, star: {} as CanvasImageSource });
    landEverything(f);
    const t = tracked(2);
    for (const [, l, band, now] of SHOT) f.draw(t.ctx, l === 'lit' ? { x: f.settled[3]!.nx, y: f.settled[3]!.ny } : l, band, now, true, 2);
    return { digest: t.digest(), images: t.n.drawImage, t };
  }

  test('the look is unchanged: the same rects, colors and flares land in the same places', () => {
    const s = shot();
    assert.ok(s.images >= 1, 'the flare scene has flares');
    assert.equal(s.digest, LOOK);
  });

  test('a redraw costs no save per flake, and a fill color is set once per color, not per flake', () => {
    const f = makeFlakes({ seed: 'look', box: BOX, inks: GLITTER, holo: HOLO, density: 70, glint: GLINT, star: {} as CanvasImageSource });
    landEverything(f);
    const t = tracked(2);
    f.draw(t.ctx, { x: -0.35, y: -0.45 }, bands.light, 1234, true, 2);
    const seen = new Set(t.lines.filter((l) => l.startsWith('rect ')).map((l) => l.split(' ')[1]));
    assert.equal(t.n.fillRect, f.settled.length);
    assert.ok(t.n.save + t.n.restore <= 2, `${t.n.save} saves and ${t.n.restore} restores for ${f.settled.length} flakes`);
    assert.ok(t.n.fillStyleSets <= seen.size + 2, `${t.n.fillStyleSets} fill assignments for ${seen.size} colors`);
    assert.ok(t.n.fillStyleSets < f.settled.length / 4, `${t.n.fillStyleSets} fill assignments for ${f.settled.length} flakes`);
    assert.deepEqual(t.matrix(), [2, 0, 0, 2, 0, 0], 'the transform is back to the density scale');
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
  test('the look is unchanged: the puff, the flakes and the flares land in the same places in the same colors', () => {
    const light = burstShot(bands.light, false);
    assert.ok(light.flying > 100 && light.t.n.drawImage >= 1, 'a busy burst with flares');
    assert.equal(light.digest, BURST_LIGHT);
    /* The dark board's puff is tinted from the glint now (it was a fixed gold); its flakes are what they were. */
    assert.equal(burstShot(bands.dark, true).digest, BURST_DARK_FLAKES);
  });

  test('the puff and the flare are drawn in the glint it is handed: a warm glint shows in every stop and stroke, and is moved into the band', () => {
    const WARM = '#ffeecc';
    const f = makeFlakes({ seed: 'puff', box: { w: 300, h: 150 }, inks: GLITTER, holo: HOLO, density: 70, glint: WARM });
    burst(f, 0);
    const lit = recorder();
    drawBurst(lit.ctx, f, { lo: 0.5, hi: 1 }, 100);
    assert.ok(lit.stops.length >= 3 && lit.strokes.size === 1);
    for (const c of [...lit.stops, ...lit.strokes]) assert.ok(c.startsWith('#ffeecc'), `the glint, not white: ${c}`);
    /* A glint darker than the band's floor is lifted to it, so a source-over puff cannot pull a cell under the floor. */
    const floor = recorder();
    drawBurst(floor.ctx, f, { lo: 0.95, hi: 1 }, 100);
    assert.ok(luminanceOf(toLinear(rgbaHex(floor.stops[0]!))) >= 0.95 - 0.004, floor.stops[0]);
    /* On a board with a lower ceiling the same glint is scaled under the ceiling, keeping its hue (red >= green >= blue). */
    const dark = recorder();
    drawBurst(dark.ctx, f, { lo: 0, hi: 0.1 }, 100);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(rgbaHex(dark.stops[0]!).slice(i, i + 2), 16)) as [number, number, number];
    assert.ok(r >= g && g >= b && r < 255, `scaled: ${dark.stops[0]}`);
    assert.ok(luminanceOf(toLinear(rgbaHex(dark.stops[0]!))) <= 0.1 + 0.004);
    assert.deepEqual([...sampleBurst(f, { lo: 0.5, hi: 1 }, 100)].filter((c) => c === WARM), [WARM], 'the sampler reports the same color');
  });

  test('the flare sprite is built from the glint, one per glint', () => {
    const stops: string[] = [];
    const g = globalThis as unknown as { OffscreenCanvas?: unknown };
    g.OffscreenCanvas = class {
      getContext() {
        return new Proxy({}, {
          get: (_t, k: string) => (k === 'createRadialGradient' ? () => ({ addColorStop: (_o: number, c: string) => stops.push(c) }) : () => undefined),
          set: () => true,
        });
      }
    };
    try {
      for (const glint of ['#ffeecc', '#ffeecc', '#aaccff']) {
        const f = makeFlakes({ seed: 'spr', box: { w: 100, h: 60 }, inks: GLITTER, holo: HOLO, density: 70, glint });
        landEverything(f);
        f.draw(tracked(1).ctx, { x: 0, y: 0 }, bands.light, 0, false);
        const made = stops.splice(0);
        if (glint === '#ffeecc' && made.length === 0) continue;
        assert.ok(made.length > 0 && made.every((c) => c.startsWith(glint)), `${glint}: ${made.join(' ')}`);
      }
    } finally { delete g.OffscreenCanvas; }
  });

  test('a burst frame costs no save per flake', () => {
    const f = makeFlakes({ seed: 'burst-look', box: { w: 400, h: 200 }, inks: GLITTER, holo: HOLO, density: 70, glint: GLINT, star: {} as CanvasImageSource });
    burst(f, 0);
    stepBurst(f, 400);
    const t = tracked(2);
    drawBurst(t.ctx, f, bands.light, 400, 2);
    assert.ok(t.n.fillRect > 500, `${t.n.fillRect} flakes in the air`);
    assert.ok(t.n.save + t.n.restore <= 2, `${t.n.save} saves and ${t.n.restore} restores for ${t.n.fillRect} flakes`);
    assert.deepEqual(t.matrix(), [2, 0, 0, 2, 0, 0], 'the transform is back to the density scale');
  });

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

  test('reduced motion turned on mid-burst lands every flake at once and gives the cap back', () => {
    const f = make('mid', { w: 400, h: 200 });
    burst(f, 0);
    assert.equal(stepBurst(f, 16), true);
    assert.ok(f.flying > 0);
    motion = 'reduce';
    assert.equal(stepBurst(f, 32), false);
    assert.equal(f.flying, 0);
    assert.equal(f.settled.length, f.total);
    assert.equal(new Set(f.settled).size, f.total, 'each flake once');
    assert.equal(burstProbe.inFlight(), 0);
  });

  /* The page-wide cap decides how many of a burst fly and how many land at once; where every flake ends up is the post's own. */
  test('the settled outcome is the same whether or not another post used up the cap', () => {
    const keys = (f: Flakes) => f.settled.map((k) => `${k.x},${k.y},${k.ink}`).sort();
    const alone = make('cap', { w: 400, h: 200 });
    landEverything(alone);
    burstProbe.reset();
    const hog = make('hog');
    burst(hog, 0);
    assert.equal(burstProbe.inFlight(), MAX_IN_FLIGHT);
    const crowded = make('cap', { w: 400, h: 200 });
    burst(crowded, 0);
    assert.equal(crowded.flying, 0, 'no room: all of it lands at once');
    landEverything(crowded);
    assert.deepEqual(keys(crowded), keys(alone));
    assert.equal(crowded.settled.length, crowded.total);
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


/** The post-ink failures among `#rrggbb` strings, on one board. */
function failures(mode: (typeof MODES)[number], colors: Iterable<string>): string[] {
  const out: string[] = [];
  for (const c of colors) for (const ink of POST_INK) { const r = ratio(tokens[mode][ink]!, c); if (r < 4.5) out.push(`${mode} ${c} ${r.toFixed(1)}:1 on ${ink}`); }
  return out;
}
/** The `#rrggbb` of a `#rrggbbaa` stop. */
const rgbaHex = (c: string): string => {
  assert.match(c, /^#[0-9a-f]{8}$/u, 'a stop with alpha is #rrggbbaa');
  return c.slice(0, 7);
};

describe('everything over the words stays in the band', () => {
  test('the burst: every flake color it draws, and the sampler, hold 4.5:1 on both boards at several moments', () => {
    for (const mode of MODES) {
      const f = make(`rb-${mode}`, { w: 400, h: 200 });
      burst(f, 0);
      const drawn = new Set<string>();
      for (let t = 0; t <= 1600; t += 80) {
        stepBurst(f, t);
        const r = recorder();
        drawBurst(r.ctx, f, bandOf(tokens[mode]), t);
        for (const c of r.styles) if (c.startsWith('#')) drawn.add(c);
        for (const c of r.stops) drawn.add(rgbaHex(c));
        for (const c of sampleBurst(f, bandOf(tokens[mode]), t)) drawn.add(c);
      }
      assert.ok(drawn.size > 3, 'colors were drawn');
      assert.deepEqual(failures(mode, drawn).slice(0, 5), []);
    }
  });

  test('the sampler agrees with the page check across a grid of times', () => {
    const f = make('rb2', { w: 300, h: 150 });
    burst(f, 0);
    let t = 0;
    const fails = shineIsReadable(tokens, (mode) => { t += 37; stepBurst(f, t % 1600); return sampleBurst(f, bandOf(tokens[mode]), t % 1600); });
    assert.deepEqual(fails.slice(0, 5), []);
  });

  test('the puff is white only where the band reaches white, and a tint inside the band elsewhere', () => {
    const f = make('puff', { w: 300, h: 150 });
    burst(f, 0);
    const light = recorder();
    drawBurst(light.ctx, f, { lo: 0.5, hi: 1 }, 100);
    assert.ok(light.stops.length >= 3);
    for (const c of light.stops) assert.ok(c.startsWith('#ffffff'), `white on the light board: ${c}`);
    for (const band of [{ lo: 0, hi: 0.3 }, bands.dark]) {
      const dark = recorder();
      drawBurst(dark.ctx, f, band, 100);
      assert.ok(dark.stops.length >= 3);
      for (const c of [...dark.stops, ...dark.strokes]) {
        const L = luminanceOf(toLinear(rgbaHex(c)));
        assert.ok(L <= band.hi + 0.004, /* band.ts rounds inside its own 0.004 margin */ `${c} has luminance ${L} over the ceiling ${band.hi}`);
      }
    }
  });

  test('the cling layer: every color it can paint holds 4.5:1 on both boards', () => {
    const f = make('cl');
    const fails = shineIsReadable(tokens, (mode) => sampleCling(f, bandOf(tokens[mode])));
    assert.deepEqual(fails.slice(0, 5), []);
  });
});

describe('release', () => {
  test('a post dropped mid-burst gives its share of the cap back', () => {
    const a = make('rel-a');
    burst(a, 0);
    assert.equal(burstProbe.inFlight(), MAX_IN_FLIGHT);
    release(a);
    assert.equal(burstProbe.inFlight(), 0);
    assert.equal(a.flying, 0);
    assert.equal(a.settled.length, a.total, 'its flakes are down where they were headed');
    assert.equal(stepBurst(a, 16), false);
    release(a);
    assert.equal(burstProbe.inFlight(), 0, 'twice does no harm');
    const b = make('rel-b');
    burst(b, 20);
    assert.equal(b.flying, MAX_IN_FLIGHT, 'the second post flies its full share');
  });

  test('releasing twice while another post flies leaves that post its share', () => {
    const a = make('rel-d'), b = make('rel-e');
    burst(a, 0);
    burst(b, 0);
    assert.equal(burstProbe.inFlight(), MAX_IN_FLIGHT, 'b found no room');
    release(a);
    assert.equal(burstProbe.inFlight(), 0);
    const c = make('rel-f');
    burst(c, 5);
    assert.equal(burstProbe.inFlight(), MAX_IN_FLIGHT);
    release(a); release(a);
    assert.equal(burstProbe.inFlight(), MAX_IN_FLIGHT, 'a second release of a is a no-op');
    assert.equal(a.settled.length, a.total);
  });

  test('releasing a post that never burst changes nothing', () => {
    const a = make('rel-c', { w: 200, h: 100 });
    const n = a.settled.length;
    release(a);
    assert.equal(burstProbe.inFlight(), 0);
    assert.equal(a.settled.length, n);
  });
});

describe('landAll', () => {
  test('places every flake at rest with the in-flight cap fully used by another post, and leaves the count alone', () => {
    const other = make('land-a');
    burst(other, 0);
    assert.equal(burstProbe.inFlight(), MAX_IN_FLIGHT);
    const b = make('land-b');
    landAll(b);
    assert.equal(b.settled.length, b.total);
    assert.equal(b.flying, 0);
    assert.equal(b.fired, true);
    assert.equal(burstProbe.inFlight(), MAX_IN_FLIGHT, 'it used none of the cap');
    assert.equal(burst(b, 5), false, 'a landed post does not burst');
    assert.equal(burstProbe.inFlight(), MAX_IN_FLIGHT);
  });
});
