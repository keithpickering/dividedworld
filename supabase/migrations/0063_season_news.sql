-- Season news: the season page's News tab, and the alert that links to it. The alerts plan, Task 8; the alerts design, sections 4 and 7.
--
-- The season's public facts are Acts already written, and none of them is edited here: the reveal's header Act and its per-character
-- Acts in the reveal thread, each tally Act in the season's Turns thread, and the Boss's arrival and farewell posts in the announcements
-- thread, found through `season_handovers`. `season_news` reads them, newest first, one row per Act-sized item, each with the Act to
-- link; nothing in it depends on who reads (a class is public only as the reveal's `shown` made it; who plays whom is in no Act of
-- these kinds), so every player gets the same rows and the server marks no one's characters (the client marks the player's own as
-- Rankings does). The Boss's arrival and departure come from `season_handovers` alone: `staff_changes` records Mod Bots hired and
-- fired and never a Boss (0043), so it has nothing to add here.
--
-- One tally Act is one item however many names it holds (a settlement writes them in parts of at most a hundred), so a page stays a
-- page at a busy instance; the screen draws its debuts and its Turns from the Act's own lists. Every item is one `seasonNews` alert
-- (alert_row.sub says which: results, tally, bossArrived, bossLeft), read from this same function, so the alert and the page cannot
-- differ, and the same for every player. The counts read indexes: seasons (one row each) for the reveals, `acts_tallies` for tallies,
-- and season_handovers (one row per season).
--
-- The reveal and Turns threads leave The System's board's list. thread_list (0062) was the one door to a thread by id as well as to
-- a board's list, so a thread it hides could not be opened; `thread_open` is the same row for every thread but the updates
-- thread (0062: its reader is the Updates page), and thread_list is it less the season's reveal and Turns threads, which a link still opens. The board's thread
-- counter is netted for each as the updates thread's was, so it stays the length of the list; a trigger on `seasons` nets the ones
-- that reveal_season and post_tally make, without redefining either.
--
-- Live: a new update or item of season news queues a broadcast on `reach` (event `news`, a public projection: the kind, its sub, the
-- Act and its time), by a trigger on the table the item is written to, so no writer is redefined. The HUD hears it (0061).

-- ------------------------------------------------------------------------ the threads ----

create view thread_open as
  select t.id, t.board, t.title, t.origin_act_id, t.created_at, t.last_at, t.next_seq - 1 as last_seq, t.replies,
         f.id as first_act, f.character as first_character,
         l.id as last_act, l.character as last_character,
         (select count(*) from (
            select 1 from acts r where r.thread = t.id and r.kind = 'post' and r.seq > 1 and r.created_at > now() - interval '7 days'
            limit (select (h.value #>> '{}')::integer from settings h where h.key = 'hotReplies')
          ) capped) as replies_this_week,
         o.thread as origin_thread, ot.title as origin_title, o.seq as origin_seq
  from threads t
  left join acts f on f.thread = t.id and f.seq = 1
  left join acts l on l.thread = t.id and l.seq = t.next_seq - 1
  left join acts o on o.id = t.origin_act_id
  left join threads ot on ot.id = o.thread
  where t.id is distinct from (select (u.value #>> '{}')::uuid from settings u where u.key = 'updatesThread');
revoke all on thread_open from public, anon, authenticated;
grant select on thread_open to authenticated;

-- The threads no board's list holds besides the updates thread (0062 keeps that one by its setting): the season's reveal and Turns threads,
-- each recorded here once, when the season row first points at it. thread_list leaves them out, and the board's counter is netted for each
-- exactly once, so it stays the length of the list however often a test or an admin writes the season's row again.
create table unlisted_threads (thread uuid primary key references threads (id));
alter table unlisted_threads enable row level security;
revoke all on unlisted_threads from public, anon, authenticated;

-- thread_list (0062), leaving out the unlisted threads as well. Ids are compared as uuids, so a join on thread_list keeps its index.
-- Everything else as 0062 wrote it.
create or replace view thread_list as
  select * from thread_open t
  where not exists (select 1 from unlisted_threads x where x.thread = t.id);

-- A thread no list holds: recorded, and its board's counter netted, once (by the same shard rule as the count).
create function net_unlisted_thread(unlisted uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  home uuid := (select t.board from threads t where t.id = unlisted);
begin
  if home is null then return; end if;
  insert into unlisted_threads (thread) values (unlisted) on conflict do nothing;
  if not found then return; end if;
  update board_thread_counts set threads = threads - 1
   where board = home and shard = coalesce((select c.shard from board_thread_counts c where c.board = home order by c.shard for update skip locked limit 1), 0);
end $$;
revoke execute on function net_unlisted_thread(uuid) from public, anon, authenticated;

create function seasons_net_threads() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.turns_thread is not null and old.turns_thread is null then perform net_unlisted_thread(new.turns_thread); end if;
  if new.reveal_act is not null and old.reveal_act is null then perform net_unlisted_thread((select a.thread from acts a where a.id = new.reveal_act)); end if;
  return new;
end $$;
create trigger seasons_net_threads after update of turns_thread, reveal_act on seasons for each row execute function seasons_net_threads();
revoke execute on function seasons_net_threads() from public, anon, authenticated;

-- The threads already made: recorded and netted once, in the counter's first shard (the board's count is the sum of its shards).
with found as (
  select s.turns_thread as thread from seasons s where s.turns_thread is not null
  union
  select r.thread from seasons s join acts r on r.id = s.reveal_act
), made as (
  insert into unlisted_threads (thread) select f.thread from found f on conflict do nothing returning thread
)
update board_thread_counts c set threads = c.threads - x.n
from (select t.board, count(*) as n from made m join threads t on t.id = m.thread group by t.board) x
where c.board = x.board and c.shard = 0;

-- backfill_board_counts (0030), counting the list a board has and not every thread it holds, so a replay of the counters agrees with the
-- triggers: the unlisted threads (and the updates thread, 0062) are in no board's count.
create or replace function backfill_board_counts() returns void
language sql set search_path = public, pg_temp as $$
  update board_thread_counts c set threads = case when c.shard = 0 then (select count(*) from thread_list t where t.board = c.board) else 0 end
$$;

-- ---------------------------------------------------------------------------- the news ----

-- A tally's debuts and Turns together; 0 for a payload that holds neither as a list.
create function tally_names(p jsonb) returns integer
language sql immutable set search_path = public, pg_temp as $$
  select (case when jsonb_typeof(p -> 'debuts') = 'array' then jsonb_array_length(p -> 'debuts') else 0 end)
       + (case when jsonb_typeof(p -> 'turns') = 'array' then jsonb_array_length(p -> 'turns') else 0 end)
$$;
revoke execute on function tally_names(jsonb) from public, anon, authenticated;

-- Tallies, newest first, for the news and its count.
create index acts_tallies on acts (created_at desc, id desc) where kind = 'tally';

-- A Boss changed at a handover: the Boss it ended with is not the one it began with, by nomination or rotation.
create view season_boss_changes as
  select h.season, s.number, h.outgoing, h.boss, h.at
  from season_handovers h join seasons s on s.id = h.season
  where h.boss is not null and h.boss is distinct from h.outgoing and h.how in ('nomination', 'rotation');
revoke all on season_boss_changes from public, anon, authenticated;

create type season_news_row as (
  kind text,         -- results | tally | bossArrived | bossLeft
  act uuid,          -- the Act to link: the reveal's header, the tally, the Boss's post (null where the instance wrote no line)
  thread uuid,       -- the Act's thread
  seq integer,       -- the Act's place in it (a link to the post names its page and number)
  at timestamptz,
  season integer,    -- the season's number (for a Boss row, the season it began or ended)
  name text,         -- a Boss row: the Boss's name
  quote text,        -- a Boss row: its post's first words
  count integer,     -- results: characters ranked; tally: names in it
  detail jsonb       -- results: { top: [{ character, name, place, standing, shown }] }; tally: { debuts, turns }
);

-- A page of season news, newest first: the newest `most` (1 to 50, 20 by default) older than `before` (exclusive; none for the newest
-- page), and every item sharing the instant of the last, so a later page never repeats one or loses one.
create function season_news(before timestamptz default null, most integer default 20) returns setof season_news_row
language sql stable security definer set search_path = public, pg_temp as $$
  with
  lim as (select coalesce($1, 'infinity'::timestamptz) as b, greatest(1, least(coalesce($2, 20), 50)) as k),
  ann as (select (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements') as thread),
  r_floor as (
    select coalesce((select a.created_at from seasons s join acts a on a.id = s.reveal_act
                     where a.created_at < (select b from lim) order by a.created_at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  results as (
    select 'results'::text as kind, a.id as act, a.thread, a.seq, a.created_at as at, (a.payload ->> 'season')::integer as season,
           null::text as name, null::text as quote, (a.payload ->> 'characters')::integer as count,
           jsonb_build_object('top', (
             select coalesce(jsonb_agg(jsonb_build_object('character', t.payload -> 'character', 'name', t.payload -> 'name', 'place', t.payload -> 'place',
                                                          'standing', t.payload -> 'standing', 'shown', coalesce(t.payload -> 'shown', '[]'::jsonb)) order by t.seq), '[]'::jsonb)
             from (select r.* from acts r where r.thread = a.thread and r.kind = 'reveal' and r.payload ? 'character' order by r.seq limit 3) t)) as detail
    from seasons s join acts a on a.id = s.reveal_act
    where a.created_at < (select b from lim) and a.created_at >= (select at from r_floor)
  ),
  t_floor as (
    select coalesce((select a.created_at from acts a where a.kind = 'tally' and a.created_at < (select b from lim)
                     order by a.created_at desc, a.id desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  tallies as (
    select 'tally'::text as kind, a.id as act, a.thread, a.seq, a.created_at as at, (a.payload ->> 'season')::integer as season,
           null::text as name, null::text as quote, tally_names(a.payload) as count,
           jsonb_build_object('debuts', case when jsonb_typeof(a.payload -> 'debuts') = 'array' then a.payload -> 'debuts' else '[]'::jsonb end,
                              'turns', case when jsonb_typeof(a.payload -> 'turns') = 'array' then a.payload -> 'turns' else '[]'::jsonb end) as detail
    from acts a
    where a.kind = 'tally' and a.created_at < (select b from lim) and a.created_at >= (select at from t_floor) and tally_names(a.payload) > 0
  ),
  -- The Boss's words are said by say_in_announcements (0051) in the handover's own transaction, if the instance wrote a line for it:
  -- the first post of that Boss in the announcements thread from the handover's instant on.
  boss_all as materialized (
    select x.kind, p.id as act, p.thread, p.seq, c.at, x.season, x.name, left(p.body, 600) as quote, null::integer as count, null::jsonb as detail
    from (
      select 'bossArrived'::text as kind, h.boss as who, h.at, h.number as season, 'bossArrival'::text as line from season_boss_changes h
      union all
      select 'bossLeft', h.outgoing, h.at, h.number - 1, 'bossFarewell' from season_boss_changes h where h.outgoing is not null
    ) c0
    cross join lateral (select c0.kind, c0.season, (select ch.name from characters ch where ch.staff = c0.who) as name) x
    cross join lateral (select c0.at as at) c
    left join lateral (
      select a.id, a.thread, a.seq, a.payload ->> 'body' as body
      from acts a join characters ch on ch.id = a.character
      where a.thread = (select thread from ann) and ch.staff = c0.who and a.kind = 'post' and a.created_at >= c0.at
        and exists (select 1 from settings s where s.key = 'systemLines' and jsonb_typeof(s.value -> c0.line) = 'array' and jsonb_array_length(s.value -> c0.line) > 0)
      order by a.seq limit 1
    ) p on true
    where c.at < (select b from lim)
  ),
  bosses as (
    select * from boss_all b
    where b.at >= coalesce((select b2.at from boss_all b2 order by b2.at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz)
  ),
  merged as (
    select * from results union all select * from tallies union all select * from bosses
  )
  select m.kind, m.act, m.thread, m.seq, m.at, m.season, m.name, m.quote, m.count, m.detail
  from merged m
  where m.at >= coalesce((select m2.at from merged m2 order by m2.at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz)
  order by m.at desc, m.kind, m.act nulls first
$$;
revoke execute on function season_news(timestamptz, integer) from public, anon;
grant execute on function season_news(timestamptz, integer) to authenticated;

-- ---------------------------------------------------------------------- the alert for all ----

-- alerts_news and alerts_news_unread (0062), now with season news as well: every player's, the same for each. An update row as 0062 has it;
-- a season-news row is `seasonNews` with the news item's kind as its sub, the Act to link, its thread, and a Boss's name or a count of names
-- (title and character are null: it is nobody's of the player's). Read from season_news itself, so an alert is exactly an item of the page.
create or replace function alerts_news(before timestamptz, most integer) returns setof alert_row
language sql stable as $$
  with
  floor_at as (
    select coalesce((select x.created_at from acts x where x.kind = 'update' and x.created_at < $1 order by x.created_at desc offset greatest($2, 1) - 1 limit 1), '-infinity'::timestamptz) as at
  ),
  updates_news as (
    select 'update'::text as kind, null::text as sub, a.id as act, null::uuid as character, a.created_at as at, a.thread, c.name, a.payload ->> 'title' as title, null::integer as count
    from acts a join characters c on c.id = a.character
    where a.kind = 'update' and a.created_at < $1 and a.created_at >= (select at from floor_at)
  ),
  season as (
    select 'seasonNews'::text as kind, n.kind as sub, n.act, null::uuid as character, n.at, n.thread, n.name, null::text as title, n.count
    from season_news($1, greatest($2, 1)) n
  )
  select * from updates_news union all select * from season
$$;
create or replace function alerts_news_unread(seen timestamptz) returns integer
language sql stable as $$
  select (select count(*) from (select 1 from acts a where a.kind = 'update' and a.created_at > $1 limit 10) u)::integer
       + (select count(*) from (select 1 from seasons s join acts a on a.id = s.reveal_act where a.created_at > $1 limit 10) r)::integer
       + (select count(*) from (select 1 from acts a where a.kind = 'tally' and a.created_at > $1 and tally_names(a.payload) > 0 limit 10) t)::integer
       + (select count(*) from (
           select 1 from season_boss_changes h where h.at > $1
           union all
           select 1 from season_boss_changes h where h.at > $1 and h.outgoing is not null
           limit 10) b)::integer
$$;
revoke execute on function alerts_news(timestamptz, integer), alerts_news_unread(timestamptz) from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------- live ----

-- A new item of news is announced on `reach` (every signed-in player hears it) as it is written. The payload is the public projection of
-- what alert_row says: kind, sub, the Act, and its time. No account, no character of a player's.
create function news_announce() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'season_handovers' then
    if new.boss is not null and new.boss is distinct from new.outgoing and new.how in ('nomination', 'rotation') then
      perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'seasonNews', 'sub', 'boss', 'act', null, 'at', new.at));
    end if;
  elsif new.kind = 'update' then
    perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'update', 'sub', null, 'act', new.id, 'at', new.created_at));
  elsif new.kind = 'tally' then
    if tally_names(new.payload) > 0 then
      perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'seasonNews', 'sub', 'tally', 'act', new.id, 'at', new.created_at));
    end if;
  elsif new.kind = 'reveal' and not (new.payload ? 'character') then
    perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'seasonNews', 'sub', 'results', 'act', new.id, 'at', new.created_at));
  end if;
  return new;
end $$;
create trigger acts_announce_news after insert on acts for each row when (new.kind in ('update', 'tally', 'reveal')) execute function news_announce();
create trigger season_handovers_announce_news after insert on season_handovers for each row execute function news_announce();
revoke execute on function news_announce() from public, anon, authenticated;
