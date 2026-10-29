-- The System's board (supabase/migrations/0013_system_board.sql): one board is The System's, flagged
-- in the instance's seed; The System posts its tally and its reveal there; players post nowhere
-- on it, and a thread spun from what it said opens on a board of theirs. An instance seeded
-- before the flag keeps its threads where they are. The screens' engine plan, Task 1.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- Settle the next window, a day long, as the job does, as the service: from where the last one
-- ended, which an earlier file's committed race may have moved. A character made inside it debuts.
create function pg_temp.settle_day_with_debut(owner uuid, name text) returns jsonb language plpgsql as $$
declare
  s timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  said jsonb;
begin
  insert into characters (owner, name, created_at) values (owner, name, s + interval '1 hour');
  perform set_config('role', 'service_role', true);
  said := apply_settlement(s, s + interval '1 day', '[]');
  perform tests.unbecome();
  return said;
end $$;

-- ---- One board is The System's, and it is where The System's Acts go ----
do $$
declare
  ann uuid := tests.account('sys-ann');
  a uuid := tests.character(ann, 'Sys Ann', 'alpha', now() - interval '10 days');
  sys uuid := (select id from boards where slug = 'the-system');
  general uuid := (select id from boards where slug = 'general');
  t uuid;
  settled jsonb;
  tally uuid;
  why text;
  spun jsonb;
begin
  if system_board() is distinct from sys then raise exception 'system_board() is the board flagged as The System''s, not the first'; end if;
  if pg_temp.refusal($q$insert into boards (slug, name, is_system) values ('second-system', 'Again', true)$q$) is null then
    raise exception 'a second board was flagged as The System''s';
  end if;

  -- The tally opens on The System's board.
  settled := pg_temp.settle_day_with_debut(ann, 'Sys Debut');
  tally := (settled ->> 'tally')::uuid;
  if tally is null then raise exception 'the settlement posted no tally: %', settled; end if;
  if (select t.board from acts x join threads t on t.id = x.thread where x.id = tally) is distinct from sys then
    raise exception 'the tally opened on another board than The System''s';
  end if;
  t := (select thread from acts where id = tally);

  -- A player posts nowhere on it: not a thread, not a reply.
  perform tests.become(ann);
  why := pg_temp.refusal(format('select start_thread(%L, %L, %L, %L)', 'the-system', a, 'Mine now', 'Hello.'));
  if why is distinct from 'only The System posts here; spin a thread from what it said' then raise exception 'a thread on The System''s board: %', why; end if;
  why := pg_temp.refusal(format('select post(%L, %L, %L)', t, a, 'A reply.'));
  if why is distinct from 'only The System posts here; spin a thread from what it said' then raise exception 'a reply on The System''s board: %', why; end if;
  why := pg_temp.refusal(format('select post(%L, %L, %L, %L)', t, a, 'A quote.', tally));
  if why is distinct from 'only The System posts here; spin a thread from what it said' then raise exception 'a quoting reply on The System''s board: %', why; end if;

  -- A spin from the tally opens on the players' board, and points back at it.
  spun := spin(tally, a, 'About last night', 'Who is Sys Debut?');
  if (spun -> 'thread' ->> 'board')::uuid is distinct from general then raise exception 'a spin from The System''s Act opened on %, not the players'' board', spun -> 'thread' ->> 'board'; end if;
  if (spun -> 'thread' ->> 'origin_act_id')::uuid is distinct from tally then raise exception 'the spin points at the tally'; end if;
  -- And a spin from an ordinary post stays on its own board.
  spun := spin((spun -> 'act' ->> 'id')::uuid, a, 'Again', '');
  if (spun -> 'thread' ->> 'board')::uuid is distinct from general then raise exception 'a spin from the players'' board moved'; end if;
  perform tests.unbecome();

  -- The reveal opens on The System's board.
  update settings set value = '{"unit": "day", "count": 1}' where key = 'seasonLength';
  settled := reveal_season(now());
  if (settled -> 'thread' ->> 'board')::uuid is distinct from sys then raise exception 'the reveal opened on another board: %', settled; end if;
end $$;

-- ---- A board for players can be spun onto even when The System's was made first ----
do $$
declare
  ann uuid := tests.account('sys-order');
  a uuid := tests.character(ann, 'Sys Order', 'alpha', now() - interval '10 days');
  r uuid;
  spun jsonb;
begin
  -- The System's board made before every other: a spin still lands on the first board for players.
  update boards set created_at = '1999-01-01' where slug = 'the-system';
  insert into threads (board, title) values (system_board(), 'Said') returning id into r;
  insert into acts (character, kind, thread, payload) values (null, 'reveal', r, '{}') returning id into r;
  perform tests.become(ann);
  spun := spin(r, a, 'Spun from the first board', '');
  perform tests.unbecome();
  if (spun -> 'thread' ->> 'board')::uuid is distinct from (select id from boards where slug = 'general') then raise exception 'a spin from The System''s Act landed on its board'; end if;
  update boards set created_at = (select created_at from boards where slug = 'general') where slug = 'the-system';
end $$;

-- ---- An instance seeded before the flag: its threads stay where they are ----
do $$
declare
  ann uuid := tests.account('sys-old');
  a uuid := tests.character(ann, 'Sys Old', 'alpha', now() - interval '10 days');
  general uuid := (select id from boards where slug = 'general');
  old_turns uuid;
  old_post uuid;
  settled jsonb;
begin
  -- As it stood: no board flagged, so The System posted on the first board.
  update boards set is_system = false;
  if system_board() is distinct from general then raise exception 'an instance with no board flagged posts on its first, as before'; end if;
  -- No Turns thread yet, so the tally opens one afresh on the board The System posts on now.
  update seasons set turns_thread = null;
  settled := pg_temp.settle_day_with_debut(ann, 'Sys Old Debut');
  old_turns := (select thread from acts where id = (settled ->> 'tally')::uuid);
  if (select board from threads where id = old_turns) is distinct from general then raise exception 'the old instance''s tally opened on its first board'; end if;
  -- Players still post on its first board.
  perform tests.become(ann);
  old_post := (post(old_turns, a, 'Before the flag.') ->> 'id')::uuid;
  perform tests.unbecome();

  -- An admin seeds again with the instance's flagged board: it becomes The System's, and nothing moves.
  perform set_config('role', 'service_role', true);
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'reactions', '[]'::jsonb, 'cards', '[]'::jsonb,
    'boards', jsonb_build_array(jsonb_build_object('slug', 'general', 'name', 'General', 'description', ''),
                                jsonb_build_object('slug', 'the-system', 'name', 'The System', 'description', '', 'system', true))));
  perform tests.unbecome();
  if system_board() is distinct from (select id from boards where slug = 'the-system') then raise exception 'seeding the flag made the board The System''s'; end if;
  if (select board from threads where id = old_turns) is distinct from general then raise exception 'seeding moved an old thread'; end if;
  if (select thread from acts where id = old_post) is distinct from old_turns then raise exception 'seeding moved an old post'; end if;

  -- A seed that flags no board leaves the flag where it is.
  perform set_config('role', 'service_role', true);
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'reactions', '[]'::jsonb, 'cards', '[]'::jsonb,
    'boards', jsonb_build_array(jsonb_build_object('slug', 'side', 'name', 'Side', 'description', ''))));
  perform tests.unbecome();
  if system_board() is distinct from (select id from boards where slug = 'the-system') then raise exception 'a seed that flags no board unflagged The System''s'; end if;
  -- A seed that flags another board moves the flag to it, and only the flag.
  perform set_config('role', 'service_role', true);
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'reactions', '[]'::jsonb, 'cards', '[]'::jsonb,
    'boards', jsonb_build_array(jsonb_build_object('slug', 'side', 'name', 'Renamed', 'description', '', 'system', true))));
  perform tests.unbecome();
  if system_board() is distinct from (select id from boards where slug = 'side') then raise exception 'a seed flagging another board moved the flag'; end if;
  if (select name from boards where slug = 'side') is distinct from 'Side' then raise exception 'seeding the flag renamed an admin''s board'; end if;
  if (select count(*) from boards where is_system) is distinct from 1::bigint then raise exception 'two boards are The System''s'; end if;
end $$;
