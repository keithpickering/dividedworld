-- The motion feel (supabase/migrations/0110_motion_feel.sql; docs/plans/2026-11-04-glass-polish-plan.md, Task 11): motion is system, reduce,
-- full or snappy; a saved `full` is unchanged, `snappy` is kept, and anything else is refused by name.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('mf-ann');
  bob uuid := tests.account('mf-bob');
  said jsonb;
begin
  perform tests.become(ann);
  said := set_preferences(motion => 'snappy');
  if said ->> 'motion' is distinct from 'snappy' or (select motion from account_preferences) is distinct from 'snappy' then raise exception 'snappy is kept: %', said; end if;
  if pg_temp.refusal($q$select set_preferences(motion => 'fast')$q$) is distinct from 'motion follows the system, or is off, smooth or snappy' then raise exception 'a motion that is none of the four is refused, naming the choices'; end if;
  if (select motion from account_preferences) is distinct from 'snappy' then raise exception 'a refused call changes nothing'; end if;
  perform tests.unbecome();

  -- A row holding `full` (every row saved before this) reads back full.
  perform tests.become(bob);
  said := set_preferences(motion => 'full');
  if said ->> 'motion' is distinct from 'full' or (select motion from account_preferences) is distinct from 'full' then raise exception 'full reads back full: %', said; end if;
  perform tests.unbecome();
end $$;
