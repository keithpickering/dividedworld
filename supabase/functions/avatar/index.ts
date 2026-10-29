/**
 * A character's avatar, one entry point: the work is core.ts; this is the edge: the session, which
 * whoami() reads as the player; the service key, for the bucket and the write; a bound on the body
 * before it is read; and the multipart form the browser sends (character, frames as JSON, and the
 * files source, square and portrait, source left out for a recrop and portrait for a square alone).
 */
import { LIMITS, runAvatar } from './core.ts';
import { postgrest } from '../_shared/rpc.ts';
import { supabaseStorage } from '../_shared/storage.ts';
import { CORS, environment } from '../_shared/serve.ts';

/** The three files at their largest, and the form around them. */
const MOST_BYTES = LIMITS.source.bytes + LIMITS.square.bytes + LIMITS.portrait.bytes + 16 * 1024;

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

const file = async (form: FormData, name: string): Promise<Uint8Array | null> => {
  const f = form.get(name);
  return f instanceof File ? new Uint8Array(await f.arrayBuffer()) : null;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return answer(405, { error: 'an avatar is sent with a POST' });
  const env = environment((name) => Deno.env.get(name));
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!anon) throw new Error('SUPABASE_ANON_KEY must be set');
  const session = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!session) return answer(401, { error: 'sign in to set an avatar' });
  const declared = Number(request.headers.get('Content-Length') ?? 'NaN');
  if (!(declared <= MOST_BYTES)) return answer(413, { error: 'that request is too long, or does not say how long it is' });
  let form: FormData;
  try { form = await request.formData(); } catch { return answer(400, { error: 'an avatar is sent as a form' }); }
  let frames: unknown = null;
  try { frames = JSON.parse(String(form.get('frames') ?? 'null')); } catch { /* refused below as missing */ }
  const out = await runAvatar(
    { player: postgrest({ url: env.url, key: anon, bearer: session }), service: postgrest({ url: env.url, key: env.key }) },
    supabaseStorage({ url: env.url, key: env.key, bucket: 'avatars' }),
    { character: String(form.get('character') ?? ''), frames: frames as never, source: await file(form, 'source'), square: (await file(form, 'square')) as Uint8Array, portrait: await file(form, 'portrait') },
  );
  return answer(out.status, out.body);
});
