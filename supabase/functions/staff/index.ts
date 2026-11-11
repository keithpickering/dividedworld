/**
 * The Mod Bots' Edge Function, with two doors: the filing run (pg_cron, the jobs key) and a player's report or appeal (the player's own
 * session). The work is core.ts, patrol.ts, apology.ts, report.ts and appeal.ts, and the wiring of both doors is handler.ts; this file
 * reads only `Deno.env` and hands it over, so the same handler runs in the rehearsal. No secret is ever logged or returned.
 */
import { handle } from './handler.ts';
import { deployedDeps } from '../_shared/handler.ts';

Deno.serve((request) => handle(request, deployedDeps((name) => Deno.env.get(name))));
