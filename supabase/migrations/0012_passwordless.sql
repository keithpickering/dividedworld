-- Sign-in is passwordless (the owner's answer 13, on #4 and #3): a player signs in with a code
-- or link sent by email (supabase/functions/account/core.ts), and no login holds a password.
-- Supabase Auth has no setting that turns its password sign-in off on its own
-- (supabase/config.toml), so this holds it off where the password would live: a login's
-- password hash is kept empty, whoever writes one (a sign-up through Auth's own endpoint, a
-- player setting one through Auth's /user). Password sign-in then fails alike for every
-- address, and there is no password whose checking takes longer for an address with a login.
-- Whether Auth's own code request takes the same time for an address it knows is measured once,
-- on the owner's test project, and its result goes on #3.
create function auth_no_password() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.encrypted_password := '';
  return new;
end $$;
create trigger no_password before insert or update of encrypted_password on auth.users
  for each row execute function auth_no_password();

revoke execute on function auth_no_password() from public, anon, authenticated;
