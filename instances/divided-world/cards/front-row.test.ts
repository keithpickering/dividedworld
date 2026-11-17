/**
 * Front Row's own rules: a Gimmick a character carries, used on the character and never cast; one at a time; and the machine's price.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidePlay, decideUse, type CardRules, type CardTarget } from '../../../engine/rules/cards.ts';
import { instanceProblems } from '../../../engine/rules/instance.ts';
import { instance } from '../index.ts';
import { defaults as settings } from '../settings.ts';
import { settle } from '../../../engine/rules/settle.ts';
import type { InputAct, InputReaction, SettlementInput } from '../../../engine/rules/types.ts';
import { frontRow, price } from './front-row.ts';

const character: CardTarget = { reach: 'character', character: 'c1' };

test('Front Row is a Pepperoni uncommon use card that earns on reactions to a character\'s cards for three days, and sells for 150', () => {
  assert.equal(frontRow.key, 'front-row');
  assert.equal(frontRow.name, 'Front Row');
  assert.equal(frontRow.alignment, 'pepperoni');
  assert.equal(frontRow.rarity, 'uncommon');
  assert.equal(frontRow.play, 'use');
  assert.deepEqual(frontRow.reaches, ['character']);
  assert.deepEqual(frontRow.gimmick, { kind: 'earn', quadrants: ['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative'], flat: 0.5, acts: ['card', 'spring'] });
  assert.deepEqual(frontRow.lasts, { unit: 'day', count: 3 });
  assert.equal(price, 150);
});

test('Front Row is used on a character through decideUse for 0, is refused by decidePlay, and a second live one is refused', () => {
  const use = decideUse(frontRow, settings, character, [], {}, '');
  assert.deepEqual([use.ok, use.ok ? use.value.price : null], [true, 0]);
  assert.equal(decidePlay(frontRow, settings, character, [], {}, '').ok, false, 'a Gimmick is not cast');
  const live = [{ card: 'front-row', act: 'k1', reach: 'character', ends: new Date(Date.now() + 86_400_000).toISOString() }];
  assert.equal(decideUse(frontRow, settings, character, live, {}, '').ok, false, 'a second live play is refused');
});

test('the instance stays whole with Front Row in its pool', () => {
  assert.ok(instance.cards.some((c) => c.key === 'front-row'), 'the card is in the pool');
  assert.deepEqual(instanceProblems(instance), []);
});

/* ---- what it pays, settled with the real instance ---- */
const HR = 3_600_000;
const W_FROM = 100 * HR;
const W_TO = 124 * HR;
const at = (hours: number) => W_FROM + hours * HR;
const useOnTom = (id: string, card: string, hours = 2): InputAct => ({ id, character: 'tom-1', kind: 'card', at: at(hours), thread: 't1', card, reach: 'character', on: 'tom-1', ends: at(20) });
/** Tom's own cast of a card, on Bob's post. */
const castByTom = (id: string, hours: number): InputAct => ({ id, character: 'tom-1', kind: 'card', at: at(hours), thread: 't1', card: 'feelin-fab', target: 'bp1' });
const vote = (act: string, kind: string, hours: number, who: 'bob' | 'amy' = 'bob'): InputReaction => ({ act, player: who, character: `${who}-1`, kind, at: at(hours) });
function board(cls: string, plays: InputAct[], reactions: InputReaction[]): SettlementInput {
  return {
    window: { id: 'w1', from: W_FROM, to: W_TO },
    characters: [
      { id: 'tom-1', player: 'tom', classes: [{ class: cls, from: 0 }] },
      { id: 'bob-1', player: 'bob', classes: [{ class: 'face', from: 0 }] },
      { id: 'amy-1', player: 'amy', classes: [{ class: 'face', from: 0 }] },
    ],
    acts: [
      { id: 'tp1', character: 'tom-1', kind: 'post', at: at(1), thread: 't1' },
      { id: 'bp1', character: 'bob-1', kind: 'post', at: at(1), thread: 't1' },
      ...plays,
    ],
    reactions,
  };
}
const boosts = (r: ReturnType<typeof settle>) => r.entries.filter((e) => e.character === 'tom-1' && e.reason === 'card.boost');
const amountFor = (r: ReturnType<typeof settle>, reason: string) => r.entries.filter((e) => e.character === 'tom-1' && e.reason === reason).reduce((t, e) => t + e.amount, 0);
const FRONT_ROW = { card: 'front-row', flat: 0.5 };

test('a Lurker under Front Row keeps what its class pays for a vote on a card it cast, and is paid half a vote more', () => {
  const r = settle(board('lurker', [useOnTom('g1', 'front-row'), castByTom('c1', 3)], [vote('c1', 'yawn', 5)]), instance);
  assert.equal(amountFor(r, 'lurker.cardDrew'), 10, 'the class pays as it does without the card');
  assert.equal(amountFor(r, 'card.boost'), 5);
  assert.deepEqual(boosts(r).map((e) => e.params), [FRONT_ROW]);
});

test('a Face under Front Row is paid half a vote more for a groan on a card it cast, whatever the class makes of the vote', () => {
  const r = settle(board('face', [useOnTom('g1', 'front-row'), castByTom('c1', 3)], [vote('c1', 'eye-roll', 5)]), instance);
  assert.equal(amountFor(r, 'card.boost'), 5);
  assert.deepEqual(boosts(r).map((e) => e.params), [FRONT_ROW]);
});

test('a vote on the spring Act of a Reversal the character set is paid half a vote more', () => {
  const spring: InputAct = { id: 's1', character: 'tom-1', kind: 'spring', at: at(3), thread: 't1', card: 'rope-break', target: 'bp1', by: 'bp1' };
  const r = settle(board('face', [useOnTom('g1', 'front-row'), spring], [vote('s1', 'fire', 5)]), instance);
  assert.equal(amountFor(r, 'card.boost'), 5);
  assert.deepEqual(boosts(r).map((e) => e.params), [FRONT_ROW]);
});

test("a vote on the character's post, and a vote on a card from before Front Row was played, are paid no boost", () => {
  const onPost = settle(board('face', [useOnTom('g1', 'front-row')], [vote('tp1', 'fire', 5)]), instance);
  assert.equal(amountFor(onPost, 'card.boost'), 0, "its posts are not its cards");
  const early = settle(board('face', [castByTom('c1', 1.5), useOnTom('g1', 'front-row', 4)], [vote('c1', 'fire', 2)]), instance);
  assert.equal(amountFor(early, 'card.boost'), 0, 'a vote from before the play is not paid');
  // A voter who first reacted before the play and moves their vote after it is still a vote the card did not draw.
  const moved = settle(board('face', [castByTom('c1', 1.5), useOnTom('g1', 'front-row', 4)], [vote('c1', 'fire', 2), vote('c1', 'tomato', 6)]), instance);
  assert.equal(amountFor(moved, 'card.boost'), 0, 'a voter first seen before the play is not paid, even for a later change of vote');
});

test('Front Row and a post-paying earn both up pay one vote each: the card\'s vote by Front Row, the post\'s by the other, and neither twice', () => {
  // Sweet Heat has not merged, so this test's own copy of Front Row's rules carries Sweet Heat's gimmick: half a vote on the two excited quadrants, on posts.
  const sweetHeat: CardRules<Record<string, never>> = { ...frontRow, key: 'sweet-heat', name: 'Sweet Heat', gimmick: { kind: 'earn', quadrants: ['excitedPositive', 'excitedNegative'], flat: 0.5 } };
  const both = { ...instance, cards: [...instance.cards, sweetHeat] };
  const r = settle(board('face', [useOnTom('g1', 'front-row'), useOnTom('g2', 'sweet-heat'), castByTom('c1', 3)], [vote('tp1', 'fire', 5), vote('c1', 'fire', 5, 'amy')]), both);
  const lines = r.details.filter((d) => d.character === 'tom-1' && d.reason === 'card.boost').map((d) => [d.act, d.params?.card, d.amount]).sort();
  assert.deepEqual(lines, [['c1', 'front-row', 5], ['tp1', 'sweet-heat', 5]]);
  assert.equal(amountFor(r, 'card.boost'), 10);
});
