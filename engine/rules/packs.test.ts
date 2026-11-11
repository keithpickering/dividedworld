import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packOdds, rollPack, type PackRules } from './packs.ts';
import type { CardRules, Rarity } from './cards.ts';

const card = (key: string, rarity: Rarity) => ({ key, rarity }) as unknown as CardRules;
const cards = [card('a', 'common'), card('b', 'common'), card('c', 'uncommon'), card('d', 'uncommon'), card('e', 'uncommon'), card('f', 'rare')];
const on = { oldVoice: true };
const pack: PackRules = { key: 'p', pulls: [{ weights: { common: 85, uncommon: 15 } }, { weights: { uncommon: 75, rare: 25 } }] };

test('packOdds gives each pull its rarities and the eligible cards with their chances', () => {
  const odds = packOdds(pack, cards, on);
  assert.equal(odds.length, 2);
  assert.deepEqual(odds[0]!.map((r) => [r.rarity, r.chance]), [['common', 0.85], ['uncommon', 0.15]]);
  assert.deepEqual(odds[0]![0]!.cards, [{ card: 'a', chance: 0.425 }, { card: 'b', chance: 0.425 }]);
  assert.deepEqual(odds[1]!.map((r) => [r.rarity, r.chance]), [['uncommon', 0.75], ['rare', 0.25]]);
  assert.deepEqual(odds[1]![1]!.cards, [{ card: 'f', chance: 0.25 }]);
  assert.deepEqual(odds[1]![0]!.cards.map((c) => c.chance), [0.25, 0.25, 0.25]);
});

test('a card the pack leaves out is not eligible', () => {
  const odds = packOdds({ ...pack, leaves: ['a'] }, cards, on);
  assert.deepEqual(odds[0]![0]!.cards, [{ card: 'b', chance: 0.85 }]);
});

const script = (...xs: number[]) => () => xs.shift()!;

test('rollPack draws a rarity, then a card of it, per pull, in pull order', () => {
  // 0.1 is common (0 to 0.85) and 0 picks its first card; 0.9 in the second pull is rare (0.75 to 1).
  assert.deepEqual(rollPack(pack, cards, on, script(0.1, 0.0, 0.9, 0.0)), ['a', 'f']);
  // 0.9 is uncommon (0.85 up) and 0.5 of three is the second; 0.3 is uncommon (under 0.75) and 0 the first.
  assert.deepEqual(rollPack(pack, cards, on, script(0.9, 0.5, 0.3, 0.0)), ['d', 'c']);
});

test('rollPack with random always just under 1 returns the last eligible card of the last rarity', () => {
  assert.deepEqual(rollPack(pack, cards, on, () => 0.9999999999), ['e', 'f']);
});

test('a rarity with no eligible card is dropped from a pull\'s odds and its roll alike', () => {
  const thin: PackRules = { key: 't', pulls: [{ weights: { common: 1, legendary: 1 } }] };
  assert.deepEqual(packOdds(thin, cards, on)[0]!.map((r) => [r.rarity, r.chance]), [['common', 1]]);
  assert.deepEqual(rollPack(thin, cards, on, script(0.99, 0.0)), ['a']);
});

test('rollPack with random 0 picks the first card of the first rarity', () => {
  assert.deepEqual(rollPack(pack, cards, on, () => 0), ['a', 'c']);
});

test('rollPack refuses a pull with no card to give', () => {
  assert.throws(() => rollPack({ key: 'x', pulls: [{ weights: { legendary: 1 } }] }, cards, on, () => 0), /no card to give/u);
});

test('a card that writes is not among the leaves where the instance runs no old voice, in the odds or the roll, and is where it does', () => {
  const writer = { key: 'w', rarity: 'rare', writes: { tokens: () => 1, frame: () => ({ prompt: '', stop: [] }) } } as unknown as CardRules;
  const all = [...cards, writer];
  const keys = (settings: { oldVoice: boolean }) => packOdds(pack, all, settings).flat().flatMap((r) => r.cards.map((c) => c.card));
  assert.ok(keys({ oldVoice: true }).includes('w'));
  assert.ok(!keys({ oldVoice: false }).includes('w'), 'the odds do not list it');
  assert.deepEqual(packOdds(pack, all, { oldVoice: false })[1]![1]!.cards, [{ card: 'f', chance: 0.25 }], 'the rare it shared is the only one left');
  assert.deepEqual(rollPack({ key: 'x', pulls: [{ weights: { rare: 1 } }] }, [writer], { oldVoice: true }, () => 0), ['w'], 'where it runs, a rare-only pack can roll it');
  assert.throws(() => rollPack({ key: 'x', pulls: [{ weights: { rare: 1 } }] }, [writer], { oldVoice: false }, () => 0), /no card to give/u, 'and where it does not, it is never rolled');
});
