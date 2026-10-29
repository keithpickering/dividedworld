-- Invites with a cap and an expiry, and admins (supabase/migrations/0020_admins_invites.sql): a
-- player holds at most invitesPerPlayer open invites, an admin any number; an invite opens for
-- inviteLifetime, and an expired code is refused in the words an unknown one is; a reissue opens it
-- for another lifetime. The cap counts an invite as used only once a settlement shows it used, so
-- making a fourth never says a friend has just signed up. The screens' engine plan, Task 8.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  ann uuid := tests.account('cap-ann');
  boss uuid := tests.account('cap-admin');
  newcomer uuid := gen_random_uuid();
  codes text[] := '{}';
  why text;
  expired_one bigint;
  first_used bigint;
  open_one bigint;
  fresh text;
begin
  insert into auth.users (id, email) values (newcomer, 'cap-new@test.invalid');
  perform tests.become(ann);
  for i in 1..3 loop codes := codes || (create_invite() ->> 'code'); end loop;
  why := pg_temp.refusal('select create_invite()');
  if why is distinct from 'you hold 3 open invites, the most there are: one used or expired frees one' then raise exception 'a fourth open invite: %', why; end if;
  perform tests.unbecome();

  -- An admin holds any number.
  insert into admins (account) values (boss);
  perform tests.become(boss);
  for i in 1..5 loop perform create_invite(); end loop;
  if (select count(*) from my_invites) is distinct from 5::bigint then raise exception 'an admin makes as many invites as they like'; end if;
  perform tests.unbecome();

  -- A friend opens an account with one: until a settlement shows it used, it still counts, so the
  -- inviter learns nothing early. Its use is set after the last settled end, wherever an earlier
  -- file's committed race left that.
  perform tests.become(newcomer);
  perform open_account(codes[1]);
  perform tests.unbecome();
  update invites set used_at = coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons)) + interval '1 hour' where used_by = newcomer;
  perform tests.become(ann);
  if pg_temp.refusal('select create_invite()') is null then raise exception 'a use the settlement has not shown freed an invite'; end if;
  perform tests.unbecome();
  perform set_config('role', 'service_role', true);
  perform apply_settlement(coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons)),
    coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons)) + interval '1 day', '[]');
  perform tests.unbecome();
  -- Shown used, it frees a place: this makes Ann's third open invite.
  perform tests.become(ann);
  if pg_temp.refusal('select create_invite()') is not null then raise exception 'a use the settlement has shown frees an invite'; end if;
  perform tests.unbecome();

  -- An expired invite reads as an unknown code, and frees a place. Alike in time too: both are
  -- refused by one lookup, the expiry one more condition on the row it finds or does not.
  -- (Ann holds codes[2], codes[3] and the one just made.)
  update invites set expires_at = now() - interval '1 minute' where code_hash = invite_hash(codes[2]);
  perform tests.become_service();
  if invite_open(codes[2]) is distinct from invite_open('never-made') or invite_open(codes[2]) is distinct from 'nothing' then raise exception 'an expired code reads unlike an unknown one'; end if;
  if invite_open(codes[3]) is distinct from 'opens' then raise exception 'an unexpired code opens'; end if;
  perform tests.unbecome();
  insert into auth.users (id, email) values (gen_random_uuid(), 'cap-late@test.invalid');
  perform tests.become((select id from auth.users where email = 'cap-late@test.invalid'));
  why := pg_temp.refusal(format('select open_account(%L)', codes[2]));
  if why is distinct from pg_temp.refusal(format('select open_account(%L)', 'never-made')) then raise exception 'opening with an expired code says something an unknown one does not: %', why; end if;
  perform tests.unbecome();
  expired_one := (select id from invites where code_hash = invite_hash(codes[2]));
  open_one := (select id from invites where code_hash = invite_hash(codes[3]));
  perform tests.become(ann);
  if (select expired from my_invites where id = expired_one) is distinct from true then raise exception 'its inviter sees it expired'; end if;
  -- The expired one freed a place: a new one fills it.
  perform create_invite();
  -- At the cap again; a reissue of the expired one would open a fourth, and is refused.
  why := pg_temp.refusal(format('select reissue_invite(%L)', expired_one));
  if why is distinct from 'you hold 3 open invites, the most there are: one used or expired frees one' then raise exception 'a reissue past the cap: %', why; end if;
  -- A reissue of an open one is the same place, and opens for another lifetime.
  fresh := reissue_invite(open_one) ->> 'code';
  if (select expires_at from my_invites where id = open_one) is distinct from now() + interval '7 days' then raise exception 'a reissued invite opens for another seven days: %', (select expires_at from my_invites where id = open_one); end if;
  perform tests.unbecome();
  perform tests.become_service();
  if invite_open(fresh) is distinct from 'opens' then raise exception 'a reissued code opens'; end if;
  perform tests.unbecome();

  -- Under the cap (another of Ann's lapses), the expired one reissued opens again, for a whole
  -- lifetime: its way out.
  update invites set expires_at = now() - interval '1 minute' where id = open_one;
  perform tests.become(ann);
  fresh := reissue_invite(expired_one) ->> 'code';
  if (select (expired, expires_at) from my_invites where id = expired_one) is distinct from (false, now() + interval '7 days') then raise exception 'an expired invite reissued under the cap opens again'; end if;
  perform tests.unbecome();
  perform tests.become_service();
  if invite_open(fresh) is distinct from 'opens' then raise exception 'a reissued expired code opens'; end if;
  perform tests.unbecome();
  -- A cap is a whole number, at least one, when it is written.
  begin
    update settings set value = '0' where key = 'invitesPerPlayer';
    raise exception 'a cap of 0 was written';
  exception when check_violation then null;
  end;

  -- Used, then expired before a settlement shows it used: to its inviter, expired and never used.
  perform tests.become(boss);
  fresh := create_invite() ->> 'code';
  perform tests.unbecome();
  insert into auth.users (id, email) values (gen_random_uuid(), 'cap-quiet@test.invalid');
  perform tests.become((select id from auth.users where email = 'cap-quiet@test.invalid'));
  perform open_account(fresh);
  perform tests.unbecome();
  update invites set used_at = coalesce((select max(ends_at) from settlements), now()) + interval '1 hour', expires_at = now() - interval '1 minute' where code_hash = invite_hash(fresh);
  first_used := (select id from invites where code_hash = invite_hash(fresh));
  perform tests.become(boss);
  if (select (used, expired) from my_invites where id = first_used) is distinct from (false, true) then raise exception 'a use not yet shown showed through an expiry: %', (select to_jsonb(m) from my_invites m where id = first_used); end if;
  perform tests.unbecome();

  -- Who is an admin is the service's to write and the caller's own to ask.
  perform tests.become(ann);
  if is_admin() then raise exception 'a player is not an admin'; end if;
  if pg_temp.refusal(format('insert into admins (account) values (%L)', ann)) is null then raise exception 'a player made themselves an admin'; end if;
  if pg_temp.refusal('select count(*) from admins') is null then raise exception 'a player read who the admins are'; end if;
  perform tests.unbecome();
  perform tests.become(boss);
  if not is_admin() then raise exception 'an admin is one'; end if;
  perform tests.unbecome();
end $$;

-- ---- Two invites made at once at one under the cap: one is made, the other refused ----
do $$
declare
  ann uuid := gen_random_uuid();
  said text[];
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'race-cap@test.invalid');
    insert into accounts (id) values (%1$L);
    insert into invites (code_hash, inviter, expires_at) values (invite_hash('race-cap-1'), %1$L, now() + interval '7 days'), (invite_hash('race-cap-2'), %1$L, now() + interval '7 days');
  $sql$, ann));
  said := tests.race(ann, 'select create_invite()', ann, 'select create_invite()');
  if (said[1] is null) = (said[2] is null) then raise exception 'exactly one of two invites at once is made: %', said; end if;
  if coalesce(said[1], said[2]) is distinct from 'you hold 3 open invites, the most there are: one used or expired frees one' then raise exception 'the other is refused in words: %', said; end if;
  if (select count(*) from invites where inviter = ann) is distinct from 3::bigint then raise exception 'two invites at once passed the cap'; end if;
end $$;
