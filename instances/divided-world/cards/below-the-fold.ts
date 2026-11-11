/**
 * Below the Fold (Salty, uncommon, a Move on a post): the post is drawn as one bar and nothing else until a reader presses the bar,
 * which opens it for that reader on that page and folds it again on a second press. The fold is the same for every reader alike,
 * the author and the caster included, so its accessible path is the same press on a real button. The post's words stay in the
 * Act; the fold is a layer the screens draw (instances/divided-world/ui/below-the-fold/), and nothing is saved or sent when a reader
 * opens it. One fold fits on a post, so a second is refused in plain words; it costs nothing more to play than its price at the
 * machine (docs/plans/2026-11-11-card-notes-design.md, section 2).
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';

export const belowTheFold: CardRules<Record<string, never>> = {
  key: 'below-the-fold',
  name: 'Below the Fold',
  alignment: 'salty',
  rarity: 'uncommon',
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(belowTheFold, target, effects, now),
  validateConfig: () => ok({}),
};
