import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supabaseStorage } from './storage.ts';
import { TransportError } from './rpc.ts';

const recording = (status = 200) => {
  const sent: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body });
    return new Response('{}', { status });
  }) as unknown as typeof globalThis.fetch;
  return { sent, storage: supabaseStorage({ url: 'https://project.test', key: 'service-key', bucket: 'avatars', fetch }) };
};

test('a file is stored by Storage\'s REST endpoint, under its name, never over another', async () => {
  const { sent, storage } = recording();
  const bytes = new Uint8Array([1, 2, 3]);
  await storage.put('a b/c.webp', bytes, 'image/webp');
  assert.equal(sent[0]!.url, 'https://project.test/storage/v1/object/avatars/a%20b%2Fc.webp');
  assert.equal(sent[0]!.method, 'POST');
  assert.deepEqual(sent[0]!.headers, { apikey: 'service-key', Authorization: 'Bearer service-key', 'Content-Type': 'image/webp', 'x-upsert': 'false' });
  assert.equal(sent[0]!.body, bytes);
});

test('files are removed in one request naming them; none to remove sends nothing', async () => {
  const { sent, storage } = recording();
  await storage.remove(['x.webp', 'y.webp']);
  assert.equal(sent[0]!.url, 'https://project.test/storage/v1/object/avatars');
  assert.equal(sent[0]!.method, 'DELETE');
  assert.deepEqual(JSON.parse(String(sent[0]!.body)), { prefixes: ['x.webp', 'y.webp'] });
  await storage.remove([]);
  assert.equal(sent.length, 1);
});

test('a refusal from Storage is thrown, never taken for a stored file', async () => {
  const { storage } = recording(409);
  await assert.rejects(storage.put('x.webp', new Uint8Array([1]), 'image/webp'), /HTTP 409/);
  await assert.rejects(storage.remove(['x.webp']), /HTTP 409/);
});

// A Storage that answers each request from a script, in order, and keeps what it was sent.
const scripted = (answers: (number | 'lost' | Uint8Array)[]) => {
  const sent: { url: string; method: string }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, method: String(init.method ?? 'GET') });
    const a = answers.shift();
    if (a === undefined) throw new Error('more requests than the script holds');
    if (a === 'lost') throw new TypeError('fetch failed');
    return a instanceof Uint8Array ? new Response(a, { status: 200 }) : new Response('{}', { status: a });
  }) as unknown as typeof globalThis.fetch;
  return { sent, storage: supabaseStorage({ url: 'https://project.test', key: 'service-key', bucket: 'avatars', fetch, pause: async () => {} }) };
};

test('a 5xx or no answer is asked again; a file stored on a later attempt is one stored file', async () => {
  const { sent, storage } = scripted([503, 'lost', 200]);
  await storage.put('x.webp', new Uint8Array([1]), 'image/webp');
  assert.deepEqual(sent.map((s) => s.method), ['POST', 'POST', 'POST']);
  const removal = scripted([429, 200]);
  await removal.storage.remove(['x.webp']);
  assert.equal(removal.sent.length, 2);
});

test('a name taken on a retry by the same bytes is the file the lost attempt stored; other bytes are refused', async () => {
  const same = scripted(['lost', 409, new Uint8Array([1, 2])]);
  await same.storage.put('x.webp', new Uint8Array([1, 2]), 'image/webp');
  assert.deepEqual(same.sent.map((s) => s.method), ['POST', 'POST', 'GET']);
  const other = scripted(['lost', 409, new Uint8Array([9])]);
  await assert.rejects(other.storage.put('x.webp', new Uint8Array([1, 2]), 'image/webp'), /already there, and is another file/);
});

test('no answer after every attempt is a transport failure, said with each attempt', async () => {
  const { storage } = scripted([503, 'lost', 502, 504]);
  await assert.rejects(storage.put('x.webp', new Uint8Array([1]), 'image/webp'), (e: unknown) => e instanceof TransportError && /4 attempt\(s\): HTTP 503; no answer.*HTTP 502; HTTP 504/.test((e as Error).message));
});
