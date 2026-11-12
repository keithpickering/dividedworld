/**
 * A trophy's picture, one entry point: the work is core.ts; this is the edge: the caller's session, which is_admin() reads (the secret key is the Storage's alone and is
 * used only after core.ts has found the caller to be an admin); a bound on the body before it is read; and the multipart form the admin page sends (one file, `file`).
 *
 * The gate: with verify_jwt off (supabase/config.toml), any caller reaches this handler, so nothing is stored before is_admin(), asked with the caller's own session,
 * answers true; a session the database does not take is answered 401 and a player 403, in the same words whatever they sent. core.test.ts holds it.
 */
import { LIMITS, runTrophyArt } from './core.ts';
import { postgrest } from '../_shared/rpc.ts';
import { supabaseStorage } from '../_shared/storage.ts';
import { CORS, environment } from '../_shared/serve.ts';

/** The file at its largest, and the form around it. */
const MOST_BYTES = LIMITS.bytes + 4 * 1024;

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return answer(405, { error: 'trophy art is sent with a POST' });
  const env = environment((name) => Deno.env.get(name));
  const session = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!session) return answer(401, { error: 'sign in to make trophy art' });
  const declared = Number(request.headers.get('Content-Length') ?? 'NaN');
  if (!(declared <= MOST_BYTES)) return answer(413, { error: 'that request is too long, or does not say how long it is' });
  // The form is read only once core.ts has found the caller to be an admin, so a caller who is not is answered the same whatever they sent.
  const file = async (): Promise<unknown> => {
    let form: FormData;
    try { form = await request.formData(); } catch { return null; }
    const sent = form.get('file');
    return sent instanceof File ? new Uint8Array(await sent.arrayBuffer()) : null;
  };
  const out = await runTrophyArt(
    { player: postgrest({ url: env.url, key: env.publishable, bearer: session }) },
    supabaseStorage({ url: env.url, key: env.secret, bucket: 'trophies' }),
    { file },
  );
  return answer(out.status, out.body);
});
