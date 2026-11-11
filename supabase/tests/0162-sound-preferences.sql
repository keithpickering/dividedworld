-- The sound preferences (supabase/migrations/0154_sound_preferences.sql; docs/plans/2026-11-11-laugh-track-design.md): game and interface sound
-- 'off' by default, each with a volume of 80, each kept alone, a sound other than off or on and a volume outside 0 to 100 in steps of 5 refused
-- in plain words, read by the account alone, and carried in boot()'s preferences.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('sound-ann');
  bob uuid := tests.account('sound-bob');
  said jsonb;
  before_all jsonb;
  k text;
begin
  perform tests.become(ann);
  said := set_preferences(smoke => 'low', tilt => 'on', text_size => 150);
  if said ->> 'game_sound' is distinct from 'off' or said ->> 'interface_sound' is distinct from 'off'
     or (said -> 'game_volume')::int is distinct from 80 or (said -> 'interface_volume')::int is distinct from 80 then
    raise exception 'the sounds default to off at 80: %', said;
  end if;
  before_all := said;

  said := set_preferences(game_sound => 'on');
  if said ->> 'game_sound' is distinct from 'on' or (select game_sound from account_preferences) is distinct from 'on' then raise exception 'game sound on is kept: %', said; end if;
  if said - 'game_sound' is distinct from before_all - 'game_sound' then raise exception 'naming the game sound leaves every other choice as it was: %', said; end if;

  said := set_preferences(game_volume => 35);
  if (said -> 'game_volume')::int is distinct from 35 or (select game_volume from account_preferences) is distinct from 35 then raise exception 'a game volume is kept: %', said; end if;
  if said ->> 'game_sound' is distinct from 'on' then raise exception 'the volume leaves the sound as it was: %', said; end if;

  said := set_preferences(interface_sound => 'on', interface_volume => 0);
  if said ->> 'interface_sound' is distinct from 'on' or (said -> 'interface_volume')::int is distinct from 0
     or (select interface_volume from account_preferences) is distinct from 0 then raise exception 'interface sound and a volume of 0 are kept: %', said; end if;
  if (said -> 'game_volume')::int is distinct from 35 or said ->> 'smoke' is distinct from 'low' then raise exception 'the interface choices leave the rest as it was: %', said; end if;

  said := set_preferences(game_volume => 100);
  if (said -> 'game_volume')::int is distinct from 100 then raise exception '100 is a volume: %', said; end if;
  said := set_preferences(smoke => 'off');
  if said ->> 'game_sound' is distinct from 'on' or (said -> 'game_volume')::int is distinct from 100 or (said -> 'interface_volume')::int is distinct from 0 then raise exception 'a call leaving the sounds out keeps them: %', said; end if;

  if pg_temp.refusal($q$select set_preferences(game_sound => 'loud')$q$) is distinct from 'game sounds are off or on' then raise exception 'a game sound that is neither is refused, naming the choice'; end if;
  if pg_temp.refusal($q$select set_preferences(interface_sound => 'loud')$q$) is distinct from 'interface sounds are off or on' then raise exception 'an interface sound that is neither is refused, naming the choice'; end if;
  foreach k in array array['game_volume => 7', 'game_volume => 105', 'game_volume => -5', 'interface_volume => 7', 'interface_volume => 105'] loop
    if pg_temp.refusal('select set_preferences(' || k || ')') is distinct from 'a volume is 0 to 100, in steps of 5' then raise exception 'a volume outside 0 to 100 in steps of 5 is refused: %', k; end if;
  end loop;
  if (select game_sound || game_volume || interface_sound || interface_volume from account_preferences) is distinct from 'on100on0' then raise exception 'a refused call changes nothing'; end if;

  if boot() #>> '{preferences,game_sound}' is distinct from 'on' or (boot() #> '{preferences,game_volume}')::int is distinct from 100
     or boot() #>> '{preferences,interface_sound}' is distinct from 'on' or (boot() #> '{preferences,interface_volume}')::int is distinct from 0 then
    raise exception 'boot carries the four sounds the page loads with: %', boot() -> 'preferences';
  end if;
  perform tests.unbecome();

  perform tests.become(bob);
  said := set_preferences(motion => 'reduce');
  if said ->> 'game_sound' is distinct from 'off' or (said -> 'interface_volume')::int is distinct from 80 then raise exception 'another account starts at the defaults: %', said; end if;
  if exists (select 1 from account_preferences where account = ann) then raise exception 'another account read the sounds'; end if;
  perform tests.unbecome();
end $$;
