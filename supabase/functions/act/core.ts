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
import { basePrice, casterMessage, decidePlay, decideSet, decideUse, effectsOnTarget, type CardEffect, type CardTarget, type EffectsAbove, type Reach } from '../../../engine/rules/cards.ts';
import type { Instance } from '../../../engine/rules/types.ts';
import { DatabaseError, TransportError, postgrest, type Db } from '../_shared/rpc.ts';
import type { Broadcast } from '../_shared/broadcast.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';

export interface ActionAnswer {
  readonly status: number;
  readonly body: unknown;
  /** What the write sends live, once it has committed: public projections only. */
  readonly broadcasts?: readonly Broadcast[];
}

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

const announcement = (a: Row): Broadcast[] => {
  const told = a.announcement as Row | null | undefined;
  // A drop announced with its class: the character's own unmask follows the tally (0028_loud_classes.sql).
  return told ? [...thread(told.thread), ...act(told.act), ...act(told.unmask)] : [];
};

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
const BROADCASTS: Record<string, (answer: Row) => Broadcast[]> = {
  post: (a) => withSprung(a, act(without(a, 'sprung'))),
  edit_post: (a) => act(a),
  play_card: (a) => withSprung(a, [...act(without(a, 'sprung')), ...onReach(without(a, 'sprung'))]),
  // A card back: the set Act names no card, so neither does what is sent.
  set_card: (a) => act(a),
  start_thread: (a) => [...thread(a.thread), ...act(a.act)],
  spin: (a) => [...thread(a.thread), ...act(a.act)],
  unmask: (a) => act(a),
  // A Turn waits for the settlement, whose tally is sent from there (settle/core.ts).
  turn: () => [],
  withdraw_turn: () => [],
  react: (a) => withSprung(a, a.thread ? [{ topic: `thread:${a.thread}`, event: 'tally', payload: { act: a.act, tally: a.tally } }] : []),
  save_effect_state: (a) => (a.thread ? [{ topic: `thread:${a.thread}`, event: 'effect', payload: { play: a.play, saved_at: a.saved_at } }] : []),
  buy_card: () => [],
  // A player's own: a character appears on the next load of who is here, and an invite or an
  // account is nobody else's to hear of. A drop announced is The System's tally of one, sent now
  // with the Turns thread it opened, as the settlement sends a tally (0024_debuts.sql).
  create_character: (a) => announcement(a),
  set_debut: (a) => announcement(a),
  create_invite: () => [],
  reissue_invite: () => [],
  open_account: () => [],
};
const live = (rpc: string, answer: unknown): Broadcast[] =>
  answer && typeof answer === 'object' ? (BROADCASTS[rpc]?.(answer as Row) ?? []) : [];

/**
 * The calls that may be sent again after a failure that may have followed their commit
 * (supabase/functions/_shared/rpc.ts): the reads, and opening an account (one already open is no
 * change). Every other write is sent once; a saved effect's state among them, since a save
 * repeated after a newer one landed would bring the older strokes back.
 */
const REPEATABLE = new Set(['whoami', 'card_target', 'card_target_reach', 'card_of_play', 'open_account', 'instance_settings']);
export const SAFE_TO_REPEAT = (fn: string): boolean => REPEATABLE.has(fn);

/** The act function's two connections: as the player, and as the service; each sends a write once. */
export function actDbs(o: { url: string; key: string; anon: string; session: string; fetch?: typeof globalThis.fetch; sleep?: (ms: number) => Promise<void> }): { player: Db; service: Db } {
  const common = { url: o.url, fetch: o.fetch, sleep: o.sleep, safeToRepeat: SAFE_TO_REPEAT };
  return { player: postgrest({ ...common, key: o.anon, bearer: o.session }), service: postgrest({ ...common, key: o.key }) };
}

/** The hint every refusal the action functions raise carries, so their words alone reach a player. */
export const REFUSAL_HINT = 'kayfabb.refusal';

const refused = (field: string, why: string): ActionAnswer => ({ status: 400, body: { field, error: why } });

export async function runAction(dbs: { player: Db; service: Db }, instance: Instance, request: unknown): Promise<ActionAnswer> {
  const decision = decide(request, instance);
  if (!decision.ok) return refused(decision.field, decision.why);
  try {
    if (!decision.asService) {
      const body = await dbs.player.rpc<unknown>(decision.rpc, decision.args);
      return { status: 200, body, broadcasts: live(decision.rpc, body) };
    }

    const who = await dbs.player.rpc<string | null>('whoami', {});
    if (!who) return { status: 401, body: { error: 'sign in to act' } };
    let args: Record<string, unknown> = { ...decision.args, who };
    // A card's prices are settings: read as the rows hold them now, not as the code was deployed.
    const tuned = decision.rpc === 'buy_card' || decision.needsTarget ? await withDatabaseSettings(instance, dbs.service) : instance;
    if (decision.rpc === 'buy_card') args = { ...args, price: basePrice(tuned.cards.find((c) => c.key === decision.args.card)!, tuned.settings) };
    if (decision.needsTarget) {
      // The target as its rules see it (card_target_reach, 0055): a post, a character, a thread or a board, with its own effects and
      // the live ones above it, which a card's canApply sees too (effectsOnTarget).
      const reach = (decision.args.reach ?? 'post') as Reach;
      const read = await dbs.player.rpc<(CardTarget & { effects: CardEffect[]; above?: EffectsAbove }) | null>('card_target_reach',
        { reach, target: decision.args.target, ...(decision.args.from_post ? { from_post: decision.args.from_post } : {}) });
      if (!read) return refused('target', `there is no such ${reach}`);
      const { effects: own, above = {}, ...said } = read;
      const target = { ...said, reach } as CardTarget;
      const effects = effectsOnTarget(target, own ?? [], above);
      const rules = instance.cards.find((c) => c.key === decision.args.card)!;
      if (decision.play === 'set') {
        // A strike's configuration is the struck card's, checked by that card's own rules.
        const set = decideSet(rules, tuned.settings, target, effects, decision.args.config, tuned.cards);
        if (!set.ok) return refused('config', set.why);
        args = { ...args, config: set.value.config, price: set.value.price };
      } else {
        const said = casterMessage(decision.args.message);
        if (!said.ok) return refused('message', said.why);
        const nameOf = (key: string) => instance.cards.find((c) => c.key === key)?.name ?? key;
        const play = decision.play === 'use'
          ? decideUse(rules, tuned.settings, target, effects, decision.args.config, said.value)
          : decidePlay(rules, tuned.settings, target, effects, decision.args.config, said.value, { nameOf });
        if (!play.ok) return refused('config', play.why);
        args = { ...args, config: play.value.config, message: play.value.message, price: play.value.price };
      }
    }
    if (decision.needsCardOfPlay) {
      const key = await dbs.player.rpc<string | null>('card_of_play', { play: decision.args.on_play });
      const rules = instance.cards.find((c) => c.key === key);
      if (!rules) return refused('play', 'there is no such card on a post');
      if (!rules.validateState) return refused('play', 'this card keeps no state');
      const state = rules.validateState(decision.args.state);
      if (!state.ok) return refused('state', state.why);
      args = { ...args, state: state.value };
    }
    const body = await dbs.service.rpc<unknown>(decision.rpc, args);
    return { status: 200, body, broadcasts: live(decision.rpc, body) };
  } catch (e) {
    if (e instanceof DatabaseError && e.hint === REFUSAL_HINT) return { status: e.status >= 400 && e.status < 500 ? e.status : 400, body: { error: e.reason, code: e.code } };
    if (e instanceof DatabaseError && e.status === 401 && e.message.startsWith('whoami:')) return { status: 401, body: { error: 'sign in to act' } };
    // The answer was lost, and the write may have committed: said so, never "it failed".
    if (e instanceof TransportError) {
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

/**
 * An action, answered; then, after the answer and whatever it queued, the write's live updates and the drain of the outbox, handed
 * to `after` (afterTheAnswer in the edge). The drain runs after every action, a refused one included, whether or not the write
 * queued anything, so that no answer differs by it.
 */
export async function handleAction(o: {
  readonly dbs: { player: Db; service: Db };
  readonly instance: Instance;
  readonly body: unknown;
  readonly send: (messages: readonly Broadcast[]) => Promise<unknown>;
  readonly drain: () => Promise<void>;
  readonly after: (work: () => Promise<void>) => void;
}): Promise<ActionAnswer> {
  const out = await runAction(o.dbs, o.instance, o.body);
  o.after(async () => {
    if (out.broadcasts?.length) await o.send(out.broadcasts).catch((e) => console.error('broadcast threw', e));
    await o.drain();
  });
  return out;
}
