/**
 * Whoops!'s pure half (design, section 11; refinements design section 2): the splat as a field of balls, kept round,
 * and the shading by the ink's luminance.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DESIGN, THRESHOLD, contrast, covers, fieldAt, fieldGrid, luminance, makeSplat, mulberry32, shading, unitPx, type Box, type Splat } from './splat.ts';
import { NAMED_COLORS } from '../../../../engine/bbcode/parse.ts';

const WIDE: Box = { w: 988, h: 330 };
const TALL: Box = { w: 390, h: 1200 };

test('seeding: one seed gives the same balls twice, two seeds differ, and nothing reads Math.random', () => {
  const real = Math.random;
  let calls = 0;
  Math.random = () => { calls++; return real(); };
  try {
    assert.deepEqual(makeSplat(20261029), makeSplat(20261029));
    assert.notDeepEqual(makeSplat(1).balls, makeSplat(2).balls);
    assert.notEqual(makeSplat(1).placement.cx, makeSplat(2).placement.cx);
  } finally {
    Math.random = real;
  }
  assert.equal(calls, 0);
  const a = mulberry32(5), b = mulberry32(5);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.notEqual(mulberry32(5)(), mulberry32(6)());
});

test('the constants are the design box and the iso level', () => {
  assert.deepEqual(DESIGN, { w: 1.25, h: 1 });
  assert.equal(THRESHOLD, 0.42);
  assert.ok(Math.abs(unitPx({ w: 1000, h: 1250 }) - 1000) < 1e-9);
});

const lone = (r: number): Splat => ({ balls: [{ x: 0.625, y: 0.5, r }], placement: { cx: 0.625, cy: 0.5 } });

test('the threshold: a lone ball\'s edge sits at its radius', () => {
  for (const box of [WIDE, TALL]) {
    const r = 0.1, rPx = r * unitPx(box);
    const cx = box.w / 2, cy = box.h / 2;
    assert.equal(covers(lone(r), box, (cx + rPx - 0.5) / box.w, cy / box.h), true, 'just inside');
    assert.equal(covers(lone(r), box, (cx + rPx + 0.5) / box.w, cy / box.h), false, 'just outside');
    assert.equal(covers(lone(r), box, cx / box.w, cy / box.h), true);
    assert.equal(fieldAt(lone(r), box, 0, 0), 0);
  }
});

/** A ball with no other ball within reach of it: a droplet or fleck that stands apart. */
function isolated(s: Splat) {
  return s.balls.find((b, i) => b.r > 0.01 && s.balls.every((o, j) => j === i || Math.hypot(o.x - b.x, o.y - b.y) > 2 * (o.r + b.r) + 0.02));
}

test('kept round: a droplet\'s covered extent across equals its extent down, within a pixel, on a wide and a tall box', () => {
  let tested = 0;
  for (let seed = 1; seed <= 20 && tested < 3; seed++) {
    const s = makeSplat(seed), d = isolated(s);
    if (!d) continue;
    tested++;
    for (const box of [WIDE, TALL]) {
      const px = d.x / DESIGN.w * box.w, py = d.y * box.h, reach = 2 * d.r * unitPx(box) + 2;
      const extent = (dx: number, dy: number) => {
        let n = 0;
        for (let t = -reach; t <= reach; t += 0.25) if (covers({ balls: [d], placement: s.placement }, box, (px + t * dx) / box.w, (py + t * dy) / box.h)) n += 0.25;
        return n;
      };
      const across = extent(1, 0), down = extent(0, 1);
      assert.ok(across > 0);
      assert.ok(Math.abs(across - down) <= 1, `seed ${seed} on ${box.w}x${box.h}: ${across} across, ${down} down`);
      assert.ok(Math.abs(across - 2 * d.r * unitPx(box)) <= 1);
    }
  }
  assert.ok(tested >= 1, 'found a standing-apart droplet');
});

/*
 * The splat spreads over the whole box, not a band at its top. The plan asked for 70% of the grid; the bench's approved splat,
 * whose constants these are, covers 58 to 71% over seeds 1 to 40 on both boxes, so the floor is 55% (a plan gap in the PR), and
 * each quarter of the box is reached, top and bottom alike, so a band would fail.
 */
test('whole body: at least 55% of a 20 by 20 grid across the box is inked, its center is, and so is each quarter of it', () => {
  for (const box of [WIDE, TALL]) {
    for (const seed of [1, 2, 3, 99, 2 ** 31 - 1]) {
      const s = makeSplat(seed);
      let hit = 0;
      const quarters = [0, 0, 0, 0];
      for (let i = 0; i < 20; i++) {
        for (let j = 0; j < 20; j++) {
          if (!covers(s, box, (i + 0.5) / 20, (j + 0.5) / 20)) continue;
          hit++;
          quarters[(i < 10 ? 0 : 1) + (j < 10 ? 0 : 2)]!++;
        }
      }
      assert.ok(hit / 400 >= 0.55, `seed ${seed} on ${box.w}x${box.h}: ${hit / 4}%`);
      assert.equal(covers(s, box, 0.5, 0.5), true, 'the center');
      for (const [q, n] of quarters.entries()) assert.ok(n / 100 >= 0.4, `seed ${seed} on ${box.w}x${box.h}: quarter ${q} at ${n}%`);
    }
  }
});

test('rounded joins: from the core out through an arm\'s first bead the field never dips below the threshold', () => {
  for (const box of [WIDE, TALL]) {
    for (const seed of [1, 2, 3, 99]) {
      const s = makeSplat(seed);
      // makeSplat builds 1 core + 6 inner + 15 ring balls = 22, so index 22 is the first arm's first bead
      const core = s.balls[0]!, bead = s.balls[22]!;
      const ax = core.x / DESIGN.w * box.w, ay = core.y * box.h, bx = bead.x / DESIGN.w * box.w, by = bead.y * box.h;
      for (let t = 0; t <= 1; t += 0.02) {
        const v = fieldAt(s, box, (ax + (bx - ax) * t) / box.w, (ay + (by - ay) * t) / box.h);
        assert.ok(v >= THRESHOLD, `seed ${seed} on ${box.w}x${box.h}: field ${v.toFixed(3)} at ${t.toFixed(2)}`);
      }
    }
  }
});

test('fieldGrid agrees with fieldAt at every pixel center, on a non-integer box at density 2', () => {
  const s = makeSplat(7), box = { w: 37.5, h: 41.3 }, density = 2;
  const g = fieldGrid(s, box, density);
  const gw = Math.ceil(box.w * density), gh = Math.ceil(box.h * density);
  assert.equal(g.length, gw * gh);
  let inked = 0;
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const want = fieldAt(s, box, (i + 0.5) / density / box.w, (j + 0.5) / density / box.h);
      if (want > 0) inked++;
      assert.ok(Math.abs(g[j * gw + i]! - want) < 1e-5, `pixel ${i},${j}: ${g[j * gw + i]} against ${want}`);
    }
  }
  assert.ok(inked > gw * gh * 0.2, `${inked} inked pixels, so the comparison has something to compare`);
});

test('fieldGrid cost follows the balls\' reach: the inner loop visits under 20% of balls times pixels on a tall box', () => {
  const s = makeSplat(7), work = { visits: 0 };
  const big = fieldGrid(s, TALL, 1, work);
  assert.equal(big.length, 390 * 1200);
  const all = s.balls.length * big.length;
  assert.ok(work.visits > 0);
  assert.ok(work.visits < all * 0.2, `${work.visits} visits of ${all} (${(100 * work.visits / all).toFixed(1)}%)`);
});

test('luminance is the WCAG relative luminance of the primaries', () => {
  assert.ok(Math.abs(luminance('#ff0000') - 0.2126) < 1e-9);
  assert.ok(Math.abs(luminance('#00ff00') - 0.7152) < 1e-9);
  assert.ok(Math.abs(luminance('#0000ff') - 0.0722) < 1e-9);
  assert.equal(luminance('#000'), 0);
  assert.ok(Math.abs(luminance('white') - 1) < 1e-9);
});

test('the shading: the highlight falls and the shadows rise with the ink\'s luminance', () => {
  const inks = ['#000000', '#800000', '#808080', '#c0c0c0', '#ffffff'].map((c) => shading(c));
  for (let i = 1; i < inks.length; i++) {
    assert.ok(inks[i]!.highlight < inks[i - 1]!.highlight, 'highlight falls');
    assert.ok(inks[i]!.edgeShadow > inks[i - 1]!.edgeShadow, 'edge shadow rises');
    assert.ok(inks[i]!.underside > inks[i - 1]!.underside, 'underside rises');
  }
  assert.ok(shading('#000').highlight > 0.2);
  assert.equal(shading('#fff').highlight, 0);
  assert.equal(shading('black').edgeShadow, 0);
  assert.deepEqual(shading('#f00'), shading('#ff0000'));
  assert.deepEqual(shading('White'), shading('#ffffff'));
});

test('every named color the card accepts has a shading', () => {
  for (const name of NAMED_COLORS) assert.ok(Number.isFinite(shading(name).highlight), name);
  assert.throws(() => shading('chartreuse'), RangeError);
});

test('contrast is the WCAG ratio, 1 to 21', () => {
  assert.ok(Math.abs(contrast('#000000', '#ffffff') - 21) < 1e-9);
  assert.equal(contrast('#777777', '#777777'), 1);
});
