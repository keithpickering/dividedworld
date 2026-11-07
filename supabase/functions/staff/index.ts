/**
 * The Mod Bots' Edge Function, with two doors. The filing run: pg_cron calls it at the instance's `modBots.filingCron` with the minute it fired
 * (supabase/migrations/0104_mod_moves.sql), and it accepts only the jobs key (kayfabb_jobs, in apikey). A player's report: the client calls it with the player's own
 * session (Authorization), as it calls the act function; nothing is done as the service before the database has taken the report AS THE PLAYER (`open_report` verifies the
 * session, that the caller plays the character, and that it is not banned), and a request with no session is answered 401 the same whoever its target is. A player's appeal is
 * the same door at `/staff/appeal` (`open_appeal`, which does not refuse a banned character: a ban is appealed by the banned). The work is
 * core.ts (the filing run), patrol.ts (the patrol run, on the same schedule: each patrol due is claimed once, judged, and its findings start visits), report.ts (the report) and appeal.ts (the appeal), through door.ts; this is the edge: the environment, the model adapters
 * (supabase/functions/_shared/models/) and an answer that says what happened. No secret is ever logged or returned: the model key is read by the adapter from `Deno.env`
 * and appears in no message.
 *
 * The database client does not repeat a write after a failure that may have followed its commit (`safeToRepeat`). Of this run's writes the ledger's row and the call's
 * record are not idempotent (`record_staff_call` and `record_patrol_call` number each call they are sent, and `claim_patrol` hands out the next patrol each time it is asked): `file_visit` finds a visit already ended and `apply_mod_move` finds the move of its cause, so a repeat of either writes nothing a second time and is sent again.
 */
import { runFilings } from './core.ts';
import { runPatrolsAfterFilings } from './patrol.ts';
import { appealDoor } from './appeal.ts';
import { reportDoor } from './report.ts';
import { chooseInstance } from '../_shared/instance.ts';
import { postgrest } from '../_shared/rpc.ts';
import { environment, fromTheService, json, notTheService } from '../_shared/serve.ts';
import { models } from '../_shared/models/index.ts';
import { ledgerWriter } from '../_shared/models/ledger.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';

/** The calls that write and are not idempotent: not sent again after an answer that may have been lost on the way back. */
const WRITES = new Set(['record_model_call', 'record_staff_call', 'record_patrol_call', 'claim_patrol']);

Deno.serve(async (request) => {
  const env = environment((name) => Deno.env.get(name));
  if (!fromTheService(request, env.jobs)) {
    // Not the service: a player's report or appeal, with the player's session, by the path (`/staff/appeal`; anything else is a report). Nothing is read as the service until
    // open_report or open_appeal, as the player, has taken it (report.ts, appeal.ts, both through door.ts).
    const door = new URL(request.url).pathname.replace(/\/+$/, '').endsWith('/appeal') ? appealDoor : reportDoor;
    return door(request, {
      instance: chooseInstance(Deno.env.get('KAYFABB_PROFILE')),
      // The player's calls are sent once (a report or an appeal is paid for: a lost answer is told, not repeated); the service's, as the run's are.
      dbs: (session) => ({
        player: postgrest({ url: env.url, key: env.publishable, bearer: session, safeToRepeat: () => false }),
        service: postgrest({ url: env.url, key: env.secret, safeToRepeat: (fn) => !WRITES.has(fn) }),
      }),
      models: async (service) => {
        const tiers = (await withDatabaseSettings(chooseInstance(Deno.env.get('KAYFABB_PROFILE')), service)).settings.modelTiers;
        return models((name) => Deno.env.get(name), ledgerWriter(service), { tiers });
      },
    });
  }
  const body = (await request.json().catch(() => ({}))) as { slot?: unknown };
  // The schedule sends the minute it fired; a call without one is refused rather than guessed.
  if (typeof body.slot !== 'string' || Number.isNaN(Date.parse(body.slot))) return json(400, { error: 'slot: the scheduled minute, as a time' });
  const slot = body.slot;
  // One clock for the whole invocation: the filings and the patrols share the run's time.
  const begun = Date.now();
  try {
    const db = postgrest({ url: env.url, key: env.secret, safeToRepeat: (fn) => !WRITES.has(fn) });
    const instance = chooseInstance(Deno.env.get('KAYFABB_PROFILE'));
    // The tiers are the instance's `modelTiers` setting as the database holds it now; the model adapter names no model of its own.
    const tiers = (await withDatabaseSettings(instance, db)).settings.modelTiers;
    const modelsNow = models((name) => Deno.env.get(name), ledgerWriter(db), { tiers });
    const outcome = await runFilings(db, modelsNow, instance, slot);
    // The patrols due, after the filings and on their own: a patrol's failure costs the filings nothing, and a filing run's failure is thrown before any patrol is claimed.
    const patrols = await runPatrolsAfterFilings(db, modelsNow, instance, Date.now, begun, slot);
    if (patrols.status === 'ok') {
      const odd = patrols.patrols.filter((p) => p.status !== 'judged' || p.trims.length > 0 || p.dropped.length > 0 || p.capped > 0);
      if (odd.length) console.warn('patrols with a skip, a failure, a trim, a drop or a cap', slot, JSON.stringify(odd.map((p) => ({ patrol: p.patrol, staff: p.staff, status: p.status, why: p.why, trims: p.trims, dropped: p.dropped, capped: p.capped }))));
    }
    if (outcome.status === 'ok') {
      const odd = outcome.filings.filter((f) => f.status === 'failed' || f.trims.length > 0 || f.dropped.length > 0 || f.why !== undefined);
      if (odd.length) console.warn('filings with a trim, a drop, a stock line or a failure', slot, JSON.stringify(odd.map((f) => ({ visit: f.visit, staff: f.staff, status: f.status, why: f.why, trims: f.trims, dropped: f.dropped }))));
    }
    return json(200, { ...outcome, patrols });
  } catch (e) {
    // The details go to the function's log; the answer says only that it failed, and for which slot.
    console.error('staff failed', slot, e instanceof Error ? e.message : 'unknown');
    return json(500, { error: 'the filing run failed', slot });
  }
});
