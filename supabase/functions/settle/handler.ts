/**
 * The settlement job's handler (index.ts serves it): pg_cron calls the Edge Function at the instance's settlement time with
 * the minute it fired (supabase/migrations/0004_schedule.sql). The work is core.ts; this is the
 * edge: the jobs key it accepts (the secret key named kayfabb_jobs, in apikey), the environment,
 * and an answer that says what happened. It reads nothing of Deno's: what it needs comes in as `deps` (_shared/handler.ts).
 */
import { runSettlement } from './core.ts';
import { chooseInstance } from '../_shared/instance.ts';
import { environment, fromTheService, json, notTheService } from '../_shared/serve.ts';
import type { JobDeps } from '../_shared/handler.ts';

export async function handle(request: Request, deps: JobDeps): Promise<Response> {
  const env = environment(deps.env);
  if (!fromTheService(request, env.jobs)) return notTheService(env.jobs, 'the settlement is run by the service');
  const body = (await request.json().catch(() => ({}))) as { until?: unknown };
  // The schedule sends the window's end; a call without one is refused rather than guessed.
  if (typeof body.until !== 'string' || Number.isNaN(Date.parse(body.until))) return json(400, { error: 'until: the window\'s end, as a time' });
  const until = body.until;
  try {
    const outcome = await runSettlement(deps.db(env), chooseInstance(deps.env('KAYFABB_PROFILE')), until, { deliver: deps.broadcaster({ url: env.url, key: env.secret, fetch: deps.fetch }).deliver });
    // Windows still waiting are settled by the next firing; said in the log, so a schedule that
    // never catches up is seen.
    if (outcome.status !== 'nothing to settle' && outcome.behind) console.warn('settle behind: windows wait for the next run', until, outcome.window.end);
    return json(200, outcome);
  } catch (e) {
    // The details go to the function's log; the answer says only that it failed, and for which window.
    console.error('settle failed', until, e);
    return json(500, { error: 'the settlement failed; the window stays unsettled for the next run', until });
  }
}
