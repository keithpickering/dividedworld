import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dragPeels, dragThreshold, holdShare, savedAfterPeel, stripsOf, type PlayStrips } from './peel.ts';

const play = (id: string, phrase: string, replacement: string, peeled: number[] = []): PlayStrips => ({ id, phrase, replacement, peeled: new Set(peeled) });
const cover = (text: string, s: { from: number; to: number }) => text.slice(s.from, s.to);

test('a drag peels past twice the strip\'s height, never less than 24 pixels, in any direction', () => {
  assert.equal(dragThreshold(16), 32);
  assert.equal(dragThreshold(8), 24);
  assert.equal(dragPeels(31, 0, 16), false);
  assert.equal(dragPeels(-20, 25, 16), true, 'a diagonal pull counts its length');
});

test('a hold peels at the card\'s time: its share grows to 1, and never past', () => {
  assert.equal(holdShare(0, 700), 0);
  assert.equal(holdShare(350, 700), 0.5);
  assert.equal(holdShare(2000, 700), 1);
});

test('each occurrence of each play is a strip, numbered in the post\'s order, and a saved or local peel leaves an adhesive mark', () => {
  const text = 'Mario and mario, MARIO!';
  const { shown, peeled, total } = stripsOf(text, [play('k1', 'mario', 'Luigi', [1])], new Set(['k1:2']));
  assert.deepEqual(shown.map((s) => [s.index, cover(text, s), s.replacement]), [[0, 'Mario', 'Luigi']]);
  assert.deepEqual(peeled.map((s) => [s.index, cover(text, s)]), [[1, 'mario'], [2, 'MARIO']]);
  assert.deepEqual(total, { k1: 3 });
});

test('where strips overlap, only the top one shows, over all of them; peeling it shows the one beneath', () => {
  const text = 'a big cats day';
  const plays = [play('k1', 'big cats', 'tiny dogs'), play('k2', 'cats', 'kittens')];
  const top = stripsOf(text, plays, new Set());
  assert.deepEqual(top.shown.map((s) => [s.play, cover(text, s), s.replacement]), [['k2', 'big cats', 'kittens']]);
  const under = stripsOf(text, plays, new Set(['k2:0']));
  assert.deepEqual(under.shown.map((s) => [s.play, cover(text, s), s.replacement]), [['k1', 'big cats', 'tiny dogs']]);
  assert.deepEqual(under.peeled.map((s) => [s.play, cover(text, s)]), [['k2', 'cats']]);
});

test('the author\'s save after a peel: the places kept in order, and clean once every place is peeled', () => {
  assert.deepEqual(savedAfterPeel([2], 0, 3), { peeled: [0, 2] });
  assert.deepEqual(savedAfterPeel([0, 2], 1, 3), { peeled: [0, 1, 2], clean: true });
  assert.deepEqual(savedAfterPeel([0], 0, 3), { peeled: [0] }, 'a place already peeled is kept once');
});

test('a play whose phrase the post no longer holds shows no strip, and comes back when an edit brings it back', () => {
  const plays = [play('k1', 'mario', 'Luigi')];
  assert.deepEqual(stripsOf('only luigi here', plays, new Set()).shown, []);
  assert.equal(stripsOf('mario is back', plays, new Set()).shown.length, 1);
});

test('a strip over a looser match covers the original words, punctuation and all', () => {
  const text = "No, don't! Mario's here. DONT";
  const { shown, total } = stripsOf(text, [play('k1', 'dont', 'do')], new Set());
  assert.deepEqual(shown.map((s) => cover(text, s)), ["don't", 'DONT']);
  assert.equal(total.k1, 2);
});
