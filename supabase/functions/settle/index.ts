/**
 * The settlement job's Edge Function: pg_cron calls it at the instance's settlement time with
 * the minute it fired (supabase/migrations/0004_schedule.sql). The work is core.ts; this is the
 * edge: the service key, the environment, and an answer that says what happened.
 */
import { runSettlement } from './core.ts';
import { chooseInstance } from '../_shared/instance.ts';
import { environment, fromTheService, json, serviceDb } from '../_shared/serve.ts';

Deno.serve(async (request) => {
  const env = environment((name) => Deno.env.get(name));
  if (!fromTheService(request, env.key)) return json(401, { error: 'the settlement is run by the service' });
  const body = (await request.json().catch(() => ({}))) as { until?: unknown };
  // The schedule sends the window's end; a call without one is refused rather than guessed.
  if (typeof body.until !== 'string' || Number.isNaN(Date.parse(body.until))) return json(400, { error: 'until: the window\'s end, as a time' });
  const until = body.until;
  try {
    return json(200, await runSettlement(serviceDb(env), chooseInstance(Deno.env.get('KAYFABB_PROFILE')), until));
  } catch (e) {
    // The details go to the function's log; the answer says only that it failed, and for which window.
    console.error('settle failed', until, e);
    return json(500, { error: 'the settlement failed; the window stays unsettled for the next run', until });
  }
});
