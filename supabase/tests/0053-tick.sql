-- The tick: The System's standing orders, every minute (supabase/migrations/0048_tick.sql; the system plan, Task 10; the system
-- design, sections 2, 3 and 7). system_tick() lands each queued move whose time has come (not held, while The System is on), as its
-- own staff member, with the stock line for it; and ends each landed move whose demand is met or whose expiry has passed, whatever
-- the switch says. It runs again and again, so each of those happens once. It costs what the moves due and the moves in force cost,
-- never what the history of moves does. The poison of the two reads: a plan that walks the moves already landed. The tick checks
-- a move's expiry every minute, but its demand only every demandCheckMinutes and for at most demandChecksPerTick moves a minute,
-- oldest check first, within a time budget; a move that cannot land is recorded on its row and never stops the rest.

-- ---- A seed with the instance's words in it: the stock lines, the move words, the announcements thread ----
do $$
declare
  seed jsonb;
  g uuid;
  ann uuid;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true,
      'systemLines', jsonb_build_object(
        'moveLanded', jsonb_build_array('It is done: {move}.'),
        'moveMet', jsonb_build_array('Met: {move}.'),
        'moveExpired', jsonb_build_array('Expired: {move}.'),
        'bossArrival', jsonb_build_array('{boss} on {board} for {move}.')),
      'systemMoveWords', jsonb_build_object('renameBoard', 'the renaming of a board to "{name}"')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'tk-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'tk-boss', 'name', 'Tick Boss', 'kind', 'boss', 'title', 'Boss', 'signature', 'Hi')),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(jsonb_build_object('key', 'renameBoard', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'), jsonb_build_object('key', 'shout'))));
  perform seed_instance(seed);
  perform seed_instance(seed);
  -- The announcements thread: one, on The System's board, titled from the seed, recorded where the tick finds it. A reseed makes no second.
  if (select count(*) from threads t join boards b on b.id = t.board where b.is_system and t.title = 'Announcements') is distinct from 1::bigint then
    raise exception 'two seeds left % announcements threads', (select count(*) from threads t join boards b on b.id = t.board where b.is_system and t.title = 'Announcements');
  end if;
  ann := (select value #>> '{}' from settings where key = 'systemAnnouncements')::uuid;
  if ann is distinct from (select t.id from threads t join boards b on b.id = t.board where b.is_system and t.title = 'Announcements') then raise exception 'the announcements thread is not recorded in systemAnnouncements'; end if;
  -- The tick is scheduled, every minute.
  if (select schedule from cron.job where jobname = 'kayfabb-system-tick') is distinct from '* * * * *' then raise exception 'the system tick is not scheduled every minute'; end if;
  -- It is the service's and the cron's, not a client's.
  if has_function_privilege('authenticated', 'system_tick()', 'execute') or has_function_privilege('anon', 'system_tick()', 'execute') or not has_function_privilege('service_role', 'system_tick()', 'execute') then
    raise exception 'system_tick is executable by the wrong roles';
  end if;
  -- A line fills its tokens: the Boss's name, the board's current name, the move's plain words.
  g := (select id from boards where slug = 'general');
  if system_line('bossArrival', 'renameBoard', jsonb_build_object('board', g, 'name', 'Toast Palace'), 'tk-boss') is distinct from 'Tick Boss on General for the renaming of a board to "Toast Palace".' then
    raise exception 'a stock line filled to %', system_line('bossArrival', 'renameBoard', jsonb_build_object('board', g, 'name', 'Toast Palace'), 'tk-boss');
  end if;
  -- Words a model supplied are put in once and never read as tokens: a board named {boss}, {premise} or {board} shows as typed.
  if system_line('bossArrival', 'renameBoard', jsonb_build_object('board', g, 'name', '{boss}', 'premise', 'Secret'), 'tk-boss') is distinct from 'Tick Boss on General for the renaming of a board to "{boss}".' then
    raise exception 'a name {boss} was filled: %', system_line('bossArrival', 'renameBoard', jsonb_build_object('board', g, 'name', '{boss}', 'premise', 'Secret'), 'tk-boss');
  end if;
  if system_line('moveLanded', 'renameBoard', jsonb_build_object('board', g, 'name', '{premise}', 'premise', 'Secret'), 'tk-boss') is distinct from 'It is done: the renaming of a board to "{premise}".' then
    raise exception 'a name {premise} was filled: %', system_line('moveLanded', 'renameBoard', jsonb_build_object('board', g, 'name', '{premise}', 'premise', 'Secret'), 'tk-boss');
  end if;
  if system_line('bossArrival', 'renameBoard', jsonb_build_object('board', g, 'name', '{board} {move}'), 'tk-boss') is distinct from 'Tick Boss on General for the renaming of a board to "{board} {move}".' then
    raise exception 'a name {board} {move} was filled: %', system_line('bossArrival', 'renameBoard', jsonb_build_object('board', g, 'name', '{board} {move}'), 'tk-boss');
  end if;
  -- A move kind with no plain words falls back to "a move", never the raw key; a line the instance lacks leaves the plain words alone.
  if system_line('moveLanded', 'lockThread', '{}'::jsonb, 'tk-boss') is distinct from 'It is done: a move.' then raise exception 'a move with no words read %', system_line('moveLanded', 'lockThread', '{}'::jsonb, 'tk-boss'); end if;
  if system_line('noSuchLine', 'lockThread', '{}'::jsonb, 'tk-boss') is distinct from 'a move' then raise exception 'a missing line and missing words read %', system_line('noSuchLine', 'lockThread', '{}'::jsonb, 'tk-boss'); end if;
end $$;

-- A landed move's Act, written as a landed move is; its demand may be any the catalogs hold.
create function pg_temp.landed(new_name text, demand jsonb, expires timestamptz) returns uuid language plpgsql as $$
begin
  return (write_staff_act('tk-boss', 'move', (select value #>> '{}' from settings where key = 'systemAnnouncements')::uuid, null,
    jsonb_strip_nulls(jsonb_build_object('kind', 'renameBoard', 'body', 'Landed.',
      'params', jsonb_build_object('board', (select id from boards where slug = 'general'), 'name', new_name, 'premise', 'The subject of ' || new_name, 'description', 'About ' || new_name),
      'demand', demand, 'expires_at', expires))) ->> 'id')::uuid;
end $$;
-- A player's post lands the demands of one post; a tick otherwise skips a move checked a moment ago, so a test that expects the next
-- tick to see a new post says its moves are due for a check.
create function pg_temp.recheck() returns void language sql as $$ update open_moves set checked_at = null $$;
create function pg_temp.queued(new_name text, go_live timestamptz, held boolean default false, boss text default 'tk-boss') returns bigint language plpgsql as $$
declare
  m bigint;
  q bigint;
begin
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural, held_at, held_by)
  values (m, boss, 'renameBoard',
    jsonb_build_object('board', (select id from boards where slug = 'general'), 'name', new_name, 'premise', 'The subject of ' || new_name, 'description', 'About ' || new_name),
    jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', (select id from boards where slug = 'general'), 'count', 5)),
    'because', go_live, go_live + interval '3 days', true,
    case when held then now() end, case when held then tests.account('tk-admin-' || new_name) end) returning id into q;
  return q;
end $$;

-- ---- A due move lands once, even when the tick runs twice; a held move and a move not yet due never land ----
do $$
declare
  due bigint := pg_temp.queued('Toast Palace', now() - interval '1 hour');
  held bigint := pg_temp.queued('Held Hall', now() - interval '1 hour', true);
  later bigint := pg_temp.queued('Later Land', now() + interval '1 hour');
  act uuid;
  ann uuid := (select value #>> '{}' from settings where key = 'systemAnnouncements')::uuid;
  ran jsonb;
begin
  ran := system_tick();
  if (ran ->> 'landed')::integer is distinct from 1 or (ran ->> 'failed')::integer is distinct from 0 then raise exception 'the first tick landed % moves: %', ran ->> 'landed', ran; end if;
  act := (select landed_act from queued_moves where id = due);
  if act is null then raise exception 'a due move did not land'; end if;
  -- It is the Boss's move Act in the announcements thread, its body the stock line with its tokens filled, its params and expiry as queued.
  if (select a.character::text || '|' || a.kind || '|' || a.thread::text from acts a where a.id = act)
     is distinct from (select c.id::text || '|move|' || ann::text from characters c where c.staff = 'tk-boss') then raise exception 'the move Act is not the Boss''s move in the announcements thread'; end if;
  if (select a.payload ->> 'body' from acts a where a.id = act) is distinct from 'It is done: the renaming of a board to "Toast Palace".' then
    raise exception 'the move''s body is %', (select a.payload ->> 'body' from acts a where a.id = act);
  end if;
  if (select (a.payload ->> 'expires_at')::timestamptz from acts a where a.id = act) is distinct from (select expires_at from queued_moves where id = due) then raise exception 'the landed move''s expiry is not the queued one'; end if;
  if (select a.payload #>> '{demand,kind}' from acts a where a.id = act) is distinct from 'postsOnBoard' then raise exception 'the landed move lost its demand'; end if;
  -- Again, and a third time: nothing more lands.
  ran := system_tick();
  perform system_tick();
  if (ran ->> 'landed')::integer is distinct from 0 then raise exception 'the second tick landed again'; end if;
  if (select count(*) from acts a where a.kind = 'move' and a.payload #>> '{params,name}' = 'Toast Palace') is distinct from 1::bigint then raise exception 'one queued move became % move Acts', (select count(*) from acts a where a.kind = 'move' and a.payload #>> '{params,name}' = 'Toast Palace'); end if;
  if (select landed_act from queued_moves where id = due) is distinct from act then raise exception 'a second tick re-pointed a landed move'; end if;
  -- The held move never landed, and neither did the one not due; the landed one is in force, so the board is called what it says.
  if (select landed_act from queued_moves where id = held) is not null or exists (select 1 from acts a where a.kind = 'move' and a.payload #>> '{params,name}' = 'Held Hall') then raise exception 'a held move landed'; end if;
  if (select landed_act from queued_moves where id = later) is not null then raise exception 'a move landed before its time'; end if;
  if (select name from boards_now where slug = 'general') is distinct from 'Toast Palace' then raise exception 'the landed rename is not in force'; end if;
  -- Ended by hand, as an admin's reversal will, so the board is the next section's to find as it was.
  perform end_move(act, 'reversed', 'test');
end $$;

-- ---- A met demand ends its move with `met` and the old name returns; an expired move ends with `expired`; the Boss says so ----
do $$
declare
  g uuid := (select id from boards where slug = 'general');
  ann uuid := (select value #>> '{}' from settings where key = 'systemAnnouncements')::uuid;
  pc uuid := tests.character(tests.account('tk-player'), 'Tk Player');
  th uuid := tests.thread('Tk thread');
  mv_met uuid := pg_temp.landed('Met Manor', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', g, 'count', 1)), now() + interval '2 days');
  mv_open uuid := pg_temp.landed('Open Oasis', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', g, 'count', 9)), now() + interval '2 days');
  mv_old uuid := pg_temp.landed('Old Orchard', null, now() - interval '1 minute');
  mv_never uuid := pg_temp.landed('Never Nook', null, null);
  ran jsonb;
begin
  -- Before any post, nothing is met; the one past its expiry is over.
  perform system_tick();
  if exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id in (mv_met, mv_open, mv_never)) then raise exception 'a move ended before its demand was met or its time came'; end if;
  if (select e.payload ->> 'why' || '/' || (e.payload ->> 'by') from acts e where e.kind = 'move_end' and e.target_act_id = mv_old) is distinct from 'expired/expiry' then raise exception 'a move past its expiry did not end expired'; end if;
  -- A player posts on the board after the move landed: the demand of one post is met, the one of nine is not.
  perform tests.post(pc, th, 'Hello there.', now() + interval '1 minute');
  perform pg_temp.recheck();
  ran := system_tick();
  if (select e.payload ->> 'why' || '/' || (e.payload ->> 'by') from acts e where e.kind = 'move_end' and e.target_act_id = mv_met) is distinct from 'met/demand' then raise exception 'a met demand did not end its move met'; end if;
  if exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id in (mv_open, mv_never)) then raise exception 'a move whose demand is not met, or that has none, ended'; end if;
  if (ran ->> 'met')::integer is distinct from 1 or (ran ->> 'expired')::integer is distinct from 0 or (ran ->> 'failed')::integer is distinct from 0 then raise exception 'the tick counted %', ran; end if;
  -- The Boss says it in the announcements thread, in the stock line for it, once.
  if (select count(*) from acts a where a.kind = 'post' and a.thread = ann and a.payload ->> 'body' = 'Met: the renaming of a board to "Met Manor".') is distinct from 1::bigint then raise exception 'the Boss did not say the demand was met once'; end if;
  if (select count(*) from acts a where a.kind = 'post' and a.thread = ann and a.payload ->> 'body' = 'Expired: the renaming of a board to "Old Orchard".') is distinct from 1::bigint then raise exception 'the Boss did not say the move expired once'; end if;
  if (select a.character from acts a where a.payload ->> 'body' = 'Met: the renaming of a board to "Met Manor".') is distinct from (select id from characters where staff = 'tk-boss') then raise exception 'the end was not said by the move''s Boss'; end if;
  perform system_tick();
  if (select count(*) from acts e where e.kind = 'move_end' and e.target_act_id in (mv_met, mv_old)) is distinct from 2::bigint or (select count(*) from acts a where a.kind = 'post' and a.thread = ann and a.payload ->> 'body' like 'Met:%') is distinct from 1::bigint then
    raise exception 'a second tick ended or spoke again';
  end if;
  -- The old name returns when its rename ends: only the moves still in force name the board now.
  perform end_move(mv_open, 'reversed', 'test');
  perform end_move(mv_never, 'reversed', 'test');
  if (select name from boards_now where slug = 'general') is distinct from 'General' then raise exception 'the old name did not return: %', (select name from boards_now where slug = 'general'); end if;
end $$;
do $$
declare
  g uuid := (select id from boards where slug = 'general');
  mv_met uuid;
begin
  -- A rename in force is shown, and its demand met by a later post brings the old name back.
  mv_met := pg_temp.landed('Returned Realm', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', g, 'count', 1)), now() + interval '2 days');
  if (select name from boards_now where slug = 'general') is distinct from 'Returned Realm' then raise exception 'the rename is not in force'; end if;
  perform tests.post((select id from characters where name = 'Tk Player'), (select id from threads where title = 'Tk thread'), 'Again.', now() + interval '2 minutes');
  perform pg_temp.recheck();
  perform system_tick();
  if (select payload ->> 'why' from acts where kind = 'move_end' and target_act_id = mv_met) is distinct from 'met' then raise exception 'the met demand did not end the move'; end if;
  if (select name from boards_now where slug = 'general') is distinct from 'General' then raise exception 'the old name did not return when the demand was met'; end if;
end $$;

-- ---- With The System switched off, nothing lands, but a met or expired landed move still ends ----
do $$
declare
  g uuid := (select id from boards where slug = 'general');
  due bigint := pg_temp.queued('Off Outpost', now() - interval '1 hour');
  mv_old uuid := pg_temp.landed('Off Orchard', null, now() - interval '1 minute');
  mv_met uuid := pg_temp.landed('Off Manor', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', g, 'count', 1)), now() + interval '2 days');
  ran jsonb;
begin
  perform tests.post((select id from characters where name = 'Tk Player'), (select id from threads where title = 'Tk thread'), 'More.', now() + interval '3 minutes');
  update settings set value = 'false' where key = 'systemEnabled';
  perform pg_temp.recheck();
  ran := system_tick();
  if (select landed_act from queued_moves where id = due) is not null or (ran ->> 'landed')::integer is distinct from 0 or (ran ->> 'failed')::integer is distinct from 0 then raise exception 'a move landed with The System off: %', ran; end if;
  if (select count(*) from acts e where e.kind = 'move_end' and e.target_act_id in (mv_old, mv_met)) is distinct from 2::bigint then raise exception 'moves in force did not end with The System off'; end if;
  -- Switched on again, the move that waited lands: nothing was stranded.
  -- (Every due structural row lands at once when The System comes back, as intended: the admin queue shows such rows as waiting, and an
  -- admin holds the ones they do not want before switching The System back on.)
  update settings set value = 'true' where key = 'systemEnabled';
  ran := system_tick();
  if (select landed_act from queued_moves where id = due) is null or (ran ->> 'failed')::integer is distinct from 0 then raise exception 'the waiting move did not land when The System came back: %', ran; end if;
end $$;

-- ---- A move whose progress errors does not stop another ending, and it still expires ----
do $$
declare
  bad uuid := pg_temp.landed('Error Estate', jsonb_build_object('kind', 'shout', 'params', '{}'::jsonb), now() + interval '2 days');
  bad_old uuid := pg_temp.landed('Error Edge', jsonb_build_object('kind', 'shout', 'params', '{}'::jsonb), now() - interval '1 minute');
  good uuid := pg_temp.landed('Good Grove', null, now() - interval '1 minute');
begin
  if (demand_progress_or_error(bad) ->> 'error') is null then raise exception 'the poison move''s progress does not error'; end if;
  perform system_tick();
  if exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = bad) then raise exception 'a move whose progress errors was ended by the demand'; end if;
  if (select e.payload ->> 'why' from acts e where e.kind = 'move_end' and e.target_act_id = good) is distinct from 'expired' then raise exception 'one bad move stopped another from ending'; end if;
  if (select e.payload ->> 'why' from acts e where e.kind = 'move_end' and e.target_act_id = bad_old) is distinct from 'expired' then raise exception 'a move whose progress errors did not expire'; end if;
  -- What the tick read is stored on the move's row (0053), the evaluator's error form included, so a board shows it as it shows any count.
  if (select progress ->> 'error' from open_moves where move_act = bad) is null then raise exception 'the tick did not store the error form of a count that failed: %', (select progress from open_moves where move_act = bad); end if;
  perform end_move(bad, 'reversed', 'test');
end $$;

-- ---- Demand checks are paced: at most demandChecksPerTick a tick, oldest first; a move checked lately waits demandCheckMinutes; expiry ignores both ----
do $$
declare
  g uuid := (select id from boards where slug = 'general');
  pc uuid := (select id from characters where name = 'Tk Player');
  th uuid := (select id from threads where title = 'Tk thread');
  met uuid[] := '{}';
  one uuid;
  ran jsonb;
  ended integer;
begin
  perform end_move(o.move_act, 'reversed', 'test') from open_moves o;
  insert into settings (key, value) values ('demandChecksPerTick', '2'), ('demandCheckMinutes', '5') on conflict (key) do update set value = excluded.value;
  -- Five moves whose one-post demand a later post meets: with two checks a tick, one tick ends two, the next two more, the last one.
  for i in 1..5 loop met := met || pg_temp.landed('Pace ' || i, jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', g, 'count', 1)), now() + interval '2 days'); end loop;
  perform tests.post(pc, th, 'Pacing.', now() + interval '10 minutes');
  ran := system_tick();
  ended := (select count(*) from acts e where e.kind = 'move_end' and e.target_act_id = any (met));
  if ended <> 2 or (ran ->> 'met')::integer <> 2 or (ran ->> 'checked')::integer <> 2 then raise exception 'one tick with a cap of 2 ended % of five met moves: %', ended, ran; end if;
  ran := system_tick();
  if (select count(*) from acts e where e.kind = 'move_end' and e.target_act_id = any (met)) is distinct from 4::bigint or (ran ->> 'met')::integer <> 2 then raise exception 'the next tick did not end two more: %', ran; end if;
  ran := system_tick();
  if (select count(*) from acts e where e.kind = 'move_end' and e.target_act_id = any (met)) is distinct from 5::bigint or (ran ->> 'failed')::integer <> 0 then raise exception 'the third tick did not end the last: %', ran; end if;

  -- A move checked a minute ago is not checked again until demandCheckMinutes have passed: its demand is met in between and it still waits.
  update settings set value = '40' where key = 'demandChecksPerTick';
  one := pg_temp.landed('Patient Pier', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', g, 'count', 1)), now() + interval '2 days');
  update open_moves set checked_at = now() - interval '1 minute' where move_act = one;
  ran := system_tick();
  if exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = one) or (ran ->> 'checked')::integer <> 0 then raise exception 'a move checked a minute ago was checked again: %', ran; end if;
  update open_moves set checked_at = now() - interval '5 minutes' where move_act = one;
  ran := system_tick();
  if (select e.payload ->> 'why' from acts e where e.kind = 'move_end' and e.target_act_id = one) is distinct from 'met' or (ran ->> 'checked')::integer <> 1 then raise exception 'a move checked five minutes ago was not checked: %', ran; end if;

  -- Expiry is checked for every move in force each tick, whatever the cap: three expired moves end in a tick that may check one demand.
  update settings set value = '1' where key = 'demandChecksPerTick';
  for i in 1..3 loop perform pg_temp.landed('Lapsed ' || i, null, now() - interval '1 minute'); end loop;
  perform pg_temp.landed('Unmet Umbra', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', g, 'count', 99)), now() + interval '2 days');
  perform pg_temp.landed('Unmet Umbra Two', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', g, 'count', 99)), now() + interval '2 days');
  ran := system_tick();
  if (ran ->> 'expired')::integer <> 3 or (ran ->> 'checked')::integer <> 1 then raise exception 'expiry was held to the demand cap: %', ran; end if;

  -- The checks rotate: each check is recorded on the move, so with a cap of one the next tick checks a different move,
  -- never the same one again; the one checked longest ago (or never) goes first. Two unmet moves, the one with the
  -- smaller id checked ten minutes ago and the other never: the never-checked one goes first, then the old one, and
  -- both carry the time they were checked. An order by id instead would take the old one first.
  perform end_move(o.move_act, 'reversed', 'test') from open_moves o;
  update settings set value = '1' where key = 'demandChecksPerTick';
  declare
    x uuid := pg_temp.landed('Rota Ridge', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', g, 'count', 99)), now() + interval '2 days');
    y uuid := pg_temp.landed('Rota Reef', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', g, 'count', 99)), now() + interval '2 days');
    older uuid := least(x, y);
    never uuid := greatest(x, y);
  begin
    update open_moves set checked_at = null where move_act in (x, y);
    update open_moves set checked_at = now() - interval '10 minutes' where move_act = older;
    ran := system_tick();
    if (ran ->> 'checked')::integer <> 1 or (select checked_at from open_moves where move_act = never) is distinct from now() then
      raise exception 'the first tick did not check the never-checked move first and record it: %', ran;
    end if;
    ran := system_tick();
    if (ran ->> 'checked')::integer <> 1 or (select checked_at from open_moves where move_act = older) is distinct from now() then
      raise exception 'the second tick did not move on to the move checked longest ago: %', ran;
    end if;
    ran := system_tick();
    if (ran ->> 'checked')::integer <> 0 then raise exception 'a third tick checked a move it had just checked: %', ran; end if;
  end;

  -- A tick past its time budget stops checking demands and carries on next minute; expiry still ends moves.
  update settings set value = '40' where key = 'demandChecksPerTick';
  perform pg_temp.landed('Budget Barn', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', g, 'count', 1)), now() + interval '2 days');
  perform pg_temp.landed('Budget Brook', null, now() - interval '1 minute');
  perform pg_temp.recheck();
  perform set_config('kayfabb.tick_budget_seconds', '0', true);
  ran := system_tick();
  perform set_config('kayfabb.tick_budget_seconds', '', true);
  if (ran ->> 'checked')::integer <> 0 or (ran ->> 'expired')::integer <> 1 or (ran ->> 'budget')::boolean is not true then raise exception 'a tick out of time checked demands: %', ran; end if;
  ran := system_tick();
  if (ran ->> 'met')::integer < 1 or (ran ->> 'budget')::boolean is not false then raise exception 'the next minute did not carry on: %', ran; end if;
  perform end_move(o.move_act, 'reversed', 'test') from open_moves o;
  update settings set value = '40' where key = 'demandChecksPerTick';
end $$;

-- ---- A queued move that cannot land is recorded on its row and never stops the next; it stays due until an admin holds it ----
do $$
declare
  bad bigint;
  good bigint;
  ran jsonb;
  at1 timestamptz;
begin
  insert into characters (name, staff, staff_kind, debuted_at) values ('Tk Retired Boss', 'tk-boss-retired', 'boss', now());
  update characters set retired_at = now() where staff = 'tk-boss-retired';
  bad := pg_temp.queued('Bad Boss Bay', now() - interval '2 hours', false, 'tk-boss-retired');
  good := pg_temp.queued('Good Boss Bay', now() - interval '1 hour');
  ran := system_tick();
  if (ran ->> 'landed')::integer <> 1 or (ran ->> 'failed')::integer <> 1 then raise exception 'the tick counted %', ran; end if;
  if (select landed_act from queued_moves where id = good) is null then raise exception 'a failing row stopped the good one landing'; end if;
  if (select landed_act from queued_moves where id = bad) is not null or (select held_at from queued_moves where id = bad) is not null then raise exception 'the failing row landed or was held'; end if;
  if (select failed_at is null or failure is null or failure !~ 'retired' from queued_moves where id = bad) then raise exception 'the failure was not recorded: %', (select failure from queued_moves where id = bad); end if;
  if (select failed_at from queued_moves where id = good) is not null then raise exception 'a landed row records a failure'; end if;
  -- It stays due, and a later failure overwrites the earlier one.
  update queued_moves set failure = 'stale' where id = bad;
  ran := system_tick();
  if (ran ->> 'failed')::integer <> 1 or (select failure from queued_moves where id = bad) !~ 'retired' then raise exception 'the failing row was not tried again: %', ran; end if;
  -- An admin holds it: the way out. The tick leaves it alone.
  update queued_moves set held_at = now(), held_by = tests.account('tk-admin-bad') where id = bad;
  ran := system_tick();
  if (ran ->> 'failed')::integer <> 0 then raise exception 'a held row still failed: %', ran; end if;
  perform end_move(landed_act, 'reversed', 'test') from queued_moves where id = good;
end $$;

-- ---- No announcements thread: the tick says so, lands nothing, and still ends ----
do $$
declare
  was jsonb := (select value from settings where key = 'systemAnnouncements');
  due bigint;
  ran jsonb;
begin
  due := pg_temp.queued('Nowhere Nook', now() - interval '1 hour');
  delete from settings where key = 'systemAnnouncements';
  ran := system_tick();
  insert into settings (key, value) values ('systemAnnouncements', was);
  if (ran ->> 'noThread')::boolean is not true or (ran ->> 'landed')::integer <> 0 then raise exception 'a tick with no thread said %', ran; end if;
  if (select landed_act from queued_moves where id = due) is not null then raise exception 'a move landed with nowhere to say it'; end if;
  ran := system_tick();
  if (ran ->> 'noThread')::boolean is not false or (select landed_act from queued_moves where id = due) is null then raise exception 'the move did not land once the thread was back: %', ran; end if;
  perform end_move(landed_act, 'reversed', 'test') from queued_moves where id = due;
end $$;

-- ---- The tick's reads use their indexes, whatever the history ----
do $$
declare
  src text := regexp_replace((select prosrc from pg_proc where proname = 'system_tick' and pronamespace = 'public'::regnamespace), '\s+', ' ', 'g');
  due text := 'select q.id, q.staff, q.kind, q.params, q.demand, q.expires_at from queued_moves q where q.landed_act is null and q.held_at is null and q.go_live_at <= now() order by q.go_live_at, q.id for update skip locked';
  open_ text := 'select o.move_act, a.character, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act order by o.landed_at, o.move_act';
  demand_ text := 'select o.move_act, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act where jsonb_typeof(a.payload -> ''demand'') = ''object'' and (o.checked_at is null or o.checked_at <= now() - check_every) order by o.checked_at nulls first, o.move_act limit cap';
  m bigint;
  act uuid;
  plan text;
  line text;
  ran jsonb;
begin
  -- The reads below are the function's own, word for word, or the plans prove nothing about it.
  if position(due in src) = 0 then raise exception 'the due read in this test is not the tick''s'; end if;
  if position(open_ in src) = 0 then raise exception 'the open-moves read in this test is not the tick''s'; end if;
  if position(demand_ in src) = 0 then raise exception 'the demand-check read in this test is not the tick''s'; end if;
  -- A deep history: landed and ended moves, which neither read may touch.
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  for i in 1..300 loop
    act := pg_temp.landed('History ' || i, null, now() + interval '1 day');
    perform end_move(act, 'expired', 'test');
    insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural, landed_act)
    values (m, 'tk-boss', 'renameBoard', '{}'::jsonb, 'w', now() - interval '9 days', now() + interval '1 day', true, act);
  end loop;
  analyze queued_moves, open_moves, acts;
  -- With sequential scans switched off, the plans below can only be built from the indexes. That proves an index exists that matches each
  -- read's predicate and order; it does not prove the planner picks it on a given day's statistics.
  set local enable_seqscan = off;
  plan := '';
  for line in execute 'explain ' || replace(due, ' for update skip locked', '') loop plan := plan || line || E'\n'; end loop;
  if plan !~ 'queued_moves_due' then raise exception 'the due read does not use queued_moves_due: %', plan; end if;
  if plan ~ 'Seq Scan' then raise exception 'the due read walks a table: %', plan; end if;
  plan := '';
  for line in execute 'explain ' || open_ loop plan := plan || line || E'\n'; end loop;
  if plan !~ 'open_moves' then raise exception 'the open-moves read does not start from open_moves: %', plan; end if;
  if plan !~ 'acts_pkey' then raise exception 'the open-moves read does not probe the acts by their key: %', plan; end if;
  if plan ~ 'Seq Scan' then raise exception 'the open-moves read walks a table: %', plan; end if;
  plan := '';
  for line in execute 'explain ' || replace(replace(replace(demand_, 'check_every', '''5 minutes''::interval'), ' limit cap', ' limit 40'), 'now() - ', 'now() - ') loop plan := plan || line || E'\n'; end loop;
  if plan !~ 'open_moves_checked' then raise exception 'the demand-check read does not use open_moves_checked: %', plan; end if;
  if plan ~ 'Seq Scan' then raise exception 'the demand-check read walks a table: %', plan; end if;
  -- And the tick over that history lands nothing and ends nothing: the moves in force are the ones before it, and nothing here is due.
  ran := system_tick();
  if (ran ->> 'landed')::integer <> 0 or (ran ->> 'met')::integer <> 0 or (ran ->> 'expired')::integer <> 0 or (ran ->> 'failed')::integer <> 0 then
    raise exception 'the tick over a deep history did something: %', ran;
  end if;
end $$;
