-- Chattier staff second follow-ups (supabase/migrations/0419_chattier_second_follow_ups.sql; docs/plans/2026-11-23-chattier-staff-second-follow-ups-plan.md, Task 1; issue #1025 F1).
-- F1: pool_orphans reads from the earlier of the week's start and the day before `through`, so a Sunday post whose spend failed is an orphan on Monday (and still one on every day after it that week).
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
