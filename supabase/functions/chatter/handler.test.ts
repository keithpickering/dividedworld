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

test('chatter: the refusals', () => refusals('slot', 'the pool is run by the service'));

test('chatter: a good request runs the pool on deps.db with the WRITES set, and models built with the tiers the database holds', async () => {
  const d = fakeDeps((fn) => { if (fn === 'claim_pool_run') return null; throw new Error(`the fake database has no ${fn}`); });
  const res = await handle(post({ slot: SLOT }), d.deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'busy' });
  assert.equal(d.dbs.length, 1);
  assert.equal(d.dbs[0]!.env.secret, KEY);
  const safe = d.dbs[0]!.safeToRepeat!;
  for (const w of ['write_staff_act', 'write_staff_thread', 'staff_play_card', 'staff_set_card', 'write_staff_note', 'record_pool_spend', 'claim_pool_run', 'record_model_call']) assert.equal(safe(w), false, w);
  assert.equal(safe('pool_context'), true);
  assert.deepEqual(d.built.map((b) => b.options.tiers), [TIERS]);
  assert.equal(d.built[0]!.options.fetch, d.deps.fetch);
  assert.equal(d.built[0]!.read('SUPABASE_URL'), 'http://db.test');
  assert.ok(d.calls.some((c) => c.fn === 'claim_pool_run'));
});

test('chatter: a throw is a 500 naming the slot and nothing else', async () => {
  const d = fakeDeps((fn) => { if (fn === 'claim_pool_run') throw new Error('secret detail'); return null; });
  const res = await handle(post({ slot: SLOT }), d.deps);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'the chatter failed', slot: SLOT });
});
