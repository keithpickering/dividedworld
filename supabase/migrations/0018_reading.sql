-- Reading, remembered on the server: one private row per player per thread, so first-unread and
-- new-post markers follow a player from phone to desktop; public view counts, distinct players per
-- thread, recounted in batches and never live; and a player's own reactions, readable by that
-- player, so a screen can outline them and say "2 of 3 left". The screens' engine plan, Task 6;
-- the screens' design, section 6 ("Reading is remembered on the server").
--
-- A view is a private row, never an Act: no class rule reads it, and nothing about it is
-- broadcast. A live count would say whether a new poster's player had already read the thread,
-- so counts move only when count_thread_views() runs, at the instance's viewCountCron (hourly by
-- default). The row records the HUD's character at the player's first read, so a reveal of who
-- read something, if a card ever makes one, names a character, never a player. Until the owner
-- answers #12, no player reads the counts (below).
--
-- Its way out is none needed: reading changes nothing a player can be held by.

create table reading (
  account uuid not null references accounts (id),
  thread uuid not null references threads (id),
  furthest_seq integer not null check (furthest_seq >= 0),
  first_character uuid references characters (id),
  first_read_at timestamptz not null default now(),
  read_at timestamptz not null default now(),
  primary key (account, thread)
);
-- The threads a new reader came to since a count, found without reading every row; and each
-- thread's readers, counted without reading every player's.
create index reading_first_read_at on reading (first_read_at);
create index reading_thread on reading (thread);

create table thread_view_counts (
  thread uuid primary key references threads (id),
  players integer not null check (players >= 0),
  counted_at timestamptz not null
);

-- When the counts last ran, so the next run recounts only the threads read since.
create table view_count_runs (
  only_row boolean primary key default true check (only_row),
  ran_at timestamptz not null
);

-- The caller read `in_thread` through post `seq`, through the HUD's character `through` (null for
-- a player with no character yet). The furthest only rises, and never past the thread's last post.
-- The first character is the first read's; where that read had none, the first read that had one.
create function mark_read(in_thread uuid, seq integer, through uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  last_seq integer;
  kept reading%rowtype;
begin
  if through is not null then perform played_by(through, caller); end if;
  select next_seq - 1 into last_seq from threads where id = in_thread;
  if last_seq is null then raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  insert into reading as r (account, thread, furthest_seq, first_character)
  values (caller, in_thread, greatest(0, least(coalesce(seq, 0), last_seq)), through)
  on conflict (account, thread) do update set furthest_seq = greatest(r.furthest_seq, excluded.furthest_seq), read_at = now(),
    first_character = coalesce(r.first_character, excluded.first_character)
  returning * into kept;
  return jsonb_build_object('thread', kept.thread, 'furthest_seq', kept.furthest_seq);
end $$;

-- Recount the threads a new reader came to since the last run: distinct players, however many
-- masks they read through. A re-read changes no count, so it is not a reason to recount. A first
-- read whose transaction began before the last run and committed after it is caught by reading a
-- little before that run, so a count is never left behind; a thread recounted twice is the same
-- count. One run at a time, each reading the last run's time once it holds the lock. The cost is
-- the threads that gained a reader in the hour and their readers, read through reading_thread.
create function count_thread_views() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  since timestamptz;
  started timestamptz;
  done integer;
begin
  perform pg_advisory_xact_lock(hashtext('kayfabb.count_thread_views'));
  since := coalesce((select ran_at from view_count_runs), '-infinity') - interval '10 minutes';
  started := clock_timestamp();
  insert into thread_view_counts as v (thread, players, counted_at)
  select x.thread, count(*), started
  from reading x where x.thread in (select thread from reading where first_read_at >= since)
  group by x.thread
  on conflict (thread) do update set players = excluded.players, counted_at = excluded.counted_at;
  get diagnostics done = row_count;
  insert into view_count_runs (ran_at) values (started) on conflict (only_row) do update set ran_at = excluded.ran_at;
  return done;
end $$;

-- (Re)schedule the count at the instance's viewCountCron, as 0004 schedules the settlement.
create function schedule_view_counts() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return cron.schedule('kayfabb-view-counts', setting('viewCountCron') #>> '{}', 'select public.count_thread_views()');
end $$;

create function settings_reschedule_view_counts() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform schedule_view_counts();
  return null;
end $$;
create trigger settings_reschedule_view_counts after insert or update on settings
  for each row when (new.key = 'viewCountCron') execute function settings_reschedule_view_counts();
-- An instance seeded before this migration holds no viewCountCron until it is seeded again; the
-- count is scheduled then, by the trigger above.

-- A player's own reactions, through each of their masks: theirs to see, nobody else's. It runs as
-- its owner, filtered to the caller, as my_invites (0009) does, so the reactions table itself stays
-- unreadable by the API roles (0002; supabase/tests/0003-reactions.sql holds it), and only the
-- three columns a screen needs leave it: not the account, not when.
create view my_reactions as
  select r.act, r.kind, r.reactor_character as character from reactions r where r.reactor_account = auth.uid();

alter table reading enable row level security;
alter table thread_view_counts enable row level security;
alter table view_count_runs enable row level security;
revoke all on reading, thread_view_counts, view_count_runs, my_reactions from anon, authenticated;
grant select on reading to authenticated;
create policy own on reading for select to authenticated using (account = auth.uid());
-- Withheld from players for now: a count of distinct players can say that two masks that posted
-- in a thread are one player's, so it waits on the owner's answer to #12 (count the masks read
-- through instead, or show none) before any player reads it. The rows and the job are kept, so
-- the count is there to show once the answer is written into the design.
create policy read on thread_view_counts for select to authenticated using (true);
grant select on my_reactions to authenticated;

revoke execute on function count_thread_views(), schedule_view_counts(), settings_reschedule_view_counts() from public, anon, authenticated;
revoke execute on function mark_read(uuid, integer, uuid) from public, anon;
grant execute on function mark_read(uuid, integer, uuid) to authenticated;
