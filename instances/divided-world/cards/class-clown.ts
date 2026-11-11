/**
 * Class Clown (Pepperoni, uncommon, Gimmick on a character): for 2 days (the design said 36 hours; a span is in days, weeks or months), each 😂 and each 🙄 the character's posts earn counts 0.5
 * more, then it ends by itself (the card types design). The keys are this instance's reactions.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';

export const classClown: CardRules<Record<string, never>> = {
  key: 'class-clown',
  name: 'Class Clown',
  alignment: 'pepperoni',
  rarity: 'uncommon',
  play: 'use',
  reaches: ['character'],
  gimmick: { kind: 'earn', reactions: ['laughing', 'eye-roll'], by: 0.5 },
  lasts: { unit: 'day', count: 2 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(classClown, target, effects, now),
  validateConfig: () => ok({}),
};
