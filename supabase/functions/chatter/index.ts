/**
 * The posting pool's Edge Function: pg_cron calls it at the instance's `pool.chatterCron` with the minute it fired
 * (supabase/migrations/0089_pool_spends.sql). The work is core.ts; this is the edge: the jobs key it accepts (kayfabb_jobs, in apikey), the
 * environment, the model adapters (supabase/functions/_shared/models/) and an answer that says what happened. No secret is ever logged or
 * returned: the model key is read by the adapter from `Deno.env` and appears in no message.
 *
 * The database client does not repeat a write after a failure that may have followed its commit (`safeToRepeat`): a post or a spend repeated
 * on a guess is a post twice (and a claim repeated would be refused by its own first try). A read is repeated; a write is thrown, and the next run of the day finds what was written (core.ts, `pool_orphans`).
 */
import { runChatter } from './core.ts';
import { chooseInstance } from '../_shared/instance.ts';
import { postgrest } from '../_shared/rpc.ts';
import { environment, fromTheService, json, notTheService } from '../_shared/serve.ts';
import { models } from '../_shared/models/index.ts';
import { ledgerWriter } from '../_shared/models/ledger.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';

/** The calls that write: not sent again after an answer that may have been lost on the way back. The ledger's own writer is one. */
const WRITES = new Set(['write_staff_act', 'write_staff_thread', 'staff_play_card', 'staff_set_card', 'write_staff_note', 'record_pool_spend', 'claim_pool_run', 'record_model_call']);

Deno.serve(async (request) => {
  const env = environment((name) => Deno.env.get(name));
  if (!fromTheService(request, env.jobs)) return notTheService(env.jobs, 'the pool is run by the service');
  const body = (await request.json().catch(() => ({}))) as { slot?: unknown };
  // The schedule sends the minute it fired; a call without one is refused rather than guessed.
  if (typeof body.slot !== 'string' || Number.isNaN(Date.parse(body.slot))) return json(400, { error: 'slot: the scheduled minute, as a time' });
  const slot = body.slot;
  try {
    const db = postgrest({ url: env.url, key: env.secret, safeToRepeat: (fn) => !WRITES.has(fn) });
    const instance = chooseInstance(Deno.env.get('KAYFABB_PROFILE'));
    // The tiers are the instance's `modelTiers` setting as the database holds it now; the model adapter names no model of its own.
    const tiers = (await withDatabaseSettings(instance, db)).settings.modelTiers;
    const outcome = await runChatter(db, models((name) => Deno.env.get(name), ledgerWriter(db), { tiers }), instance, slot);
    if (outcome.status === 'ok') {
      const unspent = outcome.picks.filter((p) => p.status === 'rejected' || p.status === 'failed');
      if (unspent.length) console.warn('chatter picks that spent nothing', slot, JSON.stringify(unspent.map((p) => ({ staff: p.staff, status: p.status, why: p.why }))));
    }
    return json(200, outcome);
  } catch (e) {
    // The details go to the function's log; the answer says only that it failed, and for which slot.
    console.error('chatter failed', slot, e instanceof Error ? e.message : 'unknown');
    return json(500, { error: 'the chatter failed', slot });
  }
});
