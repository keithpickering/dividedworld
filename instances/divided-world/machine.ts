/**
 * Divided World's Vending Machine, slot by slot in grid order (docs/plans/2026-11-04-booster-packs-design.md): a price in
 * hundredths of an orb and whether it is on sale. Starting numbers the season review replaces. Main Event starts hidden:
 * the Boss's moves bring it out. Off Day, the legendary, and Sugar Coat, the second rare, start hidden too and follow it, and Graffiti, the third rare, after them.
 * Line Cutter and Feelin' Glam (card notes, Part 2), the fourth and fifth rares, are hidden too, and Whodunnit? (card notes, Part 3), the sixth rare, is hidden after them, so no slot before them moves.
 * Jimmy Wails was the last on-sale slot; Hype-Up and Last Word (card notes, Part 4) follow it, so no drawn slot moves; Laugh Track follows those, then Overreaction and Blind Study (card notes, Part 3).
 * Happy Heart and Take the Fall (card notes, Part 5), the two uncommons, end the on-sale run after Blind Study, and the hidden Super Happy Heart, Tattle-Tale and Ultra Happy Heart,
 * the rares and the legendary, are last of all after Whodunnit?, so no slot above them moves.
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
  { item: { card: 'jimmy-wails' }, availability: 'onSale', price: 200 },
  { item: { card: 'hype-up' }, availability: 'onSale', price: 150 },
  { item: { card: 'last-word' }, availability: 'onSale', price: 150 },
  { item: { card: 'laugh-track' }, availability: 'onSale', price: 150 },
  { item: { card: 'overreaction' }, availability: 'onSale', price: 100 },
  { item: { card: 'blind-study' }, availability: 'onSale', price: 150 },
  { item: { card: 'happy-heart' }, availability: 'onSale', price: 150 },
  { item: { card: 'take-the-fall' }, availability: 'onSale', price: 150 },
  { item: { card: 'main-event' }, availability: 'hidden', price: 300 },
  { item: { card: 'off-day' }, availability: 'hidden', price: 500 },
  { item: { card: 'sugar-coat' }, availability: 'hidden', price: 300 },
  { item: { card: 'graffiti' }, availability: 'hidden', price: 300 },
  { item: { card: 'line-cutter' }, availability: 'hidden', price: 300 },
  { item: { card: 'feelin-glam' }, availability: 'hidden', price: 300 },
  { item: { card: 'whodunnit' }, availability: 'hidden', price: 300 },
  { item: { card: 'super-happy-heart' }, availability: 'hidden', price: 300 },
  { item: { card: 'tattle-tale' }, availability: 'hidden', price: 300 },
  { item: { card: 'ultra-happy-heart' }, availability: 'hidden', price: 600 },
]);
