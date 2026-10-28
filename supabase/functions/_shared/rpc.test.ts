import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseError, TransportError, postgrest } from './rpc.ts';

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

test('a call posts the arguments to the function\'s RPC endpoint with the key, and returns its answer', async () => {
  const { fetch, calls } = scripted(json(200, { applied: true }));
  const db = postgrest({ url: 'https://p.example', key: 'k', fetch, sleep: noWait });
  assert.deepEqual(await db.rpc('apply_settlement', { a: 1 }), { applied: true });
  assert.equal(calls[0]?.url, 'https://p.example/rest/v1/rpc/apply_settlement');
  const headers = new Headers(calls[0]?.init.headers);
  assert.equal(headers.get('Authorization'), 'Bearer k');
  assert.equal(headers.get('apikey'), 'k');
  assert.equal(calls[0]?.init.body, '{"a":1}');
});

test('a transport failure is retried on the request: a fetch that never answered, a 502, a 503, a 504', async () => {
  const { fetch, calls } = scripted(new TypeError('fetch failed'), json(502, {}), json(503, {}), json(504, {}), json(200, 7));
  const db = postgrest({ url: 'https://p.example', key: 'k', fetch, sleep: noWait, attempts: 5 });
  assert.equal(await db.rpc('f', {}), 7);
  assert.equal(calls.length, 5);
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
