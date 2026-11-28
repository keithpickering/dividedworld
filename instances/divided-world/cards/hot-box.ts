/**
 * Hot Box (Salty, common, Cast on a post, anyone's): smoke fills the post, in the color the caster chose, and a reader clears
 * it to read through by waving it away. It is an obstacle read through by clearing it, and it is the same for every reader,
 * the post's author and the caster included. Nothing a reader clears is saved or sent. One Hot Box to a post at a time, and
 * the smoke is drawn on each screen, so it is not seeded (docs/plans/2026-11-15-wave-1-cards-design.md, section 2.2).
 *
 * It lasts (docs/plans/2026-11-27-lasting-gags-design.md, section 2): over the first three days (`HOT_BOX_THINS`, a constant
 * of its screen) the smoke thins to a haze, and the haze stays; a play has no `lasts` and ends only if it carries an `ends`
 * (one played before this shipped). The post's author can air it out, line by line, for everyone: the saved state is
 * `{ aired }`, the share of the row's height (the content area's where there is no row) cleared from its top (more than 0 and less than 1, to a
 * ten-thousandth), or `{ clean: true }` once all of it is. The author's saves are held for `hotBox.holdHours` after the play
 * lands (`stateHeldUntil`; 0 holds none). Aired out clean is final (`drawsEffect.final`): no later save is taken, the play
 * holds no place in the card's stack, and the post can be smoked again.
 */
import { color, economyOf, landsOn, ok, refuse, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths, Span } from '../../../engine/rules/types.ts';
import { holdEnds } from './hold.ts';
import { colorWord, field, who } from './seen-words.ts';

/** The span the smoke thins over, to its floor, where it holds. */
export const HOT_BOX_THINS: Span = { unit: 'day', count: 3 };

export const hotBox: CardRules<{ color: string }> = {
  key: 'hot-box',
  /** Its effect is drawn on the post, so each play counts toward the post's limit of drawn effects (`postEffects`). */
  drawsEffect: { cleared: (state) => field(state, 'clean') === true, final: true },
  name: 'Hot Box',
  alignment: 'salty',
  rarity: 'common',
  reads: [{ key: 'hotBox.holdHours', whole: true, min: 0, max: 168 }],
  seen: (p) => {
    const smoke = colorWord(p.config);
    if (field(p.state, 'clean') === true) return `${who(p)} filled this post with smoke, ${p.ago}, and its author has aired it all out: the words read clearly.`;
    const thick = `${who(p)} filled this post with thick ${smoke === null ? '' : `${smoke} `}smoke, ${p.ago}: a reader has to wave it away to read through, and over three days it thins to a haze that stays.`;
    return typeof field(p.state, 'aired') === 'number' ? `${thick} Its author has aired out the top of it.` : thick;
  },
  stateHeldUntil: (settings, landed) => holdEnds(economyOf(settings, 'hotBox.holdHours'), landed),
  stateHeldWords: (until) => `This smoke is too thick to air out until ${until}. It can be aired out after that.`,
  validateState: (state) => {
    if (field(state, 'clean') === true) return ok({ clean: true });
    const aired = field(state, 'aired');
    if (typeof aired === 'number' && Number.isFinite(aired) && aired > 0 && aired < 1) {
      const kept = Math.round(aired * 10_000) / 10_000;
      if (kept > 0 && kept < 1) return ok({ aired: kept });
    }
    return refuse('the smoke is aired out to a share of the post, more than 0 and less than 1, or clean');
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
