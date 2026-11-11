/**
 * Divided World's Vending Machine, slot by slot in grid order (docs/plans/2026-11-04-booster-packs-design.md): a price in
 * hundredths of an orb and whether it is on sale. Starting numbers the season review replaces. Main Event starts hidden:
 * the Boss's moves bring it out, and so does Off Day, the legendary, and Sugar Coat, the second rare, which follow it. Hype-Up and Last Word end the on-sale slots (card notes, Part 4), so no drawn slot moves.
 */
import { deepFreeze } from '../../engine/rules/instance.ts';
import type { SlotSeed } from '../../engine/rules/packs.ts';

export const machine: readonly SlotSeed[] = deepFreeze<SlotSeed[]>([
  { item: { pack: 'booster' }, availability: 'onSale', price: 300 },
  { item: { card: 'whoops' }, availability: 'onSale', price: 100 },
  { item: { card: 'stick-around' }, availability: 'onSale', price: 100 },
  { item: { card: 'autocorrect' }, availability: 'onSale', price: 100 },
  { item: { card: 'you-were-saying' }, availability: 'onSale', price: 100 },
  { item: { card: 'publicity-tour' }, availability: 'onSale', price: 150 },
  { item: { card: 'feelin-fab' }, availability: 'onSale', price: 20 },
  { item: { card: 'card-collector' }, availability: 'onSale', price: 150 },
  { item: { card: 'hall-pass' }, availability: 'onSale', price: 150 },
  { item: { card: 'force-field' }, availability: 'onSale', price: 150 },
  { item: { card: 'heat-magnet' }, availability: 'onSale', price: 150 },
  { item: { card: 'class-clown' }, availability: 'onSale', price: 150 },
  { item: { card: 'good-vibes' }, availability: 'onSale', price: 150 },
  { item: { card: 'glitter-bomb' }, availability: 'onSale', price: 150 },
  { item: { card: 'below-the-fold' }, availability: 'onSale', price: 100 },
  { item: { card: 'mooch' }, availability: 'onSale', price: 150 },
  { item: { card: 'toll' }, availability: 'onSale', price: 150 },
  { item: { card: '4d-chess' }, availability: 'onSale', price: 150 },
  { item: { card: 'hype-up' }, availability: 'onSale', price: 150 },
  { item: { card: 'last-word' }, availability: 'onSale', price: 150 },
  { item: { card: 'main-event' }, availability: 'hidden', price: 300 },
  { item: { card: 'off-day' }, availability: 'hidden', price: 500 },
  { item: { card: 'sugar-coat' }, availability: 'hidden', price: 300 },
]);
