/**
 * The card-text writer's Edge Function: pg_cron calls it every minute as the sweep for what the act function's kick missed
 * (supabase/migrations/0149_card_writes.sql, schedule_card_writes). The work is core.ts and the wiring is handler.ts; this file reads
 * only `Deno.env` and hands it over, so the same handler runs in the rehearsal. No secret is ever logged or returned.
 */
import { handle } from './handler.ts';
import { deployedDeps } from '../_shared/handler.ts';

Deno.serve((request) => handle(request, deployedDeps((name) => Deno.env.get(name))));
