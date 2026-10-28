/**
 * A player's actions, one entry point: post, start a thread, edit, spin a thread from an Act,
 * react, and (with their tasks) the cards and the Turn. The work is core.ts; this is the edge:
 * the session, which the database reads through auth.uid(), so the call is made as the player.
 */
import { runAction } from './core.ts';
import { chooseInstance } from '../_shared/instance.ts';
import { postgrest } from '../_shared/rpc.ts';
import { json } from '../_shared/serve.ts';

Deno.serve(async (request) => {
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anon) throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set');
  const session = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!session) return json(401, { error: 'sign in to act' });
  const body: unknown = await request.json().catch(() => null);
  const answer = await runAction(postgrest({ url, key: anon, bearer: session }), chooseInstance(Deno.env.get('KAYFABB_PROFILE')), body);
  return json(answer.status, answer.body);
});
