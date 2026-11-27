/**
 * Divided World's Vending Machine, computed by rule from the cards and their prices (docs/plans/2026-11-14-base-set-design.md,
 * section 4.3), so a new card adds no line here and two card builds never meet in this file. The Booster comes first, on sale at 3.00.
 * Then every common is on sale: the Moves, then the Reversals, then the Gimmicks, each group by the card's name. Then every uncommon, rare
 * and legendary card follows, hidden, by rarity and then by name. An event-only card has no slot: it is found only through its events. The owner's words: "I haven't actually been listing uncommons or rarer in
 * the machine, because it incentivizes buying a pack and makes the pulls more special", and the grid must not grow until it scrolls and
 * stops looking like a vending machine (section 0, items 4 and 5). A hidden slot is not drawn, so the grid stays small, and an admin or the
 * Boss's moves can still bring one out (Main Event is brought out that way). A card's price is in its own file (`cards/<key>.ts`).
 * Starting numbers the season review replaces.
 */
import { deepFreeze } from '../../engine/rules/instance.ts';
import { RARITIES, playOf, type CardRules } from '../../engine/rules/cards.ts';
import type { SlotSeed } from '../../engine/rules/packs.ts';
import { cards, prices } from './cards/index.ts';

const PLAYS = ['cast', 'set', 'use'] as const;
const BOOSTER_PRICE = 300;

const byName = (a: CardRules, b: CardRules): number => a.name.localeCompare(b.name, 'en');

/** The machine for a card list and its prices: pure, so its filters are tested on crafted cards as well as on the instance's own. */
export function machineOf(cards: readonly CardRules[], prices: ReadonlyMap<string, number>): SlotSeed[] {
  const slot = (c: CardRules, availability: 'onSale' | 'hidden'): SlotSeed => {
    const price = prices.get(c.key);
    if (price === undefined) throw new Error(`card ${c.key} has no price`);
    return { item: { card: c.key }, availability, price };
  };
  const commons = cards.filter((c) => c.rarity === 'common');
  const rarer = cards.filter((c) => c.rarity !== 'common' && c.eventOnly !== true);
  return [
    { item: { pack: 'booster' }, availability: 'onSale', price: BOOSTER_PRICE },
    ...PLAYS.flatMap((p) => commons.filter((c) => playOf(c) === p).sort(byName)).map((c) => slot(c, 'onSale')),
    ...RARITIES.flatMap((r) => rarer.filter((c) => c.rarity === r).sort(byName)).map((c) => slot(c, 'hidden')),
  ];
}

export const machine: readonly SlotSeed[] = deepFreeze<SlotSeed[]>(machineOf(cards, prices));
