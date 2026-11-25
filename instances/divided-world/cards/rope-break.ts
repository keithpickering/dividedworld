/**
 * Rope Break (Sweet, common, Set): set face down on one of the player's own posts, it springs on the first Salty common card cast
 * there and catches it: the cast does nothing, and its card goes to the setter's hand (docs/plans/2026-11-15-wave-1-cards-design.md,
 * section 2.1). It names no card: it matches by flavor and rarity (`trap.match`), the first card here that does. A ward on the post
 * is asked before the back, and a Move that lands from a quote is no cast, so neither meets it. A card back shows on the post like
 * any other, so a reader cannot tell it from a Hall Pass or a Move.
 */
import { ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';
import { who } from './seen-words.ts';

export const ropeBreak: CardRules<Record<string, never>> = {
  key: 'rope-break',
  name: 'Rope Break',
  alignment: 'sweet',
  rarity: 'common',
  play: 'set',
  trap: { trigger: { on: 'cast' }, match: { flavors: ['salty'], upTo: 'common' } },
  seen: (p) => `${who(p)}'s Rope Break sprang on this post, ${p.ago}: a Salty card played here snapped against it, did nothing, and ended up in the setter's hand.`,
  playPrice: () => 0,
  canApply: () => ok(undefined),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 100;
