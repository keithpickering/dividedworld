-- Registration and characters: invites, the account a login opens, and a character made with a
-- class.
--
-- Task 14 of docs/plans/2026-10-28-core-loop-engine-plan.md; the design's sections 8 and 11.
-- registrationMode is open, invite or closed. Supabase Auth makes the login: the account Edge
-- Function asks it to after it has answered, so the answer is the same for an address with an
-- account and one without (supabase/functions/account/core.ts). The login then opens its
-- KayfaBB account itself, with the invite it signed up with, at its first sign-in; that is when
-- an invite is spent, so a code given for an address nobody confirms is never wasted.
--
-- No login is stuck without an account: open_account() can be called again with another
-- invite, and the inviter can send an unused invite again or make another. While registration
-- is closed the way out is an admin's: seeding registrationMode open or invite again
-- (seed_instance, 0004), after which the login opens its account at its next sign-in. A login
-- with no account can do nothing else here: every action needs a character, and a character
-- needs an account.
--
-- An invite is a random code the inviter hands to a friend themselves; only its hash is stored
-- here, so a read of this table gives no code that opens anything. The login that signed up
-- with a code also carries it in its own Auth metadata, readable by that login alone; it stays
-- there after the invite is spent, when it opens nothing.

create table invites (
  id bigint generated always as identity primary key,
  code_hash text not null unique,
  inviter uuid not null references accounts (id),
  created_at timestamptz not null default now(),
  used_by uuid unique references accounts (id),
  used_at timestamptz,
  check ((used_by is null) = (used_at is null))
);
create index invites_inviter on invites (inviter, created_at);

create function invite_hash(code text) returns text
language sql immutable set search_path = public, extensions, pg_temp as $$
  select encode(extensions.digest(convert_to(code, 'UTF8'), 'sha256'), 'hex')
$$;

create function invite_code() returns text
language sql volatile set search_path = public, extensions, pg_temp as $$
  select translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_')
$$;

create function signed_in_account() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare caller uuid := auth.uid();
begin
  if caller is null or not exists (select 1 from accounts where id = caller) then
    raise exception 'sign in with an account first' using hint = 'kayfabb.refusal', errcode = '28000';
  end if;
  return caller;
end $$;

-- Make an invite: its code, shown to the inviter this once.
create function create_invite() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  code text := invite_code();
  made bigint;
begin
  insert into invites (code_hash, inviter) values (invite_hash(code), caller) returning id into made;
  return jsonb_build_object('invite', made, 'code', code);
end $$;

-- Whether an invite reads as used to its inviter: once a settlement has run past the moment its
-- account opened (the owner's answer 17, on #4), never to the minute, since a mask that appears
-- just after an invite's use would point at the friend it was given to. Who used it, and when,
-- the inviter never reads.
create function invite_shown_used(used_at timestamptz) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select used_at is not null and used_at < coalesce((select max(ends_at) from settlements), '-infinity')
$$;

-- What an inviter sees of their invites: whether each is used, as invite_shown_used() reads it.
create view my_invites as
  select i.id, i.created_at, i.used_at is not null and i.used_at < coalesce((select max(ends_at) from settlements), '-infinity') as used
  from invites i where i.inviter = auth.uid();

-- Send an unused invite again: the same invite with a new code, the old code dead. The way out
-- of an invite whose code was lost. One whose use the settlement has not yet shown answers as an
-- unused one does, so the answer never shows its use early; its new code opens nothing, as the
-- invite is spent, and the next settlement shows it used.
create function reissue_invite(invite bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  code text := invite_code();
begin
  update invites set code_hash = invite_hash(code) where id = invite and inviter = caller and not invite_shown_used(used_at);
  if not found then raise exception 'you have no unused invite %', invite using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  return jsonb_build_object('invite', invite, 'code', code);
end $$;

-- Whether a code would open an account now, for the sign-up answer: 'opens', 'closed' (no code
-- opens one), or 'nothing' (this code opens nothing). Says nothing of any address.
create function invite_open(code text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case setting('registrationMode') #>> '{}'
    when 'open' then 'opens'
    when 'invite' then case when exists (select 1 from invites where code_hash = invite_hash(coalesce(code, '')) and used_by is null) then 'opens' else 'nothing' end
    else 'closed' end
$$;

-- The caller's login opens its account, spending the invite where registration needs one. A
-- login that already has its account changes nothing, so a client may call this at every
-- sign-in.
create function open_account(code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := auth.uid();
  mode text := setting('registrationMode') #>> '{}';
  spent bigint;
begin
  if caller is null or not exists (select 1 from auth.users where id = caller) then
    raise exception 'sign in first' using hint = 'kayfabb.refusal', errcode = '28000';
  end if;
  -- One opening per login at a time, so a double submit opens it once and the second says so.
  perform pg_advisory_xact_lock(hashtext('kayfabb.open_account'), hashtext(caller::text));
  if exists (select 1 from accounts where id = caller) then return jsonb_build_object('account', caller, 'opened', false); end if;
  if mode = 'closed' then raise exception 'registration is closed' using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  if mode = 'invite' then
    -- Locked, and read again once a racing login lets go of it: the second finds it spent.
    select id into spent from invites where code_hash = invite_hash(coalesce(code, '')) and used_by is null for update;
    if spent is null then raise exception 'that invite opens nothing' using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  end if;
  insert into accounts (id) values (caller);
  if spent is not null then update invites set used_by = caller, used_at = now() where id = spent; end if;
  return jsonb_build_object('account', caller, 'opened', true);
end $$;

-- Make a character, with its first class: held to the cap (characters_within_cap, 0001), to a
-- name nobody holds whatever its case or script (name_key, 0011), and to a class the instance has. It waits to debut at the
-- next settlement (characters.debuted_at, 0001), which is its way out.
create function create_character(name text, class text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  named text := btrim(name, ' ');
  made uuid;
begin
  if named is null or char_length(named) not between 1 and 40 then
    raise exception 'a name is 1 to 40 characters' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A name nobody's can be made to look like: unique whatever its case or script (0011), and holding no
  -- invisible, control or direction character and no space but a single one. The same set as
  -- engine/rules/actions.ts's NAME_HIDDEN.
  if named ~ '[\u0001-\u001f\u007f-\u00a0\u00ad\u034f\u061c\u115f\u1160\u1680\u17b4\u17b5\u180b-\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\u2800\U0001d173-\U0001d17a\U000e0000-\U000e0fff]' or named like '%  %' then
    raise exception 'a name can hold letters, marks, digits, symbols and single spaces, nothing hidden' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if not exists (select 1 from class_kinds where key = class) then
    raise exception 'there is no class "%"', class using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  begin
    insert into characters (owner, name) values (caller, named) returning id into made;
  exception when unique_violation then
    raise exception 'that name is taken' using hint = 'kayfabb.refusal', errcode = '23505';
  end;
  insert into class_history (character, class_key, started_at) values (made, class, (select created_at from characters where id = made));
  return jsonb_build_object('id', made, 'name', named, 'class', class, 'waiting', true);
end $$;

alter table invites enable row level security;
revoke all on invites, my_invites from anon, authenticated;
grant select on my_invites to authenticated;

revoke execute on function invite_hash(text), invite_code(), signed_in_account(), invite_shown_used(timestamptz), create_invite(), reissue_invite(bigint),
  invite_open(text), open_account(text), create_character(text, text) from public, anon, authenticated;
grant execute on function create_invite(), reissue_invite(bigint), open_account(text), create_character(text, text) to authenticated;
grant execute on function invite_open(text) to service_role;
