import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './handler.ts';
import { instance as dividedWorld } from '../_shared/instance.ts';
import { KEY, SLOT, TIERS, fakeDeps, post, refusals } from '../_shared/handler-test-kit.ts';

test('staff: a request without the jobs key and without a session goes to the report door and is answered 401', async () => {
  const d = fakeDeps(() => null);
  const res = await handle(post({ slot: SLOT }, null), d.deps);
  assert.equal(res.status, 401);
  assert.equal(d.calls.length, 0, 'nothing is read as the service before the database has taken the report as the player');
});

test('staff: a body without a valid slot is a 400 and reads nothing', async () => {
  for (const bad of [{}, { slot: 5 }, { slot: 'not a time' }, 'not json']) {
    const d = fakeDeps(() => null);
    const res = await handle(post(bad), d.deps);
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /^slot: /);
    assert.equal(d.dbs.length + d.calls.length, 0);
  }
});

test('staff: a good request runs the filings, then the patrols, then the apologies, on deps.db with the WRITES set and models built with the database tiers', async () => {
  const d = fakeDeps((fn) => {
    switch (fn) {
      case 'refund_stale_reports': case 'refund_stale_appeals': return 0;
      case 'filings_due': return [];
      case 'judgment_load_today': return 1_000_000; // the patrols' day is spent: they claim nothing
      case 'pending_apologies': return [];
      default: throw new Error(`the fake database has no ${fn}`);
    }
  });
  const res = await handle(post({ slot: SLOT }), d.deps);
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.status, 'ok');
  assert.equal(body.patrols.status, 'ok');
  assert.equal(body.apologies.status, 'ok');
  const order = d.calls.map((c) => c.fn).filter((fn) => fn !== 'instance_settings');
  assert.deepEqual(order, ['refund_stale_reports', 'refund_stale_appeals', 'filings_due', 'judgment_load_today', 'pending_apologies']);
  assert.equal(d.dbs.length, 1);
  assert.equal(d.dbs[0]!.env.secret, KEY);
  const safe = d.dbs[0]!.safeToRepeat!;
  for (const w of ['record_model_call', 'record_staff_call', 'record_patrol_call', 'claim_patrol']) assert.equal(safe(w), false, w);
  assert.equal(safe('file_visit'), true);
  assert.deepEqual(d.built.map((b) => b.options.tiers), [TIERS]);
  assert.equal(d.built[0]!.options.fetch, d.deps.fetch);
});

test('staff: a throw is a 500 naming the slot and nothing else', async () => {
  const d = fakeDeps((fn) => { if (fn === 'refund_stale_reports') throw new Error('secret detail'); return null; });
  const res = await handle(post({ slot: SLOT }), d.deps);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'the filing run failed', slot: SLOT });
});

// The player's doors: a request with no jobs key and the player's session. The player's own client is built inside the handler
// (key: the publishable key, bearer: the session) and sends through globalThis.fetch, which these tests stand in for.
const THROUGH = '11111111-1111-4111-8111-111111111111';
const POST = '22222222-2222-4222-8222-222222222222';
const BOARD = '33333333-3333-4333-8333-333333333333';
const MOD = dividedWorld.system.roster.find((p) => p.key !== dividedWorld.system.firstBoss)!.key;

async function atTheDoor(path: string, body: unknown, d: ReturnType<typeof fakeDeps>) {
  const asked: { url: string; key: string | null; bearer: string | null }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    asked.push({ url: String(url), key: h.get('apikey'), bearer: h.get('Authorization') });
    const opened = { report: POST, appeal: POST, post: POST, thread: POST, staff: MOD, reason: 'r', plea: 'p', details: { band: 'warning', points: 1, rule: 'r', filed_by: MOD }, board: { id: BOARD, name: 'B', premise: 'P' }, reporter: { id: THROUGH, name: 'Rep' }, appellant: { id: THROUGH, name: 'App' } };
    return new Response(JSON.stringify(opened), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const res = await handle(new Request(`http://fn.test${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer the-session' }, body: JSON.stringify(body) }), d.deps);
    return { res, asked };
  } finally { globalThis.fetch = real; }
}

function doorDb(fn: string) {
  switch (fn) {
    case 'mod_standing': return { office: 'mod', allowance: 1, order: null, beat: [{ id: BOARD, name: 'B' }] };
    case 'staff_career': return { led: [], offices: [] };
    case 'staff_memory_latest': case 'staff_memory_at': return null;
    case 'staff_notes_recent': case 'rules_in_force': return [];
    case 'pool_thread': return { title: 'T', posts: [{ act: POST, name: 'A', pronouns: null, body: 'x' }] };
    case 'character_faces': return {};
    case 'mod_group_context': return { conferred: [], characters: [] };
    case 'refund_report': case 'refund_appeal': return { refunded: true };
    default: return null;
  }
}

test('staff: /staff/appeal goes to the appeal door and any other path to the report door, each opening as the player with the publishable key', async () => {
  const appeal = fakeDeps(doorDb);
  const a = await atTheDoor('/staff/appeal', { through: THROUGH, punishment: POST, plea: 'sorry' }, appeal);
  assert.deepEqual(a.asked.map((x) => x.url), ['http://db.test/rest/v1/rpc/open_appeal']);
  assert.equal(a.asked[0]!.key, 'sb_publishable_test');
  assert.equal(a.asked[0]!.bearer, 'Bearer the-session');
  const report = fakeDeps(doorDb);
  const r = await atTheDoor('/staff', { through: THROUGH, post: POST, reason: 'rude' }, report);
  assert.deepEqual(r.asked.map((x) => x.url), ['http://db.test/rest/v1/rpc/open_report']);
});

test('staff: the door\'s service client never repeats a write, and its models get deps.fetch and the database tiers', async () => {
  for (const [path, body] of [['/staff', { through: THROUGH, post: POST, reason: 'rude' }], ['/staff/appeal', { through: THROUGH, punishment: POST, plea: 'sorry' }]] as const) {
    const d = fakeDeps(doorDb);
    await atTheDoor(path, body, d);
    assert.equal(d.dbs.length, 1, path);
    assert.equal(d.dbs[0]!.env.secret, KEY);
    for (const w of ['record_model_call', 'record_staff_call', 'record_patrol_call', 'claim_patrol']) assert.equal(d.dbs[0]!.safeToRepeat!(w), false, w);
    assert.equal(d.dbs[0]!.safeToRepeat!('refund_report'), true);
    assert.deepEqual(d.built.map((b) => b.options.tiers), [TIERS], path);
    assert.equal(d.built[0]!.options.fetch, d.deps.fetch, path);
  }
});
