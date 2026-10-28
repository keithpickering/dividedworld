import { test } from 'node:test';
import assert from 'node:assert/strict';
import { halveAcrossActs, shareVotes } from './votes.ts';

const r = (act: string, player: string, character = `${player}-c1`, kind = 'fire') => ({ act, player, character, kind });

test('one reaction is a whole vote', () => {
  const [v] = shareVotes([r('a1', 'p1')]);
  assert.equal(v?.share, 1);
});

test('three reactions from one player on one Act are a third of a vote each', () => {
  const votes = shareVotes([r('a1', 'p1', 'p1-c1', 'fire'), r('a1', 'p1', 'p1-c1', 'zzz'), r('a1', 'p1', 'p1-c1', 'tea')]);
  assert.deepEqual(votes.map((v) => v.share), [1 / 3, 1 / 3, 1 / 3]);
});

test('two players\' reactions never share a vote', () => {
  const votes = shareVotes([r('a1', 'p1'), r('a1', 'p2')]);
  assert.deepEqual(votes.map((v) => v.share), [1, 1]);
});

test('a player reacting through two of their characters is one player', () => {
  const votes = shareVotes([r('a1', 'p1', 'p1-c1', 'fire'), r('a1', 'p1', 'p1-c2', 'zzz')]);
  assert.deepEqual(votes.map((v) => v.share), [0.5, 0.5]);
});

test('one player\'s reactions on two Acts are two votes', () => {
  const votes = shareVotes([r('a1', 'p1'), r('a2', 'p1')]);
  assert.deepEqual(votes.map((v) => v.share), [1, 1]);
});

test('the shares keep the reactions they came from', () => {
  const [v] = shareVotes([r('a1', 'p1', 'p1-c2', 'tea')]);
  assert.equal(v?.kind, 'tea');
  assert.equal(v?.character, 'p1-c2');
});

const acts = new Map([
  ['a1', { character: 'x', at: 1 }],
  ['a2', { character: 'x', at: 2 }],
  ['a3', { character: 'x', at: 3 }],
  ['a4', { character: 'x', at: 4 }],
  ['b1', { character: 'y', at: 1 }],
]);
const actOf = (id: string) => {
  const a = acts.get(id);
  if (!a) throw new Error(`no act ${id}`);
  return a;
};

test('a player\'s votes on one character\'s Acts weigh 1, ½, ¼, ⅛ in the order the Acts were made', () => {
  // Reacted to in a scrambled order: the weight follows the Acts' order, not the reactions'.
  const votes = halveAcrossActs(shareVotes([r('a3', 'p1'), r('a1', 'p1'), r('a4', 'p1'), r('a2', 'p1')]), actOf, 0.5);
  const by = Object.fromEntries(votes.map((v) => [v.act, v.votes]));
  assert.deepEqual(by, { a1: 1, a2: 0.5, a3: 0.25, a4: 0.125 });
});

test('the fourth Act by one character in a window weighs ⅛', () => {
  const votes = halveAcrossActs(shareVotes(['a1', 'a2', 'a3', 'a4'].map((a) => r(a, 'p1'))), actOf, 0.5);
  assert.equal(votes.find((v) => v.act === 'a4')?.votes, 0.125);
});

test('the halving is per player: another player\'s first vote on the same character is whole', () => {
  const votes = halveAcrossActs(shareVotes([r('a1', 'p1'), r('a2', 'p1'), r('a2', 'p2')]), actOf, 0.5);
  assert.equal(votes.find((v) => v.act === 'a2' && v.player === 'p2')?.votes, 1);
  assert.equal(votes.find((v) => v.act === 'a2' && v.player === 'p1')?.votes, 0.5);
});

test('the halving is keyed by player, never character: two of one player\'s characters halve together', () => {
  const votes = halveAcrossActs(shareVotes([r('a1', 'p1', 'p1-c1'), r('a2', 'p1', 'p1-c2')]), actOf, 0.5);
  assert.equal(votes.find((v) => v.act === 'a2')?.votes, 0.5);
});

test('the halving is per target character: a vote on another character starts whole', () => {
  const votes = halveAcrossActs(shareVotes([r('a1', 'p1'), r('a2', 'p1'), r('b1', 'p1')]), actOf, 0.5);
  assert.equal(votes.find((v) => v.act === 'b1')?.votes, 1);
});

test('the share and the halving multiply', () => {
  const votes = halveAcrossActs(shareVotes([r('a1', 'p1'), r('a2', 'p1', 'p1-c1', 'fire'), r('a2', 'p1', 'p1-c1', 'zzz')]), actOf, 0.5);
  assert.deepEqual(votes.filter((v) => v.act === 'a2').map((v) => v.votes), [0.25, 0.25]);
});

test('Acts made at the same instant are ordered by id, so the result never depends on input order', () => {
  const same = (id: string) => ({ character: 'z', at: 5, id });
  const lookup = (id: string) => same(id);
  const one = halveAcrossActs(shareVotes([r('m', 'p1'), r('k', 'p1')]), lookup, 0.5);
  const two = halveAcrossActs(shareVotes([r('k', 'p1'), r('m', 'p1')]), lookup, 0.5);
  const key = (vs: typeof one) => vs.map((v) => `${v.act}:${v.votes}`).sort();
  assert.deepEqual(key(one), key(two));
  assert.equal(one.find((v) => v.act === 'k')?.votes, 1);
});
