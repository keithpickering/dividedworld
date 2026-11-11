/**
 * Off Day (Salty, legendary, a Move on a character): the character is scored as the class the play names for the one settlement window
 * after the next settlement; its true end is that window's, which the server writes (docs/plans/2026-11-11-card-notes-design.md,
 * section 2, "Off Day"). Nothing is paid and nobody learns it: the card shows as a mark, as any play does.
 *
 * - **The settlement's** is the class: it scores the window as the named class. **The engine's** is the stack and the reach.
 * - **Its `lasts`** is only the bound a character effect needs (`reachLasts.character` is a week); its `stack` of 2 lets the next
 *   window's Off Day land while this window's is still up, and the one-per-window rule is the server's.
 * - **Its configuration** is `{ class }`, the key of one of the instance's classes.
 */
import { landsOn, ok, refuse, type CardRules } from '../../../engine/rules/cards.ts';
import { classes } from '../classes/index.ts';

export type OffDayConfig = { readonly class: string };

export const offDay: CardRules<OffDayConfig> = {
  key: 'off-day',
  name: 'Off Day',
  alignment: 'salty',
  rarity: 'legendary',
  reaches: ['character'],
  scoresAs: true,
  lasts: { unit: 'day', count: 2 },
  stack: 2,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(offDay, target, effects, now),
  validateConfig: (config) => {
    const named = typeof config === 'object' && config !== null ? (config as { class?: unknown }).class : undefined;
    return typeof named === 'string' && classes.some((c) => c.key === named) ? ok({ class: named }) : refuse('choose the class to name');
  },
};
