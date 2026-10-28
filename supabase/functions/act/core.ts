/**
 * A player's action, as a pure module: decide it against the instance (engine/rules/actions.ts),
 * then call its SQL function as the player, whose session the Db carries. Answers carry the
 * public projection the SQL function returned, the decision's refusal with its field, or the
 * database's refusal in the function's own words; never PostgREST's detail, which can quote a
 * row, and never anything from a failure inside.
 */
import { decide } from '../../../engine/rules/actions.ts';
import type { Instance } from '../../../engine/rules/types.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';

export interface ActionAnswer {
  readonly status: number;
  readonly body: unknown;
}

export async function runAction(db: Db, instance: Instance, request: unknown): Promise<ActionAnswer> {
  const decision = decide(request, instance);
  if (!decision.ok) return { status: 400, body: { field: decision.field, error: decision.why } };
  try {
    return { status: 200, body: await db.rpc<unknown>(decision.rpc, decision.args) };
  } catch (e) {
    if (e instanceof DatabaseError) return { status: e.status >= 400 && e.status < 500 ? e.status : 400, body: { error: e.reason, code: e.code } };
    console.error('act failed', decision.rpc, e);
    return { status: 500, body: { error: 'the action could not be completed; try again' } };
  }
}
