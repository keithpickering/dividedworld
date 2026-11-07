/**
 * The types every instance implements, and the shapes the settlement reads.
 *
 * The engine is written against `Instance` and never names one: an instance's classes,
 * cards, reactions, settings and board seed arrive through this interface, handed to the
 * engine by the composition root (supabase/functions/). See CLAUDE.md, "KayfaBB never knows
 * which instance it runs".
 *
 * Aura is an integer count of hundredths of an orb wherever it is stored or returned. Times
 * are epoch milliseconds.
 */
import type { BeyondPost, CardRules, Rarity } from './cards.ts';
import type { StockLineKey } from '../system/stock.ts';
import type { Duty } from '../system/duties.ts';
import type { HintSettings } from './hints.ts';
import type { AlertKind } from './alerts.ts';
import type { PhaseOverrides, PhaseSettings } from '../system/phases.ts';
import type { PoolTrigger } from '../system/pool.ts';

/** Where a reaction sits on the two axes the classes read: how excited, how positive. */
export type Quadrant = 'excitedPositive' | 'excitedNegative' | 'calmPositive' | 'boredNegative';

export const QUADRANTS: readonly Quadrant[] = ['excitedPositive', 'excitedNegative', 'calmPositive', 'boredNegative'];

/** One reaction a player can leave: its stable key, the emoji shown, its quadrant. */
export interface ReactionKind {
  readonly key: string;
  readonly emoji: string;
  readonly quadrant: Quadrant;
}

/** A card's alignment: Sweet enhances, Salty defuses, Pepperoni depends on context. */
export type Alignment = 'sweet' | 'salty' | 'pepperoni';

export const ALIGNMENTS: readonly Alignment[] = ['sweet', 'salty', 'pepperoni'];

/** Aura, in hundredths of an orb. */
export type Hundredths = number;

/** A length of time in calendar units, so "3 months" stays three months in SQL too. */
export interface Span {
  /** Minutes only where a setting says it takes them (editGrace, presenceWindow, hints.window); a window, a season and a cooldown count days or more. */
  readonly unit: 'minute' | 'day' | 'week' | 'month';
  readonly count: number;
}

/** The posting pool's numbers (`Settings.pool`). */
export interface PoolSettings {
  /** How many posts a week the pool pays for, in all: every unprompted post at every office. */
  readonly weekly: number;
  /** The share of a day's posts held back for personas with little history, from 0 to 0.5; the first favorites cannot hold every slot forever. */
  readonly holdback: number;
  /** How many new threads a week the pool may start; zero is none, and then every pool post is a reply. */
  readonly threadsWeekly: number;
  /** The rarest card a pool persona plays (`staff_play_card`, `staff_set_card`): a card above it is refused. */
  readonly cardRarityMost: Rarity;
  /** How many days back a persona's priority reads its posts and the reactions to them (`pool_signals`'s `tallies`). */
  readonly priorityDays: number;
  /** The most of its own recent notes (`staff_notes`) the Boss's meeting reads, newest kept. A note is read, never acted on. */
  readonly notesRead: number;
  /** How many of a thread's newest public posts a pool persona is shown when it writes in it (`chatter`), each cut to `digestExcerptChars`. */
  readonly chatterThreadPosts: number;
  /** Each trigger's strength: a candidate's score is its trigger's strength times its persona's priority. A whole number, at least 1. */
  readonly strengths: Readonly<Record<PoolTrigger, number>>;
  /** When the pool's daily pick and posts run, as a five-field cron expression in UTC. */
  readonly chatterCron: string;
}

/**
 * The Mod Bots' numbers (`Settings.modBots`; the Mod Bots design, sections 2 to 8). A starting point each: the owner tunes them with a row,
 * never a deploy. Money is in hundredths of an orb.
 */
export interface ModBotSettings {
  /** The most moves the Boss hands one Mod at a meeting (and the most one Mod holds at once); the code clamps and records a trim. */
  readonly allowanceMost: number;
  /** The most days a rule set by a Mod lasts. */
  readonly ruleDaysMost: number;
  /** How long a visit lasts before the Mod files, in hours: the range every persona's own strictness is clamped into. */
  readonly visitHours: { readonly least: number; readonly most: number };
  /** The most patrols the Boss's meeting schedules for the Mods in a day; the rest are cut from the end. */
  readonly patrolsPerDay: number;
  /** How many of a board's recent posts one patrol's judgment reads (a bounded read of public posts). */
  readonly patrolSample: number;
  /** What a report costs the reporter: spent on every judged report, whatever the verdict, and refunded only when the judgment fails. */
  readonly reportPrice: Hundredths;
  /** The most reports one character may file in a day. */
  readonly reportsPerDay: number;
  /** The most Mod judgments (patrols, reports, appeals) the instance pays for in a day. */
  readonly judgmentsPerDay: number;
  /** The most filing calls the instance pays for in a day: one a filing, and a second for an old voice's move. Counted from the ledger. */
  readonly filingLinesPerDay: number;
  /** What an appeal costs, and is refunded when it is upheld. */
  readonly appealPrice: Hundredths;
  /** How long a tail on a character lasts, in hours. */
  readonly tailHours: number;
  /** The targeting cap: no more than this many public punishments of one character in this many days. */
  readonly cap: { readonly punishments: number; readonly days: number };
  /** When the filing run looks for visits due, as a five-field cron expression in UTC. */
  readonly filingCron: string;
  /** How long past its due time a visit may wait before the filing run files it as it stands, in minutes. */
  readonly filingGraceMinutes: number;
}

/**
 * The warn bar's numbers (`Settings.warnBar`; the Mod Bots design, section 5). An infraction adds its band's points when a visit files, drops off
 * `decay` after it lands, and a bar that reaches `size` brings a timed ban whose length is the season's ladder step.
 */
export interface WarnBarSettings {
  /** What the bar holds: it brings a ban when the points not yet expired reach this many. A whole number, at least 1. */
  readonly size: number;
  /** What an infraction of each band adds. Whole numbers from 1 to `size`. */
  readonly bands: { readonly minor: number; readonly moderate: number; readonly severe: number };
  /** How long an infraction counts after it lands. */
  readonly decay: Span;
  /** The days of a character's first ban in a season, its second, its third; the last step repeats. Whole numbers, at least 1, and at least one step. */
  readonly banDays: readonly number[];
}

/** The settings the engine itself reads. A class's own numbers live with the class. */
export interface Settings {
  /** The most a wallet holds; Aura past it leaves the wallet and stays in the standing. */
  readonly walletCap: Hundredths;
  /** What one whole vote on a class's favored or hostile reactions is worth. */
  readonly vote: Hundredths;
  /** Each further Act by one character a player votes on in a window weighs this times the one before. */
  readonly halving: number;
  /** The most distinct reactions one player leaves on one Act, across all their characters. */
  readonly reactionCap: number;
  /** The most characters one player runs. */
  readonly charactersPerPlayer: number;
  /** When The System settles, as a five-field cron expression in UTC. */
  readonly settlementCron: string;
  /**
   * When each thread's view count is recounted, as a five-field cron expression in UTC: hourly by
   * default, never live, since a live count says whether a new poster's player had already read.
   */
  readonly viewCountCron: string;
  /**
   * How long one settlement window is: a day for a daily settlement. The cron says when a run
   * comes; this says how finely it settles, each missed length its own window, a window settled
   * once its whole length has passed. A season's first window, where it did not begin at a
   * window's end, ends at the first run, so the windows after it end when the cron comes.
   */
  readonly settlementLength: Span;
  readonly seasonLength: Span;
  readonly turnCooldown: Span;
  /** Who may open an account: anyone, someone with an invite, or nobody new. */
  readonly registrationMode: 'open' | 'invite' | 'closed';
  /** The most unused, unexpired invites a player holds at once; an admin holds any number. */
  readonly invitesPerPlayer: number;
  /** How long an invite opens an account for, from when it was made or last reissued. */
  readonly inviteLifetime: Span;
  /**
   * How long after a post is made an edit records a version without setting "Last edited", so a
   * typo fixed at once is not a confession. Every edit is still a public Act in the post's history.
   */
  readonly editGrace: Span;
  /** The longest a post's text may be, in characters (code points). */
  readonly postMaxLength: number;
  /** The longest a thread's title may be, in characters. */
  readonly titleMaxLength: number;
  /** How many posts a thread shows on one page. */
  readonly postsPerPage: number;
  /** A thread is HOT when it has had at least this many replies in the last 7 days. */
  readonly hotReplies: number;
  /**
   * How long after a character's last poll it stays listed in "Who is online" and "Users browsing":
   * a mask arrives on its first poll and leaves only by aging out this long after its last, so a
   * swap of masks is never shown as one leaving as another arrives.
   */
  readonly presenceWindow: Span;
  /** The most names a presence box shows, longest present first; past it the box says "and N others". */
  readonly presenceNames: number;
  /**
   * How often, in seconds, a page asks who is there, which also marks the viewer's current mask
   * present: how quickly a player sees an arrival, and how often each viewer calls the server.
   */
  readonly presencePollSeconds: number;
  /**
   * How long a card set face down stays set if nothing springs it: the same for every Set card, so a
   * back's end says nothing about which card it is (the card mechanic's design, section 3).
   */
  readonly setLasts: Span;
  /**
   * The least rarity a card must be to reach beyond a post, per reach (the card mechanic's design, section 7): a card reaching
   * further than its rarity allows is refused at seeding (instanceProblems, seed_instance).
   */
  readonly reachRarity: Readonly<Record<BeyondPost, Rarity>>;
  /** The longest a play beyond a post lasts, per reach: a card's own `lasts` is at most this, and every such effect ends on its timer. */
  readonly reachLasts: Readonly<Record<BeyondPost, Span>>;
  /**
   * The numbers a card gives the screens, each named by the instance ("whoops.clean"): a card's effect
   * decides something on the client (how much of a layer counts as washed clean), so the number is one the
   * screens read (`screen_settings`). The screens read the economy there too, but only for words that state its
   * numbers and for prices (0073, 0039); no screen decides anything by it. The engine checks each is a number;
   * the cards that name them in `screenReads` check their range.
   */
  readonly cardSettings: Readonly<Record<string, number>>;
  /**
   * The instance's own numbers (a class's bonus, a card's price), each named by the instance
   * ("lurker.earlyMatch"). The engine checks each is a number and never reads one; the classes
   * and cards that name them do, so an override or a settings row retunes them without a deploy.
   */
  readonly economy: Readonly<Record<string, number>>;
  /**
   * Whether The System runs at all. While false it holds no meeting and lands no move, and nothing it would
   * do is seen by a player. An instance turns it on only once the screens that show a move's way out exist.
   */
  readonly systemEnabled: boolean;
  /** When the Boss's meeting runs, as a five-field cron expression in UTC: daily by default, an hour after the settlement so the digest holds the newest standings. */
  readonly meetingCron: string;
  /**
   * The three phases of a season (the Boss's ramp): how long the honeymoon and the meltdown last, and in each phase
   * how many moves the Boss earns a week, how many it can bank, and the longest a move of that phase may run. A
   * player feels it as a Boss that starts gentle, settles into its reign and finishes loud.
   */
  readonly phases: PhaseSettings;
  /** Days after a handover that an outgoing Boss's moves stay in force while the new Boss reviews them. */
  readonly inheritanceGraceDays: number;
  /** How many of the most recent Bosses are left out of the draw when the outgoing Boss's successor is chosen, so a Boss does not come straight back. */
  readonly rosterRecentExcluded: number;
  /** Hours a move that reshapes a board waits in the admin queue before it lands, in which an admin can hold it. */
  readonly structuralHoldHours: number;
  /** The most model calls a day that fill in small in-character lines; past it, stock lines stand in, so cost never grows with activity. A starting point. */
  readonly microEventDailyCalls: number;
  /** How many threads the Boss's digest of public play holds. A starting point. */
  readonly digestThreads: number;
  /** How many top posts the digest quotes. A starting point. */
  readonly digestExcerpts: number;
  /** How many characters of a post the digest quotes. A starting point. */
  readonly digestExcerptChars: number;
  /** The most opinions of characters a Boss's memory keeps; the Boss orders them most important first and the rest are cut. A starting point. */
  readonly memoryOpinions: number;
  /** The most grudges a Boss's memory keeps, most important first. A starting point. */
  readonly memoryGrudges: number;
  /** The most subjects in the userbase's wheelhouse a Boss's memory keeps, most important first. A starting point. */
  readonly memoryWheelhouse: number;
  /** The most real-world subjects a Boss's memory leaves alone, most important first. A starting point. */
  readonly memoryRealWorld: number;
  /**
   * The staff roster's posting pool (the staff roster design, sections 4 and 6; its plan, Task 9): how many posts a week the pool pays
   * for, how a day's pick is made, and the numbers the pool's other readers share (notes, cards, priority). A starting point each.
   */
  readonly pool: PoolSettings;
  /** The Mod Bots' numbers: allowances, rule lengths, visits, patrols, reports, appeals, tails and the targeting cap. */
  readonly modBots: ModBotSettings;
  /** The warn bar and the ban ladder: points by band, how long they last, and how long each ban in a season runs. */
  readonly warnBar: WarnBarSettings;
  /** The longest a board's name may be, in characters, whether The System or a player proposes it. */
  readonly boardNameMaxLength: number;
  /** The most days any move may last, whatever its phase allows. A starting point. */
  readonly moveExpiryMostDays: number;
  /** The fewest hours any move lasts before it may expire, so a player always has time to meet its demand. A starting point. */
  readonly moveExpiryLeastHours: number;
  /**
   * How often the tick looks at whether a move in force has had its demand met, in minutes. A player feels it as the delay between meeting a
   * demand and the move ending: about this long, and longer when many moves are in force (see `demandChecksPerTick`). A move's expiry is
   * checked every minute whatever this says. A starting point.
   */
  readonly demandCheckMinutes: number;
  /**
   * The most moves the tick checks the demand of in one minute, oldest check first, so the tick's one transaction stays short however many
   * moves are in force. The rest wait for the next minute. A player feels it only when more moves are in force than this each
   * `demandCheckMinutes` allow: a met demand then ends a few minutes later. A starting point.
   */
  readonly demandChecksPerTick: number;
  /**
   * When a post's or a card's reactions earn their player a hint (the alerts design's section 5): the fewest reactions, the share
   * that makes one quadrant lead, the share that makes it divisive, and how far back reactions count. Computed from public counts only.
   */
  readonly hints: HintSettings;
  /**
   * The alert kinds that toast for a player who has not chosen (Settings › Notifications; the alerts design's section 8). A kind that does not
   * toast still counts and still has its row in Alerts, and a player's own choice replaces this list whole.
   */
  readonly toastDefaults: readonly AlertKind[];
  /** The model each tier of a call uses (the meeting runs on `strong`, small lines on `light`), as the provider names it. */
  readonly modelTiers: { readonly strong: string; readonly light: string };
}

/**
 * The kinds of Act the settlement reads. An `unmask` is a character's reveal of its own class
 * (supabase/migrations/0027_unmask.sql): an Act of its character like a card, whose reactions are
 * scored and which counts in the halving, and no post. An `announce` is a character's announced
 * debut or Turn, written by The System on its behalf at the moment it takes effect
 * (supabase/migrations/0100_announce.sql): an Act of its character like an unmask, whose reactions
 * are scored and which counts in the halving, and no post. A set is a card set face down, naming no
 * card; a spring is a trap sprung, naming it (supabase/migrations/0054_card_plays.sql).
 */
export type ActKind = 'post' | 'spin' | 'card' | 'edit' | 'unmask' | 'announce' | 'set' | 'spring';

/**
 * A board the instance starts with. Exactly one is The System's (`system`): only The System posts
 * there (a season's announcements, the arrivals and farewells), and players react to it and spin threads
 * from it onto a board of their own.
 */
export interface BoardSeed {
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly system?: boolean;
}

/* ------------------------------------------------------------ the settlement's input ---- */

/**
 * An Act as the settlement reads it. `thread` is the thread it is in; for a `spin` it is the
 * thread the spin opened, and `target` the Act it was spun from. For a `card`, `target` is the
 * post it landed on, and a card beyond a post names its `reach` instead.
 */
export interface InputAct {
  readonly id: string;
  readonly character: string;
  readonly kind: ActKind;
  readonly at: number;
  readonly thread: string;
  readonly target?: string;
  readonly card?: string;
  /**
   * A card played beyond a post (0055_card_reach.sql): on a character, a thread or a board. It has no target post to outdraw, so it
   * carries no `target`; its own reactions pay its caster as any Act's do, and it is in no class's cards played or landed.
   */
  readonly reach?: BeyondPost;
}

/** A staff post a card landed on: its author is staff, so it is named but never settled. */
export interface UnscoredTarget {
  readonly id: string;
  readonly kind: ActKind;
  readonly at: number;
  readonly thread: string;
  readonly staff: true;
}

/**
 * One reaction. Who left it (player and character) is private and never leaves the server;
 * the settlement reads it only to keep one player's reactions to one vote and to drop a
 * player's reactions to their own characters.
 */
export interface InputReaction {
  readonly act: string;
  readonly kind: string;
  readonly at: number;
  readonly player: string;
  readonly character: string;
}

/** A character, its player (private), and the classes it has held, oldest first. */
export interface InputCharacter {
  readonly id: string;
  readonly player: string;
  readonly classes: readonly { readonly class: string; readonly from: number }[];
}

/**
 * Everything one settlement window reads. `acts` holds the window's Acts and every earlier Act
 * the window touches (a post reacted to, a card's target, a spun thread's origin and earlier
 * replies); `reactions` holds the window's reactions and every earlier reaction on an Act
 * reacted to in the window. Nothing at or after `to` is read.
 */
export interface SettlementInput {
  readonly window: { readonly id: string; readonly from: number; readonly to: number };
  readonly characters: readonly InputCharacter[];
  readonly acts: readonly InputAct[];
  readonly reactions: readonly InputReaction[];
  /**
   * The System's own Acts (a tally, a season's reveal) that an input Act or reaction points at: no
   * character's, so nobody's to settle. A player may spin a thread from one, and that spin is from
   * someone else's Act; a player may react to one, and that reaction moves nobody's Aura.
   */
  readonly systemActs?: readonly string[];
  /**
   * The staff posts a window's card landed on (#122): no character's in the input, so nobody's to pay, but each with its
   * reactions as for any Act, so a card on one is judged against how many players the post drew. Its reactors are paid
   * nothing for reacting there, as for any of The System's Acts.
   */
  readonly unscoredTargets?: readonly UnscoredTarget[];
  /**
   * What earlier windows paid for each player's vote on each Act this window's reactions touch
   * (engine/rules/votes.ts's payVotes): its weight, and each quadrant's share at it.
   */
  readonly paid?: readonly {
    readonly player: string;
    readonly act: string;
    readonly weight: number;
    readonly shares: Readonly<Record<Quadrant, number>>;
  }[];
}

/* ------------------------------------------------------ what a class's rules are given ---- */

/** A reaction one of the character's Acts received, as a weight in votes; never who left it. */
export interface ReceivedReaction {
  readonly act: string;
  readonly actKind: ActKind;
  readonly quadrant: Quadrant;
  readonly at: number;
  /** When the reacted Act was posted: public, as every post and card shows its time. */
  readonly actAt: number;
  /**
   * What this window pays of the reacting player's one vote on the Act, in this quadrant, times
   * its halving: the difference from what earlier windows paid, so a vote that moved from this
   * quadrant to another is negative here (engine/rules/votes.ts's payVotes).
   */
  readonly votes: number;
}

/** A reaction the character gave. */
export interface GivenReaction {
  readonly act: string;
  readonly quadrant: Quadrant;
  readonly at: number;
  /** What this window adds (or, negative, takes back) of its player's one vote on the Act, in this quadrant. */
  readonly share: number;
}

/**
 * Where the character's player's vote on another's Act stands, in one quadrant, given in each
 * window in which another player first reacted to the Act, to the mask whose reaction there is
 * the player's latest: so a class can pay the window in which a crowd arrives, by the Act's
 * direction then, whether or not its player reacted again.
 */
export interface HeldVote {
  readonly act: string;
  readonly quadrant: Quadrant;
  /** When the latest other player to arrive in the window first reacted. */
  readonly at: number;
  /** When the reaction the vote is held through landed: the latest by the mask that says this quadrant. */
  readonly reactedAt: number;
  /** The player's share of their one vote on the Act in this quadrant, unhalved, at this settlement. */
  readonly share: number;
  /** Where the player came among the players who reacted to the Act, by first reaction: 1 is first. */
  readonly rank: number;
  /** How many other players had reacted to the Act before the window, and by its end. */
  readonly othersBefore: number;
  readonly othersNow: number;
  /** The Act's dominant quadrant by vote share at this settlement, without this player's vote; null on a tie or none. */
  readonly endsUp: Quadrant | null;
}

/** A card the character played, and how it drew against the post it landed on, in the window. */
export interface PlayedCard {
  readonly act: string;
  readonly card: string;
  readonly alignment: Alignment;
  /**
   * The alignment the play reads as this window (the Autocorrect design, section 8): a Sweet or Salty card's own; a Pepperoni
   * card's by the lean of other players' votes on it in the window, Salty where the negative quadrants outweigh the positive,
   * Sweet the other way, and Pepperoni on a tie or with none. The class rules that read an alignment read this.
   */
  readonly readsAs: Alignment;
  readonly at: number;
  readonly target: string;
  /** The target's author is another player's character. */
  readonly onOthers: boolean;
  /** Votes on the card in the window. */
  readonly votes: number;
  /** Votes on the target post in the window. */
  readonly targetVotes: number;
  /** Votes on the target post after the card was played (each counted once per player and alignment, for that player's earliest card of this alignment there), by quadrant, from other players. */
  readonly targetAfter: Readonly<Record<Quadrant, number>>;
}

/** A card another player played on one of the character's posts. */
export interface LandedCard {
  readonly act: string;
  readonly card: string;
  readonly alignment: Alignment;
  /** The alignment the play reads as this window, as `PlayedCard.readsAs`. */
  readonly readsAs: Alignment;
  readonly at: number;
  readonly on: string;
}

/** A thread the character spun, and how many other players had replied before the window and by its end. */
export interface SpunThread {
  readonly act: string;
  readonly thread: string;
  readonly at: number;
  /** It was spun from another player's Act. */
  readonly fromOthers: boolean;
  readonly repliersBefore: number;
  readonly repliersNow: number;
}

/**
 * What a class's rules read: only Acts, things anyone could see happen. A character that
 * Turned inside the window is given one input per class it held, each covering its stretch.
 */
export interface ClassInput {
  readonly character: string;
  readonly from: number;
  readonly to: number;
  readonly posts: readonly { readonly act: string; readonly at: number }[];
  readonly received: readonly ReceivedReaction[];
  readonly given: readonly GivenReaction[];
  readonly held: readonly HeldVote[];
  readonly cardsPlayed: readonly PlayedCard[];
  readonly cardsLanded: readonly LandedCard[];
  readonly threadsSpun: readonly SpunThread[];
}

/**
 * One thing a class's rules paid or charged. `amount` is in hundredths and may be fractional;
 * the settlement sums and rounds. `reason` is the class's own key for the rule: dot-separated
 * words, each starting lowercase (`face.cheered`), as the ledger stores it.
 */
export interface Earning {
  readonly reason: string;
  readonly amount: number;
  /**
   * The economy numbers the reason's words state, by key, as this earning used them (the core loop design, section 6, #57): the
   * settlement writes them into the ledger row (`ledger.params`), so a line settled before a retune is said with the numbers it was
   * settled under. Only on a reason whose words state a tunable number (`lurker.postedTooMuch` names `lurker.postsAllowed`).
   */
  readonly params?: Readonly<Record<string, number>>;
  readonly act?: string;
  readonly quadrant?: Quadrant;
  /**
   * The reactions it pays for, where they are not on `act`: on this Act, after this time (a card's
   * lift is the votes on its target after it). The live estimate hangs its lines on them, and
   * without it on the reactions to `act` in `quadrant`: an earning paid for another Act's reactions
   * names them here, or its lines hang on the wrong ones.
   */
  readonly valuing?: { readonly act: string; readonly from: number };
  /**
   * The time of the one reaction it pays for, where it pays for one. An earning for one reaction
   * names it here, one for many alike votes names `valuing`, and one for no reaction names
   * neither: the live estimate shows a line with `at` at that time, whole, and never apportions it.
   */
  readonly at?: number;
}

/** A class: a playstyle, and the rules that turn what a character did and received into Aura. */
/** An economy number a class or card reads: its name, and the bounds it holds to, if any. */
export type EconomyRead = string | { readonly key: string; readonly whole?: boolean; readonly min?: number; readonly max?: number };

export interface ClassRules {
  readonly key: string;
  readonly name: string;
  /** The economy numbers its rules read, so an instance missing one, or holding one out of its bounds, is refused before it settles. */
  readonly reads?: readonly EconomyRead[];
  earn(input: ClassInput, settings: Settings): readonly Earning[];
}

/* ------------------------------------------------------------------- the instance ---- */

/**
 * The words The System says in the instance's own voice, each with `{season}` where the season's
 * number goes. In character, so they may bluff ("The fiction may lie; the log never does").
 */
export interface Copy {
  /** The thread a season's announced debuts and Turns are posted in. */
  readonly announcementsThreadTitle: string;
}

/**
 * A member rank, as a 2003 postbit shows one: its name, from a settled season standing up.
 * Ranks are listed ascending, the first from 0; a standing below 0 holds the first.
 */
export interface Rank {
  readonly name: string;
  readonly from: Hundredths;
}

/**
 * A style of pips, the row a postbit draws beside a rank: a full and an empty image, named for the
 * screens to draw. The instance's `default` is every character's until its player picks another.
 */
export interface PipStyle {
  readonly key: string;
  readonly name: string;
  readonly full: string;
  readonly empty: string;
}

/**
 * A staff character an instance seeds (0043): a Boss or a Mod Bot, a character with no account behind it. The seed makes
 * it once; `title` and `signature` are its profile's (a title of at most 40 characters, a signature of at most 500).
 */
export interface StaffSeed {
  readonly key: string;
  readonly name: string;
  readonly title: string;
  readonly signature: string;
}

/* ----------------------------------------------------------------- The System's content ---- */

/** The standing orders' stock lines: what The System says when a model call is out of budget or fails. */
export type StockLines = Readonly<Record<StockLineKey, readonly string[]>>;

/** One dumb multiple-choice question a Mod Bot asks of whoever tries to talk it down. */
export interface QuizQuestion {
  readonly question: string;
  readonly choices: readonly string[];
  /** The right choice; one of `choices`. */
  readonly answer: string;
}

/** How a Mod Bot's visit can be intercepted: a quiz, a bribe (in hundredths of an orb), or a distraction. */
export type Weakness =
  | { readonly kind: 'quiz'; readonly questions: readonly QuizQuestion[] }
  | { readonly kind: 'bribe'; readonly price: Hundredths }
  | { readonly kind: 'distraction' };

/**
 * A persona in the instance's one roster (the staff roster design, section 1): a staff character and the mind that plays
 * it. Every persona carries every field a Boss has and every field a Mod Bot has, so any persona can hold any office
 * without a second shape.
 */
export interface Persona extends StaffSeed {
  /** The system prompt that makes the model this persona, built on the instance's shared premise for the duty it is doing. */
  readonly persona: string;
  /** What it is into on its first day. */
  readonly startingHobby: string;
  /** A line of temperament, for an admin reading the roster and for the meeting to be told. */
  readonly temperament: string;
  /** For a reinvention: the key of the persona whose memory this one picks up. */
  readonly inheritsMemoryOf?: string;
  /** Its own phase numbers as a Boss, clamped into the engine's caps (`PHASE_CAPS`). */
  readonly phases?: PhaseOverrides;
  /** The kinds of board it likes to patrol. */
  readonly beats: readonly string[];
  /** The predicate keys it lobbies for. */
  readonly petRules: readonly string[];
  /** How long its visits run, in hours, and which bands it pushes for. */
  readonly strictness: { readonly visitHours: { readonly least: number; readonly most: number }; readonly bands: readonly string[] };
  readonly weakness: Weakness;
  /** `chat` for the chat model, `oldVoice` for the old completion model. */
  readonly voice: 'chat' | 'oldVoice';
  /** What persuades it on appeal, a line for its appeal prompt. */
  readonly persuadedBy: string;
}

/** Who does a duty: the season's Boss, the bot on the board's beat, the bot that filed, or a staff member by key. */
export type DutyAssignee = 'boss' | 'beat' | 'filer' | (string & {});

/** A feed an instance lets The System read for outside material: plain code fetches it; no model searches the web. */
export interface FeedSource {
  readonly name: string;
  readonly url: string;
}

/**
 * Everything The System needs from an instance: its roster of personas, who does each duty, the lines it falls back
 * on, what it reads from outside, what it leaves alone, and the shape of a board's name. The engine names this
 * interface and never an instance's persona.
 */
export interface SystemContent {
  /** Every staff persona the instance seeds: Bosses, Mod Bots and any other, one shape. */
  readonly roster: readonly Persona[];
  /** The member group every staff character is in; the engine reads its name from here. */
  readonly staffGroup: { readonly name: string };
  /** The roster key of the first season's Boss. */
  readonly firstBoss: string;
  /** The title of the one thread on The System's board where landed moves and their ends are written; the seed makes it once. */
  readonly announcementsTitle: string;
  /** The roster keys on staff when the instance is seeded (never the first Boss). */
  readonly firstStaff: readonly string[];
  readonly duties: Readonly<Record<Duty, DutyAssignee>>;
  readonly stockLines: StockLines;
  readonly feeds: readonly FeedSource[];
  /** Subjects never amplified (politics, real tragedies); a starting list admins edit. */
  readonly realWorld: readonly string[];
  /** Material the community likes, a starting list The System learns more of. */
  readonly wheelhouse: readonly string[];
  /** Problems with a board name The System proposes; empty when it is in style. */
  nameStyle(name: string): string[];
  /**
   * The same style, said in the instance's own words for the meeting's prompt: what a name must look like, with a few
   * examples. The engine composes the prompt from this and never writes a community's style itself.
   */
  readonly nameStyleBrief: string;
}

/**
 * The instance's developer persona (the alerts design, section 3): the one in-character voice the glass has, on the Updates page. It
 * is written by the instance's admins and never by a model, so it is no part of `system`, which is all a model reads. `name` is the
 * staff character's; `tagline` is its profile title (at most 40 characters, which a profile holds); `avatar` is a key the instance's UI
 * turns into a picture (`InstanceUi.avatars`), as a pip style's key is. An instance with none stands on the engine's plain default.
 */
export interface DeveloperPersona {
  readonly name: string;
  readonly tagline: string;
  readonly avatar?: string;
}

export interface Instance {
  readonly key: string;
  readonly name: string;
  readonly copy: Copy;
  readonly classes: readonly ClassRules[];
  readonly cards: readonly CardRules[];
  readonly reactions: readonly ReactionKind[];
  readonly settings: Settings;
  readonly boards: readonly BoardSeed[];
  readonly ranks: readonly Rank[];
  readonly pipStyles: readonly PipStyle[];
  readonly system: SystemContent;
  /** The developer persona; left out, the engine's default ("The developers", no tagline, no avatar). */
  readonly developer?: DeveloperPersona;
}
