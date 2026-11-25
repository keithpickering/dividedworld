/**
 * The confetti's pieces are a pure function of a seed (the play's id), so a test can pin them (the plan's Task 6): the same seed throws the same pieces,
 * another seed throws others, and the pieces are the owner's count, in the fabric's light shade, gold and white, thrown up from the box's bottom edge.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { confettiPieces, seedOf } from './confetti.ts';
import { TUNING } from './tuning.ts';

const BOX = { w: 600, h: 300 };
const COLORS = ['#f73434', TUNING.confetti.gold, TUNING.confetti.white];

describe('confetti', () => {
  test('the same seed gives the same pieces, and another seed gives others', () => {
    const a = confettiPieces(seedOf('play-1'), BOX, COLORS);
    assert.ok(a.length > 0);
    assert.deepEqual(confettiPieces(seedOf('play-1'), BOX, COLORS), a);
    assert.notDeepEqual(confettiPieces(seedOf('play-2'), BOX, COLORS), a);
  });

  test('a seed is a number made from the play id, the same each time', () => {
    assert.equal(seedOf('play-1'), seedOf('play-1'));
    assert.notEqual(seedOf('play-1'), seedOf('play-2'));
  });

  test('there are the owner\'s two hundred pieces, each one of the three colors, thrown up from the bottom edge', () => {
    const pieces = confettiPieces(seedOf('play-1'), BOX, COLORS);
    assert.equal(pieces.length, TUNING.confetti.count);
    assert.deepEqual(new Set(pieces.map((p) => p.color)), new Set(COLORS));
    for (const p of pieces) {
      assert.equal(p.y, BOX.h);
      assert.ok(p.vy < 0);
      assert.ok(p.x > 0 && p.x < BOX.w);
    }
  });

  test('a tall box is thrown against at most the tuned height, so a tall post\'s confetti is not a mile high', () => {
    const tall = confettiPieces(seedOf('play-1'), { w: 600, h: 6000 }, COLORS);
    const capped = confettiPieces(seedOf('play-1'), { w: 600, h: TUNING.confetti.boxMaxPx }, COLORS);
    assert.deepEqual(tall.map((p) => p.vy), capped.map((p) => p.vy));
    assert.equal(tall[0]!.y, 6000);
  });
});
