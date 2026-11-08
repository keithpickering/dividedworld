/**
 * Bluff (Pepperoni, common, Set): a card back that does nothing (the card mechanic's design, section 6). Set face down, it looks
 * exactly like a Trap Card to everyone but its setter, and ends at its time with nothing revealed: a Bluff stays a bluff.
 */
import { ok, type CardRules } from '../../../engine/rules/cards.ts';

export const bluff: CardRules<Record<string, never>> = {
  key: 'bluff',
  name: 'Bluff',
  alignment: 'pepperoni',
  rarity: 'common',
  play: 'set',
  playPrice: () => 0,
  canApply: () => ok(undefined),
  validateConfig: () => ok({}),
};
