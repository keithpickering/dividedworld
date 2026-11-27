/**
 * The Vending Machine is computed by rule from the cards and their prices (docs/plans/2026-11-14-base-set-design.md,
 * section 4.3): the Booster, then the commons on sale, then everything rarer hidden.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machine, machineOf } from './machine.ts';
import { cards } from './cards/index.ts';
import { RARITIES, playOf, type CardRules } from '../../engine/rules/cards.ts';

const byName = (a: CardRules, b: CardRules): number => a.name.localeCompare(b.name, 'en');
const PLAYS = ['cast', 'set', 'use'] as const;
const slotKey = (s: (typeof machine)[number]): string | undefined => ('card' in s.item ? s.item.card : undefined);
const cardSlots = machine.slice(1);

test('the first slot is the Booster, on sale at 3.00', () => {
  assert.deepEqual(machine[0], { item: { pack: 'booster' }, availability: 'onSale', price: 300 });
});

test('the on-sale cards after the Booster are exactly the commons: Moves, then Reversals, then Gimmicks, each by name', () => {
  const commons = cards.filter((c) => c.rarity === 'common');
  const want = PLAYS.flatMap((p) => commons.filter((c) => playOf(c) === p).sort(byName)).map((c) => c.key);
  const got = cardSlots.filter((s) => s.availability === 'onSale').map(slotKey);
  assert.deepEqual(got, want);
});

test('the rest are every uncommon, rare and legendary card, hidden, by rarity and then by name', () => {
  const rarer = cards.filter((c) => c.rarity !== 'common' && c.eventOnly !== true);
  const want = RARITIES.flatMap((r) => rarer.filter((c) => c.rarity === r).sort(byName)).map((c) => c.key);
  const hidden = cardSlots.filter((s) => s.availability === 'hidden');
  assert.deepEqual(hidden.map(slotKey), want);
  // and they come after every on-sale card
  const firstHidden = cardSlots.findIndex((s) => s.availability === 'hidden');
  assert.ok(cardSlots.slice(firstHidden).every((s) => s.availability === 'hidden'));
});

test('no slot names an event-only card: an event-only card is found only through its events', () => {
  const eventOnly = cards.filter((c) => c.eventOnly === true).map((c) => c.key);
  assert.deepEqual(cardSlots.map(slotKey).filter((k) => k !== undefined && eventOnly.includes(k)), []);
});

test('every card has exactly one slot, and every card slot names a card', () => {
  const keys = cards.map((c) => c.key);
  const slotted = cardSlots.map(slotKey);
  assert.ok(cardSlots.every((s) => 'card' in s.item));
  assert.deepEqual([...slotted].sort(), [...keys].sort());
  assert.equal(new Set(slotted).size, slotted.length);
});

test('machineOf gives an event-only card no slot, and a plain card of the same rarity its slot', () => {
  const base = cards.find((c) => c.rarity === 'rare');
  assert.ok(base !== undefined);
  const plain: CardRules = { ...base, key: 'plainRare', name: 'Plain Rare' };
  const only: CardRules = { ...base, key: 'onlyRare', name: 'Only Rare', eventOnly: true };
  const slots = machineOf([only, plain], new Map([['plainRare', 500], ['onlyRare', 500]]));
  assert.deepEqual(slots.slice(1).map(slotKey), ['plainRare']);
});
