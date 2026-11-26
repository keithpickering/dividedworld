-- Lead-ins, aftermath and the new conditions (docs/plans/2026-11-25-arc-announcements-plan.md, Task 2; its design, sections 6, 7 and 8b).
--
-- What it does.
--   persona_arcs        gains `lead_ins` ({beat key: the lead-in's unlock}) and `aftermath` (the beats a successor plays, kept as the arc's are: key, mini, unlock, and a lead-in's unlock; never a brief).
--   seed_instance       writes both from the roster (the beat's `leadIn.unlock`, the persona's `aftermath`), and refuses an aftermath beat or a lead-in that names a condition the catalog lacks.
--   arc_predecessor     (staff, season, seated): the Boss that handed over to `staff` (the latest handover row naming it as the new Boss, at or before the season, that changed the Boss), the season that Boss
--                       served (the same season for a departure, the season before for a roll-over, as say_farewell reads it) and the season the handover seated `staff` in.
--   beat_condition_holds `phase` takes `daysIntoPhase` (days after the phase began); `beatLanded` takes `of: 'predecessor'` (the predecessor's beat in its season, by the same landed rule) and `not: true`
--                       (the negation). For a predecessor's beat the negation also waits for the answer to be settled: a part still waiting to land is neither landed nor not landed, so two aftermath beats that
--                       exclude each other by `not` cannot both unlock while a structural part is held back for its day. With no predecessor either reads false.
--   arc_board, beat_role_board  resolve {role, beat, of: 'predecessor'}; beat_role_board takes the `of` as a fifth argument (default null, so every four-argument call is as it was). A predecessor's board that
--                       has been merged or reversed (board_is_open) is none, not a closed board; an own beat's role is read as it always was.
--   arc_aftermath_cond  rewrites a condition inside an aftermath beat: a `beatLanded` or {role, beat} with no `of` names an earlier aftermath beat of the same list, read under the Boss's own key `after:<pred>:<key>`.
--   arc_pass_for        beside the Boss's own beats, the aftermath beats of its predecessor's persona, recorded under the Boss with key `after:<pred>:<key>` as optional mini-arcs (unlocked once, lapsed with the
--                       season, never due), only in the season the handover seated the Boss in. arc_pass (0333) calls it and is not changed.
--   arc_lead_ins        the keys (an aftermath beat's as its event key) of the beats whose lead-in conditions all hold and that have no event yet; read at call time.
--   arc_for_meeting     adds `leadIns`, and lists unlocked aftermath beats with `aftermath: true` and their `predecessor`.
--   arc_beat_events     its beat key may be `after:<pred>:<key>`, and the guard (0336) knows that key: the persona must have been seated by `<pred>` in that season and `<pred>` must have that aftermath beat.
--
-- Latest definitions copied: seed_instance (0413), beat_condition_holds, arc_season_span's neighbours arc_for_meeting and arc_pass_for (0333), arc_board and beat_role_board (0332), arc_beat_events_guard
-- (0336). Everything each does that is not named here is as written there; security definer, search_path and grants stay (a replaced beat_role_board is dropped and made again with the fifth argument,
-- and given the grants it had).
-- Existing rows: lead_ins and aftermath default empty, so a deployed instance reads exactly as before until its seed runs.
-- Ways out: no state is added. A lead-in has no state of its own and ends with its beat or its season; an aftermath beat lapses at the season's end like an optional beat.
-- Masks: a condition reads public beats, bundles, boards and handover rows; nothing here reads who made a character, a class or who reacted (supabase/tests/0186-arcs.sql greps every definition).

alter table persona_arcs add column lead_ins jsonb not null default '{}' check (jsonb_typeof(lead_ins) = 'object');
alter table persona_arcs add column aftermath jsonb not null default '[]' check (jsonb_typeof(aftermath) = 'array' and jsonb_array_length(aftermath) <= 24);

alter table arc_beat_events drop constraint arc_beat_events_beat_check;
alter table arc_beat_events add constraint arc_beat_events_beat_check
  check (beat ~ '^[a-z][a-z0-9_-]{0,39}$' or beat ~ '^after:[a-z][a-z0-9_-]{0,39}:[a-z][a-z0-9_-]{0,39}$');

-- ------------------------------------------------------------------------------ the predecessor ----

create function arc_predecessor(in_staff text, in_season bigint) returns table (staff text, season bigint, seated bigint)
language sql stable security definer set search_path = public, pg_temp as $$
  select h.outgoing,
         case when h.cause = 'departure' then h.season else (select z.id from seasons z where z.id < h.season order by z.id desc limit 1) end,
         h.season
  from season_handovers h
  where h.boss = in_staff and h.outgoing is not null and h.outgoing <> h.boss and h.how in ('nomination', 'rotation') and h.season <= in_season
  order by h.season desc, h.id desc limit 1
$$;

-- A condition inside an aftermath beat, as the current Boss's own events read it: no `of` names an earlier aftermath beat of the list, recorded under after:<pred>:<key>.
create function arc_aftermath_cond(cond jsonb, pred text) returns jsonb
language plpgsql immutable security definer set search_path = public, pg_temp as $$
declare
  side text;
begin
  if jsonb_typeof(cond) is distinct from 'object' then return cond; end if;
  if cond ->> 'kind' = 'beatLanded' and not cond ? 'of' and jsonb_typeof(cond -> 'beat') = 'string' then
    return cond || jsonb_build_object('beat', 'after:' || pred || ':' || (cond ->> 'beat'));
  end if;
  if cond ->> 'kind' = 'boardActivity' then
    foreach side in array array['board', 'above', 'below'] loop
      if jsonb_typeof(cond -> side) = 'object' and not (cond -> side) ? 'of' and jsonb_typeof(cond -> side -> 'beat') = 'string' then
        cond := jsonb_set(cond, array[side, 'beat'], to_jsonb('after:' || pred || ':' || (cond -> side ->> 'beat')));
      end if;
    end loop;
  end if;
  return cond;
end $$;

-- ------------------------------------------------------------------------------------ the boards ----

drop function beat_role_board(bigint, text, text, text);
create function beat_role_board(in_season bigint, in_staff text, in_beat text, in_role text, in_of text default null) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  who text := in_staff;
  sn bigint := in_season;
  made uuid;
begin
  if in_of is not null then
    if in_of <> 'predecessor' then return null; end if;
    select p.staff, p.season into who, sn from arc_predecessor(in_staff, in_season) p;
    if who is null then return null; end if;
  end if;
  select role_board(e.bundle, in_role) into made from arc_beat_events e
  where e.season = sn and e.staff = who and e.beat = in_beat and e.event = 'played' and e.bundle is not null order by e.id desc limit 1;
  -- The predecessor's board is read only while it stands: merged or reversed, it is none.
  if in_of is not null and made is not null and not board_is_open(made) then return null; end if;
  return made;
end $$;

create or replace function arc_board(in_season bigint, in_staff text, ref jsonb) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select case jsonb_typeof(ref)
    when 'string' then (select b.id from boards b where b.id::text = lower(ref #>> '{}'))
    when 'object' then beat_role_board(in_season, in_staff, ref ->> 'beat', ref ->> 'role', ref ->> 'of')
  end
$$;

-- ----------------------------------------------------------------------------------- conditions ----

create or replace function beat_condition_holds(in_staff text, in_season bigint, cond jsonb) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  kind text;
  sp record;
  s seasons%rowtype;
  days integer;
  side text;
  other jsonb;
  here uuid;
  there uuid;
  n bigint;
  m bigint;
  outcome text;
  begun timestamptz;
  who text;
  sn bigint;
  played boolean;
  bnd uuid;
  landed boolean;
  waiting boolean;
begin
  if jsonb_typeof(cond) is distinct from 'object' then raise exception 'a condition is an object with a kind' using errcode = '22023'; end if;
  kind := cond ->> 'kind';
  case kind
    when 'phase' then
      select * into sp from arc_season_span(in_staff, in_season);
      if not found or not (cond ? 'phase' or cond ? 'daysBeforeEnd') then return false; end if;
      if cond ? 'phase' then
        case cond ->> 'phase'
          when 'honeymoon' then null;
          when 'reign' then if now() < sp.honeymoon_ends then return false; end if;
          when 'meltdown' then if now() < sp.meltdown_starts then return false; end if;
          else raise exception 'a phase is honeymoon, reign or meltdown' using errcode = '22023';
        end case;
        -- Days into the phase: counted from where the phase begins (the season's start, the honeymoon's end, the meltdown's start).
        if cond ? 'daysIntoPhase' then
          begun := case cond ->> 'phase' when 'honeymoon' then sp.starts_at when 'reign' then sp.honeymoon_ends else sp.meltdown_starts end;
          if now() < begun + make_interval(hours => (cond ->> 'daysIntoPhase')::integer * 24) then return false; end if;
        end if;
      elsif cond ? 'daysIntoPhase' then
        return false;
      end if;
      if cond ? 'daysBeforeEnd' and now() < sp.ends_at - make_interval(hours => (cond ->> 'daysBeforeEnd')::integer * 24) then return false; end if;
      return true;
    when 'beatLanded' then
      -- The rule from design question #459: a beat has landed when it has been played, every part of its bundle that was not held or refused has landed, and at least one part has landed.
      -- A part is held (held_at) or refused (refused_at, a refusal at landing; a tick failure without refused_at is retried, so that part is still waiting) and so is left out; a part that
      -- landed counts as landed even if it was reversed later, because it did land (the reversal is an Act beside it); a part still waiting means the beat has not landed yet.
      -- A beat with no bundle has landed once played. Read at the beat's latest play only: a repeatable beat replayed with a bundle that has not landed is not landed because an earlier play's was.
      who := in_staff;
      sn := in_season;
      if cond ? 'of' then
        if cond ->> 'of' is distinct from 'predecessor' then raise exception 'beatLanded reads a beat of the Boss, or of its predecessor' using errcode = '22023'; end if;
        select p.staff, p.season into who, sn from arc_predecessor(in_staff, in_season) p;
        -- No predecessor: nothing landed and nothing did not land.
        if who is null then return false; end if;
      end if;
      select true, l.bundle into played, bnd
      from (select e.bundle from arc_beat_events e where e.season = sn and e.staff = who and e.beat = cond ->> 'beat' and e.event = 'played' order by e.id desc limit 1) l;
      played := coalesce(played, false);
      waiting := played and bnd is not null and exists (select 1 from queued_moves q where q.bundle = bnd and q.landed_act is null and q.held_at is null and q.refused_at is null);
      landed := played and (bnd is null or (exists (select 1 from queued_moves q where q.bundle = bnd and q.landed_act is not null) and not waiting));
      if coalesce((cond ->> 'not')::boolean, false) is not true then return landed; end if;
      -- Not landed. For a predecessor's beat the answer is settled only once no part is still waiting: it is a fact the successor reads once, and a part held for its day will land.
      if cond ? 'of' then return not landed and not waiting; end if;
      return not landed;
    when 'boardActivity' then
      days := (cond ->> 'days')::integer;
      if days is null or days not between 1 and 90 then raise exception 'boardActivity counts posts over 1 to 90 days' using errcode = '22023'; end if;
      side := case when cond ? 'above' and not cond ? 'below' then 'above' when cond ? 'below' and not cond ? 'above' then 'below' end;
      if side is null then return false; end if;
      here := arc_board(in_season, in_staff, cond -> 'board');
      if here is null then return false; end if;
      other := cond -> side;
      if jsonb_typeof(other) = 'number' then
        m := (other #>> '{}')::numeric;
      else
        there := arc_board(in_season, in_staff, other);
        if there is null then return false; end if;
        m := arc_board_posts(there, days);
      end if;
      n := arc_board_posts(here, days);
      return case side when 'above' then n > m else n < m end;
    when 'moveReversed' then
      select * into s from seasons where id = in_season;
      if not found then return false; end if;
      -- An admin ended one of this Boss's moves as reversed, since the season began (and before it ended).
      return exists (
        select 1 from acts e join acts mv on mv.id = e.target_act_id join characters c on c.id = mv.character
        where e.kind = 'move_end' and e.payload ->> 'why' = 'reversed' and e.payload ->> 'by' = 'admin'
          and e.created_at >= s.starts_at and (s.ends_at is null or e.created_at < s.ends_at) and mv.kind = 'move' and c.staff = in_staff);
    when 'demandResolved' then
      outcome := cond ->> 'outcome';
      if outcome not in ('met', 'failed') then raise exception 'a demand is resolved as met or failed' using errcode = '22023'; end if;
      select * into s from seasons where id = in_season;
      if not found then return false; end if;
      -- Met: a move with a demand ended as met. Failed: a move with a demand ran out (expired, or a favor's check came and was not met).
      return exists (
        select 1 from acts e join acts mv on mv.id = e.target_act_id join characters c on c.id = mv.character
        where e.kind = 'move_end' and e.created_at >= s.starts_at and (s.ends_at is null or e.created_at < s.ends_at) and mv.kind = 'move' and c.staff = in_staff
          and jsonb_typeof(mv.payload -> 'demand') = 'object'
          and case outcome when 'met' then e.payload ->> 'why' = 'met' else e.payload ->> 'why' in ('expired', 'unmet') end);
    else
      raise exception 'no check for condition %', coalesce(kind, 'null') using errcode = 'P0001';
  end case;
end $$;

-- ---------------------------------------------------------------------------------- the reads ----

create function arc_lead_ins(in_staff text, in_season bigint) returns text[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  pred text;
  states jsonb;
  b record;
  c record;
  ok boolean;
  keys text[] := '{}';
begin
  if in_staff is null or in_season is null then return keys; end if;
  states := arc_latest_states(in_staff, in_season);
  select p.staff into pred from arc_predecessor(in_staff, in_season) p where p.seated = in_season;
  for b in
    select e.value ->> 'key' as key, a.lead_ins -> (e.value ->> 'key') as unlock, e.ord, false as after
    from persona_arcs a, jsonb_array_elements(a.beats) with ordinality e(value, ord)
    where a.staff = in_staff and jsonb_typeof(a.lead_ins -> (e.value ->> 'key')) = 'array'
    union all
    select 'after:' || pred || ':' || (e.value ->> 'key'), e.value #> '{leadIn,unlock}', 1000 + e.ord, true
    from persona_arcs a, jsonb_array_elements(a.aftermath) with ordinality e(value, ord)
    where pred is not null and a.staff = pred and jsonb_typeof(e.value #> '{leadIn,unlock}') = 'array'
    order by 3
  loop
    -- A lead-in is for a beat with no event yet, and has at least one condition.
    if states ? b.key or jsonb_array_length(b.unlock) = 0 then continue; end if;
    begin
      ok := true;
      for c in select u.value as cond from jsonb_array_elements(b.unlock) u loop
        if not beat_condition_holds(in_staff, in_season, case when b.after then arc_aftermath_cond(c.cond, pred) else c.cond end) then ok := false; exit; end if;
      end loop;
      if ok then keys := keys || b.key; end if;
    exception when others then
      raise warning 'arc_lead_ins: the lead-in of % was not read: % (%)', b.key, sqlerrm, sqlstate;
    end;
  end loop;
  return keys;
end $$;

create or replace function arc_for_meeting(in_staff text, in_season bigint) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with st as (select arc_latest_states(in_staff, in_season) as s),
       pr as (select p.staff from arc_predecessor(in_staff, in_season) p where p.seated = in_season)
  select jsonb_build_object(
    'beats', coalesce((select jsonb_agg(x.j order by x.ord)
                       from (select b.ord, jsonb_build_object('key', b.value ->> 'key', 'mini', coalesce((b.value ->> 'mini')::boolean, false),
                                                              'due', beat_is_due(in_staff, in_season, b.value -> 'due')) as j
                             from persona_arcs a, jsonb_array_elements(a.beats) with ordinality b(value, ord), st
                             where a.staff = in_staff and st.s ->> (b.value ->> 'key') = 'unlocked'
                             union all
                             select 1000 + b.ord, jsonb_build_object('key', b.value ->> 'key', 'mini', coalesce((b.value ->> 'mini')::boolean, true), 'due', false,
                                                                      'aftermath', true, 'predecessor', pr.staff)
                             from pr join persona_arcs a on a.staff = pr.staff, jsonb_array_elements(a.aftermath) with ordinality b(value, ord), st
                             where st.s ->> ('after:' || pr.staff || ':' || (b.value ->> 'key')) = 'unlocked') x), '[]'::jsonb),
    'heldBack', to_jsonb(held_back_kinds(in_staff, in_season)),
    'leadIns', to_jsonb(arc_lead_ins(in_staff, in_season)))
$$;

-- ---------------------------------------------------------------------------------- the pass ----

create or replace function arc_pass_for(in_staff text, in_season bigint, in_closed boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sp record;
  pred text;
  states jsonb;
  b record;
  c record;
  last text;
  ok boolean;
  done boolean := in_closed;
  unlocked integer := 0;
  lapsed integer := 0;
begin
  if in_staff is null or in_season is null then return jsonb_build_object('unlocked', 0, 'lapsed', 0); end if;
  -- The aftermath is the predecessor persona's, and is the Boss's only in the season the handover seated it in.
  select p.staff into pred from arc_predecessor(in_staff, in_season) p where p.seated = in_season;
  -- A persona with no arc and no aftermath to play costs one read of its row, and needs nothing else set.
  if not exists (select 1 from persona_arcs a where a.staff = in_staff and jsonb_array_length(a.beats) > 0)
     and not (pred is not null and exists (select 1 from persona_arcs a where a.staff = pred and jsonb_array_length(a.aftermath) > 0)) then
    return jsonb_build_object('unlocked', 0, 'lapsed', 0);
  end if;
  states := arc_latest_states(in_staff, in_season);
  if in_closed and not (states::text like '%"unlocked"%') then return jsonb_build_object('unlocked', 0, 'lapsed', 0); end if;
  if not in_closed then
    select * into sp from arc_season_span(in_staff, in_season);
    done := found and now() >= sp.ends_at;
  end if;
  for b in
    select e.value as beat, e.value ->> 'key' as key, e.ord, false as after
    from persona_arcs a, jsonb_array_elements(a.beats) with ordinality e(value, ord) where a.staff = in_staff
    union all
    select e.value, 'after:' || pred || ':' || (e.value ->> 'key'), 1000 + e.ord, true
    from persona_arcs a, jsonb_array_elements(a.aftermath) with ordinality e(value, ord) where pred is not null and a.staff = pred
    order by 3
  loop
    begin
      last := states ->> b.key;
      if last = 'lapsed' then continue; end if;
      if done then
        if last = 'unlocked' and (in_closed or jsonb_typeof(b.beat -> 'due') is distinct from 'object') then
          insert into arc_beat_events (season, staff, beat, event) values (in_season, in_staff, b.key, 'lapsed');
          lapsed := lapsed + 1;
        end if;
        continue;
      end if;
      if last is null or (last = 'played' and not b.after and coalesce((b.beat ->> 'repeatable')::boolean, false)) then
        ok := true;
        for c in select u.value as cond from jsonb_array_elements(b.beat -> 'unlock') u loop
          if not beat_condition_holds(in_staff, in_season, case when b.after then arc_aftermath_cond(c.cond, pred) else c.cond end) then ok := false; exit; end if;
        end loop;
        if ok then
          insert into arc_beat_events (season, staff, beat, event) values (in_season, in_staff, b.key, 'unlocked');
          unlocked := unlocked + 1;
        end if;
      end if;
    exception when others then
      raise warning 'arc_pass_for: beat % was not read: % (%)', b.key, sqlerrm, sqlstate;
    end;
  end loop;
  return jsonb_build_object('unlocked', unlocked, 'lapsed', lapsed);
end $$;

-- ---------------------------------------------------------------------------------- the guard ----

-- arc_beat_events_guard (0336), knowing the key after:<pred>:<key>: the aftermath beat of <pred>'s persona, for a Boss that <pred> handed over to in that season. Everything else as 0336 wrote it.
create or replace function arc_beat_events_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  arc jsonb;
  last text;
  pred text;
begin
  if tg_op <> 'INSERT' then raise exception 'a beat''s event is only ever added (%)', tg_op using errcode = 'P0001'; end if;
  -- An import (tools/import-instance.mjs) writes as a replica, table by table in name order, so this table's rows go in before persona_arcs and queued_moves hold
  -- what they name. They are an exported log, each row checked when it was first written; replaying the checks against half an import would refuse a faithful
  -- round trip. Only the live insert is checked against the persona's beats and the beat's last event; the refusals above stay in every mode.
  if current_setting('session_replication_role') = 'replica' then return new; end if;
  if new.beat like 'after:%' then
    select p.staff into pred from arc_predecessor(new.staff, new.season) p where p.seated = new.season and p.staff = split_part(new.beat, ':', 2);
    select b.value into arc from persona_arcs a, jsonb_array_elements(a.aftermath) b(value) where a.staff = pred and b.value ->> 'key' = split_part(new.beat, ':', 3);
  else
    select b.value into arc from persona_arcs a, jsonb_array_elements(a.beats) b(value) where a.staff = new.staff and b.value ->> 'key' = new.beat;
  end if;
  if arc is null then raise exception 'the persona % has no beat %', new.staff, new.beat using errcode = '23514'; end if;
  perform pg_advisory_xact_lock(hashtext('kayfabb.arc_beat'), hashtext(new.season::text || ':' || new.staff || ':' || new.beat));
  select e.event into last from arc_beat_events e where e.season = new.season and e.staff = new.staff and e.beat = new.beat order by e.id desc limit 1;
  if new.event = 'unlocked' then
    if last = 'unlocked' then raise exception 'that beat is already unlocked' using errcode = '23514'; end if;
    if last = 'lapsed' then raise exception 'that beat has lapsed for the season' using errcode = '23514'; end if;
    if last = 'played' and (pred is not null or coalesce((arc ->> 'repeatable')::boolean, false) is not true) then raise exception 'that beat was played and is not repeatable' using errcode = '23514'; end if;
  elsif last is distinct from 'unlocked' then
    raise exception 'a beat is % only once it has unlocked (it is %)', new.event, coalesce(last, 'not unlocked') using errcode = '23514';
  end if;
  if new.bundle is not null and not exists (select 1 from queued_moves q where q.bundle = new.bundle and q.staff = new.staff) then
    raise exception 'that bundle has no part of this persona''s' using errcode = '23514';
  end if;
  return new;
end $$;

revoke execute on function arc_predecessor(text, bigint), arc_aftermath_cond(jsonb, text), beat_role_board(bigint, text, text, text, text), arc_lead_ins(text, bigint) from public, anon, authenticated;
grant execute on function arc_predecessor(text, bigint), arc_aftermath_cond(jsonb, text), beat_role_board(bigint, text, text, text, text), arc_lead_ins(text, bigint) to service_role;

-- ------------------------------------------------------------------------------ seed_instance ----

-- seed_instance (0413_rewind), writing lead_ins and aftermath beside the arc, and checking an aftermath beat's and a lead-in's conditions against the catalog. Everything else as 0413_rewind wrote it. Its grants are as they were (replaced in place).
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
              from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) p,
                   jsonb_array_elements(coalesce(p -> 'arc', '[]') || coalesce(p -> 'aftermath', '[]')) b,
                   jsonb_array_elements(coalesce(b -> 'unlock', '[]') || case when jsonb_typeof(b #> '{leadIn,unlock}') = 'array' then b #> '{leadIn,unlock}' else '[]'::jsonb end) c
              where not exists (select 1 from condition_kinds k where k.key = c ->> 'kind'));
  if unknown is not null then raise exception 'an arc names a condition the catalog lacks: %', unknown using errcode = '23514'; end if;
  delete from persona_arcs where staff in (select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e);
  -- `lead_ins` is {beat key: the lead-in's unlock} of the arc's beats that have one, and `aftermath` the persona's aftermath beats as the arc's are kept (key, mini, unlock, and a lead-in's unlock): never a brief or a mood.
  insert into persona_arcs (staff, beats, holds_back, phase_days, lead_ins, aftermath)
  select e ->> 'key', coalesce(e -> 'arc', '[]'), coalesce(e -> 'holdsBack', '[]'), coalesce(e -> 'phaseDays', '{}'),
         (select coalesce(jsonb_object_agg(b.value ->> 'key', b.value #> '{leadIn,unlock}'), '{}'::jsonb)
          from jsonb_array_elements(coalesce(e -> 'arc', '[]')) b where jsonb_typeof(b.value #> '{leadIn,unlock}') = 'array'),
         (select coalesce(jsonb_agg(jsonb_build_object('key', a.value -> 'key', 'mini', coalesce(a.value -> 'mini', 'true'::jsonb), 'repeatable', false, 'unlock', coalesce(a.value -> 'unlock', '[]'::jsonb))
                                    || case when jsonb_typeof(a.value #> '{leadIn,unlock}') = 'array' then jsonb_build_object('leadIn', jsonb_build_object('unlock', a.value #> '{leadIn,unlock}')) else '{}'::jsonb end
                                    order by a.ord), '[]'::jsonb)
          from jsonb_array_elements(coalesce(e -> 'aftermath', '[]')) with ordinality a(value, ord))
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
