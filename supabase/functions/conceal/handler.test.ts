import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from './handler.ts';
import { KEY, fakeDeps, post } from '../_shared/handler-test-kit.ts';

test('conceal: a caller that is not the service is refused and nothing is read', async () => {
  const d = fakeDeps(() => null);
  const res = await handle(post({}, 'not-the-key'), d.deps);
  assert.equal(res.status, 401);
  assert.equal((await handle(post({}, null), d.deps)).status, 401);
  assert.equal(d.dbs.length + d.calls.length, 0);
});

test('conceal: due Acts get a layer through deps.db, and a 200 is recorded as the job\'s heartbeat', async () => {
  const d = fakeDeps((fn) => (fn === 'conceal_due' ? [{ act: 'a1', hidden: ['p1'], body: 'x [quote=p1]secret[/quote]' }] : null));
  const res = await handle(post({}), d.deps);
  assert.equal(res.status, 200);
  assert.equal(d.dbs[0]!.env.secret, KEY);
  const layer = d.calls.find((c) => c.fn === 'record_layer');
  assert.equal(layer?.args.act, 'a1');
  assert.deepEqual(layer?.args.hidden, ['p1']);
  assert.deepEqual(d.calls.map((c) => c.fn), ['conceal_due', 'record_layer', 'record_job_run']);
  assert.deepEqual(d.calls.at(-1)!.args, { job: 'kayfabb-conceal' });
});

test('conceal: a failed run is a 500 naming nothing of the failure, and is not recorded', async () => {
  const d = fakeDeps((fn) => { if (fn === 'conceal_due') throw new Error('secret detail'); return null; });
  const original = console.error;
  console.error = () => {};
  try {
    const res = await handle(post({}), d.deps);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'the conceal run failed; the Acts stay due for the next run' });
  } finally { console.error = original; }
  assert.equal(d.calls.some((c) => c.fn === 'record_job_run'), false);
});
