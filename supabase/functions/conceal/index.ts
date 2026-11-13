/**
 * The concealer's Edge Function: pg_cron calls it every minute (the job `kayfabb-conceal`) with the jobs key (the secret key named kayfabb_jobs, in apikey). The work is core.ts;
 * this is the edge: the environment, the service's database, and an answer that says what happened. The database side is `conceal_due(most)` and `record_layer(act, hidden, body)`.
 */
import { runConceal } from './core.ts';
import type { ConcealDb, ConcealRow } from './core.ts';
import { environment, fromTheService, json, notTheService, serviceDb } from '../_shared/serve.ts';

/** The most Acts one run answers; the rest wait a minute. */
const MOST = 200;

Deno.serve(async (request) => {
  const env = environment((name) => Deno.env.get(name));
  if (!fromTheService(request, env.jobs)) return notTheService(env.jobs, 'quotes are concealed by the service');
  try {
    const db = serviceDb(env);
    const concealDb: ConcealDb = {
      due: (most) => db.rpc<ConcealRow[]>('conceal_due', { most }),
      record: async (act, hidden, body) => { await db.rpc('record_layer', { act, hidden, body }); },
    };
    return json(200, await runConceal({ db: concealDb, most: MOST }));
  } catch (e) {
    // The details go to the function's log; the answer says only that it failed. The Acts stay due for the next run.
    console.error('conceal failed', e);
    return json(500, { error: 'the conceal run failed; the Acts stay due for the next run' });
  }
});
