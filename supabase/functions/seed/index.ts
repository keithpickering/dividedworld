/**
 * Writes the deployed instance's vocabulary and numbers into the database (seed_instance(),
 * supabase/migrations/0004_schedule.sql). Called by hand with the service key after a deploy
 * that changes them, and at an instance's first start; safe to call again.
 */
import { chooseInstance } from '../_shared/instance.ts';
import { instanceSeed } from '../_shared/seed.ts';
import { environment, fromTheService, json, serviceDb } from '../_shared/serve.ts';

Deno.serve(async (request) => {
  const env = environment((name) => Deno.env.get(name));
  if (!fromTheService(request, env.key)) return json(401, { error: 'the instance is seeded by the service' });
  try {
    const instance = chooseInstance(Deno.env.get('KAYFABB_PROFILE'));
    return json(200, await serviceDb(env).rpc('seed_instance', { payload: instanceSeed(instance) }));
  } catch (e) {
    console.error('seed failed', e);
    return json(500, { error: 'seeding failed; see the function log' });
  }
});
