/**
 * End to end: every action through the Edge Function's own core (supabase/functions/act/core.ts),
 * as a player, against the real migrations. What only this proves: that the arguments
 * engine/rules/actions.ts decides are the ones each SQL function takes, by name, and that what
 * comes back is the public projection. Run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psqlDb, sql, scratchSeed } from './psql-db.ts';
import { runAction } from '../../functions/act/core.ts';
import { instance } from '../../functions/_shared/instance.ts';

test('a player starts a thread, replies quoting it, edits, spins a thread from it, and another reacts', async () => {
  await psqlDb().rpc('seed_instance', { payload: scratchSeed(instance) });
  const make = (label: string, name: string) => {
    const account = sql(`with u as (insert into auth.users (email) values ('${label}@test.invalid') returning id) insert into accounts (id) select id from u returning id`);
    const character = sql(`with c as (insert into characters (owner, name, debuted_at) values ('${account}', '${name}', now()) returning id)
      insert into class_history (character, class_key) select id, 'heel' from c returning character`);
    return { account, character };
  };
  const ann = make('act-e2e-ann', 'Wrenchwork');
  const bob = make('act-e2e-bob', 'Cogsworth');
  const service = psqlDb();
  const asAnn = { player: psqlDb(ann.account), service };
  const asBob = { player: psqlDb(bob.account), service };

  const started = await runAction(asAnn, instance, { action: 'startThread', board: 'general', character: ann.character, title: 'Hot take', body: 'Pineapple.' });
  assert.equal(started.status, 200, JSON.stringify(started));
  const { thread, act } = started.body as { thread: { id: string }; act: { id: string; seq: number } };
  assert.equal(act.seq, 1);

  const replied = await runAction(asAnn, instance, { action: 'post', thread: thread.id, character: ann.character, body: 'As I said:', quote: act.id });
  assert.equal(replied.status, 200, JSON.stringify(replied));
  assert.equal((replied.body as { target_act_id: string }).target_act_id, act.id);

  const edited = await runAction(asAnn, instance, { action: 'edit', post: act.id, character: ann.character, body: 'Pineapple, definitely.' });
  assert.equal((edited.body as { current_payload: { body: string } }).current_payload.body, 'Pineapple, definitely.');

  const spun = await runAction(asAnn, instance, { action: 'spin', origin: act.id, character: ann.character, title: 'On pineapple' });
  assert.equal(spun.status, 200, JSON.stringify(spun));
  assert.equal((spun.body as { thread: { origin_act_id: string } }).thread.origin_act_id, act.id);

  const reacted = await runAction(asBob, instance, { action: 'react', act: act.id, character: bob.character, kind: 'tomato' });
  assert.deepEqual({ status: reacted.status, body: reacted.body }, { status: 200, body: { act: act.id, thread: thread.id, tally: { tomato: 1 } } });
  assert.deepEqual(reacted.broadcasts, [{ topic: `thread:${thread.id}`, event: 'tally', payload: { act: act.id, tally: { tomato: 1 } } }]);

  // The database's refusal, in its own words: Ann's characters cannot react to her own post.
  const own = await runAction(asAnn, instance, { action: 'react', act: act.id, character: ann.character, kind: 'fire' });
  assert.equal(own.status, 400);
  assert.match(String((own.body as { error: string }).error), /your characters cannot react/);

  // The Vending Machine, a play priced by its post, and the author washing the ink away.
  sql(`insert into wallets (account, balance) values ('${ann.account}', 300) on conflict (account) do update set balance = 300`);
  // A purchase names the slot and the price the screen showed (machine_now), and the database holds the slot.
  const [slot, shown] = sql(`select slot || ' ' || price from machine_now where card = 'whoops'`).split(' ');
  const bought = await runAction(asAnn, instance, { action: 'buyCard', slot, price: Number(shown) });
  assert.equal(bought.status, 200, JSON.stringify(bought));
  const stale = await runAction(asAnn, instance, { action: 'buyCard', slot, price: Number(shown) + 1 });
  assert.equal(stale.status, 400, JSON.stringify(stale));
  assert.match(String((stale.body as { error: string }).error), /the price is now/);
  const played = await runAction(asAnn, instance, { action: 'playCard', card: 'whoops', character: ann.character, target: act.id, config: { color: 'Teal', seed: 1 }, message: ' Oops. ' });
  assert.equal(played.status, 200, JSON.stringify(played));
  const { seed, ...payload } = (played.body as { payload: { seed: unknown } }).payload;
  assert.deepEqual(payload, { card: 'whoops', layer: 1, message: 'Oops.', config: { color: 'teal' } });
  assert.ok(Number.isSafeInteger(seed) && (seed as number) >= 0 && (seed as number) < 2 ** 31, `the server's seed: ${seed}`);
  const k = (played.body as { id: string }).id;
  assert.equal(Number(sql(`select balance from wallets where account = '${ann.account}'`)), 200, 'a short post: the play costs nothing more');
  const caster = await runAction(asAnn, instance, { action: 'saveEffect', play: k, character: ann.character, state: { strokes: [] } });
  assert.equal(caster.status, 200, 'Ann wrote the post she splatted, so she is its author here');
  const notAuthor = await runAction(asBob, instance, { action: 'saveEffect', play: k, character: bob.character, state: { strokes: [] } });
  assert.ok(notAuthor.status >= 400 && notAuthor.status < 500, 'a refusal (psql has no HTTP status to give)');
  assert.match(String((notAuthor.body as { error: string }).error), /only the post's author/);
  const again = await runAction(asAnn, instance, { action: 'playCard', card: 'whoops', character: ann.character, target: act.id, config: { color: 'red' } });
  assert.equal(again.status, 400, 'no card left, and the post carries one already');

  // A Turn, announced, waits for the settlement: nothing public yet, and nothing sent live. Bob
  // may withdraw it until then.
  const turned = await runAction(asBob, instance, { action: 'turn', character: bob.character, class: 'jabroni', loudness: 'announced' });
  assert.equal(turned.status, 200, JSON.stringify(turned));
  const { takes_effect_at: when, ...waiting } = turned.body as { takes_effect_at: string | null };
  assert.deepEqual(waiting, { pending: true, class: 'jabroni', loudness: 'announced', show_from: false, show_to: false });
  assert.equal(when, sql(`select to_json(next_settlement_at())`).replace(/^"|"$/g, '') || null, 'it says when it takes effect, or that the first run decides');
  assert.deepEqual(turned.broadcasts, []);
  const withdrawn = await runAction(asBob, instance, { action: 'withdrawTurn', character: bob.character });
  assert.equal(withdrawn.status, 200, JSON.stringify(withdrawn));
  assert.equal(sql(`select count(*) from pending_turns where character = '${bob.character}'`), '0');

  // Nothing any action answered, or sent live, names a player.
  for (const answer of [started, replied, edited, spun, reacted, own, bought, played, caster, notAuthor, again, turned]) {
    assert.ok(!JSON.stringify(answer).includes(ann.account) && !JSON.stringify(answer).includes(bob.account), 'an answer carried an account');
  }
});

test('a barred player apologizes through the action rules: an empty body is refused by field, a real one opens the thread live, and a second waits', async () => {
  await psqlDb().rpc('seed_instance', { payload: scratchSeed(instance) });
  const account = sql(`with u as (insert into auth.users (email) values ('act-e2e-sorry@test.invalid') returning id) insert into accounts (id) select id from u returning id`);
  const character = sql(`with c as (insert into characters (owner, name, debuted_at) values ('${account}', 'Sorryworks', now()) returning id)
    insert into class_history (character, class_key) select id, 'heel' from c returning character`);
  // A staff move that bars the character from General and asks an apology, written as the staff writes it (0127's model).
  const move = sql(`do $$
    declare made uuid;
    begin
      perform set_config('kayfabb.staff_writer', 'on', true);
      made := tests.act((select id from characters where staff = '${instance.system.firstBoss}'), 'move',
        (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements'),
        jsonb_build_object('kind', 'conferGroup', 'body', 'Moved.',
          'params', jsonb_build_object('character', '${character}', 'group', 'trialMembers', 'board', (select id::text from boards where slug = 'general')),
          'demand', jsonb_build_object('kind', 'apologyAccepted', 'params', '{}'::jsonb),
          'expires_at', clock_timestamp() + interval '3 days'));
      perform set_config('kayfabb.staff_writer', '', true);
    end $$;
    select id from acts where kind = 'move' and payload -> 'params' ->> 'character' = '${character}'`);
  const asSorry = { player: psqlDb(account), service: psqlDb() };
  const written = () => sql(`select (select count(*) from acts where character = '${character}' and kind = 'spin') || ' ' || (select count(*) from apologies where character = '${character}')`);
  assert.equal(written(), '0 0');

  // The action rules read the request first: an empty apology never reaches the SQL function.
  const empty = await runAction(asSorry, instance, { action: 'apologize', move, character, title: 'I am sorry', body: '' });
  assert.equal(empty.status, 400, JSON.stringify(empty));
  assert.equal((empty.body as { field: string }).field, 'body');
  assert.equal(written(), '0 0', 'a refused apology wrote nothing');

  const sent = await runAction(asSorry, instance, { action: 'apologize', move, character, title: 'I am sorry', body: 'I was wrong, and here is why.' });
  assert.equal(sent.status, 200, JSON.stringify(sent));
  const { thread, act } = sent.body as { thread: { id: string }; act: { id: string } };
  assert.equal(sql(`select count(*) from acts a join threads t on t.id = a.thread where a.id = '${act.id}' and a.kind = 'spin' and a.character = '${character}' and a.target_act_id = '${move}' and t.id = '${thread.id}' and t.origin_act_id = '${move}'`), '1', 'the apology is the spin of the move');
  assert.equal(sql(`select count(*) || ' ' || min(state) from apologies where character = '${character}' and move_act = '${move}' and apology_act = '${act.id}'`), '1 pending');
  const { board } = thread as unknown as { board: string };
  assert.deepEqual(sent.broadcasts, [
    { topic: `board:${board}`, event: 'thread', payload: thread },
    { topic: `thread:${thread.id}`, event: 'act', payload: act },
  ], 'the thread and its Act are heard live');
  assert.ok(!JSON.stringify(sent).includes(account), 'the answer carried an account');

  // One at a time: a second is refused in the database's own words.
  const second = await runAction(asSorry, instance, { action: 'apologize', move, character, title: 'Again', body: 'Again.' });
  assert.ok(second.status >= 400 && second.status < 500, JSON.stringify(second));
  assert.match(String((second.body as { error: string }).error), /still waiting for a ruling/);
  assert.equal(written(), '1 1', 'a refused second apology wrote nothing');
});
