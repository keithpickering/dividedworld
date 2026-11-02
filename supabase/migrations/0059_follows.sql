-- Followed threads. The alerts plan, Task 4; the alerts design, sections 4, 10 and 11.
--
-- "A reply is defined by following": a player is told of new posts in the threads they follow. By default that is every thread
-- one of their characters started (the thread's first Act's author, as 0056 finds a thread's starter); a player follows any
-- other thread, or stops following one they started, with follow_thread. The choice is a row of the caller's own over that
-- default: a preference, as the theme is, never an Act ("Append-only" concerns Acts), and it is read by its account alone.
--
-- thread_follows holds only the choice: (account, thread, follow). A started thread with no row is followed; a row with
-- follow = false turns it off; a row with follow = true follows a thread one did not start. Nothing about it is broadcast, and
-- it is in no publication ("A response never proves a private fact"; supabase/tests/0014-realtime.sql).
--
-- my_followed_threads is the caller's followed threads that have posts past their own place (reading.furthest_seq, 0018), by
-- characters they do not own, with how many (counted to 100, a cap that keeps a busy thread's count one bounded index range; a
-- screen words 100 as "99+") and the newest such post's time; newest first, at most 50. Only threads with a count above nought
-- are rows, so a thread read to its end leaves the list by itself and nothing is stored to clear. The count is computed from
-- public posts and the caller's own ownership and place alone; no other account's follows or ownership enter it, and nothing
-- here changes a public read. "By characters they do not own" is the caller's own masks only: a staff character, whose owner is
-- null, is another's.
--
-- Its way out is the choice itself: Unfollow, on the thread page and on the Alerts row, and a thread read to its end.
--
-- Cost, at a busy instance: a player who started or follows hundreds of threads costs one probe each. The threads one started
-- are found by acts_thread_openers (a character's first Acts, nothing else of theirs), the threads chosen by thread_follows'
-- key, a thread's place by reading's key, and each thread's new posts by acts' (thread, seq) key, read from the newest back and
-- stopped at 100. A thread with nothing past the caller's place is skipped from its own row (next_seq) without reading its Acts.
-- The one cost that is not bounded by the cap is a run of the caller's own posts past their place, which the backward read steps
-- over; reading the thread, as posting does, ends it.

create table thread_follows (
  account uuid not null references accounts (id),
  thread uuid not null references threads (id),
  follow boolean not null,
  at timestamptz not null default now(),
  primary key (account, thread)
);
-- A thread's followers are never asked for (no Act fans out to them, design section 11), so the key serves every read.

-- A character's first Acts: the threads it started, found without reading the rest of what it wrote.
create index acts_thread_openers on acts (character, thread) where seq = 1;

alter table thread_follows enable row level security;
revoke all on thread_follows from anon, authenticated;
grant select on thread_follows to authenticated;
create policy own on thread_follows for select to authenticated using (account = auth.uid());

-- The caller chooses: follow `in_thread` (on_ true) or stop following it (false). Answers the state, as {"thread", "following"}.
create function follow_thread(in_thread uuid, on_ boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
begin
  if on_ is null then raise exception 'follow or unfollow, not neither' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if not exists (select 1 from threads where id = in_thread) then
    raise exception 'there is no such thread' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  insert into thread_follows as f (account, thread, follow) values (caller, in_thread, on_)
  on conflict (account, thread) do update set follow = excluded.follow, at = now() where f.follow is distinct from excluded.follow;
  return jsonb_build_object('thread', in_thread, 'following', on_);
end $$;

-- Whether the caller follows `in_thread`: their choice, else whether one of their characters started it. The thread page asks
-- this to draw Follow or Unfollow from the server's answer, since the default depends on who started the thread, which a page
-- cannot read for itself.
create function following_thread(in_thread uuid) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  caller uuid := signed_in_account();
  chosen boolean;
begin
  select follow into chosen from thread_follows where account = caller and thread = in_thread;
  if chosen is not null then return chosen; end if;
  return exists (select 1 from acts o join characters c on c.id = o.character where o.thread = in_thread and o.seq = 1 and c.owner = caller);
end $$;

-- The caller's own, as my_reactions (0018) is: run as its owner, filtered to auth.uid().
create view my_followed_threads as
  with followed as (
    select o.thread from characters c join acts o on o.character = c.id and o.seq = 1 where c.owner = auth.uid()
    union
    select f.thread from thread_follows f where f.account = auth.uid() and f.follow
  )
  select th.id as thread, th.board, th.title, n.new_posts, n.newest_at
  from followed fo
  join threads th on th.id = fo.thread
  left join reading r on r.account = auth.uid() and r.thread = th.id
  cross join lateral (
    select count(*)::integer as new_posts, max(p.created_at) as newest_at
    from (select a.created_at
          from acts a join characters pc on pc.id = a.character
          where a.thread = th.id and a.kind = 'post' and a.seq > coalesce(r.furthest_seq, 0) and pc.owner is distinct from auth.uid()
          order by a.seq desc limit 100) p
  ) n
  where th.next_seq - 1 > coalesce(r.furthest_seq, 0)
    and n.new_posts > 0
    and not exists (select 1 from thread_follows u where u.account = auth.uid() and u.thread = th.id and not u.follow)
  order by n.newest_at desc
  limit 50;

revoke all on my_followed_threads from anon, public;
grant select on my_followed_threads to authenticated;

revoke execute on function follow_thread(uuid, boolean), following_thread(uuid) from public, anon;
grant execute on function follow_thread(uuid, boolean), following_thread(uuid) to authenticated;
