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
 *  - A month is thirty days (a cooldown, a lifetime); the server counts calendar months.
 *  - A name is taken by the engine's own `sameName` (case and look-alike folding, as the database's).
 *  - A debut dropped "now" writes no announcement Act; tests that need one seed it.
 *  - A card's seeded settings are not drawn (a play carries no `seed`); a saved effect is kept as the post's author sent it, unchecked by the card's rules; and there is no check that a Turn's settlement is now due.
 */
import type { Instance, Settings, Span } from '../../rules/types.ts';
import { decide } from '../../rules/actions.ts';
import { atOrBelow, basePrice, casterMessage, decidePlay, decideSet, decideUse, effectsOnTarget, type BeyondPost, type CardEffect, type CardTarget, type EffectsAbove, type PostTarget, type Reach } from '../../rules/cards.ts';
import { sameName } from '../../rules/names.ts';
import { isWritten, type WrittenKind } from '../../rules/alerts.ts';
import { DEFAULT_DEVELOPER } from '../../rules/instance.ts';
import { ALERTS_PAGE, ALERTS_UNREAD_BOUND, DEFAULT_PREFERENCES, FOLLOWED_COUNT_CAP, LOST_ANSWER, MOVES_LOG_PAGE, SPUN_FROM_MAX, UPDATES_PAGE } from './api.ts';
import { buildMoveNotice, toDemand, toProgress } from './moves.ts';
import { micros, readLogPageNow, type LedgerRow, type ShareRow } from './log-page.ts';
import type {
  AdminQueue, BoardName, Demand, MoveEnded, MoveInForce, MoveLogRow, MovesCursor, MovesLog, QueuedMove, StaffProfile,
  Act, AccountListener, ActKind, Alert, Update, UpdateChange, Answer, AvatarUpload, Bought, Board, BoardListener, BoardSummary, CardEvent, Character, CharacterCounts, ClassReveal, CreatedCharacter, DebutLoudness, EffectState,
  DebutTiming, Estimate, EstimateLine, FollowedThread, Frame, HeldCard, Id, KayfaApi, LogShare, MyCharacter, MyInvite, MyReaction, PendingTurn, Preferences, PreferencesPatch, Refusal,
  Presence, PresencePlace, ReachListener, ScreenSettings, Season, Session, Standing, Tally, ThreadListener, ThreadSummary, TurnAnnounced, Wallet, WalletEvent,
} from './api.ts';

/** The code `verifyCode` accepts for any address. */
export const TEST_CODE = '123456';

const CODE_MESSAGE = 'If this address can sign in here, a code and a link to sign in are on their way to it. A new login needs an invite where this instance asks for one. If nothing comes in a few minutes, ask again.';
const SYSTEM_BOARD = 'only The System posts here; spin a thread from what it said';
const MINUTE = 60_000;
const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 29, 12);

export interface LiveEvent {
  readonly topic: string;
  readonly event: 'act' | 'tally' | 'thread' | 'effect' | 'alert';
}

export interface Seed {
  account(name: string, options?: { email?: string; admin?: boolean }): Id;
  admin(account: Id, on?: boolean): void;
  /** A character of an account; debuted unless said otherwise. */
  character(account: Id, name: string, cls: string, options?: { debuted?: boolean; retired?: boolean; loudness?: DebutLoudness; at?: number }): Id;
  retire(character: Id): void;
  /** A thread with its first Act; a null character is The System's, on its board only. */
  thread(board: string, character: Id | null, title: string, body?: string, options?: SeedAct): { thread: Id; act: Id };
  post(thread: Id, character: Id | null, body: string, options?: SeedAct & { quote?: Id }): Id;
  /** A reaction, refused in the server's words like any other. */
  react(account: Id, character: Id, act: Id, kind: string): void;
  /**
   * A settlement: debuts the waiting characters, applies the waiting Turns (class history starts
   * then, so the cooldown does), writes its ledger lines with their shares, credits each account's
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
  /**
   * An alert the writers of the Acts would have written for `account` (`write_alert`, 0058), of a kind that is not read from the Acts
   * themselves: a trap struck or sprung, a hint, a ruling. A quote and a card on the account's post, character or thread are alerts
   * here as the Acts that make them are (a post that quotes theirs, a card played on theirs by another player), so seeding either
   * is refused. `act` is the Act it is about, `character` the account's character it concerns, `at` an epoch (else now).
   */
  alert(account: Id, alert: { kind: WrittenKind; act: Id; character?: Id; sub?: string; at?: number }): void;
  /**
   * An update by the developer persona (what `post_update` writes, 0062), dated `at` (else now): the developer character is made on its first
   * update, from the instance's persona (else the engine's plain one), and so is the updates thread on The System's board. Returns the Act.
   */
  update(update: { title: string; body: string; changes?: readonly UpdateChange[]; at?: number }): Id;
  cards(account: Id, held: Readonly<Record<string, number>>): void;
  /** The account's settled wallet, as a purchase or a card play leaves it between settlements (`settle` sets it at one, and dates it). Writes no wallet event: it is the state the seed starts from. */
  wallet(account: Id, balance: number): void;
  /** A purchase from the Vending Machine by an account, dated `at`: `buyCard` as that player, refused as it is, with its wallet event and card ledger row. */
  buy(account: Id, card: string, options?: { at?: number }): void;
  /** A character's Turn asked by its player, waiting for the next settlement; refused in the server's words like any other. */
  turn(character: Id, to: string, options?: { loudness?: 'silent' | 'announced'; showFrom?: boolean; showTo?: boolean }): void;
  /** What the account's next estimate holds; its times are the ask's. */
  estimate(account: Id, estimate: { entries?: Estimate['entries']; lines?: readonly EstimateLine[] }): void;
  /** A character's unmask Act in a thread, as its player's reveal (`via` 'act') or a debut's or a Turn's. */
  reveal(character: Id, thread: Id, options?: { via?: ClassReveal['via']; class?: string; at?: number; message?: string }): Id;
  /** A tally Act in a thread of The System's board that announces a Turn of a character. */
  announceTurn(character: Id, thread: Id, options?: { was?: string; since?: string; at?: number }): Id;
  avatar(character: Id, urls: { square?: string; portrait?: string }): void;
  /** A tally on an Act as if that many others had reacted, kind by kind: no one's reaction (no account or character stands behind it), only the counts every reader sees. */
  tally(act: Id, counts: Readonly<Record<string, number>>): void;
  /** A staff character (a Boss or a Mod Bot): debuted, owned by no player, with no class; it acts only through the seed below. */
  staff(key: string, name: string, kind: 'boss' | 'bot', options?: { title?: string; signature?: string; at?: number; debuted?: boolean }): Id;
  /** A staff member's in-character profile, a version at `at` (the latest is the one read). */
  staffProfile(key: string, profile: { interests?: readonly string[]; favorites?: readonly Id[]; mood?: string; signature?: string; at?: number }): void;
  /** A staff character's post in a thread of The System's board, as the Boss posts there. */
  staffPost(staff: Id, thread: Id, body: string, options?: { at?: number }): Id;
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
  queueMove(staff: string, move: SeedMove & { goLiveAt: number; why?: string; failure?: { at: number; text: string } }): number;
  /** A nomination of a successor waiting in the admin queue (`boss` is a roster key); returns its queue id. */
  queueSuccessor(staff: string, boss: string, options: { goLiveAt: number; why?: string }): number;
  /** An admin's hold on a queued move, dated `at`: it never lands. */
  holdQueued(id: number, at?: number): void;
  /**
   * A card play by a character on an Act, in the Act's own thread (what a player's play makes; the cards plan makes the real action).
   * With `paid`, its player's card ledger records the play at that price and the wallet pays it, as `play_card` does (a wallet event
   * where it is more than 0); without, the play is an Act alone, held and paid for nowhere.
   */
  card(character: Id, target: Id, card: string, options?: { message?: string; config?: Readonly<Record<string, unknown>>; at?: number; live?: boolean; layer?: number; paid?: number; caught?: Id; ends?: string }): Id;
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
  spring(set: Id, options?: { trigger?: string; caught?: Id; at?: number }): Id;
  /** A saved card effect on a thread's play, heard by its subscribers. */
  effect(thread: Id, play: Id): void;
  /**
   * The next post, edit or spin gets no answer, as when the network drops: it answers with an
   * uncertain refusal. `went` says whether the server did it before the answer was lost.
   */
  loseNextAnswer(went: boolean): void;
}

/** A settled ledger line a seed writes: one reason's amount for one character, and its shares, which add up to it. */
export interface SeedLine {
  readonly character: Id;
  readonly reason: string;
  readonly amount: number;
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
  /** For The System's Acts: `tally` (default) or `reveal`. */
  readonly kind?: 'tally' | 'reveal';
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
  readonly history: { cls: string; at: number }[];
  pending: (PendingTurn & { asked: number }) | null;
  /** Hidden from every presence box (presence_hidden, 0041). */
  presenceHidden: boolean;
  title: string;
  signature: string;
  pipStyle: string;
  square: string | null;
  portrait: string | null;
  squareFrame: Frame | null;
  portraitFrame: Frame | null;
  /** Set for a staff character. */
  staff?: { readonly key: string; readonly kind: 'boss' | 'bot' | 'developer' };
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
  admin: boolean;
  prefs: Preferences;
  wallet: number;
  cards: Record<string, number>;
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
  const settings: Settings = { ...options.instance.settings, ...options.settings };
  const instance: Instance = { ...options.instance, settings };
  const screen: ScreenSettings = {
    postsPerPage: settings.postsPerPage, hotReplies: settings.hotReplies, editGrace: settings.editGrace, reactionCap: settings.reactionCap,
    charactersPerPlayer: settings.charactersPerPlayer, invitesPerPlayer: settings.invitesPerPlayer, inviteLifetime: settings.inviteLifetime,
    turnCooldown: settings.turnCooldown, walletCap: settings.walletCap, postMaxLength: settings.postMaxLength, titleMaxLength: settings.titleMaxLength,
    registrationMode: settings.registrationMode, settlementLength: settings.settlementLength, cardSettings: settings.cardSettings,
    presencePollSeconds: settings.presencePollSeconds, presenceWindow: settings.presenceWindow,
    /* What screen_settings's cardEconomy holds (0039): the economy this backend prices with, cut to what the cards' prices read. */
    cardEconomy: Object.fromEntries(Object.entries(settings.economy).filter(([key]) => instance.cards.some((c) => c.priceKey === key || (c.reads ?? []).some((r) => (typeof r === 'string' ? r : r.key) === key)))),
  };

  /* ----------------------------------------------------------------------- time ---- */
  let offset = 0;
  const base = options.now ?? (() => START);
  const now = () => base() + offset;
  const span = (s: Span) => s.count * (s.unit === 'minute' ? MINUTE : s.unit === 'day' ? DAY : s.unit === 'week' ? 7 * DAY : 30 * DAY);

  let counter = 0;
  const uuid = () => `00000000-0000-4000-8000-${(++counter).toString(16).padStart(12, '0')}`;

  /* ---------------------------------------------------------------------- state ---- */
  const accounts = new Map<Id, AccountRec>();
  const byEmail = new Map<string, Id>();
  const characters = new Map<Id, CharRec>();
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
  const seasons: Season[] = [{ id: 1, number: 1, startsAt: iso(START), endsAt: null, turnsThread: null, revealAct: null }];
  let lastSettled: number | null = null;
  let nextSettlement: number | null = null;
  const boards: Board[] = options.instance.boards.map((b) => ({ id: uuid(), slug: b.slug, name: b.name, description: b.description, isSystem: b.system === true, moveAct: null }));
  /* Moves: how each landed move ended, the staff profiles (versions, newest read), and the admin queue's own rows. */
  const moveEnds = new Map<Id, { why: 'met' | 'expired' | 'reversed' | 'superseded' | 'spent'; by: string; at: number }>();
  const staffProfiles: { key: string; at: number; interests: string[]; favorites: Id[]; mood: string; signature: string }[] = [];
  interface QueueRec { id: number; staff: string; successor?: string; move: SeedMove; why: string; goLiveAt: number; failure: { at: number; text: string } | null; heldAt: number | null; landed: Id | null; replacedAt?: number }
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
  function derivedAlert(a: ActRec): { account: Id; kind: 'quote' | 'cardOnYours'; character: Id } | null {
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
    };
  }

  /** Whether the account follows the thread: its choice, else whether one of its characters started it (following_thread, 0059). */
  const follows = (account: AccountRec, threadId: Id): boolean => {
    const chosen = account.follows.get(threadId);
    if (chosen !== undefined) return chosen;
    const opening = placed(threadId)[0];
    return opening?.character != null && characters.get(opening.character)?.owner === account.id;
  };
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

  function summary(t: ThreadRec): ThreadSummary {
    const all = placed(t.id);
    const first = all[0];
    const last = all.at(-1);
    const week = now() - 7 * DAY;
    const origin = t.origin === null ? undefined : acts.get(t.origin);
    const from = origin ? threads.get(origin.thread) : undefined;
    // The greatest time of any placed (non-edit) Act, as threads.last_at is; the creation time with none, since lastAt is not null here.
    return {
      id: t.id, board: t.board, title: t.title, originActId: t.origin, createdAt: iso(t.at), lastAt: iso(all.length ? Math.max(...all.map((a) => a.at)) : t.at), lastSeq: t.nextSeq - 1,
      replies: all.filter((a) => a.kind === 'post' && a.seq! > 1).length,
      firstAct: first?.id ?? null, firstCharacter: first?.character ?? null, lastAct: last?.id ?? null, lastCharacter: last?.character ?? null,
      // Capped at the hotReplies threshold, as thread_list counts it: a screen only compares it with that.
      repliesThisWeek: Math.min(settings.hotReplies, all.filter((a) => a.kind === 'post' && a.seq! > 1 && a.at > week && a.at <= now()).length),
      originThread: origin?.thread ?? null, originTitle: from?.title ?? null, originSeq: origin?.seq ?? null,
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

  function publicCharacter(c: CharRec): Character {
    return {
      id: c.id, name: c.name, title: c.title, signature: c.signature, avatarSquare: c.square, avatarPortrait: c.portrait, squareFrame: c.squareFrame,
      portraitFrame: c.portraitFrame, pipStyle: c.pipStyle,
      joined: `${iso(c.debutedAt!).slice(0, 7)}-01`,
      ...(c.staff ? { staff: c.staff.key, staffKind: c.staff.kind } : {}),
    };
  }

  /* ---------------------------------------------------------------------- moves ---- */
  /** The moves in force, newest first: a landed `move` Act with no end. */
  const inForce = () => [...acts.values()].filter((a) => a.kind === 'move' && !moveEnds.has(a.id)).sort((a, b) => b.at - a.at || b.order - a.order);
  /** A board as it is called now: its latest rename in force, else its own row (boards_now). */
  function boardNow(b: Board): Board {
    const m = inForce().find((a) => a.payload['kind'] === 'renameBoard' && (a.payload['params'] as Record<string, unknown>)['board'] === b.id);
    if (!m) return b;
    const p = m.payload['params'] as Record<string, unknown>;
    return { ...b, name: String(p['name']), description: String(p['description'] ?? b.description), moveAct: m.id };
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
      square: null, portrait: null, squareFrame: null, portraitFrame: null, staff: { key: 'developer', kind: 'developer' },
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
  const listed = (t: ThreadRec) => t.id !== updatesThreadId;
  /** `within` (0005): text that is something and no longer than the setting, in the server's words. */
  const within = (field: string, value: string, most: number): string | null =>
    /^[\s\u200b-\u200d\u2060]*$/u.test(value) ? `${field} is empty` : [...value].length > most ? `${field} is longer than ${most} characters` : null;
  /** One update, with the persona that wrote it (the `updates` read). */
  function updateOf(a: ActRec): Update {
    const c = characters.get(a.character!)!;
    return {
      act: a.id, thread: a.thread, character: c.id, name: c.name, tagline: c.title, avatar: (options.instance.developer ?? DEFAULT_DEVELOPER).avatar ?? null,
      title: String(a.payload['title']), body: String(a.payload['body']), changes: a.payload['changes'] as UpdateChange[], at: iso(a.at), seq: a.seq!,
    };
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
  function write(a: { character: Id | null; kind: ActKind; thread: Id; target?: Id | null; payload: Record<string, unknown>; at?: number }): ActRec {
    const t = threads.get(a.thread)!;
    /* An edit is a version of its post and a card is a tag on its post: neither takes a place in the thread (0035_card_takes_no_seq.sql). */
    const placedAct = a.kind !== 'edit' && a.kind !== 'card' && a.kind !== 'set' && a.kind !== 'spring';
    const rec: ActRec = {
      id: uuid(), order: ++order, character: a.character, kind: a.kind, thread: a.thread, target: a.target ?? null, seq: placedAct ? t.nextSeq++ : null,
      at: a.at ?? stamp ?? now(), payload: a.payload,
    };
    acts.set(rec.id, rec);
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

  function post(thread: Id, character: Id, body: string, quote: Id | null): Answer<Act> {
    const bad = request({ action: 'post', thread, character, body, quote });
    if (bad) return bad;
    const c = acting(character);
    if (isRefusal(c)) return c;
    const found = threadAndBoard(thread);
    if (isRefusal(found)) return found;
    if (found.board.isSystem) return refuse(SYSTEM_BOARD);
    if (quote !== null && !acts.has(quote)) return refuse('there is no such Act to quote');
    const written = write({ character, kind: 'post', thread, target: quote, payload: { body } });
    sendAct(written);
    return ok(publicAct(written));
  }

  function startThread(boardSlug: string, character: Id, title: string, body: string): Answer<{ thread: ThreadSummary; act: Act }> {
    const bad = request({ action: 'startThread', board: boardSlug, character, title, body });
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
    return ok({ thread: summary(t), act: publicAct(written) });
  }

  function spin(origin: Id, character: Id, title: string, body: string): Answer<{ thread: ThreadSummary; act: Act }> {
    const bad = request({ action: 'spin', origin, character, title, body });
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

  /** The state a play's effect has saved, as effect_state keeps it: one row per play, the newest save. */
  const effects = new Map<Id, { state: unknown; at: number }>();
  /** The plays an account has released itself from, as "account play". */
  const releases = new Map<string, number>();
  const playOf = (id: Id) => { const a = acts.get(id); return a && a.kind === 'card' ? a : null; };

  /* The player's log: the settlements' ledger with its shares, every wallet event and the card ledger, each by account (0003, 0006, 0034). */
  interface SettlementRec { readonly id: number; readonly startsAt: number; readonly endsAt: number; readonly sharesKept: boolean; readonly lines: readonly (LedgerLine & { readonly account: Id })[] }
  interface LedgerLine { readonly character: Id; readonly reason: string; readonly amount: number; readonly shares: readonly LogShare[] }
  const settlements: SettlementRec[] = [];
  const walletEvents: { readonly account: Id; readonly order: number; readonly event: WalletEvent; readonly ms: number }[] = [];
  const cardLedger: { readonly account: Id; readonly order: number; readonly event: CardEvent; readonly ms: number }[] = [];
  let logOrder = 0;
  const recordWallet = (account: Id, at: number, e: Omit<WalletEvent, 'at'>) => { walletEvents.push({ account, order: ++logOrder, ms: at, event: { ...e, at: iso(at) } }); };
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
    const at = now();
    effects.set(play, { state, at });
    send(`thread:${played.thread}`, 'effect', () => { for (const l of [...(threadListeners.get(played.thread) ?? [])]) l.onEffect?.(play, iso(at)); });
    return ok({ play, savedAt: iso(at) });
  }

  function releaseEffect(play: Id): Answer<{ play: Id; releasedAt: string }> {
    const account = me();
    if (!account) return refuse('sign in to act');
    if (!playOf(play)) return refuse('there is no such card on a post');
    /* Kept from the first release. */
    const key = `${account.id} ${play}`;
    if (!releases.has(key)) releases.set(key, now());
    return ok({ play, releasedAt: iso(releases.get(key)!) });
  }

  /**
   * What a wallet debit refuses, in the words of `wallet_spend` (0006_cards.sql): the amounts are hundredths, as the server says them.
   * Returns the balance left, or the refusal.
   */
  function spend(account: AccountRec, amount: number, what: 'purchase' | 'play', ref: Id | null): number | Refusal {
    const short = covers(account, amount);
    if (short) return short;
    /* As wallet_spend: a price of nothing moves nothing, and writes no event. */
    if (amount === 0) return account.wallet;
    account.wallet -= amount;
    recordWallet(account.id, stamp ?? now(), { settlement: null, kind: what, change: -amount, overflow: 0, floored: 0, balanceAfter: account.wallet, ref });
    return account.wallet;
  }
  /** `wallet_spend`'s refusal of a price the wallet does not hold, or nothing. */
  const covers = (account: AccountRec, amount: number): Refusal | null => (account.wallet < amount ? refuse(`that costs ${amount}, and your wallet holds ${account.wallet}`) : null);

  /** `buy_card` (0006_cards.sql): the card's base price from the settled wallet, and one more of it in the hand. */
  function buyCard(card: string): Answer<Bought> {
    const bad = request({ action: 'buyCard', card });
    if (bad) return bad;
    const account = me()!;
    const price = basePrice(instance.cards.find((c) => c.key === card)!, settings);
    const left = spend(account, price, 'purchase', null);
    if (typeof left !== 'number') return left;
    account.cards[card] = (account.cards[card] ?? 0) + 1;
    recordCard(account.id, stamp ?? now(), { card, kind: 'bought', act: null, price });
    return ok({ card, balance: left, held: account.cards[card]! });
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
    const decided = decidePlay(rules, settings, { reach: 'post', act: on.id, kind: on.kind as PostTarget['kind'], length: typeof text === 'string' ? [...text].length : 0 }, effects, config, message, { nameOf: (k) => instance.cards.find((c) => c.key === k)?.name ?? k });
    if (!decided.ok) return refuse(decided.why, message !== undefined && !casterMessage(message).ok ? 'message' : 'config');
    const c = acting(character);
    if (isRefusal(c)) return c;
    const account = me()!;
    if ((account.cards[card] ?? 0) < 1) return refuse(`you hold no "${card}" card; the Vending Machine sells them`);
    const short = covers(account, decided.value.price);
    if (short) return short;
    account.cards[card]! -= 1;
    const layer = [...acts.values()].filter((a) => a.kind === 'card' && a.target === target && a.payload.card === card && a.payload.caught === undefined && onPost(a)).length + 1;
    /* A live trap on a cast that is no rarer than it catches the play (spring_traps): the spring is written first, as the server writes it. */
    const trap = liveBack(target);
    const trapRules = trap ? instance.cards.find((c) => c.key === trap.card) : undefined;
    const catches = trap && trapRules?.trap?.trigger.on === 'cast' && atOrBelow(rules.rarity, trapRules.rarity) && ownerOf(acts.get(trap.set)!.character!) !== undefined;
    const written = write({ character, kind: 'card', thread: on.thread, target, payload: { card, message: decided.value.message, config: decided.value.config, ...(catches ? { caught: trap!.set } : { layer }) } });
    let spring: ActRec | null = null;
    if (catches) {
      spring = write({ character: acts.get(trap.set)!.character, kind: 'spring', thread: on.thread, target, payload: { card: trap.card, trigger: 'cast', outcome: trapRules!.trap!.outcome, set: trap.set, by: written.id, caught: written.id } });
      faceDown.get(trap.set)!.sprung = spring.id;
    }
    /* After the Act, so the wallet's record names what the Aura went on (play_card). */
    spend(account, decided.value.price, 'play', written.id);
    recordCard(account.id, written.at, { card, kind: 'played', act: written.id, price: decided.value.price });
    sendAct(written);
    if (spring) {
      const setter = accounts.get(faceDown.get(trap!.set)!.account);
      if (setter && trapRules!.trap!.outcome.do === 'payout' && decided.value.price > 0) setter.wallet = Math.min(settings.walletCap, setter.wallet + decided.value.price);
      sendAct(spring);
    }
    return ok(publicAct(written));
  }

  /**
   * The cards set face down (face_down, 0054): which card a set is, its setter's account alone; when it ends; the spring that ended it.
   * The in-memory backend springs a cast trap on a cast; the other triggers are the server's to test.
   */
  const faceDown = new Map<Id, { account: Id; card: string; post: Id; endsAt: number; sprung: Id | null }>();
  function liveBack(post: Id): { set: Id; card: string } | null {
    for (const [set, f] of faceDown) if (f.post === post && f.sprung === null && f.endsAt > now()) return { set, card: f.card };
    return null;
  }
  /** What a card's rules see on a post (card_target): its plays not caught, each ward's rarity and end, and its card backs naming no card. */
  function effectsOn(target: Id): CardEffect[] {
    const out: CardEffect[] = [];
    for (const a of acts.values()) {
      if (a.target !== target) continue;
      if (a.kind === 'card' && a.payload.caught === undefined && onPost(a)) {
        const r = instance.cards.find((c) => c.key === a.payload.card);
        out.push({ card: String(a.payload.card), act: a.id, ...(r?.ward ? { ward: r.rarity } : {}), ...(typeof a.payload.ends === 'string' ? { ends: a.payload.ends } : {}) });
      } else if (a.kind === 'set') {
        const f = faceDown.get(a.id);
        out.push({ card: null, act: a.id, faceDown: true, ends: iso(f?.sprung ? acts.get(f.sprung)!.at : f?.endsAt ?? a.at) });
      }
    }
    return out;
  }

  /** A card Act that is a post's play, not one beyond a post that sits on the post it was played from (0055_card_reach.sql). */
  const onPost = (a: ActRec): boolean => (a.payload.reach ?? 'post') === 'post';
  /** The plays beyond a post (play_reach, 0055): each play's reach, its target and when it ends, never edited. */
  const reachPlays = new Map<Id, { reach: BeyondPost; target: Id; endsAt: number }>();
  /** The live plays on one target beyond a post, as effects (reach_effects, 0055). */
  const reachEffects = (reach: BeyondPost, target: Id): CardEffect[] => [...reachPlays].filter(([, r]) => r.reach === reach && r.target === target && r.endsAt > now())
    .map(([play, r]) => {
      const rules = instance.cards.find((c) => c.key === acts.get(play)!.payload.card);
      return { card: String(acts.get(play)!.payload.card), act: play, reach, ends: iso(r.endsAt), ...(rules?.ward ? { ward: rules.rarity } : {}) };
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
    const decided = play === 'use' ? decideUse(rules, settings, goal, effects, config, message) : decidePlay(rules, settings, goal, effects, config, message, { now: new Date(at) });
    if (!decided.ok) return refuse(decided.why, message !== undefined && !casterMessage(message).ok ? 'message' : 'config');
    const c = acting(character);
    if (isRefusal(c)) return c;
    if (play === 'use' && reach === 'character' && target !== character) return refuse(`${rules.name} is used on your own character`);
    const account = me()!;
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

  /** set_card (0054): decided by the card's rules (decideSet), then the author, the hand and the post's one back are the database's. */
  function setCard(card: string, character: Id, target: Id, config: Readonly<Record<string, unknown>>): Answer<Act> {
    const bad = request({ action: 'setCard', card, character, target, config });
    if (bad) return bad;
    const on = acts.get(target);
    if (!on) return refuse('there is no such post', 'target');
    const rules = instance.cards.find((c) => c.key === card)!;
    const text = (publicAct(on).currentPayload as { body?: unknown }).body;
    const decided = decideSet(rules, settings, { reach: 'post', act: on.id, kind: on.kind as PostTarget['kind'], length: typeof text === 'string' ? [...text].length : 0 }, effectsOn(target), config, instance.cards);
    if (!decided.ok) return refuse(decided.why, 'config');
    const c = acting(character);
    if (isRefusal(c)) return c;
    if (on.character !== character) return refuse('a card is set face down on a post of your own character\'s');
    const account = me()!;
    if ((account.cards[card] ?? 0) < 1) return refuse(`you hold no "${card}" card; the Vending Machine sells them`);
    const short = covers(account, decided.value.price);
    if (short) return short;
    account.cards[card]! -= 1;
    const written = write({ character, kind: 'set', thread: on.thread, target, payload: {} });
    faceDown.set(written.id, { account: account.id, card, post: target, endsAt: written.at + span(settings.setLasts), sprung: null });
    spend(account, decided.value.price, 'play', written.id);
    recordCard(account.id, written.at, { card, kind: 'played', act: written.id, price: decided.value.price });
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
    const decided = decideUse(rules, settings, { reach: 'post', act: on.id, kind: on.kind as PostTarget['kind'], length: typeof text === 'string' ? [...text].length : 0 }, effectsOn(target), config, message);
    if (!decided.ok) return refuse(decided.why, 'config');
    const c = acting(character);
    if (isRefusal(c)) return c;
    if (on.character !== character) return refuse(`${rules.name} is used on your own post`);
    const account = me()!;
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

  function unmask(character: Id, thread: Id, message: string): Answer<Act> {
    const bad = request({ action: 'unmask', character, thread, message });
    if (bad) return bad;
    const c = acting(character);
    if (isRefusal(c)) return c;
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

  const ownedCount = (account: Id) => [...characters.values()].filter((c) => c.owner === account && c.retiredAt === null).length;

  function createCharacter(name: string, cls: string, timing: DebutTiming, loudness: DebutLoudness): Answer<CreatedCharacter> {
    const bad = request({ action: 'createCharacter', name, class: cls, timing, loudness });
    if (bad) return bad;
    const account = me()!;
    const named = name.replace(/^ +| +$/g, '');
    if (ownedCount(account.id) >= settings.charactersPerPlayer) return refuse(`a player runs at most ${settings.charactersPerPlayer} characters`);
    if ([...characters.values()].some((c) => sameName(c.name, named))) return refuse('that name is taken');
    const c = addCharacter(account.id, named, cls, { debuted: timing === 'now', loudness });
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

  function addCharacter(owner: Id, name: string, cls: string, o: { debuted: boolean; loudness: DebutLoudness; retired?: boolean; at?: number }): CharRec {
    const at = o.at ?? now();
    const c: CharRec = {
      id: uuid(), owner, name, createdAt: at, debutedAt: o.debuted ? at : null, retiredAt: o.retired ? at : null, loudness: o.loudness,
      history: [{ cls, at }], pending: null, presenceHidden: false, title: '', signature: '', pipStyle: options.instance.pipStyles[0]?.key ?? 'default',
      square: null, portrait: null, squareFrame: null, portraitFrame: null,
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

  function addAccount(email: string): AccountRec {
    const a: AccountRec = {
      id: uuid(), email, admin: false, prefs: DEFAULT_PREFERENCES, wallet: 0, cards: {}, reading: new Map(), follows: new Map(),
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
    postUpdate: (title, body, changes) => (me()?.admin ? writeUpdate(title, body, changes, undefined) : refuse('only an admin writes an update')),
    settings: () => screen,

    boards: () => boards.map((b): BoardSummary => {
      const mine = [...threads.values()].filter((t) => t.board === b.id && listed(t)).map(summary);
      const latest = mine.sort((x, y) => Date.parse(y.lastAt) - Date.parse(x.lastAt) || y.id.localeCompare(x.id))[0];
      return { ...boardNow(b), threadCount: mine.length, lastAt: latest?.lastAt ?? null, lastCharacter: latest?.lastCharacter ?? null, lastThread: latest?.id ?? null };
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
    movesLog(staff, before) {
      const who = [...characters.values()].find((c) => c.staff?.key === staff);
      const mine = !who ? [] : [...acts.values()].filter((a) => a.kind === 'move' && a.character === who.id)
        .sort((x, y) => y.at - x.at || (y.id < x.id ? -1 : y.id > x.id ? 1 : 0));
      const after = before ? mine.filter((a) => a.at < Date.parse(before.at) || (a.at === Date.parse(before.at) && a.id < before.act)) : mine;
      const page = after.slice(0, MOVES_LOG_PAGE);
      const rows = page.map((a): MoveLogRow => {
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
    staffProfile(staff) {
      const latest = staffProfiles.filter((p) => p.key === staff).sort((a, b) => b.at - a.at).at(0);
      return latest ? ({ staff, at: iso(latest.at), interests: latest.interests, favorites: latest.favorites, mood: latest.mood, signature: latest.signature } satisfies StaffProfile) : null;
    },
    adminQueue() {
      if (!me()?.admin) throw new Error('only an admin reads the queue');
      const nameOf = (staff: string | null) => (staff === null ? null : [...characters.values()].find((c) => c.staff?.key === staff)?.name ?? null);
      const paramsOf = moveParams;
      const demandFor = moveDemand;
      const waiting = queue.filter((q) => q.landed === null && q.heldAt === null).sort((a, b) => a.goLiveAt - b.goLiveAt || a.id - b.id).map((q): QueuedMove => q.successor !== undefined ? ({
        id: q.id, staff: q.staff, boss: nameOf(q.staff), kind: 'nameSuccessor', params: { boss: q.successor }, demand: null, why: q.why, goLiveAt: iso(q.goLiveAt),
        expiresAt: null, structural: true, boardName: null, failedAt: null, failure: null, replacedAt: q.replacedAt === undefined ? null : iso(q.replacedAt),
      }) : ({
        id: q.id, staff: q.staff, boss: nameOf(q.staff), kind: 'renameBoard', params: paramsOf(q.move), demand: demandFor(q.move), why: q.why, goLiveAt: iso(q.goLiveAt),
        expiresAt: q.move.expiresAt === undefined ? null : iso(q.move.expiresAt), structural: true, boardName: boards.find((b) => b.slug === q.move.board) ? boardNow(boards.find((b) => b.slug === q.move.board)!).name : null,
        failedAt: q.failure ? iso(q.failure.at) : null, failure: q.failure?.text ?? null, replacedAt: null,
      }));
      const rowOf = (a: ActRec) => {
        const q = queue.find((x) => x.landed === a.id);
        const who = a.character ? characters.get(a.character) : undefined;
        return { q, staff: who?.staff?.key ?? null, boss: who?.name ?? null };
      };
      const live = inForce().map((a): MoveInForce => {
        const { q, staff, boss } = rowOf(a);
        return {
          act: a.id, id: q?.id ?? null, staff, boss, kind: String(a.payload['kind']), params: (a.payload['params'] ?? {}) as Record<string, unknown>, demand: demandOf(a.id),
          why: q?.why ?? null, landedAt: iso(a.at), expiresAt: typeof a.payload['expires_at'] === 'string' ? a.payload['expires_at'] : null, progress: toProgress(progressOf(a)),
        };
      });
      const since = now() - 30 * DAY;
      const ended: MoveEnded[] = [
        ...[...moveEnds.entries()].filter(([, e]) => e.at >= since).map(([id, e]): MoveEnded => {
          const a = acts.get(id)!;
          const { q, staff, boss } = rowOf(a);
          return { how: e.why, by: e.by, at: iso(e.at), act: id, id: q?.id ?? null, staff, boss, kind: String(a.payload['kind']), params: (a.payload['params'] ?? {}) as Record<string, unknown>, demand: demandOf(id), why: q?.why ?? null, landedAt: iso(a.at) };
        }),
        ...queue.filter((q) => q.heldAt !== null && q.heldAt >= since).map((q): MoveEnded => ({
          how: 'held', by: 'admin', at: iso(q.heldAt!), act: null, id: q.id, staff: q.staff, boss: nameOf(q.staff), kind: 'renameBoard', params: paramsOf(q.move), demand: demandFor(q.move), why: q.why, landedAt: null,
        })),
      ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
      return { cap: 100, waiting, inForce: live, ended, more: { waiting: false, inForce: false, ended: false },
        roster: [...characters.values()].filter((c) => c.staff?.kind === 'boss' && c.retiredAt === null && c.debutedAt !== null).map((c) => ({ staff: c.staff!.key, name: c.name })) } satisfies AdminQueue;
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
      const roster = [...characters.values()].filter((c) => c.staff?.kind === 'boss' && c.retiredAt === null && c.debutedAt !== null);
      if (!roster.some((c) => c.staff?.key === boss)) return refuse('that is not a Boss of the roster');
      if (boss === q.staff) return refuse('a Boss cannot succeed itself');
      q.successor = boss;
      q.replacedAt = now();
      return ok({ id, boss });
    },
    bosses: () => [...characters.values()].filter((c) => c.staff?.kind === 'boss').map((c) => ({ staff: c.staff!.key, name: c.name })),
    reverseMove(act) {
      if (!me()?.admin) return refuse('only an admin reverses a move');
      const a = acts.get(act);
      if (!a || a.kind !== 'move') return refuse('that is not a move');
      if (moveEnds.has(act)) return refuse('that move has already ended');
      moveEnds.set(act, { why: 'reversed', by: 'admin', at: now() });
      const end = write({ character: null, kind: 'move_end', thread: a.thread, target: act, payload: { why: 'reversed', by: 'admin' } });
      return ok({ act, endedBy: end.id });
    },
    threads(board, page) {
      const all = [...threads.values()].filter((t) => t.board === board && listed(t)).map(summary)
        .sort((x, y) => Date.parse(y.lastAt) - Date.parse(x.lastAt) || y.id.localeCompare(x.id));
      return { threads: all.slice(page.offset, page.offset + page.limit), total: all.length };
    },
    thread: (id) => (threads.has(id) && listed(threads.get(id)!) ? summary(threads.get(id)!) : null),
    acts: (thread, from, to) => placed(thread).filter((a) => a.seq! >= from && a.seq! <= to).map(publicAct),
    act: (id) => (acts.has(id) ? publicAct(acts.get(id)!) : null),
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
      return [...acts.values()].filter((a) => (a.kind === 'card' || a.kind === 'set' || a.kind === 'spring') && a.target !== null && wanted.has(a.target)).sort((a, b) => a.at - b.at || a.order - b.order).slice(0, limit).map(publicAct);
    },
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
          .flatMap((x) => x.lines.filter((l) => l.account === account).map((l) => ({ settlement: x.id, startsAt: iso(x.startsAt), endsAt: iso(x.endsAt), sharesKept: x.sharesKept, character: l.character, reason: l.reason, amount: l.amount }))));
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
          ledger,
          shares,
          wallet: newest(walletEvents.filter((e) => e.account === account && fits(e.ms))).map((e) => e.event),
          cards: newest(cardLedger.filter((e) => e.account === account && fits(e.ms))).map((e) => e.event),
          playsOnMine: newest(onMine.filter((a) => fits(a.at)).map((a) => ({ ms: a.at, order: a.order, a }))).map(({ a }) => ({ play: a.id, post: a.target!, at: iso(a.at), reach: reachOf(a) as 'post' | 'character' | 'thread', targetName: targetName(a), targetCharacter: targetCharacter(a) })),
          saves: newest(onMine.filter((a) => effects.has(a.id) && fits(effects.get(a.id)!.at)).map((a) => ({ ms: effects.get(a.id)!.at, order: a.order, a })))
            .map(({ a, ms }) => ({ play: a.id, post: a.target!, savedAt: iso(ms) })),
          /* The in-memory backend sets no card face down and springs no trap: the setter's and the caster's lines are the adapter's (my_face_down, my_caught). */
          setEnds: [],
          caught: [],
        };
      }, before ?? null);
    },
    myReleases: (plays) => plays.filter((play) => me() !== null && releases.has(`${me()!.id} ${play}`)),
    releaseEffect,
    saveEffect,
    buyCard: lossy(buyCard),
    playCard: lossy(playCard),
    setCard: lossy(setCard),
    useCard: lossy(useCard),
    myFaceDown: (sets) => {
      const account = me()?.id;
      return Object.fromEntries(sets.filter((s) => faceDown.get(s)?.account === account).map((s) => [s, faceDown.get(s)!.card]));
    },
    pinnedThreads: (board) => [...reachPlays]
      .filter(([play, r]) => r.reach === 'thread' && r.endsAt > now() && threads.get(r.target)?.board === board && instance.cards.find((c) => c.key === acts.get(play)!.payload.card)?.pins === true)
      .map(([play, r]) => ({ thread: summary(threads.get(r.target)!), play, endsAt: iso(r.endsAt), act: publicAct(acts.get(play)!) }))
      .sort((a, b) => acts.get(b.play)!.at - acts.get(a.play)!.at || acts.get(b.play)!.order - acts.get(a.play)!.order),
    effectsAbove: (chars, thread, board) => {
      const wanted = new Set(chars);
      return [...reachPlays].filter(([, r]) => r.endsAt > now() && (r.reach === 'character' ? wanted.has(r.target) : r.reach === 'thread' ? r.target === thread : r.target === board))
        .map(([play, r]) => ({ play, reach: r.reach, target: r.target, endsAt: iso(r.endsAt), act: publicAct(acts.get(play)!) }))
        .sort((a, b) => acts.get(a.play)!.at - acts.get(b.play)!.at || acts.get(a.play)!.order - acts.get(b.play)!.order);
    },
    cardsOn: (act, limit) => [...acts.values()].filter((a) => (a.kind === 'card' || a.kind === 'set' || a.kind === 'spring') && a.target === act).sort((a, b) => a.at - b.at || a.order - b.order).slice(0, limit).map(publicAct),
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
    characterReveals: (id, limit = 50) => [...acts.values()].filter((a) => a.kind === 'reveal' && a.payload.character === id)
      .sort((x, y) => y.at - x.at || y.order - x.order).slice(0, Math.max(1, limit)).map(publicAct),
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
    classReveals: (ids) => [...acts.values()].filter((a) => a.kind === 'unmask' && a.character !== null && ids.includes(a.character))
      .sort((a, b) => a.at - b.at || a.order - b.order)
      .map((a): ClassReveal => ({
        act: a.id, character: a.character!, class: String(a.payload.class), at: iso(a.at), via: a.payload.via as ClassReveal['via'], thread: a.thread,
      })),
    turnsAnnounced(ids) {
      const out: TurnAnnounced[] = [];
      for (const a of [...acts.values()].filter((x) => x.kind === 'tally').sort((x, y) => x.at - y.at || x.order - y.order)) {
        const turns = Array.isArray(a.payload.turns) ? (a.payload.turns as readonly Record<string, unknown>[]) : [];
        for (const t of turns) {
          if (typeof t.character === 'string' && ids.includes(t.character)) {
            out.push({ act: a.id, character: t.character, at: iso(a.at), was: typeof t.was === 'string' ? t.was : null, since: typeof t.since === 'string' ? t.since : null });
          }
        }
      }
      return out;
    },
    nextSettlementAt: () => takesEffectAt(),

    myCharacters() {
      const account = me();
      if (!account) return [];
      return [...characters.values()].filter((c) => c.owner === account.id).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((c): MyCharacter => {
        const opens = turnOpens(c);
        return {
          id: c.id, name: c.name, class: classNow(c).cls, classSince: iso(classNow(c).at), turnOpensAt: opens === null ? null : iso(opens),
          debutedAt: c.debutedAt === null ? null : iso(c.debutedAt), debutLoudness: c.loudness, retiredAt: c.retiredAt === null ? null : iso(c.retiredAt),
          pendingTurn: c.pending ? { class: c.pending.class, loudness: c.pending.loudness, showFrom: c.pending.showFrom, showTo: c.pending.showTo, takesEffectAt: takesEffectAt() } : null,
          presenceHidden: c.presenceHidden,
        };
      });
    },
    wallet: (): Wallet => ({ balance: me()?.wallet ?? 0, cap: settings.walletCap }),
    myReactions(ids) {
      const account = me();
      return account ? reactions.filter((r) => r.account === account.id && ids.includes(r.act)).map((r): MyReaction => ({ act: r.act, kind: r.kind, character: r.character })) : [];
    },
    myCards: () => Object.entries(me()?.cards ?? {}).filter(([, held]) => held > 0).map(([card, held]): HeldCard => ({ card, held })),
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
      const listed = [...presence.entries()].flatMap(([id, row]) => {
        const c = characters.get(id)!;
        if (row.seenAt < at - win || c.debutedAt === null || c.retiredAt !== null || c.presenceHidden) return [];
        if (where.kind === 'thread' && !(row.kind === 'thread' && row.place === place)) return [];
        if (where.kind === 'board' && row.board !== board) return [];
        return [{ id, name: c.name, since: where.kind === 'index' ? row.onlineSince : row.placeSince }];
      }).sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const shown = listed.slice(0, settings.presenceNames);
      return { names: shown.map(({ id, name }) => ({ id, name })), others: listed.length - shown.length };
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
      if (p.motion !== undefined && p.motion !== 'system' && p.motion !== 'reduce' && p.motion !== 'full') return refuse('motion follows the system, or is reduced or full');
      if (p.smoke !== undefined && !['full', 'low', 'off'].includes(p.smoke)) return refuse('the smoke is full, low or off');
      if (p.contrast !== undefined && p.contrast !== 'standard' && p.contrast !== 'high') return refuse('contrast is standard or high');
      if (p.textSize !== undefined && ![100, 125, 150, 200].includes(p.textSize)) return refuse('text size is 100, 125, 150 or 200 percent');
      /* The set of cards met is no parameter of set_preferences: a stray one in a patch is ignored, as the server would. */
      const { cardsMet: _ignored, ...choices } = p as PreferencesPatch & { cardsMet?: unknown };
      account.prefs = { ...account.prefs, ...choices };
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
    forgetCardsMet() {
      const account = me();
      if (!account) return refuse('sign in with an account first');
      account.prefs = { ...account.prefs, cardsMet: [] };
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
    alertsUnread() {
      // my_alerts_unread (0060): what arrived after the account's mark (never set: everything), to the bound.
      const account = me();
      if (!account) throw new Error('sign in with an account first');
      const seen = account.prefs.alertsSeenAt === null ? -Infinity : Date.parse(account.prefs.alertsSeenAt);
      return Math.min(ALERTS_UNREAD_BOUND, alertsOf(account).filter((a) => Date.parse(a.at) > seen).length);
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
    setProfile(character, title, signature, pipStyle) {
      const c = acting(character);
      if (isRefusal(c)) return c;
      if ([...title].length > 40) return refuse('a title is at most 40 characters');
      if ([...signature].length > 500) return refuse('a signature is at most 500 characters');
      if (!options.instance.pipStyles.some((p) => p.key === pipStyle)) return refuse(`there is no pip style "${pipStyle}"`);
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
      return ok(publicCharacter(c));
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
    if (!found.board.isSystem) throw new Error('The System\'s Acts are on its board');
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
      return { account: c.owner, character: l.character, reason: l.reason, amount: l.amount, shares };
    });
    const id = settlements.length + 1;
    settlements.push({ id, startsAt, endsAt: at, sharesKept, lines: written });
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
      if (a.character === null || ownerOfCharacter(a.character) === account.id) continue;
      const derived = derivedAlert(a);
      if (derived?.account === account.id) out.push(line({ kind: derived.kind, sub: null, act: a.id, character: derived.character, at: a.at }));
    }
    for (const w of seededAlerts) if (w.account === account.id) out.push(line({ kind: w.kind, sub: w.sub, act: w.act, character: w.character, at: w.at }));
    for (const f of followedFor(account)) out.push(line({ kind: 'followed', sub: null, act: null, character: null, at: Date.parse(f.newestAt), thread: f.thread, title: f.title, count: f.newPosts }));
    /* Every player's news, the same for each (alerts_news, 0062): one line per update, and nothing of the player's in it. Season news joins here. */
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
      const a = addAccount(email);
      a.admin = o?.admin === true;
      return a.id;
    },
    admin(account, on = true) { accounts.get(account)!.admin = on; },
    character(account, name, cls, o) {
      if (!accounts.has(account)) throw new Error(`no such account ${account}`);
      return addCharacter(account, name, cls, { debuted: o?.debuted ?? true, loudness: o?.loudness ?? 'announced', retired: o?.retired, at: o?.at }).id;
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
        if (!board.isSystem) throw new Error('The System\'s Acts are on its board');
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
          c.history.push({ cls: c.pending.class, at });
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
    alert(account, a) {
      seeded(account);
      if (!isWritten(a.kind) || a.kind === 'quote' || a.kind === 'cardOnYours') throw new Error(`a ${a.kind} alert is read from the Acts that make it, not seeded`);
      if (!acts.has(a.act)) throw new Error('an alert is about an Act that exists');
      if (a.character !== undefined && characters.get(a.character)?.owner !== account) throw new Error('an alert concerns a character of the account\'s');
      const line = { account, kind: a.kind, sub: a.sub ?? null, act: a.act, character: a.character ?? null, at: a.at ?? now() };
      seededAlerts.push(line);
      send(`account:${account}`, 'alert', () => { for (const l of [...(accountListeners.get(account) ?? [])]) l.onAlert?.({ id: crypto.randomUUID(), kind: line.kind, sub: line.sub, act: line.act, character: line.character, at: iso(line.at) }); });
    },
    update(u) {
      const wrote = writeUpdate(u.title, u.body, u.changes ?? [], u.at);
      if (!wrote.ok) throw new Error(`a seeded update is refused: ${wrote.error}`);
      return wrote.value.act;
    },
    cards(account, held) { seeded(account).cards = { ...held }; },
    wallet(account, balance) { setWallet(account, balance); },
    buy(account, card, o) { accepted(asAt(account, o?.at, () => buyCard(card))); },
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
      const turned: Record<string, unknown> = { character, name: characters.get(character)!.name, loudness: 'announced' };
      if (o.was !== undefined) turned.was = o.was;
      if (o.since !== undefined) turned.since = o.since;
      return systemAct(thread, { at: o.at, kind: 'tally', payload: { turns: [turned] } }, '').id;
    },
    tally(act, counts) {
      if (!acts.has(act)) throw new Error(`no such Act ${act}`);
      for (const [kind, n] of Object.entries(counts)) for (let i = 0; i < n; i++) reactions.push({ act, account: '', character: '', kind });
    },
    staff(key, name, kind, o) {
      if ([...characters.values()].some((c) => c.staff?.key === key)) throw new Error(`staff member ${key} exists`);
      const at = o?.at ?? now();
      const c: CharRec = {
        id: uuid(), owner: '', name, createdAt: at, debutedAt: o?.debuted === false ? null : at, retiredAt: null, loudness: 'silent', history: [{ cls: '', at }], pending: null, presenceHidden: false,
        title: o?.title ?? '', signature: o?.signature ?? '', pipStyle: options.instance.pipStyles[0]?.key ?? 'default',
        square: null, portrait: null, squareFrame: null, portraitFrame: null, staff: { key, kind },
      };
      characters.set(c.id, c);
      return c.id;
    },
    staffProfile(key, p) {
      staffId(key);
      staffProfiles.push({ key, at: p.at ?? now(), interests: [...(p.interests ?? [])], favorites: [...(p.favorites ?? [])], mood: p.mood ?? '', signature: p.signature ?? '' });
    },
    staffPost(staff, thread, body, o) {
      systemBoard(thread);
      if (!characters.get(staff)?.staff) throw new Error('only a staff character posts as The System\'s Boss');
      return write({ character: staff, kind: 'post', thread, payload: { body }, at: o?.at }).id;
    },
    move(staff, m) {
      const at = m.at ?? now();
      const boss = staffId(staff);
      const demand = moveDemand(m);
      const id = write({
        character: boss, kind: 'move', thread: announcements(),
        payload: { kind: 'renameBoard', body: m.body ?? 'The System has spoken.', params: moveParams(m), ...(demand ? { demand } : {}), expires_at: iso(m.expiresAt ?? at + 3 * DAY) }, at,
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
      const rec: QueueRec = { id: queue.length + 1, staff, move: m, why: m.why ?? 'it seemed time', goLiveAt: m.goLiveAt, failure: m.failure ?? null, heldAt: null, landed: null };
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
      /* A play a trap caught names its set, and takes no layer; a Use carries its end (0054). */
      if (o?.caught !== undefined) { payload.caught = o.caught; delete payload.layer; }
      if (o?.ends !== undefined) payload.ends = o.ends;
      /* A paid play is refused before its Act is written, as play_card refuses before it writes; the hand is the seed's to set (`cards`). */
      if (o?.paid !== undefined) {
        if (!Number.isInteger(o.paid) || o.paid < 0) throw new Error(`a price is a whole amount, at least zero, not ${o.paid}`);
        const short = covers(seeded(ownerOf(character)), o.paid);
        if (short) accepted(short);
      }
      const written = asAt(ownerOf(character), o?.at, () => write({ character, kind: 'card', thread: on.thread, target, payload }));
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
      const written = asAt(f.account, o?.at, () => write({
        character: back.character, kind: 'spring', thread: back.thread, target: f.post,
        payload: { card: f.card, trigger: o?.trigger ?? rules?.trap?.trigger.on ?? 'cast', outcome: rules?.trap?.outcome ?? { do: 'nullify' }, set, ...(o?.caught ? { by: o.caught, caught: o.caught } : {}) },
      }));
      f.sprung = written.id;
      return written.id;
    },
    loseNextAnswer(went) { losing = { went }; },
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
