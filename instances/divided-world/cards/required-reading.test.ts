/**
 * Required Reading's own rules: its facts, the use on a post it lands on (and the cast it refuses), a second live one refused, and that
 * the instance still passes its checks with the card in the pool.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePlay, decideUse } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';
import { instance } from '../index.ts';
import { cards } from './index.ts';
import { price, requiredReading } from './required-reading.ts';
import { defaults as settings } from '../settings.ts';
import { post } from './test-kit.ts';
import { settle } from '../../../engine/rules/settle.ts';
import type { InputAct, InputReaction, SettlementInput } from '../../../engine/rules/types.ts';

test('Required Reading is a Sweet common used on a post, for a week, paying on calm positive reactions, and sold at 1.00', () => {
  assert.deepEqual([requiredReading.key, requiredReading.name, requiredReading.alignment, requiredReading.rarity, requiredReading.play], ['required-reading', 'Required Reading', 'sweet', 'common', 'use']);
  assert.deepEqual(requiredReading.gimmick, { kind: 'earn', quadrants: ['calmPositive'], flat: 1 });
  assert.deepEqual(requiredReading.lasts, { unit: 'week', count: 1 });
  assert.equal(price, 100);
  assert.equal(instance.machine.find((m) => 'card' in m.item && m.item.card === 'required-reading')?.price, 100);
});

test('Required Reading lands on a post through decideUse at no price, is refused by decidePlay, and a second live one is refused', () => {
  const use = decideUse(requiredReading, settings, post(10), [], {}, '');
  assert.equal(use.ok, true);
  assert.equal(use.ok && use.value.price, 0);
  assert.equal(decidePlay(requiredReading, settings, post(10), [], {}, '').ok, false, 'a Gimmick is not cast');
  const live = [{ card: 'required-reading', act: 'k1', ends: new Date(Date.now() + 86_400_000).toISOString() }];
  assert.equal(decideUse(requiredReading, settings, post(10), live, {}, '').ok, false);
});

test('the instance has no problems with Required Reading in the pool', () => {
  assert.equal(cards.some((c) => c.key === 'required-reading'), true);
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
    ],
    acts: [
      { id: 'tp1', character: 'tom-1', kind: 'post', at: W_FROM + HR, thread: 't1' },
      { id: 'tp2', character: 'tom-1', kind: 'post', at: W_FROM + HR, thread: 't1' },
      ...plays,
    ],
    reactions,
  };
}
const readingOn = (id: string, at = W_FROM + 2 * HR): InputAct => ({ id, character: 'tom-1', kind: 'card', at, thread: 't1', card: 'required-reading', target: 'tp1', ends: W_FROM + 20 * HR });
const hypeOn = (id: string, at = W_FROM + 3 * HR): InputAct => ({ id, character: 'bob-1', kind: 'card', at, thread: 't1', card: 'hype-up', target: 'tp1', ends: W_FROM + 20 * HR });
const vote = (kind: string, at: number, act = 'tp1'): InputReaction => ({ act, player: 'bob', character: 'bob-1', kind, at });
const calmAfter = vote('thumbs-up', W_FROM + 5 * HR);
const amountFor = (r: ReturnType<typeof settle>, reason: string) => r.entries.filter((e) => e.character === 'tom-1' && e.reason === reason).reduce((t, e) => t + e.amount, 0);
const boosts = (r: ReturnType<typeof settle>) => r.entries.filter((e) => e.reason === 'card.boost');

test("Required Reading pays a vote more on a Technician's post for one calm vote after the play", () => {
  const r = settle(board('technician', [readingOn('g1')], [calmAfter]), instance);
  assert.equal(amountFor(r, 'technician.respected'), 10);
  assert.equal(boosts(r).length, 1);
  assert.equal(amountFor(r, 'card.boost'), 10);
  assert.deepEqual(boosts(r)[0]!.params, { card: 'required-reading', flat: 1 });
});

test("Required Reading pays the same vote more on a Heel's post, whose own line is a loss", () => {
  const r = settle(board('heel', [readingOn('g1')], [calmAfter]), instance);
  assert.equal(amountFor(r, 'heel.shrugged'), -10);
  assert.equal(boosts(r).length, 1);
  assert.equal(amountFor(r, 'card.boost'), 10);
  assert.deepEqual(boosts(r)[0]!.params, { card: 'required-reading', flat: 1 });
});

test('Required Reading pays nothing more for a hype vote', () => {
  const r = settle(board('technician', [readingOn('g1')], [vote('fire', W_FROM + 5 * HR)]), instance);
  assert.equal(amountFor(r, 'technician.respected'), 0, 'the hype vote is no calm vote');
  assert.equal(boosts(r).length, 0);
});

test('Required Reading pays nothing more for a calm vote before the play', () => {
  const r = settle(board('technician', [readingOn('g1')], [vote('thumbs-up', W_FROM + 90 * 60_000)]), instance);
  assert.equal(amountFor(r, 'technician.respected'), 10, 'the vote still pays its class');
  assert.equal(boosts(r).length, 0);
});

test('Required Reading pays nothing more for a calm vote from a player who first reacted before the play', () => {
  const r = settle(board('technician', [readingOn('g1')], [vote('fire', W_FROM + 90 * 60_000), calmAfter]), instance);
  assert.ok(amountFor(r, 'technician.respected') > 0, 'the later calm vote still pays its class, by its own share');
  assert.equal(boosts(r).length, 0);
});

test("Required Reading pays nothing more for a calm vote on another post of the same character", () => {
  const r = settle(board('technician', [readingOn('g1')], [vote('thumbs-up', W_FROM + 5 * HR, 'tp2')]), instance);
  assert.equal(amountFor(r, 'technician.respected'), 10, 'the other post still pays its class');
  assert.equal(boosts(r).length, 0);
});

test("Required Reading and Hype-Up both up on one post pay one boost for a calm vote, the earlier play's, and Hype-Up's alone for a hype vote", () => {
  const calm = settle(board('technician', [readingOn('g1'), hypeOn('g2')], [calmAfter]), instance);
  assert.equal(boosts(calm).length, 1);
  assert.equal(boosts(calm)[0]!.amount, 10);
  assert.deepEqual(boosts(calm)[0]!.params, { card: 'required-reading', flat: 1 });
  const hype = settle(board('technician', [readingOn('g1'), hypeOn('g2')], [vote('fire', W_FROM + 5 * HR)]), instance);
  assert.equal(boosts(hype).length, 1);
  assert.equal(boosts(hype)[0]!.amount, 10);
  assert.deepEqual(boosts(hype)[0]!.params, { card: 'hype-up', flat: 1 });
});
