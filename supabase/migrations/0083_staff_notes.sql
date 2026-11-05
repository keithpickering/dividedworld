-- Staff notes (the staff roster design, "The masks"; its plan, Task 6).
--
-- A pool persona writes a short note of its own with each post it makes: a thought to itself, kept for the next time it is asked to
-- write. A note is read, never acted on: the Boss's meeting reads its own recent notes as context (`engine/system/memory.ts`,
-- `supabase/functions/meet/core.ts`) and nothing here, or there, turns a note's words into an effect.
--
-- `act` is the pool post that wrote the note, so a note is never without its post; `body` is at most 280 characters (the engine's
-- `noteMost`, held there by a test that reads this file) and never blank. The table is append-only like the office log, and no client
-- reaches it: only `staff_notes_recent`, for the service role, reads it back.
--
-- Ways out: nothing here holds a player in a state. A note is an inert record of what a persona thought.

create table staff_notes (
  id bigint generated always as identity primary key,
  staff text not null references characters (staff),
  act uuid not null references acts (id),
  at timestamptz not null default now(),
  body text not null check (length(btrim(body, E' \t\n\r\f\v')) between 1 and 280)
);
create index staff_notes_latest on staff_notes (staff, at desc, id desc);
alter table staff_notes enable row level security;
revoke all on staff_notes from public, anon, authenticated;

create function staff_notes_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a staff note is never edited or removed (%); write a new one', tg_op using errcode = 'P0001';
end $$;
create trigger staff_notes_no_update before update or delete on staff_notes for each row execute function staff_notes_append_only();
create trigger staff_notes_no_truncate before truncate on staff_notes for each statement execute function staff_notes_append_only();
-- Always: a session in replica mode, as a restore with triggers disabled runs, fires them too.
alter table staff_notes enable always trigger staff_notes_no_update;
alter table staff_notes enable always trigger staff_notes_no_truncate;
revoke execute on function staff_notes_append_only() from public, anon, authenticated;

-- A persona's notes after `since` (null: all), the newest `most`, returned oldest first as a json array of their words.
create function staff_notes_recent(of_staff text, since timestamptz, most integer) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(n.body order by n.at, n.id), '[]'::jsonb)
  from (
    select s.body, s.at, s.id from staff_notes s
    where s.staff = of_staff and (since is null or s.at > since)
    order by s.at desc, s.id desc
    limit greatest(coalesce(most, 0), 0)
  ) n
$$;
revoke execute on function staff_notes_recent(text, timestamptz, integer) from public, anon, authenticated;
grant execute on function staff_notes_recent(text, timestamptz, integer) to service_role;

-- The setting that bounds the read: how many of its own recent notes the Boss's meeting reads (`notesRead`, a whole number, at least 1).
-- Held beside settings_held (0077) in a trigger of its own so that function stays as it was; the pool's settings (the plan's Task 9)
-- fold it into that function's list when they arrive. The TypeScript rule is `notesRead` in engine/rules/instance.ts, and
-- supabase/tests/0079-settings-held.sql lists its poisons and goods.
create function settings_held_notes() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.key = 'notesRead' and not setting_whole(new.value, 1) then
    raise exception 'notesRead is a whole number of notes, at least 1' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger settings_held_notes before insert or update on settings for each row execute function settings_held_notes();
revoke execute on function settings_held_notes() from public, anon, authenticated;
