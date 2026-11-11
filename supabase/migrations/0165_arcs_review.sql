-- Arcs, after review (supabase/migrations/0164_arcs.sql; docs/plans/2026-11-06-fangame-split-plan.md, Task 5): the lapses at a season's close, the reads the meeting makes, and three small fixes.
--
--   arc_pass            (0164) also reads the most recently closed season, for its Boss, and lapses what was still unlocked there. Why in the pass and not in reveal_season: the close is a long
--                       function that runs once, and a lapse written there is lost if the pass does not run at that instant (The System off, a failure); the pass runs every minute and finds the
--                       state as it is, so it catches up, and reveal_season (0099) stays as it is. Only the most recent closed season is read: a season that closed before it has had its pass, and
--                       the read is one persona's events in one season, the same cost whatever the history. In a closed season every beat still unlocked lapses, due beats too: a due beat is played
--                       with its defaults at the next meeting, and if no meeting came it lapses with the rest. In the open season, once its planned end has passed, only the optional beats lapse
--                       (a meeting may still come before the close).
--   arc_pass_for        the work of one persona in one season, open or closed.
--   arc_latest_states   {beat: latest event} for a persona in a season: the one definition of a beat's state, read by the pass and by the meeting.
--   beat_is_due         whether a due point has passed (see below).
--   held_back_kinds     the kinds a persona holds back in a season: those whose `until` beat has no event yet (the beat has not unlocked), in the persona's order.
--   arc_for_meeting     what the meeting reads (Task 6 calls this with the Boss and the open season): {"beats": [{"key", "mini", "due"}], "heldBack": [kind]}, the beats unlocked and not yet played
--                       in the persona's order, `due` meaning the beat has a due point and it has passed (the meeting says "must be played at this meeting"), and the kinds held back.
--   arc_season_span     (0164) guards a persona's phase day that is null, no number or a fraction, and cuts one to the engine's caps as phaseAt does (1 to 42 days, PHASE_CAPS): a day that is no number
--                       is the instance's. seed.ts makes the same cut before it seeds, so the two agree.
--   beat_condition_holds (0164) reads `beatLanded` at the beat's latest play only.
--
-- A PHASE HAS BEGUN. The `phase` condition is true once the phase has begun, and stays true: the honeymoon has begun from the season's first instant, the reign once the honeymoon is over, the
-- meltdown once its last days have come. `daysBeforeEnd` is true once the season is within that many days of its end. Both named, both must hold. A due point's `phase` is read the same way: it is
-- past once the phase has begun (plus `daysIntoPhase` days), or once the season is within `daysBeforeEnd` days of its end; where a due point names both, either one passing makes it past.
--
-- A persona removed from the roster leaves its `persona_arcs` row and its events behind: harmless, because the pass reads only the current Boss's row and the beats that row names, and the
-- events are insert-only history.
--
-- Cost. Nothing here grows with the Acts an instance holds: each read is one persona's beats (at most 24) and one season's events of that persona, by arc_beat_events_latest.

-- ------------------------------------------------------------------------------ the span ----

-- arc_season_span (0164) with a persona's phase day guarded: a number is made whole and held to 1 to 42 days (PHASE_CAPS, as phaseAt holds it); anything else is the instance's.
create or replace function arc_season_span(in_staff text, in_season bigint)
returns table (starts_at timestamptz, ends_at timestamptz, honeymoon_ends timestamptz, meltdown_starts timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s seasons%rowtype;
  h integer;
  m integer;
  own jsonb;
begin
  select * into s from seasons where id = in_season;
  if not found then return; end if;
  select a.phase_days into own from persona_arcs a where a.staff = in_staff;
  h := case when jsonb_typeof(own -> 'honeymoon') = 'number' then least(greatest(floor((own ->> 'honeymoon')::numeric), 1), 42)::integer else (setting('phases') #>> '{honeymoon,days}')::integer end;
  m := case when jsonb_typeof(own -> 'meltdown') = 'number' then least(greatest(floor((own ->> 'meltdown')::numeric), 1), 42)::integer else (setting('phases') #>> '{meltdown,days}')::integer end;
  starts_at := s.starts_at;
  ends_at := coalesce(s.ends_at, s.starts_at + span_interval(setting('seasonLength')));
  honeymoon_ends := s.starts_at + make_interval(hours => h * 24);
  meltdown_starts := greatest(honeymoon_ends, ends_at - make_interval(hours => m * 24));
  return next;
end $$;

-- ------------------------------------------------------------------------------ beatLanded ----

-- beat_condition_holds (0164), `beatLanded` read at the beat's latest play. Everything else as 0164 wrote it.
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
      end if;
      if cond ? 'daysBeforeEnd' and now() < sp.ends_at - make_interval(hours => (cond ->> 'daysBeforeEnd')::integer * 24) then return false; end if;
      return true;
    when 'beatLanded' then
      -- Played, and its bundle (if it has one) landed in full: every part, so a part an admin held or that was refused leaves the beat unlanded.
      -- Read at the beat's latest play only: a repeatable beat replayed with a bundle that waits is not landed because an earlier play's bundle was.
      return exists (
        select 1 from (select e.bundle from arc_beat_events e
                       where e.season = in_season and e.staff = in_staff and e.beat = cond ->> 'beat' and e.event = 'played' order by e.id desc limit 1) l
        where l.bundle is null or (exists (select 1 from queued_moves q where q.bundle = l.bundle)
                                   and not exists (select 1 from queued_moves q where q.bundle = l.bundle and q.landed_act is null)));
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

-- ------------------------------------------------------------------------------- the reads ----

-- {beat: latest event} for a persona in a season: the one definition of a beat's state.
create function arc_latest_states(in_staff text, in_season bigint) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_object_agg(l.beat, l.event), '{}'::jsonb)
  from (select distinct on (x.beat) x.beat, x.event from arc_beat_events x where x.season = in_season and x.staff = in_staff order by x.beat, x.id desc) l
$$;

-- Whether a beat's due point has passed. A phase's start is the season's, the honeymoon's end or the meltdown's start; `daysIntoPhase` counts from it; `daysBeforeEnd` from the season's end.
-- Where a due point names both, either passing makes it past. No due point (null, or an object that names nothing) is never past.
create function beat_is_due(in_staff text, in_season bigint, due jsonb) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  sp record;
  begun timestamptz;
begin
  if jsonb_typeof(due) is distinct from 'object' then return false; end if;
  select * into sp from arc_season_span(in_staff, in_season);
  if not found then return false; end if;
  if due ? 'phase' then
    begun := case due ->> 'phase' when 'honeymoon' then sp.starts_at when 'reign' then sp.honeymoon_ends when 'meltdown' then sp.meltdown_starts end;
    if begun is not null and now() >= begun + make_interval(hours => coalesce((due ->> 'daysIntoPhase')::integer, 0) * 24) then return true; end if;
  end if;
  if due ? 'daysBeforeEnd' and now() >= sp.ends_at - make_interval(hours => (due ->> 'daysBeforeEnd')::integer * 24) then return true; end if;
  return false;
end $$;

-- The kinds a persona holds back in a season: those whose beat has not unlocked (no event of it yet), in the persona's order.
create function held_back_kinds(in_staff text, in_season bigint) returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array(
    select h.value ->> 'kind' from persona_arcs a, jsonb_array_elements(a.holds_back) with ordinality h(value, ord)
    where a.staff = in_staff and not (arc_latest_states(in_staff, in_season) ? (h.value ->> 'until'))
    order by h.ord), '{}'::text[])
$$;

-- What the meeting reads of a persona's arc (Task 6 calls this with the season's Boss and the open season): the beats unlocked and not yet played, in the persona's order, each with whether it
-- is past its due point, and the kinds held back. {"beats": [{"key", "mini", "due"}], "heldBack": [kind]}. A persona with no arc reads empty.
create function arc_for_meeting(in_staff text, in_season bigint) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with st as (select arc_latest_states(in_staff, in_season) as s)
  select jsonb_build_object(
    'beats', coalesce((select jsonb_agg(jsonb_build_object('key', b.value ->> 'key', 'mini', coalesce((b.value ->> 'mini')::boolean, false),
                                                         'due', beat_is_due(in_staff, in_season, b.value -> 'due')) order by b.ord)
                       from persona_arcs a, jsonb_array_elements(a.beats) with ordinality b(value, ord), st
                       where a.staff = in_staff and st.s ->> (b.value ->> 'key') = 'unlocked'), '[]'::jsonb),
    'heldBack', to_jsonb(held_back_kinds(in_staff, in_season)))
$$;

-- ------------------------------------------------------------------------------- the pass ----

-- The work of one persona in one season. In the open season (`in_closed` false): a beat with no event, or a repeatable one last played, whose every condition holds is `unlocked`; once the season's
-- planned end has come, an optional beat (no due point) still unlocked is `lapsed`. In a closed season: every beat still unlocked is `lapsed`, a due one too, and nothing unlocks. A beat that
-- fails to read is warned about and the rest go on. Returns what it wrote.
create function arc_pass_for(in_staff text, in_season bigint, in_closed boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sp record;
  states jsonb;
  b record;
  c record;
  last text;
  ok boolean;
  done boolean := in_closed;
  unlocked integer := 0;
  lapsed integer := 0;
begin
  -- A persona with no arc costs one read of its row, and needs nothing else set.
  if in_staff is null or in_season is null or not exists (select 1 from persona_arcs a where a.staff = in_staff and jsonb_array_length(a.beats) > 0) then return jsonb_build_object('unlocked', 0, 'lapsed', 0); end if;
  states := arc_latest_states(in_staff, in_season);
  if in_closed and not (states::text like '%"unlocked"%') then return jsonb_build_object('unlocked', 0, 'lapsed', 0); end if;
  if not in_closed then
    select * into sp from arc_season_span(in_staff, in_season);
    done := found and now() >= sp.ends_at;
  end if;
  for b in
    select e.value as beat from persona_arcs a, jsonb_array_elements(a.beats) with ordinality e(value, ord) where a.staff = in_staff order by e.ord
  loop
    begin
      last := states ->> (b.beat ->> 'key');
      if last = 'lapsed' then continue; end if;
      if done then
        if last = 'unlocked' and (in_closed or jsonb_typeof(b.beat -> 'due') is distinct from 'object') then
          insert into arc_beat_events (season, staff, beat, event) values (in_season, in_staff, b.beat ->> 'key', 'lapsed');
          lapsed := lapsed + 1;
        end if;
        continue;
      end if;
      if last is null or (last = 'played' and coalesce((b.beat ->> 'repeatable')::boolean, false)) then
        ok := true;
        for c in select u.value as cond from jsonb_array_elements(b.beat -> 'unlock') u loop
          if not beat_condition_holds(in_staff, in_season, c.cond) then ok := false; exit; end if;
        end loop;
        if ok then
          insert into arc_beat_events (season, staff, beat, event) values (in_season, in_staff, b.beat ->> 'key', 'unlocked');
          unlocked := unlocked + 1;
        end if;
      end if;
    exception when others then
      raise warning 'arc_pass_for: beat % was not read: % (%)', b.beat ->> 'key', sqlerrm, sqlstate;
    end;
  end loop;
  return jsonb_build_object('unlocked', unlocked, 'lapsed', lapsed);
end $$;

-- arc_pass (0164): the season's Boss in the open season, then the Boss of the most recently closed season, for what it left unlocked. Returns what was written.
create or replace function arc_pass() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  open_n jsonb;
  closed_n jsonb := jsonb_build_object('unlocked', 0, 'lapsed', 0);
  last_closed record;
begin
  open_n := arc_pass_for(current_boss(), (select x.id from seasons x where x.ends_at is null), false);
  select x.id, x.boss into last_closed from seasons x where x.ends_at is not null order by x.number desc limit 1;
  if found then closed_n := arc_pass_for(last_closed.boss, last_closed.id, true); end if;
  return jsonb_build_object('unlocked', (open_n ->> 'unlocked')::integer + (closed_n ->> 'unlocked')::integer, 'lapsed', (open_n ->> 'lapsed')::integer + (closed_n ->> 'lapsed')::integer);
end $$;

revoke execute on function arc_latest_states(text, bigint), beat_is_due(text, bigint, jsonb), held_back_kinds(text, bigint), arc_for_meeting(text, bigint), arc_pass_for(text, bigint, boolean)
  from public, anon, authenticated;
grant execute on function arc_latest_states(text, bigint), beat_is_due(text, bigint, jsonb), held_back_kinds(text, bigint), arc_for_meeting(text, bigint), arc_pass_for(text, bigint, boolean) to service_role;
