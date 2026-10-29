-- Registration and characters (supabase/migrations/0009_registration.sql). Plan Task 14.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- A login Supabase Auth made, with no account yet.
create function pg_temp.login(email text) returns uuid language plpgsql as $$
declare made uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (made, email);
  return made;
end $$;

-- ---- An invite opens one account, once; the inviter sees theirs and can send one again ----
do $$
declare
  ann uuid := tests.account('reg-ann');
  newcomer uuid := pg_temp.login('reg-new@test.invalid');
  second uuid := pg_temp.login('reg-second@test.invalid');
  code text;
  fresh text;
  invite bigint;
  why text;
begin
  perform tests.become(ann);
  code := create_invite() ->> 'code';
  if code is null or length(code) < 16 then raise exception 'an invite is a code long enough not to guess: %', code; end if;
  select id into invite from invites;
  if (select count(*) from invites) <> 1 then raise exception 'the inviter sees their invite'; end if;
  perform tests.unbecome();
  if exists (select 1 from invites where code_hash = code or code_hash like '%' || code || '%') then raise exception 'an invite''s code is stored, not its hash'; end if;

  -- The register function asks whether a code would open an account; it says nothing of any address.
  perform tests.become_service();
  if invite_open(code) <> 'opens' then raise exception 'a fresh invite should open an account'; end if;
  if invite_open('not-a-code') <> 'nothing' or invite_open(null) <> 'nothing' then raise exception 'a code nobody made opens nothing'; end if;
  perform tests.unbecome();

  -- Sent again: the same invite, a new code; the old one is dead.
  perform tests.become(ann);
  fresh := reissue_invite(invite) ->> 'code';
  perform tests.unbecome();
  if fresh = code then raise exception 'an invite sent again has a new code'; end if;
  perform tests.become_service();
  if invite_open(code) <> 'nothing' then raise exception 'the old code still opens an account'; end if;
  perform tests.unbecome();

  -- A login opens its account with the invite, which is then spent.
  perform tests.become(newcomer);
  why := pg_temp.refusal(format('select open_account(%L)', code));
  if why is distinct from 'that invite opens nothing' then raise exception 'a dead code opened an account: %', why; end if;
  if (open_account(fresh) ->> 'opened')::boolean is not true then raise exception 'the invite should open the account'; end if;
  if (open_account(null) ->> 'opened')::boolean is not false then raise exception 'opening an account already open is no change, and no error'; end if;
  perform tests.unbecome();
  if not exists (select 1 from accounts where id = newcomer) then raise exception 'the account is opened'; end if;
  if (select used_by from invites where id = invite) <> newcomer then raise exception 'the invite is spent'; end if;
  perform tests.become(second);
  if pg_temp.refusal(format('select open_account(%L)', fresh)) is distinct from 'that invite opens nothing' then raise exception 'a spent invite opened a second account'; end if;
  perform tests.unbecome();

  -- A used invite cannot be sent again; nor can another player's.
  perform tests.become(ann);
  if pg_temp.refusal(format('select reissue_invite(%s)', invite)) is null then raise exception 'a used invite was sent again'; end if;
  perform tests.unbecome();
  perform tests.become(newcomer);
  if exists (select 1 from invites) then raise exception 'a player read an invite that is not theirs'; end if;
  perform tests.unbecome();
  -- Another player's unused invite is not theirs to send again.
  perform tests.become(ann);
  invite := (create_invite() ->> 'invite')::bigint;
  perform tests.unbecome();
  perform tests.become(newcomer);
  if pg_temp.refusal(format('select reissue_invite(%s)', invite)) is null then raise exception 'a player sent another''s invite again'; end if;
  perform tests.unbecome();
  -- The inviter sees whether an invite is used, never who used it or when: a mask that appears
  -- just after an invite's use would point at the friend.
  perform tests.become(ann);
  if pg_temp.refusal('select used_by from invites') is null then raise exception 'the inviter read who used an invite'; end if;
  if pg_temp.refusal('select used_at from invites') is null then raise exception 'the inviter read when an invite was used'; end if;
  if pg_temp.refusal('select code_hash from invites') is null then raise exception 'the inviter read an invite''s hash'; end if;
  if (select count(*) from invites where used) <> 1 then raise exception 'the inviter sees which invites are used'; end if;
  perform tests.unbecome();
end $$;

-- ---- Open registration needs no invite; closed registration opens nothing ----
do $$
declare
  open_one uuid := pg_temp.login('reg-open@test.invalid');
  shut_one uuid := pg_temp.login('reg-shut@test.invalid');
begin
  update settings set value = '"open"' where key = 'registrationMode';
  perform tests.become_service();
  if invite_open(null) <> 'opens' then raise exception 'open registration opens for any code'; end if;
  perform tests.unbecome();
  perform tests.become(open_one);
  if (open_account(null) ->> 'opened')::boolean is not true then raise exception 'open registration needs no invite'; end if;
  perform tests.unbecome();
  update settings set value = '"closed"' where key = 'registrationMode';
  perform tests.become_service();
  if invite_open(null) <> 'closed' or invite_open('anything') <> 'closed' then raise exception 'closed registration opens nothing, and says so'; end if;
  perform tests.unbecome();
  perform tests.become(shut_one);
  if coalesce(pg_temp.refusal('select open_account(null)'), '') not like '%closed%' then raise exception 'closed registration should say so'; end if;
  perform tests.unbecome();
  -- A login whose account is open signs in as before while registration is closed.
  perform tests.become(open_one);
  if (open_account(null) ->> 'opened')::boolean is not false then raise exception 'closing registration shut out an open account'; end if;
  perform tests.unbecome();
  update settings set value = '"invite"' where key = 'registrationMode';
end $$;

-- ---- A character is made with a class, held to the cap: a seventh is refused ----
do $$
declare
  cat uuid := tests.account('reg-cat');
  made jsonb;
  why text;
begin
  perform tests.become(cat);
  for i in 1..6 loop
    made := create_character(format('Mask %s', i), 'alpha');
  end loop;
  if made ->> 'class' <> 'alpha' or made ->> 'name' <> 'Mask 6' then raise exception 'a character made: %', made; end if;
  why := pg_temp.refusal($q$select create_character('Mask 7', 'alpha')$q$);
  if why is null then raise exception 'a seventh character was made'; end if;
  if why not like '%6%' then raise exception 'the refusal should say what the cap is: %', why; end if;
  perform tests.unbecome();
  if (select count(*) from characters where owner = cat) <> 6 then raise exception 'six characters, no more'; end if;
  if (select count(*) from class_history h join characters c on c.id = h.character where c.owner = cat) <> 6 then raise exception 'each has its first class'; end if;
  perform tests.become(tests.account('reg-dan'));
  if pg_temp.refusal($q$select create_character('mask 1', 'beta')$q$) is distinct from 'that name is taken' then raise exception 'a name is one per instance, whatever its case'; end if;
  if pg_temp.refusal($q$select create_character('Nobody', 'ghost')$q$) is null then raise exception 'a character with no class'; end if;
  if pg_temp.refusal($q$select create_character('   ', 'beta')$q$) is null then raise exception 'a character with no name'; end if;
  if pg_temp.refusal(format('select create_character(%L, %L)', repeat('n', 41), 'beta')) is null then raise exception 'a name past 40 characters'; end if;
  -- A name another's cannot be made to look like: no invisible, control or direction characters, no space but a single one.
  foreach why in array array['Mas' || chr(8203) || 'k 1', 'Mask' || chr(160) || '1', 'Mask  1', 'Mask' || chr(8238) || '1', 'Mask' || chr(9) || '1', 'Mask' || chr(65279) || '1'] loop
    if coalesce(pg_temp.refusal(format('select create_character(%L, %L)', why, 'beta')), '') not like '%can hold%' then raise exception 'a name with a hidden character: %', why; end if;
  end loop;
  if (create_character(' Spaced Name ', 'beta') ->> 'name') <> 'Spaced Name' then raise exception 'a name is trimmed'; end if;
  perform tests.unbecome();
  -- A login with no account makes no character and no invite.
  perform tests.become(pg_temp.login('reg-none@test.invalid'));
  if pg_temp.refusal($q$select create_character('Lost', 'alpha')$q$) is null then raise exception 'a login with no account made a character'; end if;
  if pg_temp.refusal('select create_invite()') is null then raise exception 'a login with no account made an invite'; end if;
  perform tests.unbecome();
end $$;

-- ---- Two logins opening accounts with one invite at once: one opens, the other is refused in words ----
do $$
declare
  ann uuid := gen_random_uuid(); x uuid := gen_random_uuid(); y uuid := gen_random_uuid();
  said text[];
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'race-inv-a@test.invalid'), (%2$L, 'race-inv-x@test.invalid'), (%3$L, 'race-inv-y@test.invalid');
    insert into accounts (id) values (%1$L);
    insert into invites (code_hash, inviter) values (invite_hash('race-code'), %1$L);
  $sql$, ann, x, y));
  said := tests.race_as(x, 'select open_account(''race-code'')', y, 'select open_account(''race-code'')');
  if (said[1] is null) = (said[2] is null) then raise exception 'exactly one should open: %', said; end if;
  if coalesce(said[1], said[2]) <> 'that invite opens nothing' then raise exception 'the loser should be refused in words: %', said; end if;
  if (select count(*) from accounts where id in (x, y)) <> 1 then raise exception 'one invite opened two accounts'; end if;
end $$;

-- ---- One login opening its account twice at once (a double submit): it opens once, and both say so plainly ----
do $$
declare
  ann uuid := gen_random_uuid(); z uuid := gen_random_uuid();
  said text[];
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'race-twice-a@test.invalid'), (%2$L, 'race-twice-z@test.invalid');
    insert into accounts (id) values (%1$L);
    insert into invites (code_hash, inviter) values (invite_hash('twice-code'), %1$L);
  $sql$, ann, z));
  said := tests.race_as(z, 'select open_account(''twice-code'')', z, 'select open_account(''twice-code'')');
  if said[1] is not null or said[2] is not null then raise exception 'a login opening its account twice at once was refused: %', said; end if;
  if (select count(*) from accounts where id = z) <> 1 then raise exception 'the account is opened once'; end if;
end $$;
