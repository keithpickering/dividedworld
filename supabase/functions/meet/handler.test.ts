import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './handler.ts';
import { instance as dividedWorld } from '../_shared/instance.ts';
import type { Db } from '../_shared/rpc.ts';
import type { Environment } from '../_shared/serve.ts';
import type { JobDeps } from '../_shared/handler.ts';
import type { Models } from '../../../engine/system/model.ts';

const KEY = 'sb_secret_test_jobs_key';
const VARS: Record<string, string> = { SUPABASE_URL: 'http://db.test', SUPABASE_SECRET_KEY: KEY, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
/** The tiers the fake database holds; a handler must build its models with these and no others. */
const TIERS = { strong: 'tier-strong-from-the-database', light: 'tier-light-from-the-database' };
const SLOT = '2026-11-01T09:23:00.000Z';

type Call = { fn: string; args: Record<string, any> };

/** Deps whose every part is a fake that writes down what it was handed (as meet/core.test.ts builds its fake Db and Models). */
function fakeDeps(answer: (fn: string, args: Record<string, any>) => unknown, o: { enabled?: boolean } & Partial<JobDeps> = {}) {
  const { enabled = true, ...extra } = o;
  const calls: Call[] = [];
  const dbs: { env: Environment; safeToRepeat?: (fn: string) => boolean }[] = [];
  const built: { read: JobDeps['env']; record: unknown; options: any }[] = [];
  const db: Db = {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ fn, args });
      if (fn === 'instance_settings') return { economy: dividedWorld.settings.economy, systemEnabled: enabled, modelTiers: TIERS } as T;
      return answer(fn, args) as T;
    },
  };
  const models: Models = {
    async chat() { throw new Error('the fake models were asked a chat'); },
    async complete() { throw new Error('the fake models were asked a completion'); },
  };
  const deps: JobDeps = {
    env: (name) => VARS[name],
    db: (env, options) => { dbs.push({ env, safeToRepeat: options?.safeToRepeat }); return db; },
    models: ((read: JobDeps['env'], record: unknown, options: unknown) => { built.push({ read, record, options }); return models; }) as JobDeps['models'],
    fetch: (async () => { throw new Error('no network in this test'); }) as typeof fetch,
    broadcaster: (() => { throw new Error('no broadcaster in this test'); }) as unknown as JobDeps['broadcaster'],
    ...extra,
  };
  return { deps, calls, dbs, built, models };
}

const post = (body: unknown, key: string | null = KEY, url = 'http://fn.test/') =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key === null ? {} : { apikey: key }) }, body: typeof body === 'string' ? body : JSON.stringify(body) });

async function refusals(field: 'slot' | 'until', what: string) {
  const d = fakeDeps(() => null);
  const good = { [field]: SLOT };
  const res = await handle(post(good, 'not-the-key'), d.deps);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: what });
  assert.equal((await handle(post(good, null), d.deps)).status, 401, 'no key at all is refused the same');
  assert.equal(d.dbs.length + d.calls.length, 0, 'nothing is built or read for a caller that is not the service');
  for (const bad of [{}, { [field]: 5 }, { [field]: 'not a time' }, 'not json']) {
    const e = fakeDeps(() => null);
    const r = await handle(post(bad), e.deps);
    assert.equal(r.status, 400);
    assert.match(((await r.json()) as { error: string }).error, new RegExp(`^${field}: `));
    assert.equal(e.dbs.length + e.calls.length, 0);
  }
}

test('meet: the refusals', () => refusals('slot', 'the meeting is run by the service'));

test('meet: a good request runs the meeting on the database deps.db made, with models built with the tiers the database holds, and reads feeds through deps.fetch', async () => {
  const fetched: string[] = [];
  const d = fakeDeps((fn) => {
    switch (fn) {
      case 'begin_meeting': return { status: 'begun', meeting: 7 };
      case 'fail_meeting': return { status: 'closed' };
      case 'meeting_context': return { season: { startsAt: Date.now() - 1e9, endsAt: Date.now() + 1e10 }, boss: dividedWorld.system.firstBoss, lastSlot: null, boards: [], successors: [] };
      case 'system_digest': return { since: SLOT, until: SLOT, threads: [], standings: [], moves: [], quotes: [], bossReactions: [], excerpts: [], characters: [] };
      case 'staff_memory_latest': return null;
      case 'staff_career': return { led: [], offices: [] };
      case 'staff_notes_recent': return [];
      case 'bank_now': return 5;
      default: throw new Error(`the fake database has no ${fn}`);
    }
  }, { fetch: (async (url: unknown) => { fetched.push(String(url)); throw new Error('feed down'); }) as typeof fetch });
  const res = await handle(post({ slot: SLOT }), d.deps);
  assert.equal(res.status, 200);
  // The fake models fail the chat: the meeting closes failed, answered 200 with the outcome, as the deployed function does.
  assert.equal(((await res.json()) as { status: string }).status, 'failed');
  assert.equal(d.dbs.length, 1);
  assert.equal(d.dbs[0]!.env.url, 'http://db.test');
  assert.equal(d.dbs[0]!.env.secret, KEY);
  assert.equal(d.dbs[0]!.safeToRepeat, undefined, 'the meeting asks for the default client');
  assert.equal(d.built.length, 1);
  assert.equal(d.built[0]!.read('SUPABASE_URL'), 'http://db.test', 'the models read their keys through deps.env');
  assert.deepEqual(d.built[0]!.options.tiers, TIERS);
  assert.equal(d.built[0]!.options.fetch, d.deps.fetch);
  assert.ok(d.calls.some((c) => c.fn === 'begin_meeting' && c.args.slot === SLOT));
  assert.ok(fetched.length > 0);
  assert.deepEqual(fetched, dividedWorld.system.feeds.map((f) => f.url), 'the feeds are read through deps.fetch');
});

test('meet: a throw is a 500 naming the slot and nothing else', async () => {
  const d = fakeDeps((fn) => { if (fn === 'begin_meeting') throw new Error('secret detail'); return null; });
  const res = await handle(post({ slot: SLOT }), d.deps);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'the meeting failed and was closed as failed', slot: SLOT });
});
