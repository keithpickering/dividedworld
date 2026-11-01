/**
 * Trap Card (Salty, uncommon, Set): set face down on one of the player's own posts, it springs on the first card cast there that is
 * no rarer than it, catches that play, and pays the setter exactly what the caster's wallet paid for it (the card mechanic's design,
 * sections 4 and 6). Minus World's Spell Trap, said plainly as the gag it was. A card back shows on the post like any other, so a
 * reader cannot tell it from a Bluff.
 */
import { ok, type CardRules } from '../../../engine/rules/cards.ts';

export const trapCard: CardRules<Record<string, never>> = {
  key: 'trap-card',
  name: 'Trap Card',
  alignment: 'salty',
  rarity: 'uncommon',
  play: 'set',
  trap: { trigger: { on: 'cast' }, outcome: { do: 'payout' } },
  priceKey: 'trapCard.price',
  playPrice: () => 0,
  canApply: () => ok(undefined),
  // It carries nothing: what it pays is what the caught play cost.
  validateConfig: () => ok({}),
};
