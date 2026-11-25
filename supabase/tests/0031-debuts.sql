-- Debuts, retired (supabase/migrations/0024_debuts.sql, 0028_loud_classes.sql, 0067_debut_now.sql; ended by 0428_no_debuts.sql, whose test holds what is true now):
-- a character is made active and no debut is announced. What is left to hold here is what the old debut Acts still are, since the ones already written stay in the log:
-- a class reveal, a character's own Act that others react to, spin and have settled; and a new character is in the season's results.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ---- An old debut announcement, written before 0428, is its character's own Act on The System's board, and a class reveal where it names a class ----
do $$
declare
  ann uuid := tests.account('old-debut-ann');
  bob uuid := tests.account('old-debut-bob');
  a uuid := tests.character(ann, 'Debuted Before', 'beta', now() - interval '60 days');
  b uuid := tests.character(bob, 'Watches Debuts', 'alpha', now() - interval '60 days');
  on_system uuid;
  old jsonb;
  old_id uuid;
  spun jsonb;
begin
  insert into threads (board, title) values (system_board(), 'Old debuts') returning id into on_system;
  old := tests.old_debut(a, on_system, 'beta', now() - interval '59 days');
  old_id := (old ->> 'id')::uuid;
  if (select payload from acts where id = old_id) is distinct from '{"what": "debut", "class": "beta"}'::jsonb then raise exception 'the old debut names its class: %', old; end if;
  if (select (class, via) from class_reveals where character = a) is distinct from ('beta'::text, 'debut'::text) then raise exception 'an old debut that names its class is a class reveal'; end if;
  -- It is the character's Act on The System's board: reacted to, spun, and its reactions are the character's.
  perform tests.become(bob);
  perform react(old_id, b, 'up');
  spun := spin(old_id, b, 'About that debut', '');
  perform tests.unbecome();
  if (select board from threads where id = (spun -> 'thread' ->> 'id')::uuid) is distinct from players_board() then raise exception 'a thread spun from an old debut opens on the players'' board'; end if;
  if not exists (select 1 from jsonb_array_elements(settlement_input(now() - interval '60 days', now() + interval '1 hour') -> 'acts') x where x ->> 'id' = old_id::text and x ->> 'character' = a::text)
     or settlement_input(now() - interval '60 days', now() + interval '1 hour') -> 'systemActs' @> to_jsonb(array[old_id]) then
    raise exception 'an old debut is settled as its character''s Act, never The System''s';
  end if;
  -- Players still post nothing on The System's board.
  perform tests.become(ann);
  if pg_temp.refusal(format('select unmask(%L, %L, %L)', a, on_system, '')) is distinct from 'only the staff post here; spin a thread from what they said' then raise exception 'a player unmasked on The System''s board'; end if;
  perform tests.unbecome();
end $$;

-- ---- The season's reveal names every character, a new one among them ----
do $$
declare
  ann uuid := tests.account('reveal-drop');
  made uuid;
  ended timestamptz;
begin
  update seasons set starts_at = now() - interval '1 day' where ends_at is null;
  perform tests.become(ann);
  made := (create_character('Revealed New Character', 'alpha') ->> 'id')::uuid;
  perform tests.unbecome();
  ended := (select starts_at from seasons where ends_at is null) + span_interval(setting('seasonLength'));
  perform reveal_season(ended);
  if not exists (select 1 from season_results where character = made) then raise exception 'the season''s results name a character made in the season'; end if;
end $$;
