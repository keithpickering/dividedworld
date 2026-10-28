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
  const until = typeof body.until === 'string' ? body.until : new Date().toISOString();
  try {
    return json(200, await runSettlement(serviceDb(env), chooseInstance(Deno.env.get('KAYFABB_PROFILE')), until));
  } catch (e) {
    console.error('settle failed', until, e);
    return json(500, { error: e instanceof Error ? e.message : String(e), until });
  }
});
