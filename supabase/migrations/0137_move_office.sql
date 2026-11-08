-- The office a move landed under (docs/plans/2026-11-06-member-groups-plan.md, Task 10, review).
--
--   write_staff_act   (0109) also stamps a `move` Act's payload with `office` ('boss' or 'mod'): the office the staff character holds when the Act is written. Every move lands through
--                     this function (the tick's landing pass, apply_mod_move), so one place stamps them all. The screens (the move's post, its notice, the barred box) name the move's
--                     role from the stamp and never from the persona's office now, which a handover or a reassignment can change. A payload that already carries an `office` is left as
--                     given. Everything else as 0109 wrote it.
--
-- Moves written before this migration carry no stamp, and a stamp cannot be added to an Act afterward (Acts are append-only): the screens read an unstamped move as the Boss's. Only
-- the Boss, and the rule-setting Mod before group moves, made moves then, and no instance with players holds one.
-- Masks. The office of a staff character is public (characters_public carries it); the stamp adds nothing private.

create or replace function write_staff_act(staff_key text, kind text, thread uuid, target uuid, payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  whose text;
  written uuid;
  held text;
  stamped jsonb := payload;
begin
  select c.id, c.staff_kind into who, whose from characters c where c.staff = staff_key;
  if whose = 'developer' then
    raise exception 'the developer speaks only through post_update, by an admin' using errcode = '42501';
  end if;
  if kind is null or kind not in ('post', 'spin', 'card', 'edit', 'move', 'move_keep', 'visit', 'visit_join', 'report_verdict', 'appeal_ruling') then
    raise exception 'a staff character posts, spins, plays a card, edits, moves, keeps a move, visits or gives a verdict or a ruling, not %', coalesce(kind, 'nothing') using errcode = '22023';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'an Act''s payload is an object' using errcode = '22023'; end if;
  if who is null then raise exception 'there is no staff member "%"', staff_key using errcode = 'P0002'; end if;
  -- A persona that has not debuted writes nothing, and a benched one is silent (0082).
  select o.office into held from staff_office_now o where o.staff = staff_key;
  if held in ('waiting', 'benched') then
    raise exception 'a % persona writes nothing', held using errcode = '55000';
  end if;
  -- A move says which office made it, as the office stood when it landed.
  if kind = 'move' and held in ('boss', 'mod') and not (payload ? 'office') then
    stamped := payload || jsonb_build_object('office', held);
  end if;
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (who, kind, thread, target, stamped) returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  return act_projection(written);
end $$;
