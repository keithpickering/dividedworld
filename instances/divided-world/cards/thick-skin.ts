/**
 * Thick Skin (Sweet, uncommon, Gimmick on a character): for 3 days, half of each loss the character's class takes from reactions, a reaction's
 * or a whole window's, is given back, then it ends by itself (docs/plans/2026-11-16-settlement-design.md, sections 3.2 and 4). It changes no gain, and no cost that no
 * reaction caused. The settlement's is the giving back; this file names only the effect and its share.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';

export const thickSkin: CardRules<Record<string, never>> = {
  key: 'thick-skin',
  name: 'Thick Skin',
  alignment: 'sweet',
  rarity: 'uncommon',
  play: 'use',
  reaches: ['character'],
  gimmick: { kind: 'cushion', share: 0.5 },
  lasts: { unit: 'day', count: 3 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(thickSkin, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 150;
