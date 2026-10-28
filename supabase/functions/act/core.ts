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
import { decidePlay, type CardEffect, type CardTarget } from '../../../engine/rules/cards.ts';
import type { Instance } from '../../../engine/rules/types.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import type { Broadcast } from '../_shared/broadcast.ts';

export interface ActionAnswer {
  readonly status: number;
  readonly body: unknown;
  /** What the write sends live, once it has committed: public projections only. */
  readonly broadcasts?: readonly Broadcast[];
}

type Row = Record<string, unknown>;
const act = (a: unknown): Broadcast[] => (a && typeof a === 'object' && (a as Row).thread ? [{ topic: `thread:${(a as Row).thread}`, event: 'act', payload: a }] : []);
const thread = (t: unknown): Broadcast[] => (t && typeof t === 'object' && (t as Row).board ? [{ topic: `board:${(t as Row).board}`, event: 'thread', payload: t }] : []);

/**
 * What each SQL function's answer sends live. Each is the public projection the function
 * returned, never more; a purchase, which is the player's alone, sends nothing, and so does a
 * silent Turn, which returns no Act.
 */
const BROADCASTS: Record<string, (answer: Row) => Broadcast[]> = {
  post: (a) => act(a),
  edit_post: (a) => act(a),
  play_card: (a) => act(a),
  start_thread: (a) => [...thread(a.thread), ...act(a.act)],
  spin: (a) => [...thread(a.thread), ...act(a.act)],
  turn: (a) => act(a.act),
  react: (a) => (a.thread ? [{ topic: `thread:${a.thread}`, event: 'tally', payload: { act: a.act, tally: a.tally } }] : []),
  save_effect_state: (a) => (a.thread ? [{ topic: `thread:${a.thread}`, event: 'effect', payload: { play: a.play, state: a.state } }] : []),
  buy_card: () => [],
};
const live = (rpc: string, answer: unknown): Broadcast[] =>
  answer && typeof answer === 'object' ? (BROADCASTS[rpc]?.(answer as Row) ?? []) : [];

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
    if (decision.needsTarget) {
      const target = await dbs.player.rpc<(CardTarget & { effects: CardEffect[] }) | null>('card_target', { target: decision.args.target });
      if (!target) return refused('target', 'there is no such post');
      const rules = instance.cards.find((c) => c.key === decision.args.card)!;
      const play = decidePlay(rules, target, target.effects, decision.args.config);
      if (!play.ok) return refused('config', play.why);
      args = { ...args, config: play.value.config, price: play.value.price };
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
    console.error('act failed', decision.rpc, e);
    return { status: 500, body: { error: 'the action could not be completed; try again' } };
  }
}
