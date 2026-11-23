-- Chattier staff, second follow-ups: the database (docs/plans/2026-11-23-chattier-staff-second-follow-ups-plan.md, Task 1; issue #1025 F1).
--
-- pool_orphans (0317_surfaces.sql) read the posts from the start of the week of `through`. On a Monday that is Monday itself, so a Sunday kept pick whose post landed and whose record_pool_spend failed was
-- no orphan to it: the chatter function adopts orphans before it reads the carried picks (`kept_picks` of the day before), the pick still had no spend, and it was written a second time. The lower bound is now
-- the earlier of the week's start and the day before `through`, so the Sunday post is adopted on Monday and `kept_picks` no longer lists it. Everything else in pool_orphans as 0317 wrote it.
-- Ways out: no state is added. Masks: the read is of staff characters' own posts and cards, as before.
--
-- The test that drives it red is supabase/tests/0419-chattier-second-follow-ups.sql.

create or replace function pool_orphans(through date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('staff', o.staff, 'day', o.day, 'act', o.id, 'startedThread', o.seq = 1,
    'card', (select k.id from acts k
             where k.character = o.character
               and ((k.kind = 'set' and k.target_act_id = o.id)
                    or (k.kind = 'card' and k.payload ->> 'pool' = o.day and o.target_act_id is not null and k.target_act_id = o.target_act_id)
                    or (k.kind = 'draw' and k.payload ->> 'pool' = o.day))
               and not exists (select 1 from pool_spends s where s.card_act = k.id)
             order by k.created_at, k.id limit 1)) order by o.day, o.staff), '[]'::jsonb)
  from (select distinct on (c.staff, a.payload ->> 'pool') c.staff, a.payload ->> 'pool' as day, a.id, a.seq, a.character, a.target_act_id
        from acts a join characters c on c.id = a.character
        where c.staff is not null and a.kind = 'post' and a.payload ->> 'pool' ~ '^\d{4}-\d{2}-\d{2}$'
          and (a.payload ->> 'pool')::date between least(date_trunc('week', through::timestamp)::date, through - 1) and through
          and not exists (select 1 from pool_spends s where s.post_act = a.id)
        order by c.staff, a.payload ->> 'pool', a.created_at, a.id) o
$$;
