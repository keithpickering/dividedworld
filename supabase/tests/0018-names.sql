-- Names that look different (supabase/migrations/0011_names.sql): two characters' names may not
-- be the same once letters that look alike across scripts are folded together (Unicode's
-- confusable skeleton, UTS #39) and case is ignored. The fix round's Task G; the owner's answer
-- 12, on #4.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('name-ann');
  bob uuid := tests.account('name-bob');
begin
  perform tests.become(ann);
  perform create_character('Pipewrench', 'alpha');
  perform tests.unbecome();
  perform tests.become(bob);
  -- A Cyrillic е (U+0435) in place of the Latin e is refused, in the words any taken name gets.
  if pg_temp.refusal(format('select create_character(%L, %L)', U&'Pipewr\0435nch', 'alpha')) is distinct from 'that name is taken' then
    raise exception 'a Cyrillic lookalike was made: %', pg_temp.refusal(format('select create_character(%L, %L)', U&'Pipewr\0435nch', 'alpha'));
  end if;
  if pg_temp.refusal(format('select create_character(%L, %L)', 'PIPEWRENCH', 'alpha')) is distinct from 'that name is taken' then raise exception 'a name differing only in case was made'; end if;
  -- A digit that looks like a letter is that letter; as written, a capital I is the l it looks like.
  if pg_temp.refusal(format('select create_character(%L, %L)', 'B0b', 'alpha')) is not null then raise exception '"B0b" was refused before any Bob'; end if;
  if pg_temp.refusal(format('select create_character(%L, %L)', 'Bob', 'alpha')) is distinct from 'that name is taken' then raise exception 'a letter for a digit was made'; end if;
  if pg_temp.refusal(format('select create_character(%L, %L)', 'PipewrenchI', 'alpha')) is not null then raise exception '"PipewrenchI" was refused'; end if;
  if pg_temp.refusal(format('select create_character(%L, %L)', 'Pipewrenchl', 'alpha')) is distinct from 'that name is taken' then raise exception 'an l for a capital I was made'; end if;
  -- A name that says something more is its own.
  if pg_temp.refusal(format('select create_character(%L, %L)', 'Pipewrench II', 'alpha')) is not null then raise exception '"Pipewrench II" was refused'; end if;
  if pg_temp.refusal(format('select create_character(%L, %L)', 'The Real Pipewrench', 'alpha')) is not null then raise exception '"The Real Pipewrench" was refused'; end if;
  perform tests.unbecome();
  -- The key is held by the table, so no writer can skip it.
  if (select name_key from characters where name = 'Pipewrench') is distinct from name_skeleton(U&'Pipewr\0435nch') then raise exception 'a character''s key is its name''s skeleton'; end if;
  begin
    insert into characters (owner, name) values (bob, U&'\0420\0456pewrench');
    raise exception 'a lookalike was written past create_character()';
  exception when unique_violation then null;
  end;
  -- The data says which Unicode release it is.
  if (select version from unicode_data where what = 'confusables') !~ '^\d+\.\d+\.\d+$' then raise exception 'the confusables'' Unicode release is recorded'; end if;
end $$;
