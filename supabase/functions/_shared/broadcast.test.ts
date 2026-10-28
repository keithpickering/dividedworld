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
