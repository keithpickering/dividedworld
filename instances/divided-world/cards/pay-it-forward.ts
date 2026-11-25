/**
 * Pay It Forward (Sweet, uncommon, Set): set face down on one of the player's own posts, it springs on the first Sweet card up to uncommon
 * cast there (docs/plans/2026-11-20-refund-outcome-design.md). The cast lands as usual, and its card goes back to its caster's hand
 * (`trap.outcome`, a refund); the setter is paid nothing for it. A staff cast passes over it. It takes no configuration. A ward on the post
 * is asked before the back, and a Move that lands from a quote is no cast, so neither meets it.
 */
import { ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';
import { who } from './seen-words.ts';

export const payItForward: CardRules<Record<string, never>> = {
  key: 'pay-it-forward',
  name: 'Pay It Forward',
  alignment: 'sweet',
  rarity: 'uncommon',
  play: 'set',
  trap: { trigger: { on: 'cast' }, match: { flavors: ['sweet'], upTo: 'uncommon' }, outcome: { kind: 'refund' } },
  seen: (p) => `${who(p)}'s Pay It Forward sprang on this post, ${p.ago}: a kind card played here landed fine, and was handed right back to the one who played it.`,
  playPrice: () => 0,
  canApply: () => ok(undefined),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 150;
