import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedJson, environment, fromTheService, sameSecret } from './serve.ts';

test('only a request bearing the service key is from the service', () => {
  const req = (auth?: string) => new Request('https://f.example/settle', { method: 'POST', headers: auth ? { Authorization: auth } : {} });
  assert.equal(fromTheService(req('Bearer the-key'), 'the-key'), true);
  for (const auth of [undefined, 'Bearer the-ke', 'Bearer the-keyy', 'the-key', 'Bearer ', 'Bearer THE-KEY']) {
    assert.equal(fromTheService(req(auth), 'the-key'), false, String(auth));
  }
});

test('sameSecret compares whole strings, of any lengths', () => {
  assert.equal(sameSecret('', ''), true);
  assert.equal(sameSecret('a', ''), false);
  assert.equal(sameSecret('', 'a'), false);
  assert.equal(sameSecret('abc', 'abd'), false);
  assert.equal(sameSecret('abc', 'abc'), true);
});

test('a function with its environment missing says what is missing', () => {
  assert.throws(() => environment(() => undefined), /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
  assert.deepEqual(environment((n) => ({ SUPABASE_URL: 'u', SUPABASE_SERVICE_ROLE_KEY: 'k' })[n]), { url: 'u', key: 'k' });
});

test('a body is read as JSON up to a bound, and past it not at all', async () => {
  const post = (body: string, headers: Record<string, string> = {}) => new Request('https://f.example/act', { method: 'POST', body, headers });
  assert.deepEqual(await boundedJson(post('{"a":1}'), 100), { tooLong: false, body: { a: 1 } });
  assert.deepEqual(await boundedJson(post('not json'), 100), { tooLong: false, body: null });
  assert.equal((await boundedJson(post('x'.repeat(101)), 100)).tooLong, true);
  assert.equal((await boundedJson(post('{}', { 'Content-Length': '1000000' }), 100)).tooLong, true, 'refused on its declared length before it is read');
  assert.equal((await boundedJson(post(JSON.stringify('🔥'.repeat(30))), 100)).tooLong, true, 'counted in bytes');
});
