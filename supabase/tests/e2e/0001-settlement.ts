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
import { SPAN_MOST } from '../../../engine/rules/instance.ts';

test('a span\'s largest count is one number in the code\'s settings and the database\'s', () => {
  const write = (count: number) => sql(`do $$ begin
    update settings set value = '{"unit": "week", "count": ${count}}' where key = 'turnCooldown';
    raise notice 'written';
  exception when check_violation then raise notice 'refused'; end $$; select 1`);
  const kept = sql(`select value from settings where key = 'turnCooldown'`);
  assert.doesNotThrow(() => write(SPAN_MOST));
  assert.equal(JSON.parse(sql(`select value from settings where key = 'turnCooldown'`)).count, SPAN_MOST, 'the code\'s largest count is written');
  write(SPAN_MOST + 1);
  assert.equal(JSON.parse(sql(`select value from settings where key = 'turnCooldown'`)).count, SPAN_MOST, 'and one more is refused');
  sql(`update settings set value = '${kept}' where key = 'turnCooldown'`);
});

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
    with c as (insert into characters (owner, name, created_at, debuted_at) values
      ('${ids['e2e-heel']}', 'Pipewrench', '${at(-1)}', '${at(-1)}'), ('${ids['e2e-face']}', 'Sunbeam', '${at(-1)}', '${at(-1)}'), ('${ids['e2e-lurk']}', 'Shadow', '${at(-1)}', '${at(-1)}')
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
  assert.equal(lurk, 0, 'the Lurker reacted early, but one other player is no crowd: no call is paid yet');
  assert.equal(Number(sql(`select amount from standings where character = '${characters.Pipewrench}'`)), 20);
  assert.equal(sql(`select string_agg(reason, ',' order by reason) from ledger where character = '${characters.Pipewrench}'`), 'heel.drewHeat');

  const again = await runSettlement(db, instance, until);
  assert.equal(again.status, 'nothing to settle');
  assert.equal(Number(sql(`select balance from wallets where account = '${ids['e2e-heel']}'`)), 20, 'a second run changes nothing');

  // The next day two more players bring the post its crowd of three others: the Lurker's call is
  // paid in that window, by where the post leans then without the Lurker's own vote.
  const crowd = JSON.parse(sql(`
    with u as (insert into auth.users (email) values ('e2e-crowd-1@test.invalid'), ('e2e-crowd-2@test.invalid') returning id, email),
    a as (insert into accounts (id) select id from u returning id),
    c as (insert into characters (owner, name, created_at, debuted_at) select id, 'Crowd ' || split_part(email, '@', 1), '${at(-1)}', '${at(-1)}' from u returning id, owner),
    h as (insert into class_history (character, class_key, started_at) select id, 'face', '${at(-1)}' from c returning 1)
    select json_agg(json_build_object('account', owner, 'character', id)) from c`)) as { account: string; character: string }[];
  sql(`insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values
    ${crowd.map((c, i) => `('${post}', '${c.character}', '${c.account}', 'tomato', 1, '${at(26 + i)}')`).join(',\n    ')}`);
  const second = await runSettlement(db, instance, at(48));
  assert.equal(second.status, 'applied', JSON.stringify(second));
  assert.equal(Number(sql(`select balance from wallets where account = '${ids['e2e-lurk']}'`)), 10, 'the third other player arrived: the call is paid');
  assert.equal(sql(`select string_agg(reason, ',') from ledger where character = '${characters.Shadow}'`), 'lurker.calledIt');
  assert.equal(Number(sql(`select balance from wallets where account = '${ids['e2e-heel']}'`)), 40, 'and the Heel two more votes of heat');
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
    with c as (insert into characters (owner, name, created_at, debuted_at) values
      ('${ids['e2e-spin-a']}', 'Spinner', '${at(-1)}', '${at(-1)}'), ('${ids['e2e-spin-b']}', 'Replier', '${at(-1)}', '${at(-1)}') returning id, name),
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

test('a player reacting on two days is paid one vote in all, through the real migrations', async () => {
  const db = psqlDb();
  const start = sql(`select to_jsonb(coalesce(max(ends_at), now()))#>>'{}' from settlements`);
  const at = (hours: number) => new Date(Date.parse(start) + hours * 3_600_000).toISOString();
  const ids = JSON.parse(sql(`
    with u as (insert into auth.users (email) values ('e2e-twice-heel@test.invalid'), ('e2e-twice-fan@test.invalid') returning id, email),
    a as (insert into accounts (id) select id from u returning id)
    select json_object_agg(split_part(email, '@', 1), id) from u`));
  const characters = JSON.parse(sql(`
    with c as (insert into characters (owner, name, created_at, debuted_at) values
      ('${ids['e2e-twice-heel']}', 'Twice Heel', '${at(-1)}', '${at(-1)}'), ('${ids['e2e-twice-fan']}', 'Twice Fan', '${at(-1)}', '${at(-1)}') returning id, name),
    h as (insert into class_history (character, class_key, started_at)
      select id, case name when 'Twice Heel' then 'heel' else 'face' end, '${at(-1)}' from c returning 1)
    select json_object_agg(name, id) from c`));
  const post = sql(`
    with t as (insert into threads (board, title) select id, 'Twice' from boards where slug = 'general' returning id)
    insert into acts (character, kind, thread, payload, created_at)
    select '${characters['Twice Heel']}', 'post', t.id, '{"body": "Hot take."}', '${at(1)}' from t returning id`);
  sql(`insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values
    ('${post}', '${characters['Twice Fan']}', '${ids['e2e-twice-fan']}', 'tomato', 1, '${at(2)}')`);
  assert.equal((await runSettlement(db, instance, at(24))).status, 'applied');
  sql(`insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values
    ('${post}', '${characters['Twice Fan']}', '${ids['e2e-twice-fan']}', 'angry', 2, '${at(26)}')`);
  assert.equal((await runSettlement(db, instance, at(48))).status, 'applied');
  assert.equal(Number(sql(`select sum(amount) from ledger where character = '${characters['Twice Heel']}' and reason = 'heel.drewHeat'`)), 10, 'one vote of heat over two days, not one and a half');
});

test('two missed days settle as two windows through the real migrations, the halving over each day alone', async () => {
  const db = psqlDb();
  const start = sql(`select to_jsonb(coalesce(max(ends_at), now()))#>>'{}' from settlements`);
  const at = (hours: number) => new Date(Date.parse(start) + hours * 3_600_000).toISOString();
  const ids = JSON.parse(sql(`
    with u as (insert into auth.users (email) values ('e2e-missed-heel@test.invalid'), ('e2e-missed-fan@test.invalid') returning id, email),
    a as (insert into accounts (id) select id from u returning id)
    select json_object_agg(split_part(email, '@', 1), id) from u`));
  const characters = JSON.parse(sql(`
    with c as (insert into characters (owner, name, created_at, debuted_at) values
      ('${ids['e2e-missed-heel']}', 'Missed Heel', '${at(-1)}', '${at(-1)}'), ('${ids['e2e-missed-fan']}', 'Missed Fan', '${at(-1)}', '${at(-1)}') returning id, name),
    h as (insert into class_history (character, class_key, started_at)
      select id, case name when 'Missed Heel' then 'heel' else 'face' end, '${at(-1)}' from c returning 1)
    select json_object_agg(name, id) from c`));
  // One post each day, and the Fan's heat on each: on one window, the second would be halved.
  for (const [hour, body] of [[1, 'Day one.'], [25, 'Day two.']] as const) {
    const post = sql(`
      with t as (insert into threads (board, title) select id, 'Missed ${hour}' from boards where slug = 'general' returning id)
      insert into acts (character, kind, thread, payload, created_at)
      select '${characters['Missed Heel']}', 'post', t.id, '{"body": "${body}"}', '${at(hour)}' from t returning id`);
    sql(`insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values
      ('${post}', '${characters['Missed Fan']}', '${ids['e2e-missed-fan']}', 'tomato', 1, '${at(hour + 1)}')`);
  }
  const out = await runSettlement(db, instance, at(48));
  assert.equal(out.status === 'applied' && out.windows.length, 2);
  assert.equal(Number(sql(`select sum(amount) from ledger where character = '${characters['Missed Heel']}' and reason = 'heel.drewHeat'`)), 20, 'a whole vote each day, never halved across the two');
});

test('the settlement of a season\'s last window posts its tally and its reveal, and sends both live', async () => {
  const db = psqlDb();
  const start = sql(`select to_jsonb(max(ends_at))#>>'{}' from settlements`);
  const at = (hours: number) => new Date(Date.parse(start) + hours * 3_600_000).toISOString();
  const ids = JSON.parse(sql(`
    with u as (insert into auth.users (email) values ('e2e-tally@test.invalid') returning id),
    a as (insert into accounts (id) select id from u returning id)
    select json_build_object('account', (select id from u))`));
  // A character made in the window, which debuts at its end; the season's length runs out there.
  const made = sql(`insert into characters (owner, name, created_at) values ('${ids.account}', 'Debutante', '${at(2)}') returning id`);
  sql(`insert into class_history (character, class_key, started_at) values ('${made}', 'face', '${at(2)}')`);
  sql(`update settings set value = jsonb_build_object('unit', 'day', 'count', (select extract(day from ('${at(24)}'::timestamptz - starts_at))::integer from seasons where ends_at is null)) where key = 'seasonLength'`);
  const sent: { topic: string; event: string; payload: { kind?: string; id?: string } }[] = [];
  const out = await runSettlement(db, instance, at(24), { send: async (m) => { sent.push(...(m as typeof sent)); return true; } });
  assert.equal(out.status, 'applied', JSON.stringify(out));
  const tally = sql(`select id from acts where kind = 'tally' and payload -> 'debuts' @> '[{"name": "Debutante"}]'`);
  assert.ok(tally, 'the tally names the debut');
  assert.ok(sent.some((m) => m.event === 'act' && m.payload.id === tally), 'the tally is sent live');
  const reveals = sql(`select string_agg(id::text, ',' order by id) from acts where kind = 'reveal' and created_at = '${at(24)}'`).split(',');
  assert.ok(reveals.length > 1, 'the season is revealed');
  // An earlier test's runs sent nothing, so what they posted went out with this run too.
  const sentIds = new Set(sent.filter((m) => m.event === 'act').map((m) => m.payload.id));
  assert.deepEqual(reveals.filter((id) => !sentIds.has(id)), [], 'every Act of the reveal is sent live');
  assert.ok(sent.some((m) => m.event === 'thread'), 'and its thread, for its board');
  assert.equal(sql(`select count(*) from broadcasts_due`), '0', 'nothing is left waiting');
  sql(`update settings set value = '{"unit": "month", "count": 3}' where key = 'seasonLength'`);
});
