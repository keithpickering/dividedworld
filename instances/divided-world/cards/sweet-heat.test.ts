/**
 * Sweet Heat's own rules: it is used on a character, never cast, and one live at a time on a character. And what it pays, settled with the real instance.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePlay, decideUse } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';
import { settle } from '../../../engine/rules/settle.ts';
import type { InputAct, InputReaction, SettlementInput } from '../../../engine/rules/types.ts';
import { instance } from '../index.ts';
import { defaults as settings } from '../settings.ts';
import { sweetHeat, price } from './sweet-heat.ts';

const character = { reach: 'character' as const, character: 'c1' };

test('Sweet Heat has its facts: a pepperoni uncommon use on a character, half a vote more on excited reactions for 3 days, sold for 150', () => {
  assert.equal(sweetHeat.key, 'sweet-heat');
  assert.equal(sweetHeat.name, 'Sweet Heat');
  assert.equal(sweetHeat.alignment, 'pepperoni');
  assert.equal(sweetHeat.rarity, 'uncommon');
  assert.equal(sweetHeat.play, 'use');
  assert.deepEqual(sweetHeat.reaches, ['character']);
  assert.deepEqual(sweetHeat.gimmick, { kind: 'earn', quadrants: ['excitedPositive', 'excitedNegative'], flat: 0.5 });
  assert.deepEqual(sweetHeat.lasts, { unit: 'day', count: 3 });
  assert.equal(price, 150);
});

test('Sweet Heat lands on a character through decideUse for free, is refused by decidePlay, and a second live one is refused', () => {
  assert.deepEqual(decideUse(sweetHeat, settings, character, [], {}, '').ok, true);
  assert.equal((decideUse(sweetHeat, settings, character, [], {}, '') as { value: { price: number } }).value.price, 0);
  assert.equal(decidePlay(sweetHeat, settings, character, [], {}, '').ok, false, 'a Gimmick is not cast');
  const live = [{ card: 'sweet-heat', act: 'k1', reach: 'character' as const, ends: new Date(Date.now() + 86_400_000).toISOString() }];
  assert.equal(decideUse(sweetHeat, settings, character, live, {}, '').ok, false);
});

test('the instance is whole with Sweet Heat in its pool', () => {
  assert.deepEqual(instanceProblems(instance), []);
});

/* ---- what it pays, settled with the real instance ---- */
const HR = 3_600_000;
const W_FROM = 100 * HR;
const W_TO = 124 * HR;
function board(cls: string, plays: InputAct[], reactions: InputReaction[]): SettlementInput {
  return {
    window: { id: 'w1', from: W_FROM, to: W_TO },
    characters: [
      { id: 'tom-1', player: 'tom', classes: [{ class: cls, from: 0 }] },
      { id: 'bob-1', player: 'bob', classes: [{ class: 'face', from: 0 }] },
      { id: 'cat-1', player: 'cat', classes: [{ class: 'face', from: 0 }] },
    ],
    acts: [{ id: 'tp1', character: 'tom-1', kind: 'post', at: W_FROM + HR, thread: 't1' }, ...plays],
    reactions,
  };
}
const use = (id: string, card: string, at = W_FROM + 2 * HR): InputAct => ({ id, character: 'tom-1', kind: 'card', at, thread: 't1', card, reach: 'character', on: 'tom-1', ends: at + 18 * HR });
const vote = (kind: string, player = 'bob', at = W_FROM + 5 * HR, act = 'tp1'): InputReaction => ({ act, player, character: `${player}-1`, kind, at });
const amountFor = (r: ReturnType<typeof settle>, reason: string) => r.entries.filter((e) => e.character === 'tom-1' && e.reason === reason).reduce((t, e) => t + e.amount, 0);
const boosts = (r: ReturnType<typeof settle>) => r.entries.filter((e) => e.character === 'tom-1' && e.reason === 'card.boost');

test('a Face under Sweet Heat with one hype vote from another player: cheered 10 and a boost of 5', () => {
  const r = settle(board('face', [use('g1', 'sweet-heat')], [vote('fire')]), instance);
  assert.equal(amountFor(r, 'face.cheered'), 10);
  assert.equal(amountFor(r, 'card.boost'), 5);
  assert.deepEqual(boosts(r)[0]!.params, { card: 'sweet-heat', flat: 0.5 });
});

test('a Technician under Sweet Heat with one heat vote: dragged in -10 and the same boost of 5', () => {
  const r = settle(board('technician', [use('g1', 'sweet-heat')], [vote('tomato')]), instance);
  assert.equal(amountFor(r, 'technician.draggedIn'), -10);
  assert.equal(amountFor(r, 'card.boost'), 5);
  assert.deepEqual(boosts(r)[0]!.params, { card: 'sweet-heat', flat: 0.5 });
});

test('a Tweener under Sweet Heat with one hype and one heat vote from two players: its split as today, and a boost of 10', () => {
  const votes = [vote('fire', 'bob'), vote('tomato', 'cat')];
  const bare = settle(board('tweener', [], votes), instance);
  const r = settle(board('tweener', [use('g1', 'sweet-heat')], votes), instance);
  assert.equal(amountFor(bare, 'tweener.splitTheRoom'), 20);
  assert.equal(amountFor(r, 'tweener.splitTheRoom'), amountFor(bare, 'tweener.splitTheRoom'));
  assert.equal(amountFor(r, 'card.boost'), 10);
  assert.ok(boosts(r).every((e) => (e.params as { card: string; flat: number }).card === 'sweet-heat' && (e.params as { flat: number }).flat === 0.5));
});

test('a calm vote, a vote on a card the character played, and a vote before the play earn no boost', () => {
  const play = use('g1', 'sweet-heat');
  assert.deepEqual(boosts(settle(board('face', [play], [vote('thumbs-up')]), instance)), [], 'calm');
  assert.deepEqual(boosts(settle(board('face', [play], [vote('eye-roll')]), instance)), [], 'calm and negative');
  assert.deepEqual(boosts(settle(board('face', [play], [vote('fire', 'bob', W_FROM + 5 * HR, 'g1')]), instance)), [], 'on a card the character played');
  assert.deepEqual(boosts(settle(board('face', [play], [vote('fire', 'bob', W_FROM + 90 * 60_000)]), instance)), [], 'before the play');
});

test('Heat Magnet and Sweet Heat both up on one heat vote make one boost, the larger: 8 of Heat Magnet', () => {
  const r = settle(board('technician', [use('g1', 'sweet-heat'), use('g2', 'heat-magnet', W_FROM + 3 * HR)], [vote('tomato')]), instance);
  assert.equal(boosts(r).length, 1);
  assert.equal(boosts(r)[0]!.amount, 8, '7.5, rounded');
  assert.deepEqual(boosts(r)[0]!.params, { card: 'heat-magnet', flat: 0.75 });
});
