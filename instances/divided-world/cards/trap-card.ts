/**
 * Trap Card (Salty, uncommon, Set): set face down on one of the player's own posts, it names one card, springs on the first play
 * of that card cast there, catches that play, and takes its card into the setter's hand; no money moves (the face-down Moves
 * design, section 4, which replaced the card mechanic design's payout). Minus World's Spell Trap, said plainly as the gag it
 * was. A card back shows on the post like any other, so a reader cannot tell it from a Bluff, a Hall Pass or a Move.
 *
 * - **Its configuration** is `{ card }`, the key of the card it catches, 1 to 64 characters. Whether it is a card of the instance
 *   that is cast on a post is `decideSet`'s to check against the instance's list, so this file imports no other card.
 * - **Its staff options** give a persona the card as an enum of the instance's cards cast on a post, which `cards/index.ts` builds once the list exists.
 */
import { ok, refuse, type CardRules } from '../../../engine/rules/cards.ts';

export type TrapCardConfig = { readonly card: string };

export const CARD_KEY = { least: 1, most: 64 } as const;

export const trapCard: CardRules<TrapCardConfig> = {
  key: 'trap-card',
  name: 'Trap Card',
  alignment: 'salty',
  rarity: 'uncommon',
  play: 'set',
  trap: { trigger: { on: 'cast' } },
  catches: (config) => config.card,
  playPrice: () => 0,
  canApply: () => ok(undefined),
  validateConfig: (config) => {
    const card = typeof config === 'object' && config !== null ? (config as { card?: unknown }).card : undefined;
    if (typeof card !== 'string') return refuse('the card is the key of the card to catch');
    if (card.length < CARD_KEY.least || card.length > CARD_KEY.most) return refuse(`the card is a key of ${CARD_KEY.least} to ${CARD_KEY.most} characters`);
    return ok({ card });
  },
};
