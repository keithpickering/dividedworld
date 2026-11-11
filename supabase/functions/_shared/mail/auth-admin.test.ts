import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authAdmin, banDuration } from './auth-admin.ts';

const NOW = Date.parse('2026-11-11T12:00:00Z');

test('banDuration rounds up to whole hours; indefinite is a very long time; the past is none', () => {
  assert.equal(banDuration('2026-11-12T12:30:00Z', NOW), '25h');
  assert.equal(banDuration('2026-11-12T12:00:00Z', NOW), '24h');
  assert.equal(banDuration(null, NOW), '876000h');
  assert.equal(banDuration('2026-11-11T11:00:00Z', NOW), null);
});

function fake(answer: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return answer(); }) as unknown as typeof fetch;
  return { f, calls };
}

test('setBan and clearBan PUT ban_duration to the admin user endpoint with the secret key', async () => {
  const { f, calls } = fake(() => new Response('{}', { status: 200 }));
  const a = authAdmin({ url: 'https://p.example', key: 'sb_secret_x', fetch: f, now: () => NOW });
  await a.setBan('u1', '2026-11-12T12:30:00Z');
  await a.setBan('u1', null);
  await a.clearBan('u1');
  assert.deepEqual(calls.map((c) => [c.url, c.init.method, JSON.parse(c.init.body as string)]), [
    ['https://p.example/auth/v1/admin/users/u1', 'PUT', { ban_duration: '25h' }],
    ['https://p.example/auth/v1/admin/users/u1', 'PUT', { ban_duration: '876000h' }],
    ['https://p.example/auth/v1/admin/users/u1', 'PUT', { ban_duration: 'none' }],
  ]);
  assert.equal((calls[0]!.init.headers as Record<string, string>).apikey, 'sb_secret_x');
});

test('a refusal throws without the key; the address is read from the admin user', async () => {
  const bad = fake(() => new Response('{"msg":"no"}', { status: 403 }));
  await assert.rejects(authAdmin({ url: 'https://p.example', key: 'sb_secret_x', fetch: bad.f }).clearBan('u1'), (e) => e instanceof Error && /403/.test(e.message) && !e.message.includes('sb_secret_x'));
  const ok = fake(() => new Response('{"email":"a@example.test"}', { status: 200 }));
  assert.equal(await authAdmin({ url: 'https://p.example', key: 'k', fetch: ok.f }).address('u1'), 'a@example.test');
  const none = fake(() => new Response('{}', { status: 404 }));
  assert.equal(await authAdmin({ url: 'https://p.example', key: 'k', fetch: none.f }).address('u1'), null);
});
