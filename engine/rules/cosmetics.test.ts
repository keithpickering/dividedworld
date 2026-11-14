import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beltHolder, inSquare, outfitOverhang, outfitProblems, pieceProblem } from './cosmetics.ts';
import type { CosmeticsSettings, Piece } from './cosmetics.ts';

const settings: CosmeticsSettings = {
  gear: { wornMost: 12, reach: 0.4 },
  trophies: { shownMost: 3 },
  events: { windowMinutes: 15, dayMost: 4, outcomes: { line: 70, gear: 20, card: 10 }, gearRarity: { common: 80 }, cardRarity: { common: 80 } },
};
const piece = (over: Partial<Piece> = {}): Piece => ({ gear: 'hat', x: 0.5, y: 0.5, w: 0.5, turn: 0, layer: 0, ...over });

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
  assert.deepEqual(inside, { gear: 'hat', x: 0.5, y: 0.5, w: 0.2, turn: 30, layer: 3 });
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
  const aspectOf = (g: string) => aspects[g];
  /* A cap at y 0.05, w 0.76, aspect 0.5, in a slot 2 tall: half-height 0.19, center 0.1, so 0.09 above. */
  assert.ok(Math.abs(outfitOverhang([piece({ gear: 'cap', y: 0.05, w: 0.76 })], aspectOf, 2, 0.4) - 0.09) < 1e-9);
  assert.equal(outfitOverhang([piece({ gear: 'cap', y: 0.5, w: 0.76 })], aspectOf, 2, 0.4), 0);
  assert.equal(outfitOverhang([], aspectOf, 2, 0.4), 0);
  /* A piece turned a quarter has its width for height: 1.0 tall art of w 0.5 (aspect 2) turns to half-height 0.25 at center 0.2 (y 0.1). */
  assert.ok(Math.abs(outfitOverhang([piece({ gear: 'tall', y: 0.1, w: 0.5, turn: 90 })], aspectOf, 2, 0.4) - 0.05) < 1e-9);
  assert.ok(Math.abs(outfitOverhang([piece({ gear: 'tall', y: 0.1, w: 0.5, turn: 0 })], aspectOf, 2, 0.4) - 0.3) < 1e-9);
  /* Art the instance does not know is skipped, as Outfit skips it. */
  assert.equal(outfitOverhang([piece({ gear: 'nope', y: 0, w: 1 })], aspectOf, 2, 0.4), 0);
  /* Capped at the settings' reach, where the layer's clip cuts. */
  assert.equal(outfitOverhang([piece({ gear: 'tall', y: 0, w: 1 })], aspectOf, 2, settings.gear.reach), 0.4);
  /* Tallness null reads as 2; a shorter slot moves the center up. */
  assert.equal(outfitOverhang([piece({ gear: 'cap', y: 0.05, w: 0.76 })], aspectOf, null, 0.4), outfitOverhang([piece({ gear: 'cap', y: 0.05, w: 0.76 })], aspectOf, 2, 0.4));
  assert.ok(outfitOverhang([piece({ gear: 'cap', y: 0.1, w: 0.76 })], aspectOf, 1, 0.4) > outfitOverhang([piece({ gear: 'cap', y: 0.1, w: 0.76 })], aspectOf, 2, 0.4));
  /* The highest of several wins. */
  assert.ok(Math.abs(outfitOverhang([piece({ gear: 'cap', y: 0.05, w: 0.76 }), piece({ gear: 'tall', y: 0.1, w: 0.5 })], aspectOf, 2, 0.4) - 0.3) < 1e-9);
});
