-- The Alerts read and the HUD's count. The alerts plan, Task 5; the alerts design, sections 2, 4, 10 and 11.
--
-- my_alerts(before, most) is the caller's list, newest first, a union of what a player has to be told, each row once with its kind
-- (engine/rules/alerts.ts):
--   written     the caller's rows of `alerts` (0058): a quote, a card on theirs, a trap struck or sprung, a hint, a ruling;
--   followed    one row per followed thread with posts past the caller's place (my_followed_threads, 0059), its `at` the newest such
--               post's time, so "newer than the mark" means "a post arrived after you last looked"; a thread read to its end is no
--               row, so it leaves the list by itself; its `count` is how many posts (to 100, shown "100+"), its `act` is null (a
--               follow is a thread's alert, not a post's);
--   settlement  one row per settlement that moved a character of the caller's (they have ledger lines in it, as My log has), its
--               `at` the time it was applied (a settlement applied after the player last looked is new, whatever its window's end
--               said), its `sub` the settlement's id as text, its `count` how many of the caller's own characters it moved; it has
--               no Act and is written by nobody, it is read from the ledger (0003);
--   news        every player's: updates (Task 7) and season news (Task 8). Neither exists yet. Each is added by its task, which
--               replaces alerts_news and alerts_news_unread below (create or replace; the two are the one place a news source
--               joins, so my_alerts need not be re-copied) and adds its row to supabase/tests/0065-alerts-read.sql.
-- Each row: kind, sub, act, character, at, and the inputs of the words a screen says: the thread (to link to) and its title, the
-- character's public name, a count. Never a caster, a reactor, an account or a class.
--
-- "A response never proves a private fact": every source is the caller's own rows or public facts, nothing is computed from
-- another account's, and the settlement rows are the caller's own ledger lines (what My log already shows them), counted as
-- characters of theirs and never as anything of another player's. A staff character, a board play, the caller's own other masks'
-- plays are never written (0058), so nothing here needs to look.
--
-- Paging: `before` is exclusive (the oldest `at` of the page before), `most` is the page's size (1 to 100). A page is the `most`
-- newest rows, extended to every row that shares the instant of its last, so no row is split from its tie and cut from the next
-- page: written alerts of one transaction share an `at`, and so can a run of settlements applied together. A page is therefore
-- at least `most` rows when there are that many, and a later page never repeats a row of an earlier one.
--
-- Cost, at a busy instance (design, section 11): every HUD load calls my_alerts_unread, an Alerts page my_alerts. Every source is
-- bounded before the union: written alerts are one range of alerts_by_account (account, at) read from the newest back, the first
-- `most` rows and their ties; followed threads are my_followed_threads (at most 50, each a bounded probe, 0059); settlements are
-- the caller's ledger lines read from the newest back by ledger_account (account, settlement), grouped as they stream, `most`
-- settlements and their ties. The unread count reads each source with a limit of 10. The ledger is bounded by the settlement's id
-- as a stand-in for its time (a settlement is applied after the one before it, so ids and applied_at go the same way, as they do
-- here by construction); the exact comparison is on applied_at, through the join. The statements keep their arguments as $1, $2
-- so that supabase/tests/0065-alerts-read.sql can plan exactly the text shipped here.
--
-- my_alerts_unread(): how many of those are newer than the account's alerts_seen_at (0057; never set means everything is new),
-- counted with a bound: at most 10. A result of 10 means ten or more, and the screen says "9+" for it; 0 to 9 are exact.
--
-- Its way out: a list is a read, not a state. The count falls when the mark moves (see_alerts), and a followed thread falls out
-- when it is read or unfollowed (0059).

create index settlements_by_applied on settlements (applied_at desc, id desc);

create type alert_row as (
  kind text,
  sub text,
  act uuid,
  character uuid,
  at timestamptz,
  thread uuid,
  name text,
  title text,
  count integer
);

-- Every player's news (updates, season news): none yet. A source added by Task 7 or 8 replaces both functions. alerts_news answers
-- its newest `most` rows older than `before`, with every row that shares the instant of the last, in alert_row's shape;
-- alerts_news_unread answers how many are newer than `seen`, counted to 10.
create function alerts_news(before timestamptz, most integer) returns setof alert_row
language sql stable as $$
  select null::text, null::text, null::uuid, null::uuid, null::timestamptz, null::uuid, null::text, null::text, null::integer where false
$$;
create function alerts_news_unread(seen timestamptz) returns integer
language sql stable as $$ select 0 $$;
revoke execute on function alerts_news(timestamptz, integer), alerts_news_unread(timestamptz) from public, anon, authenticated, service_role;

create function my_alerts(before timestamptz default null, most integer default 30) returns setof alert_row
language sql stable security definer set search_path = public, pg_temp as $$
  with me as materialized (select signed_in_account() as id),
  lim as (select coalesce($1, 'infinity'::timestamptz) as before, greatest(1, least(coalesce($2, 30), 100)) as k),
  -- Written: the instant of the k-th newest row before the cursor, so the range below is k rows and their ties.
  w_floor as (
    select coalesce((select a.at from alerts a where a.account = (select id from me) and a.at < (select before from lim)
                     order by a.at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  written as (
    select a.kind, a.sub, a.act, a.character, a.at, ac.thread, c.name, t.title, null::integer as count
    from alerts a
    left join acts ac on ac.id = a.act
    left join characters c on c.id = a.character
    left join threads t on t.id = ac.thread
    where a.account = (select id from me) and a.at < (select before from lim) and a.at >= (select at from w_floor)
  ),
  f as materialized (select * from my_followed_threads v where v.newest_at < (select before from lim)),
  f_floor as (
    select coalesce((select v.newest_at from f v order by v.newest_at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  followed as (
    select 'followed'::text as kind, null::text as sub, null::uuid as act, null::uuid as character, v.newest_at as at, v.thread, null::text as name, v.title, v.new_posts as count
    from f v where v.newest_at >= (select at from f_floor)
  ),
  -- Settlements: the caller's ledger lines from the newest settlement back, grouped as they stream, k settlements.
  hi as (
    select coalesce((select s.id from settlements s where s.applied_at < (select before from lim) order by s.applied_at desc, s.id desc limit 1), 0) as id
  ),
  st_k as (
    select s.id, s.applied_at, count(distinct l.character)::integer as n
    from ledger l join settlements s on s.id = l.settlement
    where l.account = (select id from me) and l.settlement <= (select id from hi) and s.applied_at < (select before from lim)
    group by s.id, s.applied_at
    order by s.id desc limit (select k from lim)
  ),
  st_floor as (
    select case when (select count(*) from st_k) = (select k from lim) then (select min(applied_at) from st_k) else '-infinity'::timestamptz end as at
  ),
  st_tie as (
    select s.id, s.applied_at, g.n
    from settlements s
    cross join lateral (select count(distinct l.character)::integer as n from ledger l
                        where l.account = (select id from me) and l.settlement = s.id having count(*) > 0) g
    where s.applied_at = (select at from st_floor) and s.id not in (select id from st_k)
  ),
  settled as (
    select 'settlement'::text as kind, x.id::text as sub, null::uuid as act, null::uuid as character, x.applied_at as at, null::uuid as thread, null::text as name, null::text as title, x.n as count
    from (select * from st_k union all select * from st_tie) x
  ),
  merged as (
    select * from written
    union all select * from followed
    union all select * from settled
    union all select * from alerts_news((select before from lim), (select k from lim))
  )
  select m.kind, m.sub, m.act, m.character, m.at, m.thread, m.name, m.title, m.count
  from merged m
  where m.at >= coalesce((select m2.at from merged m2 order by m2.at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz)
  order by m.at desc, m.kind, m.sub nulls first, m.act nulls first, m.thread nulls first
$$;

create function my_alerts_unread() returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  with me as materialized (select signed_in_account() as id),
  seen as (
    select coalesce((select p.alerts_seen_at from account_preferences p where p.account = (select id from me)), '-infinity'::timestamptz) as at
  ),
  parts as (
    select (select count(*) from (select 1 from alerts a where a.account = (select id from me) and a.at > (select at from seen) limit 10) w) as n
    union all
    select (select count(*) from (select 1 from my_followed_threads v where v.newest_at > (select at from seen) limit 10) f)
    union all
    select (select count(*) from (
      select 1 from ledger l join settlements s on s.id = l.settlement
      where l.account = (select id from me)
        and l.settlement > coalesce((select s0.id from settlements s0 where s0.applied_at <= (select at from seen) order by s0.applied_at desc, s0.id desc limit 1), 0)
        and s.applied_at > (select at from seen)
      group by s.id limit 10) x)
    union all
    select alerts_news_unread((select at from seen))
  )
  select least(10, sum(n))::integer from parts
$$;

revoke execute on function my_alerts(timestamptz, integer), my_alerts_unread() from public, anon;
grant execute on function my_alerts(timestamptz, integer), my_alerts_unread() to authenticated;
