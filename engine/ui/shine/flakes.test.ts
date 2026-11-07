import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { tokensOf } from '../contrast.ts';
import { ratio, MODES } from '../contrast.ts';
import { bandOf, luminanceOf, POST_INK, shineIsReadable, toLinear } from './band.ts';
import { burst, burstProbe, drawBurst, GLINT_SHARE, glintsAreFew, glintShare, landAll, makeFlakes, MAX_IN_FLIGHT, release, sampleBurst, sampleCling, sampleFlakes, stepBurst, type Flakes } from './flakes.ts';

/* The bench's GLITTER inks (docs/research/2026-11-06-shine-bench/01-bench.html): seven rainbow inks, then silver for the
   holographic flakes from index 7. They are the reference inks for these tests, copied as literals. */
const GLITTER = ['#ff3b4a', '#ff9a2e', '#ffd23f', '#3ddc6b', '#2fd6ff', '#4a6bff', '#b65cff', '#dfe4ec', '#dfe4ec', '#dfe4ec'];
const HOLO = 7;
/* Divided World's glint (the engine may not import the instance, so the tests carry a copy). */
const GLINT = '#ffffff';
const BOX = { w: 988, h: 300 };
/* Digest of what `draw` painted for `shot()` before the draw was restructured to one transform per flake. Repinned 2026-11-07, when
   the dark board's flakes went to their inks at the ceiling with tinted flares (the owner: "almost imperceptible in dark mode"); the
   light board's two scenes were checked to paint the same lines, byte for byte, before and after. */
const LOOK = '7e92bbb1a01692c2e5ccb74c5e58628e1a5754261479fe787cf863ad608f70ea';
/* A box wide enough that one post alone has more burst flakes than the page-wide cap holds. */
const HUGE = { w: 1400, h: 300 };
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
    clearRect: () => {},
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

/* Digests of what `drawBurst` painted for `burstShot()` before it was restructured to one transform per flake. Repinned 2026-11-07,
   when the burst was turned to be seen from above the whole time (the owner: keep "that same camera angle"). */
const BURST_LIGHT = 'b1488eb8c9d1b667a736554d711d1648752f749191bf40a912ea2e025f6d5cd2';
/* (Pinned with the dark post bursting on its own: before the cap rose it shared the page with the light shot's burst above and flew only the 530 flakes left of 1,500.) */
/* Repinned 2026-11-07 with BURST_LIGHT, and for the dark board's inks at the ceiling. */
const BURST_DARK_FLAKES = 'a2ecf0062e70a3f550d8c547878901ba08f11942a27500c26fc49533e1b05a5c';
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

  /* The dark board's glints leave the band (section 5, issue #340); this is what holds them to a few flakes at once. */
  test('glints are few: at every light and moment, at most GLINT_SHARE of the flakes glint', () => {
    const f = make();
    landEverything(f);
    const nows = Array.from({ length: 80 }, (_, k) => k * 250);
    assert.deepEqual(glintsAreFew(f, nows).slice(0, 5), []);
    /* And the light the post's own flakes crowd toward does glint some, so the check is not passing on nothing. */
    assert.ok(Math.max(...nows.map((now) => glintShare(f, { x: 0, y: 0 }, now))) > 0);
  });

  test('POISON: a post whose flakes all face one light is named at that light', () => {
    const f = make();
    landEverything(f);
    for (const k of (f as unknown as { settled: Array<{ nx: number; ny: number }> }).settled) { k.nx = 0.375; k.ny = -0.75; }
    const failures = glintsAreFew(f, [0]);
    assert.ok(failures.length > 0);
    assert.ok(failures.every((m) => m.includes('at light (0.375, -0.75)')), failures[0]);
    assert.ok(glintShare(f, { x: 0.375, y: -0.75 }, 0) > GLINT_SHARE);
  });

  test('drawing paints each settled flake once; a flare is drawn where the band reaches white, and on the dark board only with a canvas for its hue', () => {
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

  /**
   * The two layers against one pass, for the scenes `shot()` draws and a sweep of lights on both boards: painting the base and then
   * the lit layer over it leaves every flake showing the color one pass gives it (the last rect painted at each place wins), every
   * flare where one pass puts it, and every flake under a flare repainted in the lit layer before the flare, so the flare is added
   * to it there as one pass adds it. The lit layer is a small share of the flakes.
   */
  function layered(f: Flakes, light: { x: number; y: number }, band: { lo: number; hi: number }, now: number, idle: boolean) {
    const one = tracked(2), base = tracked(2), lit = tracked(2);
    f.draw(one.ctx, light, band, now, idle, 2);
    f.drawBase(base.ctx, band, 2);
    f.drawLit(lit.ctx, light, band, now, idle, 2);
    const shows = (...layers: string[][]) => {
      const at = new Map<string, string>();
      for (const lines of layers) for (const l of lines) if (l.startsWith('rect ')) { const [, style, ...corners] = l.split(' '); at.set(corners.join(' '), style!); }
      return at;
    };
    const flares = (lines: string[]) => lines.filter((l) => l.startsWith('img ')).sort();
    return { one, base, lit, single: shows(one.lines), composite: shows(base.lines, lit.lines), flares: { one: flares(one.lines), lit: flares(lit.lines) } };
  }
  const LIGHTS = [{ x: -0.35, y: -0.45 }, { x: 0.3, y: 0.2 }, { x: 1.2, y: -0.9 }, { x: -1.4, y: 1.1 }, { x: 0, y: 0 }, { x: 0.71, y: 0.33 }];

  test('the base and the lit layer over it paint what one pass paints: each flake in its color, each flare in its place', () => {
    const f = makeFlakes({ seed: 'look', box: BOX, inks: GLITTER, holo: HOLO, density: 70, glint: GLINT, star: {} as CanvasImageSource });
    landEverything(f);
    const scenes: Array<[{ x: number; y: number }, { lo: number; hi: number }, number, boolean]> = [
      ...SHOT.map(([, l, band, now]) => [l === 'lit' ? { x: f.settled[3]!.nx, y: f.settled[3]!.ny } : l, band, now, true] as [{ x: number; y: number }, { lo: number; hi: number }, number, boolean]),
      ...LIGHTS.flatMap((l, k) => [[l, bands.light, k * 700, k % 2 === 0], [l, bands.dark, k * 700, k % 2 === 1], [l, { lo: 0.1, hi: 1 }, k * 300, true]] as Array<[{ x: number; y: number }, { lo: number; hi: number }, number, boolean]>),
    ];
    const shares: string[] = [];
    for (const [light, band, now, idle] of scenes) {
      const r = layered(f, light, band, now, idle);
      assert.equal(r.composite.size, r.single.size, 'every flake is in the base');
      let differ = 0;
      for (const [k, v] of r.single) if (r.composite.get(k) !== v) differ++;
      assert.equal(differ, 0, `${differ} flakes show another color than one pass gives them, at ${JSON.stringify(light)} on ${JSON.stringify(band)}`);
      assert.deepEqual(r.flares.lit, r.flares.one, 'the flares are the lit layer\'s, the same as one pass\'s');
      /* Under each flare's square, every flake is in the lit layer, so the flare is added to it on that canvas. */
      const litAt = new Set(r.lit.lines.filter((l) => l.startsWith('rect ')).map((l) => l.split(' ').slice(2).join(' ')));
      for (const fl of r.flares.lit) {
        const [, , , p0, p1] = fl.split(' ');
        const [x0, y0] = p0!.split(',').map(Number), [x1, y1] = p1!.split(',').map(Number);
        for (const l of r.one.lines.filter((x) => x.startsWith('rect '))) {
          const pts = l.split(' ').slice(2).map((p) => p.split(',').map(Number));
          if (pts.some(([x, y]) => x! >= x0! && x! <= x1! && y! >= y0! && y! <= y1!)) assert.ok(litAt.has(l.split(' ').slice(2).join(' ')), `a flake under a flare is not repainted under it: ${l}`);
        }
      }
      shares.push(`${(100 * r.lit.n.fillRect / f.settled.length).toFixed(1)}%`);
      assert.ok(r.lit.n.fillRect < f.settled.length * 0.3, `the lit layer paints ${r.lit.n.fillRect} of ${f.settled.length} flakes`);
    }
    console.log(`lit layer share of the flakes, per scene: ${shares.join(' ')}`);
  });

  test('POISON: a lit layer that leaves out the flakes under a flare is caught; one that misses a lit flake is caught', () => {
    const f = makeFlakes({ seed: 'look', box: BOX, inks: GLITTER, holo: HOLO, density: 70, glint: GLINT, star: {} as CanvasImageSource });
    landEverything(f);
    const light = { x: f.settled[3]!.nx, y: f.settled[3]!.ny }, band = { lo: 0.1, hi: 1 };
    const r = layered(f, light, band, 5, true);
    /* Drop the lit layer's rects that are not lit themselves (the ones there only for a flare): a flake under a flare goes missing. */
    const own = new Map(r.single);
    const flareOnly = r.lit.lines.filter((l) => l.startsWith('rect ') && own.get(l.split(' ').slice(2).join(' ')) === r.base.lines.find((b) => b.split(' ').slice(2).join(' ') === l.split(' ').slice(2).join(' '))?.split(' ')[1]);
    assert.ok(flareOnly.length > 0, 'the scene has flakes in the lit layer only for a flare');
    /* Drop one lit flake that shows a color the base does not: the composite differs from one pass. */
    const lit = r.lit.lines.filter((l) => l.startsWith('rect ') && !flareOnly.includes(l));
    assert.ok(lit.length > 0);
    const composite = new Map<string, string>();
    for (const l of [...r.base.lines, ...r.lit.lines.filter((x) => x !== lit[0])]) if (l.startsWith('rect ')) { const [, style, ...c] = l.split(' '); composite.set(c.join(' '), style!); }
    let differ = 0;
    for (const [k, v] of r.single) if (composite.get(k) !== v) differ++;
    assert.equal(differ, 1);
  });

  test('the base is one key a board and settled count: the light, the time and the twinkle do not change it', () => {
    const f = make();
    landEverything(f);
    const a = tracked(2), b = tracked(2);
    f.drawBase(a.ctx, bands.light, 2);
    f.drawBase(b.ctx, bands.light, 2);
    assert.equal(a.digest(), b.digest());
    assert.equal(a.n.drawImage, 0, 'the base has no flare');
    assert.equal(f.baseKey(bands.light), f.baseKey({ ...bands.light }));
    assert.notEqual(f.baseKey(bands.light), f.baseKey(bands.dark));
    const before = makeFlakes({ seed: 'p1', box: BOX, inks: GLITTER, holo: HOLO, density: 70, glint: GLINT });
    const k = before.baseKey(bands.light);
    landEverything(before);
    assert.notEqual(before.baseKey(bands.light), k, 'a burst that lands flakes changes the key');
  });

  test('the lit layer clears what it drew last time, square by square, and all of its canvas the first time or after a resize', () => {
    const f = makeFlakes({ seed: 'look', box: BOX, inks: GLITTER, holo: HOLO, density: 70, glint: GLINT, star: {} as CanvasImageSource });
    landEverything(f);
    const calls: unknown[][] = [];
    const canvas = { width: 1976, height: 600 };
    const t = tracked(2);
    const ctx = Object.assign(t.ctx, { canvas, clearRect: (...a: number[]) => calls.push(a) });
    f.drawLit(ctx, { x: 0.3, y: 0.2 }, bands.light, 0, false, 2);
    assert.deepEqual(calls, [[0, 0, 1976, 600]]);
    const drawn = t.n.fillRect;
    calls.length = 0;
    f.drawLit(ctx, { x: 0.32, y: 0.2 }, bands.light, 16, false, 2);
    assert.equal(calls.length, drawn, 'one square a flake drawn last time');
    assert.ok(calls.every(([, , w, h]) => w! > 0 && h! > 0 && w! < 60 && h! < 60), 'each a flake\'s or a flare\'s square');
    canvas.width = 988;
    calls.length = 0;
    f.drawLit(ctx, { x: 0.32, y: 0.2 }, bands.light, 32, false, 1);
    assert.deepEqual(calls, [[0, 0, 988, 600]]);
  });

  /* A lit layer handed a span (engine/ui/shine/loop.ts `ShineFrame.span`, issue #304) repaints only the flakes on screen: those whose
     square reaches into the span's rows. The base under them is whole, so a flake left out shows its unlit color until it is redrawn. */
  test('the lit layer with a span paints the lit flakes whose square reaches into the span, and none further off', () => {
    const f = makeFlakes({ seed: 'look', box: BOX, inks: GLITTER, holo: HOLO, density: 70, glint: GLINT, star: {} as CanvasImageSource });
    landEverything(f);
    const light = { x: f.settled[3]!.nx, y: f.settled[3]!.ny }, band = { lo: 0.1, hi: 1 };
    const span = { top: 100, bottom: 180 };
    const all = tracked(2), part = tracked(2);
    f.drawLit(all.ctx, light, band, 5, true, 2);
    f.drawLit(part.ctx, light, band, 5, true, 2, span);
    /* A rect's center, in CSS px (the canvas is at density 2). */
    const centerY = (l: string) => l.split(' ').slice(2).map((p) => Number(p.split(',')[1])).reduce((a, b) => a + b, 0) / 8;
    const rects = (lines: string[]) => lines.filter((l) => l.startsWith('rect '));
    const inPart = new Set(rects(part.lines));
    /* A lit flake's square reaches 13.7 px at most (a flare's), and a flake under that flare is painted with it: two reaches off the span. */
    const reach = 28;
    let kept = 0;
    for (const l of rects(all.lines)) {
      const y = centerY(l);
      if (y >= span.top && y <= span.bottom) { assert.ok(inPart.has(l), `a lit flake in the span is painted: ${l}`); kept++; }
    }
    assert.ok(kept > 0, 'the scene has lit flakes in the span');
    for (const l of inPart) {
      assert.ok(rects(all.lines).includes(l), `painted as the whole layer paints it: ${l}`);
      const y = centerY(l);
      assert.ok(y >= span.top - reach && y <= span.bottom + reach, `a flake off the span is not painted: ${l}`);
    }
    assert.ok(inPart.size < rects(all.lines).length, 'flakes off the span are left out');
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
    burstProbe.reset(); // the light burst above is still in the air; the dark one is its own post and gets the whole cap
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

  /* The owner, 2026-11-07: the burst should keep the camera above the post the whole time, as the settled glitter has it. */
  test('seen from above: a flake in the air keeps near the line from the burst point to its place and never falls down the screen', () => {
    const f = make('above', { w: 600, h: 300 });
    burst(f, 0);
    const parts = (f as unknown as { parts: Array<{ f: { x: number; y: number }; x: number; y: number }> }).parts.slice();
    const from = new Map(parts.map((b) => [b, { x: b.x, y: b.y }]));
    let worst = 0;
    for (let t = 16; t <= 1900; t += 16) {
      stepBurst(f, t);
      for (const b of (f as unknown as { parts: typeof parts }).parts) {
        const a = from.get(b)!, dx = b.f.x - a.x, dy = b.f.y - a.y, len = Math.hypot(dx, dy) || 1;
        /* How far off the straight line from where it left to where it rests, and how far past either end. */
        const along = ((b.x - a.x) * dx + (b.y - a.y) * dy) / len;
        const off = Math.abs((b.x - a.x) * dy - (b.y - a.y) * dx) / len;
        worst = Math.max(worst, off, -along, along - len);
      }
    }
    assert.ok(worst <= 40.5, `a flake strayed ${worst.toFixed(1)} px off its line`);
    assert.equal(f.flying, 0);
  });

  test('a flake in the air is nearer the reader, so it is drawn larger than it lies on the post, and its own size again as it lands', () => {
    const f = make('near', { w: 400, h: 200 });
    burst(f, 0);
    const size = (t: ReturnType<typeof tracked>) => t.lines.filter((l) => l.startsWith('rect ')).map((l) => {
      const [a, , , d] = l.split(' ').slice(2).map((p) => p.split(',').map(Number) as [number, number]);
      return Math.hypot(d![0] - a![0], d![1] - a![1]);
    });
    stepBurst(f, 400);
    const mid = tracked(1);
    drawBurst(mid.ctx, f, bands.light, 400);
    const own = (f as unknown as { parts: Array<{ f: { s: number } }> }).parts.map((b) => b.f.s * 0.84);
    const grown = size(mid).filter((h, i) => h > own[i]! * 1.2).length;
    assert.ok(grown > size(mid).length * 0.5, `${grown} of ${size(mid).length} drawn larger mid-flight`);
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
    fillCap('hog');
    assert.equal(burstProbe.inFlight(), MAX_IN_FLIGHT);
    const crowded = make('cap', { w: 400, h: 200 });
    burst(crowded, 0);
    assert.equal(crowded.flying, 0, 'no room: all of it lands at once');
    landEverything(crowded);
    assert.deepEqual(keys(crowded), keys(alone));
    assert.equal(crowded.settled.length, crowded.total);
  });

  /* Owner's decision on #268: a full-width post (988 by 300: 4,234 flakes, 635 shown before the burst) bursts whole. */
  test('a full-width post bursts whole: every flake that leaves its rest is in flight and none lands at once', () => {
    const f = make();
    const rest = f.total - f.settled.length;
    assert.ok(rest > 3500, 'about 3,600 leave their rest');
    burst(f, 0);
    assert.equal(f.flying, rest);
    assert.equal(f.settled.length + f.flying, f.total);
    assert.equal(burstProbe.inFlight(), rest);
  });

  test('a post with more burst flakes than the cap holds is capped: MAX_IN_FLIGHT fly and the rest are down at once', () => {
    const f = make('huge', HUGE);
    assert.ok(f.total - f.settled.length > MAX_IN_FLIGHT);
    burst(f, 0);
    assert.equal(f.flying, MAX_IN_FLIGHT);
    assert.equal(f.settled.length + f.flying, f.total);
  });

  test('a second post bursting at once gets only what is left of the page-wide cap and lands the rest at once', () => {
    const posts = [make('a'), make('b'), make('c')];
    const aRest = posts[0]!.total - posts[0]!.settled.length;
    const bRest = posts[1]!.total - posts[1]!.settled.length;
    for (const p of posts) burst(p, 0);
    assert.equal(posts[0]!.flying, aRest, 'the first flies whole');
    assert.equal(posts[1]!.flying, MAX_IN_FLIGHT - aRest, 'the second shares the remainder');
    assert.ok(posts[1]!.flying > 0 && posts[1]!.flying < bRest);
    assert.equal(posts[1]!.settled.length + posts[1]!.flying, posts[1]!.total, 'the rest of the second is down');
    assert.equal(posts[2]!.flying, 0);
    assert.equal(posts[2]!.settled.length, posts[2]!.total, 'the whole of the third post is down');
    assert.equal(burstProbe.inFlight(), MAX_IN_FLIGHT);
    for (let t = 0; (stepBurst(posts[0]!, t) || stepBurst(posts[1]!, t)) && t < 5000; t += 16);
    assert.equal(burstProbe.inFlight(), 0);
    assert.equal(posts[0]!.settled.length, posts[0]!.total);
    assert.equal(posts[1]!.settled.length, posts[1]!.total);
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

/* The owner, 2026-11-07: the glitter is almost imperceptible on the dark board. The settled field holds the band (section 5 of the
   shine design), so within it each ink is taken at the ceiling, saturated; a flake facing the light glints out of it (issue #340). */
describe('the dark board', () => {
  const chroma = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); return Math.max(r!, g!, b!) - Math.min(r!, g!, b!); };
  const L = (hex: string) => luminanceOf(toLinear(hex));

  test('a flake facing the light is its ink at the ceiling, in color, not a gray; one facing away is a share of that, not black', () => {
    const f = make('jewel', { w: 300, h: 150 });
    landEverything(f);
    const band = bands.dark;
    for (const k of f.settled.filter((x) => x.ink < HOLO).slice(0, 40)) {
      const lit = tracked(1), unlit = tracked(1);
      f.draw(lit.ctx, { x: k.nx, y: k.ny }, band, 0, false);
      f.draw(unlit.ctx, { x: 99, y: 99 }, band, 0, false);
      const at = (t: ReturnType<typeof tracked>) => t.lines.find((l) => l.startsWith('rect ') && l.endsWith(rectOf(k)))!.split(' ')[1]!;
      const on = at(lit), off = at(unlit);
      assert.ok(L(on) >= band.hi * 0.9 && L(on) <= band.hi + 0.004, `${on} lit sits at the ceiling ${band.hi}`);
      assert.ok(chroma(on) >= 40, `${on} lit keeps its color`);
      assert.ok(L(off) >= band.hi * 0.3, `${off} unlit still shows`);
    }
  });

  /* Its glint, out of the band since issue #340, is flakes.glint.test.ts's: a sprite needs a canvas that file stands in from the start. */
});

/** The rect a settled flake is drawn as, at density 1, as `tracked` writes its corners. */
function rectOf(k: { x: number; y: number; s: number; rot: number }): string {
  const c = Math.cos(k.rot), s = Math.sin(k.rot), r3 = (x: number) => String(+x.toFixed(3));
  const at = (x: number, y: number) => `${r3(c * x - s * y + k.x)},${r3(s * x + c * y + k.y)}`;
  const x0 = -k.s / 2, y0 = -k.s * 0.42, x1 = x0 + k.s, y1 = y0 + k.s * 0.84;
  return [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)].join(' ');
}

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

/* Bursts full-width posts until the page-wide cap is used up; returns them. */
const fillCap = (prefix: string): Flakes[] => {
  const posts: Flakes[] = [];
  for (let i = 0; burstProbe.inFlight() < MAX_IN_FLIGHT; i++) { const p = make(`${prefix}${i}`); burst(p, 0); posts.push(p); }
  return posts;
};

describe('release', () => {
  test('a post dropped mid-burst gives its share of the cap back', () => {
    const a = make('rel-a', HUGE);
    burst(a, 0);
    assert.equal(burstProbe.inFlight(), MAX_IN_FLIGHT);
    release(a);
    assert.equal(burstProbe.inFlight(), 0);
    assert.equal(a.flying, 0);
    assert.equal(a.settled.length, a.total, 'its flakes are down where they were headed');
    assert.equal(stepBurst(a, 16), false);
    release(a);
    assert.equal(burstProbe.inFlight(), 0, 'twice does no harm');
    const b = make('rel-b', HUGE);
    burst(b, 20);
    assert.equal(b.flying, MAX_IN_FLIGHT, 'the second post flies its full share');
  });

  test('releasing twice while another post flies leaves that post its share', () => {
    const a = make('rel-d', HUGE), b = make('rel-e', HUGE);
    burst(a, 0);
    burst(b, 0);
    assert.equal(b.flying, 0, 'b found no room');
    assert.equal(burstProbe.inFlight(), MAX_IN_FLIGHT);
    release(a);
    assert.equal(burstProbe.inFlight(), 0);
    const c = make('rel-f', HUGE);
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
    fillCap('land-a');
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
