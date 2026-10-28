import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REFUSAL_HINT, runAction } from './core.ts';
import { DatabaseError, type Db } from '../_shared/rpc.ts';
import { instance } from '../_shared/instance.ts';

const id = '11111111-1111-4111-8111-111111111111';
const recording = (answer: unknown = { id }) => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db: Db = { rpc: async <T>(fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return answer as T; } };
  return { db, calls };
};
/** A player's Db and the service's, answering by function, recording which was asked. */
function pair(answers: Record<string, unknown>) {
  const calls: string[] = [];
  const make = (who: string): Db => ({ rpc: async <T>(fn: string, args: Record<string, unknown>) => { calls.push(`${who}:${fn}:${JSON.stringify(args)}`); return answers[fn] as T; } });
  return { dbs: { player: make('player'), service: make('service') }, calls };
}

test('a decided action calls its SQL function as the player and answers with what it returned', async () => {
  const { db, calls } = recording({ id, kind: 'post' });
  const out = await runAction({ player: db, service: db }, instance, { action: 'post', thread: id, character: id, body: 'Hello.' });
  assert.deepEqual({ status: out.status, body: out.body }, { status: 200, body: { id, kind: 'post' } });
  assert.deepEqual(calls, [{ fn: 'post', args: { in_thread: id, through: id, body: 'Hello.', quoting: null } }]);
});

test('a refused decision never reaches the database, and says which field', async () => {
  const { db, calls } = recording();
  const out = await runAction({ player: db, service: db }, instance, { action: 'post', thread: id, character: id, body: '' });
  assert.equal(out.status, 400);
  assert.deepEqual(out.body, { field: 'body', error: 'is empty' });
  assert.equal(calls.length, 0);
});

test('the database\'s refusal is answered in its own words, never PostgREST\'s detail', async () => {
  const db: Db = { rpc: async () => { throw new DatabaseError('post: you do not play that character (Key (owner)=(x))', '42501', 403, 'you do not play that character', REFUSAL_HINT); } };
  const out = await runAction({ player: db, service: db }, instance, { action: 'post', thread: id, character: id, body: 'Hello.' });
  assert.deepEqual(out, { status: 403, body: { error: 'you do not play that character', code: '42501' } });
});

test('a database error that is not a refusal meant for a player is answered with nothing from inside', async () => {
  for (const [code, status, message] of [['23505', 409, 'duplicate key value violates unique constraint "acts_one_card_per_post"'], ['PGRST202', 404, 'Could not find the function public.post'], ['42501', 403, 'permission denied for table characters']] as const) {
    const db: Db = { rpc: async () => { throw new DatabaseError(`post: ${message}`, code, status, message); } };
    const out = await runAction({ player: db, service: db }, instance, { action: 'post', thread: id, character: id, body: 'Hello.' });
    assert.deepEqual(out, { status: 500, body: { error: 'the action could not be completed; try again' } }, code);
  }
});

test('anything else that fails is a plain 500 that carries nothing from inside', async () => {
  const db: Db = { rpc: async () => { throw new TypeError('socket hang up at 10.0.0.5'); } };
  const out = await runAction({ player: db, service: db }, instance, { action: 'post', thread: id, character: id, body: 'Hello.' });
  assert.deepEqual(out, { status: 500, body: { error: 'the action could not be completed; try again' } });
});

const target = '22222222-2222-4222-8222-222222222222';
const whoami = '33333333-3333-4333-8333-333333333333';

test('a play asks the post, prices it by the card\'s own rules, and is written by the service for the caller', async () => {
  const { dbs, calls } = pair({ whoami, card_target: { act: target, kind: 'post', length: 1200, effects: [] }, play_card: { id: 'k', kind: 'card' } });
  const out = await runAction(dbs, instance, { action: 'playCard', card: 'whoops', character: id, target, config: { color: 'Red' } });
  assert.deepEqual({ status: out.status, body: out.body }, { status: 200, body: { id: 'k', kind: 'card' } });
  assert.deepEqual(calls, [
    `player:whoami:{}`,
    `player:card_target:{"target":"${target}"}`,
    `service:play_card:${JSON.stringify({ card: 'whoops', through: id, target, config: { color: 'red' }, who: whoami, price: 50 })}`,
  ]);
});

test('a play its card refuses never reaches the service', async () => {
  const { dbs, calls } = pair({ whoami, card_target: { act: target, kind: 'post', length: 10, effects: [{ card: 'whoops', act: 'k0' }] } });
  const out = await runAction(dbs, instance, { action: 'playCard', card: 'whoops', character: id, target, config: { color: 'red' } });
  assert.equal(out.status, 400);
  assert.match(String((out.body as { error: string }).error), /already/);
  assert.ok(!calls.some((c) => c.startsWith('service:')));
});

test('a purchase is the service\'s, for whoever the session is', async () => {
  const { dbs, calls } = pair({ whoami, buy_card: { card: 'whoops', balance: 0 } });
  await runAction(dbs, instance, { action: 'buyCard', card: 'whoops' });
  assert.equal(calls[1], `service:buy_card:${JSON.stringify({ card: 'whoops', price: 100, who: whoami })}`);
});

test('a session with no account behind it acts as nobody', async () => {
  const { dbs, calls } = pair({ whoami: null });
  const out = await runAction(dbs, instance, { action: 'buyCard', card: 'whoops' });
  assert.equal(out.status, 401);
  assert.equal(calls.length, 1);
});

test('strokes are checked by the card that was played, and saved by the service', async () => {
  const { dbs, calls } = pair({ whoami, card_of_play: 'whoops', save_effect_state: { play: target } });
  const bad = await runAction(dbs, instance, { action: 'saveEffect', play: target, character: id, state: { strokes: 'all' } });
  assert.equal(bad.status, 400);
  const good = await runAction(dbs, instance, { action: 'saveEffect', play: target, character: id, state: { strokes: [] } });
  assert.equal(good.status, 200);
  assert.ok(calls.at(-1)!.startsWith('service:save_effect_state:'));
  const none = pair({ whoami, card_of_play: 'stick-around' });
  const stateless = await runAction(none.dbs, instance, { action: 'saveEffect', play: target, character: id, state: {} });
  assert.equal(stateless.status, 400, 'Stick Around keeps no state');
});

test('what an action wrote is broadcast as its public projection, on its thread\'s or board\'s channel; a purchase never is', async () => {
  const thread = '44444444-4444-4444-8444-444444444444';
  const board = '55555555-5555-4555-8555-555555555555';
  const cases: [unknown, Record<string, unknown>, unknown][] = [
    [{ action: 'post', thread: id, character: id, body: 'x' }, { post: { id: 'a', thread } }, [{ topic: `thread:${thread}`, event: 'act', payload: { id: 'a', thread } }]],
    [{ action: 'react', act: id, character: id, kind: 'fire' }, { react: { act: id, thread, tally: { fire: 1 } } }, [{ topic: `thread:${thread}`, event: 'tally', payload: { act: id, tally: { fire: 1 } } }]],
    [{ action: 'startThread', board: 'general', character: id, title: 't', body: 'b' }, { start_thread: { thread: { id: thread, board }, act: { id: 'a', thread } } },
      [{ topic: `board:${board}`, event: 'thread', payload: { id: thread, board } }, { topic: `thread:${thread}`, event: 'act', payload: { id: 'a', thread } }]],
    [{ action: 'turn', character: id, class: 'heel', loudness: 'silent' }, { turn: { turned: true, loudness: 'silent' } }, []],
    [{ action: 'turn', character: id, class: 'heel', loudness: 'announced' }, { turn: { turned: true, act: { id: 'a', thread } } }, [{ topic: `thread:${thread}`, event: 'act', payload: { id: 'a', thread } }]],
    [{ action: 'turn', character: id, class: 'heel', loudness: 'announced' }, { turn: { turned: true, thread: { id: thread, board }, act: { id: 'a', thread } } },
      [{ topic: `board:${board}`, event: 'thread', payload: { id: thread, board } }, { topic: `thread:${thread}`, event: 'act', payload: { id: 'a', thread } }]],
    [{ action: 'buyCard', card: 'whoops' }, { whoami: id, buy_card: { card: 'whoops', balance: 0, held: 1 } }, []],
    [{ action: 'saveEffect', play: id, character: id, state: { strokes: [] } }, { whoami: id, card_of_play: 'whoops', save_effect_state: { play: id, thread, state: { strokes: [] } } },
      [{ topic: `thread:${thread}`, event: 'effect', payload: { play: id, state: { strokes: [] } } }]],
  ];
  for (const [request, answers, broadcasts] of cases) {
    const { dbs } = pair(answers);
    const out = await runAction(dbs, instance, request);
    assert.equal(out.status, 200, JSON.stringify(request));
    assert.deepEqual(out.broadcasts ?? [], broadcasts, JSON.stringify(request));
  }
});
