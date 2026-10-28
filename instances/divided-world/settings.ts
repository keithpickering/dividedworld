/**
 * Divided World's starting economy: the design's section 10 table
 * (docs/plans/2026-10-28-core-loop-design.md), in hundredths of an orb. Every number is a
 * starting point the season review replaces with what the cast does.
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
  seasonLength: { unit: 'month', count: 3 },
  turnCooldown: { unit: 'day', count: 30 },
  registrationMode: 'invite',
  /** Long enough for an effortpost; short enough that one post is never a page of its own. */
  postMaxLength: 20_000,
  titleMaxLength: 120,
});

/** The playtest's shorter season and cooldown, kept apart from the defaults they replace. */
export const playtestOverrides: Partial<Settings> = deepFreeze<Partial<Settings>>({
  seasonLength: { unit: 'week', count: 3 },
  turnCooldown: { unit: 'day', count: 7 },
});

export const playtest: Settings = withOverrides(defaults, playtestOverrides);

/** What the classes and cards read: their own numbers from the same table. */
export const economy = deepFreeze({
  lurker: {
    /** "Early" is among this many first players to react to a post. */
    earlyPlayers: 3,
    /** An early reaction that matches where the post ends up. */
    earlyMatch: 10,
    /** A spun thread pays once replies come from this many other players. */
    spunThreadRepliers: 3,
    spunThread: 20,
    /** Posts in a window before each further one costs. */
    postsAllowed: 3,
    overPosting: -10,
  },
  heel: { saltyOutdraws: 20 },
  face: { cardOutdraws: -20 },
  jabroni: { saltyLanded: 20 },
  stickAround: { price: 100 },
  /** 1.00 to buy, plus 0.25 per 500 characters of the target when played, at most 3.00 in all. */
  whoops: { price: 100, perLength: 25, lengthStep: 500, mostInAll: 300 },
});
