-- season_page(tab, season, character, page): /season in one read (the glass-load design, section 7; its plan, Task 6).
-- The Season screen has two tabs. Rankings reads the finished seasons and the current season, then either a page of the standings with the reveals
-- and Turns of the characters on it, or, for a finished season, the place a linked character holds in its table and a page of the table
-- (engine/ui/rankings/Rankings.tsx). News reads the first page of the season's news. This answers each as one document.
--
--   in_tab        'news' for the News tab; anything else is Rankings.
--   in_season     a season's number: null or the current season's reads the standings; a finished season's reads its results; one that is
--                 neither (a season that does not exist, or that has not finished) answers null, as Rankings shows "missing".
--   in_character  for a finished season, the character the link names; its place in the table picks the page when no page is asked.
--   in_page       the page asked, clamped to 1 .. 10000 as Rankings clamps it; with none, the standings' first page, or the finished table's
--                 page holding the character's row (Rankings.tsx: index / 50 + 1), or its first.
--
-- Always `season` (current_season). News: `news`, season_news()'s first page (20, SEASON_NEWS_PAGE). Rankings: `finished` (finished_seasons()),
-- `page` (the page read), then for the standings `standings` (standings_page, 50 rows, PER_PAGE), `size` (season_size) and `reveals` and `turns`
-- of the page's characters, every one of them (asking about all but the player's own would say which are); for a finished season `place`
-- (result_place, only when a character is named; null where the season has no row for it) and `results` (results_page). `lastSettledAt` and
-- the caller's own characters come from boot and are not repeated.
--
-- Bounded by a page: 50 standings or results, their reveals and Turns, or 20 news rows. Every piece is a public projection read as the caller
-- (security invoker); standings_page and season_news are the functions the browser already calls. It writes nothing, reads only what a screen may
-- read (tools/check-web-reads.mjs) and is stable, which supabase/tests/e2e/0016-screen-reads.ts holds. A visitor is refused.

create function season_page(in_tab text, in_season integer, in_character uuid, in_page integer) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with cur as (
    select s.number from current_season s limit 1
  ), fin as (
    select f.number, f.starts_at, f.ends_at, f.results_at, f.characters from finished_seasons() f
  ), mode as (
    select case
      when in_tab = 'news' then 'news'
      when in_season is null or in_season is not distinct from (select c.number from cur c) then 'standings'
      when exists (select 1 from fin f where f.number = in_season) then 'results'
      else 'missing'
    end as m
  ), pl as (
    -- The finished table's index of the linked character, counted from 0.
    select case when (select m from mode) = 'results' and in_character is not null then result_place(in_season, in_character) end as place
  ), pg as (
    select case when in_page is not null then least(greatest(in_page, 1), 10000)
                else least(greatest(coalesce((select place from pl) / 50 + 1, 1), 1), 10000) end as page
  ), st as (
    select s.character, s.name, s.standing, s.place, s.n
    from standings_page(((select page from pg) - 1) * 50, case when (select m from mode) = 'standings' then 50 else 0 end) with ordinality as s(character, name, standing, place, n)
  ), rs as (
    select r.character, r.name, r.place, r.standing, r.shown, r.n
    from results_page(case when (select m from mode) = 'results' then in_season end, (select page from pg)) with ordinality as r(character, name, place, standing, shown, n)
  ), nw as (
    -- The ordinality is the function's own order; it is not a column of a news row, and is taken off again below.
    select n.ordinality as o, to_jsonb(n) - 'ordinality' as item
    from season_news(null, 20) with ordinality as n
    where (select m from mode) = 'news'
  )
  select case (select m from mode)
    when 'missing' then null
    when 'news' then jsonb_build_object(
      'season', (select to_jsonb(s) from current_season s limit 1),
      'news', coalesce((select jsonb_agg(x.item order by x.o) from nw x), '[]'::jsonb))
    when 'standings' then jsonb_build_object(
      'season', (select to_jsonb(s) from current_season s limit 1),
      'finished', coalesce((select jsonb_agg(to_jsonb(f) order by f.number desc) from fin f), '[]'::jsonb),
      'page', (select page from pg),
      'standings', coalesce((select jsonb_agg(to_jsonb(x) - 'n' order by x.n) from st x), '[]'::jsonb),
      'size', (select z.characters from season_size z limit 1),
      'reveals', coalesce((select jsonb_agg(to_jsonb(r) order by r.at, r.act::text collate "C") from (
        select v.act, v.character, v.class, v.at, v.via, v.thread from class_reveals v where v.character in (select x.character from st x)) r), '[]'::jsonb),
      'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.at, t.act::text collate "C") from (
        select u.act, u.character, u.at, u.was from turns_announced u where u.character in (select x.character from st x)) t), '[]'::jsonb))
    else jsonb_build_object(
      'season', (select to_jsonb(s) from current_season s limit 1),
      'finished', coalesce((select jsonb_agg(to_jsonb(f) order by f.number desc) from fin f), '[]'::jsonb),
      'page', (select page from pg),
      'place', (select place from pl),
      'results', coalesce((select jsonb_agg(to_jsonb(x) - 'n' order by x.n) from rs x), '[]'::jsonb))
  end;
end;

revoke all on function season_page(text, integer, uuid, integer) from public, anon, authenticated;
grant execute on function season_page(text, integer, uuid, integer) to authenticated;
