/**
 * The concealer's handler (index.ts serves it): pg_cron calls the Edge Function every minute (the job `kayfabb-conceal`) with the jobs key (the secret key named kayfabb_jobs, in apikey). The work is core.ts;
 * this is the edge: the environment, the service's database, and an answer that says what happened. The database side is `conceal_due(most)` and `record_layer(act, hidden, body)`.
 * It reads nothing of Deno's: what it needs comes in as `deps` (_shared/handler.ts), so the same handler runs in the rehearsal.
 */
import { runConceal } from './core.ts';
import type { ConcealDb, ConcealRow } from './core.ts';
import { environment, fromTheService, json, notTheService } from '../_shared/serve.ts';
import { asJob } from '../_shared/job.ts';
import type { JobDeps } from '../_shared/handler.ts';

/** The most Acts one run answers; the rest wait a minute. */
const MOST = 200;

export const handle = asJob('kayfabb-conceal', async (request: Request, deps: JobDeps): Promise<Response> => {
  const env = environment(deps.env);
  if (!fromTheService(request, env.jobs)) return notTheService(env.jobs, 'quotes are concealed by the service');
  try {
    const db = deps.db(env);
    const concealDb: ConcealDb = {
      due: (most) => db.rpc<ConcealRow[]>('conceal_due', { most }),
      record: async (act, hidden, body) => { await db.rpc('record_layer', { act, hidden, body }); },
    };
    return json(200, await runConceal({ db: concealDb, most: MOST }));
  } catch (e) {
    // The details go to the function's log; the answer says only that it failed. The Acts stay due for the next run.
    console.error('conceal failed', e instanceof Error ? e.message : 'unknown');
    return json(500, { error: 'the conceal run failed; the Acts stay due for the next run' });
  }
});
