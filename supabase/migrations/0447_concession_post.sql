-- A talked-down Mod posts its concession in the thread (docs/plans/2026-11-24-concession-post-design.md; its plan, Task 1).
--
-- Each visit may have a written concession, kept unread in `visit_concessions`: written by the Mod's opening call (a quiz Mod's question call, or a `concession` call for every other Mod), or written empty (`none`) when
-- that call fails, is rejected, is over its cap, the System is off, or its window passed. When an interception succeeds the visit ends as today, then the Mod's character posts in the visit's thread, quoting the visited
-- post: the written concession, else a line drawn from the persona's `staff_concessions`, with `{who}` filled by the interceptor's character's name. One concession post per visit, best effort, never failing the talk-down.
--
-- visit_concessions       one row per visit that has its concession settled: `model` (the Mod's own words, 1 to 280 characters) or `none` (no body, with the reason in `why`). The body rules are the table's own checks. Append-only (an
--                         update, delete or truncate is refused, always); no client reads it (row security on, nothing granted). A written concession reaches no page before it is posted.
-- visit_concession_posts  one row per visit whose concession post was tried: its source (`model` or `stock`), the post's Act, or the refusal's words when the post was refused. Its primary key is the "one post per visit" guard.
--                         Append-only; only an admin reads it (no client role), as visit_draw_failures (0105) is.
-- staff_concessions       a persona's stock lines, seeded from its `concessions` as staff_quiz_questions is from its quiz. No client reads it. A reseed replaces what an earlier seed wrote.
-- visits_open.concession_at   the pending concessions' index. FORM USED: a column on visits_open, as visits_open.quiz_at (0446) is, with a partial index on it, so "the open non-quiz visits with no row, oldest first" reads only the
--                         pending ones. A trigger sets it when the open row is made (no row stands; a quiz visit is marked too, for the tick) and another clears it when the row is written, so rebuild_visits_open (0105)
--                         needs no change. A visit that ends while pending loses its open row, and with it the mark; a late write is refused for an ended visit.
-- concession_line_index(visit, n)   service only. Which of a persona's n stock lines the visit draws: the visit id's own hash modulo n, never negative, so the same visit draws the same line on any database.
-- write_visit_concession(visit, source, body, why)   service only. Writes the row once (a second write answers the row that stands); writes nothing for a visit that has ended ({written: false, ended: true}), so a late call is
--                         never posted and never kept. It takes the visit's open row for update, so a talk-down racing it either ends first (and the write finds the visit over) or waits for the write and posts it.
-- pending_concessions(most)   service only. The open non-quiz visits with no row, started less than `modBots.concessionWriteMinutes` ago (15 where the setting is missing), oldest first, in the columns pending_quizzes answers.
--                         There is no bank requirement: a stock line (or none) always stands behind a missing concession.
-- concession_calls_today()    service only. Today's (UTC) ledger calls for the duty `concession`, as quiz_calls_today counts quizzes.
-- backfill_visit_concessions()   service only, and run once below: a `none` row (why `before`) for every visit that has none, open or ended, so no staff run calls for an old visit and an open one talked down posts its stock. Idempotent.
-- post_concession(visit, interceptor)   internal: security definer, with no grant to any role; only intercept and distract_visits call it. Posts the concession in a block of its own, so a refusal (a lockout, a benched or waiting
--                         persona, a No quote, a spring) rolls back only the post, and records the outcome in visit_concession_posts either way.
-- system_tick       (0446), step 7 also writes the `none` concession row (why `window`) in the same step as a quiz's bank row, and a new step 8 writes `none` for each open visit with no concession row past its window
--                   (`quizWriteMinutes` for a quiz visit, whether or not its question was written; `concessionWriteMinutes` for any other), whatever the switch says; counted as `concessionsLapsed`. Best effort per visit.
-- intercept         (0446) and distract_visits (0108): after a successful talk-down's end_visit answers `ended: true`, they call post_concession (distract_visits after it has ended every visit, in the Mods' character order). intercept takes the
--                   thread's row first, so a cast and an interception in one thread are one after the other (the reasoning is on distract_visits below).
-- seed_instance     (0413), seeding staff_concessions from each persona's `concessions`. setting_modbots (0446), holding `concessionsPerDay` and `concessionWriteMinutes`. staff_call_records (0446), taking the duty `concession`.
-- Latest definitions copied: system_tick (0446), intercept (0446), setting_modbots (0446), distract_visits (0108), seed_instance (0413); quiz_calls_today (0446) is the pattern for concession_calls_today.
--
-- Settings: `modBots` now requires both fields (the TypeScript check and every seeded settings object carry them); a stored row without them is given defaults below, an instance already seeded gets its own from its next reseed.

-- ------------------------------------------------------------------------------------------------ the tables ----

create table visit_concessions (
  visit_act uuid primary key references acts (id),
  source text not null check (source in ('model', 'none')),
  body text,
  why text,
  at timestamptz not null default now(),
  -- A model row has words (not blank); a none row has none.
  constraint visit_concessions_body_present check ((source = 'model') = (body is not null and btrim(body) <> '')),
  constraint visit_concessions_body_empty check (source = 'model' or body is null),
  constraint visit_concessions_body_length check (char_length(body) <= 280)
);
alter table visit_concessions enable row level security;
revoke all on visit_concessions from public, anon, authenticated;

create function visit_concessions_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a visit''s concession is never edited or removed (%)', tg_op using errcode = 'P0001';
end $$;
create trigger visit_concessions_no_update before update or delete on visit_concessions for each row execute function visit_concessions_append_only();
create trigger visit_concessions_no_truncate before truncate on visit_concessions for each statement execute function visit_concessions_append_only();
alter table visit_concessions enable always trigger visit_concessions_no_update;
alter table visit_concessions enable always trigger visit_concessions_no_truncate;
revoke execute on function visit_concessions_append_only() from public, anon, authenticated;

create table visit_concession_posts (
  visit_act uuid primary key references acts (id),
  source text not null check (source in ('model', 'stock')),
  post_act uuid references acts (id),
  error text,
  at timestamptz not null default now(),
  -- Posted, or refused with its reason; never both and never neither.
  constraint visit_concession_posts_outcome check ((post_act is null) = (error is not null))
);
alter table visit_concession_posts enable row level security;
revoke all on visit_concession_posts from public, anon, authenticated;

create function visit_concession_posts_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a visit''s concession post is never edited or removed (%)', tg_op using errcode = 'P0001';
end $$;
create trigger visit_concession_posts_no_update before update or delete on visit_concession_posts for each row execute function visit_concession_posts_append_only();
create trigger visit_concession_posts_no_truncate before truncate on visit_concession_posts for each statement execute function visit_concession_posts_append_only();
alter table visit_concession_posts enable always trigger visit_concession_posts_no_update;
alter table visit_concession_posts enable always trigger visit_concession_posts_no_truncate;
revoke execute on function visit_concession_posts_append_only() from public, anon, authenticated;

-- A persona's stock lines. Seeded (and replaced by a reseed) like staff_quiz_questions (0108), so it is not append-only: it is a seed's table, and no client reads it.
create table staff_concessions (
  staff text not null references characters (staff),
  idx integer not null check (idx >= 0),
  line text not null check (btrim(line) <> '' and char_length(line) <= 280),
  primary key (staff, idx)
);
alter table staff_concessions enable row level security;
revoke all on staff_concessions from public, anon, authenticated;

-- ------------------------------------------------------------------------------------- the pending index ----

alter table visits_open add column concession_at timestamptz;
create index visits_open_concession_pending on visits_open (concession_at, visit_act) where concession_at is not null;

-- When an open row is made for a visit that has no concession yet, it is marked with the visit's start, a quiz visit's too: its concession comes with its question where the staff run writes both, and the tick settles it `none`
-- at quizWriteMinutes where that run wrote only the question (or none). pending_concessions leaves the quiz visits out of the staff run's list.
create function visits_open_mark_concession() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.concession_at := (select a.created_at from acts a where a.id = new.visit_act and a.kind = 'visit'
                          and not exists (select 1 from visit_concessions c where c.visit_act = a.id));
  return new;
end $$;
revoke execute on function visits_open_mark_concession() from public, anon, authenticated;
create trigger visits_open_mark_concession before insert on visits_open for each row execute function visits_open_mark_concession();

-- When the concession is written the visit is no longer pending.
create function visit_concessions_clear_mark() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update visits_open set concession_at = null where visit_act = new.visit_act and concession_at is not null;
  return null;
end $$;
revoke execute on function visit_concessions_clear_mark() from public, anon, authenticated;
create trigger visit_concessions_clear_mark after insert on visit_concessions for each row execute function visit_concessions_clear_mark();

-- ---------------------------------------------------------------------------------------------- the writers ----

-- Which of n stock lines a visit draws: its id's own hash, modulo n, and never negative (the hash is a signed bigint, and % keeps the sign). null where there are no lines.
create function concession_line_index(visit uuid, n integer) returns integer
language sql immutable set search_path = public, pg_temp as $$
  select case when n > 0 then (((hashtextextended(visit::text, 0) % n::bigint) + n) % n)::integer end
$$;

create function write_visit_concession(visit uuid, source text, body text, why text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  made boolean;
  row visit_concessions%rowtype;
begin
  if not exists (select 1 from acts v where v.id = write_visit_concession.visit and v.kind = 'visit') then
    raise exception 'there is no such visit' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  -- The open row, taken for update: a talk-down ends the visit under the same lock, so a write either lands before it (and is posted) or finds the visit over (and is not kept).
  perform 1 from visits_open o where o.visit_act = write_visit_concession.visit for update;
  if not found or exists (select 1 from acts e where e.kind = 'visit_end' and e.target_act_id = write_visit_concession.visit) then
    return jsonb_build_object('written', false, 'ended', true);
  end if;
  insert into visit_concessions (visit_act, source, body, why)
  values (write_visit_concession.visit, write_visit_concession.source, write_visit_concession.body, write_visit_concession.why)
  on conflict (visit_act) do nothing
  returning * into row;
  made := found;
  if not made then select * into row from visit_concessions c where c.visit_act = write_visit_concession.visit; end if;
  return jsonb_build_object('written', made, 'source', row.source, 'body', row.body, 'why', row.why);
end $$;

create function pending_concessions(most integer) returns table (visit_act uuid, staff text, post_act uuid, thread uuid, board uuid, board_name text, charges jsonb, started_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.visit_act, c.staff, o.post, v.thread, t.board, b.name, visit_charges(o.visit_act), o.concession_at
  from visits_open o
  join acts v on v.id = o.visit_act
  join characters c on c.id = v.character
  join threads t on t.id = v.thread
  left join boards_now b on b.id = t.board
  where o.concession_at is not null
    and v.payload #>> '{challenge,kind}' is distinct from 'quiz'
    and o.concession_at > now() - make_interval(mins => coalesce((select (s.value ->> 'concessionWriteMinutes')::integer from settings s where s.key = 'modBots'), 15))
  order by o.concession_at, o.visit_act
  limit greatest(pending_concessions.most, 0)
$$;

create function concession_calls_today() returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::integer from model_calls m where m.duty = 'concession' and m.at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
$$;

create function backfill_visit_concessions() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  with made as (
    insert into visit_concessions (visit_act, source, why)
    select v.id, 'none', 'before' from acts v where v.kind = 'visit'
    on conflict (visit_act) do nothing
    returning 1
  ) select count(*)::integer into n from made;
  return n;
end $$;

-- The post a talked-down Mod makes. The body is the visit's `model` row's, else a line of the persona's stock drawn by the visit's id; `{who}` is the interceptor's character's name (one `replace` pass, so a name that holds
-- `{who}` is not filled again). It is written as the Mod's own post quoting the visited post, inside a block of its own: any refusal (a lockout, a benched or waiting persona, a No quote on the visited post, a trap springing)
-- rolls back only the post, and is recorded with a warning. A visit already recorded posts nothing, and a Mod with no line and no body records `no concession`. The talk-down never fails with the post.
-- The filled body is cut to `postMaxLength` (see `cap`). The block's rollback takes everything write_staff_act did after the block began (the Act, its counts and quote rows) and nothing before it.
create function post_concession(visit uuid, interceptor uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v acts%rowtype;
  mod_key text;
  who text;
  said text;
  src text := 'stock';
  made jsonb;
  -- What bounds the body: a line is at most 280 characters, but each `{who}` in it grows it by the interceptor's name (up to 40 characters), so a line of many tokens could outgrow a post. A staff Act is no player's
  -- post and write_staff_act checks no length, so the filled body is cut to the instance's `postMaxLength` here (5000 where it is missing).
  cap integer := greatest(coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'postMaxLength'), 5000), 1);
begin
  if exists (select 1 from visit_concession_posts p where p.visit_act = post_concession.visit) then return; end if;
  select * into v from acts a where a.id = post_concession.visit and a.kind = 'visit';
  if not found then return; end if;
  select c.staff into mod_key from characters c where c.id = v.character;
  select c.name into who from characters c where c.id = post_concession.interceptor;
  begin
    select c.body into said from visit_concessions c where c.visit_act = post_concession.visit and c.source = 'model';
    if said is not null then
      src := 'model';
    else
      -- One read: the persona's lines numbered in order, the count beside each, and the one the visit's id draws.
      select l.line into said from (select s.line, row_number() over (order by s.idx) - 1 as pos, count(*) over () as total from staff_concessions s where s.staff = mod_key) l
      where l.pos = concession_line_index(post_concession.visit, l.total::integer);
    end if;
    if said is null then raise exception 'no concession' using errcode = 'P0001'; end if;
    made := write_staff_act(mod_key, 'post', v.thread, v.target_act_id, jsonb_build_object('body', left(replace(said, '{who}', coalesce(who, 'someone')), cap)));
    insert into visit_concession_posts (visit_act, source, post_act) values (post_concession.visit, src, (made ->> 'id')::uuid);
  exception when others then
    raise warning 'post_concession: visit % posted no concession: % (%)', post_concession.visit, sqlerrm, sqlstate;
    insert into visit_concession_posts (visit_act, source, error) values (post_concession.visit, src, left(sqlerrm, 500)) on conflict (visit_act) do nothing;
  end;
end $$;

revoke execute on function concession_line_index(uuid, integer), write_visit_concession(uuid, text, text, text), pending_concessions(integer), concession_calls_today(), backfill_visit_concessions() from public, anon, authenticated;
grant execute on function concession_line_index(uuid, integer), write_visit_concession(uuid, text, text, text), pending_concessions(integer), concession_calls_today(), backfill_visit_concessions() to service_role;
-- post_concession is the one function here no role calls: intercept and distract_visits (security definer, the owner's) are its only callers.
revoke execute on function post_concession(uuid, uuid) from public, anon, authenticated, service_role;

-- Visits already held: every visit, open or ended, is given a `none` row (none becomes pending, no staff run calls for an old visit, and an open one talked down posts its stock).
select backfill_visit_concessions();

-- staff_call_records (0446), also taking the duty concession, the call that writes a visit's concession. Everything else as 0446 wrote it.
alter table staff_call_records drop constraint staff_call_records_duty_check;
alter table staff_call_records add constraint staff_call_records_duty_check check (duty in ('filing', 'reportJudge', 'patrolJudge', 'appeal', 'ruling', 'apologyJudge', 'standingOrderLine', 'quizQuestion', 'concession'));

-- --------------------------------------------------------------------------------------------- the setting ----

-- setting_modbots (0446_written_quiz.sql), also holding `concessionsPerDay` (a whole number, at least 0; 0 means the stock always) and `concessionWriteMinutes` (a whole number, at least 1). Everything else as 0446 wrote it.
create or replace function setting_modbots(v jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  wholes constant jsonb := '{"allowanceMost": 1, "ruleDaysMost": 1, "patrolsPerDay": 0, "reportPrice": 0, "reportsPerDay": 1, "judgmentsPerDay": 1, "filingLinesPerDay": 1, "appealPrice": 0, "tailHours": 1, "filingGraceMinutes": 1, "quizQuestionsPerDay": 0, "quizWriteMinutes": 1, "concessionsPerDay": 0, "concessionWriteMinutes": 1}';
  fields constant text[] := array['allowanceMost', 'ruleDaysMost', 'patrolsPerDay', 'reportPrice', 'reportsPerDay', 'judgmentsPerDay', 'filingLinesPerDay', 'appealPrice', 'tailHours', 'filingGraceMinutes', 'quizQuestionsPerDay', 'quizWriteMinutes', 'concessionsPerDay', 'concessionWriteMinutes', 'patrolSample', 'patrolPool', 'visitHours', 'cap', 'filingCron'];
  shape constant text := 'an object giving allowanceMost, ruleDaysMost, reportsPerDay, judgmentsPerDay, filingLinesPerDay, tailHours, filingGraceMinutes, quizWriteMinutes and concessionWriteMinutes (whole numbers, at least 1), patrolsPerDay, reportPrice, appealPrice, quizQuestionsPerDay and concessionsPerDay (whole numbers, at least 0), patrolSample (a whole number from 1 to 25), patrolPool (a whole number from patrolSample to 100), visitHours (least and most, whole hours, at least 1, most not below least), cap (punishments and days, whole numbers, at least 1) and filingCron (a five-field cron expression, each field inside its range)';
  k text;
begin
  if jsonb_typeof(v) is distinct from 'object' then return shape; end if;
  select e into k from jsonb_object_keys(v) e where e <> all (fields) limit 1;
  if k is not null then return format('%s; "%s" is not one of its fields', shape, k); end if;
  for k in select jsonb_object_keys(wholes) loop
    if not setting_whole(v -> k, (wholes ->> k)::numeric) then return format('%s; "%s" is not', shape, k); end if;
  end loop;
  if not setting_whole(v -> 'patrolSample', 1, 25) then return shape || '; "patrolSample" is not'; end if;
  if not setting_whole(v -> 'patrolPool', (v ->> 'patrolSample')::numeric, 100) then return shape || '; "patrolPool" is not'; end if;
  if not coalesce(jsonb_typeof(v -> 'visitHours') = 'object' and (select count(*) from jsonb_object_keys(v -> 'visitHours')) = 2
      and setting_whole(v -> 'visitHours' -> 'least', 1) and setting_whole(v -> 'visitHours' -> 'most', 1)
      and (v -> 'visitHours' ->> 'most')::numeric >= (v -> 'visitHours' ->> 'least')::numeric, false) then
    return shape || '; "visitHours" is not';
  end if;
  if not coalesce(jsonb_typeof(v -> 'cap') = 'object' and (select count(*) from jsonb_object_keys(v -> 'cap')) = 2
      and setting_whole(v -> 'cap' -> 'punishments', 1) and setting_whole(v -> 'cap' -> 'days', 1), false) then
    return shape || '; "cap" is not';
  end if;
  if not setting_cron(v -> 'filingCron') then return shape || '; "filingCron" is not'; end if;
  return null;
end $$;

-- A deployed instance's stored `modBots` row lacks the two fields, and the staff function's settings check would refuse the whole staff run until a reseed. The data step gives each missing field its default,
-- independently: `concessionWriteMinutes` 15 and `concessionsPerDay` 0 (0 means the stock always, so no paid call starts until the instance's own seed sets its budget). A row that already holds a field keeps it. A migration's
-- write is a seed's: kayfabb.seeding is on, so settings_tuned (0355) leaves tuned_at as it was. At replay there is no row, so it changes nothing on a fresh database. A function, so the test can call it on a row it plants.
create function migrate_modbots_concession_fields() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  was text := current_setting('kayfabb.seeding', true);
  n integer;
begin
  perform set_config('kayfabb.seeding', 'on', true);
  update settings set value = value
      || case when value ? 'concessionWriteMinutes' then '{}'::jsonb else jsonb_build_object('concessionWriteMinutes', 15) end
      || case when value ? 'concessionsPerDay' then '{}'::jsonb else jsonb_build_object('concessionsPerDay', 0) end
  where key = 'modBots' and not (value ? 'concessionWriteMinutes' and value ? 'concessionsPerDay');
  get diagnostics n = row_count;
  perform set_config('kayfabb.seeding', coalesce(nullif(was, ''), 'off'), true);
  return n;
end $$;
revoke execute on function migrate_modbots_concession_fields() from public, anon, authenticated;
grant execute on function migrate_modbots_concession_fields() to service_role;
select migrate_modbots_concession_fields();

-- ------------------------------------------------------------------------------------------- the seed ----

-- seed_instance (0413_rewind), also seeding `staff_concessions` from each persona's `concessions`. Everything else as 0413 wrote it. Its grants are as they were (replaced in place).
create or replace function public.seed_instance(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  flags integer;
  flagged text;
  unknown text;
  sys uuid;
  opened uuid;
  was text := current_setting('kayfabb.seeding', true);
  listed text[];
  first_staff text[];
  departing text[];
  departed text[] := '{}';
  returned text[] := '{}';
  open_id bigint;
  boss_was text;
  handed text;
  mods_were bigint;
  retiring boolean := payload ? 'formerly' or payload ? 'withdrawn';
  moving record;
  copies bigint;
  renamed jsonb := '[]'::jsonb;
  withdrawn_out jsonb := '[]'::jsonb;
  strays uuid[];
  left_boards uuid[];
  placed integer := 0;
  counting record;
  on_list bigint;
begin
  -- Two seeds at once would each find no office row and both write one into the append-only office log. An advisory
  -- transaction lock serializes seeds without locking any table a player reads, and lets go at commit.
  perform pg_advisory_xact_lock(hashtext('kayfabb.seed_instance'));
  -- And then the offices lock, before any persona row is written: set_office and a handover take it first and then row-lock a persona, so a seed that took it after its persona upserts would wait on a row an admin
  -- holds while the admin waits on this lock. One order everywhere: seed lock, offices lock, rows.
  perform pg_advisory_xact_lock(hashtext('kayfabb.offices'));
  -- The settings trigger (settings_tuned) marks a row tuned for any write but a seed's: this transaction is the seed's, so its writes leave no mark.
  perform set_config('kayfabb.seeding', 'on', true);
  select count(*), min(e ->> 'slug') into flags, flagged
  from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false);
  if flags > 1 then raise exception 'a seed flags one board as The System''s, not %', flags using errcode = '22023'; end if;
  -- The economy is merged, number by number: a card kind is never removed, so the numbers its rules read stay in the row with it.
  perform seed_setting(e.key, e.value) from jsonb_each(payload -> 'settings') e;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  -- Reaction kinds are the one vocabulary a seed removes. Classes and cards never are: a card must outlive its slot and its pulls
  -- (0139). A reaction kind has nothing that must outlive it once nothing uses it, and a kind something does use is never removed.
  if payload ? 'reactions' then
    select string_agg(k.key || ' (' || (select count(*) from reactions r where r.kind = k.key) || ' reactions)', ', ' order by k.key) into unknown
    from reaction_kinds k
    where not exists (select 1 from jsonb_array_elements(payload -> 'reactions') e where e ->> 'key' = k.key)
      and (exists (select 1 from reactions r where r.kind = k.key) or exists (select 1 from reaction_tallies t where t.kind = k.key));
    if unknown is not null then
      raise exception 'the instance no longer lists reaction kinds that reactions use: %; a used kind is never removed (#216)', unknown using errcode = '22023';
    end if;
    -- `not exists`, not `not in`: an element with no key would make `not in` null for every kind, hiding a used one.
    delete from reaction_kinds k where not exists (select 1 from jsonb_array_elements(payload -> 'reactions') e where e ->> 'key' = k.key);
  end if;
  insert into reaction_kinds (key, emoji, quadrant) select e ->> 'key', e ->> 'emoji', e ->> 'quadrant' from jsonb_array_elements(payload -> 'reactions') e
  on conflict (key) do update set emoji = excluded.emoji, quadrant = excluded.quadrant;
  -- Member groups (0128): the instance's whole set, the ladder and the groups a move confers. A condition kind group_now has no case for stops the seed,
  -- naming the group. A group the payload no longer lists is deleted unless a move (landed or queued) names it, so the log line that names it still can.
  if payload ? 'groups' then
    select string_agg(e ->> 'key' || ' (' || coalesce(e ->> 'condition', 'none') || ')', ', ') into unknown
    from jsonb_array_elements(payload -> 'groups') e
    where e ->> 'source' = 'ladder' and coalesce(e ->> 'condition', '') <> all (array['default', 'posts', 'seasons', 'staff']);
    if unknown is not null then
      raise exception 'the instance''s groups name a condition kind group_now has no case for: %', unknown using errcode = '22023';
    end if;
    delete from group_kinds k
    where not exists (select 1 from jsonb_array_elements(payload -> 'groups') e where e ->> 'key' = k.key)
      and not exists (select 1 from acts a where a.kind = 'move' and a.payload ->> 'kind' = 'conferGroup' and a.payload #>> '{params,group}' = k.key)
      and not exists (select 1 from queued_moves q where q.kind = 'conferGroup' and q.params ->> 'group' = k.key);
    insert into group_kinds (key, name, badge, color, stripe, source, rung, condition, at_least, tone)
    select e ->> 'key', e ->> 'name', e ->> 'badge', e ->> 'color', coalesce((e ->> 'stripe')::boolean, false), e ->> 'source', (e ->> 'rung')::integer,
      e ->> 'condition', (e ->> 'atLeast')::integer, e ->> 'tone'
    from jsonb_array_elements(payload -> 'groups') e
    on conflict (key) do update set name = excluded.name, badge = excluded.badge, color = excluded.color, stripe = excluded.stripe, source = excluded.source, rung = excluded.rung,
      condition = excluded.condition, at_least = excluded.at_least, tone = excluded.tone;
  end if;
  -- A card's play, rarity, trap, gimmick and time up (0054, 0148), and its reaches (0055), checked as instanceProblems checks them, each
  -- naming the card. The reaches are read against reachRarity and reachLasts as the settings above have just written them.
  select nullif(concat_ws('; ', card_kinds_problem(payload -> 'cards'), card_reach_problem(payload -> 'cards')), '') into unknown;
  if unknown is not null then raise exception '%', unknown using errcode = '22023'; end if;
  -- The three ways a card leaves (0404). A seed that carries `formerly` or `withdrawn` says where every card a seed wrote stands (from_seed), and is refused, naming the keys, where it does not: a key in none of cards, formerly and withdrawn,
  -- a key in more than one, a renaming into a card the seed does not list (or into itself; a name already gone may point at a withdrawn card, and needs no entry when the card its chain ends in is listed), a refund that is not a positive whole number, and a card that left listed as a card again (a card that comes back takes a new key).
  -- The refusal does not depend on who holds what. Nothing is written before it.
  if retiring then
    select string_agg(k.key, ', ' order by k.key) into unknown from card_kinds k
    where k.from_seed and not exists (select 1 from jsonb_array_elements(coalesce(payload -> 'cards', '[]')) e where e ->> 'key' = k.key)
      and not exists (select 1 from jsonb_array_elements(coalesce(payload -> 'formerly', '[]')) e where e ->> 'key' = k.key)
      and not exists (select 1 from jsonb_array_elements(coalesce(payload -> 'withdrawn', '[]')) e where e ->> 'key' = k.key)
      -- A renamed card is listed by name, under the card that carries it, so history never says "a card". The one name that needs no entry is a card that was renamed and whose chain then ended in a withdrawal that the payload lists:
      -- no card can carry that name, so there is no shape the instance could write for it.
      and not (k.gone_at is not null and exists (
        select 1 from card_now(k.key) n join jsonb_array_elements(coalesce(payload -> 'withdrawn', '[]')) w on w ->> 'key' = n.key where n.refund is not null));
    if unknown is not null then
      raise exception 'the seed lists % as no card, no former name and no withdrawn card: a card the database holds is listed as one of the three, never left out', unknown using errcode = '22023';
    end if;
    select string_agg(d.key, ', ' order by d.key) into unknown
    from (select x.key from (select e ->> 'key' as key from jsonb_array_elements(coalesce(payload -> 'cards', '[]')) e
                             union all select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'formerly', '[]')) e
                             union all select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'withdrawn', '[]')) e) x group by x.key having count(*) > 1) d;
    if unknown is not null then raise exception 'the seed lists % in more than one of its cards, former names and withdrawn cards: a card is in one', unknown using errcode = '22023'; end if;
    select string_agg(f.e ->> 'key' || ' (renamed to ' || coalesce(f.e ->> 'became', 'nothing') || ')', ', ' order by f.e ->> 'key') into unknown
    from jsonb_array_elements(coalesce(payload -> 'formerly', '[]')) f(e)
    where f.e ->> 'became' is null or f.e ->> 'became' = f.e ->> 'key'
       or not (exists (select 1 from jsonb_array_elements(coalesce(payload -> 'cards', '[]')) c where c ->> 'key' = f.e ->> 'became')
               -- a name already gone may point at a card the payload withdraws (its copies were that card's when it was refunded)
               or (exists (select 1 from jsonb_array_elements(coalesce(payload -> 'withdrawn', '[]')) w where w ->> 'key' = f.e ->> 'became')
                   and exists (select 1 from card_kinds g where g.key = f.e ->> 'key' and g.gone_at is not null)));
    if unknown is not null then raise exception 'a card is renamed to another card the seed lists as a card, never to itself or to nothing: %', unknown using errcode = '22023'; end if;
    select string_agg(w.e ->> 'key', ', ' order by w.e ->> 'key') into unknown
    from jsonb_array_elements(coalesce(payload -> 'withdrawn', '[]')) w(e)
    where jsonb_typeof(w.e -> 'refund') is distinct from 'number' or (w.e ->> 'refund') !~ '^[1-9][0-9]{0,8}$';
    if unknown is not null then raise exception 'a withdrawn card is refunded a positive whole number of hundredths: %', unknown using errcode = '22023'; end if;
    select string_agg(k.key, ', ' order by k.key) into unknown from card_kinds k
    where k.gone_at is not null and exists (select 1 from jsonb_array_elements(coalesce(payload -> 'cards', '[]')) e where e ->> 'key' = k.key);
    if unknown is not null then
      raise exception '% already left the game and cannot be listed as a card again: a card that comes back takes a new key', unknown using errcode = '22023';
    end if;
  end if;
  -- A card's stack, whether it is seeded and the economy numbers its rules read are the code's, as its name is; so
  -- are its rarity, its play, its trap (with its match), its gimmick, its discipline, how long a Use of it is up, where it reaches, whether it pins, whether it writes, whether it replies, whether it keeps, its skim, whether it scores as a class, what it draws, its drive and the words it refuses a blank message with.
  insert into card_kinds (key, name, alignment, stack, seeded, reads, rarity, play, trap, gimmick, refunds, discipline, lasts, reaches, pins, writes, replies, keeps, skim, scores_as, draws, drive, needs_message, veil, adds_reaction, surface, from_seed, cuts, draws_effect, rewind)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}'),
    e ->> 'rarity', coalesce(e ->> 'play', 'cast'), nullif(e -> 'trap', 'null'), nullif(e -> 'gimmick', 'null'), nullif(e -> 'refunds', 'null'), nullif(e -> 'discipline', 'null'), span_interval(e -> 'lasts'),
    case when e ? 'reaches' then array(select jsonb_array_elements_text(e -> 'reaches')) else '{post}' end, coalesce((e ->> 'pins')::boolean, false), coalesce((e ->> 'writes')::boolean, false),
    coalesce((e ->> 'replies')::boolean, false), coalesce((e ->> 'keeps')::boolean, false),
    nullif(e -> 'skim', 'null'), coalesce((e ->> 'scoresAs')::boolean, false),
    case when jsonb_typeof(e -> 'draws') = 'array' then array(select jsonb_array_elements_text(e -> 'draws')) end, nullif(e -> 'drive', 'null'), nullif(e ->> 'needsMessage', ''),
    nullif(e ->> 'veil', ''), coalesce((e ->> 'addsReaction')::boolean, false), coalesce((e ->> 'surface')::boolean, false), true, nullif(e -> 'cuts', 'null'), coalesce((e ->> 'drawsEffect')::boolean, false), e #>> '{rewind,upTo}'
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads,
    rarity = excluded.rarity, play = excluded.play, trap = excluded.trap, gimmick = excluded.gimmick, refunds = excluded.refunds, discipline = excluded.discipline, lasts = excluded.lasts,
    reaches = excluded.reaches, pins = excluded.pins, writes = excluded.writes, replies = excluded.replies, keeps = excluded.keeps, skim = excluded.skim, scores_as = excluded.scores_as,
    draws = excluded.draws, drive = excluded.drive, needs_message = excluded.needs_message, veil = excluded.veil, adds_reaction = excluded.adds_reaction, surface = excluded.surface, from_seed = true, cuts = excluded.cuts, draws_effect = excluded.draws_effect, rewind = excluded.rewind;
  -- Out of print (0404): the flag sets retired_at, kept while it stays and cleared when it goes.
  update card_kinds k set retired_at = case when coalesce((e.c ->> 'retired')::boolean, false) then coalesce(k.retired_at, now()) end
  from jsonb_array_elements(payload -> 'cards') e(c)
  where k.key = e.c ->> 'key' and k.retired_at is distinct from case when coalesce((e.c ->> 'retired')::boolean, false) then coalesce(k.retired_at, now()) end;
  -- Renamed and withdrawn (0404): each key not yet gone is moved by card_leaves, once ever, and its copies are counted for the answer.
  if retiring then
    for moving in
      select f.e ->> 'key' as old, f.e ->> 'became' as became, null::integer as refund from jsonb_array_elements(coalesce(payload -> 'formerly', '[]')) f(e) join card_kinds k on k.key = f.e ->> 'key' where k.gone_at is null
      union all
      select w.e ->> 'key', null, (w.e ->> 'refund')::integer from jsonb_array_elements(coalesce(payload -> 'withdrawn', '[]')) w(e) join card_kinds k on k.key = w.e ->> 'key' where k.gone_at is null
      order by 1
    loop
      copies := card_leaves(moving.old, moving.became, moving.refund);
      if moving.became is not null then renamed := renamed || jsonb_build_object('from', moving.old, 'to', moving.became, 'copies', copies);
      else withdrawn_out := withdrawn_out || jsonb_build_object('key', moving.old, 'copies', copies, 'refunded', copies * moving.refund); end if;
    end loop;
  end if;
  -- The packs the instance sells (replaced each seed: their pulls are its code), then the slots it names that the database does not hold yet,
  -- at the end of the grid in the instance's order. A slot already holding the item is never touched: its place, availability and price are an
  -- admin's (0139). A pack or card a slot names must exist, and a missing one is a foreign key's refusal.
  -- A pack is a pull pack (its pulls and what it leaves out) or a fixed one (its cards in order, 0377); the table holds exactly one of the two.
  insert into pack_kinds (key, pulls, leaves, contents)
  select e ->> 'key', nullif(e -> 'pulls', 'null'), coalesce(array(select jsonb_array_elements_text(e -> 'leaves')), '{}'),
         case when jsonb_typeof(e -> 'contents') = 'array' then array(select jsonb_array_elements_text(e -> 'contents')) end
  from jsonb_array_elements(coalesce(payload -> 'packs', '[]')) e
  on conflict (key) do update set pulls = excluded.pulls, leaves = excluded.leaves, contents = excluded.contents;
  -- A pack kind the payload does not list is out of print, one it lists is not (0404; a payload with no `packs` says nothing of pack kinds): its slot is left out of the machine, and a sealed pack of it still opens.
  if retiring and payload ? 'packs' then
    update pack_kinds k set retired_at = x.want
    from (select p.key, case when l.key is null then coalesce(p.retired_at, now()) end as want
          from pack_kinds p left join (select distinct e ->> 'key' as key from jsonb_array_elements(coalesce(payload -> 'packs', '[]')) e) l on l.key = p.key) x
    where x.key = k.key and k.retired_at is distinct from x.want;
  end if;
  if payload ? 'gear' then
    insert into gear_kinds (key, rarity) select e ->> 'key', e ->> 'rarity' from jsonb_array_elements(payload -> 'gear') e
    on conflict (key) do update set rarity = excluded.rarity;
    delete from gear_kinds k where not exists (select 1 from jsonb_array_elements(payload -> 'gear') e where e ->> 'key' = k.key)
      and not exists (select 1 from gear_ledger l where l.gear = k.key) and not exists (select 1 from gear_worn w where w.gear = k.key);
  end if;
  if payload ? 'eventLines' then
    insert into event_lines (key, outcome, text) select e ->> 'key', e ->> 'outcome', e ->> 'text' from jsonb_array_elements(payload -> 'eventLines') e
    on conflict (key) do update set outcome = excluded.outcome, text = excluded.text;
    delete from event_lines l where not exists (select 1 from jsonb_array_elements(payload -> 'eventLines') e where e ->> 'key' = l.key);
  end if;
  -- The instance's trophy kinds (0206): added and brought up to date, the places, the Boss's kinds and the met demand's set as the catalog names them, and a kind the instance
  -- dropped removed unless an award names it. An admin-made kind is never touched, and an instance key that begins `made-` is refused (those are the admin page's).
  if payload ? 'trophies' then
    select string_agg(e ->> 'key', ', ') into unknown from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e where e ->> 'key' like 'made-%';
    if unknown is not null then raise exception 'a trophy key begins "made-" only on the admin page: %', unknown using errcode = '22023'; end if;
    select string_agg(k, ', ') into unknown
    from (select jsonb_array_elements_text(coalesce(payload -> 'trophies' -> 'seasonPlaces', '[]') || coalesce(payload -> 'trophies' -> 'boss', '[]')
                                           || case when payload -> 'trophies' ? 'demandMet' then jsonb_build_array(payload -> 'trophies' ->> 'demandMet') else '[]'::jsonb end) k) n
    where not exists (select 1 from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e where e ->> 'key' = n.k);
    if unknown is not null then raise exception 'the trophy catalog names kinds it does not define: %', unknown using errcode = '22023'; end if;
    -- The flags are cleared and set again, so that the unique indexes never see a place twice.
    update trophy_kinds set season_place = null, boss_gives = false, demand_met = false where made_by is null and (season_place is not null or boss_gives or demand_met);
    insert into trophy_kinds (key, name, line, belt) select e ->> 'key', e ->> 'name', nullif(e ->> 'line', ''), coalesce((e ->> 'belt')::boolean, false)
    from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e
    on conflict (key) do update set name = excluded.name, line = excluded.line, belt = excluded.belt;
    update trophy_kinds k set season_place = p.n::smallint
    from jsonb_array_elements_text(coalesce(payload -> 'trophies' -> 'seasonPlaces', '[]')) with ordinality p(key, n) where k.key = p.key;
    update trophy_kinds k set boss_gives = true where k.key in (select jsonb_array_elements_text(coalesce(payload -> 'trophies' -> 'boss', '[]')));
    update trophy_kinds k set demand_met = true where k.key = payload -> 'trophies' ->> 'demandMet';
    delete from trophy_kinds k where k.made_by is null and not exists (select 1 from jsonb_array_elements(payload -> 'trophies' -> 'kinds') e where e ->> 'key' = k.key)
      and not exists (select 1 from trophy_awards a where a.trophy = k.key);
  end if;
  insert into machine_slots (position, card, pack, availability, price)
  select (select coalesce(max(position), 0) from machine_slots) + row_number() over (order by m.i), m.e ->> 'card', m.e ->> 'pack', m.e ->> 'availability', (m.e ->> 'price')::integer
  from jsonb_array_elements(coalesce(payload -> 'machine', '[]')) with ordinality m(e, i)
  where not exists (select 1 from machine_slots s where s.card = m.e ->> 'card' or s.pack = m.e ->> 'pack');
  -- The welcome pack's backfill (0377): every account with a character and no welcome pack yet gets one, when `startingPack` names a fixed pack. One insert with a semi-join to characters
  -- (characters_owner) and an anti-join to packs (packs_one_welcome), which writes nothing on a second seed; the unique index makes it once ever, so a seed racing a character's creation
  -- grants once, and an instance that changes `startingPack` later gives no second.
  insert into packs (account, pack, price, contents, source)
  select a.id, k.key, 0, k.contents, 'welcome'
  from pack_kinds k
  join accounts a on exists (select 1 from characters c where c.owner = a.id)
  where k.key = welcome_pack_kind()
    and not exists (select 1 from packs w where w.account = a.id and w.source = 'welcome')
  on conflict (account) where source = 'welcome' do nothing;
  -- The flag leaves the board that held it before another takes it, so the index never sees two.
  -- A seed naming one slug twice is refused by the upsert ("cannot affect row a second time"),
  -- where 0004 took its first; an instance never holds one (instanceProblems).
  if flagged is not null then update boards set is_system = false where is_system and slug <> flagged; end if;
  insert into boards (slug, name, description, is_system, created_at)
  select b.e ->> 'slug', b.e ->> 'name', coalesce(b.e ->> 'description', ''), coalesce(b.e ->> 'slug' = flagged, false),
         now() + make_interval(secs => b.i / 1000000.0)
  from jsonb_array_elements(payload -> 'boards') with ordinality b(e, i)
  on conflict (slug) do update set is_system = true where excluded.is_system and not boards.is_system;
  -- A pip style is added or renamed, never removed: a profile may name it.
  insert into pip_styles (key, name, full_image, empty_image)
  select e ->> 'key', e ->> 'name', e ->> 'full', e ->> 'empty' from jsonb_array_elements(coalesce(payload -> 'pipStyles', '[]')) e
  on conflict (key) do update set name = excluded.name, full_image = excluded.full_image, empty_image = excluded.empty_image;
  -- The instance's personas (0082), once each: a persona is made when its key has no character yet, with the profile its seed gives (its
  -- title and its signature, cut to what a profile holds). The first Boss and the first staff debut at seed time; every other persona
  -- is made waiting, with no debut, and debuts the moment it first takes an office. What an admin wrote is never written over: a reseed
  -- finds the key and does nothing. A persona in firstStaff with no office row is hired as a Mod Bot, cause `seed`; one with a row,
  -- a benched one's included, is left as that row says, so a reseed never rehires.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where e ? 'pronouns' and not pronouns_hold(pronouns_lowered(e -> 'pronouns')));
  if unknown is not null then raise exception 'persona % has pronouns that are not five words of 1 to 12 letters and a plural', unknown using errcode = '22023'; end if;
  with seeded as (
    select e ->> 'key' as staff, e ->> 'name' as name, coalesce(e ->> 'title', '') as title, coalesce(e ->> 'signature', '') as signature,
      pronouns_lowered(e -> 'pronouns') as pronouns
    from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  ), made as (
    insert into characters (name, staff, staff_kind, debuted_at)
    select s.name, s.staff, 'persona',
      case when s.staff = nullif(payload -> 'system' ->> 'firstBoss', '')
             or s.staff in (select jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]'))) then now() end
    from seeded s
    on conflict (staff) do nothing returning id, staff
  )
  insert into character_profiles (character, title, signature, pronouns)
  select m.id, left(s.title, 40), left(s.signature, 500), coalesce(s.pronouns, new_pronouns()) from made m join seeded s on s.staff = m.staff;
  -- Each listed persona's pronouns (0124), as its beats below: the seed's set is the persona's, so a reseed rewrites what an earlier seed or an earlier
  -- persona file wrote; a persona the seed gives none is left as it was. Its title and its signature stay as the first seed wrote them.
  update character_profiles p set pronouns = pronouns_lowered(e.value -> 'pronouns')
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e, characters c
  where e.value ? 'pronouns' and c.staff = e.value ->> 'key' and c.staff_kind = 'persona' and p.character = c.id
    and p.pronouns is distinct from pronouns_lowered(e.value -> 'pronouns');
  select string_agg(k, ', ') into unknown from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from characters c where c.staff = k and c.staff_kind = 'persona');
  if unknown is not null then raise exception 'firstStaff names %, which no persona in the seed''s roster is', unknown using errcode = '22023'; end if;
  -- Each listed persona's beat preferences (0103): the slugs of the kinds of board it likes. The seed's list is the persona's whole list, so a reseed
  -- replaces what an earlier seed wrote; a persona the seed gives no `beats` is left as it was.
  delete from staff_beats b where b.staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ? 'beats');
  insert into staff_beats (staff, slug)
  select distinct e ->> 'key', s
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e,
       jsonb_array_elements_text(case when jsonb_typeof(e -> 'beats') = 'array' then e -> 'beats' else '[]'::jsonb end) s
  where e ? 'beats';
  -- Each listed persona's visit traits (0105): the hours a visit of its runs and what talks it down. The seed's entry is the persona's whole traits, so a
  -- reseed replaces what an earlier seed wrote; a persona the seed gives neither is left as it was. A challenge carries a kind and its number (how many
  -- questions, or the price) and nothing else: a quiz's answers are never seeded here, where a client could read them.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where (e ? 'visitHours' or e ? 'challenge') and visit_traits_problem(e -> 'visitHours', e -> 'challenge') is not null);
  if unknown is not null then
    raise exception 'persona % has visit traits that are wrong: %', unknown, (select visit_traits_problem(e -> 'visitHours', e -> 'challenge')
      from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where (e ? 'visitHours' or e ? 'challenge') and visit_traits_problem(e -> 'visitHours', e -> 'challenge') is not null limit 1) using errcode = '22023';
  end if;
  -- A quiz persona's questions (0108): the question, its choices and the right one, kept where no client can read them. The seed's entry is the persona's whole quiz, so a
  -- reseed replaces what an earlier seed wrote. A quiz that cannot be played is refused with the persona's name, and nothing is written.
  unknown := (select string_agg(distinct e ->> 'key', ', ') from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
    where (e ? 'visitHours' or e ? 'challenge' or e ? 'quiz') and quiz_problem(e -> 'challenge', e -> 'quiz') is not null);
  if unknown is not null then
    raise exception 'persona % has a quiz that cannot be played: %', unknown, (select quiz_problem(e -> 'challenge', e -> 'quiz')
      from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where (e ? 'visitHours' or e ? 'challenge' or e ? 'quiz') and quiz_problem(e -> 'challenge', e -> 'quiz') is not null limit 1) using errcode = '22023';
  end if;
  insert into staff_visit_traits (staff, visit_least, visit_most, challenge)
  select e ->> 'key', coalesce((e #>> '{visitHours,least}')::integer, 1), coalesce((e #>> '{visitHours,most}')::integer, 1000), coalesce(e -> 'challenge', '{"kind": "distraction"}'::jsonb)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  where e ? 'visitHours' or e ? 'challenge'
  on conflict (staff) do update set visit_least = excluded.visit_least, visit_most = excluded.visit_most, challenge = excluded.challenge;
  delete from staff_quiz_questions q where q.staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ? 'visitHours' or e ? 'challenge' or e ? 'quiz');
  insert into staff_quiz_questions (staff, idx, question, choices, answer)
  select e ->> 'key', (x.n - 1)::integer, btrim(x.q ->> 'question'), x.q -> 'choices', x.q ->> 'answer'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e,
       jsonb_array_elements(case when jsonb_typeof(e -> 'quiz') = 'array' then e -> 'quiz' else '[]'::jsonb end) with ordinality x(q, n)
  where e #>> '{challenge,kind}' = 'quiz';
  -- A persona's stock concessions (the concession post's design): its lines, kept where no client can read them. The seed's list is the persona's whole set, so a reseed replaces what an earlier seed wrote,
  -- for every persona the seed lists (one that lists none ends with none).
  delete from staff_concessions q where q.staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e);
  insert into staff_concessions (staff, idx, line)
  select e ->> 'key', (x.n - 1)::integer, btrim(x.l #>> '{}')
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e,
       jsonb_array_elements(case when jsonb_typeof(e -> 'concessions') = 'array' then e -> 'concessions' else '[]'::jsonb end) with ordinality x(l, n);
  insert into staff_offices (staff, office, cause)
  select k, 'mod', 'seed' from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from staff_offices x where x.staff = k);
  -- A persona the seed seats as a mod is debuted: a reseed that adds a still-waiting persona to firstStaff hires it above, and it debuts here.
  update characters c set debuted_at = now()
  where c.debuted_at is null and c.staff_kind = 'persona'
    and c.staff in (select k from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k)
    and exists (select 1 from staff_offices x where x.staff = c.staff and x.cause = 'seed' and x.office = 'mod');
  -- The staff group is the ladder's staff rung (group_kinds, seeded above), so no staffGroup setting is written; a row an earlier seed left is read by no one.
  -- The catalogs (0046): the moves and demands the engine holds, as the engine lists them. A reseed upserts a move's flag and
  -- never removes a kind, since a landed move may name it. A missing flag is a seed's mistake (a move that reshapes a board
  -- must not be seeded as one that does not), so it is refused by the column.
  insert into move_kinds (key, structural, shapes_board, lasting, offices, derived)
  select e ->> 'key', (e ->> 'structural')::boolean, coalesce((e ->> 'shapesBoard')::boolean, false), coalesce((e ->> 'lasting')::boolean, false),
         case when jsonb_typeof(e -> 'offices') = 'array' and jsonb_array_length(e -> 'offices') > 0 then array(select jsonb_array_elements_text(e -> 'offices')) else '{boss}' end,
         case when jsonb_typeof(e -> 'derived') = 'array' then array(select jsonb_array_elements_text(e -> 'derived')) else '{}' end
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board, lasting = excluded.lasting, offices = excluded.offices, derived = excluded.derived;
  -- The rule predicates (0102), as the engine lists them (engine/rules/predicates.ts). A reseed upserts; a predicate is never removed,
  -- since a landed rule may name it.
  insert into rule_predicates (key, param_kind, least, most, tags, plain)
  select e ->> 'key', e ->> 'param', (e ->> 'least')::integer, (e ->> 'most')::integer,
         case when jsonb_typeof(e -> 'tags') = 'array' then array(select jsonb_array_elements_text(e -> 'tags')) end, e ->> 'plain'
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'predicates', '[]')) e
  on conflict (key) do update set param_kind = excluded.param_kind, least = excluded.least, most = excluded.most, tags = excluded.tags, plain = excluded.plain;
  insert into demand_kinds (key) select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'demands', '[]')) e
  on conflict (key) do nothing;
  -- The conditions that unlock a beat (0332), as the engine lists them (engine/system/conditions.ts). A reseed upserts; a condition is never removed, since a persona's arc may name it.
  insert into condition_kinds (key, plain)
  select e ->> 'key', e ->> 'plain' from jsonb_array_elements(coalesce(payload -> 'system' -> 'conditions', '[]')) e
  on conflict (key) do update set plain = excluded.plain;
  -- A persona's arc (0332): one row each, rewritten by a reseed. An arc naming a condition the catalog lacks is refused, naming it: the check that no beat waits on a condition nothing reads.
  unknown := (select string_agg(distinct c ->> 'kind', ', ')
              from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) p, jsonb_array_elements(coalesce(p -> 'arc', '[]')) b, jsonb_array_elements(coalesce(b -> 'unlock', '[]')) c
              where not exists (select 1 from condition_kinds k where k.key = c ->> 'kind'));
  if unknown is not null then raise exception 'an arc names a condition the catalog lacks: %', unknown using errcode = '23514'; end if;
  delete from persona_arcs where staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e);
  insert into persona_arcs (staff, beats, holds_back, phase_days)
  select e ->> 'key', coalesce(e -> 'arc', '[]'), coalesce(e -> 'holdsBack', '[]'), coalesce(e -> 'phaseDays', '{}')
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e;
  -- The roster's order (0051): the seed's personas, in the order it lists them, so the rotation has one to follow. A seed with no
  -- persona leaves the setting as it was.
  perform seed_setting('bossRoster', r.roster)
  from (select jsonb_agg(e.value ->> 'key' order by e.ord) as roster
        from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) with ordinality e(value, ord)
        having count(*) > 0) r;
  if not exists (select 1 from seasons) then insert into seasons (number, starts_at) values (1, now()); end if;
  -- The open season's Boss (0043's seasons.boss) is the seed's firstBoss when it has none: a season opened before a Boss
  -- existed, or by this seed. A season that already has a Boss keeps it.
  if nullif(payload -> 'system' ->> 'firstBoss', '') is not null then
    update seasons set boss = payload -> 'system' ->> 'firstBoss' where ends_at is null and boss is null;
  end if;
  -- The announcements thread: the one thread on The System's board where a landed move is written and a move's end is said. Made once,
  -- titled from the seed (`system.announcementsTitle`), and its id recorded in the setting `systemAnnouncements` where the tick finds it.
  -- A reseed finds the setting (and the thread it names) and makes nothing; a seed with no title makes none, and until a seed has one
  -- the tick lands nothing (a board with nowhere to say a move is no board it can move). The setting is not in a seed's `settings`,
  -- so no seed writes it over.
  if nullif(payload -> 'system' ->> 'announcementsTitle', '') is not null
     and setting_thread('systemAnnouncements') is null then
    insert into threads (board, title) values (system_board(), payload -> 'system' ->> 'announcementsTitle') returning id into opened;
    perform seed_setting('systemAnnouncements', to_jsonb(opened::text));
  end if;
  -- The developer persona and its thread (0062): a seed with a `developer` entry ({ name, title, avatar }) makes the one developer, once,
  -- as it makes a persona: debuted at seed time, with the tagline as its profile title, cut to what a profile holds. What an admin wrote is
  -- never written over: a reseed finds the key and does nothing, except that the avatar's asset key is the instance's to change. Then
  -- the updates thread, on The System's board, recorded in the setting `updatesThread` (not in a seed's `settings`, so no seed
  -- writes it over); the board's thread counter is netted by the thread's own, since a board's count is the length of its list and
  -- thread_list never lists this one.
  if jsonb_typeof(payload -> 'developer') = 'object' then
    if payload -> 'developer' ? 'pronouns' and not pronouns_hold(pronouns_lowered(payload -> 'developer' -> 'pronouns')) then
      raise exception 'the developer has pronouns that are not five words of 1 to 12 letters and a plural' using errcode = '22023';
    end if;
    -- The thread opens on The System's board, so a database with no board is told so before anything is made.
    if system_board() is null then raise exception 'a developer needs The System''s board; seed boards first' using errcode = '22023'; end if;
    with made as (
      insert into characters (name, staff, staff_kind, debuted_at) values (payload -> 'developer' ->> 'name', 'developer', 'developer', now())
      on conflict (staff) do nothing returning id
    )
    insert into character_profiles (character, title, signature, pronouns)
    select m.id, left(coalesce(payload -> 'developer' ->> 'title', ''), 40), '', coalesce(pronouns_lowered(payload -> 'developer' -> 'pronouns'), new_pronouns()) from made m;
    -- The developer's pronouns, when the seed names them, are rewritten on every seed (0124); its title and signature are not.
    update character_profiles p set pronouns = pronouns_lowered(payload -> 'developer' -> 'pronouns')
    from characters c
    where payload -> 'developer' ? 'pronouns' and c.staff = 'developer' and p.character = c.id and p.pronouns is distinct from pronouns_lowered(payload -> 'developer' -> 'pronouns');
    if nullif(payload -> 'developer' ->> 'avatar', '') is not null then
      perform seed_setting('developerAvatar', to_jsonb(payload -> 'developer' ->> 'avatar'));
    end if;
    if setting_thread('updatesThread') is null then
      sys := system_board();
      insert into threads (board, title) values (sys, 'Updates') returning id into opened;
      perform seed_setting('updatesThread', to_jsonb(opened::text));
      update board_thread_counts set threads = threads - 1
       where board = sys and shard = coalesce((select c.shard from board_thread_counts c where c.board = sys order by c.shard for update skip locked limit 1), 0);
    end if;
  end if;
  -- The anonymous poster (0357): a seed with an `anonymous` entry ({ name, title, avatar, pronouns }) makes the one stand-in, once, as it makes the developer: debuted at seed time, the tagline its profile title, the pronouns
  -- rewritten on every seed when the seed names them, the avatar's asset key the instance's to change. What an admin wrote is never written over. A seed with none makes none, and stand_in() is then null (land_refusal
  -- refuses a veil until one exists); seed.ts always sends one, the engine's own when the instance names none.
  if jsonb_typeof(payload -> 'anonymous') = 'object' then
    if payload -> 'anonymous' ? 'pronouns' and not pronouns_hold(pronouns_lowered(payload -> 'anonymous' -> 'pronouns')) then
      raise exception 'the anonymous poster has pronouns that are not five words of 1 to 12 letters and a plural' using errcode = '22023';
    end if;
    with made as (
      insert into characters (name, staff, staff_kind, debuted_at) values (payload -> 'anonymous' ->> 'name', 'anonymous', 'anonymous', now())
      on conflict (staff) do nothing returning id
    )
    insert into character_profiles (character, title, signature, pronouns)
    select m.id, left(coalesce(payload -> 'anonymous' ->> 'title', ''), 40), '', coalesce(pronouns_lowered(payload -> 'anonymous' -> 'pronouns'), new_pronouns()) from made m;
    update character_profiles p set pronouns = pronouns_lowered(payload -> 'anonymous' -> 'pronouns')
    from characters c
    where payload -> 'anonymous' ? 'pronouns' and c.staff = 'anonymous' and p.character = c.id and p.pronouns is distinct from pronouns_lowered(payload -> 'anonymous' -> 'pronouns');
    if nullif(payload -> 'anonymous' ->> 'avatar', '') is not null then
      perform seed_setting('anonymousAvatar', to_jsonb(payload -> 'anonymous' ->> 'avatar'));
    end if;
  end if;
  -- The seed's roster is the whole staff (docs/plans/2026-11-21-departed-personas-design.md, sections 2 and 3). A persona the roster does not list, and that the seed has not already benched, is departing. This block runs last,
  -- after the persona files, the roster setting, the season and its first Boss and the announcements thread are in place, so a departing Boss's handover reads the roster this seed wrote and says its farewell in the thread.
  -- It runs after (and not inside) the `firstStaff` hire above, which hires only a persona with no office row: a persona the seed benched has one, so it is brought back here and only by a roster that lists it. A seed that
  -- lists no persona (a partial seed) is not a roster and benches nobody, as it leaves `bossRoster` as it was.
  listed := array(select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e where e ->> 'key' is not null);
  first_staff := array(select k from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k);
  if cardinality(listed) > 0 then
    -- The offices lock is held since the top of this function, so what stands is what is read.
    select s.id, s.boss into open_id, boss_was from seasons s where s.ends_at is null;
    mods_were := (select count(*) from staff_office_now o join characters c on c.staff = o.staff where o.office = 'mod' and c.retired_at is null);
    -- A persona listed again after a seed benched it comes back first, so a Boss that is leaving can hand the chair to it: a Mod where firstStaff names it, else a member. A member row debuts nothing; a Mod row debuts it,
    -- as the firstStaff hire does.
    returned := array(
      select k from unnest(listed) k
      where exists (select 1 from characters c where c.staff = k and c.staff_kind = 'persona' and c.retired_at is null)
        and (select o.office = 'benched' and o.cause = 'seed' from staff_offices o where o.staff = k order by o.id desc limit 1));
    insert into staff_offices (staff, office, cause) select k, case when k = any (first_staff) then 'mod' else 'member' end, 'seed' from unnest(returned) k;
    update characters c set debuted_at = now() where c.debuted_at is null and c.staff_kind = 'persona' and c.staff = any (returned) and c.staff = any (first_staff);
    departing := array(
      select c.staff from characters c
      where c.staff_kind = 'persona' and c.retired_at is null and c.staff <> all (listed)
        and not coalesce((select o.office = 'benched' and o.cause = 'seed' from staff_offices o where o.staff = c.staff order by o.id desc limit 1), false)
      order by c.staff);
    -- The other departing personas first, so neither the rotation nor a standing nomination can seat one.
    insert into staff_offices (staff, office, cause) select k, 'benched', 'seed' from unnest(departing) k where k is distinct from boss_was;
    departed := array(select k from unnest(departing) k where k is distinct from boss_was);
    if boss_was is not null and boss_was = any (departing) then
      -- The early handover, in the open season: it refuses (and the seed with it, nothing written) where no one else can sit in the chair. Its farewell is posted before the bench below, since a benched persona writes nothing.
      perform hand_over(open_id, boss_was, now(), true);
      insert into staff_offices (staff, office, cause) values (boss_was, 'benched', 'seed');
      departed := departed || boss_was;
      select s.boss into handed from seasons s where s.id = open_id;
    end if;
    -- The staff is never empty: where a Mod stood before this seed and none stands now (it benched the last one, or the Boss's handover did), each listed firstStaff persona that is not the Boss is hired. If that still leaves none,
    -- the seed is refused. A staff that had no Mod before this seed is not this seed's doing, so it is left as it was (the firstStaff hire above is how a first seed gets its Mod).
    if mods_were > 0
       and not exists (select 1 from staff_office_now o join characters c on c.staff = o.staff where o.office = 'mod' and c.retired_at is null) then
      insert into staff_offices (staff, office, cause)
      select k, 'mod', 'seed' from unnest(first_staff) k
      where k = any (listed) and k is distinct from (select s.boss from seasons s where s.id = open_id)
        and exists (select 1 from characters c where c.staff = k and c.staff_kind = 'persona' and c.retired_at is null);
      update characters c set debuted_at = now() where c.debuted_at is null and c.staff_kind = 'persona' and c.staff = any (first_staff)
        and exists (select 1 from staff_offices x where x.staff = c.staff and x.cause = 'seed' and x.office = 'mod' and x.id = (select max(y.id) from staff_offices y where y.staff = c.staff));
      if not exists (select 1 from staff_office_now o join characters c on c.staff = o.staff where o.office = 'mod' and c.retired_at is null) then
        raise exception 'the seed leaves no Mod Bot on staff: name one in firstStaff' using hint = 'kayfabb.refusal', errcode = '55000';
      end if;
    end if;
  end if;
  -- The staff's threads follow the flag (0407). Every thread of system_threads() is stored on system_board(); one that is not is a stray, left behind by a flag a seed moved, in this run or in an older
  -- one, so the strays are looked for on every seed and not only when the flag moves in this one. With none, nothing is written. Otherwise they are placed by rebuild_thread_places (its own lock and
  -- its refusal of a thread another writer moved), and then the counts of every board a stray left and of the system board are recounted by the rule thread_list lists by (backfill_board_counts, 0063):
  -- the threads in thread_list on the board, in shard 0, the other shards zero. The recount, and not a delta, because a board that held threads from before 0339's rule, or the Updates thread netted
  -- by hand, is not one rebuild_thread_places' deltas can be trusted to leave right, and the system board's arrivals are the ones it never counts.
  if system_board() is not null then
    -- One keyed probe for each of the staff's threads (system_thread_rows), and no second read of threads for its board: a reseed reads what the staff's threads are, not how many threads there are.
    select array_agg(r.id), array_agg(distinct r.board) into strays, left_boards
    from system_thread_rows() r where r.board is distinct from system_board();
    if strays is not null then
      placed := rebuild_thread_places(strays);
      left_boards := (select array_agg(x order by x) from (select unnest(left_boards) union select system_board()) u(x));
      perform 1 from board_thread_counts c where c.board = any (left_boards) order by c.board, c.shard for update;
      for counting in
        select b as board from unnest(left_boards) b order by b
      loop
        select count(*) into on_list from thread_list l where l.board = counting.board;
        update board_thread_counts c set threads = case when c.shard = 0 then on_list else 0 end
        where c.board = counting.board and c.threads is distinct from case when c.shard = 0 then on_list else 0 end;
      end loop;
    end if;
  end if;
  -- Seeding ends here: a write later in a transaction that called this (a test file's, one session's) is not the seed's. The flag goes back to the value this found. A custom
  -- setting cannot be truly unset inside a transaction, so one that was unset (null) or empty goes back to 'off', which the trigger reads the same.
  perform set_config('kayfabb.seeding', coalesce(nullif(was, ''), 'off'), true);
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'groups', (select count(*) from group_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards),
    'retired', (select coalesce(jsonb_agg(k.key order by k.key), '[]'::jsonb) from card_kinds k where k.retired_at is not null), 'renamed', renamed, 'withdrawn', withdrawn_out,
    'departed', to_jsonb(departed), 'returned', to_jsonb(returned), 'handover', to_jsonb(handed), 'placed', placed);
end $function$;

-- ------------------------------------------------------------------------------------ the talk-down ----

-- intercept (0446_written_quiz.sql), taking the thread's row before the visit's open row (the order place_cast's distraction has), and a successful interception's end calling post_concession once the visit has ended.
-- Everything else as 0446 wrote it.
create or replace function intercept(through uuid, visit_act uuid, answer text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid;
  v acts%rowtype;
  ckind text;
  price integer;
  mod_key text;
  mod_name text;
  me text;
  said text := btrim(coalesce(answer, ''));
  wanted text;
  shown jsonb;
  ok boolean;
  iid uuid;
  until timestamptz;
  hours integer := coalesce((select (m.value ->> 'tailHours')::integer from settings m where m.key = 'modBots'), 24);
  held numeric;
  closed jsonb;
begin
  caller := acting(through);
  perform not_banned(through);
  select * into v from acts a where a.id = intercept.visit_act and a.kind = 'visit';
  if not found then raise exception 'there is no such visit' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The thread's row first, `for no key update` as place_cast takes it at thread reach: a cast that ends visits in this thread and an interception in it are one after the other and never hold a visit's open row while
  -- waiting at the thread (the concession post below takes the thread's row too). See distract_visits for the whole order.
  perform 1 from threads t where t.id = v.thread for no key update;
  -- The visit's open row, taken for update: a filing or another interception waits, then finds the visit over. A visit with no open row has ended.
  perform 1 from visits_open o where o.visit_act = v.id for update;
  if not found then raise exception 'this visit is over' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  if exists (select 1 from acts i where i.kind = 'intercept' and i.character = through and i.payload ->> 'visit_act' = v.id::text) then
    raise exception 'this character has already tried this visit' using hint = 'kayfabb.refusal', errcode = '23505';
  end if;
  ckind := v.payload #>> '{challenge,kind}';
  select c.staff, c.name into mod_key, mod_name from characters c where c.id = v.character;
  select c.name into me from characters c where c.id = through;
  if ckind = 'quiz' then
    -- The question is the visit's own row. With none written yet the quiz is pending: refused in the same words for everyone, before anything is written, so the character's one try is not spent.
    select q.answer, q.choices into wanted, shown from visit_quizzes q where q.visit_act = v.id;
    if not found then raise exception 'the question is still being written; try again in a few minutes' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
    if said = '' then raise exception 'pick an answer' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    -- An answer is one of the choices shown: anything else (or something far too long) is refused the same way for everyone, before anything is written.
    if char_length(said) > 200 or not shown ? said then raise exception 'pick one of the answers shown' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
    ok := said = wanted;
  elsif ckind = 'bribe' then
    price := (v.payload #>> '{challenge,price}')::integer;
    select w.balance into held from wallets w where w.account = caller;
    if coalesce(held, 0) < price then
      raise exception 'that costs %, and your wallet holds %', price, coalesce(held, 0) using hint = 'kayfabb.refusal', errcode = 'P0001';
    end if;
    ok := true;
    said := '';
  else
    raise exception 'this Mod is moved by a card played on the thread, not by an answer or a payment' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  perform set_config('kayfabb.intercept_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'intercept', v.thread, v.target_act_id, jsonb_build_object('visit_act', v.id, 'kind', ckind, 'succeeded', ok) || case when ckind = 'quiz' then jsonb_build_object('answer', said) else '{}'::jsonb end)
  returning id into iid;
  perform set_config('kayfabb.intercept_writer', '', true);
  if ckind = 'bribe' then perform wallet_spend(caller, price, 'bribe', iid); end if;
  if ok then
    closed := end_visit(v.id, 'intercepted', iid, me || ' got past ' || mod_name || '''s ' || case ckind when 'quiz' then 'quiz' else 'price' end || '.');
    -- The Mod concedes in the thread (best effort: post_concession never fails the talk-down, and a refusal rolls back only the post).
    if (closed ->> 'ended')::boolean then perform post_concession(v.id, through); end if;
  else
    until := now() + make_interval(hours => hours);
    insert into tails (character, staff, intercept_act, until) values (through, mod_key, iid, until);
  end if;
  return jsonb_build_object('intercept', iid, 'visit', v.id, 'kind', ckind, 'succeeded', ok, 'ended', ok, 'tail_until', until);
end $$;
revoke execute on function intercept(uuid, uuid, text) from public, anon;
grant execute on function intercept(uuid, uuid, text) to authenticated, service_role;

-- distract_visits (0108_interception.sql), every visit it ends then calling post_concession for the caster. Everything else as 0108 wrote it. Create or replace keeps 0108's grants (none to an API role).
-- It ends every visit first, in 0108's order (each visit's open row, then its intercept Act and end), and only then posts the concessions, in the order of the Mods' character ids (then the visit's id). One cast can end
-- visits of several Mods, each posting as its own character and so taking that character's post-count row; two statements that each take several of those rows must take them in one order, or two casts ending
-- visits of the same two Mods would each hold one and wait for the other. The visits' open rows are each a visit's own, and one thread's visits are the one cast's, so they are no cross-wait.
-- Why an interception and a cast in one thread cannot deadlock: both take the thread's row first. place_cast at thread reach takes it `for no key update` before it lays the card and calls this; intercept takes it
-- the same way before it takes the visit's open row (see intercept below). So of two such statements the second waits at the thread for the first to commit, and neither waits there holding a visit's open row or a
-- post-count row. After the thread, every writer takes the visit's open row, then (inside post_concession's own block) the quoted post `for share` where a live back may spring on it, the thread again, and the Mod's count row. A
-- filing takes the post's row before the open row, and intercept and a thread cast take the post's row after it, so a filing racing a concession on a post with a live back could still wait both ways; that is the one wait
-- this leaves, and it falls inside post_concession's block: the deadlock detector's victim, if it is the post, loses only the post (the talk-down stands, the row records the error), and if it is the filing the tick files it
-- again.
create or replace function distract_visits(caster uuid, in_thread uuid, card_act uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v record;
  iid uuid;
  ended integer := 0;
  me text := (select c.name from characters c where c.id = caster);
  said text;
  closed jsonb;
  done uuid[] := '{}';
begin
  for v in
    select a.id, a.target_act_id, (select m.name from characters m where m.id = a.character) as mod_name
    from acts a join visits_open o on o.visit_act = a.id
    where a.kind = 'visit' and a.thread = in_thread and a.payload #>> '{challenge,kind}' = 'distraction'
    order by a.created_at, a.id
  loop
    perform 1 from visits_open o where o.visit_act = v.id for update;
    continue when not found;
    continue when exists (select 1 from acts i where i.kind = 'intercept' and i.character = caster and i.payload ->> 'visit_act' = v.id::text);
    perform set_config('kayfabb.intercept_writer', 'on', true);
    insert into acts (character, kind, thread, target_act_id, payload)
    values (caster, 'intercept', in_thread, v.target_act_id, jsonb_build_object('visit_act', v.id, 'kind', 'distraction', 'succeeded', true, 'card', card_act))
    returning id into iid;
    perform set_config('kayfabb.intercept_writer', '', true);
    said := me || ' drew ' || v.mod_name || '''s attention away from this post with a card.';
    closed := end_visit(v.id, 'intercepted', iid, said);
    if (closed ->> 'ended')::boolean then done := done || v.id; end if;
    ended := ended + 1;
  end loop;
  -- The Mods concede in the thread, by the caster's name, in the order of their character ids (best effort: post_concession never fails the talk-down).
  for v in
    select a.id from acts a where a.id = any (done) order by a.character, a.id
  loop
    perform post_concession(v.id, caster);
  end loop;
  return ended;
end $$;
revoke execute on function distract_visits(uuid, uuid, uuid) from public, anon, authenticated;

-- system_tick (0446_written_quiz.sql), a quiz's bank row written beside its `none` concession row (step 7), and a step 8 that settles each pending visit past its window (`modBots.quizWriteMinutes` for a quiz visit,
-- `modBots.concessionWriteMinutes` otherwise) as `none`, the count in its answer as `concessionsLapsed`. Everything else as 0446 wrote it.
create or replace function system_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  enabled boolean := coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'systemEnabled'), false);
  check_every interval := make_interval(mins => coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'demandCheckMinutes'), 5));
  cap integer := coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'demandChecksPerTick'), 40);
  budget_ends timestamptz := clock_timestamp() + make_interval(secs => coalesce(nullif(current_setting('kayfabb.tick_budget_seconds', true), '')::numeric, 20));
  due record;
  inforce record;
  written uuid;
  why text;
  clash text;
  ended_by text;
  counted jsonb;
  expires timestamptz;
  did_end boolean;
  landed integer := 0;
  met integer := 0;
  expired integer := 0;
  failed integer := 0;
  unmet integer := 0;
  arcs integer := 0;
  awards_failed integer := 0;
  checked integer := 0;
  out_of_time boolean := false;
  superseded integer := 0;
  filed integer := 0;
  tries integer;
  late record;
  check_at timestamptz;
  filing_grace interval := make_interval(mins => coalesce((select (s.value #>> '{filingGraceMinutes}')::integer from settings s where s.key = 'modBots'), 10));
  boss text := current_boss();
  -- The instant the open season's Boss was seated: the latest Boss-changing handover of the open season (a departure's included), else the season's start.
  handed timestamptz := coalesce((select h.at from season_boss_changes h join seasons x on x.id = h.season and x.ends_at is null order by h.landed_at desc, h.handover desc limit 1),
                                  (select x.starts_at from seasons x where x.ends_at is null));
  grace interval := make_interval(days => coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'inheritanceGraceDays'), 3));
  first_before uuid;
  was record;
  dep record;
  lp jsonb;
  rk text;
  resolved uuid;
  lapsed_n integer := 0;
  rq record;
  asked record;
  owed_late record;
  owed_error text;
  owed_paid integer := 0;
  rq_public boolean;
  mt uuid;
  quiz_grace interval := make_interval(mins => coalesce((select (s.value ->> 'quizWriteMinutes')::integer from settings s where s.key = 'modBots'), 15));
  quiz_late record;
  quiz_bank jsonb;
  quiz_banked integer := 0;
  conc_grace interval := make_interval(mins => coalesce((select (s.value ->> 'concessionWriteMinutes')::integer from settings s where s.key = 'modBots'), 15));
  conc_late record;
  conc_lapsed integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('kayfabb.system_tick')) then return jsonb_build_object('skipped', true); end if;

  -- The one lock order (0339): the global place key before anything is written. A lasting move due to land, or one in force that this tick may end (an expiry, a demand met, a superseded one), writes places, so
  -- the key is taken first. A landing move also opens a thread of its own on the system board and writes its Act into it, a thread no one else holds until the tick commits; an admin's reversal takes the key
  -- and only then writes its end into the move's thread. A non-lasting landing therefore has no row a reversal waits for, and the key is needed only where a lasting move is due or in force, which is the test
  -- below. The one key is held to the end of the tick; the tick's own rows are the only thing it waits for before it is taken.
  if exists (select 1 from queued_moves q join move_kinds k on k.key = q.kind
             where k.lasting and q.landed_act is null and q.held_at is null and q.refused_at is null and q.go_live_at <= now())
     or exists (select 1 from open_moves o join acts a on a.id = o.move_act join move_kinds k on k.key = a.payload ->> 'kind' where k.lasting) then
    perform lock_thread_places();
  end if;

  -- 1. Landing: only while The System is on. A landed move is written in a thread of its own on the staff's board (below), so it needs no thread made beforehand.
  if enabled then
    for due in
      select q.id, q.staff, q.kind, q.params, q.demand, q.expires_at, q.admin_description, q.bundle, q.depends_on, q.line from queued_moves q where q.landed_act is null and q.held_at is null and q.refused_at is null and q.go_live_at <= now() order by q.go_live_at, q.id for update skip locked
    loop
      -- A machine move is checked against the machine as it is now, so it waits for the machine's one lock (0141's admin functions take it to take a pack off sale or
      -- reorder), taken here and not inside the block below so that a timeout is not swallowed as a failed move. Without it a Pull landing as an admin took the last pack
      -- holding its card off sale could each miss the other and leave a Pull with no pack on sale. The tick holds only queued_moves rows (and Acts it inserts) when it
      -- waits here, and those functions never lock those rows, so there is no cycle. Taken only when a machine move is about to be checked, and held to the end of
      -- the tick, so the checks below read what the admin committed.
      if due.kind in ('pullSlot', 'repriceSlot', 'flashSale') then perform pg_advisory_xact_lock(hashtext('kayfabb.machine')); end if;
      begin
        -- A part of a bundle (0329) lands after the parts it builds on, and not before: one of them still waiting, and this one waits; one refused, and it is refused with it (nothing
        -- will ever make the board it names); one held (an admin's hold follows its dependents at once, so this only meets a row queued after the hold), and it is held with it. Then each
        -- role in its params is the board the part it names made, in the Act, so the Act says which board it moved to and the log can name it.
        lp := due.params;
        if due.depends_on is not null then
          select d.id, d.held_at, d.held_by, d.refused_at, d.role into dep from queued_moves d
          where d.id = any (due.depends_on) and d.landed_act is null order by (d.refused_at is not null) desc, (d.held_at is not null) desc, d.id limit 1;
          if found then
            if dep.refused_at is not null then
              update queued_moves set failed_at = now(), failure = left('that move cannot land: the move it builds on was refused', 500), refused_at = now() where id = due.id;
            elsif dep.held_at is not null then
              update queued_moves set held_at = dep.held_at, held_by = dep.held_by where id = due.id;
            end if;
            continue;
          end if;
        end if;
        for rk in select e.key from jsonb_each(lp) e where jsonb_typeof(e.value) = 'object' and e.value ? 'role' loop
          resolved := case when (lp -> rk) ? 'beat'
            then beat_role_board(meeting_season((select q.meeting from queued_moves q where q.id = due.id)), due.staff, lp #>> array[rk, 'beat'], lp #>> array[rk, 'role'])
            else role_board(due.bundle, lp #>> array[rk, 'role']) end;
          if resolved is null then exit; end if;
          lp := jsonb_set(lp, array[rk], to_jsonb(resolved::text));
        end loop;
        if resolved is null and exists (select 1 from jsonb_each(lp) e where jsonb_typeof(e.value) = 'object' and e.value ? 'role') then
          update queued_moves set failed_at = now(), failure = left('that move cannot land: a part it names made no board', 500), refused_at = now() where id = due.id;
          continue;
        end if;
        -- Two rules that conflict may have waited together; the one that lands second meets the first. It is refused for good, with the reason.
        if due.kind = 'setRule' then
          clash := rule_conflict(nullif(lp ->> 'board', '')::uuid, lp ->> 'predicate', nullif(lp -> 'param', 'null'::jsonb));
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that rule would leave no post that follows the rules: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
        end if;
        -- The machine's moves are checked against the machine as it is now (0140): a slot an admin has since changed, a card no pack on sale can give, a pull too many.
        -- Refused for good with the reason, as a rule is, and never applied: it is no Act, so nothing was put on the machine and nothing needs reversing.
        if due.kind in ('pullSlot', 'repriceSlot', 'flashSale') then
          clash := machine_move_problem(due.kind, lp, due.demand, (select q.go_live_at from queued_moves q where q.id = due.id), due.expires_at, true);
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that machine move cannot land: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
        end if;
        -- The three moves that build the board are checked against the boards and threads as they are now (0320), as a machine move is against the machine: state changes between
        -- the queue and the landing (a board closed, a thread gone, a merge that would now make a cycle). Refused for good, with the reason; it is no Act, so nothing needs reversing.
        if due.kind in ('createBoard', 'moveThread', 'mergeBoard') then
          -- The writers of a place wait for each other (0339): the global key (already held, taken before the loop; a second take costs nothing), and for a merge the key of the board it closes, which a
          -- thread insert on that board tries shared, so a thread started there is committed before the merge reads its threads, or is refused at once. Both are held to the end of the tick.
          perform lock_thread_places();
          if due.kind = 'mergeBoard' then perform lock_board_closing(safe_uuid(lp ->> 'board')); end if;
          clash := lasting_move_problem(due.kind, lp);
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that move cannot land: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
          first_before := first_open_board();
        end if;
        -- The Boss's trophy (0208) is checked against the instance as it is now: a character that has since become staff or retired, a trophy it was given meanwhile, a belt it
        -- already holds. Refused for good with the reason, as the machine's moves are, and never applied: it is no Act, so no award was written and nothing needs reversing.
        if due.kind = 'awardTrophy' then
          clash := trophy_move_problem(due.params, due.demand);
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that trophy cannot be given: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
        end if;
        -- The move's thread (the staff-board threads design, section 6): a part of a bundle goes in the thread of the bundle's earliest landed part, whenever that landed; anything else, and a bundle's first part,
        -- opens a staff thread of its own, titled for its kind. It is opened here, inside this move's block, so a part that fails to land takes its thread with it and the next one that lands opens it again.
        mt := null;
        if due.bundle is not null then
          select a.thread into mt from queued_moves p join acts a on a.id = p.landed_act where p.bundle = due.bundle and p.landed_act is not null order by a.created_at, a.seq, a.id limit 1;
        end if;
        if mt is null then mt := open_staff_thread(due.staff, move_thread_title(due.kind, lp, due.staff)); end if;
        written := (write_staff_act(due.staff, 'move', mt, null,
          jsonb_build_object('kind', due.kind, 'params', lp, 'body', case when nullif(btrim(due.line, E' \t\n\r\f\v'), '') is not null then system_line_fill(btrim(due.line, E' \t\n\r\f\v'), due.kind, lp, due.staff)
            else system_line(case when due.kind = 'setRule' then 'ruleSet' else 'moveLanded' end, due.kind, lp, due.staff) end)
          || case when due.demand is not null then jsonb_build_object('demand', due.demand) else '{}'::jsonb end
          || case when due.expires_at is not null then jsonb_build_object('expires_at', due.expires_at) else '{}'::jsonb end) ->> 'id')::uuid;
        update queued_moves set landed_act = written where id = due.id;
        -- A ruling on a player's own character (design section 2): the member a Boss put in a group is told, as is the starter of a thread the Boss moved. A mergeBoard and a group left alert no one.
        if due.kind = 'conferGroup' then
          perform write_alert(safe_uuid(lp ->> 'character'), 'ruling', 'grouped', written, null);
        elsif due.kind = 'moveThread' then
          perform write_alert((select a.character from acts a where a.thread = safe_uuid(lp ->> 'thread') and a.seq = 1), 'ruling', 'threadMoved', written, null);
        end if;
        -- What it was built on, recorded now that it has landed: an admin's reversal of one of them follows it (reverse_move).
        if due.depends_on is not null then
          insert into move_dependencies (act, on_act) select written, d.landed_act from queued_moves d where d.id = any (due.depends_on) and d.landed_act is not null and d.landed_act <> written on conflict do nothing;
        end if;
        -- The award is the move's whole effect and outlasts it: written in this transaction, naming the move's Act, and the move ends at once (`spent`, as a nomination does). If
        -- either fails, the Act goes with them (this block's rollback) and the move is left due, with the failure recorded below.
        if due.kind = 'awardTrophy' then
          insert into trophy_awards (trophy, character, by, act) values (due.params ->> 'trophy', (due.params ->> 'character')::uuid, 'boss', written);
          perform end_move(written, 'spent', 'award');
        end if;
        if due.kind = 'renameBoard' and due.admin_description is not null then
          perform write_describe((lp ->> 'board')::uuid, due.admin_description, written);
        end if;
        -- A made board is a row (its slug from its name), pointing at the Act that made it; a moved thread ends the move of the same thread that was in force, as superseded; then the
        -- threads the move touched are rebuilt (lasting_rebuild), so the stored board follows the Acts.
        if due.kind = 'createBoard' then
          insert into boards (slug, name, description, created_by_act) values (board_slug_for(lp ->> 'name'), lp ->> 'name', coalesce(lp ->> 'description', ''), written);
        elsif due.kind = 'moveThread' then
          for was in
            select o.move_act from open_moves o join acts a on a.id = o.move_act
            where a.payload ->> 'kind' = 'moveThread' and lower(a.payload #>> '{params,thread}') = lower(lp ->> 'thread') and a.id <> written
            order by o.landed_at, o.move_act
          loop
            if (end_move(was.move_act, 'superseded', 'landing') ->> 'ended')::boolean then perform say_move_end(was.move_act, 'superseded'); end if;
          end loop;
        end if;
        if due.kind in ('createBoard', 'moveThread', 'mergeBoard') then perform lasting_rebuild(written, first_before); end if;
        landed := landed + 1;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: queued move % did not land: % (%)', due.id, sqlerrm, sqlstate;
        -- Recorded on the row (the latest failure), so the admin queue can show it and an admin can hold the row. The row stays due.
        update queued_moves set failed_at = now(), failure = left(sqlerrm || ' (' || sqlstate || ')', 500) where id = due.id;
      end;
    end loop;
  end if;

  -- 1b. Arcs (0332): after landing, so a bundle that landed in this tick has unlocked what waited on it in the same one. Only while The System is on (a beat unlocks for a meeting). The pass reads the
  -- season's Boss alone and costs the same however many Acts there are; a failure of it is counted and warned about and never stops the rest of the tick.
  if enabled then
    begin
      lp := arc_pass();
      arcs := (lp ->> 'unlocked')::integer + (lp ->> 'lapsed')::integer;
    exception when others then
      failed := failed + 1;
      raise warning 'system_tick: the arc pass failed: % (%)', sqlerrm, sqlstate;
    end;
  end if;

  -- 2. Expiry: whatever the switch says, for every move in force, every tick. It is a comparison.
  for inforce in
    select o.move_act, a.character, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act order by o.landed_at, o.move_act
  loop
    expires := move_expires_at(inforce.move_act);
    if expires is not null and expires <= now() then
      begin
        did_end := (end_move(inforce.move_act, 'expired', 'expiry') ->> 'ended')::boolean;
        if did_end then expired := expired + 1; perform say_move_end(inforce.move_act, 'expired'); end if;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
      end;
    end if;
  end loop;

  -- 2b. The handover's leftovers, whatever the switch says. A nomination in force whose Boss is not the season's is spent (a nomination that
  -- landed after the handover it was for); a move that shapes a board and is not the season's Boss's, still unaddressed `inheritanceGraceDays`
  -- after the handover that seated the Boss, the latest of the season's (a departure's included), or after it landed, if later, ends `superseded`: the new Boss's review never came, or never reached it. A move the
  -- Boss kept is its own (move_owner), so it never ends here. The read is of the moves in force, a handful of rows.
  if boss is not null then
    for inforce in
      select o.move_act, a.payload ->> 'kind' as kind, o.landed_at
      from open_moves o join acts a on a.id = o.move_act join move_kinds k on k.key = a.payload ->> 'kind' and (k.shapes_board or k.key = 'nameSuccessor') and not k.lasting
      where move_owner(o.move_act) is distinct from boss
      order by o.landed_at, o.move_act
    loop
      begin
        if inforce.kind = 'nameSuccessor' then
          perform end_move(inforce.move_act, 'spent', 'handover');
        elsif greatest(inforce.landed_at, handed) + grace <= now() then
          did_end := (end_move(inforce.move_act, 'superseded', 'inheritance') ->> 'ended')::boolean;
          if did_end then superseded := superseded + 1; perform say_move_end(inforce.move_act, 'superseded'); end if;
        end if;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: inherited move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
      end;
    end loop;
  end if;

  -- 3. Demands: the moves least recently checked, at most `cap`, none checked within `check_every`, and none once the budget is spent.
  -- A move with no demand is never read. `checked_at` is set before the read, so a move whose progress errors takes its turn like the
  -- rest instead of holding the front of the line; the count it read is stored beside it (`open_moves.progress`, 0053).
  for inforce in
    select o.move_act, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act where jsonb_typeof(a.payload -> 'demand') = 'object' and not (a.payload ->> 'kind' = 'conferGroup' and a.payload #> '{params,checkAt}' is not null) and (o.checked_at is null or o.checked_at <= now() - check_every) order by o.checked_at nulls first, o.move_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    update open_moves set checked_at = now() where move_act = inforce.move_act;
    checked := checked + 1;
    did_end := false;
    counted := null;
    begin
      counted := demand_progress_or_error(inforce.move_act);
      if coalesce((counted ->> 'met')::boolean, false) then
        did_end := (end_move(inforce.move_act, 'met', 'demand') ->> 'ended')::boolean;
        if did_end then
          met := met + 1;
          -- The met demand's trophy to each character that made it (0206), in a block of its own: the move is ended whatever happens here. A failure is a warning, a row
          -- (trophy_award_failures) and a count in the tick's answer, and an admin can give the trophy by hand.
          begin
            perform award_demand_trophies(inforce.move_act);
          exception when others then
            awards_failed := awards_failed + 1;
            raise warning 'system_tick: the trophies for move % were not given: % (%)', inforce.move_act, sqlerrm, sqlstate;
            begin
              insert into trophy_award_failures (move_act, error) values (inforce.move_act, left(sqlerrm || ' (' || sqlstate || ')', 500))
              on conflict (move_act) do update set error = excluded.error, at = now();
            exception when others then null;
            end;
          end;
        end if;
      end if;
    exception when others then
      failed := failed + 1;
      did_end := false;
      raise warning 'system_tick: move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
    end;
    -- What it read is kept on the move's row (a move just ended has no row left, and the update finds none), outside the block above so
    -- that a failure in ending the move does not take the count with it. The board and the admin queue read this, not the evaluator.
    if counted is not null then update open_moves set progress = counted where move_act = inforce.move_act; end if;
    -- The Boss says it. The move is ended whether or not the line is posted.
    if did_end then perform say_move_end(inforce.move_act, 'met'); end if;
  end loop;

  -- 3b. Favors: a favor is a group conferred with a check (`params.checkAt`) and the demand it reads. It is not ended `met` by the pass above: a favor met is kept to its
  -- expiry. At its check, one whose demand is not met is stripped, `unmet`, and the Boss says so. A demand that cannot be evaluated (progress carries an `error`) is no evidence:
  -- the favor is left and read again at the next turn. The moves in force that carry a check are a handful; one past its check is read at most once in `demandCheckMinutes`, the
  -- least recently checked first, and none once the budget is spent. One already recorded met (open_moves.progress) is not read again: a demand only ever grows, and the favor
  -- is kept to its expiry.
  for inforce in
    select o.move_act, a.payload from open_moves o join acts a on a.id = o.move_act
    where a.payload ->> 'kind' = 'conferGroup' and a.payload #> '{params,checkAt}' is not null and (o.checked_at is null or o.checked_at <= now() - check_every)
      and coalesce((o.progress ->> 'met')::boolean, false) is not true
      -- Only a favor whose check has come (the case keeps a malformed time from being cast: the guard refuses one, and a move written any other way must not stop the tick).
      and case when a.payload #>> '{params,checkAt}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then (a.payload #>> '{params,checkAt}')::timestamptz end <= now()
    order by o.checked_at nulls first, o.move_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      check_at := (inforce.payload #>> '{params,checkAt}')::timestamptz;
      if check_at <= now() then
        update open_moves set checked_at = now() where move_act = inforce.move_act;
        checked := checked + 1;
        counted := demand_progress_or_error(inforce.move_act);
        if not (counted ? 'error') then update open_moves set progress = counted where move_act = inforce.move_act; end if;
        if counted ? 'error' then
          failed := failed + 1;
          raise warning 'system_tick: favor % could not be read at its check: % ', inforce.move_act, counted ->> 'error';
        elsif not coalesce((counted ->> 'met')::boolean, false) then
          did_end := (end_move(inforce.move_act, 'unmet', 'check') ->> 'ended')::boolean;
          if did_end then unmet := unmet + 1; perform say_move_end(inforce.move_act, 'unmet'); end if;
        end if;
      end if;
    exception when others then
      failed := failed + 1;
      raise warning 'system_tick: favor % was not checked: % (%)', inforce.move_act, sqlerrm, sqlstate;
    end;
  end loop;

  -- 4. Visits: each open visit `filingGraceMinutes` past its end is filed with the stock line, so nothing waits on a model. Whatever the switch says: a
  -- visit that has started is filed even if The System is turned off, and even if its Mod has left the staff. By visits_open_due, oldest first, and none once
  -- the budget is spent, at most `demandChecksPerTick` (the tick's one count for work per run; visits have no setting of their own); one that has failed goes behind the
  -- rest, by its last failure; file_visit locks the visit, so the filing cron racing this files it once. One that fails is left for the next tick.
  for late in
    select o.visit_act from visits_open o where o.ends_at <= now() - filing_grace order by o.failed_at nulls first, o.ends_at, o.visit_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      if (file_visit(late.visit_act, null) ->> 'filed')::boolean then filed := filed + 1; end if;
    exception when others then
      failed := failed + 1;
      raise warning 'system_tick: visit % did not file: % (%)', late.visit_act, sqlerrm, sqlstate;
      -- Recorded, and sent behind the others (the order above), so a visit that keeps failing never starves the rest.
      update visits_open set failed_at = now(), attempts = attempts + 1 where visit_act = late.visit_act returning attempts into tries;
      insert into visit_file_failures (visit_act, attempts, error) values (late.visit_act, coalesce(tries, 1), left(sqlerrm || ' (' || sqlstate || ')', 500))
      on conflict (visit_act) do update set attempts = excluded.attempts, error = excluded.error, at = now();
      -- The ceiling: a visit that cannot be filed after `visit_file_attempts_most` tries is dropped (ended `dropped`, no infraction), so it is never stuck for good.
      if coalesce(tries, 1) >= 10 then
        begin
          perform end_visit(late.visit_act, 'dropped', null, 'This visit could not be filed and was dropped.');
        exception when others then
          raise warning 'system_tick: visit % could not be dropped: % (%)', late.visit_act, sqlerrm, sqlstate;
        end;
      end if;
    end;
  end loop;

  -- 5. Staff requests (0424): a request a persona conferred and no meeting has ruled lapses `staffRequests.daysMost` days after it was conferred (staff_requests_now.lapses_at), and one whose request post is
  -- hidden, or gone, lapses at the next tick. Whatever the switch says, as a visit is filed: a state's way out is time, so a request does not wait on The System being on. The oldest first, at most `demandChecksPerTick`
  -- (the tick's one count for work per run), and none once the budget is spent. Where the post is still public and The System is on, the Boss replies in the thread to the request post with the stock line
  -- `requestLapsed` ({boss}, {asker}: the asker as the post's public author shows, so a veiled one is the anonymous name); an instance with no such line says nothing, and a post that cannot be written is
  -- a warning, never a request left waiting (boss_request_reply writes it, as requests_ruled's replies are). The reply is written before its ruling row (which names it), so the request's key is held first: try-locked, never waited on, so a meeting ruling the same
  -- request (requests_ruled holds the same key) and this pass cannot wait on each other; one it holds is left to the next tick. It reads the queue (staff_requests_open), the requests that wait and no other, so a row is read per
  -- waiting request, which the days they wait bound, and never one per request ruled in the past. As visits are (4 above), a request that failed to lapse, or was held by a meeting, goes behind the rest by its last
  -- failure (failed_at, then the oldest first), so one request that keeps raising or keeps being held never holds a slot of the pass from the others; it is still read when the others have been, and a meeting can rule it.
  for rq in select d.id, d.request_act, d.thread from staff_requests_due(cap) d
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      if not pg_try_advisory_xact_lock(hashtextextended('kayfabb.request.' || rq.id, 0)) then
        -- A meeting holds it (the row may be one its transaction has already ruled): behind the others, and never waited for (skip locked), so the tick does not wait on that transaction either.
        update staff_requests_open set failed_at = now() where request = (select x.request from staff_requests_open x where x.request = rq.id for update skip locked);
        continue;
      end if;
      if exists (select 1 from staff_request_rulings g where g.request = rq.id) then continue; end if;
      rq_public := staff_request_post_public(rq.request_act);
      if rq_public and enabled and boss is not null then
        begin
          select s.asker_name, s.body into asked from staff_request_shown(rq.id) s;
          perform owe_line(boss, 'requestLapsed', rq.thread, rq.request_act, rq.request_act, rq.id,
            jsonb_build_object('asker', coalesce(asked.asker_name, ''), 'body', left(coalesce(asked.body, ''), 600)));
        exception when others then
          raise warning 'system_tick: the lapse of request % was not owed: % (%)', rq.id, sqlerrm, sqlstate;
        end;
      end if;
      insert into staff_request_rulings (request, ruling) values (rq.id, 'lapsed');
      lapsed_n := lapsed_n + 1;
    exception when others then
      failed := failed + 1;
      raise warning 'system_tick: request % did not lapse: % (%)', rq.id, sqlerrm, sqlstate;
      -- Recorded and sent behind the others (the order above). The block's own writes are undone, so this is the one write left; a row a meeting is ruling is not waited for.
      update staff_requests_open set failed_at = now(), attempts = attempts + 1 where request = (select x.request from staff_requests_open x where x.request = rq.id for update skip locked);
    end;
  end loop;

  -- 6. Owed lines (the persona lines plan, Task 4): a line a move's end, a request's lapse or a handover's arrival owes its speaker (lines_owed_open), not paid by the staff run within `owedLines.graceMinutes`, is posted from the
  -- speaker's stock (pay_owed_line with no body); with The System off it is paid `unsaid` ('The System is off') and nothing is posted, as the lapse above says nothing then. Whatever the switch says otherwise: the line's act has happened. The
  -- oldest first (a row that failed goes behind the rest, by its last failure, so one line that keeps raising never holds the pass), at most `demandChecksPerTick` (the tick's one count for work per run), and none once the budget is spent.
  -- The queue is the lines not yet paid, which the grace bounds, and never one per line paid in the past. A row the staff run holds is skipped (skip locked) and paid by whoever has it. A line that raises (only a transient failure gets here:
  -- pay_owed_line pays every other failure `unsaid` itself) is counted and sent behind the others (the attempts, a record and no cap), and is tried again on a later tick, so a run of transient failures never turns a line into an unsaid one.
  for owed_late in
    select o.owed from lines_owed_open o where o.at <= now() - make_interval(mins => owed_grace_minutes()) order by o.failed_at nulls first, o.at, o.owed limit cap for update of o skip locked
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      if enabled then
        perform pay_owed_line(owed_late.owed, null);
      else
        perform pay_owed_unsaid(owed_late.owed, 'The System is off');
      end if;
      owed_paid := owed_paid + 1;
    exception when others then
      failed := failed + 1;
      owed_error := left(sqlerrm || ' (' || sqlstate || ')', 400);
      raise warning 'system_tick: owed line % was not paid: %', owed_late.owed, owed_error;
      update lines_owed_open set failed_at = now(), attempts = attempts + 1 where owed = owed_late.owed;
    end;
  end loop;

  -- 7. Pending quizzes (the written quiz plan, Task 1): a quiz visit with no question row whose start is `modBots.quizWriteMinutes` or more in the past is given its bank question (snapshotted into the row, so a reseed of
  -- the bank cannot change it), whatever the switch says: the staff run writes the model's question sooner where it can, and no visit waits longer than this. The oldest first, found by the partial index on visits_open
  -- (the pending ones alone), at most `demandChecksPerTick`, and none once the budget is spent. A visit whose persona has no bank question for it (a reseed removed it) is not scanned at all, so it can never hold the head of the scan and starve the rest (pending_quizzes leaves it out for the same reason); it ends with its visit, or is banked once a reseed gives the bank that question back. Best effort per visit: one that fails is warned and left for the next tick; a row
  -- the staff run wrote first is left as it stands (write_visit_quiz answers it and writes nothing).
  for quiz_late in
    select o.visit_act from visits_open o where o.quiz_at is not null and o.quiz_at <= now() - quiz_grace
      and exists (select 1 from acts v join characters c on c.id = v.character join staff_quiz_questions q on q.staff = c.staff and q.idx = (v.payload #>> '{challenge,question_index}')::integer where v.id = o.visit_act)
    order by o.quiz_at, o.visit_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      quiz_bank := bank_quiz_for(quiz_late.visit_act);
      if quiz_bank is null then
        raise warning 'system_tick: quiz visit % has no bank question to fall back on', quiz_late.visit_act;
        continue;
      end if;
      if (write_visit_quiz(quiz_late.visit_act, 'bank', quiz_bank ->> 'question', quiz_bank -> 'choices', quiz_bank ->> 'answer') ->> 'written')::boolean then
        quiz_banked := quiz_banked + 1;
        -- The quiz visit's concession is settled in the same step: none, since the Mod's call did not write it in time (a row the staff run wrote first is left as it stands, and so is its concession).
        perform write_visit_concession(quiz_late.visit_act, 'none', null, 'window');
      end if;
    exception when others then
      raise warning 'system_tick: the question for visit % was not banked: % (%)', quiz_late.visit_act, sqlerrm, sqlstate;
    end;
  end loop;

  -- 8. Pending concessions (the concession post plan, Task 1): an open visit with no concession row whose start is past its window (`modBots.quizWriteMinutes` for a quiz visit, `modBots.concessionWriteMinutes` for any other)
  -- is given a `none` row (why `window`), whatever the switch says: the staff run writes the Mod's own words sooner where it can, and no visit waits longer than this. A quiz visit is covered here whether or not its
  -- question was written (step 7 writes the `none` row beside a bank row it has just written, so a quiz visit reaches this step only when the run wrote its question, or its persona has no bank question to fall back on). The oldest first, found by the
  -- partial index on visits_open (the pending ones alone), at most `demandChecksPerTick`, and none once the budget is spent. Best effort per visit: one that fails is warned and left for the next tick; a row the staff run wrote
  -- first is left as it stands (write_visit_concession answers it and writes nothing).
  for conc_late in
    select o.visit_act from visits_open o join acts v on v.id = o.visit_act
    where o.concession_at is not null
      and o.concession_at <= now() - case when v.payload #>> '{challenge,kind}' = 'quiz' then quiz_grace else conc_grace end
    order by o.concession_at, o.visit_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      if (write_visit_concession(conc_late.visit_act, 'none', null, 'window') ->> 'written')::boolean then
        conc_lapsed := conc_lapsed + 1;
      end if;
    exception when others then
      raise warning 'system_tick: the concession for visit % was not settled: % (%)', conc_late.visit_act, sqlerrm, sqlstate;
    end;
  end loop;

  return jsonb_build_object('landed', landed, 'met', met, 'expired', expired, 'superseded', superseded, 'unmet', unmet, 'failed', failed, 'checked', checked, 'visits', filed, 'beats', arcs, 'budget', out_of_time,
    'awardsFailed', awards_failed, 'requestsLapsed', lapsed_n, 'owedPaid', owed_paid, 'quizzesBanked', quiz_banked, 'concessionsLapsed', conc_lapsed);
end $$;
