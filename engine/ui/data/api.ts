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

export type Id = string;

/* ------------------------------------------------------------------ answers ---- */

/** A refusal, in the server's own words, with the request field it names when it names one. */
export interface Refusal {
  readonly ok: false;
  readonly error: string;
  readonly field?: string;
}

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
}

/* ------------------------------------------------------------- public reads ---- */

export interface Board {
  readonly id: Id;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  /** The System's own board: only The System posts there; players react and spin. */
  readonly isSystem: boolean;
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
  readonly firstAct: Id | null;
  readonly firstCharacter: Id | null;
  readonly lastAct: Id | null;
  /** Null for The System's own Acts. */
  readonly lastCharacter: Id | null;
  readonly repliesThisWeek: number;
}

export type ActKind = 'post' | 'spin' | 'card' | 'edit' | 'tally' | 'reveal' | 'unmask';

/** An Act as every reader sees it (acts_public): the original and, where edited, what it shows now. */
export interface Act {
  readonly id: Id;
  /** Null for The System's own Acts (a tally, the reveal). */
  readonly character: Id | null;
  readonly kind: ActKind;
  readonly thread: Id;
  readonly targetActId: Id | null;
  /** Null for an edit, which is a version of its post and no place in the thread. */
  readonly seq: number | null;
  readonly createdAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly currentPayload: Readonly<Record<string, unknown>>;
  readonly editedAt: string | null;
  /** Set only by an edit made after the grace period: what "Last edited" says. */
  readonly shownEditedAt: string | null;
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
}

/** A character's season standing (season_standings) and when it was last settled. */
export interface Standing {
  readonly character: Id;
  readonly name: string;
  /** Hundredths. */
  readonly standing: number;
  /** Ties share a place. */
  readonly place: number;
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
}

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

/* ---------------------------------------------------------------- the api ---- */

export interface KayfaApi {
  /* Signing in: passwordless, through the account function only, in the same words for every address. */
  session(): Promise<Session>;
  onSession(listener: (s: Session) => void): () => void;
  requestCode(email: string, invite: string | null): Promise<Answer<{ readonly message: string; readonly invite?: string }>>;
  verifyCode(email: string, code: string): Promise<Answer<{ readonly account: boolean; readonly why?: string }>>;
  openAccount(invite: string | null): Promise<Answer<{ readonly opened: boolean }>>;
  signOut(): Promise<void>;
  isAdmin(): Promise<boolean>;

  settings(): Promise<ScreenSettings>;

  /* What anyone signed in can read. */
  boards(): Promise<readonly BoardSummary[]>;
  threads(board: Id, page: { readonly offset: number; readonly limit: number }): Promise<{ readonly threads: readonly ThreadSummary[]; readonly total: number }>;
  thread(id: Id): Promise<ThreadSummary | null>;
  /** A thread's Acts from one seq to another, both included, edits left out (each shows through its post). */
  acts(thread: Id, fromSeq: number, toSeq: number): Promise<readonly Act[]>;
  act(id: Id): Promise<Act | null>;
  /** A post's every version, the original first, each as it was written. */
  history(post: Id): Promise<readonly Act[]>;
  /** The threads spun from an Act. */
  spunFrom(act: Id): Promise<readonly ThreadSummary[]>;
  /** Debuted characters with their profiles; an id not among them (waiting, or none) is left out. */
  characters(ids: readonly Id[]): Promise<readonly Character[]>;
  characterCounts(id: Id): Promise<CharacterCounts>;
  /** A character's public Acts of a kind, newest first, for its public record. */
  characterActs(id: Id, kinds: readonly ActKind[], page: { readonly offset: number; readonly limit: number }): Promise<{ readonly acts: readonly Act[]; readonly total: number }>;
  /** Every Act asked about, with an empty tally where none has been left. */
  tallies(acts: readonly Id[]): Promise<Readonly<Record<Id, Tally>>>;
  /** Every thread asked about, 0 where none has been counted yet (the count moves hourly, never live). */
  viewCounts(threads: readonly Id[]): Promise<Readonly<Record<Id, number>>>;
  season(): Promise<Season | null>;
  /** The open season's standings, every debuted character, ranked. */
  standings(): Promise<readonly Standing[]>;
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
  /** The furthest seq read in each thread asked about; a thread never read is absent. */
  reading(threads: readonly Id[]): Promise<Readonly<Record<Id, number>>>;
  /** Never lowers what was read; `through` is the HUD's character, if one is chosen. A refusal is dropped: a read mark is no action of the player's. */
  markRead(thread: Id, seq: number, through: Id | null): Promise<void>;
  preferences(): Promise<Preferences>;
  setPreferences(p: Partial<Preferences>): Promise<Answer<Preferences>>;
  estimate(): Promise<Estimate>;
  invites(): Promise<readonly MyInvite[]>;
  createInvite(): Promise<Answer<{ readonly invite: number; readonly code: string }>>;
  reissueInvite(invite: number): Promise<Answer<{ readonly invite: number; readonly code: string }>>;

  /* Acting, as one of the player's characters. */
  startThread(board: string, character: Id, title: string, body: string): Promise<Answer<{ readonly thread: ThreadSummary; readonly act: Act }>>;
  post(thread: Id, character: Id, body: string, quote: Id | null): Promise<Answer<Act>>;
  edit(post: Id, character: Id, body: string): Promise<Answer<Act>>;
  spin(origin: Id, character: Id, title: string, body: string): Promise<Answer<{ readonly thread: ThreadSummary; readonly act: Act }>>;
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
}
