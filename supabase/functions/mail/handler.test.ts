import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './handler.ts';
import { instance as dividedWorld } from '../_shared/instance.ts';
import { KEY, fakeDeps, post } from '../_shared/handler-test-kit.ts';
import type { JobDeps } from '../_shared/handler.ts';
import type { MailMessage } from '../../../engine/system/mail.ts';

const outbox = { id: 5, account: 'acct-1', template: 'banned', facts: { post: '/p/1', thread: '/t/1', section: 'x', note: 'n', conduct: '/conduct' }, bar: { outcome: 'ban', until: null } };

/** The kit's database, answering the instance's settings with the given admin address. */
function world(adminAddress: string | null) {
  const sent: MailMessage[] = [];
  const bans: string[] = [];
  const built: { url: string; key: string }[] = [];
  const mailers: JobDeps['env'][] = [];
  const kit = fakeDeps((fn) => (fn === 'mail_due' ? [outbox] : null), {
    mailer: ((env: JobDeps['env']) => { mailers.push(env); return { send: async (m: MailMessage) => { sent.push(m); return { id: 'p1' }; } }; }) as JobDeps['mailer'],
    authAdmin: (o) => {
      built.push(o);
      return { setBan: async (a, until) => { bans.push(`ban ${a} ${until}`); }, clearBan: async (a) => { bans.push(`clear ${a}`); }, address: async (a) => `${a}@example.test` };
    },
  });
  const inner = kit.deps.db;
  const db: JobDeps['db'] = (env, o) => {
    const real = inner(env, o);
    return { rpc: async <T>(fn: string, args: Record<string, unknown>): Promise<T> => (fn === 'instance_settings' ? ({ economy: dividedWorld.settings.economy, conduct: { ...dividedWorld.settings.conduct, adminAddress } } as T) : real.rpc<T>(fn, args)) };
  };
  return { ...kit, deps: { ...kit.deps, db }, sent, bans, built, mailers };
}

test('mail: a caller that is not the service is refused and nothing is built', async () => {
  const w = world('admin@example.test');
  assert.equal((await handle(post({}, 'not-the-key'), w.deps)).status, 401);
  assert.equal((await handle(post({}, null), w.deps)).status, 401);
  assert.equal(w.built.length + w.mailers.length + w.calls.length, 0);
});

test('mail: a due row is sent through deps.mailer with the address from deps.authAdmin and the admin address as reply-to, then the 200 is recorded', async () => {
  const w = world('admin@example.test');
  const res = await handle(post({}), w.deps);
  assert.equal(res.status, 200);
  assert.deepEqual(w.built, [{ url: 'http://db.test', key: KEY }]);
  assert.deepEqual(w.sent.map((m) => [m.to, m.replyTo, m.idempotencyKey]), [['acct-1@example.test', 'admin@example.test', 'kayfabb-mail-5']]);
  assert.deepEqual(w.bans, ['ban acct-1 null']);
  assert.equal(w.calls.filter((c) => c.fn === 'record_mail_attempt' && c.args.kind === 'sent').length, 1);
  assert.deepEqual(w.calls.at(-1), { fn: 'record_job_run', args: { job: 'kayfabb-mail' } });
});

test('mail: with no admin address the mail waits, no mailer is built, and the waiting run is still a heartbeat', async () => {
  const w = world(null);
  const res = await handle(post({}), w.deps);
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { status: string }).status, 'waiting for the admin address');
  assert.equal(w.mailers.length, 0);
  assert.equal(w.calls.some((c) => c.fn === 'record_mail_attempt'), false);
  assert.deepEqual(w.calls.at(-1), { fn: 'record_job_run', args: { job: 'kayfabb-mail' } });
});

test('mail: a failure to build the mailer is a 500 that names no key, and is not recorded', async () => {
  const w = world('admin@example.test');
  w.deps.mailer = () => { throw new Error('RESEND_API_KEY is not set: mail cannot be sent'); };
  const original = console.error;
  console.error = () => {};
  try {
    const res = await handle(post({}), w.deps);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'the mail run failed; due mail stays due for the next run' });
  } finally { console.error = original; }
  assert.equal(w.calls.some((c) => c.fn === 'record_job_run'), false);
});
