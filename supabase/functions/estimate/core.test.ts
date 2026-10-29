import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESTIMATE_HOLD_SECONDS, runEstimate } from './core.ts';
import { DatabaseError, TransportError, type Db } from '../_shared/rpc.ts';
import { instance } from '../_shared/instance.ts';

const me = '11111111-1111-4111-8111-111111111111';
const H = 3_600_000;
/** An open window in which another's fire lands on the caller's Face's post. */
const input = {
  player: 'you-key',
  window: { id: 'estimate', from: 0, to: 24 * H },
  characters: [{ id: 'mine', player: 'you-key', classes: [{ class: 'face', from: 0 }] }, { id: 'k1', player: 'k1', classes: [] }],
  acts: [{ id: 'p1', character: 'mine', kind: 'post', at: H, thread: 't' }],
  reactions: [{ act: 'p1', kind: 'fire', at: 2 * H, player: 'k1', character: 'k1' }],
  systemActs: [],
};

function dbs(answers: Record<string, unknown>) {
  const calls: string[] = [];
  const make = (who: string): Db => ({ rpc: async <T>(fn: string, args: Record<string, unknown>) => {
    calls.push(`${who}:${fn}:${JSON.stringify(args)}`);
    const a = fn === 'instance_settings' && !(fn in answers) ? { economy: instance.settings.economy } : answers[fn];
    if (a instanceof Error) throw a;
    return a as T;
  } });
  return { dbs: { player: make('player'), service: make('service') }, calls };
}

test('the estimate is the signed-in caller\'s, read by the service for them, valued by the engine, and kept', async () => {
  const { dbs: d, calls } = dbs({ whoami: me, estimate_kept: null, estimate_input: input, estimate_keep: null });
  const out = await runEstimate(d, instance);
  assert.equal(out.status, 200);
  assert.deepEqual(calls.filter((c) => !c.includes('instance_settings') && !c.includes('estimate_keep:')), [
    `player:whoami:{}`, `service:estimate_kept:{"account":"${me}","within_seconds":${ESTIMATE_HOLD_SECONDS}}`, `service:estimate_input:{"account":"${me}"}`]);
  assert.ok(calls.some((c) => c.startsWith(`service:estimate_keep:{"account":"${me}","answer":`)), 'the answer is kept for the next ask');
  const body = out.body as { entries: { character: string; reason: string; amount: number }[]; lines: { at?: number; amount: number }[] };
  assert.ok(body.entries.length > 0 && body.entries.every((e) => e.character === 'mine'), JSON.stringify(body));
  assert.ok(body.lines.some((l) => l.at === 2 * H), 'a line per reaction, with its time');
  assert.ok(!JSON.stringify(body).includes('k1') && !JSON.stringify(body).includes('you-key'), 'no key reaches the answer');
});

test('asked again within the hold, the kept estimate is the answer, and the window is not read again', async () => {
  const kept = { entries: [{ character: 'mine', reason: 'face.cheered', amount: 10 }], lines: [] };
  const { dbs: d, calls } = dbs({ whoami: me, estimate_kept: kept });
  assert.deepEqual(await runEstimate(d, instance), { status: 200, body: kept });
  assert.ok(!calls.some((c) => c.includes('estimate_input')), calls.join('\n'));
  assert.ok(ESTIMATE_HOLD_SECONDS >= 10, 'long enough that a crowd of reactions is one read, not one each');
});

test('a session with no account is answered as nobody; no window yet is an empty estimate', async () => {
  assert.equal((await runEstimate(dbs({ whoami: null }).dbs, instance)).status, 401);
  assert.deepEqual(await runEstimate(dbs({ whoami: me, estimate_kept: null, estimate_input: null }).dbs, instance), { status: 200, body: { entries: [], lines: [] } });
});

test('a failure says nothing from inside, and a lost answer says so', async () => {
  const broken = await runEstimate(dbs({ whoami: me, estimate_kept: null, estimate_input: new DatabaseError('estimate_input: relation "reactions" (detail)', 'XX000', 500) }).dbs, instance);
  assert.deepEqual(broken, { status: 500, body: { error: 'the estimate could not be read; try again' } });
  const lost = await runEstimate(dbs({ whoami: me, estimate_kept: null, estimate_input: new TransportError('no answer') }).dbs, instance);
  assert.equal(lost.status, 503);
});
