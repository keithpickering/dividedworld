/**
 * End to end: every action through the Edge Function's own core (supabase/functions/act/core.ts),
 * as a player, against the real migrations. What only this proves: that the arguments
 * engine/rules/actions.ts decides are the ones each SQL function takes, by name, and that what
 * comes back is the public projection. Run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psqlDb, sql } from './psql-db.ts';
import { runAction } from '../../functions/act/core.ts';
import { instance } from '../../functions/_shared/instance.ts';
import { instanceSeed } from '../../functions/_shared/seed.ts';

test('a player starts a thread, replies quoting it, edits, spins a thread from it, and another reacts', async () => {
  await psqlDb().rpc('seed_instance', { payload: instanceSeed(instance) });
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
  const bought = await runAction(asAnn, instance, { action: 'buyCard', card: 'whoops' });
  assert.equal(bought.status, 200, JSON.stringify(bought));
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
