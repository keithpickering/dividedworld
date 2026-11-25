-- Chattier staff, the database (supabase/migrations/0415_chattier_staff.sql; docs/plans/2026-11-22-chattier-staff-plan.md, Task 4; the design's sections 2, 3, 4 and 7).
-- The six tables are append-only and no client's; the day's sessions are written once and read open at [start, end); a persona's waiting replies are a player's public replies to its posts, not a staff
-- character's, not older than `since`, not answered, not in a locked-out thread, read through the target index (an explain on a seeded large table); a turn is one transaction (the post, the turn, the answers) and refuses,
-- writing nothing, a closed session, another persona's, a quote outside the answers and an answered reply; the conversation and the record are bounded; presence lists a persona in session on its threads and in the
-- index and not once the session ends; and no function this migration creates reads an account, a reactor's account, an owner or a class (a check over `pg_proc.prosrc`, driven red on a planted function).

do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('Landed: {move}.'),
        'bossFarewell', jsonb_build_array('Farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.'))),
    'classes', '[]'::jsonb,
    'boards', jsonb_build_array(jsonb_build_object('slug', 'side', 'name', 'Side', 'description', 'Off to one side.')),
    'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Cs Gabe', 'title', 'Made this.', 'avatar', 'gabe'),
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'cs-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'cs-boss', 'name', 'Cs Boss', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'cs-mod', 'name', 'Cs Mod', 'title', 'Mod', 'signature', 'b'),
        jsonb_build_object('key', 'cs-late', 'name', 'Cs Late', 'title', 'Mod', 'signature', 'c'),
        jsonb_build_object('key', 'cs-bench', 'name', 'Cs Bench', 'title', 'Bench', 'signature', 'd'),
        jsonb_build_object('key', 'cs-wait', 'name', 'Cs Wait', 'title', 'Waiting', 'signature', 'e')),
      'firstStaff', jsonb_build_array('cs-mod', 'cs-late'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')))));
  update characters set debuted_at = now() where staff = 'cs-bench';
  insert into staff_offices (staff, office, cause) values ('cs-bench', 'benched', 'admin');
end $$;

create function pg_temp.refused(stmt text) returns text language plpgsql as $$
begin execute stmt; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create function pg_temp.staff_post(k text, in_thread uuid, body text, target uuid default null) returns uuid language sql as $$
  select (write_staff_act(k, 'post', in_thread, target, jsonb_build_object('body', body)) ->> 'id')::uuid
$$;
-- Today in UTC. A day's sessions are written as the draw writes them: [{staff, start, end}], minutes from 00:00 UTC.
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'UTC')::date $$;

-- ---- The tables: append-only, firing always, row-level security on, and no client's ----
do $$
declare
  t text; said text; who text; n bigint; sid bigint;
  tt uuid := tests.thread('Tables');
  ann uuid := tests.account('cs-tables-ann');
  a uuid := tests.character(ann, 'Cs Tables Ann');
  p uuid := pg_temp.staff_post('cs-boss', tt, 'A post for the tables.');
  r uuid := tests.act(a, 'post', tt, '{"body": "A reply."}', p);
begin
  perform tests.become_service();
  perform write_sessions(pg_temp.today(), '[{"staff": "cs-boss", "start": 0, "end": 1440}]');
  perform keep_pick('2030-02-01', 'cs-boss', '{"trigger": "named"}');
  perform claim_pool_round('2030-02-01 10:00+00');
  sid := (select id from staff_sessions where staff = 'cs-boss' and day = pg_temp.today());
  perform write_staff_turn('cs-boss', sid, tt, r, array[r], 'A turn.', 0);
  perform tests.unbecome();
  insert into meetings (started_at, finished_at, outcome, slot) values (now() - interval '1 day', now() - interval '1 day', 'ok', now() - interval '1 day');
  insert into staff_points (meeting, staff, line) select max(id), 'cs-boss', 'A line.' from meetings;
  foreach t in array array['staff_sessions', 'pool_kept_picks', 'pool_turns', 'pool_answered', 'staff_points', 'pool_round_claims', 'pool_round_days'] loop
    if (select count(*) from pg_trigger g where g.tgrelid = ('public.' || t)::regclass and g.tgname in (t || '_no_update', t || '_no_truncate') and g.tgenabled = 'A') is distinct from 2 then
      raise exception '%''s append-only triggers must fire always', t;
    end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || t)::regclass) then raise exception '% has no row-level security', t; end if;
    execute format('select count(*) from %I', t) into n;
    if n is distinct from 1 then raise exception '% holds % rows, not the 1 this test wrote', t, n; end if;
    said := pg_temp.refused(format('update %I set %I = %I', t, case t when 'pool_answered' then 'turn' when 'staff_points' then 'line' when 'pool_round_claims' then 'slot' else 'day' end,
                                   case t when 'pool_answered' then 'turn' when 'staff_points' then 'line' when 'pool_round_claims' then 'slot' else 'day' end));
    if said is null or said !~ '^P0001' then raise exception '% was updated: %', t, said; end if;
    said := pg_temp.refused(format('delete from %I', t));
    if said is null or said !~ '^P0001' then raise exception '% was deleted from: %', t, said; end if;
    said := pg_temp.refused(format('truncate %I cascade', t));
    if said is null or said !~ '^P0001' then raise exception '% was truncated: %', t, said; end if;
    foreach who in array array['anon', 'authenticated'] loop
      perform set_config('role', who, true);
      said := pg_temp.refused(format('select count(*) from %I', t));
      perform tests.unbecome();
      if said is null or said !~ '^42501' then raise exception '% can read %: %', who, t, said; end if;
    end loop;
  end loop;
  -- The unique keys are the tables' own.
  said := pg_temp.refused(format('insert into pool_kept_picks (day, staff, pick) values (%L, %L, %L)', '2030-02-01', 'cs-boss', '{}'));
  if said is null or said !~ '^23505' then raise exception 'a second kept pick for a day and a persona was taken: %', said; end if;
  said := pg_temp.refused(format('insert into pool_answered (reply, turn) values (%L, %L)', r, (select id from pool_turns)));
  if said is null or said !~ '^23505' then raise exception 'a reply was answered twice: %', said; end if;
  said := pg_temp.refused(format('insert into staff_points (meeting, staff, line) select max(id), %L, %L from meetings', 'cs-boss', 'Another.'));
  if said is null or said !~ '^23505' then raise exception 'a second talking point for a meeting and a persona was taken: %', said; end if;
  said := pg_temp.refused(format('insert into staff_points (meeting, staff, line) select max(id), %L, %L from meetings', 'cs-mod', repeat('x', 201)));
  if said is null or said !~ '^23514' then raise exception 'a talking point of 201 characters was taken: %', said; end if;
  said := pg_temp.refused(format('insert into staff_sessions (day, staff, starts_at, ends_at) values (%L, %L, %L, %L)', '2030-02-01', 'cs-boss', '2030-02-01 10:00+00', '2030-02-01 10:00+00'));
  if said is null or said !~ '^23514' then raise exception 'a session that ends when it starts was taken: %', said; end if;
end $$;

-- ---- No client reaches the doors ----
do $$
declare
  who text; denied boolean; fn text;
begin
  foreach who in array array['anon', 'authenticated'] loop
    foreach fn in array array['select claim_pool_round(now())', 'select write_sessions(''2030-02-01'', ''[]'')', 'select sessions_awake(now())', 'select sessions_day(''2030-02-01'')', 'select pool_day_started(''2030-02-01'')',
      'select keep_pick(''2030-02-01'', ''cs-boss'', ''{}'')', 'select kept_picks(''2030-02-01'')', 'select pool_waiting(array[''cs-boss''], now())',
      'select count(*) from pool_waiting_rows(array[''cs-boss''], now())', 'select pool_turns_today(''2030-02-01'')',
      'select write_staff_turn(''cs-boss'', 1, gen_random_uuid(), gen_random_uuid(), array[gen_random_uuid()], ''x'', 0)',
      'select pool_conversation(''cs-boss'', gen_random_uuid(), 1, 1, 1)', 'select pool_record(gen_random_uuid(), ''cs-boss'')', 'select staff_points_latest(''cs-boss'')'] loop
      perform set_config('role', who, true);
      denied := false;
      begin execute fn; exception when insufficient_privilege then denied := true; end;
      perform tests.unbecome();
      if not denied then raise exception '% can call %', who, fn; end if;
    end loop;
  end loop;
  -- A signed-in player still reaches the box, which the view feeds.
  perform set_config('role', 'authenticated', true);
  perform presence_box('index', null);
  perform tests.unbecome();
end $$;

-- ---- The round's claim: one of a slot, and the way out is time ----
do $$
declare first uuid; again uuid; other uuid;
begin
  perform tests.become_service();
  first := claim_pool_round('2030-03-01 10:15+00');
  again := claim_pool_round('2030-03-01 10:15+00');
  other := claim_pool_round('2030-03-01 10:30+00');
  if first is null then raise exception 'the first claim of a slot was refused'; end if;
  if again is not null then raise exception 'a second claim of a slot inside its lease was let in'; end if;
  if other is null then raise exception 'another slot''s claim was refused'; end if;
  -- A claim aged past its lease is no claim (the crashed round's way out).
  if claim_pool_round('2030-03-01 10:15+00', interval '0 seconds') is null then raise exception 'a claim older than its lease still held the slot'; end if;
  perform tests.unbecome();
end $$;

-- ---- The day's sessions: written once; awake at [start, end) ----
do $$
declare n integer; said text; awake jsonb;
begin
  perform tests.become_service();
  n := write_sessions('2030-01-07', '[{"staff": "cs-boss", "start": 600, "end": 660}, {"staff": "cs-mod", "start": 720, "end": 780}]');
  if n is distinct from 2 then raise exception 'the day holds % sessions, not 2', n; end if;
  -- The poison: the same day written again holds the same two.
  n := write_sessions('2030-01-07', '[{"staff": "cs-boss", "start": 600, "end": 660}, {"staff": "cs-mod", "start": 720, "end": 780}]');
  if n is distinct from 2 then raise exception 'writing the day twice made it hold % sessions', n; end if;
  if (select count(*) from staff_sessions where day = '2030-01-07') is distinct from 2 then raise exception 'writing the day twice wrote rows twice'; end if;
  -- The day is marked started by the write, once however many times it is written, and a day written with no rows is marked too (a day on which no persona keeps a session).
  if pool_day_started('2030-01-07') is not true then raise exception 'a day with its sessions written is not marked started'; end if;
  if (select count(*) from pool_round_days where day = '2030-01-07') is distinct from 1 then raise exception 'writing the day twice marked it more than once'; end if;
  if pool_day_started('2030-01-09') is not false then raise exception 'a day nothing was written for is marked started'; end if;
  n := write_sessions('2030-01-09', '[]');
  if n is distinct from 0 or pool_day_started('2030-01-09') is not true then raise exception 'a day written with no rows is not marked started (%)', n; end if;
  n := write_sessions('2030-01-09', '[]');
  if (select count(*) from pool_round_days where day = '2030-01-09') is distinct from 1 then raise exception 'writing the empty day twice marked it more than once'; end if;
  -- A write with mark false writes the sessions and leaves the day unmarked; a later write marks it, and the sessions are not written twice.
  n := write_sessions('2030-01-12', '[{"staff": "cs-boss", "start": 600, "end": 660}]', false);
  if n is distinct from 1 or pool_day_started('2030-01-12') then raise exception 'a write with mark false marked the day (%)', n; end if;
  n := write_sessions('2030-01-12', '[{"staff": "cs-boss", "start": 600, "end": 660}]');
  if n is distinct from 1 or pool_day_started('2030-01-12') is not true then raise exception 'the closing write did not mark the day (%)', n; end if;
  -- A refused write marks nothing.
  perform pg_temp.refused('select write_sessions(''2030-01-11'', ''[{"staff": "nobody", "start": 0, "end": 15}]'')');
  if pool_day_started('2030-01-11') then raise exception 'a refused write marked the day'; end if;
  -- A second visit of the same persona the same day is another session.
  n := write_sessions('2030-01-07', '[{"staff": "cs-boss", "start": 900, "end": 915}]');
  if n is distinct from 3 then raise exception 'a second session of a persona was not written: %', n; end if;
  said := pg_temp.refused('select write_sessions(''2030-01-08'', ''[{"staff": "nobody", "start": 0, "end": 15}]'')');
  if said is null or said !~ '^P0002' then raise exception 'a session for a key that is no persona was written: %', said; end if;
  said := pg_temp.refused('select write_sessions(''2030-01-08'', ''[{"staff": "cs-boss", "start": 1430, "end": 1450}]'')');
  if said is null or said !~ '^22023' then raise exception 'a session that crosses midnight was written: %', said; end if;
  said := pg_temp.refused('select write_sessions(''2030-01-08'', ''[{"staff": "cs-boss", "start": 60, "end": 60}]'')');
  if said is null or said !~ '^22023' then raise exception 'an empty session was written: %', said; end if;
  said := pg_temp.refused('select write_sessions(''2030-01-08'', ''{"staff": "cs-boss"}'')');
  if said is null or said !~ '^22023' then raise exception 'sessions that are no list were written: %', said; end if;
  if (select count(*) from staff_sessions where day = '2030-01-08') is distinct from 0 then raise exception 'a refused day left rows behind'; end if;
  -- A benched persona and one that has not debuted post nothing, so they keep no sessions.
  said := pg_temp.refused('select write_sessions(''2030-01-08'', ''[{"staff": "cs-bench", "start": 0, "end": 15}]'')');
  if said is null or said !~ '^55000' then raise exception 'a session for a benched persona was written: %', said; end if;
  said := pg_temp.refused('select write_sessions(''2030-01-08'', ''[{"staff": "cs-wait", "start": 0, "end": 15}]'')');
  if said is null or said !~ '^55000' then raise exception 'a session for a waiting persona was written: %', said; end if;
  if (select count(*) from staff_sessions where day = '2030-01-08') is distinct from 0 then raise exception 'a refused day left rows behind'; end if;
  -- The developer is no persona that posts.
  said := pg_temp.refused(format('select write_sessions(''2030-01-08'', %L)', jsonb_build_array(jsonb_build_object('staff', (select staff from characters where staff_kind = 'developer'), 'start', 0, 'end', 15))));
  if said is null or said !~ '^P0002' then raise exception 'a session for the developer was written: %', said; end if;
  -- Awake: at the start and one second before the end; not at the end, nor a second before the start.
  awake := sessions_awake('2030-01-07 10:00:00+00');
  if jsonb_array_length(awake) is distinct from 1 or awake -> 0 ->> 'staff' is distinct from 'cs-boss' then raise exception 'at a session''s start: %', awake; end if;
  if jsonb_typeof(awake -> 0 -> 'session') is distinct from 'number' or (awake -> 0 -> 'spent')::int is distinct from 0 or awake -> 0 -> 'spentByThread' is distinct from '{}'::jsonb then
    raise exception 'an awake session''s shape: %', awake;
  end if;
  if jsonb_array_length(sessions_awake('2030-01-07 10:59:59+00')) is distinct from 1 then raise exception 'one second before a session''s end it is not awake'; end if;
  if jsonb_array_length(sessions_awake('2030-01-07 11:00:00+00')) is distinct from 0 then raise exception 'at a session''s end it is still awake'; end if;
  if jsonb_array_length(sessions_awake('2030-01-07 09:59:59+00')) is distinct from 0 then raise exception 'before a session''s start it is awake'; end if;
  awake := sessions_awake('2030-01-07 12:30:00+00');
  if jsonb_array_length(awake) is distinct from 1 or awake -> 0 ->> 'staff' is distinct from 'cs-mod' then raise exception 'another persona''s session was not read: %', awake; end if;
  -- The day's sessions, for the picks.
  awake := sessions_day('2030-01-07');
  if jsonb_array_length(awake) is distinct from 3 or awake -> 0 ->> 'staff' is distinct from 'cs-boss' or awake -> 0 ->> 'startsAt' not like '2030-01-07T10:00:00%' then
    raise exception 'the day''s sessions: %', awake;
  end if;
  if sessions_day('2030-01-09') is distinct from '[]'::jsonb then raise exception 'a day with no sessions has some'; end if;
  perform tests.unbecome();
end $$;

-- ---- Kept picks: kept once, listed until written ----
do $$
declare t uuid := tests.thread('Picks'); p uuid := pg_temp.staff_post('cs-boss', t, 'The pick.'); k jsonb; said text;
begin
  perform tests.become_service();
  perform keep_pick('2030-01-09', 'cs-boss', '{"trigger": "named", "n": 1}');
  perform keep_pick('2030-01-09', 'cs-boss', '{"trigger": "quoted", "n": 2}');
  perform keep_pick('2030-01-09', 'cs-mod', '{"trigger": "oldFlame"}');
  k := kept_picks('2030-01-09');
  if jsonb_array_length(k) is distinct from 2 or k -> 0 ->> 'staff' is distinct from 'cs-boss' or k -> 0 -> 'pick' ->> 'n' is distinct from '1' then raise exception 'the first keep is the day''s: %', k; end if;
  perform record_pool_spend('2030-01-09', 'cs-boss', 'named', p, null, false, '{}', 0);
  k := kept_picks('2030-01-09');
  if jsonb_array_length(k) is distinct from 1 or k -> 0 ->> 'staff' is distinct from 'cs-mod' then raise exception 'a written pick is still listed: %', k; end if;
  if kept_picks('2030-01-10') is distinct from '[]'::jsonb then raise exception 'another day lists picks'; end if;
  said := pg_temp.refused('select keep_pick(''2030-01-09'', ''nobody'', ''{}'')');
  if said is null or said !~ '^P0002' then raise exception 'a pick was kept for no one: %', said; end if;
  perform tests.unbecome();
end $$;

-- ---- The waiting replies: a player's public reply to a persona's post, and nothing else ----
do $$
declare
  t uuid := tests.thread('Waiting');
  t2 uuid := tests.thread('Locked');
  ann uuid := tests.account('cs-w-ann'); a uuid := tests.character(ann, 'Cs W Ann');
  bob uuid := tests.account('cs-w-bob'); b uuid := tests.character(bob, 'Cs W Bob');
  boss uuid := (select id from characters where staff = 'cs-boss');
  p uuid; p2 uuid; a1 uuid; a2 uuid; a3 uuid; old uuid; s1 uuid; l1 uuid; lp uuid; sset uuid; veiled uuid; vplay uuid;
  w jsonb; since timestamptz := now() - interval '2 days';
begin
  p := pg_temp.staff_post('cs-boss', t, 'The boss speaks.');
  p2 := pg_temp.staff_post('cs-mod', t, 'The mod speaks.');
  old := tests.act(a, 'post', t, '{"body": "A stale reply."}', p, now() - interval '3 days');
  a1 := tests.act(a, 'post', t, '{"body": "Ann answers."}', p, now() - interval '2 hours');
  a2 := tests.act(b, 'post', t, '{"body": "Bob answers."}', p, now() - interval '1 hour');
  s1 := pg_temp.staff_post('cs-mod', t, 'A colleague answers.', p);
  a3 := tests.act(a, 'post', t, '{"body": "Ann answers the mod."}', p2);
  -- A reply under a live author veil shows as the stand-in's, so it names no one and is not waiting.
  veiled := tests.act(b, 'post', t, '{"body": "Bob, veiled."}', p, now() - interval '30 minutes');
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, stack) values ('cswveil', 'Csw Veil', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'author', 1) on conflict (key) do nothing;
  vplay := tests.act(a, 'card', t, '{"card": "cswveil", "reach": "post"}', veiled);
  insert into post_veils (play, post, veil, author, caster_account, ends_at, post_kind) values (vplay, veiled, 'author', b, bob, now() + interval '1 day', 'post');
  -- (its cover row is kept by the table's own trigger)
  -- A thread the boss is locked out of: a reply there is not waiting.
  lp := pg_temp.staff_post('cs-boss', t2, 'A locked thread.');
  l1 := tests.act(a, 'post', t2, '{"body": "Ann in the locked thread."}', lp);
  perform set_config('kayfabb.staff_writer', 'on', true);
  sset := tests.act(boss, 'set', t2, '{}', lp);
  perform tests.act(boss, 'spring', t2, jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'lockedOut', 'set', sset::text, 'locks', boss::text, 'until', (now() + interval '1 day')::text), lp);
  perform set_config('kayfabb.staff_writer', '', true);

  perform tests.become_service();
  w := pool_waiting(array['cs-boss', 'cs-mod'], since);
  -- The boss has two waiting replies in the first thread, newest last; the mod has one (Ann's); the stale one, the colleague's and the locked thread's are not waiting.
  if jsonb_array_length(w) is distinct from 2 then raise exception 'waiting replies by persona and thread: %', w; end if;
  if w -> 0 ->> 'staff' is distinct from 'cs-boss' or w -> 0 ->> 'thread' is distinct from t::text or jsonb_array_length(w -> 0 -> 'replies') is distinct from 2 then raise exception 'the boss''s waiting replies: %', w; end if;
  if w -> 0 -> 'replies' -> 0 ->> 'act' is distinct from a1::text or w -> 0 -> 'replies' -> 1 ->> 'act' is distinct from a2::text then raise exception 'replies are not newest last: %', w; end if;
  if w -> 0 -> 'replies' -> 0 ->> 'author' is distinct from a::text or w -> 0 -> 'replies' -> 1 ->> 'author' is distinct from b::text then raise exception 'a reply''s author is its character: %', w; end if;
  if jsonb_typeof(w -> 0 -> 'heat') is distinct from 'number' or (w -> 0 ->> 'heat')::numeric is distinct from 0 then raise exception 'a thread with no turns has no heat: %', w; end if;
  if (w -> 0 -> 'replies' -> 0 ->> 'at')::timestamptz is distinct from (select created_at from acts where id = a1) then raise exception 'a reply''s time is its own: %', w; end if;
  if w -> 1 ->> 'staff' is distinct from 'cs-mod' or w -> 1 -> 'replies' -> 0 ->> 'act' is distinct from a3::text then raise exception 'the mod''s waiting reply: %', w; end if;
  if exists (select 1 from jsonb_array_elements(w) e, jsonb_array_elements(e -> 'replies') r where r ->> 'act' in (old::text, s1::text, l1::text, veiled::text)) then raise exception 'a stale, a staff, a veiled or a locked-out reply is waiting: %', w; end if;
  -- Narrowed to one persona; and `since` cuts what is older.
  if jsonb_array_length(pool_waiting(array['cs-mod'], since)) is distinct from 1 then raise exception 'one persona''s read lists others'; end if;
  w := pool_waiting(array['cs-boss'], now() - interval '90 minutes');
  if jsonb_array_length(w) is distinct from 1 or jsonb_array_length(w -> 0 -> 'replies') is distinct from 1 or w -> 0 -> 'replies' -> 0 ->> 'act' is distinct from a2::text then raise exception 'since cuts the older reply: %', w; end if;
  if pool_waiting(array['nobody'], since) is distinct from '[]'::jsonb then raise exception 'no persona, waiting replies'; end if;
  perform tests.unbecome();
end $$;

-- ---- A turn: the post, the turn and the answers in one transaction; its refusals write nothing ----
do $$
declare
  t uuid := tests.thread('Turn');
  t2 uuid := tests.thread('Turn locked');
  ann uuid := tests.account('cs-t-ann'); a uuid := tests.character(ann, 'Cs T Ann');
  bob uuid := tests.account('cs-t-bob'); b uuid := tests.character(bob, 'Cs T Bob');
  boss uuid := (select id from characters where staff = 'cs-boss');
  p uuid; pm uuid; a1 uuid; a2 uuid; a3 uuid; a4 uuid; s1 uuid; l1 uuid; lp uuid; sset uuid; tpost uuid; o1 uuid; v1 uuid; vplay uuid;
  w jsonb; sid bigint; msid bigint; closed bigint; made jsonb; said text; before_acts bigint; before_turns bigint; before_answers bigint; made_turn bigint; since timestamptz := now() - interval '2 days';
begin
  p := pg_temp.staff_post('cs-boss', t, 'The boss speaks again.');
  pm := pg_temp.staff_post('cs-mod', t, 'The mod speaks again.');
  a1 := tests.act(a, 'post', t, '{"body": "Ann answers."}', p, now() - interval '2 hours');
  a2 := tests.act(b, 'post', t, '{"body": "Bob answers."}', p, now() - interval '1 hour');
  a3 := tests.act(b, 'post', t, '{"body": "Bob answers the mod."}', pm);
  s1 := pg_temp.staff_post('cs-mod', t, 'A colleague answers.', p);
  -- A reply older than the wait (48 hours), and one under a live author veil: neither is waiting now, so neither is answered.
  o1 := tests.act(a, 'post', t, '{"body": "Ann, three days ago."}', p, now() - interval '3 days');
  v1 := tests.act(b, 'post', t, '{"body": "Bob, veiled."}', p, now() - interval '30 minutes');
  vplay := tests.act(a, 'card', t, '{"card": "cswveil", "reach": "post"}', v1);
  insert into post_veils (play, post, veil, author, caster_account, ends_at, post_kind) values (vplay, v1, 'author', b, bob, now() + interval '1 day', 'post');
  lp := pg_temp.staff_post('cs-boss', t2, 'A locked thread.');
  l1 := tests.act(a, 'post', t2, '{"body": "Ann in the locked thread."}', lp);
  perform set_config('kayfabb.staff_writer', 'on', true);
  sset := tests.act(boss, 'set', t2, '{}', lp);
  perform tests.act(boss, 'spring', t2, jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'lockedOut', 'set', sset::text, 'locks', boss::text, 'until', (now() + interval '1 day')::text), lp);
  perform set_config('kayfabb.staff_writer', '', true);
  perform tests.become_service();
  perform write_sessions(pg_temp.today(), '[{"staff": "cs-boss", "start": 0, "end": 1440}, {"staff": "cs-mod", "start": 0, "end": 1440}]');
  perform write_sessions(pg_temp.today() - 1, '[{"staff": "cs-boss", "start": 0, "end": 60}]');
  sid := (select id from staff_sessions where staff = 'cs-boss' and day = pg_temp.today() order by id limit 1);
  msid := (select id from staff_sessions where staff = 'cs-mod' and day = pg_temp.today() order by id limit 1);
  closed := (select id from staff_sessions where staff = 'cs-boss' and day = pg_temp.today() - 1);

  w := (select e from jsonb_array_elements(pool_waiting(array['cs-boss'], since)) e where e ->> 'thread' = t::text);
  if w is null or jsonb_array_length(w -> 'replies') is distinct from 2 then raise exception 'before the turn the boss has two waiting: %', w; end if;
  if exists (select 1 from jsonb_array_elements(pool_waiting(array['cs-boss'], since)) e where e ->> 'thread' = t2::text) then raise exception 'a locked-out thread has waiting replies'; end if;

  -- The refusals write nothing: a closed session, another persona's session, a quote outside the answers, a reply to another persona's post, a staff reply, no answers, a locked-out thread.
  before_acts := (select count(*) from acts); before_turns := (select count(*) from pool_turns); before_answers := (select count(*) from pool_answered);
  said := pg_temp.refused(format('select write_staff_turn(%L, %L, %L, %L, %L::uuid[], %L, 0)', 'cs-boss', closed, t, a2, array[a1, a2], 'No.'));
  if said is null or said !~ '^55000' then raise exception 'a closed session wrote a turn: %', said; end if;
  said := pg_temp.refused(format('select write_staff_turn(%L, %L, %L, %L, %L::uuid[], %L, 0)', 'cs-boss', msid, t, a2, array[a1, a2], 'No.'));
  if said is null or said !~ '^42501' then raise exception 'another persona''s session wrote a turn: %', said; end if;
  said := pg_temp.refused(format('select write_staff_turn(%L, %L, %L, %L, %L::uuid[], %L, 0)', 'cs-boss', sid, t, a3, array[a1, a2], 'No.'));
  if said is null or said !~ '^22023' then raise exception 'a quote outside the answers wrote a turn: %', said; end if;
  said := pg_temp.refused(format('select write_staff_turn(%L, %L, %L, %L, %L::uuid[], %L, 0)', 'cs-boss', sid, t, a3, array[a3], 'No.'));
  if said is null or said !~ '^22023' then raise exception 'a reply to another persona''s post was answered: %', said; end if;
  said := pg_temp.refused(format('select write_staff_turn(%L, %L, %L, %L, %L::uuid[], %L, 0)', 'cs-boss', sid, t, s1, array[s1], 'No.'));
  if said is null or said !~ '^22023' then raise exception 'a staff reply was answered: %', said; end if;
  said := pg_temp.refused(format('select write_staff_turn(%L, %L, %L, %L, %L::uuid[], %L, 0)', 'cs-boss', sid, t, a2, array[]::uuid[], 'No.'));
  if said is null or said !~ '^22023' then raise exception 'a turn with no answers was written: %', said; end if;
  said := pg_temp.refused(format('select write_staff_turn(%L, %L, %L, %L, %L::uuid[], %L, 0)', 'cs-boss', sid, t2, l1, array[l1], 'Locked.'));
  if said is null or said !~ '^22023' then raise exception 'a reply in a locked-out thread was answered: %', said; end if;
  said := pg_temp.refused(format('select write_staff_turn(%L, %L, %L, %L, %L::uuid[], %L, 0)', 'cs-boss', sid, t, o1, array[o1, a2], 'Old.'));
  if said is null or said !~ '^22023' then raise exception 'a reply older than the wait was answered: %', said; end if;
  said := pg_temp.refused(format('select write_staff_turn(%L, %L, %L, %L, %L::uuid[], %L, 0)', 'cs-boss', sid, t, v1, array[v1, a2], 'Veiled.'));
  if said is null or said !~ '^22023' then raise exception 'a reply under an author veil was answered: %', said; end if;
  if (select count(*) from acts) is distinct from before_acts or (select count(*) from pool_turns) is distinct from before_turns or (select count(*) from pool_answered) is distinct from before_answers then raise exception 'a refused turn wrote something'; end if;

  -- A turn: the post, the turn and the answers together.
  made := write_staff_turn('cs-boss', sid, t, a2, array[a1, a2], 'The boss answers them both.', 0);
  tpost := (made -> 'post' ->> 'id')::uuid;
  made_turn := (made ->> 'turn')::bigint;
  if not exists (select 1 from acts where id = tpost and kind = 'post' and target_act_id = a2 and thread = t and character = boss) then raise exception 'the turn''s post is not the boss''s quote of the newest reply: %', made; end if;
  if (select count(*) from pool_turns where id = made_turn and post_act = tpost and quoting = a2 and session = sid and thread = t and staff = 'cs-boss' and day = pg_temp.today()) is distinct from 1 then raise exception 'the turn''s row is not written'; end if;
  if (select count(*) from pool_answered where turn = made_turn) is distinct from 2 or not exists (select 1 from pool_answered where reply = a1) then raise exception 'the turn does not hold its answers'; end if;
  -- Answered replies are waiting no more, and the session has spent a turn in the thread.
  w := (select e from jsonb_array_elements(pool_waiting(array['cs-boss'], since)) e where e ->> 'thread' = t::text);
  if w is not null then raise exception 'answered replies are still waiting: %', w; end if;
  said := pg_temp.refused(format('select write_staff_turn(%L, %L, %L, %L, %L::uuid[], %L, 0)', 'cs-boss', sid, t, a1, array[a1], 'Again.'));
  if said is null or said !~ '^55000' then raise exception 'an answered reply was answered again: %', said; end if;
  if (select count(*) from pool_turns) is distinct from before_turns + 1 then raise exception 'a refused second answer wrote a turn'; end if;
  w := (select e from jsonb_array_elements(sessions_awake(now())) e where (e ->> 'session')::bigint = sid);
  if (w ->> 'spent')::int is distinct from (select count(*)::int from pool_turns where session = sid) or (w ->> 'spent')::int < 1 or (w -> 'spentByThread' ->> t::text)::int is distinct from 1 then raise exception 'the session''s spend: %', w; end if;
  if pool_turns_today(pg_temp.today()) is distinct from before_turns + 1 or pool_turns_today('2030-05-05') is distinct from 0 then raise exception 'the day''s turns: %', pool_turns_today(pg_temp.today()); end if;
  -- A fresh reply to the turn's own post is waiting for the boss.
  a4 := tests.act(a, 'post', t, '{"body": "Ann answers the turn."}', tpost);
  w := (select e from jsonb_array_elements(pool_waiting(array['cs-boss'], since)) e where e ->> 'thread' = t::text);
  if w is null or jsonb_array_length(w -> 'replies') is distinct from 1 or w -> 'replies' -> 0 ->> 'act' is distinct from a4::text then raise exception 'a reply to a turn is waiting: %', w; end if;
  perform tests.unbecome();
end $$;

-- ---- Heat: the public reaction total on a persona's turns in a thread (reaction_tallies_open, as pool_signals reads it) ----
do $$
declare
  t uuid := tests.thread('Heat');
  ann uuid := tests.account('cs-h-ann'); a uuid := tests.character(ann, 'Cs H Ann');
  bob uuid := tests.account('cs-h-bob'); b uuid := tests.character(bob, 'Cs H Bob');
  p uuid := pg_temp.staff_post('cs-boss', t, 'The boss, hot.');
  r1 uuid := tests.act(a, 'post', t, '{"body": "Hot one."}', p);
  r2 uuid := tests.act(b, 'post', t, '{"body": "Hot two."}', p);
  sid bigint; made jsonb; tp uuid; heat jsonb;
begin
  perform tests.become_service();
  perform write_sessions(pg_temp.today(), '[{"staff": "cs-boss", "start": 0, "end": 1440}]');
  sid := (select id from staff_sessions where staff = 'cs-boss' and day = pg_temp.today() order by id limit 1);
  made := write_staff_turn('cs-boss', sid, t, r1, array[r1], 'First turn.', 0);
  tp := (made -> 'post' ->> 'id')::uuid;
  perform tests.unbecome();
  -- The public tally the crowd sees (the table react() keeps), two up on the turn and one boo.
  insert into reaction_tallies (act, kind, count) values (tp, 'up', 2), (tp, 'boo', 1);
  perform tests.become_service();
  heat := (select e from jsonb_array_elements(pool_waiting(array['cs-boss'], now() - interval '2 days')) e where e ->> 'thread' = t::text);
  if heat is null or (heat ->> 'heat')::numeric is distinct from 3 then raise exception 'three reactions on the turn make heat 3: %', heat; end if;
  -- The reply that is still waiting (r2) is the thread's; the answered one (r1) is not.
  if jsonb_array_length(heat -> 'replies') is distinct from 1 or heat -> 'replies' -> 0 ->> 'act' is distinct from r2::text then raise exception 'the waiting reply of a hot thread: %', heat; end if;
  perform tests.unbecome();
end $$;

-- ---- The conversation: bounded and cut ----
do $$
declare
  t uuid := tests.thread('Conversation');
  ann uuid := tests.account('cs-c-ann'); a uuid := tests.character(ann, 'Cs C Ann');
  p1 uuid; p2 uuid; p3 uuid; r jsonb;
begin
  -- One transaction has one now(), so the posts are given their own times, as a thread has them.
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at) values ((select id from characters where staff = 'cs-boss'), 'post', t, '{"body": "First post of the boss in this thread."}', now() - interval '30 minutes') returning id into p1;
  insert into acts (character, kind, thread, payload, created_at) values ((select id from characters where staff = 'cs-boss'), 'post', t, '{"body": "Second post of the boss in this thread."}', now() - interval '20 minutes') returning id into p2;
  insert into acts (character, kind, thread, payload, created_at) values ((select id from characters where staff = 'cs-boss'), 'post', t, '{"body": "Third post of the boss in this thread."}', now() - interval '10 minutes') returning id into p3;
  insert into acts (character, kind, thread, payload, created_at) values ((select id from characters where staff = 'cs-mod'), 'post', t, '{"body": "Not the boss''s."}', now() - interval '5 minutes');
  perform set_config('kayfabb.staff_writer', '', true);
  perform tests.act(a, 'post', t, '{"body": "Reply one to the third."}', p3, now() - interval '9 minutes');
  perform tests.act(a, 'post', t, '{"body": "Reply two to the third."}', p3, now() - interval '8 minutes');
  perform tests.act(a, 'post', t, '{"body": "Reply three to the third."}', p3, now() - interval '7 minutes');
  perform tests.act(a, 'post', t, '{"body": "Reply to the first."}', p1, now() - interval '25 minutes');
  perform tests.become_service();
  r := pool_conversation('cs-boss', t, 2, 2, 9);
  if jsonb_array_length(r -> 'posts') is distinct from 2 then raise exception 'the newest 2 posts: %', r; end if;
  if r -> 'posts' -> 0 ->> 'act' is distinct from p2::text or r -> 'posts' -> 1 ->> 'act' is distinct from p3::text then raise exception 'the newest posts, oldest first: %', r; end if;
  if r -> 'posts' -> 1 ->> 'body' is distinct from 'Third pos' or (r -> 'posts' -> 1 ->> 'cut')::boolean is distinct from true then raise exception 'a body is cut to 9 characters: %', r; end if;
  if jsonb_array_length(r -> 'posts' -> 1 -> 'replies') is distinct from 2 or r -> 'posts' -> 1 -> 'replies' -> 1 ->> 'body' is distinct from 'Reply thr' or r -> 'posts' -> 1 -> 'replies' -> 0 ->> 'body' is distinct from 'Reply two' then
    raise exception 'the newest 2 replies, oldest first, cut: %', r;
  end if;
  if r -> 'posts' -> 1 -> 'replies' -> 0 ->> 'name' is distinct from 'Cs C Ann' or not (r -> 'posts' -> 1 -> 'replies' -> 0) ? 'pronouns' then raise exception 'a reply carries its author''s name and pronouns: %', r; end if;
  if jsonb_array_length(r -> 'posts' -> 0 -> 'replies') is distinct from 0 then raise exception 'a post with no replies shows some'; end if;
  r := pool_conversation('cs-boss', t, 0, 3, 9);
  if r -> 'posts' is distinct from '[]'::jsonb then raise exception 'zero posts asked, some shown'; end if;
  r := pool_conversation('cs-boss', t, 4, 3, 1000);
  if jsonb_array_length(r -> 'posts') is distinct from 3 or (r -> 'posts' -> 0 ->> 'cut')::boolean is distinct from false then raise exception 'a body that fits is not cut: %', r; end if;
  r := pool_conversation('nobody', t, 4, 3, 1000);
  if r -> 'posts' is distinct from '[]'::jsonb then raise exception 'no persona, a conversation'; end if;
  perform tests.unbecome();
end $$;

-- ---- The record and the talking point ----
do $$
declare
  t uuid := tests.thread('Record');
  r jsonb; m1 bigint; m2 bigint;
begin
  perform tests.become_service();
  r := pool_record(t, 'cs-boss');
  if jsonb_typeof(r -> 'moves') is distinct from 'array' or jsonb_array_length(r -> 'moves') > 10 or jsonb_typeof(r -> 'rules') is distinct from 'array' then raise exception 'the record''s shape: %', r; end if;
  if r -> 'order' is distinct from 'null'::jsonb then raise exception 'the boss has a standing order: %', r; end if;
  perform tests.unbecome();
  -- Two meetings; the later one wrote a point for the mod only, and an order for it.
  insert into meetings (started_at, finished_at, outcome, slot) values (now() - interval '3 hours', now() - interval '3 hours', 'ok', now() - interval '3 hours') returning id into m1;
  insert into staff_points (meeting, staff, line) values (m1, 'cs-boss', 'Yesterday''s line.'), (m1, 'cs-mod', 'Old news.');
  insert into meetings (started_at, finished_at, outcome, slot) values (now() - interval '1 hour', now() - interval '1 hour', 'ok', now() - interval '1 hour') returning id into m2;
  insert into staff_points (meeting, staff, line) values (m2, 'cs-mod', 'Watch the side board.');
  insert into staff_orders (meeting, staff, boards, order_line, allowance) values (m2, 'cs-mod', '{}', 'Keep an eye on the side.', 0);
  perform tests.become_service();
  if staff_points_latest('cs-mod') is distinct from 'Watch the side board.' then raise exception 'the mod''s point: %', staff_points_latest('cs-mod'); end if;
  if staff_points_latest('cs-boss') is not null then raise exception 'the latest meeting wrote none for the boss, yet: %', staff_points_latest('cs-boss'); end if;
  if staff_points_latest('nobody') is not null then raise exception 'a point for no one'; end if;
  r := pool_record(t, 'cs-mod');
  if r ->> 'order' is distinct from 'Keep an eye on the side.' then raise exception 'a Mod''s standing order is its record''s: %', r; end if;
  if pool_record(t, 'cs-boss') -> 'order' is distinct from 'null'::jsonb then raise exception 'the boss has an order: %', pool_record(t, 'cs-boss'); end if;
  perform tests.unbecome();
end $$;

-- ---- Presence: a persona in session shows where it is talking, and not once it ends ----
do $$
declare
  t_post uuid := tests.thread('Presence posted'); t_wait uuid := tests.thread('Presence waiting'); t_none uuid := tests.thread('Presence none');
  ann uuid := tests.account('cs-p-ann'); a uuid := tests.character(ann, 'Cs P Ann');
  late uuid := (select id from characters where staff = 'cs-late');
  pw uuid; others_before integer; box jsonb; sid bigint;
begin
  -- cs-late posted on t_wait three days ago (long outside the presence window) and has a reply waiting there; it posts on t_post now; t_none has nothing of its own.
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at) values (late, 'post', t_wait, '{"body": "An old post, answered now."}', now() - interval '3 days') returning id into pw;
  perform set_config('kayfabb.staff_writer', '', true);
  perform tests.act(a, 'post', t_wait, '{"body": "A waiting reply."}', pw);
  perform tests.act(a, 'post', t_none, '{"body": "Nothing for the late persona here."}');
  insert into presence (character, place_kind, place, board, place_since, online_since, seen_at) values (a, 'thread', t_none, (select board from threads where id = t_none), now(), now(), now());
  perform tests.become_service();
  -- Before its session: only its own posts list a persona, and the index lists none.
  perform pg_temp.staff_post('cs-late', t_post, 'The late persona posts here.');
  if exists (select 1 from jsonb_array_elements(presence_box('index', null) -> 'names') e where e ->> 'name' = 'Cs Late') then raise exception 'a persona with no session is in the index'; end if;
  if exists (select 1 from jsonb_array_elements(presence_box('thread', t_wait) -> 'names') e where e ->> 'name' = 'Cs Late') then raise exception 'a persona with no session is on a thread it has a reply waiting in'; end if;
  if not exists (select 1 from jsonb_array_elements(presence_box('thread', t_post) -> 'names') e where e ->> 'name' = 'Cs Late') then raise exception 'a persona is not on the thread it just posted in, as before'; end if;
  others_before := (presence_box('index', null) ->> 'others')::integer;
  perform write_sessions(pg_temp.today(), '[{"staff": "cs-late", "start": 0, "end": 1440}]');
  sid := (select id from staff_sessions where staff = 'cs-late' and day = pg_temp.today());
  -- Its threads: the one it posted in since the session began, the one with a reply waiting; never the one it has neither on.
  if not exists (select 1 from jsonb_array_elements(presence_box('thread', t_post) -> 'names') e where e ->> 'name' = 'Cs Late' and (e ->> 'staff')::boolean) then raise exception 'a persona in session is not on the thread it posted in'; end if;
  if not exists (select 1 from jsonb_array_elements(presence_box('thread', t_wait) -> 'names') e where e ->> 'name' = 'Cs Late' and (e ->> 'staff')::boolean) then raise exception 'a persona in session is not on the thread it has a reply waiting in'; end if;
  if exists (select 1 from jsonb_array_elements(presence_box('thread', t_none) -> 'names') e where e ->> 'name' = 'Cs Late') then raise exception 'a persona in session is on a thread it has no turn or post in'; end if;
  -- The board's box lists it once however many threads; the index lists it once, as staff, beside the player; the count of others does not move.
  box := presence_box('board', (select board from threads where id = t_post));
  if (select count(*) from jsonb_array_elements(box -> 'names') e where e ->> 'name' = 'Cs Late') is distinct from 1 then raise exception 'the board lists a persona in session more or less than once: %', box; end if;
  box := presence_box('index', null);
  if (select count(*) from jsonb_array_elements(box -> 'names') e where e ->> 'name' = 'Cs Late' and (e ->> 'staff')::boolean) is distinct from 1 then raise exception 'the index lists a persona in session once, as staff: %', box; end if;
  if not exists (select 1 from jsonb_array_elements(box -> 'names') e where e ->> 'name' = 'Cs P Ann' and not (e ->> 'staff')::boolean) then raise exception 'the index lost its player: %', box; end if;
  if (box ->> 'others')::integer is distinct from others_before then raise exception 'the index''s count moved for a persona in session: % to %', others_before, box ->> 'others'; end if;
  -- A persona benched now is listed nowhere, though its session was written while it posted and it posted in t_post.
  insert into staff_offices (staff, office, cause) values ('cs-late', 'benched', 'admin');
  if exists (select 1 from jsonb_array_elements(presence_box('index', null) -> 'names') e where e ->> 'name' = 'Cs Late') then raise exception 'a benched persona is in the index'; end if;
  if exists (select 1 from jsonb_array_elements(presence_box('thread', t_wait) -> 'names') e where e ->> 'name' = 'Cs Late') then raise exception 'a benched persona is on a thread it has a reply waiting in'; end if;
  insert into staff_offices (staff, office, cause) values ('cs-late', 'mod', 'admin');
  perform tests.unbecome();
  -- A session that has ended lists nothing of its own: its trigger is put aside for the moment (a restore does it) so the row can be moved into the past.
  alter table staff_sessions disable trigger staff_sessions_no_update;
  update staff_sessions set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' where id = sid;
  alter table staff_sessions enable always trigger staff_sessions_no_update;
  perform tests.become_service();
  if exists (select 1 from jsonb_array_elements(presence_box('index', null) -> 'names') e where e ->> 'name' = 'Cs Late') then raise exception 'a persona whose session ended is in the index'; end if;
  if exists (select 1 from jsonb_array_elements(presence_box('thread', t_wait) -> 'names') e where e ->> 'name' = 'Cs Late') then raise exception 'a persona whose session ended is on a thread it has a reply waiting in'; end if;
  perform tests.unbecome();
end $$;

-- ---- pool_waiting is bounded: at most 12 threads for a persona and 20 replies in a thread, the newest ----
do $$
declare
  late uuid := (select id from characters where staff = 'cs-late');
  pl uuid := tests.character(tests.account('cs-bound'), 'Cs Bound');
  th uuid; busy uuid; p uuid; w jsonb;
begin
  for i in 1 .. 14 loop
    th := tests.thread('Bound ' || i);
    perform set_config('kayfabb.staff_writer', 'on', true);
    insert into acts (character, kind, thread, payload) values (late, 'post', th, '{"body": "A post."}') returning id into p;
    perform set_config('kayfabb.staff_writer', '', true);
    if i = 14 then busy := th; end if;
    -- Thread i's newest reply is 15 - i minutes old, so threads 1 and 2 are the two left out; thread 14 has 25 replies.
    perform tests.act(pl, 'post', th, '{"body": "A reply."}', p, now() - (15 - i) * interval '1 minute');
    if i = 14 then
      for j in 1 .. 24 loop perform tests.act(pl, 'post', th, jsonb_build_object('body', 'More ' || j), p, now() - interval '1 minute' - j * interval '1 minute'); end loop;
    end if;
  end loop;
  perform tests.become_service();
  w := pool_waiting(array['cs-late'], now() - interval '2 days');
  if jsonb_array_length(w) is distinct from 12 then raise exception 'a persona''s threads are bounded at 12: %', jsonb_array_length(w); end if;
  if exists (select 1 from jsonb_array_elements(w) e where e ->> 'thread' in (select id::text from threads where title in ('Bound 1', 'Bound 2'))) then raise exception 'the two threads with the oldest replies are left out, not the newest'; end if;
  if not exists (select 1 from jsonb_array_elements(w) e where e ->> 'thread' = busy::text and jsonb_array_length(e -> 'replies') = 20) then raise exception 'a thread''s replies are bounded at 20: %', w; end if;
  perform tests.unbecome();
end $$;

-- ---- pool_conversation clamps what it is asked for: 20 posts, 10 replies, 2000 characters ----
do $$
declare
  t uuid := tests.thread('Clamped');
  pl uuid := tests.character(tests.account('cs-clamp'), 'Cs Clamp');
  boss uuid := (select id from characters where staff = 'cs-boss');
  p uuid; r jsonb;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  for i in 1 .. 25 loop
    insert into acts (character, kind, thread, payload, created_at) values (boss, 'post', t, jsonb_build_object('body', case when i = 25 then repeat('x', 3000) else 'Post ' || i end), now() - (30 - i) * interval '1 minute') returning id into p;
  end loop;
  perform set_config('kayfabb.staff_writer', '', true);
  for i in 1 .. 15 loop perform tests.act(pl, 'post', t, '{"body": "A reply."}', p, now() - i * interval '10 seconds'); end loop;
  perform tests.become_service();
  r := pool_conversation('cs-boss', t, 1000, 1000, 100000);
  if jsonb_array_length(r -> 'posts') is distinct from 20 then raise exception 'the posts asked for are clamped at 20: %', jsonb_array_length(r -> 'posts'); end if;
  if jsonb_array_length(r -> 'posts' -> 19 -> 'replies') is distinct from 10 then raise exception 'the replies asked for are clamped at 10'; end if;
  if length(r -> 'posts' -> 19 ->> 'body') is distinct from 2000 or (r -> 'posts' -> 19 ->> 'cut')::boolean is distinct from true then raise exception 'the characters asked for are clamped at 2000'; end if;
  perform tests.unbecome();
end $$;

-- ---- The index's names are capped for players alone: a persona in session takes no player's slot ----
do $$
declare
  t uuid := tests.thread('Capped');
  late uuid := (select id from characters where staff = 'cs-late');
  before_others integer; after_others integer; box jsonb; who uuid;
begin
  update settings set value = '2' where key = 'presenceNames';
  for i in 1 .. 5 loop
    who := tests.character(tests.account('cs-cap-' || i), 'Cs Cap ' || i);
    insert into presence (character, place_kind, place, board, place_since, online_since, seen_at)
    values (who, 'thread', t, (select board from threads where id = t), now(), now() - i * interval '1 minute', now());
  end loop;
  perform tests.become_service();
  box := presence_box('index', null);
  before_others := (box ->> 'others')::integer;
  if (select count(*) from jsonb_array_elements(box -> 'names') e where not (e ->> 'staff')::boolean) is distinct from 2 or exists (select 1 from jsonb_array_elements(box -> 'names') e where e ->> 'name' = 'Cs Late') then
    raise exception 'the cap binds on players with no persona in session: %', box;
  end if;
  perform write_sessions(pg_temp.today(), '[{"staff": "cs-late", "start": 0, "end": 1440}]');
  box := presence_box('index', null);
  after_others := (box ->> 'others')::integer;
  if not exists (select 1 from jsonb_array_elements(box -> 'names') e where e ->> 'name' = 'Cs Late' and (e ->> 'staff')::boolean) then raise exception 'the persona in session is not in the index: %', box; end if;
  if (select count(*) from jsonb_array_elements(box -> 'names') e where not (e ->> 'staff')::boolean) is distinct from 2 then raise exception 'the persona took a player''s name slot: %', box; end if;
  if after_others is distinct from before_others then raise exception 'the players'' others moved for a persona in session: % to %', before_others, after_others; end if;
  perform tests.unbecome();
end $$;

-- ---- pool_waiting reads through the persona's own posts and the target index, never a scan of the window's posts ----
-- A busy instance in miniature: 40000 posts by 400 players in 80 threads, a persona with 300 posts of its own and 20 replies to the newest of them. The plan is that of `pool_waiting_rows`, which pool_waiting and
-- presence read; it must probe the target index once for each post of the persona (`Index Cond: (target_act_id = p.id)`, an index or a bitmap scan inside a nested loop), not read the window's posts (a scan) or every reply there is (a merge by the index).
-- The bulk rows are written with triggers off (a restore does it); the counters they would keep are not what is read.
do $$
declare
  boss uuid := (select id from characters where staff = 'cs-boss');
  th uuid[]; chars uuid[]; plan text; ln record; hits integer; capped uuid;
begin
  select array_agg(tests.thread('Big ' || i)) into th from generate_series(1, 80) i;
  select array_agg(tests.character(tests.account('cs-big-' || i), 'Cs Big ' || i)) into chars from generate_series(1, 400) i;
  set local session_replication_role = replica;
  insert into acts (character, kind, thread, payload, seq, created_at)
  select chars[1 + (i % 400)], 'post', th[1 + (i % 80)], jsonb_build_object('body', 'Chatter ' || i), i / 80 + 1, now() - (i % 40000) * interval '3 seconds' from generate_series(1, 40000) i;
  insert into acts (character, kind, thread, payload, seq, created_at)
  select boss, 'post', th[1 + (i % 80)], jsonb_build_object('body', 'Staff ' || i), 100000 + i, now() - (i % 300) * interval '5 minutes' from generate_series(1, 300) i;
  insert into acts (character, kind, thread, payload, target_act_id, seq, created_at)
  select chars[1 + (row_number() over ())::int % 400], 'post', p.thread, '{"body": "A reply."}', p.id, 200000 + row_number() over (), now() - interval '10 minutes'
  from (select id, thread from acts where character = boss and kind = 'post' and thread = any (th) order by created_at desc limit 20) p;
  -- The cap is exact: 210 newer replies by staff to one post do not crowd out the three older player replies, since staff replies are not waiting and are left out before the cap.
  select p.id into capped from acts p where p.character = boss and p.kind = 'post' and p.thread = any (th) and not exists (select 1 from acts r where r.target_act_id = p.id) order by p.created_at limit 1;
  insert into acts (character, kind, thread, payload, target_act_id, seq, created_at)
  select (select id from characters where staff = 'cs-mod'), 'post', (select thread from acts where id = capped), '{"body": "A colleague."}', capped, 300000 + i, now() - interval '1 minute' from generate_series(1, 210) i;
  insert into acts (character, kind, thread, payload, target_act_id, seq, created_at)
  select chars[i], 'post', (select thread from acts where id = capped), '{"body": "An older player reply."}', capped, 400000 + i, now() - interval '1 hour' from generate_series(1, 3) i;
  set local session_replication_role = origin;
  analyze acts;
  analyze characters;
  plan := '';
  for ln in execute format('explain select * from pool_waiting_rows(array[%L], now() - interval ''2 days'')', 'cs-boss') loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
  if plan not like '%acts_target%' or plan !~ 'Index Cond: \(+target_act_id = p\.id\)' then raise exception 'the waiting replies are not probed by the target index, once for each post of the persona: %', plan; end if;
  if plan ~ 'Seq Scan on acts\M' or plan ~ 'Merge Join' then raise exception 'the waiting replies scan or merge the posts: %', plan; end if;
  -- A thread's presence read starts from the persona's own posts in that thread and probes the target index from them; a board's, from its posts in that board's threads. Neither reads other places.
  plan := '';
  for ln in execute format('explain select * from pool_waiting_in_thread(%L, array[%L], now() - interval ''2 days'')', th[1], 'cs-boss') loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
  if plan !~ format('Index Cond:[^\n]*thread = ''%s''', th[1]) or plan !~ 'target_act_id = p.id' or plan ~ 'Seq Scan on acts p\M' or plan ~ 'acts_created' or plan ~ 'Merge Join' then
    raise exception 'a thread''s presence read does not probe that thread alone: %', plan;
  end if;
  plan := '';
  for ln in execute format('explain select * from pool_waiting_in_board(%L, array[%L], now() - interval ''2 days'')', (select board from threads where id = th[1]), 'cs-boss') loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
  if plan !~ 'target_act_id = p.id' or plan ~ 'Seq Scan on acts p\M' or plan ~ 'acts_created' or plan ~ 'Merge Join' then
    raise exception 'a board''s presence read does not probe its own posts: %', plan;
  end if;
  select count(*) into hits from pool_waiting_rows(array['cs-boss'], now() - interval '2 days') w where w.thread = any (th);
  if (select count(*) from pool_waiting_rows(array['cs-boss'], now() - interval '2 days') w where w.act in (select id from acts where target_act_id = capped and created_at < now() - interval '30 minutes')) is distinct from 3 then
    raise exception 'staff replies crowded the waiting replies out of the cap';
  end if;
  hits := hits - 3;
  if hits is distinct from 20 then raise exception 'the 20 seeded replies are not all found: %', hits; end if;
  if jsonb_array_length(pool_waiting(array['cs-boss'], now() - interval '2 days')) < 1 then raise exception 'the aggregate finds none'; end if;
end $$;

-- ---- No new function reads an account, a reactor's account, an owner or a class ----
-- The check is over the functions' own text (pg_proc.prosrc), a comment included, so a body that merely names what it must not read is the same as one that does. `leaks` returns the functions of a list whose text names
-- one of the private columns; the self-test plants functions that read `characters.account`, `characters.owner`, `reactions.reactor_account` and a class, and holds that the check finds each (and not the innocent one).
create function pg_temp.leaks(fns regprocedure[]) returns text[] language sql as $$
  select coalesce(array_agg(f::text order by f::text), '{}')
  from unnest(fns) f join pg_proc p on p.oid = f::oid
  where p.prosrc ~* '\m(account|reactor_account|owner|class|class_key|pending_class|caster_account)\M'
$$;
do $$
declare
  fns regprocedure[] := array[
    'claim_pool_round(timestamptz, interval)', 'write_sessions(date, jsonb, boolean)', 'sessions_awake(timestamptz)', 'sessions_day(date)', 'pool_day_started(date)', 'keep_pick(date, text, jsonb)', 'kept_picks(date)',
    'pool_waiting_rows(text[], timestamptz)', 'pool_waiting_in_thread(uuid, text[], timestamptz)', 'pool_waiting_in_board(uuid, text[], timestamptz)', 'pool_waiting(text[], timestamptz)', 'pool_turns_today(date)', 'write_staff_turn(text, bigint, uuid, uuid, uuid[], text, integer, jsonb)', 'pool_chars_today(date)',
    'pool_conversation(text, uuid, integer, integer, integer)', 'pool_record(uuid, text)', 'staff_points_latest(text)', 'staff_rows_append_only()']::regprocedure[];
  found text[];
begin
  found := pg_temp.leaks(fns);
  if found is distinct from '{}'::text[] then raise exception 'new functions read a private fact: %', found; end if;
  -- The presence view and the box read characters and the persona's own acts, nothing private.
  if pg_get_viewdef('presence_listed'::regclass) ~* '\m(account|reactor_account|owner|class|class_key)\M' then raise exception 'the presence view reads a private fact'; end if;
  if (select p.prosrc from pg_proc p where p.oid = 'presence_box(text, uuid)'::regprocedure) ~* '\m(account|reactor_account|owner|class|class_key)\M' then raise exception 'presence_box reads a private fact'; end if;
  -- The poison: functions that read who owns a character, who reacted, a class. They are not run (plpgsql is not checked until it runs), only read.
  create function pg_temp.planted_reads_account(k text) returns uuid language plpgsql as $f$
    begin return (select c.account from characters c where c.staff = k); end $f$;
  create function pg_temp.planted_reads_owner(k text) returns uuid language plpgsql as $f$
    begin return (select c.owner from characters c where c.staff = k); end $f$;
  create function pg_temp.planted_reads_reactors() returns bigint language plpgsql as $f$
    begin return (select count(distinct r.reactor_account) from reactions r); end $f$;
  create function pg_temp.planted_reads_class(k text) returns text language plpgsql as $f$
    begin return (select h.class_key from class_history h join characters c on c.id = h.character where c.staff = k); end $f$;
  create function pg_temp.planted_innocent(k text) returns uuid language plpgsql as $f$
    begin return (select c.id from characters c where c.staff = k); end $f$;
  found := pg_temp.leaks(array['pg_temp.planted_reads_account(text)', 'pg_temp.planted_reads_owner(text)', 'pg_temp.planted_reads_reactors()', 'pg_temp.planted_reads_class(text)', 'pg_temp.planted_innocent(text)']::regprocedure[]);
  if cardinality(found) is distinct from 4 or exists (select 1 from unnest(found) f where f like '%innocent%') then
    raise exception 'the check did not find the planted functions that read a private fact (and only them): %', found;
  end if;
end $$;
