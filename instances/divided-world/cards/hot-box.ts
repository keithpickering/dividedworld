/**
 * Hot Box (Salty, common, Cast on a post, anyone's): smoke fills the post for 3 days, in the color the caster chose, and
 * a reader clears it to read through by waving it away. It is an obstacle read through by clearing it, and it is the same
 * for every reader, the post's author and the caster included. Nothing a reader clears is saved or sent, and the smoke
 * thins as the three days pass. One Hot Box to a post at a time, and the smoke is drawn on each screen, so it is not
 * seeded (docs/plans/2026-11-15-wave-1-cards-design.md, section 2.2).
 */
import { color, landsOn, ok, refuse, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';
import { colorWord, who } from './seen-words.ts';

export const HOT_BOX_LASTS = { unit: 'day', count: 3 } as const;

export const hotBox: CardRules<{ color: string }> = {
  key: 'hot-box',
  /** Its effect is drawn on the post, so each play counts toward the post's limit of drawn effects (`postEffects`). */
  drawsEffect: {},
  name: 'Hot Box',
  alignment: 'salty',
  rarity: 'common',
  lasts: HOT_BOX_LASTS,
  seen: (p) => {
    const smoke = colorWord(p.config);
    return `${who(p)} filled this post with thick ${smoke === null ? '' : `${smoke} `}smoke, ${p.ago}: a reader has to wave it away to read through, and it thins out as the days pass.`;
  },
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(hotBox, target, effects, now),
  /** The smoke colors code falls back on when a persona gives none (staffConfigOf): lime green, medium purple, hot pink,
   *  orange and light gray, as hex where color() takes no such name. */
  staffConfigs: [{ color: '#32cd32' }, { color: '#9370db' }, { color: '#ff69b4' }, { color: 'orange' }, { color: '#d3d3d3' }],
  // Only the color is the caster's: anything else sent is not kept.
  validateConfig: (config) => {
    const smoke = color(typeof config === 'object' && config !== null ? (config as { color?: unknown }).color : undefined);
    return smoke ? ok({ color: smoke }) : refuse('the smoke is a color: a named one, or #rgb or #rrggbb');
  },
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 100;
