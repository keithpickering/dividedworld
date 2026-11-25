-- The meeting's minutes (supabase/migrations/0431_minutes.sql; docs/plans/2026-11-24-staff-board-threads-plan.md, Task 6; the design, section 8).
--
-- The Boss's last part of a meeting may carry `minutes`: a few lines in its voice, which apply_meeting posts as the Boss in the season's Staff Meetings thread (seasons.meetings_thread), opened
-- on the system board by meetings_thread(season) the first time any are posted. Words only: nothing reads them as a move.
--
-- 1. A meeting with no minutes (none, blank, or not a string) opens no thread and posts nothing; its record says so (minutesPosted false).
-- 2. A meeting with minutes opens the season's Staff Meetings thread once, titled by the instance's `meetingsThreadTitle`, on the system board and listed there, and posts the words as written
--    by the Boss; the record says minutesPosted true.
-- 3. The next day's meeting posts in the same thread: one thread, two posts, in order.
-- 4. A second apply of an applied meeting posts nothing again.
-- 5. Minutes longer than postMaxLength are cut to it.
-- 6. The thread is one of the instance's own (instance_threads()), so it follows the system board's flag.
-- 7. The minutes are words that decide nothing: with the instance's `meetingsThreadTitle` missing, a meeting that carries minutes still applies (its moves and points land), the record says
--    minutesPosted false and minutesSkipped names the missing word, and no thread is opened (the sub-block rolled its own insert back).
-- 8. The same with a Boss that cannot write (retired): the meeting applies, the minutes are skipped with the reason, nothing is posted.
-- (Poison: apply_meeting posting before the already-applied check, or posting with `meetings_thread` read before the season's row is locked. Red on "an applied meeting posted its minutes again".)

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;
create function pg_temp.rename(board uuid, name text) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'renameBoard',
    'params', jsonb_build_object('board', board, 'name', name, 'premise', 'About ' || name, 'description', 'Welcome to ' || name),
    'demand', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', board, 'count', 5)),
    'go_live_at', now() + interval '48 hours', 'expires_in_hours', 48, 'why', 'Because.')
$$;
create function pg_temp.payload(general uuid, name text, extra jsonb) returns jsonb language sql as $$
  select jsonb_build_object('boss', 'mn-boss', 'weekly_moves', 0, 'bank_cap', 10, 'moves', jsonb_build_array(pg_temp.rename(general, name)), 'record', '{}'::jsonb) || extra
$$;

do $$
declare
  general uuid;
  sid bigint;
  m1 bigint; m2 bigint; m3 bigint; m4 bigint; m5 bigint; m6 bigint; m7 bigint; m8 bigint;
  threads_before integer;
  r jsonb;
  t uuid;
  posts integer;
begin
  select id into general from boards where slug = 'general';
  insert into characters (name, staff, staff_kind, debuted_at) values ('Mn Boss', 'mn-boss', 'persona', now());
  insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do nothing;
  insert into demand_kinds (key) values ('postsOnBoard') on conflict (key) do nothing;
  insert into settings (key, value) values ('structuralHoldHours', '24') on conflict (key) do update set value = excluded.value;
  update settings set value = value || jsonb_build_object('meetingsThreadTitle', 'Season {season}: Staff Meetings') where key = 'copy';
  update seasons set boss = 'mn-boss' where ends_at is null;
  select id into sid from seasons where ends_at is null;
  insert into move_bank (staff, balance, as_of) values ('mn-boss', 20, now());
  perform pg_temp.expect((select meetings_thread from seasons where id = sid) is null, 'the season starts with no Staff Meetings thread');

  -- 1. None, blank, not a string: nothing opened, nothing posted.
  m1 := (begin_meeting('2031-04-01T09:00:00Z') ->> 'meeting')::bigint;
  r := apply_meeting(m1, pg_temp.payload(general, 'One', '{}'::jsonb));
  perform pg_temp.expect(r ->> 'status' = 'applied', 'no minutes: ' || r::text);
  perform pg_temp.expect((select meetings_thread from seasons where id = sid) is null, 'a meeting with no minutes opened the Staff Meetings thread');
  perform pg_temp.expect((select (record ->> 'minutesPosted')::boolean from meetings where id = m1) is false, 'no minutes: the record did not say minutesPosted false');
  m2 := (begin_meeting('2031-04-02T09:00:00Z') ->> 'meeting')::bigint;
  perform apply_meeting(m2, pg_temp.payload(general, 'Two', jsonb_build_object('minutes', E'  \n ')));
  m3 := (begin_meeting('2031-04-03T09:00:00Z') ->> 'meeting')::bigint;
  perform apply_meeting(m3, pg_temp.payload(general, 'Three', jsonb_build_object('minutes', 7)));
  perform pg_temp.expect((select meetings_thread from seasons where id = sid) is null, 'a blank or non-string minutes opened the thread');
  perform pg_temp.expect(not exists (select 1 from threads where title like '%Staff Meetings%'), 'a thread titled Staff Meetings exists after meetings with none');

  -- 2. Minutes: the thread opens once, on the system board, listed, and the Boss posts the words as written.
  m4 := (begin_meeting('2031-04-04T09:00:00Z') ->> 'meeting')::bigint;
  r := apply_meeting(m4, pg_temp.payload(general, 'Four', jsonb_build_object('minutes', 'We argued about the Palace. It was decided.')));
  perform pg_temp.expect(r ->> 'status' = 'applied', 'minutes: ' || r::text);
  t := (select meetings_thread from seasons where id = sid);
  perform pg_temp.expect(t is not null, 'a meeting with minutes opened no Staff Meetings thread');
  perform pg_temp.expect((select title from threads where id = t) = 'Season ' || (select number from seasons where id = sid) || ': Staff Meetings', 'the thread is titled by the instance''s word: ' || (select title from threads where id = t));
  perform pg_temp.expect((select board from threads where id = t) = system_board(), 'the Staff Meetings thread is not on the system board');
  perform pg_temp.expect(exists (select 1 from thread_list l where l.id = t), 'the Staff Meetings thread is not listed');
  perform pg_temp.expect((select count(*) from acts a where a.thread = t and a.kind = 'post') = 1, 'the minutes were not posted once');
  perform pg_temp.expect((select a.payload ->> 'body' from acts a where a.thread = t and a.kind = 'post') = 'We argued about the Palace. It was decided.', 'the minutes were not posted as written');
  perform pg_temp.expect((select c.staff from acts a join characters c on c.id = a.character where a.thread = t and a.kind = 'post') = 'mn-boss', 'the minutes were not posted by the Boss');
  perform pg_temp.expect((select (record ->> 'minutesPosted')::boolean from meetings where id = m4) is true, 'the record did not say minutesPosted true');

  -- 3. The next meeting posts in the same thread.
  m5 := (begin_meeting('2031-04-05T09:00:00Z') ->> 'meeting')::bigint;
  perform apply_meeting(m5, pg_temp.payload(general, 'Five', jsonb_build_object('minutes', 'Day two.')));
  perform pg_temp.expect((select meetings_thread from seasons where id = sid) = t, 'a second meeting changed the Staff Meetings thread');
  perform pg_temp.expect((select count(*) from threads where title like '%Staff Meetings%') = 1, 'two Staff Meetings threads were opened');
  perform pg_temp.expect((select array_agg(a.payload ->> 'body' order by a.seq) from acts a where a.thread = t and a.kind = 'post') = array['We argued about the Palace. It was decided.', 'Day two.'], 'the minutes are not two posts in order');

  -- 4. An applied meeting posts nothing again.
  r := apply_meeting(m5, pg_temp.payload(general, 'Five', jsonb_build_object('minutes', 'Again!')));
  perform pg_temp.expect(r ->> 'status' = 'already applied', 're-apply: ' || r::text);
  perform pg_temp.expect((select count(*) from acts a where a.thread = t and a.kind = 'post') = 2, 'an applied meeting posted its minutes again');

  -- 5. Past postMaxLength is cut to it.
  update settings set value = '30' where key = 'postMaxLength';
  m6 := (begin_meeting('2031-04-06T09:00:00Z') ->> 'meeting')::bigint;
  perform apply_meeting(m6, pg_temp.payload(general, 'Six', jsonb_build_object('minutes', repeat('m', 100))));
  perform pg_temp.expect((select length(a.payload ->> 'body') from acts a where a.thread = t and a.kind = 'post' order by a.seq desc limit 1) = 30, 'minutes over postMaxLength were not cut to it');
  update settings set value = '20000' where key = 'postMaxLength';

  -- 6. The thread is one of the instance's own.
  perform pg_temp.expect(t in (select instance_threads()), 'the Staff Meetings thread is not in instance_threads()');

  -- 7. No meetingsThreadTitle: the meeting applies, the minutes are skipped.
  update seasons set meetings_thread = null where id = sid;
  select count(*) into threads_before from threads;
  update settings set value = value - 'meetingsThreadTitle' where key = 'copy';
  m7 := (begin_meeting('2031-04-07T09:00:00Z') ->> 'meeting')::bigint;
  r := apply_meeting(m7, pg_temp.payload(general, 'Seven', jsonb_build_object('minutes', 'Unseeded.', 'points', jsonb_build_array(jsonb_build_object('staff', 'mn-boss', 'line', 'Hold the line.')))));
  perform pg_temp.expect(r ->> 'status' = 'applied', 'a missing meetingsThreadTitle failed the meeting: ' || r::text);
  perform pg_temp.expect(exists (select 1 from queued_moves q where q.meeting = m7), 'a missing meetingsThreadTitle lost the meeting''s moves');
  perform pg_temp.expect(exists (select 1 from staff_points p where p.meeting = m7), 'a missing meetingsThreadTitle lost the meeting''s points');
  perform pg_temp.expect((select (record ->> 'minutesPosted')::boolean from meetings where id = m7) is false, 'a missing word: minutesPosted was not false');
  perform pg_temp.expect((select record ->> 'minutesSkipped' from meetings where id = m7) like '%meetingsThreadTitle%', 'minutesSkipped did not name the missing word: ' || coalesce((select record ->> 'minutesSkipped' from meetings where id = m7), 'null'));
  perform pg_temp.expect((select meetings_thread from seasons where id = sid) is null, 'a skipped minutes left the season pointing at a thread');
  perform pg_temp.expect((select count(*) from threads) = threads_before, 'a skipped minutes left a thread behind');
  update settings set value = value || jsonb_build_object('meetingsThreadTitle', 'Season {season}: Staff Meetings') where key = 'copy';
  update seasons set meetings_thread = t where id = sid;

  -- 8. A Boss that cannot write (retired; the season's Boss is never benched, as staff_office_now reads it): the same.
  select count(*) into threads_before from threads;
  update characters set retired_at = now() where staff = 'mn-boss';
  m8 := (begin_meeting('2031-04-08T09:00:00Z') ->> 'meeting')::bigint;
  r := apply_meeting(m8, pg_temp.payload(general, 'Eight', jsonb_build_object('minutes', 'Benched.', 'points', jsonb_build_array(jsonb_build_object('staff', 'mn-boss', 'line', 'Nope.')))));
  perform pg_temp.expect(r ->> 'status' = 'applied', 'a retired Boss failed the meeting: ' || r::text);
  perform pg_temp.expect(exists (select 1 from queued_moves q where q.meeting = m8), 'a retired Boss lost the meeting''s moves');
  perform pg_temp.expect((select (record ->> 'minutesPosted')::boolean from meetings where id = m8) is false, 'retired: minutesPosted was not false');
  perform pg_temp.expect((select record ->> 'minutesSkipped' from meetings where id = m8) is not null, 'retired: minutesSkipped did not say why: ' || coalesce((select record ->> 'minutesSkipped' from meetings where id = m8), 'null'));
  perform pg_temp.expect((select count(*) from acts a where a.thread = t and a.kind = 'post') = 3, 'a retired Boss posted minutes');
  perform pg_temp.expect((select count(*) from threads) = threads_before, 'a retired Boss left a thread behind');
end $$;
