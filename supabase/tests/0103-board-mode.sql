-- A theme and a mode, held apart (supabase/migrations/0103_board_mode.sql; board-look plan Task 15): the mode defaults to the device's, is kept,
-- refused by name when it is none of the three, read by the account alone and carried in boot(); and the migration's one rewrite of the old
-- mixed theme column turns system, light and dark into the default theme in a mode, and leaves any other key with the device's mode.

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

-- The migration's rewrite, run on rows as the old column held them. This statement is the migration's, word for word; it is here because a
-- replay from zero has no rows for it to rewrite.
do $$
declare
  a uuid[] := array[tests.account('mode-s'), tests.account('mode-l'), tests.account('mode-d'), tests.account('mode-o')];
  want text[][] := array[['default', 'system'], ['default', 'light'], ['default', 'dark'], ['dusk', 'system']];
  i integer;
begin
  insert into account_preferences (account, theme, mode) values (a[1], 'system', 'system'), (a[2], 'light', 'system'), (a[3], 'dark', 'system'), (a[4], 'dusk', 'system');
  update account_preferences set mode = case when theme in ('light', 'dark') then theme else 'system' end,
    theme = case when theme in ('system', 'light', 'dark') then 'default' else theme end;
  for i in 1..4 loop
    if (select (theme, mode) from account_preferences where account = a[i]) is distinct from (want[i][1], want[i][2]) then
      raise exception 'row % was rewritten to %', i, (select (theme, mode) from account_preferences where account = a[i]);
    end if;
  end loop;
end $$;
