-- Invites with a cap and an expiry, and admins. The screens' engine plan, Task 8; the screens'
-- design, section 12: a player holds invitesPerPlayer open invites at a time (three), each open
-- for inviteLifetime (seven days); an admin holds any number. This adds the cap issue #4's
-- question 14 left for later.
--
-- An open invite is one not yet shown used (invite_shown_used, 0009) and not expired. The cap
-- counts by what the inviter is shown, never by what happened: an invite a friend used an hour
-- ago still counts until the settlement shows it used, so making one more never says a friend has
-- just signed up. An expired code is refused in the words an unknown code is, by the same query,
-- so nobody holding a code learns it once opened something. Ways out: an expired invite is
-- reissued for another lifetime; a player at the cap waits for an invite to be used (and shown so)
-- or to expire, or reissues one that expired.
--
-- An admin is an account the service lists in `admins`: an operator's act, written by hand or by a
-- tool, never by a player. Only is_admin() reads it, and only for the caller.

create table admins (
  account uuid primary key references accounts (id),
  added_at timestamptz not null default now()
);

create function is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from admins where account = auth.uid())
$$;

-- The spans now include an invite's lifetime (0007's settings_spans_hold, with one more key).
create or replace function settings_spans_hold() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.key in ('settlementLength', 'seasonLength', 'turnCooldown', 'inviteLifetime') and not (
       jsonb_typeof(new.value) = 'object' and new.value ->> 'unit' in ('day', 'week', 'month')
       and jsonb_typeof(new.value -> 'count') = 'number' and (new.value ->> 'count')::numeric >= 1
       and (new.value ->> 'count')::numeric <= 1000
       and (new.value ->> 'count')::numeric = trunc((new.value ->> 'count')::numeric)) then
    raise exception '% is a span: a unit of day, week or month and a whole count from 1 to 1000', new.key using errcode = '23514';
  end if;
  return new;
end $$;

-- How long an invite opens for: the setting, or, for the backfill below on an instance not yet
-- seeded with it, a week. The cap has no such fallback: an instance seeded before this migration
-- holds no invitesPerPlayer until it is seeded again, which every deploy does, and until then
-- create_invite says the setting is not set rather than guess a cap.
create function invite_lifetime() returns interval
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(span_interval((select value from settings where key = 'inviteLifetime')), interval '7 days')
$$;

-- Every invite made before this migration opens for a whole lifetime from now, so none dies the
-- day the cap arrives.
alter table invites add column expires_at timestamptz;
update invites set expires_at = now() + invite_lifetime();
alter table invites alter column expires_at set not null, alter column expires_at set default now() + invite_lifetime();

-- A cap is a whole number of invites, at least one, held so when it is written.
create function settings_invites_hold() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.key = 'invitesPerPlayer' and not (jsonb_typeof(new.value) = 'number' and (new.value #>> '{}')::numeric >= 1
       and (new.value #>> '{}')::numeric = trunc((new.value #>> '{}')::numeric) and (new.value #>> '{}')::numeric <= 2147483647) then
    raise exception 'invitesPerPlayer is a whole number, at least 1' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger settings_invites_hold before insert or update on settings for each row execute function settings_invites_hold();

-- Whether an invite is open to its inviter: not shown used, and not expired.
create function invite_open_for_inviter(used_at timestamptz, expires_at timestamptz) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select not invite_shown_used(used_at) and expires_at > now()
$$;

-- The caller may hold one more open invite: an admin always, a player under the cap. The caller's
-- account is locked, so two at once cannot both read a count under it.
create function invite_room(caller uuid, besides bigint default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  most integer := (setting('invitesPerPlayer'))::integer;
  held integer;
begin
  if exists (select 1 from admins where account = caller) then return; end if;
  perform 1 from accounts where id = caller for no key update;
  select count(*) into held from invites i where i.inviter = caller and i.id is distinct from besides and invite_open_for_inviter(i.used_at, i.expires_at);
  if held >= most then
    raise exception 'you hold % open invites, the most there are: one used or expired frees one', most using hint = 'kayfabb.refusal', errcode = 'P0001';
  end if;
end $$;

-- create_invite (0009), held to the cap, with an expiry.
create or replace function create_invite() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  code text := invite_code();
  made bigint;
begin
  perform invite_room(caller);
  insert into invites (code_hash, inviter, expires_at) values (invite_hash(code), caller, now() + invite_lifetime()) returning id into made;
  return jsonb_build_object('invite', made, 'code', code);
end $$;

-- reissue_invite (0009): a new code and a fresh lifetime. An expired invite reissued is one more
-- open invite, so it is held to the cap; an open one keeps its place.
create or replace function reissue_invite(invite bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  code text := invite_code();
  was invites%rowtype;
begin
  select * into was from invites where id = invite and inviter = caller and not invite_shown_used(used_at) for update;
  if was.id is null then raise exception 'you have no unused invite %', invite using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if was.expires_at <= now() then perform invite_room(caller, invite); end if;
  update invites set code_hash = invite_hash(code), expires_at = now() + invite_lifetime() where id = invite;
  return jsonb_build_object('invite', invite, 'code', code);
end $$;

-- invite_open (0009): an expired code is refused as an unknown one is, by the same lookup.
create or replace function invite_open(code text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case setting('registrationMode') #>> '{}'
    when 'open' then 'opens'
    when 'invite' then case when exists (select 1 from invites where code_hash = invite_hash(coalesce(code, '')) and not invite_shown_used(used_at) and expires_at > now()) then 'opens' else 'nothing' end
    else 'closed' end
$$;

-- open_account (0009): an expired invite opens nothing, in the same words.
create or replace function open_account(code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := auth.uid();
  mode text := setting('registrationMode') #>> '{}';
  spent bigint;
begin
  if caller is null or not exists (select 1 from auth.users where id = caller) then
    raise exception 'sign in first' using hint = 'kayfabb.refusal', errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtext('kayfabb.open_account'), hashtext(caller::text));
  if exists (select 1 from accounts where id = caller) then return jsonb_build_object('account', caller, 'opened', false); end if;
  if mode = 'closed' then raise exception 'registration is closed' using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  if mode = 'invite' then
    select id into spent from invites where code_hash = invite_hash(coalesce(code, '')) and used_by is null and expires_at > now() for update;
    if spent is null then raise exception 'that invite opens nothing' using hint = 'kayfabb.refusal', errcode = 'P0001'; end if;
  end if;
  insert into accounts (id) values (caller);
  if spent is not null then update invites set used_by = caller, used_at = now() where id = spent; end if;
  return jsonb_build_object('account', caller, 'opened', true);
end $$;

-- What an inviter sees of their invites (0009's my_invites), with when each stops opening and
-- whether it has. An invite shown used is never shown expired. Used is invite_shown_used() written
-- out, as 0009 writes it: a view calls a function with its caller's privileges.
drop view my_invites;
create view my_invites as
  select i.id, i.created_at, s.used, case when s.used then null else i.expires_at end as expires_at, not s.used and i.expires_at <= now() as expired
  from invites i
  cross join lateral (select i.used_at is not null and i.used_at < coalesce((select max(ends_at) from settlements), '-infinity') as used) s
  where i.inviter = auth.uid();

alter table admins enable row level security;
revoke all on admins, my_invites from anon, authenticated;
grant select on my_invites to authenticated;

revoke execute on function invite_lifetime(), invite_open_for_inviter(timestamptz, timestamptz), invite_room(uuid, bigint), settings_invites_hold() from public, anon, authenticated;
revoke execute on function is_admin() from public, anon;
grant execute on function is_admin() to authenticated;
