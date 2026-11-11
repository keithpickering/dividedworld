-- The beat-event guard (0185) let a faithful import through: its checks of a live insert (the persona has the beat, the beat's last event, the bundle) read persona_arcs
-- and queued_moves, which an import writes after this table, so an exported log of valid events was refused ("the persona exp-boss has no beat split"). Under
-- session_replication_role = 'replica' the insert is now carried as written, as 0072's moments are; update, delete and truncate stay refused in every mode.

create or replace function arc_beat_events_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  arc jsonb;
  last text;
begin
  if tg_op <> 'INSERT' then raise exception 'a beat''s event is only ever added (%)', tg_op using errcode = 'P0001'; end if;
  -- An import (tools/import-instance.mjs) writes as a replica, table by table in name order, so this table's rows go in before persona_arcs and queued_moves hold
  -- what they name. They are an exported log, each row checked when it was first written; replaying the checks against half an import would refuse a faithful
  -- round trip. Only the live insert is checked against the persona's beats and the beat's last event; the refusals above stay in every mode.
  if current_setting('session_replication_role') = 'replica' then return new; end if;
  select b.value into arc from persona_arcs a, jsonb_array_elements(a.beats) b(value) where a.staff = new.staff and b.value ->> 'key' = new.beat;
  if arc is null then raise exception 'the persona % has no beat %', new.staff, new.beat using errcode = '23514'; end if;
  perform pg_advisory_xact_lock(hashtext('kayfabb.arc_beat'), hashtext(new.season::text || ':' || new.staff || ':' || new.beat));
  select e.event into last from arc_beat_events e where e.season = new.season and e.staff = new.staff and e.beat = new.beat order by e.id desc limit 1;
  if new.event = 'unlocked' then
    if last = 'unlocked' then raise exception 'that beat is already unlocked' using errcode = '23514'; end if;
    if last = 'lapsed' then raise exception 'that beat has lapsed for the season' using errcode = '23514'; end if;
    if last = 'played' and coalesce((arc ->> 'repeatable')::boolean, false) is not true then raise exception 'that beat was played and is not repeatable' using errcode = '23514'; end if;
  elsif last is distinct from 'unlocked' then
    raise exception 'a beat is % only once it has unlocked (it is %)', new.event, coalesce(last, 'not unlocked') using errcode = '23514';
  end if;
  if new.bundle is not null and not exists (select 1 from queued_moves q where q.bundle = new.bundle and q.staff = new.staff) then
    raise exception 'that bundle has no part of this persona''s' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function arc_beat_events_guard() from public, anon, authenticated;
