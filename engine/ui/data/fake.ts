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
 *  - There is no purchase and no card play of a player's own (a seed makes one); a saved effect is kept as the post's author sent it, unchecked by the card's rules; and there is no check that a Turn's settlement is now due.
 */
import type { Instance, Settings, Span } from '../../rules/types.ts';
import { decide } from '../../rules/actions.ts';
import { sameName } from '../../rules/names.ts';
import { DEFAULT_PREFERENCES, LOST_ANSWER, SPUN_FROM_MAX } from './api.ts';
import type {
  Act, ActKind, Answer, AvatarUpload, Board, BoardListener, BoardSummary, Character, CharacterCounts, ClassReveal, CreatedCharacter, DebutLoudness, EffectState,
  DebutTiming, Estimate, EstimateLine, Frame, HeldCard, Id, KayfaApi, MyCharacter, MyInvite, MyReaction, PendingTurn, Preferences, Refusal,
  ScreenSettings, Season, Session, Standing, Tally, ThreadListener, ThreadSummary, TurnAnnounced, Wallet,
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
  readonly event: 'act' | 'tally' | 'thread' | 'effect';
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
   * then, so the cooldown does), sets the wallets (by account) and standings (by character) given,
   * and dates `lastSettledAt`. Each part can be left out.
   */
  settle(options: { at?: number; wallet?: Readonly<Record<Id, number>>; standings?: Readonly<Record<Id, number>>; debut?: boolean; turns?: boolean }): void;
  season(season: Partial<Season>): void;
  nextSettlementAt(at: number | null): void;
  views(thread: Id, count: number): void;
  cards(account: Id, held: Readonly<Record<string, number>>): void;
  /** The account's settled wallet, as a purchase or a card play leaves it between settlements (`settle` sets it at one, and dates it). */
  wallet(account: Id, balance: number): void;
  /** A character's Turn asked by its player, waiting for the next settlement; refused in the server's words like any other. */
  turn(character: Id, to: string, options?: { loudness?: 'silent' | 'announced'; showFrom?: boolean; showTo?: boolean }): void;
  /** What the account's next estimate holds; its times are the ask's. */
  estimate(account: Id, estimate: { entries?: Estimate['entries']; lines?: readonly EstimateLine[] }): void;
  /** A character's unmask Act in a thread, as its player's reveal (`via` 'act') or a debut's or a Turn's. */
  reveal(character: Id, thread: Id, options?: { via?: ClassReveal['via']; class?: string; at?: number; message?: string }): Id;
  /** A tally Act in a thread of The System's board that announces a Turn of a character. */
  announceTurn(character: Id, thread: Id, options?: { was?: string; since?: string; at?: number }): Id;
  avatar(character: Id, urls: { square?: string; portrait?: string }): void;
  /** A card play by a character on an Act, in the Act's own thread (what a player's play makes; the cards plan makes the real action). */
  card(character: Id, target: Id, card: string, options?: { message?: string; at?: number; live?: boolean }): Id;
  /** A saved card effect on a thread's play, heard by its subscribers. */
  effect(thread: Id, play: Id): void;
  /**
   * The next post, edit or spin gets no answer, as when the network drops: it answers with an
   * uncertain refusal. `went` says whether the server did it before the answer was lost.
   */
  loseNextAnswer(went: boolean): void;
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
  title: string;
  signature: string;
  pipStyle: string;
  square: string | null;
  portrait: string | null;
  squareFrame: Frame | null;
  portraitFrame: Frame | null;
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
  estimate: { entries: Estimate['entries']; lines: readonly EstimateLine[] };
  asked: Estimate | null;
}
interface InviteRec { readonly id: number; readonly owner: Id; code: string; readonly createdAt: number; issuedAt: number; usedBy: Id | null }

const refuse = (error: string, field?: string): Refusal => (field === undefined ? { ok: false, error } : { ok: false, error, field });
const ok = <T,>(value: T): Answer<T> => ({ ok: true, value });
const iso = (ms: number) => new Date(ms).toISOString();

/** The methods that are not a promise of something: everything else is made one. */
const NOT_PROMISED = new Set(['onSession', 'subscribeThread', 'subscribeBoard']);
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
    registrationMode: settings.registrationMode, settlementLength: settings.settlementLength,
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
  const threads = new Map<Id, ThreadRec>();
  const reactions: { act: Id; account: Id; character: Id; kind: string }[] = [];
  const invites: InviteRec[] = [];
  const pendingInvite = new Map<string, string | null>();
  const views = new Map<Id, number>();
  const standingOf = new Map<Id, number>();
  const seasons: Season[] = [{ id: 1, number: 1, startsAt: iso(START), endsAt: null, turnsThread: null, revealAct: null }];
  let lastSettled: number | null = null;
  let nextSettlement: number | null = null;
  const boards: Board[] = options.instance.boards.map((b) => ({ id: uuid(), slug: b.slug, name: b.name, description: b.description, isSystem: b.system === true }));
  const playersBoard = boards.find((b) => !b.isSystem);

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

  const placed = (threadId: Id) => [...acts.values()].filter((a) => a.thread === threadId && a.seq !== null).sort((a, b) => a.seq! - b.seq!);

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
    };
  }

  const tallyOf = (act: Id): Tally => {
    const counts: Record<string, number> = {};
    for (const r of reactions) if (r.act === act) counts[r.kind] = (counts[r.kind] ?? 0) + 1;
    return counts;
  };

  /* -------------------------------------------------------------------- writing ---- */
  let order = 0;
  /** The time a seeded player's Act is dated, while the seed runs it through the action (the clock otherwise). */
  let stamp: number | null = null;
  function write(a: { character: Id | null; kind: ActKind; thread: Id; target?: Id | null; payload: Record<string, unknown>; at?: number }): ActRec {
    const t = threads.get(a.thread)!;
  /* An edit is a version of its post and a card is a tag on its post: neither takes a place in the thread (0035_card_takes_no_seq.sql). */
    const placedAct = a.kind !== 'edit' && a.kind !== 'card';
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

  function saveEffect(play: Id, character: Id, state: Readonly<Record<string, unknown>>): Answer<{ play: Id; savedAt: string }> {
    const bad = request({ action: 'saveEffect', character, play, state });
    if (bad) return bad;
    const c = acting(character);
    if (isRefusal(c)) return c;
    const played = playOf(play);
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
      history: [{ cls, at }], pending: null, title: '', signature: '', pipStyle: options.instance.pipStyles[0]?.key ?? 'default',
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
      id: uuid(), email, admin: false, prefs: DEFAULT_PREFERENCES, wallet: 0, cards: {}, reading: new Map(),
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
    settings: () => screen,

    boards: () => boards.map((b): BoardSummary => {
      const mine = [...threads.values()].filter((t) => t.board === b.id).map(summary);
      const latest = mine.sort((x, y) => Date.parse(y.lastAt) - Date.parse(x.lastAt) || y.id.localeCompare(x.id))[0];
      return { ...b, threadCount: mine.length, lastAt: latest?.lastAt ?? null, lastCharacter: latest?.lastCharacter ?? null, lastThread: latest?.id ?? null };
    }),
    board: (slugOrId) => boards.find((b) => b.slug === slugOrId || b.id === slugOrId) ?? null,
    threads(board, page) {
      const all = [...threads.values()].filter((t) => t.board === board).map(summary)
        .sort((x, y) => Date.parse(y.lastAt) - Date.parse(x.lastAt) || y.id.localeCompare(x.id));
      return { threads: all.slice(page.offset, page.offset + page.limit), total: all.length };
    },
    thread: (id) => (threads.has(id) ? summary(threads.get(id)!) : null),
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
      return [...acts.values()].filter((a) => a.kind === 'card' && a.target !== null && wanted.has(a.target)).sort((a, b) => a.at - b.at || a.order - b.order).slice(0, limit).map(publicAct);
    },
    effectStates(plays) {
      const out: Record<Id, EffectState> = {};
      for (const play of plays) {
        const saved = effects.get(play);
        if (saved) out[play] = { state: saved.state, savedAt: iso(saved.at) };
      }
      return out;
    },
    myReleases: (plays) => plays.filter((play) => me() !== null && releases.has(`${me()!.id} ${play}`)),
    releaseEffect,
    saveEffect,
    cardsOn: (act, limit) => [...acts.values()].filter((a) => a.kind === 'card' && a.target === act).sort((a, b) => a.at - b.at || a.order - b.order).slice(0, limit).map(publicAct),
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
      account.prefs = { ...account.prefs, ...p };
      return ok(account.prefs);
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
    cards(account, held) { seeded(account).cards = { ...held }; },
    wallet(account, balance) { setWallet(account, balance); },
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
      const written = asAt(ownerOf(character), o?.at, () => write({ character, kind: 'card', thread: on.thread, target, payload }));
      if (o?.live) sendAct(written);
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
