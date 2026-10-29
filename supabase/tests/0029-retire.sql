-- Retiring a character (supabase/migrations/0021_characters_listed.sql): an admin retires one on
-- its player's request, which frees a slot in the roster; it cannot act, every Act of it stays
-- readable, and an admin can restore it unless its player's roster is full again. The screens'
-- engine plan, Task 10.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('ret-ann');
  bob uuid := tests.account('ret-bob');
  boss uuid := tests.account('ret-admin');
  old uuid := tests.character(ann, 'Ret Old');
  b uuid := tests.character(bob, 'Ret Reader');
  t uuid := tests.thread();
  p uuid := tests.post(old, t, 'Before I go.');
  why text;
  seventh uuid;
begin
  for i in 2..6 loop perform tests.character(ann, 'Ret Mask ' || i); end loop;
  insert into admins (account) values (boss);
  perform tests.become(ann);
  if pg_temp.refusal($q$select create_character('Ret Seventh', 'alpha')$q$) is null then raise exception 'a seventh character was made'; end if;
  perform tests.unbecome();

  -- Only an admin retires.
  perform tests.become(ann);
  if pg_temp.refusal(format('select retire_character(%L)', old)) is distinct from 'only an admin retires a character' then raise exception 'a player retired a character'; end if;
  perform tests.unbecome();
  perform tests.become(boss);
  perform retire_character(old);
  perform tests.unbecome();

  -- It frees a slot, cannot act by any path, and every Act of it stays readable.
  perform tests.become(ann);
  perform create_character('Ret Seventh', 'alpha');
  why := pg_temp.refusal(format('select post(%L, %L, %L)', t, old, 'Back?'));
  if why is distinct from 'that character is retired; an admin can restore it' then raise exception 'a retired character posted: %', why; end if;
  if pg_temp.refusal(format('select react(%L, %L, %L)', p, old, 'up')) is distinct from 'that character is retired; an admin can restore it' then raise exception 'a retired character reacted'; end if;
  if pg_temp.refusal(format('select turn(%L, %L, %L)', old, 'beta', 'silent')) is distinct from 'that character is retired; an admin can restore it' then raise exception 'a retired character Turned'; end if;
  perform tests.unbecome();
  if coalesce(pg_temp.refusal(format('insert into acts (character, kind, thread, payload) values (%L, %L, %L, %L)', old, 'post', t, '{"body": "x"}')), '') not like '%retired%' then
    raise exception 'an Act by a retired character was written past every action';
  end if;
  perform tests.become(bob);
  if (select current_payload ->> 'body' from acts_public where id = p) is distinct from 'Before I go.' then raise exception 'a retired character''s Act is still read'; end if;
  if not exists (select 1 from characters_public where id = old) then raise exception 'a retired character is still known by its name'; end if;
  -- To another player it is any character they do not play.
  if pg_temp.refusal(format('select post(%L, %L, %L)', t, old, 'Mine?')) is distinct from 'you do not play that character' then raise exception 'another player learned a character is retired'; end if;
  perform tests.unbecome();

  -- Restored into a full roster: refused in plain words. With a slot, restored.
  seventh := (select id from characters where name = 'Ret Seventh');
  perform tests.become(boss);
  why := pg_temp.refusal(format('select restore_character(%L)', old));
  if why is distinct from 'its player already runs 6 characters; one retired frees a slot' then raise exception 'a restore into a full roster: %', why; end if;
  perform retire_character(seventh);
  perform restore_character(old);
  perform tests.unbecome();
  perform tests.become(ann);
  perform post(t, old, 'I am back.');
  perform tests.unbecome();
  perform tests.become(boss);
  if pg_temp.refusal(format('select restore_character(%L)', old)) is distinct from 'that character is not retired' then raise exception 'restoring one that is not retired'; end if;
  perform tests.unbecome();
end $$;
