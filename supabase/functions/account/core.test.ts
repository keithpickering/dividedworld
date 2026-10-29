import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANSWER_FLOOR_MS, runAccount, type Auth, type Session } from './core.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { REFUSAL_HINT } from '../act/core.ts';

const KNOWN = 'known@test.invalid';
const UNKNOWN = 'nobody@test.invalid';
const INVITE = 'good-invite-code';
const CODE = '123456';

const session: Session = { access_token: 'tok', refresh_token: 'ref', expires_in: 3600, user: { id: 'u1', user_metadata: { invite: INVITE } } };
const noAuth: Auth = { requestCode: async () => {}, verifyCode: async () => ({ refused: 'code' }) };

/**
 * A virtual clock, and a Supabase Auth whose work takes longer for an address it knows, as
 * finding a login and sending it a code takes longer than finding none: the answer must not show it.
 */
function world(options: { mode?: 'open' | 'invite' | 'closed' } = {}) {
  let now = 0;
  const clock = { now: () => now, sleep: async (ms: number) => { now += ms; } };
  const calls: string[] = [];
  const work = (email: string) => { now += email === KNOWN ? 90 : 5; };
  const auth: Auth = {
    requestCode: async (email, o) => { work(email); calls.push(`requestCode:${email}:${JSON.stringify(o)}`); },
    verifyCode: async (email, code) => { work(email); calls.push(`verifyCode:${email}`); return email === KNOWN && code === CODE ? { session } : { refused: 'code' }; },
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

test('asking for a code answers the same, in the same time, for an address with an account and one without, and asks Auth only after', async () => {
  for (const invite of [INVITE, undefined]) {
    const w = world();
    const known = await w.answer({ action: 'requestCode', email: KNOWN, invite });
    const unknown = await w.answer({ action: 'requestCode', email: UNKNOWN, invite });
    assert.equal(known.status, 202);
    assert.deepEqual([known.status, known.body, known.took], [unknown.status, unknown.body, unknown.took]);
    assert.equal(known.took, ANSWER_FLOOR_MS);
    assert.ok(!w.calls.some((c) => c.startsWith('requestCode')), 'Auth was asked before the answer');
    await known.later?.();
    await unknown.later?.();
    assert.equal(w.calls.filter((c) => c.startsWith('requestCode')).length, 2);
  }
});

test('the answer to a code request says what a new player needs and what to do if nothing comes, the same for every address', async () => {
  const out = await world().answer({ action: 'requestCode', email: UNKNOWN });
  const message = (out.body as { message: string }).message;
  assert.match(message, /invite/);
  assert.match(message, /ask again/);
});

test('a code asked for with an invite that opens may make a login; one asked for without, where an invite is needed, only signs one in', async () => {
  const w = world();
  await (await w.answer({ action: 'requestCode', email: UNKNOWN, invite: INVITE })).later?.();
  await (await w.answer({ action: 'requestCode', email: UNKNOWN })).later?.();
  assert.deepEqual(w.calls.filter((c) => c.startsWith('requestCode')), [
    `requestCode:${UNKNOWN}:${JSON.stringify({ create: true, invite: INVITE })}`,
    `requestCode:${UNKNOWN}:${JSON.stringify({ create: false, invite: null })}`,
  ]);
  // Where registration is open, anyone may make a login; where it is closed, nobody new.
  const open = world({ mode: 'open' });
  await (await open.answer({ action: 'requestCode', email: UNKNOWN })).later?.();
  assert.deepEqual(open.calls.filter((c) => c.startsWith('requestCode')), [`requestCode:${UNKNOWN}:${JSON.stringify({ create: true, invite: null })}`]);
  const closed = world({ mode: 'closed' });
  const out = await closed.answer({ action: 'requestCode', email: KNOWN });
  assert.equal(out.status, 202, 'a login made before registration closed still signs in');
  await out.later?.();
  assert.deepEqual(closed.calls.filter((c) => c.startsWith('requestCode')), [`requestCode:${KNOWN}:${JSON.stringify({ create: false, invite: null })}`]);
});

test('whether a code request is refused turns on the invite and the instance\'s mode, never on the address', async () => {
  for (const email of [KNOWN, UNKNOWN]) {
    const bad = await world().answer({ action: 'requestCode', email, invite: 'not a code' });
    assert.deepEqual([bad.status, bad.body, bad.took, bad.later], [400, { field: 'invite', error: 'that invite opens nothing' }, ANSWER_FLOOR_MS, undefined]);
    const shut = await world({ mode: 'closed' }).answer({ action: 'requestCode', email, invite: INVITE });
    assert.deepEqual([shut.status, shut.body], [403, { error: 'registration is closed' }]);
  }
});

test('a wrong code answers the same, in the same time, as a code for an address with no account', async () => {
  const w = world();
  const known = await w.answer({ action: 'verifyCode', email: KNOWN, code: '000000' });
  const unknown = await w.answer({ action: 'verifyCode', email: UNKNOWN, code: CODE });
  assert.equal(known.status, 400);
  assert.deepEqual([known.status, known.body, known.took], [unknown.status, unknown.body, unknown.took]);
  assert.deepEqual(known.body, { field: 'code', error: 'that code does not match, or it has expired: ask for a new one' });
  assert.equal(known.later, undefined);
});

test('the right code signs in, opens the login\'s account with the invite it asked with, and answers with the session', async () => {
  const w = world();
  const out = await w.answer({ action: 'verifyCode', email: KNOWN, code: CODE });
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { session, account: true });
  assert.ok(w.calls.includes(`player(tok):open_account:${JSON.stringify({ code: INVITE })}`));
  assert.equal(out.took % ANSWER_FLOOR_MS, 0);
});

test('no path takes a password', async () => {
  const w = world();
  for (const action of ['signUp', 'signIn', 'reset', 'resend']) {
    const out = await w.answer({ action, email: KNOWN, password: 'right password', invite: INVITE });
    assert.deepEqual(out.body, { field: 'action', error: 'the actions are requestCode and verifyCode' }, action);
  }
  assert.ok(!w.calls.some((c) => !c.startsWith('service')), 'a password request reached Auth');
  // Nor does a code request carry one on to Auth.
  const asked = await w.answer({ action: 'requestCode', email: KNOWN, invite: INVITE, password: 'sneaked in' });
  await asked.later?.();
  assert.ok(!w.calls.some((c) => c.includes('sneaked in')));
});

test('a login whose invite was spent signs in with no account, and is told the way out', async () => {
  const w = world();
  const spent = new DatabaseError('open_account: that invite opens nothing', 'P0001', 400, 'that invite opens nothing', REFUSAL_HINT);
  const out = await runAccount({
    auth: { ...noAuth, verifyCode: async () => ({ session: { access_token: 't', refresh_token: 'r', expires_in: 1, user: { id: 'u', user_metadata: {} } } }) },
    service: { rpc: async () => { throw new Error('unused'); } },
    player: () => ({ rpc: async () => { throw spent; } }),
    clock: w.clock,
  }, { action: 'verifyCode', email: KNOWN, code: CODE });
  assert.equal(out.status, 200);
  const body = out.body as { account: boolean; why: string };
  assert.equal(body.account, false);
  assert.match(body.why, /that invite opens nothing.*another invite/);
});

test('a login with no invite in its metadata opens its account with none; a database failure is a retry-later', async () => {
  const w = world();
  const calls: string[] = [];
  const plain = { access_token: 't', refresh_token: 'r', expires_in: 1, user: { id: 'u' } };
  const base: Auth = { ...noAuth, verifyCode: async () => ({ session: plain }) };
  const out = await runAccount({ auth: base, service: { rpc: async () => null as never }, player: () => ({ rpc: async <T>(fn: string, args: Record<string, unknown>) => { calls.push(`${fn}:${JSON.stringify(args)}`); return { opened: true } as T; } }), clock: w.clock },
    { action: 'verifyCode', email: KNOWN, code: CODE });
  assert.equal(out.status, 200);
  assert.deepEqual(calls, ['open_account:{"code":null}']);
  const broken = await runAccount({ auth: base, service: { rpc: async () => null as never }, player: () => ({ rpc: async () => { throw new DatabaseError('open_account: boom', '42P01', 500); } }), clock: w.clock },
    { action: 'verifyCode', email: KNOWN, code: CODE });
  assert.deepEqual([broken.status, broken.body], [503, { error: 'signing in is not working right now; try again' }]);
});

test('a login signing in while registration is closed is told its way out is an admin\'s, not another invite', async () => {
  const w = world();
  const closed = new DatabaseError('open_account: registration is closed', 'P0001', 400, 'registration is closed', REFUSAL_HINT);
  const out = await runAccount({
    auth: { ...noAuth, verifyCode: async () => ({ session: { access_token: 't', refresh_token: 'r', expires_in: 1, user: { id: 'u', user_metadata: {} } } }) },
    service: { rpc: async () => { throw new Error('unused'); } },
    player: () => ({ rpc: async () => { throw closed; } }),
    clock: w.clock,
  }, { action: 'verifyCode', email: KNOWN, code: CODE });
  const body = out.body as { account: boolean; why: string };
  assert.equal(body.account, false);
  assert.match(body.why, /registration is closed; when an admin opens it again, your next sign-in opens your account/);
  assert.doesNotMatch(body.why, /another invite/);
});

test('a malformed request is refused by its field, in the same time as any answer', async () => {
  const w = world();
  for (const [request, field] of [
    [{ action: 'requestCode', email: 'no-at-sign', invite: INVITE }, 'email'],
    [{ action: 'requestCode' }, 'email'],
    [{ action: 'verifyCode', email: UNKNOWN }, 'code'],
    [{ action: 'verifyCode', email: UNKNOWN, code: 'abc' }, 'code'],
    [{ action: 'verifyCode', email: UNKNOWN, code: '1'.repeat(11) }, 'code'],
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
  const slow: Auth = { ...noAuth, verifyCode: async () => { now += ANSWER_FLOOR_MS + 7; return { refused: 'code' }; } };
  const out = await runAccount({ auth: slow, service: { rpc: async () => null as never }, player: () => ({ rpc: async () => null as never }), clock }, { action: 'verifyCode', email: KNOWN, code: CODE });
  assert.equal(out.status, 400);
  assert.equal(now, 2 * ANSWER_FLOOR_MS);
});

test('Auth failing to answer a code is a plain retry-later, in the same time', async () => {
  let now = 0;
  const clock = { now: () => now, sleep: async (ms: number) => { now += ms; } };
  const down: Auth = { ...noAuth, verifyCode: async () => { throw new Error('upstream 503'); } };
  const out = await runAccount({ auth: down, service: { rpc: async () => null as never }, player: () => ({ rpc: async () => null as never }), clock }, { action: 'verifyCode', email: KNOWN, code: CODE });
  assert.deepEqual([out.status, out.body, now], [503, { error: 'signing in is not working right now; try again' }, ANSWER_FLOOR_MS]);
});
