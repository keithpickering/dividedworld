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
  /** Three open invites a player, each open for a week; an admin any number (the screens' design, section 12). */
  invitesPerPlayer: 3,
  inviteLifetime: { unit: 'day', count: 7 },
  /** Two minutes to fix a typo without "Last edited" (the screens' design, section 6). */
  editGrace: { unit: 'minute', count: 2 },
  /** Long enough for an effortpost; short enough that one post is never a page of its own. */
  postMaxLength: 20_000,
  titleMaxLength: 120,
  /** A page of a thread: long enough to read in one sitting, short enough to load at once. */
  postsPerPage: 20,
  /** HOT: ten replies in the last 7 days. */
  hotReplies: 10,
  /** Switched off: The System holds no meeting and lands no move until Task 13 of its plan turns it on, after the screens that show a move's way out exist. */
  systemEnabled: false,
  /** Daily, at 09:23 UTC, an hour after the settlement, so the Boss's digest holds the newest standings. */
  meetingCron: '23 9 * * *',
  /**
   * The ramp of a season: a gentle two-week honeymoon, a long reign, a three-week meltdown. Starting points
   * the season review replaces with what the cast does. A move's longest run grows with the phase: a week in
   * the honeymoon, four in the reign, six in the meltdown.
   */
  phases: {
    honeymoon: { days: 14, weeklyMoves: 2, bankCap: 4, moveExpiryMostDays: 7 },
    reign: { weeklyMoves: 5, bankCap: 10, moveExpiryMostDays: 28 },
    meltdown: { days: 21, weeklyMoves: 8, bankCap: 14, moveExpiryMostDays: 42 },
  },
  /** An outgoing Boss's moves stay in force three days while the new Boss reviews them. */
  inheritanceGraceDays: 3,
  /** The two most recent Bosses sit out the draw for the next one, so a Boss does not come straight back. */
  rosterRecentExcluded: 2,
  /** A move that reshapes a board waits a day for an admin to hold it. */
  structuralHoldHours: 24,
  /** A starting point: twenty in-character lines a day from the light model; past it, stock lines stand in. */
  microEventDailyCalls: 20,
  /** A starting point: the Boss's digest holds the ten hottest threads. */
  digestThreads: 10,
  /** A starting point: the digest quotes the eight top posts. */
  digestExcerpts: 8,
  /** A starting point: each quoted post is cut to 280 characters. */
  digestExcerptChars: 280,
  /** A starting point: a Boss remembers its forty strongest opinions of characters; the rest fade, which keeps its memory (read at every meeting) small. */
  memoryOpinions: 40,
  /** A starting point: a Boss holds at most twenty grudges at a time, most important first. */
  memoryGrudges: 20,
  /** A starting point: a Boss keeps thirty subjects it has learned the community likes. */
  memoryWheelhouse: 30,
  /** A starting point: a Boss leaves thirty real-world subjects alone. */
  memoryRealWorld: 30,
  /** A starting point: a Boss reads its twelve newest notes to itself at a meeting. */
  notesRead: 12,
  /** A board's name is at most 60 characters, whoever proposes it. */
  boardNameMaxLength: 60,
  /** A starting point: no move runs longer than six weeks. */
  moveExpiryMostDays: 42,
  /** A starting point: no move expires sooner than a day after it lands, so a player always has time to meet its demand. */
  moveExpiryLeastHours: 24,
  /** A met demand ends its move within about five minutes (longer when more moves are in force than the cap below allows per minute). */
  demandCheckMinutes: 5,
  /** Forty demand checks a minute keeps the tick's one transaction short; an instance with more moves in force than that waits a little longer. */
  demandChecksPerTick: 40,
  /** The meeting runs on the strong model, small lines on the light one; model ids as the claude-api skill listed them on 2026-10-31. */
  modelTiers: { strong: 'claude-opus-5-5', light: 'claude-haiku-5-5' },
  /** Presence (the staff design, section 2): five minutes listed after the last poll, fifteen names, a poll every 30 seconds. */
  presenceWindow: { unit: 'minute', count: 5 },
  presenceNames: 15,
  presencePollSeconds: 30,
  /** A card set face down stays set a week if nothing springs it (the card mechanic's design, section 3). */
  setLasts: { unit: 'day', count: 7 },
  /** A card reaches a character from uncommon, a thread from rare and a board only as a legendary (the card mechanic's design, section 7). */
  reachRarity: { character: 'uncommon', thread: 'rare', board: 'legendary' },
  /** A character effect lasts at most a week; a thread's and a board's at most a day. */
  reachLasts: { character: { unit: 'day', count: 7 }, thread: { unit: 'day', count: 1 }, board: { unit: 'day', count: 1 } },
  /**
   * Hints (the alerts design's section 5): a pattern needs a crowd (eight reactions in the window, so one stray reaction is never a trend),
   * a clear lead (six in ten in one quadrant), and a real split (three in ten on each side to be divisive), counted over six hours.
   * Starting points the season review replaces.
   */
  hints: { least: 8, share: 0.6, split: 0.3, window: { unit: 'minute', count: 360 } },
  /**
   * What toasts until a player chooses (the alerts design's section 8): news about their own characters and the rulings and updates that
   * concern them. Followed threads, hints and season news are the quieter kinds, and wait in Alerts unless a player turns them on.
   */
  toastDefaults: ['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'ruling', 'settlement', 'update'],
  /** The numbers a card gives the screens: a Whoops! layer is washed clean at 95%, the last specks not being worth chasing across a phone. */
  cardSettings: { 'whoops.clean': 95, 'autocorrect.peelMs': 700 },
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
    /** Evergreen: what a calm-positive vote on an old post of the Technician's pays, on top of Respected. */
    'technician.evergreen': 5,
    /** How many whole days old a Technician's post is when a calm-positive vote on it first pays Evergreen. */
    'technician.evergreenDays': 3,
    'stickAround.price': 100,
    /** The card mechanic's first plays, at starting numbers the season review replaces: a Trap Card and a Force Field 1.50, a Bluff 0.25. */
    'trapCard.price': 150,
    'forceField.price': 150,
    'bluff.price': 25,
    'glitterBomb.price': 150,
    'mainEvent.price': 300,
    /** Feelin' Fab, the cheapest card in the shop: 0.20, below a Bluff's 0.25. */
    'feelinFab.price': 20,
    /** 1.00 to buy, plus 0.25 per 500 characters of the target when played, at most 3.00 in all. */
    'whoops.price': 100,
    'whoops.perLength': 25,
    'whoops.lengthStep': 500,
    'whoops.mostInAll': 300,
    /** Autocorrect: 1.00 to buy, as in Minus World, plus 0.25 per 50 characters it covers when played, at most 3.00 in all. */
    'autocorrect.price': 100,
    'autocorrect.perVolume': 25,
    'autocorrect.volumeStep': 50,
    'autocorrect.mostInAll': 300,
  },
});

/** The playtest's shorter season and cooldown, kept apart from the defaults they replace. */
export const playtestOverrides: Partial<Settings> = deepFreeze<Partial<Settings>>({
  seasonLength: { unit: 'week', count: 3 },
  turnCooldown: { unit: 'day', count: 7 },
});

export const playtest: Settings = withOverrides(defaults, playtestOverrides);

