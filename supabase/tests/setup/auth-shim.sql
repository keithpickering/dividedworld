-- The harness's stand-in for what Supabase provides before any migration runs: the three API
-- roles the grants name, the auth schema the foreign keys point at, and auth.uid(), which
-- Supabase implements by reading the JWT claims its gateway sets. An assertion file
-- impersonates a caller with `set local role authenticated` and
-- `select set_config('request.jwt.claims', '{"sub":"<uuid>"}', true)`, both scoped to the
-- transaction tools/test-sql.mjs wraps each file in, as PostgREST does it. Nothing here is
-- applied to a real project. Carried from currents (docs/plans/port-manifest.md).
--
-- Only what the migrations and assertions need is here. A stand-in for another thing Supabase
-- provides (pg_cron, storage) is added beside the migration that first needs it.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);

-- `->>` yields text, and a SQL function declared to return uuid cannot coerce that itself.
create or replace function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

-- No claim set means no role decided yet, not anon by default: a test that forgot to
-- impersonate anybody must not read as an anon test and pass for the wrong reason.
create or replace function auth.role() returns text language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '')
$$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

grant usage on schema auth, extensions to anon, authenticated, service_role;

-- The harness connects as the superuser, which bypasses row-level security outright. A test
-- that forgets `set local role` before checking what a caller can see passes for the wrong
-- reason, silently. Call this first in any assertion whose result depends on a policy.
create or replace function auth.assert_impersonating() returns void language plpgsql as $$
begin
  if current_user = 'postgres' or (select rolsuper from pg_roles where rolname = current_user) then
    raise exception 'an RLS assertion is running as a superuser; set local role first';
  end if;
end;
$$;

-- Supabase grants, by default, everything on every object the postgres role creates in
-- public to the three API roles. Bare Postgres has none of it, so a grant a migration forgets
-- to revoke would be invisible here and real on the project. Modeled, it is visible; row-level
-- security is still what keeps anon and authenticated out of the tables, as on the project.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
