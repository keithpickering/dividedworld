/**
 * Divided World's starting economy: the design's section 10 table
 * (docs/plans/2026-10-28-core-loop-design.md), in hundredths of an orb. Every number is a
 * starting point the season review replaces with what the cast does, and every one is a
 * setting, the classes' and cards' own included (`economy`), so an override, the playtest
 * profile or a settings row retunes it without a deploy.
 */
import { deepFreeze, withOverrides } from '../../engine/rules/instance.ts';
import type { Settings } from '../../engine/rules/types.ts';

/** What the engine reads. */
export const defaults: Settings = deepFreeze<Settings>({
  walletCap: 600,
  vote: 10,
  halving: 0.5,
  reactionCap: 3,
  charactersPerPlayer: 6,
  /** Daily, at 08:17 UTC: the small hours across the Americas, when the board is quietest. */
  settlementCron: '17 8 * * *',
  /** Hourly, at a minute of its own, so the count never lands with the settlement's. */
  viewCountCron: '41 * * * *',
  /** One day a window, matching the daily settlement. */
  settlementLength: { unit: 'day', count: 1 },
  seasonLength: { unit: 'month', count: 3 },
  turnCooldown: { unit: 'day', count: 30 },
  registrationMode: 'invite',
  /** Long enough for an effortpost; short enough that one post is never a page of its own. */
  postMaxLength: 20_000,
  titleMaxLength: 120,
  /** The classes' and cards' own numbers from the same table, each named for what reads it. */
  economy: {
    /** "Early" is among this many first players to react to a post. */
    'lurker.earlyPlayers': 3,
    /** An early reaction that matches where the post ends up. */
    'lurker.earlyMatch': 10,
    /** An early call is paid once this many other players have reacted to the post. */
    'lurker.crowd': 3,
    /** A spun thread pays once replies come from this many other players. */
    'lurker.spunThreadRepliers': 3,
    'lurker.spunThread': 20,
    /** Posts in a window before each further one costs. */
    'lurker.postsAllowed': 3,
    'lurker.overPosting': -10,
    'heel.saltyOutdraws': 20,
    'face.cardOutdraws': -20,
    'jabroni.saltyLanded': 20,
    'stickAround.price': 100,
    /** 1.00 to buy, plus 0.25 per 500 characters of the target when played, at most 3.00 in all. */
    'whoops.price': 100,
    'whoops.perLength': 25,
    'whoops.lengthStep': 500,
    'whoops.mostInAll': 300,
  },
});

/** The playtest's shorter season and cooldown, kept apart from the defaults they replace. */
export const playtestOverrides: Partial<Settings> = deepFreeze<Partial<Settings>>({
  seasonLength: { unit: 'week', count: 3 },
  turnCooldown: { unit: 'day', count: 7 },
});

export const playtest: Settings = withOverrides(defaults, playtestOverrides);

