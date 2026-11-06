-- Reports (the Mod Bots design, section 7 and "What could slip a mask"; its plan, Task 8).
--
-- A report is a character's public Act on someone's post: `report` (by the reporter, on the post: its reason, at most 280 characters). The Mod on the board's beat
-- hears it at once and answers with a `report_verdict` (by the Mod, on the report): `visit` (a visit to the post, with a charge), `dismissed` (the Aura is spent and
-- the Mod grumbles in public) or `backfire` (a visit to the reporter's latest post, for wasting the staff's time). Neither takes a seq in its thread.
--
--   open_report(through, post, reason)   the player's door. It verifies the caller plays `through` (acting) and that the character is not banned (not_banned), so the
--                                        Edge Function around it can be bypassed to no effect. In this order: acting, not_banned, THEN the reason, The System on, the post (a player's
--                                        post), a Mod on the board's beat, THEN the instance's daily judgment budget (`modBots.judgmentsPerDay`, one instance-wide count: the
--                                        day's billed judgments plus every report paid and still in flight, and the same refusal in the same words whoever asks), then the
--                                        character's quota (`reportsPerDay`: per CHARACTER, never per account; a report refunded for a failed judgment is not counted, one
--                                        swept for never being judged is), THEN the price (`reportPrice`, wallet_spend, kind 'report'), and
--                                        the `report` Act. A report across one's own masks is allowed: no refusal depends on who owns the post.
--   close_report(report, verdict, line, charge, staff)   the service's: writes the verdict by the Mod and, for a visit or a backfire, starts the visit (start_visit; the
--                                        backfire's cause is 'backfire'). Once: a report already closed returns its verdict and writes nothing, and a report refunded is not
--                                        closed. The charge is repaired here as in the engine: a charge naming no rule in force on the board (nor a house rule, when it
--                                        says `house`) becomes the board's premise at the minor band; a rule's charge takes the rule's own band. A backfire's charge is
--                                        always minor. A reporter with no post gets no visit: the verdict still lands, with no visit_act.
--   refund_report(report)                the service's: the price back to the account that paid, once (`report_refunds` holds the one), and nothing else is written, so
--                                        the report can be made again. Refused once the report has a verdict.
--   refund_stale_reports(minutes)        refunds each report older than that with no verdict and no refund (a judgment that never came back), so a player is never left
--                                        out of pocket: the staff run calls it every time it runs.
--   judgment_calls_today()               the instance's billed judgment calls today (UTC): reportJudge, patrolJudge and appeal rows of the ledger.
--
-- `visit` charges gain the cause 'backfire' (acts_visit_guard and start_visit, each as 0103 wrote it with that one word added), write_staff_act also writes a verdict,
-- and wallet_events gain the kinds 'report' and 'refund'.
--
-- Masks. Nothing here reads who owns a character except the caller check and the wallet the report is paid from. The budget is one count, the quota one character's,
-- the verdict and the visit are public Acts, and the answer open_report gives names the reporter's own public name. close_report and refund_report read no owner: the
-- refund finds the account in the wallet event that took the price.
--
-- Ways out. A report whose judgment fails is refunded and can be made again; a report whose function died is refunded by refund_stale_reports; a dismissed report has
-- spent its Aura on purpose (the Mod's grumble is the game); the visit a report draws has every way out a visit has. Concurrency: a report's decisions are made under an
-- advisory lock of its own (close and refund take the same one, so a report is closed once or refunded once, never both), and opening takes one instance-wide lock for
-- its checks, so the quota and the budget are not read twice at once. The budget's bound: a report counts from the moment it is paid (judgment_load_today), under that lock,
-- so reports never take the day past `judgmentsPerDay` by themselves, and an unjudged report holds its room for at most 150 seconds (report_in_flight_window), never until the sweep; the other judgments (patrols, appeals) are counted by the ledger once billed and are not under this
-- lock, so a day can pass the budget by the number of those in flight at the same instant, and by no more.

-- ------------------------------------------------------------------------------------------------------ the Acts ----

alter table acts drop constraint acts_kind_check;
alter table acts add constraint acts_kind_check check (kind in ('post', 'spin', 'card', 'edit', 'tally', 'reveal', 'unmask', 'move', 'move_end', 'move_keep', 'set', 'spring', 'update', 'card_end', 'describe', 'infraction', 'ban',
  'visit', 'visit_join', 'visit_end', 'report', 'report_verdict'));

alter table acts drop constraint acts_seq_check;
alter table acts add constraint acts_seq_check check ((kind = 'edit') = (seq is null) or kind in ('card', 'set', 'spring', 'card_end', 'describe', 'infraction', 'ban', 'visit', 'visit_join', 'visit_end', 'report', 'report_verdict'));

alter table acts add constraint acts_report_payload check (
  case kind
    when 'report' then payload - 'reason' = '{}'::jsonb
      and jsonb_typeof(payload -> 'reason') = 'string' and char_length(payload ->> 'reason') between 1 and 280
    when 'report_verdict' then payload - 'report_act' - 'verdict' - 'line' - 'visit_act' = '{}'::jsonb
      and jsonb_typeof(payload -> 'report_act') = 'string' and payload ->> 'report_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and payload ->> 'verdict' in ('visit', 'dismissed', 'backfire')
      and jsonb_typeof(payload -> 'line') = 'string' and char_length(payload ->> 'line') <= 280
      and (not payload ? 'visit_act' or (jsonb_typeof(payload -> 'visit_act') = 'string' and payload ->> 'visit_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
    else true
  end is true);

-- One verdict per report; a character's reports of the day are found by the character, the day's by the time.
create unique index acts_one_report_verdict on acts (target_act_id) where kind = 'report_verdict';
create index acts_reports_by_character on acts (character, created_at) where kind = 'report';
create index acts_reports_by_time on acts (created_at) where kind = 'report';

-- acts_take_seq (0103), also leaving a report and its verdict out of their thread's seq; everything else as 0103 wrote it.
create or replace function acts_take_seq() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind in ('edit', 'card', 'set', 'spring', 'card_end', 'describe', 'infraction', 'ban', 'visit', 'visit_join', 'visit_end', 'report', 'report_verdict') then
    new.seq := null;
  else
    -- On the right of an assignment a column is its old value: a post that takes a seq above 1 is a reply.
    update threads set next_seq = next_seq + 1, last_at = greatest(last_at, new.created_at),
                       replies = replies + case when new.kind = 'post' and next_seq > 1 then 1 else 0 end
     where id = new.thread returning next_seq - 1 into new.seq;
  end if;
  return new;
end $$;

-- A report is a player's character's Act on a player's post in the post's thread, written only by open_report; a verdict is a staff character's Act on a report in
-- its thread.
create function acts_report_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t acts%rowtype;
begin
  select * into t from acts where id = new.target_act_id;
  if new.kind = 'report' then
    if coalesce(current_setting('kayfabb.report_writer', true), '') <> 'on' then
      raise exception 'a report is made only through open_report' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    if new.character is null or exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
      raise exception 'a report is a player''s character''s Act' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    if t.kind is distinct from 'post' and t.kind is distinct from 'spin' or t.thread is distinct from new.thread or exists (select 1 from characters c where c.id = t.character and c.staff is not null) then
      raise exception 'a report is of a player''s post, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
  else
    if new.character is null or not exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
      raise exception 'a report_verdict is a staff character''s Act' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    if t.kind is distinct from 'report' or t.thread <> new.thread or new.payload ->> 'report_act' <> t.id::text then
      raise exception 'a report_verdict is of a report, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke execute on function acts_report_guard() from public, anon, authenticated;
create trigger acts_report_guard before insert on acts for each row when (new.kind in ('report', 'report_verdict')) execute function acts_report_guard();

-- ------------------------------------------------------------------------------------- 0103's functions, re-made ----

-- acts_visit_guard (0103), a charge's cause also 'backfire'. Everything else as 0103 wrote it.
create or replace function acts_visit_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  charge jsonb;
  t acts%rowtype;
begin
  if new.kind = 'visit_end' then
    if coalesce(current_setting('kayfabb.visit_writer', true), '') <> 'on' then
      raise exception 'a visit ends only through end_visit' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
  elsif not exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a % is a staff character''s Act', new.kind using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  select * into t from acts where id = new.target_act_id;
  if new.kind = 'visit' then
    if t.kind not in ('post', 'spin') or t.thread <> new.thread or exists (select 1 from characters c where c.id = t.character and c.staff is not null) then
      raise exception 'a visit is of a player''s post, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
    perform (new.payload ->> 'ends_at')::timestamptz;
  elsif new.kind = 'visit_join' then
    -- The open row is taken for update, so a join cannot commit after the end that is being written (end_visit takes the same row): it waits, then finds none.
    if t.kind is distinct from 'visit' or t.thread <> new.thread or not exists (select 1 from visits_open o where o.visit_act = t.id for update) then
      raise exception 'a visit_join is of an open visit, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
  else
    if t.kind is distinct from 'visit' or t.thread <> new.thread or new.payload ->> 'visit_act' <> t.id::text then
      raise exception 'a visit_end is of a visit, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
  end if;
  -- A charge: the rule it names (null where none: Obstruction, a premise), the board, a band, what drew it and the post it is about.
  for charge in select c from jsonb_array_elements(case new.kind when 'visit' then new.payload -> 'charges' when 'visit_join' then jsonb_build_array(new.payload -> 'charge') else '[]'::jsonb end) c loop
    if jsonb_typeof(charge) is distinct from 'object' or charge ->> 'band' is null or charge ->> 'band' not in ('minor', 'moderate', 'severe')
       or charge ->> 'cause' is null or charge ->> 'cause' not in ('rule', 'report', 'patrol', 'tail', 'backfire')
       or jsonb_typeof(charge -> 'rule_number') not in ('number', 'null') or (jsonb_typeof(charge -> 'board') is distinct from 'string')
       or jsonb_typeof(charge -> 'about_act') is distinct from 'string' then
      raise exception 'a charge names its rule number (or null), board, band, cause and the post it is about: %', charge using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
  end loop;
  return new;
end $$;

-- start_visit (0103), a charge's cause also 'backfire'. Everything else as 0103 wrote it.
create or replace function start_visit(post_act uuid, staff text, charge jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p record;
  ch jsonb;
  open_visit uuid;
  held jsonb;
  top text;
  same boolean;
  ends timestamptz;
  written uuid;
  joined uuid;
  sprung jsonb;
begin
  select a.id, a.thread, t.board, c.staff is not null as by_staff into p
  from acts a join threads t on t.id = a.thread join characters c on c.id = a.character where a.id = post_act and a.kind in ('post', 'spin');
  if not found then raise exception 'there is no such post to visit' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if p.by_staff then return null; end if;
  if jsonb_typeof(charge) is distinct from 'object' or charge ->> 'band' is null or charge ->> 'band' not in ('minor', 'moderate', 'severe') or charge ->> 'cause' is null or charge ->> 'cause' not in ('rule', 'report', 'patrol', 'tail', 'backfire') then
    raise exception 'a charge names its band and its cause' using errcode = '22023';
  end if;
  ch := jsonb_strip_nulls(jsonb_build_object('predicate', charge -> 'predicate', 'rule', charge -> 'rule')) || jsonb_build_object(
    'rule_number', coalesce(charge -> 'rule_number', 'null'::jsonb), 'board', coalesce(charge ->> 'board', p.board::text), 'band', charge ->> 'band', 'cause', charge ->> 'cause',
    'about_act', coalesce(charge ->> 'about_act', post_act::text));
  -- One decision per post at a time: two charges drawn at once meet here, and the second joins.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.visit:' || post_act::text, 0));
  -- The open row is taken for update: a filing (or any end) holding it makes this wait, and then it finds the visit gone and decides afresh, never joining a visit that
  -- has ended.
  select o.visit_act into open_visit from visits_open o where o.post = post_act for update;
  same := visit_charge_repeats(post_act, ch);
  if same then
    return case when open_visit is not null then jsonb_build_object('visit', open_visit, 'joined', false) else jsonb_build_object('visit', null, 'repeat', true) end;
  end if;
  if open_visit is not null then
    -- A second charge joins; the band the visit holds is the highest of its charges.
    held := visit_charges(open_visit);
    top := (select c ->> 'band' from jsonb_array_elements(held || jsonb_build_array(ch)) c
            order by case c ->> 'band' when 'severe' then 3 when 'moderate' then 2 else 1 end desc limit 1);
    joined := (write_staff_act(staff, 'visit_join', p.thread, open_visit, jsonb_build_object('charge', ch, 'band', top)) ->> 'id')::uuid;
    return jsonb_build_object('visit', open_visit, 'joined', true, 'join', joined);
  end if;
  ends := now() + visit_window(post_act, staff);
  written := (write_staff_act(staff, 'visit', p.thread, post_act, jsonb_build_object(
    'charges', jsonb_build_array(ch), 'ends_at', ends, 'challenge', visit_challenge(post_act, staff), 'line', visit_line('visitArrived', staff, jsonb_build_array(ch)))) ->> 'id')::uuid;
  -- A trap set on the post springs when a visit starts on it (Task 9 wires the trigger and removes this check).
  if visit_traps_wired() then sprung := spring_traps('visit', post_act, written); end if;
  return jsonb_build_object('visit', written, 'joined', false, 'ends_at', ends) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;
revoke execute on function start_visit(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function start_visit(uuid, text, jsonb) to service_role;

-- write_staff_act (0103), also writing a report's verdict. Everything else as 0103 wrote it.
create or replace function write_staff_act(staff_key text, kind text, thread uuid, target uuid, payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  whose text;
  written uuid;
  held text;
begin
  select c.id, c.staff_kind into who, whose from characters c where c.staff = staff_key;
  if whose = 'developer' then
    raise exception 'the developer speaks only through post_update, by an admin' using errcode = '42501';
  end if;
  if kind is null or kind not in ('post', 'spin', 'card', 'edit', 'move', 'move_keep', 'visit', 'visit_join', 'report_verdict') then
    raise exception 'a staff character posts, spins, plays a card, edits, moves, keeps a move, visits or gives a report''s verdict, not %', coalesce(kind, 'nothing') using errcode = '22023';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'an Act''s payload is an object' using errcode = '22023'; end if;
  if who is null then raise exception 'there is no staff member "%"', staff_key using errcode = 'P0002'; end if;
  -- A persona that has not debuted writes nothing, and a benched one is silent (0082).
  select o.office into held from staff_office_now o where o.staff = staff_key;
  if held in ('waiting', 'benched') then
    raise exception 'a % persona writes nothing', held using errcode = '55000';
  end if;
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (who, kind, thread, target, payload) returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  return act_projection(written);
end $$;


-- --------------------------------------------------------------------------------------------------------- the money ----

alter table wallet_events drop constraint wallet_events_kind_check;
alter table wallet_events add constraint wallet_events_kind_check check (kind in ('settlement', 'purchase', 'play', 'trap', 'trapSystem', 'report', 'refund'));

-- A report whose price went back. Written once per report and never changed (a report is refunded once, and a free report has a row too, so "refunded" is a fact about the
-- report whatever it cost). No client reads it.
create table report_refunds (
  report_act uuid primary key references acts (id),
  amount integer not null check (amount >= 0),
  -- Why: 'failed' (the judgment failed, so the player may report again) or 'stale' (the report was never judged; it still counts toward the character's quota, so a direct
  -- open_report cannot make free public reports without end).
  why text not null default 'failed' check (why in ('failed', 'stale')),
  at timestamptz not null default now()
);
alter table report_refunds enable row level security;
revoke all on report_refunds from public, anon, authenticated;
create function report_refunds_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a refund is never edited or removed (%)', tg_op using errcode = 'P0001';
end $$;
create trigger report_refunds_no_update before update or delete on report_refunds for each row execute function report_refunds_append_only();
create trigger report_refunds_no_truncate before truncate on report_refunds for each statement execute function report_refunds_append_only();
alter table report_refunds enable always trigger report_refunds_no_update;
alter table report_refunds enable always trigger report_refunds_no_truncate;
revoke execute on function report_refunds_append_only() from public, anon, authenticated;

-- ----------------------------------------------------------------------------------------------------- the budget ----

-- The instance's billed judgments today (UTC): the Mods' report, patrol and appeal calls in the ledger. One count for the instance, read the same by everyone.
create function judgment_calls_today() returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::integer from model_calls m
  where m.duty in ('reportJudge', 'patrolJudge', 'appeal') and m.at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
$$;
revoke execute on function judgment_calls_today() from public, anon, authenticated;
grant execute on function judgment_calls_today() to service_role;

-- What the budget is counted against: the ledger's judgments, plus every report paid within the window (below) that is still in flight (no verdict, no refund, and no billed
-- call of its own yet: once its call is billed the ledger counts it). So a burst of reports cannot all pass a check made before any of them is judged.
-- A report counts only while a judgment could still be running for it: it was paid within the staff function's limit (150 seconds, the `timeout_milliseconds` of the
-- schedule and the platform's own cap). An older one with no verdict was never judged (a client called open_report and went no further, or the function died), so it holds
-- no room while it waits to be swept; the sweep and the quota do not read this window.
create function report_in_flight_window() returns interval
language sql immutable set search_path = public, pg_temp as $$ select interval '150 seconds' $$;
revoke execute on function report_in_flight_window() from public, anon, authenticated;

create function judgment_load_today() returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select judgment_calls_today() + (
    select count(*)::integer from acts r
    where r.kind = 'report' and r.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
      and r.created_at > now() - report_in_flight_window()
      and not exists (select 1 from acts v where v.kind = 'report_verdict' and v.target_act_id = r.id)
      and not exists (select 1 from report_refunds f where f.report_act = r.id)
      and not exists (select 1 from staff_call_records c where c.cause_act = r.id and c.duty = 'reportJudge'))
$$;
revoke execute on function judgment_load_today() from public, anon, authenticated;
grant execute on function judgment_load_today() to service_role;

-- A Mod's line on a report from the instance's stock lines (`reportDismissed`, `reportBackfired`): {mod} is the Mod's name and {reporter} the reporter's. Where the
-- instance gave none the plain default says the same.
create function report_line(line_key text, staff text, reporter text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  lines jsonb;
  mod_name text := coalesce((select c.name from characters c where c.staff = report_line.staff), '');
begin
  select s.value -> line_key into lines from settings s where s.key = 'systemLines';
  if jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0 and jsonb_typeof(lines -> 0) = 'string' then
    return left(fill_tokens(lines ->> floor(random() * jsonb_array_length(lines))::integer, jsonb_build_object('mod', mod_name, 'reporter', reporter)), 280);
  end if;
  return case line_key
    when 'reportDismissed' then mod_name || ' read ' || reporter || '''s report and dismissed it.'
    else mod_name || ' read ' || reporter || '''s report and has some thoughts about ' || reporter || '.' end;
end $$;
revoke execute on function report_line(text, text, text) from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------------ open_report ----

create function open_report(through uuid, post uuid, reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid;
  p record;
  bots jsonb := coalesce((select s.value from settings s where s.key = 'modBots'), '{}'::jsonb);
  price integer := coalesce((bots ->> 'reportPrice')::integer, 25);
  per_day integer := coalesce((bots ->> 'reportsPerDay')::integer, 3);
  budget integer := coalesce((bots ->> 'judgmentsPerDay')::integer, 60);
  day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  said text := btrim(coalesce(reason, ''));
  mod_key text;
  rid uuid;
  board record;
  me text;
begin
  caller := acting(through);
  perform not_banned(through);
  if regexp_replace(said, '[\s ​-‍⁠　﻿]', '', 'g') = '' then
    raise exception 'say why you are reporting this post' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if char_length(said) > 280 then
    raise exception 'a reason is at most 280 characters' using hint = 'kayfabb.refusal', errcode = '22001';
  end if;
  if not coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'systemEnabled'), false) then
    raise exception 'there is no one on duty to hear a report right now' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  select a.id, a.thread, t.board, c.staff is not null as by_staff into p
  from acts a join threads t on t.id = a.thread join characters c on c.id = a.character where a.id = open_report.post and a.kind in ('post', 'spin');
  if not found then raise exception 'there is no such post to report' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if p.by_staff then raise exception 'a post by The System is not reported' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  mod_key := beat_of(p.board);
  if mod_key is null then raise exception 'there is no one on duty to hear a report right now' using hint = 'kayfabb.refusal', errcode = '55000'; end if;

  -- The checks and the write are one decision: one lock for the instance, taken before the count of the day is read.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.reports', 0));
  -- The instance's budget first, and before anything is paid: one count (the ledger's judgments and the reports in flight), and the same words for everyone.
  if judgment_load_today() >= budget then
    raise exception 'the Mods have heard all the reports they will today; reports open again after midnight UTC' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  -- This character's quota, and only this character's: a report refunded for a failed judgment is not one of the day's (the player may report again); one swept for
  -- never being judged is.
  if (select count(*) from acts r where r.kind = 'report' and r.character = open_report.through and r.created_at >= day_start
        and not exists (select 1 from report_refunds f where f.report_act = r.id and f.why = 'failed')) >= per_day then
    raise exception 'this character has made its % reports for today', per_day using hint = 'kayfabb.refusal', errcode = '55000';
  end if;

  perform set_config('kayfabb.report_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'report', p.thread, open_report.post, jsonb_build_object('reason', said)) returning id into rid;
  perform set_config('kayfabb.report_writer', '', true);
  perform wallet_spend(caller, price, 'report', rid);

  select b.id, b.name, b.premise into board from boards_now b where b.id = p.board;
  select c.name into me from characters c where c.id = through;
  return jsonb_build_object('report', rid, 'post', open_report.post, 'thread', p.thread, 'staff', mod_key, 'price', price, 'reason', said,
    'board', jsonb_build_object('id', board.id, 'name', board.name, 'premise', board.premise),
    'reporter', jsonb_build_object('id', through, 'name', me));
end $$;
revoke execute on function open_report(uuid, uuid, text) from public, anon;
grant execute on function open_report(uuid, uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------------------------------- close_report ----

-- A visit verdict's charge: a rule in force takes the rule's own band; a premise charge the Mod meant keeps the Mod's band (The System may be harsh: it is a fixed list of
-- choices with a visit's own ways out); a charge naming no rule in force on the board cannot be repaired without inventing one, so it becomes the premise at the minor band.
create function close_report(report_act uuid, verdict text, line text default null, charge jsonb default null, staff text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r acts%rowtype;
  v acts%rowtype;
  thr_board uuid;
  board record;
  mod_key text;
  reporter text;
  said text := left(btrim(coalesce(close_report.line, '')), 280);
  rn integer;
  house boolean;
  rule_row rules_now%rowtype;
  ch jsonb;
  band text;
  words text;
  started jsonb;
  target uuid;
  payload jsonb;
  written uuid;
  repaired boolean := false;
begin
  select * into r from acts a where a.id = close_report.report_act and a.kind = 'report';
  if not found then raise exception 'there is no such report' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The report's own lock: closing and refunding it are one decision, so it is closed once, or refunded once, never both.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.report.' || r.id::text, 0));
  if exists (select 1 from report_refunds f where f.report_act = r.id) then
    return jsonb_build_object('closed', false, 'refunded', true);
  end if;
  select * into v from acts a where a.kind = 'report_verdict' and a.target_act_id = r.id;
  if found then
    return jsonb_build_object('closed', false, 'existing', true, 'verdict_act', v.id, 'verdict', v.payload ->> 'verdict') ||
      case when v.payload ? 'visit_act' then jsonb_build_object('visit', v.payload -> 'visit_act') else '{}'::jsonb end;
  end if;
  if close_report.verdict is null or close_report.verdict not in ('visit', 'dismissed', 'backfire') then
    raise exception 'a report is answered with a visit, a dismissal or a backfire, not %', coalesce(close_report.verdict, 'nothing') using errcode = '22023';
  end if;
  select t.board into thr_board from threads t where t.id = r.thread;
  select b.id, b.name, b.premise into board from boards_now b where b.id = thr_board;
  mod_key := case when close_report.staff is not null and exists (select 1 from staff_now n where n.staff = close_report.staff) then close_report.staff else beat_of(board.id) end;
  if mod_key is null then raise exception 'no Mod is on staff to answer a report' using errcode = '55000'; end if;
  reporter := (select c.name from characters c where c.id = r.character);

  if close_report.verdict = 'visit' then
    -- The charge, repaired: a rule in force on the board (or a house rule, when it says so) with the rule's own band, else the board's premise at the minor band.
    if jsonb_typeof(close_report.charge) = 'object' then
      if jsonb_typeof(close_report.charge -> 'rule_number') = 'number' and (close_report.charge ->> 'rule_number')::numeric = trunc((close_report.charge ->> 'rule_number')::numeric)
         and (close_report.charge ->> 'rule_number')::numeric between 1 and 100000 then
        rn := (close_report.charge ->> 'rule_number')::integer;
      end if;
      house := coalesce(close_report.charge -> 'house' = 'true'::jsonb, false);
      band := close_report.charge ->> 'band';
    end if;
    if rn is not null then
      select * into rule_row from rules_now x where x.number = rn and case when house then x.board is null else x.board = board.id end limit 1;
    end if;
    if rule_row.move_act is not null then
      select 'Rule ' || rule_row.number || ': ' || fill_tokens(x.plain, jsonb_build_object('param', coalesce(rule_row.param #>> '{}', ''))) into words from rule_predicates x where x.key = rule_row.predicate;
      if rule_row.board is null then words := 'House ' || words; end if;
      ch := jsonb_build_object('rule_number', rule_row.number, 'board', board.id, 'band', rule_row.band, 'cause', 'report', 'about_act', r.target_act_id, 'predicate', rule_row.predicate, 'rule', words);
    else
      if rn is not null or band is null or band not in ('minor', 'moderate', 'severe') then band := 'minor'; repaired := rn is not null; end if;
      ch := jsonb_build_object('rule_number', null, 'board', board.id, 'band', band, 'cause', 'report', 'about_act', r.target_act_id, 'rule', 'the premise of ' || board.name);
    end if;
    started := start_visit(r.target_act_id, mod_key, ch);
    said := coalesce(nullif(said, ''), visit_line('visitArrived', mod_key, jsonb_build_array(ch)));
  elsif close_report.verdict = 'dismissed' then
    said := coalesce(nullif(said, ''), report_line('reportDismissed', mod_key, reporter));
  else
    -- The reporter's latest post, charged minor with wasting the staff's time. A reporter with no post has nothing to visit: the verdict still lands.
    select a.id into target from acts a where a.character = r.character and a.kind in ('post', 'spin') order by a.created_at desc, a.id desc limit 1;
    if target is not null then
      started := start_visit(target, mod_key, jsonb_build_object('rule_number', null, 'board', (select t.board from threads t join acts a on a.thread = t.id where a.id = target), 'band', 'minor',
        'cause', 'backfire', 'about_act', target, 'rule', 'wasting the staff''s time'));
    end if;
    said := coalesce(nullif(said, ''), report_line('reportBackfired', mod_key, reporter));
  end if;

  payload := jsonb_build_object('report_act', r.id, 'verdict', close_report.verdict, 'line', said);
  if started is not null and started ->> 'visit' is not null then payload := payload || jsonb_build_object('visit_act', started ->> 'visit'); end if;
  written := (write_staff_act(mod_key, 'report_verdict', r.thread, r.id, payload) ->> 'id')::uuid;
  return jsonb_build_object('closed', true, 'verdict_act', written, 'verdict', close_report.verdict, 'staff', mod_key, 'line', said, 'charge_repaired', repaired)
    || case when started is not null then jsonb_build_object('visit', started ->> 'visit', 'started', started) else '{}'::jsonb end;
end $$;
revoke execute on function close_report(uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function close_report(uuid, text, text, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------------------------------- refund_report ----

create function refund_report(report_act uuid, why text default 'failed') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r acts%rowtype;
  paid record;
  amount integer;
begin
  select * into r from acts a where a.id = refund_report.report_act and a.kind = 'report';
  if not found then raise exception 'there is no such report' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.report.' || r.id::text, 0));
  if exists (select 1 from acts a where a.kind = 'report_verdict' and a.target_act_id = r.id) then
    return jsonb_build_object('refunded', false, 'closed', true);
  end if;
  if exists (select 1 from report_refunds f where f.report_act = r.id) then
    return jsonb_build_object('refunded', false, 'already', true);
  end if;
  select w.account, -w.change as price into paid from wallet_events w where w.kind = 'report' and w.ref = r.id;
  amount := coalesce(paid.price, 0);
  insert into report_refunds (report_act, amount, why) values (r.id, amount, coalesce(refund_report.why, 'failed'));
  if amount > 0 then perform wallet_move(paid.account, amount, 'refund', null, r.id); end if;
  return jsonb_build_object('refunded', true, 'amount', amount);
end $$;
revoke execute on function refund_report(uuid, text) from public, anon, authenticated;
grant execute on function refund_report(uuid, text) to service_role;

-- Reports whose judgment never came back (the function died between the payment and the answer, or a client called open_report and went no further): refunded, oldest
-- first, at most `most` at a time. Read by the report index on the day's reports; a report that already has a verdict or a refund is skipped.
create function refund_stale_reports(minutes integer default 10, most integer default 100) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  stale uuid;
  n integer := 0;
begin
  for stale in
    select r.id from acts r
    where r.kind = 'report' and r.created_at < now() - make_interval(mins => greatest(refund_stale_reports.minutes, 1))
      and r.created_at >= now() - interval '3 days'
      and not exists (select 1 from acts v where v.kind = 'report_verdict' and v.target_act_id = r.id)
      and not exists (select 1 from report_refunds f where f.report_act = r.id)
    order by r.created_at, r.id limit greatest(refund_stale_reports.most, 0)
  loop
    if (refund_report(stale, 'stale') ->> 'refunded')::boolean then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function refund_stale_reports(integer, integer) from public, anon, authenticated;
grant execute on function refund_stale_reports(integer, integer) to service_role;
