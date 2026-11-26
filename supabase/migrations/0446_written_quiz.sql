-- A Mod writes its quiz question for each visit (docs/plans/2026-11-22-written-quiz-design.md, section 3; its plan, Task 1).
--
-- A quiz visit's question lives in a `visit_quizzes` row, written once: by the staff run from a light-tier call in the Mod's voice (`model`), or from the persona's bank (`bank`) when that call
-- fails, is rejected, the day's `quizQuestionsPerDay` is spent, the System is off, or `quizWriteMinutes` has passed. Until the row exists the quiz is PENDING: `visit_quiz` answers
-- {"pending": true} and `intercept` refuses a quiz answer, in the same words for everyone and before anything is written, so the character's one try is not spent.
--
-- visit_quizzes     one row per quiz visit: its source, question, choices (2 to 8 distinct strings). The 4-choice cap on a model question is the engine's repair (engine/system/quiz.ts) and is not held here; the table allows 2 to 8 because a bank question
--                   (the seed allows up to 8 choices) is snapshotted whole and a snapshot of it must never fail; the choices' being distinct strings is a trigger's. Also the answer, and when it was written. Append-only (an update, delete or truncate is refused, always);
--                   no client reads it (row security on, nothing granted). `visit_quiz` hands a page the question and choices and never the answer or the source.
-- visits_open.quiz_at   the pending quizzes' index. A column on visits_open (the open visits, which a trigger on the visit Act already keeps) holding the visit's start while it awaits its question and null
--                   otherwise, with a partial index on it, so "the open quiz visits with no row, oldest first" reads only the pending ones. A trigger sets it when the open row is made (the visit's
--                   challenge is a quiz and no row stands) and another clears it when the row is written, so rebuild_visits_open (0105) needs no change. A visit that ends while pending loses its open row, and with
--                   it the mark; its question may still be written, harmlessly.
-- write_visit_quiz(visit, source, question, choices, answer)   service only. Writes the row once; a second write (the staff run and the tick can race) writes nothing and answers the row that stands.
--                   Refuses a visit that is not a quiz visit. Answers {written, source, question, choices, answer}.
-- bank_quiz_for(visit)    service only. The persona's bank question for the visit, by its stored `question_index`, as {question, choices, answer}, or null where the bank has none.
-- pending_quizzes(most)   service only. The open quiz visits with no row, oldest first, with what the staff run's call needs.
-- quiz_calls_today()      service only. Today's (UTC) ledger calls for the duty `quizQuestion`, as filing_calls_today counts filings.
-- backfill_visit_quizzes()   service only, and run once below: a bank row for every quiz visit that has none, open or ended, from its stored `question_index`, so no visit already open becomes pending and
--                   visit_quiz() answers for an ended one as before. Idempotent.
-- system_tick       (0445), step 7: the bank question for each pending quiz visit whose start is `modBots.quizWriteMinutes` or more in the past, whatever the switch says. Best effort per visit.
-- visit_quiz        (0368), reading visit_quizzes. intercept (0108), a quiz answer reading it too. setting_modbots (0362), holding `quizQuestionsPerDay` and `quizWriteMinutes`.
-- staff_call_records (0445), taking the duty quizQuestion.
-- Latest definitions copied: system_tick (0445), visit_quiz (0368), intercept (0108), setting_modbots (0362); filing_calls_today (0106) is the pattern for quiz_calls_today.
--
-- Settings: `modBots` now requires both fields (the TypeScript check and every seeded settings object carry them); an instance already seeded gains them from its next reseed.

-- ------------------------------------------------------------------------------------------------ the table ----

create table visit_quizzes (
  visit_act uuid primary key references acts (id),
  source text not null check (source in ('model', 'bank')),
  question text not null check (btrim(question) <> ''),
  choices jsonb not null check (jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) between 2 and 8),
  answer text not null check (choices ? answer),
  at timestamptz not null default now()
);
alter table visit_quizzes enable row level security;
revoke all on visit_quizzes from public, anon, authenticated;

-- The choices are 2 to 4 distinct strings (the table's check holds the count, 2 to 8; a trigger holds what a check cannot say).
create function visit_quizzes_well_formed() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if exists (select 1 from jsonb_array_elements(new.choices) e where jsonb_typeof(e) <> 'string')
     or (select count(distinct e) from jsonb_array_elements_text(new.choices) e) <> jsonb_array_length(new.choices) then
    raise exception 'a question''s choices are distinct strings' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function visit_quizzes_well_formed() from public, anon, authenticated;
create trigger visit_quizzes_well_formed before insert on visit_quizzes for each row execute function visit_quizzes_well_formed();

create function visit_quizzes_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a visit''s question is never edited or removed (%)', tg_op using errcode = 'P0001';
end $$;
create trigger visit_quizzes_no_update before update or delete on visit_quizzes for each row execute function visit_quizzes_append_only();
create trigger visit_quizzes_no_truncate before truncate on visit_quizzes for each statement execute function visit_quizzes_append_only();
alter table visit_quizzes enable always trigger visit_quizzes_no_update;
alter table visit_quizzes enable always trigger visit_quizzes_no_truncate;
revoke execute on function visit_quizzes_append_only() from public, anon, authenticated;

-- ------------------------------------------------------------------------------------- the pending index ----

alter table visits_open add column quiz_at timestamptz;
create index visits_open_quiz_pending on visits_open (quiz_at, visit_act) where quiz_at is not null;

-- When an open row is made for a quiz visit that has no question yet, it is marked with the visit's start.
create function visits_open_mark_quiz() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.quiz_at := (select a.created_at from acts a where a.id = new.visit_act and a.kind = 'visit' and a.payload #>> '{challenge,kind}' = 'quiz'
                    and not exists (select 1 from visit_quizzes q where q.visit_act = a.id));
  return new;
end $$;
revoke execute on function visits_open_mark_quiz() from public, anon, authenticated;
create trigger visits_open_mark_quiz before insert on visits_open for each row execute function visits_open_mark_quiz();

-- When the question is written the visit is no longer pending.
create function visit_quizzes_clear_mark() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update visits_open set quiz_at = null where visit_act = new.visit_act and quiz_at is not null;
  return null;
end $$;
revoke execute on function visit_quizzes_clear_mark() from public, anon, authenticated;
create trigger visit_quizzes_clear_mark after insert on visit_quizzes for each row execute function visit_quizzes_clear_mark();

-- ---------------------------------------------------------------------------------------------- the writers ----

create function bank_quiz_for(visit uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('question', q.question, 'choices', q.choices, 'answer', q.answer)
  from acts v join characters c on c.id = v.character
  join staff_quiz_questions q on q.staff = c.staff and q.idx = (v.payload #>> '{challenge,question_index}')::integer
  where v.id = bank_quiz_for.visit and v.kind = 'visit' and v.payload #>> '{challenge,kind}' = 'quiz'
$$;

create function write_visit_quiz(visit uuid, source text, question text, choices jsonb, answer text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  made boolean;
  row visit_quizzes%rowtype;
begin
  if not exists (select 1 from acts v where v.id = write_visit_quiz.visit and v.kind = 'visit' and v.payload #>> '{challenge,kind}' = 'quiz') then
    raise exception 'there is no such quiz visit' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  insert into visit_quizzes (visit_act, source, question, choices, answer)
  values (write_visit_quiz.visit, write_visit_quiz.source, write_visit_quiz.question, write_visit_quiz.choices, write_visit_quiz.answer)
  on conflict (visit_act) do nothing
  returning * into row;
  made := found;
  if not made then select * into row from visit_quizzes q where q.visit_act = write_visit_quiz.visit; end if;
  return jsonb_build_object('written', made, 'source', row.source, 'question', row.question, 'choices', row.choices, 'answer', row.answer);
end $$;

create function pending_quizzes(most integer) returns table (visit_act uuid, staff text, post_act uuid, thread uuid, board uuid, board_name text, charges jsonb, started_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select o.visit_act, c.staff, o.post, v.thread, t.board, b.name, visit_charges(o.visit_act), o.quiz_at
  from visits_open o
  join acts v on v.id = o.visit_act
  join characters c on c.id = v.character
  join threads t on t.id = v.thread
  left join boards_now b on b.id = t.board
  -- A visit whose persona has no bank question to fall back on is left out: it could never be banked, and at the head of the oldest-first scan it would starve the visits behind it.
  where o.quiz_at is not null
    and exists (select 1 from staff_quiz_questions q where q.staff = c.staff and q.idx = (v.payload #>> '{challenge,question_index}')::integer)
  order by o.quiz_at, o.visit_act
  limit greatest(pending_quizzes.most, 0)
$$;

create function quiz_calls_today() returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::integer from model_calls m where m.duty = 'quizQuestion' and m.at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
$$;

create function backfill_visit_quizzes() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  with made as (
    insert into visit_quizzes (visit_act, source, question, choices, answer)
    select v.id, 'bank', q.question, q.choices, q.answer
    from acts v join characters c on c.id = v.character
    join staff_quiz_questions q on q.staff = c.staff and q.idx = (v.payload #>> '{challenge,question_index}')::integer
    where v.kind = 'visit' and v.payload #>> '{challenge,kind}' = 'quiz'
    on conflict (visit_act) do nothing
    returning 1
  ) select count(*)::integer into n from made;
  return n;
end $$;

revoke execute on function bank_quiz_for(uuid), write_visit_quiz(uuid, text, text, jsonb, text), pending_quizzes(integer), quiz_calls_today(), backfill_visit_quizzes() from public, anon, authenticated;
grant execute on function bank_quiz_for(uuid), write_visit_quiz(uuid, text, text, jsonb, text), pending_quizzes(integer), quiz_calls_today(), backfill_visit_quizzes() to service_role;

-- Visits already held: every quiz visit, open or ended, is given its bank question from its stored question_index (none becomes pending).
select backfill_visit_quizzes();

-- staff_call_records (0445), taking the duty quizQuestion, the call that writes a visit's question. Everything else as 0445 wrote it.
alter table staff_call_records drop constraint staff_call_records_duty_check;
alter table staff_call_records add constraint staff_call_records_duty_check check (duty in ('filing', 'reportJudge', 'patrolJudge', 'appeal', 'ruling', 'apologyJudge', 'standingOrderLine', 'quizQuestion'));

-- --------------------------------------------------------------------------------------------- the setting ----

-- setting_modbots (0362_patrol_weights.sql), also holding `quizQuestionsPerDay` (a whole number, at least 0) and `quizWriteMinutes` (a whole number, at least 1). Everything else as 0362 wrote it.
create or replace function setting_modbots(v jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  wholes constant jsonb := '{"allowanceMost": 1, "ruleDaysMost": 1, "patrolsPerDay": 0, "reportPrice": 0, "reportsPerDay": 1, "judgmentsPerDay": 1, "filingLinesPerDay": 1, "appealPrice": 0, "tailHours": 1, "filingGraceMinutes": 1, "quizQuestionsPerDay": 0, "quizWriteMinutes": 1}';
  fields constant text[] := array['allowanceMost', 'ruleDaysMost', 'patrolsPerDay', 'reportPrice', 'reportsPerDay', 'judgmentsPerDay', 'filingLinesPerDay', 'appealPrice', 'tailHours', 'filingGraceMinutes', 'quizQuestionsPerDay', 'quizWriteMinutes', 'patrolSample', 'patrolPool', 'visitHours', 'cap', 'filingCron'];
  shape constant text := 'an object giving allowanceMost, ruleDaysMost, reportsPerDay, judgmentsPerDay, filingLinesPerDay, tailHours, filingGraceMinutes and quizWriteMinutes (whole numbers, at least 1), patrolsPerDay, reportPrice, appealPrice and quizQuestionsPerDay (whole numbers, at least 0), patrolSample (a whole number from 1 to 25), patrolPool (a whole number from patrolSample to 100), visitHours (least and most, whole hours, at least 1, most not below least), cap (punishments and days, whole numbers, at least 1) and filingCron (a five-field cron expression, each field inside its range)';
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

-- A deployed instance's stored `modBots` row lacks the two fields, and the staff function's settings check would refuse the whole staff run (filings included) until a reseed. The data step gives
-- each missing field its default, independently: `quizWriteMinutes` 15 and `quizQuestionsPerDay` 0 (0 means the bank always, so no paid call starts until the instance's own seed sets its budget; Divided World's
-- seed carries 60). A row that already holds a field keeps it. A migration's write is a seed's: kayfabb.seeding is on, so settings_tuned (0355) leaves tuned_at as it was. At replay there is no row, so it changes
-- nothing on a fresh database. A function, so the test can call it on a row it plants.
create function migrate_modbots_quiz_fields() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  was text := current_setting('kayfabb.seeding', true);
  n integer;
begin
  perform set_config('kayfabb.seeding', 'on', true);
  update settings set value = value
      || case when value ? 'quizWriteMinutes' then '{}'::jsonb else jsonb_build_object('quizWriteMinutes', 15) end
      || case when value ? 'quizQuestionsPerDay' then '{}'::jsonb else jsonb_build_object('quizQuestionsPerDay', 0) end
  where key = 'modBots' and not (value ? 'quizWriteMinutes' and value ? 'quizQuestionsPerDay');
  get diagnostics n = row_count;
  perform set_config('kayfabb.seeding', coalesce(nullif(was, ''), 'off'), true);
  return n;
end $$;
revoke execute on function migrate_modbots_quiz_fields() from public, anon, authenticated;
grant execute on function migrate_modbots_quiz_fields() to service_role;
select migrate_modbots_quiz_fields();

-- ------------------------------------------------------------------------------------------- the reads ----

-- visit_quiz (0368_client_reads_plan_once.sql), reading the question from visit_quizzes: a quiz visit with no row answers {"pending": true}, and a row answers its question and choices, never its answer or source.
-- A visit that is no quiz visit answers null, as before. Everything else as 0368 wrote it.
create or replace function public.visit_quiz(visit uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return (
  select case when q.visit_act is null then jsonb_build_object('pending', true) else jsonb_build_object('question', q.question, 'choices', q.choices) end
  from acts v left join visit_quizzes q on q.visit_act = v.id
  where v.id = visit_quiz.visit and v.kind = 'visit' and v.payload #>> '{challenge,kind}' = 'quiz'
  );
end
$function$;

-- intercept (0108_interception.sql), a quiz answer reading the visit's question from visit_quizzes and refusing while none is written. Everything else as 0108 wrote it.
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
begin
  caller := acting(through);
  perform not_banned(through);
  select * into v from acts a where a.id = intercept.visit_act and a.kind = 'visit';
  if not found then raise exception 'there is no such visit' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
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
    perform end_visit(v.id, 'intercepted', iid, me || ' got past ' || mod_name || '''s ' || case ckind when 'quiz' then 'quiz' else 'price' end || '.');
  else
    until := now() + make_interval(hours => hours);
    insert into tails (character, staff, intercept_act, until) values (through, mod_key, iid, until);
  end if;
  return jsonb_build_object('intercept', iid, 'visit', v.id, 'kind', ckind, 'succeeded', ok, 'ended', ok, 'tail_until', until);
end $$;
revoke execute on function intercept(uuid, uuid, text) from public, anon;
grant execute on function intercept(uuid, uuid, text) to authenticated, service_role;

-- system_tick (0445_persona_lines.sql), a step 7 that gives each pending quiz visit its bank question once `modBots.quizWriteMinutes` have passed, and the count in its answer as `quizzesBanked`. Everything else as 0445 wrote it.
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
      end if;
    exception when others then
      raise warning 'system_tick: the question for visit % was not banked: % (%)', quiz_late.visit_act, sqlerrm, sqlstate;
    end;
  end loop;

  return jsonb_build_object('landed', landed, 'met', met, 'expired', expired, 'superseded', superseded, 'unmet', unmet, 'failed', failed, 'checked', checked, 'visits', filed, 'beats', arcs, 'budget', out_of_time,
    'awardsFailed', awards_failed, 'requestsLapsed', lapsed_n, 'owedPaid', owed_paid, 'quizzesBanked', quiz_banked);
end $$;
