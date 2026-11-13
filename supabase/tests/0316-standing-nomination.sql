-- The Boss's standing nomination in meeting_context (supabase/migrations/0364_standing_nomination.sql; the rehearsal patch design, section 5).
-- meeting_context() hands the meeting the Boss's latest nameSuccessor, waiting or landed and not ended, that no admin held or refused: `{boss, at}`, `at` the
-- meeting's started_at in epoch milliseconds. An admin's hold takes a waiting one out, a reversal takes a landed one out, and with none standing it is null.
--
-- The world is 0056-succession.sql's: four Bosses of a roster, 'su-a' the Boss; every nomination is a queued move of 'su-a' in a meeting of its own.

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 30),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('Landed: {move}.'), 'bossFarewell', jsonb_build_array('Farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.')),
      'systemMoveWords', jsonb_build_object('nameSuccessor', 'the naming of a successor')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'su-a',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'su-a', 'name', 'Su A', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'su-b', 'name', 'Su B', 'title', 'Boss', 'signature', 'b'),
        jsonb_build_object('key', 'su-c', 'name', 'Su C', 'title', 'Boss', 'signature', 'c'),
        jsonb_build_object('key', 'su-d', 'name', 'Su D', 'title', 'Boss', 'signature', 'd')),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')))));
  insert into admins (account) values (tests.account('sn-admin'));
end $$;

create function pg_temp.ann() returns uuid language sql as $$ select (value #>> '{}')::uuid from settings where key = 'systemAnnouncements' $$;
create function pg_temp.nomination() returns jsonb language sql as $$ select meeting_context() -> 'nomination' $$;
-- A nomination of the Boss in a meeting begun at `at`, waiting to land (go_live_at ahead, so the tick leaves it); `landed` writes the move's Act and lands it.
create function pg_temp.nominate(to_staff text, at timestamptz, landed boolean) returns bigint language plpgsql as $$
declare
  m bigint;
  q bigint;
  written uuid;
begin
  insert into meetings (started_at, slot, finished_at, outcome) values (at, at, at, 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (m, 'su-a', 'nameSuccessor', jsonb_build_object('boss', to_staff), null, 'because', now() + interval '30 days', null, true) returning id into q;
  if landed then
    perform set_config('kayfabb.staff_writer', 'on', true);
    insert into acts (character, kind, thread, payload, created_at)
    values ((select c.id from characters c where c.staff = 'su-a'), 'move', pg_temp.ann(), jsonb_build_object('kind', 'nameSuccessor', 'params', jsonb_build_object('boss', to_staff), 'body', 'landed'), at) returning id into written;
    perform set_config('kayfabb.staff_writer', '', true);
    update queued_moves set landed_act = written where id = q;
  end if;
  return q;
end $$;
create function pg_temp.ms(at timestamptz) returns bigint language sql as $$ select (extract(epoch from at) * 1000)::bigint $$;

do $$
declare
  admin uuid := (select id from auth.users where email = 'sn-admin@test.invalid');
  t1 timestamptz := date_trunc('second', now() - interval '3 days');
  t2 timestamptz := date_trunc('second', now() - interval '2 days');
  t3 timestamptz := date_trunc('second', now() - interval '1 day');
  q1 bigint; q2 bigint; q3 bigint;
begin
  if (select current_boss()) is distinct from 'su-a' then raise exception 'the first season has the seed''s first Boss, not %', current_boss(); end if;
  -- None standing: null, and the key is there (a database that does not say is the older one).
  perform pg_temp.expect(meeting_context() ? 'nomination' and jsonb_typeof(meeting_context() -> 'nomination') = 'null', 'with none standing the nomination is null: ' || meeting_context()::text);

  -- Two landed and one waiting: the latest of the three, with the meeting's start in epoch milliseconds.
  q1 := pg_temp.nominate('su-b', t1, true);
  q2 := pg_temp.nominate('su-c', t2, true);
  q3 := pg_temp.nominate('su-d', t3, false);
  perform pg_temp.expect(pg_temp.nomination() = jsonb_build_object('boss', 'su-d', 'at', pg_temp.ms(t3)), 'the waiting one is the latest of three: ' || coalesce(pg_temp.nomination()::text, 'null'));

  -- An admin holds the waiting one: the latest landed one stands.
  update queued_moves set held_at = now(), held_by = admin where id = q3;
  perform pg_temp.expect(pg_temp.nomination() = jsonb_build_object('boss', 'su-c', 'at', pg_temp.ms(t2)), 'a held one is not standing: ' || coalesce(pg_temp.nomination()::text, 'null'));

  -- A landed one an admin reversed is not standing: the older landed one is.
  perform end_move((select landed_act from queued_moves where id = q2), 'reversed', 'admin');
  perform pg_temp.expect(pg_temp.nomination() = jsonb_build_object('boss', 'su-b', 'at', pg_temp.ms(t1)), 'an ended one is not standing: ' || coalesce(pg_temp.nomination()::text, 'null'));

  -- Every one gone: null again.
  perform end_move((select landed_act from queued_moves where id = q1), 'reversed', 'admin');
  perform pg_temp.expect(jsonb_typeof(pg_temp.nomination()) = 'null', 'with all of them gone the nomination is null: ' || coalesce(pg_temp.nomination()::text, 'null'));
  -- Another staff member's waiting nomination is no one's but its own: it is not the Boss's standing one.
  perform pg_temp.expect((select count(*) from queued_moves where staff = 'su-b') = 0, 'the world has no other staff queue yet');
  -- The queue's guard lets only the Boss queue one, so the row is written past its triggers: what is under test is meeting_context's filter, for the day a former Boss's row is still in the table.
  set local session_replication_role = replica;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values ((select id from meetings order by id desc limit 1), 'su-b', 'nameSuccessor', jsonb_build_object('boss', 'su-c'), null, 'because', now() + interval '30 days', null, true);
  set local session_replication_role = origin;
  perform pg_temp.expect((select count(*) from queued_moves where staff = 'su-b' and kind = 'nameSuccessor') = 1, 'the other staff member''s row is there');
  perform pg_temp.expect(jsonb_typeof(pg_temp.nomination()) = 'null', 'another staff member''s nomination is not the Boss''s: ' || coalesce(pg_temp.nomination()::text, 'null'));
end $$;
