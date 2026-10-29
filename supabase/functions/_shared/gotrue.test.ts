import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gotrue } from './gotrue.ts';

const recorder = (respond: (url: string, body: unknown) => Response) => {
  const calls: { url: string; body: unknown; apikey: string | null }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body, apikey: new Headers(init.headers).get('apikey') });
    return respond(url, body);
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
};
const session = { access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: 'u' } };
const opts = { url: 'https://p.example', key: 'anon', sleep: async () => {} };

test('a code is asked for and checked at Supabase Auth\'s own endpoints, called with the public key, and no password goes anywhere', async () => {
  const { calls, fetch } = recorder((url) => new Response(JSON.stringify(url.includes('verify') ? session : {}), { status: 200 }));
  const auth = gotrue({ ...opts, fetch });
  await auth.requestCode('a@b.c', { create: true, invite: 'code' });
  await auth.requestCode('a@b.c', { create: false, invite: null });
  assert.deepEqual(await auth.verifyCode('a@b.c', '123456'), { session });
  assert.deepEqual(calls.map((c) => [c.url, c.body]), [
    ['https://p.example/auth/v1/otp', { email: 'a@b.c', create_user: true, data: { invite: 'code' } }],
    ['https://p.example/auth/v1/otp', { email: 'a@b.c', create_user: false, data: { invite: null } }],
    ['https://p.example/auth/v1/verify', { type: 'email', email: 'a@b.c', token: '123456' }],
  ]);
  assert.ok(calls.every((c) => c.apikey === 'anon'));
  assert.ok(!JSON.stringify(calls).includes('password'));
});

test('a refused code is a wrong or expired one; anything else is thrown', async () => {
  const refuse = (body: unknown, status: number) => recorder(() => new Response(JSON.stringify(body), { status })).fetch;
  for (const [body, status] of [[{ error_code: 'otp_expired', msg: 'Token has expired or is invalid' }, 403], [{ error_code: 'otp_invalid' }, 400], [{ error: 'invalid_grant' }, 400]] as const) {
    assert.deepEqual(await gotrue({ ...opts, fetch: refuse(body, status) }).verifyCode('a@b.c', '1'), { refused: 'code' }, JSON.stringify(body));
  }
  await assert.rejects(gotrue({ ...opts, fetch: refuse({}, 429) }).verifyCode('a@b.c', '1'));
  await assert.rejects(gotrue({ ...opts, fetch: refuse({ error_code: 'captcha_failed' }, 400) }).verifyCode('a@b.c', '1'));
  await assert.rejects(gotrue({ ...opts, fetch: refuse({}, 500) }).verifyCode('a@b.c', '1'));
});

test('a code request, after the answer, is retried once on a transport failure, and its refusals are logged, never thrown', async () => {
  let n = 0;
  const flaky = (async () => (++n === 1 ? new Response('', { status: 503 }) : new Response('{}', { status: 200 }))) as unknown as typeof globalThis.fetch;
  await gotrue({ ...opts, fetch: flaky }).requestCode('a@b.c', { create: false, invite: null });
  assert.equal(n, 2);
  // An address with no login, asked for without making one, is Auth's refusal: logged, never told.
  let m = 0;
  const none = (async () => { m++; return new Response(JSON.stringify({ error_code: 'otp_disabled' }), { status: 422 }); }) as unknown as typeof globalThis.fetch;
  await gotrue({ ...opts, fetch: none }).requestCode('a@b.c', { create: false, invite: null });
  assert.equal(m, 1);
  let k = 0;
  const limited = (async () => { k++; return new Response('', { status: 429 }); }) as unknown as typeof globalThis.fetch;
  await gotrue({ ...opts, fetch: limited }).requestCode('a@b.c', { create: true, invite: null });
  assert.equal(k, 1);
});

test('a code check is retried once when Auth does not answer or answers a 5xx, never on a refusal or a 429', async () => {
  let n = 0;
  const blip = (async () => (++n === 1 ? new Response('', { status: 502 }) : new Response(JSON.stringify(session), { status: 200 }))) as unknown as typeof globalThis.fetch;
  assert.deepEqual(await gotrue({ ...opts, fetch: blip }).verifyCode('a@b.c', '1'), { session });
  assert.equal(n, 2);
  let m = 0;
  const gone = (async () => { m++; throw new TypeError('reset'); }) as unknown as typeof globalThis.fetch;
  await assert.rejects(gotrue({ ...opts, fetch: gone }).verifyCode('a@b.c', '1'));
  assert.equal(m, 2);
  for (const [status, body] of [[429, {}], [403, { error_code: 'otp_expired' }]] as const) {
    let k = 0;
    const once = (async () => { k++; return new Response(JSON.stringify(body), { status }); }) as unknown as typeof globalThis.fetch;
    await gotrue({ ...opts, fetch: once }).verifyCode('a@b.c', '1').catch(() => {});
    assert.equal(k, 1, String(status));
  }
});
