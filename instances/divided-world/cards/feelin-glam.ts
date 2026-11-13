/**
 * Feelin' Glam (Sweet, rare, a Move cast on a thread): for a week every post in the thread is drawn with one more level of Feelin' Fab's rainbow, and a
 * post written in the thread during that week keeps the level after it (docs/plans/2026-11-11-card-notes-design.md, section 2, and its Part 2 plan).
 * It is one play on the thread and nothing is written on any post: the database holds the play and its end, and the screens work out each post's level
 * from the play's dates and the post's (`fallsOn`), handing the play to Feelin' Fab's effect. It ends by itself, and an admin can end it, during the
 * week or after, which takes the level off every post.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';

export const feelinGlam: CardRules<Record<string, never>> = {
  key: 'feelin-glam',
  name: "Feelin' Glam",
  alignment: 'sweet',
  rarity: 'rare',
  reaches: ['thread'],
  lasts: { unit: 'day', count: 7 },
  keeps: true,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(feelinGlam, target, effects, now),
  validateConfig: () => ok({}),
};
