-- The Mod's one move, and the filing run's doors (the Mod Bots design, sections 2 and 6; its plan, Task 7).
--
-- A Mod's visit filing is a light-tier call that may carry at most one move (design, section 2). The `staff` Edge Function (supabase/functions/staff/) makes the
-- call; this migration is the database's side of it.
--
--   queued_moves.cause_act   the Act that drew the move (a visit, and later a report, a patrol or an appeal), written once and never changed. A Mod's move is keyed on
--                            it: one cause queues at most one move for a Mod, so a filing run that crashes between its calls and runs again, or two runs that race,
--                            queue the move once and spend the allowance once. A meeting's moves have no cause.
--   queued_moves_guard       (0103) also refusing a rule a Mod sets for longer than `modBots.ruleDaysMost` days, so the cap holds in SQL and not only in the engine's
--                            repair (Task 4's review), and refusing a change to cause_act.
--   apply_mod_move           queues the Mod's move as the Mod's, going live now, through the guard: the office, the beat, the allowance (spent by queueing it, under the
--                            Mod's lock) and the cap. It writes nothing and says why when the guard refuses or the move is malformed, and it also refuses a cause that is a visit that
--                            ended any way but filed. It raises only for a missing cause_act (a caller's bug): a move that does not hold must not cost the filing it rode in on. An expiry past the cap is clamped here first, and the clamp is returned (`trimmed`). It is idempotent
--                            on the cause.
--   staff_call_records / record_staff_call   the repair's trims and drops for each billed call (a retry is the next attempt), never edited.
--   filings_due              the visits whose end is past and that are still open, oldest first, bounded: what the filing run reads. Never before ends_at (the tick's grace,
--                            `filingGraceMinutes`, gives the run the first chance), and never a visit the tick has already failed to file (it is the tick's, and goes behind).
--   mod_standing             a persona's office, what it has left to spend, the Boss's last order to it and the boards of its beat.
--   rules_in_force           the rules that apply on a board, the board's own and the house's, as `rules_now` numbers them.
--   filing_calls_today       the instance-wide count of today's (UTC) filing calls in the ledger: what `filingLinesPerDay` is counted against.
--   schedule_staff           (re)schedules the filing run at `modBots.filingCron`, as schedule_meeting (0071) does; the settings trigger runs it.
--
-- Masks. Nothing here reads who owns a character, a class or who reacted: a visit, its charges, the board and the Mod's own record are public or the Mod's.
-- Ways out. A move that is not queued costs nothing and is told why; a visit the run does not file is filed by the tick.

alter table queued_moves add column cause_act uuid references acts (id);
create unique index queued_moves_cause on queued_moves (staff, cause_act) where cause_act is not null;

-- queued_moves_guard (0103), also refusing a Mod's rule past modBots.ruleDaysMost days, and a change to cause_act. Everything else as 0103 wrote it.
create or replace function queued_moves_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  params_ok boolean;
  problem text;
  holder text;
  watched uuid;
begin
  if tg_op = 'DELETE' then
    raise exception 'a queued move is held or landed, never removed' using errcode = '23514';
  elsif tg_op = 'INSERT' then
    if new.demand is not null and not exists (select 1 from demand_kinds d where d.key = new.demand ->> 'kind') then
      raise exception 'there is no demand kind "%"', coalesce(new.demand ->> 'kind', '') using errcode = '23514';
    end if;
    if new.demand is not null and demand_params_problem(new.demand) is not null then
      raise exception 'the demand''s params are malformed at %', demand_params_problem(new.demand) using errcode = '23514';
    end if;
    if not exists (select 1 from move_kinds k where k.key = new.kind) then
      raise exception 'there is no move kind "%"', new.kind using errcode = '23514';
    end if;
    if new.structural is distinct from (select k.structural from move_kinds k where k.key = new.kind) then
      raise exception 'a % move is not queued as structural = %', new.kind, new.structural using errcode = '23514';
    end if;
    -- Who may make a move: the office the staff member holds now must be one the kind names (0103). The Boss holds the seat the open season names;
    -- a Mod Bot is on staff; a member, a benched persona, a waiting one and the developer make none.
    holder := (select o.office from staff_office_now o where o.staff = new.staff);
    if holder is null or not exists (select 1 from move_kinds k where k.key = new.kind and holder = any (k.offices)) then
      raise exception 'a % move is not one a % makes', new.kind, coalesce(holder, 'staff member with no office') using errcode = '23514';
    end if;
    if new.kind = 'nameSuccessor' then
      if new.demand is not null or new.expires_at is not null then raise exception 'a nomination has no demand and no expiry' using errcode = '23514'; end if;
      if jsonb_typeof(new.params -> 'boss') is distinct from 'string'
         or not (new.params ->> 'boss' = any (boss_roster())) then
        raise exception 'a nomination names a persona on the Boss roster, not a benched or retired one' using errcode = '23514';
      end if;
      if new.params ->> 'boss' = new.staff then raise exception 'a Boss does not name itself' using errcode = '23514'; end if;
    end if;
    if new.admin_description is not null then raise exception 'a queued move is queued without an admin''s replacement' using errcode = '23514'; end if;
    if new.kind = 'setRule' then
      -- A rule ends by its expiry, so none waits on an admin; the board is stored in lowercase, the one form numbering and indexes compare.
      if new.expires_at is null then raise exception 'a rule needs an expiry' using errcode = '23514'; end if;
      if jsonb_typeof(new.params -> 'board') = 'string' then new.params := jsonb_set(new.params, '{board}', to_jsonb(lower(new.params ->> 'board'))); end if;
      -- The board's shape comes before anything casts it: a board that is no uuid is a malformed rule, never an error in a cast.
      if jsonb_typeof(new.params -> 'board') is distinct from 'string' and new.params -> 'board' is not null and new.params -> 'board' <> 'null'::jsonb then
        raise exception 'a rule is malformed: the board is no board of the players' using errcode = '23514';
      end if;
      if jsonb_typeof(new.params -> 'board') = 'string' and (new.params ->> 'board') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'a rule is malformed: the board is no board of the players' using errcode = '23514';
      end if;
      problem := rule_params_problem(new.params);
      if problem is not null then raise exception 'a rule is malformed: %', problem using errcode = '23514'; end if;
      problem := rule_conflict(nullif(new.params ->> 'board', '')::uuid, new.params ->> 'predicate', nullif(new.params -> 'param', 'null'::jsonb));
      if problem is not null then raise exception 'that rule would leave no post that follows the rules: %', problem using errcode = '23514'; end if;
    end if;
    -- A Mod's move names a board of its beat and spends an allowance (0103). The board is the beat_of answer for it, so a board the Boss's order left out is
    -- still some Mod's; the allowance is counted under a lock of the Mod's own, so two moves queued at once cannot spend the one left.
    -- Only the guard says which order a row spends against: a caller's value is never kept.
    new.spent_order := null;
    if holder = 'mod' then
      -- The Mod's own lock comes first: the beat and the allowance are read under it, so two moves queued at once (two sessions, or two rows of one insert,
      -- which are counted because these functions are volatile) cannot spend the one left.
      perform pg_advisory_xact_lock(hashtextextended('kayfabb.allowance.' || new.staff, 0));
      watched := case when (new.params ->> 'board') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (new.params ->> 'board')::uuid end;
      if watched is null then raise exception 'a Mod''s move names the board it watches' using errcode = '23514'; end if;
      if beat_of(watched) is distinct from new.staff then raise exception 'that board is not on %''s beat', new.staff using errcode = '23514'; end if;
      -- A rule a Mod sets lasts at most `modBots.ruleDaysMost` days (7 where the setting is not there yet; setting_modbots holds it a whole number, and it is read as numeric all the same): the Boss's phase bounds the Boss's, and nothing but this bounds a Mod's.
      if new.kind = 'setRule' and new.expires_at > new.go_live_at + coalesce((select (s.value ->> 'ruleDaysMost')::numeric from settings s where s.key = 'modBots'), 7) * interval '1 day' then
        raise exception 'a rule a Mod sets lasts at most % days', coalesce((select (s.value ->> 'ruleDaysMost')::numeric from settings s where s.key = 'modBots'), 7)::numeric(10,0) using errcode = '23514';
      end if;
      if mod_allowance(new.staff) < 1 then raise exception '% has no allowance left; the Boss hands out more at its meeting', new.staff using errcode = '23514'; end if;
      new.spent_order := (select x.id from staff_orders x where x.staff = new.staff order by x.id desc limit 1);
    end if;
  else
    params_ok := new.params is not distinct from old.params
      or (old.kind = 'nameSuccessor' and old.landed_act is null and old.held_at is null
          and new.params - 'boss' = old.params - 'boss' and jsonb_typeof(new.params -> 'boss') = 'string');
    if not params_ok
       or (new.id, new.meeting, new.staff, new.kind, new.demand, new.why, new.go_live_at, new.expires_at, new.structural, new.spent_order, new.cause_act)
          is distinct from (old.id, old.meeting, old.staff, old.kind, old.demand, old.why, old.go_live_at, old.expires_at, old.structural, old.spent_order, old.cause_act) then
      raise exception 'a queued move is only ever held or landed' using errcode = '23514';
    end if;
    -- Who replaced a nomination and when change only with the Boss they replace, and with each other.
    if (new.replaced_by, new.replaced_at) is distinct from (old.replaced_by, old.replaced_at)
       and (new.params is not distinct from old.params or new.replaced_by is null or new.replaced_at is null) then
      raise exception 'a replacement is recorded with the Boss it puts in place' using errcode = '23514';
    end if;
    -- An admin's replacement of a description is for a rename still waiting, and never leaves the row afterward.
    if (new.admin_description, new.described_by, new.described_at) is distinct from (old.admin_description, old.described_by, old.described_at)
       and (old.kind <> 'renameBoard' or old.landed_act is not null or old.held_at is not null or new.admin_description is null) then
      raise exception 'only a rename that is still waiting takes an admin''s description' using errcode = '23514';
    end if;
    -- A refusal at landing is final: set once, on a row still waiting, and never changed or taken back.
    if (new.refused_at, new.failed_at, new.failure) is distinct from (old.refused_at, old.failed_at, old.failure)
       and (old.refused_at is not null or (new.refused_at is not null and (old.landed_act is not null or old.held_at is not null or new.failure is null))) then
      raise exception 'a refused rule stays refused' using errcode = '23514';
    end if;
    if (old.held_at is not null and (new.held_at, new.held_by) is distinct from (old.held_at, old.held_by))
       or (old.landed_act is not null and new.landed_act is distinct from old.landed_act) then
      raise exception 'a queued move that is held or landed stays so' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;


-- ------------------------------------------------------------------------------------------------ the Mod's move ----

create function apply_mod_move(staff text, move jsonb, cause_act uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  kind text;
  params jsonb;
  hours numeric;
  most numeric := coalesce((select (s.value ->> 'ruleDaysMost')::numeric from settings s where s.key = 'modBots'), 7) * 24;
  least numeric := coalesce((select (s.value #>> '{}')::numeric from settings s where s.key = 'moveExpiryLeastHours'), 24);
  why text;
  ord staff_orders%rowtype;
  existing bigint;
  made bigint;
  trimmed jsonb := '{}'::jsonb;
  lives timestamptz := now();
begin
  if apply_mod_move.cause_act is null or not exists (select 1 from acts a where a.id = apply_mod_move.cause_act) then
    raise exception 'a Mod''s move names the Act that drew it' using errcode = '22023';
  end if;
  -- The Mod's own lock, the one the queue guard takes for the allowance: the check for an earlier move of this cause and the insert are one decision.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.allowance.' || apply_mod_move.staff, 0));
  select q.id into existing from queued_moves q where q.staff = apply_mod_move.staff and q.cause_act = apply_mod_move.cause_act;
  if found then return jsonb_build_object('move', existing, 'queued', false, 'existing', true); end if;

  if jsonb_typeof(move) is distinct from 'object' then return jsonb_build_object('move', null, 'queued', false, 'reason', 'the move is no object'); end if;
  kind := move ->> 'kind';
  params := move -> 'params';
  if kind is null or jsonb_typeof(params) is distinct from 'object' then return jsonb_build_object('move', null, 'queued', false, 'reason', 'the move names its kind and its params'); end if;
  why := left(btrim(regexp_replace(coalesce(move ->> 'why', ''), '\s+', ' ', 'g')), 200);
  if why = '' then return jsonb_build_object('move', null, 'queued', false, 'reason', 'the move says why'); end if;
  if jsonb_typeof(move -> 'expires_in_hours') is distinct from 'number' then return jsonb_build_object('move', null, 'queued', false, 'reason', 'the move says how many hours it lasts'); end if;
  hours := round((move ->> 'expires_in_hours')::numeric);
  if hours > most then
    trimmed := trimmed || jsonb_build_object('expires_in_hours', jsonb_build_object('before', hours, 'after', most));
    hours := most;
  elsif hours < least then
    trimmed := trimmed || jsonb_build_object('expires_in_hours', jsonb_build_object('before', hours, 'after', least));
    hours := least;
  end if;
  -- A move does not ride on a filing that never happened: a visit ended any way but filed (talked down, trapped, reversed) draws no move.
  if exists (select 1 from acts e where e.kind = 'visit_end' and e.target_act_id = apply_mod_move.cause_act and e.payload ->> 'outcome' is distinct from 'filed') then
    return jsonb_build_object('move', null, 'queued', false, 'reason', 'that visit ended and was never filed, so it draws no move');
  end if;
  select * into ord from staff_orders o where o.staff = apply_mod_move.staff order by o.id desc limit 1;
  if not found then return jsonb_build_object('move', null, 'queued', false, 'reason', apply_mod_move.staff || ' has had no order from the Boss'); end if;

  begin
    -- The guard decides: the office, the beat, the allowance, the cap and the rule itself. It stamps the order the move spends against.
    insert into queued_moves (meeting, staff, kind, params, why, go_live_at, expires_at, structural, cause_act)
    values (ord.meeting, apply_mod_move.staff, kind, params, why, lives, lives + make_interval(hours => hours::integer),
            coalesce((select k.structural from move_kinds k where k.key = kind), false), apply_mod_move.cause_act)
    returning id into made;
  exception
    when unique_violation then
      select q.id into existing from queued_moves q where q.staff = apply_mod_move.staff and q.cause_act = apply_mod_move.cause_act;
      return jsonb_build_object('move', existing, 'queued', false, 'existing', true);
    when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or data_exception then
      -- The guard's refusals and a malformed move (a cast, a null, a wrong type) are refusals: the filing it rode in on is not left open to pay for the call again. Anything
      -- else (a lock timeout, a deadlock, a failing trigger, a resource error) is not a verdict on the move, and raises: the visit stays open and the next run tries again.
      return jsonb_build_object('move', null, 'queued', false, 'reason', case when sqlstate in ('23514', '23502') then sqlerrm else 'the move is malformed' end);
  end;
  return jsonb_build_object('move', made, 'queued', true, 'existing', false) || case when trimmed = '{}'::jsonb then '{}'::jsonb else jsonb_build_object('trimmed', trimmed) end;
end $$;

-- -------------------------------------------------------------------------------------------- the call's record ----

-- What a judged call came to, kept in the database ("Cost is a column": the ledger holds the model layer's result, this holds the repair's): the trims made and
-- what was dropped, with the predicate that failed, one row per billed call (the Act that drew it, the duty, the Mod, the attempt). Written once, never edited. No client
-- reads it and no admin screen shows it yet: it is read in SQL.
create table staff_call_records (
  cause_act uuid not null references acts (id),
  duty text not null check (duty in ('filing', 'reportJudge', 'patrolJudge', 'appeal')),
  staff text not null references characters (staff),
  record jsonb not null check (jsonb_typeof(record) = 'object'),
  -- Each billed call has a record: a retry of the same cause is the next attempt.
  attempt integer not null default 1 check (attempt >= 1),
  at timestamptz not null default now(),
  primary key (cause_act, duty, staff, attempt)
);
alter table staff_call_records enable row level security;
revoke all on staff_call_records from public, anon, authenticated;
create function staff_call_records_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a call''s record is never edited or removed (%)', tg_op using errcode = 'P0001';
end $$;
create trigger staff_call_records_no_update before update or delete on staff_call_records for each row execute function staff_call_records_append_only();
create trigger staff_call_records_no_truncate before truncate on staff_call_records for each statement execute function staff_call_records_append_only();
alter table staff_call_records enable always trigger staff_call_records_no_update;
alter table staff_call_records enable always trigger staff_call_records_no_truncate;
revoke execute on function staff_call_records_append_only() from public, anon, authenticated;

-- Keeps a call's record. Every billed call has one: a retry of the same cause, duty and Mod is the next attempt (counted under a lock of its own, so two runs at once
-- take two numbers). Returns {recorded, attempt}.
create function record_staff_call(cause_act uuid, duty text, staff text, record jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.call_record.' || record_staff_call.cause_act::text || record_staff_call.duty || record_staff_call.staff, 0));
  select count(*) + 1 into n from staff_call_records r where r.cause_act = record_staff_call.cause_act and r.duty = record_staff_call.duty and r.staff = record_staff_call.staff;
  insert into staff_call_records (cause_act, duty, staff, record, attempt) values (record_staff_call.cause_act, record_staff_call.duty, record_staff_call.staff, record_staff_call.record, n);
  return jsonb_build_object('recorded', true, 'attempt', n);
end $$;
revoke execute on function record_staff_call(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function record_staff_call(uuid, text, text, jsonb) to service_role;

-- ------------------------------------------------------------------------------------------------ the filing run ----

create function filings_due(most integer) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x.j order by x.ends_at, x.visit_act), '[]'::jsonb)
  from (
    select o.ends_at, o.visit_act,
           jsonb_build_object('visit', o.visit_act, 'post', o.post, 'thread', v.thread, 'staff', c.staff, 'ends_at', o.ends_at,
             'board', jsonb_build_object('id', b.id, 'name', b.name, 'premise', b.premise), 'charges', visit_charges(o.visit_act)) as j
    from visits_open o
    join acts v on v.id = o.visit_act
    join characters c on c.id = v.character
    join threads t on t.id = v.thread
    join boards_now b on b.id = t.board
    where o.ends_at <= now() and o.failed_at is null
    order by o.ends_at, o.visit_act
    limit greatest(filings_due.most, 0)
  ) x
$$;

create function mod_standing(staff text) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'office', (select o.office from staff_office_now o where o.staff = mod_standing.staff),
    'allowance', mod_allowance(mod_standing.staff),
    'order', (select x.order_line from staff_orders x where x.staff = mod_standing.staff order by x.id desc limit 1),
    'beat', case when exists (select 1 from staff_now n where n.staff = mod_standing.staff)
      then coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'name', w.name) order by w.name, w.id)
                     from (select b.id, b.name from boards_now b where not b.is_system and beat_of(b.id) = mod_standing.staff order by b.name, b.id limit 50) w), '[]'::jsonb)
      else '[]'::jsonb end)
$$;

create function rules_in_force(board uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('board', r.board, 'number', r.number, 'predicate', r.predicate, 'param', r.param, 'band', r.band) order by r.board nulls first, r.number), '[]'::jsonb)
  from rules_now r where r.board is null or r.board = rules_in_force.board
$$;

create function filing_calls_today() returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::integer from model_calls m where m.duty = 'filing' and m.at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
$$;

revoke execute on function apply_mod_move(text, jsonb, uuid), filings_due(integer), mod_standing(text), rules_in_force(uuid), filing_calls_today() from public, anon, authenticated;
grant execute on function apply_mod_move(text, jsonb, uuid), filings_due(integer), mod_standing(text), rules_in_force(uuid), filing_calls_today() to service_role;

-- ---------------------------------------------------------------------------------------------------- the schedule ----

-- (Re)schedule the filing run at `modBots.filingCron`, as schedule_meeting() (0071) and schedule_chatter() (0089) do: the jobs key in apikey, nothing sent until the
-- Vault holds both its secrets. The body carries the minute the job fired in.
create function schedule_staff() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return cron.schedule('kayfabb-staff', setting('modBots') ->> 'filingCron', $job$
    select net.http_post(
      url := s.base || '/functions/v1/staff',
      headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', s.secret),
      body := jsonb_build_object('slot', date_trunc('minute', now())),
      timeout_milliseconds := 150000
    )
    from (
      select (select decrypted_secret from vault.decrypted_secrets where name = 'kayfabb_functions_url') as base,
             (select decrypted_secret from vault.decrypted_secrets where name = 'kayfabb_jobs_key') as secret
    ) s
    where s.base is not null and s.secret is not null
  $job$);
end $$;

create function settings_reschedule_staff() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform schedule_staff();
  return null;
end $$;
create trigger settings_reschedule_staff after insert or update on settings
  for each row when (new.key = 'modBots') execute function settings_reschedule_staff();
revoke execute on function schedule_staff(), settings_reschedule_staff() from public, anon, authenticated;

select schedule_staff() where exists (select 1 from settings where key = 'modBots');
