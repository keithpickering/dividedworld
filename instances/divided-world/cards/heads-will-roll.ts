/**
 * Heads Will Roll (Pepperoni, rare, a Move on a post, one to a post): the post's live reaction tiles come loose and orbit inside its content area, the
 * heaviest drifting and the lighter ones circling them, and to react a reader catches one (docs/plans/2026-11-27-season-two-cards-design.md, section 2).
 *
 * Its rules are its place and its price: nothing is configured, nothing more is paid, and it has no author clear (a clear would let an author keep every
 * play that pays and settle every one that taxes). The motion, the catching and the reel-in are the screens': the orbit is
 * `ui/heads-will-roll/orbit.ts`, and the five numbers it reads are `screenReads`.
 *
 * - `overMass`: an Overreaction head's mass is its count times this (1 to 5).
 * - `suns`: how many of the heaviest heads are suns (whole, 1 to 4).
 * - `mostTurns`: the most turns a second a head rolls (0.05 to 3).
 * - `reelBase`, `reelPerSpeed`: the reel-in takes `reelBase + reelPerSpeed x (speed / size)` seconds, the speed in the head's own widths a second (0 to 5 and 0 to 1).
 */
import { landsOn, ok, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';
import { who } from './seen-words.ts';

export const headsWillRoll: CardRules<Record<string, never>> = {
  key: 'heads-will-roll',
  /** Its effect is drawn on the post, so each play counts toward the post's limit of drawn effects (`postEffects`). */
  drawsEffect: {},
  name: 'Heads Will Roll',
  alignment: 'pepperoni',
  rarity: 'rare',
  stack: 1,
  screenReads: [
    { key: 'headsWillRoll.overMass', min: 1, max: 5 },
    { key: 'headsWillRoll.suns', whole: true, min: 1, max: 4 },
    { key: 'headsWillRoll.mostTurns', min: 0.05, max: 3 },
    { key: 'headsWillRoll.reelBase', min: 0, max: 5 },
    { key: 'headsWillRoll.reelPerSpeed', min: 0, max: 1 },
  ],
  seen: (p) => `${who(p)} knocked this post's reactions loose, ${p.ago}. A reader catches one to react.`,
  playPrice: () => 0,
  canApply: (target, effects, _config, now) => landsOn(headsWillRoll, target, effects, now),
  /** A persona plays it as it is: there is nothing to choose. */
  staffConfigs: [{}],
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 300;
