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

-- ------------------------------------------------------------------------------------------------------------------
-- Task 2 (issue #1021 F5): a failed turn retries by why it failed, and the day's ceiling counts every paid call.
--
-- pool_attempts holds one row for each turn the chatter function tried and did not write: its day, persona, session and thread, the outcome ('refused': the provider refused the answer; 'rejected': an answer that
-- could not be used (not JSON, cut off, a bound repairAnswer could not repair, a schema refusal, a prompt too long); 'failed': a transport failure that outlived its retries, or a database error) and whether the
-- call was paid (the model answered). The replies it would have answered are pool_attempt_replies, one row for each, indexed by reply: a child table and not a uuid[] with a GIN index, so the waiting reads probe a
-- plain b-tree on the reply and one attempt over many replies is many small rows however many attempts a busy instance keeps.
-- A reply stops waiting when one refused attempt covers it or two rejected ones do; failed attempts leave it waiting (the failure was not the reply's). The three waiting reads and so write_staff_turn's check
-- (which asks pool_waiting_in_thread) and the presence box (which reads the same three) all follow, each as its 0415 definition with the one predicate added next to pool_answered's.
-- pool_turns_today counts the day's turns plus its paid attempts, so a refused answer is spent against the ceiling as a written one is.
-- Ways out: the state this adds is a reply no longer waited on; it ends by itself (the wait window, `waitHours`, ages the reply out as it does any reply) and a player's own reply answers a persona's next post anew.
-- Masks: nothing here reads an account, an owner or a class.
-- The test that drives it red is supabase/tests/0419-chattier-second-follow-ups.sql.

create table pool_attempts (
  id bigint generated always as identity primary key,
  day date not null,
  staff text not null references characters (staff),
  session bigint not null references staff_sessions (id),
  thread uuid not null references threads (id),
  outcome text not null check (outcome in ('refused', 'rejected', 'failed')),
  paid boolean not null,
  at timestamptz not null default now()
);
create index pool_attempts_day on pool_attempts (day) where paid;
create table pool_attempt_replies (
  attempt bigint not null references pool_attempts (id),
  reply uuid not null references acts (id),
  primary key (attempt, reply)
);
create index pool_attempt_replies_reply on pool_attempt_replies (reply);

do $$
declare t text;
begin
  foreach t in array array['pool_attempts', 'pool_attempt_replies'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('create trigger %I before update or delete on %I for each row execute function staff_rows_append_only()', t || '_no_update', t);
    execute format('create trigger %I before truncate on %I for each statement execute function staff_rows_append_only()', t || '_no_truncate', t);
    execute format('alter table %I enable always trigger %I', t, t || '_no_update');
    execute format('alter table %I enable always trigger %I', t, t || '_no_truncate');
  end loop;
end $$;

-- A failed attempt, written. Refuses (hint 'kayfabb.refusal') a persona that is none, a session that is not its own, and any `answers` that is empty, has a null element, or names a reply that is not waiting on the persona in
-- `in_thread` now (by the same read write_staff_turn asks, pool_waiting_in_thread, with the same wait window; so an act that is no reply to it, a reply in another thread, an answered reply and a reply already given up on are
-- refused, and a reply with one rejected attempt, still waiting, takes its second). The replies are the distinct `answers`.
create function record_turn_attempt(staff_key text, in_session bigint, in_thread uuid, answers uuid[], outcome text, paid boolean) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sess staff_sessions;
  wanted uuid[];
  made bigint;
begin
  select * into sess from staff_sessions s where s.id = in_session;
  if sess.id is null or sess.staff is distinct from staff_key then
    raise exception 'that session is not %''s', staff_key using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if coalesce(cardinality(answers), 0) = 0 or array_position(answers, null) is not null then
    raise exception 'an attempt names the replies it answers' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  select array_agg(distinct x) into wanted from unnest(answers) x;
  if (select count(*) from pool_waiting_in_thread(in_thread, array[staff_key], now() - coalesce(((select g.value from settings g where g.key = 'pool') -> 'turns' ->> 'waitHours')::integer, 48) * interval '1 hour') w
      where w.act = any (wanted)) is distinct from cardinality(wanted) then
    raise exception 'an attempt names the replies waiting on its own posts in its thread' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  insert into pool_attempts (day, staff, session, thread, outcome, paid)
  values (sess.day, staff_key, in_session, in_thread, record_turn_attempt.outcome, record_turn_attempt.paid) returning id into made;
  insert into pool_attempt_replies (attempt, reply) select made, x from unnest(wanted) x;
  return made;
end $$;
revoke execute on function record_turn_attempt(text, bigint, uuid, uuid[], text, boolean) from public, anon, authenticated;
grant execute on function record_turn_attempt(text, bigint, uuid, uuid[], text, boolean) to service_role;

create or replace function pool_waiting_rows(staff_keys text[], since timestamptz) returns table (staff text, thread uuid, act uuid, author uuid, at timestamptz)
language sql stable as $$
  select c.staff, r.thread, r.id, r.character, r.created_at
  from characters c
  cross join lateral (
    select p.id from acts p
    where p.character = c.id and p.kind = 'post'
      and p.created_at >= pool_waiting_rows.since - coalesce(((select g.value from settings g where g.key = 'pool') ->> 'priorityDays')::integer, 28) * interval '1 day'
  ) mine
  cross join lateral (
    -- Every filter that makes a reply waiting is inside, before the cap, so the cap is the newest 200 waiting replies to a post.
    select x.id, x.thread, x.character, x.created_at from acts x
    join characters w on w.id = x.character and w.staff is null
    where x.target_act_id = mine.id and x.kind = 'post' and x.created_at >= pool_waiting_rows.since
      and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = x.id)
      and not exists (select 1 from pool_answered a where a.reply = x.id)
      -- A reply a failed turn gave up on: refused once by the provider, or rejected twice (record_turn_attempt, 0419). A failed (transport or database) attempt leaves it waiting.
      and not exists (select 1 from pool_attempt_replies ar join pool_attempts pa on pa.id = ar.attempt where ar.reply = x.id and pa.outcome in ('refused', 'rejected')
                      group by ar.reply having bool_or(pa.outcome = 'refused') or count(*) >= 2)
      and locked_out_until(c.id, x.thread) is null
    order by x.created_at desc, x.id desc limit 200
  ) r
  where c.staff = any (pool_waiting_rows.staff_keys) and c.staff_kind = 'persona'
    -- Public: the persona's post is not under a live author veil (a veiled reply was left out above, and is named nowhere).
    and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = mine.id)
$$;

create or replace function pool_waiting_in_thread(in_thread uuid, staff_keys text[], since timestamptz) returns table (staff text, thread uuid, act uuid, author uuid, at timestamptz)
language sql stable as $$
  select c.staff, r.thread, r.id, r.character, r.created_at
  from characters c
  cross join lateral (
    select p.id from acts p
    where p.character = c.id and p.kind = 'post'
      and p.thread = pool_waiting_in_thread.in_thread
      and p.created_at >= pool_waiting_in_thread.since - coalesce(((select g.value from settings g where g.key = 'pool') ->> 'priorityDays')::integer, 28) * interval '1 day'
  ) mine
  cross join lateral (
    -- Every filter that makes a reply waiting is inside, before the cap, so the cap is the newest 200 waiting replies to a post.
    select x.id, x.thread, x.character, x.created_at from acts x
    join characters w on w.id = x.character and w.staff is null
    where x.target_act_id = mine.id and x.kind = 'post' and x.created_at >= pool_waiting_in_thread.since
      and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = x.id)
      and not exists (select 1 from pool_answered a where a.reply = x.id)
      -- A reply a failed turn gave up on: refused once by the provider, or rejected twice (record_turn_attempt, 0419). A failed (transport or database) attempt leaves it waiting.
      and not exists (select 1 from pool_attempt_replies ar join pool_attempts pa on pa.id = ar.attempt where ar.reply = x.id and pa.outcome in ('refused', 'rejected')
                      group by ar.reply having bool_or(pa.outcome = 'refused') or count(*) >= 2)
      and locked_out_until(c.id, x.thread) is null
    order by x.created_at desc, x.id desc limit 200
  ) r
  where c.staff = any (pool_waiting_in_thread.staff_keys) and c.staff_kind = 'persona'
    -- Public: the persona's post is not under a live author veil (a veiled reply was left out above, and is named nowhere).
    and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = mine.id)
$$;

create or replace function pool_waiting_in_board(in_board uuid, staff_keys text[], since timestamptz) returns table (staff text, thread uuid, act uuid, author uuid, at timestamptz)
language sql stable as $$
  select c.staff, r.thread, r.id, r.character, r.created_at
  from characters c
  cross join lateral (
    select p.id from acts p
    join threads pt on pt.id = p.thread and pt.board = pool_waiting_in_board.in_board
    where p.character = c.id and p.kind = 'post'
      and p.created_at >= pool_waiting_in_board.since - coalesce(((select g.value from settings g where g.key = 'pool') ->> 'priorityDays')::integer, 28) * interval '1 day'
  ) mine
  cross join lateral (
    -- Every filter that makes a reply waiting is inside, before the cap, so the cap is the newest 200 waiting replies to a post.
    select x.id, x.thread, x.character, x.created_at from acts x
    join characters w on w.id = x.character and w.staff is null
    where x.target_act_id = mine.id and x.kind = 'post' and x.created_at >= pool_waiting_in_board.since
      and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = x.id)
      and not exists (select 1 from pool_answered a where a.reply = x.id)
      -- A reply a failed turn gave up on: refused once by the provider, or rejected twice (record_turn_attempt, 0419). A failed (transport or database) attempt leaves it waiting.
      and not exists (select 1 from pool_attempt_replies ar join pool_attempts pa on pa.id = ar.attempt where ar.reply = x.id and pa.outcome in ('refused', 'rejected')
                      group by ar.reply having bool_or(pa.outcome = 'refused') or count(*) >= 2)
      and locked_out_until(c.id, x.thread) is null
    order by x.created_at desc, x.id desc limit 200
  ) r
  where c.staff = any (pool_waiting_in_board.staff_keys) and c.staff_kind = 'persona'
    -- Public: the persona's post is not under a live author veil (a veiled reply was left out above, and is named nowhere).
    and not exists (select 1 from post_veil_cover cv join post_veils_live vl on vl.play = cv.play and vl.veil = 'author' where cv.act = mine.id)
$$;

-- The turns written on a UTC day plus its paid failed attempts, instance-wide (the ceiling counts calls that were paid for and nothing else).
create or replace function pool_turns_today(on_day date) returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select (select count(*) from pool_turns t where t.day = on_day)::integer + (select count(*) from pool_attempts p where p.day = on_day and p.paid)::integer
$$;
