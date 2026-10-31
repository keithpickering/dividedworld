/**
 * Billing: the order of a post's tags. The play that has drawn the most (its public reaction count plus
 * the threads spun from it) is billed first, ties going to the newest, then to the id, so the order is
 * total and two readers with the same counts see the same order.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billing, drawnOf } from './billing.ts';
import type { CardPlay } from './types.ts';

const play = (id: string, playedAt: string): CardPlay => ({
  id, card: 'whoops', layer: 1, caster: 'c', message: '', config: {}, playedAt, post: 'p',
});
const a = play('a', '2026-10-31T21:00:00.000Z');
const b = play('b', '2026-10-31T21:05:00.000Z');
const c = play('c', '2026-10-31T21:10:00.000Z');
const ids = (plays: readonly CardPlay[]) => plays.map((p) => p.id);

test('the most drawn play is billed first', () => {
  const drawn = new Map([['a', 2], ['b', 9], ['c', 5]]);
  assert.deepEqual(ids(billing([a, b, c], (id) => drawn.get(id) ?? 0)), ['b', 'c', 'a']);
});

test('a tie in draws goes to the newest play', () => {
  const drawn = new Map([['a', 4], ['b', 4], ['c', 1]]);
  assert.deepEqual(ids(billing([a, b, c], (id) => drawn.get(id) ?? 0)), ['b', 'a', 'c']);
});

test('a tie in draws and in time goes to the id, so the order is total', () => {
  const same = '2026-10-31T21:00:00.000Z';
  const x = play('x', same);
  const y = play('y', same);
  assert.deepEqual(ids(billing([y, x], () => 3)), ['x', 'y']);
  assert.deepEqual(ids(billing([x, y], () => 3)), ['x', 'y']);
});

test('no plays bill nothing', () => {
  assert.deepEqual(billing([], () => 0), []);
});

test('billing leaves the plays it was given in their order', () => {
  const given = [a, b, c];
  billing(given, (id) => (id === 'c' ? 1 : 0));
  assert.deepEqual(ids(given), ['a', 'b', 'c']);
});

test('drawn is the sum of the tally plus the threads spun from the play; a kind at zero adds nothing', () => {
  assert.equal(drawnOf({ heart: 3, laugh: 2 }, 1), 6);
  assert.equal(drawnOf({ heart: 0, laugh: 2 }, 0), 2);
  assert.equal(drawnOf({}, 0), 0);
  assert.equal(drawnOf({}, 4), 4);
});

test('billing reads nothing but its arguments: the same counts in another insertion order give the same order', () => {
  const one = new Map([['a', 5], ['b', 5], ['c', 7]]);
  const two = new Map([['c', 7], ['b', 5], ['a', 5]]);
  const first = ids(billing([a, b, c], (id) => one.get(id) ?? 0));
  const second = ids(billing([c, a, b], (id) => two.get(id) ?? 0));
  assert.deepEqual(first, ['c', 'b', 'a']);
  assert.deepEqual(second, first);
});
