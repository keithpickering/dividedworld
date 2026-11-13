-- The discipline cards' catalog, a play that is over at once, relief and the lift (supabase/migrations/0361_discipline_cards.sql, section 1; docs/plans/2026-11-11-card-notes-part-5-plan.md,
-- Task 2; the design docs/plans/2026-11-11-card-notes-design.md, "Happy Heart, Super Happy Heart, Ultra Happy Heart").
--
-- 1. card_kinds holds `discipline`: null, or an object of one of four kinds on a cast card, with a time up only for a watch; card_kinds_problem and seed_instance say the same in the engine's words, and a
--    relief or an unban reaches a character with no time up.
-- 2. A relief or an unban acts the moment it lands: no play_reach row, no `ends`, no stack. Relief takes the target's oldest live points first (warn_reliefs), an unban lifts every running ban (ban_lifts);
--    warn_points, banned_until, my_bans.until and punishment_running read them (card_relief, ban_ends). A heart on an empty bar and an unban on a character not banned are refused before anything is spent.
-- 3. An admin's end of the play (reverse_card) undoes it, computed; the rows stay. The tables are append-only and nobody's to read or write.
-- 4. No set face down (the trigger), no staff caster, no staff target; a refusal is the same words for every caller (the mask test).
-- The cards are this file's own (t-relief-one, t-relief-all, t-unban, t-fall, t-watch), never an instance's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- ---- 0. The race (first: the committed rows must not meet this file's own locks): a heart and a filing on one character, in either order ----
-- The target holds a moderate (4); a heart (lightestBand, 2) and a minor filing (2) go at once. Whichever goes first, the bar is 4 + 2 - 2 = 4, and never negative.
do $$
declare
  ua uuid := gen_random_uuid(); uc uuid := gen_random_uuid();
  caster uuid := gen_random_uuid(); target uuid := gen_random_uuid(); t uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid();
  said text[]; held text; why text;
begin
  perform tests.commit(format($sql$
    insert into settings (key, value) values ('warnBar', '{"size": 10, "bands": {"minor": 2, "moderate": 4, "severe": 7}, "decay": {"unit": "day", "count": 14}, "banDays": [1, 3, 7]}') on conflict (key) do nothing;
    insert into card_kinds (key, name, alignment, rarity, play, reaches, discipline) values
      ('t-relief-one', 'Test Relief One', 'sweet', 'uncommon', 'cast', '{character}', '{"kind": "relief", "points": "lightestBand"}'),
      ('t-relief-all', 'Test Relief All', 'sweet', 'rare', 'cast', '{character}', '{"kind": "relief", "points": "all"}'),
      ('t-unban', 'Test Unban', 'sweet', 'legendary', 'cast', '{character}', '{"kind": "unban"}')
      on conflict (key) do nothing;
    insert into auth.users (id, email) values (%1$L, 'dh-race-a@test.invalid'), (%2$L, 'dh-race-c@test.invalid');
    insert into accounts (id) values (%1$L), (%2$L);
    insert into wallets (account, balance) values (%1$L, 100), (%2$L, 100);
    insert into characters (id, owner, name, created_at, debuted_at) values (%3$L, %1$L, 'Dh Race Caster', now(), now()), (%4$L, %2$L, 'Dh Race Target', now(), now());
    insert into class_history (character, class_key, started_at) values (%3$L, 'alpha', now()), (%4$L, 'alpha', now());
    insert into card_ledger (account, card, kind, price) values (%1$L, 't-relief-one', 'bought', 0);
    insert into threads (id, board, title) select %5$L, b.id, 'Dh race' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%6$L, %4$L, 'post', %5$L, '{"body": "One."}'), (%7$L, %4$L, 'post', %5$L, '{"body": "Two."}');
    do $d$ begin perform infract(%4$L, 'moderate', %6$L, 'dh-mod'); end $d$;
  $sql$, ua, uc, caster, target, t, p1, p2));
  if warn_points(target) is distinct from 4 then raise exception 'the race starts at 4: %', warn_points(target); end if;
  said := tests.race_service(
    format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', ua, 't-relief-one', caster, target, '{}', '', 'character', p1),
    format('select infract(%L, %L, %L, %L)', target, 'minor', p2, 'dh-mod'));
  if said[1] is not null or said[2] is not null then raise exception 'a heart and a filing at once both land, said %', said; end if;
  if warn_points(target) is distinct from 4 then raise exception 'a heart racing a filing: the bar is the filing''s points less the heart''s (4), got %', warn_points(target); end if;
  if (select coalesce(sum(points), 0) from warn_reliefs where infraction in (select id from acts where kind = 'infraction' and payload ->> 'character' = target::text)) is distinct from 2::bigint then
    raise exception 'the heart took 2 once';
  end if;
  -- The lock itself, deterministically: another session holds the target's row (as infract does), and a heart waits on it rather than reading the bar past it. 55P03 is the lock timeout.
  insert into card_ledger (account, card, kind, price) values (ua, 't-relief-one', 'bought', 0);
  held := current_setting('lock_timeout');
  perform extensions.dblink_connect('dh_holder', current_setting('kayfabb.scratch_url'));
  begin
    perform extensions.dblink_exec('dh_holder', 'begin');
    perform extensions.dblink_exec('dh_holder', format('do $h$ begin perform 1 from characters where id = %L for no key update; end $h$', target));
    perform set_config('lock_timeout', '200ms', true);
    why := pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', ua, 't-relief-one', caster, target, '{}', '', 'character', p1));
    perform set_config('lock_timeout', held, true);
    perform extensions.dblink_exec('dh_holder', 'rollback');
  exception when others then
    perform extensions.dblink_disconnect('dh_holder');
    raise;
  end;
  perform extensions.dblink_disconnect('dh_holder');
  if why is null or why not like '55P03:%' then raise exception 'a heart waits on the target''s row lock, said %', why; end if;
  if warn_points(target) is distinct from 4 then raise exception 'the timed-out heart took nothing: bar %', warn_points(target); end if;
end $$;

-- ---- Fixtures for the rest: the bar's numbers, a staff character, and helpers ----
insert into settings (key, value) values ('warnBar', '{"size": 10, "bands": {"minor": 2, "moderate": 4, "severe": 7}, "decay": {"unit": "day", "count": 14}, "banDays": [1, 3, 7]}') on conflict (key) do nothing;
insert into characters (name, staff, staff_kind, debuted_at) values ('Dh Mod', 'dh-mod', 'persona', now()) on conflict do nothing;

create function pg_temp.owner(c uuid) returns uuid language sql as $$ select owner from characters where id = c $$;

-- A player with a wallet and one character (named 'Dh <label>').
create function pg_temp.player(label text, cash integer default 500) returns uuid language plpgsql as $$
declare a uuid := tests.account('dh-' || label);
begin
  insert into wallets (account, balance) values (a, cash) on conflict (account) do update set balance = excluded.balance;
  return tests.character(a, 'Dh ' || label);
end $$;

create function pg_temp.wallet(c uuid) returns integer language sql as $$ select coalesce((select w.balance from wallets w where w.account = pg_temp.owner(c)), 0) $$;

-- A player says something through the real post(), as the account that owns the character.
create function pg_temp.say(by_character uuid, in_thread uuid, body text) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become(pg_temp.owner(by_character));
  made := post(in_thread, by_character, body);
  perform tests.unbecome();
  return (made ->> 'id')::uuid;
end $$;

-- An infraction of a band against the character, on a post of its own (as a visit's filing does).
create function pg_temp.inf(c uuid, t uuid, band text) returns jsonb language plpgsql as $$
declare p uuid := pg_temp.say(c, t, 'A post ' || gen_random_uuid());
begin
  return infract(c, band, p, 'dh-mod') || jsonb_build_object('post', p);
end $$;

create function pg_temp.hand(c uuid, card text, n integer default 1) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select pg_temp.owner(c), card, 'bought', 0 from generate_series(1, n)
$$;

create function pg_temp.post_of(c uuid) returns uuid language sql as $$ select id from acts where character = c and kind = 'post' order by created_at desc, id limit 1 $$;

-- A heart: the caster's player plays the card through the caster on the target, from one of its posts, paying `price`.
create function pg_temp.heart(caster uuid, card text, target uuid, price integer default 0, from_post uuid default null) returns jsonb language sql as $$
  select play_card(pg_temp.owner(caster), card, caster, target, '{}', price, '', 'character', coalesce(from_post, pg_temp.post_of(target)))
$$;

-- Posts to be filed, made up front (a banned character cannot post); a ban for the character: a severe and a moderate on two of them fill a bar of ten.
create function pg_temp.posts(c uuid, t uuid, n integer default 2) returns uuid[] language plpgsql as $$
declare out uuid[] := '{}'; i integer;
begin
  for i in 1..n loop out := out || pg_temp.say(c, t, 'A post ' || gen_random_uuid()); end loop;
  return out;
end $$;
create function pg_temp.fill(c uuid, two uuid[]) returns uuid language plpgsql as $$
declare hit jsonb;
begin
  perform infract(c, 'severe', two[1], 'dh-mod');
  hit := infract(c, 'moderate', two[2], 'dh-mod');
  if hit ->> 'ban' is null then raise exception 'the bar did not fill: %', hit; end if;
  return (hit ->> 'ban')::uuid;
end $$;

-- A ruling planted on a punishment, as close_appeal writes it (an appeal, then its ruling by a staff character, in the punishment's thread).
create function pg_temp.ruled(punishment uuid, c uuid, verdict text, delta integer, until timestamptz default null) returns void language plpgsql as $$
declare ap uuid; t uuid := (select thread from acts where id = punishment);
begin
  perform set_config('kayfabb.appeal_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (c, 'appeal', t, punishment, '{"plea": "Please."}') returning id into ap;
  perform set_config('kayfabb.appeal_writer', '', true);
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  values ((select id from characters where staff = 'dh-mod'), 'appeal_ruling', t, ap,
          jsonb_build_object('appeal_act', ap, 'verdict', verdict, 'points_delta', delta, 'line', 'Ruled.') || case when until is null then '{}'::jsonb else jsonb_build_object('until', until) end);
  perform set_config('kayfabb.staff_writer', '', true);
end $$;

-- ---- 1. The catalog ----
do $$
declare why text;
begin
  if not exists (select 1 from information_schema.columns where table_name = 'card_kinds' and column_name = 'discipline' and data_type = 'jsonb') then raise exception 'card_kinds has no discipline jsonb column'; end if;
  -- A relief and an unban reach a character with no time up (the beyond-a-post check lets them through); a fall reaches a post with none; a watch needs one.
  insert into card_kinds (key, name, alignment, rarity, play, reaches, discipline) values ('t-fall', 'Test Fall', 'sweet', 'uncommon', 'cast', '{post}', '{"kind": "fall"}');
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, discipline) values ('t-watch', 'Test Watch', 'salty', 'rare', 'cast', '{character}', interval '7 days', '{"kind": "watch", "weight": 2}');
  why := pg_temp.refusal($s$insert into card_kinds (key, name, alignment, rarity, play, reaches, discipline) values ('t-bad', 'Bad', 'sweet', 'rare', 'cast', '{character}', '{"kind": "watch", "weight": 2}')$s$);
  if why not like '23514:%' then raise exception 'a watch with no time up is refused by the catalog, said %', why; end if;
  why := pg_temp.refusal($s$insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, discipline) values ('t-bad', 'Bad', 'sweet', 'rare', 'cast', '{character}', interval '1 day', '{"kind": "relief", "points": "all"}')$s$);
  if why not like '23514:%' then raise exception 'a relief with a time up is refused by the catalog, said %', why; end if;
  why := pg_temp.refusal($s$insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, discipline) values ('t-bad', 'Bad', 'sweet', 'rare', 'cast', '{character}', interval '1 day', '{"kind": "unban"}')$s$);
  if why not like '23514:%' then raise exception 'an unban with a time up is refused by the catalog, said %', why; end if;
  why := pg_temp.refusal($s$insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, discipline) values ('t-bad', 'Bad', 'sweet', 'rare', 'cast', '{post}', interval '1 day', '{"kind": "fall"}')$s$);
  if why not like '23514:%' then raise exception 'a fall with a time up is refused by the catalog, said %', why; end if;
  why := pg_temp.refusal($s$insert into card_kinds (key, name, alignment, rarity, play, reaches, discipline) values ('t-bad', 'Bad', 'sweet', 'rare', 'cast', '{character}', '{"kind": "bless"}')$s$);
  if why not like '23514:%' then raise exception 'a discipline of no kind is refused by the catalog, said %', why; end if;
  why := pg_temp.refusal($s$insert into card_kinds (key, name, alignment, rarity, play, reaches, discipline) values ('t-bad', 'Bad', 'sweet', 'rare', 'cast', '{character}', '"relief"')$s$);
  if why not like '23514:%' then raise exception 'a discipline that is not an object is refused by the catalog, said %', why; end if;
  why := pg_temp.refusal($s$insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, discipline) values ('t-bad', 'Bad', 'sweet', 'rare', 'use', '{character}', interval '1 day', '{"kind": "watch", "weight": 2}')$s$);
  if why not like '23514:%' then raise exception 'a discipline on a use card is refused by the catalog, said %', why; end if;
  -- Only a relief or an unban is let through the beyond-a-post check: any other card beyond a post still needs its time up.
  why := pg_temp.refusal($s$insert into card_kinds (key, name, alignment, rarity, play, reaches) values ('t-bad', 'Bad', 'sweet', 'rare', 'cast', '{character}')$s$);
  if why not like '23514:%' then raise exception 'a card beyond a post with no time up is still refused, said %', why; end if;
  why := pg_temp.refusal($s$insert into card_kinds (key, name, alignment, rarity, play, reaches, discipline) values ('t-bad', 'Bad', 'sweet', 'rare', 'cast', '{thread}', '{"kind": "fall"}')$s$);
  if why not like '23514:%' then raise exception 'a fall beyond a post with no time up is still refused, said %', why; end if;
end $$;

-- card_kinds_problem and seed_instance say it in the engine's words (engine/rules/instance.ts, disciplineProblems and reachProblems), naming the card.
do $$
declare why text; c constant text := '"key": "k", "rarity": "uncommon"';
begin
  why := card_kinds_problem(('[{' || c || ', "reaches": ["character"], "discipline": {"kind": "relief", "points": "lightestBand"}},'
    || '{' || c || ', "key": "u", "reaches": ["character"], "discipline": {"kind": "unban"}, "stack": 1, "pins": false},'
    || '{' || c || ', "key": "f", "discipline": {"kind": "fall"}, "reaches": ["post"], "stack": 1},'
    || '{' || c || ', "key": "w", "reaches": ["character"], "lasts": {"unit": "day", "count": 7}, "discipline": {"kind": "watch", "weight": 2}}]')::jsonb);
  if why is not null then raise exception 'clean discipline cards were refused: %', why; end if;
  why := card_reach_problem(('[{' || c || ', "reaches": ["character"], "discipline": {"kind": "relief", "points": "all"}}, {' || c || ', "key": "u", "reaches": ["character"], "discipline": {"kind": "unban"}}]')::jsonb);
  if why is not null then raise exception 'a relief and an unban reach a character with no time up: %', why; end if;
  why := card_reach_problem(('[{' || c || ', "reaches": ["character"]}]')::jsonb);
  if why is distinct from 'card "k" reaches beyond a post with no time up (lasts); every effect beyond a post ends at its time' then raise exception 'any other card beyond a post needs a time up: %', why; end if;
  why := card_reach_problem(('[{' || c || ', "reaches": ["character"], "discipline": {"kind": "watch", "weight": 2}}]')::jsonb);
  if why is distinct from 'card "k" reaches beyond a post with no time up (lasts); every effect beyond a post ends at its time' then raise exception 'a watch needs a time up: %', why; end if;

  why := card_kinds_problem(('[{' || c || ', "discipline": "relief"}]')::jsonb);
  if why is distinct from 'card "k" has a discipline that is not an object with a kind' then raise exception 'a discipline that is no object: %', why; end if;
  why := card_kinds_problem(('[{' || c || ', "discipline": {"kind": "bless"}}]')::jsonb);
  if why is distinct from 'card "k" has the discipline kind "bless"; a discipline is relief, unban, fall or watch' then raise exception 'a discipline of no kind: %', why; end if;
  why := card_kinds_problem(('[{' || c || ', "play": "use", "gimmick": {"kind": "ward", "upTo": "common"}, "lasts": {"unit": "day", "count": 7}, "reaches": ["character"], "discipline": {"kind": "watch", "weight": 2}}]')::jsonb);
  if why not like '%card "k" has a discipline, and only a cast card does%' then raise exception 'a discipline on a use card: %', why; end if;
  why := card_kinds_problem(('[{' || c || ', "reaches": ["character"], "writes": true, "discipline": {"kind": "relief", "points": "all"}}]')::jsonb);
  if why is distinct from 'card "k" has a relief and writes; a card with a discipline has no other effect' then raise exception 'a discipline beside writes: %', why; end if;
  why := card_kinds_problem(('[{' || c || ', "key": "u", "reaches": ["character"], "needsMessage": "Say.", "discipline": {"kind": "unban"}}]')::jsonb);
  if why is distinct from 'card "u" has an unban and needsMessage; a card with a discipline has no other effect' then raise exception 'an unban beside needsMessage: %', why; end if;
  why := card_kinds_problem(('[{' || c || ', "reaches": ["post"], "discipline": {"kind": "relief", "points": "all"}}]')::jsonb);
  if why is distinct from 'card "k" has a relief, and a relief reaches a character alone' then raise exception 'a relief on a post: %', why; end if;
  why := card_kinds_problem(('[{' || c || ', "reaches": ["post", "character"], "lasts": {"unit": "day", "count": 7}, "discipline": {"kind": "fall"}}]')::jsonb);
  if why not like '%card "k" has a fall, and a fall reaches a post alone%' then raise exception 'a fall beyond a post: %', why; end if;
  why := card_kinds_problem(('[{' || c || ', "reaches": ["character"], "discipline": {"kind": "relief", "points": "some"}}]')::jsonb);
  if why is distinct from 'card "k" has a relief of "some"; relief takes the lightestBand or all' then raise exception 'a relief of some: %', why; end if;
  why := card_kinds_problem(('[{' || c || ', "reaches": ["character"], "lasts": {"unit": "day", "count": 1}, "discipline": {"kind": "unban"}}]')::jsonb);
  if why is distinct from 'card "k" has an unban and a time up; an unban is over when it lands and has none' then raise exception 'an unban with a time up: %', why; end if;
  why := card_kinds_problem(('[{' || c || ', "reaches": ["character"], "pins": true, "discipline": {"kind": "relief", "points": "all"}}]')::jsonb);
  if why is distinct from 'card "k" has a relief and pins; a relief is over when it lands and has none' then raise exception 'a relief that pins: %', why; end if;
  why := card_kinds_problem(('[{' || c || ', "reaches": ["post"], "stack": 2, "discipline": {"kind": "fall"}}]')::jsonb);
  if why is distinct from 'card "k" has a fall, and a fall has a stack of 1' then raise exception 'a fall with a stack of 2: %', why; end if;
  why := card_kinds_problem(('[{' || c || ', "reaches": ["post"], "lasts": {"unit": "day", "count": 1}, "discipline": {"kind": "fall"}}]')::jsonb);
  if why not like '%card "k" has a fall and a time up; a fall lasts until a filing spends it%' then raise exception 'a fall with a time up: %', why; end if;
  why := card_kinds_problem(('[{' || c || ', "reaches": ["character"], "discipline": {"kind": "watch", "weight": 2}}]')::jsonb);
  if why is distinct from 'card "k" has a watch with no time up (lasts); a watch ends at its time' then raise exception 'a watch with no time up: %', why; end if;
  why := card_kinds_problem(('[{' || c || ', "reaches": ["character"], "lasts": {"unit": "day", "count": 7}, "discipline": {"kind": "watch", "weight": 1}}]')::jsonb);
  if why is distinct from 'card "k" has a watch of weight 1; weight is a number above 1 and at most 10' then raise exception 'a watch of weight 1: %', why;  end if;
  why := card_kinds_problem(('[{' || c || ', "reaches": ["character"], "lasts": {"unit": "day", "count": 7}, "discipline": {"kind": "watch", "weight": 11}}]')::jsonb);
  if why is distinct from 'card "k" has a watch of weight 11; weight is a number above 1 and at most 10' then raise exception 'a watch of weight 11: %', why; end if;
  why := card_kinds_problem(('[{' || c || ', "reaches": ["character"], "lasts": {"unit": "day", "count": 7}, "discipline": {"kind": "watch"}}]')::jsonb);
  if why is distinct from 'card "k" has a watch of weight none; weight is a number above 1 and at most 10' then raise exception 'a watch with no weight: %', why; end if;

  -- seed_instance writes the column, refuses a poison, and lets a relief and an unban through with no time up.
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', jsonb_build_array(
    jsonb_build_object('key', 't-seed-relief', 'name', 'Seed Relief', 'alignment', 'sweet', 'rarity', 'uncommon', 'reaches', jsonb_build_array('character'), 'discipline', jsonb_build_object('kind', 'relief', 'points', 'all')),
    jsonb_build_object('key', 't-seed-plain', 'name', 'Seed Plain', 'alignment', 'sweet', 'rarity', 'common'))));
  if (select discipline from card_kinds where key = 't-seed-relief') is distinct from '{"kind": "relief", "points": "all"}'::jsonb or (select discipline from card_kinds where key = 't-seed-plain') is not null
     or (select lasts from card_kinds where key = 't-seed-relief') is not null then raise exception 'seed_instance writes the discipline and nothing else'; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "t-seed-bad", "name": "Seed Bad", "alignment": "sweet", "rarity": "rare", "reaches": ["character"], "discipline": {"kind": "watch", "weight": 2}}]}')$s$);
  if why is null or why not like '22023:%card "t-seed-bad" reaches beyond a post with no time up%' then raise exception 'seed_instance refuses a watch with no time up, said %', why; end if;
  why := pg_temp.refusal($s$select seed_instance('{"settings": {}, "classes": [], "boards": [], "cards": [{"key": "t-seed-bad", "name": "Seed Bad", "alignment": "sweet", "rarity": "rare", "discipline": {"kind": "bless"}}]}')$s$);
  if why is null or why not like '22023:%card "t-seed-bad" has the discipline kind "bless"%' then raise exception 'seed_instance refuses a discipline of no kind, said %', why; end if;
end $$;

-- ---- 2. Relief takes the oldest points first and splits an infraction; a heart is over when it lands ----
do $$
declare
  t uuid := tests.thread('Dh relief');
  caster uuid := pg_temp.player('r1-caster');
  c uuid := pg_temp.player('r1-target');
  a jsonb := pg_temp.inf(c, t, 'moderate');
  b jsonb := pg_temp.inf(c, t, 'minor');
  ia uuid := (a ->> 'infraction')::uuid; ib uuid := (b ->> 'infraction')::uuid;
  pl jsonb; pid uuid; w0 integer; n0 bigint; said text;
begin
  perform pg_temp.hand(caster, 't-relief-one', 4);
  w0 := pg_temp.wallet(caster);
  if warn_points(c) is distinct from 6 then raise exception 'the bar before: %', warn_points(c); end if;
  -- A 4 then a 2 on the bar, lightestBand 2: the 4 shows 2 left, the bar 4.
  pl := pg_temp.heart(caster, 't-relief-one', c, 50);
  pid := (pl ->> 'id')::uuid;
  if card_relief(ia) is distinct from 2 or card_relief(ib) is distinct from 0 or warn_points(c) is distinct from 4 then
    raise exception 'a lightestBand heart takes the oldest 2: %, %, bar %', card_relief(ia), card_relief(ib), warn_points(c);
  end if;
  if (select points from warn_reliefs where play = pid and infraction = ia) is distinct from 2 or (select count(*) from warn_reliefs where play = pid) is distinct from 1::bigint then raise exception 'one relief row of 2 on the first'; end if;
  -- It is over when it lands: the payload says so and names what was taken, it has no end and no play_reach row, and the hand and the wallet are spent as any play's.
  if pl -> 'payload' -> 'instant' is distinct from 'true'::jsonb or (pl -> 'payload' ->> 'took')::integer is distinct from 2 or pl -> 'payload' ? 'ends'
     or pl -> 'payload' ->> 'reach' is distinct from 'character' or pl -> 'payload' ->> 'character' is distinct from c::text or pl -> 'payload' ->> 'targetName' is distinct from 'Dh r1-target' then
    raise exception 'an instant play''s payload: %', pl -> 'payload';
  end if;
  if exists (select 1 from play_reach r where r.play = pid) then raise exception 'a heart writes no play_reach row'; end if;
  if pg_temp.wallet(caster) is distinct from w0 - 50 or card_held(pg_temp.owner(caster), 't-relief-one') is distinct from 3 then raise exception 'the heart is paid for once'; end if;
  -- A second on the same character lands at once and takes the rest of the first; a third the second infraction.
  pl := pg_temp.heart(caster, 't-relief-one', c);
  if card_relief(ia) is distinct from 4 or card_relief(ib) is distinct from 0 or warn_points(c) is distinct from 2 or (pl -> 'payload' ->> 'took')::integer is distinct from 2 then
    raise exception 'a second heart takes the rest of the first: %, %, bar %', card_relief(ia), card_relief(ib), warn_points(c);
  end if;
  pl := pg_temp.heart(caster, 't-relief-one', c);
  if card_relief(ib) is distinct from 2 or warn_points(c) is distinct from 0 then raise exception 'a third heart takes the second infraction: %, bar %', card_relief(ib), warn_points(c); end if;
  -- The Acts are as they were: nothing updated an infraction.
  if (select (payload ->> 'points')::integer from acts where id = ia) is distinct from 4 then raise exception 'an infraction was changed'; end if;
  -- The bar is empty: the heart is refused in plain words, and the hand and the wallet are as they were.
  w0 := pg_temp.wallet(caster);
  n0 := (select count(*) from warn_reliefs);
  said := pg_temp.refusal(format('select pg_temp.heart(%L, %L, %L, 50)', caster, 't-relief-one', c));
  if said is distinct from '55000: this character''s warn bar is empty' then raise exception 'an empty bar refuses, said %', said; end if;
  if pg_temp.wallet(caster) is distinct from w0 or card_held(pg_temp.owner(caster), 't-relief-one') is distinct from 1 or (select count(*) from warn_reliefs) is distinct from n0 then
    raise exception 'a refused heart spent or wrote something';
  end if;
  -- The play's own Act is public as any card Act is, and the log's relief rows are the table's, never an Act edited.
  if not exists (select 1 from acts_public x where x.id = pid) then raise exception 'a heart''s play is a public Act'; end if;
end $$;

-- `all` empties a bar of three infractions, taking each in full.
do $$
declare
  t uuid := tests.thread('Dh all');
  caster uuid := pg_temp.player('r2-caster');
  c uuid := pg_temp.player('r2-target');
  i1 jsonb := pg_temp.inf(c, t, 'minor'); i2 jsonb := pg_temp.inf(c, t, 'moderate'); i3 jsonb := pg_temp.inf(c, t, 'minor');
  pl jsonb;
begin
  perform pg_temp.hand(caster, 't-relief-all', 1);
  pl := pg_temp.heart(caster, 't-relief-all', c);
  if warn_points(c) is distinct from 0 or (pl -> 'payload' ->> 'took')::integer is distinct from 8 then raise exception 'all empties the bar: %, took %', warn_points(c), pl -> 'payload' ->> 'took'; end if;
  if (select array_agg(w.points order by k.created_at, k.id) from warn_reliefs w join acts k on k.id = w.infraction where w.play = (pl ->> 'id')::uuid) is distinct from array[2, 4, 2] then
    raise exception 'one row for each infraction, each in full: %', (select array_agg(w.points) from warn_reliefs w where w.play = (pl ->> 'id')::uuid);
  end if;
end $$;

-- ---- 3. An infraction an appeal reduced gives only what is left; the bar is never below zero; the expired and the pre-ban are not touched ----
do $$
declare
  t uuid := tests.thread('Dh left');
  caster uuid := pg_temp.player('r3-caster');
  c uuid := pg_temp.player('r3-target');
  sev jsonb := pg_temp.inf(c, t, 'severe'); mnr jsonb := pg_temp.inf(c, t, 'minor');
  is_ uuid := (sev ->> 'infraction')::uuid; im uuid := (mnr ->> 'infraction')::uuid;
  pl jsonb;
begin
  perform pg_temp.hand(caster, 't-relief-one', 1);
  perform pg_temp.hand(caster, 't-relief-all', 1);
  -- An appeal reduced the severe 7 by 4 (half, rounded up, kept): 3 are left on it, and 5 on the bar.
  perform pg_temp.ruled(is_, c, 'reduced', -4);
  if warn_points(c) is distinct from 5 then raise exception 'the bar after a reduction: %', warn_points(c); end if;
  pl := pg_temp.heart(caster, 't-relief-one', c);
  if card_relief(is_) is distinct from 2 or warn_points(c) is distinct from 3 then raise exception 'a heart takes from what is left: %, bar %', card_relief(is_), warn_points(c); end if;
  pl := pg_temp.heart(caster, 't-relief-all', c);
  if card_relief(is_) is distinct from 3 or card_relief(im) is distinct from 2 or warn_points(c) is distinct from 0 or (pl -> 'payload' ->> 'took')::integer is distinct from 3 then
    raise exception 'an infraction gives only what is left, and the bar is never below zero: %, %, bar %', card_relief(is_), card_relief(im), warn_points(c);
  end if;
end $$;

-- A ruling that lands after a heart took everything from an infraction: the infraction's left-over is 0 and the ruling would take 4 more; the bar clamps at zero and never goes below it
-- (a severe 7, t-relief-all takes 7, then an appeal reduces it by 4: 7 - 4 - 7 is -4 for that infraction, and the bar says 0).
do $$
declare
  t uuid := tests.thread('Dh clamp');
  caster uuid := pg_temp.player('r5-caster');
  c uuid := pg_temp.player('r5-target');
  sev jsonb := pg_temp.inf(c, t, 'severe'); mnr jsonb := pg_temp.inf(c, t, 'minor');
  is_ uuid := (sev ->> 'infraction')::uuid;
  pl jsonb;
begin
  perform pg_temp.hand(caster, 't-relief-all', 1);
  pl := pg_temp.heart(caster, 't-relief-all', c);
  if warn_points(c) is distinct from 0 or card_relief(is_) is distinct from 7 then raise exception 'the heart took all 9: bar %, relief %', warn_points(c), card_relief(is_); end if;
  perform pg_temp.ruled(is_, c, 'reduced', -4);
  if warn_points(c) is distinct from 0 then raise exception 'an infraction a heart emptied counts zero, not 7 - 4 - 7: %', warn_points(c); end if;
  -- Another infraction after it still counts in full: the clamp is per infraction, not on the sum.
  perform pg_temp.inf(c, t, 'minor');
  if warn_points(c) is distinct from 2 then raise exception 'the clamp is per infraction: a later minor counts 2, got %', warn_points(c); end if;
end $$;

do $$
declare
  t uuid := tests.thread('Dh stale');
  caster uuid := pg_temp.player('r4-caster');
  c uuid := pg_temp.player('r4-target');
  p1 uuid := pg_temp.say(c, t, 'Old.'); p2 uuid := pg_temp.say(c, t, 'Before the ban.');
  board uuid := (select board from threads where id = t);
  gone uuid; before_ban uuid; live jsonb; pl jsonb;
begin
  perform pg_temp.hand(caster, 't-relief-all', 2);
  -- An infraction that has expired (it landed 15 days ago, for 14), and one from before the character's last ban (the ban has since ended).
  perform set_config('kayfabb.warn_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at)
  values (null, 'infraction', t, jsonb_build_object('character', c, 'band', 'minor', 'points', 2, 'rule_number', null, 'board', board, 'about_act', p1, 'visit_act', null, 'staff', 'dh-mod',
                                                    'expires_at', now() - interval '1 day'), now() - interval '15 days') returning id into gone;
  insert into acts (character, kind, thread, payload, created_at)
  values (null, 'infraction', t, jsonb_build_object('character', c, 'band', 'minor', 'points', 2, 'rule_number', null, 'board', board, 'about_act', p2, 'visit_act', null, 'staff', 'dh-mod',
                                                    'expires_at', now() + interval '10 days'), now() - interval '3 days') returning id into before_ban;
  insert into acts (character, kind, thread, payload, created_at)
  values (null, 'ban', t, jsonb_build_object('character', c, 'days', 1, 'until', now() - interval '1 day', 'infraction_act', before_ban, 'season', 1), now() - interval '2 days');
  perform set_config('kayfabb.warn_writer', '', true);
  if warn_points(c) is distinct from 0 then raise exception 'neither an expired infraction nor one from before the last ban counts: %', warn_points(c); end if;
  if pg_temp.refusal(format('select pg_temp.heart(%L, %L, %L)', caster, 't-relief-all', c)) is distinct from '55000: this character''s warn bar is empty' then raise exception 'a bar of only the stale is empty'; end if;
  live := pg_temp.inf(c, t, 'minor');
  pl := pg_temp.heart(caster, 't-relief-all', c);
  if (pl -> 'payload' ->> 'took')::integer is distinct from 2 or card_relief(gone) is distinct from 0 or card_relief(before_ban) is distinct from 0 or card_relief((live ->> 'infraction')::uuid) is distinct from 2
     or exists (select 1 from warn_reliefs w where w.infraction in (gone, before_ban)) then raise exception 'a heart touches only the live infraction'; end if;
end $$;

-- ---- 4. Unban: lifts every running ban at once; the lifted character plays; my_bans.until is the lift; the ladder is not stepped back ----
do $$
declare
  t uuid := tests.thread('Dh unban');
  caster uuid := pg_temp.player('u1-caster');
  c uuid := pg_temp.player('u1-target');
  twin uuid := tests.character(pg_temp.owner(c), 'Dh u1-twin');
  ps uuid[] := pg_temp.posts(c, t, 8);
  keep uuid := pg_temp.say(c, t, 'A post for the heart to come from.');
  ban1 uuid; ban2 uuid; ban3 uuid; pl jsonb; pid uuid; until timestamptz; w0 integer; said text;
begin
  perform pg_temp.hand(caster, 't-unban', 3);
  -- Two bans running at once (a late filing can lay a second): the first a day, the second three.
  ban1 := pg_temp.fill(c, ps[1:2]);
  ban2 := pg_temp.fill(c, ps[3:4]);
  if banned_until(c) is null or (select (payload ->> 'days')::integer from acts where id = ban2) is distinct from 3 then raise exception 'two bans are running, the second three days: %', (select payload from acts where id = ban2); end if;
  if pg_temp.refusal(format('select pg_temp.say(%L, %L, %L)', c, t, 'Banned.')) not like '%banned until%' then raise exception 'the ban holds before the Unban'; end if;
  w0 := pg_temp.wallet(caster);
  pl := pg_temp.heart(caster, 't-unban', c, 50);
  pid := (pl ->> 'id')::uuid;
  if banned_until(c) is not null then raise exception 'an Unban lifts every running ban: still banned until %', banned_until(c); end if;
  if (select count(*) from ban_lifts where play = pid) is distinct from 2::bigint or not exists (select 1 from ban_lifts where play = pid and ban = ban1) or not exists (select 1 from ban_lifts where play = pid and ban = ban2) then
    raise exception 'one lift row for each running ban';
  end if;
  if pl -> 'payload' -> 'instant' is distinct from 'true'::jsonb or pl -> 'payload' ? 'ends' or jsonb_array_length(pl -> 'payload' -> 'lifted') is distinct from 2
     or not (select bool_and((e ->> 'until')::timestamptz > now() and e ->> 'ban' in (ban1::text, ban2::text)) from jsonb_array_elements(pl -> 'payload' -> 'lifted') e) then
    raise exception 'an Unban''s payload names each ban and the end it had: %', pl -> 'payload';
  end if;
  if exists (select 1 from play_reach r where r.play = pid) then raise exception 'an Unban writes no play_reach row'; end if;
  if pg_temp.wallet(caster) is distinct from w0 - 50 then raise exception 'an Unban is paid for'; end if;
  -- The lifted character plays: it posts, and the log's own read says when the ban ended, at the lift (the Act's own time), and keeps the ban's own end beside.
  perform pg_temp.say(c, t, 'Free again.');
  perform tests.become(pg_temp.owner(c));
  select b.until into until from my_bans b where b.ban = ban2;
  perform tests.unbecome();
  if until is distinct from (select created_at from acts where id = pid) then raise exception 'my_bans.until is the lift''s time: %', until; end if;
  if punishment_running(ban1) or punishment_running(ban2) then raise exception 'a lifted ban is not running'; end if;
  -- A character that is not banned (the twin, or the lifted one now) is refused in plain words and nothing is spent; the words are the same for an owner and a stranger.
  perform pg_temp.hand(c, 't-unban', 1);
  w0 := pg_temp.wallet(caster);
  said := pg_temp.refusal(format('select pg_temp.heart(%L, %L, %L, 50)', caster, 't-unban', c));
  if said is distinct from '55000: this character is not banned' then raise exception 'an Unban on a character not banned refuses, said %', said; end if;
  if pg_temp.refusal(format('select pg_temp.heart(%L, %L, %L, 50, %L)', c, 't-unban', twin, pg_temp.say(twin, t, 'Twin.'))) is distinct from said then raise exception 'the same words for the owner''s other mask'; end if;
  if pg_temp.wallet(caster) is distinct from w0 or card_held(pg_temp.owner(caster), 't-unban') is distinct from 2 then raise exception 'a refused Unban spent something'; end if;
  -- The ladder is not stepped back: the next full bar is the third ban (7 days), as if the lifted bans had run.
  ban3 := pg_temp.fill(c, ps[5:6]);
  if (select (payload ->> 'days')::integer from acts where id = ban3) is distinct from 7 then raise exception 'a lifted ban still counts on the ladder: %', (select payload from acts where id = ban3); end if;
end $$;

-- The ladder from the first: 1 day, lifted, then 3.
do $$
declare
  t uuid := tests.thread('Dh ladder');
  caster uuid := pg_temp.player('u2-caster');
  c uuid := pg_temp.player('u2-target');
  ps uuid[] := pg_temp.posts(c, t, 4);
  keep uuid := pg_temp.say(c, t, 'Heart post.');
  ban1 uuid; ban2 uuid;
begin
  perform pg_temp.hand(caster, 't-unban', 1);
  ban1 := pg_temp.fill(c, ps[1:2]);
  perform pg_temp.heart(caster, 't-unban', c);
  ban2 := pg_temp.fill(c, ps[3:4]);
  if (select (payload ->> 'days')::integer from acts where id = ban1) is distinct from 1 or (select (payload ->> 'days')::integer from acts where id = ban2) is distinct from 3 then raise exception '1 day, lifted, then 3'; end if;
  if banned_until(c) is null then raise exception 'the second ban runs'; end if;
end $$;

-- ---- 5. An admin's end undoes it, computed; the rows stay ----
do $$
declare
  t uuid := tests.thread('Dh end');
  admin_acc uuid := tests.account('dh-admin');
  caster uuid := pg_temp.player('e1-caster');
  c uuid := pg_temp.player('e1-target');
  d uuid := pg_temp.player('e1-banned');
  i jsonb := pg_temp.inf(c, t, 'moderate');
  ps uuid[] := pg_temp.posts(d, t, 3);
  ban uuid; own timestamptz; pl jsonb; relief_play uuid; lift_play uuid;
begin
  insert into admins (account) values (admin_acc);
  perform pg_temp.hand(caster, 't-relief-all', 1);
  perform pg_temp.hand(caster, 't-unban', 1);
  pl := pg_temp.heart(caster, 't-relief-all', c);
  relief_play := (pl ->> 'id')::uuid;
  if warn_points(c) is distinct from 0 then raise exception 'the heart took the points'; end if;
  perform tests.become(admin_acc);
  perform reverse_card(relief_play);
  perform tests.unbecome();
  if warn_points(c) is distinct from 4 or card_relief((i ->> 'infraction')::uuid) is distinct from 0 then raise exception 'an admin''s end puts the points back: %', warn_points(c); end if;
  if (select count(*) from warn_reliefs where play = relief_play) is distinct from 1::bigint then raise exception 'the relief row stays'; end if;

  ban := pg_temp.fill(d, ps[1:2]);
  own := (select (payload ->> 'until')::timestamptz from acts where id = ban);
  pl := pg_temp.heart(caster, 't-unban', d, 0, ps[3]);
  lift_play := (pl ->> 'id')::uuid;
  if banned_until(d) is not null then raise exception 'the Unban lifted the ban'; end if;
  perform tests.become(admin_acc);
  perform reverse_card(lift_play);
  perform tests.unbecome();
  if banned_until(d) is distinct from own or not punishment_running(ban) then raise exception 'an admin''s end of an Unban restores the ban''s own end: %', banned_until(d); end if;
  if (select count(*) from ban_lifts where play = lift_play) is distinct from 1::bigint then raise exception 'the lift row stays'; end if;
  -- Ended once: a second end is refused as any card's is.
  perform tests.become(admin_acc);
  if pg_temp.refusal(format('select reverse_card(%L)', lift_play)) is null then raise exception 'a second end'; end if;
  perform tests.unbecome();
end $$;

-- An appeal's ruling on a ban is read in place of the ban's own end, and a lift ends it at the least of the two.
do $$
declare
  t uuid := tests.thread('Dh ruled ban');
  caster uuid := pg_temp.player('e2-caster');
  d uuid := pg_temp.player('e2-banned');
  ps uuid[] := pg_temp.posts(d, t, 3);
  ban uuid;
begin
  perform pg_temp.hand(caster, 't-unban', 1);
  ban := pg_temp.fill(d, ps[1:2]);
  perform pg_temp.ruled(ban, d, 'increased', 0, now() + interval '5 days');
  if ban_ends(ban) is distinct from now() + interval '5 days' or banned_until(d) is distinct from now() + interval '5 days' then raise exception 'ban_ends reads an appeal''s ruling in place of the ban''s own end: %', ban_ends(ban); end if;
  perform pg_temp.heart(caster, 't-unban', d, 0, ps[3]);
  if banned_until(d) is not null or ban_ends(ban) > now() then raise exception 'a lift ends a ruled ban too'; end if;
end $$;

-- ---- 6. The masks and the other refusals ----
do $$
declare
  t uuid := tests.thread('Dh masks');
  ann uuid := tests.account('dh-ann'); bob uuid := tests.account('dh-bob'); eve uuid := tests.account('dh-eve');
  a1 uuid := tests.character(ann, 'Dh Ann One'); a2 uuid := tests.character(ann, 'Dh Ann Two');
  b1 uuid := tests.character(bob, 'Dh Bob One'); e1 uuid := tests.character(eve, 'Dh Eve One');
  pa2 uuid := pg_temp.say(a2, t, 'Ann two speaks.'); pb1 uuid := pg_temp.say(b1, t, 'Bob speaks.'); pe1 uuid := pg_temp.say(e1, t, 'Eve speaks.');
  bot uuid := (select id from characters where staff = 'dh-mod');
  bp uuid;
  inf1 jsonb; ps uuid[]; bc uuid := pg_temp.player('m-banned'); caster uuid := pg_temp.player('m-caster'); ban uuid;
  said_owner text; said_stranger text; said_self text; pl jsonb; w0 integer;
begin
  perform pg_temp.hand(a1, 't-relief-one', 3); perform pg_temp.hand(e1, 't-relief-one', 3);
  perform pg_temp.hand(bc, 't-unban', 1);
  -- A heart through one mask on another mask of the same account lands, as does a heart on one's own mask.
  inf1 := pg_temp.inf(a2, t, 'severe');
  pl := pg_temp.heart(a1, 't-relief-one', a2, 0);
  if (pl -> 'payload' ->> 'took')::integer is distinct from 2 or warn_points(a2) is distinct from 5 then raise exception 'a heart on one''s other mask lands: bar %', warn_points(a2); end if;
  pl := pg_temp.heart(a2, 't-relief-one', a2, 0);
  if warn_points(a2) is distinct from 3 then raise exception 'a heart on one''s own mask lands: bar %', warn_points(a2); end if;
  -- The refusal on an empty bar is word for word the same for the owner (through its other mask), for a stranger, and for the character itself.
  said_owner := pg_temp.refusal(format('select pg_temp.heart(%L, %L, %L)', a1, 't-relief-one', b1));
  said_stranger := pg_temp.refusal(format('select pg_temp.heart(%L, %L, %L)', e1, 't-relief-one', b1));
  said_self := pg_temp.refusal(format('select pg_temp.heart(%L, %L, %L)', b1, 't-relief-one', b1));
  perform pg_temp.hand(b1, 't-relief-one', 1);
  said_self := pg_temp.refusal(format('select pg_temp.heart(%L, %L, %L)', b1, 't-relief-one', b1));
  if said_owner is distinct from '55000: this character''s warn bar is empty' or said_stranger is distinct from said_owner or said_self is distinct from said_owner then
    raise exception 'the refusal is the same for everyone: %, %, %', said_owner, said_stranger, said_self;
  end if;
  -- A banned caster plays nothing: not_banned says so, plainly.
  perform pg_temp.hand(bc, 't-relief-one', 1);
  ps := pg_temp.posts(bc, t, 2);
  ban := pg_temp.fill(bc, ps);
  said_owner := pg_temp.refusal(format('select pg_temp.heart(%L, %L, %L, 0, %L)', bc, 't-relief-one', a2, pa2));
  if said_owner not like '55000: this character is banned until %' then raise exception 'a banned caster is refused by not_banned, said %', said_owner; end if;
  -- A staff target is refused, and so is a staff caster, each before anything is spent or written.
  perform set_config('kayfabb.staff_writer', 'on', true);
  bp := tests.post(bot, t, 'Behave.');
  perform set_config('kayfabb.staff_writer', '', true);
  w0 := pg_temp.wallet(a1);
  said_owner := pg_temp.refusal(format('select pg_temp.heart(%L, %L, %L, 0, %L)', a1, 't-relief-one', bot, bp));
  if said_owner is distinct from '22023: Test Relief One lands on a player''s character' then raise exception 'a staff target is refused, said %', said_owner; end if;
  said_owner := pg_temp.refusal(format('select place_cast(%L, %L, %L, %L, %L, %L, %L, null, 0)', bot, 't-relief-one', a2, '{}', '', 'character', pa2));
  if said_owner is distinct from '42501: a staff character casts no card that has a discipline' then raise exception 'a staff caster is refused, said %', said_owner; end if;
  if card_held(ann, 't-relief-one') is distinct from 1 then raise exception 'a refusal spent a heart: %', card_held(ann, 't-relief-one'); end if;
end $$;

-- A ward on the character turns a heart away as it turns any cast.
do $$
declare
  t uuid := tests.thread('Dh ward');
  caster uuid := pg_temp.player('w-caster'); c uuid := pg_temp.player('w-target');
  i jsonb := pg_temp.inf(c, t, 'minor');
  warding uuid; why text;
begin
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, gimmick) values ('t-ward', 'Test Ward', 'sweet', 'uncommon', 'use', '{character}', interval '2 days', '{"kind": "ward", "upTo": "rare"}') on conflict (key) do nothing;
  perform pg_temp.hand(c, 't-ward', 1); perform pg_temp.hand(caster, 't-relief-one', 1);
  perform play_card(pg_temp.owner(c), 't-ward', c, c, '{}', 0, '', 'character', pg_temp.post_of(c));
  why := pg_temp.refusal(format('select pg_temp.heart(%L, %L, %L)', caster, 't-relief-one', c));
  if why not like '42501: this character''s Test Ward turns away cards up to rare' then raise exception 'a ward turns a heart away, said %', why; end if;
  if warn_points(c) is distinct from 2 or card_held(pg_temp.owner(caster), 't-relief-one') is distinct from 1 then raise exception 'a warded heart did nothing and cost nothing'; end if;
end $$;

-- ---- 7. Never set face down ----
do $$
declare
  t uuid := tests.thread('Dh face down');
  ann uuid := tests.account('dh-setter'); a uuid := tests.character(ann, 'Dh Setter');
  p uuid := tests.post(a, t, 'Words a back would sit under.');
  k text; why text;
begin
  foreach k in array array['t-relief-one', 't-relief-all', 't-unban', 't-fall', 't-watch'] loop
    insert into card_ledger (account, card, kind, price) values (ann, k, 'bought', 0);
    perform tests.become_service();
    why := pg_temp.refusal(format('select set_card(%L, %L, %L, %L, %L, 0)', ann, k, a, p, '{}'));
    perform tests.unbecome();
    if why is distinct from '22023: ' || (select name from card_kinds where key = k) || ' acts the moment it lands, so it is cast face up and never set face down' then
      raise exception 'a discipline card % was set face down, or refused in other words: %', k, why;
    end if;
    if exists (select 1 from face_down f where f.post = p and f.card = k) or card_held(ann, k) is distinct from 1 then raise exception 'a refused set of % left something behind', k; end if;
  end loop;
end $$;

-- ---- 8. The tables are append-only and no one's to read or write ----
do $$
declare
  played uuid; infr uuid; why text;
begin
  select play, infraction into played, infr from warn_reliefs limit 1;
  why := pg_temp.refusal(format('update warn_reliefs set points = 9 where play = %L', played));
  if why is null then raise exception 'warn_reliefs refuses UPDATE'; end if;
  why := pg_temp.refusal(format('delete from warn_reliefs where play = %L', played));
  if why is null then raise exception 'warn_reliefs refuses DELETE'; end if;
  why := pg_temp.refusal('truncate warn_reliefs');
  if why is null then raise exception 'warn_reliefs refuses TRUNCATE'; end if;
  why := pg_temp.refusal(format('insert into warn_reliefs (play, infraction, points) values (%L, %L, 0)', played, infr));
  if why is null then raise exception 'a relief takes at least a point'; end if;
  select play into played from ban_lifts limit 1;
  why := pg_temp.refusal(format('delete from ban_lifts where play = %L', played));
  if why is null then raise exception 'ban_lifts refuses DELETE'; end if;
  why := pg_temp.refusal(format('update ban_lifts set play = play where play = %L', played));
  if why is null then raise exception 'ban_lifts refuses UPDATE'; end if;
  why := pg_temp.refusal('truncate ban_lifts');
  if why is null then raise exception 'ban_lifts refuses TRUNCATE'; end if;
  -- The API roles read and write neither.
  perform tests.become((select id from auth.users limit 1));
  why := pg_temp.refusal('select count(*) from warn_reliefs');
  if why is null then raise exception 'a player reads warn_reliefs'; end if;
  why := pg_temp.refusal('select count(*) from ban_lifts');
  if why is null then raise exception 'a player reads ban_lifts'; end if;
  perform tests.unbecome();
end $$;

-- ---- 9. A heart's words and its rows are one read: payload `took` is the sum of its warn_reliefs rows, for every relief play this file made (the race's, the splits, the empties, the ended) ----
do $$
declare
  n integer; bad text;
begin
  select count(*), string_agg(a.id::text, ', ') filter (where (a.payload ->> 'took')::integer is distinct from coalesce((select sum(w.points) from warn_reliefs w where w.play = a.id), 0)) into n, bad
  from acts a where a.kind = 'card' and a.payload ? 'took';
  if n < 8 then raise exception 'the world holds the relief plays this check reads: %', n; end if;
  if bad is not null then raise exception 'a heart''s took is not the sum of its relief rows: %', bad; end if;
  -- And the walk's predicate is warn_points': for every character of this file, the bar is what live_infractions leaves.
  select string_agg(c.id::text, ', ') into bad from characters c
  where warn_points(c.id) is distinct from (select coalesce(sum(l.left_over), 0)::integer from live_infractions(c.id) l);
  if bad is not null then raise exception 'warn_points and the walk read different infractions: %', bad; end if;
end $$;
