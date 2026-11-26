-- Owed lines, the queue row's lock (supabase/migrations/0445_persona_lines.sql, pay_owed_line, pay_owed_unsaid and system_tick's step 6; docs/plans/2026-11-25-persona-lines-plan.md, Task 4).
-- A race, so it commits through dblink on purpose (the way 0077-trap-locks.sql does), and its world is committed first.
--
-- 1. The staff run's payment and the tick's, at once: one session pays a line inside an open transaction, a second pay_owed_line waits on the queue row's lock, and when the first commits it
--    returns the existing payment (`already`) and writes nothing; the line is posted once.
-- 2. pay_owed_unsaid waits on the row the same way and, once the line is paid, settles nothing a second time.
-- 3. The tick's grace pass skips a row another session holds (skip locked), leaves it open, and pays it once the hold ends.

-- ---- The world, committed: a Boss, a Mod, a thread and three moves that ended, so three lines are owed ----
do $$
begin
  perform tests.commit($sql$
    do $w$
    declare
      seed jsonb;
      th uuid;
      mv uuid;
      i integer;
    begin
      seed := jsonb_build_object(
        'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3,
          'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
          'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
          'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5, 'patrolPool', 20,
            'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
            'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
          'systemLines', jsonb_build_object('moveMet', jsonb_build_array('Met {move}.')),
          'systemMoveWords', jsonb_build_object('setRule', 'a rule')),
        'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
        'developer', jsonb_build_object('name', 'Rc Gabe', 'title', 'Made this. Sorry.'),
        'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'rc-b',
          'staff', jsonb_build_array(
            jsonb_build_object('key', 'rc-b', 'name', 'Rc Bee', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
            jsonb_build_object('key', 'rc-a', 'name', 'Rc Aye', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
              'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50))),
          'firstStaff', jsonb_build_array('rc-a'),
          'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
          'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
          'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
      perform seed_instance(seed);
      insert into settings (key, value) values ('systemLines', '{"moveMet": ["Met {move}."]}'::jsonb) on conflict (key) do update set value = excluded.value;
      perform set_config('kayfabb.staff_writer', 'on', true);
      for i in 1..3 loop
        insert into threads (board, title) select b.id, 'Race ' || i from boards b where b.slug = 'general' returning id into th;
        mv := tests.act((select id from characters where staff = 'rc-a'), 'move', th,
          jsonb_build_object('kind', 'setRule', 'body', 'A rule.', 'params', jsonb_build_object('board', null, 'predicate', 'noAllCaps', 'param', null, 'band', 'minor')), null, now());
        perform say_move_end(mv, 'met');
      end loop;
      perform set_config('kayfabb.staff_writer', '', true);
    end $w$;
  $sql$);
end $$;

create function pg_temp.owed_of(n integer) returns bigint language sql as $$
  select o.id from (select x.id, row_number() over (order by x.id) as rn from lines_owed x where x.line_key = 'moveMet') o where o.rn = owed_of.n
$$;
create function pg_temp.posts_in_owed(o bigint) returns bigint language sql as $$
  select count(*) from acts a where a.thread = (select w.thread from lines_owed w where w.id = posts_in_owed.o) and a.kind = 'post'
$$;

-- ---- 1. A payment held open, a second payment waits and then returns the first ----
do $$
declare
  oid bigint := pg_temp.owed_of(1);
  got jsonb;
  held text;
begin
  if oid is null then raise exception 'the race world owed no line'; end if;
  perform extensions.dblink_connect('ol_holder', current_setting('kayfabb.scratch_url'));
  begin
    perform extensions.dblink_send_query('ol_holder', format('begin; select pay_owed_line(%s, %L); select pg_sleep(1.5); commit', oid, 'Held voice.'));
    perform pg_sleep(0.5);
    -- The holder has paid in its open transaction (the row is deleted there, not committed): a reader without the lock would still see the line open and post it again.
    perform set_config('lock_timeout', '200ms', true);
    begin
      got := pay_owed_line(oid, 'Second voice.');
      held := null;
    exception when others then
      held := sqlstate;
    end;
    perform set_config('lock_timeout', '0', true);
    if held is distinct from '55P03' then raise exception 'a second payment did not wait on the held row: % %', held, got; end if;
    -- Now wait for the holder to commit.
    got := pay_owed_line(oid, 'Second voice.');
  exception when others then
    perform extensions.dblink_disconnect('ol_holder');
    raise;
  end;
  perform extensions.dblink_disconnect('ol_holder');
  if (got ->> 'already')::boolean is distinct from true or got ->> 'how' is distinct from 'voiced' then raise exception 'the waiting payment did not return the existing one: %', got; end if;
  if pg_temp.posts_in_owed(oid) is distinct from 1::bigint then raise exception 'the line was posted % times', pg_temp.posts_in_owed(oid); end if;
  if (select count(*) from lines_paid p where p.owed = oid) is distinct from 1::bigint then raise exception 'the line was paid more than once'; end if;
  if (select a.payload ->> 'body' from acts a where a.id = (got ->> 'act')::uuid) is distinct from 'Held voice.' then raise exception 'the posted words are not the first payment''s'; end if;
end $$;

-- ---- 2. pay_owed_unsaid waits on the same lock, and settles nothing twice ----
do $$
declare
  oid bigint := pg_temp.owed_of(2);
  held text;
begin
  perform extensions.dblink_connect('ol_holder2', current_setting('kayfabb.scratch_url'));
  begin
    perform extensions.dblink_send_query('ol_holder2', format('begin; select pay_owed_line(%s, %L); select pg_sleep(1.5); commit', oid, 'Held again.'));
    perform pg_sleep(0.5);
    perform set_config('lock_timeout', '200ms', true);
    begin
      perform pay_owed_unsaid(oid, 'The System is off');
      held := null;
    exception when others then
      held := sqlstate;
    end;
    perform set_config('lock_timeout', '0', true);
    if held is distinct from '55P03' then raise exception 'pay_owed_unsaid did not wait on the held row: %', held; end if;
    perform pay_owed_unsaid(oid, 'The System is off');
  exception when others then
    perform extensions.dblink_disconnect('ol_holder2');
    raise;
  end;
  perform extensions.dblink_disconnect('ol_holder2');
  if (select count(*) from lines_paid p where p.owed = oid) is distinct from 1::bigint or (select p.how from lines_paid p where p.owed = oid) is distinct from 'voiced' then
    raise exception 'pay_owed_unsaid settled a line already paid: %', (select jsonb_agg(to_jsonb(p)) from lines_paid p where p.owed = oid);
  end if;
end $$;

-- ---- 3. The tick's grace pass skips a row another session holds, and pays it once it is let go ----
do $$
declare
  oid bigint := pg_temp.owed_of(3);
  ran jsonb;
begin
  perform tests.commit(format('update lines_owed_open set at = now() - interval ''1 day'' where owed = %s', oid));
  perform extensions.dblink_connect('ol_holder3', current_setting('kayfabb.scratch_url'));
  begin
    perform extensions.dblink_exec('ol_holder3', 'begin');
    perform extensions.dblink_exec('ol_holder3', format('do $h$ begin perform 1 from lines_owed_open where owed = %s for update; end $h$', oid));
    perform set_config('lock_timeout', '500ms', true);
    ran := system_tick();
    perform set_config('lock_timeout', '0', true);
    perform extensions.dblink_exec('ol_holder3', 'rollback');
  exception when others then
    perform extensions.dblink_disconnect('ol_holder3');
    raise;
  end;
  perform extensions.dblink_disconnect('ol_holder3');
  if (ran ->> 'owedPaid')::integer is distinct from 0 or (ran ->> 'failed')::integer is distinct from 0 then raise exception 'the grace pass did not skip the held row: %', ran; end if;
  if exists (select 1 from lines_paid p where p.owed = oid) or not exists (select 1 from lines_owed_open o where o.owed = oid) then raise exception 'the held row was paid or left the queue'; end if;
  ran := system_tick();
  if (select p.how from lines_paid p where p.owed = oid) is distinct from 'stock' then raise exception 'the released row was not paid from stock: %', ran; end if;
end $$;
