/**
 * Ultra Happy Heart (Sweet, legendary, a Move only ever cast face up): the Unban. Cast on a banned character, it ends every ban running on that character at once, so
 * the character can post, react and play cards again from that moment (docs/plans/2026-11-11-card-notes-design.md, section 2, and its Part 5 plan). The ban stays on the record and still counts on the season's ladder, and
 * the warn bar is not touched. It is over the moment it lands, and refused on a character that is not banned. A banned character plays no card, so another character plays it.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';

export const ultraHappyHeart: CardRules<Record<string, never>> = {
  key: 'ultra-happy-heart',
  name: 'Ultra Happy Heart',
  alignment: 'sweet',
  rarity: 'legendary',
  reaches: ['character'],
  discipline: { kind: 'unban' },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(ultraHappyHeart, target, effects, now),
  validateConfig: () => ok({}),
};
