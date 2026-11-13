/**
 * The meeting's handler: pg_cron calls the Edge Function (index.ts) at the instance's meetingCron with the minute it fired
 * (supabase/migrations/0047_meeting.sql). The work is core.ts; this is the edge: the jobs key it accepts
 * (kayfabb_jobs, in apikey), the environment, the model
 * adapters (supabase/functions/_shared/models/) and an answer that says what happened. No secret is ever logged or returned:
 * the model key is read by the adapter from the environment accessor it is given and appears in no message. It reads nothing of
 * Deno's: what it needs comes in as `deps` (_shared/handler.ts), so the rehearsal runs it in Node.
 */
import { runMeeting } from './core.ts';
import { chooseInstance } from '../_shared/instance.ts';
import { environment, fromTheService, json, notTheService } from '../_shared/serve.ts';
import { ledgerWriter } from '../_shared/models/ledger.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';
import { tokenCounter } from '../../../engine/system/tokens.ts';
import type { JobDeps } from '../_shared/handler.ts';

export async function handle(request: Request, deps: JobDeps): Promise<Response> {
  const env = environment(deps.env);
  if (!fromTheService(request, env.jobs)) return notTheService(env.jobs, 'the meeting is run by the service');
  const body = (await request.json().catch(() => ({}))) as { slot?: unknown };
  // The schedule sends the minute it fired; a call without one is refused rather than guessed.
  if (typeof body.slot !== 'string' || Number.isNaN(Date.parse(body.slot))) return json(400, { error: 'slot: the scheduled minute, as a time' });
  const slot = body.slot;
  try {
    const db = deps.db(env);
    const instance = chooseInstance(deps.env('KAYFABB_PROFILE'));
    // The tiers are the instance's `modelTiers` setting as the database holds it now; the model adapter names no model of its own.
    const { settings } = await withDatabaseSettings(instance, db);
    const outcome = await runMeeting(db, deps.models(deps.env, ledgerWriter(db), { tiers: settings.modelTiers, oldVoice: { window: settings.oldVoiceWindow, count: tokenCounter(settings.oldVoiceTokenizer) }, fetch: deps.fetch }), instance, slot, Date.now, deps.fetch);
    if (outcome.status === 'failed' || outcome.status === 'rejected') console.warn('meeting closed without effect', slot, outcome.status, outcome.error);
    return json(200, outcome);
  } catch (e) {
    // The details go to the function's log; the answer says only that it failed, and for which slot. runMeeting has closed the
    // row `failed` with the error (best effort) before it rethrew; only if that close failed too is the row left open, for the
    // next run of the slot to resume or the next slot to close failed.
    console.error('meet failed', slot, e instanceof Error ? e.message : 'unknown');
    return json(500, { error: 'the meeting failed and was closed as failed', slot });
  }
}
