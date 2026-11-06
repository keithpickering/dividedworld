-- A season's results: the season's end writes no post (docs/plans/2026-11-06-season-end-design.md, sections 1 to 3; the plan's Task 1; #278).
--
-- reveal_season (0073) wrote, at a season's end, a thread on the staff's board: a header Act and one Act per character with its name, its place,
-- its standing and `shown` (what its player made public in the season). It is now a record that is not a post. `season_results` freezes the season
-- as it ended, one row per character: the name at the time, the place, the standing and `shown`, written in the transaction that ends the season.
-- Rows are never edited or removed ("Append-only"): a trigger refuses update, delete and truncate, enabled always, as 0090's guard is, so not even a
-- session in replica mode can change a result. The import tool only inserts, so the guard does not trip it. `seasons.results_at` says when the
-- results landed (the settlement transaction's now(), as `news_landed` dated the reveal), and is what Season News and the alerts order by.
--
-- The reveal Acts already written are never edited. Their threads stay, reached by an old link, and still draw. `backfill_season_results` copies
-- their facts into the table once, dating the results from their `news_landed` row, else from the header's `created_at`; on an empty database it
-- copies nothing, so a fresh instance's export holds no rows the migrations made.
--
-- Season News reads the table for its results item (no Act and no thread to link: the item opens the glass's Rankings), `news_landed` no longer
-- holds results (the table's check narrows to `tally` and `announcements`, the kind the next migration adds, so the check changes once), and the
-- results are announced on `reach` where `news_announce` announced the header. Three reads serve Rankings and the record: the finished seasons, a
-- page of 50 rows of one and a character's index in its order. The season's thread of Turns is now the Promos thread and listed on the staff's
-- board again; only an old reveal thread stays unlisted.
--
-- Copy: the instance gives one word, `announcementsThreadTitle`, where it gave `turnsThreadTitle`, `revealTitle` and `revealBody`. post_tally (0024)
-- reads the new key until the next migration replaces it.

-- ------------------------------------------------------------------------------------------ the table ----

create table season_results (
  season bigint not null references seasons (id),
  character uuid not null references characters (id),
  name text not null,
  place integer not null check (place >= 1),
  standing integer not null,
  shown jsonb not null default '[]' check (jsonb_typeof(shown) = 'array'),
  primary key (season, character)
);
-- A page of a season's final table, in the order the table is read (ties share a place and are listed by name).
create index season_results_by_place on season_results (season, place, name, character);
-- A character's seasons, newest first.
create index season_results_by_character on season_results (character, season desc);
alter table season_results enable row level security;
revoke all on season_results from public, anon, authenticated;
grant select on season_results to authenticated;
create policy read on season_results for select to authenticated using (true);

create function season_results_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a season''s result is never edited or removed (season_results, %); it is written once, as the season ended', tg_op using errcode = 'P0001';
end $$;
create trigger season_results_no_update before update or delete on season_results for each row execute function season_results_append_only();
create trigger season_results_no_truncate before truncate on season_results for each statement execute function season_results_append_only();
-- Always: a session in replica mode, as a restore with triggers disabled runs, fires them too.
alter table season_results enable always trigger season_results_no_update;
alter table season_results enable always trigger season_results_no_truncate;
revoke execute on function season_results_append_only() from public, anon, authenticated;

alter table seasons add column results_at timestamptz;

-- The seasons whose results have landed, which the reads below and the screens' pickers see (the whole of `seasons` is readable already; this is the
-- finished part, in the words of the glass).
create view seasons_finished as
  select id, number, starts_at, ends_at, results_at from seasons where results_at is not null;
revoke all on seasons_finished from public, anon, authenticated;
grant select on seasons_finished to authenticated;

-- ---------------------------------------------------------------------------------------- the backfill ----

-- The reveals already written, copied once (a function so a test can stage an old database and replay it; the migration calls it below, and it
-- changes nothing the second time). A season revealed before 0029 has no `shown` in its Acts (it carried every class), so it shows nothing; one revealed before the
-- places were written (0007's) has neither a place nor a standing in them, and gets the season's final standings' (the standings table keeps every season's) and the rank they give.
create function backfill_season_results() returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into season_results (season, character, name, place, standing, shown)
  select f.season, f.character, f.name, coalesce(f.place, rank() over (partition by f.season order by f.standing desc)), f.standing, f.shown
  from (
    select s.id as season, c.id as character, r.payload ->> 'name' as name, (r.payload ->> 'place')::integer as place,
           coalesce((r.payload ->> 'standing')::integer, st.amount, 0) as standing,
           case when jsonb_typeof(r.payload -> 'shown') = 'array' then r.payload -> 'shown' else '[]'::jsonb end as shown
    from seasons s
    join acts h on h.id = s.reveal_act
    join acts r on r.thread = h.thread and r.kind = 'reveal' and r.payload ?& array['character', 'name']
    join characters c on c.id = (r.payload ->> 'character')::uuid
    left join standings st on st.season = s.id and st.character = c.id
  ) f
  on conflict (season, character) do nothing;
  update seasons s set results_at = coalesce(
    (select n.landed_at from news_landed n where n.act = s.reveal_act and n.kind = 'results'),
    (select h.created_at from acts h where h.id = s.reveal_act))
  where s.reveal_act is not null and s.results_at is null
$$;
revoke execute on function backfill_season_results() from public, anon, authenticated;
select backfill_season_results();

-- ------------------------------------------------------------------------------------------- the news ----

-- Results are no news_landed row any more: the season says when they landed. The old rows are an index, not Acts, and their dates moved to
-- `results_at` above. The kind check takes the announcements the next migration writes, so it changes once.
delete from news_landed where kind = 'results';
alter table news_landed drop constraint news_landed_kind_check;
alter table news_landed add constraint news_landed_kind_check check (kind in ('tally', 'announcements'));

-- backfill_news_landed (0063), tallies alone: a reveal header lands no row.
create or replace function backfill_news_landed() returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into news_landed (act, kind, landed_at)
  select a.id, 'tally', a.created_at from acts a
  where a.kind = 'tally' and tally_names(a.payload) > 0
  on conflict (act) do nothing
$$;
revoke execute on function backfill_news_landed() from public, anon, authenticated;

-- news_announce (0063), without the reveal header: a season's end is announced by reveal_season itself, which has no Act to hang it on.
create or replace function news_announce() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'season_handovers' then
    if new.boss is not null and new.boss is distinct from new.outgoing and new.how in ('nomination', 'rotation') then
      -- The words the news reads are bossLeft (the one who goes, where there was one) and bossArrived (the one who comes), as season_news says them.
      if new.outgoing is not null then
        perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'seasonNews', 'sub', 'bossLeft', 'act', null, 'at', new.landed_at));
      end if;
      perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'seasonNews', 'sub', 'bossArrived', 'act', null, 'at', new.landed_at));
    end if;
  elsif new.kind = 'update' then
    perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'update', 'sub', null, 'act', new.id, 'at', new.created_at));
  elsif new.kind = 'tally' then
    if tally_names(new.payload) > 0 then
      insert into news_landed (act, kind) values (new.id, 'tally');
      perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'seasonNews', 'sub', 'tally', 'act', new.id, 'at', now()));
    end if;
  end if;
  return new;
end $$;
drop trigger acts_announce_news on acts;
create trigger acts_announce_news after insert on acts for each row when (new.kind in ('update', 'tally')) execute function news_announce();

-- season_news (0063), its results item read from season_results: one per season with `results_at`, in that order with the same paging floor.
-- `count` is the season's row count and `detail.top` its first three rows by place; `act`, `thread` and `seq` are null, there being no Act.
-- Everything else as 0063 wrote it.
create or replace function season_news(before timestamptz default null, most integer default 20) returns setof season_news_row
language sql stable security definer set search_path = public, pg_temp as $$
  with
  lim as (select coalesce($1, 'infinity'::timestamptz) as b, greatest(1, least(coalesce($2, 20), 50)) as k),
  ann as (select (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements') as thread),
  r_floor as (
    select coalesce((select s.results_at from seasons s where s.results_at is not null and s.results_at < (select b from lim)
                     order by s.results_at desc, s.number desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  results as (
    select 'results'::text as kind, null::uuid as act, null::uuid as thread, null::integer as seq, s.results_at as at, s.number as season,
           null::text as name, null::text as quote, (select count(*) from season_results r where r.season = s.id)::integer as count,
           jsonb_build_object('top', (
             select coalesce(jsonb_agg(jsonb_build_object('character', t.character, 'name', t.name, 'place', t.place, 'standing', t.standing, 'shown', t.shown)
                                       order by t.place, t.name, t.character), '[]'::jsonb)
             from (select r.* from season_results r where r.season = s.id order by r.place, r.name, r.character limit 3) t)) as detail
    from seasons s
    where s.results_at is not null and s.results_at < (select b from lim) and s.results_at >= (select at from r_floor)
  ),
  t_floor as (
    select coalesce((select n.landed_at from news_landed n where n.kind = 'tally' and n.landed_at < (select b from lim)
                     order by n.landed_at desc, n.act desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  tallies as (
    select 'tally'::text as kind, a.id as act, a.thread, a.seq, n.landed_at as at, (a.payload ->> 'season')::integer as season,
           null::text as name, null::text as quote, tally_names(a.payload) as count,
           jsonb_build_object('debuts', case when jsonb_typeof(a.payload -> 'debuts') = 'array' then a.payload -> 'debuts' else '[]'::jsonb end,
                              'turns', case when jsonb_typeof(a.payload -> 'turns') = 'array' then a.payload -> 'turns' else '[]'::jsonb end) as detail
    from news_landed n join acts a on a.id = n.act
    where n.kind = 'tally' and n.landed_at < (select b from lim) and n.landed_at >= (select at from t_floor)
  ),
  boss_all as materialized (
    select 'bossArrived'::text as kind, h.boss as who, h.landed_at as at, h.number as season, 'bossArrival'::text as line from season_boss_changes h
    where h.landed_at < (select b from lim)
    union all
    select 'bossLeft', h.outgoing, h.landed_at, h.number - 1, 'bossFarewell' from season_boss_changes h
    where h.outgoing is not null and h.landed_at < (select b from lim)
  ),
  boss_page as (
    select * from boss_all c
    where c.at >= coalesce((select c2.at from boss_all c2 order by c2.at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz)
  ),
  bosses as (
    select c.kind, p.id as act, p.thread, p.seq, c.at, c.season, (select ch.name from characters ch where ch.staff = c.who) as name,
           left(p.body, 600) as quote, null::integer as count, null::jsonb as detail
    from boss_page c
    left join lateral (
      select a.id, a.thread, a.seq, a.payload ->> 'body' as body
      from characters ch join acts a on a.character = ch.id
      where ch.staff = c.who and a.created_at = c.at and a.kind = 'post' and a.thread = (select thread from ann)
        and exists (select 1 from settings s where s.key = 'systemLines' and jsonb_typeof(s.value -> c.line) = 'array' and jsonb_array_length(s.value -> c.line) > 0)
      order by a.seq limit 1
    ) p on true
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

-- alerts_news_unread (0063), counting the seasons whose results landed after the mark where it counted the results rows of news_landed.
create or replace function alerts_news_unread(seen timestamptz) returns integer
language sql stable as $$
  select (select count(*) from (select 1 from acts a where a.kind = 'update' and a.created_at > $1 limit 10) u)::integer
       + (select count(*) from (select 1 from news_landed n where n.landed_at > $1 limit 10) r)::integer
       + (select count(*) from (select 1 from seasons s where s.results_at > $1 limit 10) q)::integer
       + (select count(*) from (
           select 1 from season_boss_changes h where h.landed_at > $1
           union all
           select 1 from season_boss_changes h where h.landed_at > $1 and h.outgoing is not null
           limit 10) b)::integer
$$;
revoke execute on function alerts_news_unread(timestamptz) from public, anon, authenticated, service_role;
-- Season results are found by time alone on every HUD load: a range of results_at.
create index seasons_by_results_at on seasons (results_at desc) where results_at is not null;

-- ------------------------------------------------------------------------------------ reveal_season ----

-- reveal_season (0073), everything as it wrote it except the thread: no thread, no reveal Acts, no broadcasts of them. The season's results are
-- rows of season_results with the same select the per-character Acts used (in order of final standing, characters by name and id, who plays them
-- never), `results_at` is now(), and `reveal_act` stays null. Returns the season's number and the count of rows. The results are announced on `reach`
-- as news (`sub` results), where news_announce announced the header Act.
create or replace function reveal_season(ended timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s seasons%rowtype;
  new_season bigint;
  written integer;
begin
  select * into s from seasons where ends_at is null for no key update;
  if s.id is null or s.starts_at + span_interval(setting('seasonLength')) > ended then return null; end if;

  update seasons set ends_at = ended where id = s.id;
  insert into seasons (number, starts_at) values (s.number + 1, ended) returning id into new_season;
  begin
    perform hand_over(new_season, s.boss, ended);
  exception when others then
    raise warning 'reveal_season: the handover of season % failed: % (%)', s.number + 1, sqlerrm, sqlstate;
    -- The season keeps its outgoing Boss rather than none, where that much can still be done.
    begin
      update seasons set boss = s.boss where id = new_season and boss is null;
      insert into season_handovers (season, outgoing, boss, how, note, at)
      values (new_season, s.boss, s.boss, case when s.boss is null then 'none' else 'unchanged' end, left('the handover failed: ' || sqlerrm, 1000), ended)
      on conflict (season) do nothing;
    exception when others then null;
    end;
  end;
  -- Each character in order of final standing, with its place and its standing, and only what its player made public in the season (`shown`): its
  -- reveals, and its announced Turns with the class each left where the Turn named it, in order. Read from class_reveals and turns_announced (0027),
  -- which read Acts alone, so no unrevealed class and no silent Turn is in it: they roll over into the next season, a clue rather than a stated fact
  -- (the class reveal design, section 5). A Turn that took effect at this very end is the next season's, as before. At one instant a Turn comes before
  -- the reveal it wrote (0028), as its tally stands before it in the thread. A character that debuts at this very settlement played no part in the
  -- season, and is the next one's.
  insert into season_results (season, character, name, place, standing, shown)
    select s.id, c.id, c.name, rank() over (order by coalesce(st.amount, 0) desc), coalesce(st.amount, 0),
        coalesce((
          select jsonb_agg(x.entry order by x.at, x.after, x.act) from (
            select r.at, 1 as after, r.act, jsonb_build_object('kind', 'reveal', 'act', r.act, 'at', r.at, 'class', r.class, 'via', r.via) as entry
            from class_reveals r where r.character = c.id and r.at >= s.starts_at and r.at < ended
            union all
            select t.at, 0, t.act, jsonb_build_object('kind', 'turn', 'act', t.act, 'at', t.at)
              || case when t.was is null then '{}'::jsonb else jsonb_build_object('was', t.was) end
            from turns_announced t where t.character = c.id and t.at >= s.starts_at and t.at < ended
          ) x), '[]'::jsonb)
    from characters c left join standings st on st.character = c.id and st.season = s.id
    where c.debuted_at < ended and c.staff is null;
  get diagnostics written = row_count;
  update seasons set results_at = now() where id = s.id;
  perform broadcast_later('reach', 'news', jsonb_build_object('kind', 'seasonNews', 'sub', 'results', 'season', s.number, 'act', null, 'at', now()));
  return jsonb_build_object('season', s.number, 'results', written);
end $$;

-- ---------------------------------------------------------------------------------------- the reads ----

-- The finished seasons, newest first: the choice on Rankings. Characters is the season's row count.
create function finished_seasons() returns table (number integer, starts_at timestamptz, ends_at timestamptz, results_at timestamptz, characters integer)
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  select f.number, f.starts_at, f.ends_at, f.results_at, (select count(*) from season_results r where r.season = f.id)::integer
  from seasons_finished f order by f.number desc limit 200;
end;

-- A page of a finished season's final table: 50 rows by place, then name, then id, in an index's order. A page below 1 is 1 and above 10000 is 10000;
-- a season without results has no rows.
create function results_page(in_season integer, page integer) returns table ("character" uuid, name text, place integer, standing integer, shown jsonb)
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  select r.character, r.name, r.place, r.standing, r.shown
  from season_results r join seasons_finished f on f.id = r.season
  where f.number = in_season
  order by r.place, r.name, r.character
  offset (least(greatest(coalesce(page, 1), 1), 10000) - 1) * 50 limit 50;
end;

-- A character's index in that order, counted from 0 (the page holding it is index / 50 + 1), or null where the season has no row for it. The rows
-- ahead of it are counted from the same index.
create function result_place(in_season integer, in_character uuid) returns integer
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  select (select count(*) from season_results r where r.season = f.id and (r.place, r.name, r.character) < (x.place, x.name, x.character))::integer
  from seasons_finished f join season_results x on x.season = f.id and x.character = in_character
  where f.number = in_season;
end;

revoke execute on function finished_seasons(), results_page(integer, integer), result_place(integer, uuid) from public, anon;
grant execute on function finished_seasons(), results_page(integer, integer), result_place(integer, uuid) to authenticated;

-- profile_page and record_page (0096), their `seasons` read from season_results joined to the finished seasons, by character, newest first, at most 50,
-- as { season: the number, place, standing, at: when the results landed }. Everything else as 0096 wrote it.
create or replace function profile_page(in_character uuid) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with c as (
    select id, name, joined, staff, office from characters_public where id = in_character
  ), acts5 as (
    -- PROFILE_ROWS (engine/ui/profile/record.ts): the newest few of its own Acts, with no count.
    select a.* from acts_public a
    where a.character = in_character and a.kind in ('post', 'spin', 'card')
    order by a.created_at desc limit 5
  ), rv as (
    select r.act, r.character, r.class, r.at, r.via, r.thread from class_reveals r where r.character = in_character
  ), tn as (
    select t.act, t.character, t.at, t.was from turns_announced t where t.character = in_character
  )
  select case when not exists (select 1 from c) then null else jsonb_build_object(
    'character', (select to_jsonb(c) from c),
    'profile', (select to_jsonb(p) from (
      select character, title, signature, avatar_square, avatar_portrait, square_frame, portrait_frame, pip_style
      from character_profiles where character = in_character) p),
    'counts', (select to_jsonb(n) from (select character, posts, spins, cards from character_post_counts where character = in_character) n),
    'standing', standing_place(in_character),
    'settled_at', (select s.ends_at from settlements s order by s.ends_at desc limit 1),
    'season', (select to_jsonb(s) from current_season s limit 1),
    'reveals', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.act::text collate "C") from rv r), '[]'::jsonb),
    'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.act::text collate "C") from tn t), '[]'::jsonb),
    'acts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from acts5 a), '[]'::jsonb),
    -- The card plays' target posts and the Turns' tallies, placed with one batched read (playLinks, turnLinks).
    'targets', coalesce((select jsonb_agg(to_jsonb(x)) from acts_public x
      where x.id in (select a.target_act_id from acts5 a where a.kind = 'card' and a.target_act_id is not null union select t.act from tn t)), '[]'::jsonb),
    'seasons', coalesce((select jsonb_agg(to_jsonb(a) order by a.at desc, a.season desc) from (
      select f.number as season, r.place, r.standing, f.results_at as at
      from season_results r join seasons_finished f on f.id = r.season
      where r.character = in_character
      order by f.results_at desc, f.number desc limit 50) a), '[]'::jsonb),
    'unread', my_alerts_unread()
  ) end;
end;

create or replace function record_page(in_character uuid, in_kind text, in_page integer) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with c as (
    select id, name, joined, staff, office from characters_public where id = in_character
  ), k as (
    select case when in_kind in ('all', 'post', 'spin', 'card', 'class', 'seasons') then in_kind else 'all' end as kind,
           least(greatest(coalesce(in_page, 1), 1), 10000) as page
  ), rv as (
    select r.act, r.character, r.class, r.at, r.via, r.thread from class_reveals r, k
    where r.character = in_character and k.kind in ('all', 'class')
  ), tn as (
    select t.act, t.character, t.at, t.was from turns_announced t, k
    where t.character = in_character and k.kind in ('all', 'class')
  ), seasons_read as (
    select f.number as season, r.place, r.standing, f.results_at as at
    from season_results r join seasons_finished f on f.id = r.season, k
    where k.kind in ('all', 'seasons') and r.character = in_character
    order by f.results_at desc, f.number desc limit 50
  ), w as (
    -- The window of the character's own Acts: for `all`, from `max(0, offset - extras)` for `offset + 20 - from` rows
    -- (the extras are merged in by the client, `mergeWindow`); for one kind, the page itself; for class and seasons, none.
    select case k.kind when 'all' then array['post', 'spin', 'card'] when 'post' then array['post'] when 'spin' then array['spin']
                       when 'card' then array['card'] else array[]::text[] end as kinds,
           case when k.kind = 'all' then greatest(0, (k.page - 1) * 20 - ((select count(*) from rv) + (select count(*) from tn) + (select count(*) from seasons_read)))
                else (k.page - 1) * 20 end as from_row,
           case when k.kind = 'all' then (k.page - 1) * 20 + 20 else 20 end as base
    from k
  ), acts_read as (
    -- The kinds as an init plan, so the planner keeps the ordered scan of the character's Acts with the limit pushed down.
    select a.* from acts_public a
    where a.character = in_character and a.kind = any (((select kinds from w)::text[]))
    order by a.created_at desc
    offset (select from_row from w)
    limit (select case when k.kind = 'all' then w.base - w.from_row else 20 end from w, k)
  )
  select case when not exists (select 1 from c) then null else jsonb_build_object(
    'kind', (select kind from k),
    'page', (select page from k),
    'character', (select to_jsonb(c) from c),
    'profile', (select to_jsonb(p) from (
      select character, title, signature, avatar_square, avatar_portrait, square_frame, portrait_frame, pip_style
      from character_profiles where character = in_character) p),
    -- RecordScreen reads the counters for all, post, spin and card only.
    'counts', (select to_jsonb(n) from (select character, posts, spins, cards from character_post_counts where character = in_character and (select kind from k) in ('all', 'post', 'spin', 'card')) n),
    'reveals', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.act::text collate "C") from rv r), '[]'::jsonb),
    'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.act::text collate "C") from tn t), '[]'::jsonb),
    'seasons', coalesce((select jsonb_agg(to_jsonb(a) order by a.at desc, a.season desc) from seasons_read a), '[]'::jsonb),
    'acts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from acts_read a), '[]'::jsonb),
    'targets', coalesce((select jsonb_agg(to_jsonb(x)) from acts_public x
      where x.id in (select a.target_act_id from acts_read a where a.kind = 'card' and a.target_act_id is not null union select t.act from tn t)), '[]'::jsonb),
    'unread', my_alerts_unread()
  ) end;
end;

-- --------------------------------------------------------------------------------------------- copy ----

-- settings_copy_complete (0007), asking for the Promos thread's title alone: the reveal's words are gone, and the Turns thread's title is the Promos'.
create or replace function settings_copy_complete() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare missing text;
begin
  if new.key <> 'copy' then return new; end if;
  select string_agg(k, ', ') into missing from unnest(array['announcementsThreadTitle']) k
  where jsonb_typeof(new.value -> k) is distinct from 'string' or btrim(new.value ->> k) = '';
  if missing is not null then raise exception 'copy is missing %', missing using errcode = '23514'; end if;
  return new;
end $$;
-- The instance's words, after the check that no longer asks for them: the Turns thread's title becomes the Promos', the reveal's words go. In one
-- statement, so settings_copy_kept and the check above see a complete copy.
update settings set value = (value - 'turnsThreadTitle' - 'revealTitle' - 'revealBody') || jsonb_build_object('announcementsThreadTitle', value -> 'turnsThreadTitle')
where key = 'copy' and value ? 'turnsThreadTitle' and not (value ? 'announcementsThreadTitle');

-- post_tally (0024), its thread titled by the Promos' word. Everything else as 0024 wrote it; the next migration replaces it.
create or replace function post_tally(in_season bigint, debuts jsonb, turns jsonb, at timestamptz, part integer default 1, parts integer default 1) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s seasons%rowtype;
  in_thread uuid;
  opened uuid;
  written uuid;
begin
  select * into s from seasons where id = in_season for no key update;
  in_thread := s.turns_thread;
  if in_thread is null then
    insert into threads (board, title) values (system_board(), copy_of('announcementsThreadTitle', s.number)) returning id into in_thread;
    update seasons set turns_thread = in_thread where id = s.id;
    opened := in_thread;
  end if;
  insert into acts (character, kind, thread, payload, created_at)
  values (null, 'tally', in_thread, jsonb_build_object('season', s.number, 'part', part, 'of', parts, 'debuts', debuts, 'turns', turns), at)
  returning id into written;
  return jsonb_build_object('act', act_projection(written), 'thread', case when opened is null then null else thread_projection(opened) end);
end $$;

-- ------------------------------------------------------------------------------------- the threads ----

-- seasons_net_threads (0063): only an old reveal thread is unlisted now. The season's Turns thread is the Promos', listed on the staff's board.
create or replace function seasons_net_threads() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.reveal_act is not null and old.reveal_act is null then perform net_unlisted_thread((select a.thread from acts a where a.id = new.reveal_act)); end if;
  return new;
end $$;
drop trigger seasons_net_threads on seasons;
create trigger seasons_net_threads after update of reveal_act on seasons for each row execute function seasons_net_threads();

-- backfill_unlisted_threads (0063), the old reveal threads alone.
create or replace function backfill_unlisted_threads() returns void
language sql security definer set search_path = public, pg_temp as $$
  select net_unlisted_thread(f.thread) from (
    select r.thread from seasons s join acts r on r.id = s.reveal_act
  ) f
$$;
revoke execute on function backfill_unlisted_threads() from public, anon, authenticated;

-- The Turns threads 0063 unlisted are listed again: each is recorded no more, and its board's counter takes it back (once, by the same shard rule as
-- the netting).
with relisted as (
  delete from unlisted_threads u where u.thread in (select s.turns_thread from seasons s where s.turns_thread is not null) returning u.thread
)
update board_thread_counts c set threads = c.threads + n.k
from (select t.board, count(*)::integer as k from relisted r join threads t on t.id = r.thread group by t.board) n
where c.board = n.board and c.shard = coalesce((select min(c2.shard) from board_thread_counts c2 where c2.board = n.board), 0);
