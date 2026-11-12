/**
 * Line Cutter (Pepperoni, rare, a Move only ever cast face up): the caster writes a reply with the play, and the reply is drawn right under the post it is
 * played on, on that post's page, however long the thread grows (docs/plans/2026-11-11-card-notes-design.md, section 2, and its Part 2 plan). The reply
 * is an ordinary post with its own number; the database writes it with the play and remembers which post it sits under (`post_under`), and the thread
 * screen draws it there and leaves its number empty. One fits under a post, and a reply that cut in takes none under it. It does not end by itself: an
 * admin's end drops the reply back to its number.
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';

export const lineCutter: CardRules<Record<string, never>> = {
  key: 'line-cutter',
  name: 'Line Cutter',
  alignment: 'pepperoni',
  rarity: 'rare',
  replies: true,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(lineCutter, target, effects, now),
  validateConfig: () => ok({}),
};
