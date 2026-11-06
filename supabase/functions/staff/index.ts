/**
 * The Mod Bots' Edge Function, with two doors. The filing run: pg_cron calls it at the instance's `modBots.filingCron` with the minute it fired
 * (supabase/migrations/0104_mod_moves.sql), and it accepts only the jobs key (kayfabb_jobs, in apikey). A player's report: the client calls it with the player's own
 * session (Authorization), as it calls the act function; nothing is done as the service before the database has taken the report AS THE PLAYER (`open_report` verifies the
 * session, that the caller plays the character, and that it is not banned), and a request with no session is answered 401 the same whoever its target is. The work is
 * core.ts (the run) and report.ts (the report); this is the edge: the environment, the model adapters
 * (supabase/functions/_shared/models/) and an answer that says what happened. No secret is ever logged or returned: the model key is read by the adapter from `Deno.env`
 * and appears in no message.
 *
 * The database client does not repeat a write after a failure that may have followed its commit (`safeToRepeat`). Of this run's writes the ledger's row and the call's
 * record are not idempotent (`record_staff_call` numbers each call it is sent): `file_visit` finds a visit already ended and `apply_mod_move` finds the move of its cause, so a repeat of either writes nothing a second time and is sent again.
 */
import { runFilings } from './core.ts';
import { runReport } from './report.ts';
import { chooseInstance } from '../_shared/instance.ts';
import { postgrest } from '../_shared/rpc.ts';
import { CORS, boundedJson, environment, fromTheService, json, notTheService } from '../_shared/serve.ts';
import { models } from '../_shared/models/index.ts';
import { ledgerWriter } from '../_shared/models/ledger.ts';
import { withDatabaseSettings } from '../_shared/settings.ts';

/** The calls that write and are not idempotent: not sent again after an answer that may have been lost on the way back. */
const WRITES = new Set(['record_model_call', 'record_staff_call']);

/** A report is a reason of 280 characters, ids and a little more. */
const MOST_REPORT_BYTES = 8 * 1024;

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const env = environment((name) => Deno.env.get(name));
  if (!fromTheService(request, env.jobs)) {
    // Not the service: a player's report, with the player's session. The gate is open_report itself, called as the player (report.ts).
    if (request.method !== 'POST') return reply(405, { error: 'reports are posted' });
    const session = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!session) return reply(401, { error: 'sign in to report' });
    const { tooLong, body: asked } = await boundedJson(request, MOST_REPORT_BYTES);
    if (tooLong) return reply(413, { error: 'that report is too long' });
    try {
      const instance = chooseInstance(Deno.env.get('KAYFABB_PROFILE'));
      // The player's calls are sent once (a report is paid for: a lost answer is told, not repeated); the service's, as the run's are.
      const player = postgrest({ url: env.url, key: env.publishable, bearer: session, safeToRepeat: () => false });
      const service = postgrest({ url: env.url, key: env.secret, safeToRepeat: (fn) => !WRITES.has(fn) });
      const tiers = (await withDatabaseSettings(instance, service)).settings.modelTiers;
      const out = await runReport({ player, service }, models((name) => Deno.env.get(name), ledgerWriter(service), { tiers }), instance, asked);
      return reply(out.status, out.body);
    } catch (e) {
      console.error('report failed', e instanceof Error ? e.message : 'unknown');
      return reply(500, { error: 'the report could not be made; try again' });
    }
  }
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
