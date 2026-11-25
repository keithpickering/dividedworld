/**
 * Whoopee Cushion (Pepperoni, common, Set): set face down on one of the player's own posts, it springs on the first common card cast
 * there, whatever its flavor (docs/plans/2026-11-20-whoopee-cushion-design.md). The cast lands as usual and its caster keeps what it earns; each vote
 * it draws, in every quadrant, pays the setter a quarter of a vote (`trap.outcome`, a ride with `every`), for as long as it draws votes.
 * It names no card and no quadrant, so it takes no configuration. A ward on the post is asked before the back, and a Move that lands from a
 * quote is no cast, so neither meets it. A card back shows on the post like any other. A persona is never offered it (`staffOffers`).
 */
import { ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';
import { who } from './seen-words.ts';

export const whoopeeCushion: CardRules<Record<string, never>> = {
  key: 'whoopee-cushion',
  name: 'Whoopee Cushion',
  alignment: 'pepperoni',
  rarity: 'common',
  play: 'set',
  trap: { trigger: { on: 'cast' }, match: { upTo: 'common' }, outcome: { kind: 'ride', share: 0.25, every: true } },
  seen: (p) => `${who(p)}'s Whoopee Cushion went off on this post, ${p.ago}: a card was played here and the whole thread heard a long, loud pfffft.`,
  playPrice: () => 0,
  canApply: () => ok(undefined),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 100;
