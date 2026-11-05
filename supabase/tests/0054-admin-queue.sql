-- The admin queue and reversal (supabase/migrations/0049_admin_queue.sql; the system plan, Task 11; the system design, section 7).
-- admin_queue(), hold_move(id) and reverse_move(act) are an admin's alone. A held move never lands; a reversed move ends as `reversed`
-- by an admin, the old name returns, and the Boss says so once; the next digest lists both, for the Director's memory only.

-- ---- A seed with the instance's words in it, an admin, a player ----
do $$
declare
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true,
      'systemLines', jsonb_build_object(
        'moveLanded', jsonb_build_array('It is done: {move}.'),
        'moveMet', jsonb_build_array('Met: {move}.'),
        'moveExpired', jsonb_build_array('Expired: {move}.'),
        'moveReversed', jsonb_build_array('Overruled: {move}.')),
      'systemMoveWords', jsonb_build_object('renameBoard', 'the renaming of a board to "{name}"')),
    'classes', '[]'::jsonb, 'reactions', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'aq-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'aq-boss', 'name', 'Queue Boss', 'title', 'Boss', 'signature', 'Hi')),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(jsonb_build_object('key', 'renameBoard', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'))));
  perform seed_instance(seed);
  insert into admins (account) values (tests.account('aq-admin'));
  perform tests.account('aq-player');
end $$;

create function pg_temp.queued(new_name text, go_live timestamptz) returns bigint language plpgsql as $$
declare
  m bigint;
  q bigint;
begin
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (m, 'aq-boss', 'renameBoard',
    jsonb_build_object('board', (select id from boards where slug = 'general'), 'name', new_name, 'premise', 'The subject of ' || new_name, 'description', 'About ' || new_name),
    jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', (select id from boards where slug = 'general'), 'count', 5)),
    'because ' || new_name, go_live, go_live + interval '3 days', true) returning id into q;
  return q;
end $$;

-- The queue's rows are made once, here, and found by name below: a move that is waiting stays in the queue for every block after it.
create function pg_temp.q(new_name text) returns bigint language sql as $$ select id from queued_moves where params ->> 'name' = new_name $$;
do $$
declare
  ancient bigint;
begin
  perform pg_temp.queued('Held Hall', now() - interval '1 hour');
  perform pg_temp.queued('Due Dune', now() - interval '1 hour');
  perform pg_temp.queued('Waiting Way', now() + interval '1 hour');
  -- A hold from long ago: in no group of the last 30 days.
  ancient := pg_temp.queued('Ancient Arch', now() - interval '60 days');
  update queued_moves set held_at = now() - interval '40 days', held_by = (select id from auth.users where email = 'aq-admin@test.invalid') where id = ancient;
end $$;

-- ---- A player calling any of the three is refused, and a visitor cannot reach them at all ----
do $$
declare
  player uuid := (select id from auth.users where email = 'aq-player@test.invalid');
  q bigint := pg_temp.q('Waiting Way');
begin
  perform tests.become(player);
  begin perform admin_queue(); raise exception 'a player read the admin queue'; exception when insufficient_privilege then null; end;
  begin perform hold_move(q); raise exception 'a player held a move'; exception when insufficient_privilege then null; end;
  begin perform reverse_move(gen_random_uuid()); raise exception 'a player reversed a move'; exception when insufficient_privilege then null; end;
  perform tests.unbecome();
  if (select held_at from queued_moves where id = q) is not null then raise exception 'a player''s refused hold held the move'; end if;
  perform tests.become_anon();
  begin perform admin_queue(); raise exception 'a visitor reached admin_queue'; exception when insufficient_privilege then null; end;
  begin perform hold_move(q); raise exception 'a visitor reached hold_move'; exception when insufficient_privilege then null; end;
  begin perform reverse_move(gen_random_uuid()); raise exception 'a visitor reached reverse_move'; exception when insufficient_privilege then null; end;
  perform tests.unbecome();
  if not (has_function_privilege('authenticated', 'admin_queue()', 'execute') and has_function_privilege('authenticated', 'hold_move(bigint)', 'execute')
          and has_function_privilege('authenticated', 'reverse_move(uuid)', 'execute')) then raise exception 'the web client cannot call the admin functions'; end if;
  if (select count(*) from pg_proc p where p.proname in ('admin_queue', 'hold_move', 'reverse_move', 'say_move_end') and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public, pg_temp')) is distinct from 4::bigint then
    raise exception 'an admin function is not security definer with a pinned search_path';
  end if;
end $$;

-- ---- An admin holds a queued move, and the tick never lands it ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'aq-admin@test.invalid');
  held bigint := pg_temp.q('Held Hall');
  due bigint := pg_temp.q('Due Dune');
  later bigint := pg_temp.q('Waiting Way');
  r jsonb;
begin
  perform tests.become(admin);
  r := hold_move(held);
  perform tests.unbecome();
  if (select held_at is null or held_by is distinct from admin from queued_moves where id = held) then raise exception 'the hold did not record when and by which admin'; end if;
  if r::text like '%' || admin::text || '%' then raise exception 'hold_move answered with the admin''s account'; end if;
  perform system_tick();
  perform system_tick();
  if (select landed_act from queued_moves where id = held) is not null or exists (select 1 from acts a where a.kind = 'move' and a.payload #>> '{params,name}' = 'Held Hall') then raise exception 'a held move landed'; end if;
  if (select landed_act from queued_moves where id = due) is null then raise exception 'the tick did not land the move that was not held'; end if;
  if (select landed_act from queued_moves where id = later) is not null then raise exception 'a move landed before its time'; end if;
  -- Held twice, held when landed, held when there is none: each refused in words.
  perform tests.become(admin);
  begin perform hold_move(held); raise exception 'a held move was held again'; exception when others then
    if sqlstate <> '55000' or sqlerrm <> 'that move is already held' then raise exception 'holding a held move said % (%)', sqlerrm, sqlstate; end if;
  end;
  begin perform hold_move(due); raise exception 'a landed move was held'; exception when others then
    if sqlstate <> '55000' or sqlerrm <> 'that move has already landed; reverse it instead' then raise exception 'holding a landed move said % (%)', sqlerrm, sqlstate; end if;
  end;
  begin perform hold_move(-1); raise exception 'a move that is not there was held'; exception when others then
    if sqlstate <> 'P0002' then raise exception 'holding no move said % (%)', sqlerrm, sqlstate; end if;
  end;
  perform tests.unbecome();
  if (select held_at is not null from queued_moves where id = due) then raise exception 'a refused hold held a landed move'; end if;
end $$;

-- ---- What admin_queue holds: waiting, in force, ended ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'aq-admin@test.invalid');
  held bigint := pg_temp.q('Held Hall');
  due bigint := pg_temp.q('Due Dune');
  later bigint := pg_temp.q('Waiting Way');
  landed uuid;
  met uuid;
  stale uuid;
  older uuid;
  q jsonb;
  g uuid := (select id from boards where slug = 'general');
begin
  perform system_tick();
  landed := (select landed_act from queued_moves where id = due);
  -- A move that was met, for the ended group.
  met := (write_staff_act('aq-boss', 'move', (select value #>> '{}' from settings where key = 'systemAnnouncements')::uuid, null,
    jsonb_build_object('kind', 'renameBoard', 'body', 'Landed.', 'params', jsonb_build_object('board', g, 'name', 'Met Manor', 'premise', 'p', 'description', 'd'))) ->> 'id')::uuid;
  perform end_move(met, 'met', 'demand');
  -- A move that ended more than 30 days ago (its move_end backdated, as the old hold above is): in no group of the last 30 days.
  stale := (write_staff_act('aq-boss', 'move', (select value #>> '{}' from settings where key = 'systemAnnouncements')::uuid, null,
    jsonb_build_object('kind', 'renameBoard', 'body', 'Landed.', 'params', jsonb_build_object('board', g, 'name', 'Stale Steppe', 'premise', 'p', 'description', 'd'))) ->> 'id')::uuid;
  perform set_config('kayfabb.move_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  select null, 'move_end', a.thread, a.id, jsonb_build_object('why', 'expired', 'by', 'expiry'), now() - interval '40 days' from acts a where a.id = stale;
  perform set_config('kayfabb.move_end_writer', '', true);
  -- A move in force that landed two hours ago (on a board of no one's, so the rename above stays the one in force), for the order of the group.
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at)
  values ((select id from characters where staff = 'aq-boss'), 'move', (select value #>> '{}' from settings where key = 'systemAnnouncements')::uuid,
    jsonb_build_object('kind', 'renameBoard', 'body', 'Landed.', 'params', jsonb_build_object('board', gen_random_uuid(), 'name', 'Older Oak', 'premise', 'p', 'description', 'd')),
    now() - interval '2 hours') returning id into older;
  perform set_config('kayfabb.staff_writer', '', true);
  -- The tick records a row it could not land (0048); the queue shows it, so an admin can hold it.
  update queued_moves set failed_at = now(), failure = 'it did not land' where id = later;
  -- A post on the board after the tick counted the move: the queue shows the tick's stored count (0053), not a live one.
  perform tests.post(tests.character(tests.account('aq-poster'), 'Queue Poster'), tests.thread('Queue thread'), 'after the count', now() + interval '1 second');
  perform tests.become(admin);
  q := admin_queue();
  perform tests.unbecome();
  if (q ->> 'cap')::integer is distinct from 100 or q -> 'more' is distinct from '{"waiting": false, "inForce": false, "ended": false}'::jsonb then raise exception 'the cap and what was cut are %, %', q -> 'cap', q -> 'more'; end if;
  -- Waiting: only the one not yet due, with its Boss, its why in the Boss's words, its times, and the board's name now.
  if jsonb_array_length(q -> 'waiting') is distinct from 1 then raise exception 'waiting holds % moves: %', jsonb_array_length(q -> 'waiting'), q -> 'waiting'; end if;
  if q #>> '{waiting,0,id}' is distinct from later::text or q #>> '{waiting,0,why}' is distinct from 'because Waiting Way' or q #>> '{waiting,0,boss}' is distinct from 'Queue Boss'
     or q #>> '{waiting,0,staff}' is distinct from 'aq-boss' or q #>> '{waiting,0,kind}' is distinct from 'renameBoard' or q #>> '{waiting,0,structural}' is distinct from 'true'
     or q #>> '{waiting,0,params,name}' is distinct from 'Waiting Way' or q #>> '{waiting,0,demand,kind}' is distinct from 'postsOnBoard'
     or (q #>> '{waiting,0,goLiveAt}')::timestamptz is distinct from (select go_live_at from queued_moves where id = later)
     or (q #>> '{waiting,0,expiresAt}')::timestamptz is distinct from (select expires_at from queued_moves where id = later)
     or q #>> '{waiting,0,boardName}' is distinct from 'Due Dune' or q #>> '{waiting,0,failure}' is distinct from 'it did not land' or (q #>> '{waiting,0,failedAt}') is null then
    raise exception 'the waiting move reads %', q -> 'waiting' -> 0;
  end if;
  -- In force: the move that landed now and an older one, newest first, the due one with its progress; the met one is not here.
  if (select array_agg(j ->> 'act' order by o) from jsonb_array_elements(q -> 'inForce') with ordinality as t(j, o)) is distinct from array[landed::text, older::text] then
    raise exception 'in force holds %', (select array_agg(j ->> 'act' order by o) from jsonb_array_elements(q -> 'inForce') with ordinality as t(j, o));
  end if;
  if exists (select 1 from jsonb_array_elements(q -> 'inForce') j where j ->> 'act' = met::text) then raise exception 'a move with an end is in force'; end if;
  if q #>> '{inForce,0,act}' is distinct from landed::text or q #>> '{inForce,0,progress,of}' is distinct from '5' or q #>> '{inForce,0,progress,done}' is distinct from '0'
     or q #>> '{inForce,0,boss}' is distinct from 'Queue Boss' or q #>> '{inForce,0,why}' is distinct from 'because Due Dune' or q #>> '{inForce,0,id}' is distinct from due::text
     or q #>> '{inForce,0,demand,kind}' is distinct from 'postsOnBoard' or q #>> '{inForce,0,landedAt}' is null or q #>> '{inForce,0,expiresAt}' is null then
    raise exception 'the move in force reads %', q -> 'inForce' -> 0;
  end if;
  -- Its progress is the one the tick stored: 0 of 5 (a live count would say 1, the post above), counted when the tick ran. A move that asks
  -- nothing was never counted: no number, and no time.
  if q #>> '{inForce,0,progress,checkedAt}' is null or (q #>> '{inForce,0,progress,checkedAt}')::timestamptz is distinct from (select checked_at from open_moves where move_act = landed) then
    raise exception 'the move in force was counted at %', q #>> '{inForce,0,progress,checkedAt}';
  end if;
  if q #> '{inForce,1,progress}' is distinct from '{"checkedAt": null}'::jsonb then raise exception 'a move never counted reads %', q #> '{inForce,1,progress}'; end if;
  -- Ended: the held one and the met one; the hold of 40 days ago is gone from the window.
  if jsonb_array_length(q -> 'ended') is distinct from 2 then raise exception 'ended holds % moves: %', jsonb_array_length(q -> 'ended'), q -> 'ended'; end if;
  if not exists (select 1 from jsonb_array_elements(q -> 'ended') j where j ->> 'how' = 'held' and j ->> 'id' = held::text and j ->> 'act' is null and j ->> 'why' = 'because Held Hall' and j #>> '{params,name}' = 'Held Hall')
     or not exists (select 1 from jsonb_array_elements(q -> 'ended') j where j ->> 'how' = 'met' and j ->> 'act' = met::text and j ->> 'by' = 'demand' and j ->> 'at' is not null) then
    raise exception 'ended reads %', q -> 'ended';
  end if;
  if exists (select 1 from jsonb_array_elements(q -> 'ended') j where j ->> 'act' = stale::text) then raise exception 'a move that ended 40 days ago is in the last 30 days'; end if;
  if q::text like '%held_by%' or q::text like '%' || admin::text || '%' then raise exception 'the admin queue names which admin held a move'; end if;
end $$;

-- ---- A group is cut at the cap and says so: 101 waiting rows give 100, and `more` says one was left out (a throwaway: undone below) ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'aq-admin@test.invalid');
  i integer;
  q jsonb;
begin
  for i in 1..100 loop
    perform pg_temp.queued('Bulk ' || lpad(i::text, 3, '0'), now() + interval '2 hours' + i * interval '1 minute');
  end loop;
  perform tests.become(admin); q := admin_queue(); perform tests.unbecome();
  if (select count(*) from queued_moves where landed_act is null and held_at is null) is distinct from 101::bigint then raise exception 'the throwaway queue is not 101 rows'; end if;
  if jsonb_array_length(q -> 'waiting') is distinct from 100 or (q -> 'more' ->> 'waiting')::boolean is distinct from true then
    raise exception 'waiting holds % of 101 and more.waiting is %', jsonb_array_length(q -> 'waiting'), q -> 'more' -> 'waiting';
  end if;
  if q #>> '{waiting,99,params,name}' is distinct from 'Bulk 099' then raise exception 'the cut kept the wrong rows: the last is %', q #>> '{waiting,99,params,name}'; end if;
  if (q -> 'more' ->> 'inForce')::boolean or (q -> 'more' ->> 'ended')::boolean then raise exception 'a group that was not cut says it was: %', q -> 'more'; end if;
  raise exception 'throwaway' using errcode = 'P9999';
exception when sqlstate 'P9999' then null;
end $$;

-- ---- An admin reverses a landed rename: the old name returns, the move ends reversed by an admin, the Boss says so once ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'aq-admin@test.invalid');
  player uuid := (select id from auth.users where email = 'aq-player@test.invalid');
  due bigint := pg_temp.q('Due Dune');
  held bigint := pg_temp.q('Held Hall');
  landed uuid;
  ann uuid := (select value #>> '{}' from settings where key = 'systemAnnouncements')::uuid;
  old_name text := (select name from boards where slug = 'general');
  q jsonb;
  d jsonb;
  post uuid;
begin
  landed := (select landed_act from queued_moves where id = due);
  if (select name from boards_now where slug = 'general') is distinct from 'Due Dune' then raise exception 'the rename is not in force before the reversal'; end if;
  perform tests.become(admin);
  perform reverse_move(landed);
  perform tests.unbecome();
  if (select name from boards_now where slug = 'general') is distinct from old_name then raise exception 'the old name did not return: %', (select name from boards_now where slug = 'general'); end if;
  if (select e.payload ->> 'why' || '/' || (e.payload ->> 'by') from acts e where e.kind = 'move_end' and e.target_act_id = landed) is distinct from 'reversed/admin' then raise exception 'the move did not end reversed by an admin'; end if;
  if exists (select 1 from open_moves where move_act = landed) then raise exception 'a reversed move is still in force'; end if;
  -- The Boss says it, once, in the announcements thread, in the stock line for a reversal.
  if (select count(*) from acts a where a.kind = 'post' and a.thread = ann and a.payload ->> 'body' = 'Overruled: the renaming of a board to "Due Dune".') is distinct from 1::bigint then
    raise exception 'the Boss said the reversal % times', (select count(*) from acts a where a.kind = 'post' and a.thread = ann and a.payload ->> 'body' = 'Overruled: the renaming of a board to "Due Dune".');
  end if;
  if (select a.character from acts a where a.payload ->> 'body' like 'Overruled:%') is distinct from (select id from characters where staff = 'aq-boss') then raise exception 'the reversal was not said by the move''s Boss'; end if;
  -- Reversing again, reversing what is no move, and the tick: refused in words, and nothing more is written or said.
  post := (select a.id from acts a where a.kind = 'post' and a.payload ->> 'body' like 'Overruled:%');
  perform tests.become(admin);
  begin perform reverse_move(landed); raise exception 'a reversed move was reversed again'; exception when others then
    if sqlstate <> '55000' or sqlerrm <> 'that move has already ended' then raise exception 'reversing an ended move said % (%)', sqlerrm, sqlstate; end if;
  end;
  begin perform reverse_move(post); raise exception 'a post was reversed'; exception when others then
    if sqlstate <> 'P0002' or sqlerrm <> 'that is not a move' then raise exception 'reversing a post said % (%)', sqlerrm, sqlstate; end if;
  end;
  perform tests.unbecome();
  perform system_tick();
  if (select count(*) from acts a where a.kind = 'move_end' and a.target_act_id = landed) is distinct from 1::bigint or (select count(*) from acts a where a.kind = 'post' and a.payload ->> 'body' like 'Overruled:%') is distinct from 1::bigint then
    raise exception 'a refused reversal or a tick ended or said it again';
  end if;
  -- The ended group of the queue says how it ended.
  perform tests.become(admin); q := admin_queue(); perform tests.unbecome();
  if not exists (select 1 from jsonb_array_elements(q -> 'ended') j where j ->> 'how' = 'reversed' and j ->> 'by' = 'admin' and j ->> 'act' = landed::text and j #>> '{params,name}' = 'Due Dune')
     or not exists (select 1 from jsonb_array_elements(q -> 'ended') j where j ->> 'how' = 'held' and j ->> 'id' = held::text) then
    raise exception 'ended reads %', q -> 'ended';
  end if;
  if exists (select 1 from jsonb_array_elements(q -> 'inForce') j where j ->> 'act' = landed::text) then raise exception 'a reversed move is in force in the queue'; end if;
  insert into settings (key, value) values ('digestThreads', '3'), ('digestExcerpts', '10'), ('digestExcerptChars', '50') on conflict (key) do update set value = excluded.value;
  -- The next digest lists both: the reversed move as ended by an admin, the held one as held, with the Boss's own words and no admin.
  d := system_digest(now() - interval '1 hour', now() + interval '1 hour');
  if not exists (select 1 from jsonb_array_elements(d -> 'moves') m where m ->> 'act' = landed::text and m ->> 'state' = 'ended' and m #>> '{ended,why}' = 'reversed' and m #>> '{ended,by}' = 'admin') then
    raise exception 'the digest does not list the reversed move: %', d -> 'moves';
  end if;
  if not exists (select 1 from jsonb_array_elements(d -> 'moves') m where m ->> 'state' = 'held' and m ->> 'act' is null and m ->> 'kind' = 'renameBoard' and m #>> '{params,name}' = 'Held Hall'
                 and m ->> 'why' = 'because Held Hall' and m ->> 'heldAt' is not null and m #>> '{demand,kind}' = 'postsOnBoard' and m -> 'progress' = 'null'::jsonb and m -> 'ended' = 'null'::jsonb) then
    raise exception 'the digest does not list the held move: %', d -> 'moves';
  end if;
  if d::text like '%' || admin::text || '%' or d::text like '%held_by%' then raise exception 'the digest names the admin who held a move'; end if;
  -- A window the hold and the reversal are not in lists neither.
  d := system_digest(now() + interval '1 hour', now() + interval '2 hours');
  if exists (select 1 from jsonb_array_elements(d -> 'moves') m where m ->> 'state' in ('held', 'ended')) then raise exception 'a later window lists a hold or a reversal: %', d -> 'moves'; end if;
  -- The digest role still cannot read who held a move, nor can a player read the queue's table.
  if has_column_privilege('kayfabb_digest', 'queued_moves', 'held_by', 'select') then raise exception 'the digest role reads held_by'; end if;
  perform tests.become(player);
  begin perform 1 from queued_moves; raise exception 'a player read queued_moves'; exception when insufficient_privilege then null; end;
  perform tests.unbecome();
end $$;

-- ---- A hold is never crowded out of the digest: more moves in force than digestExcerpts, and a hold is still listed ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'aq-admin@test.invalid');
  ann uuid := (select value #>> '{}' from settings where key = 'systemAnnouncements')::uuid;
  g uuid := (select id from boards where slug = 'general');
  fresh bigint;
  i integer;
  d jsonb;
begin
  insert into settings (key, value) values ('digestThreads', '3'), ('digestExcerpts', '2'), ('digestExcerptChars', '50') on conflict (key) do update set value = excluded.value;
  for i in 1..3 loop
    perform write_staff_act('aq-boss', 'move', ann, null,
      jsonb_build_object('kind', 'renameBoard', 'body', 'Landed.', 'params', jsonb_build_object('board', g, 'name', 'Crowd ' || i, 'premise', 'p', 'description', 'd')));
  end loop;
  fresh := pg_temp.queued('Fresh Fold', now() + interval '1 hour');
  perform tests.become(admin); perform hold_move(fresh); perform tests.unbecome();
  d := system_digest(now() - interval '1 hour', now() + interval '1 hour');
  if jsonb_array_length(d -> 'moves') > 2 then raise exception 'the digest holds more moves than digestExcerpts: %', d -> 'moves'; end if;
  if not exists (select 1 from jsonb_array_elements(d -> 'moves') m where m ->> 'state' = 'held') then
    raise exception 'three moves in force crowded the hold out of a digest capped at 2: %', d -> 'moves';
  end if;
end $$;
