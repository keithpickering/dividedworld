-- Thread views count characters: a thread's view count is the number of masks that have read
-- it, each counted once, and a reader with no character yet counts once as their account. The
-- clues design, section 2; the clues plan, Task 1.
--
-- A count of masks is the masks' doing, not the player's: one player reading through three masks
-- counts three, as three characters walking into a room would. So the count is computed from no
-- private fact (CLAUDE.md, "A response never proves a private fact"), and signed-in players read
-- it. Which masks read a thread stays private: thread_reads has no grant, and is never an Act or a
-- broadcast. The counts still move only when count_thread_views() runs, at viewCountCron, now for
-- cost alone: a live count would be a broadcast per read at a busy instance.
--
-- The cost at a busy instance: one row per mask per thread it ever read, written once (a re-read
-- through the same mask conflicts and writes nothing); a run reads the threads that gained a
-- reader since the last, through thread_reads_first_read_at, and those threads' readers, through
-- the primary key.
--
-- Its way out is none needed: reading changes nothing a player can be held by.

-- `reader` is the character read through, or the account where the read had none. It names no
-- table, since it is either.
create table thread_reads (
  thread uuid not null references threads (id),
  reader uuid not null,
  first_read_at timestamptz not null default now(),
  primary key (thread, reader)
);
create index thread_reads_first_read_at on thread_reads (first_read_at);

alter table thread_reads enable row level security;
revoke all on thread_reads from anon, authenticated;

-- 0018's, with the mask read through recorded beside the player's reading row, which is unchanged:
-- its first_character stays, for a reveal a card may one day make.
create or replace function mark_read(in_thread uuid, seq integer, through uuid default null) returns jsonb
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
  -- A read with no mask is the account's only while it has no mask to read through: a player
  -- with one reads through it, so a read sent without it adds no view of its own.
  if through is not null or not exists (select 1 from characters where owner = caller and debuted_at is not null and retired_at is null) then
    insert into thread_reads (thread, reader) values (in_thread, coalesce(through, caller)) on conflict do nothing;
  end if;
  return jsonb_build_object('thread', kept.thread, 'furthest_seq', kept.furthest_seq);
end $$;

-- The readers PR #9 recorded: each reading row's first character, or its account where it had
-- none, first read when the reading row was. A mask that read after a player's first read was not
-- recorded and is not guessed. A character since retired is still the mask that read. Run once
-- below; a second run adds nothing.
create function views_from_reading() returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into thread_reads (thread, reader, first_read_at)
  select thread, coalesce(first_character, account), first_read_at from reading
  on conflict do nothing;
$$;
select views_from_reading();

alter table thread_view_counts rename column players to views;

-- Recount the threads a new reader came to since the last run: the masks that read each, and the
-- accounts that read with no mask. A re-read through the same mask changes no count, so it is not a
-- reason to recount. As 0018's, a first read whose transaction began before the last run and
-- committed after it is caught by reading a little before that run; one run at a time.
create or replace function count_thread_views() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  since timestamptz;
  started timestamptz;
  done integer;
begin
  perform pg_advisory_xact_lock(hashtext('kayfabb.count_thread_views'));
  since := coalesce((select ran_at from view_count_runs), '-infinity') - interval '10 minutes';
  started := clock_timestamp();
  insert into thread_view_counts as v (thread, views, counted_at)
  select x.thread, count(*), started
  from thread_reads x where x.thread in (select thread from thread_reads where first_read_at >= since)
  group by x.thread
  on conflict (thread) do update set views = excluded.views, counted_at = excluded.counted_at;
  get diagnostics done = row_count;
  insert into view_count_runs (ran_at) values (started) on conflict (only_row) do update set ran_at = excluded.ran_at;
  return done;
end $$;

-- The counts, for every signed-in player: a count of masks is the masks' doing (above). 0018
-- withheld them while they counted players, which could say that two masks are one player's.
grant select on thread_view_counts to authenticated;
create policy read_all on thread_view_counts for select to authenticated using (true);

revoke execute on function views_from_reading() from public, anon, authenticated;
revoke execute on function count_thread_views() from public, anon, authenticated;
revoke execute on function mark_read(uuid, integer, uuid) from public, anon;
grant execute on function mark_read(uuid, integer, uuid) to authenticated;
