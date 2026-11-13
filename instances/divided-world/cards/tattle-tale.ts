/**
 * Tattle-Tale (Salty, rare, a Move only ever cast face up): cast on a character, it makes a Mod Bot's patrol twice as likely to pick that character's posts to look at, for a week,
 * and then ends by itself (docs/plans/2026-11-11-card-notes-design.md, section 2, and its Part 5 plan). It makes a look likelier and never a ruling: the Mod Bot still judges each post against the rules, and the staff's targeting cap still bounds
 * how often one character can be picked. One is live on a character at a time. The weight is the rules' (`discipline.weight`), and the words that say "twice" read it.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';

export const tattleTale: CardRules<Record<string, never>> = {
  key: 'tattle-tale',
  name: 'Tattle-Tale',
  alignment: 'salty',
  rarity: 'rare',
  reaches: ['character'],
  lasts: { unit: 'day', count: 7 },
  discipline: { kind: 'watch', weight: 2 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(tattleTale, target, effects, now),
  validateConfig: () => ok({}),
};
