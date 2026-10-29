/**
 * A player's live estimate, one entry point: the work is core.ts; this is the edge: the session,
 * which whoami() reads as the player, the service key that reads the window for them, and the
 * headers a browser's preflight asks for. The screens ask when the HUD opens and when a reaction
 * lands on one of the player's posts, never on a timer; asks within ESTIMATE_HOLD_SECONDS (core.ts)
 * are answered from the estimate kept, so a crowd of reactions is one read of the window.
 */
import { estimateDbs, runEstimate } from './core.ts';
import { chooseInstance } from '../_shared/instance.ts';
import { CORS, environment } from '../_shared/serve.ts';

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return answer(405, { error: 'the estimate is asked for with a POST' });
  const env = environment((name) => Deno.env.get(name));
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!anon) throw new Error('SUPABASE_ANON_KEY must be set');
  const session = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!session) return answer(401, { error: 'sign in to see your estimate' });
  const out = await runEstimate(estimateDbs({ url: env.url, key: env.key, anon, session }), chooseInstance(Deno.env.get('KAYFABB_PROFILE')));
  return answer(out.status, out.body);
});
