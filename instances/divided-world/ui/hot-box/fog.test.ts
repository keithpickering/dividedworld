/**
 * Hot Box's fog, as numbers (docs/plans/2026-11-15-hot-box-fog-plan.md, Task 4): the field and its picture, with no DOM. Each test names the defect it is
 * for. Three of the plan's figures are not the bench's arithmetic and are written here as measured, with the plan's figure beside them: the drive down to
 * the model has a 70 ms constant and the flow carries a little fog in, so a cell held clear is within 0.05 of it after 300 ms (measured: 0.036 at worst; the plan says 0.02 after 250), which the picture draws as no fog at all; eight rounds of the bench's pressure solve lower the
 * flow's divergence by a few percent (the plan says to a quarter); carried texture eases back over 3.5 s a fold, so a hard sweep is at rest within 30 s
 * (the plan says 12), and nothing in it moves or is thinned long before.
 *
 *   node --experimental-strip-types --no-warnings=ExperimentalWarning --test instances/divided-world/ui/hot-box/fog.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FOG, cellOrigin, divergence, fogAt, makeCloud, makeField, pageCloud, paintFog, project, rowsOf, stepField, type FogField, type FogInput } from './fog.ts';
import { SMOKE, covered, extendTrail, fogAlpha, holeRadius, type Clearing, type TrailPoint } from './smoke.ts';
import { mulberry32 } from '../../cards/whoops/splat.ts';

const GREEN: readonly [number, number, number] = [155, 226, 138];
const W = 760, H = 300, R = holeRadius(W), FRAME = 1000 / 60;

/** The whole picture of a field, as bytes. */
function picture(field: FogField, o: Partial<Parameters<typeof paintFog>[4]> = {}): Uint8ClampedArray {
  const rows = { y0: 0, y1: field.gh }, out = new Uint8ClampedArray(field.gw * field.gh * 4);
  paintFog(field, pageCloud(), out, rows, { color: GREEN, alpha: fogAlpha(1), t: 0, ...o });
  return out;
}

/** A mouse's clearing at a point, open. */
const at = (x: number, y: number): Clearing => ({ x, y, openedAt: 0, leftAt: null, hold: 0 });

/** Steps a field with a pointer moving right along `y` from `x0` at `speed` px a second until `until` ms, then gone; calls `each` after every step. */
function sweep(field: FogField, o: { x0: number; y: number; speed: number; until: number; total: number; trail?: boolean; rounds?: number }, each?: (now: number, x: number) => void): void {
  let trail: TrailPoint[] = [], now = 0, x = o.x0;
  while (now < o.total) {
    now += FRAME;
    const moving = now <= o.until;
    if (moving) x += (o.speed * FRAME) / 1000;
    const clearings = moving ? [at(x, o.y)] : [];
    if (o.trail) trail = moving ? extendTrail(trail, x, o.y, now, R) : trail.filter((p) => now - p.leftAt < SMOKE.wake);
    const input: FogInput = {
      clearings: moving ? [{ x, y: o.y, vx: o.speed, vy: 0 }] : [], trail, radius: R, ...(o.rounds === undefined ? {} : { rounds: o.rounds }),
      target: (px, py) => covered(px, py, clearings, R, now, false, trail),
    };
    stepField(field, FRAME, input);
    each?.(now, x);
  }
}

test('the numbers are the bench\'s', () => {
  assert.equal(FOG.cell, 5);
  assert.deepEqual([FOG.sheet1.scale, FOG.sheet1.dx, FOG.sheet1.dy], [3.2, 7, -3.2]);
  assert.deepEqual([FOG.sheet2.scale, FOG.sheet2.dx, FOG.sheet2.dy], [8.5, -2.6, -1.4]);
  assert.deepEqual([FOG.light.gain, FOG.light.most, FOG.shade.gain, FOG.shade.most], [0.85, 0.5, 1.9, 0.85]);
  assert.deepEqual([FOG.sink, FOG.damp, FOG.settle, FOG.rounds, FOG.burst.ms, FOG.maxStep], [70, 900, 3500, 8, 260, 50]);
});

test('the ghost: fog at rest is exactly its alpha in every cell, whatever the time', () => {
  const field = makeField(W, H);
  for (const [strength, t] of [[1, 0], [1, 1234], [0.5, 98765], [0, 4_000_000]] as const) {
    const alpha = fogAlpha(strength), px = picture(field, { alpha, t });
    const want = Math.round(alpha * 255);
    for (let i = 3; i < px.length; i += 4) assert.equal(px[i], want, `alpha at byte ${i}, t ${t}`);
  }
});

test('shaded, in the caster\'s color: many tones, some lighter and some darker, and the hue is the color\'s', () => {
  const px = picture(makeField(W, H), { t: 500 });
  const hue = (r: number, g: number, b: number): number => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return 0;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  const seen = [new Set<number>(), new Set<number>(), new Set<number>()];
  let lighter = 0, darker = 0, sum = [0, 0, 0], count = 0;
  const own = GREEN[0] + GREEN[1] + GREEN[2];
  for (let i = 0; i < px.length; i += 4) {
    for (let c = 0; c < 3; c++) { seen[c]!.add(px[i + c]!); sum[c]! += px[i + c]!; }
    const lum = px[i]! + px[i + 1]! + px[i + 2]!;
    if (lum > own + 6) lighter++;
    if (lum < own - 6) darker++;
    count++;
  }
  for (const s of seen) assert.ok(s.size >= 40, `${s.size} values of a channel`);
  assert.ok(lighter > count / 20, `${lighter} of ${count} lighter than the color`);
  assert.ok(darker > count / 20, `${darker} of ${count} darker than the color`);
  const mean = hue(sum[0]! / count, sum[1]! / count, sum[2]! / count), want = hue(...GREEN);
  assert.ok(Math.abs(mean - want) <= 12, `mean hue ${mean.toFixed(1)} against ${want.toFixed(1)}`);
});

test('the picture is where the caller is told: a cell is one pixel, a cell outside the box on every side', () => {
  const field = makeField(W, H);
  assert.equal(field.gw, Math.ceil(W / 5) + 3);
  assert.deepEqual(cellOrigin(field, 0, 0), { x: -5, y: -5 });
  /* The rows for a tile hold a row beyond each end, and stop at the grid. */
  assert.deepEqual(rowsOf(field, 100, 200), { y0: 20, y1: 42 });
  assert.deepEqual(rowsOf(field, 0, H), { y0: 0, y1: field.gh - 1 });
  assert.deepEqual(rowsOf(field, 0, 1e9), { y0: 0, y1: field.gh });
});

test('the model is the floor: a cell held clear is within 0.05 of the model 300 ms on, and is drawn clear, through 200 random steps', () => {
  const field = makeField(W, H), rnd = mulberry32(7);
  let x = 200, y = 150, vx = 60, vy = 20, now = 0;
  /* How long each cell's center has been in a clearing's clear core without a break, ms. */
  const inside = new Float32Array(field.gw * field.gh);
  let checked = 0, worst = 0;
  for (let k = 0; k < 200; k++) {
    const dt = 8 + rnd() * 30;
    now += dt;
    if (rnd() < 0.1) { vx = (rnd() - 0.5) * 240; vy = (rnd() - 0.5) * 120; }
    x = Math.min(W - 60, Math.max(60, x + (vx * dt) / 1000));
    y = Math.min(H - 60, Math.max(60, y + (vy * dt) / 1000));
    const clearings = [at(x, y)];
    stepField(field, dt, { clearings: [{ x, y, vx, vy }], trail: [], radius: R, target: (px, py) => covered(px, py, clearings, R, now, false) });
    for (let cy = 1; cy < field.gh - 1; cy++) for (let cx = 1; cx < field.gw - 1; cx++) {
      const o = cellOrigin(field, cx, cy), px = o.x + 2.5, py = o.y + 2.5, i = cy * field.gw + cx;
      inside[i] = covered(px, py, clearings, R, now, false) === 0 ? inside[i]! + dt : 0;
      if (inside[i]! >= 300) { checked++; worst = Math.max(worst, fogAt(field, px, py).d); }
    }
    assert.ok(worst <= 0.05, `step ${k}: ${worst} in a cell held clear`);
  }
  /* That much fog is drawn as none: the wisps take more than it from the alpha (`paintFog`). */
  assert.ok(0.05 - 0.95 * FOG.wisp.base * FOG.wisp.bite < 0);
  assert.ok(checked > 1000, `${checked} cells checked`);
});

test('the fog moves: a clearing moving right drags the fog with it, and leaves it thinner behind than ahead', () => {
  const field = makeField(W, H);
  let last = 0;
  sweep(field, { x0: 200, y: 150, speed: 400, until: 300, total: 300 }, (now, x) => {
    last = x;
    if (Math.abs(now - 100) > FRAME / 2) return;
    let sum = 0, n = 0;
    for (let py = 150 - R; py <= 150 + R; py += 5) for (let px = x - R; px <= x + R; px += 5) if (Math.hypot(px - x, py - 150) < R) { sum += fogAt(field, px, py).u; n++; }
    assert.ok(sum / n > 20, `mean flow ${sum / n} px a second at 100 ms`);
  });
  assert.ok(last > 300);
  const behind = fogAt(field, last - R * 0.9, 150).d, ahead = fogAt(field, last + R * 0.9, 150).d;
  assert.ok(behind < ahead - 0.2, `behind ${behind}, ahead ${ahead}`);
});

test('it goes around: the pressure rounds lower the flow\'s divergence, more rounds lower it more, and none leave it', () => {
  const dragged = (): { field: FogField; box: NonNullable<FogField['box']> } => {
    const field = makeField(W, H);
    sweep(field, { x0: 300, y: 150, speed: 400, until: 100, total: 100, rounds: 0 });
    return { field, box: field.box! };
  };
  const before = (() => { const { field, box } = dragged(); return divergence(field, box); })();
  const after = (rounds: number): number => { const { field, box } = dragged(); project(field, box, rounds, 1); return divergence(field, box); };
  assert.ok(before > 0.1, `divergence before: ${before}`);
  assert.equal(after(0), before);
  const eight = after(FOG.rounds), forty = after(40);
  assert.ok(eight < before * 0.99, `eight rounds: ${eight} from ${before}`);
  assert.ok(forty < eight, `forty rounds: ${forty} against ${eight}`);
});

test('it closes, within the wake: a cell the pointer passed is under half fog at half the wake and whole by one and a half', () => {
  const field = makeField(W, H);
  let passed = -1;
  const seen = new Map<number, number>();
  sweep(field, { x0: 100, y: 150, speed: 400, until: 1250, total: 5000, trail: true }, (now, x) => {
    if (passed < 0 && x >= 300) passed = now;
    if (passed < 0) return;
    for (const share of [0.5, 1.5]) if (Math.abs(now - passed - share * SMOKE.wake) <= FRAME / 2) seen.set(share, fogAt(field, 300, 150).d);
  });
  assert.ok(seen.get(0.5)! < 0.5, `at half the wake: ${seen.get(0.5)}`);
  assert.ok(seen.get(1.5)! >= 0.97, `at one and a half: ${seen.get(1.5)}`);
});

test('it settles to rest exactly: nothing moves or is thinned 12 s on, and by 30 s the field holds nothing at all', () => {
  const field = makeField(W, H);
  let quietAt = -1;
  sweep(field, { x0: 100, y: 150, speed: 400, until: 1250, total: 30_000, trail: true }, (now) => { if (quietAt < 0 && field.quiet) quietAt = now; });
  assert.ok(quietAt > 0 && quietAt < 12_000, `quiet at ${quietAt}`);
  assert.equal(field.box, null);
  assert.equal(field.store, null);
  for (const [x, y] of [[300, 150], [5, 5], [700, 280]] as const) assert.deepEqual(fogAt(field, x, y), { d: 1, u: 0, v: 0, ox: 0, oy: 0 });
  /* And at rest it is the ghost again. */
  const px = picture(field);
  for (let i = 3; i < px.length; i += 4) assert.equal(px[i], Math.round(fogAlpha(1) * 255));
});

test('only disturbed cells are stepped, and only their rows are stored, whatever the post\'s size', () => {
  const field = makeField(2400, 20_000);
  assert.equal(field.store, null);
  /* Nothing reaches a field at rest: nothing is stepped and nothing is made. */
  assert.equal(stepField(field, FRAME, { clearings: [], trail: [], radius: 90, target: () => 1 }), 0);
  assert.equal(field.store, null);
  const cells = stepField(field, FRAME, { clearings: [{ x: 1200, y: 10_000 }], trail: [], radius: 90, target: (x, y) => covered(x, y, [at(1200, 10_000)], 90, 1, false) });
  assert.ok(cells > 0 && cells < 4000, `${cells} cells`);
  assert.ok(field.store!.rows < 200, `${field.store!.rows} rows stored of ${field.gh}`);
});

test('a view clips the box: nothing outside it is stepped, and what leaves it is at rest when it is seen again', () => {
  const field = makeField(W, 4000);
  const input = (view: { top: number; bottom: number }): FogInput => ({ clearings: [{ x: 300, y: 1000 }], trail: [], radius: R, view, target: (x, y) => covered(x, y, [at(300, 1000)], R, 1, false) });
  for (let k = 0; k < 20; k++) stepField(field, FRAME, input({ top: 800, bottom: 1400 }));
  assert.ok(fogAt(field, 300, 1000).d < 0.1);
  /* The reader scrolls away: the clearing is out of the view, so its cells are let go. */
  assert.equal(stepField(field, FRAME, input({ top: 2000, bottom: 2600 })), 0);
  assert.equal(field.store, null);
  assert.equal(fogAt(field, 300, 1000).d, 1);
  /* A view that cuts through the clearing steps only its side of it. */
  stepField(field, FRAME, input({ top: 1000, bottom: 1600 }));
  assert.ok(field.box!.y0 >= rowsOf(field, 1000, 1600).y0);
});

test('deterministic: the same inputs give the same bytes, with no Math.random', (t) => {
  t.mock.method(Math, 'random', () => { throw new Error('Math.random'); });
  const run = (): Uint8ClampedArray => {
    const field = makeField(W, H);
    sweep(field, { x0: 100, y: 150, speed: 400, until: 600, total: 900, trail: true });
    return picture(field, { t: 900 });
  };
  assert.deepEqual(run(), run());
  const a = makeCloud(3), b = makeCloud(3), c = makeCloud(4);
  assert.deepEqual(a.t1, b.t1);
  assert.notDeepEqual(a.t1, c.t1);
});

test('a long frame is clamped: five seconds moves the fog no farther than 50 ms does', () => {
  const run = (dt: number): Uint8ClampedArray => {
    const field = makeField(W, H);
    for (let k = 0; k < 10; k++) stepField(field, dt, { clearings: [{ x: 300, y: 150, vx: 400, vy: 0 }], trail: [], radius: R, target: (x, y) => covered(x, y, [at(300, 150)], R, 1, false) });
    return picture(field);
  };
  assert.deepEqual(run(5000), run(50));
  assert.notDeepEqual(run(50), run(16));
});

test('a tap bursts: the fog is pushed outward from the point', () => {
  const field = makeField(W, H);
  for (let k = 0; k < 6; k++) stepField(field, FRAME, { clearings: [{ x: 300, y: 150, burst: true }], trail: [], radius: R, target: (x, y) => covered(x, y, [at(300, 150)], R, 1, false) });
  assert.ok(fogAt(field, 340, 150).u > 5, `right of the tap: ${fogAt(field, 340, 150).u}`);
  assert.ok(fogAt(field, 260, 150).u < -5, `left of it: ${fogAt(field, 260, 150).u}`);
  assert.ok(fogAt(field, 300, 190).v > 5, `below it: ${fogAt(field, 300, 190).v}`);
});

test('thinned fog loses alpha and never gains it; clear fog is nothing', () => {
  const field = makeField(W, H);
  for (let k = 0; k < 30; k++) stepField(field, FRAME, { clearings: [{ x: 300, y: 150 }], trail: [], radius: R, target: (x, y) => covered(x, y, [at(300, 150)], R, 1, false) });
  const px = picture(field), A = Math.round(fogAlpha(1) * 255);
  const alphaAt = (x: number, y: number): number => px[((Math.floor(y / 5) + 1) * field.gw + Math.floor(x / 5) + 1) * 4 + 3]!;
  assert.equal(alphaAt(300, 150), 0);
  assert.equal(alphaAt(700, 20), A);
  let between = 0;
  for (let i = 3; i < px.length; i += 4) { assert.ok(px[i]! <= A); if (px[i]! > 0 && px[i]! < A) between++; }
  assert.ok(between > 50, `${between} cells of wisps at the rim`);
});

test('drawn from the model directly: no field is read, the fog is the model\'s inside its reach and whole outside it', () => {
  const field = makeField(W, H), clearings = [at(300, 150)];
  /* A field left disturbed somewhere else is not what is drawn. */
  for (let k = 0; k < 20; k++) stepField(field, FRAME, { clearings: [{ x: 600, y: 150 }], trail: [], radius: R, target: (x, y) => covered(x, y, [at(600, 150)], R, 1, false) });
  const A = Math.round(fogAlpha(1) * 255);
  const px = picture(field, { direct: { target: (x, y) => covered(x, y, clearings, R, 1, true), reach: { left: 300 - R, top: 150 - R, right: 300 + R, bottom: 150 + R } } });
  const alphaAt = (x: number, y: number): number => px[((Math.floor(y / 5) + 1) * field.gw + Math.floor(x / 5) + 1) * 4 + 3]!;
  assert.equal(alphaAt(300, 150), 0);
  assert.equal(alphaAt(600, 150), A);
  /* With no reach, the model is not asked at all. */
  const whole = picture(field, { direct: { target: () => { throw new Error('asked'); }, reach: null } });
  for (let i = 3; i < whole.length; i += 4) assert.equal(whole[i], A);
});

test('a band is open across the whole width by its share, over the field or the model', () => {
  const field = makeField(W, H), A = Math.round(fogAlpha(1) * 255);
  const alphaAt = (px: Uint8ClampedArray, x: number, y: number): number => px[((Math.floor(y / 5) + 1) * field.gw + Math.floor(x / 5) + 1) * 4 + 3]!;
  const open = picture(field, { bands: [{ top: 100, bottom: 120, o: 1 }] });
  for (const x of [2, 380, 757]) { assert.equal(alphaAt(open, x, 110), 0); assert.equal(alphaAt(open, x, 90), A); assert.equal(alphaAt(open, x, 125), A); }
  const half = picture(field, { bands: [{ top: 100, bottom: 120, o: 0.5 }], direct: { target: () => 1, reach: null } });
  assert.ok(alphaAt(half, 380, 110) > 0 && alphaAt(half, 380, 110) < A);
});

test('a post reads the page\'s one cloud at its own offset', () => {
  assert.equal(pageCloud(), pageCloud());
  const field = makeField(W, H);
  assert.notDeepEqual(picture(field, { phase: { x: 0, y: 0 } }), picture(field, { phase: { x: 411, y: 77 } }));
});
