-- The patrol's weighted draw (supabase/migrations/0362_patrol_weights.sql; docs/plans/2026-11-11-card-notes-part-5-plan.md, Task 5 and Decided in planning 11 to 13).
--
-- 1. watched_characters is a view of two columns (character, weight): the live watches on characters (a play at character reach whose card's discipline is a watch, not over by time and not
--    ended by an admin). The digest role reads it and nobody else does; a play that is no watch, or is not on a character, is not in it.
-- 2. patrol_sample(boards, most, pool, seed) draws `most` posts from the newest `pool` eligible posts on the beat, each weighted by its author's largest live watch, else 1. The draw follows the weights
--    (the statistical check below, with its own poison run inside this file), it is the same for the same seed, and a pool no larger than the sample returns every candidate whatever the weights.
-- 3. An ended watch (by time, or by an admin's reverse_card) weighs 1. The sample is returned newest first, so its order says nothing of a weight; staff posts and posts under a visit are left out
--    (0112-patrols.sql holds those cases).
-- 4. The doors: the new signature is the service's and the digest role's own; the old two-argument one is gone.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- ---- 0. The world: a watch card of this file's own, an admin, a board of forty threads with one post each by forty characters ----
do $$
declare
  general uuid;
  admin_acc uuid := tests.account('pw-admin');
  n integer;
  c uuid;
  t uuid;
begin
  -- A card of this file's own: a watch at weight 2 and one at weight 4, each up for a week, reaching a character alone.
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, discipline) values
    ('t-watch', 'Test Watch', 'salty', 'rare', 'cast', '{character}', interval '7 days', '{"kind": "watch", "weight": 2}'),
    ('t-watch-4', 'Test Watch Four', 'salty', 'rare', 'cast', '{character}', interval '7 days', '{"kind": "watch", "weight": 4}'),
    ('t-not-watch', 'Test Not A Watch', 'salty', 'rare', 'cast', '{character}', interval '7 days', null);
  insert into admins (account) values (admin_acc);
  insert into boards (slug, name) values ('pw-general', 'Pw General') returning id into general;
  for n in 1..40 loop
    c := tests.character(tests.account('pw-' || n), 'Pw ' || n);
    insert into threads (board, title) values (general, 'Pw thread ' || n) returning id into t;
    perform tests.post(c, t, 'Post ' || n, clock_timestamp() - interval '2 hours' + n * interval '1 minute');
  end loop;
end $$;

-- The watches of this file's characters only, so a watch another file committed is not read here. It reads the real view, so the poison below shows through it.
create view pg_temp.pw_watch as select w.character, w.weight from watched_characters w where w.character in (select id from characters where name like 'Pw %');

-- The check's measure: over `seeds` seeds, how many times the watched character's post is sampled against the mean of the other candidates' (the "others" being every other character of this file).
create function pg_temp.ratio(seeds integer, most integer, pool integer) returns numeric language sql as $$
  with picks as (
    select (x ->> 'act')::uuid as act
    from generate_series(1, seeds) s(seed)
    cross join lateral jsonb_array_elements(patrol_sample(array[(select id from boards where slug = 'pw-general')], most, pool, s.seed)) x
  ), by_author as (
    select a.character, count(*)::numeric as n from picks p join acts a on a.id = p.act group by a.character
  )
  select coalesce((select n from by_author where character = (select id from characters where name = 'Pw 1')), 0)
         / ((select coalesce(sum(n), 0) from by_author where character <> (select id from characters where name = 'Pw 1')) / 39)
$$;

-- ---- 1. The view: two columns, the digest role's alone, live watches on characters only ----
do $$
declare
  watcher uuid := (select id from characters where name = 'Pw 1');
  other uuid := (select id from characters where name = 'Pw 2');
  caster uuid := (select id from characters where name = 'Pw 3');
  t uuid := (select id from threads where title = 'Pw thread 3');
  p uuid := (select id from acts where kind = 'post' and payload ->> 'body' = 'Post 3');
  admin_acc uuid := (select id from auth.users where email = 'pw-admin@test.invalid');
  live uuid;
  worn uuid;
  ended uuid;
  not_watch uuid;
  on_post uuid;
  cols text;
  role text;
begin
  select string_agg(column_name, ', ' order by ordinal_position) into cols from information_schema.columns where table_name = 'watched_characters' and table_schema = 'public';
  if cols is distinct from 'character, weight' then raise exception 'watched_characters exposes % and not exactly character, weight', cols; end if;
  foreach role in array array['anon', 'authenticated', 'service_role'] loop
    if has_table_privilege(role, 'watched_characters', 'select') then raise exception '% reads watched_characters', role; end if;
  end loop;
  if not has_table_privilege('kayfabb_digest', 'watched_characters', 'select') then raise exception 'the digest role does not read watched_characters'; end if;
  if has_table_privilege('kayfabb_digest', 'watched_characters', 'insert,update,delete,truncate') then raise exception 'the digest role writes watched_characters'; end if;
  if exists (select 1 from pg_temp.pw_watch) then raise exception 'a watch is up before any was played'; end if;

  live := tests.act(caster, 'card', t, jsonb_build_object('card', 't-watch', 'reach', 'character', 'character', watcher, 'ends', now() + interval '7 days'), p);
  insert into play_reach (play, reach, character, ends_at) values (live, 'character', watcher, now() + interval '7 days');
  if (select array_agg(w.character || '=' || w.weight) from (select character::text as character, weight::text as weight from pg_temp.pw_watch) w) is distinct from array[watcher::text || '=2'] then
    raise exception 'the live watch is not the one row, at its weight: %', (select jsonb_agg(to_jsonb(w)) from pg_temp.pw_watch w);
  end if;

  -- A watch past its time, an admin-ended one, a card that is no watch, and a watch on a post are not in it.
  worn := tests.act(caster, 'card', t, jsonb_build_object('card', 't-watch', 'reach', 'character', 'character', other, 'ends', now() - interval '1 hour'), p, now() - interval '2 hours');
  insert into play_reach (play, reach, character, ends_at) values (worn, 'character', other, now() - interval '1 hour');
  not_watch := tests.act(caster, 'card', t, jsonb_build_object('card', 't-not-watch', 'reach', 'character', 'character', other, 'ends', now() + interval '7 days'), p);
  insert into play_reach (play, reach, character, ends_at) values (not_watch, 'character', other, now() + interval '7 days');
  on_post := tests.act(caster, 'card', t, jsonb_build_object('card', 't-watch', 'layer', 1), p);
  ended := tests.act(caster, 'card', t, jsonb_build_object('card', 't-watch-4', 'reach', 'character', 'character', other, 'ends', now() + interval '7 days'), p);
  insert into play_reach (play, reach, character, ends_at) values (ended, 'character', other, now() + interval '7 days');
  if (select count(*) from pg_temp.pw_watch where character = other) is distinct from 1 then
    raise exception 'the other character is watched by a play that is over by time, no watch or on a post, or the live one is missing: %', (select jsonb_agg(to_jsonb(w)) from pg_temp.pw_watch w);
  end if;
  perform tests.become(admin_acc);
  perform reverse_card(ended);
  perform tests.unbecome();
  if exists (select 1 from pg_temp.pw_watch where character = other) then raise exception 'a watch an admin ended still counts: %', (select jsonb_agg(to_jsonb(w)) from pg_temp.pw_watch w); end if;
  if (select count(*) from pg_temp.pw_watch) is distinct from 1 then raise exception 'something other than the one live watch is in the view'; end if;
end $$;

-- ---- 2. The sample: newest first, the same for the same seed, every candidate when the pool is no larger than the sample ----
do $$
declare
  general uuid := (select id from boards where slug = 'pw-general');
  got jsonb;
  again jsonb;
  newest uuid[];
  seen uuid[];
  n integer;
  differs boolean := false;
begin
  -- The pool is the newest `pool` posts; with the sample as large as the pool, every candidate is returned, whatever the weights.
  newest := (select array_agg(a.id order by a.created_at desc, a.id desc) from (select id, created_at from acts where kind = 'post' and thread in (select id from threads where board = general) order by created_at desc, id desc limit 10) a);
  got := patrol_sample(array[general], 10, 10, 7);
  if (select array_agg((x ->> 'act')::uuid order by ord) from jsonb_array_elements(got) with ordinality t(x, ord)) is distinct from newest then
    raise exception 'a pool no larger than the sample did not return every candidate, newest first, with a watch up: %', got;
  end if;
  got := patrol_sample(array[general], 15, 10, 7);
  if jsonb_array_length(got) is distinct from 10 then raise exception 'a sample larger than its pool returned % posts and not the pool''s 10', jsonb_array_length(got); end if;

  -- A smaller sample is newest first, whatever drew it.
  for n in 1..30 loop
    got := patrol_sample(array[general], 8, 40, n);
    if jsonb_array_length(got) is distinct from 8 then raise exception 'the sample is not cut to most: %', jsonb_array_length(got); end if;
    if (select array_agg((x ->> 'act')::uuid order by ord) from jsonb_array_elements(got) with ordinality t(x, ord))
       is distinct from (select array_agg(a.id order by a.created_at desc, a.id desc) from acts a where a.id in (select (x ->> 'act')::uuid from jsonb_array_elements(got) x)) then
      raise exception 'the sample is not newest first (an order that would tell a weight): %', got;
    end if;
    again := patrol_sample(array[general], 8, 40, n);
    if again is distinct from got then raise exception 'the same seed drew a different sample'; end if;
    if got is distinct from patrol_sample(array[general], 8, 40, n::bigint) then raise exception 'the seed is read differently by type'; end if;
    if n > 1 and got is distinct from patrol_sample(array[general], 8, 40, n - 1) then differs := true; end if;
  end loop;
  if not differs then raise exception 'thirty seeds drew one sample: the seed is not read'; end if;

  -- A pool of zero or less, and a sample of zero, read nothing; no boards, no sample.
  if patrol_sample(array[general], 5, 0, 1) is distinct from '[]'::jsonb then raise exception 'a pool of zero gave a sample'; end if;
  if patrol_sample(array[general], 0, 5, 1) is distinct from '[]'::jsonb then raise exception 'a sample of zero gave posts'; end if;
  if patrol_sample('{}'::uuid[], 5, 20, 1) is distinct from '[]'::jsonb then raise exception 'no boards gave a sample'; end if;
  -- The shape is today's: the same seven keys.
  if (select string_agg(k, ',' order by k) from jsonb_object_keys(patrol_sample(array[general], 1, 5, 1) -> 0) k) is distinct from 'act,board,body,name,pronouns,thread,title' then
    raise exception 'the sampled post has another shape: %', patrol_sample(array[general], 1, 5, 1) -> 0;
  end if;
end $$;

-- ---- 3. The draw follows the weights (4000 seeds, so the margin over 1.5 is far outside the noise of the true ratio, about 1.75): the watched character's post is sampled at least 1.5 times as often as the mean of the others' ----
do $$
declare
  r numeric;
begin
  r := pg_temp.ratio(4000, 10, 40);
  if coalesce(r, 0) < 1.5 then raise exception 'a watched character (weight 2) was sampled % times as often as the mean of the others, not 1.5 or more', round(r, 2); end if;
  raise notice 'the watched character was sampled % times as often as the mean of the others', round(r, 2);
end $$;

-- The poison, run in this file every time: the same measure against a watched_characters whose weight is forced to 1 (the change is a savepoint's, undone by the raise) must be below that margin.
-- The check above would fail on it, so the measure is known to tell a weighted draw from an unweighted one.
do $$
declare
  r numeric;
begin
  begin
    create or replace view watched_characters as
      select p.character, 1::numeric as weight from play_reach p where p.reach = 'character' and p.ends_at > now();
    r := pg_temp.ratio(1000, 10, 40);
    if coalesce(r, 99) >= 1.5 then raise exception 'the poisoned measure (weights forced to 1) still read % times, so the check above cannot tell a weighted draw', round(r, 2); end if;
    raise exception using errcode = 'P0001', message = 'poison-undone';
  exception when raise_exception then
    if sqlerrm is distinct from 'poison-undone' then raise; end if;
  end;
  if (select count(*) from pg_temp.pw_watch) is distinct from 1 then raise exception 'the poison was not undone'; end if;
  if (select weight from pg_temp.pw_watch) is distinct from 2::numeric then raise exception 'the poison was not undone: the weight is forced'; end if;
end $$;

-- ---- 4. An ended watch weighs 1: past its time, and ended by an admin ----
do $$
declare
  watcher uuid := (select id from characters where name = 'Pw 1');
  caster uuid := (select id from characters where name = 'Pw 3');
  t uuid := (select id from threads where title = 'Pw thread 3');
  p uuid := (select id from acts where kind = 'post' and payload ->> 'body' = 'Post 3');
  admin_acc uuid := (select id from auth.users where email = 'pw-admin@test.invalid');
  live uuid := (select a.id from acts a join play_reach r on r.play = a.id where r.character = watcher and a.payload ->> 'card' = 't-watch');
  r numeric;
begin
  perform tests.become(admin_acc);
  perform reverse_card(live);
  perform tests.unbecome();
  if exists (select 1 from pg_temp.pw_watch) then raise exception 'an admin-ended watch is still watched'; end if;
  r := pg_temp.ratio(1000, 10, 40);
  if coalesce(r, 99) >= 1.5 then raise exception 'an admin-ended watch still drew % times as often', round(r, 2); end if;
  -- One that runs out of time on its own.
  declare
    worn uuid := tests.act(caster, 'card', t, jsonb_build_object('card', 't-watch', 'reach', 'character', 'character', watcher, 'ends', now() - interval '1 minute'), p, now() - interval '2 hours');
  begin
    insert into play_reach (play, reach, character, ends_at) values (worn, 'character', watcher, now() - interval '1 minute');
  end;
  if exists (select 1 from pg_temp.pw_watch) then raise exception 'a watch past its time is still watched'; end if;
  r := pg_temp.ratio(1000, 10, 40);
  if coalesce(r, 99) >= 1.5 then raise exception 'a watch past its time still drew % times as often', round(r, 2); end if;
end $$;

-- ---- 5. The doors: the new signature is the service's and the digest role's own; the old one is gone ----
do $$
begin
  if to_regprocedure('patrol_sample(uuid[], integer)') is not null then raise exception 'the two-argument patrol_sample is still there'; end if;
  if has_function_privilege('anon', 'patrol_sample(uuid[], integer, integer, bigint)', 'execute') or has_function_privilege('authenticated', 'patrol_sample(uuid[], integer, integer, bigint)', 'execute') then
    raise exception 'patrol_sample is a client''s';
  end if;
  if not has_function_privilege('service_role', 'patrol_sample(uuid[], integer, integer, bigint)', 'execute') then raise exception 'patrol_sample is not the service''s'; end if;
  if (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'patrol_sample(uuid[], integer, integer, bigint)'::regprocedure) is distinct from 'kayfabb_digest' then
    raise exception 'patrol_sample is not owned by the digest role';
  end if;
  if has_schema_privilege('kayfabb_digest', 'public', 'create') then raise exception 'the owner change left the digest role able to create in public'; end if;
end $$;

-- ---- 6. The view and card_ended agree, play by play ----
-- watched_characters repeats card_ended's two tests (an admin's card_end, a refunded write) because the digest role may not call the function, and a function a view calls runs with the reader's
-- privileges. Nothing else holds the two together, so this does: for every play at character reach in this file's world, the view names its character exactly when the play's card is a watch,
-- is not over by time, and card_ended says it is not over. One character for each case, so membership in the view is that play's alone. If card_ended gains a test and the view does not, a case here goes red.
do $$
declare
  caster uuid := (select id from characters where name = 'Pw 3');
  t uuid := (select id from threads where title = 'Pw thread 3');
  p uuid := (select id from acts where kind = 'post' and payload ->> 'body' = 'Post 3');
  admin_acc uuid := (select id from auth.users where email = 'pw-admin@test.invalid');
  c_live uuid := (select id from characters where name = 'Pw 11');
  c_time uuid := (select id from characters where name = 'Pw 12');
  c_admin uuid := (select id from characters where name = 'Pw 13');
  c_refund uuid := (select id from characters where name = 'Pw 14');
  c_plain uuid := (select id from characters where name = 'Pw 15');
  pl uuid;
  r record;
  kinds text[] := '{}';
  k text;
  expected boolean;
  actual boolean;
begin
  create temp table pw_case (play uuid primary key, kind text not null) on commit drop;
  -- live watch
  pl := tests.act(caster, 'card', t, jsonb_build_object('card', 't-watch', 'reach', 'character', 'character', c_live, 'ends', now() + interval '7 days'), p);
  insert into play_reach (play, reach, character, ends_at) values (pl, 'character', c_live, now() + interval '7 days');
  insert into pw_case values (pl, 'live watch');
  -- watch over by time
  pl := tests.act(caster, 'card', t, jsonb_build_object('card', 't-watch', 'reach', 'character', 'character', c_time, 'ends', now() - interval '1 hour'), p, now() - interval '2 hours');
  insert into play_reach (play, reach, character, ends_at) values (pl, 'character', c_time, now() - interval '1 hour');
  insert into pw_case values (pl, 'watch over by time');
  -- watch an admin ended
  pl := tests.act(caster, 'card', t, jsonb_build_object('card', 't-watch', 'reach', 'character', 'character', c_admin, 'ends', now() + interval '7 days'), p);
  insert into play_reach (play, reach, character, ends_at) values (pl, 'character', c_admin, now() + interval '7 days');
  insert into pw_case values (pl, 'admin-ended watch');
  perform tests.become(admin_acc);
  perform reverse_card(pl);
  perform tests.unbecome();
  -- watch whose write was refunded (a card_write_refunds row, one for each play, as a failed first generation leaves it; no payer, so no amount)
  pl := tests.act(caster, 'card', t, jsonb_build_object('card', 't-watch', 'reach', 'character', 'character', c_refund, 'ends', now() + interval '7 days'), p);
  insert into play_reach (play, reach, character, ends_at) values (pl, 'character', c_refund, now() + interval '7 days');
  insert into card_write_refunds (play, amount) values (pl, null);
  insert into pw_case values (pl, 'refunded watch');
  -- a character play that is no watch
  pl := tests.act(caster, 'card', t, jsonb_build_object('card', 't-not-watch', 'reach', 'character', 'character', c_plain, 'ends', now() + interval '7 days'), p);
  insert into play_reach (play, reach, character, ends_at) values (pl, 'character', c_plain, now() + interval '7 days');
  insert into pw_case values (pl, 'non-watch character play');

  for r in
    select pr.play, pr.character, pr.ends_at, coalesce(pc.kind, 'earlier play in this file') as kind,
           coalesce(k.discipline ->> 'kind' = 'watch', false) as is_watch
    from play_reach pr
    join acts a on a.id = pr.play
    join card_kinds k on k.key = a.payload ->> 'card'
    left join pw_case pc on pc.play = pr.play
    where pr.reach = 'character' and pr.character in (select id from characters where name like 'Pw %')
  loop
    expected := r.is_watch and r.ends_at > now() and not card_ended(r.play);
    actual := exists (select 1 from watched_characters w where w.character = r.character);
    if actual is distinct from expected then
      raise exception 'watched_characters and card_ended disagree on the % (play %): the view says %, the card is a watch that is up says %', r.kind, r.play, actual, expected;
    end if;
    kinds := kinds || r.kind;
  end loop;
  foreach k in array array['live watch', 'watch over by time', 'admin-ended watch', 'refunded watch', 'non-watch character play'] loop
    if not (k = any (kinds)) then raise exception 'the guard has no % to compare', k; end if;
  end loop;
  if not exists (select 1 from pg_temp.pw_watch where character = c_live) or exists (select 1 from pg_temp.pw_watch where character in (c_time, c_admin, c_refund, c_plain)) then
    raise exception 'the guard''s own cases are not the one live watch and four that are not: %', (select jsonb_agg(to_jsonb(w)) from pg_temp.pw_watch w);
  end if;
end $$;
