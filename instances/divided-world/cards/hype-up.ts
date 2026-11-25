/**
 * Hype-Up (Sweet, common, Cast on a post, anyone's): for 3 days, every positive vote (excited or calm) on the post pays its author a flat vote more,
 * whatever class the author holds, then it ends by itself. It is Publicity Tour's push cast on one post: the quadrants and span are the same list
 * (publicity.ts), at a whole vote, and where the two are up on one vote only the larger pays. It pays the caster nothing for it (docs/plans/2026-11-11-card-notes-design.md, Part 4 plan, and
 * docs/plans/2026-11-13-hype-up-on-a-post-design.md).
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import { HYPE, PUBLICITY_LASTS } from './publicity.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';
import { who } from './seen-words.ts';

export const hypeUp: CardRules<Record<string, never>> = {
  key: 'hype-up',
  name: 'Hype-Up',
  alignment: 'sweet',
  rarity: 'common',
  reaches: ['post'],
  gimmick: HYPE,
  lasts: PUBLICITY_LASTS,
  seen: (p) => `${who(p)} hyped this post up, ${p.ago}: for a few days its author gets a bit more out of every cheer it draws.`,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(hypeUp, target, effects, now),
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 100;
