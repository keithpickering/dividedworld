/**
 * End to end: the settlement job's own core (supabase/functions/settle/core.ts) and the seed
 * (supabase/functions/_shared/seed.ts), against the real migrations on the scratch database,
 * with Divided World seeded as the composition root seeds it. What only this proves: that
 * settlement_input()'s rows are the SettlementInput the engine reads, and that what the
 * engine returns is what apply_settlement() takes. Run by tools/test-sql.mjs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { psqlDb, sql, scratchSeed } from './psql-db.ts';
import { runSettlement } from '../../functions/settle/core.ts';
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
  await db.rpc('seed_instance', { payload: scratchSeed(instance) });

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
    ('${post}', '${characters.Shadow}', '${ids['e2e-lurk']}', 'vomiting', 1, '${at(3)}')`);

  const until = at(24);
  const first = await runSettlement(db, instance, until);
  assert.equal(first.status, 'applied', JSON.stringify(first));

  const heel = Number(sql(`select balance from wallets where account = '${ids['e2e-heel']}'`));
  const lurk = Number(sql(`select balance from wallets where account = '${ids['e2e-lurk']}'`));
  assert.equal(heel, 20, 'two whole votes of heat on the Heel\'s post');
  assert.equal(lurk, 0, 'the Lurker reacted early, but one other player is no crowd: no call is paid yet');
  // In the season the window settled into: a debut also wrote a row at 0 in the season the standings read (0030's roster).
  assert.equal(Number(sql(`select amount from standings where character = '${characters.Pipewrench}' and season = (select season from settlements order by ends_at desc limit 1)`)), 20);
  assert.equal(sql(`select string_agg(reason, ',' order by reason) from ledger where character = '${characters.Pipewrench}'`), 'heel.drewHeat');
  // The heat is shared on the post it was drawn by, and the Heel reads the share through their own view.
  const shares = JSON.parse(sql(`begin; do $$ begin perform tests.become('${ids['e2e-heel']}'); end $$;
    select coalesce(jsonb_agg(jsonb_build_object('character', character, 'reason', reason, 'act', act, 'quadrant', quadrant, 'amount', amount)), '[]') from my_ledger_shares; rollback;`));
  assert.deepEqual(shares, [{ character: characters.Pipewrench, reason: 'heel.drewHeat', act: post, quadrant: 'excitedNegative', amount: 20 }], 'the heat, on the post');
  // Every ledger line the settlement wrote with shares is what its shares add up to.
  assert.equal(sql(`select count(*) from ledger l join (select ledger, sum(amount) as total from ledger_shares group by ledger) s on s.ledger = l.id where s.total <> l.amount`), '0', 'each line\'s shares add up to it');

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
  // The System's own Act, as an earlier season's end wrote it, then a spin from it and a reply in the spun thread.
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
    ('${post}', '${characters['Twice Fan']}', '${ids['e2e-twice-fan']}', 'vomiting', 2, '${at(26)}')`);
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

test('the settlement of a season\'s last window announces its debuts and ends in results, and sends both live', async () => {
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
  const out = await runSettlement(db, instance, at(24), { deliver: async (m) => { sent.push(...(m as typeof sent)); return 'sent' as const; } });
  assert.equal(out.status, 'applied', JSON.stringify(out));
  const tally = sql(`select id from acts where kind = 'announce' and character = '${made}' and payload = '{"what": "debut"}'`);
  assert.ok(tally, 'the debut is announced as the character\'s own Act');
  assert.ok(sent.some((m) => m.event === 'act' && m.payload.id === tally), 'the announcement is sent live');
  // The season's end writes no Act and opens no thread: its results are rows, and the news of them is sent live.
  assert.equal(sql(`select count(*) from acts where kind = 'reveal' and created_at = '${at(24)}'`), '0', 'a season\'s end writes no reveal Act');
  assert.ok(Number(sql(`select count(*) from season_results r join seasons s on s.id = r.season where s.ends_at = '${at(24)}'`)) > 0, 'the season\'s results are written');
  assert.ok(sent.some((m) => m.event === 'news' && (m.payload as unknown as { sub?: string }).sub === 'results'), 'the results are sent live as news');
  assert.equal(sql(`select count(*) from broadcasts_due`), '0', 'nothing is left waiting');
  sql(`update settings set value = '{"unit": "month", "count": 3}' where key = 'seasonLength'`);
});

// A reversed play settles no further (bot-card-options plan, Task 3; design section 3, "Aura"). Two Heels each play a Salty card on a
// post and the same two fans vote on each card; one card is reversed by an admin (a card_end, written as reverse_card writes it,
// at an instant the test chooses), the other never is, so the control proves the setup pays at all.
async function reversedPlays(db: ReturnType<typeof psqlDb>) {
  await db.rpc('seed_instance', { payload: scratchSeed(instance) });
  const start = sql(`select to_jsonb(coalesce(max(ends_at), now()))#>>'{}' from settlements`);
  const at = (hours: number) => new Date(Date.parse(start) + hours * 3_600_000).toISOString();
  const tag = Math.random().toString(36).slice(2, 8);
  const ids = JSON.parse(sql(`
    with u as (insert into auth.users (email) values ('e2e-rv-${tag}-gone@test.invalid'), ('e2e-rv-${tag}-kept@test.invalid'), ('e2e-rv-${tag}-fan1@test.invalid'), ('e2e-rv-${tag}-fan2@test.invalid'), ('e2e-rv-${tag}-author@test.invalid') returning id, email),
    a as (insert into accounts (id) select id from u returning id)
    select json_object_agg(split_part(email, '@', 1), id) from u`)) as Record<string, string>;
  const who = (k: string) => ids[`e2e-rv-${tag}-${k}`];
  const characters = JSON.parse(sql(`
    with c as (insert into characters (owner, name, created_at, debuted_at) values
      ('${who('gone')}', 'Gone ${tag}', '${at(-1)}', '${at(-1)}'), ('${who('kept')}', 'Kept ${tag}', '${at(-1)}', '${at(-1)}'),
      ('${who('fan1')}', 'Fan1 ${tag}', '${at(-1)}', '${at(-1)}'), ('${who('fan2')}', 'Fan2 ${tag}', '${at(-1)}', '${at(-1)}'),
      ('${who('author')}', 'Author ${tag}', '${at(-1)}', '${at(-1)}') returning id, name),
    h as (insert into class_history (character, class_key, started_at)
      select id, case when name like 'Gone%' or name like 'Kept%' then 'heel' else 'face' end, '${at(-1)}' from c returning 1)
    select json_object_agg(split_part(name, ' ', 1), id) from c`)) as Record<string, string>;
  const play = (name: 'Gone' | 'Kept') => {
    const post = sql(`
      with t as (insert into threads (board, title) select id, 'Salty ${name} ${tag}' from boards where slug = 'general' returning id)
      insert into acts (character, kind, thread, payload, created_at)
      select '${characters.Author}', 'post', t.id, '{"body": "A take."}', '${at(1)}' from t returning id`);
    const card = sql(`insert into acts (character, kind, thread, target_act_id, payload, created_at)
      select '${characters[name]}', 'card', thread, id, '{"card": "whoops", "config": {"color": "red"}}', '${at(2)}' from acts where id = '${post}' returning id`);
    for (const [i, fan] of (['Fan1', 'Fan2'] as const).entries()) {
      sql(`insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values
        ('${card}', '${characters[fan]}', '${who(fan.toLowerCase())}', 'tomato', ${i + 1}, '${at(3 + i)}')`);
    }
    return { post, card };
  };
  // What reverse_card writes, at a chosen instant (it writes at now()).
  const reverse = (card: string, when: string) => sql(`select set_config('kayfabb.card_end_writer', 'on', false);
    insert into acts (character, kind, thread, target_act_id, payload, created_at)
    select null, 'card_end', thread, id, '{"why": "reversed", "by": "admin"}', '${when}' from acts where id = '${card}'; select set_config('kayfabb.card_end_writer', '', false)`);
  const aura = (name: string) => Number(sql(`select coalesce(sum(amount), 0) from ledger where character = '${characters[name]}'`));
  return { at, ids, who, characters, play, reverse, aura, tag };
}

test('a card an admin reversed before the window\'s end moves no Aura, and the card beside it still does', async () => {
  const db = psqlDb();
  const t = await reversedPlays(db);
  const gone = t.play('Gone');
  t.play('Kept');
  t.reverse(gone.card, t.at(10));
  const out = await runSettlement(db, instance, t.at(24));
  assert.equal(out.status, 'applied', JSON.stringify(out));
  assert.ok(t.aura('Kept') > 0, 'the control: an unreversed Salty card and its two votes pay its Heel');
  assert.equal(t.aura('Gone'), 0, 'a reversed card and the votes on it move no Aura');
  assert.equal(sql(`select count(*) from ledger_shares where act = '${gone.card}'`), '0', 'and no share of a ledger line names the reversed play');
});

test('a card reversed exactly at the window\'s end was in force for the whole window, as a vote written then is not in it', async () => {
  const db = psqlDb();
  const t = await reversedPlays(db);
  const edge = t.play('Gone');
  t.play('Kept');
  t.reverse(edge.card, t.at(24));
  assert.equal((await runSettlement(db, instance, t.at(24))).status, 'applied');
  assert.equal(t.aura('Gone'), t.aura('Kept'), 'an end at window_end is after the window, so it settles as the control does');
  assert.ok(t.aura('Gone') > 0);
});

test('a card reversed after its window settled keeps that window\'s Aura, and moves none in the next', async () => {
  const db = psqlDb();
  const t = await reversedPlays(db);
  const gone = t.play('Gone');
  assert.equal((await runSettlement(db, instance, t.at(24))).status, 'applied');
  const settled = t.aura('Gone');
  assert.ok(settled > 0, 'the play paid its Heel in the window it was in force');
  // Reversed in the next window, with a further vote on it after.
  t.reverse(gone.card, t.at(25));
  sql(`insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values
    ('${gone.card}', '${t.characters.Author}', '${t.who('author')}', 'tomato', 1, '${t.at(26)}')`);
  assert.equal((await runSettlement(db, instance, t.at(48))).status, 'applied');
  assert.equal(t.aura('Gone'), settled, 'the first window\'s Aura stays and the next moves none');
});

test('a window in which an Earn Gimmick boosts a card\'s Heel is applied, and the next window settles (#452)', async () => {
  const db = psqlDb();
  const t = await reversedPlays(db);
  const gone = t.play('Gone');
  // A Heat Magnet on the Heel, in force across the window: its boost is a card.boost entry that names the card.
  const magnet = sql(`insert into acts (character, kind, thread, target_act_id, payload, created_at)
    select '${t.characters.Gone}', 'card', thread, id, jsonb_build_object('card', 'heat-magnet', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', '${t.characters.Gone}', 'targetName', 'Gone', 'ends', '${t.at(60)}'::timestamptz), '${t.at(1.5)}'
    from acts where id = '${gone.post}' returning id`);
  assert.ok(magnet, 'the Gimmick is played');
  const first = await runSettlement(db, instance, t.at(24));
  assert.equal(first.status, 'applied', JSON.stringify(first));
  assert.equal(sql(`select count(*) from ledger where character = '${t.characters.Gone}' and reason = 'card.boost' and params ->> 'card' = 'heat-magnet'`), '1', 'the boost is its own entry, naming its card');
  assert.ok(Number(sql(`select count(*) from ledger_shares s join ledger l on l.id = s.ledger where l.reason = 'card.boost' and l.character = '${t.characters.Gone}'`)) > 0, 'and has its shares');
  sql(`insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values
    ('${gone.card}', '${t.characters.Author}', '${t.who('author')}', 'tomato', 1, '${t.at(26)}')`);
  assert.equal((await runSettlement(db, instance, t.at(48))).status, 'applied', 'the next window settles');
});

// The card payouts (plan Task 5): a Mooch, a Toll, a 4D Chess spring and an Off Day settle through runSettlement, minted into the paid player's own ledger and never taken from anyone, and a
// control run without the plays is the same for everyone they do not pay.
async function payoutWorld(db: ReturnType<typeof psqlDb>, label: string, plays: boolean) {
  await db.rpc('seed_instance', { payload: scratchSeed(instance) });
  const start = sql(`select to_jsonb(coalesce(max(ends_at), now()))#>>'{}' from settlements`);
  const at = (hours: number) => new Date(Date.parse(start) + hours * 3_600_000).toISOString();
  const who = ['poster', 'mooch', 'author', 'setter', 'caster', 'target', 'offcaster', 'f1', 'f2', 'f3'] as const;
  const classes: Record<string, string> = { poster: 'heel', caster: 'heel', offcaster: 'heel' };
  const ids = JSON.parse(sql(`
    with u as (insert into auth.users (email) values ${who.map((w) => `('e2e-${label}-${w}@test.invalid')`).join(', ')} returning id, email),
    a as (insert into accounts (id) select id from u returning id)
    select json_object_agg(split_part(split_part(email, '@', 1), '-', 3), id) from u`)) as Record<(typeof who)[number], string>;
  const c = JSON.parse(sql(`
    with c as (insert into characters (owner, name, created_at, debuted_at) values
      ${who.map((w) => `('${ids[w]}', '${label} ${w}', '${at(-1)}', '${at(-1)}')`).join(', ')} returning id, name),
    h as (insert into class_history (character, class_key, started_at)
      select id, case ${who.map((w) => `when name = '${label} ${w}' then '${classes[w] ?? 'face'}'`).join(' ')} end, '${at(-1)}' from c returning 1)
    select json_object_agg(substr(name, length('${label} ') + 1), id) from c`)) as Record<(typeof who)[number], string>;
  const thread = sql(`insert into threads (board, title) select id, '${label} payouts' from boards where slug = 'general' returning id`);
  const act = (character: string, hours: number, kind: string, payload: object, target?: string) =>
    sql(`insert into acts (character, kind, thread, target_act_id, payload, created_at)
      values ('${character}', '${kind}', '${thread}', ${target ? `'${target}'` : 'null'}, '${JSON.stringify(payload).replaceAll("'", "''")}', '${at(hours)}') returning id`);
  let slot = 0;
  const vote = (target: string, w: 'f1' | 'f2' | 'f3', kind: string, hours: number) => {
    slot += 1;
    sql(`insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values ('${target}', '${c[w]}', '${ids[w]}', '${kind}', ${slot}, '${at(hours)}')`);
  };
  const week = (from: number) => at(from + 168);

  // The window before: an Off Day names the class heel for the Face "target", played by the Heel "offcaster" (it names the window after the next settlement).
  if (plays) {
    const anchor = act(c.offcaster, 1, 'post', { body: 'Naming a class.' });
    act(c.offcaster, 2, 'card', { card: 'off-day', message: '', config: { class: 'heel' }, reach: 'character', character: c.target, targetName: 'target', starts: at(24), ends: at(48) }, anchor);
  }
  assert.equal((await runSettlement(db, instance, at(24))).status, 'applied', 'the window before settles');

  // The window itself.
  const pp = act(c.poster, 25, 'post', { body: 'Mooch me.' });
  const pt = act(c.author, 25, 'post', { body: 'Toll me.' });
  const pc = act(c.setter, 25, 'post', { body: 'Back me.' });
  const px = act(c.target, 25, 'post', { body: 'Name me.' });
  const castT = act(c.caster, 25.6, 'card', { card: 'whoops', config: { color: 'red' } }, pt);
  const castC = act(c.caster, 25.7, 'card', { card: 'whoops', config: { color: 'red' } }, pc);
  if (plays) {
    act(c.mooch, 25.5, 'card', { card: 'mooch', message: '', config: { quadrant: 'excitedNegative' }, layer: 1, ends: week(25.5) }, pp);
    act(c.author, 25.2, 'card', { card: 'toll', message: '', config: {}, layer: 1, ends: week(25.2) }, pt);
    const set = act(c.setter, 25.1, 'set', {}, pc);
    act(c.setter, 25.7, 'spring', { card: '4d-chess', trigger: 'cast', did: 'rode', set, by: castC, quadrant: 'excitedNegative' }, pc);
  }
  for (const [i, w] of (['f1', 'f2'] as const).entries()) {
    vote(pp, w, 'tomato', 26 + i); vote(castT, w, 'tomato', 28 + i); vote(castC, w, 'tomato', 30 + i); vote(px, w, 'tomato', 32 + i);
  }
  const cap = Number(sql(`select setting('walletCap')`));
  if (plays) sql(`insert into wallets (account, balance) values ('${ids.mooch}', ${cap}) on conflict (account) do update set balance = ${cap}`);
  const second = await runSettlement(db, instance, at(48));
  assert.equal(second.status, 'applied', JSON.stringify(second));
  const w1 = sql(`select id from settlements order by ends_at desc limit 1`);
  const rows = (w: string, reasonLike = '%') => sql(`select coalesce(string_agg(reason || ':' || coalesce(params ->> 'card', '') || ':' || amount, ',' order by reason, params ->> 'card'), '') from ledger where character = '${c[w as keyof typeof c]}' and reason like '${reasonLike}'`);
  const sum = (w: string, reason: string) => Number(sql(`select coalesce(sum(amount), 0) from ledger where character = '${c[w as keyof typeof c]}' and reason = '${reason}'`));
  const wallet = (w: (typeof who)[number]) => Number(sql(`select coalesce((select balance from wallets where account = '${ids[w]}'), 0)`));
  const ledgerTotal = (w: (typeof who)[number]) => Number(sql(`select coalesce(sum(amount), 0) from ledger where account = '${ids[w]}'`));
  const settled = { window1: w1, rows, sum, wallet, ledgerTotal, ids, c, cap, act, vote, at, castC, castT, pp };
  return settled;
}

test('Mooch, Toll, 4D Chess and Off Day settle: minted into the paid player\'s ledger, nothing taken, and a control without them agrees for everyone else', async () => {
  const db = psqlDb();
  const tag = Math.random().toString(36).slice(2, 7);
  // Where no earlier file has settled a window, one is settled first, so that both worlds start where the history ends (not at now).
  await db.rpc('seed_instance', { payload: scratchSeed(instance) });
  if (sql(`select count(*) from settlements`) === '0') {
    const first = await runSettlement(db, instance, sql(`select to_jsonb(min(starts_at) + interval '1 day')#>>'{}' from seasons`));
    assert.equal(first.status, 'applied', JSON.stringify(first));
  }
  const control = await payoutWorld(db, `ctl${tag}`, false);
  const played = await payoutWorld(db, `pay${tag}`, true);

  // What each card paid, in the paid player's own ledger, naming its card.
  assert.equal(played.sum('mooch', 'card.skim'), 2, 'a Mooch: 0.1 of a vote for each of two votes in its quadrant');
  assert.equal(played.rows('mooch', 'card.skim'), 'card.skim:mooch:2');
  assert.equal(played.sum('author', 'card.ride'), 10, 'a Toll: half a vote for each of two votes on a cast made while it was up');
  assert.equal(played.rows('author', 'card.ride'), 'card.ride:toll:10');
  assert.equal(played.sum('setter', 'card.ride'), 20, '4D Chess: a whole vote for each of two votes in its quadrant on the cast that sprang it');
  assert.equal(played.rows('setter', 'card.ride'), 'card.ride:4d-chess:20');
  assert.equal(control.sum('mooch', 'card.skim') + control.sum('author', 'card.ride') + control.sum('setter', 'card.ride'), 0, 'the control pays none');

  // Nothing is taken: the poster's and the casters' entries, and the fans', equal the control's.
  for (const w of ['poster', 'caster', 'f1', 'f2'] as const) assert.equal(played.rows(w), control.rows(w), `${w}'s entries are the control's`);
  // Each paid account's wallet moved by its entries (the Mooch's wallet was at the cap: it takes none, and the standing takes all).
  assert.equal(played.wallet('author'), played.ledgerTotal('author'), 'the Toll\'s player\'s wallet moved by the entries');
  assert.equal(played.wallet('setter'), played.ledgerTotal('setter'), 'the 4D Chess setter\'s wallet moved by the entries');
  assert.equal(played.wallet('mooch'), played.cap, 'a wallet at the cap takes none of it');
  assert.ok(played.ledgerTotal('mooch') >= 2, 'but the entries are written');
  assert.equal(Number(sql(`select coalesce(sum(amount), 0) from standings where character = '${played.c.mooch}'`)), played.ledgerTotal('mooch'), 'and the standing takes all of it');

  // The Off Day: the target was scored as the named class for the window (a Face earning as a Heel), recorded in scored_as, once.
  assert.ok(played.rows('target', 'heel.%').startsWith('heel.'), 'the Face named a Heel earns as one for the window');
  assert.equal(control.rows('target', 'heel.%'), '', 'the control Face earns no Heel reasons');
  assert.equal(sql(`select class_key || ':' || count(*) from scored_as where settlement = ${played.window1} and character = '${played.c.target}' group by class_key`), 'heel:1');
  assert.equal(sql(`select count(*) from scored_as where settlement = ${control.window1}`), '0');

  // The window after pays a late vote on the sprung cast, in the setter's ledger, with no end.
  const before = played.sum('setter', 'card.ride');
  played.vote(played.castC, 'f3', 'tomato', 50);
  const third = await runSettlement(db, instance, played.at(72));
  assert.equal(third.status, 'applied', JSON.stringify(third));
  assert.equal(played.sum('setter', 'card.ride') - before, 10, 'a late vote on the cast a 4D Chess rode pays a whole vote');
  assert.equal(sql(`select count(*) from scored_as where settlement = (select id from settlements order by ends_at desc limit 1)`), '0', 'a window with no named play writes no scored_as row');
});
