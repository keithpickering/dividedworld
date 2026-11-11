import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './handler.ts';
import { KEY, TIERS, fakeDeps, post } from '../_shared/handler-test-kit.ts';

test('write: a caller that is not the service is refused, and nothing is built or read', async () => {
  const d = fakeDeps(() => null);
  const res = await handle(post({}, 'not-the-key'), d.deps);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'card texts are written by the service' });
  assert.equal((await handle(post({}, null), d.deps)).status, 401, 'no key at all is refused the same');
  assert.equal(d.dbs.length + d.calls.length, 0);
});

test('write: a good request claims on deps.db, builds its models from deps with the database\'s tiers, and answers counts alone', async () => {
  const d = fakeDeps((fn) => {
    if (fn === 'claim_card_writes') return [];
    throw new Error(`the fake database has no ${fn}`);
  });
  const res = await handle(post({}), d.deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { claimed: 0, written: 0, failed: 0, errored: 0 });
  assert.equal(d.dbs.length, 1);
  assert.equal(d.dbs[0]!.env.secret, KEY);
  assert.equal(d.dbs[0]!.safeToRepeat!('record_model_call'), false, 'the ledger\'s write is sent once');
  assert.equal(d.dbs[0]!.safeToRepeat!('finish_card_write'), true, 'a second finish writes nothing, so it may be sent again');
  assert.equal(d.built.length, 1);
  assert.equal(d.built[0]!.read, d.deps.env, 'the adapters read the environment they were handed');
  assert.deepEqual(d.built[0]!.options.tiers, TIERS);
  assert.equal(d.built[0]!.options.fetch, d.deps.fetch, 'the adapters call through deps.fetch');
  assert.ok(d.calls.some((c) => c.fn === 'claim_card_writes' && c.args.most >= 1 && c.args.most <= 16), 'no more is claimed than a round holds');
});

test('write: a throw is a 500 that says what happens next and nothing else', async () => {
  const d = fakeDeps((fn) => { if (fn === 'claim_card_writes') throw new Error('secret detail'); return null; });
  const res = await handle(post({}), d.deps);
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: 'the writing failed; claimed jobs are taken again when their claim runs out' });
});
