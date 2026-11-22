import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardNameOf } from './card-names.ts';
import { inPrint } from './cards.ts';
import type { CardRules } from './cards.ts';
import type { Instance } from './types.ts';

const card = (over: Record<string, unknown>) => ({ key: 'a', name: 'A', alignment: 'salty', rarity: 'common', ...over }) as unknown as CardRules;
const shelf = {
  cards: [card({ key: 'new', name: 'New', formerly: [{ key: 'old', name: 'Old' }] }), card({ key: 'b', name: 'B', retired: true })],
  withdrawn: [{ key: 'gone', name: 'Gone', refund: 100 }],
} as Pick<Instance, 'cards' | 'withdrawn'>;

test('a card\'s name is found from the card, from a card\'s formerly, and from the withdrawn', () => {
  assert.equal(cardNameOf(shelf, 'new'), 'New');
  assert.equal(cardNameOf(shelf, 'b'), 'B');
  assert.equal(cardNameOf(shelf, 'old'), 'Old');
  assert.equal(cardNameOf(shelf, 'gone'), 'Gone');
});

test('a key nothing knows has no name', () => {
  assert.equal(cardNameOf(shelf, 'ghost'), undefined);
});

test('a card is in print unless it is retired', () => {
  assert.equal(inPrint(card({})), true);
  assert.equal(inPrint(card({ retired: true })), false);
});
