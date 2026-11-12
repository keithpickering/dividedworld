import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REFUSAL_HINT, SAFE_TO_REPEAT, actDbs, afterTheAnswer, coalesced, forgetHintSettings, handleAction, runAction } from './core.ts';
import { DatabaseError, TransportError, type Db } from '../_shared/rpc.ts';
import { instance } from '../_shared/instance.ts';
import { landsOn } from '../../../engine/rules/cards.ts';
import { NOT_RUN } from '../../../engine/ui/data/api.ts';

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
  const { dbs, calls } = pair({ whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 1200, body: 'x'.repeat(1200), effects: [] }, play_card: { id: 'k', kind: 'card' } });
  const out = await runAction(dbs, instance, { action: 'playCard', card: 'whoops', character: id, target, config: { color: 'Red', seed: 7 }, message: ' Clean that up. ' });
  assert.deepEqual({ status: out.status, body: out.body }, { status: 200, body: { id: 'k', kind: 'card' } });
  assert.deepEqual(calls, [
    `player:whoami:{}`,
    `service:instance_settings:{}`,
    `player:card_target_reach:{"reach":"post","target":"${target}"}`,
    `service:play_card:${JSON.stringify({ card: 'whoops', through: id, target, config: { color: 'red' }, message: 'Clean that up.', who: whoami, price: 50 })}`,
  ]);
});

test('a play on a post hands play_card the version it was decided against, and its rules see the post\'s visible words', async () => {
  const edit = '44444444-4444-4444-8444-444444444444';
  const seen: unknown[] = [];
  const reading = { ...instance, cards: instance.cards.map((c) => c.key !== 'whoops' ? c : { ...c, canApply: (t: Parameters<typeof c.canApply>[0], e: Parameters<typeof c.canApply>[1]) => { seen.push(t.reach === 'post' ? t.text : null); return c.canApply(t, e); } }) };
  const { dbs, calls } = pair({ whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 30, body: 'my [b]cats[/b] [url=https://a.example]x[/url]', version: edit, effects: [] }, play_card: { id: 'k', kind: 'card' } });
  const out = await runAction(dbs, reading, { action: 'playCard', card: 'whoops', character: id, target, config: { color: 'red' }, message: '' });
  assert.equal(out.status, 200);
  assert.deepEqual(seen, ['my cats \n']);
  assert.deepEqual(calls.at(-1), `service:play_card:${JSON.stringify({ card: 'whoops', through: id, target, config: { color: 'red' }, message: '', who: whoami, price: 0, reach: 'post', from_post: null, version: edit })}`);
});

test('a card that needs a message, played with none, is refused on the message field, and never written', async () => {
  const pleading = { ...instance, cards: instance.cards.map((c) => (c.key === 'whoops' ? { ...c, needsMessage: 'say why' } : c)) };
  const { dbs, calls } = pair({ whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [] } });
  const out = await runAction(dbs, pleading, { action: 'playCard', card: 'whoops', character: id, target, config: { color: 'red' }, message: '  ' });
  assert.deepEqual({ status: out.status, body: out.body }, { status: 400, body: { field: 'message', error: 'say why' } });
  assert.ok(!calls.some((c) => c.startsWith('service:play_card:')), calls.join('\n'));
});

test('a play whose message is too long is refused by its field, and never written', async () => {
  const { dbs, calls } = pair({ whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [] } });
  const out = await runAction(dbs, instance, { action: 'playCard', card: 'whoops', character: id, target, config: { color: 'red' }, message: 'x'.repeat(201) });
  assert.deepEqual({ status: out.status, body: out.body }, { status: 400, body: { field: 'message', error: 'the message is at most 200 characters' } });
  assert.ok(!calls.some((c) => c.startsWith('service:play_card:')), calls.join('\n'));
});

test('a play its card refuses is never written by the service', async () => {
  const { dbs, calls } = pair({ whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [1, 2, 3].map((i) => ({ card: 'whoops', act: `k${i}` })) } });
  const out = await runAction(dbs, instance, { action: 'playCard', card: 'whoops', character: id, target, config: { color: 'red' } });
  assert.equal(out.status, 400);
  assert.match(String((out.body as { error: string }).error), /already/);
  assert.ok(!calls.some((c) => c.startsWith('service:') && !c.startsWith('service:instance_settings:')), calls.join('\n'));
});

const slot = '55555555-5555-4555-8555-555555555555';

test('a purchase is the service\'s, for whoever the session is, at the price the screen showed', async () => {
  const { dbs, calls } = pair({ whoami, buy_card: { card: 'whoops', balance: 0 }, buy_pack: { pack: 'p', contents: [], balance: 0 } });
  await runAction(dbs, instance, { action: 'buyCard', slot, price: 250 });
  assert.ok(calls.includes(`service:buy_card:${JSON.stringify({ slot, price: 250, who: whoami })}`), calls.join('\n'));
  await runAction(dbs, instance, { action: 'buyPack', slot, price: 300 });
  assert.ok(calls.includes(`service:buy_pack:${JSON.stringify({ slot, price: 300, who: whoami })}`), calls.join('\n'));
  assert.ok(!calls.some((c) => c.includes('instance_settings')), 'a purchase reads no settings: its slot is the database\'s');
});

test('a play is priced at the prices the settings rows hold', async () => {
  const { dbs, calls } = pair({ instance_settings: { economy: { ...instance.settings.economy, 'whoops.perLength': 50 } }, whoami,
    card_target_reach: { act: target, kind: 'post', length: 1000, body: 'x'.repeat(1000), effects: [] }, play_card: { id: 'k' } });
  await runAction(dbs, instance, { action: 'playCard', card: 'whoops', character: id, target, config: { color: 'red' } });
  assert.ok(calls.some((c) => c.startsWith('service:play_card:') && c.includes('"price":100')), calls.join('\n'));
});

test('a session with no account behind it acts as nobody', async () => {
  const { dbs, calls } = pair({ whoami: null });
  const out = await runAction(dbs, instance, { action: 'buyCard', slot, price: 100 });
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
    [{ action: 'buyCard', slot: id, price: 100 }, { whoami: id, buy_card: { card: 'whoops', balance: 0, held: 1 } }, []],
    [{ action: 'buyPack', slot: id, price: 300 }, { whoami: id, buy_pack: { pack: 'p', contents: ['whoops'], balance: 0 } }, []],
    [{ action: 'saveEffect', play: id, character: id, state: { strokes: [] } }, { whoami: id, card_of_play: 'whoops', save_effect_state: { play: id, thread, state: { strokes: [] }, saved_at: 't1' } },
      [{ topic: `thread:${thread}`, event: 'effect', payload: { play: id, saved_at: 't1' } }]],
    [{ action: 'edit', post: id, character: id, body: 'y' }, { edit_post: { id: 'e', thread } }, [{ topic: `thread:${thread}`, event: 'act', payload: { id: 'e', thread } }]],
    [{ action: 'spin', origin: id, character: id, title: 't', body: '' }, { spin: { thread: { id: thread, board }, act: { id: 's', thread } } },
      [{ topic: `board:${board}`, event: 'thread', payload: { id: thread, board } }, { topic: `thread:${thread}`, event: 'act', payload: { id: 's', thread } }]],
    // An apology is a spin of the move's Act: heard as a spin is.
    [{ action: 'apologize', move: id, character: id, title: 't', body: 'b' }, { apologize: { thread: { id: thread, board }, act: { id: 'p', thread } } },
      [{ topic: `board:${board}`, event: 'thread', payload: { id: thread, board } }, { topic: `thread:${thread}`, event: 'act', payload: { id: 'p', thread } }]],
    [{ action: 'playCard', card: 'whoops', character: id, target: id, config: { color: 'red' } },
      { whoami: id, card_target_reach: { act: id, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [] }, play_card: { id: 'c', thread } }, [{ topic: `thread:${thread}`, event: 'act', payload: { id: 'c', thread } }]],
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
    // A drop with its class is one announce Act, after the thread when this opened it: no separate reveal is sent, even
    // where an answer still carried one (0100 writes none).
    [{ action: 'createCharacter', name: 'Dropped', class: 'heel', timing: 'now', loudness: 'with_class' },
      { create_character: { id, waiting: false, announcement: { act: { id: 'd', thread }, thread: { id: thread, board }, unmask: { id: 'u', thread } } } },
      [{ topic: `board:${board}`, event: 'thread', payload: { id: thread, board } }, { topic: `thread:${thread}`, event: 'act', payload: { id: 'd', thread } }]],
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

test('a new character\'s pronouns reach create_character, and none is a null', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const she = { subject: 'she', object: 'her', determiner: 'her', possessive: 'hers', reflexive: 'herself', plural: false };
  const made = pair({ create_character: { id, waiting: true, announcement: null } });
  await runAction(made.dbs, instance, { action: 'createCharacter', name: 'Hers', class: 'heel', pronouns: { ...she, subject: 'SHE' } });
  await runAction(made.dbs, instance, { action: 'createCharacter', name: 'Plain', class: 'heel' });
  assert.deepEqual(made.calls, [
    `player:create_character:${JSON.stringify({ name: 'Hers', class: 'heel', timing: 'now', loudness: 'announced', pronouns: she })}`,
    `player:create_character:${JSON.stringify({ name: 'Plain', class: 'heel', timing: 'now', loudness: 'announced', pronouns: null })}`,
  ]);
  const bad = pair({});
  const out = await runAction(bad.dbs, instance, { action: 'createCharacter', name: 'Bad', class: 'heel', pronouns: { ...she, subject: '' } });
  assert.equal(out.status, 400);
  assert.deepEqual(bad.calls, []);
});

test('ending a card is the caller\'s own call, heard on its thread, and on reach too for a play beyond a post; a refusal sends nothing', async () => {
  const thread = '44444444-4444-4444-8444-444444444444';
  const end = { id: 'e', kind: 'card_end', thread, target_act_id: target, payload: { why: 'reversed', by: 'admin' } };
  const onPost = pair({ reverse_card: { ...end, play: target } });
  const a = await runAction(onPost.dbs, instance, { action: 'reverseCard', play: target });
  assert.equal(a.status, 200);
  assert.deepEqual(a.broadcasts, [{ topic: `thread:${thread}`, event: 'act', payload: end }]);
  assert.deepEqual(onPost.calls, [`player:reverse_card:${JSON.stringify({ play: target })}`]);
  const beyond = await runAction(pair({ reverse_card: { ...end, play: target, reach: 'thread' } }).dbs, instance, { action: 'reverseCard', play: target });
  assert.deepEqual(beyond.broadcasts, [{ topic: `thread:${thread}`, event: 'act', payload: end }, { topic: 'reach', event: 'effect', payload: end }]);
  const no: Db = { rpc: async () => { throw new DatabaseError('reverse_card: no', '55000', 400, 'an admin has already ended that card', REFUSAL_HINT); } };
  const refused = await runAction({ player: no, service: no }, instance, { action: 'reverseCard', play: target });
  assert.deepEqual(refused, { status: 400, body: { error: 'an admin has already ended that card', code: '55000' } });
  assert.equal((refused as { broadcasts?: unknown }).broadcasts, undefined);
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
  for (const fn of ['whoami', 'card_target', 'card_target_reach', 'card_of_play', 'open_account', 'instance_settings']) assert.equal(SAFE_TO_REPEAT(fn), true, fn);
  // A save repeated after a newer one landed would bring back the older strokes.
  for (const fn of ['save_effect_state', 'post', 'start_thread', 'edit_post', 'spin', 'apologize', 'react', 'turn', 'withdraw_turn', 'buy_card', 'buy_pack', 'play_card', 'create_character', 'set_debut', 'create_invite', 'reissue_invite']) assert.equal(SAFE_TO_REPEAT(fn), false, fn);
});

test('a write whose answer was lost says plainly it may have gone through', async () => {
  const lost: Db = { rpc: async () => { throw new TransportError('post: no answer after 1 attempt(s): HTTP 504'); } };
  const out = await runAction({ player: lost, service: lost }, instance, { action: 'post', thread: id, character: id, body: 'x' });
  assert.equal(out.status, 503);
  assert.match((out.body as { error: string }).error, /may have gone through.*look before you try again/);
});

test('a write that certainly did not run says so: sent false, in the words the screen holds as NOT_RUN', async () => {
  const buy = { action: 'buyCard', slot: id, price: 100 };
  // A read before the write never answered: nothing was written.
  const noWho: Db = { rpc: async () => { throw new TransportError('whoami: no answer after 4 attempt(s): no answer (fetch failed)'); } };
  const early = await runAction({ player: noWho, service: noWho }, instance, buy);
  assert.deepEqual({ status: early.status, body: early.body }, { status: 503, body: { error: NOT_RUN, sent: false } });
  // The write itself got a 503 on every attempt: it never ran.
  const player: Db = { rpc: async <T>() => id as T };
  const never: Db = { rpc: async () => { throw new TransportError('buy_card: no answer after 4 attempt(s): HTTP 503; HTTP 503; HTTP 503; HTTP 503', 'never'); } };
  const refused = await runAction({ player, service: never }, instance, buy);
  assert.deepEqual({ status: refused.status, body: refused.body }, { status: 503, body: { error: NOT_RUN, sent: false } });
  // The write's own fetch threw: it may have run, and no `sent` is said.
  const threw: Db = { rpc: async () => { throw new TransportError('buy_card: no answer (fetch failed)', 'maybe'); } };
  const lost = await runAction({ player, service: threw }, instance, buy);
  assert.equal(lost.status, 503);
  assert.match((lost.body as { error: string }).error, /may have gone through.*look before you try again/);
  assert.equal('sent' in (lost.body as object), false);
});

test('the act function\'s player connection sends the publishable key and the session; its service connection, the secret key alone', async () => {
  const sent: Headers[] = [];
  const fetch = (async (_url: string, init: RequestInit) => { sent.push(new Headers(init.headers)); return new Response('1', { status: 200 }); }) as unknown as typeof globalThis.fetch;
  const dbs = actDbs({ url: 'https://p.example', key: 'sb_secret_s', publishable: 'sb_publishable_p', session: 'tok', fetch, sleep: async () => {} });
  await dbs.player.rpc('whoami', {});
  await dbs.service.rpc('card_target', {});
  assert.deepEqual(sent.map((h) => [h.get('apikey'), h.get('Authorization')]), [['sb_publishable_p', 'Bearer tok'], ['sb_secret_s', null]]);
});

test('the act function\'s connections send a post once after a 504, and a read again', async () => {
  const seen: string[] = [];
  const fetch = (async (url: string) => { seen.push(url.split('/').pop()!); return new Response('', { status: 504 }); }) as unknown as typeof globalThis.fetch;
  const dbs = actDbs({ url: 'https://p.example', key: 'service', publishable: 'sb_publishable_p', session: 'tok', fetch, sleep: async () => {} });
  await assert.rejects(dbs.player.rpc('post', {}));
  assert.deepEqual(seen, ['post']);
  seen.length = 0;
  await assert.rejects(dbs.service.rpc('whoami', {}));
  assert.equal(seen.length, 4);
});

// Engine test cards beside the instance's own, so a Set and a Use are decided without naming an instance's cards.
const ok = <T>(value: T) => ({ ok: true as const, value });
const base = { alignment: 'salty' as const, playPrice: () => 0, canApply: () => ok(undefined) };
const inky = { ...base, key: 'test-inky', name: 'Test Inky', rarity: 'common' as const, validateConfig: (c: unknown) => ((c as { ink?: unknown })?.ink === 'red' ? ok({ ink: 'red' }) : { ok: false as const, why: 'the ink is red' }) };
const snare = { ...base, key: 'test-snare', name: 'Test Snare', rarity: 'uncommon' as const, play: 'set' as const, trap: { trigger: { on: 'visit' as const } }, validateConfig: inky.validateConfig };
const move = { ...base, key: 'test-move', name: 'Test Move', rarity: 'common' as const, validateConfig: (c: unknown) => ok(c) };
const shield = { ...base, key: 'test-shield', name: 'Test Shield', rarity: 'uncommon' as const, play: 'use' as const, gimmick: { kind: 'ward' as const, upTo: 'uncommon' as const }, lasts: { unit: 'day' as const, count: 7 }, validateConfig: (c: unknown) => ok(c) };
const hush = { ...base, key: 'test-hush', name: 'Test Hush', rarity: 'uncommon' as const, play: 'use' as const, gimmick: { kind: 'noQuote' as const }, lasts: { unit: 'day' as const, count: 7 }, validateConfig: (c: unknown) => ok(c) };
const tested = { ...instance, cards: [...instance.cards, inky, snare, move, shield, hush] };
const setAct = { id: 'k', kind: 'set', thread: 'th', payload: {} };

test('a Set is decided by its card\'s rules and written by set_card; its answer and its broadcast carry no card key', async () => {
  for (const card of ['test-snare', 'test-move']) {
    const { dbs, calls } = pair({ whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [] }, set_card: setAct });
    const out = await runAction(dbs, tested, { action: 'setCard', card, character: id, target, config: card === 'test-snare' ? { ink: 'red' } : {} });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.ok(calls.some((c) => c.startsWith('service:set_card:') && c.includes(`"card":"${card}"`) && c.includes('"price":0')), calls.join('\n'));
    assert.doesNotMatch(JSON.stringify(out.body), /test-/, 'the answer names no card');
    assert.deepEqual(out.broadcasts, [{ topic: 'thread:th', event: 'act', payload: setAct }]);
    assert.doesNotMatch(JSON.stringify(out.broadcasts), /test-/, 'the broadcast names no card');
  }
});

test('a take-back is written by take_back for the account and the character, and its Act is heard on the thread', async () => {
  const back = { id: 'tb', kind: 'take_back', thread: 'th', payload: { set: target } };
  const { dbs, calls } = pair({ whoami, take_back: back });
  const out = await runAction(dbs, instance, { action: 'takeBack', character: id, set: target });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.deepEqual(calls, [`player:whoami:{}`, `service:take_back:${JSON.stringify({ through: id, set_act: target, who: whoami })}`]);
  assert.deepEqual(out.broadcasts, [{ topic: 'thread:th', event: 'act', payload: back }]);
  assert.doesNotMatch(JSON.stringify(out.body) + JSON.stringify(out.broadcasts), /snare|whoops|test-/, 'the answer and the broadcast name no card');
});

test('a Salty cast on a post under a live Good Vibes thread is priced 25 above its play price, and a Sweet one is not', async () => {
  const under = (ends: string) => ({ reach: 'post', act: target, kind: 'post', length: 1200, body: 'x'.repeat(1200), effects: [],
    above: { thread: [{ card: 'good-vibes', act: 'g', gimmick: { kind: 'price', flavors: ['salty'], add: 25 }, ends }] } });
  const live = new Date(Date.now() + 86_400_000).toISOString();
  const salty = pair({ whoami, card_target_reach: under(live), play_card: { id: 'k', kind: 'card' } });
  assert.equal((await runAction(salty.dbs, instance, { action: 'playCard', card: 'whoops', character: id, target, config: { color: 'red' }, message: '' })).status, 200);
  assert.ok(salty.calls.some((c) => c.startsWith('service:play_card:') && c.includes('"price":75')), salty.calls.join('\n'));
  const ended = pair({ whoami, card_target_reach: under(new Date(Date.now() - 1000).toISOString()), play_card: { id: 'k', kind: 'card' } });
  await runAction(ended.dbs, instance, { action: 'playCard', card: 'whoops', character: id, target, config: { color: 'red' }, message: '' });
  assert.ok(ended.calls.some((c) => c.startsWith('service:play_card:') && c.includes('"price":50')), 'an ended Good Vibes adds nothing');
  const sweet = pair({ whoami, card_target_reach: under(live), play_card: { id: 'k', kind: 'card' } });
  await runAction(sweet.dbs, instance, { action: 'playCard', card: 'stick-around', character: id, target, config: {}, message: '' });
  assert.ok(sweet.calls.some((c) => c.startsWith('service:play_card:') && !c.includes('"price":75')), 'a Sweet cast pays no surcharge');
});

const onPost = { whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [] }, set_card: setAct };
const setCalls = (calls: string[]) => calls.filter((c) => c.startsWith('service:set_card:'));

test('a player sets a Move face down: Whoops! and Glitter Bomb pass the decision to set_card, with neither a catch nor a phrase', async () => {
  for (const [card, config] of [['whoops', { color: 'red' }], ['glitter-bomb', {}]] as const) {
    const { dbs, calls } = pair(onPost);
    const out = await runAction(dbs, instance, { action: 'setCard', card, character: id, target, config });
    assert.equal(out.status, 200, `${card}: ${JSON.stringify(out.body)}`);
    const sent = setCalls(calls);
    assert.equal(sent.length, 1, calls.join('\n'));
    assert.ok(sent[0]!.includes(`"card":"${card}"`) && sent[0]!.includes('"catches":null') && sent[0]!.includes('"phrase":null'), sent[0]);
  }
});

test('a catching set card naming Whoops! sends the named catch, from the card\'s own rules', async () => {
  const { dbs, calls } = pair(onPost);
  // A request that also names a catch and a phrase of its own: the act function takes neither.
  const out = await runAction(dbs, instance, { action: 'setCard', card: 'card-collector', character: id, target, config: { card: 'whoops' }, catches: 'glitter-bomb', phrase: 'smuggled' });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const sent = setCalls(calls);
  assert.ok(sent[0]!.includes('"catches":"whoops"') && sent[0]!.includes('"phrase":null') && !sent[0]!.includes('smuggled') && !sent[0]!.includes('glitter-bomb'), sent[0]);
});

test('a Card Collector naming Force Field is refused in its own words, before SQL', async () => {
  const { dbs, calls } = pair(onPost);
  const out = await runAction(dbs, instance, { action: 'setCard', card: 'card-collector', character: id, target, config: { card: 'force-field' } });
  assert.deepEqual({ status: out.status, body: out.body }, { status: 400, body: { field: 'config', error: 'Card Collector names a card that is cast on a post' } });
  assert.equal(setCalls(calls).length, 0, calls.join('\n'));
});

test('an Autocorrect set sends its own phrase', async () => {
  const { dbs, calls } = pair(onPost);
  const out = await runAction(dbs, instance, { action: 'setCard', card: 'autocorrect', character: id, target, config: { phrase: 'Heel Turn', replacement: 'Face Turn' }, phrase: 'smuggled' });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const sent = setCalls(calls);
  assert.ok(sent[0]!.includes('"phrase":"Heel Turn"') && sent[0]!.includes('"catches":null') && !sent[0]!.includes('smuggled'), sent[0]);
});

const sentArgs = (calls: string[]) => JSON.parse(setCalls(calls)[0]!.replace(/^service:set_card:/, '')) as Record<string, unknown>;
const postOf = { reach: 'post', act: target, kind: 'post', length: 30, body: 'The punchline was funny, honestly.', effects: [] };

test('a Move set with conditions sends phrase, passage, the named ids and who_except to set_card, and keeps the account in who', async () => {
  const { dbs, calls } = pair({ ...onPost, card_target_reach: postOf });
  const when = { says: 'nice try', passage: 'the punchline', who: { except: true, characters: [target] } };
  const out = await runAction(dbs, instance, { action: 'setCard', card: 'whoops', character: id, target, config: { color: 'red' }, when });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const a = sentArgs(calls);
  assert.deepEqual({ phrase: a.phrase, passage: a.passage, named: a.named, who_except: a.who_except, conditions: a.conditions }, { phrase: 'nice try', passage: 'the punchline', named: [target], who_except: true, conditions: undefined });
  assert.equal(a.who, whoami, 'who stays the account');
});

test('a set with no conditions sends nulls for all four', async () => {
  const { dbs, calls } = pair(onPost);
  await runAction(dbs, instance, { action: 'setCard', card: 'whoops', character: id, target, config: { color: 'red' } });
  const a = sentArgs(calls);
  assert.deepEqual([a.passage, a.named, a.who_except], [null, null, null]);
});

test('a condition the rules refuse is refused before SQL, in their words', async () => {
  const { dbs, calls } = pair({ ...onPost, card_target_reach: postOf });
  const out = await runAction(dbs, instance, { action: 'setCard', card: 'whoops', character: id, target, config: { color: 'red' }, when: { passage: 'the setup' } });
  assert.deepEqual({ status: out.status, body: out.body }, { status: 400, body: { field: 'config', error: "that passage is not in this post's words" } });
  assert.equal(setCalls(calls).length, 0);
});

test('Autocorrect takes no Says of its own and keeps its phrase', async () => {
  const { dbs, calls } = pair(onPost);
  const out = await runAction(dbs, instance, { action: 'setCard', card: 'autocorrect', character: id, target, config: { phrase: 'Heel Turn', replacement: 'Face Turn' }, when: { says: 'other' } });
  assert.deepEqual({ status: out.status, body: out.body }, { status: 400, body: { field: 'config', error: 'Autocorrect already waits for its own phrase' } });
  assert.equal(setCalls(calls).length, 0);
});

test('a Use is refused by the act function when it is set', async () => {
  const { dbs, calls } = pair(onPost);
  const out = await runAction(dbs, tested, { action: 'setCard', card: 'test-shield', character: id, target, config: {} });
  assert.deepEqual({ status: out.status, body: out.body }, { status: 400, body: { field: 'config', error: 'Test Shield is used on your own post' } });
  assert.equal(setCalls(calls).length, 0);
});

test('a set card\'s configuration is checked by its own rules before SQL', async () => {
  const { dbs, calls } = pair({ whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [] } });
  const out = await runAction(dbs, tested, { action: 'setCard', card: 'test-snare', character: id, target, config: { ink: 'blue' } });
  assert.deepEqual({ status: out.status, body: out.body }, { status: 400, body: { field: 'config', error: 'the ink is red' } });
  assert.ok(!calls.some((c) => c.startsWith('service:set_card:')), calls.join('\n'));
});

test('a second card back on a post is refused before SQL, as anyone would see it', async () => {
  const { dbs, calls } = pair({ whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [{ card: null, act: 'b', faceDown: true, ends: new Date(Date.now() + 1e6).toISOString() }] } });
  const out = await runAction(dbs, tested, { action: 'setCard', card: 'test-move', character: id, target });
  assert.deepEqual({ status: out.status, body: out.body }, { status: 400, body: { field: 'config', error: 'this post already holds a card face down' } });
  assert.ok(!calls.some((c) => c.startsWith('service:set_card:')), calls.join('\n'));
});

test('a Use on a post under someone else\'s character is refused by SQL and answered in its words', async () => {
  const refusal = new DatabaseError('play_card: Test Shield is used on your own post', '42501', 403, 'Test Shield is used on your own post', REFUSAL_HINT);
  const answers: Record<string, unknown> = { whoami, card_target_reach: { act: target, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [] } };
  const make = (): Db => ({ rpc: async <T>(fn: string) => { if (fn === 'play_card') throw refusal; return (fn === 'instance_settings' ? { economy: instance.settings.economy } : answers[fn]) as T; } });
  const out = await runAction({ player: make(), service: make() }, tested, { action: 'useCard', card: 'test-shield', character: id, target });
  assert.deepEqual({ status: out.status, body: out.body }, { status: 403, body: { error: 'Test Shield is used on your own post', code: '42501' } });
});

test('a card is played the way it is played: a Set card is not cast, and a Cast card is not used', async () => {
  const { dbs } = pair({ whoami, card_target_reach: { act: target, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [] } });
  const cast = await runAction(dbs, tested, { action: 'playCard', card: 'test-snare', character: id, target });
  assert.deepEqual(cast.body, { field: 'config', error: 'Test Snare is set face down on your own post' });
  const used = await runAction(dbs, tested, { action: 'useCard', card: 'test-inky', character: id, target, config: { ink: 'red' } });
  assert.deepEqual(used.body, { field: 'config', error: 'Test Inky is cast' });
});

test('a cast under a ward is refused in the ward card\'s name', async () => {
  const { dbs } = pair({ whoami, card_target_reach: { act: target, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [{ card: 'test-shield', act: 'w', gimmick: { kind: 'ward', upTo: 'uncommon' } }] } });
  const out = await runAction(dbs, tested, { action: 'playCard', card: 'test-inky', character: id, target, config: { ink: 'red' } });
  assert.deepEqual(out.body, { field: 'config', error: 'this post\'s Test Shield turns away cards up to uncommon' });
});

test('a spring, and a strike\'s card, go out live as Acts of their own', async () => {
  const thread = '44444444-4444-4444-8444-444444444444';
  const spring = { id: 's', kind: 'spring', thread, payload: { card: 'test-snare' } };
  const struck = { id: 'k', kind: 'card', thread };
  const cases: [unknown, Record<string, unknown>, unknown][] = [
    [{ action: 'post', thread: id, character: id, body: 'x' }, { post: { id: 'a', thread, sprung: { ...spring, struck } } },
      [{ topic: `thread:${thread}`, event: 'act', payload: { id: 'a', thread } }, { topic: `thread:${thread}`, event: 'act', payload: spring }, { topic: `thread:${thread}`, event: 'act', payload: struck }]],
    [{ action: 'react', act: id, character: id, kind: 'fire' }, { react: { act: id, thread, tally: { fire: 1 }, sprung: spring } },
      [{ topic: `thread:${thread}`, event: 'tally', payload: { act: id, tally: { fire: 1 } } }, { topic: `thread:${thread}`, event: 'act', payload: spring }]],
    [{ action: 'playCard', card: 'whoops', character: id, target: id, config: { color: 'red' } },
      { whoami: id, card_target_reach: { act: id, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [] }, play_card: { id: 'c', thread, sprung: spring } },
      [{ topic: `thread:${thread}`, event: 'act', payload: { id: 'c', thread } }, { topic: `thread:${thread}`, event: 'act', payload: spring }]],
  ];
  for (const [request, answers, broadcasts] of cases) {
    const { dbs } = pair(answers);
    const out = await runAction(dbs, tested, request);
    assert.equal(out.status, 200, JSON.stringify(request));
    assert.deepEqual(out.broadcasts ?? [], broadcasts, JSON.stringify(request));
  }
});

// A card beyond a post (docs/plans/2026-11-01-card-reach-plan.md, Task 3): the engine's test card, beside the instance's.
const sparkle = { ...instance.cards.find((c) => c.key === 'stick-around')!, key: 'sparkle', name: 'Sparkle', rarity: 'uncommon' as const, play: 'cast' as const,
  reaches: ['character' as const], lasts: { unit: 'day' as const, count: 7 },
  canApply: (t: Parameters<typeof landsOn>[1], e: Parameters<typeof landsOn>[2]) => landsOn({ key: 'sparkle', reaches: ['character'] }, t, e) };
const reaching = { ...instance, cards: [...instance.cards, sparkle] };

test('a play beyond a post reads its target by card_target_reach, and its rules see the effects above it', async () => {
  const post = '44444444-4444-4444-8444-444444444444';
  const { dbs, calls } = pair({ whoami, card_target_reach: { reach: 'character', character: target, effects: [], above: { thread: [], board: [] } }, play_card: { id: 'k', kind: 'card' } });
  const out = await runAction(dbs, reaching, { action: 'playCard', card: 'sparkle', character: id, reach: 'character', target, post });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  assert.ok(calls.includes(`player:card_target_reach:${JSON.stringify({ reach: 'character', target, from_post: post })}`), calls.join('\n'));
  assert.ok(calls.some((c) => c.startsWith('service:play_card:') && c.includes('"reach":"character"') && c.includes(`"from_post":"${post}"`)), calls.join('\n'));
  // A second on the same character is the card's own rules to refuse, before SQL.
  const live = { card: 'sparkle', act: 'g', reach: 'character', ends: new Date(Date.now() + 1e6).toISOString() };
  const again = pair({ whoami, card_target_reach: { reach: 'character', character: target, effects: [live], above: {} } });
  const refused = await runAction(again.dbs, reaching, { action: 'playCard', card: 'sparkle', character: id, reach: 'character', target, post });
  assert.deepEqual({ status: refused.status, body: refused.body }, { status: 400, body: { field: 'config', error: 'this character already carries that card' } });
  assert.ok(!again.calls.some((c) => c.startsWith('service:play_card:')), again.calls.join('\n'));
});

test('a request with a reach the card lacks is refused before SQL is asked anything', async () => {
  const { dbs, calls } = pair({ whoami });
  const out = await runAction(dbs, reaching, { action: 'playCard', card: 'whoops', character: id, reach: 'character', target, post: target, config: { color: 'red' } });
  assert.deepEqual({ status: out.status, body: out.body }, { status: 400, body: { field: 'reach', error: 'this card lands on a post' } });
  assert.deepEqual(calls, []);
});

test('a target card_target_reach does not find is refused in its reach\'s words', async () => {
  const { dbs } = pair({ whoami, card_target_reach: null });
  const out = await runAction(dbs, reaching, { action: 'playCard', card: 'sparkle', character: id, reach: 'character', target, post: target });
  assert.deepEqual(out.body, { field: 'target', error: 'there is no such character' });
});

// The drain after every write (docs/plans/2026-11-02-alerts-plan.md, Task 6): an alert is queued in the outbox by the write itself,
// and sent from there after the answer. What a player sees of an action, and when, must not tell whether it queued an alert (which
// exists only when the quoted or targeted character has an owner), so the answer is made before the drain starts, and the drain
// is never awaited by the answer, with or without a runtime that lets work outlive it.
const quoting = { action: 'post', thread: id, character: id, body: 'Hello.', quote: target };
const wait = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

test('the answer to a quoting post is made before the drain starts, and is the same whether the drain finds an alert or nothing', async () => {
  const outcomes: { answer: string; before: string[] }[] = [];
  for (const waiting of [[], [{ id: 1, topic: `account:${whoami}`, event: 'alert', payload: { kind: 'quote' } }]]) {
    const log: string[] = [];
    const db: Db = { rpc: async <T>(fn: string) => { log.push(`rpc:${fn}`); return { id: 'q', kind: 'post', thread: id } as T; } };
    let later: (() => Promise<void>) | undefined;
    const answer = await handleAction({
      dbs: { player: db, service: db }, instance, body: quoting,
      send: async () => { log.push('send'); },
      drain: async () => { log.push(`drain:${waiting.length}`); },
      after: (work) => { later = work; },
    });
    const before = [...log];
    assert.ok(later, 'the drain is handed on to run after the answer');
    await later();
    outcomes.push({ answer: JSON.stringify(answer), before });
    assert.deepEqual(log.slice(before.length), ['send', `drain:${waiting.length}`], 'the live updates go out, then the outbox is drained');
  }
  assert.equal(outcomes[0]!.answer, outcomes[1]!.answer, 'the answer is byte for byte the same');
  assert.deepEqual(outcomes[0]!.before, ['rpc:post']);
  assert.deepEqual(outcomes[0]!.before, outcomes[1]!.before, 'nothing the drain does has happened when the answer is made');
});

test('a write that is refused is drained after too, so that no answer differs by whether anything was queued', async () => {
  const db: Db = { rpc: async () => { throw new DatabaseError('post: no', '42501', 403, 'no', REFUSAL_HINT); } };
  let later = 0;
  const answer = await handleAction({ dbs: { player: db, service: db }, instance, body: quoting, send: async () => {}, drain: async () => {}, after: () => { later++; } });
  assert.equal(answer.status, 403);
  assert.equal(later, 1);
});

test('after the answer, the work starts on a later turn, and without EdgeRuntime the answer does not wait for it', async () => {
  // The local runtime has no waitUntil: the answer must not be held by a drain that finds an alert (a slower drain) any more than by
  // one that finds nothing.
  for (const takes of [0, 50]) {
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    afterTheAnswer(async () => { log.push('started'); if (takes) await gate; log.push('finished'); });
    assert.deepEqual(log, [], 'not started in the same turn as the answer');
    await Promise.resolve();
    assert.deepEqual(log, [], 'nor in a microtask after it');
    await wait(5);
    assert.deepEqual(log, takes ? ['started'] : ['started', 'finished'], 'it runs on, with nothing awaiting it');
    release();
    await wait();
  }
});

test('with a runtime that lets work outlive the answer, the work is handed to it whole, and nothing it throws reaches anyone', async () => {
  const handed: Promise<unknown>[] = [];
  const logged: unknown[][] = [];
  const was = console.error;
  console.error = (...a: unknown[]) => { logged.push(a); };
  try {
    afterTheAnswer(async () => { throw new Error('realtime is down'); }, { waitUntil: (p) => { handed.push(p); } });
    assert.equal(handed.length, 1);
    await handed[0]; // settles, and does not reject
  } finally { console.error = was; }
  assert.equal(logged.length, 1);
  assert.match(String(logged[0]![0]), /after the answer/);
});

test('a play beyond a post is also sent on reach, as the public Act and nothing more; a play on a post is not', async () => {
  const thread = '44444444-4444-4444-8444-444444444444';
  const play = { id: 'k', kind: 'card', thread, payload: { card: 'sparkle', reach: 'character', character: target, ends: '2026-11-09T00:00:00Z', targetName: 'Ann' } };
  const { dbs } = pair({ whoami, card_target_reach: { reach: 'character', character: target, effects: [], above: {} }, play_card: play });
  const out = await runAction(dbs, reaching, { action: 'playCard', card: 'sparkle', character: id, reach: 'character', target, post: id });
  assert.deepEqual(out.broadcasts, [{ topic: `thread:${thread}`, event: 'act', payload: play }, { topic: 'reach', event: 'effect', payload: play }]);
  const onPost = pair({ whoami, card_target_reach: { act: target, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [] }, play_card: { id: 'c', kind: 'card', thread, payload: { card: 'whoops' } } });
  const plain = await runAction(onPost.dbs, instance, { action: 'playCard', card: 'whoops', character: id, target, config: { color: 'red' } });
  assert.ok(!plain.broadcasts?.some((b) => b.topic === 'reach'));
});

test('drains started while one is in flight are one follow-up, not one each; a drain that throws does not stop the next', async () => {
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const drain = coalesced(async () => { runs++; await gate; });
  const first = drain();
  await wait();
  assert.equal(runs, 1);
  const many = [drain(), drain(), drain(), drain()];
  await wait();
  assert.equal(runs, 1, 'writes during a drain start no drain of their own');
  release();
  await Promise.all([first, ...many]);
  assert.equal(runs, 2, 'one follow-up covers every write that came meanwhile');
  const quiet = coalesced(async () => { throw new Error('realtime is down'); });
  const log = console.error;
  console.error = () => {};
  try { await quiet(); await quiet(); } finally { console.error = log; }
});

// ---- Hints (the alerts plan, Task 12): checked after a reaction's answer, from public counts, fired once per Act and pattern ----
const reacting = { action: 'react', act: target, character: id, kind: 'tomato' };
const post = '66666666-6666-4666-8666-666666666666';
const zero = { excitedPositive: 0, excitedNegative: 0, calmPositive: 0, boredNegative: 0 };
const heat = { counts: { ...zero, excitedNegative: 12 }, cardOn: null };
/** A Db answering by function and recording every call; `windows` answers act_window_counts by the Act asked about. */
function hinting(windows: Record<string, unknown>, o: { fired?: boolean } = {}) {
  forgetHintSettings();
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  /** Hint calls, sends and drains in the order they happened. */
  const seq: string[] = [];
  const hints = { least: 8, share: 0.6, split: 0.3, window: { unit: 'minute', count: 360 } };
  const db: Db = { rpc: async <T>(fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn === 'act_window_counts' || fn === 'fire_hint') seq.push(`${fn}:${args.about}${args.pattern ? `:${args.pattern}` : ''}`);
    if (fn === 'react') return { act: target, thread: id, tally: { boo: 12 } } as T;
    if (fn === 'instance_settings') return { economy: instance.settings.economy, hints } as T;
    if (fn === 'act_window_counts') return (windows[args.about as string] ?? { counts: zero, cardOn: null }) as T;
    if (fn === 'fire_hint') return (o.fired ?? true) as T;
    return null as T;
  } };
  return { db, calls, seq };
}
const hintCalls = (calls: { fn: string; args: Record<string, unknown> }[]) => calls.filter((c) => c.fn === 'act_window_counts' || c.fn === 'fire_hint');
async function reactedWith(db: Db, request: unknown = reacting, log: string[] = []) {
  let later: (() => Promise<void>) | undefined;
  const answer = await handleAction({
    dbs: { player: db, service: db }, instance, body: request,
    send: async () => { log.push('send'); }, drain: async () => { log.push('drain'); }, after: (work) => { later = work; },
  });
  return { answer, later: later!, log };
}

test('a reaction whose window shows a pattern fires its hint, after the answer and before the drain', async () => {
  const { db, calls, seq } = hinting({ [target]: heat });
  const { answer, later } = await reactedWith(db, reacting, seq);
  assert.deepEqual(calls.map((c) => c.fn), ['react'], 'the answer was made from the reaction alone');
  assert.equal(answer.status, 200);
  await later();
  const since = (calls.find((c) => c.fn === 'act_window_counts')!.args.since) as string;
  assert.ok(Math.abs(Date.now() - 360 * 60_000 - Date.parse(since)) < 5_000, `the window starts six hours back: ${since}`);
  assert.deepEqual(hintCalls(calls), [
    { fn: 'act_window_counts', args: { about: target, since } },
    { fn: 'fire_hint', args: { about: target, pattern: 'leading:excitedNegative' } },
  ]);
  // The reaction's own broadcasts and alerts go out first, never held by the hint's reads; the hint's alert is drained once more.
  assert.deepEqual(seq, ['send', 'drain', `act_window_counts:${target}`, `fire_hint:${target}:leading:excitedNegative`, 'drain']);
});

test('the answer is the same whether a hint fires or not, and made before any hint work', async () => {
  const answers: string[] = [];
  const before: string[][] = [];
  for (const windows of [{ [target]: heat }, {}]) {
    const { db, calls } = hinting(windows);
    const { answer, later } = await reactedWith(db);
    before.push(calls.map((c) => c.fn));
    answers.push(JSON.stringify(answer));
    await later();
  }
  assert.equal(answers[0], answers[1], 'byte for byte');
  assert.deepEqual(before[0], ['react']);
  assert.deepEqual(before[0], before[1]);
});

test('a quiet window fires nothing, and only a reaction looks at hints at all', async () => {
  const quiet = hinting({ [target]: { counts: { ...zero, excitedNegative: 3 }, cardOn: null } });
  await (await reactedWith(quiet.db)).later();
  assert.deepEqual(hintCalls(quiet.calls).map((c) => c.fn), ['act_window_counts']);
  const posted = hinting({});
  await (await reactedWith(posted.db, { action: 'post', thread: id, character: id, body: 'Hello.' })).later();
  assert.deepEqual(hintCalls(posted.calls), [], 'a post is no reaction');
  const refused: Db = { rpc: async () => { throw new DatabaseError('react: no', '42501', 403, 'your characters cannot react to each other', REFUSAL_HINT); } };
  const calls: string[] = [];
  const spy: Db = { rpc: async <T>(fn: string, a: Record<string, unknown>) => { calls.push(fn); return refused.rpc<T>(fn, a); } };
  await (await reactedWith(spy)).later();
  assert.deepEqual(calls, ['react'], 'a refused reaction reads no counts');
});

test('a reaction sent again fires the same hint again, which the database answers with false: a pattern is fired once, never twice', async () => {
  const first = hinting({ [target]: heat }, { fired: true });
  const second = hinting({ [target]: heat }, { fired: false });
  await (await reactedWith(first.db)).later();
  const again = await reactedWith(second.db);
  await again.later();
  assert.equal(hintCalls(first.calls).filter((c) => c.fn === 'fire_hint').length, 1);
  assert.deepEqual(hintCalls(first.calls).filter((c) => c.fn === 'fire_hint'), hintCalls(second.calls).filter((c) => c.fn === 'fire_hint'), 'the same call both times, so SQL\'s once-per-Act-and-pattern decides');
  assert.deepEqual(again.log, ['send', 'drain'], 'a hint that did not fire is no error, and the drain still runs');
});

test('a card reacted to is compared with the post it landed on: more than the post is stealing the thunder, for both players', async () => {
  const card = { counts: { ...zero, excitedPositive: 10 }, cardOn: post };
  const { db, calls } = hinting({ [target]: card, [post]: { counts: { ...zero, calmPositive: 4 }, cardOn: null } });
  await (await reactedWith(db)).later();
  assert.deepEqual(hintCalls(calls).map((c) => `${c.fn}:${c.args.about}:${c.args.pattern ?? ''}`), [
    `act_window_counts:${target}:`, `act_window_counts:${post}:`, `fire_hint:${target}:thunder`, `fire_hint:${post}:thunder`,
  ]);
});

test('the thunder compares the window alone: a post with more reactions in all than its card, but fewer lately, is outdrawn (#149 F2)', async () => {
  // In the window the card has 10 and the post 4. However many the post drew before the window, nothing reads that: only the
  // window's counts are read, so the thunder fires, and the words say "lately" (instances/divided-world/ui/hint-words.ts).
  const card = { counts: { ...zero, excitedPositive: 10 }, cardOn: post };
  const { db, calls } = hinting({ [target]: card, [post]: { counts: { ...zero, calmPositive: 4 }, cardOn: null } });
  await (await reactedWith(db)).later();
  assert.deepEqual([...new Set(hintCalls(calls).map((c) => c.fn))], ['act_window_counts', 'fire_hint'], 'no whole-life count is read');
  assert.deepEqual(hintCalls(calls).filter((c) => c.fn === 'fire_hint').map((c) => `${c.args.about}:${c.args.pattern}`), [`${target}:thunder`, `${post}:thunder`]);
});

test('a card that has not outdrawn its post is judged by its own reactions, and its post is not read twice', async () => {
  const card = { counts: { ...zero, excitedNegative: 10 }, cardOn: post };
  const { db, calls } = hinting({ [target]: card, [post]: { counts: { ...zero, calmPositive: 30 }, cardOn: null } });
  await (await reactedWith(db)).later();
  assert.deepEqual(hintCalls(calls).filter((c) => c.fn === 'fire_hint').map((c) => `${c.args.about}:${c.args.pattern}`), [`${target}:leading:excitedNegative`]);
  assert.equal(calls.filter((c) => c.fn === 'act_window_counts').length, 2);
});

test('an error in the hint work is logged and does not stop the drain; a database error is not retried', async () => {
  forgetHintSettings();
  const seen: string[] = [];
  const fetch = (async (url: string) => {
    const fn = url.split('/').pop()!;
    seen.push(fn);
    if (fn === 'react') return new Response(JSON.stringify({ act: target, thread: id, tally: {} }), { status: 200 });
    if (fn === 'instance_settings') return new Response(JSON.stringify({ economy: instance.settings.economy, hints: { least: 8, share: 0.6, split: 0.3, window: { unit: 'minute', count: 360 } } }), { status: 200 });
    if (fn === 'act_window_counts') return new Response(JSON.stringify(heat), { status: 200 });
    return new Response(JSON.stringify({ code: '23503', message: 'insert or update on table "hints_fired" violates foreign key constraint' }), { status: 409 });
  }) as unknown as typeof globalThis.fetch;
  const dbs = actDbs({ url: 'https://p.example', key: 'service', publishable: 'sb_publishable_p', session: 'tok', fetch, sleep: async () => {} });
  const logged: unknown[][] = [];
  const was = console.error;
  console.error = (...a: unknown[]) => { logged.push(a); };
  let later!: () => Promise<void>;
  const drained: string[] = [];
  try {
    await handleAction({ dbs, instance, body: reacting, send: async () => {}, drain: async () => { drained.push('drain'); }, after: (w) => { later = w; } });
    await later();
  } finally { console.error = was; }
  assert.equal(seen.filter((f) => f === 'fire_hint').length, 1, 'a database error is a fact about the request: thrown at once');
  assert.deepEqual(drained, ['drain']);
  assert.ok(logged.some((l) => /hint/.test(String(l[0]))), 'and logged');
});

test('a transport failure on the hint\'s calls is retried on the request itself, and they are safe to repeat', async () => {
  for (const fn of ['act_window_counts', 'fire_hint']) assert.equal(SAFE_TO_REPEAT(fn), true, fn);
  const seen: string[] = [];
  let tries = 0;
  const fetch = (async (url: string) => {
    seen.push(url.split('/').pop()!);
    return ++tries < 3 ? new Response('', { status: 504 }) : new Response('true', { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  const dbs = actDbs({ url: 'https://p.example', key: 'service', publishable: 'sb_publishable_p', session: 'tok', fetch, sleep: async () => {} });
  assert.equal(await dbs.service.rpc('fire_hint', { about: target, pattern: 'divisive' }), true);
  assert.deepEqual(seen, ['fire_hint', 'fire_hint', 'fire_hint']);
});

test('a card whose thunder has already fired is judged by its own reactions after that', async () => {
  const card = { counts: { ...zero, excitedNegative: 10 }, cardOn: post };
  const h = hinting({ [target]: card, [post]: { counts: { ...zero, calmPositive: 2 }, cardOn: null } });
  const fired: Record<string, boolean> = { [`${target}:thunder`]: false, [`${post}:thunder`]: false };
  const rpc = h.db.rpc;
  const db: Db = { rpc: async <T>(fn: string, args: Record<string, unknown>) => {
    const told = fn === 'fire_hint' && `${args.about}:${args.pattern}` in fired;
    if (told) h.seq.push(`fire_hint:${args.about}:${args.pattern}`);
    return told ? (fired[`${args.about}:${args.pattern}`] as T) : rpc<T>(fn, args);
  } };
  await (await reactedWith(db, reacting, h.seq)).later();
  assert.deepEqual(h.seq.filter((s) => s.startsWith('fire_hint')), [`fire_hint:${target}:thunder`, `fire_hint:${post}:thunder`, `fire_hint:${target}:leading:excitedNegative`]);
});

test('a card under the least is not compared: its post\'s window is not read', async () => {
  const h = hinting({ [target]: { counts: { ...zero, excitedPositive: 3 }, cardOn: post } });
  await (await reactedWith(h.db, reacting, h.seq)).later();
  assert.deepEqual(h.seq.filter((s) => s.startsWith('act_window_counts')), [`act_window_counts:${target}`]);
});

test('the hint settings are read once a minute per connection, not once a reaction', async () => {
  const h = hinting({ [target]: heat });
  await (await reactedWith(h.db)).later();
  await (await reactedWith(h.db)).later();
  assert.equal(h.calls.filter((c) => c.fn === 'instance_settings').length, 1);
});

test('the hint settings are held across requests: two connections built per request make one settings read', async () => {
  forgetHintSettings();
  const seen: string[] = [];
  const fetch = (async (url: string) => {
    const fn = url.split('/').pop()!;
    seen.push(fn);
    if (fn === 'react') return new Response(JSON.stringify({ act: target, thread: id, tally: {} }), { status: 200 });
    if (fn === 'instance_settings') return new Response(JSON.stringify({ economy: instance.settings.economy, hints: { least: 8, share: 0.6, split: 0.3, window: { unit: 'minute', count: 360 } } }), { status: 200 });
    if (fn === 'act_window_counts') return new Response(JSON.stringify({ counts: zero, cardOn: null }), { status: 200 });
    return new Response('null', { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  for (let request = 0; request < 2; request++) {
    const dbs = actDbs({ url: 'https://p.example', key: 'service', publishable: 'sb_publishable_p', session: 'tok', fetch, sleep: async () => {} });
    let later!: () => Promise<void>;
    await handleAction({ dbs, instance, body: reacting, send: async () => {}, drain: async () => {}, after: (w) => { later = w; } });
    await later();
  }
  assert.equal(seen.filter((f) => f === 'instance_settings').length, 1);
  assert.equal(seen.filter((f) => f === 'act_window_counts').length, 2);
});

test('a thunder told to the card and then refused to the post is still a hint written: the second drain runs', async () => {
  const card = { counts: { ...zero, excitedPositive: 10 }, cardOn: post };
  const h = hinting({ [target]: card, [post]: { counts: { ...zero, calmPositive: 2 }, cardOn: null } });
  const rpc = h.db.rpc;
  const db: Db = { rpc: async <T>(fn: string, args: Record<string, unknown>) => {
    if (fn === 'fire_hint' && args.about === post) { h.seq.push('fire_hint:post threw'); throw new DatabaseError('fire_hint: x', '23503', 409, 'x'); }
    return rpc<T>(fn, args);
  } };
  const was = console.error;
  console.error = () => {};
  try { await (await reactedWith(db, reacting, h.seq)).later(); } finally { console.error = was; }
  assert.deepEqual(h.seq.slice(-3), [`fire_hint:${target}:thunder`, 'fire_hint:post threw', 'drain']);
  assert.equal(h.seq.filter((s) => s === 'drain').length, 2);
});

// The gate (docs/plans/2026-11-02-api-keys-design.md, section 2): with verify_jwt off, any caller reaches the handler, so nothing
// is done as the service, and no drain or hint check is scheduled, until whoami(), read with the caller's session, names an account.
const badBearer = (fn: string) => new DatabaseError(`${fn}: JWSError (CompactDecodeError Invalid number of parts: Expected 3 parts; got 1)`, 'PGRST301', 401);
/** A player's and the service's Db, recording each call; `refuse` names the player's call PostgREST refuses the bearer on, else whoami answers `whoami`. */
function gated(o: { refuse?: string; whoami?: unknown }) {
  const calls: string[] = [];
  const make = (who: string): Db => ({ rpc: async <T>(fn: string) => {
    calls.push(`${who}:${fn}`);
    if (who === 'player' && fn === o.refuse) throw badBearer(fn);
    return (fn === 'whoami' ? o.whoami : null) as T;
  } });
  return { dbs: { player: make('player'), service: make('service') }, calls };
}

test('a session the database does not take is refused at whoami(), with nothing done as the service and nothing scheduled after', async () => {
  for (const [name, world] of [['a bad bearer', { refuse: 'whoami' }], ['no account', { whoami: null }]] as const) {
    const { dbs, calls } = gated(world);
    let later = 0;
    const out = await handleAction({ dbs, instance, body: { action: 'buyCard', slot: id, price: 100 }, send: async () => {}, drain: async () => {}, after: () => { later++; } });
    assert.deepEqual({ status: out.status, body: out.body }, { status: 401, body: { error: 'sign in to act' } }, name);
    assert.deepEqual(calls, ['player:whoami'], `${name}: the service received no call`);
    assert.equal(later, 0, `${name}: no drain and no hint check`);
  }
});

test('a player\'s own call with a session the database does not take is refused as signed out, and the service is never called', async () => {
  const { dbs, calls } = gated({ refuse: 'post' });
  let later = 0;
  const out = await handleAction({ dbs, instance, body: { action: 'post', thread: id, character: id, body: 'Hello.' }, send: async () => {}, drain: async () => {}, after: () => { later++; } });
  assert.deepEqual({ status: out.status, body: out.body }, { status: 401, body: { error: 'sign in to act' } });
  assert.deepEqual(calls, ['player:post'], 'the player\'s call is the one made');
  assert.equal(later, 0, 'no drain');
});

test('a request that names no account schedules nothing after: a body refused before whoami(), or a call the database refuses for having no account', async () => {
  // A body decide() refuses, under a bearer PostgREST would not take: nothing is read, and nothing is done as the service after.
  {
    const { dbs, calls } = gated({ refuse: 'whoami' });
    let later = 0;
    const out = await handleAction({ dbs, instance, body: {}, send: async () => {}, drain: async () => {}, after: () => { later++; } });
    assert.equal(out.status, 400);
    assert.deepEqual(calls, [], 'nothing is read');
    assert.equal(later, 0, 'a refused body schedules no drain');
  }
  // A player's own call that PostgREST takes and SQL refuses for having no account (28000, as 0005 raises it).
  {
    const noAccount: Db = { rpc: async () => { throw new DatabaseError('post: sign in to act', '28000', 401, 'sign in to act', REFUSAL_HINT); } };
    let later = 0;
    const out = await handleAction({ dbs: { player: noAccount, service: noAccount }, instance, body: { action: 'post', thread: id, character: id, body: 'Hello.' },
      send: async () => {}, drain: async () => {}, after: () => { later++; } });
    assert.deepEqual({ status: out.status, body: out.body }, { status: 401, body: { error: 'sign in to act', code: '28000' } });
    assert.equal(later, 0, 'a caller with no account schedules no drain');
  }
});

// The kick for a card's written text: after the answer, for the post a play or an edit named, and only where it may have jobs.
const kicking = {
  ...instance,
  settings: { ...instance.settings, oldVoice: true },
  cards: instance.cards.map((c) => (c.key === 'whoops' ? { ...c, writes: { tokens: () => 10, frame: () => ({ prompt: 'p', stop: [] }) } } : c)),
} as typeof instance;
async function kickedBy(body: unknown, answers: Record<string, unknown>, who: typeof instance = kicking) {
  const { dbs } = pair({ whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [] }, ...answers });
  const posts: string[] = [];
  let later!: () => Promise<void>;
  const out = await handleAction({ dbs, instance: who, body, send: async () => {}, drain: async () => {}, after: (w) => { later = w; }, write: async (p) => { posts.push(p); } });
  await later();
  return { out, posts };
}

test('the kick: a play of a card that writes kicks the writer for its post, after the answer', async () => {
  const { out, posts } = await kickedBy({ action: 'playCard', card: 'whoops', character: id, target, config: { color: 'red' } }, { play_card: { id: 'k', kind: 'card' } });
  assert.equal(out.status, 200);
  assert.deepEqual(posts, [target]);
});

test('a play of a card that writes hands play_card the tokens its rules decided, and a play of any other card hands it none', async () => {
  const writing = { ...kicking, cards: kicking.cards.map((c) => (c.key === 'whoops' ? { ...c, writes: { tokens: () => 37, frame: () => ({ prompt: 'p', stop: [] }) } } : c)) } as typeof instance;
  const run = async (who: typeof instance) => {
    const { dbs, calls } = pair({ whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [] }, play_card: { id: 'k', kind: 'card' } });
    await runAction(dbs, who, { action: 'playCard', card: 'whoops', character: id, target, config: { color: 'red', tokens: 5000 } });
    return JSON.parse(calls.find((c) => c.startsWith('service:play_card:'))!.slice('service:play_card:'.length)) as Record<string, unknown>;
  };
  assert.equal((await run(writing)).tokens, 37, 'the decision\'s number, never one the request carried');
  assert.equal('tokens' in (await run(instance)), false);
});

test('a top-level tokens field of the request is ignored: the play records what the server decided, and a card that does not write gets none', async () => {
  const writing = { ...kicking, cards: kicking.cards.map((c) => (c.key === 'whoops' ? { ...c, writes: { tokens: () => 37, frame: () => ({ prompt: 'p', stop: [] }) } } : c)) } as typeof instance;
  const run = async (who: typeof instance) => {
    const { dbs, calls } = pair({ whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [] }, play_card: { id: 'k', kind: 'card' } });
    await runAction(dbs, who, { action: 'playCard', card: 'whoops', character: id, target, config: { color: 'red' }, tokens: 5000 });
    return JSON.parse(calls.find((c) => c.startsWith('service:play_card:'))!.slice('service:play_card:'.length)) as Record<string, unknown>;
  };
  assert.equal((await run(writing)).tokens, 37);
  assert.equal('tokens' in (await run(instance)), false);
});

test('the kick: a play of another card makes no claim at all', async () => {
  // The same play of a card whose rules do not write.
  const plain = await kickedBy({ action: 'playCard', card: 'whoops', character: id, target, config: { color: 'red' } }, { play_card: { id: 'k', kind: 'card' } }, instance);
  assert.equal(plain.out.status, 200);
  assert.deepEqual(plain.posts, []);
  const other = await kickedBy(reacting, { react: { act: target, thread: id, tally: {} } });
  assert.deepEqual(other.posts, []);
});

test('the kick: an edit kicks, since any post may have a tail waiting', async () => {
  const { posts } = await kickedBy({ action: 'edit', post: target, character: id, body: 'y' }, { edit_post: { id: 'e', thread: id } });
  assert.deepEqual(posts, [target]);
});

test('the kick: a refused play or edit kicks nothing, and a kick that throws is logged and never escapes', async () => {
  const refusing: Db = { rpc: async () => { throw new DatabaseError('x', '55000', 400, 'no', REFUSAL_HINT); } };
  let later!: () => Promise<void>;
  const posts: string[] = [];
  await handleAction({ dbs: { player: refusing, service: refusing }, instance: kicking, body: { action: 'edit', post: target, character: id, body: 'y' }, send: async () => {}, drain: async () => {}, after: (w) => { later = w; }, write: async (p) => { posts.push(p); } });
  await later();
  assert.deepEqual(posts, []);
  const { dbs } = pair({ edit_post: { id: 'e', thread: id } });
  const was = console.error; console.error = () => {};
  try {
    await handleAction({ dbs, instance: kicking, body: { action: 'edit', post: target, character: id, body: 'y' }, send: async () => {}, drain: async () => {}, after: (w) => { later = w; }, write: async () => { throw new Error('endpoint down'); } });
    await later();
  } finally { console.error = was; }
});

test('a gift is the service\'s, for whoever the session is, and only the gift\'s projection is broadcast, never a balance', async () => {
  const thread = '66666666-6666-4666-8666-666666666666';
  const gift = { id: '77777777-7777-4777-8777-777777777777', kind: 'donation', thread, character: id, targetActId: target, seq: null, payload: { amount: 25 } };
  const { dbs, calls } = pair({ whoami, donate: { gift, balance: 475 } });
  const out = await runAction(dbs, instance, { action: 'donate', character: id, drive: target, amount: 25 });
  assert.ok(calls.includes(`service:donate:${JSON.stringify({ through: id, drive: target, amount: 25, who: whoami })}`), calls.join('\n'));
  assert.deepEqual(out.body, { gift, balance: 475 }, 'the giver is answered with the gift and their own balance');
  assert.deepEqual(out.broadcasts, [{ topic: `thread:${thread}`, event: 'act', payload: gift }]);
  assert.doesNotMatch(JSON.stringify(out.broadcasts), /balance|475/, 'no wallet or balance is sent live');
});

// Task 6 (card notes, Part 6): what a skim play, a ride set and a scored-as play send play_card and set_card, and how the server's refusals of them come back.
const playCalls = (calls: string[]) => calls.filter((c) => c.startsWith('service:play_card:'));

test('a skim play\'s configuration reaches play_card as the card\'s validator shaped it, and a second for the same quadrant is refused before SQL', async () => {
  const { dbs, calls } = pair({ whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [] }, play_card: { id: 'k', kind: 'card' } });
  const out = await runAction(dbs, instance, { action: 'playCard', card: 'mooch', character: id, target, config: { quadrant: 'excitedPositive', extra: 'smuggled' }, message: '' });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const sent = playCalls(calls);
  assert.equal(sent.length, 1, calls.join('\n'));
  assert.ok(sent[0]!.includes('"config":{"quadrant":"excitedPositive"}') && !sent[0]!.includes('smuggled'), sent[0]);

  const live = { card: 'mooch', act: 'm', ends: new Date(Date.now() + 1e6).toISOString(), quadrant: 'excitedPositive' };
  const same = pair({ whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [live] }, play_card: { id: 'k', kind: 'card' } });
  const refused = await runAction(same.dbs, instance, { action: 'playCard', card: 'mooch', character: id, target, config: { quadrant: 'excitedPositive' }, message: '' });
  assert.deepEqual({ status: refused.status, body: refused.body }, { status: 400, body: { field: 'config', error: 'this post already carries that card for that quadrant' } });
  assert.equal(playCalls(same.calls).length, 0);
  const other = await runAction(same.dbs, instance, { action: 'playCard', card: 'mooch', character: id, target, config: { quadrant: 'boredNegative' }, message: '' });
  assert.equal(other.status, 200, JSON.stringify(other.body));

  const none = await runAction(same.dbs, instance, { action: 'playCard', card: 'mooch', character: id, target, config: {}, message: '' });
  assert.deepEqual({ status: none.status, body: none.body }, { status: 400, body: { field: 'config', error: 'choose the reactions to mooch' } });
});

test('a ride set sends the catch from the card\'s rules and the quadrant in its configuration', async () => {
  const { dbs, calls } = pair(onPost);
  const out = await runAction(dbs, instance, { action: 'setCard', card: '4d-chess', character: id, target, config: { card: 'whoops', quadrant: 'calmPositive', extra: 'smuggled' }, catches: 'glitter-bomb' });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const sent = setCalls(calls);
  assert.ok(sent[0]!.includes('"catches":"whoops"') && sent[0]!.includes('"quadrant":"calmPositive"') && !sent[0]!.includes('glitter-bomb') && !sent[0]!.includes('smuggled'), sent[0]);
  const none = await runAction(pair(onPost).dbs, instance, { action: 'setCard', card: '4d-chess', character: id, target, config: { card: 'whoops' } });
  assert.deepEqual({ status: none.status, body: none.body }, { status: 400, body: { field: 'config', error: 'choose the reactions it pays on' } });
});

test('a scored-as play names its class in its configuration and goes to play_card on a character', async () => {
  const post = '44444444-4444-4444-8444-444444444444';
  const named = instance.classes[0]!.key;
  const { dbs, calls } = pair({ whoami, card_target_reach: { reach: 'character', character: target, effects: [], above: { thread: [], board: [] } }, play_card: { id: 'k', kind: 'card' } });
  const out = await runAction(dbs, instance, { action: 'playCard', card: 'off-day', character: id, reach: 'character', target, post, config: { class: named, extra: 1 }, message: '' });
  assert.equal(out.status, 200, JSON.stringify(out.body));
  const sent = playCalls(calls);
  assert.ok(sent[0]!.includes(`"config":{"class":"${named}"}`) && sent[0]!.includes('"reach":"character"'), sent[0]);
  const bad = await runAction(dbs, instance, { action: 'playCard', card: 'off-day', character: id, reach: 'character', target, post, config: { class: 'no-such-class' }, message: '' });
  assert.deepEqual({ status: bad.status, body: bad.body }, { status: 400, body: { field: 'config', error: 'choose the class to name' } });
});

test('each refusal of a skim, a ride and a scored-as play comes back as a plain refusal with its words', async () => {
  const cases = [
    ['22023', 400, 'this card names a reaction quadrant'],
    ['23505', 409, 'this post already carries that card for that quadrant'],
    ['22023', 400, 'there is no such class'],
    ['55000', 409, 'the next settlement\'s time is not known yet, so no window can be named; play it after that settlement'],
    ['55000', 409, 'this season ends at the next settlement, so there is no window after it to name'],
    ['23505', 409, 'this character already has a class named for the window after the next settlement'],
  ] as const;
  for (const [code, status, words] of cases) {
    const refusal = new DatabaseError(`play_card: ${words}`, code, status, words, REFUSAL_HINT);
    const answers: Record<string, unknown> = { whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [] } };
    const make = (): Db => ({ rpc: async <T>(fn: string) => { if (fn === 'play_card') throw refusal; return (fn === 'instance_settings' ? { economy: instance.settings.economy } : answers[fn]) as T; } });
    const out = await runAction({ player: make(), service: make() }, instance, { action: 'playCard', card: 'mooch', character: id, target, config: { quadrant: 'excitedPositive' }, message: '' });
    assert.deepEqual({ status: out.status, body: out.body }, { status, body: { error: words, code } }, words);
  }
});

// A surface card (docs/plans/2026-11-11-graffiti-plan.md, Task 3). The act function names no instance's card, so the case uses a fixture: Whoops!'s rules with a surface.
{
  const dab = { strokes: [{ width: 0.012, aspect: 1, points: [[0.505, 0.505]] }] };
  const strokes = (i: unknown) => (typeof i === 'object' && i !== null && Array.isArray((i as { strokes?: unknown }).strokes)
    ? { ok: true as const, value: { strokes: (i as { strokes: never[] }).strokes, payload: { strokes: (i as { strokes: unknown[] }).strokes } } } : { ok: false as const, why: 'draw some strokes' });
  const base = instance.cards.find((c) => c.key === 'whoops')!;
  const wall = { ...base, key: 'wall', name: 'Wall', stack: 1, screenReads: [{ key: 'wall.limit', whole: true, min: 1, max: 100 }], surface: { limitKey: 'wall.limit', mostLive: 7, validateDraw: strokes, validateWash: strokes } };
  const walled = { ...instance, cards: [...instance.cards, wall], settings: { ...instance.settings, cardSettings: { ...instance.settings.cardSettings, 'wall.limit': 40 } } };
  const rows = (limit: number) => ({ economy: instance.settings.economy, cardSettings: { ...instance.settings.cardSettings, 'wall.limit': limit } });
  const thread = '44444444-4444-4444-8444-444444444444';

  test('a draw reads its wall\'s card, decides the drawing by that card, and takes the limit from the settings rows, not from the deployed code', async () => {
    for (const [limit, most] of [[10, 1000], [25, 2500]] as const) {
      const { dbs, calls } = pair({ instance_settings: rows(limit), whoami, card_of_play: 'wall', draw_on_surface: { id: 'd', thread, covered: 1, live: ['d'] } });
      const out = await runAction(dbs, walled, { action: 'draw', character: id, play: target, input: dab });
      assert.equal(out.status, 200);
      const sent = calls.find((c) => c.startsWith('service:draw_on_surface:'))!;
      const args = JSON.parse(sent.slice('service:draw_on_surface:'.length));
      assert.equal(args.most, most, `the rows say ${limit}%, the code 40%`);
      assert.deepEqual({ who: args.who, through: args.through, play: args.play, payload: args.payload }, { who: whoami, through: id, play: target, payload: { strokes: dab.strokes } });
      assert.equal(args.cells.length, 10000);
      assert.equal(args.cells.split('1').length - 1, 1);
      assert.equal('input' in args, false);
    }
  });

  test('a draw or a wash on a card that holds no wall is refused, and a drawing the card refuses says why; nothing is written', async () => {
    for (const action of ['draw', 'wash']) {
      const none = pair({ whoami, card_of_play: 'whoops' });
      const out = await runAction(none.dbs, walled, { action, character: id, play: target, input: dab });
      assert.deepEqual({ status: out.status, body: out.body }, { status: 400, body: { field: 'play', error: 'this card holds no wall' } }, action);
      assert.ok(!none.calls.some((c) => /service:(draw_on_surface|wash_surface)/.test(c)));
    }
    const bad = pair({ whoami, card_of_play: 'wall' });
    const out = await runAction(bad.dbs, walled, { action: 'draw', character: id, play: target, input: 'scribble' });
    assert.deepEqual({ status: out.status, body: out.body }, { status: 400, body: { field: 'input', error: 'draw some strokes' } });
    assert.ok(!bad.calls.some((c) => c.includes('draw_on_surface')));
  });

  test('a surface card played with no first draw is refused before the database is asked', async () => {
    for (const action of ['playCard']) {
      const { dbs, calls } = pair({ whoami });
      const out = await runAction(dbs, walled, { action, card: 'wall', character: id, target, config: {}, message: '' });
      assert.deepEqual({ status: out.status, body: out.body }, { status: 400, body: { field: 'first', error: 'draw your tag first' } }, action);
      assert.equal(calls.length, 0);
    }
  });

  test('a surface card played with its first draw is written by play_surface_card, with the draw\'s cells, the limit from the rows and the card\'s most live draws', async () => {
    const { dbs, calls } = pair({ instance_settings: rows(30), whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 10, body: 'hello', effects: [] },
      play_surface_card: { id: 'k', kind: 'card', thread, draw: { id: 'd', thread, covered: 1, live: ['d'], payload: { strokes: [] } } } });
    const out = await runAction(dbs, walled, { action: 'playCard', card: 'wall', character: id, target, config: { color: 'red' }, message: '', first: dab });
    assert.equal(out.status, 200);
    const sent = JSON.parse(calls.find((c) => c.startsWith('service:play_surface_card:'))!.slice('service:play_surface_card:'.length));
    assert.deepEqual({ card: sent.card, first: sent.first, most: sent.most, most_live: sent.most_live, who: sent.who }, { card: 'wall', first: { strokes: dab.strokes }, most: 3000, most_live: 7, who: whoami });
    assert.equal(sent.first_cells.length, 10000);
    assert.ok(!calls.some((c) => c.includes('service:play_card:')));
    // The play is heard as a play, without the drawing in it; the wall's own count follows, and never its strokes.
    assert.deepEqual(out.broadcasts, [
      { topic: `thread:${thread}`, event: 'act', payload: { id: 'k', kind: 'card', thread } },
      { topic: `thread:${thread}`, event: 'surface', payload: { play: 'k', covered: 1 } },
    ]);
  });

  test('a surface card (a cast card) set face down is written by set_surface_card with its draft, and refused without a first draw', async () => {
    const { dbs, calls } = pair({ instance_settings: rows(30), whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 10, body: 'hello', effects: [] }, set_surface_card: { id: 's', thread } });
    const out = await runAction(dbs, walled, { action: 'setCard', card: 'wall', character: id, target, config: { color: 'red' }, first: dab });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    const sent = JSON.parse(calls.find((c) => c.startsWith('service:set_surface_card:'))!.slice('service:set_surface_card:'.length));
    assert.deepEqual({ draft: sent.draft, most: sent.most, most_live: sent.most_live, first: sent.first, who: sent.who }, { draft: { strokes: dab.strokes }, most: 3000, most_live: 7, first: undefined, who: whoami });
    assert.equal(sent.draft_cells.length, 10000);
    assert.ok(!calls.some((c) => c.includes('service:set_card:')));
    const none = pair({ whoami });
    const refused = await runAction(none.dbs, walled, { action: 'setCard', card: 'wall', character: id, target, config: {} });
    assert.deepEqual(refused.body, { field: 'first', error: 'draw your tag first' });
    assert.equal(none.calls.length, 0);
  });

  test('a first draw the card refuses is refused on the field `first`, so the screen shows it on the drawing', async () => {
    for (const action of ['playCard', 'setCard']) {
      const { dbs } = pair({ instance_settings: rows(30), whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 10, body: 'hello', effects: [] } });
      const out = await runAction(dbs, walled, { action, card: 'wall', character: id, target, config: { color: 'red' }, message: '', first: 'scribble' });
      assert.deepEqual({ status: out.status, body: out.body }, { status: 400, body: { field: 'first', error: 'draw some strokes' } }, action);
    }
  });

  test('a draw\'s and a wash\'s broadcast is the wall\'s count on its thread, and holds no strokes', async () => {
    for (const [action, rpc] of [['draw', 'draw_on_surface'], ['wash', 'wash_surface']] as const) {
      const answer = { id: 'd', thread, kind: action, payload: { strokes: dab.strokes }, covered: 12, live: ['d'] };
      const { dbs } = pair({ instance_settings: rows(30), whoami, card_of_play: 'wall', [rpc]: answer });
      const out = await runAction(dbs, walled, { action, character: id, play: target, input: dab });
      assert.deepEqual(out.broadcasts, [{ topic: `thread:${thread}`, event: 'surface', payload: { play: target, covered: 12 } }], action);
      assert.ok(!JSON.stringify(out.broadcasts).includes('strokes'));
    }
  });

  test('neither a draw nor a wash is repeated after a lost answer, which is said as lost', async () => {
    assert.equal(SAFE_TO_REPEAT('draw_on_surface'), false);
    assert.equal(SAFE_TO_REPEAT('wash_surface'), false);
    for (const action of ['draw', 'wash']) {
      const db: Db = { rpc: async <T>(fn: string) => { if (fn === 'draw_on_surface' || fn === 'wash_surface') throw new TransportError('gone'); return (fn === 'instance_settings' ? rows(30) : fn === 'card_of_play' ? 'wall' : whoami) as T; } };
      const out = await runAction({ player: db, service: db }, walled, { action, character: id, play: target, input: dab });
      assert.equal(out.status, 503, action);
      assert.match(JSON.stringify(out.body), /may have gone through/);
    }
  });
}

test('a no-quote card is refused before SQL on a post whose read holds a live back, and in its own words', async () => {
  const { dbs, calls } = pair({ whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [{ card: null, act: 'b', faceDown: true, ends: new Date(Date.now() + 1e6).toISOString() }] } });
  const out = await runAction(dbs, tested, { action: 'useCard', card: 'test-hush', character: id, target, config: {} });
  assert.deepEqual({ status: out.status, body: out.body }, { status: 400, body: { field: 'config', error: 'Test Hush stops quotes, and this post holds a card face down; take that card back first' } });
  assert.ok(!calls.some((c) => c.startsWith('service:play_card:')), calls.join('\n'));
});

test('a Set is refused before SQL on a post whose read holds a live no-quote, in the words of decideSet', async () => {
  const ends = new Date(Date.now() + 1e6).toISOString();
  const { dbs, calls } = pair({ whoami, card_target_reach: { reach: 'post', act: target, kind: 'post', length: 10, body: 'x'.repeat(10), effects: [{ card: 'test-hush', act: 'h', gimmick: { kind: 'noQuote' }, ends }] } });
  const out = await runAction(dbs, tested, { action: 'setCard', card: 'test-move', character: id, target });
  assert.equal(out.status, 400);
  assert.match(String((out.body as { error: string }).error), /^this post's Test Hush stops quotes until .+, so no card is set face down here until then$/);
  assert.ok(!calls.some((c) => c.startsWith('service:set_card:')), calls.join('\n'));
});
