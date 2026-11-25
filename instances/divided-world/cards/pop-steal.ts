/**
 * Pop Steal (Salty, common, Set): set face down on one of the player's own posts, it springs on the first Sweet common card cast
 * there and catches it: the cast does nothing, and its card goes to the setter's hand (docs/plans/2026-11-20-class-balance-design.md,
 * section 4). It is Rope Break's mirror (rope-break.ts), the same configuration with the other flavor, and needs no engine work. It
 * names no card: it matches by flavor and rarity (`trap.match`). A ward on the post is asked before the back, and a Move that lands
 * from a quote is no cast, so neither meets it. A card back shows on the post like any other, so a reader cannot tell it from a Hall
 * Pass or a Move.
 */
import { ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';
import { who } from './seen-words.ts';

export const popSteal: CardRules<Record<string, never>> = {
  key: 'pop-steal',
  name: 'Pop Steal',
  alignment: 'salty',
  rarity: 'common',
  play: 'set',
  trap: { trigger: { on: 'cast' }, match: { flavors: ['sweet'], upTo: 'common' } },
  seen: (p) => `${who(p)}'s Pop Steal sprang on this post, ${p.ago}: a sweet little card played here was snatched out of the air, did nothing, and ended up in the thief's pocket.`,
  playPrice: () => 0,
  canApply: () => ok(undefined),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 100;
