/**
 * The settlement job's Edge Function: pg_cron calls it at the instance's settlement time with
 * the minute it fired (supabase/migrations/0004_schedule.sql). The work is core.ts and the wiring is handler.ts; this file
 * reads only `Deno.env` and hands it over, so the same handler runs in the rehearsal.
 */
import { handle } from './handler.ts';
import { deployedDeps } from '../_shared/handler.ts';

Deno.serve((request) => handle(request, deployedDeps((name) => Deno.env.get(name))));
