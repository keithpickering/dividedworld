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

test('sign-up, sign-in and recovery are Supabase Auth\'s own endpoints, called with the public key', async () => {
  const session = { access_token: 'a', refresh_token: 'r', expires_in: 3600, user: { id: 'u' } };
  const { calls, fetch } = recorder((url) => new Response(JSON.stringify(url.includes('token') ? session : {}), { status: 200 }));
  const auth = gotrue({ url: 'https://p.example', key: 'anon', fetch, sleep: async () => {} });
  await auth.signUp('a@b.c', 'pw', { invite: 'code' });
  assert.deepEqual(await auth.signIn('a@b.c', 'pw'), { session });
  await auth.recover('a@b.c');
  assert.deepEqual(calls.map((c) => c.url), ['https://p.example/auth/v1/signup', 'https://p.example/auth/v1/token?grant_type=password', 'https://p.example/auth/v1/recover']);
  assert.deepEqual(calls[0]?.body, { email: 'a@b.c', password: 'pw', data: { invite: 'code' } });
  assert.ok(calls.every((c) => c.apikey === 'anon'));
});

test('a refused sign-in is a wrong password or an address not yet confirmed; anything else is thrown', async () => {
  const refuse = (body: unknown, status = 400) => recorder(() => new Response(JSON.stringify(body), { status })).fetch;
  const opts = { url: 'https://p.example', key: 'anon', sleep: async () => {} };
  assert.deepEqual(await gotrue({ ...opts, fetch: refuse({ error_code: 'invalid_credentials', msg: 'Invalid login credentials' }) }).signIn('a@b.c', 'x'), { refused: 'credentials' });
  assert.deepEqual(await gotrue({ ...opts, fetch: refuse({ error: 'invalid_grant', error_description: 'Invalid login credentials' }) }).signIn('a@b.c', 'x'), { refused: 'credentials' });
  assert.deepEqual(await gotrue({ ...opts, fetch: refuse({ error_code: 'email_not_confirmed' }) }).signIn('a@b.c', 'x'), { refused: 'unconfirmed' });
  await assert.rejects(gotrue({ ...opts, fetch: refuse({}, 429) }).signIn('a@b.c', 'x'));
  await assert.rejects(gotrue({ ...opts, fetch: refuse({}, 500) }).signIn('a@b.c', 'x'));
});

test('work after the answer is retried once on a transport failure, and its refusals are logged, never thrown', async () => {
  let n = 0;
  const flaky = (async () => (++n === 1 ? new Response('', { status: 503 }) : new Response('{}', { status: 200 }))) as unknown as typeof globalThis.fetch;
  await gotrue({ url: 'https://p.example', key: 'anon', fetch: flaky, sleep: async () => {} }).recover('a@b.c');
  assert.equal(n, 2);
  let m = 0;
  const taken = (async () => { m++; return new Response(JSON.stringify({ error_code: 'user_already_exists' }), { status: 422 }); }) as unknown as typeof globalThis.fetch;
  await gotrue({ url: 'https://p.example', key: 'anon', fetch: taken, sleep: async () => {} }).signUp('a@b.c', 'pw', { invite: null });
  assert.equal(m, 1);
});

test('a sign-in is retried once when Auth does not answer or answers a 5xx, never on a refusal or a 429', async () => {
  const opts = { url: 'https://p.example', key: 'anon', sleep: async () => {} };
  const session = { access_token: 'a', refresh_token: 'r', expires_in: 1, user: { id: 'u' } };
  let n = 0;
  const blip = (async () => (++n === 1 ? new Response('', { status: 502 }) : new Response(JSON.stringify(session), { status: 200 }))) as unknown as typeof globalThis.fetch;
  assert.deepEqual(await gotrue({ ...opts, fetch: blip }).signIn('a@b.c', 'pw'), { session });
  assert.equal(n, 2);
  let m = 0;
  const gone = (async () => { m++; throw new TypeError('reset'); }) as unknown as typeof globalThis.fetch;
  await assert.rejects(gotrue({ ...opts, fetch: gone }).signIn('a@b.c', 'pw'));
  assert.equal(m, 2);
  for (const [status, body] of [[429, {}], [400, { error_code: 'invalid_credentials' }]] as const) {
    let k = 0;
    const once = (async () => { k++; return new Response(JSON.stringify(body), { status }); }) as unknown as typeof globalThis.fetch;
    await gotrue({ ...opts, fetch: once }).signIn('a@b.c', 'pw').catch(() => {});
    assert.equal(k, 1, String(status));
  }
});

test('a 400 that is not about the password is thrown, not told as a wrong password', async () => {
  const fetch = (async () => new Response(JSON.stringify({ error_code: 'captcha_failed' }), { status: 400 })) as unknown as typeof globalThis.fetch;
  await assert.rejects(gotrue({ url: 'https://p.example', key: 'anon', fetch, sleep: async () => {} }).signIn('a@b.c', 'pw'));
});

test('work after the answer: exactly two tries on a lasting failure, none again on a 429, and a resend is Auth\'s own', async () => {
  const opts = { url: 'https://p.example', key: 'anon', sleep: async () => {} };
  let n = 0;
  const down = (async () => { n++; return new Response('', { status: 503 }); }) as unknown as typeof globalThis.fetch;
  await gotrue({ ...opts, fetch: down }).recover('a@b.c');
  assert.equal(n, 2);
  let m = 0;
  const limited = (async () => { m++; return new Response('', { status: 429 }); }) as unknown as typeof globalThis.fetch;
  await gotrue({ ...opts, fetch: limited }).recover('a@b.c');
  assert.equal(m, 1);
  const { calls, fetch } = recorder(() => new Response('{}', { status: 200 }));
  await gotrue({ ...opts, fetch }).resend('a@b.c');
  assert.deepEqual(calls.map((c) => [c.url, c.body]), [['https://p.example/auth/v1/resend', { type: 'signup', email: 'a@b.c' }]]);
});
