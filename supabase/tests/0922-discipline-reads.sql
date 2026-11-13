-- The discipline cards' reads for the log (supabase/migrations/0420_discipline_cards.sql, section 2; docs/plans/2026-11-11-card-notes-part-5-plan.md, Task 3).
--
-- 1. my_infractions gains card_relief (what the cards took off an infraction, 0 where none) and fall_play (the play that took a fall, null until section 3 writes one), as its last columns.
-- 2. my_bans gains lifted_at and lifted_card (when and by which card the first live lift ended the ban; both null where no card acted, and where an admin has ended the play).
-- 3. log_page carries the four, for the caller's own characters only: a second player's page holds none of the first's rows.
-- 4. An admin's end of the lifting play (reverse_card) takes the lift out again: lifted_at and lifted_card null, until the ban's own end; a second Unban shows the second play.
-- The cards are this file's own (t-relief-one, t-unban, t-unban-2), never an instance's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

insert into settings (key, value) values ('warnBar', '{"size": 10, "bands": {"minor": 2, "moderate": 4, "severe": 7}, "decay": {"unit": "day", "count": 14}, "banDays": [1, 3, 7]}') on conflict (key) do nothing;
insert into characters (name, staff, staff_kind, debuted_at) values ('Dr Mod', 'dr-mod', 'persona', now()) on conflict do nothing;
insert into card_kinds (key, name, alignment, rarity, play, reaches, discipline) values
  ('t-relief-one', 'Test Relief One', 'sweet', 'uncommon', 'cast', '{character}', '{"kind": "relief", "points": "lightestBand"}'),
  ('t-unban', 'Test Unban', 'sweet', 'legendary', 'cast', '{character}', '{"kind": "unban"}'),
  ('t-unban-2', 'Test Unban Two', 'sweet', 'legendary', 'cast', '{character}', '{"kind": "unban"}')
  on conflict (key) do nothing;

create function pg_temp.owner(c uuid) returns uuid language sql as $$ select owner from characters where id = c $$;
create function pg_temp.player(label text, cash integer default 500) returns uuid language plpgsql as $$
declare a uuid := tests.account('dr-' || label);
begin
  insert into wallets (account, balance) values (a, cash) on conflict (account) do update set balance = excluded.balance;
  return tests.character(a, 'Dr ' || label);
end $$;
create function pg_temp.say(by_character uuid, in_thread uuid, body text) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become(pg_temp.owner(by_character));
  made := post(in_thread, by_character, body);
  perform tests.unbecome();
  return (made ->> 'id')::uuid;
end $$;
create function pg_temp.hand(c uuid, card text, n integer default 1) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select pg_temp.owner(c), card, 'bought', 0 from generate_series(1, n)
$$;
create function pg_temp.post_of(c uuid) returns uuid language sql as $$ select id from acts where character = c and kind = 'post' order by created_at desc, id limit 1 $$;
create function pg_temp.heart(caster uuid, card text, target uuid) returns jsonb language sql as $$
  select play_card(pg_temp.owner(caster), card, caster, target, '{}', 0, '', 'character', pg_temp.post_of(target))
$$;

-- ---- 1. An infraction two hearts each took from; one nothing took from ----
do $$
declare
  t uuid := tests.thread('Dr reads');
  caster uuid := pg_temp.player('caster');
  c uuid := pg_temp.player('target');
  stranger uuid := pg_temp.player('stranger');
  p1 uuid := pg_temp.say(c, t, 'First post.');
  p2 uuid := pg_temp.say(c, t, 'Second post.');
  ia uuid; ib uuid; the_ban uuid; pl1 uuid; pl2 uuid; unbanned uuid; unbanned2 uuid; admin_acc uuid; row jsonb; page jsonb; hit jsonb;
begin
  perform pg_temp.hand(caster, 't-relief-one', 2);
  ia := (infract(c, 'moderate', p1, 'dr-mod') ->> 'infraction')::uuid;
  ib := (infract(c, 'minor', p2, 'dr-mod') ->> 'infraction')::uuid;
  pl1 := (pg_temp.heart(caster, 't-relief-one', c) ->> 'id')::uuid;
  pl2 := (pg_temp.heart(caster, 't-relief-one', c) ->> 'id')::uuid;
  if (select count(*) from warn_reliefs where infraction = ia) is distinct from 2::bigint then raise exception 'each heart took 2 from the moderate'; end if;

  perform tests.become(pg_temp.owner(c));
  select to_jsonb(i) into row from my_infractions i where i.infraction = ia;
  if row ->> 'card_relief' is distinct from '4' or row -> 'fall_play' is distinct from 'null'::jsonb then raise exception 'two hearts took 4 from the moderate, no fall: %', row; end if;
  select to_jsonb(i) into row from my_infractions i where i.infraction = ib;
  if row ->> 'card_relief' is distinct from '0' or row -> 'fall_play' is distinct from 'null'::jsonb then raise exception 'no card acted on the minor: %', row; end if;
  -- The same through log_page.
  page := log_page(null);
  select x into row from jsonb_array_elements(page -> 'sources' -> 'infractions') x where x ->> 'infraction' = ia::text;
  if row ->> 'card_relief' is distinct from '4' or not row ? 'fall_play' then raise exception 'log_page carries card_relief and fall_play: %', row; end if;
  select x into row from jsonb_array_elements(page -> 'sources' -> 'infractions') x where x ->> 'infraction' = ib::text;
  if row ->> 'card_relief' is distinct from '0' or row -> 'fall_play' is distinct from 'null'::jsonb then raise exception 'log_page: nothing took from the minor: %', row; end if;
  perform tests.unbecome();

  -- ---- 2. A ban lifted; a ban no card touched ----
  perform pg_temp.hand(caster, 't-unban', 1);
  perform infract(c, 'severe', p1, 'dr-mod');
  hit := infract(c, 'severe', p2, 'dr-mod');
  the_ban := (hit ->> 'ban')::uuid;
  if the_ban is null then raise exception 'the bar did not fill: %', hit; end if;
  perform tests.become(pg_temp.owner(c));
  select to_jsonb(b) into row from my_bans b where b.ban = the_ban;
  if row -> 'lifted_at' is distinct from 'null'::jsonb or row -> 'lifted_card' is distinct from 'null'::jsonb or not row ? 'lifted_at' or not row ? 'lifted_card' then raise exception 'no card has acted on the ban: %', row; end if;
  perform tests.unbecome();
  unbanned := (pg_temp.heart(caster, 't-unban', c) ->> 'id')::uuid;
  perform tests.become(pg_temp.owner(c));
  select to_jsonb(b) into row from my_bans b where b.ban = the_ban;
  if (row ->> 'lifted_at')::timestamptz is distinct from (select created_at from acts where id = unbanned) or row ->> 'lifted_card' is distinct from 't-unban' then raise exception 'the ban was lifted by the Unban: %', row; end if;
  if (row ->> 'until')::timestamptz is distinct from (select created_at from acts where id = unbanned) or row ->> 'own_until' is null then raise exception 'until is the lift, own_until stays: %', row; end if;
  page := log_page(null);
  select x into row from jsonb_array_elements(page -> 'sources' -> 'bans') x where x ->> 'ban' = the_ban::text;
  if (row ->> 'lifted_at')::timestamptz is distinct from (select created_at from acts where id = unbanned) or row ->> 'lifted_card' is distinct from 't-unban' then raise exception 'log_page carries the lift: %', row; end if;
  perform tests.unbecome();

  -- ---- 2b. An admin's end of the lifting play: the ban is not lifted again (both lift columns null, until is the ban's own end); a second Unban shows the second play ----
  admin_acc := tests.account('dr-admin');
  insert into admins (account) values (admin_acc);
  perform tests.become(admin_acc);
  perform reverse_card(unbanned);
  perform tests.unbecome();
  perform tests.become(pg_temp.owner(c));
  select to_jsonb(b) into row from my_bans b where b.ban = the_ban;
  if row -> 'lifted_at' is distinct from 'null'::jsonb or row -> 'lifted_card' is distinct from 'null'::jsonb then raise exception 'an admin''s end of the Unban leaves no lift on the ban: %', row; end if;
  if (row ->> 'until')::timestamptz is distinct from (row ->> 'own_until')::timestamptz or (row ->> 'until')::timestamptz <= now() then raise exception 'the ban ends at its own end again: %', row; end if;
  page := log_page(null);
  select x into row from jsonb_array_elements(page -> 'sources' -> 'bans') x where x ->> 'ban' = the_ban::text;
  if row -> 'lifted_at' is distinct from 'null'::jsonb or row -> 'lifted_card' is distinct from 'null'::jsonb then raise exception 'log_page carries no lift after the admin''s end: %', row; end if;
  perform tests.unbecome();
  -- A second Unban (another card, so the two plays can be told apart in one transaction) is the lift the ban shows now.
  perform pg_temp.hand(caster, 't-unban-2', 1);
  unbanned2 := (pg_temp.heart(caster, 't-unban-2', c) ->> 'id')::uuid;
  perform tests.become(pg_temp.owner(c));
  select to_jsonb(b) into row from my_bans b where b.ban = the_ban;
  if row ->> 'lifted_card' is distinct from 't-unban-2' or (row ->> 'lifted_at')::timestamptz is distinct from (select created_at from acts where id = unbanned2)
     or (row ->> 'until')::timestamptz is distinct from (select created_at from acts where id = unbanned2) then raise exception 'the second Unban is the lift the ban shows: %', row; end if;
  perform tests.unbecome();

  -- ---- 3. A second player's page holds none of it ----
  perform tests.become(pg_temp.owner(stranger));
  page := log_page(null);
  if jsonb_array_length(page -> 'sources' -> 'infractions') <> 0 or jsonb_array_length(page -> 'sources' -> 'bans') <> 0 then raise exception 'a stranger''s log_page holds none of the first player''s rows: %', page -> 'sources' -> 'infractions'; end if;
  if exists (select 1 from my_infractions) or exists (select 1 from my_bans) then raise exception 'a stranger''s views hold none of the first player''s rows'; end if;
  perform tests.unbecome();
end $$;
