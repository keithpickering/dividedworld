/**
 * The card-text writer's Edge Function: pg_cron calls it every minute as the sweep (the act function's kick, afterTheAnswer, writes a play's
 * tail within seconds; this finds what a kick missed, and the jobs whose claim ran out). The work is core.ts; this is the edge: the jobs key it
 * accepts (kayfabb_jobs, in apikey), the environment, the model adapters (supabase/functions/_shared/models/) and an answer of counts only.
 * No secret is ever logged or returned.
 *
 * The database client repeats a read, and a finish or a claim (a second finish writes nothing, and a lost claim only waits out its lease);
 * the ledger's own write is sent once, since a repeat would be a second row for one call.
 */
import { runWrites } from './core.ts';
import { chooseInstance } from '../_shared/instance.ts';
import { postgrest } from '../_shared/rpc.ts';
import { environment, fromTheService, json, notTheService } from '../_shared/serve.ts';
import { models } from '../_shared/models/index.ts';
import { ledgerWriter } from '../_shared/models/ledger.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';

/** Jobs claimed in a round. */
const MOST = 16;

Deno.serve(async (request) => {
  const env = environment((name) => Deno.env.get(name));
  if (!fromTheService(request, env.jobs)) return notTheService(env.jobs, 'card texts are written by the service');
  try {
    const db = postgrest({ url: env.url, key: env.secret, safeToRepeat: (fn) => fn !== 'record_model_call' });
    const tuned = await withDatabaseSettings(chooseInstance(Deno.env.get('KAYFABB_PROFILE')), db);
    const counts = await runWrites(db, models((name) => Deno.env.get(name), ledgerWriter(db), { tiers: tuned.settings.modelTiers }), tuned, tuned.settings, MOST);
    return json(200, counts);
  } catch (e) {
    console.error('write failed', e instanceof Error ? e.message : 'unknown');
    return json(500, { error: 'the writing failed; claimed jobs are taken again when their claim runs out' });
  }
});
