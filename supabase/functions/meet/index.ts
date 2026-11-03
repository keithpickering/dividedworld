/**
 * The meeting's Edge Function: pg_cron calls it at the instance's meetingCron with the minute it fired
 * (supabase/migrations/0047_meeting.sql). The work is core.ts; this is the edge: the service key, the environment, the model
 * adapters (supabase/functions/_shared/models/) and an answer that says what happened. No secret is ever logged or returned:
 * the model key is read by the adapter from `Deno.env` and appears in no message.
 */
import { runMeeting } from './core.ts';
import { chooseInstance } from '../_shared/instance.ts';
import { environment, fromTheService, json, serviceDb } from '../_shared/serve.ts';
import { models } from '../_shared/models/index.ts';
import { ledgerWriter } from '../_shared/models/ledger.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';

Deno.serve(async (request) => {
  const env = environment((name) => Deno.env.get(name));
  if (!fromTheService(request, env.secret)) return json(401, { error: 'the meeting is run by the service' });
  const body = (await request.json().catch(() => ({}))) as { slot?: unknown };
  // The schedule sends the minute it fired; a call without one is refused rather than guessed.
  if (typeof body.slot !== 'string' || Number.isNaN(Date.parse(body.slot))) return json(400, { error: 'slot: the scheduled minute, as a time' });
  const slot = body.slot;
  try {
    const db = serviceDb(env);
    const instance = chooseInstance(Deno.env.get('KAYFABB_PROFILE'));
    // The tiers are the instance's `modelTiers` setting as the database holds it now; the model adapter names no model of its own.
    const tiers = (await withDatabaseSettings(instance, db)).settings.modelTiers;
    const outcome = await runMeeting(db, models((name) => Deno.env.get(name), ledgerWriter(db), { tiers }), instance, slot, Date.now, fetch);
    if (outcome.status === 'failed' || outcome.status === 'rejected') console.warn('meeting closed without effect', slot, outcome.status, outcome.error);
    return json(200, outcome);
  } catch (e) {
    // The details go to the function's log; the answer says only that it failed, and for which slot. runMeeting has closed the
    // row `failed` with the error (best effort) before it rethrew; only if that close failed too is the row left open, for the
    // next run of the slot to resume or the next slot to close failed.
    console.error('meet failed', slot, e instanceof Error ? e.message : 'unknown');
    return json(500, { error: 'the meeting failed and was closed as failed', slot });
  }
});
