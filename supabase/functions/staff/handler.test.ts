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
