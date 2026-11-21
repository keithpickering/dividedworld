-- Crowd pay, kept, checked and paid (supabase/migrations/0384_crowd_pay.sql; docs/plans/2026-11-20-crowd-pay-plan.md, Task 4; design docs/plans/2026-11-20-crowd-pay-design.md, sections 1, 2 and 5).
-- apply_settlement takes `crowd`, a list of { player, acts }: the Acts each player is paid for, as engine/rules/settle.ts's crowdPay sends them. It refuses what the engine never sends, each in words of its own and writing nothing,
-- prices the move itself (the Acts counted times setting('crowdPayEach')) and writes one wallet move of kind `crowd` per player after the settlement's own, plus a private `crowd_paid` row for each Act. It writes no ledger row
-- and no standing: crowd pay is no character's. my_crowd_paid is the player's own rows, as my_ledger_shares is.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- What a refused call must leave as it found it.
create function pg_temp.kept() returns text language sql as $$
  select (select count(*) from settlements) || '/' || (select count(*) from crowd_paid) || '/' || (select count(*) from wallet_events) || '/' || (select count(*) from ledger) || '/' || (select count(*) from standings)
$$;

-- Apply the window w1 to w2 with this crowd, and nothing else: the refusal's words, or null.
create function pg_temp.apply(w1 timestamptz, w2 timestamptz, crowd jsonb) returns text language plpgsql as $$
begin
  return pg_temp.refusal(format($f$select apply_settlement(%L, %L, '[]', '{}', '[]', '[]', %L)$f$, w1, w2, crowd));
end $$;

do $$
declare
  ann uuid := tests.account('cp-ann'); bob uuid := tests.account('cp-bob'); cat uuid := tests.account('cp-cat'); dan uuid := tests.account('cp-dan'); eve uuid := tests.account('cp-eve');
  a uuid := tests.character(ann, 'Cp Ann'); b uuid := tests.character(bob, 'Cp Bob'); c uuid := tests.character(cat, 'Cp Cat'); d uuid := tests.character(dan, 'Cp Dan'); e uuid := tests.character(eve, 'Cp Eve');
  t uuid := tests.thread('Cp thread');
  w1 timestamptz := coalesce((select max(ends_at) from settlements), '2030-01-01T00:00:00Z');
  w2 timestamptz := w1 + interval '1 day';
  w3 timestamptz := w1 + interval '2 days';
  pb1 uuid; pb2 uuid; pb3 uuid; pb4 uuid; pb5 uuid; w4 timestamptz; old uuid; pa uuid; sysact uuid; staffpost uuid; gift uuid; play uuid; ended_play uuid; staff uuid;
  before_it text;
  why text;
  said jsonb;
  s1 bigint;
  n integer;
begin
  insert into card_kinds (key, name, alignment, rarity, play, lasts, reaches, gimmick) values
    ('cpcard', 'Cp Card', 'sweet', 'uncommon', 'use', interval '3 days', '{character}', '{"kind": "cushion", "share": 0.5}')
  on conflict (key) do nothing;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Cp Bot', 'cp-bot', 'persona', now()) returning id into staff;

  -- Bob's posts in the window, one from before it, and the Acts the poisons below react to.
  old := tests.post(b, t, 'Before the window.', w1 - interval '3 days');
  pb1 := tests.post(b, t, 'One.', w1 + interval '1 hour');
  pb2 := tests.post(b, t, 'Two.', w1 + interval '2 hours');
  pb3 := tests.post(b, t, 'Three.', w1 + interval '3 hours');
  pb4 := tests.post(b, t, 'Four.', w1 + interval '4 hours');
  pa := tests.post(a, t, 'Ann''s.', w1 + interval '5 hours');
  sysact := tests.act(null, 'tally', t, '{}', null, w1 + interval '6 hours');
  perform set_config('kayfabb.staff_writer', 'on', true);
  staffpost := tests.post(staff, t, 'The bot''s.', w1 + interval '7 hours');
  perform set_config('kayfabb.staff_writer', '', true);
  -- A gift is a donation Act on a drive's opening play, which donate writes; the well-formed trigger is set aside for this one row, since the drive is no part of what is tested.
  alter table acts disable trigger acts_well_formed;
  gift := tests.act(b, 'donation', t, '{"amount": 10, "overhead": 1, "arrives": 9}', pb1, w1 + interval '8 hours');
  alter table acts enable trigger acts_well_formed;
  play := tests.act(b, 'card', t, jsonb_build_object('card', 'cpcard', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', b, 'ends', w1 + interval '4 days', 'targetName', 'Cp Bob'), pb1, w1 + interval '9 hours');
  ended_play := tests.act(b, 'card', t, jsonb_build_object('card', 'cpcard', 'message', '', 'config', '{}'::jsonb, 'reach', 'character', 'character', b, 'ends', w1 + interval '4 days', 'targetName', 'Cp Bob'), pb1, w1 + interval '10 hours');
  perform set_config('kayfabb.card_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values (null, 'card_end', t, ended_play, '{"why": "reversed", "by": "admin"}', w1 + interval '11 hours');
  perform set_config('kayfabb.card_end_writer', '', true);

  -- Cat: a reaction to pb1 and pb2 inside the window (each first), and to the ended play. Dan: pb1 and pb2 (and pb2 twice, with another kind: still one Act). Eve: `old` first, a day before the window, and again inside it; and pb3.
  insert into reactions (act, reactor_account, reactor_character, kind, slot, created_at) values
    (pb1, cat, c, 'up', 1, w1 + interval '12 hours'),
    (pb2, cat, c, 'up', 1, w1 + interval '13 hours'),
    (ended_play, cat, c, 'up', 1, w1 + interval '14 hours'),
    (pb1, dan, d, 'up', 1, w1 + interval '15 hours'),
    (pb2, dan, d, 'up', 1, w1 + interval '16 hours'),
    (pb2, dan, d, 'boo', 2, w1 + interval '17 hours'),
    (old, eve, e, 'up', 1, w1 - interval '1 day'),
    (old, eve, e, 'boo', 2, w1 + interval '18 hours'),
    (pb3, eve, e, 'up', 1, w1 + interval '19 hours');
  -- Ann reacts to her own post, to the tally, to the bot's post and to the gift (raw rows: the game would not take them), and Cat to the tally, the bot's post, the gift and a post Dan alone reacted to.
  insert into reactions (act, reactor_account, reactor_character, kind, slot, created_at) values
    (pa, ann, a, 'up', 1, w1 + interval '20 hours'),
    (sysact, cat, c, 'up', 1, w1 + interval '20 hours'),
    (staffpost, cat, c, 'up', 1, w1 + interval '20 hours'),
    (gift, cat, c, 'up', 1, w1 + interval '20 hours'),
    (play, cat, c, 'up', 1, w1 + interval '21 hours');
  -- A wallet one short of the cap, and a settled history to start from.
  insert into wallets (account, balance) values (dan, 598);

  before_it := pg_temp.kept();

  -- ---- What the engine never sends is refused, each in its own words, and nothing is written ----
  why := pg_temp.apply(w1, w2, jsonb_build_array(jsonb_build_object('player', cat, 'acts', jsonb_build_array(pb4))));
  if why is null or why not like '22023 %did not react to%inside the window%' then raise exception 'an Act the player never reacted to: %', why; end if;
  why := pg_temp.apply(w1, w2, jsonb_build_array(jsonb_build_object('player', eve, 'acts', jsonb_build_array(old))));
  if why is null or why not like '22023 %first reacted to%before the window%' then raise exception 'an Act first reacted to before the window: %', why; end if;
  why := pg_temp.apply(w1, w2, jsonb_build_array(jsonb_build_object('player', ann, 'acts', jsonb_build_array(pa))));
  if why is null or why not like '22023 %one of the player''s own characters%' then raise exception 'the player''s own character''s Act: %', why; end if;
  why := pg_temp.apply(w1, w2, jsonb_build_array(jsonb_build_object('player', cat, 'acts', jsonb_build_array(staffpost))));
  if why is null or why not like '22023 %a staff character''s%' then raise exception 'a staff Act: %', why; end if;
  why := pg_temp.apply(w1, w2, jsonb_build_array(jsonb_build_object('player', cat, 'acts', jsonb_build_array(sysact))));
  if why is null or why not like '22023 %no character''s%' then raise exception 'a System Act: %', why; end if;
  why := pg_temp.apply(w1, w2, jsonb_build_array(jsonb_build_object('player', cat, 'acts', jsonb_build_array(gift))));
  if why is null or why not like '22023 %a gift%' then raise exception 'a gift: %', why; end if;
  why := pg_temp.apply(w1, w2, jsonb_build_array(jsonb_build_object('player', cat, 'acts', jsonb_build_array(ended_play))));
  if why is null or why not like '22023 %ended by an admin%' then raise exception 'a play an admin ended: %', why; end if;
  why := pg_temp.apply(w1, w2, jsonb_build_array(jsonb_build_object('player', cat, 'acts', jsonb_build_array(pb1, pb1))));
  if why is null or why not like '22023 %listed twice%' then raise exception 'an Act listed twice: %', why; end if;
  why := pg_temp.apply(w1, w2, jsonb_build_array(jsonb_build_object('player', cat, 'acts', jsonb_build_array(pb1)), jsonb_build_object('player', cat, 'acts', jsonb_build_array(pb2))));
  if why is null or why not like '22023 %two rows for one player%' then raise exception 'two rows for one player: %', why; end if;
  why := pg_temp.apply(w1, w2, jsonb_build_array(jsonb_build_object('player', cat, 'acts', jsonb_build_array(gen_random_uuid()))));
  if why is null or why not like '22023 %an Act that does not exist%' then raise exception 'an Act that does not exist: %', why; end if;

  -- An id is one id in either case: the same player twice, and the same Act twice, are refused though the text differs.
  why := pg_temp.apply(w1, w2, jsonb_build_array(jsonb_build_object('player', cat, 'acts', jsonb_build_array(pb1)), jsonb_build_object('player', upper(cat::text), 'acts', jsonb_build_array(pb2))));
  if why is null or why not like '22023 %two rows for one player%' then raise exception 'one player in two cases: %', why; end if;
  why := pg_temp.apply(w1, w2, jsonb_build_array(jsonb_build_object('player', cat, 'acts', jsonb_build_array(pb1, upper(pb1::text)))));
  if why is null or why not like '22023 %listed twice%' then raise exception 'one Act in two cases: %', why; end if;

  -- The shape of the call: a list of rows, each an object with a player who has an account and a list of uuids that is not empty.
  why := pg_temp.apply(w1, w2, '{"player": "x"}');
  if why is null or why not like '22023 %crowd pay is a list%' then raise exception 'crowd that is not a list: %', why; end if;
  why := pg_temp.apply(w1, w2, '["cat"]');
  if why is null or why not like '22023 %a crowd pay row is a player and a list of Act ids%' then raise exception 'a row that is not an object: %', why; end if;
  why := pg_temp.apply(w1, w2, jsonb_build_array(jsonb_build_object('player', cat, 'acts', pb1)));
  if why is null or why not like '22023 %a crowd pay row is a player and a list of Act ids%' then raise exception 'acts that are not a list: %', why; end if;
  why := pg_temp.apply(w1, w2, jsonb_build_array(jsonb_build_object('player', cat, 'acts', jsonb_build_array('not-a-uuid'))));
  if why is null or why not like '22023 %a crowd pay row is a player and a list of Act ids%' then raise exception 'an Act that is not an id: %', why; end if;
  why := pg_temp.apply(w1, w2, jsonb_build_array(jsonb_build_object('player', cat, 'acts', '[]'::jsonb)));
  if why is null or why not like '22023 %a crowd pay row is a player and a list of Act ids%' then raise exception 'a row with no Act: %', why; end if;
  why := pg_temp.apply(w1, w2, jsonb_build_array(jsonb_build_object('player', gen_random_uuid(), 'acts', jsonb_build_array(pb1))));
  if why is null or why not like '22023 %a player with no account%' then raise exception 'a player with no account: %', why; end if;
  why := pg_temp.apply(w1, w2, jsonb_build_array(jsonb_build_object('player', cat, 'acts', jsonb_build_array(pb1), 'amount', 999)));
  if why is null or why not like '22023 %a crowd pay row is a player and a list of Act ids%' then raise exception 'a row that carries an amount: %', why; end if;

  -- The cap, per player across every mask: one Act more than crowdPayMost is refused, the cap itself is not.
  update settings set value = '2' where key = 'crowdPayMost';
  insert into reactions (act, reactor_account, reactor_character, kind, slot, created_at) values (pb4, cat, c, 'up', 1, w1 + interval '22 hours');
  why := pg_temp.apply(w1, w2, jsonb_build_array(jsonb_build_object('player', cat, 'acts', jsonb_build_array(pb1, pb2, pb4))));
  if why is null or why not like '22023 %more Acts than the most%' then raise exception 'one Act more than the cap: %', why; end if;
  update settings set value = '10' where key = 'crowdPayMost';

  -- Switched off, any row is refused.
  update settings set value = '0' where key = 'crowdPayEach';
  why := pg_temp.apply(w1, w2, jsonb_build_array(jsonb_build_object('player', cat, 'acts', jsonb_build_array(pb1))));
  if why is null or why not like '22023 %crowd pay is switched off%' then raise exception 'a row with crowdPayEach at 0: %', why; end if;
  update settings set value = '2' where key = 'crowdPayEach';

  if pg_temp.kept() is distinct from before_it then raise exception 'a refused call wrote something: % then %', before_it, pg_temp.kept(); end if;

  -- ---- The good case: two Acts for Cat write two crowd_paid rows, one wallet move of kind crowd for 4, and no ledger or standing; Dan's wallet at 598 takes 2 and overflows 2 ----
  said := apply_settlement(w1, w2, '[]', '{}', '[]', '[]', jsonb_build_array(
    jsonb_build_object('player', dan, 'acts', jsonb_build_array(pb1, pb2)),
    jsonb_build_object('player', cat, 'acts', jsonb_build_array(pb1, pb2))));
  if not (said ->> 'applied')::boolean then raise exception 'a window with crowd pay should apply: %', said; end if;
  s1 := (said ->> 'settlement')::bigint;
  if (select count(*) from crowd_paid where settlement = s1) is distinct from 4::bigint
     or (select count(*) from crowd_paid where settlement = s1 and account = cat and act in (pb1, pb2)) is distinct from 2::bigint then
    raise exception 'two Acts each should be four crowd_paid rows, read %', (select jsonb_agg(to_jsonb(x)) from crowd_paid x);
  end if;
  -- The cap in force is kept with each row (`most`), the setting at payment: the log reads it, never today's.
  if exists (select 1 from crowd_paid where settlement = s1 and most is distinct from (setting('crowdPayMost'))::integer) or (select count(*) from crowd_paid where settlement = s1 and most = 10) is distinct from 4::bigint then
    raise exception 'each crowd_paid row keeps the crowdPayMost in force when it was paid (10): %', (select jsonb_agg(to_jsonb(x)) from crowd_paid x);
  end if;
  if (select count(*) from wallet_events where kind = 'crowd' and account = cat) is distinct from 1::bigint
     or (select change from wallet_events where kind = 'crowd' and account = cat) is distinct from 4
     or (select settlement from wallet_events where kind = 'crowd' and account = cat) is distinct from s1
     or (select ref from wallet_events where kind = 'crowd' and account = cat) is not null then
    raise exception 'Cat''s wallet should hold one crowd move of 4 against the settlement: %', (select jsonb_agg(to_jsonb(x)) from wallet_events x where account = cat);
  end if;
  if (select balance from wallets where account = cat) is distinct from 4 then raise exception 'Cat''s wallet should hold 4, holds %', (select balance from wallets where account = cat); end if;
  select count(*) into n from wallet_events where kind = 'crowd' and account = dan and change = 2 and overflow = 2 and balance_after = 600;
  if n <> 1 or (select balance from wallets where account = dan) is distinct from 600 then
    raise exception 'a wallet at 598 should take 2 and overflow 2: %', (select jsonb_agg(to_jsonb(x)) from wallet_events x where account = dan);
  end if;
  -- The moves come in player order, after the settlement's own (there are none here): the lower id first.
  if (select array_agg(account order by id) from wallet_events where settlement = s1) is distinct from (select array_agg(x order by x) from unnest(array[cat, dan]) x) then
    raise exception 'crowd moves are written in player order';
  end if;
  if exists (select 1 from ledger where settlement = s1) or exists (select 1 from ledger_shares sh join ledger l on l.id = sh.ledger where l.settlement = s1)
     or exists (select 1 from standings where character in (a, b, c, d, e) and amount <> 0) or exists (select 1 from settlement_class_totals where settlement = s1) then
    raise exception 'crowd pay is no ledger entry, no share, no standing and no class''s total';
  end if;

  -- The log's own: each player reads their own rows and no one else's; the table is no one's to read.
  perform tests.become(cat);
  if (select count(*) from my_crowd_paid) is distinct from 2::bigint or exists (select 1 from my_crowd_paid where settlement is distinct from s1 or act not in (pb1, pb2)) then
    raise exception 'Cat reads her two rows: %', (select jsonb_agg(to_jsonb(x)) from my_crowd_paid x);
  end if;
  if (select count(*) from information_schema.columns where table_name = 'my_crowd_paid') is distinct from 3::bigint
     or exists (select 1 from information_schema.columns where table_name = 'my_crowd_paid' and column_name = 'account') or exists (select 1 from my_crowd_paid where most is distinct from 10) then
    raise exception 'my_crowd_paid names the settlement, the Act and the cap in force, never the account'; end if;
  why := pg_temp.refusal('select count(*) from crowd_paid');
  if why is null or why not like '42501 %' then raise exception 'a player read crowd_paid itself: %', why; end if;
  perform tests.become(eve);
  if exists (select 1 from my_crowd_paid) then raise exception 'Eve reads rows that are not hers'; end if;
  perform tests.become_anon();
  why := pg_temp.refusal('select count(*) from my_crowd_paid');
  if why is null or why not like '42501 %' then raise exception 'a visitor read my_crowd_paid: %', why; end if;
  perform tests.unbecome();

  -- Append-only, as the ledger's rows are: no edit, no delete, no truncate.
  why := pg_temp.refusal('update crowd_paid set act = act');
  if why is null or why not like '% a ledger row is never edited or removed%' then raise exception 'crowd_paid was updated: %', why; end if;
  why := pg_temp.refusal('delete from crowd_paid');
  if why is null or why not like '% a ledger row is never edited or removed%' then raise exception 'crowd_paid was deleted from: %', why; end if;
  why := pg_temp.refusal('truncate crowd_paid');
  if why is null or why not like '% a ledger row is never edited or removed%' then raise exception 'crowd_paid was truncated: %', why; end if;

  -- ---- A retried window answers `already settled` before any of it, whatever it carries; an old call with no crowd on a new window pays none ----
  before_it := pg_temp.kept();
  said := apply_settlement(w1, w2, '[]', '{}', '[]', '[]', '[{"player": "nobody", "acts": []}]');
  if (said ->> 'applied')::boolean or said ->> 'reason' is distinct from 'already settled' then raise exception 'a retried window should answer already settled: %', said; end if;
  said := apply_settlement(w1, w2, '[]');
  if (said ->> 'applied')::boolean or said ->> 'reason' is distinct from 'already settled' then raise exception 'a retried window, called as before the change, should answer already settled: %', said; end if;
  if pg_temp.kept() is distinct from before_it then raise exception 'a retried window wrote something'; end if;
  said := apply_settlement(w2, w3, '[]', '{}', '[]', '[]');
  if not (said ->> 'applied')::boolean or exists (select 1 from crowd_paid where settlement = (said ->> 'settlement')::bigint)
     or exists (select 1 from wallet_events where settlement = (said ->> 'settlement')::bigint) then
    raise exception 'a window called as before the change pays no crowd pay: %', said;
  end if;
  -- An Act is paid to a player once, as a fact of the table, not of one settlement: the same (account, act) under another settlement is refused too.
  why := pg_temp.refusal(format('insert into crowd_paid (settlement, account, act, most) values (%L, %L, %L, 10)', (said ->> 'settlement')::bigint, cat, pb1));
  if why is null or why not like '23505 %crowd_paid_account%' then raise exception 'an Act paid to a player twice, under another settlement: %', why; end if;

  -- An Act already paid to the player in an earlier settlement is refused, though its first reaction reads inside this window (a state the settlement itself never writes, held against all the same).
  insert into crowd_paid (settlement, account, act, most) values (s1, eve, pb4, 10);
  insert into reactions (act, reactor_account, reactor_character, kind, slot, created_at) values (pb4, eve, e, 'up', 1, w3 + interval '1 hour');
  why := pg_temp.apply(w3, w3 + interval '1 day', jsonb_build_array(jsonb_build_object('player', eve, 'acts', jsonb_build_array(pb4))));
  if why is null or why not like '22023 %already paid%' then raise exception 'an Act already paid in an earlier settlement: %', why; end if;

  -- ---- Times are compared as settlement_input sends them, in whole milliseconds ----
  w4 := w3 + interval '1 day';
  pb5 := tests.post(b, t, 'Five.', w3 + interval '1 hour');
  before_it := pg_temp.kept();
  -- First reacted 0.7 ms before the window: it rounds to a millisecond before `from`, which the engine does not count.
  insert into reactions (act, reactor_account, reactor_character, kind, slot, created_at) values (pb5, cat, c, 'up', 1, w3 - interval '700 microseconds');
  why := pg_temp.apply(w3, w4, jsonb_build_array(jsonb_build_object('player', cat, 'acts', jsonb_build_array(pb5))));
  if why is null or why not like '22023 %first reacted to%before the window%' then raise exception 'a first reaction rounding to before the window: %', why; end if;
  delete from reactions where act = pb5 and reactor_account = cat;
  -- First reacted 0.3 ms before the window end: it rounds to `to`, which the engine does not count.
  insert into reactions (act, reactor_account, reactor_character, kind, slot, created_at) values (pb5, cat, c, 'up', 1, w4 - interval '300 microseconds');
  why := pg_temp.apply(w3, w4, jsonb_build_array(jsonb_build_object('player', cat, 'acts', jsonb_build_array(pb5))));
  if why is null or why not like '22023 %did not react to%inside the window%' then raise exception 'a first reaction rounding to the window end: %', why; end if;
  delete from reactions where act = pb5 and reactor_account = cat;
  if pg_temp.kept() is distinct from before_it then raise exception 'a refused call wrote something'; end if;
  -- First reacted 0.3 ms before the window: it rounds to `from`, which the engine counts, so it is accepted and paid.
  insert into reactions (act, reactor_account, reactor_character, kind, slot, created_at) values (pb5, cat, c, 'up', 1, w3 - interval '300 microseconds');
  said := apply_settlement(w3, w4, '[]', '{}', '[]', '[]', jsonb_build_array(jsonb_build_object('player', cat, 'acts', jsonb_build_array(pb5))));
  if not (said ->> 'applied')::boolean or (select count(*) from crowd_paid where settlement = (said ->> 'settlement')::bigint and account = cat and act = pb5) is distinct from 1::bigint then
    raise exception 'a first reaction rounding to the window start should be paid: %', said;
  end if;

  -- ---- The kind is held, and the old signature is gone ----
  why := pg_temp.refusal($f$select wallet_move((select id from accounts limit 1), 1, 'bogus', null, null)$f$);
  if why is null or why not like '23514 %wallet_events_kind_check%' then raise exception 'a wallet kind that is none: %', why; end if;
  if (select count(*) from pg_proc where proname = 'apply_settlement') is distinct from 1::bigint
     or (select pronargs from pg_proc where proname = 'apply_settlement') is distinct from 8::smallint then
    raise exception 'apply_settlement should be one function of eight parameters: %', (select jsonb_agg(oid::regprocedure::text) from pg_proc where proname = 'apply_settlement');
  end if;
  if not has_function_privilege('service_role', (select oid from pg_proc where proname = 'apply_settlement'), 'execute')
     or has_function_privilege('anon', (select oid from pg_proc where proname = 'apply_settlement'), 'execute')
     or has_function_privilege('authenticated', (select oid from pg_proc where proname = 'apply_settlement'), 'execute') then
    raise exception 'apply_settlement is the service role''s alone';
  end if;
end $$;
