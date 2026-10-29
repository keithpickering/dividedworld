/**
 * A player's live estimate of the open window, as a pure module (the screens' design, section 7):
 * who the session is, read as the player (whoami()); what that player's characters did and
 * received so far, read by the service (estimate_input(), supabase/migrations/0017_estimate.sql),
 * which names nobody else; and the engine's estimateForOwner (engine/rules/settle.ts) over it, with
 * the shared vote and the halving off, on the instance as its settings rows hold it now. The
 * settlement is exact; this says "up to", reaction by reaction, and never who reacted.
 *
 * Every answer is the caller's own: the caller's characters' entries and lines, and no key the
 * input used. A failure says nothing from inside.
 */
import { estimateForOwner } from '../../../engine/rules/settle.ts';
import type { Instance, SettlementInput } from '../../../engine/rules/types.ts';
import { TransportError, postgrest, type Db } from '../_shared/rpc.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';

export interface EstimateAnswer {
  readonly status: number;
  readonly body: unknown;
}

/** The function's two connections, as the player and as the service; every call here is a read, safe to repeat. */
export function estimateDbs(o: { url: string; key: string; anon: string; session: string; fetch?: typeof globalThis.fetch }): { player: Db; service: Db } {
  return { player: postgrest({ url: o.url, key: o.anon, bearer: o.session, fetch: o.fetch }), service: postgrest({ url: o.url, key: o.key, fetch: o.fetch }) };
}

export async function runEstimate(dbs: { player: Db; service: Db }, instance: Instance): Promise<EstimateAnswer> {
  try {
    const who = await dbs.player.rpc<string | null>('whoami', {});
    if (!who) return { status: 401, body: { error: 'sign in to see your estimate' } };
    const input = await dbs.service.rpc<(SettlementInput & { player: string }) | null>('estimate_input', { account: who });
    if (!input) return { status: 200, body: { entries: [], lines: [] } };
    const tuned = await withDatabaseSettings(instance, dbs.service);
    return { status: 200, body: estimateForOwner(input, tuned, input.player) };
  } catch (e) {
    if (e instanceof TransportError) return { status: 503, body: { error: 'no answer came back; try again' } };
    console.error('estimate failed', e);
    return { status: 500, body: { error: 'the estimate could not be read; try again' } };
  }
}
