import { test } from 'node:test';
import assert from 'node:assert/strict';
import { broadcaster } from './broadcast.ts';

test('broadcasts go to Realtime\'s broadcast endpoint, private, with the service key', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{}', { status: 202 }); }) as unknown as typeof globalThis.fetch;
  await broadcaster({ url: 'https://p.example', key: 'k', fetch }).send([{ topic: 'thread:t', event: 'act', payload: { id: 'a' } }]);
  assert.equal(calls[0]?.url, 'https://p.example/realtime/v1/api/broadcast');
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { messages: [{ topic: 'thread:t', event: 'act', payload: { id: 'a' }, private: true }] });
  assert.equal(new Headers(calls[0]?.init.headers).get('Authorization'), 'Bearer k');
});

test('nothing to broadcast sends nothing; a failed broadcast is retried once and then given up, never thrown', async () => {
  let n = 0;
  const failing = (async () => { n++; return new Response('no', { status: 503 }); }) as unknown as typeof globalThis.fetch;
  const b = broadcaster({ url: 'https://p.example', key: 'k', fetch: failing, sleep: async () => {} });
  await b.send([]);
  assert.equal(n, 0);
  assert.equal(await b.send([{ topic: 'thread:t', event: 'act', payload: {} }]), false);
  assert.equal(n, 2);
});

test('a fetch that throws is retried and never thrown; a transport failure then a success is a success', async () => {
  let n = 0;
  const throwing = (async () => { n++; throw new TypeError('connection reset'); }) as unknown as typeof globalThis.fetch;
  assert.equal(await broadcaster({ url: 'https://p.example', key: 'k', fetch: throwing, sleep: async () => {} }).send([{ topic: 'thread:t', event: 'act', payload: {} }]), false);
  assert.equal(n, 2);
  const waits: number[] = [];
  let m = 0;
  const flaky = (async () => (++m === 1 ? new Response('busy', { status: 429 }) : new Response('{}', { status: 202 }))) as unknown as typeof globalThis.fetch;
  assert.equal(await broadcaster({ url: 'https://p.example', key: 'k', fetch: flaky, sleep: async (ms) => { waits.push(ms); } }).send([{ topic: 'thread:t', event: 'act', payload: {} }]), true);
  assert.deepEqual(waits, [250]);
});

test('a refusal that will not change (a 401, a 413) is not retried', async () => {
  for (const status of [401, 413]) {
    let n = 0;
    const refusing = (async () => { n++; return new Response('no', { status }); }) as unknown as typeof globalThis.fetch;
    assert.equal(await broadcaster({ url: 'https://p.example', key: 'k', fetch: refusing, sleep: async () => {} }).send([{ topic: 'thread:t', event: 'act', payload: {} }]), false);
    assert.equal(n, 1, String(status));
  }
});

test('a delivery says how it ended: sent, refused (a refusal that will not change), or unreachable (a transport failure, twice)', async () => {
  const one = [{ topic: 'thread:t', event: 'act', payload: {} }];
  const answering = (status: number) => (async () => new Response('', { status })) as unknown as typeof globalThis.fetch;
  const opts = { url: 'https://p.example', key: 'k', sleep: async () => {} };
  assert.equal(await broadcaster({ ...opts, fetch: answering(202) }).deliver(one), 'sent');
  assert.equal(await broadcaster({ ...opts, fetch: answering(413) }).deliver(one), 'refused');
  assert.equal(await broadcaster({ ...opts, fetch: answering(401) }).deliver(one), 'refused');
  assert.equal(await broadcaster({ ...opts, fetch: answering(503) }).deliver(one), 'unreachable');
  assert.equal(await broadcaster({ ...opts, fetch: answering(429) }).deliver(one), 'unreachable');
  const throwing = (async () => { throw new TypeError('reset'); }) as unknown as typeof globalThis.fetch;
  assert.equal(await broadcaster({ ...opts, fetch: throwing }).deliver(one), 'unreachable');
  assert.equal(await broadcaster({ ...opts, fetch: answering(202) }).deliver([]), 'sent');
});
