-- The Director's records: meetings, memory, profile and move bank. The system plan
-- (docs/plans/2026-10-30-the-system-plan.md), Task 6; the system design, sections 4 and 12; the seasonal Boss
-- design, sections 1 and 3-4.
--
-- A meeting is the run in which a Boss reads the digest, remembers, and moves. Everything it keeps is the
-- instance's own bookkeeping and none of it is a client's to read except the in-character profile:
--
--   meetings       one row per finished run, written once (a failed run keeps its whole record: its error, its
--                  bank before and after, the failures in a row), and never changed. Its model calls' rows in
--                  model_calls name it.
--   staff_memory   the Boss's hidden memory, a new version per meeting, never updated; the meeting reads the
--                  latest. It holds opinions of characters, which are read from public play only, and it never
--                  reaches a client ("A response never proves a private fact").
--   staff_profiles the in-character profile, a version per meeting, public through staff_profile_now. It may
--                  bluff ("The fiction may lie"); the memory behind it never reaches a client.
--   move_bank      a Boss's running balance of moves. A counter, not an Act, so it is updated in place as a wallet
--                  is. Nothing but the meeting changes it; bank_now reads it without writing.
--
-- Append-only tables refuse update, delete and truncate, with the triggers `enable always` so a restore with
-- triggers disabled fires them too (as acts_no_update does).
--
-- Its way out: a meeting that failed leaves no player stuck; the next daily meeting is its retry, and an admin
-- can switch The System off (`systemEnabled`).

-- ------------------------------------------------------------------------------------------ meetings ----

create table meetings (
  id bigint generated always as identity primary key,
  started_at timestamptz not null,
  finished_at timestamptz not null check (finished_at >= started_at),
  outcome text not null check (outcome in ('ok', 'rejected', 'failed', 'off')),
  error text,
  bank_before numeric check (bank_before >= 0),
  bank_after numeric check (bank_after >= 0),
  -- Meetings failed in a row up to and including this one: the poison-pill count, only consecutive crashes.
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0)
);
create index meetings_finished on meetings (finished_at desc);
alter table meetings enable row level security;
revoke all on meetings from public, anon, authenticated;

-- model_calls.meeting (0042) named a meeting before meetings existed; it now has its table.
alter table model_calls add constraint model_calls_meeting_fkey foreign key (meeting) references meetings (id);
create index model_calls_meeting on model_calls (meeting) where meeting is not null;

-- --------------------------------------------------------------------------------- staff_memory ----

create table staff_memory (
  id bigint generated always as identity primary key,
  staff text not null references characters (staff),
  meeting bigint not null references meetings (id),
  at timestamptz not null default now(),
  -- engine/system/memory.ts's Memory.
  body jsonb not null check (jsonb_typeof(body) = 'object'),
  -- One version per meeting.
  unique (staff, meeting)
);
-- The latest version per staff member.
create index staff_memory_latest on staff_memory (staff, at desc, id desc);
create index staff_memory_meeting on staff_memory (meeting);
alter table staff_memory enable row level security;
revoke all on staff_memory from public, anon, authenticated;

-- ------------------------------------------------------------------------------- staff_profiles ----

create table staff_profiles (
  id bigint generated always as identity primary key,
  staff text not null references characters (staff),
  meeting bigint not null references meetings (id),
  at timestamptz not null default now(),
  interests text[] not null default '{}',
  -- Character ids the Boss chose to name: public characters, so nothing private. No foreign key on an array.
  favorites uuid[] not null default '{}',
  mood text not null default '',
  signature text not null default '',
  -- One version per meeting.
  unique (staff, meeting)
);
create index staff_profiles_latest on staff_profiles (staff, at desc, id desc);
create index staff_profiles_meeting on staff_profiles (meeting);
alter table staff_profiles enable row level security;
revoke all on staff_profiles from public, anon, authenticated;

-- Each staff member's latest profile, read by everyone. The view runs as its owner, so the table's
-- row-level security does not apply; it carries the profile's public columns only.
create view staff_profile_now as
  select distinct on (p.staff) p.staff, p.at, p.interests, p.favorites, p.mood, p.signature
  from staff_profiles p
  order by p.staff, p.at desc, p.id desc;
revoke all on staff_profile_now from public, anon, authenticated;
grant select on staff_profile_now to anon, authenticated;

-- ------------------------------------------------------------------------------------ append-only ----

create function director_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception '% is never edited or removed (%); write a new row', tg_table_name, tg_op using errcode = 'P0001';
end $$;
revoke execute on function director_append_only() from public, anon, authenticated;

create trigger meetings_no_update before update or delete on meetings for each row execute function director_append_only();
create trigger meetings_no_truncate before truncate on meetings for each statement execute function director_append_only();
create trigger staff_memory_no_update before update or delete on staff_memory for each row execute function director_append_only();
create trigger staff_memory_no_truncate before truncate on staff_memory for each statement execute function director_append_only();
create trigger staff_profiles_no_update before update or delete on staff_profiles for each row execute function director_append_only();
create trigger staff_profiles_no_truncate before truncate on staff_profiles for each statement execute function director_append_only();
alter table meetings enable always trigger meetings_no_update;
alter table meetings enable always trigger meetings_no_truncate;
alter table staff_memory enable always trigger staff_memory_no_update;
alter table staff_memory enable always trigger staff_memory_no_truncate;
alter table staff_profiles enable always trigger staff_profiles_no_update;
alter table staff_profiles enable always trigger staff_profiles_no_truncate;

-- -------------------------------------------------------------------------------------- move_bank ----

-- A Boss's running balance. Updated in place by the meeting that spends from it (a counter row, like `wallets`).
create table move_bank (
  staff text primary key references characters (staff),
  balance numeric not null check (balance >= 0),
  as_of timestamptz not null
);
alter table move_bank enable row level security;
revoke all on move_bank from public, anon, authenticated;

-- A Boss's bank now: its balance at `as_of`, plus `weekly_moves` for every week since, up to `bank_cap`. It writes
-- nothing. The phase numbers come from the caller: the meeting computes them in TypeScript with `phaseAt`, and a
-- Boss's own overrides of its phases live in the instance's TypeScript content, which SQL cannot see. A Boss with
-- no row (one arriving at a handover) starts at zero; the first meeting writes the row.
create function bank_now(staff text, weekly_moves numeric, bank_cap numeric) returns numeric
language sql stable strict security definer set search_path = public, pg_temp as $$
  select greatest(0, coalesce(
    (select least(bank_cap, b.balance + weekly_moves * greatest(extract(epoch from now() - b.as_of), 0) / 604800)
     from move_bank b where b.staff = bank_now.staff),
    0))
$$;
revoke execute on function bank_now(text, numeric, numeric) from public, anon, authenticated;
grant execute on function bank_now(text, numeric, numeric) to service_role;
