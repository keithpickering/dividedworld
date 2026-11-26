import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asJob } from './job.ts';
import { KEY, fakeDeps, post } from './handler-test-kit.ts';

const answering = (status: number) => async () => new Response(JSON.stringify({ ran: true }), { status, headers: { 'Content-Type': 'application/json' } });
const recorded = (d: ReturnType<typeof fakeDeps>) => d.calls.filter((c) => c.fn === 'record_job_run');

test('asJob: a 200 records once with the job\'s name, through the service\'s database, and the answer is the handler\'s', async () => {
  const d = fakeDeps(() => null);
  const res = await asJob('kayfabb-settle', answering(200))(post({}), d.deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ran: true });
  assert.deepEqual(recorded(d), [{ fn: 'record_job_run', args: { job: 'kayfabb-settle' } }]);
  assert.equal(d.dbs.at(-1)!.env.secret, KEY);
});

for (const status of [400, 401, 500]) {
  test(`asJob: a ${status} is returned untouched and records nothing`, async () => {
    const d = fakeDeps(() => null);
    const res = await asJob('kayfabb-meet', answering(status))(post({}), d.deps);
    assert.equal(res.status, status);
    assert.deepEqual(await res.json(), { ran: true });
    assert.equal(recorded(d).length, 0);
  });
}

test('asJob: a record that throws turns a 200 into a 500 saying so, and logs the job without the error\'s secrets', async () => {
  const kit = fakeDeps(() => null);
  const failing = { rpc: async () => { throw new Error('database down'); } } as unknown as ReturnType<typeof kit.deps.db>;
  const d = { ...kit, deps: { ...kit.deps, db: () => failing } };
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => { logged.push(a); };
  try {
    const res = await asJob('kayfabb-write', answering(200))(post({}), d.deps);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'the run finished but its heartbeat was not recorded' });
  } finally { console.error = original; }
  assert.deepEqual(logged, [['job health not recorded', 'kayfabb-write', 'database down']]);
});

test('asJob: a 200 to a caller without the jobs key (a player through staff\'s report door) is no heartbeat and records nothing', async () => {
  for (const key of [null, 'a-player-session-token']) {
    const d = fakeDeps(() => null);
    const res = await asJob('kayfabb-staff', answering(200))(post({}, key, 'http://fn.test/staff/report'), d.deps);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ran: true });
    assert.equal(recorded(d).length, 0);
  }
});
