-- Sign-in is passwordless (supabase/migrations/0012_passwordless.sql): no login holds a
-- password, whoever writes one, so password sign-in fails alike for every address and its
-- timing cannot tell an address with a login from one without. The fix round's Task H; the
-- owner's answer 13, on #4 (and #3).
do $$
declare made uuid;
begin
  insert into auth.users (email, encrypted_password) values ('pw-new@test.invalid', '$2a$10$abcdefghijklmnopqrstuv') returning id into made;
  if (select encrypted_password from auth.users where id = made) is distinct from '' then raise exception 'a login was made holding a password'; end if;
  update auth.users set encrypted_password = '$2a$10$abcdefghijklmnopqrstuv' where id = made;
  if (select encrypted_password from auth.users where id = made) is distinct from '' then raise exception 'a password was set on a login'; end if;
  -- Nothing else about a login is held back.
  update auth.users set email = 'pw-renamed@test.invalid' where id = made;
  if (select email from auth.users where id = made) is distinct from 'pw-renamed@test.invalid' then raise exception 'the guard held back more than a password'; end if;
end $$;
