-- not_the_systems (0013), its refusal in the engine's neutral words: the player reads this message as
-- the backend wrote it (web/src/data/supabase.ts passes a kayfabb.refusal through), and the engine names
-- no instance's cast, so "The System" is "the staff" here, as the fake backend says it
-- (engine/ui/data/fake.ts). The signature, security settings, search path and grants are 0013's.
create or replace function not_the_systems(on_board uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from boards where id = on_board and is_system) then
    raise exception 'only the staff post here; spin a thread from what they said' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
end $$;
