/**
 * What a player does with gear, trophies and Random Events, one entry point: the work is core.ts; this is the edge: the session, which whoami() reads as the
 * player; the secret key, for the service-only SQL functions; and a bound on the JSON body before it is read.
 *
 * The gate: with verify_jwt off (supabase/config.toml), any caller reaches this handler. So nothing is done as the service before whoami(), read with the
 * caller's session, names an account; a session the database does not take is answered 401, the same words whoever the target is. core.test.ts holds it.
 */
import { runWardrobe, type WardrobeRequest } from './core.ts';
import { postgrest } from '../_shared/rpc.ts';
import { CORS, environment } from '../_shared/serve.ts';

const MOST_BYTES = 64 * 1024;

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return answer(405, { error: 'this is sent with a POST' });
  const env = environment((name) => Deno.env.get(name));
  const session = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!session) return answer(401, { error: 'sign in first' });
  const declared = Number(request.headers.get('Content-Length') ?? 'NaN');
  if (!(declared <= MOST_BYTES)) return answer(413, { error: 'that request is too long, or does not say how long it is' });
  let body: unknown = null;
  try { body = await request.json(); } catch { /* refused below as no action */ }
  const out = await runWardrobe(
    // None of the three is sent twice on a guess: a roll that committed would answer that nothing was found.
    { player: postgrest({ url: env.url, key: env.publishable, bearer: session }), service: postgrest({ url: env.url, key: env.secret, safeToRepeat: () => false }) },
    (typeof body === 'object' && body !== null ? body : {}) as WardrobeRequest,
  );
  return answer(out.status, out.body);
});
