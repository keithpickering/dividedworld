/**
 * Divided World's packs: the Starter Pack (docs/plans/2026-11-18-starter-pack-design.md) is six common cards, two of each
 * flavor, and every one plays free on a target the settings price at nothing; it holds no Reversal that catches a Salty card
 * (docs/plans/2026-11-20-class-balance-design.md, section 3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFixed } from '../../engine/rules/packs.ts';
import { instanceProblems } from '../../engine/rules/instance.ts';
import { instance } from './index.ts';
import { defaults as settings } from './settings.ts';
import { on } from './cards/test-kit.ts';

const starter = instance.packs.find((p) => p.key === 'starter');
const held = () => {
  assert.ok(starter && isFixed(starter), 'the Starter Pack is a fixed pack');
  return starter.contents.map((key) => instance.cards.find((c) => c.key === key)!);
};

test('the starter is the instance\'s starting pack', () => {
  assert.equal(settings.startingPack, 'starter');
});

test('the starter is six cards, two of each flavor, every one common', () => {
  const cards = held();
  assert.equal(cards.length, 6);
  assert.ok(cards.every(Boolean), 'every key is a card of the instance');
  assert.ok(cards.every((c) => c.rarity === 'common'));
  const flavors = new Map<string, number>();
  for (const c of cards) flavors.set(c.alignment, (flavors.get(c.alignment) ?? 0) + 1);
  assert.deepEqual([...flavors.keys()].sort(), ['pepperoni', 'salty', 'sweet']);
  assert.ok([...flavors.values()].every((n) => n === 2));
});

test('each starter card has a target its playPrice prices at 0', () => {
  const short = 'a'.repeat(settings.economy['whoops.lengthStep']! - 1);
  const phrase = 'a'.repeat(settings.economy['autocorrect.volumeStep']! - 1);
  for (const card of held()) {
    const config = card.key === 'whoops' ? { ink: 'x' } : card.key === 'autocorrect' ? { phrase } : card.key === 'this' ? { phrase: 'a', words: '' } : {};
    const target = card.key === 'autocorrect' ? on(`${phrase} and more words`) : on(short);
    assert.equal(card.playPrice(settings, target, config as never, []), 0, card.key);
  }
});

test('the free targets sit just under the step: one character more costs Aura', () => {
  const card = (key: string) => instance.cards.find((c) => c.key === key)!;
  const long = 'a'.repeat(settings.economy['whoops.lengthStep']!);
  const phrase = 'a'.repeat(settings.economy['autocorrect.volumeStep']!);
  assert.ok(card('whoops').playPrice(settings, on(long), { ink: 'x' } as never, []) > 0);
  assert.ok(card('autocorrect').playPrice(settings, on(`${phrase} and more words`), { phrase } as never, []) > 0);
});

test('the instance with the starter has no problems', () => {
  assert.deepEqual(instanceProblems(instance), []);
});

// docs/plans/2026-11-20-class-balance-design.md, section 3: a Reversal in every new player's hand that catches Salty cards taxes
// the Salty classes' own starter cards, so the pack holds none; changing that is a decision this test makes someone state.
test('the starter holds no Reversal that catches a Salty card', () => {
  for (const card of held()) {
    assert.ok(!card.trap?.match?.flavors?.includes('salty'), `${card.key} catches Salty cards`);
  }
});
