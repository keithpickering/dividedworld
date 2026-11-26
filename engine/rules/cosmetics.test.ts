import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEAR_VIEWS, beltHolder, inSquare, outfitOverhang, outfitProblems, pieceExtent, pieceHolds, pieceProblem, pieceShape, shownView } from './cosmetics.ts';
import type { CosmeticsSettings, GearShape, Piece } from './cosmetics.ts';

const settings: CosmeticsSettings = {
  gear: { wornMost: 12, reach: 0.4 },
  trophies: { shownMost: 3 },
  events: { windowMinutes: 15, dayMost: 4, outcomes: { line: 70, gear: 20, card: 10 }, gearRarity: { common: 80 }, cardRarity: { common: 80 } },
};
const piece = (over: Partial<Piece> = {}): Piece => ({ gear: 'hat', x: 0.5, y: 0.5, w: 0.5, turn: 0, layer: 0, view: null, ...over });

test('a piece is whole at each bound and refused one past it, naming the predicate', () => {
  assert.equal(pieceProblem(piece(), settings), null);
  for (const [over, ok] of [
    [{ x: 0 }, null], [{ x: 1 }, null], [{ x: -0.01 }, 'x'], [{ x: 1.01 }, 'x'],
    [{ y: 0 }, null], [{ y: 1 }, null], [{ y: -0.01 }, 'y'], [{ y: 1.01 }, 'y'],
    [{ w: 0.05 }, null], [{ w: 1.5 }, null], [{ w: 0.049 }, 'w'], [{ w: 1.51 }, 'w'],
    [{ turn: -180 }, null], [{ turn: 180 }, null], [{ turn: -181 }, 'turn'], [{ turn: 181 }, 'turn'],
    [{ layer: 0 }, null], [{ layer: 11 }, null], [{ layer: -1 }, 'layer'], [{ layer: 12 }, 'layer'], [{ layer: 1.5 }, 'layer'],
  ] as const) assert.equal(pieceProblem(piece(over), settings), ok, JSON.stringify(over));
  assert.equal(pieceProblem(piece({ x: Number.NaN }), settings), 'x');
});

test('an outfit of twelve is whole, and a thirteenth piece is refused', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => piece({ gear: `g${i}`, layer: i }));
  const held = Object.fromEntries(twelve.map((p) => [p.gear, 1]));
  assert.deepEqual(outfitProblems(twelve, held, {}, settings), []);
  const thirteen = [...twelve, piece({ gear: 'g12', layer: 12 })];
  assert.match(outfitProblems(thirteen, { ...held, g12: 1 }, {}, settings).join('\n'), /13 pieces.*at most 12/);
});

test('two pieces on one layer are refused, naming both gear', () => {
  const said = outfitProblems([piece({ gear: 'a', layer: 2 }), piece({ gear: 'b', layer: 2 })], { a: 1, b: 1 }, {}, settings).join('\n');
  assert.match(said, /"b" shares layer 2 with "a"/);
});

test('a gear worn more times than the account\'s free copies is refused, naming it', () => {
  const two = [piece({ gear: 'stache', layer: 0 }), piece({ gear: 'stache', layer: 1 })];
  assert.match(outfitProblems(two, { stache: 1 }, {}, settings).join('\n'), /"stache" is worn 2 times here, and 1 copy is free/);
  assert.deepEqual(outfitProblems(two, { stache: 2 }, {}, settings), []);
  assert.match(outfitProblems([piece({ gear: 'stache' })], { stache: 1 }, { stache: 1 }, settings).join('\n'), /"stache" is worn 1 time here, and 0 copies are free/);
  assert.match(outfitProblems([piece({ gear: 'ghost' })], {}, {}, settings).join('\n'), /"ghost".*0 copies are free/);
});

test('a piece at the portrait\'s top-left quarter lands in the square cut there, in the square\'s own coordinates', () => {
  const inside = inSquare(piece({ x: 0.25, y: 0.25, w: 0.1, turn: 30, layer: 3 }), { x: 0, y: 0, w: 0.5, h: 0.5 });
  assert.deepEqual(inside, { gear: 'hat', x: 0.5, y: 0.5, w: 0.2, turn: 30, layer: 3, view: null });
  const moved = inSquare(piece({ x: 0.5, y: 0.5, w: 0.25 }), { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  assert.deepEqual([moved.x, moved.y, moved.w], [0.5, 0.5, 0.5]);
  const whole = inSquare(piece(), { x: 0, y: 0, w: 1, h: 1 });
  assert.deepEqual([whole.x, whole.y, whole.w], [0.5, 0.5, 0.5]);
});

test('a belt is held by the latest standing award, and the one before it again once that is reversed', () => {
  assert.equal(beltHolder([]), null);
  const first = { character: 'ann', at: '2026-01-01T00:00:00Z' };
  const second = { character: 'bo', at: '2026-02-01T00:00:00Z' };
  assert.equal(beltHolder([first, second]), 'bo');
  assert.equal(beltHolder([second, first]), 'bo');
  assert.equal(beltHolder([first, { ...second, reversed: true }]), 'ann');
  assert.equal(beltHolder([{ ...first, reversed: true }, { ...second, reversed: true }]), null);
});

test('a belt is held by the truly latest award, whatever form its time is written in, and a tie never depends on array order', () => {
  const whole = { character: 'ann', at: '2026-01-01T00:00:00Z' };
  const half = { character: 'bo', at: '2026-01-01T00:00:00.500Z' };
  assert.equal(beltHolder([whole, half]), 'bo');
  assert.equal(beltHolder([half, whole]), 'bo');
  const offset = { character: 'cy', at: '2026-01-01T01:00:00+00:00' };
  const zulu = { character: 'di', at: '2026-01-01T00:30:00Z' };
  assert.equal(beltHolder([zulu, offset]), 'cy');
  const west = { character: 'ed', at: '2026-01-01T00:00:00-05:00' };
  assert.equal(beltHolder([west, offset]), 'ed');
  assert.equal(beltHolder([{ character: 'zz', at: 'not a time' }, whole]), 'ann');
  assert.equal(beltHolder([{ character: 'zz', at: 'not a time' }]), null);
  const a = { character: 'ann', at: '2026-03-01T00:00:00Z' };
  const b = { character: 'bo', at: '2026-03-01T00:00:00+00:00' };
  assert.equal(beltHolder([a, b]), 'bo');
  assert.equal(beltHolder([b, a]), 'bo');
});

test('outfitOverhang: how far the highest piece stands above the slot, in slot widths, never below 0', () => {
  const aspects: Record<string, number> = { cap: 0.5, tall: 2 };
  /* Each item's one view, its pivot at its center: today's center-and-aspect rule. */
  const shapeOf = (p: Piece) => { const a = aspects[p.gear]; return a === undefined ? undefined : pieceShape(p, centered(a)); };
  /* A cap at y 0.05, w 0.76, aspect 0.5, in a slot 2 tall: half-height 0.19, center 0.1, so 0.09 above. */
  assert.ok(Math.abs(outfitOverhang([piece({ gear: 'cap', y: 0.05, w: 0.76 })], shapeOf, 2, 0.4) - 0.09) < 1e-9);
  assert.equal(outfitOverhang([piece({ gear: 'cap', y: 0.5, w: 0.76 })], shapeOf, 2, 0.4), 0);
  assert.equal(outfitOverhang([], shapeOf, 2, 0.4), 0);
  /* A piece turned a quarter has its width for height: 1.0 tall art of w 0.5 (aspect 2) turns to half-height 0.25 at center 0.2 (y 0.1). */
  assert.ok(Math.abs(outfitOverhang([piece({ gear: 'tall', y: 0.1, w: 0.5, turn: 90 })], shapeOf, 2, 0.4) - 0.05) < 1e-9);
  assert.ok(Math.abs(outfitOverhang([piece({ gear: 'tall', y: 0.1, w: 0.5, turn: 0 })], shapeOf, 2, 0.4) - 0.3) < 1e-9);
  /* Art the instance does not know is skipped, as Outfit skips it. */
  assert.equal(outfitOverhang([piece({ gear: 'nope', y: 0, w: 1 })], shapeOf, 2, 0.4), 0);
  /* Capped at the settings' reach, where the layer's clip cuts. */
  assert.equal(outfitOverhang([piece({ gear: 'tall', y: 0, w: 1 })], shapeOf, 2, settings.gear.reach), 0.4);
  /* Tallness null reads as 2; a shorter slot moves the center up. */
  assert.equal(outfitOverhang([piece({ gear: 'cap', y: 0.05, w: 0.76 })], shapeOf, null, 0.4), outfitOverhang([piece({ gear: 'cap', y: 0.05, w: 0.76 })], shapeOf, 2, 0.4));
  assert.ok(outfitOverhang([piece({ gear: 'cap', y: 0.1, w: 0.76 })], shapeOf, 1, 0.4) > outfitOverhang([piece({ gear: 'cap', y: 0.1, w: 0.76 })], shapeOf, 2, 0.4));
  /* The highest of several wins. */
  assert.ok(Math.abs(outfitOverhang([piece({ gear: 'cap', y: 0.05, w: 0.76 }), piece({ gear: 'tall', y: 0.1, w: 0.5 })], shapeOf, 2, 0.4) - 0.3) < 1e-9);
});

/** An item with one view of the given aspect, its pivot at its center. */
function centered(aspect: number): GearShape {
  return { default: 'front', views: { front: { width: 100, height: 100 * aspect, pivot: { x: 50, y: 50 * aspect } } } };
}
const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);
const twoViews: GearShape = {
  default: 'front',
  views: { front: { width: 400, height: 200, pivot: { x: 200, y: 150 } }, 'side-left': { width: 280, height: 220, pivot: { x: 100, y: 165 } } },
};

test('shownView: a shipped view comes back, an unshipped one and null give the default', () => {
  assert.deepEqual(GEAR_VIEWS, ['side-left', 'three-quarter-left', 'front', 'three-quarter-right', 'side-right']);
  assert.equal(shownView(twoViews, 'side-left'), 'side-left');
  assert.equal(shownView(twoViews, 'side-right'), 'front');
  assert.equal(shownView(twoViews, null), 'front');
});

test('pieceShape: the shown view, scaled to the default view and pivoted in its own picture', () => {
  const dflt = pieceShape(piece({ w: 0.5 }), twoViews);
  near(dflt.w, 0.5, 'default w'); near(dflt.aspect, 0.5, 'default aspect'); near(dflt.px, 0.5, 'default px'); near(dflt.py, 0.75, 'default py');
  const side = pieceShape(piece({ w: 0.5, view: 'side-left' }), twoViews);
  near(side.w, 0.35, 'w'); near(side.aspect, 220 / 280, 'aspect'); near(side.px, 100 / 280, 'px'); near(side.py, 0.75, 'py');
  assert.deepEqual(pieceShape(piece({ w: 0.5, view: 'side-right' }), twoViews), dflt);
});

test('pieceExtent: the turned box about the pivot, in units of the box width', () => {
  const sq = (px: number, py: number) => ({ w: 0.5, aspect: 0.5, px, py });
  /* Pivot at the center, unturned: today's center-and-aspect box. Slot 2 tall, y 0.5 puts the pivot at 1. */
  const c = pieceExtent(piece({ x: 0.5, y: 0.5 }), sq(0.5, 0.5), 2);
  near(c.left, 0.25, 'left'); near(c.right, 0.75, 'right'); near(c.top, 0.875, 'top'); near(c.bottom, 1.125, 'bottom');
  /* Pivot at the bottom-left corner, unturned: extends only right and up. */
  const b = pieceExtent(piece({ x: 0.5, y: 0.5 }), sq(0, 1), 2);
  near(b.left, 0.5, 'left'); near(b.right, 1, 'right'); near(b.top, 0.75, 'top'); near(b.bottom, 1, 'bottom');
  /* The same turned 90 degrees clockwise: corners (0,-.25) (.5,-.25) (.5,0) (0,0) about (.5,1) land at x 0..0.25, y 0..0.5 from the pivot. */
  const t = pieceExtent(piece({ x: 0.5, y: 0.5, turn: 90 }), sq(0, 1), 2);
  near(t.left, 0.5, 'left'); near(t.right, 0.75, 'right'); near(t.top, 1, 'top'); near(t.bottom, 1.5, 'bottom');
});

test('pieceHolds: a point just inside a turned corner holds, just outside does not', () => {
  const shape = { w: 0.5, aspect: 0.5, px: 0, py: 1 };
  const p = piece({ x: 0.5, y: 0.5, turn: 90 });
  /* Turned box is x 0.5..0.75, y 1..1.5 (slot 2 tall); its corner (0.75, 1.5) is the unturned (0.5, -0.25) corner. */
  assert.equal(pieceHolds(p, shape, 2, 0.74, 1.49), true);
  assert.equal(pieceHolds(p, shape, 2, 0.76, 1.49), false);
  assert.equal(pieceHolds(p, shape, 2, 0.74, 1.51), false);
  /* The unturned rectangle's old place is empty once turned: (0.9, 0.9) is inside it unturned, not turned. */
  assert.equal(pieceHolds(piece({ x: 0.5, y: 0.5 }), shape, 2, 0.9, 0.9), true);
  assert.equal(pieceHolds(p, shape, 2, 0.9, 0.9), false);
});

test('outfitOverhang: a cap pivoted at its band stands above the slot by the picture above the pivot', () => {
  const cap: GearShape = { default: 'front', views: { front: { width: 100, height: 60, pivot: { x: 50, y: 50 } } } };
  /* w 0.5: picture 0.5 wide, 0.3 tall, 0.25 above the pivot at y 0. */
  const shapeOf = (p: Piece) => pieceShape(p, cap);
  near(outfitOverhang([piece({ gear: 'cap', y: 0, w: 0.5 })], shapeOf, 2, 0.4), 0.25, 'overhang');
});

test('pieceProblem: a view must be null or one of the five', () => {
  assert.equal(pieceProblem(piece({ view: 'back' as never }), settings), 'view');
  assert.equal(pieceProblem(piece({ view: null }), settings), null);
  for (const v of GEAR_VIEWS) assert.equal(pieceProblem(piece({ view: v }), settings), null, v);
  assert.equal(pieceProblem(piece({ turn: 999, view: 'back' as never }), settings), 'turn');
  assert.equal(pieceProblem(piece({ layer: 99, view: 'back' as never }), settings), 'view');
});

test('pieceShape throws when the item has no view named by its default', () => {
  const broken: GearShape = { default: 'front', views: { 'side-left': { width: 100, height: 100, pivot: { x: 50, y: 50 } } } };
  assert.throws(() => pieceShape(piece(), broken), /no front view/);
  assert.throws(() => pieceShape(piece({ view: 'side-left' }), broken), /no front view/);
});

test('pieceHolds: a turn other than a quarter about a pivot that is no corner', () => {
  const shape = { w: 0.5, aspect: 0.5, px: 0.5, py: 0.5 };
  /* Pivot (0.5, 1); the unturned picture reaches 0.25 either side across and 0.125 up and down. */
  const at = (turn: number, dx: number, dy: number) => pieceHolds(piece({ x: 0.5, y: 0.5, turn }), shape, 2, 0.5 + dx, 1 + dy);
  const c = Math.SQRT1_2;
  /* Turned 45: the picture's long axis points down-right. */
  assert.equal(at(45, 0.2 * c, 0.2 * c), true);
  assert.equal(at(45, 0.3 * c, 0.3 * c), false);
  assert.equal(at(45, -0.1 * c, 0.1 * c), true);
  assert.equal(at(45, -0.15 * c, 0.15 * c), false);
  /* Turned -90: the long axis points up and down, so it holds 0.2 above but not 0.2 beside, where unturned it would. */
  assert.equal(at(-90, 0, -0.2), true);
  assert.equal(at(-90, 0, -0.3), false);
  assert.equal(at(-90, 0.2, 0), false);
  assert.equal(at(0, 0.2, 0), true);
});

test('pieceHolds agrees with pieceExtent: nothing outside the bounds holds, and a corner nudged inward does', () => {
  const shapes = [{ w: 0.5, aspect: 0.5, px: 0.5, py: 0.5 }, { w: 0.4, aspect: 1.5, px: 0.2, py: 0.9 }, { w: 0.5, aspect: 0.5, px: 0, py: 1 }];
  for (const shape of shapes) for (const turn of [-135, -90, -30, 0, 45, 90, 180]) {
    const p = piece({ x: 0.4, y: 0.3, turn });
    const box = pieceExtent(p, shape, 2);
    const what = `${JSON.stringify(shape)} turn ${turn}`;
    for (let i = -10; i <= 40; i++) for (let j = -10; j <= 60; j++) {
      const qx = i / 20 + 0.013, qy = j / 20 + 0.017;
      if (qx < box.left || qx > box.right || qy < box.top || qy > box.bottom) assert.equal(pieceHolds(p, shape, 2, qx, qy), false, `${what} (${qx}, ${qy})`);
    }
    /* Each unturned corner, pulled 1% toward the pivot's picture center, turned about the pivot into place. */
    const rad = (turn * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
    const l = -shape.px * shape.w, r = (1 - shape.px) * shape.w, t = -shape.py * shape.w * shape.aspect, b = (1 - shape.py) * shape.w * shape.aspect;
    for (const [cx, cy] of [[l, t], [r, t], [r, b], [l, b]] as const) {
      const dx = cx + ((l + r) / 2 - cx) * 0.01, dy = cy + ((t + b) / 2 - cy) * 0.01;
      assert.equal(pieceHolds(p, shape, 2, p.x + dx * cos - dy * sin, p.y * 2 + dx * sin + dy * cos), true, `${what} corner (${cx}, ${cy})`);
    }
  }
});

test('outfitOverhang: turned half a circle, a band-pivot cap leaves only what was below the pivot above it', () => {
  const cap: GearShape = { default: 'front', views: { front: { width: 100, height: 60, pivot: { x: 50, y: 50 } } } };
  const shapeOf = (p: Piece) => pieceShape(p, cap);
  /* w 0.5: 0.25 above the pivot and 0.05 below. Turned 180 the part above goes below and the part below goes above. */
  near(outfitOverhang([piece({ gear: 'cap', y: 0, w: 0.5, turn: 180 })], shapeOf, 2, 0.4), 0.05, 'turned');
  near(outfitOverhang([piece({ gear: 'cap', y: 0, w: 0.5, turn: 0 })], shapeOf, 2, 0.4), 0.25, 'unturned');
});
