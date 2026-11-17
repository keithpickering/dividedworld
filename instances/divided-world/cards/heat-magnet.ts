/**
 * Heat Magnet (Salty, uncommon, Gimmick on a character): for 3 days, every negative vote (excited or bored) on the character's
 * posts pays a flat three quarters of a vote more, whatever class the character holds, then it ends by itself (the card types design,
 * and docs/plans/2026-11-16-settlement-design.md). It pays on top of the class and never deepens a loss. Its price and size are section 4 of docs/plans/2026-11-15-base-set-card-numbers-design.md; it stayed uncommon, since a
 * card that reaches a character is uncommon or rarer here (`reachRarity`, ../settings.ts).
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';

export const heatMagnet: CardRules<Record<string, never>> = {
  key: 'heat-magnet',
  name: 'Heat Magnet',
  alignment: 'salty',
  rarity: 'uncommon',
  play: 'use',
  reaches: ['character'],
  gimmick: { kind: 'earn', quadrants: ['excitedNegative', 'boredNegative'], flat: 0.75 },
  lasts: { unit: 'day', count: 3 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(heatMagnet, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 100;
