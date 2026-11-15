/**
 * The Vending Machine is computed by rule from the cards and their prices (docs/plans/2026-11-14-base-set-design.md,
 * section 4.3): the Booster, then the commons on sale, then everything rarer hidden.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { machine } from './machine.ts';
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
  const rarer = cards.filter((c) => c.rarity !== 'common');
  const want = RARITIES.flatMap((r) => rarer.filter((c) => c.rarity === r).sort(byName)).map((c) => c.key);
  const hidden = cardSlots.filter((s) => s.availability === 'hidden');
  assert.deepEqual(hidden.map(slotKey), want);
  // and they come after every on-sale card
  const firstHidden = cardSlots.findIndex((s) => s.availability === 'hidden');
  assert.ok(cardSlots.slice(firstHidden).every((s) => s.availability === 'hidden'));
});

test('every card has exactly one slot, and every card slot names a card', () => {
  const keys = cards.map((c) => c.key);
  const slotted = cardSlots.map(slotKey);
  assert.ok(cardSlots.every((s) => 'card' in s.item));
  assert.deepEqual([...slotted].sort(), [...keys].sort());
  assert.equal(new Set(slotted).size, slotted.length);
});

/** Every card's price, as the machine sold it before prices moved into the card files. */
const PRICES: readonly (readonly [string, number])[] = [
  ['whoops', 100],
  ['stick-around', 100],
  ['autocorrect', 100],
  ['you-were-saying', 100],
  ['publicity-tour', 150],
  ['feelin-fab', 20],
  ['this', 20],
  ['card-collector', 150],
  ['hall-pass', 150],
  ['force-field', 150],
  ['heat-magnet', 150],
  ['class-clown', 150],
  ['good-vibes', 150],
  ['glitter-bomb', 150],
  ['below-the-fold', 100],
  ['mooch', 150],
  ['toll', 150],
  ['4d-chess', 150],
  ['jimmy-wails', 200],
  ['hype-up', 100],
  ['last-word', 150],
  ['laugh-track', 150],
  ['overreaction', 100],
  ['blind-study', 150],
  ['happy-heart', 150],
  ['take-the-fall', 150],
  ['main-event', 300],
  ['off-day', 500],
  ['sugar-coat', 300],
  ['graffiti', 300],
  ['line-cutter', 300],
  ['feelin-glam', 300],
  ['whodunnit', 300],
  ['super-happy-heart', 300],
  ['tattle-tale', 300],
  ['ultra-happy-heart', 600],
];

test("every card's slot has the price the machine always sold it at", () => {
  assert.equal(PRICES.length, cards.length);
  const sold = new Map(cardSlots.map((s) => [slotKey(s), s.price]));
  assert.deepEqual(
    PRICES.map(([k]) => [k, sold.get(k)]),
    PRICES,
  );
});
