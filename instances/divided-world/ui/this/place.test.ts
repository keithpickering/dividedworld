/**
 * Where each THIS note stands (docs/plans/2026-11-13-this-plan.md, Task 7): the search over a post's visible text, and the measuring's arithmetic over plain
 * numbers (boxes in; gap heights, note tops and the arrow's path out), so no test here needs a layout.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PAD, ROOM, layOut, placesOf, standsAt, type Spot } from './place.ts';

const play = (id: string, phrase: string, words = '') => ({ id, config: { phrase, words } });

describe('standsAt', () => {
  test('is the first of the phrase\'s occurrences', () => {
    const text = 'Stop asking for slopes. Then stop asking for slopes again.';
    assert.deepEqual(standsAt(text, 'stop asking for slopes'), { start: 0, end: 22 });
  });
  test('is null where the phrase is not in the text', () => {
    assert.equal(standsAt('Nothing here at all.', 'stop asking for slopes'), null);
  });
});

describe('placesOf', () => {
  const A = play('a', 'asking for slopes', 'agreed');
  test('a wedge at the first of two occurrences', () => {
    const text = 'Stop asking for slopes. Then stop asking for slopes again.';
    const [only] = placesOf(text, [A]);
    assert.equal(only!.play, A);
    assert.deepEqual(only!.at, { start: 5, end: 22 });
  });
  test('a receipt when the phrase is gone, and a wedge again when a later text holds it', () => {
    assert.equal(placesOf('Stop asking about slopes.', [A])[0]!.at, null);
    assert.deepEqual(placesOf('Please keep asking for slopes.', [A])[0]!.at, { start: 12, end: 29 });
  });
  test('an edit elsewhere moves the offsets and not the choice', () => {
    const before = placesOf('Stop asking for slopes. Then stop asking for slopes again.', [A])[0]!.at!;
    const after = placesOf('A new first sentence. Stop asking for slopes. Then stop asking for slopes again.', [A])[0]!.at!;
    assert.equal(after.start - before.start, 'A new first sentence. '.length);
    assert.equal(after.end - after.start, before.end - before.start);
  });
  test('one changed word is a receipt', () => {
    assert.equal(placesOf('Stop asking for slope.', [A])[0]!.at, null);
  });
  test('two plays naming one phrase are two wedges at one place, in play order', () => {
    const B = play('b', 'asking for slopes');
    const out = placesOf('Stop asking for slopes.', [A, B]);
    assert.deepEqual(out.map((p) => p.play.id), ['a', 'b']);
    assert.deepEqual(out[0]!.at, out[1]!.at);
    assert.ok(out[0]!.at);
  });
  test('a play whose configuration holds no phrase is no place at all', () => {
    assert.deepEqual(placesOf('Stop asking for slopes.', [{ id: 'x', config: { color: '#fff', seed: 1 } }]), []);
  });
});

const spot = (id: string, over: Partial<Spot> = {}): Spot => ({ id, lineTop: 100, lineHeight: 20, noteHeight: 40, wordX: 30, piece: { left: 50, width: 100 }, ...over });

describe('layOut', () => {
  test('one note: the gap is the line, the arrow\'s room, the note and its padding; the note stands under the line', () => {
    const [one] = layOut([spot('a')], 300);
    assert.equal(ROOM, 22);
    assert.equal(PAD, 8);
    assert.equal(one!.gapHeight, 20 + 22 + 40 + 8);
    assert.equal(one!.noteTop, 100 + 20 + 22);
    /* The tip is under the middle of the piece, 1px under the line; the path is in the note's own coordinates (its top is 0). */
    assert.equal(one!.arrow, 'M30,0 Q34,-14 100,-21 m-10,-3 l10,3 l-7,9');
  });
  test('the arrow leans the other way when the tip is left of the word', () => {
    const [one] = layOut([spot('a', { wordX: 200, piece: { left: 10, width: 40 } })], 300);
    assert.equal(one!.arrow, 'M200,0 Q196,-14 30,-21 m10,-3 l-10,3 l7,9');
  });
  test('the tip is held inside the wrapper\'s width', () => {
    assert.match(layOut([spot('a', { piece: { left: 290, width: 20 } })], 300)[0]!.arrow, / 286,-21 /u);
    assert.match(layOut([spot('a', { wordX: 100, piece: { left: 0, width: 10 } })], 300)[0]!.arrow, / 14,-21 /u);
  });
  test('two notes on one line stand one under the other in the order given, and the gaps add', () => {
    const [first, second] = layOut([spot('a', { lineTop: 101 }), spot('b', { lineTop: 100.4, noteHeight: 30 })], 300);
    assert.equal(first!.noteTop, 101 + 20 + 22);
    assert.equal(second!.noteTop, 143 + 40 + 8 + 22);
    assert.equal(first!.gapHeight, 90);
    assert.equal(second!.gapHeight, 20 + (22 + 40 + 8) + (22 + 30 + 8));
  });
  test('notes on different lines do not stack', () => {
    const [first, second] = layOut([spot('a'), spot('b', { lineTop: 180 })], 300);
    assert.equal(first!.gapHeight, 90);
    assert.equal(second!.gapHeight, 90);
    assert.equal(second!.noteTop, 180 + 20 + 22);
  });
  test('the heights do not depend on where the lines are, so a second pass over the tops the first one made writes none', () => {
    const at = (top: number) => layOut([spot('a', { lineTop: top }), spot('b', { lineTop: top, noteHeight: 31.5 }), spot('c', { lineTop: top + 200, lineHeight: 20.4 })], 300).map((l) => l.gapHeight);
    assert.deepEqual(at(10), at(999.5));
  });
  test('a gap\'s height is whole pixels, rounded up', () => {
    assert.equal(layOut([spot('a', { lineHeight: 20.4 })], 300)[0]!.gapHeight, 91);
  });
  test('the answer is in the order given, one for each spot', () => {
    assert.deepEqual(layOut([spot('z', { lineTop: 300 }), spot('y')], 300).map((l) => l.id), ['z', 'y']);
    assert.deepEqual(layOut([], 300), []);
  });
});
