/**
 * Thick Skin's own rules: a Gimmick on a character, used and never cast, sold for 150 and held by one character at a time.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePlay, decideUse } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';
import { defaults as settings } from '../settings.ts';
import { instance } from '../index.ts';
import { settle } from '../../../engine/rules/settle.ts';
import type { InputAct, InputReaction, SettlementInput } from '../../../engine/rules/types.ts';
import { thickSkin, price } from './thick-skin.ts';

const character = { reach: 'character' as const, character: 'c1' };
const later = () => new Date(Date.now() + 86_400_000).toISOString();

test('Thick Skin is a sweet uncommon use card, a cushion Gimmick for three days, and the machine sells it for 150', () => {
  assert.deepEqual([thickSkin.key, thickSkin.name, thickSkin.alignment, thickSkin.rarity, thickSkin.play], ['thick-skin', 'Thick Skin', 'sweet', 'uncommon', 'use']);
  assert.deepEqual(thickSkin.gimmick, { kind: 'cushion', share: 0.5 });
  assert.deepEqual(thickSkin.reaches, ['character']);
  assert.deepEqual(thickSkin.lasts, { unit: 'day', count: 3 });
  assert.equal(price, 150);
  const slot = instance.machine.find((m) => 'card' in m.item && m.item.card === 'thick-skin');
  assert.equal(slot?.price, 150, 'the machine sells it for 150');
});

test('Thick Skin lands on a character through decideUse for free, is refused by decidePlay, and a second live one is refused', () => {
  const used = decideUse(thickSkin, settings, character, [], {}, '');
  assert.equal(used.ok, true);
  assert.equal((used as { value: { price: number } }).value.price, 0);
  assert.equal(decidePlay(thickSkin, settings, character, [], {}, '').ok, false, 'a Gimmick is not cast');
  const live = [{ card: 'thick-skin', act: 'k1', reach: 'character' as const, ends: later() }];
  assert.equal(decideUse(thickSkin, settings, character, live, {}, '').ok, false, 'a character holds one at a time');
});

test('the instance is whole with Thick Skin in its pool', () => {
  assert.ok(instance.cards.some((c) => c.key === 'thick-skin'), 'the card is in the pool');
  assert.deepEqual(instanceProblems(instance), []);
});

/* ---- what it pays, settled with the real instance ---- */
const HR = 3_600_000;
const W_FROM = 100 * HR;
const W_TO = 124 * HR;
function board(cls: string, acts: InputAct[], reactions: InputReaction[]): SettlementInput {
  return {
    window: { id: 'w1', from: W_FROM, to: W_TO },
    characters: [
      { id: 'tom-1', player: 'tom', classes: [{ class: cls, from: 0 }] },
      { id: 'bob-1', player: 'bob', classes: [{ class: 'face', from: 0 }] },
    ],
    acts: [{ id: 'tp1', character: 'tom-1', kind: 'post', at: W_FROM + HR, thread: 't1' }, ...acts],
    reactions,
  };
}
const use = (id: string, card: string): InputAct => ({ id, character: 'tom-1', kind: 'card', at: W_FROM + 2 * HR, thread: 't1', card, reach: 'character', on: 'tom-1', ends: W_FROM + 20 * HR });
const heat = (act: string): InputReaction => ({ act, player: 'bob', character: 'bob-1', kind: 'tomato', at: W_FROM + 5 * HR });
const hype = (act: string): InputReaction => ({ act, player: 'bob', character: 'bob-1', kind: 'fire', at: W_FROM + 5 * HR });

test("Thick Skin gives half of a Technician's heat loss back, as a card.cushion", () => {
  const r = settle(board('technician', [use('g1', 'thick-skin')], [heat('tp1')]), instance);
  const mine = r.entries.filter((e) => e.character === 'tom-1');
  assert.deepEqual(mine.map((e) => [e.reason, e.amount]).sort(), [['card.cushion', 5], ['technician.draggedIn', -10]]);
  assert.deepEqual(mine.find((e) => e.reason === 'card.cushion')!.params, { card: 'thick-skin', share: 0.5 });
});

test("Thick Skin leaves a Face's gain alone: no cushion", () => {
  const r = settle(board('face', [use('g1', 'thick-skin')], [hype('tp1')]), instance);
  assert.equal(r.entries.filter((e) => e.reason === 'card.cushion').length, 0);
  assert.deepEqual(r.entries.filter((e) => e.character === 'tom-1').map((e) => [e.reason, e.amount]), [['face.cheered', 10]]);
});

test('Thick Skin halves a loss on a card the character played, not only on a post', () => {
  const play: InputAct = { id: 'k1', character: 'tom-1', kind: 'card', at: W_FROM + 3 * HR, thread: 't1', card: 'whoops', target: 'tp1' };
  const r = settle(board('technician', [use('g1', 'thick-skin'), play], [heat('k1')]), instance);
  const cushion = r.entries.filter((e) => e.character === 'tom-1' && e.reason === 'card.cushion');
  assert.equal(cushion.length, 1);
  assert.equal(cushion[0]!.amount, 5);
  assert.deepEqual(cushion[0]!.params, { card: 'thick-skin', share: 0.5 });
  assert.equal(r.entries.filter((e) => e.character === 'tom-1' && e.reason === 'technician.draggedIn').reduce((t, e) => t + e.amount, 0), -10);
});

test('Thick Skin never softens a Lurker past its posts allowed: the cost is whole and no cushion', () => {
  const posts: InputAct[] = [1, 2, 3].map((n) => ({ id: `lp${n}`, character: 'tom-1', kind: 'post' as const, at: W_FROM + (5 + n) * HR, thread: 't1' }));
  const r = settle(board('lurker', [use('g1', 'thick-skin'), ...posts], []), instance);
  assert.equal(r.entries.filter((e) => e.character === 'tom-1' && e.reason === 'lurker.postedTooMuch').reduce((t, e) => t + e.amount, 0), -10);
  assert.equal(r.entries.filter((e) => e.reason === 'card.cushion').length, 0);
});

test("Thick Skin and Heat Magnet both up on a Technician's heat vote: -10, a cushion of 5 and a boost of 8", () => {
  const r = settle(board('technician', [use('g1', 'thick-skin'), use('g2', 'heat-magnet')], [heat('tp1')]), instance);
  const sum = (reason: string) => r.entries.filter((e) => e.character === 'tom-1' && e.reason === reason).reduce((t, e) => t + e.amount, 0);
  assert.equal(sum('technician.draggedIn'), -10);
  assert.equal(sum('card.cushion'), 5);
  assert.equal(sum('card.boost'), 8, '7.5, rounded');
  assert.deepEqual(r.entries.find((e) => e.reason === 'card.cushion')!.params, { card: 'thick-skin', share: 0.5 });
  assert.deepEqual(r.entries.find((e) => e.reason === 'card.boost')!.params, { card: 'heat-magnet', flat: 0.75 });
});
