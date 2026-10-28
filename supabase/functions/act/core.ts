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

export interface ActionAnswer {
  readonly status: number;
  readonly body: unknown;
}

/** The hint every refusal the action functions raise carries, so their words alone reach a player. */
export const REFUSAL_HINT = 'kayfabb.refusal';

const refused = (field: string, why: string): ActionAnswer => ({ status: 400, body: { field, error: why } });

export async function runAction(dbs: { player: Db; service: Db }, instance: Instance, request: unknown): Promise<ActionAnswer> {
  const decision = decide(request, instance);
  if (!decision.ok) return refused(decision.field, decision.why);
  try {
    if (!decision.asService) return { status: 200, body: await dbs.player.rpc<unknown>(decision.rpc, decision.args) };

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
    return { status: 200, body: await dbs.service.rpc<unknown>(decision.rpc, args) };
  } catch (e) {
    if (e instanceof DatabaseError && e.hint === REFUSAL_HINT) return { status: e.status >= 400 && e.status < 500 ? e.status : 400, body: { error: e.reason, code: e.code } };
    if (e instanceof DatabaseError && e.status === 401 && e.message.startsWith('whoami:')) return { status: 401, body: { error: 'sign in to act' } };
    console.error('act failed', decision.rpc, e);
    return { status: 500, body: { error: 'the action could not be completed; try again' } };
  }
}
