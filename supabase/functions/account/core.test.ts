import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANSWER_FLOOR_MS, runAccount, type Auth, type Session } from './core.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { REFUSAL_HINT } from '../act/core.ts';

const KNOWN = 'known@test.invalid';
const UNKNOWN = 'nobody@test.invalid';
const INVITE = 'good-invite-code';

/**
 * A virtual clock, and a Supabase Auth whose work takes longer for an address it knows, as a
 * password hash compared takes longer than one never looked up: the answer must not show it.
 */
function world(options: { mode?: 'open' | 'invite' | 'closed' } = {}) {
  let now = 0;
  const clock = { now: () => now, sleep: async (ms: number) => { now += ms; } };
  const calls: string[] = [];
  const work = (email: string) => { now += email === KNOWN ? 90 : 5; };
  const session: Session = { access_token: 'tok', refresh_token: 'ref', expires_in: 3600, user: { id: 'u1', user_metadata: { invite: INVITE } } };
  const auth: Auth = {
    signUp: async (email) => { work(email); calls.push(`signUp:${email}`); },
    recover: async (email) => { work(email); calls.push(`recover:${email}`); },
    resend: async (email) => { work(email); calls.push(`resend:${email}`); },
    signIn: async (email, password) => { work(email); calls.push(`signIn:${email}`); return email === KNOWN && password === 'right password' ? { session } : { refused: 'credentials' }; },
  };
  const mode = options.mode ?? 'invite';
  const service: Db = { rpc: async <T>(fn: string, args: Record<string, unknown>) => { calls.push(`service:${fn}:${JSON.stringify(args)}`); return (fn === 'invite_open' ? (mode === 'closed' ? 'closed' : mode === 'open' || args.code === INVITE ? 'opens' : 'nothing') : null) as T; } };
  const player = (token: string): Db => ({ rpc: async <T>(fn: string, args: Record<string, unknown>) => { calls.push(`player(${token}):${fn}:${JSON.stringify(args)}`); return { account: 'u1', opened: true } as T; } });
  const answer = async (request: unknown) => {
    const start = now;
    const out = await runAccount({ auth, service, player, clock }, request);
    return { ...out, took: now - start };
  };
  return { answer, calls, clock };
}

test('signing up answers the same, in the same time, for an address with an account and one without, and asks Auth only after', async () => {
  const w = world();
  const known = await w.answer({ action: 'signUp', email: KNOWN, password: 'long enough', invite: INVITE });
  const unknown = await w.answer({ action: 'signUp', email: UNKNOWN, password: 'long enough', invite: INVITE });
  assert.equal(known.status, 202);
  assert.deepEqual([known.status, known.body, known.took], [unknown.status, unknown.body, unknown.took]);
  assert.equal(known.took, ANSWER_FLOOR_MS);
  assert.ok(!w.calls.some((c) => c.startsWith('signUp')), 'Auth was asked before the answer');
  await known.later?.();
  await unknown.later?.();
  assert.deepEqual(w.calls.filter((c) => c.startsWith('signUp')), [`signUp:${KNOWN}`, `signUp:${UNKNOWN}`]);
});

test('a reset answers the same, in the same time, for an address with an account and one without', async () => {
  const w = world();
  const known = await w.answer({ action: 'reset', email: KNOWN });
  const unknown = await w.answer({ action: 'reset', email: UNKNOWN });
  assert.equal(known.status, 202);
  assert.deepEqual([known.status, known.body, known.took], [unknown.status, unknown.body, unknown.took]);
  assert.ok(!w.calls.some((c) => c.startsWith('recover')));
  await known.later?.();
  assert.deepEqual(w.calls.filter((c) => c.startsWith('recover')), [`recover:${KNOWN}`]);
});

test('signing in with a wrong password answers the same, in the same time, as signing in to an address with no account', async () => {
  const w = world();
  const known = await w.answer({ action: 'signIn', email: KNOWN, password: 'wrong password' });
  const unknown = await w.answer({ action: 'signIn', email: UNKNOWN, password: 'wrong password' });
  assert.equal(known.status, 400);
  assert.deepEqual([known.status, known.body, known.took], [unknown.status, unknown.body, unknown.took]);
  assert.equal(known.later, undefined);
});

test('signing in opens the login\'s account with the invite it signed up with, and answers with the session', async () => {
  const w = world();
  const out = await w.answer({ action: 'signIn', email: KNOWN, password: 'right password' });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { session: { access_token: 'tok', refresh_token: 'ref', expires_in: 3600, user: { id: 'u1', user_metadata: { invite: INVITE } } }, account: true });
  assert.ok(w.calls.includes(`player(tok):open_account:${JSON.stringify({ code: INVITE })}`));
  assert.equal(out.took % ANSWER_FLOOR_MS, 0);
});

test('a login whose invite was spent signs in with no account, and is told the way out', async () => {
  const w = world();
  const spent = new DatabaseError('open_account: that invite opens nothing', 'P0001', 400, 'that invite opens nothing', REFUSAL_HINT);
  const out = await runAccount({
    auth: { signUp: async () => {}, recover: async () => {}, resend: async () => {}, signIn: async () => ({ session: { access_token: 't', refresh_token: 'r', expires_in: 1, user: { id: 'u', user_metadata: {} } } }) },
    service: { rpc: async () => { throw new Error('unused'); } },
    player: () => ({ rpc: async () => { throw spent; } }),
    clock: w.clock,
  }, { action: 'signIn', email: KNOWN, password: 'right password' });
  assert.equal(out.status, 200);
  const body = out.body as { account: boolean; why: string };
  assert.equal(body.account, false);
  assert.match(body.why, /that invite opens nothing.*another invite/);
});

test('an address not yet confirmed is told its way out: a confirmation sent again, for any address alike', async () => {
  const w = world();
  const unconfirmed = await runAccount({
    auth: { signUp: async () => {}, recover: async () => {}, resend: async () => {}, signIn: async () => ({ refused: 'unconfirmed' as const }) },
    service: { rpc: async () => null as never }, player: () => ({ rpc: async () => null as never }), clock: w.clock,
  }, { action: 'signIn', email: KNOWN, password: 'right password' });
  assert.equal(unconfirmed.status, 403);
  assert.match((unconfirmed.body as { error: string }).error, /confirm your email first.*ask for a new link/);
  const known = await w.answer({ action: 'resend', email: KNOWN });
  const unknown = await w.answer({ action: 'resend', email: UNKNOWN });
  assert.equal(known.status, 202);
  assert.deepEqual([known.status, known.body, known.took], [unknown.status, unknown.body, unknown.took]);
  assert.ok(!w.calls.some((c) => c.startsWith('resend')));
  await known.later?.();
  assert.deepEqual(w.calls.filter((c) => c.startsWith('resend')), [`resend:${KNOWN}`]);
});

test('a login with no invite in its metadata opens its account with none; a database failure is a retry-later', async () => {
  const w = world();
  const calls: string[] = [];
  const session = { access_token: 't', refresh_token: 'r', expires_in: 1, user: { id: 'u' } };
  const base = { signUp: async () => {}, recover: async () => {}, resend: async () => {}, signIn: async () => ({ session }) };
  const out = await runAccount({ auth: base, service: { rpc: async () => null as never }, player: () => ({ rpc: async <T>(fn: string, args: Record<string, unknown>) => { calls.push(`${fn}:${JSON.stringify(args)}`); return { opened: true } as T; } }), clock: w.clock },
    { action: 'signIn', email: KNOWN, password: 'right password' });
  assert.equal(out.status, 200);
  assert.deepEqual(calls, ['open_account:{"code":null}']);
  const broken = await runAccount({ auth: base, service: { rpc: async () => null as never }, player: () => ({ rpc: async () => { throw new DatabaseError('open_account: boom', '42P01', 500); } }), clock: w.clock },
    { action: 'signIn', email: KNOWN, password: 'right password' });
  assert.deepEqual([broken.status, broken.body], [503, { error: 'signing in is not working right now; try again' }]);
});

test('a sign-up with no invite, where one is needed, says so', async () => {
  const out = await world().answer({ action: 'signUp', email: UNKNOWN, password: 'long enough' });
  assert.deepEqual([out.status, out.body], [400, { field: 'invite', error: 'signing up here needs an invite' }]);
});

test('a login signing in while registration is closed is told its way out is an admin\'s, not another invite', async () => {
  const w = world();
  const closed = new DatabaseError('open_account: registration is closed', 'P0001', 400, 'registration is closed', REFUSAL_HINT);
  const out = await runAccount({
    auth: { signUp: async () => {}, recover: async () => {}, resend: async () => {}, signIn: async () => ({ session: { access_token: 't', refresh_token: 'r', expires_in: 1, user: { id: 'u', user_metadata: {} } } }) },
    service: { rpc: async () => { throw new Error('unused'); } },
    player: () => ({ rpc: async () => { throw closed; } }),
    clock: w.clock,
  }, { action: 'signIn', email: KNOWN, password: 'right password' });
  const body = out.body as { account: boolean; why: string };
  assert.equal(body.account, false);
  assert.match(body.why, /registration is closed; when an admin opens it again, your next sign-in opens your account/);
  assert.doesNotMatch(body.why, /another invite/);
});

test('whether a sign-up is refused turns on the invite and the instance\'s mode, never on the address', async () => {
  for (const email of [KNOWN, UNKNOWN]) {
    const w = world();
    const bad = await w.answer({ action: 'signUp', email, password: 'long enough', invite: 'not a code' });
    assert.deepEqual([bad.status, bad.body, bad.took, bad.later], [400, { field: 'invite', error: 'that invite opens nothing' }, ANSWER_FLOOR_MS, undefined]);
    const shut = await world({ mode: 'closed' }).answer({ action: 'signUp', email, password: 'long enough', invite: INVITE });
    assert.deepEqual([shut.status, shut.body], [403, { error: 'registration is closed' }]);
    const open = await world({ mode: 'open' }).answer({ action: 'signUp', email, password: 'long enough' });
    assert.equal(open.status, 202);
  }
});

test('a malformed request is refused by its field, in the same time as any answer', async () => {
  const w = world();
  for (const [request, field] of [
    [{ action: 'signUp', email: 'no-at-sign', password: 'long enough', invite: INVITE }, 'email'],
    [{ action: 'signUp', email: UNKNOWN, password: 'short', invite: INVITE }, 'password'],
    [{ action: 'signUp', email: UNKNOWN, password: 'x'.repeat(73), invite: INVITE }, 'password'],
    [{ action: 'reset' }, 'email'],
    [{ action: 'signIn', email: UNKNOWN }, 'password'],
    [{ action: 'delete' }, 'action'],
  ] as const) {
    const out = await w.answer(request);
    assert.equal(out.status, 400, JSON.stringify(request));
    assert.equal((out.body as { field: string }).field, field, JSON.stringify(request));
    assert.equal(out.took, ANSWER_FLOOR_MS);
  }
});

test('work that runs past the floor is rounded up to the next whole floor, so its length still shows nothing', async () => {
  let now = 0;
  const clock = { now: () => now, sleep: async (ms: number) => { now += ms; } };
  const slow: Auth = { signUp: async () => {}, recover: async () => {}, resend: async () => {}, signIn: async () => { now += ANSWER_FLOOR_MS + 7; return { refused: 'credentials' }; } };
  const out = await runAccount({ auth: slow, service: { rpc: async () => null as never }, player: () => ({ rpc: async () => null as never }), clock }, { action: 'signIn', email: KNOWN, password: 'x' });
  assert.equal(out.status, 400);
  assert.equal(now, 2 * ANSWER_FLOOR_MS);
});

test('Auth failing to answer a sign-in is a plain retry-later, in the same time', async () => {
  let now = 0;
  const clock = { now: () => now, sleep: async (ms: number) => { now += ms; } };
  const down: Auth = { signUp: async () => {}, recover: async () => {}, resend: async () => {}, signIn: async () => { throw new Error('upstream 503'); } };
  const out = await runAccount({ auth: down, service: { rpc: async () => null as never }, player: () => ({ rpc: async () => null as never }), clock }, { action: 'signIn', email: KNOWN, password: 'x' });
  assert.deepEqual([out.status, out.body, now], [503, { error: 'signing in is not working right now; try again' }, ANSWER_FLOOR_MS]);
});
