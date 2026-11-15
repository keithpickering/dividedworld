/**
 * The chair's pieces and shade (docs/plans/2026-11-15-steel-chair-plan.md, Task 4): shut, the pieces are the 46 by 90 by 8 box the
 * body simulates; open, the seat stands 88 degrees from the back frame and the rear frame -32 degrees.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { addThrow, bodies, cornersOf, createWorld, DEPTH, HALF, rng, settle, throwOf } from './body.ts';
import { BOX, depthOf, drawn, GIVE, INSET, K, PERSPECTIVE, piecesOf, project, REACH, ROOM, shadeOf, transformOf, Z_FRONT, type Piece } from './chair.ts';

/** A piece's corners in the chair's frame: its centered rectangle through its column-major matrix. */
function corners(p: Piece): [number, number, number][] {
  const m = p.matrix;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const x = (sx * p.width) / 2;
    const y = (sy * p.height) / 2;
    return [m[0] * x + m[4] * y + m[12], m[1] * x + m[5] * y + m[13], m[2] * x + m[6] * y + m[14]] as [number, number, number];
  });
}
const byName = (ps: Piece[], name: string) => ps.find((p) => p.name === name)!;

describe('piecesOf', () => {
  test('shut, every piece fits inside the 46 by 90 by 8 box', () => {
    const ps = piecesOf(0);
    assert.ok(ps.length > 4);
    for (const p of ps) for (const [x, y, z] of corners(p)) {
      assert.ok(Math.abs(x) <= BOX.width / 2 + 1e-6);
      assert.ok(Math.abs(y) <= BOX.height / 2 + 1e-6);
      assert.ok(Math.abs(z) <= BOX.depth / 2 + 1e-6);
    }
  });
  test('shut, the seat and the rear frame lie in the back frame plane (normals along z)', () => {
    for (const n of ['seat', 'rear']) assert.ok(Math.abs(Math.abs(byName(piecesOf(0), n).normal[2]) - 1) < 1e-6);
  });
  test("open, the seat's top edge lies on the hinge line (within the 2 px the seat is set back from it)", () => {
    const seat = byName(piecesOf(1), 'seat');
    const hingeY = BOX.height / 2 - 58;
    const edge = corners(seat).sort((p, q) => Math.hypot(p[1] - hingeY, p[2]) - Math.hypot(q[1] - hingeY, q[2])).slice(0, 2);
    assert.ok(Math.abs(edge[0][0] - edge[1][0]) > 41, 'the two nearest corners are the ends of one edge');
    for (const [, y, z] of edge) assert.ok(Math.hypot(y - hingeY, z) <= 2 + 1e-6, `corner at y ${y}, z ${z} is off the hinge line ${hingeY}`);
  });
  test('at a fold of 0.5 the seat is half way: 44 degrees from the back frame', () => {
    const ps = piecesOf(0.5);
    const angle = (n: number[]) => Math.atan2(n[1], n[2]) * 180 / Math.PI;
    assert.ok(Math.abs(Math.abs(angle(byName(ps, 'seat').normal) - angle(byName(ps, 'back').normal)) - 44) < 1e-3);
  });
  test("every piece's left and top are minus half its size", () => {
    for (const f of [0, 1]) for (const p of piecesOf(f)) {
      assert.equal(p.left, -p.width / 2, p.name);
      assert.equal(p.top, -p.height / 2, p.name);
    }
  });
  test('sizes: back frame 46 by 90, backrest 42 by 26, seat 42 by 38, rear 42 by 58', () => {
    const ps = piecesOf(1);
    const size = (n: string) => [byName(ps, n).width, byName(ps, n).height];
    assert.deepEqual(size('back'), [46, 90]);
    assert.deepEqual(size('backrest'), [42, 26]);
    assert.deepEqual(size('seat'), [42, 38]);
    assert.deepEqual(size('rear'), [42, 58]);
  });
  test('a tube is two strips crossed at right angles', () => {
    const tubes = piecesOf(1).filter((p) => p.kind === 'tube');
    assert.equal(tubes.length % 2, 0);
    assert.ok(tubes.length > 0);
    const [a, b] = tubes;
    const dot = a.normal[0] * b.normal[0] + a.normal[1] * b.normal[1] + a.normal[2] * b.normal[2];
    assert.ok(Math.abs(dot) < 1e-9);
  });
});

describe('shadeOf', () => {
  const rgb = (b: number) => `rgb(${b}, ${b + 6}, ${b + 16})`;
  test('the three axes', () => {
    assert.equal(shadeOf([0, 0, 1]), rgb(220));
    assert.equal(shadeOf([0, -1, 0]), rgb(190));
    assert.equal(shadeOf([0, 1, 0]), rgb(110));
    assert.equal(shadeOf([1, 0, 0]), rgb(150));
  });
  test('clamps to 60 and 235', () => {
    assert.equal(shadeOf([0, -2, 2]), rgb(235));
    assert.equal(shadeOf([0, 5, 0]), rgb(60));
  });
  test('a back-facing piece is as bright as a front-facing one', () => {
    assert.equal(shadeOf([0, 0, -1]), shadeOf([0, 0, 1]));
  });
});

/* ---------- the oblique projection: the floor seen from above, as a 2D game draws it ---------- */

/** The radius of the sphere every corner of a chair lies in (body.ts's RADIUS, which it does not export). */
const REACH_OF_CHAIR = Math.hypot(...HALF);

describe('the projection', () => {
  test("its constants come from body.ts: Z_FRONT is the glass, its give and the chair's reach; K lifts a flat chair at the very back by the room", () => {
    assert.ok(GIVE > 0);
    assert.equal(Z_FRONT, DEPTH + GIVE + REACH_OF_CHAIR);
    assert.equal(ROOM, 28);
    /* A chair lying flat at the very back, turned so that its short side (46) runs along z, the worst case: its center is at -(DEPTH + give) and
       its front edge 23 forward. (Turned with its long side, 90, along z the front edge is 45 forward and the lift is less.) */
    const front = -(DEPTH + GIVE) + HALF[0];
    assert.ok(Math.abs(K * (Z_FRONT - front) - ROOM) < 1e-9);
    assert.ok(K > 0 && K < 1);
  });

  test('a point on the floor at the front is drawn on the bottom border, and the floor recedes up the screen', () => {
    assert.deepEqual(project({ x: 17, y: 300, z: Z_FRONT }), { x: 17, y: 300 });
    const mid = project({ x: 17, y: 300, z: 0 });
    const back = project({ x: 17, y: 300, z: -(DEPTH + GIVE) });
    assert.ok(mid.y < 300 && back.y < mid.y, 'the farther back, the higher');
    /* A flat chair at the very back is lifted by no more than the room, whichever way it is turned about the vertical: its front edge is at least 23 forward of its middle. */
    for (let half = HALF[0]; half <= HALF[1]; half += 2) assert.ok(300 - project({ x: 0, y: 300, z: -(DEPTH + GIVE) + half }).y <= ROOM + 1e-9, `half-depth ${half}`);
  });

  test('the side walls are drawn exactly on the left and right borders at every depth', () => {
    for (let z = -Z_FRONT; z <= Z_FRONT; z += 7) {
      assert.equal(project({ x: 0, y: 120, z }).x, 0);
      assert.equal(project({ x: 640, y: 120, z }).x, 640);
    }
  });

  test('a point nearer the reader is drawn lower: y changes by K for each px of z', () => {
    const a = project({ x: 1, y: 100, z: 10 }), b = project({ x: 1, y: 100, z: 30 });
    assert.ok(Math.abs(b.y - a.y - 20 * K) < 1e-9);
  });

  test('over 200 seeded rests, no corner of a resting chair is drawn below the bottom border or outside the side borders', () => {
    let perspective = 0, deepest = -Infinity, shallowest = Infinity, rests = 0;
    for (const [w, h] of [[300, 200], [900, 320], [360, 260]] as const) {
      for (let s = 1; s <= 70; s++) {
        const r = rng(s * 7919 + w);
        const world = createWorld(w, h, h);
        for (let i = 0; i < 1 + (s % 3); i++) addThrow(world, throwOf(r, { left: 10, top: 8, width: w - 20, height: h - 36 }));
        settle(world, 12);
        for (const b of bodies(world)) {
          assert.ok(b.asleep, 'every throw sleeps');
          rests++;
          const centre = { x: b.position.x, y: b.position.y, z: b.position.z };
          for (const c of cornersOf(b)) {
            deepest = Math.max(deepest, c[2]); shallowest = Math.min(shallowest, c[2]);
            const flat = project({ x: c[0], y: c[1], z: c[2] });
            /* The oblique projection alone holds the bounds (up to the physics' own contact tolerance, 0.5 px). */
            assert.ok(flat.x >= -0.5 && flat.x <= w + 0.5, `x ${flat.x} outside 0..${w}`);
            assert.ok(flat.y <= h + 0.5, `y ${flat.y} below the floor ${h}`);
            /* The per-chair perspective moves a corner by at most REACH more, and drawn() is the whole picture. */
            const d = drawn(c, centre);
            perspective = Math.max(perspective, Math.hypot(d.x - flat.x, d.y - flat.y));
            assert.ok(d.x >= -0.5 - REACH && d.x <= w + 0.5 + REACH, `x ${d.x} outside the walls by more than the perspective can add`);
            assert.ok(d.y <= h + 0.5 + REACH, `y ${d.y} below the border by more than the perspective can add`);
          }
        }
      }
    }
    assert.ok(rests >= 200, `${rests} rests`);
    assert.ok(deepest <= Z_FRONT, `a corner reached z ${deepest}, past Z_FRONT ${Z_FRONT}`);
    assert.ok(shallowest >= -Z_FRONT, `a corner reached z ${shallowest}`);
    assert.ok(perspective <= REACH + 1e-9, `the perspective moved a corner ${perspective}, past its stated reach ${REACH}`);
    assert.ok(REACH < 2 && PERSPECTIVE >= 700);
  });

  /* The chair's own perspective can move a corner outward by up to REACH, which would draw a chair that touches a wall a pixel or so past the
     border. So the world the body simulates is inset by INSET (= REACH) on each side and at the floor, and drawn INSET to the right: the bound
     then holds by construction, to the physics' own tolerance. */
  test('with the world inset by INSET, no corner of any resting chair is drawn outside the content area at all', () => {
    assert.ok(INSET >= REACH && INSET < 2);
    let worst = -Infinity, rests = 0;
    for (const [w, h] of [[300, 200], [900, 320], [360, 260], [200, 150]] as const) {
      for (let s = 1; s <= 60; s++) {
        const r = rng(s * 104729 + w);
        const world = createWorld(w - 2 * INSET, h - INSET, h - INSET);
        for (let i = 0; i < 1 + (s % 3); i++) addThrow(world, throwOf(r, { left: 10, top: 8, width: w - 20, height: h - 36 }));
        settle(world, 12);
        for (const b of bodies(world)) {
          rests++;
          const centre = { x: b.position.x + INSET, y: b.position.y, z: b.position.z };
          for (const c of cornersOf(b)) {
            const d = drawn([c[0] + INSET, c[1], c[2]], centre);
            worst = Math.max(worst, -d.x, d.x - w, d.y - h);
          }
        }
      }
    }
    assert.ok(rests >= 200, `${rests} rests`);
    assert.ok(worst <= 0.01, `a corner is drawn ${worst} px past a border`);
  });
});

/** Numbers indexed without an `undefined` (the matrices below are always 16 long). */
type Dense = number[] & { [i: number]: number };

/** A tiny evaluator for the group's transform string: translate3d, perspective, matrix3d and scale3d, left to right. */
function evaluate(transform: string): Dense {
  const mulM = (a: Dense, b: Dense): Dense => { const o = new Array<number>(16).fill(0) as Dense; for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
  let m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as Dense;
  for (const [, fn, args] of transform.matchAll(/([a-z0-9]+)\(([^)]*)\)/gu)) {
    const n = args!.split(',').map((x) => parseFloat(x)) as Dense;
    let t: Dense;
    if (fn === 'translate3d') t = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, n[0], n[1], n[2], 1] as Dense;
    else if (fn === 'perspective') t = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1 / n[0], 0, 0, 0, 1] as Dense;
    else if (fn === 'scale3d') t = [n[0], 0, 0, 0, 0, n[1], 0, 0, 0, 0, n[2], 0, 0, 0, 0, 1] as Dense;
    else if (fn === 'matrix3d') t = n;
    else throw new Error(`unknown ${fn}`);
    m = mulM(m, t);
  }
  return m;
}
const through = (m: Dense, v: [number, number, number]) => {
  const x = m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], y = m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], w = m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15];
  return { x: x / w, y: y / w };
};

describe('transformOf', () => {
  /* A rotation of 0.7 rad about the axis (1, 2, 3), as a column-major matrix3d. */
  const rot = (() => {
    const [ax, ay, az] = [1, 2, 3].map((n) => n / Math.hypot(1, 2, 3)) as [number, number, number];
    const c = Math.cos(0.7), s = Math.sin(0.7), t = 1 - c;
    return [t * ax * ax + c, t * ax * ay + s * az, t * ax * az - s * ay, 0, t * ax * ay - s * az, t * ay * ay + c, t * ay * az + s * ax, 0, t * ax * az + s * ay, t * ay * az - s * ax, t * az * az + c, 0, 0, 0, 0, 1];
  })() as Dense;
  const R = (v: [number, number, number]): [number, number, number] => [rot[0] * v[0] + rot[4] * v[1] + rot[8] * v[2], rot[1] * v[0] + rot[5] * v[1] + rot[9] * v[2], rot[2] * v[0] + rot[6] * v[1] + rot[10] * v[2]];

  test("puts a chair-frame point where `drawn` says, perspective about the chair's own center included", () => {
    const pos = { x: 140, y: 150, z: -30 };
    const m = evaluate(transformOf(pos, 1, rot));
    for (const v of [[0, 0, 0], [23, 45, 4], [-23, 45, -4], [23, -45, 4]] as [number, number, number][]) {
      const o = R(v);
      const want = drawn([pos.x + o[0], pos.y + o[1], pos.z + o[2]], pos);
      const got = through(m, v);
      assert.ok(Math.abs(got.x - want.x) < 0.01 && Math.abs(got.y - want.y) < 0.01, `${JSON.stringify(got)} vs ${JSON.stringify(want)}`);
    }
  });
  test("the chair's center is drawn exactly at the projection of its position, however it is turned and scaled", () => {
    const pos = { x: 60, y: 90, z: 20 };
    for (const s of [1, 2.2]) {
      const c = through(evaluate(transformOf(pos, s, rot)), [0, 0, 0]);
      assert.ok(Math.abs(c.x - 60) < 0.01 && Math.abs(c.y - project(pos).y) < 0.01);
    }
  });
  test('a scale grows the chair about its center, in all three axes', () => {
    const pos = { x: 0, y: 0, z: 0 };
    const one = through(evaluate(transformOf(pos, 1, rot)), [10, 0, 0]);
    const two = through(evaluate(transformOf(pos, 2, rot)), [10, 0, 0]);
    assert.ok(Math.hypot(two.x, two.y - project(pos).y) > 1.9 * Math.hypot(one.x, one.y - project(pos).y));
  });
});

describe('depthOf', () => {
  test('a chair nearer the reader paints over one farther back: a larger integer for a larger z', () => {
    assert.ok(Number.isInteger(depthOf(3.2)));
    assert.ok(depthOf(10) > depthOf(-10));
    assert.ok(depthOf(10.4) >= depthOf(10));
    assert.ok(depthOf(-Z_FRONT) >= 0);
  });
});
