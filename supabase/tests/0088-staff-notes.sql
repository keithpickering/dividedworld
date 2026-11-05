-- Staff notes (supabase/migrations/0085_staff_notes.sql; the staff roster design, "The masks"; its plan, Task 6).
-- A pool persona leaves a note of its own with each post it writes: at most noteMost (280) characters, never blank, naming the post
-- (`act`) that wrote it. The table is append-only, no client reads it, and only the service role reads it back through
-- `staff_notes_recent`, newest `most` since a time, oldest first. The poison is a note with no act (refused: `act` is not null).

do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('Landed: {move}.'),
        'bossFarewell', jsonb_build_array('Farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.'))),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'nt-boss',
      'staffGroup', jsonb_build_object('name', 'Test Cores'),
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'nt-boss', 'name', 'Nt Boss', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'nt-mod', 'name', 'Nt Mod', 'title', 'Mod', 'signature', 'b')),
      'firstStaff', jsonb_build_array('nt-mod'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')))));
end $$;

create function pg_temp.refused(stmt text) returns text language plpgsql as $$
begin execute stmt; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create function pg_temp.pool_post(k text, body text) returns uuid language plpgsql as $$
declare t uuid := (select id from threads order by created_at limit 1); a uuid;
begin
  if t is null then t := tests.thread(); end if;
  a := (write_staff_act(k, 'post', t, null, jsonb_build_object('body', body)) ->> 'id')::uuid;
  return a;
end $$;

-- ---- The rules of the table ----
do $$
declare
  a uuid := pg_temp.pool_post('nt-boss', 'A pool post.');
  said text;
begin
  insert into staff_notes (staff, act, body) values ('nt-boss', a, 'Ann is up to something.');
  said := pg_temp.refused(format('insert into staff_notes (staff, act, body) values (''nt-boss'', %L, %L)', a, repeat('x', 281)));
  if said is null or said !~ '^23514' then raise exception 'a 281-character note was written: %', said; end if;
  insert into staff_notes (staff, act, body) values ('nt-boss', a, repeat('x', 280));
  said := pg_temp.refused(format('insert into staff_notes (staff, act, body) values (''nt-boss'', %L, %L)', a, E'  \n '));
  if said is null or said !~ '^23514' then raise exception 'a blank note was written: %', said; end if;
  said := pg_temp.refused(format('insert into staff_notes (staff, act, body) values (''nt-boss'', %L, '''')', a));
  if said is null or said !~ '^23514' then raise exception 'an empty note was written: %', said; end if;
  said := pg_temp.refused('insert into staff_notes (staff, act, body) values (''nt-boss'', null, ''No post wrote this.'')');
  if said is null or said !~ '^23502' then raise exception 'a note with no act was written: %', said; end if;
  said := pg_temp.refused(format('insert into staff_notes (staff, act, body) values (''nobody-at-all'', %L, ''Not staff.'')', a));
  if said is null or said !~ '^23503' then raise exception 'a note named a staff member who is not one: %', said; end if;
  said := pg_temp.refused('update staff_notes set body = ''edited''');
  if said is null then raise exception 'a note was updated'; end if;
  said := pg_temp.refused('delete from staff_notes');
  if said is null then raise exception 'a note was deleted'; end if;
  said := pg_temp.refused('truncate staff_notes');
  if said is null then raise exception 'the notes were truncated'; end if;
  if (select count(*) from pg_trigger t where t.tgrelid = 'public.staff_notes'::regclass and t.tgname in ('staff_notes_no_update', 'staff_notes_no_truncate') and t.tgenabled = 'A') is distinct from 2 then
    raise exception 'the notes'' append-only triggers must fire always';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.staff_notes'::regclass) then raise exception 'staff_notes has no row-level security'; end if;
  if (select count(*) from staff_notes) is distinct from 2 then raise exception 'a refused note left a row (% rows)', (select count(*) from staff_notes); end if;
end $$;

-- ---- No client reads or writes them; only the service role reads them back ----
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_table_privilege(r, 'public.staff_notes', 'select,insert,update,delete') then raise exception '% reaches staff_notes', r; end if;
    if has_function_privilege(r, 'public.staff_notes_recent(text, timestamptz, integer)', 'execute') then raise exception '% runs staff_notes_recent', r; end if;
  end loop;
  if not has_function_privilege('service_role', 'public.staff_notes_recent(text, timestamptz, integer)', 'execute') then raise exception 'the service role cannot run staff_notes_recent'; end if;
  perform tests.become(tests.account('nt-ann'));
  r := pg_temp.refused('select * from staff_notes');
  perform tests.unbecome();
  if r is null or r !~ '^42501' then raise exception 'a player read the notes: %', r; end if;
  perform tests.become_anon();
  r := pg_temp.refused('select staff_notes_recent(''nt-boss'', null, 5)');
  perform tests.unbecome();
  if r is null or r !~ '^42501' then raise exception 'anon ran staff_notes_recent: %', r; end if;
end $$;

-- ---- staff_notes_recent: the newest `most` since a time, oldest first, one persona's alone ----
do $$
declare
  a uuid := pg_temp.pool_post('nt-boss', 'Another pool post.');
  mod_post uuid := pg_temp.pool_post('nt-mod', 'A Mod Bot post.');
  got jsonb;
  i int;
begin
  delete from staff_notes where false;
  for i in 1..5 loop
    insert into staff_notes (staff, act, body, at) values ('nt-boss', a, 'note ' || i, '2030-01-01T00:00:00Z'::timestamptz + i * interval '1 hour');
  end loop;
  insert into staff_notes (staff, act, body, at) values ('nt-mod', mod_post, 'the Mod Bot''s own', '2030-01-01T09:00:00Z');
  perform tests.become_service();
  got := staff_notes_recent('nt-boss', '2030-01-01T01:30:00Z', 3);
  perform tests.unbecome();
  if got is distinct from '["note 3", "note 4", "note 5"]'::jsonb then raise exception 'the newest three since 01:30, oldest first: %', got; end if;
  perform tests.become_service();
  got := staff_notes_recent('nt-boss', null, 2);
  perform tests.unbecome();
  if got is distinct from '["note 4", "note 5"]'::jsonb then raise exception 'with no since, the newest two: %', got; end if;
  perform tests.become_service();
  got := staff_notes_recent('nt-mod', null, 12);
  perform tests.unbecome();
  if got is distinct from '["the Mod Bot''s own"]'::jsonb then raise exception 'another persona''s notes were read: %', got; end if;
  perform tests.become_service();
  got := staff_notes_recent('nt-boss', null, 0);
  perform tests.unbecome();
  if got is distinct from '[]'::jsonb then raise exception 'most 0 should read nothing: %', got; end if;
end $$;
