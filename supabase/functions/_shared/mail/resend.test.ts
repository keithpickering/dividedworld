import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resendMailer } from './resend.ts';
import { ProviderRefusal, TransportFailure } from '../models/transport.ts';

const KEY = 're_secret_key_value_123';
const env = (n: string) => ({ RESEND_API_KEY: KEY, MAIL_FROM: 'Fixture <noreply@example.test>' } as Record<string, string>)[n];
const message = { to: 'a@example.test', replyTo: 'admin@example.test', subject: 'S', text: 'T', html: '<p>T</p>', idempotencyKey: 'kayfabb-mail-7' };
const sleeps: number[] = [];
const sleep = async (ms: number) => { sleeps.push(ms); };

function fakeFetch(statuses: number[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const status = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    return new Response(status === 200 ? JSON.stringify({ id: 'prov-1' }) : `{"message":"nope"}`, { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

test('sends one POST to Resend with the fields and the idempotency key', async () => {
  const { f, calls } = fakeFetch([200]);
  const out = await resendMailer({ env, fetch: f, sleep }).send(message);
  assert.deepEqual(out, { id: 'prov-1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://api.resend.com/emails');
  assert.equal(calls[0]!.init.method, 'POST');
  const h = calls[0]!.init.headers as Record<string, string>;
  assert.equal(h['Idempotency-Key'], 'kayfabb-mail-7');
  assert.equal(h.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { from: 'Fixture <noreply@example.test>', to: 'a@example.test', reply_to: 'admin@example.test', subject: 'S', text: 'T', html: '<p>T</p>' });
});

test('a null replyTo sends no reply_to', async () => {
  const { f, calls } = fakeFetch([200]);
  await resendMailer({ env, fetch: f, sleep }).send({ ...message, replyTo: null });
  assert.ok(!('reply_to' in JSON.parse(calls[0]!.init.body as string)));
});

test('a 503 then a 200 is retried on the request and sent', async () => {
  const { f, calls } = fakeFetch([503, 200]);
  assert.deepEqual(await resendMailer({ env, fetch: f, sleep }).send(message), { id: 'prov-1' });
  assert.equal(calls.length, 2);
  assert.equal((calls[1]!.init.headers as Record<string, string>)['Idempotency-Key'], 'kayfabb-mail-7');
});

test('a 429 and no answer are retried, then give up as a transport failure', async () => {
  const { f, calls } = fakeFetch([429]);
  await assert.rejects(resendMailer({ env, fetch: f, sleep }).send(message), (e) => e instanceof TransportFailure);
  assert.equal(calls.length, 4);
  let n = 0;
  const never = (async () => { n++; throw new Error('socket hang up'); }) as unknown as typeof fetch;
  await assert.rejects(resendMailer({ env, fetch: never, sleep }).send(message), (e) => e instanceof TransportFailure);
  assert.equal(n, 4);
});

test('a 422 is a refusal, carries its status, and is not retried', async () => {
  const { f, calls } = fakeFetch([422]);
  await assert.rejects(resendMailer({ env, fetch: f, sleep }).send(message), (e) => e instanceof ProviderRefusal && e.status === 422 && /422/.test(e.message));
  assert.equal(calls.length, 1);
});

test('no key throws a plain error; no from address too', () => {
  assert.throws(() => resendMailer({ env: (n) => (n === 'MAIL_FROM' ? 'a@example.test' : undefined) }), /RESEND_API_KEY/);
  assert.throws(() => resendMailer({ env: (n) => (n === 'RESEND_API_KEY' ? KEY : undefined) }), /MAIL_FROM/);
});

test('the key never appears in a thrown message', async () => {
  for (const status of [422, 503, 401]) {
    const { f } = fakeFetch([status]);
    await assert.rejects(resendMailer({ env, fetch: f, sleep }).send(message), (e) => e instanceof Error && !e.message.includes(KEY) && !String(e.stack).includes(KEY));
  }
  assert.throws(() => resendMailer({ env: (n) => (n === 'RESEND_API_KEY' ? KEY : undefined) }), (e) => e instanceof Error && !e.message.includes(KEY));
});
