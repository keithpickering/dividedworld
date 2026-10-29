import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supabaseStorage } from './storage.ts';

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
