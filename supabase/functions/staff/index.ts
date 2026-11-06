/**
 * The Mod Bots' filing run's Edge Function: pg_cron calls it at the instance's `modBots.filingCron` with the minute it fired
 * (supabase/migrations/0104_mod_moves.sql). The work is core.ts; this is the edge: the jobs key it accepts (kayfabb_jobs, in apikey), the environment, the model adapters
 * (supabase/functions/_shared/models/) and an answer that says what happened. No secret is ever logged or returned: the model key is read by the adapter from `Deno.env`
 * and appears in no message.
 *
 * The database client does not repeat a write after a failure that may have followed its commit (`safeToRepeat`). Of this run's writes only the ledger's row is not
 * idempotent: `file_visit` finds a visit already ended and `apply_mod_move` finds the move of its cause, so a repeat of either writes nothing a second time and is sent again.
 */
import { runFilings } from './core.ts';
import { chooseInstance } from '../_shared/instance.ts';
import { postgrest } from '../_shared/rpc.ts';
import { environment, fromTheService, json, notTheService } from '../_shared/serve.ts';
import { models } from '../_shared/models/index.ts';
import { ledgerWriter } from '../_shared/models/ledger.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';

/** The calls that write and are not idempotent: not sent again after an answer that may have been lost on the way back. */
const WRITES = new Set(['record_model_call']);

Deno.serve(async (request) => {
  const env = environment((name) => Deno.env.get(name));
  if (!fromTheService(request, env.jobs)) return notTheService(env.jobs, 'the filing run is run by the service');
  const body = (await request.json().catch(() => ({}))) as { slot?: unknown };
  // The schedule sends the minute it fired; a call without one is refused rather than guessed.
  if (typeof body.slot !== 'string' || Number.isNaN(Date.parse(body.slot))) return json(400, { error: 'slot: the scheduled minute, as a time' });
  const slot = body.slot;
  try {
    const db = postgrest({ url: env.url, key: env.secret, safeToRepeat: (fn) => !WRITES.has(fn) });
    const instance = chooseInstance(Deno.env.get('KAYFABB_PROFILE'));
    // The tiers are the instance's `modelTiers` setting as the database holds it now; the model adapter names no model of its own.
    const tiers = (await withDatabaseSettings(instance, db)).settings.modelTiers;
    const outcome = await runFilings(db, models((name) => Deno.env.get(name), ledgerWriter(db), { tiers }), instance, slot);
    if (outcome.status === 'ok') {
      const odd = outcome.filings.filter((f) => f.status === 'failed' || f.trims.length > 0 || f.dropped.length > 0 || f.why !== undefined);
      if (odd.length) console.warn('filings with a trim, a drop, a stock line or a failure', slot, JSON.stringify(odd.map((f) => ({ visit: f.visit, staff: f.staff, status: f.status, why: f.why, trims: f.trims, dropped: f.dropped }))));
    }
    return json(200, outcome);
  } catch (e) {
    // The details go to the function's log; the answer says only that it failed, and for which slot.
    console.error('staff failed', slot, e instanceof Error ? e.message : 'unknown');
    return json(500, { error: 'the filing run failed', slot });
  }
});
