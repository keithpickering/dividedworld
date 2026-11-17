/**
 * Sweet Heat (Pepperoni, uncommon, Gimmick on a character): for 3 days, each excited vote on the character's posts, positive (hype) or
 * negative (heat), pays half a vote more, to any class, then it ends by itself (docs/plans/2026-11-16-settlement-design.md, section 4). The
 * settlement's is the pay, the largest-applies rule and the own-player rule; this file names only the effect and its size. It is uncommon, as a
 * card that reaches a character is here (`reachRarity`, ../settings.ts).
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';

export const sweetHeat: CardRules<Record<string, never>> = {
  key: 'sweet-heat',
  name: 'Sweet Heat',
  alignment: 'pepperoni',
  rarity: 'uncommon',
  play: 'use',
  reaches: ['character'],
  gimmick: { kind: 'earn', quadrants: ['excitedPositive', 'excitedNegative'], flat: 0.5 },
  lasts: { unit: 'day', count: 3 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(sweetHeat, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 150;
