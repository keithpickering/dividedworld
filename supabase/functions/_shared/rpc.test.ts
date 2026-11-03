import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseError, TransportError, postgrest, sessionRefused } from './rpc.ts';

type Call = { url: string; init: RequestInit };
/** A fetch that answers from a script, one answer per call, and records the calls. */
function scripted(...answers: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = answers.shift();
    if (!next) throw new Error('the script ran out');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const noWait = async () => {};

test('a call posts the arguments to the function\'s RPC endpoint with the key in apikey alone, and returns its answer', async () => {
  const { fetch, calls } = scripted(json(200, { applied: true }));
  const db = postgrest({ url: 'https://p.example', key: 'k', fetch, sleep: noWait });
  assert.deepEqual(await db.rpc('apply_settlement', { a: 1 }), { applied: true });
  assert.equal(calls[0]?.url, 'https://p.example/rest/v1/rpc/apply_settlement');
  const headers = new Headers(calls[0]?.init.headers);
  assert.equal(headers.get('Authorization'), null, 'a service connection sends no Authorization');
  assert.equal(headers.get('apikey'), 'k');
  assert.equal(calls[0]?.init.body, '{"a":1}');
});

test('a transport failure is retried on the request: a fetch that never answered, a 502, a 503, a 504', async () => {
  const { fetch, calls } = scripted(new TypeError('fetch failed'), json(502, {}), json(503, {}), json(504, {}), json(200, 7));
  const db = postgrest({ url: 'https://p.example', key: 'k', fetch, sleep: noWait, attempts: 5 });
  assert.equal(await db.rpc('f', {}), 7);
  assert.equal(calls.length, 5);
});

test('a write that is not safe to repeat is retried only where it cannot have run: a 503, never after a fetch that may have been sent, a 502 or a 504', async () => {
  const writes = (fn: string) => fn !== 'buy_card';
  for (const ambiguous of [new TypeError('connection reset'), json(502, {}), json(504, {})]) {
    const { fetch, calls } = scripted(ambiguous, json(200, 'bought twice'));
    const db = postgrest({ url: 'https://p.example', key: 'k', fetch, sleep: noWait, safeToRepeat: writes });
    await assert.rejects(db.rpc('buy_card', {}), (e: unknown) => e instanceof TransportError);
    assert.equal(calls.length, 1, String(ambiguous));
  }
  const { fetch, calls } = scripted(json(503, {}), json(503, {}), json(200, 'bought once'));
  const db = postgrest({ url: 'https://p.example', key: 'k', fetch, sleep: noWait, safeToRepeat: writes });
  assert.equal(await db.rpc('buy_card', {}), 'bought once');
  assert.equal(calls.length, 3);
  // A function safe to repeat is retried on all of them, as before.
  const reads = scripted(new TypeError('connection reset'), json(504, {}), json(200, 'read'));
  assert.equal(await postgrest({ url: 'https://p.example', key: 'k', fetch: reads.fetch, sleep: noWait, safeToRepeat: writes }).rpc('whoami', {}), 'read');
});

test('a transport failure that outlasts the attempts is thrown as one, with what happened each time', async () => {
  const { fetch, calls } = scripted(json(503, {}), json(503, {}), json(503, {}));
  const db = postgrest({ url: 'https://p.example', key: 'k', fetch, sleep: noWait, attempts: 3 });
  await assert.rejects(db.rpc('f', {}), (e: unknown) => e instanceof TransportError && /503.*503.*503/s.test(e.message));
  assert.equal(calls.length, 3);
});

test('a database error is a fact about the request: thrown at once, never retried', async () => {
  for (const status of [400, 401, 403, 404, 409, 500]) {
    const { fetch, calls } = scripted(json(status, { code: '22023', message: 'a window ends after it starts' }), json(200, 1));
    const db = postgrest({ url: 'https://p.example', key: 'k', fetch, sleep: noWait });
    await assert.rejects(db.rpc('f', {}), (e: unknown) => e instanceof DatabaseError && e.code === '22023' && /ends after it starts/.test(e.message), String(status));
    assert.equal(calls.length, 1, `${status} was retried`);
  }
});

test('retries wait longer each time', async () => {
  const waits: number[] = [];
  const { fetch } = scripted(json(503, {}), json(503, {}), json(200, 1));
  const db = postgrest({ url: 'https://p.example', key: 'k', fetch, sleep: async (ms) => { waits.push(ms); }, attempts: 3 });
  await db.rpc('f', {});
  assert.equal(waits.length, 2);
  assert.ok(waits[1]! > waits[0]!);
});

test('an error that is not PostgREST\'s JSON is still a database error, with its status', async () => {
  const { fetch, calls } = scripted(new Response('<html>Internal error</html>', { status: 500 }));
  const db = postgrest({ url: 'https://p.example', key: 'k', fetch, sleep: noWait });
  await assert.rejects(db.rpc('f', {}), (e: unknown) => e instanceof DatabaseError && e.status === 500 && /HTTP 500/.test(e.message));
  assert.equal(calls.length, 1);
});

test('a player\'s call carries their own session as its bearer, beside the project\'s key', async () => {
  const { fetch, calls } = scripted(json(200, 1));
  await postgrest({ url: 'https://p.example', key: 'sb_publishable_p', bearer: 'player-jwt', fetch, sleep: noWait }).rpc('post', {});
  const headers = new Headers(calls[0]?.init.headers);
  assert.equal(headers.get('apikey'), 'sb_publishable_p');
  assert.equal(headers.get('Authorization'), 'Bearer player-jwt');
});

test('an empty session is no session: no Authorization is sent', async () => {
  const { fetch, calls } = scripted(json(200, 1));
  await postgrest({ url: 'https://p.example', key: 'sb_publishable_p', bearer: '', fetch, sleep: noWait }).rpc('instance_settings', {});
  assert.equal(new Headers(calls[0]?.init.headers).get('Authorization'), null);
});

test('a database error keeps the function\'s own words apart from PostgREST\'s detail', async () => {
  const { fetch } = scripted(json(409, { code: '23505', message: 'duplicate key', details: 'Key (owner)=(secret) already exists.' }));
  const db = postgrest({ url: 'https://p.example', key: 'k', fetch, sleep: noWait });
  await assert.rejects(db.rpc('f', {}), (e: unknown) => e instanceof DatabaseError && e.reason === 'duplicate key' && !e.reason.includes('secret'));
});

test('a refused session is a 401 with no hint, and only that; it is logged by its code alone', () => {
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (...line: unknown[]) => { warned.push(line.join(' ')); };
  try {
    assert.equal(sessionRefused(new DatabaseError('whoami: JWT expired', 'PGRST301', 401)), true, 'a bearer PostgREST cannot verify');
    assert.equal(sessionRefused(new DatabaseError('whoami: permission denied for function whoami', '42501', 401)), true, 'the anon role, which may not call');
    assert.equal(sessionRefused(new DatabaseError('f: HTTP 401 {"message":"Invalid API key sb_publishable_x"}', '', 401)), true, 'the gateway');
    assert.equal(sessionRefused(new DatabaseError('post: sign in first', 'P0001', 401, 'sign in first', 'kayfabb.refusal')), false, 'a refusal a SQL function raised');
    assert.equal(sessionRefused(new DatabaseError('post: permission denied', '42501', 403)), false, 'a signed-in player refused');
    assert.equal(sessionRefused(new TransportError('fetch failed')), false);
    assert.equal(sessionRefused(new Error('401')), false);
    assert.deepEqual(warned, ['the session was refused: PGRST301', 'the session was refused: 42501', 'the session was refused: no code, so the gateway refused the request']);
    assert.ok(!warned.join().includes('sb_publishable_x'), 'nothing the gateway sent back is logged');
  } finally { console.warn = warn; }
});
