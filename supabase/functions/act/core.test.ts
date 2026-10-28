import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAction } from './core.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { instance } from '../_shared/instance.ts';

const id = '11111111-1111-4111-8111-111111111111';
const recording = (answer: unknown = { id }) => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: Db = { rpc: async <T>(fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return answer as T; } };
  return { db, calls };
};

test('a decided action calls its SQL function as the player and answers with what it returned', async () => {
  const { db, calls } = recording({ id, kind: 'post' });
  const out = await runAction(db, instance, { action: 'post', thread: id, character: id, body: 'Hello.' });
  assert.deepEqual(out, { status: 200, body: { id, kind: 'post' } });
  assert.deepEqual(calls, [{ fn: 'post', args: { in_thread: id, through: id, body: 'Hello.', quoting: null } }]);
});

test('a refused decision never reaches the database, and says which field', async () => {
  const { db, calls } = recording();
  const out = await runAction(db, instance, { action: 'post', thread: id, character: id, body: '' });
  assert.equal(out.status, 400);
  assert.deepEqual(out.body, { field: 'body', error: 'is empty' });
  assert.equal(calls.length, 0);
});

test('the database\'s refusal is answered in its own words, never PostgREST\'s detail', async () => {
  const db: Db = { rpc: async () => { throw new DatabaseError('post: you do not play that character (Key (owner)=(x))', '42501', 403, 'you do not play that character'); } };
  const out = await runAction(db, instance, { action: 'post', thread: id, character: id, body: 'Hello.' });
  assert.deepEqual(out, { status: 403, body: { error: 'you do not play that character', code: '42501' } });
});

test('anything else that fails is a plain 500 that carries nothing from inside', async () => {
  const db: Db = { rpc: async () => { throw new TypeError('socket hang up at 10.0.0.5'); } };
  const out = await runAction(db, instance, { action: 'post', thread: id, character: id, body: 'Hello.' });
  assert.deepEqual(out, { status: 500, body: { error: 'the action could not be completed; try again' } });
});
