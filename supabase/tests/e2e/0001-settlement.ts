/**
 * End to end: the settlement job's own core (supabase/functions/settle/core.ts) and the seed
 * (supabase/functions/_shared/seed.ts), against the real migrations on the scratch database,
 * with Divided World seeded as the composition root seeds it. What only this proves: that
 * settlement_input()'s rows are the SettlementInput the engine reads, and that what the
 * engine returns is what apply_settlement() takes. Run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psqlDb, sql } from './psql-db.ts';
import { runSettlement } from '../../functions/settle/core.ts';
import { instanceSeed } from '../../functions/_shared/seed.ts';
import { instance } from '../../functions/_shared/instance.ts';

test('a day on the board settles into wallets and standings, once', async () => {
  const db = psqlDb();
  await db.rpc('seed_instance', { payload: instanceSeed(instance) });

  // The day starts where the history ends (an earlier race file commits a window).
  const start = sql(`select to_jsonb(coalesce(max(ends_at), now()))#>>'{}' from settlements`);
  const at = (hours: number) => new Date(Date.parse(start) + hours * 3_600_000).toISOString();
  const ids = JSON.parse(sql(`
    with u as (insert into auth.users (email) values ('e2e-heel@test.invalid'), ('e2e-face@test.invalid'), ('e2e-lurk@test.invalid') returning id, email),
    a as (insert into accounts (id) select id from u returning id)
    select json_object_agg(split_part(email, '@', 1), id) from u`));
  const characters = JSON.parse(sql(`
    with c as (insert into characters (owner, name, created_at) values
      ('${ids['e2e-heel']}', 'Pipewrench', '${at(-1)}'), ('${ids['e2e-face']}', 'Sunbeam', '${at(-1)}'), ('${ids['e2e-lurk']}', 'Shadow', '${at(-1)}')
      returning id, name),
    h as (insert into class_history (character, class_key, started_at)
      select id, case name when 'Pipewrench' then 'heel' when 'Sunbeam' then 'face' else 'lurker' end, '${at(-1)}' from c returning 1)
    select json_object_agg(name, id) from c`));
  const post = sql(`
    with t as (insert into threads (board, title) select id, 'A take' from boards where slug = 'general' returning id)
    insert into acts (character, kind, thread, payload, created_at)
    select '${characters.Pipewrench}', 'post', t.id, '{"body": "Pineapple belongs on pizza."}', '${at(1)}' from t returning id`);
  sql(`insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values
    ('${post}', '${characters.Sunbeam}', '${ids['e2e-face']}', 'tomato', 1, '${at(2)}'),
    ('${post}', '${characters.Shadow}', '${ids['e2e-lurk']}', 'angry', 1, '${at(3)}')`);

  const until = at(24);
  const first = await runSettlement(db, instance, until);
  assert.equal(first.status, 'applied', JSON.stringify(first));

  const heel = Number(sql(`select balance from wallets where account = '${ids['e2e-heel']}'`));
  const lurk = Number(sql(`select balance from wallets where account = '${ids['e2e-lurk']}'`));
  assert.equal(heel, 20, 'two whole votes of heat on the Heel\'s post');
  assert.equal(lurk, 10, 'the Lurker reacted early, in the direction the post ended up');
  assert.equal(Number(sql(`select amount from standings where character = '${characters.Pipewrench}'`)), 20);
  assert.equal(sql(`select string_agg(reason, ',' order by reason) from ledger where character = '${characters.Pipewrench}'`), 'heel.drewHeat');

  const again = await runSettlement(db, instance, until);
  assert.equal(again.status, 'nothing to settle');
  assert.equal(Number(sql(`select balance from wallets where account = '${ids['e2e-heel']}'`)), 20, 'a second run changes nothing');
});

test('a spin from The System\'s reveal settles like any other, and the settlement goes on', async () => {
  const db = psqlDb();
  const start = sql(`select to_jsonb(coalesce(max(ends_at), now()))#>>'{}' from settlements`);
  const at = (hours: number) => new Date(Date.parse(start) + hours * 3_600_000).toISOString();
  const ids = JSON.parse(sql(`
    with u as (insert into auth.users (email) values ('e2e-spin-a@test.invalid'), ('e2e-spin-b@test.invalid') returning id, email),
    a as (insert into accounts (id) select id from u returning id)
    select json_object_agg(split_part(email, '@', 1), id) from u`));
  const characters = JSON.parse(sql(`
    with c as (insert into characters (owner, name, created_at) values
      ('${ids['e2e-spin-a']}', 'Spinner', '${at(-1)}'), ('${ids['e2e-spin-b']}', 'Replier', '${at(-1)}') returning id, name),
    h as (insert into class_history (character, class_key, started_at) select id, 'face', '${at(-1)}' from c returning 1)
    select json_object_agg(name, id) from c`));
  // The System's own Act, as the reveal writes it, then a spin from it and a reply in the spun thread.
  sql(`
    with t as (insert into threads (board, title) select id, 'Season 0: The Reveal' from boards order by created_at limit 1 returning id, board),
    r as (insert into acts (character, kind, thread, payload, created_at) select null, 'reveal', t.id, '{}', '${at(1)}' from t returning id, thread),
    s as (insert into threads (board, title, origin_act_id) select t.board, 'About the reveal', r.id from t, r returning id),
    sp as (insert into acts (character, kind, thread, target_act_id, payload, created_at) select '${characters.Spinner}', 'spin', s.id, r.id, '{"body": ""}', '${at(2)}' from s, r returning 1)
    insert into acts (character, kind, thread, payload, created_at) select '${characters.Replier}', 'post', s.id, '{"body": "Called it."}', '${at(3)}' from s`);
  const out = await runSettlement(db, instance, at(24));
  assert.equal(out.status, 'applied', JSON.stringify(out));
});
