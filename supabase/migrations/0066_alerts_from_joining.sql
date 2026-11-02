-- An account that has never opened Alerts counts what is new from when it was opened, not from the instance's start. Issue #148,
-- answered by the owner: "Only news after joining should trigger alerts."
--
-- my_alerts_unread (0060) read a missing alerts_seen_at (0057) as '-infinity', so a player who joined mid-season started with the
-- HUD at "9+": every update and every piece of season news since the instance began. The missing mark now reads as the account's
-- own accounts.created_at (0001), as if the account had opened Alerts the instant it was made. Nothing else changes: the mark itself
-- stays null until see_alerts sets it, so it can still move to any time (see_alerts keeps the later of the two), and my_alerts, the
-- list, still holds everything from before joining, since a list is history and only the count says what is new.
--
-- "A response never proves a private fact": the count reads the caller's own account row and nothing of anyone else's. Cost: one
-- primary-key read of accounts per HUD load, beside the account_preferences read it replaces.
--
-- Its way out is 0060's: the count falls when the mark moves, and a followed thread falls out when it is read or unfollowed.

create or replace function my_alerts_unread() returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  with me as materialized (select signed_in_account() as id),
  seen as (
    select coalesce((select p.alerts_seen_at from account_preferences p where p.account = (select id from me)),
                    (select a.created_at from accounts a where a.id = (select id from me))) as at
  ),
  parts as (
    select (select count(*) from (select 1 from alerts a where a.account = (select id from me) and a.at > (select at from seen) limit 10) w) as n
    union all
    -- Followed threads, by their own probe that stops at ten and not by the view that reads every one (0059): the threads the caller
    -- started (acts_thread_openers) and chose, less the ones unfollowed, kept where a post by a character they do not own sits past
    -- their place and after the mark. A thread whose last Act is no newer than the mark (threads.last_at, 0030) is skipped from its
    -- own row; the post is looked for from the newest back, so a thread with one is answered by the first row.
    select (select count(*) from (
      select 1 from (
        select o.thread from characters c join acts o on o.character = c.id and o.seq = 1 where c.owner = (select id from me)
        union
        select f.thread from thread_follows f where f.account = (select id from me) and f.follow
      ) fo
      join threads th on th.id = fo.thread
      left join reading r on r.account = (select id from me) and r.thread = th.id
      where th.last_at > (select at from seen)
        and not exists (select 1 from thread_follows u where u.account = (select id from me) and u.thread = th.id and not u.follow)
        and exists (select 1 from acts a join characters pc on pc.id = a.character
                    where a.thread = th.id and a.kind = 'post' and a.seq > coalesce(r.furthest_seq, 0) and a.created_at > (select at from seen)
                      and pc.owner is distinct from (select id from me)
                    order by a.seq desc limit 1)
      limit 10) f)
    union all
    select (select count(*) from (
      select 1 from ledger l join settlements s on s.id = l.settlement
      where l.account = (select id from me)
        and l.settlement >= coalesce((select min(s0.id) from settlements s0 where s0.applied_at > (select at from seen)), 9223372036854775807)
        and s.applied_at > (select at from seen)
      group by l.settlement order by l.settlement desc limit 10) x)
    union all
    select alerts_news_unread((select at from seen))
  )
  select least(10, sum(n))::integer from parts
$$;
