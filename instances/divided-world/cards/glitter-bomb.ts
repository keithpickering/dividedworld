/**
 * Glitter Bomb (Pepperoni, uncommon, Cast on a character): every post of the character it is cast on sparkles for a week, then stops
 * by itself (the card mechanic's design, sections 7 and 8). It falls on the mask alone: nothing reaches its player's other masks or
 * wallet. It costs nothing more to play than its price at the machine.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';

export const glitterBomb: CardRules<Record<string, never>> = {
  key: 'glitter-bomb',
  name: 'Glitter Bomb',
  alignment: 'pepperoni',
  rarity: 'uncommon',
  reaches: ['character'],
  lasts: { unit: 'day', count: 7 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(glitterBomb, target, effects, now),
  validateConfig: () => ok({}),
};
