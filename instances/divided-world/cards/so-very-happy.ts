/**
 * So Very Happy (Salty, rare, Set): set face down on one of the player's own posts, it springs on the first Move up to rare that isn't Sweet
 * played there (docs/plans/2026-11-21-so-very-happy-plan.md). The Move lands as usual, and whoever played it is locked out of that post's
 * thread for 24 hours (`trap.outcome`, a lockout). It takes no configuration. A ward on the post is asked before the back, and a Move that
 * lands from a quote is no play, so neither meets it.
 */
import { ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';
import { who } from './seen-words.ts';

export const soVeryHappy: CardRules<Record<string, never>> = {
  key: 'so-very-happy',
  name: 'SoVeryHappy',
  alignment: 'salty',
  rarity: 'rare',
  play: 'set',
  trap: { trigger: { on: 'cast' }, match: { flavors: ['salty', 'pepperoni'], upTo: 'rare' }, outcome: { kind: 'lockout', hours: 24 } },
  seen: (p) => `${who(p)}'s SoVeryHappy sprang on this post, ${p.ago}: the move played here landed as usual, and whoever played it has been locked out of this thread for a day.`,
  playPrice: () => 0,
  canApply: () => ok(undefined),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 300;
