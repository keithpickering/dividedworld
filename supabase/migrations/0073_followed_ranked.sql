-- Cost at scale: docs/plans/2026-11-03-cost-at-scale-plan.md, built from docs/plans/2026-11-03-cost-at-scale-design.md.
-- Task 1 puts `my_settlement_moved` here; Task 2 puts the `my_followed_threads` view (ranked before it is counted) after it.

-- my_settlement_moved(settlement): whether one settlement moved the caller's characters, and how many, and when it was applied. A
-- client that heard a settlement announced on `reach` asks this once, at a random moment within REACH_SPREAD_MS, in place of reading
-- its whole head of my_alerts (a union of every source) to find one row.
--
-- It counts distinct characters, as my_alerts's settlement source does (0060: `count(distinct l.character)`), so the toast and the
-- Alerts row say the same number. It returns no row when the caller has no ledger line in the settlement, so "moved none" and "no
-- such settlement" are the same empty answer.
--
-- Cost, at a busy instance: one `ledger_account` (account, settlement) range for the caller's lines in that one settlement, and one
-- `settlements` primary-key read. Both are bounded by the caller's own lines in one settlement, whatever the instance holds.
--
-- The masks (design, section 5): it reads only the caller's own ledger lines, which My log already shows them. The answer has the
-- same shape for any id, and an id that does not exist answers as "moved none" does, so nothing is computed from anyone else's
-- ownership or class, and nothing differs with who owns what.
--
-- Its way out: it is a read, and holds no state.
create function my_settlement_moved(settlement bigint) returns table (count integer, applied_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select count(distinct l.character)::integer, s.applied_at
  from ledger l join settlements s on s.id = l.settlement
  where l.account = signed_in_account() and l.settlement = $1
  group by s.applied_at
$$;

revoke execute on function my_settlement_moved(bigint) from public, anon;
grant execute on function my_settlement_moved(bigint) to authenticated;

-- my_followed_threads, ranked before it is counted (design, section 2; #149 F4). 0059 counted up to 100 new posts in every followed
-- thread that had any, then sorted and kept 50: at 300 followed threads with 120 unread posts each, written in turn across the threads as a busy
-- instance writes them, 37,679 buffers, where this reads 7,818 (supabase/tests/0064-follows.sql). This ranks first.
--
-- It is the caller's followed threads that have posts past their own place (reading.furthest_seq, 0018) by characters they do not
-- own, with how many (counted to 100, a cap that keeps a busy thread's count one bounded index range; a screen words 100 as "100+")
-- and the time of the newest such post; newest first, at most 50. Only threads with a post past the place are rows, so a thread
-- read to its end leaves the list by itself and nothing is stored to clear. Nothing but public posts and the caller's own
-- ownership and place enter it ("A response never proves a private fact"). "By characters they do not own" is the caller's own
-- masks only: a staff character, whose owner is null, is another's.
--
-- `newest_at` is the creation time of the newest qualifying post by seq, where 0059 gave the latest created_at among the counted
-- posts. They differ only when two posts' transactions interleave, and then by less than one transaction's length; this is accepted.
-- A thread is ranked by the newest post by another, so the caller's own later post does not move it.
--
-- Its way out is the choice itself: Unfollow, on the thread page and on the Alerts row, and a thread read to its end.
--
-- Cost, at a busy instance: one probe per followed thread with something past the caller's place, then 50 bounded counts, where
-- 0059 read up to 100 posts of every such thread. The threads one started are found by acts_thread_openers (a character's first
-- Acts, nothing else of theirs), the threads chosen by thread_follows' key, a thread's place by reading's key, each probe and
-- each count by acts' (thread, seq) key read from the newest back. A thread with nothing past the caller's place is skipped from
-- its own row (next_seq) without reading its Acts. The one probe that is not bounded is a run of the caller's own posts past their
-- place, which the backward read steps over (an index walk that reads one Act and one character each, with no other bound). That
-- is the accepted bound: the run ends when the thread page marks the thread read (mark_read, 0018), which posting does not do.
--
-- Same columns, in the same order, as 0059; grants and ownership are 0059's (a replaced view keeps them), so my_alerts, followed()
-- in web/src/data/supabase.ts and the fake are unchanged.
create or replace view my_followed_threads as
  with followed as (
    select o.thread from characters c join acts o on o.character = c.id and o.seq = 1 where c.owner = auth.uid()
    union
    select f.thread from thread_follows f where f.account = auth.uid() and f.follow
  ),
  ranked as (
    select th.id as thread, th.board, th.title, r.furthest_seq, q.newest_at
    from followed fo
    join threads th on th.id = fo.thread
    left join reading r on r.account = auth.uid() and r.thread = th.id
    cross join lateral (
      select a.created_at as newest_at
      from acts a join characters pc on pc.id = a.character
      where a.thread = th.id and a.kind = 'post' and a.seq > coalesce(r.furthest_seq, 0) and pc.owner is distinct from auth.uid()
      order by a.seq desc limit 1
    ) q
    where th.next_seq - 1 > coalesce(r.furthest_seq, 0)
      and not exists (select 1 from thread_follows u where u.account = auth.uid() and u.thread = th.id and not u.follow)
    order by q.newest_at desc
    limit 50
  )
  select rk.thread, rk.board, rk.title, n.new_posts, rk.newest_at
  from ranked rk
  cross join lateral (
    select count(*)::integer as new_posts
    from (select 1
          from acts a join characters pc on pc.id = a.character
          where a.thread = rk.thread and a.kind = 'post' and a.seq > coalesce(rk.furthest_seq, 0) and pc.owner is distinct from auth.uid()
          order by a.seq desc limit 100) p
  ) n
  order by rk.newest_at desc;
