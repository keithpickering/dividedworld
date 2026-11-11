import { describe, expect, test } from 'vitest';
import { pieceProblem, type Piece } from '../../rules/cosmetics.ts';
import { dragged, dragSized, dragTurned, fit, hit, layered, nudge, renumber, resized, turned } from './moves.ts';

const piece = (over: Partial<Piece> = {}): Piece => ({ gear: 'band', x: 0.5, y: 0.5, w: 0.4, turn: 0, layer: 0, ...over });
const rules = { gear: { wornMost: 12, reach: 0.4 }, trophies: { shownMost: 3 } } as Parameters<typeof pieceProblem>[1];

describe('the pointer\'s moves, in the portrait\'s fractions', () => {
  test('a drag moves the piece by the pointer\'s distance over the stage\'s size, and stays on the portrait', () => {
    expect(dragged(piece(), 50, -100, 500, 1000)).toMatchObject({ x: 0.6, y: 0.4 });
    expect(dragged(piece(), 5000, -5000, 500, 1000)).toMatchObject({ x: 1, y: 0 });
  });

  test('a corner drag scales the width by how far the pointer is from the center now over then, within the least and the most', () => {
    expect(dragSized(piece(), 100, 150).w).toBe(0.6);
    expect(dragSized(piece(), 100, 1).w).toBe(0.05);
    expect(dragSized(piece(), 100, 10000).w).toBe(1.5);
    expect(dragSized(piece(), 0, 50).w).toBe(0.4);
  });

  test('the round handle turns the piece by the angle the pointer swept, wrapped and held to 180 either way', () => {
    expect(dragTurned(piece({ turn: 10 }), 0, 30).turn).toBe(40);
    expect(dragTurned(piece({ turn: 170 }), 0, 30).turn).toBe(-160);
    expect(dragTurned(piece(), 10, -10).turn).toBe(-20);
  });
});

describe('the buttons\' and keys\' moves', () => {
  test('a nudge, a size and a turn round to whole hundredths and never leave pieceProblem\'s bounds', () => {
    let p = piece();
    for (let i = 0; i < 300; i++) p = nudge(p, i % 2 ? 0.05 : -0.01, 0.05);
    for (let i = 0; i < 40; i++) p = resized(p, i < 20 ? 0.05 : -0.05);
    for (let i = 0; i < 100; i++) p = turned(p, 5);
    expect(pieceProblem(p, rules)).toBeNull();
    expect(fit(piece({ x: 0.1 + 0.2 })).x).toBe(0.3);
  });
});

describe('layers', () => {
  const three = renumber([piece({ gear: 'a', layer: 7 }), piece({ gear: 'b', layer: 2 }), piece({ gear: 'c', layer: 5 })]);

  test('renumbering puts the pieces on layers 0, 1, 2 in the order they were in', () => {
    expect(three.map((p) => [p.gear, p.layer])).toEqual([['a', 0], ['b', 1], ['c', 2]]);
  });

  test('bringing forward swaps with the piece above, sending back with the one below, and the ends stay', () => {
    expect(layered(three, 0, 1)?.pieces.map((p) => p.gear)).toEqual(['b', 'a', 'c']);
    expect(layered(three, 1, -1)?.index).toBe(0);
    expect(layered(three, 2, 1)).toBeNull();
    expect(layered(three, 0, -1)).toBeNull();
  });
});

describe('what is under the pointer', () => {
  const aspect = () => 0.5;

  test('the topmost piece whose turned box holds the point', () => {
    const pieces = [piece({ gear: 'low', w: 0.8 }), piece({ gear: 'high', w: 0.2, layer: 1 })];
    expect(hit(pieces, aspect, 250, 500, 500, 1000)).toBe(1);
    expect(hit(pieces, aspect, 100, 500, 500, 1000)).toBe(0);
    expect(hit(pieces, aspect, 10, 10, 500, 1000)).toBeNull();
  });

  test('a turned piece is hit where it is, not where its unturned box was', () => {
    /* 200 wide, 100 tall at the center of a 500 by 1000 stage, turned a quarter: 100 wide, 200 tall. */
    const turnedUp = [piece({ turn: 90 })];
    expect(hit(turnedUp, aspect, 250, 420, 500, 1000)).toBe(0);
    expect(hit(turnedUp, aspect, 320, 500, 500, 1000)).toBeNull();
  });
});
