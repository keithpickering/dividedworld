/**
 * Toll (Pepperoni, uncommon, a Gimmick on the player's own post): for a week, the post's author is paid a share of a vote (0.5 of one)
 * for each vote on any card cast on the post. It takes nothing from the caster of those cards, and pays nothing on a card cast by the
 * author's own player (docs/plans/2026-11-11-card-notes-design.md, section 2, "Toll and 4D Chess"; the Gimmick effect `ride`,
 * docs/plans/2026-11-11-card-types-design.md).
 *
 * - **The settlement's** is the pay and the own-player rule; this file names only the effect and its share.
 * - **The engine's** is the week, the one-live-per-post stack and that the post is the player's own (SQL reads who wrote it).
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';

export const toll: CardRules<Record<string, never>> = {
  key: 'toll',
  name: 'Toll',
  alignment: 'pepperoni',
  rarity: 'uncommon',
  play: 'use',
  gimmick: { kind: 'ride', share: 0.5 },
  lasts: { unit: 'week', count: 1 },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(toll, target, effects, now),
  validateConfig: () => ok({}),
};
