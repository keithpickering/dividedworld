/**
 * Feelin' Fab (Sweet, common, Cast on a post): the post glows in a rainbow under its words, richer for each Feelin' Fab up on it, three
 * at most (docs/plans/2026-11-02-onboarding-design.md, section 5). It is the Face's card, the one a new Face starts with, and it
 * lasts as long as the post does. It costs nothing more to play than its price at the machine, which is the lowest in the shop.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';

export const feelinFab: CardRules<Record<string, never>> = {
  key: 'feelin-fab',
  name: "Feelin' Fab",
  alignment: 'sweet',
  rarity: 'common',
  reaches: ['post'],
  stack: 3,
  priceKey: 'feelinFab.price',
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(feelinFab, target, effects, now),
  validateConfig: () => ok({}),
};
