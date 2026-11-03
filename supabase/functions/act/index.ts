/**
 * A player's actions, one entry point: post, start a thread, edit, spin a thread from an Act,
 * react, buy a card, play one, save an effect's state (and, with its task, the Turn). The work
 * is core.ts; this is the edge: the session, which the database reads through auth.uid(), so
 * the call is made as the player; the secret key, for a card's writes and the live updates
 * that follow each write; a bound on the body; and the headers a browser's preflight asks for.
 *
 * The gate: with verify_jwt off (supabase/config.toml), any caller reaches this handler. So nothing is
 * done as the service before whoami(), read with the caller's session, names an account; a session the
 * database does not take is answered 401, the same words whoever the target is. core.test.ts holds it.
 * What comes before it is the caller's own request, read within its bound, and nothing else; and a request that
 * names no account schedules nothing after its answer (ActionAnswer.nobodyNamed, core.ts).
 */
import { actDbs, afterTheAnswer, coalesced, handleAction } from './core.ts';
import { chooseInstance } from '../_shared/instance.ts';
import { CORS, boundedJson, environment } from '../_shared/serve.ts';
import { broadcaster } from '../_shared/broadcast.ts';
import { sendWaiting } from '../_shared/outbox.ts';

/** A post at its longest is 20,000 characters of up to four bytes; a Whoops! save is bounded at 256 KB. */
const MOST_BYTES = 512 * 1024;

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

/** One drain at a time in this isolate (coalesced says why); the service connection it uses carries no player's session. */
let drainOutbox: (() => Promise<void>) | undefined;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return answer(405, { error: 'actions are posted' });
  const env = environment((name) => Deno.env.get(name));
  const session = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!session) return answer(401, { error: 'sign in to act' });
  const { tooLong, body } = await boundedJson(request, MOST_BYTES);
  if (tooLong) return answer(413, { error: 'that request is too long' });
  const dbs = actDbs({ url: env.url, key: env.secret, publishable: env.publishable, session });
  const live = broadcaster({ url: env.url, key: env.secret });
  // After the write committed, and after the answer where the runtime lets work outlive it: the write's live updates, then the
  // outbox (an alert is queued by the write itself), drained after every write whether or not it queued anything. A reader who
  // misses a send sees the change on their next load, a failed send is retried by the next drain, and neither a slow Realtime nor
  // what was queued ever holds up, or shows in, a player's answer (afterTheAnswer says why). Without EdgeRuntime, the local
  // runtime, nothing awaits the work either.
  const out = await handleAction({
    dbs, instance: chooseInstance(Deno.env.get('KAYFABB_PROFILE')), body,
    send: live.send,
    drain: (drainOutbox ??= coalesced(() => sendWaiting(dbs.service, live.deliver))),
    after: (work) => afterTheAnswer(work, { waitUntil: typeof EdgeRuntime !== 'undefined' && EdgeRuntime ? (p) => EdgeRuntime.waitUntil(p) : undefined }),
  });
  return answer(out.status, out.body);
});
