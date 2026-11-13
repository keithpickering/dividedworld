import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSeed } from './core.ts';
import { DatabaseError, TransportError, type Db } from '../_shared/rpc.ts';
import { instance } from '../_shared/instance.ts';

const COUNTS = { classes: 3, cards: 9 };
/** A fake database that answers seed_instance and instance_settings as given and writes down every call. */
function fake(seed: () => unknown, settings: () => unknown = () => ({ economy: instance.settings.economy })) {
  const calls: string[] = [];
  const db: Db = { rpc: async <T>(fn: string) => { calls.push(fn); return (fn === 'seed_instance' ? seed() : settings()) as T; } };
  return { db, calls };
}

test('seeded and whole: 200 with the counts seed_instance returned', async () => {
  const { db, calls } = fake(() => COUNTS);
  assert.deepEqual(await runSeed(db, instance), { status: 200, body: COUNTS });
  assert.deepEqual(calls, ['seed_instance', 'instance_settings']);
});

test('an economy the rows hold without laughTrack makes the seed 422, naming laughTrack.perPlace (2026-11-12)', async () => {
  // The economy is flat, its keys dotted: every laughTrack key is missing, as in the row that was never given them.
  const economy = Object.fromEntries(Object.entries(instance.settings.economy).filter(([k]) => !k.startsWith('laughTrack.')));
  const { db } = fake(() => COUNTS, () => ({ economy }));
  const r = await runSeed(db, instance);
  assert.equal(r.status, 422);
  const body = r.body as { error: string; problems: string[] };
  assert.equal(body.error, 'the seeded instance is not whole');
  assert.ok(body.problems.length > 0 && body.problems.some((p) => p.includes('laughTrack.perPlace')), JSON.stringify(body.problems));
  assert.ok(body.problems.every((p) => !p.includes('; the settings rows')), 'each problem is its own entry');
});

test('a seed_instance refusal is a 422 with its message, and the settings are never read', async () => {
  const { db, calls } = fake(() => { throw new DatabaseError('seed_instance: a reaction kind is in use', 'P0001', 400); });
  const r = await runSeed(db, instance);
  assert.equal(r.status, 422);
  assert.deepEqual(r.body, { error: 'seed_instance: a reaction kind is in use' });
  assert.deepEqual(calls, ['seed_instance']);
});

test('a transport failure is rethrown, never a 422: a fetch that never answered, and a 5xx from PostgREST', async () => {
  await assert.rejects(runSeed(fake(() => { throw new TransportError('seed_instance: no answer after 4 attempt(s)'); }).db, instance), TransportError);
  await assert.rejects(runSeed(fake(() => { throw new DatabaseError('seed_instance: HTTP 500', '', 500); }).db, instance), DatabaseError);
  await assert.rejects(runSeed(fake(() => COUNTS, () => { throw new TransportError('instance_settings: no answer'); }).db, instance), TransportError);
});
