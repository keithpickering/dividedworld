import { test } from 'node:test';
import assert from 'node:assert/strict';
import { halveAcrossActs, payVotes, shareVotes } from './votes.ts';

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

test('the halving is the setting\'s, not a fixed half', () => {
  const quarter = halveAcrossActs(shareVotes(['a1', 'a2', 'a3'].map((a) => r(a, 'p1'))), actOf, 0.25);
  assert.deepEqual(quarter.map((v) => v.votes), [1, 0.25, 0.0625]);
  const none = halveAcrossActs(shareVotes(['a1', 'a2', 'a3'].map((a) => r(a, 'p1'))), actOf, 1);
  assert.deepEqual(none.map((v) => v.votes), [1, 1, 1]);
});

test('only the Acts a player voted on count toward their halving: votes on a character\'s first and fourth Acts weigh 1 and ½', () => {
  const votes = halveAcrossActs(shareVotes([r('a1', 'p1'), r('a4', 'p1')]), actOf, 0.5);
  assert.equal(votes.find((v) => v.act === 'a4')?.votes, 0.5);
});

test('no votes are no votes', () => {
  assert.deepEqual(halveAcrossActs(shareVotes([]), actOf, 0.5), []);
});

test('a vote on an Act the caller cannot place is an error, not a whole vote', () => {
  assert.throws(() => halveAcrossActs(shareVotes([r('nowhere', 'p1')]), actOf, 0.5), /no act nowhere/);
});


/* ---- payVotes: one vote per player per Act, across windows ---- */
type Q = 'excitedPositive' | 'excitedNegative' | 'calmPositive' | 'boredNegative';
const payActs = new Map([['p1', { character: 'author', at: 0 }], ['p2', { character: 'author', at: 5 }]]);
const payActOf = (id: string) => payActs.get(id)!;
const W1 = { from: 0, to: 100 };
const W2 = { from: 100, to: 200 };
const at = (act: string, quadrant: Q, when: number, character = 'bob-a', player = 'bob') => ({ act, player, character, quadrant, at: when });
const sum = (xs: { share: number }[]) => xs.reduce((s, x) => s + x.share, 0);

test('a three-way split paid across two windows sums to exactly one vote, with no dust to tip a comparison', () => {
  const monday = payVotes([at('p1', 'excitedPositive', 10)], W1, [], payActOf, 0.5);
  const tuesday = payVotes([at('p1', 'excitedPositive', 10), at('p1', 'calmPositive', 110), at('p1', 'boredNegative', 120)], W2, monday.paid, payActOf, 0.5);
  assert.equal(sum(tuesday.votes), 0, 'the differences of a vote already whole sum to nothing at all');
  assert.equal(sum(monday.votes) + sum(tuesday.votes), 1);
  assert.equal(Object.values(tuesday.paid[0]!.shares).reduce((s, x) => s + x, 0), 1);
});

test('the same quadrant again in a later window pays exactly nothing', () => {
  const monday = payVotes([at('p1', 'excitedPositive', 10)], W1, [], payActOf, 0.5);
  const tuesday = payVotes([at('p1', 'excitedPositive', 10), at('p1', 'excitedPositive', 110)], W2, monday.paid, payActOf, 0.5);
  assert.deepEqual(tuesday.votes, []);
});

test('a vote paid before keeps its weight and never counts in the halving of a new one beside it', () => {
  const monday = payVotes([at('p1', 'excitedPositive', 10)], W1, [], payActOf, 0.5);
  const tuesday = payVotes([at('p1', 'excitedPositive', 10), at('p1', 'boredNegative', 110), at('p2', 'excitedPositive', 120)], W2, monday.paid, payActOf, 0.5);
  assert.deepEqual(tuesday.paid.map((v) => [v.act, v.weight]), [['p1', 1], ['p2', 1]], 'p2 is the first new vote on the author this window, whole');
});

test('a vote taken back from a quadrant is said by the mask that gave it there', () => {
  const monday = payVotes([at('p1', 'excitedPositive', 10, 'bob-lurker')], W1, [], payActOf, 0.5);
  const tuesday = payVotes([at('p1', 'excitedPositive', 10, 'bob-lurker'), at('p1', 'boredNegative', 110, 'bob-other')], W2, monday.paid, payActOf, 0.5);
  assert.deepEqual(tuesday.votes.map((v) => [v.quadrant, v.share, v.character]).sort(), [['boredNegative', 0.5, 'bob-other'], ['excitedPositive', -0.5, 'bob-lurker']]);
  // Of several reactions in the window, the latest says the window's part.
  const two = payVotes([at('p1', 'excitedPositive', 10, 'bob-a'), at('p1', 'excitedPositive', 20, 'bob-b')], W1, [], payActOf, 0.5);
  assert.equal(two.votes[0]!.character, 'bob-b');
});

test('a vote taken back is said by the mask that held it before the window, though another mask reacted there since', () => {
  const monday = payVotes([at('p1', 'excitedPositive', 10, 'bob-lurker')], W1, [], payActOf, 0.5);
  const rs = [at('p1', 'excitedPositive', 10, 'bob-lurker'), at('p1', 'excitedPositive', 110, 'bob-third'), at('p1', 'boredNegative', 120, 'bob-other')];
  const tuesday = payVotes(rs, W2, monday.paid, payActOf, 0.5);
  const taken = tuesday.votes.find((v) => v.share < 0)!;
  assert.equal(taken.character, 'bob-lurker', 'the mask paid Monday gives back what moved, not the mask that reacted Tuesday');
  assert.equal(taken.at, 120, 'at the moment it moved');
});

test('what is paid comes back in one order whatever order the reactions came in, and nothing at the window\'s end is read', () => {
  const rs = [at('p2', 'excitedPositive', 10, 'cat-a', 'cat'), at('p1', 'excitedPositive', 11), at('p1', 'boredNegative', 100)];
  const one = payVotes(rs, W1, [], payActOf, 0.5);
  assert.deepEqual(payVotes([...rs].reverse(), W1, [], payActOf, 0.5).paid, one.paid);
  assert.deepEqual(one.paid.map((v) => [v.player, v.act]), [['bob', 'p1'], ['cat', 'p2']]);
  assert.equal(one.paid[0]!.shares.excitedPositive, 1, 'the reaction at the window\'s end is the next window\'s');
});
