import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './handler.ts';
import { KEY, SLOT, TIERS, fakeDeps, post, refusals } from '../_shared/handler-test-kit.ts';

test('chatter: the refusals', () => refusals(handle, 'slot', 'the pool is run by the service'));

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
