import { describe, expect, test } from 'vitest';
import { ARC_FLOOR, ARC_SPAN, CARD_WIDTH, GROUP_GAP, TURN_FROM, TURN_TO, arcSlots, handOrder } from './arc.ts';
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
