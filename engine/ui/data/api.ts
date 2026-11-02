/**
 * KayfaApi: every read and action the engine's screens make, as one interface.
 *
 * The screens are written against this and nothing else; a backend implements it. Two do: the
 * Supabase adapter in the composition root (web/src/data/supabase.ts), the one place a Supabase
 * client lives ("Portable by construction"), and the in-memory backend beside this file
 * (engine/ui/data/fake.ts), which the stories, the unit tests and the end-to-end tests run on and
 * which refuses what the server refuses, in the same words.
 *
 * What it reads is only what the screens may know: public projections, and the signed-in
 * player's own rows (tools/check-web-reads.mjs holds the adapter to that list). Nothing here
 * answers from a private fact about anyone else: not who owns a character, not its class unless
 * its player made it public, not who reacted ("A response never proves a private fact").
 *
 * Aura is a whole number of hundredths of an orb, as the engine stores it (engine/rules/types.ts).
 * Times are ISO 8601 strings as the server sends them, except an estimate line's `at`, which is
 * epoch milliseconds as the estimate function sends it.
 */
import type { Quadrant, Span } from '../../rules/types.ts';
import type { BeyondPost, Reach } from '../../rules/cards.ts';
import type { AlertKind } from '../../rules/alerts.ts';

export type Id = string;

/* ------------------------------------------------------------------ answers ---- */

/** A refusal, in the server's own words, with the request field it names when it names one. */
export interface Refusal {
  readonly ok: false;
  readonly error: string;
  readonly field?: string;
  /**
   * Set when no answer came back from a write, so it may have gone through: the caller looks
   * before it tries again (Acts are append-only, so a blind resend is a duplicate).
   */
  readonly uncertain?: true;
}

/** The words of a lost answer; the adapter and the in-memory backend both say them. */
export const LOST_ANSWER = 'no answer came back, so this may have gone through: look before you try again';

/** The most threads `spunFrom` reads for one Act when no smaller limit is asked. */
export const SPUN_FROM_MAX = 200;

export type Answer<T> = { readonly ok: true; readonly value: T } | Refusal;

/* ---------------------------------------------------------------- the instance ---- */

/** The instance settings a screen reads (the screen_settings view): none of them a private fact. */
export interface ScreenSettings {
  readonly postsPerPage: number;
  /** A thread is HOT with at least this many replies in the last seven days. */
  readonly hotReplies: number;
  readonly editGrace: Span;
  readonly reactionCap: number;
  readonly charactersPerPlayer: number;
  readonly invitesPerPlayer: number;
  readonly inviteLifetime: Span;
  readonly turnCooldown: Span;
  readonly walletCap: number;
  readonly postMaxLength: number;
  readonly titleMaxLength: number;
  readonly registrationMode: 'open' | 'invite' | 'closed';
  readonly settlementLength: Span;
  /** How often a page polls who is browsing it, in seconds; each poll is also the viewer's heartbeat. */
  readonly presencePollSeconds: number;
  /** How long after its last poll a mask stays listed: what "Who is online" says it counts. */
  readonly presenceWindow: Span;
  /** The numbers the instance's cards give the screens, by name (`Settings.cardSettings`). */
  readonly cardSettings: Readonly<Record<string, number>>;
  /**
   * The economy numbers the cards' prices read, as the server prices with them now (0039_card_economy.sql): each card's price and
   * the keys its rules read, from the economy row an admin tunes. A key it lacks is the compiled economy's (`withCardEconomy`).
   */
  readonly cardEconomy: Readonly<Record<string, number>>;
}

/* ------------------------------------------------------------- public reads ---- */

export interface Board {
  readonly id: Id;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  /** The System's own board: only The System posts there; players react and spin. */
  readonly isSystem: boolean;
  /** The move in force that renamed this board (boards_now.move_act): its name and description above are that move's. Null when the board has none. */
  readonly moveAct: Id | null;
}

/** A board's name now and the name it had before any move, for words that name a board (a staff member's moderation log, the admin queue). */
export interface BoardName {
  readonly id: Id;
  readonly slug: string;
  readonly name: string;
  /** The board's own name, which a move in force has changed `name` from. */
  readonly was: string;
}

/** A board on the index: its threads and its latest Act. */
export interface BoardSummary extends Board {
  readonly threadCount: number;
  readonly lastAt: string | null;
  readonly lastCharacter: Id | null;
  readonly lastThread: Id | null;
}

/** A thread as the list shows it (the thread_list view). */
export interface ThreadSummary {
  readonly id: Id;
  readonly board: Id;
  readonly title: string;
  readonly originActId: Id | null;
  readonly createdAt: string;
  /** When its latest Act was made; an edit does not bump a thread. */
  readonly lastAt: string;
  /** Its latest Act's seq: Acts are numbered from 1 in each thread. */
  readonly lastSeq: number;
  /** Its posts after the first: a card, a spin, an unmask, a tally and an edit are no reply. */
  readonly replies: number;
  readonly firstAct: Id | null;
  readonly firstCharacter: Id | null;
  readonly lastAct: Id | null;
  /** Null for The System's own Acts. */
  readonly lastCharacter: Id | null;
  readonly repliesThisWeek: number;
  /** A spun thread's origin, read with the row: the thread of the Act it was spun from, that thread's title and the Act's seq. Null when it was not spun. */
  readonly originThread: Id | null;
  readonly originTitle: string | null;
  readonly originSeq: number | null;
}

export type ActKind = 'post' | 'spin' | 'card' | 'edit' | 'tally' | 'reveal' | 'unmask' | 'move' | 'move_end' | 'move_keep' | 'set' | 'spring';

/** An Act as every reader sees it (acts_public): the original and, where edited, what it shows now. */
export interface Act {
  readonly id: Id;
  /** Null for The System's own Acts (a tally, the reveal). */
  readonly character: Id | null;
  readonly kind: ActKind;
  readonly thread: Id;
  readonly targetActId: Id | null;
  /**
   * Null for an edit, which is a version of its post, and for a card, which is a tag on its post: neither is a place in the
   * thread, and a post's number is never moved by one. (A card played before that change keeps the number it was given.)
   */
  readonly seq: number | null;
  readonly createdAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly currentPayload: Readonly<Record<string, unknown>>;
  readonly editedAt: string | null;
  /** Set only by an edit made after the grace period: what "Last edited" says. */
  readonly shownEditedAt: string | null;
}

/** The state a card's effect has saved on one play, and when: what every reader loads, the post author's version. */
export interface EffectState {
  readonly state: unknown;
  readonly savedAt: string;
}

/** A crop frame, in fractions of the picture it was cut from. */
export interface Frame {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A debuted character, as anyone sees it: its name and its public profile. */
export interface Character {
  readonly id: Id;
  readonly name: string;
  readonly title: string;
  readonly signature: string;
  /** A URL, or null when it has no avatar. */
  readonly avatarSquare: string | null;
  readonly avatarPortrait: string | null;
  readonly squareFrame: Frame | null;
  readonly portraitFrame: Frame | null;
  readonly pipStyle: string;
  /** The first day of the month it debuted, "2026-10-01": the month and never the time ("Joined Oct 2026"). */
  readonly joined: string;
  /** Set only for a staff character (a Boss or a Mod Bot): the instance's key for it. A staff member is known to be staff, signed in or not. */
  readonly staff?: string;
  /** A Boss is shown ADMINISTRATOR and a Mod Bot MODERATOR. Set with `staff`. */
  readonly staffKind?: 'boss' | 'bot';
}

/** A character's season standing and its place, as a page of the standings lists it (standings_page). */
export interface Standing {
  readonly character: Id;
  readonly name: string;
  /** Hundredths. */
  readonly standing: number;
  /** Ties share a place. */
  readonly place: number;
}

/** A character's standing, its place and how many characters have debuted (`standing_place`). */
export interface StandingPlace {
  /** Hundredths. */
  readonly standing: number;
  /** Ties share a place. */
  readonly place: number;
  readonly of: number;
}

export interface Season {
  readonly id: number;
  readonly number: number;
  readonly startsAt: string;
  readonly endsAt: string | null;
  readonly turnsThread: Id | null;
  readonly revealAct: Id | null;
}

/** A class a character's player made public, as of its date (class_reveals). */
export interface ClassReveal {
  readonly act: Id;
  readonly character: Id;
  readonly class: string;
  readonly at: string;
  readonly via: 'act' | 'debut' | 'turn';
  readonly thread: Id;
}

/** An announced Turn (turns_announced); `was` only when the Turn named its old class. */
export interface TurnAnnounced {
  readonly act: Id;
  readonly character: Id;
  readonly at: string;
  readonly was: string | null;
  readonly since: string | null;
}

/** What a character has done in public, counted. */
export interface CharacterCounts {
  readonly posts: number;
  readonly spins: number;
  readonly cards: number;
}

/** A reaction tally: each kind's count, never who left it. */
export type Tally = Readonly<Record<string, number>>;

/* ------------------------------------------------------------------- the moves ---- */

/** A condition on public Acts that ends a move when it is met (engine/system/demands.ts is the catalog of kinds and their plain words). */
export interface Demand {
  readonly kind: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/**
 * How far a move's demand had come when the tick last counted it (move_progress, admin_queue): the tick stores its count on the move, so
 * a page read costs nothing in the board's size, and the count may be minutes old. `checkedAt` is when it was counted, and null when it
 * has not been counted yet, in which case the numbers are 0 of 0 and a screen shows none. `error` is set when the demand could not be
 * read, in which case the count is 0 of 0 too.
 */
export interface DemandProgress {
  readonly done: number;
  readonly of: number;
  readonly met: boolean;
  readonly checkedAt: string | null;
  readonly error?: string;
}

/**
 * A move in force as its board shows it: the Boss's `move` Act, its top three reactions and the progress of its demand. The label
 * and the words of the demand are not here; they come from the engine's catalogs by `kind` (engine/system/moves.ts, demands.ts),
 * never from the Boss's own text.
 */
export interface MoveNotice {
  readonly act: Id;
  readonly thread: Id;
  /** The Boss who made it, as a character (null if the Act somehow has none). */
  readonly character: Id | null;
  readonly kind: string;
  readonly params: Readonly<Record<string, unknown>>;
  /** Null for a move that asks nothing. */
  readonly demand: Demand | null;
  /** The Boss's own words for it (its stock line or, later, its micro-event line): shown as the Boss's, never as the glass's. */
  readonly body: string;
  readonly expiresAt: string | null;
  readonly landedAt: string;
  /** Null for a move with no demand. */
  readonly progress: DemandProgress | null;
  /** The three kinds with the most reactions, most first; a kind with none is left out. */
  readonly reactions: readonly { readonly kind: string; readonly count: number }[];
}

/** The most reactions a move's notice shows. */
export const NOTICE_REACTIONS = 3;

/** How a landed move ended (moves_log). */
export interface MoveEnd {
  readonly why: 'met' | 'expired' | 'reversed' | 'superseded' | 'spent';
  /** `tick`, `admin`, `boss` (the new Boss's review), `inheritance` (the review never came) or `handover`. */
  readonly by: string;
  readonly at: string;
}

/** One landed move of a staff member's, as its moderation log lists it. */
export interface MoveLogRow {
  readonly act: Id;
  readonly kind: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly demand: Demand | null;
  readonly expiresAt: string | null;
  /** When it landed. */
  readonly at: string;
  readonly thread: Id;
  /** Null while it is in force. */
  readonly end: MoveEnd | null;
  /** The staff key of the Boss that keeps it after a handover (a review's keep), or null. */
  readonly keptBy: string | null;
}

/** Where the next page of a moderation log starts: the last row's time and Act, as the page was ordered by them. */
export interface MovesCursor {
  readonly at: string;
  readonly act: Id;
}

/** A page of a staff member's moves, newest first. `older` is the cursor for the next page; null when nothing older is left. */
export interface MovesLog {
  readonly rows: readonly MoveLogRow[];
  readonly older: MovesCursor | null;
}

/** Moves to a page of a moderation log. */
export const MOVES_LOG_PAGE = 20;

/** A staff member's in-character profile, the latest version (staff_profile_now): what it says about itself, and it may bluff. */
export interface StaffProfile {
  readonly staff: string;
  readonly at: string;
  readonly interests: readonly string[];
  /** Characters it named, public ones. */
  readonly favorites: readonly Id[];
  readonly mood: string;
  readonly signature: string;
}

/** A move the Boss chose that waits to land (admin_queue). */
export interface QueuedMove {
  readonly id: number;
  readonly staff: string;
  readonly boss: string | null;
  readonly kind: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly demand: Demand | null;
  /** The Boss's own words for choosing it; an admin may read them. */
  readonly why: string;
  readonly goLiveAt: string;
  readonly expiresAt: string | null;
  readonly structural: boolean;
  /** A rename's board as it is called now. */
  readonly boardName: string | null;
  /** When the tick last could not land it, and why in the server's words; null when it has not failed. */
  readonly failedAt: string | null;
  readonly failure: string | null;
  /** When an admin put another Boss in a nomination's place; null when none did. Not who: admins do not need each other's accounts here. */
  readonly replacedAt: string | null;
}

/** A landed move with no end yet (admin_queue). */
export interface MoveInForce {
  readonly act: Id;
  readonly id: number | null;
  readonly staff: string | null;
  readonly boss: string | null;
  readonly kind: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly demand: Demand | null;
  readonly why: string | null;
  readonly landedAt: string;
  readonly expiresAt: string | null;
  readonly progress: DemandProgress;
}

/** A move that ended, or was held and never landed, in the last 30 days (admin_queue). */
export interface MoveEnded {
  readonly how: 'met' | 'expired' | 'reversed' | 'superseded' | 'spent' | 'held';
  readonly by: string | null;
  readonly at: string;
  /** Null for a held move, which was never an Act. */
  readonly act: Id | null;
  readonly id: number | null;
  readonly staff: string | null;
  readonly boss: string | null;
  readonly kind: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly demand: Demand | null;
  readonly why: string | null;
  readonly landedAt: string | null;
}

/** What the admin screen shows. Each group holds at most `cap` rows; `more` says a group was cut. */
export interface AdminQueue {
  readonly cap: number;
  readonly waiting: readonly QueuedMove[];
  readonly inForce: readonly MoveInForce[];
  readonly ended: readonly MoveEnded[];
  readonly more: { readonly waiting: boolean; readonly inForce: boolean; readonly ended: boolean };
  /** The Bosses a waiting nomination can be replaced with: on the roster, not retired, debuted; in the rotation's order. */
  readonly roster: readonly { readonly staff: string; readonly name: string }[];
}

/* ---------------------------------------------------------- the player's own ---- */

export interface Session {
  readonly signedIn: boolean;
  /** The account, once one is open; null while signed in with none (an invite is needed). */
  readonly account: Id | null;
}

/** One of the player's own characters (my_characters): seen by its player alone. */
export interface MyCharacter {
  readonly id: Id;
  readonly name: string;
  /** Its class now: shown to its player as "only you". */
  readonly class: string;
  readonly classSince: string;
  /** When it may next Turn; null when it may now. */
  readonly turnOpensAt: string | null;
  /** Null while it waits to debut at the next tally. */
  readonly debutedAt: string | null;
  readonly debutLoudness: 'silent' | 'announced' | 'with_class' | null;
  readonly retiredAt: string | null;
  readonly pendingTurn: PendingTurn | null;
  /** Hidden from "Who is online" and "Users browsing": listed nowhere, its player's switch in My characters. */
  readonly presenceHidden: boolean;
}

/** Where a presence box is: a thread, a board (its page and every thread on it) or the index ("Who is online"). */
export type PresencePlace = { readonly kind: 'thread'; readonly thread: Id } | { readonly kind: 'board'; readonly board: Id } | { readonly kind: 'index' };

/**
 * Who is browsing a place (0041_presence.sql): the characters present within the window, longest present first, at
 * most the instance's presenceNames of them, and how many more. Names and a count of characters only: never an
 * account, and nothing that says which are the caller's.
 */
export interface Presence {
  readonly names: readonly { readonly id: Id; readonly name: string }[];
  readonly others: number;
}

export interface PendingTurn {
  readonly class: string;
  readonly loudness: 'silent' | 'announced';
  readonly showFrom: boolean;
  readonly showTo: boolean;
  /** When the next settlement applies it; null when no window is known yet ("at the next settlement"). */
  readonly takesEffectAt: string | null;
}

export interface Wallet {
  /** The settled wallet, the only Aura that can be spent. */
  readonly balance: number;
  readonly cap: number;
}

/** A reaction the player left, through one of their characters. */
export interface MyReaction {
  readonly act: Id;
  readonly kind: string;
  readonly character: Id;
}

/** The live estimate (the estimate function): each reaction's own amount, before the shared vote and halving. */
export interface Estimate {
  readonly entries: readonly { readonly character: Id; readonly reason: string; readonly amount: number }[];
  readonly lines: readonly EstimateLine[];
  readonly asOf: string | null;
  /** Ask again only after this; an ask before it is answered by the same estimate. */
  readonly freshAfter: string | null;
}

export interface EstimateLine {
  readonly character: Id;
  readonly reason: string;
  readonly amount: number;
  readonly act?: Id;
  readonly quadrant?: Quadrant;
  /** Epoch milliseconds: when the one reaction this line pays for landed. */
  readonly at?: number;
}

export interface Preferences {
  /** "system", "light", "dark", or an instance theme's key. */
  readonly theme: string;
  readonly postbit: 'side' | 'stacked';
  readonly motion: 'system' | 'reduce' | 'full';
  /** How much smoke stands behind the glass: all of it, a third of each layer, or none (plain ground). */
  readonly smoke: 'full' | 'low' | 'off';
  /** High puts solid ground under every line of glass text and switches the glass to its `high` key. */
  readonly contrast: 'standard' | 'high';
  /** The text's size for the board and the glass together, in percent; past 150 the glass is one column. */
  readonly textSize: 100 | 125 | 150 | 200;
  /**
   * The card kinds (their keys) this account has met: a kind's first mark on a page shows its callout until the kind is in this
   * set. Changed only by `meetCard` and `forgetCardsMet`, never by `setPreferences`; at most 64, read by its own account alone.
   */
  readonly cardsMet: readonly string[];
  /**
   * When the account last opened Alerts (an ISO time), or null if it never has: what arrived after it is new, on every device. Changed
   * only by `seeAlerts`, only forward; read by its own account alone.
   */
  readonly alertsSeenAt: string | null;
  /** The end (an ISO time) of the last settlement whose summary the account has seen, or null. Changed only by `seeSettlement`, only forward. */
  readonly settlementSeen: string | null;
}

/** What `setPreferences` takes: the choices a player makes in Settings, not the set of cards met (`meetCard`, `forgetCardsMet`) or the two marks. */
export type PreferencesPatch = Partial<Omit<Preferences, 'cardsMet' | 'alertsSeenAt' | 'settlementSeen'>>;

/** What an account's preferences are before it has set any (account_preferences' defaults). */
export const DEFAULT_PREFERENCES: Preferences = { theme: 'system', postbit: 'side', motion: 'system', smoke: 'full', contrast: 'standard', textSize: 100, cardsMet: [], alertsSeenAt: null, settlementSeen: null };

export interface MyInvite {
  readonly id: number;
  readonly createdAt: string;
  readonly used: boolean;
  /** Null once used. */
  readonly expiresAt: string | null;
  readonly expired: boolean;
}

export interface HeldCard {
  readonly card: string;
  readonly held: number;
}

/** What a purchase leaves: the card bought, the settled wallet after it and how many of that card the player now holds (`buy_card`'s answer). */
export interface Bought {
  readonly card: string;
  readonly balance: number;
  readonly held: number;
}

/* ------------------------------------------------------------------ the log ---- */

/**
 * One post's share of a settled ledger line: the line's exact amount split across the posts the live
 * estimate valued for it (engine/rules/settle.ts's shareEntries, written by the settlement; the log
 * shares design). The quadrant is null where the estimate's line named none.
 */
export interface LogShare {
  readonly act: Id;
  readonly quadrant: Quadrant | null;
  readonly amount: number;
}

/** One reason's settled amount for one of the player's characters in one window (`my_ledger`), with its shares (`my_ledger_shares`). */
export interface LogLine {
  readonly character: Id;
  readonly reason: string;
  readonly amount: number;
  /** Empty where the estimate valued no post for the reason, or the settlement was made before shares were kept. */
  readonly shares: readonly LogShare[];
}

/** A settlement the player has lines in, with every line of the player's in it. */
export interface LogSettlement {
  readonly id: number;
  readonly startsAt: string;
  readonly endsAt: string;
  /** False for a settlement made before its shares were kept, which has none and never will. */
  readonly sharesKept: boolean;
  readonly lines: readonly LogLine[];
}

/** A change to the player's wallet (`my_wallet_events`): a settlement's credit with what the cap and the floor cut off, a purchase, a play, a trap's payout. */
export interface WalletEvent {
  readonly settlement: number | null;
  readonly kind: 'settlement' | 'purchase' | 'play' | 'trap';
  readonly change: number;
  /** What the cap held back of a settlement's credit. */
  readonly overflow: number;
  /** What the floor held back of a settlement's debit. */
  readonly floored: number;
  readonly balanceAfter: number;
  /** A play's Act, or a trap's spring for its payout; null for a settlement and a purchase. */
  readonly ref: Id | null;
  readonly at: string;
}

/** A card the player bought or played (`my_card_ledger`), with its price: a play that cost nothing is here and has no wallet event. */
export interface CardEvent {
  readonly card: string;
  readonly kind: 'bought' | 'played';
  /** The play's Act; null for a purchase. */
  readonly act: Id | null;
  readonly price: number;
  readonly at: string;
}

/**
 * A play another player landed on one of the player's own posts, characters or threads (`my_posts_played_on`). `post` is the post the
 * play sits on; `targetName` is the character's name or the thread's title the play landed on, null for a post.
 */
export interface PlayOnMine {
  readonly play: Id;
  readonly post: Id;
  readonly at: string;
  readonly reach: 'post' | 'character' | 'thread';
  readonly targetName: string | null;
  /** The player's character the row is about: the one played on, the thread's starter, or the post's author. */
  readonly targetCharacter: Id | null;
}

/**
 * A thread the player follows that has posts past their place (`my_followed_threads`). `newPosts` is the count of posts by
 * characters the player does not own, counted up to `FOLLOWED_COUNT_CAP` (a count at the cap means that many or more); `newestAt`
 * is the newest such post's time.
 */
export interface FollowedThread {
  readonly thread: Id;
  readonly board: Id;
  readonly title: string;
  readonly newPosts: number;
  readonly newestAt: string;
}
/** The most new posts a followed thread counts (supabase/migrations/0059_follows.sql): a screen words a count at it as "100+". */
export const FOLLOWED_COUNT_CAP = 100;

export type { AlertKind };

/**
 * One line of the player's Alerts (`my_alerts`, supabase/migrations/0060_alerts_read.sql): the kind, and the inputs of the words a
 * screen says. Never a caster, a reactor, an account or a class. `at` is when it arrived: a written alert's time, a followed
 * thread's newest new post, the time a settlement was applied. `sub` is a ruling's sub-key, or a settlement's id as text. `act` is
 * the public Act a written alert is about (null for a followed thread and a settlement), `character` the player's character it
 * concerns, `thread` and `title` the thread to open and its title, `name` that character's public name, `count` the new posts of a
 * followed thread (to `FOLLOWED_COUNT_CAP`) or the characters a settlement moved. Any of them is null where it does not apply.
 */
export interface Alert {
  readonly kind: AlertKind;
  readonly sub: string | null;
  readonly act: Id | null;
  readonly character: Id | null;
  readonly at: string;
  readonly thread: Id | null;
  readonly name: string | null;
  readonly title: string | null;
  readonly count: number | null;
}
/** A page of the Alerts is at least this many lines (more only to keep lines that share an instant together). */
export const ALERTS_PAGE = 30;
/** The count `alertsUnread` stops at: a result at the bound means that many or more, and a screen says "9+". */
export const ALERTS_UNREAD_BOUND = 10;

/** When the effect of a play on one of the player's posts was last saved: the post's author's save, which may wash it clean. */
export interface EffectSaved {
  readonly play: Id;
  readonly post: Id;
  readonly savedAt: string;
}

/**
 * The end of a card the player set face down (`my_face_down`): it sprang (`spring`, a public Act by then), or its time came with
 * nothing springing it. Which card it was is the player's own row; nobody else reads it.
 */
export interface FaceDownEnd {
  /** The set Act. */
  readonly play: Id;
  readonly card: string;
  readonly post: Id;
  readonly spring: Id | null;
  readonly endedAt: string;
}

/** A play of the player's a trap caught (`my_caught`): its card, its post, the trap's card and spring, what the play cost and what the card cost at the machine. */
export interface CaughtPlay {
  readonly play: Id;
  readonly card: string;
  readonly post: Id;
  readonly trap: string;
  readonly spring: Id;
  readonly price: number;
  /** What the player paid for the card at the machine, the latest purchase of it before the play; null where none is on record. */
  readonly boughtPrice: number | null;
  readonly at: string;
}

/**
 * A page of the player's own log, newest first: everything at or before the page's cursor and after
 * `before`, which is where the next page starts (null at the log's start). Each source is read a page
 * at a time, so a long-played account reads a page and never its history.
 */
export interface Log {
  readonly settlements: readonly LogSettlement[];
  readonly wallet: readonly WalletEvent[];
  readonly cards: readonly CardEvent[];
  readonly playsOnMine: readonly PlayOnMine[];
  readonly saves: readonly EffectSaved[];
  /** The player's cards set face down that sprang or ended, by when. */
  readonly setEnds: readonly FaceDownEnd[];
  /** The player's plays a trap caught, by when each was played. */
  readonly caught: readonly CaughtPlay[];
  /** The next page's cursor: pass it to `log` for what is older. Null when nothing older is left. */
  readonly before: string | null;
}

/* ------------------------------------------------------------------ actions ---- */

export type DebutTiming = 'now' | 'tally';
export type DebutLoudness = 'silent' | 'announced' | 'with_class';

export interface CreatedCharacter {
  readonly id: Id;
  readonly name: string;
  readonly class: string;
  readonly waiting: boolean;
  readonly loudness: DebutLoudness;
}

export interface TurnAsked {
  readonly class: string;
  readonly loudness: 'silent' | 'announced';
  readonly showFrom: boolean;
  readonly showTo: boolean;
  readonly takesEffectAt: string | null;
}

/** What an avatar upload sends: the two re-encoded WebP crops and their frames, never the original. */
export interface AvatarUpload {
  readonly character: Id;
  /** 256 by 256 WebP, cut from inside the portrait. */
  readonly square: Blob;
  /** 256 to 512 wide, up to twice as tall; null for a recrop of the square from the stored portrait. */
  readonly portrait: Blob | null;
  readonly squareFrame: Frame;
  readonly portraitFrame: Frame | null;
}

/* --------------------------------------------------------------------- live ---- */

export interface ThreadListener {
  /** A new Act, or an edited post again under its own id. May come twice or out of order: key by id. */
  readonly onAct?: (act: Act) => void;
  /** A tally that only grows: keep each kind's largest. */
  readonly onTally?: (act: Id, tally: Tally) => void;
  readonly onEffect?: (play: Id, savedAt: string) => void;
}

export interface BoardListener {
  readonly onThread?: (thread: { readonly id: Id; readonly board: Id; readonly title: string; readonly originActId: Id | null; readonly createdAt: string }) => void;
}

/** An alert as the private channel announces it (`account:<id>`, supabase/migrations/0058_alerts.sql): the public projection, with no caster, reactor, account or class. */
export type LiveAlert = Pick<Alert, 'kind' | 'sub' | 'act' | 'character' | 'at'> & {
  /** The alert's own id (`alerts.id`, a uuid), so a client that hears one twice, or hears it and reads the list, can tell it is the same. */
  readonly id: string;
};

export interface AccountListener {
  /** An alert for the player's own account, as it is written. May come twice: key by act and kind, or reread the list. */
  readonly onAlert?: (alert: LiveAlert) => void;
}

export interface ReachListener {
  /**
   * A card played beyond a post (a character, a thread or a board; the card reach design), as the public Act it is, wherever the
   * page is. May come twice or out of order: key by id. Every signed-in player hears every one, so a page keeps the plays whose
   * target it shows and drops the rest.
   */
  readonly onPlay?: (play: Act) => void;
}

/* ---------------------------------------------------------------- the api ---- */

/** A thread pinned to the top of its board's list by a live thread play whose card pins (pinned_threads, 0055): the thread, its play's Act, and when the pin ends. */
export interface PinnedThread {
  readonly thread: ThreadSummary;
  readonly play: Id;
  readonly endsAt: string;
  readonly act: Act;
}

/** A live play beyond a post (effects_above, 0055_card_reach.sql): its Act, the reach and target it lands on, and when it ends. */
export interface PlayAbove {
  readonly play: Id;
  readonly reach: BeyondPost;
  readonly target: Id;
  readonly endsAt: string;
  readonly act: Act;
}

export interface KayfaApi {
  /* Signing in: passwordless, through the account function only, in the same words for every address. */
  session(): Promise<Session>;
  onSession(listener: (s: Session) => void): () => void;
  requestCode(email: string, invite: string | null): Promise<Answer<{ readonly message: string; readonly invite?: string }>>;
  verifyCode(email: string, code: string): Promise<Answer<{ readonly account: boolean; readonly why?: string }>>;
  openAccount(invite: string | null): Promise<Answer<{ readonly opened: boolean }>>;
  signOut(): Promise<void>;
  /** The address the session signed in with, the player's own, for Settings › Account; null signed out. */
  signInAddress(): Promise<string | null>;
  isAdmin(): Promise<boolean>;
  /** The moves waiting to land, in force, and ended or held in the last 30 days. An admin's alone; anyone else is refused (the call throws). */
  adminQueue(): Promise<AdminQueue>;
  /** Holds a move that is waiting: it never lands. An admin's alone, and it cannot be taken back. */
  holdMove(id: number): Promise<Answer<{ readonly id: number; readonly heldAt: string }>>;
  /** Ends a move in force now as reversed by an admin; the old name returns at once. An admin's alone. */
  reverseMove(act: Id): Promise<Answer<{ readonly act: Id; readonly endedBy: Id }>>;
  /** Puts another Boss of the roster in a waiting nomination's place (`id` is the queue row's). An admin's alone; a nomination that has landed or been held is refused. */
  replaceSuccessor(id: number, boss: string): Promise<Answer<{ readonly id: number; readonly boss: string }>>;
  /** The Bosses of the instance's roster, by staff key and name: public, as a Boss's name is. */
  bosses(): Promise<readonly { readonly staff: string; readonly name: string }[]>;

  settings(): Promise<ScreenSettings>;

  /* What anyone signed in can read. */
  /** Every board with its thread count (a counter) and latest thread: for the index, which lists them all. */
  boards(): Promise<readonly BoardSummary[]>;
  /** One board by its slug or its id, or null: a screen that needs one board's row never reads the list of boards. */
  board(slugOrId: string): Promise<Board | null>;
  /** Every board's name now and the name it had before any move: a handful of rows, for the words that name a board (the moderation log, the admin queue). */
  boardNames(): Promise<readonly BoardName[]>;
  /**
   * A move in force, as its board shows it, or null when the Act is no move (or none the reader may see). The progress is
   * `move_progress`, a public read: it counts characters, posts and public tallies and never players.
   */
  moveNotice(act: Id): Promise<MoveNotice | null>;
  /** A page of a staff member's moves, newest first, `MOVES_LOG_PAGE` to a page; pass the last page's `older` for the next. */
  movesLog(staff: string, before?: MovesCursor | null): Promise<MovesLog>;
  /** A staff member's latest in-character profile, or null before it has one (a Mod Bot has none until it is asked to write one). */
  staffProfile(staff: string): Promise<StaffProfile | null>;
  /** A page of a board's threads, newest first; `total` is the board's thread counter, never a count of the list. */
  threads(board: Id, page: { readonly offset: number; readonly limit: number }): Promise<{ readonly threads: readonly ThreadSummary[]; readonly total: number }>;
  thread(id: Id): Promise<ThreadSummary | null>;
  /** A thread's Acts from one seq to another, both included, edits left out (each shows through its post). */
  acts(thread: Id, fromSeq: number, toSeq: number): Promise<readonly Act[]>;
  act(id: Id): Promise<Act | null>;
  /** Several Acts by id in one read; an id that is not an Act (or none the reader may see) is left out. Order is not promised. */
  actsById(ids: readonly Id[]): Promise<readonly Act[]>;
  /** A post's every version, the original first, each as it was written. */
  history(post: Id): Promise<readonly Act[]>;
  /** The threads spun from an Act, oldest first, at most `limit` (default `SPUN_FROM_MAX`): a result as long as the limit may be cut. */
  spunFrom(act: Id, limit?: number): Promise<readonly ThreadSummary[]>;
  /**
   * The threads spun from any of these Acts, oldest first, in one read (a page asks once, not once
   * per post), at most `limit` rows in all; each names its origin in `originActId`. A result as long
   * as `limit` may be cut, and an Act with none in it may have some.
   */
  spunFromMany(acts: readonly Id[], limit: number): Promise<readonly ThreadSummary[]>;
  /** The card plays on an Act, oldest first, at most `limit`: the effects an ORIGIN box lists under the Act it shows. A result as long as `limit` may be cut. */
  cardsOn(act: Id, limit: number): Promise<readonly Act[]>;
  /**
   * The card plays on any of these Acts, oldest first, in one read (a page of a thread asks once, never once per post), at most
   * `limit` rows in all; each names its post in `targetActId`. A result as long as `limit` may be cut, and a post with none in it
   * may have some.
   */
  cardsOnMany(acts: readonly Id[], limit: number): Promise<readonly Act[]>;
  /**
   * The live plays above a page's posts (effects_above, 0055): on any of these characters, on this thread and on this board, oldest
   * first, in one batched read (a page asks once, however many posts it holds). Each play's Act sits where it was played; its `target`
   * is the character, thread or board it lands on, and it is drawn there until `endsAt`. Public: nothing about who owns a character.
   */
  effectsAbove(characters: readonly Id[], thread: Id | null, board: Id | null): Promise<readonly PlayAbove[]>;
  /** The board's pinned threads (pinned_threads, 0055), newest pin first: one read of the board's live pins, never of its threads. */
  pinnedThreads(board: Id): Promise<readonly PinnedThread[]>;
  /** The state each play's effect has saved (the post's author saves it), by play; a play that has saved none is absent. Any signed-in reader may read it. */
  effectStates(plays: readonly Id[]): Promise<Readonly<Record<Id, EffectState>>>;
  /** Debuted characters with their profiles; an id not among them (waiting, or none) is left out. */
  characters(ids: readonly Id[]): Promise<readonly Character[]>;
  characterCounts(id: Id): Promise<CharacterCounts>;
  /** A page of postbits' counts in one read: each character's posts (kind post, edits not counted), every id asked about, 0 where none or not debuted. */
  characterStats(ids: readonly Id[]): Promise<Readonly<Record<Id, { readonly posts: number }>>>;
  /**
   * A page of a character's public Acts of those kinds, newest first, for its public record and a profile's latest rows.
   * It carries no total: a page is never counted (that would read the character's whole history on every view); a record's
   * totals are `characterCounts` (posts, spins, cards).
   */
  characterActs(id: Id, kinds: readonly ActKind[], page: { readonly offset: number; readonly limit: number }): Promise<readonly Act[]>;
  /** The season reveal posts that name this character (kind reveal, `payload.character`), newest first, at most `limit` (default 50): its past seasons. */
  characterReveals(id: Id, limit?: number): Promise<readonly Act[]>;
  /** Every Act asked about, with an empty tally where none has been left. */
  tallies(acts: readonly Id[]): Promise<Readonly<Record<Id, Tally>>>;
  /** Every thread asked about, 0 where none has been counted yet (the count moves hourly, never live). */
  viewCounts(threads: readonly Id[]): Promise<Readonly<Record<Id, number>>>;
  season(): Promise<Season | null>;
  /**
   * A page of the open season's standings: every debuted character, ranked by standing (ties share a place, and the next
   * place skips), then by name; at most 1,000 rows, empty past the end. The whole season is never read at once, and a
   * page costs the page on the server (one range of an index, never a ranking of the season).
   */
  standingsPage(offset: number, limit: number): Promise<readonly Standing[]>;
  /**
   * The open season's standing of each character asked about, and nothing else: 0 for one with no standings row (a debuted
   * character with nothing settled yet, which is all this is asked about), so a page of postbits reads one row each and
   * never ranks the season.
   */
  standingAmounts(ids: readonly Id[]): Promise<Readonly<Record<Id, number>>>;
  /**
   * One debuted character's standing, its place and how many characters have debuted, or null for one that has not (or none):
   * the profile's "Place 7 of 40", computed on the server by counting index ranges (never by ranking the season) and a counter.
   */
  standingPlace(id: Id): Promise<StandingPlace | null>;
  /** How many characters have debuted, as the standings list them: a counter's one row, never a count of the standings. */
  standingsCount(): Promise<number>;
  /** When the season's standings were last settled: the latest settlement's end. */
  lastSettledAt(): Promise<string | null>;
  classReveals(characters: readonly Id[]): Promise<readonly ClassReveal[]>;
  turnsAnnounced(characters: readonly Id[]): Promise<readonly TurnAnnounced[]>;
  nextSettlementAt(): Promise<string | null>;

  /* The player's own. */
  myCharacters(): Promise<readonly MyCharacter[]>;
  wallet(): Promise<Wallet>;
  myReactions(acts: readonly Id[]): Promise<readonly MyReaction[]>;
  myCards(): Promise<readonly HeldCard[]>;
  /** Which of these plays the player has released themselves from (Stick Around's certification): the player's own rows, never counted or broadcast. */
  myReleases(plays: readonly Id[]): Promise<readonly Id[]>;
  /** The furthest seq read in each thread asked about; a thread never read is absent. */
  reading(threads: readonly Id[]): Promise<Readonly<Record<Id, number>>>;
  /**
   * Never lowers what was read; `through` is the HUD's character, if one is chosen. Says whether it
   * was recorded, never with a refusal's words: a read mark is no action of the player's, and one
   * not recorded (signed out, no answer) is simply sent again with the next position.
   */
  markRead(thread: Id, seq: number, through: Id | null): Promise<boolean>;
  /**
   * One presence poll: marks `through` (the HUD's mask; null for none) present at the place, unless it is hidden or
   * retired, and answers the place's box. A mask arrives on its first poll and leaves only by aging out: a poll
   * through another mask never removes this one. Rejects on a refusal or a lost answer, so the caller counts failures.
   */
  here(place: PresencePlace, through: Id | null): Promise<Presence>;
  /** Hides a mask of the player's from every presence box, or shows it again; answers whether it is now hidden. */
  setPresenceHidden(character: Id, hidden: boolean): Promise<Answer<boolean>>;
  preferences(): Promise<Preferences>;
  setPreferences(p: PreferencesPatch): Promise<Answer<Preferences>>;
  /**
   * Records that the account has met the card kind `card` (its key): added once, however often it is called, and answered with
   * the preferences, the same for any key the server accepts. Refused for a key that is not a card's key or a 65th kind.
   */
  meetCard(card: string): Promise<Answer<Preferences>>;
  /** Empties the set of cards met, so every first-time callout shows again ("Show card tips again" in Settings). */
  forgetCardsMet(): Promise<Answer<Preferences>>;
  /**
   * Marks Alerts as opened at `at` (an ISO time) on the account, and answers the mark as it now stands. Only forward: an older time
   * leaves the mark and answers it, and a time past the server's clock is taken as now.
   */
  seeAlerts(at: string): Promise<Answer<string>>;
  /** Marks the settlement ending at `endsAt` (an ISO time) as seen on the account, as `seeAlerts` does: only forward; answers the mark. */
  seeSettlement(endsAt: string): Promise<Answer<string>>;
  /**
   * Whether the player follows the thread: their own choice, else whether one of their characters started it (`following_thread`).
   * Rejects when it cannot be read or nobody is signed in; it is the player's own fact and appears in no public read.
   */
  following(thread: Id): Promise<boolean>;
  /** Follows the thread (`on` true) or stops following it, and answers the state now. Refused for a thread that does not exist or no one signed in. */
  follow(thread: Id, on: boolean): Promise<Answer<boolean>>;
  /** The threads the player follows that have posts past their place, newest first, at most 50 (`my_followed_threads`). */
  followed(): Promise<readonly FollowedThread[]>;
  /**
   * A page of the player's Alerts (`my_alerts`), newest first: the newest `ALERTS_PAGE` lines older than `before` (an ISO time,
   * exclusive; none for the newest page), and every line sharing the instant of the last, so a later page never repeats one. The
   * next page is read from the oldest `at` of this one. Written alerts, followed threads with new posts and settlements that moved
   * the player's characters; every player's news joins it in the updates and season-news builds. Rejects when it cannot be read.
   */
  alerts(before?: string | null): Promise<readonly Alert[]>;
  /** How many alerts arrived after the account's mark (`my_alerts_unread`), at most `ALERTS_UNREAD_BOUND`; a result at the bound is shown "9+". Rejects when it cannot be read. */
  alertsUnread(): Promise<number>;
  estimate(): Promise<Estimate>;
  /** A page of the player's own log (`Log`): the newest with no cursor, then each older page from the last one's `before`. */
  log(before?: string | null): Promise<Log>;
  invites(): Promise<readonly MyInvite[]>;
  createInvite(): Promise<Answer<{ readonly invite: number; readonly code: string }>>;
  reissueInvite(invite: number): Promise<Answer<{ readonly invite: number; readonly code: string }>>;

  /* Acting, as one of the player's characters. */
  startThread(board: string, character: Id, title: string, body: string): Promise<Answer<{ readonly thread: ThreadSummary; readonly act: Act }>>;
  post(thread: Id, character: Id, body: string, quote: Id | null): Promise<Answer<Act>>;
  edit(post: Id, character: Id, body: string): Promise<Answer<Act>>;
  spin(origin: Id, character: Id, title: string, body: string): Promise<Answer<{ readonly thread: ThreadSummary; readonly act: Act }>>;
  /**
   * Buy a card from the Vending Machine at its base price, from the settled wallet only: the ghost estimate cannot be spent. The
   * price is the card's rules' (`basePrice`), never sent by the screen. Private, and nothing about it is broadcast.
   */
  buyCard(card: string): Promise<Answer<Bought>>;
  /**
   * Play a card the player holds on a post, as one of their characters: the card's own settings (`config`), the caster's message (plain
   * text, at most 200 characters, may be empty), the price its rules decide from the post as it stands. The card's Act comes back.
   * Beyond a post (`reach`), `target` is the character, the thread or the board, and a character play names the post whose postbit
   * took it (`fromPost`); the Act comes back with its reach, its target and its end in its payload (0055_card_reach.sql).
   */
  playCard(card: string, character: Id, target: Id, config: Readonly<Record<string, unknown>>, message: string, reach?: Reach, fromPost?: Id): Promise<Answer<Act>>;
  /**
   * Set a card the player holds face down on a post of the character's own (the card mechanic's design, section 3): its Act, a card
   * back, comes back naming no card. A trap that strikes carries the struck card's settings (`config`), which that card's rules check.
   */
  setCard(card: string, character: Id, target: Id, config: Readonly<Record<string, unknown>>): Promise<Answer<Act>>;
  /** Use a card the player holds on a post of the character's own (a ward), as a play is: its Act comes back, with its end. */
  useCard(card: string, character: Id, target: Id, config: Readonly<Record<string, unknown>>, message: string, reach?: Reach, fromPost?: Id): Promise<Answer<Act>>;
  /** Which card each of the player's own card backs among these sets is (`my_face_down`), by set; another's back is absent. */
  myFaceDown(sets: readonly Id[]): Promise<Readonly<Record<Id, string>>>;
  /** Release the player from a play's effect, for good and on every device; the player's own, and said again it is the same. */
  releaseEffect(play: Id): Promise<Answer<{ readonly play: Id; readonly releasedAt: string }>>;
  /** Save the state of a play's effect, as the character that wrote the post it landed on (no one else may); the card's rules bound what it holds. */
  saveEffect(play: Id, character: Id, state: Readonly<Record<string, unknown>>): Promise<Answer<{ readonly play: Id; readonly savedAt: string }>>;
  react(act: Id, character: Id, kind: string): Promise<Answer<{ readonly act: Id; readonly tally: Tally }>>;
  turn(character: Id, to: string, loudness: 'silent' | 'announced', showFrom: boolean, showTo: boolean): Promise<Answer<TurnAsked>>;
  withdrawTurn(character: Id): Promise<Answer<{ readonly withdrawn: true }>>;
  unmask(character: Id, thread: Id, message: string): Promise<Answer<Act>>;
  createCharacter(name: string, cls: string, timing: DebutTiming, loudness: DebutLoudness): Promise<Answer<CreatedCharacter>>;
  setDebut(character: Id, timing: DebutTiming, loudness: DebutLoudness): Promise<Answer<{ readonly id: Id; readonly waiting: boolean; readonly loudness: DebutLoudness }>>;
  setProfile(character: Id, title: string, signature: string, pipStyle: string): Promise<Answer<Character>>;
  setAvatar(upload: AvatarUpload): Promise<Answer<Character>>;

  /* Live: Acts, tallies and saved effects on a thread; new threads on a board. Each returns its unsubscribe. */
  subscribeThread(thread: Id, listener: ThreadListener): () => void;
  subscribeBoard(board: Id, listener: BoardListener): () => void;
  /** Live: the signed-in player's own alerts (their private channel); nothing while signed out. Returns its unsubscribe. */
  subscribeAccount(listener: AccountListener): () => void;
  /** Live: plays beyond a post, for every page that shows their target (issue 140). Returns its unsubscribe. */
  subscribeReach(listener: ReachListener): () => void;
}
