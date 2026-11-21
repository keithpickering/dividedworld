/**
 * Cheap Shot (Salty, uncommon, Gimmick on a character): the character's next Move within 3 days gets past every ward and every catching
 * card set face down that is no rarer than uncommon, and spends it (docs/plans/2026-11-20-cheap-shot-design.md). A ride or a refund springs as
 * usual. With no Move cast, it ends by itself after 3 days.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';

export const cheapShot: CardRules<Record<string, never>> = {
  key: 'cheap-shot',
  name: 'Cheap Shot',
  alignment: 'salty',
  rarity: 'uncommon',
  play: 'use',
  reaches: ['character'],
  gimmick: { kind: 'pierce', upTo: 'uncommon' },
  lasts: { unit: 'day', count: 3 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(cheapShot, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 150;
