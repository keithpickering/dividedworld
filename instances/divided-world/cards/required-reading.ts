/**
 * Required Reading (Sweet, common, Gimmick on the player's own post): for a week, each calm positive vote on the post pays its author a
 * vote more, to any class, then it ends by itself (docs/plans/2026-11-16-settlement-design.md, section 4). It counts votes from players
 * who first react to the post while it is up. The settlement's is the pay and the largest-applies rule (a Hype-Up on the same post pays the same vote once, not twice); the
 * engine's is the week, the one-live-per-post stack and that the post is the player's own.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';
import { who } from './seen-words.ts';

export const requiredReading: CardRules<Record<string, never>> = {
  key: 'required-reading',
  name: 'Required Reading',
  alignment: 'sweet',
  rarity: 'common',
  play: 'use',
  gimmick: { kind: 'earn', quadrants: ['calmPositive'], flat: 1 },
  lasts: { unit: 'week', count: 1 },
  seen: (p) => `${who(p)} marked this post Required Reading, ${p.ago}: for a week a calm thumbs-up on it earns its author a little extra.`,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(requiredReading, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 100;
