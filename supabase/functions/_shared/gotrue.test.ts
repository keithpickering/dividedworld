import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gotrue } from './gotrue.ts';

const recorder = (respond: (url: string, body: unknown) => Response) => {
  const calls: { url: string; body: unknown; apikey: string | null; authorization: string | null }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body, apikey: new Headers(init.headers).get('apikey'), authorization: new Headers(init.headers).get('Authorization') });
    return respond(url, body);
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
};
const session = { access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: 'u' } };
const opts = { url: 'https://p.example', key: 'sb_publishable_p', sleep: async () => {} };

test('a code is asked for and checked at Supabase Auth\'s own endpoints, called with the public key, and no password goes anywhere', async () => {
  const { calls, fetch } = recorder((url) => new Response(JSON.stringify(url.includes('verify') ? session : {}), { status: 200 }));
  const auth = gotrue({ ...opts, fetch });
  await auth.requestCode('a@b.c', { create: true, invite: 'code', redirect: 'https://dw.test/register' });
  await auth.requestCode('a@b.c', { create: false, invite: null, redirect: 'https://dw.test/sign-in?next=%2Fa%3Fb%3D1' });
  await auth.requestCode('a@b.c', { create: true, invite: null, redirect: 'https://dw.test/register', conduct: 2 });
  assert.deepEqual(await auth.verifyCode('a@b.c', '123456'), { session });
  assert.deepEqual(calls.map((c) => [c.url, c.body]), [
    ['https://p.example/auth/v1/otp?redirect_to=https%3A%2F%2Fdw.test%2Fregister', { email: 'a@b.c', create_user: true, data: { invite: 'code' } }],
    ['https://p.example/auth/v1/otp?redirect_to=https%3A%2F%2Fdw.test%2Fsign-in%3Fnext%3D%252Fa%253Fb%253D1', { email: 'a@b.c', create_user: false, data: { invite: null } }],
    ['https://p.example/auth/v1/otp?redirect_to=https%3A%2F%2Fdw.test%2Fregister', { email: 'a@b.c', create_user: true, data: { invite: null, conduct: 2 } }],
    ['https://p.example/auth/v1/verify', { type: 'email', email: 'a@b.c', token: '123456' }],
  ]);
  assert.ok(calls.every((c) => c.apikey === 'sb_publishable_p' && c.authorization === null), 'the key in apikey alone');
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

test('a login Auth has banned is told apart from a wrong code: the verify is refused as barred, for a 400 or a 403', async () => {
  const refuse = (body: unknown, status: number) => recorder(() => new Response(JSON.stringify(body), { status })).fetch;
  for (const status of [400, 403]) {
    assert.deepEqual(await gotrue({ ...opts, fetch: refuse({ error_code: 'user_banned', msg: 'User is banned' }, status) }).verifyCode('a@b.c', '1'), { refused: 'barred' }, String(status));
  }
});

test('a ban answered in the OAuth style (invalid_grant described as banned) is barred too, while a bare invalid_grant stays a wrong code', async () => {
  const refuse = (body: unknown, status: number) => recorder(() => new Response(JSON.stringify(body), { status })).fetch;
  for (const status of [400, 403]) {
    assert.deepEqual(await gotrue({ ...opts, fetch: refuse({ error: 'invalid_grant', error_description: 'User is banned' }, status) }).verifyCode('a@b.c', '1'), { refused: 'barred' }, String(status));
  }
  assert.deepEqual(await gotrue({ ...opts, fetch: refuse({ error: 'invalid_grant', error_description: 'Token has expired or is invalid' }, 400) }).verifyCode('a@b.c', '1'), { refused: 'code' });
});

test('a banned login following the emailed link is barred as it is by a code, in either style of answer; a spent link stays a refused link', async () => {
  const refuse = (body: unknown, status: number) => recorder(() => new Response(JSON.stringify(body), { status })).fetch;
  const hash = 'pkce_0123456789abcdef-hash';
  for (const status of [400, 403]) {
    assert.deepEqual(await gotrue({ ...opts, fetch: refuse({ error_code: 'user_banned', msg: 'User is banned' }, status) }).verifyLink(hash), { refused: 'barred' }, String(status));
    assert.deepEqual(await gotrue({ ...opts, fetch: refuse({ error: 'invalid_grant', error_description: 'User is banned' }, status) }).verifyLink(hash), { refused: 'barred' }, String(status));
  }
  assert.deepEqual(await gotrue({ ...opts, fetch: refuse({ error_code: 'otp_expired' }, 403) }).verifyLink(hash), { refused: 'link' });
});

test('a code request, after the answer, is retried once on a transport failure, and its refusals are logged, never thrown', async () => {
  let n = 0;
  const flaky = (async () => (++n === 1 ? new Response('', { status: 503 }) : new Response('{}', { status: 200 }))) as unknown as typeof globalThis.fetch;
  await gotrue({ ...opts, fetch: flaky }).requestCode('a@b.c', { create: false, invite: null, redirect: 'https://dw.test/sign-in' });
  assert.equal(n, 2);
  // An address with no login, asked for without making one, is Auth's refusal: logged, never told.
  let m = 0;
  const none = (async () => { m++; return new Response(JSON.stringify({ error_code: 'otp_disabled' }), { status: 422 }); }) as unknown as typeof globalThis.fetch;
  await gotrue({ ...opts, fetch: none }).requestCode('a@b.c', { create: false, invite: null, redirect: 'https://dw.test/sign-in' });
  assert.equal(m, 1);
  let k = 0;
  const limited = (async () => { k++; return new Response('', { status: 429 }); }) as unknown as typeof globalThis.fetch;
  await gotrue({ ...opts, fetch: limited }).requestCode('a@b.c', { create: true, invite: null, redirect: 'https://dw.test/register' });
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

test('a link\'s hash is checked at /verify with the public key; a spent one is the link\'s refusal, a blip is retried, and two blips throw', async () => {
  const hash = 'pkce_0123456789abcdef-GOOD_hash';
  const { calls, fetch } = recorder(() => new Response(JSON.stringify(session), { status: 200 }));
  assert.deepEqual(await gotrue({ ...opts, fetch }).verifyLink(hash), { session });
  assert.deepEqual(calls.map((c) => [c.url, c.body, c.apikey, c.authorization]), [['https://p.example/auth/v1/verify', { type: 'email', token_hash: hash }, 'sb_publishable_p', null]]);
  const expired = recorder(() => new Response(JSON.stringify({ error_code: 'otp_expired' }), { status: 403 })).fetch;
  assert.deepEqual(await gotrue({ ...opts, fetch: expired }).verifyLink(hash), { refused: 'link' });
  let n = 0;
  const blip = (async () => (++n === 1 ? new Response('', { status: 500 }) : new Response(JSON.stringify(session), { status: 200 }))) as unknown as typeof globalThis.fetch;
  assert.deepEqual(await gotrue({ ...opts, fetch: blip }).verifyLink(hash), { session });
  assert.equal(n, 2);
  let m = 0;
  const down = (async () => { m++; return new Response('', { status: 500 }); }) as unknown as typeof globalThis.fetch;
  await assert.rejects(gotrue({ ...opts, fetch: down }).verifyLink(hash));
  assert.equal(m, 2);
  await assert.rejects(gotrue({ ...opts, fetch: recorder(() => new Response('{}', { status: 429 })).fetch }).verifyLink(hash));
});

test('a refused or unanswered code request is logged by `otp` alone, never the redirect', async () => {
  const seen: unknown[][] = [];
  const real = console.error;
  console.error = (...a: unknown[]) => { seen.push(a); };
  try {
    const redirect = 'https://dw.test/sign-in?next=%2Fsecret-thread';
    await gotrue({ ...opts, fetch: recorder(() => new Response('{}', { status: 429 })).fetch }).requestCode('a@b.c', { create: false, invite: null, redirect });
    await gotrue({ ...opts, fetch: recorder(() => new Response('{}', { status: 503 })).fetch }).requestCode('a@b.c', { create: false, invite: null, redirect });
  } finally { console.error = real; }
  assert.deepEqual(seen, [['auth otp refused', 429], ['auth otp did not answer']]);
});
