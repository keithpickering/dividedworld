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
  -- Supabase Auth's column for a login's password hash, empty for one with none.
  encrypted_password varchar(255),
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

-- pg_cron, pg_net and Vault stand-ins, so 0004 runs its real SQL here. Bare Postgres has none of
-- the three; a Supabase project has all three. They record what a job would do rather than
-- doing it, and supabase/tests/0008-schedule.sql reads the record. Carried from currents.
create schema if not exists cron;
create table if not exists cron.job (jobid bigint generated always as identity primary key, jobname text unique, schedule text, command text, active boolean default true);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language plpgsql as $$
declare v bigint;
begin
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid into v;
  return v;
end $$;
-- url is `not null` on the real extension's queue, so a call with a missing secret fails here
-- the way it fails there.
create schema if not exists net;
create table if not exists net.http_request_queue (
  id bigint generated always as identity primary key,
  method text not null default 'POST', url text not null, headers jsonb, body jsonb, timeout_milliseconds integer
);
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 2000) returns bigint language plpgsql as $$
declare v bigint;
begin
  insert into net.http_request_queue (url, headers, body, timeout_milliseconds) values (url, headers, body, timeout_milliseconds) returning id into v;
  return v;
end $$;
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (name text primary key, decrypted_secret text);

-- Realtime's stand-ins, so 0008 runs its real SQL here: the publication Supabase makes at a
-- project's start, and the table its private channels authorize against.
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
end $$;
create schema if not exists realtime;
create table if not exists realtime.messages (
  id bigint generated always as identity primary key,
  topic text not null,
  extension text not null default 'broadcast',
  payload jsonb,
  event text,
  private boolean default true,
  inserted_at timestamptz not null default now()
);
create or replace function realtime.topic() returns text language sql stable as $$
  select nullif(current_setting('realtime.topic', true), '')
$$;
grant usage on schema realtime to anon, authenticated, service_role;
-- As on a project: the API roles may read it, and row-level security decides what they hear.
grant select on realtime.messages to anon, authenticated;
alter table realtime.messages enable row level security;

-- Storage's bucket table, as much of it as 0019_profiles.sql writes, so the avatars bucket it makes
-- is made here too and supabase/tests/e2e/0006-avatar-bucket.ts holds it to what it should be.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
-- And its objects table, row-level security on as Supabase ships it, so that a policy a migration
-- writes on it is there for e2e/0006 to read: the avatars bucket is public by URL, and no policy
-- may let anyone list it (supabase/migrations/0025_avatars.sql).
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  metadata jsonb
);
alter table storage.objects enable row level security;
