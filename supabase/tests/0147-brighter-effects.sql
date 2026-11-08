-- The brighter-effects preference (supabase/migrations/0145_brighter_effects.sql; docs/plans/2026-11-08-brighter-effects-design.md):
-- 'standard' by default, 'bright' kept, anything else refused by name, read by the account alone, and carried in boot()'s preferences.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('effects-ann');
  bob uuid := tests.account('effects-bob');
  said jsonb;
  before_all jsonb;
begin
  perform tests.become(ann);
  said := set_preferences(smoke => 'low', tilt => 'on', text_size => 150);
  if said ->> 'effects' is distinct from 'standard' then raise exception 'the effects default to standard: %', said; end if;
  before_all := said - 'effects';
  said := set_preferences(effects => 'bright');
  if said ->> 'effects' is distinct from 'bright' or (select effects from account_preferences) is distinct from 'bright' then raise exception 'bright is kept: %', said; end if;
  if said - 'effects' is distinct from before_all then raise exception 'naming the effects leaves every other choice as it was: % against %', said, before_all; end if;
  said := set_preferences(smoke => 'off');
  if said ->> 'effects' is distinct from 'bright' then raise exception 'a call leaving the effects out keeps them: %', said; end if;
  if pg_temp.refusal($q$select set_preferences(effects => 'loud')$q$) is distinct from 'effects are standard or bright' then raise exception 'effects that are neither are refused, naming the choice'; end if;
  if (select effects from account_preferences) is distinct from 'bright' then raise exception 'a refused call changes nothing'; end if;
  if boot() #>> '{preferences,effects}' is distinct from 'bright' then raise exception 'boot carries the effects the page loads with: %', boot() -> 'preferences'; end if;
  perform tests.unbecome();

  perform tests.become(bob);
  said := set_preferences(motion => 'reduce');
  if said ->> 'effects' is distinct from 'standard' then raise exception 'another account starts at standard: %', said; end if;
  if exists (select 1 from account_preferences where account = ann) then raise exception 'another account read the effects'; end if;
  perform tests.unbecome();
end $$;
