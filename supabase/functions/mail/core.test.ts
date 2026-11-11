import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMail } from './core.ts';
import type { AttemptKind, AuthAdmin, MailDb, MailRow } from './core.ts';
import type { Mailer, MailMessage } from '../../../engine/system/mail.ts';
import { ProviderRefusal, TransportFailure } from '../_shared/models/transport.ts';

const NOW = Date.parse('2026-11-11T12:00:00Z');

function world(rows: MailRow[], addresses: Record<string, string | null> = { acc1: 'a@example.test' }) {
  const attempts: { outbox: number; kind: AttemptKind; providerId: string | null; error: string | null }[] = [];
  const db: MailDb = {
    // As mail_due: a sent or refused row is done; a failed one comes back (its backoff is the database's, tested in supabase/tests/0151-conduct-mail.sql).
    async due(most) { return rows.filter((r) => !attempts.some((a) => a.outbox === r.id && a.kind !== 'failed')).slice(0, most); },
    async address(account) { return addresses[account] ?? null; },
    async attempt(a) { attempts.push({ outbox: a.outbox, kind: a.kind, providerId: a.providerId ?? null, error: a.error ?? null }); },
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

test('a due row is sent once, with the reply-to and an idempotency key, and a sent attempt is written', async () => {
  const w = world([row()]);
  await runMail(deps(w, okMailer(w)));
  assert.equal(w.sent.length, 1);
  assert.deepEqual({ ...w.sent[0] }, { to: 'a@example.test', replyTo: 'admin@example.test', subject: 'S reportRead', text: 'T', html: '<p>T</p>', idempotencyKey: 'kayfabb-mail-1' });
  assert.deepEqual(w.attempts, [{ outbox: 1, kind: 'sent', providerId: 'prov-1', error: null }]);
});

test('a second run sends nothing', async () => {
  const w = world([row()]);
  await runMail(deps(w, okMailer(w)));
  await runMail(deps(w, okMailer(w)));
  assert.equal(w.sent.length, 1);
  assert.equal(w.attempts.length, 1);
});

test('a refusal is final: recorded as refused with its message, and the row is not due again', async () => {
  const w = world([row()]);
  let calls = 0;
  const refuse: Mailer = { async send() { calls++; throw new ProviderRefusal('HTTP 422 bad address', 422); } };
  await runMail(deps(w, refuse));
  assert.equal(calls, 1);
  assert.equal(w.attempts[0]!.kind, 'refused');
  assert.match(w.attempts[0]!.error ?? '', /422/);
  assert.equal((await w.db.due(10)).length, 0);
  await runMail(deps(w, refuse));
  assert.equal(calls, 1, 'a refused mail is not sent again');
});

test('a rejected key (401) is not about the mail: it fails and is retried, never refused for good', async () => {
  const w = world([row()]);
  await runMail(deps(w, { async send() { throw new ProviderRefusal('HTTP 401 bad key', 401); } }));
  assert.equal(w.attempts[0]!.kind, 'failed');
  assert.equal((await w.db.due(10)).length, 1);
});

test('a transport failure after the mailer gave up is a failed attempt, and the row stays due', async () => {
  const w = world([row()]);
  await runMail(deps(w, { async send() { throw new TransportFailure('HTTP 503', 503); } }));
  assert.equal(w.attempts[0]!.kind, 'failed');
  assert.match(w.attempts[0]!.error ?? '', /503/);
  assert.equal((await w.db.due(10)).length, 1);
});

test('a 503 that passes is retried on the next run, and sent once under the same key', async () => {
  const w = world([row()]);
  const keys: (string | undefined)[] = [];
  let calls = 0;
  const flaky: Mailer = { async send(m) { keys.push(m.idempotencyKey); if (++calls === 1) throw new TransportFailure('HTTP 503', 503); w.sent.push(m); return { id: 'prov-ok' }; } };
  await runMail(deps(w, flaky));
  assert.equal(w.sent.length, 0);
  await runMail(deps(w, flaky));
  assert.equal(w.sent.length, 1);
  assert.deepEqual(w.attempts.map((a) => a.kind), ['failed', 'sent']);
  assert.deepEqual(keys, ['kayfabb-mail-1', 'kayfabb-mail-1']);
  await runMail(deps(w, flaky));
  assert.equal(calls, 2, 'a sent mail is not sent again');
});

test('one failing row does not stop the next', async () => {
  const w = world([row({ id: 1 }), row({ id: 2 })]);
  let n = 0;
  await runMail(deps(w, { async send(m) { if (++n === 1) throw new ProviderRefusal('HTTP 422 x', 422); w.sent.push(m); return { id: 'p' }; } }));
  assert.deepEqual(w.attempts.map((a) => [a.outbox, a.kind]), [[1, 'refused'], [2, 'sent']]);
});

test('an account with no address is a refusal: recorded, nothing is sent, and it is final', async () => {
  const w = world([row()], { acc1: null });
  await runMail(deps(w, okMailer(w)));
  assert.equal(w.sent.length, 0);
  assert.deepEqual(w.attempts, [{ outbox: 1, kind: 'refused', providerId: null, error: 'no address' }]);
  assert.equal((await w.db.due(10)).length, 0);
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

test('a suspension row whose bar the database now says is a lift clears the login, never bans it', async () => {
  // mail_due gives the account's current bar, so an old failed suspension row read after a lift (or after the suspension ended) carries the lift.
  const w = world([row({ template: 'suspended', bar: { outcome: 'lift', until: null } })]);
  await runMail(deps(w, okMailer(w)));
  assert.deepEqual(w.bans, ['clear acc1']);
  assert.equal(w.sent.length, 1);
});

test('an auth failure is recorded, the mail is not sent, and the row stays due', async () => {
  const w = world([row({ template: 'banned', bar: { outcome: 'ban', until: null } })]);
  w.auth.setBan = async () => { throw new Error('auth down'); };
  await runMail(deps(w, okMailer(w)));
  assert.equal(w.sent.length, 0);
  assert.equal(w.attempts[0]!.kind, 'failed');
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

test('a render error is deterministic: recorded as refused, never retried', async () => {
  const w = world([row()]);
  const boom = () => { throw new Error('render: bad facts'); };
  const out = await runMail(deps(w, okMailer(w), { render: boom }));
  assert.equal(w.sent.length, 0);
  assert.equal(w.attempts[0]!.kind, 'refused');
  assert.match(w.attempts[0]!.error ?? '', /bad facts/);
  assert.equal(out.status === 'done' && out.refused, 1);
  assert.equal((await w.db.due(10)).length, 0);
});

test('a row whose bar is null, as mail_due returns it for a mail with no bar (a JSON null, not an absent key), is sent with no Auth call', async () => {
  const w = world([row({ bar: null })]);
  await runMail(deps(w, okMailer(w)));
  assert.equal(w.sent.length, 1);
  assert.deepEqual(w.bans, []);
  assert.deepEqual(w.attempts, [{ outbox: 1, kind: 'sent', providerId: 'prov-1', error: null }]);
});
