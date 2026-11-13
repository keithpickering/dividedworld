-- A banned account's address cannot get a fresh, unbarred account by signing up again (the conduct plan; the owner's answer, "A ban that a fresh sign-up
-- undoes is not a ban"). An account is keyed by its Auth login (accounts.id references auth.users), and one address is one login, so signing up again with a
-- banned address is signing in as the login that already has the barred account: open_account hands back that account, opens no other, in every
-- registration mode, and the account stays barred at every writer. The login cannot be deleted to start over either, since an account is never deleted and
-- the reference refuses it. What Auth says to the address, and the account function's answers, are in supabase/functions/account/core.test.ts.
--
-- The poison, driven red once on the schema before the check was trusted:
--   * accounts.id's reference to auth.users dropped (so a login could be deleted and the address made new) must fail "the barred account's login was deleted".

create function tests.refusal(stmt text) returns text language plpgsql as $$
declare state text; hint text; msg text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics state = returned_sqlstate, hint = pg_exception_hint, msg = message_text;
  return state || '|' || coalesce(hint, '') || '|' || msg;
end $$;
grant execute on function tests.refusal(text) to authenticated, anon;

create function tests.claims(account uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', account, 'role', 'authenticated')::text, true);
end $$;

do $$
declare
  admin_a uuid := tests.account('admin-a');
  banned uuid;
  ch uuid;
  mode text;
  got jsonb;
  seen text;
  before_count bigint;
begin
  insert into admins (account) values (admin_a);
  insert into settings (key, value) values ('registrationMode', '"open"') on conflict (key) do update set value = excluded.value;
  insert into auth.users (email) values ('banned-address@test.invalid') returning id into banned;
  perform tests.claims(banned);
  got := open_account(null);
  if (got ->> 'opened')::boolean is not true then raise exception 'the account should open: %', got; end if;
  ch := tests.character(banned, 'Ban Bait');
  perform tests.become(admin_a);
  perform decide(banned, null, 'ban', null, 'for the test');
  perform tests.unbecome();
  select count(*) into before_count from accounts;

  -- Signing up again, in each mode a sign-up can find the instance in, is the same login with the same barred account, and no other account opens.
  foreach mode in array array['open', 'invite', 'closed'] loop
    update settings set value = to_jsonb(mode) where key = 'registrationMode';
    perform tests.claims(banned);
    got := open_account('anything');
    if got ->> 'account' is distinct from banned::text or (got ->> 'opened')::boolean is not false then
      raise exception 'a banned address signing up again (%) got % rather than its barred account', mode, got;
    end if;
    if (select count(*) from accounts) is distinct from before_count then raise exception 'a banned address opened another account (%)', mode; end if;
    if (select count(*) from accounts a join auth.users u on u.id = a.id where u.email = 'banned-address@test.invalid') is distinct from 1 then
      raise exception 'one address holds more than one account (%)', mode;
    end if;
    seen := tests.refusal('select signed_in_account()');
    if seen is null or seen not like '28000|kayfabb.barred|%banned%' then raise exception 'the account is not barred after signing up again (%): %', mode, seen; end if;
    seen := tests.refusal(format('select played_by(%L, %L)', ch, banned));
    if seen is null or seen not like '28000|kayfabb.barred|%banned%' then raise exception 'the barred account''s character acted after signing up again (%): %', mode, seen; end if;
  end loop;

  -- The login cannot be deleted so the address can make a new one: an account is never deleted, and it holds its login.
  seen := tests.refusal(format('delete from auth.users where id = %L', banned));
  if seen is null or seen not like '23503|%' then raise exception 'the barred account''s login was deleted: %', seen; end if;
  if not exists (select 1 from accounts where id = banned) then raise exception 'the barred account is gone'; end if;
end $$;
