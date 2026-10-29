/**
 * Signing in, passwordless, one entry point: asking for a code and signing in with it. The work
 * is core.ts, which holds every answer to the same words and the same time whatever the
 * address; this is the edge: the public key Supabase Auth is called with, the service key that
 * asks whether an invite opens anything, a player's session for opening their account, the
 * clock, and the work handed on to run after the answer.
 *
 * This guards the client that uses it. Supabase Auth's own endpoints stay reachable with the
 * public key: no login holds a password (supabase/migrations/0012_passwordless.sql), so its
 * password sign-in fails alike for every address; whether its own code request takes the same
 * time for an address it knows is Auth's, measured once on the owner's test project (issue #3).
 */
import { runAccount } from './core.ts';
import { gotrue } from '../_shared/gotrue.ts';
import { postgrest } from '../_shared/rpc.ts';
import { CORS, boundedJson, environment } from '../_shared/serve.ts';

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

const clock = { now: () => performance.now(), sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) };

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return answer(405, { error: 'these are posted' });
  const env = environment((name) => Deno.env.get(name));
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!anon) throw new Error('SUPABASE_ANON_KEY must be set');
  const { tooLong, body } = await boundedJson(request, 4 * 1024);
  if (tooLong) return answer(413, { error: 'that request is too long' });
  const out = await runAccount({
    auth: gotrue({ url: env.url, key: anon }),
    service: postgrest({ url: env.url, key: env.key }),
    player: (token) => postgrest({ url: env.url, key: anon, bearer: token }),
    clock,
  }, body);
  if (out.later) {
    const work = out.later().catch((e) => console.error('account work after the answer threw', e));
    // Never awaited: the answer must not wait on what Auth does with the address.
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime) EdgeRuntime.waitUntil(work);
    else console.error('no EdgeRuntime: the work after this answer may not finish');
  }
  return answer(out.status, out.body);
});
