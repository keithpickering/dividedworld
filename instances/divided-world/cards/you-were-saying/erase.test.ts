/**
 * The hold's clock (docs/plans/2026-11-07-you-were-saying-design.md, section 8): how many characters of a tail show at a time, given
 * the gestures on it. Pure: the Effect drives it with a timer, and the keyboard and the pointer feed it the same two events, so the
 * same characters are gone after the same time whichever is held. A release before the end waits `retypeMs` and types the tail
 * back in at `typeCps` (reduced motion: all at once); the end is a clear, which nothing brings back.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { FULL, GAP_MS, lapse, look, press, release, run, typeIn, type EraseSettings } from './erase.ts';

const S: EraseSettings = { eraseCps: 6, retypeMs: 2000, typeCps: 40, reduced: false };
const R: EraseSettings = { ...S, reduced: true };
const TOTAL = 60;

describe('the hold', () => {
  test('at 6 cps a 60-character tail is gone in 10 seconds of hold, and not before', () => {
    const held = [[0, 'hold']] as const;
    assert.deepEqual(run(S, TOTAL, FULL, held, 0), { shown: 60, cleared: false, phase: 'erasing' });
    assert.equal(run(S, TOTAL, FULL, held, 5000).shown, 30);
    assert.equal(run(S, TOTAL, FULL, held, 9999).cleared, false);
    assert.ok(run(S, TOTAL, FULL, held, 9999).shown >= 1);
    assert.deepEqual(run(S, TOTAL, FULL, held, 10_000), { shown: 0, cleared: true, phase: 'cleared' });
    assert.equal(run(S, TOTAL, FULL, held, 60_000).cleared, true);
  });

  test('a release at 5 seconds leaves 30, and after 2 seconds more it is typing back in at the typing rate', () => {
    const gone = [[0, 'hold'], [5000, 'release']] as const;
    assert.equal(run(S, TOTAL, FULL, gone, 5000).shown, 30);
    assert.deepEqual(run(S, TOTAL, FULL, gone, 6999), { shown: 30, cleared: false, phase: 'waiting' });
    assert.deepEqual(run(S, TOTAL, FULL, gone, 7000), { shown: 30, cleared: false, phase: 'typing' });
    assert.equal(run(S, TOTAL, FULL, gone, 7000 + 375).shown, 45);
    assert.deepEqual(run(S, TOTAL, FULL, gone, 7000 + 750), { shown: 60, cleared: false, phase: 'full' });
  });

  test('under reduced motion the retype is instant after the same wait', () => {
    const gone = [[0, 'hold'], [5000, 'release']] as const;
    assert.equal(run(R, TOTAL, FULL, gone, 6999).shown, 30);
    assert.deepEqual(run(R, TOTAL, FULL, gone, 7000), { shown: 60, cleared: false, phase: 'full' });
  });

  test('reduced motion erases at the same rate', () => {
    assert.equal(run(R, TOTAL, FULL, [[0, 'hold']], 5000).shown, 30);
    assert.equal(run(R, TOTAL, FULL, [[0, 'hold']], 10_000).cleared, true);
  });

  test('a release at the end retypes nothing and says it is cleared', () => {
    const done = [[0, 'hold'], [10_500, 'release']] as const;
    assert.deepEqual(run(S, TOTAL, FULL, done, 10_500), { shown: 0, cleared: true, phase: 'cleared' });
    assert.deepEqual(run(S, TOTAL, FULL, done, 600_000), { shown: 0, cleared: true, phase: 'cleared' });
  });

  test('a press while it waits to come back goes on from where it was left, and the wait starts again on the next release', () => {
    const again = [[0, 'hold'], [5000, 'release'], [6000, 'hold']] as const;
    assert.equal(run(S, TOTAL, FULL, again, 6000).shown, 30);
    assert.equal(run(S, TOTAL, FULL, again, 8000).shown, 18);
    assert.equal(run(S, TOTAL, FULL, [...again, [8000, 'release']], 9999).shown, 18);
    assert.equal(run(S, TOTAL, FULL, [...again, [8000, 'release']], 10_000 + 25).phase, 'typing');
  });

  test('a press while it types in erases from the full length, so the cost is the whole tail held', () => {
    const typing = typeIn(S, 0, 0);
    assert.equal(look(S, TOTAL, typing, 500).shown, 20);
    const held = press(S, TOTAL, typing, 500);
    assert.deepEqual(look(S, TOTAL, held, 500), { shown: 60, cleared: false, phase: 'erasing' });
    assert.equal(look(S, TOTAL, held, 500 + 1000).shown, 54);
    assert.equal(look(S, TOTAL, held, 500 + 9999).cleared, false);
    assert.equal(look(S, TOTAL, held, 500 + 10_000).cleared, true);
  });

  test('a press half a second into a 200-character tail takes 200/6 seconds of hold to clear it', () => {
    const held = press(S, 200, typeIn(S, 0, 0), 500);
    assert.equal(look(S, 200, held, 500 + 33_332).cleared, false);
    assert.equal(look(S, 200, held, 500 + 33_334).cleared, true);
  });

  test('a press while it types back in after a release also erases from the full length', () => {
    const typing = [[0, 'hold'], [5000, 'release']] as const;
    const e = press(S, TOTAL, release(S, TOTAL, press(S, TOTAL, FULL, 0), 5000), 7000 + 100);
    assert.equal(look(S, TOTAL, e, 7100).shown, 60);
    assert.equal(run(S, TOTAL, FULL, [...typing, [7100, 'hold']], 7100 + 10_000).cleared, true);
  });

  test('a press with nothing in it erases nothing and clears nothing', () => {
    assert.equal(look(S, 0, press(S, 0, FULL, 0), 5000).cleared, false);
    assert.equal(look(S, 0, press(S, 0, typeIn(S, 0, 0), 0), 5000).cleared, false);
  });

  test('typing in under reduced motion shows everything at once', () => {
    assert.deepEqual(look(R, TOTAL, typeIn(R, 0, 100), 100), { shown: 60, cleared: false, phase: 'full' });
  });

  test('a hold is half-open per character: a release part way through a character keeps it', () => {
    const e = release(S, TOTAL, press(S, TOTAL, FULL, 0), 100);
    assert.equal(look(S, TOTAL, e, 100).shown, 60);
    assert.equal(look(S, TOTAL, release(S, TOTAL, press(S, TOTAL, FULL, 0), 1100), 1100).shown, 54);
  });

  test('a total that shrinks never shows more than there is', () => {
    assert.equal(look(S, 10, FULL, 0).shown, 10);
    assert.equal(look(S, 10, typeIn(S, 40, 0), 0).shown, 10);
  });

  test('a gap in the ticks longer than the limit credits no hold time: the hold ends where it was last read', () => {
    const held = press(S, TOTAL, FULL, 0);
    const e = lapse(S, TOTAL, held, 1000, 1000 + GAP_MS + 1);
    assert.equal(e.phase, 'waiting');
    assert.equal(look(S, TOTAL, e, 1000 + GAP_MS + 1).shown, 54);
    assert.equal(look(S, TOTAL, e, 600_000).phase, 'full');
  });

  test('a gap within the limit is left alone, and so is any phase that is not an erase', () => {
    const held = press(S, TOTAL, FULL, 0);
    assert.equal(lapse(S, TOTAL, held, 1000, 1000 + GAP_MS), held);
    assert.equal(lapse(S, TOTAL, FULL, 0, 99_999), FULL);
  });

  test('a gap that would have cleared it after the last read still counts only to the last read', () => {
    const held = press(S, TOTAL, FULL, 0);
    assert.equal(look(S, TOTAL, lapse(S, TOTAL, held, 9000, 60_000), 60_000).cleared, false);
  });
});
