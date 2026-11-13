/**
 * Happy Heart (Sweet, uncommon, a Move only ever cast face up): cast on a character, it takes the oldest points off that character's warn bar at once, as many as the
 * lightest band of the warn bar lands, or as many as are left (docs/plans/2026-11-11-card-notes-design.md, section 2, and its Part 5 plan). It is over the moment it lands: it leaves no effect, takes no place in a stack and has
 * no time up, and the filings it took points from stay on the record. It is refused on an empty bar, in the same words for every caster, since a warn bar is on every postbit.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';

export const happyHeart: CardRules<Record<string, never>> = {
  key: 'happy-heart',
  name: 'Happy Heart',
  alignment: 'sweet',
  rarity: 'uncommon',
  reaches: ['character'],
  discipline: { kind: 'relief', points: 'lightestBand' },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(happyHeart, target, effects, now),
  validateConfig: () => ok({}),
};
