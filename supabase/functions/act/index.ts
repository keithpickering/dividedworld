/**
 * A player's actions, one entry point: post, start a thread, edit, spin a thread from an Act,
 * react, buy a card, play one, save an effect's state (and, with its task, the Turn). The work
 * is core.ts; this is the edge: the session, which the database reads through auth.uid(), so
 * the call is made as the player; the service key, for a card's writes and the live updates
 * that follow each write; a bound on the body; and the headers a browser's preflight asks for.
 */
import { runAction } from './core.ts';
import { chooseInstance } from '../_shared/instance.ts';
import { postgrest } from '../_shared/rpc.ts';
import { CORS, boundedJson, environment } from '../_shared/serve.ts';
import { broadcaster } from '../_shared/broadcast.ts';

/** A post at its longest is 20,000 characters of up to four bytes; a Whoops! save is bounded at 256 KB. */
const MOST_BYTES = 512 * 1024;

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return answer(405, { error: 'actions are posted' });
  const env = environment((name) => Deno.env.get(name));
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!anon) throw new Error('SUPABASE_ANON_KEY must be set');
  const session = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!session) return answer(401, { error: 'sign in to act' });
  const { tooLong, body } = await boundedJson(request, MOST_BYTES);
  if (tooLong) return answer(413, { error: 'that request is too long' });
  const dbs = { player: postgrest({ url: env.url, key: anon, bearer: session }), service: postgrest({ url: env.url, key: env.key }) };
  const out = await runAction(dbs, chooseInstance(Deno.env.get('KAYFABB_PROFILE')), body);
  // After the write committed: a reader who misses this sees the change on their next load.
  if (out.broadcasts?.length) await broadcaster({ url: env.url, key: env.key }).send(out.broadcasts);
  return answer(out.status, out.body);
});
