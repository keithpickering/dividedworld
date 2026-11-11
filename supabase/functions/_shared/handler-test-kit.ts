/**
 * What the scheduled functions' handler tests share: deps whose every part is a fake that writes down what it was handed (as
 * meet/core.test.ts builds its fake Db and Models), a request builder, and the two refusals every jobs-key handler gives.
 * Not a test itself: the build's test glob takes `*.test.ts`.
 */
import assert from 'node:assert/strict';
import { instance as dividedWorld } from '../_shared/instance.ts';
import type { Db } from '../_shared/rpc.ts';
import type { Environment } from '../_shared/serve.ts';
import type { JobDeps } from '../_shared/handler.ts';
import type { Models } from '../../../engine/system/model.ts';

export const KEY = 'sb_secret_test_jobs_key';
export const VARS: Record<string, string> = { SUPABASE_URL: 'http://db.test', SUPABASE_SECRET_KEY: KEY, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
/** The tiers the fake database holds; a handler must build its models with these and no others. */
export const TIERS = { strong: 'tier-strong-from-the-database', light: 'tier-light-from-the-database' };
export const SLOT = '2026-11-01T09:23:00.000Z';

export type Call = { fn: string; args: Record<string, any> };

/** Deps whose every part is a fake that writes down what it was handed (as meet/core.test.ts builds its fake Db and Models). */
export function fakeDeps(answer: (fn: string, args: Record<string, any>) => unknown, extra: Partial<JobDeps> = {}) {
  const calls: Call[] = [];
  const dbs: { env: Environment; safeToRepeat?: (fn: string) => boolean }[] = [];
  const built: { read: JobDeps['env']; record: unknown; options: any }[] = [];
  const db: Db = {
    async rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
      calls.push({ fn, args });
      if (fn === 'instance_settings') return { economy: dividedWorld.settings.economy, systemEnabled: true, modelTiers: TIERS } as T;
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
  return { deps, calls, dbs, built };
}

export const post = (body: unknown, key: string | null = KEY, url = 'http://fn.test/') =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key === null ? {} : { apikey: key }) }, body: typeof body === 'string' ? body : JSON.stringify(body) });

export async function refusals(handle: (request: Request, deps: JobDeps) => Promise<Response>, field: 'slot' | 'until', what: string) {
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
