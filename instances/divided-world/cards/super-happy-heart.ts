/**
 * Super Happy Heart (Sweet, rare, a Move only ever cast face up): Happy Heart's bigger sibling. Cast on a character, it takes every point off that character's warn bar
 * at once (docs/plans/2026-11-11-card-notes-design.md, section 2, and its Part 5 plan). It is over the moment it lands, and refused on an empty bar, as Happy Heart is; the filings stay on the record.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';

export const superHappyHeart: CardRules<Record<string, never>> = {
  key: 'super-happy-heart',
  name: 'Super Happy Heart',
  alignment: 'sweet',
  rarity: 'rare',
  reaches: ['character'],
  discipline: { kind: 'relief', points: 'all' },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(superHappyHeart, target, effects, now),
  validateConfig: () => ok({}),
};
