-- Chattier staff second follow-ups (supabase/migrations/0419_chattier_second_follow_ups.sql; docs/plans/2026-11-23-chattier-staff-second-follow-ups-plan.md, Task 1; issue #1025 F1).
-- F1: pool_orphans reads from the earlier of the week's start and the day before `through`, so a Sunday post whose spend failed is an orphan on the Monday, when it is adopted; from Tuesday it is last week's and out again.
-- A post of the Sunday before that, two days back on a Monday, is last week's and stays out.

insert into characters (name, staff, staff_kind, debuted_at) values ('Sf Boss', 'sf2-boss', 'persona', now());

create function pg_temp.marked_post(k text, in_thread uuid, body text, marker text) returns uuid language sql as $$
  select (write_staff_act(k, 'post', in_thread, null, jsonb_build_object('body', body, 'pool', marker)) ->> 'id')::uuid
$$;

do $$
declare
  t uuid := tests.thread('Sf2 Orphans');
  sunday uuid; saturday uuid; list jsonb;
begin
  -- 2030-01-13 is a Sunday, 2030-01-14 the Monday after it, 2030-01-12 the Saturday before.
  sunday := pg_temp.marked_post('sf2-boss', t, 'Sunday words.', '2030-01-13');
  perform tests.become_service();
  list := pool_orphans('2030-01-14');
  if not exists (select 1 from jsonb_array_elements(list) e where e ->> 'day' = '2030-01-13' and e ->> 'act' = sunday::text) then
    raise exception 'a Sunday post with no spend is not an orphan on the Monday: %', list;
  end if;
  -- the Sunday's own week still lists it on that Sunday, as before
  if not exists (select 1 from jsonb_array_elements(pool_orphans('2030-01-13')) e where e ->> 'act' = sunday::text) then
    raise exception 'the Sunday post is not an orphan on its own Sunday';
  end if;
  -- spent, it is no orphan
  perform record_pool_spend('2030-01-13'::date, 'sf2-boss', 'named', sunday, null, false);
  if exists (select 1 from jsonb_array_elements(pool_orphans('2030-01-14')) e where e ->> 'act' = sunday::text) then
    raise exception 'a spent post is an orphan';
  end if;
  perform tests.unbecome();
  -- a post of the Saturday before is last week's on the Monday after, and stays out of it
  saturday := pg_temp.marked_post('sf2-boss', t, 'Saturday words.', '2030-01-12');
  perform tests.become_service();
  if exists (select 1 from jsonb_array_elements(pool_orphans('2030-01-14')) e where e ->> 'act' = saturday::text) then
    raise exception 'a post two days back, of last week, is read on the Monday';
  end if;
  perform tests.unbecome();
end $$;

-- ---- Task 2 (#1021 F5): a failed turn retries by why it failed, and the ceiling counts paid calls ----
-- A reply covered by a refused attempt, or by two rejected ones, stops waiting in all three reads and write_staff_turn refuses it; one rejected or any number of failed attempts leave it waiting;
-- pool_turns_today counts paid attempts and not unpaid ones; the two tables are append-only, RLS on, no client's.
create function pg_temp.refused(stmt text) returns text language plpgsql as $$
begin execute stmt; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'UTC')::date $$;
create function pg_temp.waits(r uuid, th uuid) returns text language plpgsql as $$
declare since timestamptz := now() - interval '2 days'; board uuid := (select board from threads where id = th); n text := '';
begin
  if exists (select 1 from pool_waiting_rows(array['sf2-boss'], since) w where w.act = r) then n := n || 'rows,'; end if;
  if exists (select 1 from pool_waiting_in_thread(th, array['sf2-boss'], since) w where w.act = r) then n := n || 'thread,'; end if;
  if exists (select 1 from pool_waiting_in_board(board, array['sf2-boss'], since) w where w.act = r) then n := n || 'board,'; end if;
  perform tests.become_service();
  if exists (select 1 from jsonb_array_elements(pool_waiting(array['sf2-boss'], since)) e, jsonb_array_elements(e -> 'replies') x where x ->> 'act' = r::text) then n := n || 'all,'; end if;
  perform tests.unbecome();
  return n;
end $$;

do $$
declare
  t uuid := tests.thread('Sf2 Attempts');
  ann uuid := tests.account('sf2-ann'); a uuid := tests.character(ann, 'Sf2 Ann');
  p uuid := (write_staff_act('sf2-boss', 'post', t, null, jsonb_build_object('body', 'A boss post.')) ->> 'id')::uuid;
  r_ref uuid := tests.act(a, 'post', t, '{"body": "Refused reply."}', p);
  r_rej uuid := tests.act(a, 'post', t, '{"body": "Rejected reply."}', p);
  r_two uuid := tests.act(a, 'post', t, '{"body": "Twice rejected reply."}', p);
  r_fail uuid := tests.act(a, 'post', t, '{"body": "Failed reply."}', p);
  sid bigint; said text; before integer; all_waiting text := 'rows,thread,board,all,';
begin
  perform tests.become_service();
  perform write_sessions(pg_temp.today(), '[{"staff": "sf2-boss", "start": 0, "end": 1440}]');
  sid := (select id from staff_sessions where staff = 'sf2-boss' and day = pg_temp.today());
  before := pool_turns_today(pg_temp.today());
  perform tests.unbecome();
  foreach said in array array[r_ref::text, r_rej::text, r_two::text, r_fail::text] loop
    if pg_temp.waits(said::uuid, t) is distinct from all_waiting then raise exception 'a fresh reply waits in every read, not %', pg_temp.waits(said::uuid, t); end if;
  end loop;

  perform tests.become_service();
  perform record_turn_attempt('sf2-boss', sid, t, array[r_ref], 'refused', true);
  perform record_turn_attempt('sf2-boss', sid, t, array[r_rej], 'rejected', true);
  perform record_turn_attempt('sf2-boss', sid, t, array[r_two, r_two], 'rejected', false);
  perform record_turn_attempt('sf2-boss', sid, t, array[r_two], 'rejected', true);
  perform record_turn_attempt('sf2-boss', sid, t, array[r_fail], 'failed', false);
  perform record_turn_attempt('sf2-boss', sid, t, array[r_fail], 'failed', true);
  perform record_turn_attempt('sf2-boss', sid, t, array[r_fail], 'failed', false);
  perform tests.unbecome();

  if pg_temp.waits(r_ref, t) <> '' then raise exception 'a refused reply still waits in: %', pg_temp.waits(r_ref, t); end if;
  if pg_temp.waits(r_rej, t) is distinct from all_waiting then raise exception 'one rejected attempt took a reply out of: %', all_waiting; end if;
  if pg_temp.waits(r_two, t) <> '' then raise exception 'a twice rejected reply still waits in: %', pg_temp.waits(r_two, t); end if;
  if pg_temp.waits(r_fail, t) is distinct from all_waiting then raise exception 'failed attempts took a reply out of the reads: %', pg_temp.waits(r_fail, t); end if;

  -- write_staff_turn refuses a given-up reply and still writes a turn for one that waits.
  perform tests.become_service();
  said := pg_temp.refused(format('select write_staff_turn(%L, %s, %L, %L, array[%L::uuid], %L)', 'sf2-boss', sid, t, r_ref, r_ref, 'No.'));
  if said is null or said !~ 'a turn answers the replies waiting' then raise exception 'write_staff_turn wrote a turn for a refused reply: %', said; end if;
  said := pg_temp.refused(format('select write_staff_turn(%L, %s, %L, %L, array[%L::uuid], %L)', 'sf2-boss', sid, t, r_two, r_two, 'No.'));
  if said is null or said !~ 'a turn answers the replies waiting' then raise exception 'write_staff_turn wrote a turn for a twice rejected reply: %', said; end if;
  perform write_staff_turn('sf2-boss', sid, t, r_rej, array[r_rej, r_fail], 'Yes.');
  -- The ceiling: the turn, the paid attempts (refused, rejected, rejected, failed) and none of the unpaid.
  if pool_turns_today(pg_temp.today()) is distinct from before + 1 + 4 then raise exception 'the day counts % calls, not %', pool_turns_today(pg_temp.today()), before + 5; end if;
  if pool_turns_today(pg_temp.today() + 1) is distinct from 0 then raise exception 'another day counts attempts'; end if;
  -- A session that is not the persona's, and an outcome outside the three, write nothing.
  said := pg_temp.refused(format('select record_turn_attempt(%L, %s, %L, array[%L::uuid], %L, true)', 'sf2-boss', sid + 1000, t, r_ref, 'refused'));
  if said is null or said !~ '^42501' then raise exception 'an attempt in a session that is not the persona''s was written: %', said; end if;
  said := pg_temp.refused(format('select record_turn_attempt(%L, %s, %L, array[%L::uuid], %L, true)', 'sf2-boss', sid, t, r_ref, 'shrugged'));
  if said is null or said !~ '^23514' then raise exception 'an attempt with an unknown outcome was written: %', said; end if;
  perform tests.unbecome();
end $$;

do $$
declare t text; who text; said text; fn text;
begin
  foreach t in array array['pool_attempts', 'pool_attempt_replies'] loop
    if (select count(*) from pg_trigger g where g.tgrelid = ('public.' || t)::regclass and g.tgname in (t || '_no_update', t || '_no_truncate') and g.tgenabled = 'A') is distinct from 2 then
      raise exception '%''s append-only triggers must fire always', t;
    end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || t)::regclass) then raise exception '% has no row-level security', t; end if;
    said := pg_temp.refused(format('update %I set %I = %I', t, case t when 'pool_attempts' then 'paid' else 'reply' end, case t when 'pool_attempts' then 'paid' else 'reply' end));
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
  foreach who in array array['anon', 'authenticated'] loop
    perform set_config('role', who, true);
    fn := 'select record_turn_attempt(''sf2-boss'', 1, gen_random_uuid(), array[gen_random_uuid()], ''failed'', false)';
    said := pg_temp.refused(fn);
    perform tests.unbecome();
    if said is null or said !~ '^42501' then raise exception '% can call record_turn_attempt: %', who, said; end if;
  end loop;
end $$;
