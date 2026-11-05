import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankFloor, rankIndex } from './ranks.ts';

const ranks = [{ name: 'Jobber', from: 0 }, { name: 'Midcarder', from: 300 }, { name: 'Main Eventer', from: 600 }];

test('the rank is the highest whose threshold the standing reaches', () => {
  assert.equal(rankIndex(ranks, 0), 0);
  assert.equal(rankIndex(ranks, 299), 0);
  assert.equal(rankIndex(ranks, 300), 1);
  assert.equal(rankIndex(ranks, 650), 2);
  assert.equal(rankIndex(ranks, 100_000), 2);
});

test('no standing yet, or a negative one, is the first rank', () => {
  assert.equal(rankIndex(ranks, null), 0);
  assert.equal(rankIndex(ranks, -40), 0);
});

test('an instance with one rank has only that one', () => {
  assert.equal(rankIndex([{ name: 'Rookie', from: 0 }], 5000), 0);
});

test('a rank\'s floor is the least standing that lands on it, and rankIndex agrees', () => {
  ranks.forEach((_, i) => assert.equal(rankIndex(ranks, rankFloor(ranks, i)), i));
  assert.equal(rankFloor(ranks, 1), 300);
  assert.equal(rankFloor(ranks, 9), null);
  assert.equal(rankFloor([], 0), null);
});
