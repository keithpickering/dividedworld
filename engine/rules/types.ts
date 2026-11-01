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
import type { CardRules } from './cards.ts';
import type { StockLineKey } from '../system/stock.ts';
import type { Duty } from '../system/duties.ts';
import type { PhaseOverrides, PhaseSettings } from '../system/phases.ts';

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
  /** Minutes only where a setting says it takes them (editGrace); a window, a season and a cooldown count days or more. */
  readonly unit: 'minute' | 'day' | 'week' | 'month';
  readonly count: number;
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
   * The numbers a card gives the screens, each named by the instance ("whoops.clean"): a card's effect
   * decides something on the client (how much of a layer counts as washed clean), so the number is one the
   * screens read (`screen_settings`), which the economy never is. The engine checks each is a number; the
   * cards that name them in `screenReads` check their range.
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
  /** The longest a board's name may be, in characters, whether The System or a player proposes it. */
  readonly boardNameMaxLength: number;
  /** The most days any move may last, whatever its phase allows. A starting point. */
  readonly moveExpiryMostDays: number;
  /** The fewest hours any move lasts before it may expire, so a player always has time to meet its demand. A starting point. */
  readonly moveExpiryLeastHours: number;
  /** The model each tier of a call uses (the meeting runs on `strong`, small lines on `light`), as the provider names it. */
  readonly modelTiers: { readonly strong: string; readonly light: string };
}

/**
 * The kinds of Act the settlement reads. An `unmask` is a character's reveal of its own class
 * (supabase/migrations/0027_unmask.sql): an Act of its character like a card, whose reactions are
 * scored and which counts in the halving, and no post.
 */
export type ActKind = 'post' | 'spin' | 'card' | 'edit' | 'unmask';

/**
 * A board the instance starts with. Exactly one is The System's (`system`): only The System posts
 * there (a settlement's tally, the season's reveal), and players react to it and spin threads
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
 * post it landed on.
 */
export interface InputAct {
  readonly id: string;
  readonly character: string;
  readonly kind: ActKind;
  readonly at: number;
  readonly thread: string;
  readonly target?: string;
  readonly card?: string;
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
  /** The thread a season's announced Turns are posted in. */
  readonly turnsThreadTitle: string;
  /** The thread The System posts a season's reveal in, and what it says there. */
  readonly revealTitle: string;
  readonly revealBody: string;
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
 * A staff character an instance seeds (0042): a Boss or a Mod Bot, a character with no account behind it. The seed makes
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

/** A Boss in the instance's roster: a staff character, and the persona that plays it for a season. */
export interface BossPersona extends StaffSeed {
  /** The system prompt that makes the model this Boss, built on the instance's shared premise. */
  readonly persona: string;
  /** What it is into on its first day. */
  readonly startingHobby: string;
  /** A line of temperament, for an admin reading the roster and for the meeting to be told. */
  readonly temperament: string;
  /** For a reinvention: the key of the Boss whose memory this persona picks up. */
  readonly inheritsMemoryOf?: string;
  /** This Boss's own phase numbers, clamped into the engine's caps (`PHASE_CAPS`). */
  readonly phases?: PhaseOverrides;
}

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

/** A Mod Bot in the instance's roster: standing staff that outlasts Bosses. */
export interface ModBotPersona extends StaffSeed {
  readonly persona: string;
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

/** What the old voice is given for a board's description, and what it is told to stop at. */
export interface OldVoiceFrame {
  readonly prompt: string;
  readonly stop: readonly string[];
}

/** A feed an instance lets The System read for outside material: plain code fetches it; no model searches the web. */
export interface FeedSource {
  readonly name: string;
  readonly url: string;
}

/**
 * Everything The System needs from an instance: its Bosses and Mod Bots, who does each duty, the lines it falls back
 * on, what it reads from outside, what it leaves alone, and the shape of a board's name. The engine names this
 * interface and never an instance's persona.
 */
export interface SystemContent {
  readonly bosses: readonly BossPersona[];
  /** The key of the first season's Boss. */
  readonly firstBoss: string;
  /** The title of the one thread on The System's board where landed moves and their ends are written; the seed makes it once. */
  readonly announcementsTitle: string;
  readonly modBots: readonly ModBotPersona[];
  /** The keys of the bots on staff when the instance is seeded. */
  readonly firstStaff: readonly string[];
  readonly duties: Readonly<Record<Duty, DutyAssignee>>;
  readonly stockLines: StockLines;
  readonly feeds: readonly FeedSource[];
  /** Subjects never amplified (politics, real tragedies); a starting list admins edit. */
  readonly realWorld: readonly string[];
  /** Material the community likes, a starting list The System learns more of. */
  readonly wheelhouse: readonly string[];
  /** The completion prompt for a board's description, and where it stops. */
  oldVoice(input: { readonly name: string; readonly premise: string }): OldVoiceFrame;
  /** Problems with a board name The System proposes; empty when it is in style. */
  nameStyle(name: string): string[];
  /**
   * The same style, said in the instance's own words for the meeting's prompt: what a name must look like, with a few
   * examples. The engine composes the prompt from this and never writes a community's style itself.
   */
  readonly nameStyleBrief: string;
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
}
