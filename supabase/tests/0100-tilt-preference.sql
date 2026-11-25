-- The tilt preference (supabase/migrations/0098_tilt_preference.sql; shine plan Task 4): 'off' by default, 'on' kept, anything else
-- refused by name, read by the account alone, and carried in boot()'s preferences the way the separate read carries it.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('tilt-ann');
  bob uuid := tests.account('tilt-bob');
  said jsonb;
begin
  perform tests.become(ann);
  said := set_preferences(smoke => 'low');
  if said ->> 'tilt' is distinct from 'off' then raise exception 'the tilt defaults to off: %', said; end if;
  said := set_preferences(tilt => 'on');
  if said ->> 'tilt' is distinct from 'on' or (select tilt from account_preferences) is distinct from 'on' then raise exception 'on is kept: %', said; end if;
  said := set_preferences(smoke => 'off');
  if said ->> 'tilt' is distinct from 'on' then raise exception 'a call leaving the tilt out keeps it: %', said; end if;
  if pg_temp.refusal($q$select set_preferences(tilt => 'sideways')$q$) is distinct from 'tilt is off or on' then raise exception 'a tilt that is neither is refused, naming the choice'; end if;
  if (select tilt from account_preferences) is distinct from 'on' then raise exception 'a refused call changes nothing'; end if;
  if boot() #>> '{preferences,tilt}' is distinct from 'on' then raise exception 'boot carries the tilt the page loads with: %', boot() -> 'preferences'; end if;
  perform tests.unbecome();

  perform tests.become(bob);
  said := set_preferences(motion => 'reduce');
  if said ->> 'tilt' is distinct from 'off' then raise exception 'another account starts at off: %', said; end if;
  if exists (select 1 from account_preferences where account = ann) then raise exception 'another account read the tilt'; end if;
  perform tests.unbecome();
end $$;
