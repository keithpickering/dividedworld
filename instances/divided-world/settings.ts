/**
 * Divided World's starting economy: the design's section 10 table
 * (docs/plans/2026-10-28-core-loop-design.md), in hundredths of an orb. Every number is a
 * starting point the season review replaces with what the cast does, and every one is a
 * setting, the classes' and cards' own included (`economy`), so an override, the playtest
 * profile or a settings row retunes it without a deploy.
 */
import { deepFreeze, withOverrides } from '../../engine/rules/instance.ts';
import { MACHINE_DEFAULTS } from '../../engine/rules/packs.ts';
import type { Settings } from '../../engine/rules/types.ts';
import { PRONOUN_PRESETS } from '../../engine/rules/pronouns.ts';
import { DEFAULT_STRENGTHS } from '../../engine/system/pool.ts';

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
  /** The community writes in English; the stemming follows (a Postgres text search configuration, so `simple` is there for a language it has none for). */
  searchLanguage: 'english',
  /** A relevance search ranks the newest 5,000 matches: a common word fills that at once, so a busy instance pays for 5,000 rows, never for millions. */
  searchRankPool: 5000,
  /** Switched off: The System holds no meeting and lands no move until Task 13 of its plan turns it on, after the screens that show a move's way out exist. */
  systemEnabled: false,
  /** The instance runs a completion endpoint, so a card that writes in the old voice is sold and played. */
  oldVoice: true,
  /** An edit makes a card that writes wait half a minute for the editing to stop before it writes again. */
  cardWriteSettleSeconds: 30,
  /** A character a player makes starts with it/its, as every character did before pronouns; its player changes it on the character's page. */
  pronouns: PRONOUN_PRESETS.it,
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
  /** A starting point: the digest lines thirty boards, and the busiest half and the quietest half when there are more, so a Boss can see a forum with five posts in it. */
  digestBoards: 30,
  /** A starting point: a board line counts its posts over the last three weeks. */
  digestBoardDays: 21,
  /** A thread moved off a board is listed on it for a week as a stub that says where it went, then the board forgets it. */
  movedStubDays: 7,
  /** The Boss writes its farewell and its handoff at its last meeting, within a day and a half of the season's end. */
  farewellWindowHours: 36,
  /** A bundle the Boss composes in a meeting holds at most four parts. */
  bundleMostParts: 4,
  /** A bundle an arc's beat authors holds at most eight: it costs nothing from the bank, so a writer's bundle is bounded here and not by the bank. */
  bundleAuthoredMostParts: 8,
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
  /**
   * The staff roster's posting pool (the staff roster design, sections 4 to 6). Starting points: twenty posts a week, a fifth of a day's held
   * back for personas with little history, one new thread a week, common cards only, a priority that reads the last four weeks of a
   * persona's posts, a Boss that reads its twelve newest notes at a meeting, a pool persona that reads the eight newest posts of the thread it writes in, the engine's strengths (the first five triggers outrank the
   * last three), and the pick and its posts at 17:37 UTC, past the morning's meeting and settlement.
   */
  pool: {
    weekly: 20,
    holdback: 0.2,
    threadsWeekly: 1,
    cardRarityMost: 'common',
    priorityDays: 28,
    notesRead: 12,
    chatterThreadPosts: 8,
    strengths: { ...DEFAULT_STRENGTHS },
    chatterCron: '37 17 * * *',
  },
  /**
   * The Mod Bots (the Mod Bots design): a Mod holds at most three moves the Boss hands it and sets a rule for at most a week; a visit lasts two to twelve
   * hours; six patrols a day, each reading five posts; a report costs 0.25 Orbs and an appeal 0.50 (refunded when upheld); sixty judgments and sixty filing
   * lines a day; a tail lasts a day; no more than three public punishments of one character in a week; the filing run looks every five minutes and files
   * a visit left ten minutes past due as it stands.
   */
  modBots: { allowanceMost: 3, ruleDaysMost: 7, visitHours: { least: 2, most: 12 }, patrolsPerDay: 6, patrolSample: 5, reportPrice: 25, reportsPerDay: 3, judgmentsPerDay: 60, filingLinesPerDay: 60, appealPrice: 50, tailHours: 24, cap: { punishments: 3, days: 7 }, filingCron: '*/5 * * * *', filingGraceMinutes: 10 },
  /**
   * The warn bar (the Mod Bots design, section 5): ten points; a minor breach adds 2, a moderate one 4, a severe one 7; each drops off 14 days after it
   * lands; a full bar brings a ban of 1 day, then 3, then 7, and every later ban in the season is 7 days.
   */
  warnBar: { size: 10, bands: { minor: 2, moderate: 4, severe: 7 }, decay: { unit: 'day', count: 14 }, banDays: [1, 3, 7] },
  /**
   * The apology (the member groups design, section 5): a barred character may apologize to one move once a day, the judge hears ten at a run, and its ruling is
   * at most 80 words.
   */
  apology: { apologyEveryHours: 24, apologyJudgeBatch: 10, apologyRulingMaxWords: 80 },
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
  /** A card reaches a character from uncommon, a thread from uncommon (Good Vibes; Main Event is rare) and a board only as a legendary (the card mechanic's design, section 7). */
  reachRarity: { character: 'uncommon', thread: 'uncommon', board: 'legendary' },
  /** A character effect lasts at most a week; a thread's at most three days (Good Vibes); a board's at most a day. */
  reachLasts: { character: { unit: 'day', count: 7 }, thread: { unit: 'day', count: 3 }, board: { unit: 'day', count: 1 } },
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
  toastDefaults: ['quote', 'cardOnYours', 'cardEnded', 'trapStruck', 'trapSprang', 'ruling', 'settlement', 'update'],
  /**
   * The numbers a card gives the screens: a Whoops! layer is washed clean at 95%, the last specks not being worth chasing across a phone.
   * Autocorrect's tape: `pace` is how fast a strip peels, in pixels a second; `pickMs` how long a finger holds before it picks at the
   * tape; `give` how far a drag goes before a strip lets go, in pixels; `peekStayMs` how long a peeled corner stays curled; `peekSettle`
   * how fast it settles back, in pixels a second.
   */
  cardSettings: { 'whoops.clean': 95, 'autocorrect.pace': 90, 'autocorrect.pickMs': 450, 'autocorrect.give': 34, 'autocorrect.peekStayMs': 300, 'autocorrect.peekSettle': 300, 'youWereSaying.eraseCps': 6, 'youWereSaying.retypeMs': 2000, 'youWereSaying.typeCps': 40 },
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
    /** Playing Whoops! on a long post costs 0.25 per 500 characters of the target, at most 2.00 on top of its price at the machine. */
    'whoops.perLength': 25,
    'whoops.lengthStep': 500,
    'whoops.mostAdded': 200,
    /** Autocorrect, as in Minus World: playing it costs 0.25 per 50 characters it covers, at most 2.00 on top of its price at the machine. */
    'autocorrect.perVolume': 25,
    'autocorrect.volumeStep': 50,
    'autocorrect.mostAdded': 200,
    /** You Were Saying?: a play writes 25 tokens and 25 more for each step, at most 200, and each step costs 0.25 on top of its price at the machine. */
    'youWereSaying.baseTokens': 25,
    'youWereSaying.stepTokens': 25,
    'youWereSaying.stepPrice': 25,
    'youWereSaying.mostTokens': 200,
    /** The Boss's moves on the machine, from the engine's own starting numbers. */
    ...MACHINE_DEFAULTS,
  },
});

/** The playtest's shorter season and cooldown, kept apart from the defaults they replace. */
export const playtestOverrides: Partial<Settings> = deepFreeze<Partial<Settings>>({
  seasonLength: { unit: 'week', count: 3 },
  turnCooldown: { unit: 'day', count: 7 },
});

export const playtest: Settings = withOverrides(defaults, playtestOverrides);

