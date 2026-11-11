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
import type { PronounSet } from '../../rules/pronouns.ts';
import type { BeyondPost, Rarity, Reach, SetConditions } from '../../rules/cards.ts';
import type { AlertKind } from '../../rules/alerts.ts';
import type { Career } from '../../system/career.ts';
import type { RecordKind } from '../profile/record.ts';

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

/* ---------------------------------------------------------------- search ---- */

/** The most matches a search counts: it counts to one past this, so `more` says whether there are others. */
export const SEARCH_COUNT_CAP = 1000;
/** The most posts of one thread a thread-result counts before it says "100+". */
export const SEARCH_MATCHES_CAP = 100;
/** A page of results: 1 to `SEARCH_PER_PAGE_MAX`, `SEARCH_PER_PAGE` when not asked. */
export const SEARCH_PER_PAGE = 20;
export const SEARCH_PER_PAGE_MAX = 50;
/** The most card marks a post result carries. */
export const SEARCH_CARDS_MAX = 8;

export type SearchSort = 'relevance' | 'newest' | 'oldest';

/** The filters of a search (search_posts, search_threads). An empty `q` is every post the other filters leave. */
export interface SearchQuery {
  readonly q: string;
  /** A character; one that has not debuted finds nothing, the answer a random id gets. */
  readonly author: Id | null;
  readonly board: Id | null;
  /** ISO times, inclusive; null for none. */
  readonly fromAt: string | null;
  readonly toAt: string | null;
  readonly titlesOnly: boolean;
  /** Null is the default: relevance with keywords, newest without. */
  readonly sort: SearchSort | null;
  /** Null is `SEARCH_PER_PAGE`. */
  readonly perPage: number | null;
}

/** Where the next page starts: the rank (null for newest and oldest), the time and the Act of the last result shown. */
export interface SearchCursor {
  readonly rank: number | null;
  readonly at: string;
  readonly act: Id;
}

/**
 * A page of results. `count` stops at one past `SEARCH_COUNT_CAP` and `more` says it did (so the line reads "More than 1,000"); for threads `more` is
 * also true when the count read only `searchRankPool` matches and left some, so `count` is "at least"; `pooled` says a
 * relevance search ranked only the newest `searchRankPool` matches; `next` is the cursor of the following page, null on the last. Threads by time read at
 * most `searchRankPool` matches a page, so a page may hold fewer than a page's worth, or none, and still have a `next`: Next goes on from the last match read.
 */
export interface SearchPage<T> {
  readonly count: number;
  readonly more: boolean;
  readonly pooled: boolean;
  readonly results: readonly T[];
  readonly next: SearchCursor | null;
}

/** One post that matched. `snippet` carries `<<` and `>>` around the matched words (`snippetParts`). */
export interface PostHit {
  readonly act: Id;
  readonly thread: Id;
  readonly title: string;
  readonly board: Id;
  readonly boardSlug: string;
  readonly boardName: string;
  readonly seq: number;
  /** The page of the thread the post is on. */
  readonly page: number;
  readonly character: Id | null;
  readonly name: string | null;
  readonly createdAt: string;
  readonly snippet: string;
  /** The keys of the cards live on the post, at most `SEARCH_CARDS_MAX`. */
  readonly cards: readonly string[];
}

/** One thread that matched, once, with its best snippet. `matches` counts its matching posts to `SEARCH_MATCHES_CAP`; `matchesMore` says there were others. */
export interface ThreadHit {
  readonly act: Id;
  readonly thread: Id;
  readonly title: string;
  readonly board: Id;
  readonly boardSlug: string;
  readonly boardName: string;
  readonly seq: number;
  readonly page: number;
  readonly character: Id | null;
  readonly name: string | null;
  readonly createdAt: string;
  readonly snippet: string;
  readonly cards: readonly string[];
  readonly matches: number;
  readonly matchesMore: boolean;
}

/** What suggest may be asked: the groups wanted (all three when omitted), a board to keep to, whether to leave out The System's board, and how many of each (1 to 10, default 5). */
export interface SuggestOptions {
  readonly kinds?: readonly ('threads' | 'characters' | 'boards')[];
  readonly board?: Id | null;
  readonly excludeSystem?: boolean;
  readonly most?: number;
}

export interface Suggestions {
  readonly threads: readonly { readonly id: Id; readonly title: string; readonly board: Id; readonly boardName: string }[];
  readonly characters: readonly { readonly id: Id; readonly name: string }[];
  readonly boards: readonly { readonly id: Id; readonly slug: string; readonly name: string }[];
}

/* ---------------------------------------------------------------- the instance ---- */

/** The instance settings a screen reads (the screen_settings view): none of them a private fact. */
export interface ScreenSettings {
  /** The pronouns a new character starts with (`Settings.pronouns`, the setting `pronouns`): public, as a title is. */
  readonly pronouns: PronounSet;
  readonly postsPerPage: number;
  /** The text search configuration the search index is built in (`searchLanguage`); a screen never needs it but the view holds it. */
  readonly searchLanguage: string;
  /** How many of the newest matches a relevance search ranks (`searchRankPool`): the count line says "ranked among the newest N" from it. */
  readonly searchRankPool: number;
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
   * The economy numbers the cards' rules read, as the server uses them now (0039_card_economy.sql), from the economy row an admin
   * tunes. A card's buy price is not here: it is its slot's (`KayfaApi.machine`). A key it lacks is the compiled economy's (`withCardEconomy`).
   */
  readonly cardEconomy: Readonly<Record<string, number>>;
  /**
   * The instance's economy row as the server holds it now (0073): the numbers a class's words state (the core loop design, section 6,
   * #57), so a description and a line with no numbers of its own say the number an admin has tuned. Settings, none of them a private
   * fact. A key it lacks is the compiled economy's (`economyNow`).
   */
  readonly economy: Readonly<Record<string, number>>;
  /**
   * Every member group's look, the ladder lowest first and then the groups moves confer (`group_kinds`, seeded from `Instance.groups`, 0128): the key a
   * character's `group` names, its name, a #rrggbb color and whether it is drawn striped. Public. The staff rung is a group like any other: a
   * staff character's `group` names it, and its name is the one the postbit's bar, the profile's Group row and the presence chip show.
   */
  readonly groups: readonly { readonly key: string; readonly name: string; /** What the rank bar says, singular; absent where the group has none and the bar says `name`. */ readonly badge?: string; readonly color: string; readonly stripe: boolean; /** True for the ladder's staff rung (`group_kinds.condition` = 'staff'), the group every staff character is in. */ readonly staff: boolean }[];
  /** The alert kinds that toast for a player who has not chosen (`Settings.toastDefaults`). */
  readonly toastDefaults: readonly AlertKind[];
  /** How long a toast stays, in milliseconds, where a world sets it (the boards fixture holds its toasts); absent, the HUD's six seconds. */
  readonly toastMs?: number;
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
  /** That thread's title, for the Last post column. */
  readonly lastTitle: string | null;
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
  /** The thread of the Act a spun thread was spun from, which the ORIGIN box subscribes to. Null when it was not spun, or the Act is in no thread. */
  readonly originThread: Id | null;
  /** Where the origin Act can be found, read with the row. Null when it was not spun, or the Act has no place to show. */
  readonly origin: OriginPlace | null;
}

/** Where an Act a play landed on can be found. */
export type PlaceOn =
  | { readonly kind: 'post'; readonly thread: Id; readonly title: string; readonly seq: number }
  | { readonly kind: 'update'; readonly act: Id; readonly title: string }
  | { readonly kind: 'character'; readonly id: Id; readonly name: string | null }
  | { readonly kind: 'thread'; readonly id: Id; readonly title: string }
  | { readonly kind: 'board'; readonly slug: string; readonly name: string };

/** Where a spun thread's origin can be found: an Act with a place number, an update, or a play and where it landed. */
export type OriginPlace =
  | Extract<PlaceOn, { kind: 'post' | 'update' }>
  /* `card` is the card's key, null for a face-down set. `on` is null when the target cannot be placed. */
  | { readonly kind: 'play'; readonly card: string | null; readonly on: PlaceOn | null };

export type ActKind = 'post' | 'spin' | 'card' | 'edit' | 'tally' | 'reveal' | 'unmask' | 'move' | 'move_end' | 'move_keep' | 'set' | 'take_back' | 'spring' | 'update' | 'card_end' | 'announce'
  /* The Mod Bots' Acts (supabase/migrations/0104 to 0109): meta acts like a card play, none a place in the thread (`seq` null). */
  | 'visit' | 'visit_join' | 'visit_end' | 'report' | 'report_verdict' | 'intercept' | 'infraction' | 'ban' | 'appeal' | 'appeal_ruling';

/** The `field` of the refusal `reportPost` answers at the account's open-report limit (errcode 53400). */
export const REPORT_LIMIT = 'limit';

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
  /**
   * Whether the version this Act shows now (a post's current one, an edit's own) is hidden by an admin (`acts_public.hidden`, 0150): its words are
   * then null in `payload` and `currentPayload`, and the screen draws the hidden note in their place. Absent reads as not hidden. A post's own row
   * says whether its *current* version is hidden; to read whether one version in its History is, the version's `payload.body` is null.
   */
  readonly hidden?: boolean;
  /** Whether any version of this post is hidden (`acts_public.any_hidden`, 0150): the predicate that empties a quote of it, so what a quote's hidden note stands on. Absent reads as no. */
  readonly anyHidden?: boolean;
  /**
   * Set only on a card play whose first generation failed, which is then refunded and over (`acts_public.untaken`, 0149): public, the
   * same for every reader, and nothing of the refund rides with it. A play carrying it is not in force, as one with a `card_end` is not.
   */
  readonly untaken?: true;
}

/**
 * The author's own view of their hidden post (`my_hidden_version`, 0152): `hiddenUntilEdited` carries their own words, which only they can read, so they can edit them; `waiting`
 * is an edit that follows a second hide until edited, which an admin looks at before it shows again; it carries the edit's words too, so Edit can start from them. Null for anyone else and for a version that is not hidden
 * until edited.
 */
export type MyHiddenVersion =
  | { readonly status: 'hiddenUntilEdited'; readonly version: Id; readonly words: string }
  | { readonly status: 'waiting'; readonly version: Id; readonly words: string };

/* ------------------------------------------------------------------------------ a visit (the Mod Bots design, sections 6 and 7) ---- */

/** How heavy a charge is: the warn bar's bands (`Settings.warnBar.bands`). */
export type VisitBand = 'minor' | 'moderate' | 'severe';

/** One charge on a visit: the rule broken (in the glass's plain words, as the rule's catalog says it), its band, and what sent it. */
export interface VisitCharge {
  /** "Rule 2: No double posting", or the premise of a board; null where the visit's Act named none. */
  readonly rule: string | null;
  readonly ruleNumber: number | null;
  readonly band: VisitBand;
  /** What drew the charge: a rule broken, a report, a patrol, a tail (obstruction) or a backfired report. */
  readonly cause: 'rule' | 'report' | 'patrol' | 'tail' | 'backfire';
}

/**
 * What a visit asks of anyone who would talk it down. Never an answer: a quiz carries its question and its choices, a bribe its price
 * (hundredths), a distraction nothing (any card cast on the thread does it).
 */
export type VisitChallenge =
  | { readonly kind: 'quiz'; readonly question: string; readonly choices: readonly string[] }
  | { readonly kind: 'bribe'; readonly price: number }
  | { readonly kind: 'distraction' };

/** How a visit ended: filed (the points landed), intercepted (talked down), trapped (a card's trap sprang) or reversed (an admin). */
export type VisitOutcome = 'filed' | 'intercepted' | 'trapped' | 'reversed';

export interface VisitEnd {
  readonly act: Id;
  readonly at: string;
  readonly outcome: VisitOutcome;
  /** The Act that ended it where one did: the interception, or the spring. */
  readonly byAct: Id | null;
  /** The words the end carries: the Mod's filing line (its own words, which may bluff), or the plain sentence the server wrote. */
  readonly line: string;
}

/** A post's latest visit as the page carries it (thread_page's `visits`). */
export interface Visit {
  readonly id: Id;
  readonly post: Id;
  /** The Mod's character. */
  readonly mod: Id;
  readonly at: string;
  /** When the visit files if nobody talks it down. */
  readonly endsAt: string;
  /** The Mod's arrival line, in its own voice. */
  readonly line: string;
  readonly charges: readonly VisitCharge[];
  readonly challenge: VisitChallenge;
  readonly end: VisitEnd | null;
  /** The ruling of the appeal heard on the infraction it filed (`thread_page`'s visits); absent where none was heard. */
  readonly ruling?: AppealVerdict;
}

/** What a visit's filing put on its author: the infraction Act's own facts. */
export interface VisitInfraction {
  readonly act: Id;
  readonly character: Id;
  readonly points: number;
  readonly band: VisitBand;
  readonly ruleNumber: number | null;
  readonly expiresAt: string;
  readonly at: string;
}

/**
 * How a visit went, from its Acts (read when its Lens tab opens): the report that sent it and the Mod's verdict, each attempt to talk it down,
 * its end, the infraction it filed and the appeal of it with its ruling. Each is an Act as every reader sees it.
 */
export interface VisitStory {
  readonly report: Act | null;
  readonly verdict: Act | null;
  /** Each `intercept` Act of this visit, oldest first. */
  readonly attempts: readonly Act[];
  readonly end: VisitEnd | null;
  readonly infraction: VisitInfraction | null;
  readonly appeal: Act | null;
  readonly ruling: Act | null;
  /** The points on the infraction's character's warn bar now, read with the story (`characters_public`); null with no infraction. */
  readonly warnPoints: number | null;
}

/** What `intercept` answers: the attempt's Act, whether it worked, and the character's tail where it did not. */
export interface InterceptResult {
  readonly act: Id;
  readonly succeeded: boolean;
  readonly tailUntil: string | null;
}

/** The three verdicts a report can draw (`report_verdict`): a visit, dismissed, or a backfire onto the reporter's latest post. */
export type ReportVerdict = 'visit' | 'dismissed' | 'backfire';

/** What a report answers (the staff function's player door): the report's Act, the Mod's verdict and its line (its own words, which may bluff), and the visit it started. */
export interface ReportResult {
  readonly report: Id;
  /** Null where the report was heard and the answer was not carried back: the report is public, and its verdict is in the thread. */
  readonly verdict: ReportVerdict | null;
  readonly line: string;
  readonly visit: Id | null;
}

/** An appeal's four rulings (`appeal_ruling`). */
export type AppealVerdict = 'overturned' | 'upheld' | 'reduced' | 'increased';

/** What an appeal answers: the appeal's Act, the ruling and its line (the hearer's own words), the points it moved, and what came back. */
export interface AppealResult {
  readonly appeal: Id;
  readonly verdict: AppealVerdict | null;
  readonly line: string;
  readonly pointsDelta: number;
  /** Hundredths that went back (an overturned appeal); 0 otherwise. */
  readonly refunded: number;
}

/** The state a card's effect has saved on one play, and when: what every reader loads, the post author's version. */
export interface EffectState {
  readonly state: unknown;
  readonly savedAt: string;
}

/**
 * One row of a post's tails (`post_tails`, supabase/migrations/0149_card_writes.sql): what a writing card's play made for one version of its post.
 * Every row of every writing play on the post, in version order then play order, and the same for every reader: `text` is the generated words
 * (null where `failed`, and where `waiting`); `failed` is a flag and never the predicate; `waiting` is a job queued for a version that has no
 * row yet (`createdAt` null). The version is the post's own Act or an edit of it.
 */
export interface Tail {
  readonly post: Id;
  readonly play: Id;
  readonly version: Id;
  readonly text: string | null;
  readonly failed: boolean;
  readonly waiting: boolean;
  readonly createdAt: string | null;
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
  /** Its pronouns (character_profiles.pronouns, public like a title): copy about this one character is written with them. A character with no profile row has the engine's it/its. */
  readonly pronouns: PronounSet;
  /** The first day of the month it debuted, "2026-10-01": the month and never the time ("Joined Oct 2026"). */
  readonly joined: string;
  /** Set only for a staff character (a persona or the developer): the instance's key for it. A staff member is known to be staff, signed in or not. */
  readonly staff?: string;
  /** The office a staff character holds now (characters_public). The Boss is shown ADMINISTRATOR and a Mod Bot MODERATOR; a member or a benched persona has no badge, and neither has the developer persona (the Updates page's author). Set with `staff`. */
  readonly office?: Office;
  /** The key of the group it is in now (characters_public's `group`, 0128): the look is in `ScreenSettings.groups`. */
  readonly group: string;
  /** The points on its warn bar now (characters_public, carried by a thread's page); absent when it has none. */
  readonly warnPoints?: number;
  /** When its ban ends (characters_public, carried by a thread's page); absent when it is not banned. A ban holds only this character, and ends by itself at that time. */
  readonly bannedUntil?: string;
}

/** An office a staff character holds (0082). `waiting` is never shown on a character (a persona that has not debuted is in no public list); `developer` is the developer persona's, which holds no office. */
export type Office = 'boss' | 'mod' | 'member' | 'benched' | 'waiting' | 'developer';

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

/** An announced Turn (turns_announced); `was` only when the Turn named its old class, as of the Turn and never since when (#23). */
export interface TurnAnnounced {
  readonly act: Id;
  readonly character: Id;
  readonly at: string;
  readonly was: string | null;
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
  /** The office its staff character held when it landed (`payload.office`, stamped by `write_staff_act`, 0137); absent on a move from before the stamp, which is read as the Boss's. */
  readonly office?: 'boss' | 'mod';
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

/** A board a character is barred from posting on (`bars_now`, carried by `my_characters.bars`): the move that bars it, the group that move put it in, and when the bar ends if nothing ends it sooner (null: no end is set). */
export interface Bar {
  readonly board: Id;
  readonly move: Id;
  readonly group: string;
  readonly expiresAt: string | null;
}

/** One apology a character wrote to a move (`my_apologies`): `pending` until the move's staff member rules, then `accepted` or `rejected`; `returned` when the judgment failed and the next may be written at once. */
export interface Apology {
  readonly move: Id;
  readonly state: 'pending' | 'accepted' | 'rejected' | 'returned';
  readonly at: string;
  /** When the next apology to this move may be written (an ISO time); null for a returned one. */
  readonly nextAt: string | null;
}

/** The most reactions a move's notice shows. */
export const NOTICE_REACTIONS = 3;

/** How a landed move ended (moves_log). */
export interface MoveEnd {
  readonly why: 'met' | 'expired' | 'reversed' | 'superseded' | 'spent' | 'unmet' | 'overturned';
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
  /**
   * For a Mod's visit, a report it judged or an appeal it heard (`kind` 'visit', 'report' or 'appeal', whose `params` say the post's number and the plain facts): how it
   * ended (a visit's outcome, a report's verdict, an appeal's ruling), null while a visit is open. Absent on a move.
   */
  readonly outcome?: string | null;
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
  /** The Boss's pronouns, beside its name (admin_queue); the engine's it/its where no character holds the name. */
  readonly bossPronouns: PronounSet;
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
  /** The words an admin has put in the place of the rename's description (`replace_queued_description`, 0101); null when none did. The Boss's own stay in `params`. */
  readonly adminDescription: string | null;
}

/** A landed move with no end yet (admin_queue). */
export interface MoveInForce {
  readonly act: Id;
  readonly id: number | null;
  readonly staff: string | null;
  readonly boss: string | null;
  readonly bossPronouns: PronounSet;
  readonly kind: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly demand: Demand | null;
  readonly why: string | null;
  readonly landedAt: string;
  readonly expiresAt: string | null;
  readonly progress: DemandProgress;
}

/** A move that ended, or was held or refused and never landed, in the last 30 days (admin_queue). */
export interface MoveEnded {
  readonly how: 'met' | 'expired' | 'reversed' | 'superseded' | 'spent' | 'overturned' | 'held' | 'refused';
  readonly by: string | null;
  readonly at: string;
  /** Null for a held move, which was never an Act. */
  readonly act: Id | null;
  readonly id: number | null;
  readonly staff: string | null;
  readonly boss: string | null;
  readonly bossPronouns: PronounSet;
  readonly kind: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly demand: Demand | null;
  readonly why: string | null;
  readonly landedAt: string | null;
  /** A card an admin ended (admin_queue): the card's name; its caster's name is `boss`. Absent on a move. */
  readonly card?: string | null;
  /** For a rule refused when it came to land (`how: 'refused'`): the server's reason, in its words. */
  readonly reason?: string | null;
}

/** A face-up play of a staff character, still in force (admin_queue's `staffCards`), for an admin to end. */
export interface StaffCardPlay {
  readonly play: Id;
  readonly card: string;
  readonly cardName: string;
  readonly staff: string;
  readonly persona: string;
  /** The target's public name: the post's author, or the character, thread or board the play named. */
  readonly targetName: string | null;
  readonly thread: Id;
  readonly threadTitle: string | null;
  readonly at: string;
}

/**
 * A handover that changed the Boss and has no announcement yet (admin_queue's `todos`; the staff roster design, section 11). It clears when an
 * update is posted after `landedAt`, or when an admin dismisses it. `season` is the new season's number. Offices are the office log's words
 * (`boss`, `mod`, `member`, `benched`, `waiting`); `bossWas` is the new Boss's office before it took the seat, null where it held none.
 */
export interface HandoverTodo {
  readonly season: number;
  readonly boss: string;
  readonly bossName: string;
  readonly bossPronouns: PronounSet;
  readonly bossWas: string | null;
  readonly outgoing: string | null;
  readonly outgoingName: string | null;
  /** The outgoing Boss's pronouns; the engine's it/its where there is none. */
  readonly outgoingPronouns: PronounSet;
  readonly outgoingOffice: string | null;
  /** How the new Boss was chosen: `nomination` or `rotation`. */
  readonly how: string;
  readonly landedAt: string;
}

/** What the admin screen shows. Each group holds at most `cap` rows; `more` says a group was cut. */
export interface AdminQueue {
  readonly cap: number;
  readonly waiting: readonly QueuedMove[];
  readonly inForce: readonly MoveInForce[];
  readonly ended: readonly MoveEnded[];
  /** The Mod Bots' cards in force from the last 30 days, newest first. */
  readonly staffCards: readonly StaffCardPlay[];
  /** The handovers still waiting for an announcement, newest first. */
  readonly todos: readonly HandoverTodo[];
  readonly more: { readonly waiting: boolean; readonly inForce: boolean; readonly staffCards: boolean; readonly ended: boolean };
  /** The Bosses a waiting nomination can be replaced with: on the roster, not retired, debuted; in the rotation's order. */
  readonly roster: readonly { readonly staff: string; readonly name: string; readonly pronouns: PronounSet }[];
}

/* ---------------------------------------------------------- the player's own ---- */

export interface Session {
  readonly signedIn: boolean;
  /** The account, once one is open; null while signed in with none (an invite is needed). */
  readonly account: Id | null;
  /**
   * The account's own bar (my_bar): null when it has none; `until` is the end of a suspension, null for a ban. Read for a signed-in account
   * only, so signed out it is null. A screen treats a suspension whose `until` has passed as no bar, since the server ends it by itself.
   */
  readonly bar: { readonly until: string | null } | null;
  /** Whether the account has accepted the current code of conduct (conduct_accepted); true while signed out, where nothing is asked. */
  readonly conductAccepted: boolean;
}

/** One of the player's own characters (my_characters): seen by its player alone. */
export interface MyCharacter {
  readonly id: Id;
  readonly name: string;
  /** Its pronouns, as a profile shows them to everyone (its player's own choice; the screens that speak about it use them). */
  readonly pronouns: PronounSet;
  /** Its class now: shown to its player as "only you". */
  readonly class: string;
  readonly classSince: string;
  /** When its current class was made public (a reveal, a debut with its class, or a Turn announced with it); null while only its player knows it. */
  readonly classShownAt: string | null;
  /**
   * The settlement end its latest Turn was due at, where a reveal made after that window had ended made the Turn wait for the
   * next settlement (0074_settle_claim.sql); null where it took effect when due, or its class is its first.
   */
  readonly classDueAt: string | null;
  /** When it may next Turn; null when it may now. */
  readonly turnOpensAt: string | null;
  /** Null while it waits to debut at the next tally. */
  readonly debutedAt: string | null;
  readonly debutLoudness: 'silent' | 'announced' | 'with_class' | null;
  readonly retiredAt: string | null;
  readonly pendingTurn: PendingTurn | null;
  /** Hidden from "Who is online" and "Users browsing": listed nowhere, its player's switch in My characters. */
  readonly presenceHidden: boolean;
  /** When its ban ends (`my_characters.banned_until`, a public fact about it); absent while it is not banned. The composer says so; it ends by itself at that time. */
  readonly bannedUntil?: string;
  /** The boards it is barred from posting on (`my_characters.bars`, from `bars_now`, a public fact about it); absent while it is barred from none. The composer and New thread say so, and each bar ends by itself at its time. */
  readonly bars?: readonly Bar[];
}

/** Where a presence box is: a thread, a board (its page and every thread on it) or the index ("Who is online"). */
export type PresencePlace = { readonly kind: 'thread'; readonly thread: Id } | { readonly kind: 'board'; readonly board: Id } | { readonly kind: 'index' };

/**
 * Who is browsing a place (0041_presence.sql): the characters present within the window, longest present first, at
 * most the instance's presenceNames of them, and how many more. Names and a count of characters only: never an
 * account, and nothing that says which are the caller's.
 */
export interface Presence {
  /** Each name is a character's. `staff` is a public fact (a staff key shows to a visitor); a staff name is listed after its own post there, or while it has an open visit in the thread, whose post's number is `visitPost` (a visit is a public Act). */
  readonly names: readonly { readonly id: Id; readonly name: string; readonly staff: boolean; /** The key of the group it is in now (group_now, 0128): a staff name's chip is that group's name. */ readonly group?: string; readonly visitPost?: number }[];
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
  /** Which theme: "default" (the instance's first theme, so the engine names none) or a theme's key. */
  readonly theme: string;
  /** Light or dark, or the device's. A theme with one mode fixes it whatever this says, and this stays stored for the theme that holds both. */
  readonly mode: 'system' | 'light' | 'dark';
  readonly postbit: 'side' | 'stacked';
  readonly motion: 'system' | 'reduce' | 'full' | 'snappy';
  /** How much smoke stands behind the glass: all of it, a third of each layer, or none (plain ground). */
  readonly smoke: 'full' | 'low' | 'off';
  /** High puts solid ground under every line of glass text and switches the glass to its `high` key. */
  readonly contrast: 'standard' | 'high';
  /** The text's size for the board and the glass together, in percent; from 150 up the glass is one column. */
  readonly textSize: 100 | 125 | 150 | 200;
  /** Whether a card or avatar tilts toward the pointer; off until the player turns it on. */
  readonly tilt: 'off' | 'on';
  /** Whether card effects use their full colors even below the usual contrast standard; standard until the player turns it on. */
  readonly effects: 'standard' | 'bright';
  /**
   * The card kinds (their keys) this account has met: a kind's first mark on a page shows its callout until the kind is in this
   * set. Changed only by `meetCard` and `restoreTips`, never by `setPreferences`; at most 64, read by its own account alone.
   */
  readonly cardsMet: readonly string[];
  /**
   * When the account last opened Alerts (an ISO time), or null if it never has: what arrived after it is new, on every device. Changed
   * only by `seeAlerts`, only forward; read by its own account alone.
   */
  readonly alertsSeenAt: string | null;
  /** The end (an ISO time) of the last settlement whose summary the account has seen, or null. Changed only by `seeSettlement`, only forward. */
  readonly settlementSeen: string | null;
  /**
   * The alert kinds the player keeps on toast (Settings › Notifications), exactly those; an empty list is a choice (nothing toasts). Null means
   * they never chose, and the instance's `toastDefaults` hold. Changed by `setPreferences` (null there puts it back); read by its own account alone.
   */
  readonly toasts: readonly AlertKind[] | null;
  /** When the account saw the welcome (an ISO time), or null if it has not. Changed only by `seeWelcome`, once; read by its own account alone. */
  readonly welcomedAt: string | null;
  /** Whether the tips show ("on") or the player skipped them ("off"). Changed by `skipTips`, `resumeTips`, `restoreTips` and `replayTour` alone. */
  readonly tips: 'on' | 'off';
  /** The tips (their keys) the account has seen, each shown once; at most 64. Changed by `seeTip`, `restoreTips` and `replayTour` alone. */
  readonly tipsSeen: readonly string[];
}

/**
 * What `setPreferences` takes: the choices a player makes in Settings, not the set of cards met (`meetCard`, `restoreTips`), the two marks, or the welcome and tips (their own calls).
 * A `toasts` of null puts the choice back to the instance's defaults; a key left out leaves the choice as it is.
 */
export type PreferencesPatch = Partial<Omit<Preferences, 'cardsMet' | 'alertsSeenAt' | 'settlementSeen' | 'welcomedAt' | 'tips' | 'tipsSeen'>>;

/** What an account's preferences are before it has set any (account_preferences' defaults). */
export const DEFAULT_PREFERENCES: Preferences = { theme: 'default', mode: 'system', postbit: 'side', motion: 'system', smoke: 'full', contrast: 'standard', textSize: 100, tilt: 'off', effects: 'standard', cardsMet: [], alertsSeenAt: null, settlementSeen: null, toasts: null, welcomedAt: null, tips: 'on', tipsSeen: [] };

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

/**
 * One slot of the Vending Machine as every player sees it (`machine_now`, 0139_machine.sql): its place in the grid, what it sells,
 * whether it is for sale, and the price now, in hundredths. A hidden slot is not here, unless a flash sale has opened it. `move` is the Boss's
 * move in force on it (0140_machine_moves.sql), already applied to `availability` and `price`; null where it has none.
 */
export interface Slot {
  readonly id: Id;
  readonly position: number;
  readonly item: { readonly card: string } | { readonly pack: string };
  /** A card's rarity; null for a pack. */
  readonly rarity: Rarity | null;
  readonly availability: 'onSale' | 'soldOut';
  readonly price: number;
  readonly move: SlotMove | null;
}

/**
 * The Boss's move on a slot, as `machine_now` carries it: what a player's screen needs to say plainly what happened and how it ends. The words come from the
 * engine's catalogs by `kind` (engine/system/moves.ts) and `demand` (engine/system/demands.ts, with `progress`), never from the Boss's text. The slot's
 * `availability` and `price` already have the move in them; `was` is the admin's price, which a Reprice moves and a screen strikes through.
 */
export interface SlotMove {
  readonly kind: 'pullSlot' | 'repriceSlot' | 'flashSale';
  /** The move's Act. */
  readonly act: Id;
  /** When it ends on its own (ISO 8601); every machine move has an expiry. */
  readonly ends: string | null;
  /** The demand that ends it early, for a Pull and a markup; null for a markdown and a flash sale, which carry none. */
  readonly demand: Demand | null;
  /** The tick's stored count of that demand; null where there is no demand. */
  readonly progress: DemandProgress | null;
  /** The admin's price, in hundredths. */
  readonly was: number;
  /** A Reprice's percent of `was`; null for the other two. */
  readonly percent: number | null;
  /** A flash sale's window in hours; null for the other two. */
  readonly hours: number | null;
}

/**
 * A slot as an admin reads it (`admin_machine`, 0141_machine_admin.sql): every slot, a hidden one too, at the admin's own availability and price (the Boss's move
 * over it is beside them, never folded in). `move` is the Boss's machine move in force on it, enough to name it and to find it in the queue.
 */
export interface AdminSlot {
  readonly id: Id;
  readonly position: number;
  readonly item: { readonly card: string } | { readonly pack: string };
  /** A card's rarity; null for a pack. */
  readonly rarity: Slot['rarity'];
  readonly availability: 'onSale' | 'soldOut' | 'hidden';
  /** The admin's price, in hundredths of an orb. */
  readonly price: number;
  readonly move: Pick<SlotMove, 'kind' | 'act' | 'ends' | 'percent' | 'hours'> | null;
}

/** A pack opened: its id, the cards it gave in pull order, and the settled wallet after it (`buy_pack`'s answer). */
export interface Opened {
  readonly pack: Id;
  readonly contents: readonly string[];
  readonly balance: number;
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
  /** The numbers its reason's words state, as it was settled under them (`ledger.params`, 0073); absent on a row with none. */
  readonly params?: LedgerParams;
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

/** A change to the player's wallet (`my_wallet_events`): a settlement's credit with what the cap and the floor cut off, a purchase, a play, a trap's payout, and The System's payout for a staff card a trap caught. */
export interface WalletEvent {
  readonly settlement: number | null;
  /* `report`, `refund`, `appeal` and `bribe` are the Mod Bots' (0107 to 0109): a report's or an appeal's price (its `ref` the Act), the price going back, and a bribe that talked a visit down (its `ref` the interception). `grant` is an admin's (0146): Aura given by the instance's operator, `ref` null. */
  readonly kind: 'settlement' | 'purchase' | 'play' | 'trap' | 'trapSystem' | 'report' | 'refund' | 'appeal' | 'bribe' | 'grant';
  readonly change: number;
  /** What the cap held back of a settlement's credit. */
  readonly overflow: number;
  /** What the floor held back of a settlement's debit. */
  readonly floored: number;
  readonly balanceAfter: number;
  /** A play's Act, or a trap's spring for its payout; null for a settlement, a purchase and a grant. */
  readonly ref: Id | null;
  readonly at: string;
}

/**
 * A card the player bought, pulled from a pack, played or caught (`my_card_ledger`), with its price: a play that cost nothing is here and has no
 * wallet event, and a pulled card costs nothing, since its pack holds the price (`PackEvent`).
 */
export interface CardEvent {
  readonly card: string;
  /** `caught`: a card a catching set card of the player's took (0142); its `act` is the spring, and it cost nothing. */
  /**
   * `returned`: a card back in the hand. A face-down card taken back (0148; its `act` is the take-back) or whose time passed unsprung (no
   * `act`), or a play whose old voice did not answer, so its price went back and its card with it (0149; its `act` is the play).
   */
  readonly kind: 'bought' | 'played' | 'pulled' | 'caught' | 'returned';
  /** The play's Act, or the spring for a caught card; null for a purchase and a pulled card. */
  readonly act: Id | null;
  /** The pack a pulled card came from; absent on any other row. */
  readonly pack?: Id;
  /** For a purchase: true when the Boss had moved the price it was bought at. Absent otherwise, and on any other row. */
  readonly repriced?: boolean;
  readonly price: number;
  readonly at: string;
  /** For a card the player set face down, whether it carries a trap: false for a card with no trap, which never springs. Absent on any other row. */
  readonly springs?: boolean;
  /** For a card the player set face down, the card a catching set card waits to catch (`my_face_down.catches`, the setter's own row), where it was read. */
  readonly catches?: string;
  /** For a Move the player set face down, the phrase the quote must hold for it to land (`my_face_down.phrase`), where it was read. */
  readonly phrase?: string;
  /** For a Move set face down, the passage the quoted excerpt must hold (`my_face_down.passage`, the setter's own row), where it was read. */
  readonly passage?: string;
  /** For a Move set face down, the characters (ids) its Who names (`my_face_down.who`), where it was read; `whoExcept` says whether the quoter must be none of them. */
  readonly who?: readonly Id[];
  readonly whoExcept?: boolean;
}

/** A pack the player bought (`my_packs`): its kind, its price, whether the Boss had moved that price, and the cards it gave in pull order. */
export interface PackEvent {
  readonly pack: Id;
  /** The pack kind's key, which `InstanceUi.packs` names. */
  readonly kind: string;
  readonly price: number;
  readonly repriced: boolean;
  readonly contents: readonly string[];
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
/** One line of an update's plain "What changed" list: a bold label (it may be empty) and the words after it. */
export interface UpdateChange {
  readonly label: string;
  readonly text: string;
}

/**
 * One update, a post of the instance's developer persona (`updates`, supabase/migrations/0062_updates.sql), with the persona that wrote it.
 * Public: it says nothing that depends on who reads. `avatar` is an asset key the instance's UI turns into a picture (null: none).
 * `act` is the Act to react to and to spin a thread from; `thread` is the updates thread's id, which the board never lists.
 */
export interface Update {
  readonly act: Id;
  readonly thread: Id;
  readonly character: Id;
  readonly name: string;
  readonly tagline: string;
  /** The persona's pronouns (updates_read); the engine's it/its where its profile has none. */
  readonly pronouns: PronounSet;
  readonly avatar: string | null;
  readonly title: string;
  readonly body: string;
  readonly changes: readonly UpdateChange[];
  readonly at: string;
  readonly seq: number;
}
/** A page of Updates holds at most this many. */
export const UPDATES_PAGE = 20;

/**
 * One way to reach an instance's admins (the setting `adminContact`, supabase/migrations/0081_admin_contact.sql): a label and an address,
 * which is `https:` or `mailto:`. An admin writes the list in the running instance; it names no account and is the same for every reader.
 */
export interface ContactLink {
  readonly label: string;
  readonly href: string;
}
/** The contact holds at most this many links; a label is at most `CONTACT_LABEL_MAX` characters and an address `CONTACT_HREF_MAX` (0081). */
export const CONTACT_MOST = 5;
export const CONTACT_LABEL_MAX = 40;
export const CONTACT_HREF_MAX = 300;
/**
 * The one whitespace-or-control set a contact link is trimmed of and an address may not hold, as a regex character-class body. The SQL
 * (0081) writes the same set, locale-free: ASCII controls and space, the C1 controls (U+0085 too), U+00A0, U+1680, U+2000-U+200A, U+2028,
 * U+2029, U+202F, U+205F, U+3000, U+FEFF.
 */
export const CONTACT_WS = '\\x00-\\x20\\x7f-\\x9f\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff';

/** What a player made public of a character's class in a season (the reveal's `shown`): its reveals and its announced Turns, in order. */
export interface SeasonShown {
  readonly kind: 'reveal' | 'turn';
  readonly act: Id;
  readonly at: string;
  /** A reveal: the class it named. */
  readonly class: string | null;
  /** A Turn announced with its old class: the class it left. */
  readonly was: string | null;
}
/** One of the season's top three (the reveal's Acts), with its final place and standing. Public; the server marks no one's own. */
export interface SeasonResult {
  readonly character: Id;
  readonly name: string;
  readonly place: number;
  readonly standing: number;
  readonly shown: readonly SeasonShown[];
}
/** A finished season (`finished_seasons`, 0099): one whose results have landed, with the number of characters its final table ranks. */
export interface SeasonFinished {
  readonly number: number;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly resultsAt: string;
  readonly characters: number;
}
/** One row of a finished season's final table (`results_page`, 0099): the name as it was then, the place, the standing and what the player made public. */
export interface SeasonResultRow {
  readonly character: Id;
  readonly name: string;
  readonly place: number;
  readonly standing: number;
  readonly shown: readonly SeasonShown[];
}
/** One of a character's past seasons (`profile_page` and `record_page`, 0099): where it finished, and when the results landed. */
export interface SeasonRecordRow {
  readonly season: number;
  readonly place: number;
  readonly standing: number;
  readonly at: string;
}
/** A name a tally Act holds: a debut, or a Turn (with the class it left where its player announced that, and the class it took where announced). */
export interface TallyName {
  readonly character: Id;
  readonly name: string;
  readonly class: string | null;
  readonly was: string | null;
}
export type SeasonNewsKind = 'results' | 'tally' | 'bossArrived' | 'bossLeft';
/**
 * One item of season news (`season_news`, supabase/migrations/0063_season_news.sql, 0099, 0100): public, and the same for every reader. `act`, `thread` and
 * `seq` name the Act to link (a landing's first announce Act, or the Boss's post, which is null where the instance wrote no line for it). A `results`
 * item has none of the three: a season's results are rows, not an Act, and the item opens the glass's Rankings of its season.
 * `results` carries the top three and `count`, the characters ranked; `tally` (a landing of announcements, or an old tally Act) its debuts and Turns,
 * at most 20 names with `count` the whole; a Boss row its `name` and the `quote` of its post.
 */
export interface SeasonNewsItem {
  readonly kind: SeasonNewsKind;
  readonly act: Id | null;
  readonly thread: Id | null;
  readonly seq: number | null;
  readonly at: string;
  readonly season: number;
  readonly name: string | null;
  readonly quote: string | null;
  readonly count: number | null;
  readonly top: readonly SeasonResult[];
  readonly debuts: readonly TallyName[];
  readonly turns: readonly TallyName[];
}
/** A page of season news holds at least this many (more only to keep the items of one instant together). */
export const SEASON_NEWS_PAGE = 20;

/** A page of the Alerts is at least this many lines (more only to keep lines that share an instant together). */
export const ALERTS_PAGE = 30;
/** The count `alertsUnread` stops at: a result at the bound means that many or more, and a screen says "9+". */
export const ALERTS_UNREAD_BOUND = 10;

/**
 * A text or a failure a card that writes made for a post the player's character wrote (`my_posts_written_on`, 0149): the play, the post it is on, the
 * version of the post it was made for, whether the generation failed, whether it comes before any text of the play (`opening`: a text that is the
 * play's first continued the post; a later text was made again for an edit), whether it is the failure that ended the play (`over`: refunded, and
 * no row after it; a failure the play survived, or one after a text, is no line), and when. Public facts and the post's author alone.
 */
export interface WrittenOnMine {
  readonly play: Id;
  readonly post: Id;
  readonly version: Id;
  readonly failed: boolean;
  readonly opening: boolean;
  readonly over: boolean;
  readonly at: string;
}

/** When the effect of a play on one of the player's posts was last saved: the post's author's save, which may wash it clean. */
export interface EffectSaved {
  readonly play: Id;
  readonly post: Id;
  readonly savedAt: string;
}

/** The numbers a settled line's reason states, and for a card's boost (`card.boost`) the key of the card, as a string. */
export type LedgerParams = Readonly<Record<string, number | string>>;

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
  /** How it ended: it sprang, its setter took it back (a `take_back` Act), or its time passed (`my_face_down.ended_by`). */
  readonly endedBy: 'sprung' | 'taken back' | 'time';
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
 * A card play an admin ended (`my_cards_ended`, 0092): on a play the player's character cast (`cast`), or on a post, character or
 * thread of the player's it landed on (`onMine`). The names are public ones; a post is named by its author, and its own `targetName`
 * is null.
 */
export interface CardEnded {
  readonly cardEnd: Id;
  readonly play: Id;
  readonly card: string;
  readonly at: string;
  readonly side: 'cast' | 'onMine';
  readonly reach: 'post' | 'character' | 'thread' | 'board';
  readonly targetName: string | null;
  readonly postAuthorName: string | null;
  readonly casterName: string | null;
  /** The player's own character the row is about: the caster on `cast`; on `onMine` the post's author, the character played on, or the thread's starter. */
  readonly character: Id;
}

/** An infraction filed against one of the player's characters: the Act, what it was for, its points, when they drop off and what has taken some off. */
export interface LogInfraction {
  readonly infraction: Id;
  readonly character: Id;
  readonly at: string;
  readonly band: VisitBand;
  readonly points: number;
  readonly ruleNumber: number | null;
  /** The rule in the glass's words ("Rule 2: No double posting"). */
  readonly rule: string | null;
  /** The Mod that filed it. */
  readonly mod: string | null;
  readonly post: Id;
  readonly postSeq: number | null;
  readonly thread: Id;
  readonly expiresAt: string;
  /** The points an appeal took off. */
  readonly relief: number;
  /** When a ban emptied the bar, so these points stopped counting before their time; null where none did. */
  readonly emptiedAt: string | null;
}

/** A ban on one of the player's characters. */
export interface LogBan {
  readonly ban: Id;
  readonly character: Id;
  readonly at: string;
  readonly days: number;
  /** When it ends now: an appeal's ruling read in place of its own end. */
  readonly until: string;
  readonly infraction: Id;
  readonly rule: string | null;
  readonly thread: Id;
}

/** A ban running on one of the player's characters: its Act (what an appeal names), when it ends, how long it was and the rule that filled the bar. */
export interface MyBan {
  readonly ban: Id;
  readonly character: Id;
  readonly until: string;
  readonly days: number;
  readonly rule: string | null;
}

/** How a group move ended (`move_end`): its demand met, its expiry, an admin's reversal, a favor not met at its check, an appeal overturning it, or the handover. */
export type GroupMoveEndWhy = 'met' | 'expired' | 'reversed' | 'unmet' | 'overturned' | 'superseded' | 'spent';

/**
 * A staff member moving one of the player's characters into a group (`my_group_moves`, 0134), with how it ended and the appeal's ruling on it. Every field is a public fact about
 * the character's own move; none names another member of a group.
 */
export interface LogGroupMove {
  readonly move: Id;
  readonly character: Id;
  readonly at: string;
  /** The announcements thread the move was made in, and its place there: what the line links to. */
  readonly thread: Id;
  readonly seq: number | null;
  /** The group's key (its name is the instance's content). */
  readonly group: string;
  readonly board: Id | null;
  readonly boardName: string | null;
  /** When it ends now (`move_expires_at`: an appeal's ruling read in place of the move's own end); null for a move with no end of its own. */
  readonly expiresAt: string | null;
  /** The end the move's own Act set when it landed; the line that says it landed names this one, and the ruling's line carries any change. */
  readonly landedUntil: string | null;
  /** A favor's check: it stays if the demand is met by then. */
  readonly checkAt: string | null;
  readonly demand: string | null;
  /** The office the move landed under (its stamp, 0137), for the role word ("The Boss", "A Mod"); the hearer of its appeal is the same staff member. */
  readonly office: Office | null;
  readonly endedWhy: GroupMoveEndWhy | null;
  readonly endedBy: string | null;
  readonly endedAt: string | null;
  readonly ruling: AppealVerdict | null;
  readonly ruledAt: string | null;
  /** The end an appeal's ruling set. */
  readonly ruledUntil: string | null;
}

/** A report one of the player's characters made. */
export interface LogReport {
  readonly report: Id;
  readonly character: Id;
  readonly at: string;
  readonly post: Id;
  readonly postSeq: number | null;
  readonly thread: Id;
  /** Null until it is heard. */
  readonly verdict: ReportVerdict | null;
  readonly verdictAt: string | null;
  readonly mod: string | null;
  /** Why its price went back, where it did. */
  readonly refund: 'failed' | 'stale' | null;
}

/** An appeal one of the player's characters made. */
export interface LogAppeal {
  readonly appeal: Id;
  readonly character: Id;
  readonly at: string;
  readonly punishment: Id;
  /** What was appealed: warn points, a ban, or a group move that punishes (`my_appeals.punishment_kind`; a move has no post number). */
  readonly punishmentKind: 'infraction' | 'ban' | 'move';
  readonly postSeq: number | null;
  readonly thread: Id;
  readonly verdict: AppealVerdict | null;
  readonly ruledAt: string | null;
  readonly pointsDelta: number | null;
  readonly hearer: string | null;
  readonly refund: 'failed' | 'stale' | 'expired' | null;
}

/**
 * A page of the player's own log, newest first: everything at or before the page's cursor and after
 * `before`, which is where the next page starts (null at the log's start). Each source is read a page
 * at a time, so a long-played account reads a page and never its history.
 */
export interface Log {
  /** The warn points the player's characters were given, by when each landed (`my_infractions`). */
  readonly infractions: readonly LogInfraction[];
  /** The bans laid on the player's characters, by when each began (`my_bans`). */
  readonly bans: readonly LogBan[];
  /** The staff moves of the player's characters into groups, by when each landed (`my_group_moves`). */
  readonly groupMoves: readonly LogGroupMove[];
  /** The reports the player's characters made, by when each was made (`my_reports`). */
  readonly reports: readonly LogReport[];
  /** The appeals the player's characters made, by when each was made (`my_appeals`). */
  readonly appeals: readonly LogAppeal[];
  readonly settlements: readonly LogSettlement[];
  readonly wallet: readonly WalletEvent[];
  readonly cards: readonly CardEvent[];
  /** The packs the player bought, by when each was bought. */
  readonly packs: readonly PackEvent[];
  readonly playsOnMine: readonly PlayOnMine[];
  /** The texts and failures of cards that write on the player's posts, by when each was made (`my_posts_written_on`). */
  readonly writes: readonly WrittenOnMine[];
  readonly saves: readonly EffectSaved[];
  /** The player's cards set face down that sprang or ended, by when. */
  readonly setEnds: readonly FaceDownEnd[];
  /** The player's plays a trap caught, by when each was played. */
  readonly caught: readonly CaughtPlay[];
  /** The card plays an admin ended that the player cast or that landed on theirs, by when each was ended. */
  readonly ended: readonly CardEnded[];
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
  /** A writing play made a tail (`card_text`): the play and the version of its post and nothing else. Read the post's tails again. */
  readonly onText?: (play: Id, version: Id) => void;
}

export interface BoardListener {
  readonly onThread?: (thread: { readonly id: Id; readonly board: Id; readonly title: string; readonly originActId: Id | null; readonly createdAt: string }) => void;
}

/** An alert as the private channel announces it (`account:<id>`, supabase/migrations/0058_alerts.sql): the public projection, with no caster, reactor, account or class. */
export type LiveAlert = Pick<Alert, 'kind' | 'sub' | 'act' | 'character' | 'at'> & {
  /** The alert's own id (`alerts.id`, a uuid), so a client that hears one twice, or hears it and reads the list, can tell it is the same. */
  readonly id: string;
};

/**
 * News for everyone as the `reach` topic announces it (`news`, supabase/migrations/0063_season_news.sql): an update or an item of season news as it lands. Public, and the same for every
 * listener; no account, no character of a player's. It has no id of its own: its kind, sub, Act and time are its identity, so one heard twice is one.
 */
export type LiveNews = Pick<Alert, 'kind' | 'sub' | 'act' | 'at'>;

/**
 * A settlement applied, as the `reach` topic announces it (`settled`, supabase/migrations/0063_season_news.sql): its id and when it was applied. Public and
 * the same for every listener (everyone sees the clock); whether it moved the listener's characters is read from the listener's own alerts.
 */
export interface LiveSettled {
  readonly id: string;
  readonly at: string;
}

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
  /** An update or an item of season news, as it lands, for every signed-in player alike. May come twice: key by kind, sub, Act and time. */
  readonly onNews?: (news: LiveNews) => void;
  /** A settlement was applied, for every signed-in player alike. May come twice: key by id. */
  readonly onSettled?: (settled: LiveSettled) => void;
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

/**
 * A play's moment (play_moment, 0072_play_moments.sql): the post as it read when a play landed on it, with every play on it then, as
 * each stood. `version` is the post with that version's words as its current payload; `layers` is the play itself first, as it landed
 * (no state), then each layer that was on the post, with what it had saved then or null where it had saved none; `above` is each play
 * beyond a post live then on the post's author, its thread or its board. `recorded` is false for a play from before the snapshot,
 * which holds itself alone. The same answer for every reader: a card back is a back in it, for its setter as for anyone.
 */
export interface PlayMoment {
  readonly version: Act;
  readonly layers: readonly { readonly act: Act; readonly state: EffectState | null }[];
  readonly above: readonly PlayAbove[];
  readonly recorded: boolean;
}

/* ------------------------------------------------------------- one call per screen ---- */

/*
 * A screen's document is the answers of the methods its load calls today, in one request. Each field is typed as that method's
 * answer (`Awaited<ReturnType<KayfaApi['tallies']>>` and so on), so the screens hydrate the stores they hydrate today from the
 * same shapes, and the fake builds each document from its own methods. The `unread` of a page is the bell's count (`alertsUnread`).
 */

/** The frame and the HUD in one read (boot, 0097): what the first load asks of a dozen methods. */
export interface Boot {
  readonly settings: ScreenSettings;
  /** `session().account`: null for a signed-in caller with no account yet. */
  readonly account: Session['account'];
  readonly preferences: Preferences;
  readonly characters: Awaited<ReturnType<KayfaApi['myCharacters']>>;
  /** The public face of each of the player's characters (`characters(ids)`), in the order of `characters`. */
  readonly faces: Awaited<ReturnType<KayfaApi['characters']>>;
  readonly wallet: Wallet;
  readonly cards: Awaited<ReturnType<KayfaApi['myCards']>>;
  readonly boards: Awaited<ReturnType<KayfaApi['boards']>>;
  /** `isAdmin()`: whether the caller is an admin. */
  readonly admin: boolean;
  readonly unread: number;
  readonly nextSettlementAt: Awaited<ReturnType<KayfaApi['nextSettlementAt']>>;
  readonly lastSettledAt: Awaited<ReturnType<KayfaApi['lastSettledAt']>>;
  /** The end of the newest settlement the caller has ledger lines in: `log().settlements[0]?.endsAt`. */
  readonly newestSettlement: string | null;
}

/** The index (index_page, 0095): the boards, the characters who posted last on them, and who is online. */
export interface IndexPage {
  readonly boards: Awaited<ReturnType<KayfaApi['boards']>>;
  readonly characters: Awaited<ReturnType<KayfaApi['characters']>>;
  readonly presence: Presence;
  readonly unread: number;
}

/** A board's page (board_page, 0095). `page` is the page shown, clamped to the board's last. */
export interface BoardPage {
  readonly board: Board;
  readonly total: number;
  readonly page: number;
  readonly threads: readonly ThreadSummary[];
  readonly pins: Awaited<ReturnType<KayfaApi['pinnedThreads']>>;
  /** The board's own live card plays (`effectsAbove([], null, board)`). */
  readonly banner: Awaited<ReturnType<KayfaApi['effectsAbove']>>;
  readonly states: Awaited<ReturnType<KayfaApi['effectStates']>>;
  readonly releases: Awaited<ReturnType<KayfaApi['myReleases']>>;
  readonly tallies: Awaited<ReturnType<KayfaApi['tallies']>>;
  readonly mine: Awaited<ReturnType<KayfaApi['myReactions']>>;
  readonly reading: Awaited<ReturnType<KayfaApi['reading']>>;
  readonly views: Awaited<ReturnType<KayfaApi['viewCounts']>>;
  readonly characters: Awaited<ReturnType<KayfaApi['characters']>>;
  readonly presence: Presence;
  readonly unread: number;
}

/** A character on a thread's page: what the postbit draws, from the methods the thread reads people by. */
export interface ThreadPerson {
  readonly character: Character;
  /** `characterStats([id])[id].posts` */
  readonly posts: number;
  /** `standingAmounts([id])[id]`, hundredths. */
  readonly standing: number;
  readonly reveals: readonly ClassReveal[];
  readonly turns: readonly TurnAnnounced[];
}

/** A thread's page (thread_page, 0094): the page a page number or a seq lands on, with everything it draws. */
export interface ThreadPage {
  /** `thread(id)` */
  readonly thread: ThreadSummary;
  readonly page: number;
  /** `acts(thread, first, last)` of the page. */
  readonly acts: readonly Act[];
  /** The authors and casters on the page. */
  readonly people: readonly ThreadPerson[];
  /** The plays on the page's posts (`cardsOnMany`). */
  readonly plays: Awaited<ReturnType<KayfaApi['cardsOnMany']>>;
  readonly above: Awaited<ReturnType<KayfaApi['effectsAbove']>>;
  readonly faces: Awaited<ReturnType<KayfaApi['myFaceDown']>>;
  readonly states: Awaited<ReturnType<KayfaApi['effectStates']>>;
  readonly releases: Awaited<ReturnType<KayfaApi['myReleases']>>;
  readonly tallies: Awaited<ReturnType<KayfaApi['tallies']>>;
  readonly mine: Awaited<ReturnType<KayfaApi['myReactions']>>;
  readonly spun: Awaited<ReturnType<KayfaApi['spunFromMany']>>;
  /** Each page post's latest visit, if it has one. */
  readonly visits: readonly Visit[];
  /** `reading([thread])` */
  readonly reading: Awaited<ReturnType<KayfaApi['reading']>>;
  /** `board(thread.board)`; null where it cannot be read. */
  readonly board: Board | null;
  readonly following: boolean;
  readonly presence: Presence;
  readonly unread: number;
}

/** A character's profile page (profile_page, 0096). */
export interface ProfilePage {
  readonly character: Character;
  readonly counts: CharacterCounts;
  readonly standing: Awaited<ReturnType<KayfaApi['standingPlace']>>;
  readonly settledAt: Awaited<ReturnType<KayfaApi['lastSettledAt']>>;
  readonly season: Awaited<ReturnType<KayfaApi['season']>>;
  readonly reveals: Awaited<ReturnType<KayfaApi['classReveals']>>;
  readonly turns: Awaited<ReturnType<KayfaApi['turnsAnnounced']>>;
  /** `characterActs(id, ['post', 'spin', 'card'], { offset: 0, limit: PROFILE_ROWS })` */
  readonly acts: Awaited<ReturnType<KayfaApi['characterActs']>>;
  /** The card plays' target Acts and the Turns' Acts (`actsById`). */
  readonly targets: Awaited<ReturnType<KayfaApi['actsById']>>;
  readonly seasons: readonly SeasonRecordRow[];
  readonly unread: number;
}

/** A page of a character's public record (record_page, 0096). */
export interface RecordPage {
  readonly kind: RecordKind;
  readonly page: number;
  readonly character: Character;
  readonly counts: CharacterCounts;
  readonly reveals: Awaited<ReturnType<KayfaApi['classReveals']>>;
  readonly turns: Awaited<ReturnType<KayfaApi['turnsAnnounced']>>;
  readonly seasons: readonly SeasonRecordRow[];
  /** The window of the character's own Acts (`characterActs`) starting at row `from`: for `all`, the extras ahead of the window push the read down by their number. */
  readonly acts: Awaited<ReturnType<KayfaApi['characterActs']>>;
  readonly windowFrom: number;
  readonly targets: Awaited<ReturnType<KayfaApi['actsById']>>;
  readonly unread: number;
}

/** The player's characters page (my_characters_page, 0115): every character, with what the Characters and Edit profile screens draw of each. */
export interface MyCharactersPage {
  readonly characters: Awaited<ReturnType<KayfaApi['myCharacters']>>;
  /** The public face of each debuted character (`characters(ids)`); a character that has not debuted has none. */
  readonly faces: Awaited<ReturnType<KayfaApi['characters']>>;
  /** `characterCounts(id)` of each character. */
  readonly counts: Readonly<Record<Id, CharacterCounts>>;
  /** `standingAmounts(ids)` of the debuted characters, hundredths. */
  readonly standings: Awaited<ReturnType<KayfaApi['standingAmounts']>>;
  readonly reveals: Awaited<ReturnType<KayfaApi['classReveals']>>;
  readonly turns: Awaited<ReturnType<KayfaApi['turnsAnnounced']>>;
  readonly nextSettlementAt: Awaited<ReturnType<KayfaApi['nextSettlementAt']>>;
}

/** The season page (season_page, 0117): the News tab, the live standings or a finished season's final table, by `tab`. Null where the season asked for does not exist. */
export type SeasonPage =
  | { readonly tab: 'news'; readonly season: Awaited<ReturnType<KayfaApi['season']>>; readonly news: Awaited<ReturnType<KayfaApi['seasonNews']>> }
  | {
    readonly tab: 'standings';
    readonly season: Awaited<ReturnType<KayfaApi['season']>>;
    readonly finished: Awaited<ReturnType<KayfaApi['finishedSeasons']>>;
    readonly page: number;
    readonly standings: Awaited<ReturnType<KayfaApi['standingsPage']>>;
    /** `standingsCount()` */
    readonly size: number;
    readonly reveals: Awaited<ReturnType<KayfaApi['classReveals']>>;
    readonly turns: Awaited<ReturnType<KayfaApi['turnsAnnounced']>>;
  }
  | {
    readonly tab: 'results';
    readonly season: Awaited<ReturnType<KayfaApi['season']>>;
    readonly finished: Awaited<ReturnType<KayfaApi['finishedSeasons']>>;
    readonly page: number;
    /** `resultPlace(season, character)`: the character's 0-based place in the table; null where none was asked for or it has no row. */
    readonly place: Awaited<ReturnType<KayfaApi['resultPlace']>>;
    readonly results: Awaited<ReturnType<KayfaApi['resultsPage']>>;
  };

/** The Alerts page (alerts_page, 0119): the newest rows and everything the words need beside them. */
export interface AlertsPage {
  readonly alerts: Awaited<ReturnType<KayfaApi['alerts']>>;
  /** The account's mark (`preferences().alertsSeenAt`). */
  readonly seenAt: string | null;
  readonly openedAt: Awaited<ReturnType<KayfaApi['accountOpenedAt']>>;
  /** The Acts the rows name and the ones those lead to (`actsById`). */
  readonly acts: Awaited<ReturnType<KayfaApi['actsById']>>;
  /** The authors of those Acts (`characters(ids)`). */
  readonly people: Awaited<ReturnType<KayfaApi['characters']>>;
  /** The first post of each followed thread among the rows (`openingActs`). */
  readonly openings: Awaited<ReturnType<KayfaApi['openingActs']>>;
  readonly reading: Awaited<ReturnType<KayfaApi['reading']>>;
}

/** The Updates page (updates_page, 0121): a page of Updates, the open one's reactions, and for an admin with a handover season the queue. */
export interface UpdatesPage {
  readonly updates: Awaited<ReturnType<KayfaApi['updates']>>;
  /** The tallies of the open Update (`update`, or the newest). */
  readonly tallies: Awaited<ReturnType<KayfaApi['tallies']>>;
  readonly mine: Awaited<ReturnType<KayfaApi['myReactions']>>;
  readonly queue?: Awaited<ReturnType<KayfaApi['adminQueue']>>;
}

/** The outcomes an admin gives a report (`decide_report`, 0150): none and close end it with no word to the author, the others tell the author what happened. */
export const REPORT_OUTCOMES = ['none', 'nudge', 'hide', 'hideUntilEdited', 'suspend', 'ban', 'close'] as const;
export type ReportOutcomeKey = (typeof REPORT_OUTCOMES)[number];
/** What `decide` takes besides a report's outcomes: bring a version back, lift a bar, approve an edit. */
export type DecideOutcome = ReportOutcomeKey | 'unhide' | 'lift' | 'approve';
/** One outcome of a decision: `until` (an ISO time) only for a suspension, `note` the words that go into the author's mail. */
export interface ReportOutcome {
  readonly outcome: ReportOutcomeKey;
  readonly until?: string;
  readonly note?: string;
}
/** An account's decision before this one, as the admin screen shows it. */
export interface PastDecision {
  readonly outcome: string;
  readonly until: string | null;
  readonly at: string;
  readonly note: string;
}
/** An open report (`admin_reports`, 0152): the reported version's words, the section and note the reporter gave, and the author's account (null for a staff post) with its past decisions. The reporter is not shown. */
export interface AdminReport {
  readonly id: number;
  readonly versionAct: Id;
  readonly post: Id;
  readonly thread: Id | null;
  readonly section: string;
  readonly note: string | null;
  readonly at: string;
  readonly author: Id | null;
  readonly words: string;
  readonly past: readonly PastDecision[];
}
/** A post hidden until its author edited it, edited since and not yet decided again: the admin's re-review list (`reviews_due`). */
export interface AdminReview {
  readonly decision: number;
  readonly post: Id;
  readonly versionAct: Id;
  readonly thread: Id | null;
  readonly editedAt: string;
  readonly author: Id | null;
  readonly words: string;
}
/** A mail whose latest attempt failed (it will be tried again) or was refused (it never will be). */
export interface FailedMail {
  readonly id: number;
  readonly template: string;
  readonly account: Id;
  readonly kind: 'failed' | 'refused';
  readonly error: string;
  readonly at: string;
}
/** The reports screen's page (`admin_reports` and `admin_failed_mail`); null for a caller who is not an admin. */
export interface ReportsPage {
  /** At most 50, newest first; `moreReports` says more are open than these. */
  readonly reports: readonly AdminReport[];
  readonly moreReports: boolean;
  /** At most 50, oldest first (the ones waiting longest); `moreReviews` says more wait. */
  readonly reviews: readonly AdminReview[];
  readonly moreReviews: boolean;
  /** At most 200, newest first; `moreFailed` says more failed. */
  readonly failed: readonly FailedMail[];
  readonly moreFailed: boolean;
  /** Mail waiting to go with no admin reply-to address set (Settings.conduct.adminAddress), which is why it waits; 0 once one is set. */
  readonly waiting: number;
  readonly addressSet: boolean;
}

/** The admin queue page (queue_page, 0121); null for a caller who is not an admin. */
export interface QueuePage {
  readonly queue: Awaited<ReturnType<KayfaApi['adminQueue']>>;
  readonly boardNames: Awaited<ReturnType<KayfaApi['boardNames']>>;
  readonly bosses: Awaited<ReturnType<KayfaApi['bosses']>>;
  readonly contact: Awaited<ReturnType<KayfaApi['adminContact']>>;
}

/** The player's log page (log_page, 0123): the page `log(before)` answers, and what its lines name. */
export interface LogPage {
  readonly log: Awaited<ReturnType<KayfaApi['log']>>;
  /** The Acts the lines name and the ones those lead to, two rounds (`actsById`). */
  readonly acts: Awaited<ReturnType<KayfaApi['actsById']>>;
  /** `effectStates(plays)` of the saves. */
  readonly states: Awaited<ReturnType<KayfaApi['effectStates']>>;
  /** The other characters the lines name (`characters(ids)`). */
  readonly people: Awaited<ReturnType<KayfaApi['characters']>>;
  /** The threads the announced Turns and thread-reaching plays name (`thread(id)`). */
  readonly threads: readonly ThreadSummary[];
  /** The boards board-reaching plays name (`board(id)`). */
  readonly boards: readonly Board[];
  /** `standingAmounts(ids)` of the player's characters. */
  readonly standings: Awaited<ReturnType<KayfaApi['standingAmounts']>>;
  /** Every announced Turn of the player's characters (`turnsAnnounced(ids)`); the log draws only each character's latest, which the screen picks with the characters it holds (the one whose announcement is dated at its `classSince`). */
  readonly turns: Awaited<ReturnType<KayfaApi['turnsAnnounced']>>;
  readonly season: Awaited<ReturnType<KayfaApi['season']>>;
}

export interface KayfaApi {
  /* Signing in: passwordless, through the account function only, in the same words for every address. */
  session(): Promise<Session>;
  onSession(listener: (s: Session) => void): () => void;
  /** `conduct` is the version of the code of conduct the register form's box agreed to; it rides with the login and the account records it when it opens. */
  requestCode(email: string, invite: string | null, conduct?: number | null): Promise<Answer<{ readonly message: string; readonly invite?: string }>>;
  verifyCode(email: string, code: string): Promise<Answer<{ readonly account: boolean; readonly why?: string }>>;
  openAccount(invite: string | null): Promise<Answer<{ readonly opened: boolean }>>;
  signOut(): Promise<void>;
  /** The signed-in account accepts the code of conduct at this version (accept_conduct). */
  acceptConduct(version: number): Promise<Answer<Record<string, never>>>;
  /** The address the session signed in with, the player's own, for Settings › Account; null signed out. */
  signInAddress(): Promise<string | null>;
  isAdmin(): Promise<boolean>;
  /** The moves waiting to land, in force, and ended or held in the last 30 days. An admin's alone; anyone else is refused (the call throws). */
  adminQueue(): Promise<AdminQueue>;
  /**
   * An admin's update, written as the developer persona. The title and body are held to the limits a post is; `changes` is the plain
   * list under "What changed": a blank row is dropped and the words are trimmed, and a label with no text, a text over 600 characters,
   * a label over 80 or more than 30 changes is refused naming which. An admin's alone, and written by no model.
   */
  postUpdate(title: string, body: string, changes: readonly UpdateChange[]): Promise<Answer<Update>>;
  /** Puts a handover's to-do away without an update (`dismiss_handover_todo`). An admin's alone; a season with no to-do is refused, and one already dismissed is answered. */
  dismissHandoverTodo(season: number): Promise<Answer<{ readonly season: number }>>;
  /**
   * How players reach the admins (`admin_contact`): the links an admin set, or none. Public, and the same for every caller, signed in or
   * not, because the player who most needs a person may be the one who cannot sign in. Rejects when it cannot be read.
   */
  adminContact(): Promise<readonly ContactLink[]>;
  /**
   * An admin's write of the contact (`set_admin_contact`), at most `CONTACT_MOST` links. The words are trimmed, an empty row is dropped
   * and a bare email becomes `mailto:`; an address that is neither `https:` nor `mailto:`, a label over `CONTACT_LABEL_MAX`, an address over
   * `CONTACT_HREF_MAX` or more links than `CONTACT_MOST` is refused, naming the row (the refusal's words say "row N"). Answers with what was
   * stored. An admin's alone.
   */
  setAdminContact(links: readonly ContactLink[]): Promise<Answer<readonly ContactLink[]>>;
  /** Holds a move that is waiting: it never lands. An admin's alone, and it cannot be taken back. */
  holdMove(id: number): Promise<Answer<{ readonly id: number; readonly heldAt: string }>>;
  /** Ends a move in force now as reversed by an admin; the old name returns at once. An admin's alone. */
  reverseMove(act: Id): Promise<Answer<{ readonly act: Id; readonly endedBy: Id }>>;
  /**
   * Ends a card play as reversed by an admin (`reverse_card`, 0092): a `card_end` Act of no character is written beside the play, the
   * layer comes off and the card stops counting; the original play is never changed. An admin's alone; a caught play, one that has
   * worn off and one already ended are refused in words that say nothing of a face-down card. It cannot be taken back (play the card
   * again). Answers the end's Act and the play.
   */
  reverseCard(play: Id): Promise<Answer<{ readonly act: Id; readonly play: Id }>>;
  /** Puts another Boss of the roster in a waiting nomination's place (`id` is the queue row's). An admin's alone; a nomination that has landed or been held is refused. */
  replaceSuccessor(id: number, boss: string): Promise<Answer<{ readonly id: number; readonly boss: string }>>;
  /**
   * Puts an admin's words in the place of a waiting rename's description (`replace_queued_description`, 0101): when the rename lands they
   * become a `describe` Act beside it, and the Boss's words stay on the rename. `id` is the queue row's. An admin's alone; a row that has
   * landed or been held, a move that is no rename, and a description empty or over 2000 characters are refused. A second call replaces the first.
   */
  replaceQueuedDescription(id: number, description: string): Promise<Answer<{ readonly id: number; readonly description: string }>>;
  /**
   * Replaces a board's description at any time (`describe_board`, 0101), by a `describe` Act that names the board's open rename, if there is
   * one, and so ends with it. An admin's alone; a board that is not there and a description empty or over 2000 characters are refused.
   */
  describeBoard(board: Id, description: string): Promise<Answer<{ readonly board: Id; readonly description: string }>>;
  /** The instance's whole roster by staff key and name, a waiting persona included (`boss_roster_names`): an admin's alone; anyone else is refused (the call throws). */
  bosses(): Promise<readonly { readonly staff: string; readonly name: string; readonly pronouns: PronounSet }[]>;
  /** The names of staff who have debuted, by staff key (`characters_public`): public, so a waiting persona is not in it. The public moderation log names a nominee and a keeper from it. */
  staffNames(): Promise<readonly { readonly staff: string; readonly name: string; readonly pronouns: PronounSet }[]>;

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
  /**
   * The caller's own character's apologies, newest first (`my_apologies`, 0133): each one's move, state and when it was written, and when the next may be. Another
   * player's character, or an id that is no one's, reads none. Rejects when it cannot be read.
   */
  myApologies(character: Id): Promise<readonly Apology[]>;
  /**
   * The group moves of one of the player's characters that an appeal was made on and not refunded for a failed judgment (`my_appeals`): each is appealed once, so the barred box stops
   * offering Appeal on them. A character that is not the player's, or an id that is no one's, reads none. Rejects when it cannot be read.
   */
  appealedMoves(character: Id): Promise<readonly Id[]>;
  /** A page of a staff member's moves, newest first, `MOVES_LOG_PAGE` to a page; pass the last page's `older` for the next. */
  movesLog(staff: string, before?: MovesCursor | null): Promise<MovesLog>;
  /** A staff member's latest in-character profile, or null before it has one (a Mod Bot has none until it is asked to write one). */
  staffProfile(staff: string): Promise<StaffProfile | null>;
  /** A staff member's career (`staff_career`): the seasons it led and the offices it held, plain facts any reader may see. */
  staffCareer(staff: string): Promise<Career>;
  /** A page of a board's threads, newest first; `total` is the board's thread counter, never a count of the list. */
  threads(board: Id, page: { readonly offset: number; readonly limit: number }): Promise<{ readonly threads: readonly ThreadSummary[]; readonly total: number }>;
  thread(id: Id): Promise<ThreadSummary | null>;
  /** A thread's Acts from one seq to another, both included, edits left out (each shows through its post). */
  acts(thread: Id, fromSeq: number, toSeq: number): Promise<readonly Act[]>;
  act(id: Id): Promise<Act | null>;
  /** Several Acts by id in one read; an id that is not an Act (or none the reader may see) is left out. Order is not promised. */
  actsById(ids: readonly Id[]): Promise<readonly Act[]>;
  /** The first post (seq 1) of each of these threads, in one read; a thread with none the reader may see is left out. Order is not promised. */
  openingActs(threads: readonly Id[]): Promise<readonly Act[]>;
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
  /**
   * The card plays on an Act, oldest first, at most `limit`: the effects an ORIGIN box lists under the Act it shows. A result as long as `limit` may be cut.
   * The `card_end` Acts of those plays follow the plays in the same list (kind `card_end`, `targetActId` the play): a play with one was
   * ended by an admin, and the original play is unchanged.
   */
  cardsOn(act: Id, limit: number): Promise<readonly Act[]>;
  /**
   * The card plays on any of these Acts, oldest first, in one read (a page of a thread asks once, never once per post), at most
   * `limit` rows in all; each names its post in `targetActId`. A result as long as `limit` may be cut, and a post with none in it
   * may have some. The `card_end` Acts of those plays follow them in the same list (they name their play in `targetActId`, not a post).
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
  /**
   * The tails of a page of posts (`post_tails`): every row of every writing play on them, in version order then play order, and the waiting jobs.
   * At most 200 posts a call (the server refuses more); a post with no writing play has no row. The same for every signed-in reader.
   */
  tails(posts: readonly Id[]): Promise<readonly Tail[]>;
  /** A play's moment (`PlayMoment`), read once when asked for; null for an id that is no play on a post. Any signed-in reader may read it. */
  playMoment(play: Id): Promise<PlayMoment | null>;
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
  /** The Vending Machine's slots as everyone sees them now, in grid order: public, the same for every caller, a hidden slot absent. */
  machine(): Promise<readonly Slot[]>;
  /** Every slot of the machine, hidden ones too, in grid order, as an admin sees them. An admin's alone; anyone else is refused (the call throws). */
  adminMachine(): Promise<readonly AdminSlot[]>;
  /**
   * Saves a slot's availability and price (`set_slot`). A price is at least 1 (hundredths of an orb). Taking a pack off sale ends, as reversed by the admin, every
   * Pull whose card is then in no pack on sale; `ended` counts them. An admin's alone.
   */
  setSlot(slot: Id, availability: AdminSlot['availability'], price: number): Promise<Answer<{ readonly slot: Id; readonly ended: number }>>;
  /** Swaps a slot with its neighbor in the grid (`move_slot`); the first slot up and the last slot down answer `moved: false` and change nothing. An admin's alone. */
  moveSlot(slot: Id, direction: 'up' | 'down'): Promise<Answer<{ readonly slot: Id; readonly moved: boolean }>>;
  /**
   * Saves the machine page in one transaction (`save_machine`): the slots in the order given (all of them, each once) and each one's availability and price. A refusal
   * anywhere in the list saves nothing; its `field` is `<slot id>/availability` or `<slot id>/price` where one slot's word is at fault, so the page can mark it.
   * `ended` counts the Pulls this ended (see `setSlot`). An admin's alone.
   */
  saveMachine(changes: readonly { readonly slot: Id; readonly availability: AdminSlot['availability']; readonly price: number }[]): Promise<Answer<{ readonly ended: number }>>;
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
  /** The frame and the HUD in one read. Refused for a visitor, as the server refuses it. */
  boot(): Promise<Boot>;
  /** The index in one read. */
  indexPage(): Promise<IndexPage>;
  /** A board's page in one read; null where the board does not exist. `effectCards` names the cards the instance draws an effect for. */
  boardPage(slug: string, page: number, effectCards: readonly string[]): Promise<BoardPage | null>;
  /** The posts that match a search, a page at a time; `after` is the previous page's `next`. Refused (rejects) on an argument out of range, as the server refuses it. */
  searchPosts(q: SearchQuery, after?: SearchCursor | null): Promise<SearchPage<PostHit>>;
  /** The threads that match a search, each once with its best snippet, paged as `searchPosts` is. */
  searchThreads(q: SearchQuery, after?: SearchCursor | null): Promise<SearchPage<ThreadHit>>;
  /** Suggestions for a prefix of 2 to 100 characters; an empty prefix with only threads asked lists the newest threads. */
  suggest(prefix: string, options?: SuggestOptions): Promise<Suggestions>;
  /** A thread's page in one read, at a page or around a seq (the seq wins); null where the thread does not exist. Also the read for a next page and a gap. A null `perPage` is the instance's own postsPerPage, which the server reads (a first load does not know it yet). */
  threadPage(thread: Id, at: { readonly page?: number | null; readonly seq?: number | null }, perPage: number | null, effectCards: readonly string[]): Promise<ThreadPage | null>;
  /** How a visit went (`VisitStory`), read when its Lens tab opens: its thread and post are the page's. */
  visitStory(thread: Id, visit: Id, post: Id): Promise<VisitStory>;
  /**
   * One try to talk a visit down, through this character (`intercept`): a quiz's `answer` is one of its choices; a bribe and a distraction take none.
   * Refused in the server's words (a character that has tried, a visit that is over, a short wallet).
   */
  intercept(through: Id, visit: Id, answer: string | null): Promise<Answer<InterceptResult>>;
  /**
   * Reports a post through this character (the staff function's player door): paid, public, and answered at once by the Mod on the board's beat. Refused in the server's words
   * (a banned character, a day's quota spent, a short wallet); a judgment that failed refunds it and says so.
   */
  fileReport(through: Id, post: Id, reason: string): Promise<Answer<ReportResult>>;
  /** Appeals one of this character's punishments (an infraction's Act, or a ban's): a plea, a price, one appeal per punishment. */
  fileAppeal(through: Id, punishment: Id, plea: string): Promise<Answer<AppealResult>>;
  /** How many reports this character may still make today (UTC). Shown only to the player of that character; null where it could not be read. */
  reportsLeft(character: Id): Promise<number | null>;
  /**
   * Reports a version (a post, or one of its edits) to admins (`report_post`): the account's own report, never a character's. Refused in the server's words; the refusal for the
   * open-report limit has `field: REPORT_LIMIT`, and the form then asks `myOpenReports` for the account's own count. `note` is at most 1000 characters.
   */
  reportPost(version: Id, section: string, note: string): Promise<Answer<null>>;
  /** How many reports to admins the signed-in account holds open and the most it may (`my_open_reports`): the caller's own count, shown only to them; null where it could not be read. */
  myOpenReports(): Promise<{ readonly open: number; readonly most: number } | null>;
  /** The author's own words of a post hidden until they edit it, or where it waits for an admin (`my_hidden_version`); null for anyone else's post or a post that is not so hidden. */
  myHiddenVersion(post: Id): Promise<MyHiddenVersion | null>;
  /** The public name of the Mod on a board's beat, who judges its reports, and the board's name; null where no Mod is on staff. */
  beatMod(board: Id): Promise<{ readonly mod: string; readonly pronouns: PronounSet; readonly board: string } | null>;
  /** The ban now running on one of the player's characters (`my_bans`), for the appeal to the Boss; null where it is not banned. */
  myBan(character: Id): Promise<MyBan | null>;
  /** The player's own characters in one read, with what the Characters and Edit profile screens draw of each. */
  myCharactersPage(): Promise<MyCharactersPage>;
  /** The season page in one read, by `tab` ('news', else the standings or a finished `season`'s table, at `page` or around `character`); null where the season does not exist. */
  seasonPage(tab: string | null, season: number | null, character: Id | null, page: number | null): Promise<SeasonPage | null>;
  /** The Alerts page in one read, the rows at or before `before`. */
  alertsPage(before: string | null): Promise<AlertsPage>;
  /** The Updates page in one read: a page of Updates at or before `before`, `update` open (the newest when null); a handover season asks an admin's queue as well. */
  updatesPage(update: Id | null, before: string | null, handoverSeason: number | null): Promise<UpdatesPage>;
  /** The admin queue page in one read; null for a caller who is not an admin. */
  queuePage(): Promise<QueuePage | null>;
  /** The reports screen in one read; null for a caller who is not an admin. */
  reportsPage(): Promise<ReportsPage | null>;
  /** An admin decides an open report with one to six outcomes (`decide_report`); each tells the author what it says, the reporter is told the same whatever was decided. */
  decideReport(report: number, outcomes: readonly ReportOutcome[]): Promise<Answer<{ readonly decisions: readonly number[] }>>;
  /** An admin acts with no report (`decide`): approve or unhide a version, hide it again, or act on an account. */
  decide(on: { readonly account?: Id; readonly version?: Id }, outcome: DecideOutcome, until?: string, note?: string): Promise<Answer<null>>;
  /** The log in one read, the rows at or before `before`. */
  logPage(before: string | null): Promise<LogPage>;
  /** A character's profile page in one read; null where the character is not shown. */
  profilePage(character: Id): Promise<ProfilePage | null>;
  /** A page of a character's record in one read; null where the character is not shown. */
  recordPage(character: Id, kind: RecordKind, page: number): Promise<RecordPage | null>;
  /** A place's presence box on its own: it marks no one present, which is `here`'s. */
  presenceBox(place: PresencePlace): Promise<Presence>;
  /** Hides a mask of the player's from every presence box, or shows it again; answers whether it is now hidden. */
  setPresenceHidden(character: Id, hidden: boolean): Promise<Answer<boolean>>;
  preferences(): Promise<Preferences>;
  setPreferences(p: PreferencesPatch): Promise<Answer<Preferences>>;
  /**
   * Records that the account has met the card kind `card` (its key): added once, however often it is called, and answered with
   * the preferences, the same for any key the server accepts. Refused for a key that is not a card's key or a 65th kind.
   */
  meetCard(card: string): Promise<Answer<Preferences>>;
  /** Marks the welcome seen, once: a second call leaves the first time. Answers the preferences. */
  seeWelcome(): Promise<Answer<Preferences>>;
  /** Records that the account has seen the tip `key`, once however often it is called. Refused for a key that is not a tip's key or a 65th. */
  seeTip(key: string): Promise<Answer<Preferences>>;
  /** "Skip tips": turns the tips off, keeping what was seen. */
  skipTips(): Promise<Answer<Preferences>>;
  /** The Tips switch turned on: turns the tips on and forgets nothing, so what was seen stays seen. */
  resumeTips(): Promise<Answer<Preferences>>;
  /** "Show tips again": turns the tips on and forgets the tips seen and the cards met. The welcome stays seen. */
  restoreTips(): Promise<Answer<Preferences>>;
  /**
   * "Replay the HUD tour": forgets the tour's tips alone (`tour-plate`, `tour-orbs`, `tour-hand`), turns the tips on, and marks the welcome
   * seen if it never was (the tour waits on it), keeping a first time.
   */
  replayTour(): Promise<Answer<Preferences>>;
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
  /**
   * Whether the settlement `id` moved the caller's characters (`my_settlement_moved`): how many of them, and when it was applied (an ISO time), or
   * null when it moved none, is another player's alone, or does not exist; the answer has the same shape for any id. Read at a random moment after a
   * settlement is announced, so no client asks in the same instant. Rejects when it cannot be read.
   */
  settlementMoved(id: string): Promise<{ readonly count: number; readonly at: string } | null>;
  /**
   * When the caller's account was opened (an ISO time; accounts.created_at, read by its own account alone), or null where it is older
   * than anything this backend holds: an account that has never opened Alerts counts as new only what arrived after it joined (issue
   * #148), so the page's divider starts here when there is no mark. Rejects when it cannot be read.
   */
  accountOpenedAt(): Promise<string | null>;
  /**
   * A page of the Updates, newest first, `UPDATES_PAGE` to a page: those older than `before` (an ISO time, exclusive; none for the
   * newest page). The developer persona's posts, which anyone signed in reads; they are the same for every reader.
   */
  updates(before?: string | null): Promise<readonly Update[]>;
  /**
   * A page of the season's news (`season_news`), newest first: the newest `SEASON_NEWS_PAGE` older than `before` (an ISO time, exclusive; none
   * for the newest page) and every item sharing the instant of the last. Public: the same for every reader, and no character is marked as the
   * player's own (a screen marks them from `myCharacters`).
   */
  seasonNews(before?: string | null): Promise<readonly SeasonNewsItem[]>;
  /** The seasons whose results have landed (`finished_seasons`, 0099), newest first, at most 200. Public. */
  finishedSeasons(): Promise<readonly SeasonFinished[]>;
  /** A page of a finished season's final table (`results_page`, 0099): 50 rows by place, then name, then character; a season without results, or a page past the end, is empty. */
  resultsPage(season: number, page: number): Promise<readonly SeasonResultRow[]>;
  /**
   * A character's index in that table's order (`result_place`, 0099), counted from 0 and not a place number, so the page holding it is
   * `Math.floor(index / 50) + 1`; null where the season has no row for it.
   */
  resultPlace(season: number, character: Id): Promise<number | null>;
  estimate(): Promise<Estimate>;
  /** A page of the player's own log (`Log`): the newest with no cursor, then each older page from the last one's `before`. */
  log(before?: string | null): Promise<Log>;
  invites(): Promise<readonly MyInvite[]>;
  createInvite(): Promise<Answer<{ readonly invite: number; readonly code: string }>>;
  reissueInvite(invite: number): Promise<Answer<{ readonly invite: number; readonly code: string }>>;

  /*
   * Acting, as one of the player's characters. `framing`, on a post, a thread start and a spin, is the ids the body's counterfeit quotes name
   * (`framedIn`, composer/text.ts); each debuted character of another player that the body names is told (the `framed` alert, 0118).
   */
  startThread(board: string, character: Id, title: string, body: string, framing?: readonly Id[]): Promise<Answer<{ readonly thread: ThreadSummary; readonly act: Act }>>;
  post(thread: Id, character: Id, body: string, quote: Id | null, framing?: readonly Id[]): Promise<Answer<Act>>;
  edit(post: Id, character: Id, body: string): Promise<Answer<Act>>;
  spin(origin: Id, character: Id, title: string, body: string, framing?: readonly Id[]): Promise<Answer<{ readonly thread: ThreadSummary; readonly act: Act }>>;
  /**
   * A barred character's apology (`apologize`, 0130): the spin of the move that bars it, onto the board it bars, with the bar the one thing skipped, and a waiting
   * apology the move's staff member rules on. Refused while the character is banned, on a move that is not this character's or has ended, while one waits, and
   * within `Settings.apology.apologyEveryHours` of the last (the refusal names the time the next opens). `framing` is a spin's: the characters its counterfeit quotes name are told.
   */
  apologize(move: Id, character: Id, title: string, body: string, framing?: readonly Id[]): Promise<Answer<{ readonly thread: ThreadSummary; readonly act: Act }>>;
  /**
   * Buy a card from its slot of the Vending Machine, from the settled wallet only: the ghost estimate cannot be spent. The slot is
   * sent with the price it showed, and the server refuses, in plain words, a price that is no longer its own. Private, and nothing
   * about it is broadcast.
   */
  buyCard(slot: Slot): Promise<Answer<Bought>>;
  /**
   * Buy a pack from its slot, the same way; the server rolls it, and it comes back opened: the cards it gave in pull order, already in
   * the hand. Private.
   */
  buyPack(slot: Slot): Promise<Answer<Opened>>;
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
   * A Move may be set with `when`, its conditions (quote-conditions design, section 1): sent only when one is set, and never for a set card.
   */
  setCard(card: string, character: Id, target: Id, config: Readonly<Record<string, unknown>>, when?: SetConditions): Promise<Answer<Act>>;
  /**
   * Take a card the player set face down back into the hand, before it springs and before its time ends (`take_back`): the setter's own back on a post
   * of the character's, free, and its Act (a take-back, naming the set) comes back. A back that is not the player's, or that has ended, is refused in the same words.
   */
  takeBack(character: Id, set: Id): Promise<Answer<Act>>;
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
  /** `pronouns` left out: the instance's default (`Settings.pronouns`), as the server takes it. */
  createCharacter(name: string, cls: string, timing: DebutTiming, loudness: DebutLoudness, pronouns?: PronounSet): Promise<Answer<CreatedCharacter>>;
  setDebut(character: Id, timing: DebutTiming, loudness: DebutLoudness): Promise<Answer<{ readonly id: Id; readonly waiting: boolean; readonly loudness: DebutLoudness }>>;
  /** `pronouns` left out: the stored set stays. */
  setProfile(character: Id, title: string, signature: string, pipStyle: string, pronouns?: PronounSet): Promise<Answer<Character>>;
  setAvatar(upload: AvatarUpload): Promise<Answer<Character>>;

  /* Live: Acts, tallies and saved effects on a thread; new threads on a board. Each returns its unsubscribe. */
  subscribeThread(thread: Id, listener: ThreadListener): () => void;
  subscribeBoard(board: Id, listener: BoardListener): () => void;
  /** Live: the signed-in player's own alerts (their private channel); nothing while signed out. Returns its unsubscribe. */
  subscribeAccount(listener: AccountListener): () => void;
  /** Live: plays beyond a post, for every page that shows their target (issue 140). Returns its unsubscribe. */
  subscribeReach(listener: ReachListener): () => void;
}
