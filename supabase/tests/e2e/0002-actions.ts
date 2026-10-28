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
    const character = sql(`with c as (insert into characters (owner, name) values ('${account}', '${name}') returning id)
      insert into class_history (character, class_key) select id, 'heel' from c returning character`);
    return { account, character };
  };
  const ann = make('act-e2e-ann', 'Wrenchwork');
  const bob = make('act-e2e-bob', 'Cogsworth');
  const asAnn = psqlDb(ann.account);
  const asBob = psqlDb(bob.account);

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
  assert.deepEqual(reacted, { status: 200, body: { tomato: 1 } });

  // The database's refusal, in its own words: Ann's characters cannot react to her own post.
  const own = await runAction(asAnn, instance, { action: 'react', act: act.id, character: ann.character, kind: 'fire' });
  assert.equal(own.status, 400);
  assert.match(String((own.body as { error: string }).error), /your characters cannot react/);

  // Nothing any action answered names a player.
  for (const answer of [started, replied, edited, spun, reacted, own]) {
    assert.ok(!JSON.stringify(answer).includes(ann.account) && !JSON.stringify(answer).includes(bob.account), 'an answer carried an account');
  }
});
