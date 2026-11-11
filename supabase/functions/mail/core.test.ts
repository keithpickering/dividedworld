import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMail } from './core.ts';
import type { AuthAdmin, MailDb, MailRow } from './core.ts';
import type { Mailer, MailMessage } from '../../../engine/system/mail.ts';
import { ProviderRefusal, TransportFailure } from '../_shared/models/transport.ts';

const NOW = Date.parse('2026-11-11T12:00:00Z');

function world(rows: MailRow[], addresses: Record<string, string | null> = { acc1: 'a@example.test' }) {
  const attempts: { outbox: number; ok: boolean; providerId: string | null; error: string | null }[] = [];
  const db: MailDb = {
    async due(most) { return rows.filter((r) => !attempts.some((a) => a.outbox === r.id && a.ok)).slice(0, most); },
    async address(account) { return addresses[account] ?? null; },
    async attempt(a) { attempts.push({ outbox: a.outbox, ok: a.ok, providerId: a.providerId ?? null, error: a.error ?? null }); },
  };
  const sent: MailMessage[] = [];
  const bans: string[] = [];
  const auth: AuthAdmin = {
    async setBan(account, until) { bans.push(`ban ${account} ${until}`); },
    async clearBan(account) { bans.push(`clear ${account}`); },
  };
  return { db, auth, attempts, sent, bans };
}
const row = (over: Partial<MailRow> = {}): MailRow => ({ id: 1, account: 'acc1', template: 'reportRead', facts: {}, ...over });
const render = (r: MailRow) => ({ subject: `S ${r.template}`, text: 'T', html: '<p>T</p>' });
const deps = (w: ReturnType<typeof world>, mailer: Mailer, over: Record<string, unknown> = {}) =>
  ({ db: w.db, mailer, auth: w.auth, render, replyTo: 'admin@example.test', most: 20, now: () => NOW, ...over });
const okMailer = (w: ReturnType<typeof world>): Mailer => ({ async send(m) { w.sent.push(m); return { id: 'prov-' + w.sent.length }; } });

test('a due row is sent once, with the reply-to and an idempotency key, and an ok attempt is written', async () => {
  const w = world([row()]);
  await runMail(deps(w, okMailer(w)));
  assert.equal(w.sent.length, 1);
  assert.deepEqual({ ...w.sent[0] }, { to: 'a@example.test', replyTo: 'admin@example.test', subject: 'S reportRead', text: 'T', html: '<p>T</p>', idempotencyKey: 'kayfabb-mail-1' });
  assert.deepEqual(w.attempts, [{ outbox: 1, ok: true, providerId: 'prov-1', error: null }]);
});

test('a second run sends nothing', async () => {
  const w = world([row()]);
  await runMail(deps(w, okMailer(w)));
  await runMail(deps(w, okMailer(w)));
  assert.equal(w.sent.length, 1);
  assert.equal(w.attempts.length, 1);
});

test('a refusal is recorded with its message and the row stays due', async () => {
  const w = world([row()]);
  let calls = 0;
  const refuse: Mailer = { async send() { calls++; throw new ProviderRefusal('HTTP 422 bad address', 422); } };
  await runMail(deps(w, refuse));
  assert.equal(calls, 1);
  assert.equal(w.attempts[0]!.ok, false);
  assert.match(w.attempts[0]!.error ?? '', /422/);
  assert.equal((await w.db.due(10)).length, 1);
});

test('a transport failure after the mailer gave up is an ok=false attempt', async () => {
  const w = world([row()]);
  await runMail(deps(w, { async send() { throw new TransportFailure('HTTP 503', 503); } }));
  assert.equal(w.attempts[0]!.ok, false);
  assert.match(w.attempts[0]!.error ?? '', /503/);
});

test('one failing row does not stop the next', async () => {
  const w = world([row({ id: 1 }), row({ id: 2 })]);
  let n = 0;
  await runMail(deps(w, { async send(m) { if (++n === 1) throw new ProviderRefusal('HTTP 422 x', 422); w.sent.push(m); return { id: 'p' }; } }));
  assert.deepEqual(w.attempts.map((a) => [a.outbox, a.ok]), [[1, false], [2, true]]);
});

test('an account with no address is recorded, nothing is sent', async () => {
  const w = world([row()], { acc1: null });
  await runMail(deps(w, okMailer(w)));
  assert.equal(w.sent.length, 0);
  assert.deepEqual(w.attempts, [{ outbox: 1, ok: false, providerId: null, error: 'no address' }]);
});

test('a suspension sets the Auth ban until its end date, before the mail', async () => {
  const w = world([row({ template: 'suspended', bar: { outcome: 'suspend', until: '2026-11-12T12:30:00Z' } })]);
  const order: string[] = [];
  w.auth.setBan = async (a, u) => { order.push('ban'); w.bans.push(`ban ${a} ${u}`); };
  await runMail(deps(w, { async send(m) { order.push('send'); w.sent.push(m); return { id: 'p' }; } }));
  assert.deepEqual(w.bans, ['ban acc1 2026-11-12T12:30:00Z']);
  assert.deepEqual(order, ['ban', 'send']);
});

test('a ban bars indefinitely and a lift clears it', async () => {
  const w = world([row({ id: 1, template: 'banned', bar: { outcome: 'ban', until: null } }), row({ id: 2, template: 'lifted', bar: { outcome: 'lift', until: null } })]);
  await runMail(deps(w, okMailer(w)));
  assert.deepEqual(w.bans, ['ban acc1 null', 'clear acc1']);
  assert.equal(w.sent.length, 2);
});

test('an auth failure is recorded, the mail is not sent, and the row stays due', async () => {
  const w = world([row({ template: 'banned', bar: { outcome: 'ban', until: null } })]);
  w.auth.setBan = async () => { throw new Error('auth down'); };
  await runMail(deps(w, okMailer(w)));
  assert.equal(w.sent.length, 0);
  assert.equal(w.attempts[0]!.ok, false);
  assert.match(w.attempts[0]!.error ?? '', /auth down/);
  assert.equal((await w.db.due(10)).length, 1);
});

test('a null replyTo sends nothing and records nothing', async () => {
  const w = world([row({ template: 'banned', bar: { outcome: 'ban', until: null } })]);
  const out = await runMail(deps(w, okMailer(w), { replyTo: null }));
  assert.equal(w.sent.length, 0);
  assert.equal(w.attempts.length, 0);
  assert.deepEqual(w.bans, []);
  assert.match(JSON.stringify(out), /waiting for the admin address/);
});
