/**
 * A player's action, as a pure module: decide it against the instance (engine/rules/actions.ts),
 * then write it. Most actions are written as the player, whose session the player's Db carries.
 * A card's are written by the service for the caller, since a card's price and configuration
 * are its own rules, which SQL cannot run: the caller is read from the database as the player
 * (whoami()), a play's post is read and priced by its card (engine/rules/cards.ts's
 * decidePlay), a saved state is checked by the card that was played, and the service writes,
 * with SQL holding every invariant it can again (supabase/migrations/0006_cards.sql).
 *
 * Answers carry the public projection the SQL function returned, the decision's refusal with
 * its field, or a refusal of the SQL function's own (raised with the `kayfabb.refusal` hint) in
 * its own words. Any other failure is a plain answer carrying nothing from inside: not
 * PostgREST's detail, which can quote a row, nor a constraint's or a table's name.
 */
import { decide } from '../../../engine/rules/actions.ts';
import { hintFor, windowStart, type HintSettings, type QuadrantCounts } from '../../../engine/rules/hints.ts';
import { casterMessage, refusalTime, decideDraw, decidePlay, decideSet, decideUse, decideWash, effectsOnTarget, postTarget, type CardEffect, type CardRules, type SetConditions, type CardTarget, type EffectsAbove, type PostTarget, type Reach } from '../../../engine/rules/cards.ts';
import { forgedList, forgedSet } from '../../../engine/bbcode/quoted.ts';
import { contentOf, mapPlaces, type Attachment } from '../../../engine/rules/anchor.ts';
import { frameProblem } from '../../../engine/rules/frame.ts';
import type { Instance } from '../../../engine/rules/types.ts';
import { DatabaseError, TransportError, barredAnswer, postgrest, sessionRefused, type Db } from '../_shared/rpc.ts';
import type { Broadcast } from '../_shared/broadcast.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';

export interface ActionAnswer {
  readonly status: number;
  readonly body: unknown;
  /** What the write sends live, once it has committed: public projections only. */
  readonly broadcasts?: readonly Broadcast[];
  /**
   * The request named no account: its body was refused before anything was read, its session was refused, or the database
   * refused the call for having no account. Nothing is done as the service for it, and nothing is scheduled after it: with
   * verify_jwt off anyone reaches this function, and the drain after an action is the service's work.
   */
  readonly nobodyNamed?: true;
}

/** The one signed-out answer; compared by identity, which no database answer can share. */
const SIGN_IN: ActionAnswer = { status: 401, body: { error: 'sign in to act' }, nobodyNamed: true };

type Row = Record<string, unknown>;
const act = (a: unknown): Broadcast[] => (a && typeof a === 'object' && (a as Row).thread ? [{ topic: `thread:${(a as Row).thread}`, event: 'act', payload: a }] : []);
/**
 * A write that sprang a trap answers with the spring (`sprung`, 0054_card_plays.sql), and a strike's card play under it
 * (`struck`): each goes out as an Act of its own, after the write's own, so a reader sees the back revealed in place. The
 * spring is public; it carries no amount and no account.
 */
const withSprung = (a: Row, own: Broadcast[]): Broadcast[] => {
  const sprung = a.sprung as Row | undefined;
  if (!sprung || typeof sprung !== 'object') return own;
  const { struck, ...spring } = sprung;
  return [...own, ...act(spring), ...act(struck)];
};
/**
 * A play beyond a post (a character, a thread or a board; 0055) is also heard on `reach`, which every signed-in player hears
 * (0061_account_channel.sql): a page that shows the character, or a board's banner, is on another thread's topic. It is the same
 * public Act the thread's topic carries, sent as `effect`; a play on a post is a tag on that post and the thread's topic reaches
 * everyone who shows it.
 */
const onReach = (a: Row): Broadcast[] => {
  const payload = a.payload as Row | undefined;
  return payload && typeof payload === 'object' && (payload.reach === 'character' || payload.reach === 'thread' || payload.reach === 'board')
    ? [{ topic: 'reach', event: 'effect', payload: a }] : [];
};
const without = (a: Row, key: string): Row => { const { [key]: _gone, ...rest } = a; return rest; };
const thread = (t: unknown): Broadcast[] => (t && typeof t === 'object' && (t as Row).board ? [{ topic: `board:${(t as Row).board}`, event: 'thread', payload: t }] : []);

/** A reply a play carried, on the play's thread: `{ parent, play, act }`, two ids and the reply's public projection. */
const under = (card: Row, u: unknown): Broadcast[] =>
  u && typeof u === 'object' && card.thread ? [{ topic: `thread:${card.thread}`, event: 'under', payload: u }] : [];

/** The wall's count after a draw or a wash: `{ play, covered }` on its thread, never the strokes or who drew. */
const surfaceHeard = (play: unknown, answer: Row | undefined, thread: unknown): Broadcast[] =>
  typeof play === 'string' && thread && answer && typeof answer.covered === 'number'
    ? [{ topic: `thread:${thread}`, event: 'surface', payload: { play, covered: answer.covered } }] : [];
/**
 * A ballot or a close of a poll (0395): the Act's projection as `act` (on a secret poll the database's projection names no one) and the poll's live
 * numbers as `poll`: `{ poll, counts, voters, ends_at, closed, at }`, counts of characters, `at` the created_at of the Act the write made. Built from the answer
 * alone, never from the request, so a secret ballot's event carries no character and no picks. Events can arrive twice or out of order: a listener applies one only
 * if its `at` is later than the last it applied for that poll (at a tie a closed one wins), and `closed` is final (engine/ui/data/api.ts, pollHeard).
 */
const polled = (a: Row): Broadcast[] => [
  ...act(a.act),
  ...(a.thread && a.poll ? [{ topic: `thread:${a.thread}`, event: 'poll', payload: { poll: a.poll, counts: a.counts, voters: a.voters, ends_at: a.ends_at, closed: a.closed, at: (a.act as Row | undefined)?.created_at } }] : []),
];
/**
 * What each SQL function's answer sends live. Each is the public projection the function
 * returned, never more; a purchase, which is the player's alone, sends nothing, and so does a
 * Turn, which waits for the settlement to send its tally.
 *
 * Broadcasts can arrive out of order or twice (a retry after a timeout may repeat one Realtime
 * took), so each carries what a client needs to converge: an Act its id and seq; a tally the
 * counts, which only ever grow, so a client keeps each kind's largest; a saved effect only its
 * play and saved_at, never the state, which can be 256 KB and every reader fetches once, newest
 * saved_at wins.
 */
const BROADCASTS: Record<string, (answer: Row, args: Row) => Broadcast[]> = {
  post: (a) => withSprung(a, act(without(a, 'sprung'))),
  edit_post: (a) => act(a),
  // A card that replies answers with its reply `under` its post (play_card, post_under): the card Act goes out without it, and the reply is heard as `under`,
  // never as an `act` of its own, so no screen draws it at the thread's tail before it is drawn under its post.
  play_card: (a) => { const card = without(without(a, 'sprung'), 'under'); return withSprung(a, [...act(card), ...onReach(card), ...under(card, a.under)]); },
  // An admin's end of a card: the card_end is an Act of the play's thread. For a play beyond a post the answer also names its `reach`
  // (reverse_card), and the end is heard on `reach` too, as the play was; neither the `play` nor the `reach` is sent on.
  reverse_card: (a) => {
    const end = without(without(a, 'play'), 'reach');
    return [...act(end), ...(a.reach === 'character' || a.reach === 'thread' || a.reach === 'board' ? [{ topic: 'reach', event: 'effect', payload: end }] : [])];
  },
  // A surface card's play carries its first draw in the answer: the play is heard as a play, without the drawing in it, and the wall's count follows. Strokes are never sent (surfaces, below).
  play_surface_card: (a, args) => {
    const { draw, ...play } = a;
    return [...BROADCASTS['play_card']!(play, args), ...surfaceHeard(a.id, draw as Row | undefined, a.thread)];
  },
  // A drawing or a wash is heard as the wall's count: the play and how many cells it covers now. Every reader who shows the wall fetches the strokes themselves (surface_acts), as a saved effect's state is fetched.
  draw_on_surface: (a, args) => surfaceHeard(args.play, a, a.thread),
  wash_surface: (a, args) => surfaceHeard(args.play, a, a.thread),
  // A card back: the set Act names no card, so neither does what is sent.
  set_card: (a) => act(a),
  // A take-back is an Act of the back's post's author, on that post, naming the set and no card.
  take_back: (a) => act(a),
  start_thread: (a) => [...thread(a.thread), ...act(a.act)],
  spin: (a) => [...thread(a.thread), ...act(a.act)],
  // An apology is the spin of a move's Act (0130), and is heard as one.
  apologize: (a) => [...thread(a.thread), ...act(a.act)],
  unmask: (a) => act(a),
  // A silent Turn waits for the settlement and is posted nowhere; an announced one writes its announcement Act at once (0435), heard in its thread as a reveal is.
  turn: (a) => act(a.announcement),
  announce_turn: (a) => act(a.announcement),
  withdraw_turn: () => [],
  // A null tally is a post whose totals are hidden (a blind study): there is none to send.
  react: (a) => withSprung(a, a.thread && a.tally !== null ? [{ topic: `thread:${a.thread}`, event: 'tally', payload: { act: a.act, tally: a.tally } }] : []),
  cast_ballot: polled,
  close_poll: polled,
  close_poll_as_admin: polled,
  save_effect_state: (a) => (a.thread ? [{ topic: `thread:${a.thread}`, event: 'effect', payload: { play: a.play, saved_at: a.saved_at } }] : []),
  // A gift is an Act of the drive's thread, heard as a play is. The answer also holds the giver's own balance, which is the giver's alone and is never sent on.
  donate: (a) => act(a.gift),
  buy_card: () => [],
  buy_pack: () => [],
  // A player's own: a character is active at once and writes no Act (0436), so it appears on the next
  // load of who is here, and an invite or an account is nobody else's to hear of.
  create_character: () => [],
  create_invite: () => [],
  reissue_invite: () => [],
  open_account: () => [],
};
const live = (rpc: string, answer: unknown, args: Row = {}): Broadcast[] =>
  answer && typeof answer === 'object' ? (BROADCASTS[rpc]?.(answer as Row, args) ?? []) : [];

/**
 * The calls that may be sent again after a failure that may have followed their commit
 * (supabase/functions/_shared/rpc.ts): the reads, and opening an account (one already open is no
 * change). Every other write is sent once; a saved effect's state among them, since a save
 * repeated after a newer one landed would bring the older strokes back; and a draw, a wash or a play with its first draw, each of which a second send would write again.
 */
const REPEATABLE = new Set(['whoami', 'card_target', 'card_target_reach', 'card_of_play', 'play_landed_at', 'open_account', 'instance_settings',
  // The hints' calls (0065): a read, and a write that finds its own earlier effect (a pattern already fired for an Act fires nothing).
  'act_window_counts', 'fire_hint',
  // A wall's reads (0456): the live draws, the post a wall is on, and a post's versions and groups. Each reads Acts and the post's words, never an owner.
  'surface_acts', 'surface_post_of', 'surface_version_pair', 'surface_groups_on',
  // What a post shows in its content area (0456), which a draw's frame is held to: a read of the post's versions, its signature and its poll, never an owner.
  'surface_frame_of',
  // The forged-quote verdict of a body (0393): a read of the posts' versions as they stand, which an edit's new words are mapped against.
  'quote_forged']);
export const SAFE_TO_REPEAT = (fn: string): boolean => REPEATABLE.has(fn);

/** The act function's two connections: as the player, and as the service; each sends a write once. */
export function actDbs(o: { url: string; key: string; publishable: string; session: string; fetch?: typeof globalThis.fetch; sleep?: (ms: number) => Promise<void> }): { player: Db; service: Db } {
  const common = { url: o.url, fetch: o.fetch, sleep: o.sleep, safeToRepeat: SAFE_TO_REPEAT };
  return { player: postgrest({ ...common, key: o.publishable, bearer: o.session }), service: postgrest({ ...common, key: o.key }) };
}

/** The hint every refusal the action functions raise carries, so their words alone reach a player. */
export const REFUSAL_HINT = 'kayfabb.refusal';
/** The SQLSTATE a SQL function raises, with REFUSAL_HINT, when the session names no account. */
const NO_ACCOUNT = '28000';

const refused = (field: string, why: string): ActionAnswer => ({ status: 400, body: { field, error: why } });


/** What a draw says when the version it was drawn on is not one of the post's. */
export const NOT_THOSE_WORDS = "That post's words aren't the ones you drew on. Reload it and tag again.";
/** What a draw says when its declared frame is bigger than its post could be (frameHeld; the owner's words on #1237). */
export const TOO_BIG_A_FRAME = 'That tag is drawn bigger than this post. Reload it and tag again.';

/** A post's version as the wall reads it: its id, its words and its forged verdict (the list, as `forgedList` reads a payload's). */
interface Version { readonly version: string; readonly body: string; readonly forged?: unknown }
const contentAt = (v: Version) => contentOf(v.body, forgedSet(forgedList({ forged: v.forged })));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isAttachment = (a: unknown): a is Attachment => typeof a === 'object' && a !== null && ['text', 'image', 'box'].includes((a as Row).kind as string);

/**
 * Where each group of a draw sits in the post's current version: `[{ grp, version, place }]`, for the groups attached to the post's words or an image (a box group is at its box spot and
 * has no row). A group drawn on the current version is placed where it was drawn; one drawn on an older version is mapped through the words' diff, null where its words were touched.
 * A version the post never had is a refusal. One read for each distinct version the groups name, which is one in practice. Reads are retried on a transport failure (SAFE_TO_REPEAT).
 */
async function placesOfDraw(service: Db, postOf: () => Promise<string | null>, payload: Record<string, unknown>): Promise<{ ok: true; places: Row[] } | { ok: false; why: string }> {
  const groups = Array.isArray(payload.groups) ? payload.groups as unknown[] : [];
  const anchored: { grp: number; at: Attachment & { version: string } }[] = [];
  groups.forEach((g, grp) => {
    const at = typeof g === 'object' && g !== null ? (g as Row).anchor : undefined;
    if (isAttachment(at) && at.kind !== 'box') anchored.push({ grp, at });
  });
  if (anchored.length === 0) return { ok: true, places: [] };
  // A version that is no uuid is none of the post's: refused before any read, never as the database's cast error.
  if (anchored.some((a) => typeof a.at.version !== 'string' || !UUID.test(a.at.version))) return { ok: false, why: NOT_THOSE_WORDS };
  const post = await postOf();
  if (!post) return { ok: false, why: NOT_THOSE_WORDS };
  const places: Row[] = [];
  for (const version of new Set(anchored.map((a) => a.at.version))) {
    const read = await service.rpc<{ current: Version | null; drawn: Version | null } | null>('surface_version_pair', { p_post: post, p_version: version });
    // surface_version_pair reads acts_public, where a hidden version keeps its row with an empty body, so `current` and `drawn` are not null for one: it is mapped against no words and a group moved onto or off it has a null place, never a refusal.
    // `drawn` is null when the draw's version is none of the post's, and `current` for a post that is none (the guard below is for a read that gives nothing).
    if (!read || !read.current || !read.drawn) return { ok: false, why: NOT_THOSE_WORDS };
    const { current, drawn } = read;
    const own = anchored.filter((a) => a.at.version === version);
    const placed = drawn.version === current.version ? own.map((a) => a.at as Attachment | null)
      : mapPlaces(contentAt(drawn), contentAt(current), own.map((a) => a.at));
    own.forEach((a, i) => places.push({ grp: a.grp, version: current.version, place: placed[i] ?? null }));
  }
  return { ok: true, places: places.sort((a, b) => (a.grp as number) - (b.grp as number)) };
}

/**
 * A draw's declared frame held to the post it is drawn on (issue #1259; engine/rules/frame.ts): refused, in TOO_BIG_A_FRAME, when its box is taller than the post's words, images, signature, poll and
 * reactions could lay out at its width, or an image group is wider than its box. A box that does not fit its post is, for an honest screen, a layout read before the post changed, so the words say to
 * reload. A post the read cannot find is refused in NOT_THOSE_WORDS, as a version that is none of the post's is. A card that names no frame for the draw (a stencil's box is the card's own) is not held. The post is read once (surface_frame_of, 0456), retried on a transport failure.
 *
 * A spun thread's opening Act is not held: its content area also holds the ORIGIN box, another Act drawn live or as it was, which this read does not lay out.
 * A wall in an ORIGIN box is on the post that box shows (kind post, or a spin that was itself spun from), not on the opening Act: a post is laid out as in its own thread, and the box is no wider or taller than its content area there.
 */
async function frameHeld(service: Db, rules: CardRules, instance: Instance, postOf: () => Promise<string | null>, payload: Record<string, unknown>): Promise<{ ok: true } | { ok: false; why: string }> {
  const frame = rules.surface?.frameOf?.(payload) ?? null;
  if (frame === null) return { ok: true };
  const post = await postOf();
  if (!post) return { ok: false, why: NOT_THOSE_WORDS };
  const read = await service.rpc<{ kind: string; versions: { body: string; forged?: unknown }[]; signature?: string; poll?: { question: string; options: string[] } | null } | null>('surface_frame_of', { p_post: post });
  if (!read || !Array.isArray(read.versions)) return { ok: false, why: NOT_THOSE_WORDS };
  if (read.kind === 'spin') return { ok: true };
  const problem = frameProblem({
    versions: read.versions.map((v) => ({ body: typeof v.body === 'string' ? v.body : '', forged: forgedSet(forgedList({ forged: v.forged })) })),
    signature: typeof read.signature === 'string' ? read.signature : '',
    poll: read.poll && Array.isArray(read.poll.options) ? { question: String(read.poll.question ?? ''), options: read.poll.options.map(String) } : null,
    reactions: instance.reactions.length,
  }, frame);
  return problem === null ? { ok: true } : { ok: false, why: TOO_BIG_A_FRAME };
}

/** One read for each caller: the first call's promise, kept. */
const once = <T>(read: () => Promise<T>): (() => Promise<T>) => { let p: Promise<T> | undefined; return () => (p ??= read()); };

/** Where each live group of the walls on a post sits in an edit's new words: `[{ draw, grp, place }]`. A group already fallen (null) is not sent: with no row for the edit's version it stays at its box spot. */
async function placesOfEdit(service: Db, post: string, body: string): Promise<Row[]> {
  const read = await service.rpc<{ version: string; body: string; forged?: unknown; groups: { draw: string; grp: number; place: Attachment | null }[] } | null>('surface_groups_on', { p_post: post });
  if (!read || !Array.isArray(read.groups) || read.groups.length === 0) return [];
  const alive = read.groups.filter((g) => g.place !== null);
  if (alive.length === 0) return [];
  // The new words' verdict is the one the database writes with the edit (acts_forged_quotes, 0393): quote_forged of the body at this instant, read only now that there are groups to place. A body with no quote has none.
  const verdict = /\[quote=/i.test(body) ? await service.rpc<string[] | null>('quote_forged', { body, at: new Date().toISOString() }) : [];
  const moved = mapPlaces(contentAt(read), contentOf(body, forgedSet(forgedList({ forged: verdict ?? [] }))), alive.map((g) => g.place!));
  const by = new Map(alive.map((g, i) => [g, moved[i] ?? null]));
  return alive.map((g) => ({ draw: g.draw, grp: g.grp, place: by.get(g) ?? null }));
}

export async function runAction(dbs: { player: Db; service: Db }, instance: Instance, request: unknown): Promise<ActionAnswer> {
  const decision = decide(request, instance);
  if (!decision.ok) return { ...refused(decision.field, decision.why), nobodyNamed: true };
  // Set immediately before a write's own call: a transport failure with it still false came from a read that ran first, so no write was sent.
  let writing = false;
  try {
    if (!decision.asService) {
      // The player's own call: the database verifies the session on the call itself.
      let args = decision.args;
      if (decision.rpc === 'edit_post') {
        // An edit moves the walls on its post with its words (0456): where each live group sits in the new words, read as the service for a caller the database has an account for.
        const who = await dbs.player.rpc<string | null>('whoami', {}).catch((e) => { if (sessionRefused(e)) return SIGN_IN; throw e; });
        if (who === SIGN_IN || !who) return SIGN_IN;
        const surface_places = await placesOfEdit(dbs.service, args.target as string, args.body as string);
        if (surface_places.length > 0) args = { ...args, surface_places };
      }
      writing = true;
      const body = await dbs.player.rpc<unknown>(decision.rpc, args).catch((e) => { if (sessionRefused(e)) return SIGN_IN; throw e; });
      if (body === SIGN_IN) return SIGN_IN;
      return { status: 200, body, broadcasts: live(decision.rpc, body) };
    }

    const who = await dbs.player.rpc<string | null>('whoami', {}).catch((e) => { if (sessionRefused(e)) return SIGN_IN; throw e; });
    if (who === SIGN_IN || !who) return SIGN_IN;
    let args: Record<string, unknown> = { ...decision.args, who };
    // A play's prices are settings: read as the rows hold them now, not as the code was deployed. A purchase's is its slot's, which the
    // database holds and compares with the price the screen showed (machine_now, 0139_machine.sql); it is sent as it was shown.
    const tuned = decision.needsTarget || decision.needsSurface ? await withDatabaseSettings(instance, dbs.service) : instance;
    let rpc = decision.rpc;
    if (decision.needsTarget) {
      // The target as its rules see it (card_target_reach, 0055): a post, a character, a thread or a board, with its own effects and
      // the live ones above it, which a card's canApply sees too (effectsOnTarget).
      const reach = (decision.args.reach ?? 'post') as Reach;
      const read = await dbs.player.rpc<(CardTarget & { effects: CardEffect[]; above?: EffectsAbove }) | null>('card_target_reach',
        { reach, target: decision.args.target, ...(decision.args.from_post ? { from_post: decision.args.from_post } : {}) });
      if (!read) return refused('target', `there is no such ${reach}`);
      // `forged` is the verdict of the version read (card_target_reach): a forged quote is the poster's own words to the card's rules, as a screen shows it.
      const { effects: own, above = {}, ...said } = read;
      // A post is given to its card's rules with its visible words, read from its current body, and the version that body is.
      const post = said as { act: string; kind: PostTarget['kind']; body?: unknown; version?: string; under?: string; author?: string; forged?: unknown };
      // `under` is the post this one is drawn under, where it is a reply a play in force carried (card_target): a card that replies is refused there.
      const target = reach === 'post' ? postTarget(post.act, post.kind, post.body, post.version, post.under, post.author, forgedList({ forged: post.forged })) : { ...said, reach } as CardTarget;
      const effects = effectsOnTarget(target, own ?? [], above);
      const rules = instance.cards.find((c) => c.key === decision.args.card)!;
      // A surface card's first draw is the card's own to read; what it refuses is said on the drawing (`first`), not on the configuration.
      if (rules.surface !== undefined && decision.args.first !== undefined) {
        const tag = decideDraw(rules, tuned.settings, decision.args.first);
        if (!tag.ok) return refused('first', tag.why);
      }
      if (decision.play === 'set') {
        // The card's own rules decide the configuration, the card a catching set card names and the phrase a Move waits for; none of them is read from the request but the configuration.
        const { conditions, ...rest } = args as { conditions?: SetConditions };
        const set = decideSet(rules, tuned.settings, target, effects, decision.args.config, tuned.cards, conditions);
        if (!set.ok) return refused('config', set.why);
        // The ids a Who names go as `named`, since `who` is already the account on this call (set_card's first argument).
        args = { ...rest, config: set.value.config, price: set.value.price, catches: set.value.catches ?? null, phrase: set.value.phrase ?? null, passage: set.value.passage ?? null, named: set.value.who?.characters ?? null, who_except: set.value.who?.except ?? null };
      } else {
        const said = casterMessage(decision.args.message);
        if (!said.ok) return refused('message', said.why);
        const nameOf = (key: string) => instance.cards.find((c) => c.key === key)?.name ?? key;
        const play = decision.play === 'use'
          ? decideUse(rules, tuned.settings, target, effects, decision.args.config, said.value)
          : decidePlay(rules, tuned.settings, target, effects, decision.args.config, said.value, { nameOf, rulesOf: (key) => instance.cards.find((c) => c.key === key), first: decision.args.first, caster: decision.args.through as string });
        // A card that needs a caster message refuses a blank one on the message field, as the screens show it there.
        if (!play.ok) return refused(play.why === rules.needsMessage ? 'message' : 'config', play.why);
        args = { ...args, config: play.value.config, message: play.value.message, price: play.value.price };
        // A card that writes buys its tokens at this decision, from the settings as the rows hold them now; the database writes them with the play and the worker and the log read them there.
        if (play.value.tokens !== undefined) args = { ...args, tokens: play.value.tokens };
        // A surface card's first draw goes with the play, in one transaction (play_surface_card): its payload, its cells, the wall's limit from the settings rows and the card's most live draws.
        if (play.value.draw) {
          rpc = 'play_surface_card';
          // `tokens` has no default in play_surface_card, so it is always sent: a card that writes nothing sends null (PostgREST finds no function otherwise).
          // Its groups' places are those of the post's current version, which the play was just decided against.
          const placed = await placesOfDraw(dbs.service, async () => decision.args.target as string, play.value.draw.payload);
          if (!placed.ok) return refused('first', placed.why);
          // Its frame is held to the post, as a later draw's is.
          const held = await frameHeld(dbs.service, rules, instance, async () => decision.args.target as string, play.value.draw.payload);
          if (!held.ok) return refused('first', held.why);
          args = { ...args, tokens: play.value.tokens ?? null, first: play.value.draw.payload, first_coats: play.value.draw.coats, first_places: placed.places, most: play.value.draw.most, most_live: rules.surface!.mostLive };
        }
        // The version the play was decided against goes back with it; play_card refuses it once the post has another (0070).
        if (target.reach === 'post' && target.version) args = { ...args, reach: 'post', from_post: null, version: target.version };
      }
    }
    if (decision.needsCardOfPlay) {
      const key = await dbs.player.rpc<string | null>('card_of_play', { play: decision.args.on_play });
      const rules = instance.cards.find((c) => c.key === key);
      if (!rules) return refused('play', 'there is no such card on a post');
      if (!rules.validateState) return refused('play', 'this card keeps no state');
      const state = rules.validateState(decision.args.state);
      if (!state.ok) return refused('state', state.why);
      // A hold on the author's saves (the play's own rules name it): refused before any write and before the database's author check, from the
      // play's public landing time and the settings alone, so the answer is the same for every caller and proves nothing about who wrote the post.
      if (rules.stateHeldUntil) {
        const landed = await dbs.player.rpc<string | null>('play_landed_at', { play: decision.args.on_play });
        if (!landed) return refused('play', 'there is no such card on a post');
        const held = await withDatabaseSettings(instance, dbs.service);
        const until = rules.stateHeldUntil(held.settings, new Date(landed));
        if (until && Date.now() < until.getTime()) {
          const when = refusalTime(until.toISOString());
          return refused('play', rules.stateHeldWords?.(when) ?? `This card's effect can't be changed by its post's author until ${when}.`);
        }
      }
      // Whether the card says this state clears the effect it draws, and for which version of the post if it says one (0411): the database counts the effect against the post's limit from these two.
      const cleared = rules.drawsEffect?.cleared?.(state.value) ?? false;
      args = { ...args, state: state.value, cleared: cleared !== false, ...(typeof cleared === 'object' ? { cleared_for: cleared.version } : {}) };
    }
    if (decision.needsSurface) {
      // The card that holds the wall reads the drawing and counts its cells; a draw's limit is the settings rows' (`tuned`), never the code as deployed.
      const key = await dbs.player.rpc<string | null>('card_of_play', { play: decision.args.play });
      const rules = instance.cards.find((c) => c.key === key);
      if (!rules?.surface) return refused('play', 'this card holds no wall');
      const { input: _input, ...rest } = args;
      if (decision.rpc === 'draw_on_surface') {
        const drawn = decideDraw(rules, tuned.settings, decision.args.input);
        if (!drawn.ok) return refused('input', drawn.why);
        // Where its groups sit in the post's current version; the post is the one the wall is on, read once, for a drawing with a group attached to its words or an image or with a frame to hold.
        const postOf = once(() => dbs.service.rpc<string | null>('surface_post_of', { p_play: decision.args.play }));
        const placed = await placesOfDraw(dbs.service, postOf, drawn.value.payload);
        if (!placed.ok) return refused('input', placed.why);
        // And its frame is held to that post, for every draw whose frame its drawer declared (a box-only draw too), before anything is written.
        const held = await frameHeld(dbs.service, rules, instance, postOf, drawn.value.payload);
        if (!held.ok) return refused('input', held.why);
        args = { ...rest, payload: drawn.value.payload, coats: drawn.value.coats, places: placed.places, most: drawn.value.most };
      } else {
        // The live draws' payloads, which a cut names its draw and group in (the card's own validateWash reads them); a draw not live is not among them.
        const wall = await dbs.service.rpc<{ acts: { id: string; kind: string; payload: unknown }[] } | null>('surface_acts', { play: decision.args.play });
        if (!wall) return refused('play', 'there is no wall on that post');
        const draws = new Map(wall.acts.filter((a) => a.kind === 'draw').map((a) => [a.id, a.payload] as const));
        const washed = decideWash(rules, tuned.settings, decision.args.input, draws);
        if (!washed.ok) return refused('input', washed.why);
        args = { ...rest, payload: washed.value.payload, takes: washed.value.takes };
      }
    }
    writing = true;
    const body = await dbs.service.rpc<unknown>(rpc, args);
    return { status: 200, body, broadcasts: live(rpc, body, decision.args) };
  } catch (e) {
    const barred = barredAnswer(e);
    if (barred) return barred;
    if (e instanceof DatabaseError && e.hint === REFUSAL_HINT) {
      const answer: ActionAnswer = { status: e.status >= 400 && e.status < 500 ? e.status : 400, body: { error: e.reason, code: e.code } };
      // 28000: the SQL function found no account behind the session (0002, 0005, 0009 raise it so).
      return e.code === NO_ACCOUNT ? { ...answer, nobodyNamed: true } : answer;
    }
    // The answer was lost, and the write may have committed: said so, never "it failed".
    if (e instanceof TransportError) {
      // Certainly not made: a read before the write failed, or every attempt at the write was a 503. Sending again cannot duplicate.
      // The words are typed here (an edge function does not import engine/ui); core.test.ts holds them equal to NOT_RUN.
      if (!writing || e.ran === 'never') return { status: 503, body: { error: 'it did not go through; try again', sent: false } };
      return { status: 503, body: { error: 'no answer came back, so this may have gone through: look before you try again' } };
    }
    console.error('act failed', decision.rpc, e);
    return { status: 500, body: { error: 'the action could not be completed; try again' } };
  }
}

/**
 * Work that runs once the answer has gone: the live updates the write sent, and the drain of the outbox (an alert is queued by the
 * write that made it, and sent from there; supabase/functions/_shared/outbox.ts). It runs on a later turn than the one that built
 * the answer, so the answer is never shaped by it, and it is never awaited by the answer, with or without a runtime that lets
 * work outlive it (`waitUntil`, Supabase's EdgeRuntime; the local runtime has none). So neither the answer nor its timing tells
 * whether the write queued an alert, which exists only where the target has an owner (a private fact). Nothing it throws escapes.
 */
export interface Afterwards {
  readonly waitUntil?: (work: Promise<unknown>) => void;
  /** Runs a function on a later turn; a timer by default. */
  readonly defer?: (run: () => void) => void;
}
export function afterTheAnswer(work: () => Promise<unknown>, o: Afterwards = {}): void {
  const defer = o.defer ?? ((run: () => void) => { setTimeout(run, 0); });
  const running = new Promise<void>((resolve) => {
    defer(() => { work().catch((e) => console.error('work after the answer threw', e)).finally(resolve); });
  });
  o.waitUntil?.(running);
}

/** What act_window_counts answers (0065): an Act's public reaction counts in the window, and the post it is on where it is a card on one. */
interface WindowCounts { readonly counts: QuadrantCounts; readonly cardOn: string | null }
const totalOf = (c: QuadrantCounts): number => c.excitedPositive + c.excitedNegative + c.calmPositive + c.boredNegative;

/**
 * The hint a reaction may have earned (the alerts design's section 5): the window's public counts for the Act reacted to (and, for a
 * card played on a post, the post's), the engine's pick of at most one pattern, and fire_hint, which writes the hint alert for the Act's
 * own player once per Act and pattern. A card that outdraws its post is a hint for both: the post's player and the card's; once the
 * card's thunder has been told, it is judged by its own reactions again. Answers whether any hint was written.
 *
 * It reads public counts and their times, never who reacted, and runs after the answer (handleAction), so the reactor's answer and
 * its timing cannot depend on whether a hint fired. A reaction sent again reads the same window and asks again, and SQL fires a
 * pattern once. A transport failure is retried by the connection (the calls are safe to repeat); a database error is a fact about
 * the request and is thrown at once, to be logged by the caller.
 */
export async function fireHints(service: Db, instance: Instance, about: string, now: Date = new Date()): Promise<boolean> {
  const fire = (on: string, pattern: string) => service.rpc<boolean>('fire_hint', { about: on, pattern });
  // Whatever is written stays counted if a later call throws: an alert that was queued still needs its drain.
  let fired = false;
  try {
    const hints = await hintSettings(instance, service, now);
    const since = windowStart(now, hints.window).toISOString();
    const read = await service.rpc<WindowCounts>('act_window_counts', { about, since });
    // A card is compared with its post only once it has drawn the least: below it, no thunder is possible, and the post is not read.
    if (read.cardOn && totalOf(read.counts) >= hints.least) {
      const post = await service.rpc<WindowCounts>('act_window_counts', { about: read.cardOn, since });
      if (hintFor(read.counts, hints, { cardCount: totalOf(read.counts), postCount: totalOf(post.counts) }) === 'thunder') {
        const card = await fire(about, 'thunder');
        fired = card;
        fired = (await fire(read.cardOn, 'thunder')) || fired;
        // A thunder fired once does not hide the card's own pattern for good: when it has already been told, the card is judged by its reactions.
        if (card) return fired;
      }
    }
    const pattern = hintFor(read.counts, hints);
    if (pattern) fired = (await fire(about, pattern)) || fired;
  } catch (e) {
    console.error('hint check threw', e);
  }
  return fired;
}

/** The hint settings as the rows hold them, read at most once a minute per instance in this isolate: the act function builds its connections per request, so the cache lives with what outlives one. A retune is felt within the minute. */
const HINT_SETTINGS_FOR_MS = 60_000;
let settingsSeen = new WeakMap<Instance, { readonly at: number; readonly hints: HintSettings }>();
/** Forgets the held settings (for tests; a running isolate lets them lapse). */
export const forgetHintSettings = (): void => { settingsSeen = new WeakMap(); };
async function hintSettings(instance: Instance, service: Db, now: Date): Promise<HintSettings> {
  const seen = settingsSeen.get(instance);
  if (seen && now.getTime() - seen.at < HINT_SETTINGS_FOR_MS && now.getTime() >= seen.at) return seen.hints;
  const { hints } = (await withDatabaseSettings(instance, service)).settings;
  settingsSeen.set(instance, { at: now.getTime(), hints });
  return hints;
}

/**
 * An action, answered; then, after the answer and whatever it queued, the write's live updates and the drain of the outbox, handed
 * to `after` (afterTheAnswer in the edge). The drain runs after every action that names an account, a refused one included, whether or not the write
 * queued anything, so that no answer differs by it. A written reaction is also checked for a hint (fireHints) in that same later work,
 * after the first drain, with one more drain when a hint was written.
 */
export async function handleAction(o: {
  readonly dbs: { player: Db; service: Db };
  readonly instance: Instance;
  readonly body: unknown;
  readonly send: (messages: readonly Broadcast[]) => Promise<unknown>;
  readonly drain: () => Promise<void>;
  readonly after: (work: () => Promise<void>) => void;
  /** Writes the waiting card texts of one post (the write function's runWrites, with the connection and models the edge holds); absent where none is wired. */
  readonly write?: (post: string) => Promise<unknown>;
}): Promise<ActionAnswer> {
  const out = await runAction(o.dbs, o.instance, o.body);
  // A request that named no account schedules nothing (ActionAnswer.nobodyNamed says why).
  if (out.nobodyNamed) return out;
  // A reaction that was written may have earned its Act's player a hint; read from the answer's own Act, after the answer.
  const decision = decide(o.body, o.instance);
  const reacted = out.status === 200 && decision.ok && decision.rpc === 'react' && typeof (out.body as Row | null)?.act === 'string' ? (out.body as Row).act as string : null;
  const kicked = out.status === 200 && decision.ok ? postThatMayWrite(decision, o.instance) : null;
  o.after(async () => {
    if (out.broadcasts?.length) await o.send(out.broadcasts).catch((e) => console.error('broadcast threw', e));
    // The reaction's own alerts and broadcasts first, never held by the hint's reads; then the hint, and one more drain for the alert it
    // wrote. What the hint work throws is logged and never stops a drain.
    await o.drain();
    if (reacted && await fireHints(o.dbs.service, o.instance, reacted).catch((e) => { console.error('hint check threw', e); return false; })) await o.drain();
    // The kick: a tail types in seconds after the play. The claim itself answers nothing for a post with no jobs, and the cron's sweep
    // finds what a kick misses; nothing it throws escapes.
    if (kicked && o.write) await o.write(kicked).catch((e) => console.error('card text kick threw', e));
  });
  return out;
}
/**
 * The post a successful action may have queued card texts on, from the request alone (public: the card's rules and the post named): a play
 * on a post of a card that writes, or an edit, which any post may have a tail waiting for. Null for everything else, which then makes no claim.
 */
function postThatMayWrite(decision: { readonly rpc: string; readonly args: Record<string, unknown> }, instance: Instance): string | null {
  const post = decision.args.target;
  if (typeof post !== 'string') return null;
  if (decision.rpc === 'edit_post') return post;
  if (decision.rpc !== 'play_card' || (decision.args.reach ?? 'post') !== 'post') return null;
  return instance.cards.find((c) => c.key === decision.args.card)?.writes ? post : null;
}

/**
 * Makes a drain of the outbox one at a time per isolate. Every write starts a drain (so that none differs by what was queued), which
 * at a busy instance is a drain per write, each a database call and, when it finds something, a send. With one in flight, a write
 * that comes meanwhile only marks that another is due, and one follow-up runs when the first ends, so whatever any write queued is
 * sent by a drain that began after it, and a burst costs two drains, not one per write. The callers' promises settle when the
 * drain that covers them has, so a runtime that waits on one (waitUntil) stays up for the work. What a drain throws is logged.
 */
export function coalesced(run: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  return () => {
    if (running) { again = true; return running; }
    running = (async () => {
      do {
        again = false;
        await run().catch((e) => console.error('drain threw', e));
      } while (again);
    })().finally(() => { running = null; });
    return running;
  };
}
