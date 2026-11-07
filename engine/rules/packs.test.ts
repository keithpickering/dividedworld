import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packOdds, rollPack, type PackRules } from './packs.ts';
import type { CardRules, Rarity } from './cards.ts';

const card = (key: string, rarity: Rarity) => ({ key, rarity }) as unknown as CardRules;
const cards = [card('a', 'common'), card('b', 'common'), card('c', 'uncommon'), card('d', 'uncommon'), card('e', 'uncommon'), card('f', 'rare')];
const pack: PackRules = { key: 'p', pulls: [{ weights: { common: 85, uncommon: 15 } }, { weights: { uncommon: 75, rare: 25 } }] };

test('packOdds gives each pull its rarities and the eligible cards with their chances', () => {
  const odds = packOdds(pack, cards);
  assert.equal(odds.length, 2);
  assert.deepEqual(odds[0]!.map((r) => [r.rarity, r.chance]), [['common', 0.85], ['uncommon', 0.15]]);
  assert.deepEqual(odds[0]![0]!.cards, [{ card: 'a', chance: 0.425 }, { card: 'b', chance: 0.425 }]);
  assert.deepEqual(odds[1]!.map((r) => [r.rarity, r.chance]), [['uncommon', 0.75], ['rare', 0.25]]);
  assert.deepEqual(odds[1]![1]!.cards, [{ card: 'f', chance: 0.25 }]);
  assert.deepEqual(odds[1]![0]!.cards.map((c) => c.chance), [0.25, 0.25, 0.25]);
});

test('a card the pack leaves out is not eligible', () => {
  const odds = packOdds({ ...pack, leaves: ['a'] }, cards);
  assert.deepEqual(odds[0]![0]!.cards, [{ card: 'b', chance: 0.85 }]);
});

const script = (...xs: number[]) => () => xs.shift()!;

test('rollPack draws a rarity, then a card of it, per pull, in pull order', () => {
  // 0.1 is common (0 to 0.85) and 0 picks its first card; 0.9 in the second pull is rare (0.75 to 1).
  assert.deepEqual(rollPack(pack, cards, script(0.1, 0.0, 0.9, 0.0)), ['a', 'f']);
  // 0.9 is uncommon (0.85 up) and 0.5 of three is the second; 0.3 is uncommon (under 0.75) and 0 the first.
  assert.deepEqual(rollPack(pack, cards, script(0.9, 0.5, 0.3, 0.0)), ['d', 'c']);
});

test('rollPack with random always just under 1 returns the last eligible card of the last rarity', () => {
  assert.deepEqual(rollPack(pack, cards, () => 0.9999999999), ['e', 'f']);
});
