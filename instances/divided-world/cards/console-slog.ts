/**
 * Console Slog (Salty, common): the post's content area becomes an empty command prompt, and a reader mashes keys, or taps, to type the post out
 * (docs/plans/2026-11-27-season-two-cards-design.md, section 3). A reader's progress is kept in their browser and the last character out releases them on
 * every device, so each reader works for the post once and then has it as written. It is the same for every reader, the post's author and the caster
 * among them, and nothing here is saved on the play: the rules are a price, a landing and the screens' numbers.
 *
 * - **Its price** is the machine's, and a long post costs more to play, as Whoops! is priced: `consoleSlog.perLength` for every `consoleSlog.lengthStep`
 *   characters, at most `consoleSlog.mostAdded`, since a long post is more work to type out.
 * - **It lands** on a post with words of its own: one that is only a quote, code, a link or images has nothing of the author's to type, as for You Were Saying?.
 * - **One to a post.** A second play is refused by the card's stack of one.
 * - **The screens' numbers** are the mash's (ui/console-slog/slog.ts): the rhythm that builds a streak, a press's step, its most, how fast a pause drains
 *   the streak, and how many bands an image loads in.
 * - **A Mod Bot** plays it as it plays any Move with no choice to make.
 */
import { economyOf, landsOn, ok, refuse, type CardRules } from '../../../engine/rules/cards.ts';
import type { Hundredths } from '../../../engine/rules/types.ts';
import { who } from './seen-words.ts';

export const consoleSlog: CardRules<Record<string, never>> = {
  key: 'console-slog',
  name: 'Console Slog',
  alignment: 'salty',
  rarity: 'common',
  stack: 1,
  /** Its effect is drawn on the post, so the play counts toward the post's limit of drawn effects (`postEffects`). */
  drawsEffect: {},
  seen: (p) => `${who(p)} turned this post into a command prompt, ${p.ago}. A reader types it out by pressing keys.`,
  reads: [{ key: 'consoleSlog.perLength', whole: true, min: 0 }, { key: 'consoleSlog.lengthStep', whole: true, min: 1 }, { key: 'consoleSlog.mostAdded', whole: true, min: 1 }],
  /** The mash's numbers, read by the screens: the rhythm window, the presses a step takes, the most a press reveals, the presses a second a pause drains, and an image's bands. */
  screenReads: [
    { key: 'consoleSlog.rhythmMs', min: 150, max: 1500 },
    { key: 'consoleSlog.perStep', whole: true, min: 1, max: 20 },
    { key: 'consoleSlog.mostPerPress', whole: true, min: 1, max: 24 },
    { key: 'consoleSlog.drain', min: 1, max: 60 },
    { key: 'consoleSlog.bands', whole: true, min: 4, max: 40 },
  ],
  // As Whoops! is priced; Console Slog lands on a post alone, so a target that is none is priced nothing, and landsOn refuses it first.
  playPrice: (settings, target) => target.reach !== 'post' ? 0 :
    Math.max(0, Math.min(economyOf(settings, 'consoleSlog.perLength') * Math.floor(target.length / economyOf(settings, 'consoleSlog.lengthStep')),
      economyOf(settings, 'consoleSlog.mostAdded'))),
  canApply: (target, effects, _config, now) => {
    const lands = landsOn(consoleSlog, target, effects, now);
    if (!lands.ok || target.reach !== 'post') return lands;
    return target.text.trim() === '' ? refuse("There's nothing in this post to type out.") : lands;
  },
  validateConfig: () => ok({}),
};

/** What the Vending Machine sells it for, in hundredths of an orb. */
export const price: Hundredths = 100;
