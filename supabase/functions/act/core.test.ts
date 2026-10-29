import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REFUSAL_HINT, SAFE_TO_REPEAT, actDbs, runAction } from './core.ts';
import { DatabaseError, TransportError, type Db } from '../_shared/rpc.ts';
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
  // The settings rows, unless a case gives its own, hold the code's economy, as a seed writes it.
  const make = (who: string): Db => ({ rpc: async <T>(fn: string, args: Record<string, unknown>) => {
    calls.push(`${who}:${fn}:${JSON.stringify(args)}`);
    return (fn === 'instance_settings' && !(fn in answers) ? { economy: instance.settings.economy } : answers[fn]) as T;
  } });
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
  for (const [code, status, message] of [['23505', 409, 'duplicate key value violates unique constraint "acts_card_layers"'], ['PGRST202', 404, 'Could not find the function public.post'], ['42501', 403, 'permission denied for table characters']] as const) {
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
  const out = await runAction(dbs, instance, { action: 'playCard', card: 'whoops', character: id, target, config: { color: 'Red', seed: 7 }, message: ' Clean that up. ' });
  assert.deepEqual({ status: out.status, body: out.body }, { status: 200, body: { id: 'k', kind: 'card' } });
  assert.deepEqual(calls, [
    `player:whoami:{}`,
    `service:instance_settings:{}`,
    `player:card_target:{"target":"${target}"}`,
    `service:play_card:${JSON.stringify({ card: 'whoops', through: id, target, config: { color: 'red' }, message: 'Clean that up.', who: whoami, price: 50 })}`,
  ]);
});

test('a play whose message is too long is refused by its field, and never written', async () => {
  const { dbs, calls } = pair({ whoami, card_target: { act: target, kind: 'post', length: 10, effects: [] } });
  const out = await runAction(dbs, instance, { action: 'playCard', card: 'whoops', character: id, target, config: { color: 'red' }, message: 'x'.repeat(201) });
  assert.deepEqual({ status: out.status, body: out.body }, { status: 400, body: { field: 'message', error: 'the message is at most 200 characters' } });
  assert.ok(!calls.some((c) => c.startsWith('service:play_card:')), calls.join('\n'));
});

test('a play its card refuses is never written by the service', async () => {
  const { dbs, calls } = pair({ whoami, card_target: { act: target, kind: 'post', length: 10, effects: [1, 2, 3].map((i) => ({ card: 'whoops', act: `k${i}` })) } });
  const out = await runAction(dbs, instance, { action: 'playCard', card: 'whoops', character: id, target, config: { color: 'red' } });
  assert.equal(out.status, 400);
  assert.match(String((out.body as { error: string }).error), /already/);
  assert.ok(!calls.some((c) => c.startsWith('service:') && !c.startsWith('service:instance_settings:')), calls.join('\n'));
});

test('a purchase is the service\'s, for whoever the session is', async () => {
  const { dbs, calls } = pair({ whoami, buy_card: { card: 'whoops', balance: 0 } });
  await runAction(dbs, instance, { action: 'buyCard', card: 'whoops' });
  assert.ok(calls.includes(`service:buy_card:${JSON.stringify({ card: 'whoops', price: 100, who: whoami })}`), calls.join('\n'));
});

test('a card is sold and played at the prices the settings rows hold', async () => {
  const { dbs, calls } = pair({ instance_settings: { economy: { ...instance.settings.economy, 'whoops.price': 150, 'whoops.perLength': 50 } }, whoami, buy_card: { card: 'whoops', balance: 0 },
    card_target: { act: target, kind: 'post', length: 1000, effects: [] }, play_card: { id: 'k' } });
  await runAction(dbs, instance, { action: 'buyCard', card: 'whoops' });
  assert.ok(calls.includes(`service:buy_card:${JSON.stringify({ card: 'whoops', price: 150, who: whoami })}`), calls.join('\n'));
  await runAction(dbs, instance, { action: 'playCard', card: 'whoops', character: id, target, config: { color: 'red' } });
  assert.ok(calls.some((c) => c.startsWith('service:play_card:') && c.includes('"price":100')), calls.join('\n'));
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
    // A Turn waits for the settlement, whose tally the settlement sends (settle/core.ts): nothing now.
    [{ action: 'turn', character: id, class: 'heel', loudness: 'silent' }, { turn: { pending: true, class: 'heel', loudness: 'silent' } }, []],
    [{ action: 'turn', character: id, class: 'heel', loudness: 'announced' }, { turn: { pending: true, class: 'heel', loudness: 'announced' } }, []],
    [{ action: 'withdrawTurn', character: id }, { withdraw_turn: { withdrawn: true } }, []],
    [{ action: 'buyCard', card: 'whoops' }, { whoami: id, buy_card: { card: 'whoops', balance: 0, held: 1 } }, []],
    [{ action: 'saveEffect', play: id, character: id, state: { strokes: [] } }, { whoami: id, card_of_play: 'whoops', save_effect_state: { play: id, thread, state: { strokes: [] }, saved_at: 't1' } },
      [{ topic: `thread:${thread}`, event: 'effect', payload: { play: id, saved_at: 't1' } }]],
    [{ action: 'edit', post: id, character: id, body: 'y' }, { edit_post: { id: 'e', thread } }, [{ topic: `thread:${thread}`, event: 'act', payload: { id: 'e', thread } }]],
    [{ action: 'spin', origin: id, character: id, title: 't', body: '' }, { spin: { thread: { id: thread, board }, act: { id: 's', thread } } },
      [{ topic: `board:${board}`, event: 'thread', payload: { id: thread, board } }, { topic: `thread:${thread}`, event: 'act', payload: { id: 's', thread } }]],
    [{ action: 'playCard', card: 'whoops', character: id, target: id, config: { color: 'red' } },
      { whoami: id, card_target: { act: id, kind: 'post', length: 10, effects: [] }, play_card: { id: 'c', thread } }, [{ topic: `thread:${thread}`, event: 'act', payload: { id: 'c', thread } }]],
    [{ action: 'react', act: id, character: id, kind: 'fire' }, { react: { act: id, thread: null, tally: {} } }, []],
    // A drop announced is The System's tally of one, sent now, with the Turns thread it opened; a
    // waiting or silent character is its player's alone.
    [{ action: 'createCharacter', name: 'Dropped', class: 'heel', timing: 'now', loudness: 'announced' },
      { create_character: { id, waiting: false, announcement: { act: { id: 'd', thread }, thread: { id: thread, board } } } },
      [{ topic: `board:${board}`, event: 'thread', payload: { id: thread, board } }, { topic: `thread:${thread}`, event: 'act', payload: { id: 'd', thread } }]],
    [{ action: 'createCharacter', name: 'Waiting', class: 'heel' }, { create_character: { id, waiting: true, announcement: null } }, []],
    [{ action: 'setDebut', character: id, timing: 'now', loudness: 'announced' },
      { set_debut: { id, waiting: false, announcement: { act: { id: 'd', thread }, thread: null } } }, [{ topic: `thread:${thread}`, event: 'act', payload: { id: 'd', thread } }]],
    [{ action: 'setDebut', character: id, timing: 'now', loudness: 'silent' }, { set_debut: { id, waiting: false, announcement: null } }, []],
    // A drop with its class: the tally of one, then the character's own unmask, in that order.
    [{ action: 'createCharacter', name: 'Dropped', class: 'heel', timing: 'now', loudness: 'with_class' },
      { create_character: { id, waiting: false, announcement: { act: { id: 'd', thread }, thread: null, unmask: { id: 'u', thread } } } },
      [{ topic: `thread:${thread}`, event: 'act', payload: { id: 'd', thread } }, { topic: `thread:${thread}`, event: 'act', payload: { id: 'u', thread } }]],
    // A reveal is the character's Act in its thread, sent like a post.
    [{ action: 'unmask', character: id, thread }, { unmask: { id: 'u', thread } }, [{ topic: `thread:${thread}`, event: 'act', payload: { id: 'u', thread } }]],
  ];
  for (const [request, answers, broadcasts] of cases) {
    const { dbs } = pair(answers);
    const out = await runAction(dbs, instance, request);
    assert.equal(out.status, 200, JSON.stringify(request));
    assert.deepEqual(out.broadcasts ?? [], broadcasts, JSON.stringify(request));
  }
});

test('a refused or failed action sends nothing live', async () => {
  const refusal = new DatabaseError('post: no', 'P0001', 400, 'no', REFUSAL_HINT);
  const failing: Db = { rpc: async () => { throw refusal; } };
  const broken: Db = { rpc: async () => { throw new DatabaseError('post: x', '42P01', 500); } };
  for (const player of [failing, broken]) {
    const out = await runAction({ player, service: player }, instance, { action: 'post', thread: id, character: id, body: 'x' });
    assert.notEqual(out.status, 200);
    assert.equal(out.broadcasts, undefined);
  }
  assert.equal((await runAction(pair({}).dbs, instance, { action: 'post', thread: id, character: id, body: '' })).broadcasts, undefined);
});

test('only the reads and the writes that find their own earlier effect are safe to repeat after a lost answer', () => {
  for (const fn of ['whoami', 'card_target', 'card_of_play', 'open_account', 'instance_settings']) assert.equal(SAFE_TO_REPEAT(fn), true, fn);
  // A save repeated after a newer one landed would bring back the older strokes.
  for (const fn of ['save_effect_state', 'post', 'start_thread', 'edit_post', 'spin', 'react', 'turn', 'withdraw_turn', 'buy_card', 'play_card', 'create_character', 'set_debut', 'create_invite', 'reissue_invite']) assert.equal(SAFE_TO_REPEAT(fn), false, fn);
});

test('a write whose answer was lost says plainly it may have gone through', async () => {
  const lost: Db = { rpc: async () => { throw new TransportError('post: no answer after 1 attempt(s): HTTP 504'); } };
  const out = await runAction({ player: lost, service: lost }, instance, { action: 'post', thread: id, character: id, body: 'x' });
  assert.equal(out.status, 503);
  assert.match((out.body as { error: string }).error, /may have gone through.*look before you try again/);
});

test('the act function\'s connections send a post once after a 504, and a read again', async () => {
  const seen: string[] = [];
  const fetch = (async (url: string) => { seen.push(url.split('/').pop()!); return new Response('', { status: 504 }); }) as unknown as typeof globalThis.fetch;
  const dbs = actDbs({ url: 'https://p.example', key: 'service', anon: 'anon', session: 'tok', fetch, sleep: async () => {} });
  await assert.rejects(dbs.player.rpc('post', {}));
  assert.deepEqual(seen, ['post']);
  seen.length = 0;
  await assert.rejects(dbs.service.rpc('whoami', {}));
  assert.equal(seen.length, 4);
});
