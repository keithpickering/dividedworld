import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dealWords, exposed, flapOf, fromPieces, liftsOf, peelStep, piecesOf, rollDiameter, roomOf, settle, stripsOf, stuckOf, type Measure, type TapePlay } from './tape.ts';
import type { Stretch } from '../autocorrect.ts';

const text = 'Big cats are';
const plays = [
  { id: 'a', phrase: 'big cats', replacement: 'small dogs' },
  { id: 'b', phrase: 'cats are', replacement: 'nobody asked' },
  { id: 'c', phrase: 'big cats', replacement: 'Wigglers' },
] satisfies TapePlay[];
// A fixed-width measure: 10px a letter in the words, 12px a letter in a replacement, 10px a space, 4px padding.
const measure: Measure = { words: (from, to) => (to - from) * 10, replacement: (t) => t.length * 12, space: 10, pad: 4 };

test('roomOf: the larger of the strips ending together sets the room after "cats", and "nobody asked" takes the room already inside it', () => {
  const { strips, stacks } = stripsOf(text, plays);
  assert.equal(strips.length, 3);
  assert.equal(stacks.length, 1);
  const room = roomOf(stacks[0]!, measure);
  // "big cats" (0-8): small dogs = 120 + 8 = 128 against words 80 -> 48 -> 5 spaces; Wigglers = 96 + 8 = 104 -> 24 -> 3. The larger wins.
  assert.equal(room.get(8), 5);
  // "cats are" (4-12): nobody asked = 144 + 8 = 152 against words 80 + 5 spaces inside it (50) = 130 -> 22 -> 3 spaces.
  assert.equal(room.get(12), 3);
  assert.deepEqual([...room.keys()], [8, 12]);
});

test('roomOf: a strip already wider than its replacement gets none, and one peeled before this load is left out', () => {
  const wide: Measure = { ...measure, words: (from, to) => (to - from) * 100 };
  assert.equal(roomOf(stripsOf(text, plays).stacks[0]!, wide).size, 0);
  const { stacks } = stripsOf(text, plays);
  const room = roomOf(stacks[0]!, measure, new Set(['b:0']));
  assert.equal(room.get(8), 5);
  assert.equal(room.has(12), false);
});

test('exposed: only the top strip, then the one beneath it once it is peeled', () => {
  const { strips } = stripsOf(text, plays);
  const by = (id: string) => strips.find((s) => s.play === id)!;
  assert.deepEqual(strips.filter((s) => exposed(s, strips)).map((s) => s.play), ['c']);
  const live = strips.filter((s) => s.play !== 'c');
  assert.deepEqual(live.filter((s) => exposed(s, live)).map((s) => s.play), ['b']);
  const last = [by('a')];
  assert.equal(exposed(by('a'), last), true);
});

test('stripsOf: keys, places and heights', () => {
  const { strips, total } = stripsOf('big cats, big cats', [plays[0]!, plays[2]!]);
  assert.deepEqual(strips.map((s) => [s.key, s.index, s.z, s.from, s.to]), [['a:0', 0, 0, 0, 8], ['a:1', 1, 0, 10, 18], ['c:0', 0, 1, 0, 8], ['c:1', 1, 1, 10, 18]]);
  assert.deepEqual(total, { a: 2, c: 2 });
});

test('dealWords: the words that fit go in the first piece at scale 1', () => {
  const at = (t: string, scale: number) => t.length * 10 * scale;
  const dealt = dealWords('the single greatest achievement', [120, 400], at);
  assert.deepEqual(dealt.words, ['the single', 'greatest achievement']);
  assert.equal(dealt.scale, 1);
});

test('dealWords: a word too long for the first piece moves to the second rather than shrinking', () => {
  const at = (t: string, scale: number) => t.length * 10 * scale;
  const dealt = dealWords('the single greatest achievement', [50, 400], at);
  assert.deepEqual(dealt.words, ['the', 'single greatest achievement']);
  assert.equal(dealt.scale, 1);
});

test('dealWords: only an overflowing last piece shrinks the scale, never below 0.6', () => {
  const at = (t: string, scale: number) => t.length * 10 * scale;
  const dealt = dealWords('the single greatest achievement', [100, 190], at);
  // The second piece holds "greatest achievement" (20 letters = 200 at 1): 190 fits at 0.95.
  assert.equal(dealt.scale, 0.95);
  const tight = dealWords('the single greatest achievement', [100, 50], at);
  assert.equal(tight.scale, 0.6);
});

const table: { widths: number[]; stretches: Stretch[] }[] = [
  { widths: [300], stretches: [[0, 1, 0]] },
  { widths: [300], stretches: [[0.25, 0.5, 4], [0.75, 1, 3]] },
  { widths: [100, 200], stretches: [[0, 1, 0]] },
  { widths: [100, 200], stretches: [[0.1, 0.9, 5]] },
  { widths: [100, 200], stretches: [[0.1, 0.2, 4], [0.5, 1, 2]] },
  { widths: [100, 100, 100], stretches: [[0, 1, 0]] },
  { widths: [100, 100, 100], stretches: [[0.1, 0.9, 4], [0.95, 1, 3]] },
  { widths: [100, 100, 100], stretches: [[0, 0.4, 1], [0.6, 1, 6]] },
  { widths: [100, 100, 100], stretches: [[0, 0.3, 0], [0.7, 1, 0]] },
  { widths: [137, 91, 222], stretches: [[0.0123, 0.9876, 8], [0.9877, 0.9999, 4]] },
];

test('the round trip: fromPieces(piecesOf(s, w), w) is s, cut over one, two and three pieces', () => {
  for (const { widths, stretches } of table) {
    assert.deepEqual(fromPieces(piecesOf(stretches, widths), widths), stretches, JSON.stringify({ widths, stretches }));
  }
});

const rounded = (pieces: readonly (readonly Stretch[])[]) => pieces.map((p) => p.map(([a, b, e]) => [Math.round(a * 1e6) / 1e6, Math.round(b * 1e6) / 1e6, e]));

test('piecesOf: a stretch crossing a boundary is cut there with kind 0, and a hole in the middle piece leaves it with none', () => {
  assert.deepEqual(rounded(piecesOf([[0.1, 0.9, 4]], [100, 100, 100])), [[[30, 100, 3]], [[0, 100, 0]], [[0, 70, 1]]]);
  assert.deepEqual(rounded(piecesOf([[0, 0.3, 4], [0.7, 1, 4]], [100, 100, 100])), [[[0, 90, 4]], [], [[10, 100, 4]]]);
});

test('stuckOf: no entry is whole, a peeled place is none, an entry is itself', () => {
  const saved = { peeled: [1], stuck: { '2': [[0.25, 1, 3]] as Stretch[] } };
  assert.deepEqual(stuckOf(saved, 0), [[0, 1, 0]]);
  assert.deepEqual(stuckOf(saved, 1), []);
  assert.deepEqual(stuckOf(saved, 2), [[0.25, 1, 3]]);
});

const pace = { pace: 90, give: 34 };

test('peelStep: a hand 200px ahead moves the line 1.5px in a 1/60 s step, and strain builds', () => {
  const r = peelStep({ rolled: 0, strain: 0 }, 200, 1 / 60, pace);
  assert.ok(Math.abs(r.moved - 1.5) < 1e-9);
  assert.ok(Math.abs(r.rolled - 1.5) < 1e-9);
  assert.ok(r.strain > 0);
  assert.equal(r.tore, false);
});

test('peelStep: a hand within give drains strain', () => {
  const r = peelStep({ rolled: 10, strain: 0.5 }, 20, 0.1, pace);
  assert.ok(Math.abs(r.strain - 0.25) < 1e-9);
  assert.equal(peelStep({ rolled: 0, strain: 0.1 }, 0, 0.1, pace).strain, 0);
});

test('peelStep: strain reaches 1, a tear, in under 0.9 s at a lag of 100px', () => {
  let p = { rolled: 0, strain: 0 };
  let t = 0;
  let tore = false;
  while (!tore && t < 5) {
    const r = peelStep(p, 100, 1 / 60, pace);
    p = { rolled: r.rolled, strain: r.strain };
    tore = r.tore;
    t += 1 / 60;
  }
  assert.equal(tore, true);
  assert.ok(t < 0.9, `tore at ${t}`);
});

test('peelStep: a keyboard step never builds strain', () => {
  let p = { rolled: 0, strain: 0 };
  for (let i = 0; i < 600; i++) {
    const dt = 1 / 60;
    const r = peelStep(p, pace.pace * dt, dt, pace);
    p = { rolled: r.rolled, strain: r.strain };
    assert.equal(r.strain, 0);
    assert.equal(r.tore, false);
  }
  assert.ok(Math.abs(p.rolled - 900) < 1e-6);
});

test('rollDiameter grows with what is rolled: 3px bare, √(9 + 0.55 · rolled)', () => {
  assert.equal(rollDiameter(0), 3);
  assert.ok(Math.abs(rollDiameter(100) - Math.sqrt(64)) < 1e-9);
});

test('liftsOf: a pull of 150 over widths [100, 80, 60] lifts [100, 50, 0]', () => {
  assert.deepEqual(liftsOf(150, [100, 80, 60]), [100, 50, 0]);
  assert.deepEqual(liftsOf(-5, [100]), [0]);
});

test('settle: a pull holds for stay, then reaches 0 at speed', () => {
  let s = { pull: 60, since: 0 };
  for (let i = 0; i < 3; i++) s = settle(s.pull, 300, s.since, 100, 300);
  assert.equal(s.pull, 60, 'held for the stay');
  s = settle(s.pull, 300, s.since, 100, 300);
  assert.ok(Math.abs(s.pull - 30) < 1e-9);
  s = settle(s.pull, 300, s.since, 100, 300);
  assert.equal(s.pull, 0);
  assert.equal(settle(0, 300, 1000, 100, 300).pull, 0);
});

test('flapOf: theta is 150 with no lift and 92 with a full one, and the free end never scales past 1.6', () => {
  assert.equal(flapOf(0, 100, 20).theta, 150);
  assert.ok(Math.abs(flapOf(100, 100, 20).theta - 92) < 1e-9);
  for (const width of [20, 60, 200, 450, 900]) {
    for (const height of [16, 24, 32]) {
      for (let k = 1; k <= 20; k++) {
        const lift = (width * k) / 20;
        const { theta, perspective } = flapOf(lift, width, height);
        const scale = perspective / (perspective - lift * Math.sin((theta * Math.PI) / 180));
        assert.ok(scale > 0 && scale <= 1.6, `${width}x${height} lift ${lift}: ${scale}`);
      }
    }
  }
});
