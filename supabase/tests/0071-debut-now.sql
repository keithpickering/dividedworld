-- "Drop now" is the default debut (supabase/migrations/0067_debut_now.sql): create_character(name, class) with no timing makes a character
-- that has debuted, at its creation, announced; asking for the settlement still makes one that waits. The onboarding plan, Task 1.

do $$
declare
  ann uuid := tests.account('debut-now-ann');
  made jsonb;
  waiting jsonb;
begin
  perform tests.become(ann);
  made := create_character('Dropped In', 'alpha');
  if (select debuted_at from characters where id = (made ->> 'id')::uuid) is null then raise exception 'a character made with no timing has not debuted: %', made; end if;
  if (made ->> 'waiting')::boolean then raise exception 'a character made with no timing says it waits: %', made; end if;
  if (select debut_loudness from characters where id = (made ->> 'id')::uuid) is distinct from 'announced' then raise exception 'the loudness default changed'; end if;

  waiting := create_character('Waits Its Turn', 'alpha', 'tally');
  if (select debuted_at from characters where id = (waiting ->> 'id')::uuid) is not null or not (waiting ->> 'waiting')::boolean then
    raise exception 'asking for the settlement no longer waits: %', waiting;
  end if;
end $$;
