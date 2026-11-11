/**
 * Mooch (Salty, uncommon, a Move on a post): for a week, the caster is paid a share of a vote (0.1 of one) for each vote the post draws in
 * the quadrant the play names. The play names one quadrant, and a post carries one live Mooch per quadrant. Nothing is taken from the
 * poster: the pay is minted, and the poster keeps everything their class pays them (docs/plans/2026-11-11-card-notes-design.md,
 * section 2, "Mooch"; the plan, docs/plans/2026-11-11-card-notes-part-6-plan.md).
 *
 * - **The settlement's** is the pay: it reads who reacted and who owns what, and pays nothing where the caster's own player wrote the
 *   post or reacted. This file holds only the share and the quadrant, so nothing here reads a class or a player.
 * - **The engine's** is the week and the stack: `landsOn` for the post, `quadrantFree` for the quadrant.
 */
import { landsOn, ok, quadrantFree, refuse, type CardRules } from '../../../engine/rules/cards.ts';
import { QUADRANTS, type Quadrant } from '../../../engine/rules/types.ts';

export type MoochConfig = { readonly quadrant: Quadrant };

export const mooch: CardRules<MoochConfig> = {
  key: 'mooch',
  name: 'Mooch',
  alignment: 'salty',
  rarity: 'uncommon',
  skim: { share: 0.1 },
  lasts: { unit: 'week', count: 1 },
  stack: 4,
  playPrice: () => 0,
  canApply: (target, effects, config, now) => {
    const lands = landsOn(mooch, target, effects, now);
    return lands.ok && config ? quadrantFree(mooch, target, effects, config.quadrant, now) : lands;
  },
  validateConfig: (config) => {
    const quadrant = typeof config === 'object' && config !== null ? (config as { quadrant?: unknown }).quadrant : undefined;
    return QUADRANTS.includes(quadrant as Quadrant) ? ok({ quadrant: quadrant as Quadrant }) : refuse('choose the reactions to mooch');
  },
};
