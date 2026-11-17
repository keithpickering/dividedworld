import { describe, expect, test } from 'vitest';
import { ARC_FLOOR, ARC_SPAN, CARD_WIDTH, GROUP_GAP, SWIPE_REACH, SWIPE_SPREAD, SWIPE_STEP, TURN_FROM, TURN_TO, arcSlots, handOrder, swipeKeyframes, swipeMiddle, swipePose } from './arc.ts';
import type { CardFace } from './faces.ts';

const face = (key: string, play: CardFace['play'], unknown = false): CardFace => ({
  key, name: key, alignment: 'sweet', tag: 'Sweet', extra: 0, stack: 1,
  art: { color: 'var(--kb-glass-neon)', ink: 'var(--kb-glass-ink-neon)' }, tagline: '', summary: '', describe: '', rarity: 'common', play, kind: play,
  ...(unknown ? { unknown: true as const } : {}),
});

/** n cards in the given groups' sizes, as the group index of each card in order. */
const groupsOf = (...sizes: number[]): number[] => sizes.flatMap((s, g) => Array<number>(s).fill(g));
const rowsOf = (slots: readonly { row: number }[]): number => new Set(slots.map((s) => s.row)).size;
/** The steps between neighbors within one row, left to right. */
const gaps = (slots: readonly { x: number; row: number }[], row: number): number[] => {
  const xs = slots.filter((s) => s.row === row).map((s) => s.x);
  return xs.slice(1).map((x, i) => x - xs[i]!);
};

describe('the order of a hand', () => {
  const move = face('move', 'cast');
  const reversal = face('reversal', 'set');
  const gimmick = face('gimmick', 'use');
  const keep = face('keep', 'keep');
  const gone = face('gone', 'cast', true);
  const all = (faces: CardFace[]) => faces.map((f) => ({ card: f.key, held: 1 }));

  test('a Gimmick listed first stands after a Move and a Reversal', () => {
    const faces = [gimmick, reversal, move];
    expect(handOrder(all(faces), faces).map((c) => c.face.key)).toEqual(['move', 'reversal', 'gimmick']);
  });

  test('a keep card and a card the instance no longer has stand last, in one group', () => {
    const faces = [gone, keep, gimmick, move];
    const order = handOrder(all(faces), faces);
    expect(order.map((c) => c.face.key)).toEqual(['move', 'gimmick', 'gone', 'keep']);
    expect(order.map((c) => c.group)).toEqual([0, 1, 2, 2]);
  });

  test('a group is the index among the groups present, and the faces order holds within it', () => {
    const second = face('second', 'use');
    const faces = [second, gimmick, move];
    expect(handOrder(all(faces), faces).map((c) => [c.face.key, c.group])).toEqual([['move', 0], ['second', 1], ['gimmick', 1]]);
  });

  test('an empty hand, and a held card the instance does not list, draw nothing', () => {
    expect(handOrder([], [move])).toEqual([]);
    expect(handOrder([{ card: 'elsewhere', held: 2 }], [move])).toEqual([]);
    expect(arcSlots([])).toEqual([]);
  });

  test('a kind held three times is one entry; a kind held none is absent', () => {
    const faces = [move, reversal];
    expect(handOrder([{ card: 'move', held: 3 }, { card: 'reversal', held: 0 }], faces).map((c) => [c.face.key, c.held])).toEqual([['move', 3]]);
  });
});

describe('the slots of an arc', () => {
  test('one, two and three kinds stand where the board puts them', () => {
    expect(arcSlots([0])).toEqual([{ x: 10, y: -260, deg: -1, row: 0 }]);
    expect(arcSlots([0, 0])).toEqual([{ x: -60, y: -260, deg: -11, row: 0 }, { x: 72, y: -250, deg: 10, row: 0 }]);
    expect(arcSlots([0, 0, 0])).toEqual([
      { x: -60, y: -260, deg: -11, row: 0 }, { x: 10, y: -260, deg: -1, row: 0 }, { x: 72, y: -250, deg: 10, row: 0 },
    ]);
  });

  test('four kinds in one group stand a step apart and turn from the first angle to the last', () => {
    const s = arcSlots([0, 0, 0, 0]);
    expect(s.map((c) => c.x)).toEqual([-126, -60, 6, 72]);
    expect(s[0]!.deg).toBeCloseTo(TURN_FROM);
    expect(s[3]!.deg).toBeCloseTo(TURN_TO);
    expect(rowsOf(s)).toBe(1);
    // The ends stand at the board's heights, and the middle bows up above the straight line between them.
    expect(s[0]!.y).toBeCloseTo(-260);
    expect(s[3]!.y).toBeCloseTo(-250);
    expect(s[1]!.y).toBeLessThan(-260 + 10 / 3 - 1);
    expect(s[2]!.y).toBeLessThan(-260 + 20 / 3 - 1);
  });

  test('22 kinds in three groups fit one row, each a step of at least the floor apart and a half step more at a group change', () => {
    const groups = groupsOf(8, 7, 7);
    const s = arcSlots(groups);
    expect(rowsOf(s)).toBe(1);
    expect(s[0]!.x).toBeGreaterThanOrEqual(72 + CARD_WIDTH - ARC_SPAN - 1e-9);
    const g = gaps(s, 0);
    const step = Math.min(...g);
    expect(step).toBeGreaterThanOrEqual(ARC_FLOOR);
    // The row fills the span: 21 steps and two half steps, from the card's right edge back to the span's left.
    expect(step).toBeCloseTo((ARC_SPAN - CARD_WIDTH) / 22);
    expect(s[0]!.x).toBeCloseTo(72 + CARD_WIDTH - ARC_SPAN);
    g.forEach((d, i) => expect(d).toBeCloseTo(groups[i] !== groups[i + 1] ? step * (1 + GROUP_GAP) : step));
  });

  test('60 kinds take more than one row and no row is under the floor', () => {
    const s = arcSlots(groupsOf(20, 20, 20));
    expect(rowsOf(s)).toBeGreaterThan(1);
    for (let r = 0; r < rowsOf(s); r += 1) expect(Math.min(...gaps(s, r))).toBeGreaterThanOrEqual(ARC_FLOOR);
  });

  test('a back row with more group changes than the front row is held to the floor too', () => {
    // 51 kinds in two rows would split 26 and 25; the 25 carry three group changes, so their step falls under the floor.
    const s = arcSlots(groupsOf(48, 1, 1, 1));
    for (let r = 0; r < rowsOf(s); r += 1) expect(Math.min(...gaps(s, r))).toBeGreaterThanOrEqual(ARC_FLOOR);
  });

  test('200 kinds take four rows, the front row standing lowest', () => {
    const s = arcSlots(groupsOf(70, 65, 65));
    expect(rowsOf(s)).toBe(4);
    expect(s[0]!.row).toBe(0);
    expect(s.at(-1)!.row).toBe(3);
    expect(s.at(-1)!.y).toBeLessThan(s[0]!.y);
  });
});

describe('the swipe pose', () => {
  /** Each field to nine digits, so a -0 and a 0 for `deg` are the same pose. */
  const expectPose = (d: number, want: { x: number; y: number; deg: number; scale: number }) => {
    const got = swipePose(d);
    expect(got.x).toBeCloseTo(want.x, 9);
    expect(got.y).toBeCloseTo(want.y, 9);
    expect(got.deg).toBeCloseTo(want.deg, 9);
    expect(got.scale).toBeCloseTo(want.scale, 9);
  };

  test('the middle card stands 14px up, upright, 1.18 times its size and where the row puts it', () => {
    expectPose(0, { x: 0, y: -14, deg: 0, scale: 1.18 });
  });

  test('a card one step from the middle turns 6 degrees and drops 5px, at its own size, pushed 40px out from the middle', () => {
    expectPose(1, { x: 40, y: 5, deg: 6, scale: 1 });
  });

  test('a card two steps to the left turns -12 degrees and drops 20px, pushed 40px further left', () => {
    expectPose(-2, { x: -40, y: 20, deg: -12, scale: 1 });
  });

  test('a card five steps out turns at most 18 degrees and drops at most 40px', () => {
    expectPose(5, { x: 40, y: 40, deg: 18, scale: 1 });
  });

  test('half a step out is lifted half way, turns and drops in between, and is pushed most of the way out', () => {
    expectPose(0.5, { x: 40 * Math.sin((Math.PI / 2) * (0.5 / 0.7)), y: 0.625 - 7, deg: 3, scale: 1.09 });
  });

  test('the pose stops changing at SWIPE_REACH steps out, on either side', () => {
    for (const side of [1, -1]) {
      for (const beyond of [0.01, 1, 40]) expect(swipePose(side * (SWIPE_REACH + beyond))).toEqual(swipePose(side * SWIPE_REACH));
      expect(swipePose(side * (SWIPE_REACH - 0.1))).not.toEqual(swipePose(side * SWIPE_REACH));
    }
  });

  /*
   * The card in the middle stands above the rest, so as the middle passes from one card to its neighbor, half a step out, the two
   * change which stands above the other. Pushed out by SWIPE_SPREAD, the two stand apart for a stretch around that moment, so the
   * change shows nothing; at 66px apart and unspread, the middle card's neighbor would pop over it. The phone's postcard is 104 by
   * 156 and turns about its center.
   */
  const corners = (d: number) => {
    const { x, y, deg, scale } = swipePose(d);
    const a = (deg * Math.PI) / 180;
    const cx = d * SWIPE_STEP + x;
    return ([[-52, -78], [52, -78], [52, 78], [-52, 78]] as const).map(([u, v]) => [cx + scale * (u * Math.cos(a) - v * Math.sin(a)), y + scale * (u * Math.sin(a) + v * Math.cos(a))] as const);
  };
  /** The gap between two convex outlines along the axis that parts them most (negative where they overlap). */
  const gap = (p: ReturnType<typeof corners>, q: ReturnType<typeof corners>) => Math.max(...[p, q].flatMap((poly) => poly.map((_, i) => {
    const [x1, y1] = poly[i]!;
    const [x2, y2] = poly[(i + 1) % 4]!;
    const n = [y2 - y1, x1 - x2] as const;
    const along = (pts: typeof p) => pts.map(([x, y]) => x * n[0] + y * n[1]);
    const [a, b] = [along(p), along(q)];
    return Math.max(Math.min(...b) - Math.max(...a), Math.min(...a) - Math.max(...b)) / Math.hypot(...n);
  })));

  test('where the middle passes from a card to its neighbor, and for a fifth of a step either side, the two stand apart', () => {
    for (let at = 0.3; at <= 0.7 + 1e-9; at += 0.05) expect(gap(corners(-at), corners(1 - at)), `the middle ${at} steps from the left card`).toBeGreaterThan(0);
  });

  test('at rest the middle card still covers the edge of each neighbor, so the row reads as a hand', () => {
    expect(gap(corners(0), corners(1))).toBeLessThan(0);
    expect(gap(corners(0), corners(-1))).toBeLessThan(0);
  });

  test('SWIPE_SPREAD is what parts them: unspread, the two overlap where the middle passes', () => {
    expect(SWIPE_SPREAD).toBe(40);
    const unspread = (d: number) => corners(d).map(([x, y]) => [x - swipePose(d).x, y] as const);
    expect(gap(unspread(-0.5), unspread(0.5))).toBeLessThan(0);
  });
});

describe('the swipe pose as keyframes', () => {
  test('they run from SWIPE_REACH steps right of the middle to SWIPE_REACH steps left, each the pose at its distance', () => {
    const frames = swipeKeyframes();
    expect(frames[0]!.offset).toBe(0);
    expect(frames.at(-1)!.offset).toBe(1);
    expect(frames.length).toBeGreaterThan(40);
    for (const f of frames) {
      const { x, y, deg, scale } = swipePose(SWIPE_REACH - 2 * SWIPE_REACH * f.offset);
      expect(f).toEqual({ offset: f.offset, translate: `${x}px ${y}px`, rotate: `${deg}deg`, scale: String(scale) });
    }
  });

  test('a stop stands at the middle and at each step, where the pose has its corners', () => {
    const at = swipeKeyframes().map((f) => SWIPE_REACH - 2 * SWIPE_REACH * f.offset);
    for (let d = -SWIPE_REACH; d <= SWIPE_REACH; d += 1) expect(at.some((a) => Math.abs(a - d) < 1e-9), `a stop at ${d}`).toBe(true);
  });
});

describe('the middle of a swiped row', () => {
  test('the card whose center is nearest the middle is the one there', () => {
    expect(swipeMiddle([10, 76, 142], 80)).toBe(1);
  });

  test('a tie goes to the lower index', () => {
    expect(swipeMiddle([10, 76], 43)).toBe(0);
  });

  test('a row with no cards has no middle', () => {
    expect(swipeMiddle([], 0)).toBe(-1);
  });
});
