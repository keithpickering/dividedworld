-- A theme and a mode, held apart (supabase/migrations/0103_board_mode.sql; board-look plan Task 15): the mode defaults to the device's, is kept,
-- refused by name when it is none of the three, read by the account alone and carried in boot(). The migration's rewrite of the old mixed theme column
-- is proved on rows as they were by e2e/0017-mode-across-0103.ts.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('mode-ann');
  bob uuid := tests.account('mode-bob');
  said jsonb;
begin
  perform tests.become(ann);
  said := set_preferences(smoke => 'low');
  if said ->> 'theme' is distinct from 'default' or said ->> 'mode' is distinct from 'system' then raise exception 'a new account starts at the default theme following its device: %', said; end if;
  said := set_preferences(mode => 'dark');
  if said ->> 'mode' is distinct from 'dark' or said ->> 'theme' is distinct from 'default' then raise exception 'a mode is kept beside the theme: %', said; end if;
  said := set_preferences(theme => 'hot-rod');
  if said ->> 'theme' is distinct from 'hot-rod' or said ->> 'mode' is distinct from 'dark' then raise exception 'a theme chosen leaves the mode: %', said; end if;
  said := set_preferences(theme => 'default', mode => 'light');
  if (select (theme, mode) from account_preferences) is distinct from ('default'::text, 'light'::text) then raise exception 'both together: %', said; end if;
  if pg_temp.refusal($q$select set_preferences(mode => 'sepia')$q$) is distinct from 'the mode follows the device, or is light or dark' then raise exception 'a mode that is none is refused, naming the choices'; end if;
  if (select mode from account_preferences) is distinct from 'light' then raise exception 'a refused call changes nothing'; end if;
  if boot() #>> '{preferences,mode}' is distinct from 'light' then raise exception 'boot carries the mode the page loads with: %', boot() -> 'preferences'; end if;
  perform tests.unbecome();

  perform tests.become(bob);
  said := set_preferences(motion => 'reduce');
  if said ->> 'mode' is distinct from 'system' then raise exception 'another account starts at system: %', said; end if;
  perform tests.unbecome();
end $$;
