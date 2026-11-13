/**
 * Writes the deployed instance's vocabulary and numbers into the database (seed_instance(),
 * supabase/migrations/0004_schedule.sql). Called by hand with the kayfabb_jobs secret key, in apikey, after a deploy
 * that changes them, and at an instance's first start; safe to call again. The release calls it nightly
 * (docs/plans/2026-11-12-release-backend-design.md §3): 200 with the counts, 422 when the seed is refused or leaves the instance
 * not whole (runSeed, ./core.ts), 500 only when the platform failed.
 */
import { chooseInstance } from '../_shared/instance.ts';
import { runSeed } from './core.ts';
import { environment, fromTheService, json, notTheService, serviceDb } from '../_shared/serve.ts';

Deno.serve(async (request) => {
  const env = environment((name) => Deno.env.get(name));
  if (!fromTheService(request, env.jobs)) return notTheService(env.jobs, 'the instance is seeded by the service');
  try {
    const instance = chooseInstance(Deno.env.get('KAYFABB_PROFILE'));
    const answer = await runSeed(serviceDb(env), instance);
    return json(answer.status, answer.body);
  } catch (e) {
    console.error('seed failed', e);
    return json(500, { error: 'seeding failed; see the function log' });
  }
});
