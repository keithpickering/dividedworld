/**
 * The in-memory backend: KayfaApi (engine/ui/data/api.ts) with nothing behind it but a few maps.
 *
 * The screens' stories, their unit tests and the end-to-end build run on this, so it holds what the
 * server holds and refuses what the server refuses, in the server's words (supabase/migrations and
 * engine/rules/actions.ts, whose own `decide()` reads each request here as the Edge Function does).
 * It is deterministic: ids count up, time is a clock a test advances, nothing is random.
 *
 * Public reads go through the same projections the server has: a waiting character is in none of
 * them, an owner is in none, a class is public only through a reveal or an announced Turn, a
 * tally is counts. What a test controls is on `seed` (state the server's own code would have made:
 * a settlement, a reveal, a debut), on `clock`, on `signInAs`, and on `broadcast`, which can hold
 * the live events a post or a reaction sends and deliver them twice and out of order.
 *
 * Where it differs from the server, and says so:
 *  - A bar is not refused by post, start thread or spin (the database's `barred()` does); `myApologies` and `apologize` are, and `myCharacters` carries `bars`.
 *  - A month is thirty days (a cooldown, a lifetime); the server counts calendar months.
 *  - A name is taken by the engine's own `sameName` (case and look-alike folding, as the database's).
 *  - A debut dropped "now" writes no announcement Act; tests that need one seed it.
 *  - A card's seeded settings are not drawn (a play carries no `seed`); a saved effect is kept as the post's author sent it, unchecked by the card's rules; and there is no check that a Turn's settlement is now due.
 */
import type { Instance, Settings, Span } from '../../rules/types.ts';
import { decide } from '../../rules/actions.ts';
import { rollPack } from '../../rules/packs.ts';
import { beltHolder, outfitProblems, PIECE_TURN_MOST, PIECE_WIDTH, type Piece } from '../../rules/cosmetics.ts';
import { RARITIES, type Rarity } from '../../rules/cards.ts';
import { atOrBelow, OLD_VOICE_OFF, withheld, playOf as kindOfPlay, postTarget, casterMessage, decidePlay, decideSet, decideUse, effectsOnTarget, type BeyondPost, type CardEffect, type CardTarget, type EffectsAbove, type PostTarget, type Reach, type SetConditions } from '../../rules/cards.ts';
import { sameName } from '../../rules/names.ts';
import { earnedGroup } from '../../rules/groups.ts';
import { ALERT_KINDS, isWritten, type WrittenKind } from '../../rules/alerts.ts';
import { DEFAULT_DEVELOPER } from '../../rules/instance.ts';
import { normalizePronouns, pronounProblems, type PronounSet } from '../../rules/pronouns.ts';
import type { Career } from '../../system/career.ts';
import { ADMIN_AWARDS_PAGE, ALERTS_PAGE, ALERTS_UNREAD_BOUND, CONTACT_HREF_MAX, CONTACT_LABEL_MAX, CONTACT_MOST, CONTACT_WS, DEFAULT_PREFERENCES, FOLLOWED_COUNT_CAP, LOST_ANSWER, MOVES_LOG_PAGE, REIGNS_PAGE, TROPHIES_PAGE, TROPHY_FAILURES_PAGE, SEARCH_CARDS_MAX, SEARCH_COUNT_CAP, SEARCH_MATCHES_CAP, SEARCH_PER_PAGE, SEARCH_PER_PAGE_MAX, SEASON_NEWS_PAGE, SPUN_FROM_MAX, UPDATES_PAGE } from './api.ts';
import { buildMoveNotice, toDemand, toProgress } from './moves.ts';
import { TIP_KEYS, TOUR_KEYS } from '../tips/keys.ts';
import { PLAYS_PER_POST } from '../cards/plays.ts';
import { visibleText } from '../../bbcode/visible.ts';
import { parse } from '../../bbcode/parse.ts';
import { pageOf } from '../thread/pages.ts';
import { PROFILE_ROWS, RECORD_PAGE, type RecordKind } from '../profile/record.ts';
import { actsFollowed, actsNamed } from '../log/lines.ts';
import { micros, readLogPageNow, type LedgerRow, type ShareRow } from './log-page.ts';
import type {
  AdminQueue, BoardName, Demand, HandoverTodo, MoveEnded, MoveInForce, MoveLogRow, MovesCursor, MovesLog, QueuedMove, StaffCardPlay, StaffProfile,
  Act, Apology, Bar, AccountListener, Tail, ActKind, Alert, ContactLink, SeasonFinished, SeasonNewsItem, SeasonRecordRow, SeasonResultRow, TallyName, SeasonShown, Update, UpdateChange, Answer, AvatarUpload, Bought, Board, BoardListener, BoardSummary, CardEvent, PackEvent, Character, CharacterCounts, Office, ClassReveal, CreatedCharacter, DebutLoudness, EffectState, PlayMoment,
  DebutTiming, Estimate, EstimateLine, FollowedThread, Frame, HeldCard, Id, KayfaApi, LogShare, MyCharacter, MyInvite, MyReaction, PendingTurn, Preferences, PreferencesPatch, Refusal,
  Boot, BoardPage, IndexPage, Opened, AdminSlot, Slot, SlotMove, ProfilePage, RecordPage, ThreadPage, ThreadPerson, MyCharactersPage, SeasonPage, AlertsPage, UpdatesPage, QueuePage, LogPage,
  AdminAward, AdminKind, BeltCursor, BeltPage, BeltReign, RandomEvent, ShownTrophy, TrophyAwardFailure, TrophyCursor, TrophyItem, TrophyPage, WardrobeItem,
  PostHit, ThreadHit, SearchCursor, SearchPage, SearchQuery, SearchSort, Suggestions,
  AppealResult, AppealVerdict, LogAppeal, LogBan, LogCosmetic, LogGroupMove, LogInfraction, LogReport, ReportResult, ReportVerdict, Visit, VisitBand, VisitCharge, VisitEnd, VisitOutcome, VisitStory,
  Presence, PresencePlace, ReachListener, ScreenSettings, Season, Session, Standing, Tally, ThreadListener, ThreadSummary, OriginPlace, PlaceOn, TurnAnnounced, Wallet, WalletEvent,
} from './api.ts';

/** The tour's tips, which `replayTour` forgets alone: the engine's one list, which the SQL's replay_tour is held to (engine/ui/tips/keys.test.ts). */
const TOUR_TIPS: readonly string[] = TOUR_KEYS;

/** When a seasoned account (`Seed.account`) saw the welcome: fixed, so nothing about it moves with a scene's clock. */
const SEASONED_WELCOME = '2026-10-01T00:00:00.000Z';

/** The code `verifyCode` accepts for any address. */
export const TEST_CODE = '123456';

const CODE_MESSAGE = 'If this address can sign in here, a code and a link to sign in are on their way to it. A new login needs an invite where this instance asks for one. If nothing comes in a few minutes, ask again.';
const ALREADY_PUBLIC = 'that character\'s class is already public; after a Turn, the new class can be revealed';
const SYSTEM_BOARD = 'only the staff post here; spin a thread from what they said';
const MINUTE = 60_000;
const DAY = 86_400_000;
export const START = Date.UTC(2026, 9, 29, 12);

export interface LiveEvent {
  readonly topic: string;
  readonly event: 'act' | 'tally' | 'thread' | 'effect' | 'card_text' | 'alert' | 'news' | 'settled';
}

export interface Seed {
  /**
   * An account. `joinedAt` is when the account was opened (accounts.created_at); a seeded player was here before anything seeded, unless a
   * test says when they joined. `seasoned` makes its player a veteran of the forum: the welcome seen (at a fixed time, so a scene does not
   * move with the clock) and every onboarding tip seen, so no spotlight or tour waits on the board. Tips stay 'on'.
   */
  account(name: string, options?: { email?: string; admin?: boolean; joinedAt?: number; seasoned?: boolean }): Id;
  admin(account: Id, on?: boolean): void;
  /** A character of an account; debuted unless said otherwise. */
  character(account: Id, name: string, cls: string, options?: { debuted?: boolean; retired?: boolean; loudness?: DebutLoudness; at?: number; pronouns?: PronounSet }): Id;
  retire(character: Id): void;
  /** A thread with its first Act; a null character is The System's, on its board only. */
  thread(board: string, character: Id | null, title: string, body?: string, options?: SeedAct): { thread: Id; act: Id };
  post(thread: Id, character: Id | null, body: string, options?: SeedAct & { quote?: Id }): Id;
  /** A reaction, refused in the server's words like any other. */
  react(account: Id, character: Id, act: Id, kind: string): void;
  /**
   * A settlement: debuts the waiting characters, applies the waiting Turns (class history starts
   * then, so the cooldown does) but for one whose character revealed at or after `at`, which waits for the next (0074), writes its ledger lines with their shares, credits each account's
   * wallet with its lines' sum as apply_settlement does (held to the cap and the floor, with a wallet
   * event saying what either cut off) and adds each character's to its standing, sets the wallets (by
   * account) and standings (by character) given outright, and dates `lastSettledAt`. Each part can be
   * left out. Its window runs from the last settlement's end, or one settlement's length before `at`.
   * `sharesKept: false` is a settlement made before shares were kept (0034), which carries none. A
   * line's shares add up to it, and an account's wallet is credited by its lines or set, never both.
   */
  settle(options: {
    at?: number; wallet?: Readonly<Record<Id, number>>; standings?: Readonly<Record<Id, number>>; debut?: boolean; turns?: boolean;
    ledger?: readonly SeedLine[]; sharesKept?: boolean;
  }): void;
  season(season: Partial<Season>): void;
  nextSettlementAt(at: number | null): void;
  views(thread: Id, count: number): void;
  /** Gives a card, set or spring a place number in its thread, as a play written before 0035 held one: the number is the fake's only legacy shape, for tests that read a play's place. */
  legacyNumber(act: Id): void;
  /**
   * An alert the writers of the Acts would have written for `account` (`write_alert`, 0058), of a kind that is not read from the Acts
   * themselves: a trap struck or sprung, a hint, a ruling. A quote and a card on the account's post, character or thread are alerts
   * here as the Acts that make them are (a post that quotes theirs, a card played on theirs by another player), so seeding either
   * is refused. `act` is the Act it is about, `character` the account's character it concerns, `at` an epoch (else now).
   */
  alert(account: Id, alert: { kind: WrittenKind; act: Id; character?: Id; sub?: string; at?: number }): void;
  /**
   * A change of Boss at a season's roll-over (a `season_handovers` row, 0051): the outgoing Boss (null at the first) and the arriving one, by staff key,
   * dated `at` (else now). Season news then holds the Boss's arrival and departure, quoting the first post each wrote in the announcements thread dated
   * at exactly `at` (`staffPost`), as the server finds it; a later remark is not its words. A change of Boss is also a to-do in the admin queue
   * (`how` rotation unless said, `bossWas` the new Boss's office before, `outgoingOffice` member unless said), until an update is seeded or posted
   * after `at` or an admin dismisses it. The season is the next number: the first season is the seed's, and each handover opens the one after.
   */
  handover(handover: { outgoing?: string | null; boss: string; at?: number; how?: 'nomination' | 'rotation'; bossWas?: string | null; outgoingOffice?: string | null }): void;
  /**
   * An update by the developer persona (what `post_update` writes, 0062), dated `at` (else now): the developer character is made on its first
   * update, from the instance's persona (else the engine's plain one), and so is the updates thread on The System's board. Returns the Act.
   */
  update(update: { title: string; body: string; changes?: readonly UpdateChange[]; at?: number }): Id;
  /** The contact an admin set (`set_admin_contact`, 0081), past its admin check and held to its rules: a seed is the database's own hand. Refused in the server's words. */
  contact(links: readonly ContactLink[]): void;
  cards(account: Id, held: Readonly<Record<string, number>>): void;
  /** Copies of gear the account holds (`gear_ledger`), added to any it holds. */
  gear(account: Id, held: Readonly<Record<string, number>>): void;
  /** A standing award of a trophy kind (the instance's or an admin's) for a character, dated `at` (else now), by the season unless `by` says; returns its id. A belt's holder is the latest. */
  award(character: Id, trophy: string, options?: { at?: number; by?: 'season' | 'boss' | 'demand' | 'admin'; line?: string; move?: Id }): Id;
  /** The outcome of the next Random Event roll that comes past the window and the day's most, in place of the weighted draw; null is a roll that finds nothing. */
  nextEvent(event: { outcome: RandomEvent['outcome']; item?: string; line?: string } | null): void;
  /** An award that could not be written, as `trophyAwardFailures` lists it, for an admin to give by hand. */
  awardFailure(failure: Omit<TrophyAwardFailure, 'id' | 'open' | 'characters'> & { readonly characters: readonly { readonly id: Id; readonly name: string; readonly place?: number }[] | null }): Id;
  /** The account's settled wallet, as a purchase or a card play leaves it between settlements (`settle` sets it at one, and dates it). Writes no wallet event: it is the state the seed starts from. */
  wallet(account: Id, balance: number): void;
  /**
   * An invite the account made, dated `at` (else now), so a list of them can be seeded: `used` is one that someone registered with, which keeps no code a
   * page could show. It writes no Act and counts toward the account's open invites like a made one (`createInvite` is the action).
   */
  invite(account: Id, invite?: { at?: number; used?: boolean }): number;
  /** A purchase from the Vending Machine by an account, dated `at`: `buyCard` as that player from the card's on-sale slot, refused as it is, with its wallet event and card ledger row. */
  buy(account: Id, card: string, options?: { at?: number }): void;
  /**
   * An admin's change to the slot that sells a card or a pack (`item`): whether it is for sale, hidden or sold out, and its price in hundredths.
   * The machine reads it at once, as the database's rows are read at the next look. `move` is the Boss's move the slot shows (`Slot.move`):
   * the fake applies no move, so it only says what the machine shows beside it, and a test that draws a pulled slot seeds the availability
   * and price the move would have made as well (the database's `machine_now` has the move already applied to both).
   */
  slot(item: { readonly card: string } | { readonly pack: string }, change: { availability?: 'onSale' | 'soldOut' | 'hidden'; price?: number; move?: SlotMove | null }): void;
  /** A character's Turn asked by its player, waiting for the next settlement; refused in the server's words like any other. */
  turn(character: Id, to: string, options?: { loudness?: 'silent' | 'announced'; showFrom?: boolean; showTo?: boolean }): void;
  /** What the account's next estimate holds; its times are the ask's. */
  estimate(account: Id, estimate: { entries?: Estimate['entries']; lines?: readonly EstimateLine[] }): void;
  /** A character's unmask Act in a thread, as its player's reveal (`via` 'act') or a debut's or a Turn's. */
  reveal(character: Id, thread: Id, options?: { via?: ClassReveal['via']; class?: string; at?: number; message?: string }): Id;
  /**
   * An announce Act (0100) of a Turn of a character, in the thread: the character's own Act, naming the class it Turned from (`was`) and to (`class`)
   * where its player said so. `since` writes instead the tally of The System's that announced Turns before #23 and 0100, which the database still holds.
   */
  announceTurn(character: Id, thread: Id, options?: { was?: string; class?: string; since?: string; at?: number }): Id;
  /**
   * A character's announce Act (0100) in the Promos thread of the season open at `at` (else now), which this opens on the staff board where the
   * season has none. A debut names no `was`, and one that names its `class` is that class's reveal. Throws on a debut naming `was`; unlike the
   * guard, it does not check that `class` is the one the character holds, so a seed states what the board shows.
   */
  announce(character: Id, what: 'debut' | 'turn', options?: { was?: string; class?: string; at?: number }): Id;
  /**
   * A season's results as they landed (`season_results`, 0099): one frozen row per character, `name` as it was then (else the character's now),
   * dated `at` (else now). The fake never ends a season itself; this is the state its end would have left. Written once: a second call for the
   * season throws, as the table refuses an edit.
   */
  seasonResults(season: number, rows: readonly { character: Id; name?: string; place: number; standing: number; shown?: readonly SeasonShown[] }[], options?: { at?: number }): void;
  avatar(character: Id, urls: { square?: string; portrait?: string }): void;
  /** A tally on an Act as if that many others had reacted, kind by kind: no one's reaction (no account or character stands behind it), only the counts every reader sees. */
  tally(act: Id, counts: Readonly<Record<string, number>>): void;
  /** A staff character (a Boss or a Mod Bot): debuted, owned by no player, with no class; it acts only through the seed below. */
  staff(key: string, name: string, office: 'boss' | 'mod' | 'member' | 'benched', options?: { title?: string; signature?: string; at?: number; debuted?: boolean; pronouns?: PronounSet }): Id;
  /** A staff member's career as `staff_career` would return it (default: none). */
  career(key: string, career: Career): void;
  /** A staff member's in-character profile, a version at `at` (the latest is the one read). */
  staffProfile(key: string, profile: { interests?: readonly string[]; favorites?: readonly Id[]; mood?: string; signature?: string; at?: number }): void;
  /** A staff character's post in a thread (The System's board for the Boss; any board for a persona's pool post, which presence lists it for). */
  staffPost(staff: Id, thread: Id, body: string, options?: { at?: number; ruling?: { readonly verdict: 'accepted' | 'rejected'; readonly apology: Id } }): Id;
  /**
   * A conferGroup move that has landed (what `apply_mod_move`/`apply_meeting` write): `staff` moved `character` into `group` (a key of the instance's groups), barring it from `board` (a
   * slug; absent: no bar). It asks for an accepted apology (`apologyAccepted`) and runs to `expiresAt` (default three days on; null: it has no end date). Returns the move's Act.
   */
  /** The Boss's trophy award, landed: a move Act of kind awardTrophy (no demand; it ends at once in the real thing, which the notice does not need). */
  trophyMove(staff: string, move: { readonly character: Id; readonly trophy: string; readonly body?: string; readonly at?: number }): Id;
  groupMove(staff: string, move: { readonly office?: 'boss' | 'mod' | null; readonly character: Id; readonly group: string; readonly board?: string; readonly body?: string; readonly at?: number; readonly expiresAt?: number | null; readonly demand?: boolean }): Id;
  /** A staff character's office changes (a handover, a reassignment): moves it made before keep the office stamped on them. */
  setOffice(staff: string, office: 'boss' | 'mod' | 'member' | 'benched'): void;
  /** An apology a character wrote to a move (`apologize`): the spin Act is written as the server writes it, and the row is in `state` (default `pending`) from `at`. Returns the row's apology Act. */
  apology(character: Id, move: Id, state?: 'pending' | 'accepted' | 'rejected' | 'returned', options?: { at?: number }): Id;
  /**
   * A landed move: the Boss's `move` Act in a thread of The System's board (the first thread there is used, or one is made), as the
   * tick writes it. A rename takes the board's slug; the demand's board is the same board unless the demand names another.
   */
  move(staff: string, move: SeedMove): Id;
  /** A move's end, as end_move writes it: the board's old name returns. */
  endMove(act: Id, end: { why: 'met' | 'expired' | 'reversed' | 'superseded' | 'spent'; by?: string; at?: number }): Id;
  /** The new Boss keeps a move of an earlier Boss after a handover (a `move_keep` Act): the move's log row says who keeps it. */
  keepMove(act: Id, staff: string, options?: { at?: number }): Id;
  /** A move the Boss chose that waits in the admin queue; returns its queue id. */
  queueMove(staff: string, move: SeedMove & { goLiveAt: number; why?: string; failure?: { at: number; text: string }; refusal?: { at: number; text: string } }): number;
  /** A nomination of a successor waiting in the admin queue (`boss` is a roster key); returns its queue id. */
  queueSuccessor(staff: string, boss: string, options: { goLiveAt: number; why?: string }): number;
  /** An admin's hold on a queued move, dated `at`: it never lands. */
  holdQueued(id: number, at?: number): void;
  /**
   * A card play by a character on an Act, in the Act's own thread (what a player's play makes; the cards plan makes the real action).
   * With `paid`, its player's card ledger records the play at that price and the wallet pays it, as `play_card` does (a wallet event
   * where it is more than 0); without, the play is an Act alone, held and paid for nowhere. With `unrecorded`, it is a play from before
   * moments were snapshotted (0072): its moment is not taken.
   */
  card(character: Id, target: Id, card: string, options?: { message?: string; config?: Readonly<Record<string, unknown>>; at?: number; live?: boolean; layer?: number; paid?: number; caught?: Id; ends?: string; unrecorded?: boolean; spring?: Id; tokens?: number }): Id;
  /**
   * A card played beyond a post (what `play_card` writes for a reach, 0055): on a character (from `post`, one of its posts), a thread or
   * a board, its Act where play_card puts it and its play_reach row ending at `ends` (an epoch, else the card's lasts cut to its reach's
   * bound). Held and paid for nowhere. Returns the play's Act.
   */
  reach(character: Id, reach: BeyondPost, target: Id, card: string, options?: { post?: Id; at?: number; ends?: number; message?: string; config?: Readonly<Record<string, unknown>>; live?: boolean }): Id;
  /**
   * A card set face down by a character on a post of its own (what `set_card` writes): a set Act naming no card, and the setter's own
   * record of which card it is. Returns the set Act.
   */
  set(character: Id, target: Id, card: string, options?: { at?: number }): Id;
  /** The spring of a set (what `spring_traps` writes): a spring Act on its post naming the card, and `caught` where it caught a play. Returns the spring Act. */
  spring(set: Id, options?: { trigger?: string; caught?: Id; by?: Id; at?: number }): Id;
  /**
   * A Mod's visit to a post, as `start_visit` writes it (the Mod Bots design, section 6): the `visit` Act, ending `endsInMs` from now (default 3 hours)
   * with `charges` (default one minor breach of Rule 2) and a `challenge`. A quiz's `answer` is the fake's alone, never carried to a reader.
   */
  visit(mod: Id, post: Id, options?: { at?: number; endsInMs?: number; line?: string; charges?: readonly SeedCharge[]; challenge?: SeedChallenge }): Id;
  /** A visit's end (`end_visit`): filed, intercepted, trapped or reversed, with the Act that ended it where one did. */
  visitEnd(visit: Id, end: { outcome: VisitOutcome; by?: Id; line?: string; at?: number }): Id;
  /** A character's report of a post (`open_report`), with its reason. */
  report(character: Id, post: Id, reason: string, options?: { at?: number }): Id;
  /** A Mod's verdict on a report (`close_report`): the visit it sent, where it sent one. */
  verdict(report: Id, mod: Id, verdict: 'visit' | 'dismissed' | 'backfire', options?: { line?: string; visit?: Id; at?: number }): Id;
  /** The infraction a visit's filing wrote (`infract`) against its post's author, dropping off at `expiresAt` (default two weeks on). */
  infraction(visit: Id, options?: { points?: number; band?: VisitBand; ruleNumber?: number | null; expiresAt?: number; at?: number }): Id;
  /** A character's appeal of an infraction or of a group move on it (`open_appeal`), and the staff member's ruling on it (`until`: the end a ruling sets, as on a ban). */
  appeal(character: Id, infraction: Id, plea: string, options?: { at?: number }): Id;
  ruling(appeal: Id, mod: Id, verdict: 'overturned' | 'upheld' | 'reduced' | 'increased', options?: { line?: string; at?: number; until?: number }): Id;
  /** The ban a full bar writes (`infract`): the character is banned until `until` (an Act of no character, as the server writes it), and its bar is emptied. */
  ban(character: Id, until: number, options?: { days?: number; infraction?: Id; at?: number }): Id;
  /** What the next report or appeal is answered with (the Mod's judgment, which the fake does not make): a report's verdict, an appeal's ruling. The defaults are `dismissed` and `upheld`. */
  judging(answers: { readonly report?: ReportVerdict | 'failed'; readonly appeal?: AppealVerdict | 'failed' }): void;
  /** A saved card effect on a thread's play, heard by its subscribers. */
  effect(thread: Id, play: Id): void;
  /**
   * What a writing play made for a version of its post (`finish_card_write`, 0149): its row (`text`, or `failed`), the waiting job it ends, and
   * the `card_text` event on the post's thread, which carries the play and the version alone. A play of a card whose rules `write` is
   * queued at the post's version when it lands, and again at each edit, as the server does; this delivers what the model made, later.
   * `quiet` keeps the event back (a screen that was not listening), so a test can see the row without it. A failure of a play's first
   * generation, with no newer job waiting, refunds it as the server does: the play is over and its Act reads `untaken` from then (`acts_public`,
   * 0149); a failure of a regeneration of a play that made a text before refunds nothing, and a play already over takes no text.
   */
  text(play: Id, version: Id, result: { readonly text: string } | { readonly failed: true }, options?: { readonly quiet?: boolean }): void;
  /**
   * The next post, edit or spin gets no answer, as when the network drops: it answers with an
   * uncertain refusal. `went` says whether the server did it before the answer was lost.
   */
  loseNextAnswer(went: boolean): void;
}

/** A charge a seeded visit carries. */
export interface SeedCharge { readonly rule?: string; readonly ruleNumber?: number | null; readonly band?: VisitBand; readonly cause?: VisitCharge['cause'] }
/** A seeded visit's challenge; a quiz's `answer` is one of its `choices`. */
export type SeedChallenge =
  | { readonly kind: 'quiz'; readonly question: string; readonly choices: readonly string[]; readonly answer: string }
  | { readonly kind: 'bribe'; readonly price: number }
  | { readonly kind: 'distraction' };

/** A settled ledger line a seed writes: one reason's amount for one character, and its shares, which add up to it. */
export interface SeedLine {
  readonly character: Id;
  readonly reason: string;
  readonly amount: number;
  /** The numbers its reason's words state, as the settlement wrote them into its ledger row (`ledger.params`, 0073). */
  readonly params?: Readonly<Record<string, number | string>>;
  readonly shares?: readonly { readonly act: Id; readonly quadrant?: LogShare['quadrant']; readonly amount: number }[];
}

/** A rename a seed lands or queues: the board by slug, its new name, subject and description, and the demand it carries. */
export interface SeedMove {
  readonly board: string;
  readonly name: string;
  readonly premise?: string;
  readonly description?: string;
  /** The Boss's stock line. */
  readonly body?: string;
  /** A kind and its params; a `board` slug in the params becomes the board's id. Omitted: the move asks nothing. */
  readonly demand?: { readonly kind: string; readonly params: Readonly<Record<string, unknown>> };
  /** Epoch milliseconds. */
  readonly at?: number;
  readonly expiresAt?: number;
  /** The tick has not counted its demand yet: its progress carries no count and no time (the server's `{checkedAt: null}`). */
  readonly uncounted?: boolean;
}

interface SeedAct {
  readonly at?: number;
  /** For The System's Acts: `tally` (default), `reveal`, or `post` (an Act written with no character, a post the staff's word names). */
  readonly kind?: 'tally' | 'reveal' | 'post';
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface Fake extends KayfaApi {
  signInAs(account: Id | null): void;
  emailOf(account: Id): string;
  readonly clock: { now(): number; advance(ms: number): void };
  readonly broadcast: {
    /** Every event the server would have sent, held or not. */
    readonly log: readonly LiveEvent[];
    /** Keep the events sent from now instead of delivering them. */
    hold(): void;
    /** Deliver the held events, and stop holding; returns how many were held. */
    flush(options?: { reverse?: boolean; twice?: boolean }): number;
    /**
     * How many listeners hear `reach` now. A screen subscribes in an effect, which React may run after the screen is already drawn, and an
     * event sent before it subscribes is lost (as a real Realtime event would be), so a test that sends one waits for the listener it means.
     */
    reachListeners(): number;
  };
  readonly seed: Seed;
  /** Always `KAYFA_FAKE_BACKEND`: what the bundle guard finds if the fake ever reaches a production build. */
  readonly marker: string;
}

interface CharRec {
  readonly id: Id;
  readonly owner: Id;
  readonly name: string;
  readonly createdAt: number;
  debutedAt: number | null;
  retiredAt: number | null;
  loudness: DebutLoudness;
  /** Each class it has held and when it began; `dueAt`, where a reveal made that class's Turn wait past the settlement it was due at (0074). */
  readonly history: { cls: string; at: number; dueAt?: number }[];
  /** `dueAt`: the first settlement that passed the Turn over (0074); a Turn asked again is a new one, with none. */
  pending: (PendingTurn & { asked: number; dueAt?: number }) | null;
  /** Hidden from every presence box (presence_hidden, 0041). */
  presenceHidden: boolean;
  title: string;
  signature: string;
  pipStyle: string;
  pronouns: PronounSet;
  square: string | null;
  portrait: string | null;
  squareFrame: Frame | null;
  portraitFrame: Frame | null;
  portraitTallness: number | null;
  /** gear_worn: the pieces it wears, in layer order. */
  outfit: Piece[];
  /** trophies_shown: the awards its postbit shows, in order. */
  shown: Id[];
  /** Set for a staff character. */
  staff?: { readonly key: string; readonly office: Office };
}
interface ActRec {
  readonly id: Id;
  readonly order: number;
  readonly character: Id | null;
  readonly kind: ActKind;
  readonly thread: Id;
  readonly target: Id | null;
  readonly seq: number | null;
  readonly at: number;
  readonly payload: Readonly<Record<string, unknown>>;
}
interface ThreadRec { readonly id: Id; readonly board: Id; readonly title: string; readonly origin: Id | null; readonly at: number; nextSeq: number }
interface AccountRec {
  readonly id: Id;
  readonly email: string;
  /** When the account was opened (accounts.created_at, 0001): a mark never set counts from here (0066). */
  readonly createdAt: number;
  admin: boolean;
  prefs: Preferences;
  wallet: number;
  cards: Record<string, number>;
  /** gear_ledger counted by gear: the copies the account holds. */
  gear: Record<string, number>;
  /** random_event_rolls: when it last rolled, and the Random Events it has had. */
  rolledAt: number | null;
  eventsAt: number[];
  reading: Map<Id, number>;
  /** The account's follow choices over the default (thread_follows, 0059). */
  follows: Map<Id, boolean>;
  estimate: { entries: Estimate['entries']; lines: readonly EstimateLine[] };
  asked: Estimate | null;
}
interface InviteRec { readonly id: number; readonly owner: Id; code: string; readonly createdAt: number; issuedAt: number; usedBy: Id | null }

const refuse = (error: string, field?: string): Refusal => (field === undefined ? { ok: false, error } : { ok: false, error, field });
const ok = <T,>(value: T): Answer<T> => ({ ok: true, value });
const iso = (ms: number) => new Date(ms).toISOString();
/** A `my_cosmetic_log` row with nothing said: each kind fills what it uses. */
const NO_COSMETIC = { character: null, outcome: null, item: null, text: null, copies: null, trophy: null, name: null, by: null, byName: null, season: null, place: null, line: null, toName: null } as const;
/** The kinds of Act that take no place in a thread (`acts_take_seq`, supabase/migrations/0109): an edit, a card's marks and the Mod Bots' meta acts. */
const UNPLACED: ReadonlySet<ActKind> = new Set<ActKind>(['edit', 'card', 'set', 'take_back', 'spring', 'card_end', 'visit', 'visit_join', 'visit_end', 'report', 'report_verdict', 'intercept', 'infraction', 'ban', 'appeal', 'appeal_ruling']);

/** The methods that are not a promise of something: everything else is made one. */
const NOT_PROMISED = new Set(['onSession', 'subscribeThread', 'subscribeBoard', 'subscribeAccount', 'subscribeReach']);
type Sync<T> = { [K in keyof T]: T[K] extends (...a: infer A) => Promise<infer R> ? (...a: A) => R : T[K] };

/**
 * The string tools/check-web-bundle.mjs looks for in the production bundle. It is a value on the
 * object createFake returns, not an export nothing reads, because a bundler drops an unused
 * export and keeps a property of an object that is built.
 */
export const FAKE_BACKEND_MARKER = 'KAYFA_FAKE_BACKEND';
export function createFake(options: { instance: Instance; settings?: Partial<ScreenSettings>; now?: () => number }): Fake {
  /* A screen's economy (ScreenSettings.economy) is laid over the instance's, as economyNow does, never in place of it: a world given the
     web's fallback, which holds none, keeps the compiled numbers. */
  const settings: Settings = { ...options.instance.settings, ...options.settings, economy: { ...options.instance.settings.economy, ...options.settings?.economy } };
  const instance: Instance = { ...options.instance, settings };
  const screen: ScreenSettings = {
    pronouns: settings.pronouns,
    postsPerPage: settings.postsPerPage, searchLanguage: settings.searchLanguage, searchRankPool: settings.searchRankPool, hotReplies: settings.hotReplies, editGrace: settings.editGrace, reactionCap: settings.reactionCap,
    charactersPerPlayer: settings.charactersPerPlayer, invitesPerPlayer: settings.invitesPerPlayer, inviteLifetime: settings.inviteLifetime,
    turnCooldown: settings.turnCooldown, walletCap: settings.walletCap, postMaxLength: settings.postMaxLength, titleMaxLength: settings.titleMaxLength,
    registrationMode: settings.registrationMode, settlementLength: settings.settlementLength, cardSettings: settings.cardSettings,
    presencePollSeconds: settings.presencePollSeconds, presenceWindow: settings.presenceWindow, toastDefaults: settings.toastDefaults,
    /* What screen_settings's groups holds (0128): the ladder lowest first, then the groups a move confers. */
    groups: options.settings?.groups ?? [...options.instance.groups.ladder.map((g) => ({ key: g.key, name: g.name, ...(g.badge !== undefined ? { badge: g.badge } : {}), color: g.color, stripe: g.stripe === true, staff: g.when.kind === 'staff' })), ...options.instance.groups.conferred.map((g) => ({ key: g.key, name: g.name, ...(g.badge !== undefined ? { badge: g.badge } : {}), color: g.color, stripe: g.stripe === true, staff: false }))],
    ...(options.settings?.toastMs === undefined ? {} : { toastMs: options.settings.toastMs }),
    /* What screen_settings's cardEconomy holds (0039): the economy this backend prices with, cut to what the cards' prices read. */
    cardEconomy: Object.fromEntries(Object.entries(settings.economy).filter(([key]) => instance.cards.some((c) => (c.reads ?? []).some((r) => (typeof r === 'string' ? r : r.key) === key)))),
    /* What screen_settings's economy holds (0073): the whole economy row. */
    economy: settings.economy,
  };

  /* ----------------------------------------------------------------------- time ---- */
  let offset = 0;
  const base = options.now ?? (() => START);
  const now = () => base() + offset;
  const span = (s: Span) => s.count * (s.unit === 'minute' ? MINUTE : s.unit === 'hour' ? 60 * MINUTE : s.unit === 'day' ? DAY : s.unit === 'week' ? 7 * DAY : 30 * DAY);

  let counter = 0;
  const uuid = () => `00000000-0000-4000-8000-${(++counter).toString(16).padStart(12, '0')}`;

  /* ---------------------------------------------------------------------- state ---- */
  const accounts = new Map<Id, AccountRec>();
  const byEmail = new Map<string, Id>();
  const characters = new Map<Id, CharRec>();
  /** trophy_awards and trophy_reversals (0151): an award stands until `reversed`. */
  const awards: { id: Id; trophy: string; character: Id; at: number; by: 'season' | 'boss' | 'demand' | 'admin'; line: string | null; season: number | null; move: Id | null; reversed: boolean; reversedAt?: number }[] = [];
  /** What `my_cosmetic_log` reads beside the awards: the finds of Random Events and the gear an admin gave, each of one account, newest last. */
  const cosmeticEvents: { account: Id; ms: number; row: LogCosmetic }[] = [];
  /** The kinds an admin made (`make_trophy`), beside the instance's own. */
  const madeKinds: { key: string; name: string; line: string | null; belt: boolean; art: string | null }[] = [];
  /** The Random Events a test scripted (`Seed.nextEvent`), taken in order before the weighted draw; null is a roll that finds nothing. */
  const scripted: (Pick<RandomEvent, 'outcome'> & { item?: string; line?: string } | null)[] = [];
  const awardFailures: (Omit<TrophyAwardFailure, 'open' | 'characters'> & { characters: readonly { readonly id: Id; readonly name: string; readonly place?: number }[] | null })[] = [];
  /** trophy_failure_resolutions: `${failure}:${character}` for each award an admin gave by hand. */
  const failureGiven = new Set<string>();
  const acts = new Map<Id, ActRec>();
  /** Moves whose demand the tick has not counted (SeedMove.uncounted). */
  const uncounted = new Set<Id>();
  const threads = new Map<Id, ThreadRec>();
  const reactions: { act: Id; account: Id; character: Id; kind: string }[] = [];
  const invites: InviteRec[] = [];
  const pendingInvite = new Map<string, string | null>();
  const views = new Map<Id, number>();
  /** Presence (0041): one row per character, written only by that character's own polls. */
  const presence = new Map<Id, { kind: PresencePlace['kind']; place: Id | null; board: Id | null; placeSince: number; onlineSince: number; seenAt: number }>();
  const standingOf = new Map<Id, number>();
  /** `season_results` and the season's `results_at` (0099), by season number: written once, as the season ended. */
  const results = new Map<number, { at: number; rows: readonly SeasonResultRow[] }>();
  const seasons: Season[] = [{ id: 1, number: 1, startsAt: iso(START), endsAt: null, turnsThread: null, revealAct: null }];
  let lastSettled: number | null = null;
  let nextSettlement: number | null = null;
  const boards: Board[] = options.instance.boards.map((b) => ({ id: uuid(), slug: b.slug, name: b.name, description: b.description, isSystem: b.system === true, moveAct: null }));
  /* Moves: how each landed move ended, the staff profiles (versions, newest read), and the admin queue's own rows. */
  /** An admin's descriptions in the order given (`describe` Acts): the board, the rename each names (or none), the words. */
  const describes: { board: Id; moveAct: Id | null; text: string }[] = [];
  /** The apologies barred characters wrote (`apologies`, 0129). */
  const apologies: { move: Id; apology: Id; character: Id; state: 'pending' | 'accepted' | 'rejected' | 'returned'; at: number }[] = [];
  const moveEnds = new Map<Id, { why: 'met' | 'expired' | 'reversed' | 'superseded' | 'spent' | 'overturned'; by: string; at: number }>();
  const careers = new Map<string, Career>();
  const staffProfiles: { key: string; at: number; interests: string[]; favorites: Id[]; mood: string; signature: string }[] = [];
  interface QueueRec { id: number; staff: string; successor?: string; move: SeedMove; why: string; goLiveAt: number; failure: { at: number; text: string } | null; refusal?: { at: number; text: string }; heldAt: number | null; landed: Id | null; replacedAt?: number; adminDescription?: string }
  const queue: QueueRec[] = [];
  /** The staff key of the Boss that keeps each move after a handover, by the move's Act. */
  const moveKeeps = new Map<Id, string>();
  const playersBoard = boards.find((b) => !b.isSystem);
  /* The developer persona and its updates thread (0062), made at the first update; the board never lists that thread. */
  let developerId: Id | null = null;
  let updatesThreadId: Id | null = null;

  let session: { email: string | null; account: Id | null } = { email: null, account: null };
  const sessionListeners = new Set<(s: Session) => void>();
  const sessionNow = (): Session => ({ signedIn: session.email !== null, account: session.account });
  const setSession = (next: typeof session) => {
    session = next;
    const snapshot = sessionNow();
    const heard = [...sessionListeners];
    queueMicrotask(() => { for (const l of heard) l(snapshot); });
  };
  const me = () => (session.account === null ? null : accounts.get(session.account) ?? null);

  /* ----------------------------------------------------------------------- live ---- */
  const threadListeners = new Map<Id, Set<ThreadListener>>();
  const boardListeners = new Map<Id, Set<BoardListener>>();
  const accountListeners = new Map<Id, Set<AccountListener>>();
  const reachListeners = new Set<ReachListener>();
  const log: LiveEvent[] = [];
  let held: (() => void)[] | null = null;
  let muted = false;
  const send = (topic: string, event: LiveEvent['event'], deliver: () => void) => {
    if (muted) return;
    log.push({ topic, event });
    if (held) held.push(deliver);
    else queueMicrotask(deliver);
  };
  const sendAct = (act: ActRec) => {
    const shown = publicAct(act);
    send(`thread:${act.thread}`, 'act', () => { for (const l of [...(threadListeners.get(act.thread) ?? [])]) l.onAct?.(shown); });
    /* The alert the write queued (write_alert, 0058), announced to the target's account alone: none for a staff or unowned target, or
       for the account that did it. */
    const alert = derivedAlert(act);
    if (alert === null) return;
    const live = { id: crypto.randomUUID(), kind: alert.kind, sub: null, act: act.id, character: alert.character, at: iso(act.at) };
    send(`account:${alert.account}`, 'alert', () => { for (const l of [...(accountListeners.get(alert.account) ?? [])]) l.onAlert?.(live); });
  };
  /**
   * The alert an Act writes, read from the Act as `write_alert`'s callers do: a quote of a post, or a card on a post, a character or a
   * thread, for the owner of what it landed on. Null for a staff target, a spring, and a target of the Act's own account.
   */
  function derivedAlert(a: ActRec): { account: Id; kind: 'quote' | 'cardOnYours' | 'cardEnded'; character: Id } | null {
    /* An admin ended a card: the alert is the caster's own player's, about the card_end (reverse_card's write_alert); none for a staff caster. */
    if (a.kind === 'card_end') {
      const caster = a.target === null ? undefined : acts.get(a.target)?.character;
      const owner = caster == null ? undefined : characters.get(caster)?.owner;
      return caster == null || !owner ? null : { account: owner, kind: 'cardEnded', character: caster };
    }
    if (a.character === null) return null;
    let kind: 'quote' | 'cardOnYours';
    let target: Id | null | undefined;
    if (a.kind === 'post' && a.target !== null) {
      const quoted = acts.get(a.target);
      if (quoted?.kind !== 'post') return null;
      kind = 'quote'; target = quoted.character;
    } else if (a.kind === 'card' && a.target !== null && a.payload.spring === undefined) {
      const reach = (a.payload.reach ?? 'post') as string;
      kind = 'cardOnYours';
      target = reach === 'post' ? acts.get(a.target)?.character
        : reach === 'character' ? String(a.payload.character)
        : reach === 'thread' ? [...acts.values()].find((x) => x.thread === a.payload.thread && x.seq === 1)?.character : null;
    } else return null;
    const owner = target == null ? undefined : characters.get(target)?.owner;
    if (owner == null || owner === characters.get(a.character)?.owner) return null;
    return { account: owner, kind, character: target! };
  }
  /* A play beyond a post is also heard on `reach` by every signed-in page (act/core.ts's BROADCASTS.play_card). */
  const sendReach = (act: ActRec) => {
    if (act.payload.reach !== 'character' && act.payload.reach !== 'thread' && act.payload.reach !== 'board') return;
    const shown = publicAct(act);
    send('reach', 'effect', () => { for (const l of [...reachListeners]) l.onPlay?.(shown); });
  };
  /* An update is announced on `reach` to every signed-in page as it is written (news_announce, 0063); a seed is the database's own hand and says nothing. */
  const sendNews = (a: ActRec) => {
    const news = { kind: 'update' as const, sub: null, act: a.id, at: iso(a.at) };
    send('reach', 'news', () => { for (const l of [...reachListeners]) l.onNews?.(news); });
  };
  /* A settlement applied is announced on `reach` to every signed-in page (settlement_announce, 0063): its id and time, nothing of any player's. */
  const sendSettled = (id: number, at: number) => {
    const settled = { id: String(id), at: iso(at + APPLIED_AFTER) };
    send('reach', 'settled', () => { for (const l of [...reachListeners]) l.onSettled?.(settled); });
  };
  const sendThread = (t: ThreadRec) => {
    const shown = { id: t.id, board: t.board, title: t.title, originActId: t.origin, createdAt: iso(t.at) };
    send(`board:${t.board}`, 'thread', () => { for (const l of [...(boardListeners.get(t.board) ?? [])]) l.onThread?.(shown); });
  };

  /* ---------------------------------------------------------------- projections ---- */
  const edits = (post: ActRec) => [...acts.values()].filter((a) => a.kind === 'edit' && a.target === post.id).sort((a, b) => a.at - b.at || a.order - b.order);

  function publicAct(a: ActRec): Act {
    const latest = a.kind === 'post' ? edits(a).at(-1) : undefined;
    return {
      id: a.id, character: a.character, kind: a.kind, thread: a.thread, targetActId: a.target, seq: a.seq, createdAt: iso(a.at), payload: a.payload,
      currentPayload: latest?.payload ?? a.payload,
      editedAt: latest ? iso(latest.at) : null,
      shownEditedAt: latest && latest.at > a.at + span(settings.editGrace) ? iso(latest.at) : null,
      ...(untakenPlays.has(a.id) ? { untaken: true as const } : {}),
    };
  }

  /** Whether the account follows the thread: its choice, else whether one of its characters started it (following_thread, 0059). */
  const follows = (account: AccountRec, threadId: Id): boolean => {
    const chosen = account.follows.get(threadId);
    if (chosen !== undefined) return chosen;
    const opening = placed(threadId)[0];
    return opening?.character != null && characters.get(opening.character)?.owner === account.id;
  };
  /** The answer a seeded quiz visit holds (never carried to a reader), and its question and choices, by visit. */
  const visitQuizzes = new Map<Id, { readonly question: string; readonly choices: readonly string[]; readonly answer: string }>();
  const visitEndOf = (e: ActRec): VisitEnd => ({ act: e.id, at: iso(e.at), outcome: e.payload.outcome as VisitOutcome, byAct: (e.payload.by_act as Id | undefined) ?? null, line: (e.payload.line as string | undefined) ?? '' });
  /** A visit as `thread_page` carries it: its charges (the start's and each join's), its challenge without an answer, and its end. */
  function visitOf(v: ActRec): Visit {
    const c = v.payload.challenge as { kind: string; price?: number };
    const quiz = visitQuizzes.get(v.id);
    const end = [...acts.values()].find((a) => a.kind === 'visit_end' && a.target === v.id);
    const joins = [...acts.values()].filter((a) => a.kind === 'visit_join' && a.target === v.id).sort((a, b) => a.order - b.order).map((a) => a.payload.charge as Record<string, unknown>);
    return {
      id: v.id, post: v.target!, mod: v.character!, at: iso(v.at), endsAt: v.payload.ends_at as string, line: (v.payload.line as string | undefined) ?? '',
      charges: [...(v.payload.charges as Record<string, unknown>[]), ...joins].map((x): VisitCharge => ({ rule: (x.rule as string | undefined) ?? null, ruleNumber: (x.rule_number as number | null | undefined) ?? null, band: x.band as VisitBand, cause: x.cause as VisitCharge['cause'] })),
      challenge: c.kind === 'quiz' && quiz ? { kind: 'quiz', question: quiz.question, choices: quiz.choices } : c.kind === 'bribe' ? { kind: 'bribe', price: c.price ?? 0 } : { kind: 'distraction' },
      end: end ? visitEndOf(end) : null,
      ...((r) => (r ? { ruling: r } : {}))(rulingOnVisit(v.id)),
    };
  }
  /** The verdict of the appeal heard on the infraction a visit filed (thread_page's `ruling`), or undefined. */
  function rulingOnVisit(visit: Id): AppealVerdict | undefined {
    const inf = [...acts.values()].find((a) => a.kind === 'infraction' && a.payload.visit_act === visit);
    const appeal = inf ? [...acts.values()].find((a) => a.kind === 'appeal' && a.target === inf.id) : undefined;
    const ruling = appeal ? [...acts.values()].find((a) => a.kind === 'appeal_ruling' && a.target === appeal.id) : undefined;
    return ruling?.payload.verdict as AppealVerdict | undefined;
  }
  /** Each of these posts' latest visit (`vis` in thread_page). */
  const visitsOn = (posts: readonly Id[]): Visit[] => posts.flatMap((p) => {
    const latest = [...acts.values()].filter((a) => a.kind === 'visit' && a.target === p).sort((a, b) => b.order - a.order)[0];
    return latest ? [visitOf(latest)] : [];
  });
  const placed = (threadId: Id) => [...acts.values()].filter((a) => a.thread === threadId && a.seq !== null).sort((a, b) => a.seq! - b.seq!);

  /** The account's followed threads with posts past its place by characters it does not own, newest first, at most 50 (my_followed_threads, 0059). */
  function followedFor(account: AccountRec): FollowedThread[] {
    const out: FollowedThread[] = [];
    for (const t of threads.values()) {
      if (!follows(account, t.id)) continue;
      const past = placed(t.id).filter((a) => a.kind === 'post' && a.seq! > (account.reading.get(t.id) ?? 0) && a.character !== null && characters.get(a.character)?.owner !== account.id);
      if (past.length === 0) continue;
      out.push({ thread: t.id, board: t.board, title: t.title, newPosts: Math.min(past.length, FOLLOWED_COUNT_CAP), newestAt: iso(Math.max(...past.map((a) => a.at))) });
    }
    return out.sort((a, b) => Date.parse(b.newestAt) - Date.parse(a.newestAt)).slice(0, 50);
  }

  /** Where an Act is found, as an Act's own post or update place: an update, else a post with a place number, else nowhere. */
  const placeOf = (a: ActRec | undefined): Extract<PlaceOn, { kind: 'post' | 'update' }> | null =>
    !a ? null
    : a.kind === 'update' ? { kind: 'update', act: a.id, title: String(a.payload['title']) }
    : a.seq !== null ? { kind: 'post', thread: a.thread, title: threads.get(a.thread)!.title, seq: a.seq }
    : null;

  /** A spun thread's origin place, by the rules of thread_open's origin_place (0079), in order: none; an update; a play (kind first, so a numbered card is one) with its card (null for a set) and its target; any Act with a place number. */
  function originPlace(origin: ActRec): OriginPlace | null {
    if (origin.kind === 'update') return placeOf(origin);
    if (origin.kind === 'card' || origin.kind === 'set' || origin.kind === 'spring') {
      const card = origin.kind === 'set' ? null : String(origin.payload['card']);
      const beyond = reachPlays.get(origin.id);
      let on: PlaceOn | null;
      if (beyond) {
        const named = beyond.reach === 'character' ? characters.get(beyond.target) : undefined;
        on = beyond.reach === 'character' ? { kind: 'character', id: beyond.target, name: named?.debutedAt != null ? named.name : null }
          : beyond.reach === 'thread' ? { kind: 'thread', id: beyond.target, title: threads.get(beyond.target)!.title }
          : { kind: 'board', slug: boards.find((b) => b.id === beyond.target)!.slug, name: boards.find((b) => b.id === beyond.target)!.name };
      } else {
        // A play with no play_reach row is on a post (0079 joins the target post only then; every beyond-post play has a reach row).
        on = origin.target !== null ? placeOf(acts.get(origin.target)) : null;
      }
      return { kind: 'play', card, on };
    }
    return origin.seq !== null ? placeOf(origin) : null;
  }

  function summary(t: ThreadRec): ThreadSummary {
    const all = placed(t.id);
    const first = all[0];
    const last = all.at(-1);
    const week = now() - 7 * DAY;
    const origin = t.origin === null ? undefined : acts.get(t.origin);
    // The greatest time of any placed (non-edit) Act, as threads.last_at is; the creation time with none, since lastAt is not null here.
    return {
      id: t.id, board: t.board, title: t.title, originActId: t.origin, createdAt: iso(t.at), lastAt: iso(all.length ? Math.max(...all.map((a) => a.at)) : t.at), lastSeq: t.nextSeq - 1,
      replies: all.filter((a) => a.kind === 'post' && a.seq! > 1).length,
      firstAct: first?.id ?? null, firstCharacter: first?.character ?? null, lastAct: last?.id ?? null, lastCharacter: last?.character ?? null,
      // Capped at the hotReplies threshold, as thread_list counts it: a screen only compares it with that.
      repliesThisWeek: Math.min(settings.hotReplies, all.filter((a) => a.kind === 'post' && a.seq! > 1 && a.at > week && a.at <= now()).length),
      originThread: origin?.thread ?? null, origin: origin ? originPlace(origin) : null,
    };
  }

  const classAt = (c: CharRec, at: number) => [...c.history].reverse().find((h) => h.at <= at)?.cls ?? c.history[0]!.cls;
  const classNow = (c: CharRec) => c.history.at(-1)!;
  const lastTurn = (c: CharRec) => (c.history.length > 1 ? c.history.at(-1)!.at : null);
  const turnOpens = (c: CharRec) => {
    const at = lastTurn(c);
    return at === null || at + span(settings.turnCooldown) <= now() ? null : at + span(settings.turnCooldown);
  };
  const takesEffectAt = () => (nextSettlement === null ? null : iso(nextSettlement));

  /** The points of a character's infractions that have not dropped off (the seeds write no ban, so none resets the bar). */
  const warnOf = (id: Id): number => [...acts.values()].reduce((n, a) => (a.kind === 'infraction' && a.payload.character === id && Date.parse(a.payload.expires_at as string) > Date.now() ? n + (a.payload.points as number) : n), 0);
  /** When a character's latest running ban ends, or null (banned_until, 0109): a ban's end, an appeal's ruling on it read in its place. */
  const bannedUntilOf = (id: Id): number | null => {
    let latest: number | null = null;
    for (const a of acts.values()) {
      if (a.kind !== 'ban' || a.payload.character !== id) continue;
      const ruling = [...acts.values()].find((r) => r.kind === 'appeal_ruling' && typeof r.payload.until === 'string' && acts.get(r.target ?? '')?.target === a.id);
      const until = Date.parse((ruling?.payload.until ?? a.payload.until) as string);
      if (until > now() && (latest === null || until > latest)) latest = until;
    }
    return latest;
  };
  function publicCharacter(c: CharRec): Character {
    return {
      id: c.id, name: c.name, title: c.title, signature: c.signature, avatarSquare: c.square, avatarPortrait: c.portrait, squareFrame: c.squareFrame,
      portraitFrame: c.portraitFrame, portraitTallness: c.portraitTallness, outfit: c.outfit.map((o) => ({ ...o })), trophies: shelf(c.id), pipStyle: c.pipStyle, pronouns: c.pronouns,
      joined: `${iso(c.debutedAt!).slice(0, 7)}-01`,
      ...(warnOf(c.id) > 0 ? { warnPoints: warnOf(c.id) } : {}),
      ...(bannedUntilOf(c.id) !== null ? { bannedUntil: iso(bannedUntilOf(c.id)!) } : {}),
      ...(c.staff ? { staff: c.staff.key, office: c.staff.office } : {}),
      group: groupOf(c),
    };
  }
  /** The group a character is in: the highest rung it holds (a conferred group is the moves' business, not this fake's). */
  function groupOf(c: CharRec): string {
    const posts = [...acts.values()].filter((a) => a.kind === 'post' && a.character === c.id).length;
    return earnedGroup(instance.groups.ladder, { posts, seasons: 0, staff: c.staff !== undefined && c.staff !== null });
  }

  /* ---------------------------------------------------------------------- moves ---- */
  /** The moves in force, newest first: a landed `move` Act with no end. */
  const inForce = () => [...acts.values()].filter((a) => a.kind === 'move' && !moveEnds.has(a.id)).sort((a, b) => b.at - a.at || b.order - a.order);
  /** The boards a character is barred from posting on now (bars_now, less a move past its expiry that the tick has not ended). */
  /** When a move ends by itself (`move_expires_at`): the latest appeal ruling's `until`, else the move's own expiry; null for a move with no end of its own. */
  const moveEndsAt = (a: ActRec): string | null => {
    const ruled = [...acts.values()].filter((r) => r.kind === 'appeal_ruling' && typeof r.payload['until'] === 'string' && acts.get(r.target ?? '')?.target === a.id).sort((x, y) => y.at - x.at)[0];
    return typeof ruled?.payload['until'] === 'string' ? ruled.payload['until'] : typeof a.payload['expires_at'] === 'string' ? a.payload['expires_at'] : null;
  };
  const barsOf = (character: Id): Bar[] => inForce().filter((a) => {
    const params = (a.payload['params'] ?? {}) as Record<string, unknown>;
    const end = moveEndsAt(a);
    return a.payload['kind'] === 'conferGroup' && params['character'] === character && typeof params['board'] === 'string' && (end === null || Date.parse(end) > now());
  }).map((a): Bar => {
    const params = a.payload['params'] as Record<string, unknown>;
    return { board: String(params['board']), move: a.id, group: String(params['group']), expiresAt: moveEndsAt(a) };
  });
  const apologyEveryMs = (): number => 3_600_000 * (settings.apology.apologyEveryHours);
  /** A board as it is called now: its latest rename in force, else its own row (boards_now). */
  function boardNow(b: Board): Board {
    const m = inForce().find((a) => a.payload['kind'] === 'renameBoard' && (a.payload['params'] as Record<string, unknown>)['board'] === b.id);
    /* The latest describe naming the open rename (or, with none open, naming no move), else the rename's own words, else the board's. */
    const said = describes.filter((d) => d.board === b.id && d.moveAct === (m?.id ?? null)).at(-1)?.text;
    if (!m) return said === undefined ? b : { ...b, description: said };
    const p = m.payload['params'] as Record<string, unknown>;
    return { ...b, name: String(p['name']), description: said ?? String(p['description'] ?? b.description), moveAct: m.id };
  }

  /** A seeded rename's params and demand as a move Act carries them: boards by id. */
  const moveParams = (m: SeedMove) => ({
    board: boards.find((b) => b.slug === m.board)?.id ?? m.board, name: m.name, premise: m.premise ?? `The subject of ${m.name}`, description: m.description ?? `About ${m.name}`,
  });
  const moveDemand = (m: SeedMove): Demand | null => {
    if (!m.demand) return null;
    const named = m.demand.params['board'];
    return { kind: m.demand.kind, params: { ...m.demand.params, ...(typeof named === 'string' ? { board: boards.find((b) => b.slug === named)?.id ?? named } : {}) } };
  };
  /** The first thread of The System's board, made when there is none: where the Boss's moves are written. */
  function announcements(): Id {
    const board = boards.find((b) => b.isSystem);
    if (!board) throw new Error('the instance has no System board');
    const found = [...threads.values()].find((t) => t.board === board.id && t.id !== updatesThreadId);
    return found ? found.id : openThread(board.id, 'Announcements', null).id;
  }
  const staffId = (key: string): Id => {
    const c = [...characters.values()].find((x) => x.staff?.key === key);
    if (!c) throw new Error(`no staff member ${key}`);
    return c.id;
  };

  /**
   * `move_progress`, as demand_progress counts it: characters, posts and tallies after the landing, never a staff character's, never players.
   * The server stores the tick's count and says when it was counted; the fake counts as it is asked and says it counted just now, unless
   * the seed said the move was never counted (`uncounted`).
   */
  function progressOf(move: ActRec): { done?: number; of?: number; met?: boolean; checkedAt: string | null } {
    if (uncounted.has(move.id)) return { checkedAt: null };
    return { ...countOf(move), checkedAt: iso(now()) };
  }
  function countOf(move: ActRec): { done: number; of: number; met: boolean } {
    const demand = toDemand(move.payload['demand']);
    if (!demand) return { done: 0, of: 0, met: false };
    const p = demand.params;
    const after = [...acts.values()].filter((a) => a.kind === 'post' && a.at > move.at && a.character !== null && !characters.get(a.character)?.staff);
    const onBoard = (a: ActRec) => threads.get(a.thread)?.board === p['board'];
    const count = (n: number) => Math.max(1, Math.trunc(Number(n)));
    switch (demand.kind) {
      case 'postsOnBoard': { const of = count(p['count'] as number); const have = after.filter(onBoard).length; return { done: Math.min(have, of), of, met: have >= of }; }
      case 'distinctCharactersOnBoard': { const of = count(p['count'] as number); const have = new Set(after.filter(onBoard).map((a) => a.character)).size; return { done: Math.min(have, of), of, met: have >= of }; }
      case 'quadrantOnBoard': {
        const of = count(p['count'] as number);
        const have = after.filter(onBoard).reduce((sum, a) => sum + Object.entries(tallyOf(a.id)).reduce((n, [kind, c]) => n + (instance.reactions.find((r) => r.key === kind)?.quadrant === p['quadrant'] ? c : 0), 0), 0);
        return { done: Math.min(have, of), of, met: have >= of };
      }
      case 'characterPostsInThread': { const have = after.some((a) => a.thread === p['thread'] && a.character === p['character']) ? 1 : 0; return { done: have, of: 1, met: have === 1 }; }
      /* The fake does not count quotes: a crossQuote reads as not begun. */
      default: return { done: 0, of: 2, met: false };
    }
  }

  const demandOf = (id: Id): Demand | null => toDemand(acts.get(id)?.payload['demand']);

  const tallyOf = (act: Id): Tally => {
    const counts: Record<string, number> = {};
    for (const r of reactions) if (r.act === act) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    return counts;
  };

  /* -------------------------------------------------------------------- updates ---- */
  /** The developer persona's staff character, made when it is first needed: the instance's persona, else the engine's plain one (seed_instance, 0062). */
  function developer(): CharRec {
    if (developerId !== null) return characters.get(developerId)!;
    const persona = options.instance.developer ?? DEFAULT_DEVELOPER;
    const at = now();
    const c: CharRec = {
      id: uuid(), owner: '', name: persona.name, createdAt: at, debutedAt: at, retiredAt: null, loudness: 'silent', history: [{ cls: '', at }], pending: null, presenceHidden: false,
      title: persona.tagline.slice(0, 40), signature: '', pipStyle: options.instance.pipStyles[0]?.key ?? 'default',
      pronouns: persona.pronouns ?? settings.pronouns,
      square: null, portrait: null, squareFrame: null, portraitFrame: null, portraitTallness: null, outfit: [], shown: [], staff: { key: 'developer', office: 'developer' },
    };
    characters.set(c.id, c);
    developerId = c.id;
    return c;
  }
  /** The updates thread on The System's board, which no list of that board holds. */
  function updatesThread(): ThreadRec {
    if (updatesThreadId !== null) return threads.get(updatesThreadId)!;
    const board = boards.find((b) => b.isSystem);
    if (!board) throw new Error('the instance has no System board');
    updatesThreadId = openThread(board.id, 'Updates', null).id;
    return threads.get(updatesThreadId)!;
  }
  /* A board's list leaves out the updates thread and an old season's reveal thread (thread_list, 0063, 0099); the Promos thread is listed. thread() opens any of them by id (thread_open). */
  const seasonThreads = (): Set<Id> => new Set(seasons.map((s) => (s.revealAct === null ? null : acts.get(s.revealAct)?.thread ?? null)).filter((x): x is Id => x !== null));
  const listed = (t: ThreadRec) => t.id !== updatesThreadId && !seasonThreads().has(t.id);
  /** `within` (0005): text that is something and no longer than the setting, in the server's words. */
  const within = (field: string, value: string, most: number): string | null =>
    /^[\s\u200b-\u200d\u2060]*$/u.test(value) ? `${field} is empty` : [...value].length > most ? `${field} is longer than ${most} characters` : null;
  const contactEdge = new RegExp(`^[${CONTACT_WS}]+|[${CONTACT_WS}]+$`, 'gu');
  const contactSpaced = new RegExp(`[${CONTACT_WS}]`, 'u');
  /** How players reach the admins (the setting `adminContact`); none until an admin sets it. */
  let contact: readonly ContactLink[] = [];
  /**
   * set_admin_contact (0081) past its admin check, as the SQL repairs and refuses: whitespace trimmed, an empty row and keys that are no part of a link dropped, a bare email
   * (`name@host.tld`, with no scheme, slash, query or space) made `mailto:`; refused, in the SQL's words, naming the row (counted as typed, an empty row too): a label or
   * address with no partner, a label over 40 characters, an address over 300 or with a space or control character, an address that is neither `https://host` nor
   * `mailto:name@host`, and a sixth link. An input that looks like an email but carries a scheme (`javascript:a@b`) is no bare email and is refused as an address.
   */
  function writeContact(links: unknown): Answer<readonly ContactLink[]> {
    const rows = links == null ? [] : links;
    if (!Array.isArray(rows)) return refuse(`the contact is a list of { label, href }, not a ${typeof rows}`);
    const fixed: ContactLink[] = [];
    for (const [i, row] of rows.entries()) {
      const n = i + 1;
      if (row === null || typeof row !== 'object' || Array.isArray(row)) return refuse(`row ${n} is { label, href }, not a ${row === null ? 'null' : Array.isArray(row) ? 'array' : typeof row}`);
      const e = row as Record<string, unknown>;
      if (e['label'] != null && typeof e['label'] !== 'string') return refuse(`row ${n} has a label that is text`);
      if (e['href'] != null && typeof e['href'] !== 'string') return refuse(`row ${n} has an address that is text`);
      const label = String(e['label'] ?? '').replace(contactEdge, '');
      let href = String(e['href'] ?? '').replace(contactEdge, '');
      if (label === '' && href === '') continue;
      if (href === '') return refuse(`row ${n} has a label and no address; give it an address, or leave the row out`);
      if (label === '') return refuse(`row ${n} has an address and no label; give it a label, or leave the row out`);
      if (label.replace(/[\u200b-\u200d\u2060\ufeff]/gu, '') === '') return refuse(`row ${n} has a label with something visible in it, not only zero-width characters`);
      if ([...label].length > CONTACT_LABEL_MAX) return refuse(`row ${n} has a label of at most ${CONTACT_LABEL_MAX} characters`);
      if ([...href].length > CONTACT_HREF_MAX) return refuse(`row ${n} has an address of at most ${CONTACT_HREF_MAX} characters`);
      if (contactSpaced.test(href)) return refuse(`row ${n} has an address with no spaces or control characters in it`);
      if (/^[^@:/?#]+@[^@:/?#]+\.[^@:/?#]+$/.test(href)) href = `mailto:${href}`;
      if (!(/^https:\/\/[^/?#@]+([/?#]|$)/i.test(href) || /^mailto:[^@:/?#]+@[^@:/?#]+$/i.test(href))) return refuse(`row ${n} has an address that is https: or mailto: (a bare email is made mailto:)`);
      if (fixed.length >= CONTACT_MOST) return refuse(`the contact holds at most ${CONTACT_MOST} links, and row ${n} is one too many`);
      fixed.push({ label, href });
    }
    contact = fixed;
    return ok(fixed);
  }
  /** One update, with the persona that wrote it (the `updates` read). */
  function updateOf(a: ActRec): Update {
    const c = characters.get(a.character!)!;
    return {
      act: a.id, thread: a.thread, character: c.id, name: c.name, tagline: c.title, pronouns: c.pronouns, avatar: (options.instance.developer ?? DEFAULT_DEVELOPER).avatar ?? null,
      title: String(a.payload['title']), body: String(a.payload['body']), changes: a.payload['changes'] as UpdateChange[], at: iso(a.at), seq: a.seq!,
    };
  }
  /* ------------------------------------------------------------------ season news ---- */
  /** The Boss changes the fake's seeds hold (`season_handovers`, 0051): who left, who arrived, and when. */
  const handovers: { readonly outgoing: string | null; readonly boss: string; readonly at: number; readonly how: string; readonly bossWas: string | null; readonly outgoingOffice: string | null }[] = [];
  /** The seasons whose to-do an admin dismissed (`handover_dismissals`). */
  const dismissedTodos = new Set<number>();
  /** The to-dos the admin queue holds: each change of Boss with no update after it and no dismissal, newest first (admin_queue's `todos`). */
  function handoverTodos(): HandoverTodo[] {
    const latest = updateActs()[0]?.at ?? -Infinity;
    return handovers.flatMap((h, i): HandoverTodo[] => {
      const season = i + 2;
      if (h.outgoing === h.boss || latest > h.at || dismissedTodos.has(season)) return [];
      return [{
        season, boss: h.boss, bossName: staffByKey(h.boss)?.name ?? h.boss, bossPronouns: staffByKey(h.boss)?.pronouns ?? settings.pronouns, bossWas: h.bossWas, outgoing: h.outgoing, outgoingName: h.outgoing === null ? null : staffByKey(h.outgoing)?.name ?? h.outgoing,
        outgoingPronouns: (h.outgoing === null ? undefined : staffByKey(h.outgoing)?.pronouns) ?? settings.pronouns,
        outgoingOffice: h.outgoing === null ? null : h.outgoingOffice, how: h.how, landedAt: iso(h.at),
      }];
    }).reverse();
  }
  const staffByKey = (key: string) => [...characters.values()].find((c) => c.staff?.key === key);
  /** The first post of a staff member in the announcements thread dated at the handover's instant: what the Boss said as it came or went (a later remark is not it). */
  function bossPost(key: string, at: number): ActRec | undefined {
    const who = staffByKey(key);
    if (!who) return undefined;
    const board = boards.find((b) => b.isSystem);
    const home = board ? [...threads.values()].find((t) => t.board === board.id && t.id !== updatesThreadId && !seasonThreads().has(t.id)) : undefined;
    return [...acts.values()].filter((a) => a.kind === 'post' && a.character === who.id && a.thread === home?.id && a.at === at).sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0))[0];
  }
  const names = (v: unknown): TallyName[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []).map((e) => ({
    character: String(e['character']), name: String(e['name']), class: typeof e['class'] === 'string' ? e['class'] : null, was: typeof e['was'] === 'string' ? e['was'] : null }));
  /** A character's past seasons (profile_page, record_page, 0099): its row in each season's results, by when they landed and then number, newest first, at most 50. */
  const seasonsOf = (id: Id): SeasonRecordRow[] => [...results.entries()].sort(([x, a], [y, b]) => b.at - a.at || y - x).flatMap(([season, r]) => {
    const row = r.rows.find((x) => x.character === id);
    return row ? [{ season, place: row.place, standing: row.standing, at: iso(r.at) }] : [];
  }).slice(0, 50);
  /** The final table's order (`season_results_by_place`): place, then name, then character. */
  const resultOrder = (rows: readonly SeasonResultRow[]): SeasonResultRow[] =>
    [...rows].sort((x, y) => x.place - y.place || (x.name < y.name ? -1 : x.name > y.name ? 1 : 0) || (x.character < y.character ? -1 : x.character > y.character ? 1 : 0));
  /** `season_news` (0063, 0099, 0100) over what the fake holds: a results item from each season's rows, each landing of announce Acts and each old tally with names, the Boss's arrival and farewell. */
  function newsItems(): SeasonNewsItem[] {
    const out: SeasonNewsItem[] = [];
    const base = { act: null, thread: null, seq: null, name: null, quote: null, count: null, top: [], debuts: [], turns: [] } as const;
    for (const [season, r] of results) out.push({ ...base, kind: 'results', at: iso(r.at), season, count: r.rows.length, top: resultOrder(r.rows).slice(0, 3) });
    for (const a of acts.values()) {
      if (a.kind !== 'tally') continue;
      const debuts = names(a.payload['debuts']);
      const turns = names(a.payload['turns']);
      if (debuts.length + turns.length === 0) continue;
      out.push({ ...base, kind: 'tally', act: a.id, thread: a.thread, seq: a.seq, at: iso(a.at), season: Number(a.payload['season'] ?? 0), count: debuts.length + turns.length, debuts, turns });
    }
    /* A landing is the announce Acts of one thread at one instant (news_landed, 0100): its item names the first, counts them all and lists the first 20 names, debuts then Turns. */
    const landings = new Map<string, ActRec[]>();
    for (const a of [...acts.values()].filter((x) => x.kind === 'announce').sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0) || x.order - y.order)) {
      const key = `${a.thread}|${a.at}`;
      landings.set(key, [...(landings.get(key) ?? []), a]);
    }
    for (const group of landings.values()) {
      const first = group[0]!;
      const entry = (a: ActRec): TallyName => ({ character: a.character!, name: characters.get(a.character!)?.name ?? '', class: typeof a.payload['class'] === 'string' ? a.payload['class'] : null, was: typeof a.payload['was'] === 'string' ? a.payload['was'] : null });
      const named = group.slice(0, 20);
      out.push({
        ...base, kind: 'tally', act: first.id, thread: first.thread, seq: first.seq, at: iso(first.at), season: seasons.find((x) => x.turnsThread === first.thread)?.number ?? 0, count: group.length,
        debuts: named.filter((a) => a.payload['what'] === 'debut').map(entry), turns: named.filter((a) => a.payload['what'] === 'turn').map(entry),
      });
    }
    for (const h of handovers) {
      if (h.boss === h.outgoing) continue;
      const number = [...seasons].filter((s) => Date.parse(s.startsAt) <= h.at).sort((x, y) => y.number - x.number)[0]?.number ?? 1;
      const arrived = bossPost(h.boss, h.at);
      out.push({ ...base, kind: 'bossArrived', act: arrived?.id ?? null, thread: arrived?.thread ?? null, seq: arrived?.seq ?? null, at: iso(h.at), season: number, name: staffByKey(h.boss)?.name ?? h.boss, quote: arrived ? String(arrived.payload['body'] ?? '') : null });
      if (h.outgoing !== null) {
        const left = bossPost(h.outgoing, h.at);
        out.push({ ...base, kind: 'bossLeft', act: left?.id ?? null, thread: left?.thread ?? null, seq: left?.seq ?? null, at: iso(h.at), season: number - 1, name: staffByKey(h.outgoing)?.name ?? h.outgoing, quote: left ? String(left.payload['body'] ?? '') : null });
      }
    }
    return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || String(a.act ?? '').localeCompare(String(b.act ?? '')));
  }
  /** A page as `season_news` cuts it: the newest `most` older than `before`, with every item sharing the instant of the last. */
  function newsPage(before: string | null | undefined, most: number): SeasonNewsItem[] {
    const until = before == null ? Infinity : Date.parse(before);
    const older = newsItems().filter((n) => Date.parse(n.at) < until);
    const last = older[Math.min(most, older.length) - 1];
    return last === undefined ? [] : older.filter((n) => Date.parse(n.at) >= Date.parse(last.at));
  }
  const updateActs = () => [...acts.values()].filter((a) => a.kind === 'update').sort((a, b) => b.at - a.at || b.order - a.order);
  /**
   * post_update (0062) past its admin check, which `postUpdate` makes (a seed is the database's own hand): an update. The words are held as a post's are; the changes are repaired where they can be (the space
   * around words, a row with neither label nor text) and refused, naming the predicate and the change's number, where they cannot.
   */
  function writeUpdate(title: string, body: string, changes: readonly UpdateChange[], at: number | undefined): Answer<Update> {
    const bad = within('title', title, settings.titleMaxLength) ?? within('body', body, settings.postMaxLength);
    if (bad) return refuse(bad);
    const fixed: UpdateChange[] = [];
    for (const [i, c] of (changes ?? []).entries()) {
      const label = String(c?.label ?? '').replace(/^\s+|\s+$/g, '');
      const text = String(c?.text ?? '').replace(/^\s+|\s+$/g, '');
      if (label === '' && text === '') continue;
      if (text === '') return refuse(`change ${i + 1} has a label and no text; give it a text, or leave the row out`);
      fixed.push({ label, text });
    }
    if (fixed.length > 30) return refuse('an update lists at most 30 changes');
    for (const [i, c] of fixed.entries()) {
      if ([...c.label].length > 80) return refuse(`change ${i + 1} has a label of at most 80 characters`);
      if ([...c.text].length > 600) return refuse(`change ${i + 1} has a text of 1 to 600 characters`);
    }
    const written = write({ character: developer().id, kind: 'update', thread: updatesThread().id, payload: { title, body, changes: fixed }, at });
    return ok(updateOf(written));
  }

  /* -------------------------------------------------------------------- writing ---- */
  let order = 0;
  /** The time a seeded player's Act is dated, while the seed runs it through the action (the clock otherwise). */
  let stamp: number | null = null;
  function write(a: { id?: Id; character: Id | null; kind: ActKind; thread: Id; target?: Id | null; payload: Record<string, unknown>; at?: number }): ActRec {
    const t = threads.get(a.thread)!;
    /* An edit is a version of its post and a card is a tag on its post: neither takes a place in the thread (0035_card_takes_no_seq.sql). */
    const placedAct = !UNPLACED.has(a.kind);
    const rec: ActRec = {
      id: a.id ?? uuid(), order: ++order, character: a.character, kind: a.kind, thread: a.thread, target: a.target ?? null, seq: placedAct ? t.nextSeq++ : null,
      at: a.at ?? stamp ?? now(), payload: a.payload,
    };
    acts.set(rec.id, rec);
    if (rec.kind === 'card_end' && rec.target !== null) reversedPlays.add(rec.target);
    if ((rec.kind === 'card' || rec.kind === 'set' || rec.kind === 'spring') && rec.target !== null && onPost(rec)) takeMoment(rec);
    queueWrites(rec);
    return rec;
  }
  function openThread(board: Id, title: string, origin: Id | null, at?: number): ThreadRec {
    const t: ThreadRec = { id: uuid(), board, title, origin, at: at ?? stamp ?? now(), nextSeq: 1 };
    threads.set(t.id, t);
    return t;
  }

  /** The character as its player acts it, or the refusal acting() makes: the same words whoever owns it, or whether it exists. */
  function acting(through: Id): CharRec | Refusal {
    const account = me();
    const c = characters.get(through);
    if (!account) return refuse('sign in to act');
    if (!c || c.owner !== account.id) return refuse('you do not play that character');
    if (c.debutedAt === null) return refuse('that character debuts at the next settlement');
    if (c.retiredAt !== null) return refuse('that character is retired; an admin can restore it');
    return c;
  }
  /** presence_mask (0041): its player's, and debuted; a retired mask is not refused, its poll writing nothing. */
  function presenceMask(through: Id): CharRec | Refusal {
    const account = me();
    const c = characters.get(through);
    if (!account || !c || c.owner !== account.id) return refuse('you do not play that character');
    if (c.debutedAt === null) return refuse('that character debuts at the next settlement');
    return c;
  }
  /* The next write whose answer is lost (see `Seed.loseNextAnswer`). */
  let losing: { readonly went: boolean } | null = null;
  const lossy = <A extends unknown[], R>(run: (...a: A) => Answer<R>) => (...a: A): Answer<R> => {
    const lose = losing;
    if (!lose) return run(...a);
    losing = null;
    if (lose.went) run(...a);
    return { ok: false, error: LOST_ANSWER, uncertain: true };
  };
  const isRefusal = (x: unknown): x is Refusal => typeof x === 'object' && x !== null && (x as Refusal).ok === false;

  /** The Edge Function's reading of a request: signed in, then well formed. */
  function request(fields: Record<string, unknown>): Refusal | null {
    if (!me()) return refuse('sign in to act');
    const d = decide(fields, instance);
    return d.ok ? null : refuse(d.why, d.field);
  }

  function threadAndBoard(id: Id): { t: ThreadRec; board: Board } | Refusal {
    const t = threads.get(id);
    if (!t) return refuse('there is no such thread');
    return { t, board: boards.find((b) => b.id === t.board)! };
  }

  /**
   * write_framed (0118): for each distinct id among the first 5 of `framing`, a debuted character whose id the body holds as `user=<id>` (case ignored)
   * is told through write_alert's rules, which skip a staff character (no owner) and the acting account's own masks. Any other id is skipped silently.
   */
  function writeFramed(body: string, framing: readonly Id[] | undefined, act: ActRec) {
    const mine = me()?.id;
    const lowered = body.toLowerCase();
    for (const named of new Set((framing ?? []).slice(0, 5))) {
      const c = characters.get(named);
      if (!c || c.debutedAt === null || !lowered.includes(`user=${named.toLowerCase()}`)) continue;
      if (!c.owner || c.owner === mine) continue;
      seededAlerts.push({ account: c.owner, kind: 'framed', sub: null, act: act.id, character: named, at: act.at });
      const live = { id: crypto.randomUUID(), kind: 'framed' as const, sub: null, act: act.id, character: named, at: iso(act.at) };
      send(`account:${c.owner}`, 'alert', () => { for (const l of [...(accountListeners.get(c.owner) ?? [])]) l.onAlert?.(live); });
    }
  }

  function post(thread: Id, character: Id, body: string, quote: Id | null, framing?: readonly Id[]): Answer<Act> {
    const bad = request({ action: 'post', thread, character, body, quote, ...(framing ? { framing } : {}) });
    if (bad) return bad;
    const c = acting(character);
    if (isRefusal(c)) return c;
    const found = threadAndBoard(thread);
    if (isRefusal(found)) return found;
    if (found.board.isSystem) return refuse(SYSTEM_BOARD);
    if (quote !== null && !acts.has(quote)) return refuse('there is no such Act to quote');
    const written = write({ character, kind: 'post', thread, target: quote, payload: { body } });
    sendAct(written);
    writeFramed(body, framing, written);
    return ok(publicAct(written));
  }

  function startThread(boardSlug: string, character: Id, title: string, body: string, framing?: readonly Id[]): Answer<{ thread: ThreadSummary; act: Act }> {
    const bad = request({ action: 'startThread', board: boardSlug, character, title, body, ...(framing ? { framing } : {}) });
    if (bad) return bad;
    const c = acting(character);
    if (isRefusal(c)) return c;
    const board = boards.find((b) => b.slug === boardSlug);
    if (!board) return refuse('there is no such board');
    if (board.isSystem) return refuse(SYSTEM_BOARD);
    const t = openThread(board.id, title, null);
    const written = write({ character, kind: 'post', thread: t.id, payload: { body } });
    sendThread(t);
    sendAct(written);
    writeFramed(body, framing, written);
    return ok({ thread: summary(t), act: publicAct(written) });
  }

  function spin(origin: Id, character: Id, title: string, body: string, framing?: readonly Id[]): Answer<{ thread: ThreadSummary; act: Act }> {
    const bad = request({ action: 'spin', origin, character, title, body, ...(framing ? { framing } : {}) });
    if (bad) return bad;
    const c = acting(character);
    if (isRefusal(c)) return c;
    const from = acts.get(origin);
    if (!from || from.kind === 'edit') return refuse('there is no such Act to spin from');
    const home = boards.find((b) => b.id === threads.get(from.thread)!.board)!;
    const board = home.isSystem ? playersBoard! : home;
    const t = openThread(board.id, title, origin);
    const written = write({ character, kind: 'spin', thread: t.id, target: origin, payload: { title, body } });
    sendThread(t);
    sendAct(written);
    writeFramed(body, framing, written);
    return ok({ thread: summary(t), act: publicAct(written) });
  }

  function react(act: Id, character: Id, kind: string): Answer<{ act: Id; tally: Tally }> {
    const bad = request({ action: 'react', act, character, kind });
    if (bad) return bad;
    const c = acting(character);
    if (isRefusal(c)) return c;
    const target = acts.get(act);
    if (!target) return refuse('there is no such Act');
    if (target.kind === 'edit') return refuse('an edit is not reacted to; react to the post');
    const account = me()!;
    const author = target.character === null ? null : characters.get(target.character);
    if (author && author.owner === account.id) return refuse('your characters cannot react to each other');
    const mine = reactions.filter((r) => r.act === act && r.account === account.id);
    if (mine.some((r) => r.kind === kind)) return refuse('you have already left that reaction here');
    if (mine.length >= settings.reactionCap) return refuse(`you have left ${settings.reactionCap} reactions here, the most there are`);
    reactions.push({ act, account: account.id, character, kind });
    const tally = tallyOf(act);
    send(`thread:${target.thread}`, 'tally', () => { for (const l of [...(threadListeners.get(target.thread) ?? [])]) l.onTally?.(act, tally); });
    return ok({ act, tally });
  }

  /* --------------------------------------------------------------- a card that writes ---- */
  /** card_texts (0149): one row per play and version, the generation or its failure. */
  const texts: { play: Id; version: Id; text: string | null; at: number; order: number }[] = [];
  /** card_writes (0149): a play's waiting job, at the version it will continue; one per play, a newer version replacing it. */
  const jobs = new Map<Id, { post: Id; version: Id }>();
  const writes = (card: unknown): boolean => instance.cards.some((c) => c.key === card && c.writes !== undefined);
  /** A card Act that is a live writing play on a post (live_writing_plays): a card of the post's own reach that writes, no caught play, no ended one. */
  const writingPlay = (a: ActRec): boolean => a.kind === 'card' && a.target !== null && (a.payload.reach ?? 'post') === 'post' && a.payload.caught === undefined && writes(a.payload.card);
  /** The trigger on acts (card_writes_enqueue): a writing play queues its job at the post's version, an edit queues each live writing play on the post again. */
  function queueWrites(rec: ActRec) {
    if (rec.kind !== 'card' && rec.kind !== 'edit') return;
    if (writingPlay(rec)) jobs.set(rec.id, { post: rec.target!, version: edits(acts.get(rec.target!)!).at(-1)?.id ?? rec.target! });
    else if (rec.kind === 'edit' && rec.target !== null) {
      for (const k of acts.values()) if (writingPlay(k) && k.target === rec.target && !over(k.id)) jobs.set(k.id, { post: rec.target, version: rec.id });
    }
  }
  /** post_tails (0149): every row of every writing play on the posts, oldest version first, then each waiting job whose version has no row yet. */
  function tails(posts: readonly Id[]): Tail[] {
    if (new Set(posts).size > 200) throw new Error('tails are read for at most 200 posts at a time');
    const out: { row: Tail; vat: number; pat: number; order: number }[] = [];
    for (const post of new Set(posts)) {
      for (const k of acts.values()) {
        if (!writingPlay(k) || k.target !== post) continue;
        for (const x of texts.filter((t) => t.play === k.id)) {
          out.push({ row: { post, play: k.id, version: x.version, text: x.text, failed: x.text === null, waiting: false, createdAt: iso(x.at) }, vat: acts.get(x.version)!.at, pat: k.at, order: k.order });
        }
        const job = jobs.get(k.id);
        if (job && !texts.some((t) => t.play === k.id && t.version === job.version) && !over(k.id)) {
          out.push({ row: { post, play: k.id, version: job.version, text: null, failed: false, waiting: true, createdAt: null }, vat: acts.get(job.version)!.at, pat: k.at, order: k.order });
        }
      }
    }
    return out.sort((a, b) => a.vat - b.vat || a.pat - b.pat || a.order - b.order).map((x) => x.row);
  }

  /** The state a play's effect has saved, as effect_state keeps it: one row per play, the newest save. */
  const effects = new Map<Id, { state: unknown; at: number }>();
  /**
   * Each play on a post's moment, as play_moments and play_moment_layers keep it (0072): the post's version when it landed, and every
   * other layer then with what it had saved. Taken in `write`, as the trigger takes it on the Act's insert, so every path that lands a
   * play takes one: a cast, a Set, a spring, a seed.
   */
  const moments = new Map<Id, { version: Id; layers: readonly { layer: Id; saved: { state: unknown; at: number } | null }[] }>();
  function takeMoment(play: ActRec) {
    const post = acts.get(play.target!)!;
    const layers = [...acts.values()].filter((a) => a.id !== play.id && a.target === post.id && (a.kind === 'card' || a.kind === 'set' || a.kind === 'spring') && onPost(a))
      .map((a) => ({ layer: a.id, saved: effects.has(a.id) ? { ...effects.get(a.id)! } : null }));
    moments.set(play.id, { version: edits(post).at(-1)?.id ?? post.id, layers });
  }
  /** play_moment (0072): the moment's version as the post shows it then, the play and its layers, and the plays above live then. */
  function playMoment(id: Id): PlayMoment | null {
    const play = acts.get(id);
    if (!play || !(play.kind === 'card' || play.kind === 'set' || play.kind === 'spring') || play.target === null || !onPost(play)) return null;
    const post = acts.get(play.target);
    if (!post || post.kind !== 'post') return null;
    const m = moments.get(id);
    const version = m ? acts.get(m.version)! : edits(post).filter((e) => e.at <= play.at).at(-1) ?? post;
    const edited = version.kind === 'edit' ? version : null;
    const byLanding = (a: ActRec, b: ActRec) => a.at - b.at || a.order - b.order;
    const board = threads.get(post.thread)!.board;
    const wanted = new Set([id, ...(m?.layers ?? []).map((l) => l.layer)]);
    /* A play an admin had ended by the moment (a card_end at or before it) was not live then; one ended later was. */
    const endedBy = (p: Id) => [...acts.values()].some((a) => a.kind === 'card_end' && a.target === p && a.at <= play.at);
    return {
      version: {
        ...publicAct(post), currentPayload: version.payload, editedAt: edited ? iso(edited.at) : null,
        shownEditedAt: edited && edited.at > post.at + span(settings.editGrace) ? iso(edited.at) : null,
      },
      layers: [
        { act: publicAct(play), state: null },
        ...(m?.layers ?? []).map((l) => ({ rec: acts.get(l.layer)!, saved: l.saved })).sort((a, b) => byLanding(a.rec, b.rec))
          .map(({ rec, saved }) => ({ act: publicAct(rec), state: saved ? { state: saved.state, savedAt: iso(saved.at) } : null })),
        /* The card_end of the play or of one of its layers written at or before the moment (momentParts counts `<=` too), as 0092 gives. */
        ...[...acts.values()].filter((a) => a.kind === 'card_end' && a.target !== null && wanted.has(a.target) && a.at <= play.at)
          .sort(byLanding).map((a) => ({ act: publicAct(a), state: null })),
      ],
      above: [...reachPlays].filter(([p, r]) => r.endsAt > play.at && !endedBy(p) && acts.get(p)!.at < play.at
          && (r.reach === 'character' ? r.target === post.character : r.reach === 'thread' ? r.target === post.thread : r.target === board))
        .sort(([a], [b]) => byLanding(acts.get(a)!, acts.get(b)!))
        .map(([p, r]) => ({ play: p, reach: r.reach, target: r.target, endsAt: iso(r.endsAt), act: publicAct(acts.get(p)!) })),
      recorded: m !== undefined,
    };
  }
  /** The plays an account has released itself from, as "account play". */
  const releases = new Map<string, number>();
  /** The card plays an admin has ended (a `card_end` beside each, 0092): not in force, though the play and its layer stay. */
  const reversedPlays = new Set<Id>();
  /** The card plays whose first generation failed and were refunded (a row in card_write_refunds, 0149): over, as an ended play is, and public as `untaken`. */
  const untakenPlays = new Set<Id>();
  /** card_ended (0149): ended by an admin, or over because it did not take. Every reader of "in force" asks this. */
  const over = (play: Id): boolean => reversedPlays.has(play) || untakenPlays.has(play);
  /** What a refusal says of a play that is over because it did not take: the same plain words for every caller (0149), and no card named. */
  const DID_NOT_TAKE = 'That card didn\'t take, so there is nothing of it on this post.';
  /** The plays cut to a limit, as public Acts, and after them the `card_end` of each that has one (cardsOn, cardsOnMany): the ends ride in the same list. */
  const withEnds = (plays: readonly ActRec[]): Act[] => {
    const wanted = new Set(plays.filter((p) => p.kind === 'card').map((p) => p.id));
    const ends = [...acts.values()].filter((a) => a.kind === 'card_end' && a.target !== null && wanted.has(a.target)).sort((a, b) => a.at - b.at || a.order - b.order);
    return [...plays, ...ends].map(publicAct);
  };
  const playOf = (id: Id) => { const a = acts.get(id); return a && a.kind === 'card' ? a : null; };

  /* The player's log: the settlements' ledger with its shares, every wallet event and the card ledger, each by account (0003, 0006, 0034). */
  interface SettlementRec { readonly id: number; readonly startsAt: number; readonly endsAt: number; readonly sharesKept: boolean; readonly lines: readonly (LedgerLine & { readonly account: Id })[] }
  interface LedgerLine { readonly character: Id; readonly reason: string; readonly amount: number; readonly params?: Readonly<Record<string, number | string>>; readonly shares: readonly LogShare[] }
  const settlements: SettlementRec[] = [];
  const walletEvents: { readonly account: Id; readonly order: number; readonly event: WalletEvent; readonly ms: number }[] = [];
  const packLedger: { readonly account: Id; readonly order: number; readonly event: PackEvent; readonly ms: number }[] = [];
  const cardLedger: { readonly account: Id; readonly order: number; readonly event: CardEvent; readonly ms: number }[] = [];
  let logOrder = 0;
  const recordWallet = (account: Id, at: number, e: Omit<WalletEvent, 'at'>) => { walletEvents.push({ account, order: ++logOrder, ms: at, event: { ...e, at: iso(at) } }); };
  /*
   * The Vending Machine's slots (machine_slots, 0139_machine.sql), seeded from the instance in its order and changed only by `seed.slot`, as the
   * database keeps an admin's choices. Their ids are their own count, so the ids of everything else are as they were. A pack is rolled with a
   * fixed-seed generator: the fake is deterministic, and a test that wants other cards seeds the hand.
   */
  interface SlotRec { readonly id: Id; position: number; readonly item: Slot['item']; availability: 'onSale' | 'soldOut' | 'hidden'; price: number; move: SlotMove | null }
  const slotRecs: SlotRec[] = instance.machine.map((m, i): SlotRec => ({ id: `00000000-0000-4000-9000-${(i + 1).toString(16).padStart(12, '0')}`, position: i + 1, item: m.item, availability: m.availability, price: m.price, move: null }));
  let rolls = 0x9e3779b9;
  const random = (): number => { rolls = (rolls + 0x6d2b79f5) | 0; let t = Math.imul(rolls ^ (rolls >>> 15), 1 | rolls); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rarityOf = (item: Slot['item']): Slot['rarity'] => ('card' in item ? instance.cards.find((c) => c.key === item.card)?.rarity ?? null : null);
  const machine = (): Slot[] => slotRecs.filter((r) => r.availability !== 'hidden').sort((x, y) => x.position - y.position).map((r): Slot => ({
    id: r.id, position: r.position, item: r.item, rarity: rarityOf(r.item), availability: r.availability as Slot['availability'], price: r.price, move: r.move,
  }));
  /** A price as the server's refusals say it: hundredths of an orb as orbs (`orbs`, 0139). */
  const orbsOf = (hundredths: number): string => (hundredths / 100).toFixed(2);
  /** What is wrong with a slot's availability and price (`machine_apply_slot`, 0141), in the server's words, and which of the two. */
  function slotWords(availability: unknown, price: unknown): { readonly error: string; readonly field: 'availability' | 'price' } | null {
    if (availability !== 'onSale' && availability !== 'soldOut' && availability !== 'hidden') return { error: 'a slot is on sale, sold out or hidden', field: 'availability' };
    if (typeof price !== 'number' || !Number.isInteger(price) || price < 1) return { error: 'a price is at least 0.01', field: 'price' };
    if (price > 100000000) return { error: 'a price is at most 1000000.00', field: 'price' };
    return null;
  }
  /** The availability and price an admin sees on a slot: a Pull's sold out and a Boss's price are the Boss's, not the admin's. */
  const adminAvailability = (r: SlotRec): SlotRec['availability'] => (r.move?.kind === 'pullSlot' && r.availability === 'soldOut' ? 'onSale' : r.availability);
  const adminPrice = (r: SlotRec): number => (r.move ? r.move.was : r.price);
  /** Writes what an admin changed on a slot, and only what changed, so a Boss's move over it stays. True where a pack just left sale. */
  function applySlot(rec: SlotRec, availability: SlotRec['availability'], price: number): boolean {
    const was = adminAvailability(rec);
    if (availability !== was) rec.availability = availability;
    if (price !== adminPrice(rec)) {
      rec.price = price;
      if (rec.move) rec.move = { ...rec.move, was: price };
    }
    return 'pack' in rec.item && was === 'onSale' && availability !== 'onSale';
  }
  /** `card_in_open_pack` (0139): whether a pack on sale can still give the card. */
  function cardInOpenPack(card: string): boolean {
    const rules = instance.cards.find((c) => c.key === card);
    const rarity = rules?.rarity;
    /* A card the instance withholds is never rolled (roll_pack, 0149; packOdds), so no pack can give it. */
    if (!rules || !rarity || withheld(rules, instance.settings)) return false;
    return slotRecs.some((r) => {
      if (!('pack' in r.item) || r.availability !== 'onSale') return false;
      const key = r.item.pack;
      const pack = instance.packs.find((p) => p.key === key);
      return pack !== undefined && !(pack.leaves ?? []).includes(card) && pack.pulls.some((pull) => rarity in pull.weights);
    });
  }
  /** After a pack leaves sale: ends, as reversed by the admin, every Pull whose card is then in no pack on sale. Returns how many. */
  function endUnfloored(): number {
    let ended = 0;
    for (const r of [...slotRecs].sort((x, y) => x.position - y.position)) {
      const m = r.move;
      if (!m || m.kind !== 'pullSlot' || !('card' in r.item) || cardInOpenPack(r.item.card)) continue;
      const a = acts.get(m.act);
      if (a && a.kind === 'move' && !moveEnds.has(m.act)) {
        moveEnds.set(m.act, { why: 'reversed', by: 'admin', at: now() });
        write({ character: null, kind: 'move_end', thread: a.thread, target: m.act, payload: { why: 'reversed', by: 'admin' } });
      }
      r.availability = adminAvailability(r);
      r.move = null;
      ended += 1;
    }
    return ended;
  }
  /** `slot_for_sale` (0139): the slot as the machine shows it now, from the slot alone and in the same words for every caller, or a refusal. */
  function slotForSale(shown: Slot, wants: 'card' | 'pack'): SlotRec | Refusal {
    const seen = slotRecs.find((r) => r.id === shown.id && r.availability !== 'hidden');
    if (!seen) return refuse('the machine has no such slot');
    if (wants === 'card' && 'card' in seen.item) {
      const sold = instance.cards.find((c) => c.key === (seen.item as { card: string }).card);
      if (sold && withheld(sold, instance.settings)) return refuse(OLD_VOICE_OFF);
    }
    if (wants === 'card' && !('card' in seen.item)) return refuse('this slot sells a pack, not a card');
    if (wants === 'pack' && !('pack' in seen.item)) return refuse('this slot sells a card, not a pack');
    if (seen.availability === 'soldOut') return refuse('this slot is sold out');
    if (shown.price !== seen.price) return refuse(`the price is now ${orbsOf(seen.price)}, not ${orbsOf(shown.price)}`);
    return seen;
  }
  /** Whether a purchase is at a price the Boss moved: a Reprice in force whose result is not the admin's price (as buy_card and buy_pack, 0139, write it). */
  const movedPrice = (seen: SlotRec): boolean => seen.move?.kind === 'repriceSlot' && seen.price !== seen.move.was;
  const recordCard = (account: Id, at: number, e: Omit<CardEvent, 'at'>) => { cardLedger.push({ account, order: ++logOrder, ms: at, event: { ...e, at: iso(at) } }); };

  function saveEffect(play: Id, character: Id, state: Readonly<Record<string, unknown>>): Answer<{ play: Id; savedAt: string }> {
    const bad = request({ action: 'saveEffect', character, play, state });
    if (bad) return bad;
    const played = playOf(play);
    const mine = characters.get(character);
    /* The post's own player answers for the mask that wrote it, retired or not (0038); every other case is acting()'s. */
    const author = played !== null && acts.get(played.target!)?.character === character && mine !== undefined && mine.owner === me()?.id && mine.debutedAt !== null;
    if (!author) {
      const c = acting(character);
      if (isRefusal(c)) return c;
    }
    if (!played) return refuse('there is no such card on a post');
    if (acts.get(played.target!)?.character !== character) return refuse('only the post\'s author saves what is on it');
    if (reversedPlays.has(play)) return refuse('an admin ended that card');
    if (untakenPlays.has(play)) return refuse(DID_NOT_TAKE);
    const at = now();
    effects.set(play, { state, at });
    send(`thread:${played.thread}`, 'effect', () => { for (const l of [...(threadListeners.get(played.thread) ?? [])]) l.onEffect?.(play, iso(at)); });
    return ok({ play, savedAt: iso(at) });
  }

  function releaseEffect(play: Id): Answer<{ play: Id; releasedAt: string }> {
    const account = me();
    if (!account) return refuse('sign in to act');
    if (!playOf(play)) return refuse('there is no such card on a post');
    if (reversedPlays.has(play)) return refuse('an admin ended that card');
    if (untakenPlays.has(play)) return refuse(DID_NOT_TAKE);
    /* Kept from the first release. */
    const key = `${account.id} ${play}`;
    if (!releases.has(key)) releases.set(key, now());
    return ok({ play, releasedAt: iso(releases.get(key)!) });
  }

  /**
   * What a wallet debit refuses, in the words of `wallet_spend` (0006_cards.sql): the amounts are hundredths, as the server says them.
   * Returns the balance left, or the refusal.
   */
  function spend(account: AccountRec, amount: number, what: 'purchase' | 'play' | 'report' | 'appeal' | 'bribe', ref: Id | null): number | Refusal {
    const short = covers(account, amount);
    if (short) return short;
    /* As wallet_spend: a price of nothing moves nothing, and writes no event. */
    if (amount === 0) return account.wallet;
    account.wallet -= amount;
    recordWallet(account.id, stamp ?? now(), { settlement: null, kind: what, change: -amount, overflow: 0, floored: 0, balanceAfter: account.wallet, ref });
    return account.wallet;
  }
  /** A price going back (`refund_report`, an overturned appeal): the wallet and its event, as the server writes them. */
  function giveBack(account: AccountRec, amount: number, ref: Id): void {
    if (amount === 0) return;
    account.wallet += amount;
    recordWallet(account.id, stamp ?? now(), { settlement: null, kind: 'refund', change: amount, overflow: 0, floored: 0, balanceAfter: account.wallet, ref });
  }
  /** The reports whose judgment failed and were refunded: they do not count toward the day's quota (open_report). */
  const refundedReports = new Set<Id>();
  /** The appeals whose judgment failed and were refunded: the punishment can be appealed again. */
  const refundedAppeals = new Set<Id>();
  /** `wallet_spend`'s refusal of a price the wallet does not hold, or nothing. */
  const covers = (account: AccountRec, amount: number): Refusal | null => (account.wallet < amount ? refuse(`that costs ${amount}, and your wallet holds ${account.wallet}`) : null);

  /** `buy_card` (0139_machine.sql): the slot's card at the price the screen showed, from the settled wallet, and one more of it in the hand. */
  function buyCard(shown: Slot): Answer<Bought> {
    const bad = request({ action: 'buyCard', slot: shown.id, price: shown.price });
    if (bad) return bad;
    const account = me()!;
    const seen = slotForSale(shown, 'card');
    if (isRefusal(seen)) return seen;
    const card = (seen.item as { card: string }).card;
    const left = spend(account, seen.price, 'purchase', null);
    if (typeof left !== 'number') return left;
    account.cards[card] = (account.cards[card] ?? 0) + 1;
    recordCard(account.id, stamp ?? now(), { card, kind: 'bought', act: null, price: seen.price, ...(movedPrice(seen) ? { repriced: true } : {}) });
    return ok({ card, balance: left, held: account.cards[card]! });
  }

  /** `buy_pack` (0139_machine.sql): the same checks, then the roll; the cards it gave, in pull order, are in the hand. */
  function buyPack(shown: Slot): Answer<Opened> {
    const bad = request({ action: 'buyPack', slot: shown.id, price: shown.price });
    if (bad) return bad;
    const account = me()!;
    const seen = slotForSale(shown, 'pack');
    if (isRefusal(seen)) return seen;
    const pack = instance.packs.find((p) => p.key === (seen.item as { pack: string }).pack);
    if (!pack) return refuse('the machine has no such slot');
    const contents = rollPack(pack, instance.cards, instance.settings, random);
    const left = spend(account, seen.price, 'purchase', null);
    if (typeof left !== 'number') return left;
    for (const card of contents) account.cards[card] = (account.cards[card] ?? 0) + 1;
    /* The pack's row and one pulled row per card, in pull order, at the purchase's instant, as buy_pack writes them. */
    const made = uuid();
    const at = stamp ?? now();
    packLedger.push({ account: account.id, order: ++logOrder, ms: at, event: { pack: made, kind: pack.key, price: seen.price, repriced: movedPrice(seen), contents, at: iso(at) } });
    for (const card of contents) recordCard(account.id, at, { card, kind: 'pulled', act: null, pack: made, price: 0 });
    return ok({ pack: made, contents, balance: left });
  }

  /**
   * The Edge Function's reading of a play, then `play_card` (0016_cards_screens.sql): the post is read and priced by its card's rules
   * (`decidePlay`), then the character, the card in hand and the layer are the database's, in that order.
   */
  function playCard(card: string, character: Id, target: Id, config: Readonly<Record<string, unknown>>, message: string, reach: Reach = 'post', fromPost?: Id): Answer<Act> {
    const bad = request({ action: 'playCard', card, character, target, config, message, ...(reach !== 'post' ? { reach, post: fromPost } : {}) });
    if (bad) return bad;
    if (reach !== 'post') return playBeyond('cast', card, character, target, config, message, reach, fromPost);
    const on = acts.get(target);
    if (!on) return refuse('there is no such post', 'target');
    const rules = instance.cards.find((c) => c.key === card)!;
    const text = (publicAct(on).currentPayload as { body?: unknown }).body;
    const effects = effectsOn(target);
    // Decided and written in one step, with no gap for an edit to land in, so the fake checks no version (play_card does, 0070).
    const decided = decidePlay(rules, settings, postTarget(on.id, on.kind as PostTarget['kind'], text), effects, config, message, { now: new Date(now()), nameOf: (k) => instance.cards.find((c) => c.key === k)?.name ?? k });
    if (!decided.ok) return refuse(decided.why, message !== undefined && !casterMessage(message).ok ? 'message' : 'config');
    const c = acting(character);
    if (isRefusal(c)) return c;
    const account = me()!;
    settleBacks(account);
    if ((account.cards[card] ?? 0) < 1) return refuse(`you hold no "${card}" card; the Vending Machine sells them`);
    const short = covers(account, decided.value.price);
    if (short) return short;
    account.cards[card]! -= 1;
    /* The layer counts every play that landed, a reversed one too (acts_card_layers refuses a reused layer); only the stack count drops it. */
    const layer = [...acts.values()].filter((a) => a.kind === 'card' && a.target === target && a.payload.card === card && a.payload.caught === undefined && onPost(a)).length + 1;
    /* A live catching set card that names this very card, whatever its rarity, catches the play and takes it (spring_traps): the spring is written first, as the server writes it. */
    const trap = liveBack(target);
    const trapRules = trap ? instance.cards.find((c) => c.key === trap.card) : undefined;
    /* It catches the card it names, or one its match holds: the flavor in `flavors`, the rarity at or below `upTo` and at or below the back's own (spring_traps, 0148). */
    const match = trapRules?.trap?.match;
    const matched = match !== undefined && (match.flavors === undefined || match.flavors.includes(rules.alignment)) && (match.upTo === undefined || atOrBelow(rules.rarity, match.upTo)) && atOrBelow(rules.rarity, trapRules!.rarity);
    const catches = trap && trapRules?.trap?.trigger.on === 'cast' && (faceDown.get(trap.set)!.catches === card || matched) && ownerOf(acts.get(trap.set)!.character!) !== undefined;
    /* The play's id is chosen first, so the spring can name it and be written before it, as play_card writes them (each takes its moment then). */
    const playId = uuid();
    let spring: ActRec | null = null;
    if (catches) {
      spring = write({ character: acts.get(trap.set)!.character, kind: 'spring', thread: on.thread, target, payload: { card: trap.card, trigger: 'cast', did: 'caught', set: trap.set, by: playId, caught: playId } });
      faceDown.get(trap.set)!.sprung = spring.id;
    }
    const written = write({ id: playId, character, kind: 'card', thread: on.thread, target, payload: { card, message: decided.value.message, config: decided.value.config, ...(decided.value.tokens === undefined ? {} : { tokens: decided.value.tokens }), ...(catches ? { caught: trap!.set } : { layer }) } });
    /* After the Act, so the wallet's record names what the Aura went on (play_card). */
    spend(account, decided.value.price, 'play', written.id);
    recordCard(account.id, written.at, { card, kind: 'played', act: written.id, price: decided.value.price });
    sendAct(written);
    if (spring) {
      /* The caught card is the setter's: one more in the hand, and a `caught` row in their own ledger (nothing is paid). */
      const setter = accounts.get(faceDown.get(trap!.set)!.account);
      if (setter) {
        setter.cards[card] = (setter.cards[card] ?? 0) + 1;
        recordCard(setter.id, spring.at, { card, kind: 'caught', act: spring.id, price: 0 });
      }
      sendAct(spring);
    }
    return ok(publicAct(written));
  }

  /**
   * The cards set face down (face_down, 0054): which card a set is, its setter's account alone; when it ends; the spring that ended it.
   * Mirrored: a catching set card catches the one card it names on a cast (the setter takes the card, a `caught` ledger row, no payout). NOT mirrored: a Move set face down never springs on a quote
   * (no card lands on the quoting post, character, thread or board, and its phrase is never matched), a Hall Pass never ends a visit, and a ward does not stop a landing. Those are the server's to test
   * (supabase/tests/0135-face-down-moves.sql); a test that needs one writes the spring with `seed.spring`.
   */
  /** The back of each card set face down: `catches` is the card a catching set card names and `phrase` the words a Move waits for, both from the card's own rules (decideSet), as set_card stores them. */
  const faceDown = new Map<Id, { account: Id; card: string; post: Id; endsAt: number; sprung: Id | null; takenBack?: Id; catches?: string; phrase?: string; passage?: string; who?: readonly Id[]; whoExcept?: boolean; refunded?: true }>();
  function liveBack(post: Id): { set: Id; card: string } | null {
    for (const [set, f] of faceDown) if (f.post === post && f.sprung === null && f.takenBack === undefined && f.endsAt > now()) return { set, card: f.card };
    return null;
  }
  /** The account's backs whose time passed unsprung and not taken back: their cards are in the hand again (card_held, 0148), read and never written. */
  const endedBacks = (account: Id) => [...faceDown.values()].filter((f) => f.account === account && f.sprung === null && f.takenBack === undefined && f.endsAt <= now() && f.refunded !== true);
  /** What the account holds of a card: bought, pulled, caught and returned, less played, and the backs whose time passed. */
  const heldOf = (account: AccountRec, card: string): number => (account.cards[card] ?? 0) + endedBacks(account.id).filter((f) => f.card === card).length;
  /** A back whose time passed unsprung and not taken back shows as a `returned` line at its end, with no Act and no price (my_card_ledger, 0148). */
  const endedLedger = () => [...faceDown.values()].filter((f) => f.sprung === null && f.takenBack === undefined && f.endsAt <= now())
    .map((f) => ({ account: f.account, order: 0, ms: f.endsAt, event: { card: f.card, kind: 'returned' as const, act: null, price: 0, at: iso(f.endsAt) } satisfies CardEvent }));
  /** Before a card is spent: each back whose time passed becomes a card in the hand, once. */
  const settleBacks = (account: AccountRec): void => { for (const f of endedBacks(account.id)) { account.cards[f.card] = (account.cards[f.card] ?? 0) + 1; f.refunded = true; } };
  /** What a card's rules see on a post (card_target): its plays not caught or reversed, each ward's rarity and end, and its card backs naming no card. */
  function effectsOn(target: Id): CardEffect[] {
    const out: CardEffect[] = [];
    for (const a of acts.values()) {
      if (a.target !== target) continue;
      if (a.kind === 'card' && a.payload.caught === undefined && !over(a.id) && onPost(a)) {
        const r = instance.cards.find((c) => c.key === a.payload.card);
        out.push({ card: String(a.payload.card), act: a.id, ...(r?.gimmick ? { gimmick: r.gimmick } : {}), ...(typeof a.payload.ends === 'string' ? { ends: a.payload.ends } : {}) });
      } else if (a.kind === 'set') {
        const f = faceDown.get(a.id);
        out.push({ card: null, act: a.id, faceDown: true, ends: iso(f?.sprung ? acts.get(f.sprung)!.at : f?.takenBack ? acts.get(f.takenBack)!.at : f?.endsAt ?? a.at) });
      }
    }
    return out;
  }

  /** A card Act that is a post's play, not one beyond a post that sits on the post it was played from (0055_card_reach.sql). */
  const onPost = (a: ActRec): boolean => (a.payload.reach ?? 'post') === 'post';
  /** The plays beyond a post (play_reach, 0055): each play's reach, its target and when it ends, never edited. */
  const reachPlays = new Map<Id, { reach: BeyondPost; target: Id; endsAt: number }>();
  /** The live plays on one target beyond a post, as effects (reach_effects, 0055). */
  const reachEffects = (reach: BeyondPost, target: Id): CardEffect[] => [...reachPlays].filter(([play, r]) => r.reach === reach && r.target === target && r.endsAt > now() && !reversedPlays.has(play))
    .map(([play, r]) => {
      const rules = instance.cards.find((c) => c.key === acts.get(play)!.payload.card);
      return { card: String(acts.get(play)!.payload.card), act: play, reach, ends: iso(r.endsAt), ...(rules?.gimmick ? { gimmick: rules.gimmick } : {}) };
    });
  const boardOf = (thread: Id): Id => threads.get(thread)!.board;
  /**
   * `play_card` beyond a post (0055): the target is the character (played from one of its posts), the thread or the board; its rules
   * see its own live plays and the ones above it; the Act sits in the post's thread, the thread, or The System's announcements thread,
   * and its play_reach row ends at least(the card's lasts, reachLasts).
   */
  function playBeyond(play: 'cast' | 'use', card: string, character: Id, target: Id, config: Readonly<Record<string, unknown>>, message: string, reach: BeyondPost, fromPost: Id | undefined): Answer<Act> {
    const rules = instance.cards.find((c) => c.key === card)!;
    let thread: Id;
    let on: Id | null;
    let above: EffectsAbove;
    /* A use card never goes on a board, before the board is looked for (place_cast, 0148). */
    if (play === 'use' && reach === 'board') return refuse(`${rules.name} is never used on a board`);
    if (reach === 'character') {
      if (!characters.has(target)) return refuse('there is no such character', 'target');
      const from = fromPost ? acts.get(fromPost) : undefined;
      if (!from || from.kind !== 'post' || from.character !== target) return refuse('a card on a character is played from one of its posts');
      thread = from.thread;
      on = from.id;
      above = { thread: reachEffects('thread', thread), board: reachEffects('board', boardOf(thread)) };
    } else if (reach === 'thread') {
      if (!threads.has(target)) return refuse('there is no such thread', 'target');
      thread = target;
      on = [...acts.values()].find((a) => a.thread === target && a.seq === 1)?.id ?? null;
      if (!on) return refuse('that thread has no post yet');
      /* A use card on a thread is a match stipulation, so only on a thread the acting character started (place_cast, 0148), before the card's own rules are asked. */
      if (play === 'use' && acts.get(on)?.character !== character) return refuse(`${rules.name} is used on a thread your own character started`);
      above = { board: reachEffects('board', boardOf(target)) };
    } else {
      if (!boards.some((b) => b.id === target)) return refuse('there is no such board', 'target');
      thread = announcements();
      on = null;
      above = {};
    }
    const at = stamp ?? now();
    const goal = { reach, [reach]: target } as unknown as CardTarget;
    const effects = effectsOnTarget(goal, reachEffects(reach, target), above, new Date(at));
    const nameOf = (k: string) => instance.cards.find((c) => c.key === k)?.name ?? k;
    const decided = play === 'use' ? decideUse(rules, settings, goal, effects, config, message, { now: new Date(at) }) : decidePlay(rules, settings, goal, effects, config, message, { now: new Date(at), nameOf });
    if (!decided.ok) return refuse(decided.why, message !== undefined && !casterMessage(message).ok ? 'message' : 'config');
    const c = acting(character);
    if (isRefusal(c)) return c;
    if (play === 'use' && reach === 'character' && target !== character) return refuse(`${rules.name} is used on your own character`);
    const account = me()!;
    settleBacks(account);
    if ((account.cards[card] ?? 0) < 1) return refuse(`you hold no "${card}" card; the Vending Machine sells them`);
    const short = covers(account, decided.value.price);
    if (short) return short;
    account.cards[card]! -= 1;
    const bound = span(settings.reachLasts[reach]);
    const endsAt = at + Math.min(rules.lasts ? span(rules.lasts) : bound, bound);
    const written = write({ character, kind: 'card', thread, target: on, at, payload: { card, message: decided.value.message, config: decided.value.config, reach, [reach]: target, ends: iso(endsAt) } });
    reachPlays.set(written.id, { reach, target, endsAt });
    spend(account, decided.value.price, 'play', written.id);
    recordCard(account.id, written.at, { card, kind: 'played', act: written.id, price: decided.value.price });
    sendAct(written);
    sendReach(written);
    return ok(publicAct(written));
  }

  /** set_card (0142): a Move or another set card, decided by the card's rules (decideSet, whose catch and phrase the back keeps), then the author, the hand and the post's one back are the database's. */
  function setCard(card: string, character: Id, target: Id, config: Readonly<Record<string, unknown>>, when?: SetConditions): Answer<Act> {
    const bad = request({ action: 'setCard', card, character, target, config, ...(when ? { when } : {}) });
    if (bad) return bad;
    const on = acts.get(target);
    if (!on) return refuse('there is no such post', 'target');
    const rules = instance.cards.find((c) => c.key === card)!;
    const text = (publicAct(on).currentPayload as { body?: unknown }).body;
    const decided = decideSet(rules, settings, postTarget(on.id, on.kind as PostTarget['kind'], text), effectsOn(target), config, instance.cards, when ?? {}, new Date(now()));
    if (!decided.ok) return refuse(decided.why, 'config');
    /* As set_card (0144) says it: a named id that is not a debuted character, one message for a missing and an undebuted one, by its place in the list. */
    const unknown = (decided.value.who?.characters ?? []).findIndex((id) => characters.get(id)?.debutedAt == null);
    if (unknown >= 0) return refuse(`${unknown + 1} is not a character on the board`, 'config');
    const c = acting(character);
    if (isRefusal(c)) return c;
    if (on.character !== character) return refuse('a card is set face down on a post of your own character\'s');
    const account = me()!;
    settleBacks(account);
    if ((account.cards[card] ?? 0) < 1) return refuse(`you hold no "${card}" card; the Vending Machine sells them`);
    const short = covers(account, decided.value.price);
    if (short) return short;
    account.cards[card]! -= 1;
    const written = write({ character, kind: 'set', thread: on.thread, target, payload: {} });
    faceDown.set(written.id, { account: account.id, card, post: target, endsAt: written.at + span(settings.setLasts), sprung: null, ...(decided.value.catches === undefined ? {} : { catches: decided.value.catches }), ...(decided.value.phrase === undefined ? {} : { phrase: decided.value.phrase }), ...(decided.value.passage === undefined ? {} : { passage: decided.value.passage }), ...(decided.value.who === undefined ? {} : { who: decided.value.who.characters, whoExcept: decided.value.who.except }) });
    spend(account, decided.value.price, 'play', written.id);
    /* As my_card_ledger (0142) says it: whether the card can spring, from the card kinds: a set card that carries a trap, or a Move (it springs on a quote). */
    recordCard(account.id, written.at, { card, kind: 'played', act: written.id, price: decided.value.price, springs: rules.trap != null || kindOfPlay(rules) === 'cast', ...(decided.value.phrase === undefined ? {} : { phrase: decided.value.phrase }), ...(decided.value.passage === undefined ? {} : { passage: decided.value.passage }), ...(decided.value.who === undefined ? {} : { who: decided.value.who.characters, whoExcept: decided.value.who.except }) });
    sendAct(written);
    return ok(publicAct(written));
  }

  /** take_back (0148): the setter's own live back goes back to the hand, free; every other back, and one that has ended, is refused in the same words. */
  function takeBack(character: Id, set: Id): Answer<Act> {
    const bad = request({ action: 'takeBack', character, set });
    if (bad) return bad;
    const c = acting(character);
    if (isRefusal(c)) return c;
    const banned = bannedUntilOf(character);
    if (banned !== null) return refuse(`this character is banned until ${iso(banned)}; the ban ends by itself then`);
    const account = me()!;
    const nothing = 'there is no face-down card to take back there';
    const f = faceDown.get(set);
    const back = acts.get(set);
    if (!f || !back || f.account !== account.id || back.character !== character) return refuse(nothing);
    if (f.sprung !== null || f.takenBack !== undefined || f.endsAt <= now()) return refuse(nothing);
    const written = write({ character, kind: 'take_back', thread: back.thread, target: f.post, payload: { set } });
    f.takenBack = written.id;
    account.cards[f.card] = (account.cards[f.card] ?? 0) + 1;
    recordCard(account.id, written.at, { card: f.card, kind: 'returned', act: written.id, price: 0 });
    sendAct(written);
    return ok(publicAct(written));
  }

  /** A Use (play_card, 0054): decided by decideUse, on a post of the character's own, carrying its end. */
  function useCard(card: string, character: Id, target: Id, config: Readonly<Record<string, unknown>>, message: string, reach: Reach = 'post', fromPost?: Id): Answer<Act> {
    const bad = request({ action: 'useCard', card, character, target, config, message, ...(reach !== 'post' ? { reach, post: fromPost } : {}) });
    if (bad) return bad;
    if (reach !== 'post') return playBeyond('use', card, character, target, config, message, reach, fromPost);
    const on = acts.get(target);
    if (!on) return refuse('there is no such post', 'target');
    const rules = instance.cards.find((c) => c.key === card)!;
    const text = (publicAct(on).currentPayload as { body?: unknown }).body;
    const decided = decideUse(rules, settings, postTarget(on.id, on.kind as PostTarget['kind'], text), effectsOn(target), config, message, { now: new Date(now()) });
    if (!decided.ok) return refuse(decided.why, 'config');
    const c = acting(character);
    if (isRefusal(c)) return c;
    if (on.character !== character) return refuse(`${rules.name} is used on your own post`);
    const account = me()!;
    settleBacks(account);
    if ((account.cards[card] ?? 0) < 1) return refuse(`you hold no "${card}" card; the Vending Machine sells them`);
    const short = covers(account, decided.value.price);
    if (short) return short;
    account.cards[card]! -= 1;
    const layer = [...acts.values()].filter((a) => a.kind === 'card' && a.target === target && a.payload.card === card && onPost(a)).length + 1;
    const at = stamp ?? now();
    const written = write({ character, kind: 'card', thread: on.thread, target, payload: { card, layer, message: decided.value.message, config: decided.value.config, ...(rules.lasts ? { ends: iso(at + span(rules.lasts)) } : {}) } });
    spend(account, decided.value.price, 'play', written.id);
    recordCard(account.id, written.at, { card, kind: 'played', act: written.id, price: decided.value.price });
    sendAct(written);
    return ok(publicAct(written));
  }

  function edit(target: Id, character: Id, body: string): Answer<Act> {
    const bad = request({ action: 'edit', post: target, character, body });
    if (bad) return bad;
    const c = acting(character);
    if (isRefusal(c)) return c;
    const original = acts.get(target);
    if (!original || original.kind !== 'post' || original.character !== character) return refuse('that is not a post of this character\'s');
    write({ character, kind: 'edit', thread: original.thread, target, payload: { body } });
    sendAct(original);
    return ok(publicAct(original));
  }

  /** When the character's current class was made public: the latest of its unmask Acts and class-carrying announces of that class, at or after the class began (the filter `classReveals` uses). */
  function classShownAt(c: CharRec): number | null {
    const now = classNow(c);
    let latest: number | null = null;
    for (const a of acts.values()) {
      if (a.character !== c.id || a.at < now.at) continue;
      if (a.kind !== 'unmask' && !(a.kind === 'announce' && typeof a.payload.class === 'string')) continue;
      if (a.payload.class !== now.cls) continue;
      if (latest === null || a.at > latest) latest = a.at;
    }
    return latest;
  }

  function unmask(character: Id, thread: Id, message: string): Answer<Act> {
    const bad = request({ action: 'unmask', character, thread, message });
    if (bad) return bad;
    const c = acting(character);
    if (isRefusal(c)) return c;
    if (classShownAt(c) !== null) return refuse(ALREADY_PUBLIC);
    const found = threadAndBoard(thread);
    if (isRefusal(found)) return found;
    if (found.board.isSystem) return refuse(SYSTEM_BOARD);
    const written = write({ character, kind: 'unmask', thread, payload: { class: classNow(c).cls, message: message.trim(), via: 'act' } });
    sendAct(written);
    return ok(publicAct(written));
  }

  function turn(character: Id, to: string, loudness: 'silent' | 'announced', showFrom: boolean, showTo: boolean): Answer<{ class: string; loudness: 'silent' | 'announced'; showFrom: boolean; showTo: boolean; takesEffectAt: string | null }> {
    const bad = request({ action: 'turn', character, class: to, loudness, showFrom, showTo });
    if (bad) return bad;
    const c = acting(character);
    if (isRefusal(c)) return c;
    if (classNow(c).cls === to) return refuse(c.pending ? 'this character already is one: withdraw its waiting Turn to keep it' : 'this character already is one');
    const opens = turnOpens(c);
    if (opens !== null) return refuse(`this character can Turn again at ${iso(opens).replace(/\.\d+Z$/, 'Z')}`);
    // Asked again before the settlement, it is the same Turn, changed.
    c.pending = { class: to, loudness, showFrom, showTo, takesEffectAt: null, asked: now() };
    return ok({ class: to, loudness, showFrom, showTo, takesEffectAt: takesEffectAt() });
  }

  function withdrawTurn(character: Id): Answer<{ withdrawn: true }> {
    const bad = request({ action: 'withdrawTurn', character });
    if (bad) return bad;
    const c = acting(character);
    if (isRefusal(c)) return c;
    if (!c.pending) return refuse('no Turn of that character is waiting');
    c.pending = null;
    return ok({ withdrawn: true });
  }

  /** The SQL's words (pronouns_hold, 0124): a set is held after it is lowercased, as set_profile and create_character store it. */
  const PRONOUNS_REFUSAL = 'pronouns are five words of 1 to 12 letters';
  const pronounsHold = (set: PronounSet) => pronounProblems(normalizePronouns(set)).length === 0;

  const ownedCount = (account: Id) => [...characters.values()].filter((c) => c.owner === account && c.retiredAt === null).length;

  function createCharacter(name: string, cls: string, timing: DebutTiming, loudness: DebutLoudness, pronouns?: PronounSet): Answer<CreatedCharacter> {
    const bad = request({ action: 'createCharacter', name, class: cls, timing, loudness });
    if (bad) return bad;
    const account = me()!;
    const named = name.replace(/^ +| +$/g, '');
    if (ownedCount(account.id) >= settings.charactersPerPlayer) return refuse(`a player runs at most ${settings.charactersPerPlayer} characters`);
    if ([...characters.values()].some((c) => sameName(c.name, named))) return refuse('that name is taken');
    if (pronouns !== undefined && !pronounsHold(pronouns)) return refuse(PRONOUNS_REFUSAL);
    const c = addCharacter(account.id, named, cls, { debuted: timing === 'now', loudness, ...(pronouns === undefined ? {} : { pronouns: normalizePronouns(pronouns) }) });
    return ok({ id: c.id, name: c.name, class: cls, waiting: timing === 'tally', loudness });
  }

  function setDebut(character: Id, timing: DebutTiming, loudness: DebutLoudness): Answer<{ id: Id; waiting: boolean; loudness: DebutLoudness }> {
    const bad = request({ action: 'setDebut', character, timing, loudness });
    if (bad) return bad;
    const c = characters.get(character);
    if (!c || c.owner !== me()!.id) return refuse('you do not play that character');
    if (c.debutedAt !== null) return refuse('it has debuted');
    if (c.retiredAt !== null) return refuse('that character is retired; an admin can restore it');
    c.loudness = loudness;
    if (timing === 'now') c.debutedAt = now();
    return ok({ id: c.id, waiting: timing === 'tally', loudness });
  }

  function addCharacter(owner: Id, name: string, cls: string, o: { debuted: boolean; loudness: DebutLoudness; retired?: boolean; at?: number; pronouns?: PronounSet }): CharRec {
    const at = o.at ?? now();
    const c: CharRec = {
      id: uuid(), owner, name, createdAt: at, debutedAt: o.debuted ? at : null, retiredAt: o.retired ? at : null, loudness: o.loudness,
      history: [{ cls, at }], pending: null, presenceHidden: false, title: '', signature: '', pipStyle: options.instance.pipStyles[0]?.key ?? 'default',
      pronouns: o.pronouns ?? settings.pronouns,
      square: null, portrait: null, squareFrame: null, portraitFrame: null, portraitTallness: null, outfit: [], shown: [],
    };
    characters.set(c.id, c);
    return c;
  }

  const openInvites = (account: Id) => invites.filter((i) => i.owner === account && i.usedBy === null && now() < i.issuedAt + span(settings.inviteLifetime));
  const newCode = (id: number) => `invite-${id}-${++counter}`;

  function createInvite(): Answer<{ invite: number; code: string }> {
    const bad = request({ action: 'createInvite' });
    if (bad) return bad;
    const account = me()!;
    const open = openInvites(account.id).length;
    if (!account.admin && open >= settings.invitesPerPlayer) return refuse(`you hold ${open} open invites, the most there are: one used or expired frees one`);
    const id = invites.length + 1;
    invites.push({ id, owner: account.id, code: newCode(id), createdAt: now(), issuedAt: now(), usedBy: null });
    return ok({ invite: id, code: invites.at(-1)!.code });
  }

  function reissueInvite(invite: number): Answer<{ invite: number; code: string }> {
    const bad = request({ action: 'reissueInvite', invite });
    if (bad) return bad;
    const found = invites.find((i) => i.id === invite && i.owner === me()!.id && i.usedBy === null);
    if (!found) return refuse(`you have no unused invite ${invite}`);
    found.code = newCode(found.id);
    found.issuedAt = now();
    return ok({ invite, code: found.code });
  }

  /** What opening an account with `code` for `email` does: the account, or why not and the way on. */
  function tryOpen(email: string, code: string | null): { account: Id } | { why: string; way: string } {
    if (settings.registrationMode === 'closed') return { why: 'registration is closed', way: 'when an admin opens it again, your next sign-in opens your account' };
    const valid = code === null ? undefined : invites.find((i) => i.code === code && i.usedBy === null && now() < i.issuedAt + span(settings.inviteLifetime));
    if (settings.registrationMode === 'invite' && !valid) return { why: 'that invite opens nothing', way: 'open the account with another invite' };
    const account = addAccount(email);
    if (valid) valid.usedBy = account.id;
    return { account: account.id };
  }

  /* ------------------------------------------------------- gear, trophies, events ---- */
  const cosmetics = () => instance.settings.cosmetics;
  /** A trophy kind as `trophy_kinds` holds it: the instance's own, then an admin's. `art` is a URL for an admin's kind, null for the instance's (whose art is its UI's). */
  const kindOf = (key: string): { key: string; name: string; line: string | null; belt: boolean; art: string | null } | undefined => {
    const own = instance.trophies.kinds.find((k) => k.key === key);
    if (own) return { key: own.key, name: own.name, line: own.line ?? null, belt: own.belt === true, art: null };
    const made = madeKinds.find((k) => k.key === key);
    return made ? { ...made, art: made.art === null ? null : `https://trophies.fake.test/${made.art}` } : undefined;
  };
  const standing = (trophy: string) => awards.filter((a) => a.trophy === trophy && !a.reversed);
  /** Whether an award of a belt is the one held now: the latest standing award of its kind (`beltHolder`), its holder's latest. */
  const heldNow = (a: (typeof awards)[number]): boolean => {
    if (beltHolder(standing(a.trophy).map((x) => ({ character: x.character, at: iso(x.at) }))) !== a.character) return false;
    return standing(a.trophy).filter((x) => x.character === a.character).every((x) => x.at <= a.at);
  };
  const shownOf = (a: (typeof awards)[number]): ShownTrophy => {
    const k = kindOf(a.trophy)!;
    return { award: a.id, trophy: a.trophy, name: k.name, art: k.art, belt: k.belt, held: k.belt && heldNow(a) };
  };
  /** `trophy_shelf`: the awards a character shows in its order, then every belt it holds that is not among them. */
  function shelf(character: Id): ShownTrophy[] {
    const c = characters.get(character)!;
    const shown = c.shown.map((id) => awards.find((a) => a.id === id)).filter((a): a is (typeof awards)[number] => a !== undefined && !a.reversed).map(shownOf);
    const belts = awards.filter((a) => a.character === character && !a.reversed && kindOf(a.trophy)?.belt && !c.shown.includes(a.id) && heldNow(a)).sort((x, y) => y.at - x.at).map(shownOf);
    return [...shown, ...belts];
  }
  const WORDS: Record<string, string> = { season: 'the season', demand: 'a met demand', admin: 'an admin'};
  /** The link data `trophy_item` gives for a Boss's or a met demand's award: the move's Act, thread and number there. */
  const moveOf = (a: (typeof awards)[number]): TrophyItem['move'] => {
    const m = a.move === null ? undefined : acts.get(a.move);
    return m && m.kind === 'move' && m.seq !== null ? { act: m.id, thread: m.thread, seq: m.seq } : null;
  };
  /** `trophy_item`'s words for who gave: the Boss's own name, "<Name>, the Boss", where one stands. */
  const givenBy = (by: string): string => {
    if (by !== 'boss') return WORDS[by]!;
    const boss = [...characters.values()].find((c) => c.staff?.office === 'boss' && c.debutedAt !== null && c.retiredAt === null);
    return boss ? `${boss.name}, the Boss` : 'the Boss';
  };
  /** `piece_problem`'s words for the predicate `pieceProblem` names. */
  const pieceWords = (piece: Piece, most: number): string | null => {
    if (typeof piece !== 'object' || piece === null) return 'a piece is an object giving its gear, x, y, w, turn and layer';
    if (typeof piece.gear !== 'string') return 'a piece names its gear';
    const why = ((): string | null => {
      const within = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
      if (!within(piece.x, 0, 1)) return 'a piece\'s x is outside the portrait';
      if (!within(piece.y, 0, 1)) return 'a piece\'s y is outside the portrait';
      if (!within(piece.w, PIECE_WIDTH.least, PIECE_WIDTH.most)) return 'a piece\'s width is from 0.05 to 1.5 of the portrait\'s width';
      if (!within(piece.turn, -PIECE_TURN_MOST, PIECE_TURN_MOST)) return 'a piece\'s turn is from -180 to 180 degrees';
      if (!Number.isInteger(piece.layer) || !within(piece.layer, 0, most - 1)) return `a piece's layer is a whole number below ${most}`;
      return null;
    })();
    return why;
  };

  /** `my_wardrobe`: each gear the player holds, with where its copies are worn among the player's own characters. */
  function wardrobe(): Answer<WardrobeItem[]> {
    const account = me();
    if (!account) return refuse('sign in to dress a character');
    return ok(Object.entries(account.gear).filter(([, held]) => held > 0).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([gear, held]): WardrobeItem => ({
      gear, rarity: instance.gear.find((g) => g.key === gear)?.rarity ?? 'common', held,
      /* One entry for each piece worn, as my_wardrobe lists them. */
      wornBy: [...characters.values()].filter((c) => c.owner === account.id).flatMap((c) => c.outfit.filter((o) => o.gear === gear).map(() => c.id)).sort(),
    })));
  }

  /** `set_outfit` (0150): the checks in the server's order and words, the whole outfit replacing the one before. */
  function setOutfit(character: Id, pieces: readonly Piece[]): Answer<{ worn: number }> {
    const c = acting(character);
    if (isRefusal(c)) return c;
    const account = me()!;
    const most = cosmetics().gear.wornMost;
    if (!Array.isArray(pieces)) return refuse('an outfit is a list of pieces');
    if (pieces.length > most) return refuse(`${pieces.length} pieces are worn; at most ${most}`);
    for (const piece of pieces) {
      const why = pieceWords(piece, most);
      if (why) return refuse(why);
      if (!instance.gear.some((g) => g.key === piece.gear)) return refuse(`there is no gear "${piece.gear}"`);
    }
    const elsewhere: Record<string, number> = {};
    for (const o of characters.values()) if (o.owner === account.id && o.id !== c.id) for (const w of o.outfit) elsewhere[w.gear] = (elsewhere[w.gear] ?? 0) + 1;
    const problems = outfitProblems(pieces, account.gear, elsewhere, cosmetics());
    if (problems.length > 0) return refuse(problems.join('; '));
    c.outfit = pieces.map((p) => ({ gear: p.gear, x: p.x, y: p.y, w: p.w, turn: p.turn, layer: p.layer })).sort((a, b) => a.layer - b.layer);
    return ok({ worn: pieces.length });
  }

  /** `trophies_of` (0151): a page of a character's standing awards, newest first. */
  function trophiesOf(character: Id, cursor?: TrophyCursor): TrophyPage {
    const PAGE = TROPHIES_PAGE;
    const before = cursor ? Date.parse(cursor.before) : null;
    const all = awards.filter((a) => a.character === character && !a.reversed && (before === null || a.at < before || (a.at === before && a.id < cursor!.beforeId)))
      .sort((x, y) => y.at - x.at || (x.id < y.id ? 1 : x.id > y.id ? -1 : 0));
    return {
      awards: all.slice(0, PAGE).map((a): TrophyItem => ({ ...shownOf(a), line: a.line ?? kindOf(a.trophy)!.line, at: iso(a.at), by: givenBy(a.by), season: a.season, move: moveOf(a), shown: characters.get(a.character)?.shown.includes(a.id) === true })),
      more: all.length > PAGE,
    };
  }

  /** `belt_lineage` (0151, 0156): a page of reigns, newest first, from the cursor (the last reign's `began` and award). */
  function beltLineage(trophy: string, cursor?: BeltCursor): Answer<BeltPage> {
    const k = kindOf(trophy);
    if (!k) return refuse(`there is no trophy "${trophy}"`);
    if (!k.belt) return refuse(`"${trophy}" is not a belt`);
    const line = standing(trophy).sort((x, y) => x.at - y.at || (x.id < y.id ? -1 : 1));
    const before = cursor ? Date.parse(cursor.before) : null;
    const newest = line.map((a, i) => ({ a, ended: line[i + 1] ? iso(line[i + 1]!.at) : null })).reverse()
      .filter(({ a }) => before === null || a.at < before || (a.at === before && a.id < cursor!.beforeId));
    return ok({
      reigns: newest.slice(0, REIGNS_PAGE).map(({ a, ended }): BeltReign => ({ award: a.id, character: a.character, name: characters.get(a.character)?.name ?? '', began: iso(a.at), ended, by: givenBy(a.by) })),
      more: newest.length > REIGNS_PAGE,
    });
  }

  /** `show_trophies` (0151): the whole set replaces the one before. */
  function showTrophies(character: Id, chosen: readonly Id[]): Answer<{ shown: number }> {
    const c = acting(character);
    if (isRefusal(c)) return c;
    if (!Array.isArray(chosen)) return refuse('the awards shown are a list');
    const most = cosmetics().trophies.shownMost;
    if (chosen.length > most) return refuse(`${chosen.length} trophies are shown; at most ${most}`);
    if (new Set(chosen).size !== chosen.length) return refuse('a trophy is shown once');
    for (const id of chosen) {
      const a = awards.find((x) => x.id === id);
      if (!a || a.character !== character) return refuse('that trophy is not this character\'s');
      if (a.reversed) return refuse('that trophy has been taken back');
    }
    c.shown = [...chosen];
    return ok({ shown: chosen.length });
  }

  /** The weighted pick `draw_by_rarity` makes: a rarity by its weight, then one of that rarity's keys, from the fake's own random. */
  function drawByRarity(pool: readonly { key: string; rarity?: Rarity }[], weights: Readonly<Partial<Record<Rarity, number>>>): { key: string; rarity: Rarity } | null {
    const live = RARITIES.filter((r) => (weights[r] ?? 0) > 0 && pool.some((x) => x.rarity === r));
    const total = live.reduce((n, r) => n + weights[r]!, 0);
    if (total === 0) return null;
    let at = random() * total;
    const rarity = live.find((r) => (at -= weights[r]!) < 0) ?? live[live.length - 1]!;
    const keys = pool.filter((x) => x.rarity === rarity);
    return { key: keys[Math.floor(random() * keys.length)]!.key, rarity };
  }

  /** `random_event` (0152): null inside the window, at the day's most, or on a draw of nothing; a found item is the account's at once. */
  function randomEvent(character: Id): Answer<RandomEvent | null> {
    const c = acting(character);
    if (isRefusal(c)) return c;
    const account = me()!;
    const cfg = cosmetics().events;
    if (account.rolledAt !== null && account.rolledAt > now() - cfg.windowMinutes * MINUTE) return ok(null);
    if (account.eventsAt.filter((t) => t > now() - DAY).length >= cfg.dayMost) return ok(null);
    account.rolledAt = now();
    let outcome: RandomEvent['outcome'] | 'none';
    let item: string | null = null;
    let rarity: Rarity | null = null;
    let lineKey: string | null = null;
    const next = scripted.shift();
    if (next === null) return ok(null);
    if (next !== undefined) {
      outcome = next.outcome;
      item = next.item ?? null;
      rarity = (outcome === 'gear' ? instance.gear.find((g) => g.key === item)?.rarity : outcome === 'card' ? instance.cards.find((k) => k.key === item)?.rarity : null) ?? null;
      lineKey = next.line ?? null;
    } else {
      const o = { ...cfg.outcomes, none: cfg.outcomes.none ?? 0 };
      const total = o.line + o.gear + o.card + o.none;
      let at = random() * total;
      outcome = (['line', 'gear', 'card', 'none'] as const).find((k) => (at -= o[k]) < 0 && o[k] > 0) ?? 'none';
      if (outcome === 'none') return ok(null);
      if (outcome !== 'line') {
        const drawn = outcome === 'gear' ? drawByRarity(instance.gear, cfg.gearRarity) : drawByRarity(instance.cards.map((k) => ({ key: k.key, rarity: k.rarity })), cfg.cardRarity);
        if (!drawn) return ok(null);
        item = drawn.key;
        rarity = drawn.rarity;
      }
      const lines = instance.events.lines.filter((l) => l.outcome === outcome).map((l) => l.key).sort();
      lineKey = lines.length > 0 ? lines[Math.floor(random() * lines.length)]! : null;
    }
    if (outcome === 'gear' && item) account.gear[item] = (account.gear[item] ?? 0) + 1;
    if (outcome === 'card' && item) account.cards[item] = (account.cards[item] ?? 0) + 1;
    account.eventsAt.push(now());
    /* The line is its text with `{item}` still in it, which the dialog fills; a key the instance does not have says nothing. */
    const said = lineKey === null ? undefined : instance.events.lines.find((l) => l.key === lineKey);
    const event = uuid();
    cosmeticEvents.push({ account: account.id, ms: now(), row: { ...NO_COSMETIC, kind: 'found', id: event, at: iso(now()), character, outcome, item, text: said?.text ?? null } });
    return ok({ event, outcome, item, rarity, line: said?.text ?? null, ...(said ? { lineKey: said.key } : {}), character });
  }

  /** The admin's hand over gear and trophies (0150, 0151): the words are `only_admins`'s and each function's own. */
  const adminOnly = (doing: string): Refusal | null => (me()?.admin ? null : refuse(`only an admin ${doing}`));
  /** award_trophy's checks and its row, once an admin is known to be the caller. */
  const awardByAdmin = (trophy: string, character: Id, line?: string): Answer<{ readonly award: Id }> => {
    if (!kindOf(trophy)) return refuse(`there is no trophy "${trophy}"`);
    const said = lineWords(line);
    if (typeof said === 'object' && said !== null) return said;
    const c = characters.get(character);
    if (!c) return refuse('there is no such character');
    if (c.staff) return refuse('a staff character is never given a trophy');
    if (c.debutedAt === null) return refuse('that character has not debuted');
    const id = uuid();
    awards.push({ id, trophy, character, at: now(), by: 'admin', line: said, season: null, move: null, reversed: false });
    return ok({ award: id });
  };
  const lineWords = (said: string | null | undefined): string | Refusal | null => {
    const t = said == null ? null : said.trim() === '' ? null : said.trim();
    return t !== null && [...t].length > 200 ? refuse('a trophy\'s words are at most 200 characters') : t;
  };

  function addAccount(email: string, createdAt = now()): AccountRec {
    const a: AccountRec = {
      id: uuid(), email, createdAt, admin: false, prefs: DEFAULT_PREFERENCES, wallet: 0, cards: {}, gear: {}, rolledAt: null, eventsAt: [], reading: new Map(), follows: new Map(),
      estimate: { entries: [], lines: [] }, asked: null,
    };
    accounts.set(a.id, a);
    byEmail.set(email, a.id);
    return a;
  }

  /* ------------------------------------------------------------------ the api ---- */
  /** The season's standings, every debuted character ranked, as standings_page pages them: by standing, ties sharing a place, then by name. In memory, so the whole of it. */
  const ranking = (): Standing[] => {
    const listed = [...characters.values()].filter((c) => c.debutedAt !== null).map((c) => ({ character: c.id, name: c.name, standing: standingOf.get(c.id) ?? 0 }));
    return listed
      .map((s): Standing => ({ ...s, place: 1 + listed.filter((o) => o.standing > s.standing).length }))
      .sort((a, b) => a.place - b.place || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  };
  /** A place's presence box (presence_box, 0093): the characters present within the window, longest there first. It marks no one present. */
  function presenceAt(where: PresencePlace): Presence {
    let place: Id | null = null;
    let board: Id | null = null;
    if (where.kind === 'thread') {
      const t = threads.get(where.thread);
      if (!t) throw new Error('there is no such thread');
      place = t.id;
      board = t.board;
    } else if (where.kind === 'board') {
      if (!boards.some((b) => b.id === where.board)) throw new Error('there is no such board');
      place = where.board;
      board = where.board;
    }
    const win = span(settings.presenceWindow);
    const at = now();
      type Listed = { id: Id; name: string; staff: boolean; since: number; visitPost?: number };
      const base: Listed[] = [...presence.entries()].flatMap(([id, row]) => {
        const c = characters.get(id)!;
        if (row.seenAt < at - win || c.debutedAt === null || c.retiredAt !== null || c.presenceHidden) return [];
        if (where.kind === 'thread' && !(row.kind === 'thread' && row.place === place)) return [];
        if (where.kind === 'board' && row.board !== board) return [];
        return [{ id, name: c.name, staff: false, since: where.kind === 'index' ? row.onlineSince : row.placeSince }];
      }).concat(
        /* A staff character (not the developer) is listed in a thread's and a board's box for the window after its own post there (0084), read from
           public posts; the index never lists it, and a board lists it once however many of its threads it posted in. */
        where.kind === 'index' ? [] : [...characters.values()].flatMap((c) => {
          if (!c.staff || c.staff.office === 'developer' || c.debutedAt === null || c.retiredAt !== null) return [];
          const posts = [...acts.values()].filter((a) => a.kind === 'post' && a.character === c.id && a.at >= at - win && a.thread !== null && threads.has(a.thread)
            && (where.kind === 'thread' ? a.thread === place : threads.get(a.thread)!.board === board));
          if (posts.length === 0) return [];
          return [{ id: c.id, name: c.name, staff: true, since: Math.min(...posts.map((a) => a.at)) }];
        }),
      );
      /* A Mod with an open visit in the thread is listed in its box too, with the post's number (0111); one name, though it also posted. */
      const visiting: Listed[] = where.kind !== 'thread' ? [] : [...acts.values()].flatMap((v): Listed[] => {
        const c = v.character === null ? undefined : characters.get(v.character);
        const post = v.target === null ? undefined : acts.get(v.target);
        if (v.kind !== 'visit' || v.thread !== place || !c?.staff || c.staff.office === 'developer' || c.debutedAt === null || c.retiredAt !== null || !post) return [];
        if ([...acts.values()].some((e) => e.kind === 'visit_end' && e.target === v.id)) return [];
        return [{ id: c.id, name: c.name, staff: true, since: v.at, ...(post.seq !== null ? { visitPost: post.seq } : {}) }];
      });
      const listed = [...base, ...visiting].reduce<Listed[]>((out, row) => {
        const seen = out.find((o) => o.id === row.id);
        if (!seen) return [...out, { ...row }];
        seen.since = Math.min(seen.since, row.since);
        if (row.visitPost !== undefined) seen.visitPost = seen.visitPost === undefined ? row.visitPost : Math.min(seen.visitPost, row.visitPost);
        return out;
      }, []).sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const shown = listed.slice(0, settings.presenceNames);
      return { names: shown.map(({ id, name, staff, visitPost }) => ({ id, name, staff, group: groupOf(characters.get(id)!), ...(visitPost !== undefined ? { visitPost } : {}) })), others: listed.length - shown.length };
  }
  /** The rule an infraction was filed under, in the glass's words (punishment_words). */
  function ruleOf(inf: ActRec): string | null {
    const visit = typeof inf.payload.visit_act === 'string' ? acts.get(inf.payload.visit_act) : undefined;
    const charges = (visit?.payload.charges ?? []) as { rule?: string; rule_number?: number | null }[];
    const found = charges.find((c) => c.rule_number === (inf.payload.rule_number ?? null) && c.rule)?.rule;
    return found ?? (typeof inf.payload.rule_number === 'number' ? `Rule ${inf.payload.rule_number}` : 'the board\'s premise');
  }
  /**
   * `my_cosmetic_log` (0158): the finds and gear grants of the account, and the awards, takings back and passed belts of its own characters, newest first. A belt passes from
   * the holder to the next award of its kind to another character, a line that stays when that award is taken back, and a belt taken back from the taker is a `beltBack` line for the holder before.
   */
  function cosmeticLogOf(account: Id | undefined, fits: (ms: number) => boolean, cap: <T>(rows: T[]) => T[]): LogCosmetic[] {
    if (account === undefined) return [];
    const owned = (id: Id) => characters.get(id)?.owner === account;
    const bossName = () => [...characters.values()].find((c) => c.staff?.office === 'boss' && c.debutedAt !== null && c.retiredAt === null)?.name ?? null;
    const place = (trophy: string): number | null => { const i = instance.trophies.seasonPlaces.indexOf(trophy); return i < 0 ? null : i + 1; };
    const rows: { ms: number; row: LogCosmetic }[] = cosmeticEvents.filter((e) => e.account === account && fits(e.ms)).map((e) => ({ ms: e.ms, row: e.row }));
    for (const a of awards) {
      if (!owned(a.character)) continue;
      const kind = kindOf(a.trophy)!;
      const given = { trophy: a.trophy, name: kind.name, by: a.by, byName: a.by === 'boss' ? bossName() : null, season: a.season, place: a.by === 'season' ? place(a.trophy) : null };
      if (fits(a.at)) rows.push({ ms: a.at, row: { ...NO_COSMETIC, ...given, kind: 'awarded', id: a.id, at: iso(a.at), character: a.character, line: a.line } });
      if (a.reversed && a.reversedAt !== undefined && fits(a.reversedAt)) rows.push({ ms: a.reversedAt, row: { ...NO_COSMETIC, trophy: a.trophy, name: kind.name, kind: 'reversed', id: a.id, at: iso(a.reversedAt), character: a.character } });
      /* A belt passes to the next award of its kind, standing or not (it happened); the holder before it is the latest award not yet taken back when it came. */
      const next = kind.belt ? awards.filter((x) => x.trophy === a.trophy && x.at > a.at).sort((x, y) => x.at - y.at)[0] : undefined;
      const heldAt = (ms: number) => !(a.reversed && a.reversedAt !== undefined && a.reversedAt <= ms);
      const latestBefore = (ms: number, x: typeof a) => !awards.some((y) => y.trophy === a.trophy && y.at > a.at && y.at < x.at && (!(y.reversed && y.reversedAt !== undefined && y.reversedAt <= ms)));
      if (next && next.character !== a.character && heldAt(next.at) && latestBefore(next.at, next) && fits(next.at)) {
        rows.push({ ms: next.at, row: { ...NO_COSMETIC, ...given, by: next.by, byName: next.by === 'boss' ? bossName() : null, season: null, place: null, kind: 'lost', id: next.id, at: iso(next.at), character: a.character, toName: characters.get(next.character)?.name ?? null } });
      }
      /* When that next award is taken back and no later one stands, the belt is back with this holder. */
      if (next && next.reversed && next.reversedAt !== undefined && next.character !== a.character && heldAt(next.reversedAt) && latestBefore(next.reversedAt, next) && fits(next.reversedAt)
        && !awards.some((y) => y.trophy === a.trophy && y.at > next.at && !(y.reversed && y.reversedAt !== undefined && y.reversedAt <= next.reversedAt!) && y.at <= next.reversedAt!)) {
        rows.push({ ms: next.reversedAt, row: { ...NO_COSMETIC, trophy: a.trophy, name: kind.name, kind: 'beltBack', id: next.id, at: iso(next.reversedAt), character: a.character, toName: characters.get(next.character)?.name ?? null } });
      }
    }
    return cap(rows.sort((x, y) => y.ms - x.ms).map((r) => r.row));
  }
  /**
   * The log's Mod Bots sources as the views read them (my_infractions, my_bans, my_reports, my_appeals, 0111): the rows of the account's own characters, each as the view says
   * it. A seeded infraction names its Mod by `staff`, a key the fake may not hold a character for, so `mod` is then null, as the view's join is.
   */
  function modLogOf(
    account: Id | undefined,
    newest: <T extends { readonly ms: number; readonly order: number }>(rows: T[]) => T[],
    fits: (ms: number) => boolean,
  ): { infractions: LogInfraction[]; bans: LogBan[]; groupMoves: LogGroupMove[]; reports: LogReport[]; appeals: LogAppeal[] } {
    const owned = (id: unknown): boolean => typeof id === 'string' && account !== undefined && characters.get(id)?.owner === account;
    const all = [...acts.values()];
    const seqOf = (post: unknown): number | null => (typeof post === 'string' ? acts.get(post)?.seq ?? null : null);
    const named = (id: Id | null): string | null => (id === null ? null : characters.get(id)?.name ?? null);
    const rulingOn = (target: Id) => all.find((r) => r.kind === 'appeal_ruling' && all.some((a) => a.id === r.target && a.kind === 'appeal' && a.target === target));
    const ruleWords = ruleOf;
    return {
      infractions: newest(all.filter((i) => i.kind === 'infraction' && owned(i.payload.character) && fits(i.at)).map((i) => ({ ms: i.at, order: i.order, i })))
        .map(({ i }): LogInfraction => ({
          infraction: i.id, character: i.payload.character as Id, at: iso(i.at), band: i.payload.band as VisitBand, points: i.payload.points as number,
          ruleNumber: (i.payload.rule_number as number | null) ?? null, rule: ruleWords(i),
          mod: named([...characters.values()].find((c) => c.staff?.key === i.payload.staff)?.id ?? null), post: i.payload.about_act as Id, postSeq: seqOf(i.payload.about_act), thread: i.thread,
          expiresAt: i.payload.expires_at as string, relief: Math.max(0, -(Number(rulingOn(i.id)?.payload.points_delta ?? 0))),
          emptiedAt: ((b) => (b ? iso(b.at) : null))(all.filter((b) => b.kind === 'ban' && b.payload.character === i.payload.character && b.at > i.at).sort((x, y) => x.at - y.at)[0]),
        })),
      bans: newest(all.filter((b) => b.kind === 'ban' && owned(b.payload.character) && fits(b.at)).map((b) => ({ ms: b.at, order: b.order, b })))
        .map(({ b }): LogBan => ({
          ban: b.id, character: b.payload.character as Id, at: iso(b.at), days: b.payload.days as number, until: (rulingOn(b.id)?.payload.until ?? b.payload.until) as string,
          infraction: b.payload.infraction_act as Id, rule: ((i) => (i ? ruleWords(i) : null))(acts.get(String(b.payload.infraction_act))), thread: b.thread,
        })),
      /* my_group_moves (0134): the conferGroup moves on the account's own characters, each with its end and the ruling of the appeal on it; the end is read through the ruling's `until`. */
      groupMoves: newest(all.filter((m) => m.kind === 'move' && m.payload['kind'] === 'conferGroup' && owned((m.payload['params'] as Record<string, unknown> | undefined)?.['character']) && fits(m.at)).map((m) => ({ ms: m.at, order: m.order, m })))
        .map(({ m }): LogGroupMove => {
          const params = (m.payload['params'] ?? {}) as Record<string, unknown>;
          const end = all.find((e) => e.kind === 'move_end' && e.target === m.id);
          const ruling = all.find((r) => r.kind === 'appeal_ruling' && all.some((a) => a.id === r.target && a.kind === 'appeal' && a.target === m.id));
          const boardId = typeof params['board'] === 'string' ? params['board'] : null;
          return {
            move: m.id, character: params['character'] as Id, at: iso(m.at), thread: m.thread, seq: m.seq ?? null, group: String(params['group'] ?? ''), board: boardId,
            boardName: boardId ? boards.find((b) => b.id === boardId)?.name ?? null : null,
            expiresAt: typeof ruling?.payload['until'] === 'string' ? ruling.payload['until'] : typeof m.payload['expires_at'] === 'string' ? m.payload['expires_at'] : null,
            landedUntil: typeof m.payload['expires_at'] === 'string' ? m.payload['expires_at'] : null,
            checkAt: typeof params['checkAt'] === 'string' ? params['checkAt'] : null,
            demand: typeof (m.payload['demand'] as { kind?: unknown } | undefined)?.kind === 'string' ? String((m.payload['demand'] as { kind: string }).kind) : null,
            office: m.payload['office'] === 'mod' ? 'mod' as const : 'boss' as const, endedWhy: (end?.payload['why'] as LogGroupMove['endedWhy'] | undefined) ?? null, endedBy: (end?.payload['by'] as string | undefined) ?? null,
            endedAt: end ? iso(end.at) : null, ruling: (ruling?.payload['verdict'] as AppealVerdict | undefined) ?? null, ruledAt: ruling ? iso(ruling.at) : null,
            ruledUntil: typeof ruling?.payload['until'] === 'string' ? ruling.payload['until'] : null,
          };
        }),
      reports: newest(all.filter((r) => r.kind === 'report' && owned(r.character) && fits(r.at)).map((r) => ({ ms: r.at, order: r.order, r })))
        .map(({ r }): LogReport => {
          const v = all.find((x) => x.kind === 'report_verdict' && x.target === r.id);
          return {
            report: r.id, character: r.character!, at: iso(r.at), post: r.target!, postSeq: seqOf(r.target), thread: r.thread, verdict: (v?.payload.verdict as ReportVerdict | undefined) ?? null,
            verdictAt: v ? iso(v.at) : null, mod: named(v?.character ?? null), refund: refundedReports.has(r.id) ? 'failed' : null,
          };
        }),
      appeals: newest(all.filter((a) => a.kind === 'appeal' && owned(a.character) && fits(a.at)).map((a) => ({ ms: a.at, order: a.order, a })))
        .map(({ a }): LogAppeal => {
          const p = acts.get(a.target ?? '');
          const r = all.find((x) => x.kind === 'appeal_ruling' && x.target === a.id);
          const about = p?.kind === 'ban' ? acts.get(String(p.payload.infraction_act))?.payload.about_act : p?.payload.about_act;
          return {
            appeal: a.id, character: a.character!, at: iso(a.at), punishment: a.target!, punishmentKind: p?.kind === 'ban' ? 'ban' : p?.kind === 'move' ? 'move' : 'infraction', postSeq: seqOf(about), thread: a.thread,
            verdict: (r?.payload.verdict as AppealVerdict | undefined) ?? null, ruledAt: r ? iso(r.at) : null, pointsDelta: typeof r?.payload.points_delta === 'number' ? r.payload.points_delta : null,
            hearer: named(r?.character ?? null), refund: refundedAppeals.has(a.id) ? 'failed' : null,
          };
        }),
    };
  }
  /** What the next report and appeal are answered with: the Mod's judgment, which the fake does not make (`Seed.judging`). */
  const judged: { report: ReportVerdict | 'failed'; appeal: AppealVerdict | 'failed' } = { report: 'dismissed', appeal: 'upheld' };
  /** my_reports_left (0111): the day's quota (UTC) less the character's reports since midnight, none counted for one refunded for a failed judgment. */
  const reportsLeftNow = (character: Id): number => {
    const midnight = Math.floor(now() / 86_400_000) * 86_400_000;
    return Math.max(0, settings.modBots.reportsPerDay - [...acts.values()].filter((a) => a.kind === 'report' && a.character === character && a.at >= midnight && !refundedReports.has(a.id)).length);
  };
  /* ---------------------------------------------------------------- search ---- */
  /*
   * search_posts, search_threads and search_suggest over the fake's own Acts, on a small scale and with a plain word match: a whole word,
   * case and accents apart, every word needed and `-word` leaving a post out (no stemming, phrases or `or`). The caps, the pool, the
   * cursor and the ordering are the SQL's (supabase/migrations/0117_search.sql); only the matching is cruder.
   */
  const foldText = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const wordsOf = (s: string): string[] => foldText(s).match(/[\p{L}\p{N}]+/gu) ?? [];
  const searchCmp = (sort: SearchSort) => (x: SearchRow, y: SearchRow): number => {
    const time = x.at - y.at || (x.act < y.act ? -1 : x.act > y.act ? 1 : 0);
    return sort === 'oldest' ? time : sort === 'newest' ? -time : y.rank - x.rank || -time;
  };
  interface SearchRow { readonly act: Id; readonly thread: ThreadRec; readonly rec: ActRec; readonly at: number; readonly seq: number; readonly body: string; rank: number }
  function searchKeep(q: SearchQuery): { readonly rows: SearchRow[]; readonly words: string[]; readonly sort: SearchSort; readonly perPage: number } {
    /* The SQL's refusals, in its order (search_posts, search_threads). */
    const perPage = q.perPage ?? SEARCH_PER_PAGE;
    if ([...q.q].length > 200) throw new Error('a search is at most 200 characters');
    if (q.sort != null && q.sort !== 'relevance' && q.sort !== 'newest' && q.sort !== 'oldest') throw new Error('sort is relevance, newest or oldest');
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > SEARCH_PER_PAGE_MAX) throw new Error(`a page holds 1 to ${SEARCH_PER_PAGE_MAX} results`);
    if (q.fromAt !== null && q.toAt !== null && Date.parse(q.fromAt) >= Date.parse(q.toAt)) throw new Error('the range ends before it begins');
    const include: string[] = [];
    const exclude: string[] = [];
    for (const token of q.q.split(/\s+/).filter(Boolean)) (token.startsWith('-') ? exclude : include).push(...wordsOf(token));
    /* Relevance needs keywords to rank by: without them the order is newest first. */
    const sort: SearchSort = (q.sort ?? 'relevance') === 'relevance' && include.length === 0 ? 'newest' : q.sort ?? 'relevance';
    const from = q.fromAt === null ? -Infinity : Date.parse(q.fromAt);
    const to = q.toAt === null ? Infinity : Date.parse(q.toAt);
    /* Who may be found: a character that has debuted. One that has not, and one that is no character, find nothing: the same empty answer. */
    const author = q.author === null ? null : characters.get(q.author);
    if (q.author !== null && (author == null || author.debutedAt === null)) return { rows: [], words: include, sort, perPage };
    const latest = new Map<Id, ActRec>();
    for (const a of acts.values()) if (a.kind === 'edit' && a.target !== null && (!latest.has(a.target) || latest.get(a.target)!.at <= a.at)) latest.set(a.target, a);
    const rows: SearchRow[] = [];
    for (const a of acts.values()) {
      if ((a.kind !== 'post' && a.kind !== 'spin') || a.seq === null) continue;
      const thread = threads.get(a.thread);
      if (!thread || thread.id === updatesThreadId) continue;
      if (q.board !== null && thread.board !== q.board) continue;
      if (q.author !== null && a.character !== q.author) continue;
      /* A post by a character that has not debuted is kept, its name null (the SQL left-joins characters_public). */
      if (a.at < from || a.at >= to) continue;
      if (q.titlesOnly && a.seq !== 1) continue;
      const raw = (latest.get(a.id)?.payload ?? a.payload).body;
      const body = visibleText(parse(typeof raw === 'string' ? raw : '')).replace(/\s+/g, ' ').trim();
      /* A thread's first post carries its title at the heaviest weight, so a title and a post match in one index. */
      const title = a.seq === 1 ? wordsOf(thread.title) : [];
      const here = q.titlesOnly ? title : [...title, ...wordsOf(body)];
      const counts = new Map<string, number>();
      for (const w of here) counts.set(w, (counts.get(w) ?? 0) + 1);
      if (include.some((w) => !counts.has(w)) || exclude.some((w) => counts.has(w))) continue;
      const rank = include.reduce((n, w) => n + (counts.get(w) ?? 0) + 3 * title.filter((t) => t === w).length, 0);
      rows.push({ act: a.id, thread, rec: a, at: a.at, seq: a.seq, body, rank });
    }
    return { rows, words: include, sort, perPage };
  }
  /** A snippet of about thirty words around the first matched one, the matched words between `<<` and `>>`; without keywords, the post's first 200 characters. */
  function searchSnippet(row: SearchRow, words: readonly string[]): string {
    if (words.length === 0) return row.body.slice(0, 200);
    const text = !wordsOf(row.body).some((w) => words.includes(w)) ? row.thread.title : row.body;
    const tokens = text.split(' ');
    const first = Math.max(0, tokens.findIndex((t) => wordsOf(t).some((w) => words.includes(w))));
    const start = Math.max(0, first - 8);
    return tokens.slice(start, start + 30).join(' ').replace(/[\p{L}\p{N}]+/gu, (w) => (words.includes(foldText(w)) ? `<<${w}>>` : w));
  }
  function searchPage<T>(q: SearchQuery, after: SearchCursor | null | undefined, group: boolean, make: (row: SearchRow, matches: number, words: readonly string[]) => T): SearchPage<T> {
    const { rows, words, sort, perPage } = searchKeep(q);
    /* search_cursor_ok: a time and an id that cast, a rank that is a finite number (a relevance search needs it; a time-ordered one takes one or none). */
    if (after != null && !(typeof after === 'object' && typeof after.at === 'string' && /^\d{4}-\d{2}-\d{2}[T ][0-9:.]+(Z|[+-][0-9:]+)?$/.test(after.at) && !Number.isNaN(Date.parse(after.at))
      && new Date(after.at).toISOString().slice(0, 10) === after.at.slice(0, 10)
      && typeof after.act === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(after.act)
      && (sort === 'relevance' ? typeof after.rank === 'number' && Number.isFinite(after.rank) : after.rank == null || (typeof after.rank === 'number' && Number.isFinite(after.rank))))) throw new Error('that is not a cursor this search gave');
    const pool = settings.searchRankPool;
    const relevant = sort === 'relevance';
    /* A search by relevance ranks the newest `pool` of its matches, and says so only when more matched than that; newest and oldest page by time and have no pool, posts and threads alike. */
    const pooled = relevant && rows.length > pool;
    const ranked = relevant ? [...rows].sort(searchCmp('newest')).slice(0, pool) : rows;
    if (!relevant) for (const r of rows) r.rank = 0;
    const order = searchCmp(sort);
    const per = new Map<Id, SearchRow[]>();
    for (const r of rows) per.set(r.thread.id, [...(per.get(r.thread.id) ?? []), r]);
    const cursorRow = after ? ({ act: after.act, at: Date.parse(after.at), rank: after.rank ?? 0 } as SearchRow) : null;
    if (group && !relevant) {
      /* Threads by time, as the SQL's walk (search_walk) reads them: the matches in order from the cursor, at most `pool` of them, keeping each thread's key (its first match in this order);
         at one past a page of keys it stops; at the pool with matches left it stops with the last match it read as the cursor, a page of however many keys it passed (maybe none). */
      const inOrder = [...rows].sort(order);
      const keyOf = new Set<Id>();
      const keys = new Set<Id>();
      for (const r of inOrder) if (!keys.has(r.thread.id)) { keys.add(r.thread.id); keyOf.add(r.act); }
      const window = cursorRow ? inOrder.filter((r) => order(r, cursorRow) > 0) : inOrder;
      const kept: SearchRow[] = [];
      let lastRead: SearchRow | undefined;
      let cut = false;
      let read = 0;
      for (const r of window) {
        if (read >= pool) { cut = true; break; }
        read += 1; lastRead = r;
        if (keyOf.has(r.act)) { kept.push(r); if (kept.length > perPage) break; }
      }
      const shown = kept.slice(0, perPage);
      const edge = kept.length > perPage ? shown[shown.length - 1] : cut ? lastRead : undefined;
      const walked = countThreads(rows, pool);
      return {
        count: walked.count, more: walked.more, pooled: false,
        results: shown.map((r) => make(r, per.get(r.thread.id)!.length, words)),
        next: edge ? { rank: 0, at: iso(edge.at), act: edge.act } : null,
      };
    }
    const sorted = [...ranked].sort(order);
    const seenThreads = new Set<Id>();
    const candidates = group ? sorted.filter((r) => (seenThreads.has(r.thread.id) ? false : (seenThreads.add(r.thread.id), true))) : sorted;
    /* The count is of every match, or (threads) of the threads among the first `pool` matches newest first, to 1,001 (the SQL's walk); a pooled relevance search still counts past its pool for posts. */
    const walked = group ? countThreads(rows, pool) : { count: Math.min(rows.length, SEARCH_COUNT_CAP + 1), more: rows.length > SEARCH_COUNT_CAP };
    const past = cursorRow ? candidates.filter((r) => order(r, cursorRow) > 0) : candidates;
    const shown = past.slice(0, perPage);
    const last = shown[shown.length - 1];
    return {
      count: walked.count, more: walked.more, pooled,
      results: shown.map((r) => make(r, per.get(r.thread.id)!.length, words)),
      next: last && past.length > shown.length ? { rank: sort === 'relevance' ? last.rank : 0, at: iso(last.at), act: last.act } : null,
    };
  }
  /** The threads' count, whatever the sort: the threads among the newest `pool` matches, to 1,001; `more` when past 1,000 or when matches were left unread. */
  function countThreads(rows: readonly SearchRow[], pool: number): { readonly count: number; readonly more: boolean } {
    const read = [...rows].sort(searchCmp('newest')).slice(0, pool);
    const n = new Set(read.map((r) => r.thread.id)).size;
    return { count: Math.min(n, SEARCH_COUNT_CAP + 1), more: n > SEARCH_COUNT_CAP || rows.length > pool };
  }
  function searchHit(row: SearchRow, words: readonly string[]): PostHit {
    const board = boards.find((b) => b.id === row.thread.board)!;
    const who = row.rec.character === null ? undefined : characters.get(row.rec.character);
    return {
      act: row.act, thread: row.thread.id, title: row.thread.title, board: board.id, boardSlug: board.slug, boardName: board.name, seq: row.seq,
      page: pageOf(row.seq, settings.postsPerPage), character: row.rec.character, name: who?.debutedAt != null ? who.name : null, createdAt: iso(row.at),
      snippet: searchSnippet(row, words),
      /* card and spring plays that reach the post and have no card_end, oldest first (the SQL's `cards`). */
      cards: [...acts.values()].filter((a) => (a.kind === 'card' || a.kind === 'spring') && a.target === row.act && (a.payload.reach ?? 'post') === 'post' && typeof a.payload.card === 'string'
        && ![...acts.values()].some((e) => e.kind === 'card_end' && e.target === a.id)).sort((x, y) => x.at - y.at || x.order - y.order).slice(0, SEARCH_CARDS_MAX).map((a) => String(a.payload.card)),
    };
  }
  /** Two same-length strings a letter apart, or two adjacent letters swapped. */
  const oneOff = (a: string, b2: string): boolean => {
    const at = [...a].flatMap((c, i) => (c === b2[i] ? [] : [i]));
    return at.length <= 1 || (at.length === 2 && at[1] === at[0]! + 1 && a[at[0]!] === b2[at[1]!] && a[at[1]!] === b2[at[0]!]);
  };
  /**
   * How well a typed prefix names a text, 0 for not at all: 2 when the text starts with it, 1.5 when a word of it does, 1 when a word starts a
   * letter off it (a stand-in for pg_trgm's similarity, which the SQL uses).
   */
  function suggestMatch(text: string, prefix: string): number {
    const f = foldText(text);
    if (f.startsWith(prefix)) return 2;
    const words = f.split(/[^\p{L}\p{N}]+/u);
    if (words.some((w) => w.startsWith(prefix))) return 1.5;
    return prefix.length >= 4 && words.some((w) => w.length >= prefix.length && oneOff(w.slice(0, prefix.length), prefix)) ? 1 : 0;
  }

  const core: Sync<KayfaApi> = {
    session: () => sessionNow(),
    onSession(listener) { sessionListeners.add(listener); return () => { sessionListeners.delete(listener); }; },
    requestCode(email, invite) {
      const address = email.trim().toLowerCase();
      if (address.length < 3 || address.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(address)) return refuse('is not an email address', 'email');
      pendingInvite.set(address, invite);
      // Said of the invite alone, never of the address: an answer that differs would say whether it has an account.
      const valid = invite !== null && invites.some((i) => i.code === invite && i.usedBy === null && now() < i.issuedAt + span(settings.inviteLifetime));
      if (invite === null || settings.registrationMode === 'open' || valid) return ok({ message: CODE_MESSAGE });
      return ok({
        message: CODE_MESSAGE,
        invite: settings.registrationMode === 'closed' ? 'registration is closed, so no new login is made' : 'that invite opens nothing, so no new login is made with it',
      });
    },
    verifyCode(email, code) {
      const digits = code.replace(/\s/g, '');
      if (!/^\d{6,10}$/.test(digits)) return refuse('is the digits from the email', 'code');
      if (digits !== TEST_CODE) return refuse('that code does not match, or it has expired: ask for a new one', 'code');
      const address = email.trim().toLowerCase();
      const known = byEmail.get(address);
      if (known) { setSession({ email: address, account: known }); return ok({ account: true }); }
      const opened = tryOpen(address, pendingInvite.get(address) ?? null);
      if ('account' in opened) { setSession({ email: address, account: opened.account }); return ok({ account: true }); }
      setSession({ email: address, account: null });
      return ok({ account: false, why: `${opened.why}; ${opened.way}` });
    },
    openAccount(invite) {
      if (session.email === null) return refuse('sign in first');
      if (session.account !== null) return ok({ opened: false });
      const opened = tryOpen(session.email, invite);
      if ('account' in opened) { setSession({ email: session.email, account: opened.account }); return ok({ opened: true }); }
      return refuse(opened.why);
    },
    signOut() { setSession({ email: null, account: null }); },
    signInAddress: () => session.email,
    isAdmin: () => me()?.admin ?? false,
    updates(before) {
      const until = before == null ? Infinity : Date.parse(before);
      return updateActs().filter((a) => a.at < until).slice(0, UPDATES_PAGE).map(updateOf);
    },
    seasonNews: (before) => newsPage(before, SEASON_NEWS_PAGE),
    postUpdate: (title, body, changes) => {
      if (!me()?.admin) return refuse('only an admin writes an update');
      const written = writeUpdate(title, body, changes, undefined);
      if (written.ok) sendNews(acts.get(written.value.act)!);
      return written;
    },
    adminContact: () => contact,
    setAdminContact: (links) => (me()?.admin ? writeContact(links) : refuse('only an admin sets how players reach the admins')),
    settings: () => screen,

    boards: () => boards.map((b): BoardSummary => {
      const mine = [...threads.values()].filter((t) => t.board === b.id && listed(t)).map(summary);
      const latest = mine.sort((x, y) => Date.parse(y.lastAt) - Date.parse(x.lastAt) || y.id.localeCompare(x.id))[0];
      return { ...boardNow(b), threadCount: mine.length, lastAt: latest?.lastAt ?? null, lastCharacter: latest?.lastCharacter ?? null, lastThread: latest?.id ?? null, lastTitle: latest?.title ?? null };
    }),
    board(slugOrId) {
      const found = boards.find((b) => b.slug === slugOrId || b.id === slugOrId);
      return found ? boardNow(found) : null;
    },
    boardNames: () => boards.map((b): BoardName => ({ id: b.id, slug: b.slug, name: boardNow(b).name, was: b.name })),
    moveNotice(id) {
      const a = acts.get(id);
      if (!a || a.kind !== 'move') return null;
      return buildMoveNotice(publicAct(a), tallyOf(id), progressOf(a));
    },
    myApologies(character) {
      const account = me();
      if (!account || characters.get(character)?.owner !== account.id) return [];
      const every = apologyEveryMs();
      return apologies.filter((a) => a.character === character).sort((x, y) => y.at - x.at)
        .map((a): Apology => ({ move: a.move, state: a.state, at: iso(a.at), nextAt: a.state === 'returned' ? null : iso(a.at + every) }));
    },
    appealedMoves(character) {
      const account = me();
      if (!account || characters.get(character)?.owner !== account.id) return [];
      return [...acts.values()].filter((a) => a.kind === 'appeal' && a.character === character && acts.get(a.target ?? '')?.kind === 'move' && !refundedAppeals.has(a.id)).map((a) => a.target!);
    },
    apologize(move, character, title, body, framing) {
      const c = acting(character);
      if (isRefusal(c)) return c;
      const banned = bannedUntilOf(character);
      if (banned !== null) return refuse(`this character is banned until ${iso(banned)}; the ban ends by itself then`);
      const m = acts.get(move);
      const params = (m?.payload['params'] ?? {}) as Record<string, unknown>;
      const demand = (m?.payload['demand'] ?? {}) as Record<string, unknown>;
      const live = m !== undefined && m.kind === 'move' && !moveEnds.has(move) && m.payload['kind'] === 'conferGroup' && params['character'] === character && demand['kind'] === 'apologyAccepted'
        && Date.parse(String(m.payload['expires_at'])) > now();
      if (!live) return refuse('there is no move of this character\'s that an apology can answer');
      const mine = apologies.filter((a) => a.move === move);
      if (mine.some((a) => a.state === 'pending')) return refuse('an apology to that move is still waiting for a ruling');
      const next = Math.max(0, ...mine.filter((a) => a.character === character && a.state !== 'returned' && a.at > now() - apologyEveryMs()).map((a) => a.at + apologyEveryMs()));
      if (next > 0) return refuse(`this character has already apologized to that move in the last ${apologyEveryMs() / 3_600_000} hours; the next apology opens at ${iso(next).slice(0, 16).replace('T', ' ')} UTC`);
      const t = openThread(threads.get(m.thread)!.board, title, move);
      const written = write({ character, kind: 'spin', thread: t.id, target: move, payload: { title, body } });
      apologies.push({ move, apology: written.id, character, state: 'pending', at: written.at });
      sendThread(t);
      sendAct(written);
      writeFramed(body, framing, written);
      return ok({ thread: summary(t), act: publicAct(written) });
    },
    movesLog(staff, before) {
      const who = [...characters.values()].find((c) => c.staff?.key === staff);
      const mine = !who ? [] : [...acts.values()].filter((a) => (a.kind === 'move' || a.kind === 'visit' || a.kind === 'report_verdict' || a.kind === 'appeal_ruling') && a.character === who.id)
        .sort((x, y) => y.at - x.at || (y.id < x.id ? -1 : y.id > x.id ? 1 : 0));
      const after = before ? mine.filter((a) => a.at < Date.parse(before.at) || (a.at === Date.parse(before.at) && a.id < before.act)) : mine;
      const page = after.slice(0, MOVES_LOG_PAGE);
      const seqOf = (id: unknown): number | null => (typeof id === 'string' ? acts.get(id)?.seq ?? null : null);
      const rows = page.map((a): MoveLogRow => {
        /* A Mod's visit, a report it judged and an appeal it heard are rows too (0111), each with how it ended. */
        if (a.kind === 'visit') {
          const charge = ((a.payload.charges ?? []) as { rule?: string; rule_number?: number | null; band?: string; cause?: string }[])[0] ?? {};
          const e = [...acts.values()].find((x) => x.kind === 'visit_end' && x.target === a.id);
          return { act: a.id, kind: 'visit', params: { post: seqOf(a.target), rule: charge.rule ?? null, rule_number: charge.rule_number ?? null, band: charge.band ?? null, cause: charge.cause ?? null }, demand: null,
            expiresAt: typeof a.payload.ends_at === 'string' ? a.payload.ends_at : null, at: iso(a.at), thread: a.thread, end: null, keptBy: null, outcome: (e?.payload.outcome as string | undefined) ?? null };
        }
        if (a.kind === 'report_verdict') {
          return { act: a.id, kind: 'report', params: { post: seqOf(acts.get(a.target ?? '')?.target), verdict: a.payload.verdict }, demand: null, expiresAt: null, at: iso(a.at), thread: a.thread, end: null, keptBy: null, outcome: String(a.payload.verdict) };
        }
        if (a.kind === 'appeal_ruling') {
          const pun = acts.get(acts.get(a.target ?? '')?.target ?? '');
          const about = pun?.kind === 'ban' ? acts.get(String(pun.payload.infraction_act))?.payload.about_act : pun?.payload.about_act;
          return { act: a.id, kind: 'appeal', params: { post: seqOf(about), punishment: pun?.kind ?? null, verdict: a.payload.verdict, points_delta: a.payload.points_delta ?? null }, demand: null, expiresAt: null, at: iso(a.at), thread: a.thread, end: null, keptBy: null, outcome: String(a.payload.verdict) };
        }
        const end = moveEnds.get(a.id);
        return {
          act: a.id, kind: String(a.payload['kind'] ?? ''), params: (a.payload['params'] ?? {}) as Record<string, unknown>, demand: demandOf(a.id),
          expiresAt: typeof a.payload['expires_at'] === 'string' ? a.payload['expires_at'] : null, at: iso(a.at), thread: a.thread,
          end: end ? { why: end.why, by: end.by, at: iso(end.at) } : null, keptBy: moveKeeps.get(a.id) ?? null,
        };
      });
      const last = page.at(-1);
      const older: MovesCursor | null = after.length > MOVES_LOG_PAGE && last ? { at: iso(last.at), act: last.id } : null;
      return { rows, older } satisfies MovesLog;
    },
    staffCareer(staff) {
      return careers.get(staff) ?? { led: [], offices: [] };
    },
    staffProfile(staff) {
      const latest = staffProfiles.filter((p) => p.key === staff).sort((a, b) => b.at - a.at).at(0);
      return latest ? ({ staff, at: iso(latest.at), interests: latest.interests, favorites: latest.favorites, mood: latest.mood, signature: latest.signature } satisfies StaffProfile) : null;
    },
    adminQueue() {
      if (!me()?.admin) throw new Error('only an admin reads the queue');
      const nameOf = (staff: string | null) => (staff === null ? null : [...characters.values()].find((c) => c.staff?.key === staff)?.name ?? null);
      const pronounsOf = (staff: string | null): PronounSet => (staff === null ? undefined : staffByKey(staff)?.pronouns) ?? settings.pronouns;
      const paramsOf = moveParams;
      const demandFor = moveDemand;
      const waiting = queue.filter((q) => q.landed === null && q.heldAt === null && !q.refusal).sort((a, b) => a.goLiveAt - b.goLiveAt || a.id - b.id).map((q): QueuedMove => q.successor !== undefined ? ({
        id: q.id, staff: q.staff, boss: nameOf(q.staff), bossPronouns: pronounsOf(q.staff), kind: 'nameSuccessor', params: { boss: q.successor }, demand: null, why: q.why, goLiveAt: iso(q.goLiveAt),
        expiresAt: null, structural: true, boardName: null, failedAt: null, failure: null, replacedAt: q.replacedAt === undefined ? null : iso(q.replacedAt), adminDescription: null,
      }) : ({
        id: q.id, staff: q.staff, boss: nameOf(q.staff), bossPronouns: pronounsOf(q.staff), kind: 'renameBoard', params: paramsOf(q.move), demand: demandFor(q.move), why: q.why, goLiveAt: iso(q.goLiveAt),
        expiresAt: q.move.expiresAt === undefined ? null : iso(q.move.expiresAt), structural: true, boardName: boards.find((b) => b.slug === q.move.board) ? boardNow(boards.find((b) => b.slug === q.move.board)!).name : null,
        failedAt: q.failure ? iso(q.failure.at) : null, failure: q.failure?.text ?? null, replacedAt: null, adminDescription: q.adminDescription ?? null,
      }));
      const rowOf = (a: ActRec) => {
        const q = queue.find((x) => x.landed === a.id);
        const who = a.character ? characters.get(a.character) : undefined;
        return { q, staff: who?.staff?.key ?? null, boss: who?.name ?? null, bossPronouns: who?.pronouns ?? settings.pronouns };
      };
      const live = inForce().map((a): MoveInForce => {
        const { q, staff, boss, bossPronouns } = rowOf(a);
        return {
          act: a.id, id: q?.id ?? null, staff, boss, bossPronouns, kind: String(a.payload['kind']), params: (a.payload['params'] ?? {}) as Record<string, unknown>, demand: demandOf(a.id),
          why: q?.why ?? null, landedAt: iso(a.at), expiresAt: typeof a.payload['expires_at'] === 'string' ? a.payload['expires_at'] : null, progress: toProgress(progressOf(a)),
        };
      });
      const since = now() - 30 * DAY;
      const ended: MoveEnded[] = [
        ...[...moveEnds.entries()].filter(([, e]) => e.at >= since).map(([id, e]): MoveEnded => {
          const a = acts.get(id)!;
          const { q, staff, boss, bossPronouns } = rowOf(a);
          return { how: e.why, by: e.by, at: iso(e.at), act: id, id: q?.id ?? null, staff, boss, bossPronouns, kind: String(a.payload['kind']), params: (a.payload['params'] ?? {}) as Record<string, unknown>, demand: demandOf(id), why: q?.why ?? null, landedAt: iso(a.at) };
        }),
        ...[...acts.values()].filter((e) => e.kind === 'card_end' && e.target !== null && e.at >= since).map((e): MoveEnded => {
          const play = acts.get(e.target!)!;
          return {
            how: 'reversed', by: 'admin', at: iso(e.at), act: play.id, id: null, staff: play.character ? characters.get(play.character)?.staff?.key ?? null : null,
            boss: play.character ? characters.get(play.character)?.name ?? null : null, bossPronouns: (play.character ? characters.get(play.character)?.pronouns : undefined) ?? settings.pronouns, kind: 'card', params: {}, demand: null, why: null, landedAt: iso(play.at),
            card: instance.cards.find((c) => c.key === play.payload.card)?.name ?? String(play.payload.card ?? ''),
          };
        }),
        ...queue.filter((q) => q.refusal && q.heldAt === null && q.refusal.at >= since).map((q): MoveEnded => ({
          how: 'refused', by: 'tick', at: iso(q.refusal!.at), act: null, id: q.id, staff: q.staff, boss: nameOf(q.staff), bossPronouns: pronounsOf(q.staff), kind: 'renameBoard', params: paramsOf(q.move), demand: demandFor(q.move), why: q.why, landedAt: null, reason: q.refusal!.text,
        })),
        ...queue.filter((q) => q.heldAt !== null && q.heldAt >= since).map((q): MoveEnded => ({
          how: 'held', by: 'admin', at: iso(q.heldAt!), act: null, id: q.id, staff: q.staff, boss: nameOf(q.staff), bossPronouns: pronounsOf(q.staff), kind: 'renameBoard', params: paramsOf(q.move), demand: demandFor(q.move), why: q.why, landedAt: null,
        })),
      ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      /* The Mod Bots' cards in force: a face-up `card` Act of a staff character, from the last 30 days, not caught, not worn off, not ended. */
      const staffCards = [...acts.values()].filter((a) => {
        if (a.kind !== 'card' || a.character === null || !characters.get(a.character)?.staff || a.at < since) return false;
        const ends = reachPlays.get(a.id)?.endsAt ?? (typeof a.payload.ends === 'string' ? Date.parse(a.payload.ends) : null);
        return a.payload.caught === undefined && (ends === null || ends > now()) && !over(a.id);
      }).sort((a, b) => b.at - a.at || a.order - b.order).map((a): StaffCardPlay => {
        const who = characters.get(a.character!)!;
        const reach = reachPlays.get(a.id)?.reach;
        const named = reach === 'character' ? characters.get(reachPlays.get(a.id)!.target)?.name : reach === 'thread' ? threads.get(reachPlays.get(a.id)!.target)?.title
          : reach === 'board' ? boards.find((b) => b.id === reachPlays.get(a.id)!.target)?.name : characters.get(acts.get(a.target ?? '')?.character ?? '')?.name;
        return {
          play: a.id, card: String(a.payload.card ?? ''), cardName: instance.cards.find((c) => c.key === a.payload.card)?.name ?? String(a.payload.card ?? ''),
          staff: who.staff!.key, persona: who.name, targetName: named ?? null, thread: a.thread, threadTitle: threads.get(a.thread)?.title ?? null, at: iso(a.at),
        };
      });
      return { cap: 100, waiting, inForce: live, staffCards: staffCards.slice(0, 100), ended, todos: handoverTodos(), more: { waiting: false, inForce: false, staffCards: staffCards.length > 100, ended: false },
        roster: [...characters.values()].filter((c) => c.staff && c.staff.office !== 'developer' && c.staff.office !== 'benched' && c.retiredAt === null).map((c) => ({ staff: c.staff!.key, name: c.name, pronouns: c.pronouns })) } satisfies AdminQueue;
    },
    dismissHandoverTodo(season) {
      if (!me()?.admin) return refuse('only an admin dismisses a to-do');
      if (!handovers.some((h, i) => i + 2 === season && h.outgoing !== h.boss)) return refuse(`there is no to-do for season ${season}: its handover did not change the Boss`);
      dismissedTodos.add(season);
      return ok({ season });
    },
    holdMove(id) {
      if (!me()?.admin) return refuse('only an admin holds a move');
      const q = queue.find((x) => x.id === id);
      if (!q) return refuse('there is no such queued move');
      if (q.landed !== null) return refuse('that move has already landed; reverse it instead');
      if (q.heldAt !== null) return refuse('that move is already held');
      q.heldAt = now();
      return ok({ id, heldAt: iso(q.heldAt) });
    },
    replaceSuccessor(id, boss) {
      if (!me()?.admin) return refuse('only an admin replaces a successor');
      const q = queue.find((x) => x.id === id);
      if (!q) return refuse('there is no such queued move');
      if (q.successor === undefined) return refuse('that move names no successor');
      if (q.landed !== null) return refuse('that nomination has already landed; reverse it instead');
      if (q.heldAt !== null) return refuse('that nomination is held');
      const roster = [...characters.values()].filter((c) => c.staff && c.staff.office !== 'developer' && c.staff.office !== 'benched' && c.retiredAt === null);
      if (!roster.some((c) => c.staff?.key === boss)) return refuse('that is not a Boss of the roster');
      if (boss === q.staff) return refuse('a Boss cannot succeed itself');
      q.successor = boss;
      q.replacedAt = now();
      return ok({ id, boss });
    },
    replaceQueuedDescription(id, description) {
      if (!me()?.admin) return refuse('only an admin replaces a description');
      const q = queue.find((x) => x.id === id);
      if (!q) return refuse('there is no such queued move');
      if (q.successor !== undefined) return refuse('that move renames no board');
      if (q.landed !== null) return refuse('that rename has already landed; describe the board instead');
      if (q.heldAt !== null) return refuse('that rename is held');
      if (/^\s*$/u.test(description)) return refuse('a description needs words');
      if ([...description].length > 2000) return refuse('a description is at most 2000 characters');
      q.adminDescription = description;
      return ok({ id, description });
    },
    describeBoard(board, description) {
      if (!me()?.admin) return refuse('only an admin describes a board');
      const b = boards.find((x) => x.id === board);
      if (!b) return refuse('there is no such board');
      if (/^\s*$/u.test(description)) return refuse('a description needs words');
      if ([...description].length > 2000) return refuse('a description is at most 2000 characters');
      describes.push({ board, moveAct: boardNow(b).moveAct, text: description });
      return ok({ board, description });
    },
    /* boss_roster_names (0082): the roster's own list, a waiting persona's name included, for an admin alone. */
    bosses() {
      if (!me()?.admin) throw new Error('only an admin reads the Boss list');
      return [...characters.values()].filter((c) => c.staff && c.staff.office !== 'developer' && c.staff.office !== 'benched' && c.retiredAt === null).map((c) => ({ staff: c.staff!.key, name: c.name, pronouns: c.pronouns }));
    },
    /* characters_public: staff that have debuted, for anyone. */
    staffNames() {
      return [...characters.values()].filter((c) => c.staff && c.debutedAt !== null).map((c) => ({ staff: c.staff!.key, name: c.name, pronouns: c.pronouns }));
    },
    reverseMove(act) {
      if (!me()?.admin) return refuse('only an admin reverses a move');
      const a = acts.get(act);
      if (!a || a.kind !== 'move') return refuse('that is not a move');
      if (moveEnds.has(act)) return refuse('that move has already ended');
      moveEnds.set(act, { why: 'reversed', by: 'admin', at: now() });
      const end = write({ character: null, kind: 'move_end', thread: a.thread, target: act, payload: { why: 'reversed', by: 'admin' } });
      return ok({ act, endedBy: end.id });
    },
    reverseCard(play) {
      if (!me()?.admin) return refuse('only an admin ends a card');
      const p = acts.get(play);
      if (!p || p.kind !== 'card') return refuse('that is not a card play');
      if (p.payload.caught !== undefined) return refuse('that card was caught by a trap, so it never landed');
      const ends = reachPlays.get(play)?.endsAt ?? (typeof p.payload.ends === 'string' ? Date.parse(p.payload.ends) : null);
      if (ends !== null && ends <= now()) return refuse('that card has already worn off');
      if (reversedPlays.has(play)) return refuse('an admin has already ended that card');
      if (untakenPlays.has(play)) return refuse(DID_NOT_TAKE);
      const end = write({ character: null, kind: 'card_end', thread: p.thread, target: play, payload: { why: 'reversed', by: 'admin' } });
      sendAct(end);
      if (!onPost(p)) { const shown = publicAct(end); send('reach', 'effect', () => { for (const l of [...reachListeners]) l.onPlay?.(shown); }); }
      return ok({ act: end.id, play });
    },
    visitStory(thread, visit, post): VisitStory {
      const mine = [...acts.values()].filter((a) => a.thread === thread);
      const attempts = mine.filter((a) => a.kind === 'intercept' && a.target === post && a.payload.visit_act === visit).sort((a, b) => a.order - b.order).map(publicAct);
      const verdict = mine.find((a) => a.kind === 'report_verdict' && a.payload.visit_act === visit);
      const report = verdict?.target ? mine.find((a) => a.id === verdict.target && a.kind === 'report') : undefined;
      const end = mine.find((a) => a.kind === 'visit_end' && a.target === visit);
      const inf = mine.find((a) => a.kind === 'infraction' && a.payload.visit_act === visit);
      const appeal = inf ? mine.filter((a) => a.kind === 'appeal' && a.target === inf.id).sort((a, b) => a.order - b.order)[0] : undefined;
      const ruling = appeal ? mine.find((a) => a.kind === 'appeal_ruling' && a.target === appeal.id) : undefined;
      return {
        report: report ? publicAct(report) : null, verdict: verdict ? publicAct(verdict) : null, attempts, end: end ? visitEndOf(end) : null,
        infraction: inf ? { act: inf.id, character: inf.payload.character as Id, points: inf.payload.points as number, band: inf.payload.band as VisitBand, ruleNumber: (inf.payload.rule_number as number | null) ?? null, expiresAt: inf.payload.expires_at as string, at: iso(inf.at) } : null,
        appeal: appeal ? publicAct(appeal) : null, ruling: ruling ? publicAct(ruling) : null,
        warnPoints: inf ? warnOf(inf.payload.character as Id) : null,
      };
    },
    intercept(through, visit, answer) {
      const who = acting(through);
      if (isRefusal(who)) return who;
      const v = acts.get(visit);
      if (!v || v.kind !== 'visit') return refuse('there is no such visit');
      if ([...acts.values()].some((a) => a.kind === 'visit_end' && a.target === visit)) return refuse('this visit is over');
      if ([...acts.values()].some((a) => a.kind === 'intercept' && a.character === through && a.payload.visit_act === visit)) return refuse('this character has already tried this visit');
      const challenge = v.payload.challenge as { kind: string; price?: number };
      const quiz = visitQuizzes.get(visit);
      let worked: boolean;
      let bribed = 0;
      if (challenge.kind === 'quiz') {
        const said = (answer ?? '').trim();
        if (said === '') return refuse('pick an answer');
        if (!quiz?.choices.includes(said)) return refuse('pick one of the answers shown');
        worked = said === quiz.answer;
      } else if (challenge.kind === 'bribe') {
        const account = me()!;
        const short = covers(account, challenge.price ?? 0);
        if (short) return short;
        bribed = challenge.price ?? 0;
        worked = true;
      } else return refuse('this Mod is moved by a card played on the thread, not by an answer or a payment');
      const written = write({ character: through, kind: 'intercept', thread: v.thread, target: v.target, payload: { visit_act: visit, kind: challenge.kind, succeeded: worked, ...(challenge.kind === 'quiz' ? { answer: (answer ?? '').trim() } : {}) } });
      if (bribed > 0) spend(me()!, bribed, 'bribe', written.id);
      let tailUntil: string | null = null;
      if (worked) write({ character: null, kind: 'visit_end', thread: v.thread, target: visit, payload: { visit_act: visit, outcome: 'intercepted', by_act: written.id, line: `${who.name} got past ${characters.get(v.character!)?.name ?? 'the Mod'}'s ${challenge.kind === 'quiz' ? 'quiz' : 'price'}.` } });
      else tailUntil = iso(now() + 24 * 3_600_000);
      return ok({ act: written.id, succeeded: worked, tailUntil });
    },
    fileReport(through, post, reason) {
      const who = acting(through);
      if (isRefusal(who)) return who;
      const banned = bannedUntilOf(through);
      if (banned !== null) return refuse(`this character is banned until ${iso(banned)}; the ban ends by itself then`);
      const said = reason.trim();
      if (said === '') return refuse('say why you are reporting this post', 'reason');
      if (said.length > 280) return refuse('a reason is at most 280 characters', 'reason');
      const p = acts.get(post);
      if (!p || (p.kind !== 'post' && p.kind !== 'spin')) return refuse('there is no such post to report');
      if (characters.get(p.character ?? '')?.staff) return refuse('a post by the staff is not reported');
      const mod = [...characters.values()].find((c) => c.staff?.office === 'mod' && c.debutedAt !== null && c.retiredAt === null);
      if (!mod) return refuse('there is no one on duty to hear a report right now');
      if (reportsLeftNow(through) <= 0) return refuse(`this character has made its ${settings.modBots.reportsPerDay} reports for today`);
      const account = me()!;
      const short = covers(account, settings.modBots.reportPrice);
      if (short) return short;
      const report = write({ character: through, kind: 'report', thread: p.thread, target: post, payload: { reason: said } });
      spend(account, settings.modBots.reportPrice, 'report', report.id);
      /* A judgment that failed: the price goes back, the report stays with no verdict, and it can be made again (staff/report.ts). */
      if (judged.report === 'failed') {
        giveBack(account, settings.modBots.reportPrice, report.id);
        refundedReports.add(report.id);
        return refuse('The Mod could not hear this report. Your Aura has been refunded, and you can make it again.');
      }
      const verdict = judged.report;
      const visit = verdict === 'visit' ? seed.visit(mod.id, post, { charges: [{ cause: 'report' }] }) : null;
      const line = verdict === 'visit' ? 'Noted. A visit is on its way.' : verdict === 'dismissed' ? 'Dismissed. Do not waste the staff\'s time.' : 'That report is a waste of the staff\'s time, and it will be remembered.';
      const given = write({ character: mod.id, kind: 'report_verdict', thread: p.thread, target: report.id, payload: { report_act: report.id, verdict, line, ...(visit ? { visit_act: visit } : {}) } });
      void given;
      return ok<ReportResult>({ report: report.id, verdict, line, visit });
    },
    fileAppeal(through, punishment, plea) {
      const who = acting(through);
      if (isRefusal(who)) return who;
      const said = plea.trim();
      if (said === '') return refuse('say why this punishment should change', 'plea');
      if (said.length > 1000) return refuse('a plea is at most 1000 characters', 'plea');
      const pun = acts.get(punishment);
      /* A group move that punishes (its group's tone, the instance's) and has not ended, of this character's: appealed by the character it moved (params.character). */
      const params = (pun?.payload['params'] ?? {}) as Record<string, unknown>;
      const movePunishes = pun?.kind === 'move' && pun.payload['kind'] === 'conferGroup' && params['character'] === through
        && instance.groups.conferred.find((g) => g.key === params['group'])?.tone === 'punishment';
      if (!pun || !((pun.kind === 'infraction' || pun.kind === 'ban') && pun.payload.character === through) && !movePunishes) return refuse('that is not a punishment of this character');
      if (movePunishes) {
        const end = moveEndsAt(pun);
        if (moveEnds.has(pun.id) || (end !== null && Date.parse(end) <= now())) return refuse('that punishment has already run out');
      }
      if ([...acts.values()].some((a) => a.kind === 'appeal' && a.target === punishment && !refundedAppeals.has(a.id))) return refuse('this punishment has already been appealed; each punishment is appealed once');
      const hearer = (movePunishes ? characters.get(pun.character ?? '') : undefined)
        ?? [...characters.values()].find((c) => c.staff && c.staff.office === (pun.kind === 'ban' ? 'boss' : 'mod') && c.debutedAt !== null && c.retiredAt === null)
        ?? [...characters.values()].find((c) => c.staff && c.debutedAt !== null && c.retiredAt === null && c.staff.office !== 'developer');
      if (!hearer) return refuse('there is no one on duty to hear an appeal right now');
      const account = me()!;
      const short = covers(account, settings.modBots.appealPrice);
      if (short) return short;
      const appeal = write({ character: through, kind: 'appeal', thread: pun.thread, target: punishment, payload: { plea: said } });
      spend(account, settings.modBots.appealPrice, 'appeal', appeal.id);
      if (judged.appeal === 'failed') {
        giveBack(account, settings.modBots.appealPrice, appeal.id);
        refundedAppeals.add(appeal.id);
        return refuse('No one could hear this appeal. Your Aura has been refunded, and you can appeal again.');
      }
      const verdict = judged.appeal;
      const points = pun.kind === 'infraction' ? Number(pun.payload.points) : 0;
      const delta = verdict === 'overturned' ? -points : verdict === 'reduced' ? -Math.ceil(points / 2) : verdict === 'increased' ? points : 0;
      const line = `${hearer.name} has heard it: ${verdict}.`;
      /* A ban's ruling names its new end (close_appeal): overturned ends it now, reduced halves it from its start, increased runs it half again. */
      let until: string | undefined;
      if (movePunishes) {
        /* A move's length is from its landing to its own end; none has no length, so reduced and increased are upheld (close_appeal). Increased adds half the length, never past moveExpiryMostDays from landing. Overturned ends it now, why overturned. */
        const own = typeof pun.payload['expires_at'] === 'string' ? Date.parse(pun.payload['expires_at']) : null;
        const length = own === null ? null : own - pun.at;
        const end = verdict === 'overturned' ? now() : length === null ? null : verdict === 'reduced' ? pun.at + length / 2 : verdict === 'increased' ? own! + Math.min(length / 2, Math.max(0, settings.moveExpiryMostDays * DAY - length)) : null;
        if (end !== null) until = iso(end);
      } else if (pun.kind === 'ban') {
        const days = Number(pun.payload.days);
        const start = pun.at;
        const was = Date.parse(String(pun.payload.until));
        const end = verdict === 'overturned' ? now() : verdict === 'reduced' ? start + (days * 86_400_000) / 2 : verdict === 'increased' ? was + (days * 86_400_000) / 2 : null;
        if (end !== null) until = iso(end);
      }
      write({ character: hearer.id, kind: 'appeal_ruling', thread: pun.thread, target: appeal.id, payload: { appeal_act: appeal.id, verdict, points_delta: delta, line, ...(until ? { until } : {}) } });
      if (movePunishes) {
        if (verdict === 'overturned') {
          moveEnds.set(pun.id, { why: 'overturned', by: 'appeal', at: now() });
          write({ character: null, kind: 'move_end', thread: pun.thread, target: pun.id, payload: { why: 'overturned', by: 'appeal' } });
        } else if (verdict === 'reduced' && until !== undefined && Date.parse(until) <= now()) {
          moveEnds.set(pun.id, { why: 'expired', by: 'appeal', at: now() });
          write({ character: null, kind: 'move_end', thread: pun.thread, target: pun.id, payload: { why: 'expired', by: 'appeal' } });
        }
      }
      const refunded = verdict === 'overturned' ? settings.modBots.appealPrice : 0;
      giveBack(account, refunded, appeal.id);
      return ok<AppealResult>({ appeal: appeal.id, verdict, line, pointsDelta: delta, refunded });
    },
    reportsLeft: (character) => reportsLeftNow(character),
    beatMod(board) {
      const mod = [...characters.values()].find((c) => c.staff?.office === 'mod' && c.debutedAt !== null && c.retiredAt === null);
      const b = boards.find((x) => x.id === board);
      return mod && b ? { mod: mod.name, pronouns: mod.pronouns, board: boardNow(b).name } : null;
    },
    myBan(character) {
      const mine = characters.get(character);
      const account = me();
      if (!account || mine?.owner !== account.id) return null;
      const endOf = (a: ActRec): number => Date.parse(String([...acts.values()].find((r) => r.kind === 'appeal_ruling' && typeof r.payload.until === 'string' && acts.get(r.target ?? '')?.target === a.id)?.payload.until ?? a.payload.until));
      const ban = [...acts.values()].filter((a) => a.kind === 'ban' && a.payload.character === character && endOf(a) > now()).sort((a, b) => b.at - a.at)[0];
      if (!ban) return null;
      const inf = acts.get(String(ban.payload.infraction_act));
      const ruled = [...acts.values()].find((r) => r.kind === 'appeal_ruling' && typeof r.payload.until === 'string' && acts.get(r.target ?? '')?.target === ban.id);
      return { ban: ban.id, character, until: String(ruled?.payload.until ?? ban.payload.until), days: Number(ban.payload.days), rule: inf ? ruleOf(inf) : null };
    },
    threads(board, page) {
      const all = [...threads.values()].filter((t) => t.board === board && listed(t)).map(summary)
        .sort((x, y) => Date.parse(y.lastAt) - Date.parse(x.lastAt) || y.id.localeCompare(x.id));
      return { threads: all.slice(page.offset, page.offset + page.limit), total: all.length };
    },
    thread: (id) => (threads.has(id) && id !== updatesThreadId ? summary(threads.get(id)!) : null),
    acts: (thread, from, to) => placed(thread).filter((a) => a.seq! >= from && a.seq! <= to).map(publicAct),
    act: (id) => (acts.has(id) ? publicAct(acts.get(id)!) : null),
    openingActs: (threads) => [...acts.values()].filter((a) => a.seq === 1 && threads.includes(a.thread)).map(publicAct),
    actsById: (ids) => [...new Set(ids)].filter((id) => acts.has(id)).map((id) => publicAct(acts.get(id)!)),
    history(id) {
      const original = acts.get(id);
      if (!original || original.kind !== 'post') return [];
      const versions = edits(original).map((e): Act => ({
        id: e.id, character: e.character, kind: 'edit', thread: e.thread, targetActId: id, seq: null, createdAt: iso(e.at), payload: e.payload,
        currentPayload: e.payload, editedAt: null, shownEditedAt: null,
      }));
      return [{ ...publicAct(original), currentPayload: original.payload, editedAt: null, shownEditedAt: null }, ...versions];
    },
    spunFrom: (act, limit = SPUN_FROM_MAX) => [...threads.values()].filter((t) => t.origin === act).sort((a, b) => a.at - b.at).slice(0, limit).map(summary),
    spunFromMany(ids, limit) {
      const wanted = new Set(ids);
      return [...threads.values()].filter((t) => t.origin !== null && wanted.has(t.origin)).sort((a, b) => a.at - b.at).slice(0, limit).map(summary);
    },
    cardsOnMany(ids, limit) {
      const wanted = new Set(ids);
      return withEnds([...acts.values()].filter((a) => (a.kind === 'card' || a.kind === 'set' || a.kind === 'spring') && a.target !== null && wanted.has(a.target)).sort((a, b) => a.at - b.at || a.order - b.order).slice(0, limit));
    },
    tails: (posts) => tails(posts),
    effectStates(plays) {
      const out: Record<Id, EffectState> = {};
      for (const play of plays) {
        const saved = effects.get(play);
        if (saved) out[play] = { state: saved.state, savedAt: iso(saved.at) };
      }
      return out;
    },
    log(before) {
      const account = me()?.id;
      /* Each source as the adapter reads its view (web/src/data/supabase.ts): newest first at or before the cursor, a page long, or all at one instant. */
      return readLogPageNow((range) => {
        const until = 'at' in range || range.before === null ? Infinity : micros(range.before);
        const at = 'at' in range ? micros(range.at) : null;
        const fits = (ms: number) => account !== undefined && (at === null ? ms * 1000 <= until : ms * 1000 === at);
        const cap = <T,>(rows: T[]) => ('at' in range ? rows : rows.slice(0, range.limit));
        const newest = <T extends { readonly ms: number; readonly order: number }>(rows: T[]) => cap(rows.sort((a, b) => b.ms - a.ms || b.order - a.order));
        const ledger: LedgerRow[] = cap([...settlements].sort((a, b) => b.endsAt - a.endsAt).filter((x) => fits(x.endsAt))
          .flatMap((x) => x.lines.filter((l) => l.account === account).map((l) => ({ settlement: x.id, startsAt: iso(x.startsAt), endsAt: iso(x.endsAt), sharesKept: x.sharesKept, character: l.character, reason: l.reason, amount: l.amount, ...(l.params ? { params: l.params } : {}) }))));
        const read = new Set(ledger.map((l) => l.settlement));
        const shares: ShareRow[] = settlements.filter((x) => read.has(x.id))
          .flatMap((x) => x.lines.filter((l) => l.account === account).flatMap((l) => l.shares.map((sh) => ({ settlement: x.id, character: l.character, reason: l.reason, ...sh }))));
        /* my_posts_played_on: the plays other players landed on the player's posts, characters, and threads their characters started (0056).
           A board has no owner, so a board play is no one's row. */
        const reachOf = (a: ActRec): 'post' | 'character' | 'thread' | 'board' => (a.payload.reach ?? 'post') as 'post' | 'character' | 'thread' | 'board';
        const targetOwner = (a: ActRec): Id | undefined => {
          switch (reachOf(a)) {
            case 'post': return characters.get(acts.get(a.target ?? '')?.character ?? '')?.owner;
            case 'character': return characters.get(String(a.payload.character))?.owner;
            case 'thread': return characters.get([...acts.values()].find((x) => x.thread === a.payload.thread && x.seq === 1)?.character ?? '')?.owner;
            default: return undefined;
          }
        };
        const targetCharacter = (a: ActRec): Id | null => reachOf(a) === 'post' ? acts.get(a.target ?? '')?.character ?? null
          : reachOf(a) === 'character' ? String(a.payload.character) : [...acts.values()].find((x) => x.thread === a.payload.thread && x.seq === 1)?.character ?? null;
        const targetName = (a: ActRec): string | null => reachOf(a) === 'character' ? characters.get(String(a.payload.character))?.name ?? null
          : reachOf(a) === 'thread' ? threads.get(String(a.payload.thread))?.title ?? null : null;
        const onMine = [...acts.values()].filter((a) => a.kind === 'card' && a.target !== null && a.character !== null
          && targetOwner(a) === account && characters.get(a.character)?.owner !== account);
        return {
          cosmetics: cosmeticLogOf(account, fits, cap),
          ledger,
          shares,
          wallet: newest(walletEvents.filter((e) => e.account === account && fits(e.ms))).map((e) => e.event),
          cards: newest([...cardLedger, ...endedLedger()].filter((e) => e.account === account && fits(e.ms))).map((e) => e.event),
          packs: newest(packLedger.filter((e) => e.account === account && fits(e.ms))).map((e) => e.event),
          playsOnMine: newest(onMine.filter((a) => fits(a.at)).map((a) => ({ ms: a.at, order: a.order, a }))).map(({ a }) => ({ play: a.id, post: a.target!, at: iso(a.at), reach: reachOf(a) as 'post' | 'character' | 'thread', targetName: targetName(a), targetCharacter: targetCharacter(a) })),
          /* my_posts_written_on (0149): each text or failure of a card that writes on a post one of the player's characters wrote, whoever played it. */
          writes: newest(texts.flatMap((t) => {
            const play = acts.get(t.play);
            const post = play?.kind === 'card' && play.target !== null ? acts.get(play.target) : undefined;
            if (!play || !post || (play.payload.reach ?? 'post') !== 'post' || characters.get(post.character ?? '')?.owner !== account || !fits(t.at)) return [];
            const mine = texts.filter((x) => x.play === t.play);
            /* `opening`: no earlier text of the play; `over`: the failure that ended it (refunded, and no row after it). */
            const opening = !mine.some((x) => x.text !== null && x.order < t.order);
            const over = t.text === null && untakenPlays.has(t.play) && !mine.some((x) => x.order > t.order);
            return [{ ms: t.at, order: t.order, w: { play: t.play, post: post.id, version: t.version, failed: t.text === null, opening, over, at: iso(t.at) } }];
          })).map(({ w }) => w),
          saves: newest(onMine.filter((a) => effects.has(a.id) && fits(effects.get(a.id)!.at)).map((a) => ({ ms: effects.get(a.id)!.at, order: a.order, a })))
            .map(({ a, ms }) => ({ play: a.id, post: a.target!, savedAt: iso(ms) })),
          /* The in-memory backend springs no trap, so a back ends here by its setter taking it back or by its time (my_face_down.ended_by); the caster's caught lines are the adapter's (my_caught). */
          setEnds: newest([...faceDown].filter(([, f]) => f.account === account && f.sprung === null && (f.takenBack !== undefined || f.endsAt <= now()))
            .map(([play, f]) => ({ ms: f.takenBack !== undefined ? acts.get(f.takenBack)!.at : f.endsAt, order: acts.get(play)!.order, f, play }))
            .filter((x) => fits(x.ms)))
            .map(({ f, play, ms }) => ({ play, card: f.card, post: f.post, spring: null, endedAt: iso(ms), endedBy: f.takenBack !== undefined ? 'taken back' as const : 'time' as const })),
          caught: [],
          /* my_cards_ended (0092): an admin's end of a play the player cast (`cast`, its own post's too) or of one that landed on theirs
             (`onMine`); a reversal between two other players is in neither's view. */
          ended: newest([...acts.values()].filter((e) => e.kind === 'card_end' && e.target !== null && fits(e.at)).flatMap((e) => {
            const play = acts.get(e.target!);
            if (!play || play.kind !== 'card') return [];
            const cast = characters.get(play.character ?? '')?.owner === account;
            if (!cast && targetOwner(play) !== account) return [];
            const reach = reachOf(play);
            /* A play beyond a post without its play_reach row is in no one's view (the view joins it); a board is only ever the caster's. */
            if (reach !== 'post' && !reachPlays.has(play.id)) return [];
            if (!cast && reach === 'board') return [];
            const targetAuthor = reach === 'post' ? acts.get(play.target ?? '')?.character : undefined;
            return [{ ms: e.at, order: e.order, e: {
              cardEnd: e.id, play: play.id, card: String(play.payload.card), at: iso(e.at), side: cast ? 'cast' as const : 'onMine' as const, reach,
              targetName: reach === 'board' ? boards.find((b) => b.id === play.payload.board)?.name ?? null : targetName(play),
              postAuthorName: targetAuthor == null ? null : characters.get(targetAuthor)?.name ?? null,
              casterName: characters.get(play.character ?? '')?.name ?? null,
              character: (cast ? play.character : targetCharacter(play)) as Id,
            } }];
          })).map(({ e }) => e),
          ...modLogOf(account, newest, fits),
        };
      }, before ?? null);
    },
    playMoment,
    myReleases: (plays) => plays.filter((play) => me() !== null && releases.has(`${me()!.id} ${play}`)),
    releaseEffect,
    saveEffect,
    buyCard: lossy(buyCard),
    buyPack: lossy(buyPack),
    machine: () => machine(),
    adminMachine() {
      if (!me()?.admin) throw new Error('only an admin reads the machine');
      /* The admin's own availability and price: a seeded move is already applied to the slot's (see `seed.slot`), so a Pull reads on sale again here and `was` is the price. */
      return [...slotRecs].sort((x, y) => x.position - y.position).map((r): AdminSlot => ({
        id: r.id, position: r.position, item: r.item, rarity: rarityOf(r.item), availability: adminAvailability(r),
        price: adminPrice(r), move: r.move ? { kind: r.move.kind, act: r.move.act, ends: r.move.ends, percent: r.move.percent, hours: r.move.hours } : null,
      }));
    },
    setSlot(slot, availability, price) {
      if (!me()?.admin) return refuse('only an admin changes the machine');
      const words = slotWords(availability, price);
      if (words) return refuse(words.error);
      const rec = slotRecs.find((r) => r.id === slot);
      if (!rec) return refuse('the machine has no such slot');
      const left = applySlot(rec, availability, price);
      return ok({ slot, ended: left ? endUnfloored() : 0 });
    },
    saveMachine(changes) {
      if (!me()?.admin) return refuse('only an admin changes the machine');
      if (!Array.isArray(changes)) return refuse('the machine is saved as a list of its slots');
      /* All of it or none: every word is checked before anything is written. */
      const seen = new Set<string>();
      for (const c of changes) {
        const words = slotWords(c.availability, c.price);
        if (words) return refuse(words.error, `${c.slot}/${words.field}`);
        if (!slotRecs.some((r) => r.id === c.slot)) return refuse('the machine has no such slot');
        if (seen.has(c.slot)) return refuse('a slot is named once');
        seen.add(c.slot);
      }
      if (seen.size !== slotRecs.length) return refuse('the machine has changed since this page was read: reload the page');
      const places = slotRecs.map((r) => r.position).sort((x, y) => x - y);
      let left = false;
      changes.forEach((c, i) => {
        const rec = slotRecs.find((r) => r.id === c.slot)!;
        rec.position = places[i]!;
        if (applySlot(rec, c.availability, c.price)) left = true;
      });
      return ok({ ended: left ? endUnfloored() : 0 });
    },
    moveSlot(slot, direction) {
      if (!me()?.admin) return refuse('only an admin moves a slot');
      if (direction !== 'up' && direction !== 'down') return refuse('a slot moves up or down');
      const grid = [...slotRecs].sort((x, y) => x.position - y.position);
      const at = grid.findIndex((r) => r.id === slot);
      if (at < 0) return refuse('the machine has no such slot');
      const other = grid[direction === 'up' ? at - 1 : at + 1];
      if (!other) return ok({ slot, moved: false });
      [grid[at]!.position, other.position] = [other.position, grid[at]!.position];
      return ok({ slot, moved: true });
    },
    playCard: lossy(playCard),
    setCard: lossy(setCard),
    takeBack: lossy(takeBack),
    useCard: lossy(useCard),
    myFaceDown: (sets) => {
      const account = me()?.id;
      return Object.fromEntries(sets.filter((s) => faceDown.get(s)?.account === account).map((s) => [s, faceDown.get(s)!.card]));
    },
    pinnedThreads: (board) => [...reachPlays]
      .filter(([play, r]) => r.reach === 'thread' && r.endsAt > now() && !reversedPlays.has(play) && threads.get(r.target)?.board === board && instance.cards.find((c) => c.key === acts.get(play)!.payload.card)?.pins === true)
      .map(([play, r]) => ({ thread: summary(threads.get(r.target)!), play, endsAt: iso(r.endsAt), act: publicAct(acts.get(play)!) }))
      .sort((a, b) => acts.get(b.play)!.at - acts.get(a.play)!.at || acts.get(b.play)!.order - acts.get(a.play)!.order),
    effectsAbove: (chars, thread, board) => {
      const wanted = new Set(chars);
      return [...reachPlays].filter(([play, r]) => r.endsAt > now() && !reversedPlays.has(play) && (r.reach === 'character' ? wanted.has(r.target) : r.reach === 'thread' ? r.target === thread : r.target === board))
        .map(([play, r]) => ({ play, reach: r.reach, target: r.target, endsAt: iso(r.endsAt), act: publicAct(acts.get(play)!) }))
        .sort((a, b) => acts.get(a.play)!.at - acts.get(b.play)!.at || acts.get(a.play)!.order - acts.get(b.play)!.order);
    },
    cardsOn: (act, limit) => withEnds([...acts.values()].filter((a) => (a.kind === 'card' || a.kind === 'set' || a.kind === 'spring') && a.target === act).sort((a, b) => a.at - b.at || a.order - b.order).slice(0, limit)),
    characters: (ids) => ids.map((id) => characters.get(id)).filter((c): c is CharRec => c !== undefined && c.debutedAt !== null).map(publicCharacter),
    characterCounts(id) {
      const c = characters.get(id);
      const counts: { posts: number; spins: number; cards: number } = { posts: 0, spins: 0, cards: 0 };
      if (!c || c.debutedAt === null) return counts;
      for (const a of acts.values()) {
        if (a.character !== id) continue;
        if (a.kind === 'post') counts.posts++;
        else if (a.kind === 'spin') counts.spins++;
        else if (a.kind === 'card') counts.cards++;
      }
      return counts satisfies CharacterCounts;
    },
    characterStats(ids) {
      const out: Record<Id, { posts: number }> = Object.fromEntries(ids.map((id) => [id, { posts: 0 }]));
      for (const a of acts.values()) {
        if (a.kind !== 'post' || a.character === null || characters.get(a.character)?.debutedAt == null) continue;
        const counted = out[a.character];
        if (counted) counted.posts++;
      }
      return out;
    },
    characterActs(id, kinds, page) {
      const c = characters.get(id);
      const all = c && c.debutedAt !== null
        ? [...acts.values()].filter((a) => a.character === id && kinds.includes(a.kind)).sort((x, y) => y.at - x.at || y.order - x.order)
        : [];
      return all.slice(page.offset, page.offset + page.limit).map(publicAct);
    },
    finishedSeasons: () => [...results.entries()].sort(([x], [y]) => y - x).slice(0, 200).map(([number, r]): SeasonFinished => {
      const season = seasons.find((s) => s.number === number);
      return { number, startsAt: season?.startsAt ?? iso(r.at), endsAt: season?.endsAt ?? iso(r.at), resultsAt: iso(r.at), characters: r.rows.length };
    }),
    resultsPage: (season, page) => resultOrder(results.get(season)?.rows ?? []).slice((Math.min(Math.max(Math.floor(page) || 1, 1), 10_000) - 1) * 50).slice(0, 50),
    resultPlace(season, character) {
      const index = resultOrder(results.get(season)?.rows ?? []).findIndex((r) => r.character === character);
      return index < 0 ? null : index;
    },
    tallies: (ids) => Object.fromEntries(ids.map((id) => [id, tallyOf(id)])),
    viewCounts: (ids) => Object.fromEntries(ids.map((id) => [id, views.get(id) ?? 0])),
    /* The open season, else the one that started last: standings_season()'s rule, never the highest number. */
    season: () => seasons.find((s) => s.endsAt === null) ?? [...seasons].sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt))[0] ?? null,
    standingAmounts: (ids) => Object.fromEntries(ids.map((id) => [id, standingOf.get(id) ?? 0])),
    standingPlace(id) {
      const s = ranking().find((x) => x.character === id);
      return s ? { standing: s.standing, place: s.place, of: [...characters.values()].filter((c) => c.debutedAt !== null).length } : null;
    },
    standingsPage: (offset, limit) => ranking().slice(Math.max(0, Math.floor(offset)), Math.max(0, Math.floor(offset)) + Math.max(0, Math.min(Math.floor(limit), 1000))),
    standingsCount: () => [...characters.values()].filter((c) => c.debutedAt !== null).length,
    lastSettledAt: () => (lastSettled === null ? null : iso(lastSettled)),
    classReveals: (ids) => [...acts.values()].filter((a) => a.character !== null && ids.includes(a.character) && (a.kind === 'unmask' || (a.kind === 'announce' && typeof a.payload.class === 'string')))
      .sort((a, b) => a.at - b.at || a.order - b.order)
      .map((a): ClassReveal => ({
        act: a.id, character: a.character!, class: String(a.payload.class), at: iso(a.at), via: (a.kind === 'announce' ? a.payload.what : a.payload.via) as ClassReveal['via'], thread: a.thread,
      })),
    turnsAnnounced(ids) {
      /* The old tallies' Turns beside the announce Acts that are Turns (0100), in the order they were written. */
      const out: { at: number; order: number; turn: TurnAnnounced }[] = [];
      for (const a of acts.values()) {
        if (a.kind === 'announce' && a.payload.what === 'turn' && a.character !== null && ids.includes(a.character)) {
          out.push({ at: a.at, order: a.order, turn: { act: a.id, character: a.character, at: iso(a.at), was: typeof a.payload.was === 'string' ? a.payload.was : null } });
        }
        if (a.kind !== 'tally') continue;
        const turns = Array.isArray(a.payload.turns) ? (a.payload.turns as readonly Record<string, unknown>[]) : [];
        for (const t of turns) {
          if (typeof t.character === 'string' && ids.includes(t.character)) {
            out.push({ at: a.at, order: a.order, turn: { act: a.id, character: t.character, at: iso(a.at), was: typeof t.was === 'string' ? t.was : null } });
          }
        }
      }
      return out.sort((x, y) => x.at - y.at || x.order - y.order).map((x) => x.turn);
    },
    nextSettlementAt: () => takesEffectAt(),

    myCharacters() {
      const account = me();
      if (!account) return [];
      return [...characters.values()].filter((c) => c.owner === account.id).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((c): MyCharacter => {
        const opens = turnOpens(c);
        const shown = classShownAt(c);
        return {
          id: c.id, name: c.name, pronouns: c.pronouns, class: classNow(c).cls, classSince: iso(classNow(c).at), classShownAt: shown === null ? null : iso(shown), classDueAt: classNow(c).dueAt === undefined ? null : iso(classNow(c).dueAt!),
          turnOpensAt: opens === null ? null : iso(opens),
          debutedAt: c.debutedAt === null ? null : iso(c.debutedAt), debutLoudness: c.loudness, retiredAt: c.retiredAt === null ? null : iso(c.retiredAt),
          pendingTurn: c.pending ? { class: c.pending.class, loudness: c.pending.loudness, showFrom: c.pending.showFrom, showTo: c.pending.showTo, takesEffectAt: takesEffectAt() } : null,
          presenceHidden: c.presenceHidden,
          ...(bannedUntilOf(c.id) !== null ? { bannedUntil: iso(bannedUntilOf(c.id)!) } : {}),
          ...(barsOf(c.id).length > 0 ? { bars: barsOf(c.id) } : {}),
        };
      });
    },
    wallet: (): Wallet => ({ balance: me()?.wallet ?? 0, cap: settings.walletCap }),
    myReactions(ids) {
      const account = me();
      return account ? reactions.filter((r) => r.account === account.id && ids.includes(r.act)).map((r): MyReaction => ({ act: r.act, kind: r.kind, character: r.character })) : [];
    },
    myCards: () => { const account = me(); return account ? [...new Set([...Object.keys(account.cards), ...endedBacks(account.id).map((f) => f.card)])].map((card): HeldCard => ({ card, held: heldOf(account, card) })).filter((c) => c.held > 0) : []; },
    reading(ids) {
      const account = me();
      const out: Record<Id, number> = {};
      if (account) for (const id of ids) if (account.reading.has(id)) out[id] = account.reading.get(id)!;
      return out;
    },
    markRead(thread, seq, through) {
      // A refusal is dropped, as the adapter drops the server's.
      const account = me();
      const t = threads.get(thread);
      if (!account || !t) return false;
      if (through !== null && isRefusal(acting(through))) return false;
      const clamped = Math.max(0, Math.min(seq, t.nextSeq - 1));
      account.reading.set(thread, Math.max(account.reading.get(thread) ?? 0, clamped));
      return true;
    },
    here(where, through): Presence {
      // here() (0041): a refusal rejects, as the adapter throws the server's.
      if (!me()) throw new Error('sign in with an account first');
      let place: Id | null = null;
      let board: Id | null = null;
      if (where.kind === 'thread') {
        const t = threads.get(where.thread);
        if (!t) throw new Error('there is no such thread');
        place = t.id;
        board = t.board;
      } else if (where.kind === 'board') {
        if (!boards.some((b) => b.id === where.board)) throw new Error('there is no such board');
        place = where.board;
        board = where.board;
      }
      const win = span(settings.presenceWindow);
      const at = now();
      if (through !== null) {
        const c = presenceMask(through);
        if (isRefusal(c)) throw new Error(c.error);
        // This mask's row and no other: a swap leaves the old mask to age out by itself.
        if (c.retiredAt === null && !c.presenceHidden) {
          const was = presence.get(c.id);
          const fresh = !was || was.seenAt < at - win;
          const moved = fresh || was.kind !== where.kind || was.place !== place;
          presence.set(c.id, { kind: where.kind, place, board, placeSince: moved ? at : was.placeSince, onlineSince: fresh ? at : was.onlineSince, seenAt: at });
        }
      }
      return presenceAt(where);
    },
    presenceBox: (place) => presenceAt(place),

    /* The screens' documents, each composed of the fake's own methods the document's types name, so a screen sees the same answers either way. */
    boot(): Boot {
      if (session.email === null) throw new Error('sign in first');
      const mine = core.myCharacters();
      return {
        settings: core.settings(), account: session.account, preferences: core.preferences(), characters: mine, faces: core.characters(mine.map((c) => c.id)),
        wallet: core.wallet(), cards: core.myCards(), boards: core.boards(), unread: me() ? core.alertsUnread() : 0, admin: me()?.admin ?? false,
        nextSettlementAt: core.nextSettlementAt(), lastSettledAt: core.lastSettledAt(), newestSettlement: core.log().settlements[0]?.endsAt ?? null,
      };
    },
    indexPage(): IndexPage {
      const boards = core.boards();
      const people = [...new Set(boards.flatMap((b) => (b.lastCharacter === null ? [] : [b.lastCharacter])))];
      return { boards, characters: core.characters(people), presence: presenceAt({ kind: 'index' }), unread: core.alertsUnread() };
    },
    searchPosts: (q, after) => searchPage(q, after, false, (row, _n, words) => searchHit(row, words)),
    searchThreads: (q, after) => searchPage(q, after, true, (row, n, words): ThreadHit => ({ ...searchHit(row, words), matches: Math.min(n, SEARCH_MATCHES_CAP), matchesMore: n > SEARCH_MATCHES_CAP })),
    suggest(prefix, o) {
      const kinds = o?.kinds ?? ['threads', 'characters', 'boards'];
      const most = o?.most ?? 5;
      /* The SQL's refusals, in its order (search_suggest); the prefix is measured trimmed. */
      if (kinds.length === 0 || !kinds.every((k) => k === 'threads' || k === 'characters' || k === 'boards')) throw new Error('kinds are threads, characters and boards');
      if (!Number.isInteger(most) || most < 1 || most > 10) throw new Error('a list holds 1 to 10 suggestions');
      const length = [...prefix.trim()].length;
      if (length > 100) throw new Error('a prefix is at most 100 characters');
      if (length === 1) throw new Error('a prefix is at least 2 characters');
      /* An empty prefix lists the newest threads, and only where threads alone are asked (the Reveal field's empty state). */
      if (length === 0 && !(kinds.length === 1 && kinds[0] === 'threads')) throw new Error('only the threads list takes an empty prefix');
      const empty = length === 0;
      const p = foldText(prefix.trim());
      const score = (text: string): number => (empty ? 1 : suggestMatch(text, p));
      const systemBoard = (id: Id): boolean => boards.find((b) => b.id === id)?.isSystem === true;
      const best = <T,>(items: readonly { readonly item: T; readonly text: string; readonly at: number }[]): T[] =>
        items.map((x) => ({ ...x, s: score(x.text) })).filter((x) => x.s > 0).sort((x, y) => y.s - x.s || y.at - x.at).slice(0, most).map((x) => x.item);
      return {
        threads: kinds.includes('threads')
          ? best([...threads.values()].filter((t) => t.id !== updatesThreadId && (o?.board == null || t.board === o.board) && !(o?.excludeSystem && systemBoard(t.board)))
            .map((t) => ({ item: { id: t.id, title: t.title, board: t.board, boardName: boards.find((b) => b.id === t.board)!.name }, text: t.title, at: t.at })))
          : [],
        characters: kinds.includes('characters') && !empty
          ? best([...characters.values()].filter((c) => c.debutedAt !== null).map((c) => ({ item: { id: c.id, name: c.name }, text: c.name, at: c.debutedAt! })))
          : [],
        boards: kinds.includes('boards') && !empty
          ? best(boards.filter((b) => !(o?.excludeSystem && b.isSystem)).map((b) => ({ item: { id: b.id, slug: b.slug, name: b.name }, text: b.name, at: 0 })))
          : [],
      };
    },
    boardPage(slug, page, effectCards): BoardPage | null {
      const board = core.board(slug);
      if (!board) return null;
      const THREADS = 20; // THREADS_PER_PAGE (engine/ui/board/Board.tsx), which the SQL's board_page also holds.
      const want = Math.max(1, page);
      let listed = core.threads(board.id, { offset: (want - 1) * THREADS, limit: THREADS });
      const shown = Math.min(want, Math.max(1, Math.ceil(listed.total / THREADS)));
      if (shown !== want) listed = core.threads(board.id, { offset: (shown - 1) * THREADS, limit: THREADS });
      const pins = shown === 1 ? core.pinnedThreads(board.id) : [];
      const banner = core.effectsAbove([], null, board.id);
      const marked = [...banner.map((p) => p.act), ...pins.map((p) => p.act)];
      const wanted = marked.filter((a) => typeof a.payload.card === 'string' && effectCards.includes(a.payload.card)).map((a) => a.id);
      const threads = [...pins.map((p) => p.thread), ...listed.threads];
      const ids = [...new Set(threads.map((t) => t.id))];
      const people = [...new Set([...threads.flatMap((t) => [t.firstCharacter, t.lastCharacter]), ...marked.map((a) => a.character)].filter((c): c is Id => c !== null))];
      return {
        board, total: listed.total, page: shown, threads: listed.threads, pins, banner, states: core.effectStates(wanted), releases: core.myReleases(wanted),
        tallies: core.tallies(marked.map((a) => a.id)), mine: core.myReactions(marked.map((a) => a.id)), reading: core.reading(ids), views: core.viewCounts(ids),
        characters: core.characters(people), presence: presenceAt({ kind: 'board', board: board.id }), unread: core.alertsUnread(),
      };
    },
    threadPage(thread, at, askedPerPage, effectCards): ThreadPage | null {
      const summary = core.thread(thread);
      if (!summary) return null;
      /* No per_page is the instance's own setting, as the server reads it. */
      const perPage = askedPerPage ?? settings.postsPerPage;
      if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) throw new Error('a page holds 1 to 100 Acts');
      const last = Math.max(1, Math.ceil(summary.lastSeq / perPage));
      const want = at.seq != null ? Math.max(1, Math.ceil(at.seq / perPage)) : at.page ?? 1;
      const page = Math.min(last, Math.max(1, want));
      const acts = core.acts(thread, (page - 1) * perPage + 1, page * perPage);
      const posts = acts.filter((a) => a.kind === 'post');
      const plays = posts.length ? core.cardsOnMany(posts.map((a) => a.id), posts.length * PLAYS_PER_POST) : [];
      const above = core.effectsAbove([...new Set(posts.flatMap((a) => (a.character === null ? [] : [a.character])))], thread, summary.board);
      const played = [...plays, ...above.map((p) => p.act)];
      const wanted = played.filter((a) => typeof a.payload.card === 'string' && effectCards.includes(a.payload.card)).map((a) => a.id);
      const ids = [...acts, ...played].map((a) => a.id);
      const visits = visitsOn(acts.filter((a) => a.kind === 'post' || a.kind === 'spin').map((a) => a.id));
      /* A visit's Mod is named on the page (`who` in thread_page, 0108), though it has no post there. */
      const who = [...new Set([...acts, ...played].flatMap((a) => (a.character === null ? [] : [a.character])).concat(visits.map((v) => v.mod)))].sort();
      const [chars, stats, standings, reveals, turns] = [core.characters(who), core.characterStats(who), core.standingAmounts(who), core.classReveals(who), core.turnsAnnounced(who)];
      return {
        thread: summary, page, acts,
        people: chars.map((character): ThreadPerson => ({
          character, posts: stats[character.id]?.posts ?? 0, standing: standings[character.id] ?? 0,
          reveals: reveals.filter((r) => r.character === character.id), turns: turns.filter((t) => t.character === character.id),
        })),
        plays, above, faces: core.myFaceDown(played.filter((a) => a.kind === 'set').map((a) => a.id)), states: core.effectStates(wanted), releases: core.myReleases(wanted),
        visits,
        tallies: core.tallies(ids), mine: core.myReactions(ids), spun: core.spunFromMany(ids, SPUN_FROM_MAX), reading: core.reading([thread]),
        board: core.board(summary.board), following: core.following(thread), presence: presenceAt({ kind: 'thread', thread }), unread: core.alertsUnread(),
      };
    },
    profilePage(id): ProfilePage | null {
      const character = core.characters([id])[0];
      if (!character) return null;
      const reveals = core.classReveals([id]);
      const turns = core.turnsAnnounced([id]);
      const acts = core.characterActs(id, ['post', 'spin', 'card'], { offset: 0, limit: PROFILE_ROWS });
      return {
        character, counts: core.characterCounts(id), standing: core.standingPlace(id), settledAt: core.lastSettledAt(), season: core.season(), reveals, turns, acts,
        targets: core.actsById([...acts.flatMap((a) => (a.kind === 'card' && a.targetActId !== null ? [a.targetActId] : [])), ...turns.map((t) => t.act)]),
        seasons: seasonsOf(id), unread: core.alertsUnread(),
      };
    },
    recordPage(id, asked, page): RecordPage | null {
      const character = core.characters([id])[0];
      if (!character) return null;
      const RECORD = RECORD_PAGE;
      const kind: RecordKind = (['all', 'post', 'spin', 'card', 'class', 'seasons'] as const).find((k) => k === asked) ?? 'all';
      const shown = Math.min(Math.max(page, 1), 10_000);
      const reveals = kind === 'all' || kind === 'class' ? core.classReveals([id]) : [];
      const turns = kind === 'all' || kind === 'class' ? core.turnsAnnounced([id]) : [];
      const seasons = kind === 'all' || kind === 'seasons' ? seasonsOf(id) : [];
      const kinds: Record<RecordKind, readonly ActKind[]> = { all: ['post', 'spin', 'card'], post: ['post'], spin: ['spin'], card: ['card'], class: [], seasons: [] };
      const from = kind === 'all' ? Math.max(0, (shown - 1) * RECORD - (reveals.length + turns.length + seasons.length)) : (shown - 1) * RECORD;
      const limit = kind === 'all' ? shown * RECORD - from : RECORD;
      const acts = core.characterActs(id, kinds[kind], { offset: from, limit });
      return {
        kind, page: shown, character,
        /* record_page reads no counters for the class and seasons views, and the adapter reads its null as zeros. */
        counts: kind === 'class' || kind === 'seasons' ? { posts: 0, spins: 0, cards: 0 } : core.characterCounts(id), reveals, turns, seasons, acts, windowFrom: from,
        targets: core.actsById([...acts.flatMap((a) => (a.kind === 'card' && a.targetActId !== null ? [a.targetActId] : [])), ...turns.map((t) => t.act)]),
        unread: core.alertsUnread(),
      };
    },
    myCharactersPage(): MyCharactersPage {
      const mine = core.myCharacters();
      const debuted = mine.filter((c) => c.debutedAt !== null).map((c) => c.id);
      return {
        characters: mine, faces: core.characters(debuted), counts: Object.fromEntries(mine.map((c) => [c.id, core.characterCounts(c.id)])),
        standings: core.standingAmounts(debuted), reveals: core.classReveals(debuted), turns: core.turnsAnnounced(debuted), nextSettlementAt: core.nextSettlementAt(),
      };
    },
    seasonPage(tab, season, character, page): SeasonPage | null {
      const now = core.season();
      const finished = core.finishedSeasons();
      const mode = tab === 'news' ? 'news' : season === null || season === now?.number ? 'standings' : finished.some((f) => f.number === season) ? 'results' : 'missing';
      if (mode === 'missing') return null;
      if (mode === 'news') return { tab: 'news', season: now, news: core.seasonNews(null) };
      const place = mode === 'results' && character !== null ? core.resultPlace(season!, character) : null;
      const shown = page !== null ? Math.min(Math.max(page, 1), 10_000) : Math.min(Math.max(place === null ? 1 : Math.floor(place / 50) + 1, 1), 10_000);
      if (mode === 'results') return { tab: 'results', season: now, finished, page: shown, place, results: core.resultsPage(season!, shown) };
      const standings = core.standingsPage((shown - 1) * 50, 50);
      const people = standings.map((x) => x.character);
      return { tab: 'standings', season: now, finished, page: shown, standings, size: core.standingsCount(), reveals: core.classReveals(people), turns: core.turnsAnnounced(people) };
    },
    alertsPage(before): AlertsPage {
      const alerts = core.alerts(before);
      const acts = new Map<Id, Act>();
      /* The rows' Acts, and the Acts those lead to, three links deep (alerts_page's chain). */
      let next = alerts.flatMap((a) => (a.act === null ? [] : [a.act]));
      for (let depth = 0; depth < 3 && next.length; depth++) {
        const read = core.actsById(next.filter((id) => !acts.has(id)));
        for (const a of read) acts.set(a.id, a);
        next = read.flatMap((a) => (a.targetActId === null ? [] : [a.targetActId]));
      }
      const threads = [...new Set(alerts.flatMap((a) => (a.thread === null ? [] : [a.thread])))];
      return {
        alerts, seenAt: core.preferences().alertsSeenAt, openedAt: (() => { try { return core.accountOpenedAt(); } catch { return null; } })(), acts: [...acts.values()],
        people: core.characters([...new Set([...acts.values()].flatMap((a) => (a.character === null ? [] : [a.character])))]), openings: core.openingActs(threads), reading: core.reading(threads),
      };
    },
    updatesPage(update, before, handoverSeason): UpdatesPage {
      const updates = core.updates(before);
      const open = update !== null && updates.some((u) => u.act === update) ? update : updates[0]?.act ?? null;
      return {
        updates, tallies: core.tallies(open === null ? [] : [open]), mine: core.myReactions(open === null ? [] : [open]),
        ...(handoverSeason !== null && core.isAdmin() ? { queue: core.adminQueue() } : {}),
      };
    },
    queuePage(): QueuePage | null {
      return core.isAdmin() ? { queue: core.adminQueue(), boardNames: core.boardNames(), bosses: core.bosses(), contact: core.adminContact() } : null;
    },
    logPage(before): LogPage {
      const log = core.log(before);
      const mine = core.myCharacters();
      const ids = mine.map((c) => c.id);
      /* Only a character's latest Turn is a line (lines.ts), so only its announcement is named. */
      const announced = core.turnsAnnounced(ids);
      const turns = announced.filter((t) => mine.some((c) => c.id === t.character && Date.parse(c.classSince) === Date.parse(t.at)));
      const acts = new Map<Id, Act>();
      for (const a of core.actsById(actsNamed(log, null, turns))) acts.set(a.id, a);
      for (let round = 0; round < 2; round++) for (const a of core.actsById(actsFollowed(acts))) acts.set(a.id, a);
      const unnamed: { character: Id[]; thread: Id[]; board: Id[] } = { character: [], thread: [], board: [] };
      for (const a of acts.values()) {
        const reach = a.payload.reach;
        if (a.kind !== 'card' || typeof a.payload.targetName === 'string' || (reach !== 'character' && reach !== 'thread' && reach !== 'board')) continue;
        const target = a.payload[reach];
        if (typeof target === 'string') unnamed[reach].push(target);
      }
      const others = [...new Set([...acts.values()].map((a) => a.character).concat(unnamed.character).filter((c): c is Id => c !== null && !ids.includes(c)))];
      const threads = [...new Set(turns.map((t) => acts.get(t.act)?.thread).concat(unnamed.thread).filter((t): t is Id => t !== undefined))];
      return {
        log, acts: [...acts.values()], states: core.effectStates([...new Set(log.saves.map((s) => s.play))]), people: core.characters(others),
        threads: threads.flatMap((id) => core.thread(id) ?? []), boards: [...new Set(unnamed.board)].flatMap((id) => core.board(id) ?? []),
        standings: core.standingAmounts(ids), turns: announced, season: core.season(),
      };
    },
    setPresenceHidden(character, hidden) {
      if (!me()) return refuse('sign in with an account first');
      const c = presenceMask(character);
      if (isRefusal(c)) return c;
      c.presenceHidden = hidden;
      /* Either way its row goes, as set_presence_hidden (0041) removes it: shown again, it is listed from its next poll. */
      presence.delete(c.id);
      return ok(hidden);
    },
    preferences: () => me()?.prefs ?? DEFAULT_PREFERENCES,
    setPreferences(p) {
      const account = me();
      if (!account) return refuse('sign in with an account first');
      if (p.theme !== undefined && !/^[a-z][a-z0-9-]{0,39}$/.test(p.theme)) return refuse('a theme is named in lowercase words joined by hyphens');
      if (p.postbit !== undefined && p.postbit !== 'side' && p.postbit !== 'stacked') return refuse('the postbit is side or stacked');
      if (p.motion !== undefined && p.motion !== 'system' && p.motion !== 'reduce' && p.motion !== 'full' && p.motion !== 'snappy') return refuse('motion follows the system, or is off, smooth or snappy');
      if (p.smoke !== undefined && !['full', 'low', 'off'].includes(p.smoke)) return refuse('the smoke is full, low or off');
      if (p.contrast !== undefined && p.contrast !== 'standard' && p.contrast !== 'high') return refuse('contrast is standard or high');
      if (p.textSize !== undefined && ![100, 125, 150, 200].includes(p.textSize)) return refuse('text size is 100, 125, 150 or 200 percent');
      if (p.mode !== undefined && p.mode !== 'system' && p.mode !== 'light' && p.mode !== 'dark') return refuse('the mode follows the device, or is light or dark');
      if (p.tilt !== undefined && p.tilt !== 'off' && p.tilt !== 'on') return refuse('tilt is off or on');
      if (p.effects !== undefined && p.effects !== 'standard' && p.effects !== 'bright') return refuse('effects are standard or bright');
      /* As set_preferences (0064) keeps the toasts: the kinds of alert there are, each once in the order first named, null for the defaults. */
      let toasts = account.prefs.toasts;
      if (p.toasts === null) toasts = null;
      else if (p.toasts !== undefined) {
        const unknown = [...new Set(p.toasts.filter((k) => !(ALERT_KINDS as readonly string[]).includes(k)))];
        if (unknown.length) return refuse(`not a kind of alert: ${unknown.join(', ')}`);
        toasts = [...new Set(p.toasts)];
      }
      /* The set of cards met, the welcome mark and the tips' state are no parameters of set_preferences: a stray one in a patch is ignored, as the server would. */
      const { cardsMet: _ignored, welcomedAt: _w, tips: _t, tipsSeen: _s, toasts: _toasts, ...choices } = p as PreferencesPatch & { cardsMet?: unknown; welcomedAt?: unknown; tips?: unknown; tipsSeen?: unknown };
      account.prefs = { ...account.prefs, ...choices, toasts };
      return ok(account.prefs);
    },
    meetCard(card) {
      const account = me();
      if (!account) return refuse('sign in with an account first');
      if (!/^[a-z][a-z0-9-]{0,39}$/.test(card)) return refuse('a card is named in lowercase words joined by hyphens');
      const met = account.prefs.cardsMet;
      if (!met.includes(card)) {
        if (met.length >= 64) return refuse('at most 64 cards are kept as met');
        account.prefs = { ...account.prefs, cardsMet: [...met, card] };
      }
      return ok(account.prefs);
    },
    seeWelcome() {
      const account = me();
      if (!account) return refuse('sign in with an account first');
      if (account.prefs.welcomedAt === null) account.prefs = { ...account.prefs, welcomedAt: iso(now()) };
      return ok(account.prefs);
    },
    seeTip(key) {
      const account = me();
      if (!account) return refuse('sign in with an account first');
      if (!/^[a-z][a-z0-9-]{0,39}$/.test(key)) return refuse('a tip is named in lowercase words joined by hyphens');
      const seen = account.prefs.tipsSeen;
      if (!seen.includes(key)) {
        if (seen.length >= 64) return refuse('at most 64 tips are kept as seen');
        account.prefs = { ...account.prefs, tipsSeen: [...seen, key] };
      }
      return ok(account.prefs);
    },
    skipTips() {
      const account = me();
      if (!account) return refuse('sign in with an account first');
      account.prefs = { ...account.prefs, tips: 'off' };
      return ok(account.prefs);
    },
    resumeTips() {
      const account = me();
      if (!account) return refuse('sign in with an account first');
      account.prefs = { ...account.prefs, tips: 'on' };
      return ok(account.prefs);
    },
    restoreTips() {
      const account = me();
      if (!account) return refuse('sign in with an account first');
      account.prefs = { ...account.prefs, tips: 'on', tipsSeen: [], cardsMet: [] };
      return ok(account.prefs);
    },
    replayTour() {
      const account = me();
      if (!account) return refuse('sign in with an account first');
      /* The tour waits on the welcome: an account that never saw it gets the mark, as replay_tour (0069) sets it. */
      account.prefs = { ...account.prefs, tips: 'on', welcomedAt: account.prefs.welcomedAt ?? iso(now()), tipsSeen: account.prefs.tipsSeen.filter((k) => !TOUR_TIPS.includes(k)) };
      return ok(account.prefs);
    },
    seeAlerts(at) {
      const account = me();
      if (!account) return refuse('sign in with an account first');
      if (!Number.isFinite(Date.parse(at))) return refuse('a mark is a time');
      /* Only forward, as see_alerts (0057) keeps it. (Not held to the clock: this backend's seeded times and its clock are not one story.) */
      const held = account.prefs.alertsSeenAt;
      if (held === null || Date.parse(held) < Date.parse(at)) account.prefs = { ...account.prefs, alertsSeenAt: at };
      return ok(account.prefs.alertsSeenAt!);
    },
    following(thread) {
      const account = me();
      if (!account) throw new Error('sign in with an account first');
      return follows(account, thread);
    },
    follow(thread, on) {
      const account = me();
      if (!account) return refuse('sign in with an account first');
      if (!threads.has(thread)) return refuse('there is no such thread');
      account.follows.set(thread, on);
      return ok(on);
    },
    followed() {
      const account = me();
      return account ? followedFor(account) : [];
    },
    alerts(before) {
      // my_alerts (0060): the newest page of the list older than `before`, extended to every line sharing the instant of its last.
      const account = me();
      if (!account) throw new Error('sign in with an account first');
      const until = before == null ? Infinity : Date.parse(before);
      const older = alertsOf(account).filter((a) => Date.parse(a.at) < until);
      const floor = older.length >= ALERTS_PAGE ? Date.parse(older[ALERTS_PAGE - 1]!.at) : -Infinity;
      return older.filter((a) => Date.parse(a.at) >= floor);
    },
    accountOpenedAt() {
      const account = me();
      if (!account) throw new Error('sign in with an account first');
      return Number.isFinite(account.createdAt) ? iso(account.createdAt) : null;
    },
    alertsUnread() {
      // my_alerts_unread (0060, 0066): what arrived after the account's mark (never set: since the account was opened), to the bound.
      const account = me();
      if (!account) throw new Error('sign in with an account first');
      const seen = account.prefs.alertsSeenAt === null ? account.createdAt : Date.parse(account.prefs.alertsSeenAt);
      return Math.min(ALERTS_UNREAD_BOUND, alertsOf(account).filter((a) => Date.parse(a.at) > seen).length);
    },
    settlementMoved(id) {
      // my_settlement_moved (0076): the caller's own ledger lines in the settlement, counted by character; none is null, as is an id nothing holds.
      const account = me();
      if (!account) throw new Error('sign in with an account first');
      if (!/^\d+$/.test(id)) throw new Error('a settlement is a whole number'); // the function takes bigint, so the database refuses the cast
      const x = settlements.find((y) => String(y.id) === id);
      const mine = x?.lines.filter((l) => l.account === account.id) ?? [];
      return x && mine.length > 0 ? { count: new Set(mine.map((l) => l.character)).size, at: iso(x.endsAt + APPLIED_AFTER) } : null;
    },
    seeSettlement(endsAt) {
      const account = me();
      if (!account) return refuse('sign in with an account first');
      if (!Number.isFinite(Date.parse(endsAt))) return refuse('a mark is a time');
      const held = account.prefs.settlementSeen;
      if (held === null || Date.parse(held) < Date.parse(endsAt)) account.prefs = { ...account.prefs, settlementSeen: endsAt };
      return ok(account.prefs.settlementSeen!);
    },
    estimate() {
      const account = me();
      if (!account) throw new Error('sign in to see your estimate');
      if (account.asked && now() < Date.parse(account.asked.freshAfter!)) return account.asked;
      account.asked = { entries: account.estimate.entries, lines: account.estimate.lines, asOf: iso(now()), freshAfter: iso(now() + 30_000) };
      return account.asked;
    },
    invites() {
      const account = me();
      if (!account) return [];
      return invites.filter((i) => i.owner === account.id).sort((a, b) => b.createdAt - a.createdAt || b.id - a.id).map((i): MyInvite => {
        const expiry = i.issuedAt + span(settings.inviteLifetime);
        return { id: i.id, createdAt: iso(i.createdAt), used: i.usedBy !== null, expiresAt: i.usedBy === null ? iso(expiry) : null, expired: i.usedBy === null && now() >= expiry };
      });
    },
    createInvite, reissueInvite,

    startThread, post: lossy(post), edit: lossy(edit), spin: lossy(spin), react, turn, withdrawTurn, unmask, createCharacter, setDebut,
    setProfile(character, title, signature, pipStyle, pronouns) {
      const c = acting(character);
      if (isRefusal(c)) return c;
      if ([...title].length > 40) return refuse('a title is at most 40 characters');
      if ([...signature].length > 500) return refuse('a signature is at most 500 characters');
      if (!options.instance.pipStyles.some((p) => p.key === pipStyle)) return refuse(`there is no pip style "${pipStyle}"`);
      if (pronouns !== undefined && !pronounsHold(pronouns)) return refuse(PRONOUNS_REFUSAL);
      if (pronouns !== undefined) c.pronouns = normalizePronouns(pronouns);
      c.title = title;
      c.signature = signature;
      c.pipStyle = pipStyle;
      return ok(publicCharacter(c));
    },
    setAvatar(upload: AvatarUpload) {
      if (!me()) return refuse('sign in to set an avatar');
      const c = acting(upload.character);
      if (isRefusal(c)) return c;
      if ((upload.portrait === null) !== (upload.portraitFrame === null)) return refuse('an avatar has a square crop, and a portrait crop with its frame or neither');
      const inside = (f: Frame) => f.x >= 0 && f.y >= 0 && f.w > 0 && f.h > 0 && f.x + f.w <= 1 && f.y + f.h <= 1;
      if (!inside(upload.squareFrame) || (upload.portraitFrame !== null && !inside(upload.portraitFrame))) return refuse('a crop frame lies inside its picture');
      if (upload.portrait === null && c.portrait === null) return refuse('an avatar is cut from a portrait; send it');
      // A new upload has new names, so a URL is immutable.
      const n = ++counter;
      c.square = `https://avatars.fake.test/${c.id}-${n}-square.webp`;
      if (upload.portrait !== null) { c.portrait = `https://avatars.fake.test/${c.id}-${n}-portrait.webp`; c.portraitFrame = upload.portraitFrame; }
      c.squareFrame = upload.squareFrame;
      /* A new portrait takes its outfit off: the pieces were placed over the old picture (set_avatar, 0150). */
      if (upload.portrait !== null) c.outfit = [];
      return ok(publicCharacter(c));
    },

    wardrobe: () => wardrobe(),
    setOutfit: lossy(setOutfit),
    trophies: (character, cursor) => trophiesOf(character, cursor),
    beltLineage: (trophy, cursor) => beltLineage(trophy, cursor),
    showTrophies: lossy(showTrophies),
    randomEvent: lossy(randomEvent),
    grantGear(character, gear, copies) {
      const no = adminOnly('grants gear');
      if (no) return no;
      if (!Number.isInteger(copies) || copies < 1 || copies > 100) return refuse('a grant is 1 to 100 copies');
      if (!instance.gear.some((g) => g.key === gear)) return refuse(`there is no gear "${gear}"`);
      const c = characters.get(character);
      if (!c) return refuse('there is no such character');
      const owner = accounts.get(c.owner)!;
      owner.gear[gear] = (owner.gear[gear] ?? 0) + copies;
      cosmeticEvents.push({ account: owner.id, ms: now(), row: { ...NO_COSMETIC, kind: 'granted', id: uuid(), at: iso(now()), character, item: gear, copies } });
      return ok({ granted: copies });
    },
    awardTrophy(trophy, character, line) {
      const no = adminOnly('gives a trophy');
      if (no) return no;
      return awardByAdmin(trophy, character, line);
    },
    reverseAward(award) {
      const no = adminOnly('takes a trophy back');
      if (no) return no;
      const a = awards.find((x) => x.id === award);
      if (!a) return refuse('there is no such trophy');
      if (a.reversed) return refuse('that trophy was already taken back');
      a.reversed = true;
      a.reversedAt = now();
      for (const c of characters.values()) c.shown = c.shown.filter((id) => id !== award);
      return ok({ reversed: award });
    },
    makeTrophy(name, line, art, belt) {
      const no = adminOnly('makes a trophy');
      if (no) return no;
      const n = name.trim();
      if ([...n].length < 1 || [...n].length > 60) return refuse('a trophy\'s name is 1 to 60 characters');
      const said = lineWords(line);
      if (typeof said === 'object' && said !== null) return said;
      const key = `made-${uuid()}`;
      madeKinds.push({ key, name: n, line: said, belt, art: art === null ? null : `${key}.webp` });
      return ok({ trophy: key });
    },
    trophyAwardFailures(cursor) {
      const no = adminOnly('reads the trophies that could not be given');
      if (no) return no;
      const view = (f: (typeof awardFailures)[number]): TrophyAwardFailure => {
        const characters = f.characters === null ? null : f.characters.map((c) => ({ ...c, given: failureGiven.has(`${f.id}:${c.id}`) }));
        return { ...f, characters, open: characters === null || characters.length === 0 || characters.some((c) => !c.given) };
      };
      /* The unresolved first, each group newest first; the cursor continues from the last row's open, instant and id. */
      const order = (x: TrophyAwardFailure, y: TrophyAwardFailure): number => Number(y.open) - Number(x.open) || (x.at < y.at ? 1 : x.at > y.at ? -1 : x.id < y.id ? 1 : x.id > y.id ? -1 : 0);
      const all = awardFailures.map(view).sort(order)
        .filter((f) => !cursor || order({ ...f, open: cursor.beforeOpen, at: cursor.before, id: cursor.beforeId }, f) < 0);
      return ok({ failures: all.slice(0, TROPHY_FAILURES_PAGE), more: all.length > TROPHY_FAILURES_PAGE });
    },
    giveFailedAward(failure, character) {
      const no = adminOnly('gives an award that could not be written');
      if (no) return no;
      const f = awardFailures.find((x) => x.id === failure);
      if (!f) return refuse('there is no such failed award');
      if (failureGiven.has(`${failure}:${character}`)) return refuse('that award was already given to that character');
      if (f.characters === null) return refuse('the characters that award was for cannot be read now; give it from Award a trophy');
      const c = f.characters.find((x) => x.id === character);
      const key = f.trophy ?? (c?.place === undefined ? undefined : instance.trophies.seasonPlaces[c.place - 1]);
      if (!c || key === undefined) return refuse('that character was not one the failed award was for');
      const done = awardByAdmin(key, character);
      if (done.ok) failureGiven.add(`${failure}:${character}`);
      return done;
    },
    adminAwards(cursor) {
      const no = adminOnly('reads the trophies given');
      if (no) return no;
      const before = cursor ? Date.parse(cursor.before) : null;
      const all = [...awards].filter((a) => before === null || a.at < before || (a.at === before && a.id < cursor!.beforeId))
        .sort((x, y) => y.at - x.at || (x.id < y.id ? 1 : x.id > y.id ? -1 : 0));
      const kinds = [...instance.trophies.kinds.map((k) => k.key), ...madeKinds.map((k) => k.key)].map((key): AdminKind => {
        const k = kindOf(key)!;
        return { key, name: k.name, belt: k.belt, made: key.startsWith('made-'), art: k.art };
      }).sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
      return ok({
        awards: all.slice(0, ADMIN_AWARDS_PAGE).map((a): AdminAward => {
          const k = kindOf(a.trophy)!;
          return { award: a.id, trophy: a.trophy, name: k.name, belt: k.belt, art: k.art, character: a.character, to: characters.get(a.character)?.name ?? '', by: givenBy(a.by), at: iso(a.at), line: a.line, reversed: a.reversed };
        }),
        kinds,
        more: all.length > ADMIN_AWARDS_PAGE,
      });
    },
    adminCharacterNamed(name) {
      const no = adminOnly('looks a character up by name');
      if (no) return no;
      const want = name.trim().toLowerCase();
      const c = [...characters.values()].find((x) => !x.staff && x.name.toLowerCase() === want);
      return ok(c ? { id: c.id, name: c.name } : null);
    },

    subscribeThread(thread, listener) {
      const set = threadListeners.get(thread) ?? new Set();
      threadListeners.set(thread, set.add(listener));
      return () => { set.delete(listener); };
    },
    subscribeBoard(board, listener) {
      const set = boardListeners.get(board) ?? new Set();
      boardListeners.set(board, set.add(listener));
      return () => { set.delete(listener); };
    },
    subscribeAccount(listener) {
      // The private channel is the signed-in account's own; signed out, there is none to hear.
      const account = session.account;
      if (account === null) return () => {};
      const set = accountListeners.get(account) ?? new Set();
      accountListeners.set(account, set.add(listener));
      return () => { set.delete(listener); };
    },
    subscribeReach(listener) {
      reachListeners.add(listener);
      return () => { reachListeners.delete(listener); };
    },
  };

  const api = Object.fromEntries(
    Object.entries(core).map(([name, f]) => [name, NOT_PROMISED.has(name) ? f : async (...args: unknown[]) => (f as (...a: unknown[]) => unknown)(...args)]),
  ) as unknown as KayfaApi;

  /* ----------------------------------------------------------------------- seed ---- */
  /** Run `act` as an account with nothing sent live, then put the session back; a refusal is a bug in the test. */
  function as<T>(account: Id, act: () => T): T {
    const before = session;
    session = { email: accounts.get(account)!.email, account };
    muted = true;
    try { return act(); } finally { session = before; muted = false; }
  }
  /** `as`, with the Acts it makes dated `at` when one is given. */
  function asAt<T>(account: Id, at: number | undefined, act: () => T): T {
    stamp = at ?? null;
    try { return as(account, act); } finally { stamp = null; }
  }
  const accepted = <T,>(a: Answer<T>): T => {
    if (!a.ok) throw new Error(`the seed was refused: ${a.error}`);
    return a.value;
  };
  const ownerOf = (character: Id) => {
    const c = characters.get(character);
    if (!c) throw new Error(`no such character ${character}`);
    return c.owner;
  };
  const systemBoard = (thread: Id) => {
    const found = threadAndBoard(thread);
    if (isRefusal(found)) throw new Error(found.error);
    if (!found.board.isSystem) throw new Error('an Act with no character is on the staff board');
    return found.t;
  };
  const systemAct = (thread: Id, o: SeedAct, body: string): ActRec => {
    systemBoard(thread);
    return write({ character: null, kind: o.kind ?? 'tally', thread, payload: { ...(o.payload ?? { body }) }, at: o.at });
  };

  const seeded = (account: Id): AccountRec => accepted(accounts.has(account) ? ok(accounts.get(account)!) : refuse(`no such account ${account}`));
  /** An account's settled wallet: whole hundredths, never under nothing, held to the cap as a settlement holds it. */
  const setWallet = (account: Id, balance: number) => {
    const a = seeded(account);
    if (!Number.isInteger(balance) || balance < 0) accepted(refuse(`a wallet is a whole number of hundredths, not ${balance}`));
    a.wallet = Math.min(balance, settings.walletCap);
  };

  /**
   * How long after its window ends a settlement is applied, for the wallet event it writes (wallet_move dates it at now(), when the
   * job runs): a second, so a settlement's lines and its wallet event are not one instant, as on the server, and a screen that
   * assumed they share a page would be caught here too. A moment seeded within that second of a settlement would read its event
   * as dated after the moment's own clock; no moment of the boards fixture is.
   */
  const APPLIED_AFTER = 1000;
  /**
   * A settlement's ledger, as apply_settlement writes it (0003, 0034): its lines and their shares, each account credited with its
   * lines' sum through wallet_move (held to the cap and the floor, the event saying what each cut off), each character's standing moved.
   * A seed that breaks what the server refuses throws in the server's words.
   */
  function settleLedger(at: number, lines: readonly SeedLine[], sharesKept: boolean, setOutright: Readonly<Record<Id, number>>) {
    const last = settlements[settlements.length - 1];
    const startsAt = last ? last.endsAt : at - span(settings.settlementLength);
    if (at <= startsAt) throw new Error('a window ends after it starts');
    const written = lines.map((l) => {
      const c = characters.get(l.character);
      if (!c) throw new Error(`no such character ${l.character}`);
      if (!Number.isInteger(l.amount) || l.amount === 0) throw new Error(`a ledger line is whole hundredths, never 0, not ${l.amount}`);
      const shares = (l.shares ?? []).map((sh) => ({ act: sh.act, quadrant: sh.quadrant ?? null, amount: sh.amount }));
      if (!sharesKept && shares.length > 0) throw new Error('a settlement made before its shares were kept carries none');
      if (shares.some((sh) => !acts.has(sh.act))) throw new Error('a share names an Act that does not exist');
      if (shares.some((sh) => !Number.isInteger(sh.amount) || sh.amount === 0)) throw new Error('a share\'s amount is whole hundredths, never 0');
      if (shares.length > 0 && shares.reduce((sum, sh) => sum + sh.amount, 0) !== l.amount) throw new Error('an entry\'s shares add up to it');
      return { account: c.owner, character: l.character, reason: l.reason, amount: l.amount, ...(l.params ? { params: l.params } : {}), shares };
    });
    const id = settlements.length + 1;
    settlements.push({ id, startsAt, endsAt: at, sharesKept, lines: written });
    sendSettled(id, at);
    const credits = new Map<Id, number>();
    for (const l of written) {
      credits.set(l.account, (credits.get(l.account) ?? 0) + l.amount);
      standingOf.set(l.character, (standingOf.get(l.character) ?? 0) + l.amount);
    }
    for (const [account, delta] of credits) {
      if (Object.hasOwn(setOutright, account)) throw new Error('an account\'s wallet is credited by its lines or set outright, not both');
      if (delta === 0) continue;
      const a = seeded(account);
      const raw = a.wallet + delta;
      const after = Math.min(settings.walletCap, Math.max(0, raw));
      recordWallet(account, at + APPLIED_AFTER, { settlement: id, kind: 'settlement', change: after - a.wallet, overflow: Math.max(0, raw - settings.walletCap), floored: Math.max(0, -raw), balanceAfter: after, ref: null });
      a.wallet = after;
    }
  }

  /* The written alerts the fake's seeds hold (`alerts`, 0058): a trap, a hint, a ruling. A quote and a card on an account's own are read from the Acts. */
  const seededAlerts: { readonly account: Id; readonly kind: WrittenKind; readonly sub: string | null; readonly act: Id; readonly character: Id | null; readonly at: number }[] = [];

  /**
   * Every alert of the account, newest first, as `my_alerts` (0060) unions them: written (a quote of its post, a card on its post,
   * character or thread by another player, and the seeded kinds), its followed threads with new posts, and the settlements that moved
   * its characters. Every player's news joins in the updates and season-news builds.
   */
  function alertsOf(account: AccountRec): Alert[] {
    const line = (a: Pick<Alert, 'kind' | 'sub' | 'act' | 'character'> & { at: number; thread?: Id | null; count?: number | null; title?: string | null; name?: string | null }): Alert => {
      const thread = a.thread ?? (a.act === null ? null : acts.get(a.act)?.thread ?? null);
      return { kind: a.kind, sub: a.sub, act: a.act, character: a.character, at: iso(a.at), thread,
        name: a.name !== undefined ? a.name : a.character === null ? null : characters.get(a.character)?.name ?? null,
        title: a.title !== undefined ? a.title : thread === null ? null : threads.get(thread)?.title ?? null, count: a.count ?? null };
    };
    const ownerOfCharacter = (c: Id | null | undefined) => (c == null ? undefined : characters.get(c)?.owner);
    const out: Alert[] = [];
    for (const a of acts.values()) {
      if ((a.character === null && a.kind !== 'card_end') || ownerOfCharacter(a.character) === account.id) continue;
      const derived = derivedAlert(a);
      if (derived?.account === account.id) out.push(line({ kind: derived.kind, sub: null, act: a.id, character: derived.character, at: a.at }));
    }
    for (const w of seededAlerts) if (w.account === account.id) out.push(line({ kind: w.kind, sub: w.sub, act: w.act, character: w.character, at: w.at }));
    for (const f of followedFor(account)) out.push(line({ kind: 'followed', sub: null, act: null, character: null, at: Date.parse(f.newestAt), thread: f.thread, title: f.title, count: f.newPosts }));
    /* Every player's news, the same for each (alerts_news, 0062): one line per update, and nothing of the player's in it. Season news joins here. */
    for (const n of newsItems()) out.push(line({ kind: 'seasonNews', sub: n.kind, act: n.act, character: null, at: Date.parse(n.at), thread: n.thread, title: null, name: n.name, count: n.count }));
    for (const u of updateActs()) out.push(line({ kind: 'update', sub: null, act: u.id, character: null, at: u.at, thread: u.thread, title: String(u.payload['title']), name: characters.get(u.character!)?.name ?? null }));
    for (const x of settlements) {
      const mine = x.lines.filter((l) => l.account === account.id);
      if (mine.length > 0) out.push(line({ kind: 'settlement', sub: String(x.id), act: null, character: null, at: x.endsAt + APPLIED_AFTER, count: new Set(mine.map((l) => l.character)).size }));
    }
    return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || String(a.sub ?? '').localeCompare(String(b.sub ?? '')) || String(a.act ?? '').localeCompare(String(b.act ?? '')));
  }

  const seed: Seed = {
    account(name, o) {
      const email = (o?.email ?? `${name.toLowerCase()}@example.test`).toLowerCase();
      const a = addAccount(email, o?.joinedAt ?? -Infinity);
      a.admin = o?.admin === true;
      if (o?.seasoned === true) a.prefs = { ...a.prefs, welcomedAt: SEASONED_WELCOME, tipsSeen: [...TIP_KEYS] };
      return a.id;
    },
    admin(account, on = true) { accounts.get(account)!.admin = on; },
    character(account, name, cls, o) {
      if (!accounts.has(account)) throw new Error(`no such account ${account}`);
      return addCharacter(account, name, cls, { debuted: o?.debuted ?? true, loudness: o?.loudness ?? 'announced', retired: o?.retired, at: o?.at, ...(o?.pronouns === undefined ? {} : { pronouns: o.pronouns }) }).id;
    },
    /** Copies of gear the account holds (`gear_ledger`): the state a seed starts from, past the Random Events and grants that would have made it. */
    gear(account, held) {
      const a = accounts.get(account);
      if (!a) throw new Error(`no such account ${account}`);
      for (const [gear, n] of Object.entries(held)) {
        if (!instance.gear.some((g) => g.key === gear)) throw new Error(`no gear ${gear}`);
        a.gear[gear] = (a.gear[gear] ?? 0) + n;
      }
    },
    /** An award a character stands with, dated `at` (else now): what the season, a met demand or the Boss would have written. */
    award(character, trophy, o) {
      if (!characters.has(character)) throw new Error(`no such character ${character}`);
      if (!kindOf(trophy)) throw new Error(`no trophy ${trophy}`);
      const id = uuid();
      awards.push({ id, trophy, character, at: o?.at ?? now(), by: o?.by ?? 'season', line: o?.line ?? null, season: o?.by === undefined || o.by === 'season' ? 1 : null, move: o?.move ?? null, reversed: false });
      return id;
    },
    /** The outcome of the next Random Event roll that comes past the window and the day's most, in place of the draw; null is a roll that finds nothing. */
    nextEvent(event) { scripted.push(event); },
    awardFailure(failure) {
      const id = uuid();
      awardFailures.push({ id, ...failure });
      return id;
    },
    retire(character) {
      const c = characters.get(character)!;
      c.retiredAt = now();
      // As retire_character does: a waiting Turn of a retired mask would never be applied.
      c.pending = null;
    },
    thread(slug, character, title, body = '', o = {}) {
      const board = boards.find((b) => b.slug === slug);
      if (!board) throw new Error(`no board ${slug}`);
      if (character === null) {
        if (!board.isSystem) throw new Error('an Act with no character is on the staff board');
        const t = openThread(board.id, title, null, o.at);
        return { thread: t.id, act: systemAct(t.id, o, body).id };
      }
      const made = accepted(asAt(ownerOf(character), o.at, () => startThread(slug, character, title, body)));
      return { thread: made.thread.id, act: made.act.id };
    },
    post(thread, character, body, o = {}) {
      if (character === null) return systemAct(thread, o, body).id;
      const made = accepted(asAt(ownerOf(character), o.at, () => post(thread, character, body, o.quote ?? null)));
      return made.id;
    },
    react(account, character, act, kind) { accepted(as(account, () => react(act, character, kind))); },
    settle(o) {
      const at = o.at ?? now();
      if (o.debut !== false) for (const c of characters.values()) if (c.debutedAt === null) c.debutedAt = at;
      if (o.turns !== false) {
        for (const c of characters.values()) {
          if (!c.pending) continue;
          /* The backstop (masks_change, 0074): a Turn never takes effect behind a reveal dated at or after the settlement's end. It
             waits for the next, due at the first it was passed over at. */
          if ([...acts.values()].some((a) => a.kind === 'unmask' && a.character === c.id && a.at >= at)) {
            c.pending.dueAt ??= at;
            continue;
          }
          c.history.push(c.pending.dueAt === undefined ? { cls: c.pending.class, at } : { cls: c.pending.class, at, dueAt: c.pending.dueAt });
          c.pending = null;
        }
      }
      if (o.ledger !== undefined) settleLedger(at, o.ledger, o.sharesKept ?? true, o.wallet ?? {});
      for (const [account, balance] of Object.entries(o.wallet ?? {})) setWallet(account, balance);
      for (const [character, amount] of Object.entries(o.standings ?? {})) standingOf.set(character, amount);
      lastSettled = at;
    },
    season(s) {
      const number = s.number ?? Math.max(...seasons.map((x) => x.number)) + (seasons.some((x) => x.number === s.number) ? 0 : 1);
      const was = seasons.find((x) => x.number === number);
      const next: Season = { id: number, number, startsAt: iso(now()), endsAt: null, turnsThread: null, revealAct: null, ...was, ...s };
      if (was) seasons.splice(seasons.indexOf(was), 1, next);
      else seasons.push(next);
    },
    nextSettlementAt(at) { nextSettlement = at; },
    views(thread, count) { views.set(thread, count); },
    legacyNumber(act) {
      const a = acts.get(act);
      if (!a || !(a.kind === 'card' || a.kind === 'set' || a.kind === 'spring')) throw new Error('only a play can keep a legacy place number');
      (a as { seq: number | null }).seq = threads.get(a.thread)!.nextSeq++;
    },
    alert(account, a) {
      seeded(account);
      if (!isWritten(a.kind) || a.kind === 'quote' || a.kind === 'cardOnYours' || a.kind === 'cardEnded') throw new Error(`a ${a.kind} alert is read from the Acts that make it, not seeded`);
      if (!acts.has(a.act)) throw new Error('an alert is about an Act that exists');
      if (a.character !== undefined && characters.get(a.character)?.owner !== account) throw new Error('an alert concerns a character of the account\'s');
      const line = { account, kind: a.kind, sub: a.sub ?? null, act: a.act, character: a.character ?? null, at: a.at ?? now() };
      seededAlerts.push(line);
      send(`account:${account}`, 'alert', () => { for (const l of [...(accountListeners.get(account) ?? [])]) l.onAlert?.({ id: crypto.randomUUID(), kind: line.kind, sub: line.sub, act: line.act, character: line.character, at: iso(line.at) }); });
    },
    handover(h) {
      if (h.outgoing !== null && h.outgoing !== undefined) staffId(h.outgoing);
      staffId(h.boss);
      handovers.push({ outgoing: h.outgoing ?? null, boss: h.boss, at: h.at ?? now(), how: h.how ?? 'rotation', bossWas: h.bossWas ?? null, outgoingOffice: h.outgoingOffice ?? 'member' });
      /* A change of Boss is two items of news, as news_announce (0063) queues them: the one who left, where there was one, and the one who arrived. */
      const at = iso(h.at ?? now());
      if (h.outgoing != null && h.outgoing !== h.boss) {
        const left = { kind: 'seasonNews' as const, sub: 'bossLeft', act: null, at };
        send('reach', 'news', () => { for (const l of [...reachListeners]) l.onNews?.(left); });
      }
      if (h.outgoing !== h.boss) {
        const arrived = { kind: 'seasonNews' as const, sub: 'bossArrived', act: null, at };
        send('reach', 'news', () => { for (const l of [...reachListeners]) l.onNews?.(arrived); });
      }
    },
    update(u) {
      const wrote = writeUpdate(u.title, u.body, u.changes ?? [], u.at);
      if (!wrote.ok) throw new Error(`a seeded update is refused: ${wrote.error}`);
      return wrote.value.act;
    },
    contact(links) {
      const wrote = writeContact(links);
      if (!wrote.ok) throw new Error(`a seeded contact is refused: ${wrote.error}`);
    },
    cards(account, held) { seeded(account).cards = { ...held }; },
    wallet(account, balance) { setWallet(account, balance); },
    invite(account, o) {
      if (!accounts.has(account)) throw new Error(`no such account ${account}`);
      const at = o?.at ?? now();
      const id = invites.length + 1;
      /* A used invite's user is an account; the seed has none to name, so the owner stands in (nothing reads who). */
      invites.push({ id, owner: account, code: newCode(id), createdAt: at, issuedAt: at, usedBy: o?.used === true ? account : null });
      return id;
    },
    buy(account, card, o) {
      const slot = machine().find((m) => 'card' in m.item && m.item.card === card);
      accepted(asAt(account, o?.at, () => (slot ? buyCard(slot) : refuse(`the machine has no slot for card ${card}`))));
    },
    slot(item, change) {
      const rec = slotRecs.find((r) => ('card' in item ? 'card' in r.item && r.item.card === item.card : 'pack' in r.item && r.item.pack === item.pack));
      if (!rec) throw new Error(`the machine has no slot for ${JSON.stringify(item)}`);
      if (change.availability) rec.availability = change.availability;
      if (change.price !== undefined) rec.price = change.price;
      if (change.move !== undefined) rec.move = change.move;
    },
    turn(character, to, o) { accepted(as(ownerOf(character), () => turn(character, to, o?.loudness ?? 'silent', o?.showFrom ?? false, o?.showTo ?? false))); },
    estimate(account, e) {
      const a = accounts.get(account)!;
      a.estimate = { entries: e.entries ?? [], lines: e.lines ?? [] };
    },
    reveal(character, thread, o = {}) {
      const c = characters.get(character)!;
      const at = o.at ?? now();
      return write({ character, kind: 'unmask', thread, payload: { class: o.class ?? classAt(c, at), message: o.message ?? '', via: o.via ?? 'act' }, at }).id;
    },
    announceTurn(character, thread, o = {}) {
      if (o.since === undefined) {
        const payload: Record<string, unknown> = { what: 'turn' };
        if (o.was !== undefined) payload.was = o.was;
        if (o.class !== undefined) payload.class = o.class;
        return write({ character, kind: 'announce', thread, payload, at: o.at }).id;
      }
      const turned: Record<string, unknown> = { character, name: characters.get(character)!.name, loudness: 'announced', was: o.was, since: o.since };
      if (o.was === undefined) delete turned.was;
      return systemAct(thread, { at: o.at, kind: 'tally', payload: { turns: [turned] } }, '').id;
    },
    announce(character, what, o = {}) {
      if (!characters.has(character)) throw new Error(`no such character ${character}`);
      if (what === 'debut' && o.was !== undefined) throw new Error('a debut has no class it was');
      const at = o.at ?? now();
      const season = seasons.filter((x) => Date.parse(x.startsAt) <= at && (x.endsAt === null || Date.parse(x.endsAt) > at)).sort((x, y) => y.number - x.number)[0]
        ?? seasons.find((x) => x.endsAt === null) ?? seasons[seasons.length - 1]!;
      let thread = season.turnsThread;
      if (thread === null) {
        const board = boards.find((b) => b.isSystem);
        if (!board) throw new Error('the instance has no System board');
        thread = openThread(board.id, (options.instance.copy?.announcementsThreadTitle ?? 'Season {season}: Promos').replace('{season}', String(season.number)), null, at).id;
        seasons.splice(seasons.indexOf(season), 1, { ...season, turnsThread: thread });
      }
      const payload: Record<string, unknown> = { what };
      if (o.was !== undefined) payload.was = o.was;
      if (o.class !== undefined) payload.class = o.class;
      return write({ character, kind: 'announce', thread, payload, at }).id;
    },
    seasonResults(season, rows, o = {}) {
      if (results.has(season)) throw new Error(`season ${season}'s results are written once, as the season ended`);
      results.set(season, { at: o.at ?? now(), rows: rows.map((r) => ({ character: r.character, name: r.name ?? characters.get(r.character)?.name ?? '', place: r.place, standing: r.standing, shown: r.shown ?? [] })) });
    },
    tally(act, counts) {
      if (!acts.has(act)) throw new Error(`no such Act ${act}`);
      for (const [kind, n] of Object.entries(counts)) for (let i = 0; i < n; i++) reactions.push({ act, account: '', character: '', kind });
    },
    staff(key, name, office, o) {
      if ([...characters.values()].some((c) => c.staff?.key === key)) throw new Error(`staff member ${key} exists`);
      const at = o?.at ?? now();
      const c: CharRec = {
        id: uuid(), owner: '', name, createdAt: at, debutedAt: o?.debuted === false ? null : at, retiredAt: null, loudness: 'silent', history: [{ cls: '', at }], pending: null, presenceHidden: false,
        title: o?.title ?? '', signature: o?.signature ?? '', pipStyle: options.instance.pipStyles[0]?.key ?? 'default',
        pronouns: o?.pronouns ?? options.instance.system.roster.find((r) => r.key === key)?.pronouns ?? settings.pronouns,
        square: null, portrait: null, squareFrame: null, portraitFrame: null, portraitTallness: null, outfit: [], shown: [], staff: { key, office },
      };
      characters.set(c.id, c);
      return c.id;
    },
    career(key, career) {
      staffId(key);
      careers.set(key, career);
    },
    staffProfile(key, p) {
      staffId(key);
      staffProfiles.push({ key, at: p.at ?? now(), interests: [...(p.interests ?? [])], favorites: [...(p.favorites ?? [])], mood: p.mood ?? '', signature: p.signature ?? '' });
    },
    staffPost(staff, thread, body, o) {
      if (!threads.has(thread)) throw new Error(`no such thread ${thread}`);
      if (!characters.get(staff)?.staff) throw new Error('only a staff character posts as staff');
      return write({ character: staff, kind: 'post', thread, payload: { body, ...(o?.ruling ? { ruling: o.ruling.verdict, apology: o.ruling.apology } : {}) }, at: o?.at }).id;
    },
    setOffice(staff, office) {
      const c = characters.get(staffId(staff));
      if (!c?.staff) throw new Error(`no staff member ${staff}`);
      c.staff = { ...c.staff, office };
    },
    trophyMove(staff, m) {
      const at = m.at ?? now();
      return write({
        character: staffId(staff), kind: 'move', thread: announcements(),
        payload: { kind: 'awardTrophy', office: 'boss', body: m.body ?? 'Behold, a trophy.', params: { character: m.character, trophy: m.trophy }, expires_at: iso(at + 3 * DAY) }, at,
      }).id;
    },
    groupMove(staff, m) {
      const at = m.at ?? now();
      const held = characters.get(staffId(staff))?.staff?.office;
      const office = m.office === undefined ? (held === 'boss' || held === 'mod' ? held : null) : m.office;
      const board = m.board === undefined ? undefined : boards.find((b) => b.slug === m.board)?.id;
      if (m.board !== undefined && !board) throw new Error(`no board ${m.board}`);
      return write({
        character: staffId(staff), kind: 'move', thread: announcements(),
        payload: {
          kind: 'conferGroup', ...(office ? { office } : {}), body: m.body ?? 'You have been moved.', params: { character: m.character, group: m.group, ...(board ? { board } : {}) },
          ...(m.demand === false ? {} : { demand: { kind: 'apologyAccepted', params: {} } }), ...(m.expiresAt === null ? {} : { expires_at: iso(m.expiresAt ?? at + 3 * DAY) }),
        }, at,
      }).id;
    },
    apology(character, move, state = 'pending', o) {
      const m = acts.get(move);
      if (!m || m.kind !== 'move') throw new Error(`no such move ${move}`);
      const at = o?.at ?? now();
      const t = openThread(threads.get(m.thread)!.board, 'An apology', move, at);
      const written = write({ character, kind: 'spin', thread: t.id, target: move, payload: { title: 'An apology', body: 'I am sorry.' }, at });
      apologies.push({ move, apology: written.id, character, state, at });
      return written.id;
    },
    move(staff, m) {
      const at = m.at ?? now();
      const boss = staffId(staff);
      const demand = moveDemand(m);
      const id = write({
        character: boss, kind: 'move', thread: announcements(),
        payload: { kind: 'renameBoard', body: m.body ?? 'This board has a new name.', params: moveParams(m), ...(demand ? { demand } : {}), expires_at: iso(m.expiresAt ?? at + 3 * DAY) }, at,
      }).id;
      if (m.uncounted) uncounted.add(id);
      return id;
    },
    endMove(act, end) {
      const a = acts.get(act);
      if (!a || a.kind !== 'move') throw new Error(`no such move ${act}`);
      if (moveEnds.has(act)) throw new Error('that move has ended');
      const at = end.at ?? now();
      moveEnds.set(act, { why: end.why, by: end.by ?? (end.why === 'reversed' ? 'admin' : end.why === 'superseded' ? 'boss' : end.why === 'spent' ? 'handover' : 'tick'), at });
      return write({ character: null, kind: 'move_end', thread: a.thread, target: act, payload: { why: end.why, by: end.by ?? (end.why === 'reversed' ? 'admin' : end.why === 'superseded' ? 'boss' : end.why === 'spent' ? 'handover' : 'tick') }, at }).id;
    },
    queueSuccessor(staff, boss, o) {
      staffId(staff);
      const rec: QueueRec = { id: queue.length + 1, staff, successor: boss, move: { board: '', name: '' }, why: o.why ?? 'it has the stamina', goLiveAt: o.goLiveAt, failure: null, heldAt: null, landed: null };
      queue.push(rec);
      return rec.id;
    },
    keepMove(act, staff, o) {
      const a = acts.get(act);
      if (!a || a.kind !== 'move') throw new Error(`no such move ${act}`);
      moveKeeps.set(act, staff);
      return write({ character: staffId(staff), kind: 'move_keep', thread: a.thread, target: act, payload: {}, at: o?.at }).id;
    },
    queueMove(staff, m) {
      staffId(staff);
      const rec: QueueRec = { id: queue.length + 1, staff, move: m, why: m.why ?? 'it seemed time', goLiveAt: m.goLiveAt, failure: m.failure ?? null, ...(m.refusal ? { refusal: m.refusal } : {}), heldAt: null, landed: null };
      queue.push(rec);
      return rec.id;
    },
    holdQueued(id, at) {
      const q = queue.find((x) => x.id === id);
      if (!q) throw new Error(`no queued move ${id}`);
      q.heldAt = at ?? now();
    },
    avatar(character, urls) {
      const c = characters.get(character)!;
      if (urls.square !== undefined) c.square = urls.square;
      if (urls.portrait !== undefined) c.portrait = urls.portrait;
    },
    card(character, target, card, o) {
      const on = acts.get(target);
      if (!on) throw new Error(`no such Act ${target}`);
      const payload: Record<string, unknown> = { card };
      if (o?.message !== undefined) payload.message = o.message;
      if (o?.layer !== undefined) payload.layer = o.layer;
      if (o?.config !== undefined) payload.config = o.config;
      /* The tokens a card that writes bought are the play's own fact (play_card writes them with the play): given, else what its rules say of the configuration against the settings of the seed. */
      const bought = o?.tokens ?? instance.cards.find((c) => c.key === card)?.writes?.tokens((o?.config ?? {}) as never, settings);
      if (bought !== undefined && Number.isSafeInteger(bought) && bought >= 1) payload.tokens = bought;
      /* A play a trap caught names its set, and takes no layer; a Use carries its end (0054). */
      if (o?.caught !== undefined) { payload.caught = o.caught; delete payload.layer; }
      if (o?.spring !== undefined) payload.spring = o.spring;
      if (o?.ends !== undefined) payload.ends = o.ends;
      /* A paid play is refused before its Act is written, as play_card refuses before it writes; the hand is the seed's to set (`cards`). */
      if (o?.paid !== undefined) {
        if (!Number.isInteger(o.paid) || o.paid < 0) throw new Error(`a price is a whole amount, at least zero, not ${o.paid}`);
        const short = covers(seeded(ownerOf(character)), o.paid);
        if (short) accepted(short);
      }
      /* A staff character's play has no owner to act as (staff_play_card writes it as The System): it is written as itself, at `at`. */
      const written = characters.get(character)?.staff
        ? write({ character, kind: 'card', thread: on.thread, target, payload, at: o?.at })
        : asAt(ownerOf(character), o?.at, () => write({ character, kind: 'card', thread: on.thread, target, payload }));
      if (o?.unrecorded) moments.delete(written.id);
      if (o?.paid !== undefined) {
        const account = seeded(ownerOf(character));
        stamp = written.at;
        try { spend(account, o.paid, 'play', written.id); } finally { stamp = null; }
        recordCard(account.id, written.at, { card, kind: 'played', act: written.id, price: o.paid });
      }
      if (o?.live) sendAct(written);
      return written.id;
    },
    reach(character, reach, target, card, o) {
      const rules = instance.cards.find((c) => c.key === card);
      const at = o?.at ?? stamp ?? now();
      let thread: Id;
      let on: Id | null;
      if (reach === 'character') {
        const from = o?.post ? acts.get(o.post) : undefined;
        if (!from || from.character !== target) throw new Error('a character play is played from one of its posts');
        thread = from.thread; on = from.id;
      } else if (reach === 'thread') {
        thread = target; on = [...acts.values()].find((a) => a.thread === target && a.seq === 1)?.id ?? null;
      } else { thread = announcements(); on = null; }
      const bound = span(settings.reachLasts[reach]);
      const endsAt = o?.ends ?? at + Math.min(rules?.lasts ? span(rules.lasts) : bound, bound);
      const written = asAt(ownerOf(character), at, () => write({ character, kind: 'card', thread, target: on, at, payload: { card, message: o?.message ?? '', config: o?.config ?? {}, reach, [reach]: target, ends: iso(endsAt) } }));
      reachPlays.set(written.id, { reach, target, endsAt });
      if (o?.live) { sendAct(written); sendReach(written); }
      return written.id;
    },
    set(character, target, card, o) {
      const on = acts.get(target);
      if (!on) throw new Error(`no such Act ${target}`);
      if (on.character !== character) throw new Error('a card is set face down on a post of its own author\'s');
      const written = asAt(ownerOf(character), o?.at, () => write({ character, kind: 'set', thread: on.thread, target, payload: {} }));
      faceDown.set(written.id, { account: ownerOf(character), card, post: target, endsAt: written.at + span(settings.setLasts), sprung: null });
      return written.id;
    },
    spring(set, o) {
      const f = faceDown.get(set);
      const back = acts.get(set);
      if (!f || !back) throw new Error(`no such card set face down ${set}`);
      const rules = instance.cards.find((c) => c.key === f.card);
      /* A Move springs on a quote, and a set card on its own trigger (a cast, or a visit). */
      const trigger = o?.trigger ?? (rules && kindOfPlay(rules) === 'cast' ? 'quote' : rules?.trap?.trigger.on ?? 'cast');
      const written = asAt(f.account, o?.at, () => write({
        character: back.character, kind: 'spring', thread: back.thread, target: f.post,
        payload: { card: f.card, trigger, did: trigger === 'quote' ? 'landed' : trigger === 'visit' ? 'ended' : 'caught', set, ...(o?.by ? { by: o.by } : {}), ...(o?.caught ? { by: o.caught, caught: o.caught } : {}) },
      }));
      f.sprung = written.id;
      return written.id;
    },
    loseNextAnswer(went) { losing = { went }; },
    visit(mod, post, o) {
      const p = acts.get(post);
      if (!p || (p.kind !== 'post' && p.kind !== 'spin')) throw new Error(`no such post ${post}`);
      if (!characters.get(mod)?.staff) throw new Error('only a staff character visits');
      const at = o?.at ?? now();
      const ch = o?.challenge ?? { kind: 'distraction' as const };
      const id = write({
        character: mod, kind: 'visit', thread: p.thread, target: post, at,
        payload: {
          charges: (o?.charges ?? [{}]).map((c) => ({ rule: c.rule ?? 'Rule 2: No double posting', rule_number: c.ruleNumber === undefined ? 2 : c.ruleNumber, band: c.band ?? 'minor', cause: c.cause ?? 'rule', about_act: post })),
          ends_at: iso(at + (o?.endsInMs ?? 3 * 3_600_000)), line: o?.line ?? 'Routine inspection.',
          challenge: ch.kind === 'quiz' ? { kind: 'quiz', question_index: 0 } : ch.kind === 'bribe' ? { kind: 'bribe', price: ch.price } : { kind: 'distraction' },
        },
      }).id;
      if (ch.kind === 'quiz') visitQuizzes.set(id, { question: ch.question, choices: ch.choices, answer: ch.answer });
      return id;
    },
    visitEnd(visit, e) {
      const v = acts.get(visit);
      if (!v || v.kind !== 'visit') throw new Error(`no such visit ${visit}`);
      return write({ character: null, kind: 'visit_end', thread: v.thread, target: visit, at: e.at, payload: { visit_act: visit, outcome: e.outcome, ...(e.by ? { by_act: e.by } : {}), line: e.line ?? '' } }).id;
    },
    report(character, post, reason, o) {
      const p = acts.get(post);
      if (!p) throw new Error(`no such post ${post}`);
      return write({ character, kind: 'report', thread: p.thread, target: post, at: o?.at, payload: { reason } }).id;
    },
    verdict(report, mod, verdict, o) {
      const r = acts.get(report);
      if (!r || r.kind !== 'report') throw new Error(`no such report ${report}`);
      return write({ character: mod, kind: 'report_verdict', thread: r.thread, target: report, at: o?.at, payload: { report_act: report, verdict, line: o?.line ?? '', ...(o?.visit ? { visit_act: o.visit } : {}) } }).id;
    },
    infraction(visit, o) {
      const v = acts.get(visit);
      const post = v?.target ? acts.get(v.target) : undefined;
      if (!v || v.kind !== 'visit' || !post) throw new Error(`no such visit ${visit}`);
      const at = o?.at ?? now();
      return write({
        character: null, kind: 'infraction', thread: v.thread, at,
        payload: { character: post.character, band: o?.band ?? 'minor', points: o?.points ?? 2, rule_number: o?.ruleNumber === undefined ? 2 : o.ruleNumber, about_act: post.id, visit_act: visit, staff: (v.character ? characters.get(v.character)?.staff?.key : undefined) ?? 'seed', expires_at: iso(o?.expiresAt ?? at + 14 * 86_400_000) },
      }).id;
    },
    appeal(character, infraction, plea, o) {
      const i = acts.get(infraction);
      if (!i || (i.kind !== 'infraction' && !(i.kind === 'move' && i.payload['kind'] === 'conferGroup'))) throw new Error(`no such infraction ${infraction}`);
      return write({ character, kind: 'appeal', thread: i.thread, target: infraction, at: o?.at, payload: { plea } }).id;
    },
    ruling(appeal, mod, verdict, o) {
      const a = acts.get(appeal);
      if (!a || a.kind !== 'appeal') throw new Error(`no such appeal ${appeal}`);
      return write({ character: mod, kind: 'appeal_ruling', thread: a.thread, target: appeal, at: o?.at, payload: { appeal_act: appeal, verdict, line: o?.line ?? '', ...(o?.until !== undefined ? { until: iso(o.until) } : {}) } }).id;
    },
    ban(character, until, o) {
      const inf = o?.infraction ? acts.get(o.infraction) : [...acts.values()].filter((a) => a.kind === 'infraction' && a.payload.character === character).sort((x, y) => y.at - x.at)[0];
      if (!inf) throw new Error('a ban follows an infraction that filled the bar');
      const at = o?.at ?? now();
      return write({ character: null, kind: 'ban', thread: inf.thread, at, payload: { character, days: o?.days ?? 1, until: iso(until), infraction_act: inf.id, season: 1 } }).id;
    },
    judging(answers) {
      if (answers.report) judged.report = answers.report;
      if (answers.appeal) judged.appeal = answers.appeal;
    },
    text(play, version, result, o) {
      const k = acts.get(play);
      if (!k || !writingPlay(k)) throw new Error(`no such writing play ${play}`);
      if (!acts.has(version)) throw new Error(`no such version ${version}`);
      /* A play that is over (an admin ended it, or its first generation failed and it was refunded) makes no text: a late finish writes nothing (finish_card_write, 0149). */
      if (over(play)) return;
      const job = jobs.get(play);
      texts.push({ play, version, text: 'text' in result ? result.text : null, at: now(), order: ++order });
      if (job && job.version === version) jobs.delete(play);
      /* finish_card_write (0149): a failure with no newer job waiting, for a play that never made a text, refunds it, and the play is over. */
      if (!('text' in result) && !jobs.has(play) && !texts.some((t) => t.play === play && t.text !== null) && !reversedPlays.has(play)) untakenPlays.add(play);
      if (o?.quiet) return;
      send(`thread:${k.thread}`, 'card_text', () => { for (const l of [...(threadListeners.get(k.thread) ?? [])]) l.onText?.(play, version); });
    },
    effect(thread, play) {
      const savedAt = iso(now());
      send(`thread:${thread}`, 'effect', () => { for (const l of [...(threadListeners.get(thread) ?? [])]) l.onEffect?.(play, savedAt); });
    },
  };

  return Object.assign(api, {
    signInAs(account: Id | null) {
      if (account === null) return setSession({ email: null, account: null });
      const a = accounts.get(account);
      if (!a) throw new Error(`no such account ${account}`);
      setSession({ email: a.email, account });
    },
    emailOf: (account: Id) => accounts.get(account)!.email,
    clock: { now, advance: (ms: number) => { offset += ms; } },
    broadcast: {
      log,
      reachListeners: () => reachListeners.size,
      hold() { held ??= []; },
      flush(o: { reverse?: boolean; twice?: boolean } = {}) {
        const batch = held ?? [];
        held = null;
        for (const deliver of o.reverse ? [...batch].reverse() : batch) {
          queueMicrotask(deliver);
          if (o.twice) queueMicrotask(deliver);
        }
        return batch.length;
      },
    },
    seed,
    marker: FAKE_BACKEND_MARKER,
  });
}
