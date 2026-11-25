-- Season news (supabase/migrations/0063_season_news.sql; the alerts plan, Task 8; the alerts design, sections 4 and 7): the season page's
-- News tab reads what is already written (a season's results, as the season_results rows with their top three, each tally's debuts and Turns,
-- the Boss's arrival and departure), each kind once, the same for every reader; an old reveal thread leaves The System's board's list and still
-- opens by id, and the season's Promos thread is listed; nothing is edited; each news item is one `seasonNews` alert for every player.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- A suite shares one database, and earlier files commit tallies and seasons of their own: this file reads the news it makes, which is what
-- `sn()` returns (the items there were not before the file's setup).
create temp table news_before as select kind, act, name, season from season_news(null, 50);
create function pg_temp.sn() returns setof season_news_row language sql as $$
  select x.* from season_news(null, 50) x where not exists (select 1 from news_before b where b.kind = x.kind and b.act is not distinct from x.act and b.name is not distinct from x.name and b.season is not distinct from x.season)
$$;

-- The migration exists at all (so a missing one fails here, on an assertion, and not on a missing function below).
do $$
begin
  if to_regprocedure('season_news(timestamptz,integer)') is null then raise exception 'season_news(timestamptz, integer) exists'; end if;
  if to_regclass('thread_open') is null then raise exception 'thread_open exists'; end if;
end $$;

-- ---- A seed: two Bosses, the stock lines, the announcements thread, a day-long season that began long ago ----
do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'rosterRecentExcluded', 1,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'systemLines', jsonb_build_object('bossFarewell', jsonb_build_array('Farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.'))),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'sn-a',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'sn-a', 'name', 'Sn A', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'sn-b', 'name', 'Sn B', 'title', 'Boss', 'signature', 'b')),
      'firstStaff', '[]'::jsonb, 'moves', '[]'::jsonb, 'demands', '[]'::jsonb)));
  update seasons set starts_at = now() - interval '60 days' where ends_at is null;
end $$;

create function pg_temp.ann() returns uuid language sql as $$ select (value #>> '{}')::uuid from settings where key = 'systemAnnouncements' $$;

-- ---- A season played, an announced debut and an old tally, a reveal and a handover ----
do $$
declare
  ann uuid := tests.account('sn-ann');
  bob uuid := tests.account('sn-bob');
  cat uuid := tests.account('sn-cat');
  t0 timestamptz := (select starts_at from seasons where ends_at is null);
  sprit uuid; gloom uuid; hooli uuid; pipe uuid;
  th uuid := tests.thread('Chatter');
  in_season bigint := (select id from seasons where ends_at is null);
  rolled jsonb;
begin
  sprit := tests.character(ann, 'Spritey', 'alpha', t0 + interval '1 hour');
  pipe := tests.character(ann, 'Pipewrench', 'alpha', t0 + interval '1 hour');
  gloom := tests.character(bob, 'Gloomba', 'alpha', t0 + interval '1 hour');
  hooli := tests.character(cat, 'Mrs. Hooligan', 'alpha', t0 + interval '1 hour');
  -- Spritey's player revealed its class in the season; nobody else did.
  perform write_unmask(sprit, th, 'act', t0 + interval '2 hours', 'Alpha, and proud.');
  insert into standings (character, season, amount) values (sprit, in_season, 650), (gloom, in_season, 400), (hooli, in_season, 300), (pipe, in_season, 100)
  on conflict (season, character) do update set amount = excluded.amount;
  -- One announcement is a debut; an old tally names a Turn announced with its old class.
  perform write_announce(hooli, (promos_thread(in_season)).in_thread, 'debut', null, null, t0 + interval '3 hours');
  -- An old tally, as an instance written before the announce Act holds it.
  perform tests.act(null, 'tally', (promos_thread(in_season)).in_thread, jsonb_build_object('season', 1, 'part', 1, 'of', 1, 'debuts', '[]'::jsonb,
    'turns', jsonb_build_array(jsonb_build_object('character', pipe, 'name', 'Pipewrench', 'loudness', 'revealed', 'was', 'alpha', 'since', t0))), null, t0 + interval '4 hours');
  rolled := reveal_season(t0 + interval '1 day');
  if rolled is null then raise exception 'the season did not roll over'; end if;
end $$;

-- ---- Each news kind appears once, from the Acts already written ----
do $$
declare
  rows jsonb;
  tthread uuid := (select turns_thread from seasons where number = 1);
  a_post uuid;
  b_post uuid;
  n record;
begin
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at, x.kind, x.act), '[]') into rows from pg_temp.sn() x;
  if jsonb_array_length(rows) is distinct from 5 then raise exception 'five items: the results, two tallies, the Boss''s arrival and departure: %', rows; end if;
  if (select count(*) from pg_temp.sn() where kind = 'results') is distinct from 1 or (select count(*) from pg_temp.sn() where kind = 'tally') is distinct from 2
     or (select count(*) from pg_temp.sn() where kind = 'bossArrived') is distinct from 1 or (select count(*) from pg_temp.sn() where kind = 'bossLeft') is distinct from 1 then
    raise exception 'each kind appears once (the tally per Act): %', rows;
  end if;

  -- The results: no Act and no thread to link, season 1 of four characters, the top three with place, standing and what is public of their class.
  select * into n from pg_temp.sn() where kind = 'results';
  if n.act is not null or n.thread is not null or n.seq is not null or n.season is distinct from 1 or n.count is distinct from 4 then
    raise exception 'the results link nothing, season 1, of four characters: %', to_jsonb(n);
  end if;
  if jsonb_array_length(n.detail -> 'top') is distinct from 3 then raise exception 'the top three: %', n.detail; end if;
  if (select array_agg(e ->> 'name' order by (e ->> 'place')::int) from jsonb_array_elements(n.detail -> 'top') e) is distinct from array['Spritey', 'Gloomba', 'Mrs. Hooligan'] then
    raise exception 'the top three in order: %', n.detail;
  end if;
  if (n.detail #>> '{top,0,standing}')::numeric is distinct from 650 then raise exception 'the first place''s final standing: %', n.detail; end if;
  if jsonb_array_length(n.detail #> '{top,0,shown}') is distinct from 1 or n.detail #>> '{top,0,shown,0,class}' is distinct from 'alpha' then
    raise exception 'Spritey''s revealed class is public in the results: %', n.detail;
  end if;
  if jsonb_array_length(n.detail #> '{top,1,shown}') is distinct from 0 then raise exception 'an unrevealed class is not in the results: %', n.detail; end if;

  -- The tallies: each Act with its debuts and its Turns.
  if (select count(*) from pg_temp.sn() where kind = 'tally' and thread = tthread and detail #>> '{debuts,0,name}' = 'Mrs. Hooligan' and jsonb_array_length(detail -> 'turns') = 0 and count = 1) is distinct from 1 then
    raise exception 'the debut tally: %', rows;
  end if;
  if (select count(*) from pg_temp.sn() where kind = 'tally' and thread = tthread and detail #>> '{turns,0,name}' = 'Pipewrench' and detail #>> '{turns,0,was}' = 'alpha' and jsonb_array_length(detail -> 'debuts') = 0 and count = 1) is distinct from 1 then
    raise exception 'the Turn tally: %', rows;
  end if;
  if exists (select 1 from pg_temp.sn() x where x.kind = 'tally' and not exists (select 1 from acts a where a.id = x.act and a.kind in ('tally', 'announce'))) then raise exception 'a tally item links its tally or announce Act'; end if;

  -- The Boss: the arrival quotes its first words and links its post in the announcements thread; so does the departure.
  select a.id into b_post from acts a join characters c on c.id = a.character where c.staff = 'sn-b' and a.kind = 'post' and a.thread = pg_temp.ann();
  select a.id into a_post from acts a join characters c on c.id = a.character where c.staff = 'sn-a' and a.kind = 'post' and a.thread = pg_temp.ann();
  select * into n from pg_temp.sn() where kind = 'bossArrived';
  if n.seq is distinct from (select seq from acts where id = b_post) then raise exception 'the arrival names its post''s place in the thread'; end if;
  if n.act is distinct from b_post or n.thread is distinct from pg_temp.ann() or n.name is distinct from 'Sn B' or n.quote is distinct from 'Hello from Sn B.' or n.season is distinct from 2 then
    raise exception 'the arrival: %', to_jsonb(n);
  end if;
  select * into n from pg_temp.sn() where kind = 'bossLeft';
  if n.act is distinct from a_post or n.name is distinct from 'Sn A' or n.quote is distinct from 'Farewell from Sn A.' then raise exception 'the departure: %', to_jsonb(n); end if;
end $$;

-- ---- The news is dated when it landed, not at its window's end ----
-- A tally and a reveal are dated at the window they close (`created_at`), which can be long before the settlement that writes them lands. A
-- player who opens Alerts in between moves the mark past them; the news must still be new to them when it lands.
do $$
declare
  dan uuid := tests.account('sn-dan');
  t0 timestamptz := (select starts_at from seasons where number = 1);
  base integer := (select count(*) from news_before);
begin
  if (select min(created_at) from acts where id in (select act from pg_temp.sn() where kind = 'tally')) >= now() - interval '1 day' then raise exception 'the tallies are dated at their window, long before they landed'; end if;
  if (select count(*) from pg_temp.sn() where at is distinct from now()) is distinct from 0 then
    raise exception 'each item is dated when it landed (this transaction), not at its window: %', (select jsonb_agg(to_jsonb(x)) from pg_temp.sn() x);
  end if;
  perform tests.become(dan);
  perform see_alerts(t0 + interval '5 hours');
  if my_alerts_unread() is distinct from least(10, 5 + base) then
    raise exception 'a mark after the window''s end and before the settlement landed still counts the news as new: %', my_alerts_unread();
  end if;
  perform tests.unbecome();
end $$;

-- Spread over time, so that order and pages have something to show: the debut tally landed three hours ago, the Turn tally two, the results one;
-- the Boss's arrival and departure landed with the handover, now.
do $$
begin
  update news_landed set landed_at = now() - interval '3 hours' where act = (select act from pg_temp.sn() where kind = 'tally' and detail #>> '{debuts,0,name}' = 'Mrs. Hooligan');
  update news_landed set landed_at = now() - interval '2 hours' where act = (select act from pg_temp.sn() where kind = 'tally' and detail #>> '{turns,0,name}' = 'Pipewrench');
  update seasons set results_at = now() - interval '1 hour' where number = 1;
  if (select array_agg(kind) from pg_temp.sn()) is distinct from array['bossArrived', 'bossLeft', 'results', 'tally', 'tally'] then
    raise exception 'newest first by when each landed: %', (select array_agg(kind || ' ' || at) from pg_temp.sn());
  end if;
  if (select detail #>> '{turns,0,name}' from pg_temp.sn() where kind = 'tally' limit 1) is distinct from 'Pipewrench' then raise exception 'the Turn tally landed after the debut tally'; end if;
end $$;

-- ---- A page: newest first, ties kept together, `before` is exclusive ----
do $$
declare
  newest timestamptz := (select max(at) from season_news(null, 50));
begin
  if (select at from season_news(null, 50) order by at desc limit 1) is distinct from newest then raise exception 'newest first'; end if;
  -- The results, the handover and the roll-over share an instant: the page of one is every item at that instant.
  if (select count(*) from season_news(null, 1)) is distinct from (select count(*) from season_news(null, 50) where at = newest) then raise exception 'a page keeps the items of its last instant together'; end if;
  if (select count(*) from season_news(newest, 50)) is distinct from (select count(*) from season_news(null, 50) where at < newest) then raise exception 'before is exclusive'; end if;
  if (select count(*) from season_news(null, 0)) < 1 then raise exception 'a page holds at least one'; end if;
end $$;

-- ---- The same for every reader; the server marks no one's characters ----
do $$
declare
  ann uuid := (select id from auth.users where email = 'sn-ann@test.invalid');
  bob uuid := (select id from auth.users where email = 'sn-bob@test.invalid');
  as_ann jsonb; as_bob jsonb; as_cat jsonb;
  denied text;
begin
  perform tests.become(ann);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at, x.kind, x.act), '[]') into as_ann from season_news(null, 50) x;
  perform tests.unbecome();
  perform tests.become(bob);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at, x.kind, x.act), '[]') into as_bob from season_news(null, 50) x;
  perform tests.unbecome();
  perform tests.become((select id from auth.users where email = 'sn-cat@test.invalid'));
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at, x.kind, x.act), '[]') into as_cat from season_news(null, 50) x;
  perform tests.unbecome();
  if as_ann is distinct from as_bob or as_bob is distinct from as_cat then raise exception 'nothing in season_news differs by caller'; end if;
  if as_ann::text ~* '"(yours|mine|owner|account|own)"\s*:' or position(ann::text in as_ann::text) > 0 or position(bob::text in as_ann::text) > 0 then
    raise exception 'season_news marks no one''s characters and holds no account: %', as_ann;
  end if;
  -- A visitor reads none of it.
  perform tests.become_anon();
  denied := pg_temp.refusal('select * from season_news(null, 50)');
  perform tests.unbecome();
  if denied is null or denied not like '42501%' then raise exception 'a visitor reads no season news: %', denied; end if;
end $$;

-- ---- The Promos thread is listed; an old reveal thread leaves the list and still opens by id; no Act is edited ----
do $$
declare
  tthread uuid := (select turns_thread from seasons where number = 1);
  rthread uuid;
  hdr uuid;
  sys uuid := system_board();
  list_before bigint := (select count(*) from thread_list where board = sys);
begin
  if tthread is null then raise exception 'the season has a Turns thread'; end if;
  if not exists (select 1 from thread_list where id = tthread) then raise exception 'the season''s thread is listed on The System''s board'; end if;
  if (select reveal_act from seasons where number = 1) is not null then raise exception 'a season''s end points at no reveal Act'; end if;
  -- An old season's reveal thread, as an earlier season's end wrote it, is netted out of the list when the season points at it.
  insert into threads (board, title) values (sys, 'Season 1: The Reveal') returning id into rthread;
  list_before := (select count(*) from thread_list where board = sys) - 1;
  hdr := tests.act(null, 'reveal', rthread, jsonb_build_object('season', 1, 'body', 'Every mask.', 'characters', 4));
  update seasons set reveal_act = hdr where number = 1;
  if exists (select 1 from thread_list where id = rthread) then raise exception 'an old reveal thread is not in thread_list'; end if;
  if (select count(*) from thread_list where board = sys) is distinct from list_before then raise exception 'neither is the reveal thread in The System''s board''s list'; end if;
  if (select count(*) from thread_open where id in (rthread, tthread)) is distinct from 2 then raise exception 'a link to either still opens it by id'; end if;
  if (select count(*) from acts_public where thread = rthread) < 1 then raise exception 'the reveal''s Acts are read as they were written'; end if;
  -- The board's counter is still the length of its list.
  if (select count(*) from thread_list where board = sys) is distinct from coalesce((select threads from board_counts where board = sys), 0) then
    raise exception 'the system board''s counter (%) is not its list (%)', (select threads from board_counts where board = sys), (select count(*) from thread_list where board = sys);
  end if;
  -- The announcements thread, an ordinary one, is still listed.
  if not exists (select 1 from thread_list where id = pg_temp.ann()) then raise exception 'the announcements thread is still listed'; end if;
  -- Nothing is edited: an Act cannot be, and the header is the one that was written.
  if pg_temp.refusal(format('update acts set payload = ''{}'' where id = %L', hdr)) is null then raise exception 'an Act cannot be edited'; end if;
end $$;

-- A second roll-over opens a Turns thread that is listed, and no reveal thread.
do $$
declare
  sys uuid := system_board();
  before_list bigint := (select count(*) from thread_list where board = sys);
  before_all bigint := (select count(*) from thread_open where board = sys);
  s2 seasons%rowtype;
begin
  select * into s2 from seasons where ends_at is null;
  perform write_announce((select id from characters where name = 'Gloomba'), (promos_thread(s2.id)).in_thread, 'debut', null, null, s2.starts_at + interval '1 hour');
  perform reveal_season(s2.starts_at + interval '1 day');
  if (select count(*) from thread_open where board = sys) is distinct from before_all + 1 then raise exception 'a Turns thread was made, and no reveal thread'; end if;
  if (select count(*) from thread_list where board = sys) is distinct from before_list + 1 then raise exception 'the new thread is listed'; end if;
  if (select count(*) from thread_list where board = sys) is distinct from (select threads from board_counts where board = sys) then raise exception 'the counter follows the list'; end if;
end $$;

-- ---- Each player gets the same seasonNews alerts ----
do $$
declare
  ann uuid := (select id from auth.users where email = 'sn-ann@test.invalid');
  bob uuid := (select id from auth.users where email = 'sn-bob@test.invalid');
  cat uuid := (select id from auth.users where email = 'sn-cat@test.invalid');
  a_rows jsonb; b_rows jsonb; c_rows jsonb;
  stored bigint := (select count(*) from alerts);
  total integer := (select count(*) from season_news(null, 50));
  mark timestamptz;
  n0 integer;
begin
  perform tests.become(ann);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at, x.sub, x.act nulls first), '[]') into a_rows from my_alerts(null, 100) x where x.kind = 'seasonNews';
  perform tests.unbecome();
  perform tests.become(bob);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at, x.sub, x.act nulls first), '[]') into b_rows from my_alerts(null, 100) x where x.kind = 'seasonNews';
  perform tests.unbecome();
  perform tests.become(cat);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at, x.sub, x.act nulls first), '[]') into c_rows from my_alerts(null, 100) x where x.kind = 'seasonNews';
  if jsonb_array_length(a_rows) is distinct from total then raise exception 'one seasonNews alert per news item (%): %', total, a_rows; end if;
  if a_rows is distinct from b_rows or b_rows is distinct from c_rows then raise exception 'the seasonNews alerts are the same for every player'; end if;
  if exists (select 1 from jsonb_array_elements(a_rows) e where e ->> 'character' is not null) then raise exception 'a seasonNews alert is no character''s: %', a_rows; end if;
  if (select array_agg(distinct e ->> 'sub' order by e ->> 'sub') from jsonb_array_elements(a_rows) e) is distinct from array['bossArrived', 'bossLeft', 'results', 'tally'] then raise exception 'their subs name the kinds: %', a_rows; end if;
  if my_alerts_unread() is distinct from least(10, total) then raise exception 'the count includes the news: %', my_alerts_unread(); end if;
  perform see_alerts(now());
  if my_alerts_unread() is distinct from 0 then raise exception 'the count falls when the mark moves'; end if;
  perform tests.unbecome();
  if (select count(*) from alerts) is distinct from stored then raise exception 'season news is written as no row per player'; end if;
  -- A new item after the mark is one more.
  mark := now() - interval '30 minutes';
  update account_preferences set alerts_seen_at = mark where account = cat;
  n0 := (select count(*) from season_news(null, 50) where at > mark);
  perform tests.become(cat);
  if my_alerts_unread() is distinct from least(10, n0) then raise exception 'what landed after the mark is new: % of %', my_alerts_unread(), n0; end if;
  perform tests.unbecome();
  perform write_announce((select id from characters where name = 'Gloomba'), (promos_thread((select id from seasons where ends_at is null))).in_thread, 'turn', null, null, now() + interval '1 hour');
  perform tests.become(cat);
  if my_alerts_unread() is distinct from least(10, n0 + 1) then raise exception 'a new announcement is one new alert: %', my_alerts_unread(); end if;
  perform tests.unbecome();
end $$;

-- ---- A new item reaches an open HUD: a queued broadcast on `reach`, public ----
do $$
begin
  if (select count(*) from broadcasts_due where topic = 'reach' and event = 'news' and payload ->> 'kind' = 'seasonNews') < 5 then
    raise exception 'season news is queued on reach: %', (select jsonb_agg(payload) from broadcasts_due where topic = 'reach');
  end if;
  if not exists (select 1 from broadcasts_due where topic = 'reach' and event = 'news' and payload ->> 'sub' = 'results')
     or not exists (select 1 from broadcasts_due where topic = 'reach' and event = 'news' and payload ->> 'sub' = 'tally')
     or not exists (select 1 from broadcasts_due where topic = 'reach' and event = 'news' and payload ->> 'sub' = 'bossArrived')
     or not exists (select 1 from broadcasts_due where topic = 'reach' and event = 'news' and payload ->> 'sub' = 'bossLeft') then
    raise exception 'results, tallies and the handover (the Boss who left, the Boss who arrived) are each announced, in the words the page reads: %', (select jsonb_agg(payload) from broadcasts_due where topic = 'reach');
  end if;
  if exists (select 1 from broadcasts_due where topic = 'reach' and event = 'news' and payload ->> 'sub' = 'boss') then raise exception 'a handover is announced as bossLeft and bossArrived, never as boss'; end if;
  if exists (select 1 from broadcasts_due where topic = 'reach' and event = 'news' and (payload::text ~* 'owner|account')) then raise exception 'the broadcast is public'; end if;
end $$;

-- ---- The Boss's words are the handover's own: a Boss who said nothing then gets no quote, not a later unrelated post ----
-- ---- A settlement landing is announced once on `reach`, public: its id and the time it was applied ----
do $$
declare
  at1 timestamptz := (select min(starts_at) from seasons) - interval '4000 days';
  sid bigint;
begin
  delete from broadcasts_due where event = 'settled';
  insert into seasons (number, starts_at, ends_at) values (5001, at1, at1 + interval '2 days');
  insert into settlements (starts_at, ends_at, season) select at1, at1 + interval '1 day', id from seasons where number = 5001 returning id into sid;
  if (select count(*) from broadcasts_due where topic = 'reach' and event = 'settled') is distinct from 1::bigint then
    raise exception 'a settlement is announced once on reach: %', (select jsonb_agg(payload) from broadcasts_due where topic = 'reach');
  end if;
  if (select payload ->> 'id' from broadcasts_due where event = 'settled') is distinct from sid::text
     or (select payload ->> 'at' from broadcasts_due where event = 'settled') is null then
    raise exception 'the announcement carries the settlement''s id and its time';
  end if;
  if exists (select 1 from broadcasts_due where event = 'settled' and (select count(*) from jsonb_object_keys(payload)) is distinct from 2::bigint) then raise exception 'the announcement carries nothing else: nothing of a player''s'; end if;
  delete from broadcasts_due where event = 'settled';
  delete from settlements where id = sid;
end $$;

-- The instance has lines for both, but a handover's announcement is best effort (say_in_announcements only warns), so one can have said nothing.
do $$
declare
  at0 timestamptz := (select min(starts_at) from seasons) - interval '3000 days';
  n record;
begin
  insert into seasons (number, starts_at, ends_at) values (5000, at0, at0 + interval '1 day');
  insert into season_handovers (season, outgoing, boss, how, at, landed_at) select id, 'sn-a', 'sn-b', 'rotation', at0, at0 from seasons where number = 5000;
  -- Both Bosses speak later, about something else.
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at)
  select c.id, 'post', pg_temp.ann(), '{"body": "A later, unrelated remark."}', at0 + interval '1 hour' from characters c where c.staff in ('sn-a', 'sn-b');
  perform set_config('kayfabb.staff_writer', '', true);
  for n in select * from season_news(null, 50) x where x.kind in ('bossArrived', 'bossLeft') and x.season in (5000, 4999) loop
    if n.act is not null or n.quote is not null or n.thread is not null or n.seq is not null then
      raise exception 'a Boss who said nothing at its handover has no quote and no post to link, whatever it said later: %', to_jsonb(n);
    end if;
  end loop;
  if (select count(*) from season_news(null, 50) x where x.kind in ('bossArrived', 'bossLeft') and x.season in (5000, 4999)) is distinct from 2 then raise exception 'the handover is news all the same'; end if;
end $$;

-- ---- The read costs a page, however many seasons and however long the announcements thread ----
-- 300 seasons that each changed Boss, and 5,000 posts in the announcements thread (and a post at each handover). A page of twenty looks up
-- the words of the rows on the page, from an index, and no more.
create function pg_temp.buffers(q text) returns bigint language plpgsql as $$
declare j json;
begin
  execute 'explain (analyze, buffers, format json) ' || q into j;
  return (j -> 0 -> 'Plan' ->> 'Shared Hit Blocks')::bigint + (j -> 0 -> 'Plan' ->> 'Shared Read Blocks')::bigint;
end $$;
do $$
declare
  a uuid := (select id from characters where staff = 'sn-a');
  b uuid := (select id from characters where staff = 'sn-b');
  first_start timestamptz := (select min(starts_at) from seasons) - interval '2000 days';
  used bigint;
begin
  insert into seasons (number, starts_at, ends_at)
  select 1000 + g, first_start + g * interval '2 days', first_start + g * interval '2 days' + interval '1 day' from generate_series(1, 300) g;
  insert into season_handovers (season, outgoing, boss, how, at, landed_at)
  select s.id, 'sn-a', 'sn-b', 'rotation', s.starts_at, s.starts_at from seasons s where s.number between 1001 and 1300;
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at)
  select a, 'post', pg_temp.ann(), jsonb_build_object('body', 'Remark ' || g), first_start + g * (interval '2 days' * 300 / 4400) from generate_series(1, 4400) g;
  insert into acts (character, kind, thread, payload, created_at)
  select case when w = 0 then b else a end, 'post', pg_temp.ann(), jsonb_build_object('body', 'Handover ' || w), s.starts_at
  from seasons s cross join generate_series(0, 1) w where s.number between 1001 and 1300;
  perform set_config('kayfabb.staff_writer', '', true);
  analyze acts; analyze season_handovers; analyze seasons;
  -- (Rows older than the newest handovers are costed too: the newest page reads the newest rows, and the page after it the next.)
  used := pg_temp.buffers('select * from season_news(null, 20)');
  if used > 1500 then raise exception 'a page of season news costs a page (% buffers), not a walk of every handover and a scan of the thread', used; end if;
  used := pg_temp.buffers(format('select * from season_news(%L, 20)', first_start + interval '400 days'));
  if used > 1500 then raise exception 'an older page costs a page too (% buffers)', used; end if;
  used := pg_temp.buffers('select * from alerts_news(''infinity'', 30)');
  if used > 2000 then raise exception 'the alerts read costs a page (% buffers)', used; end if;
  if (select count(*) from season_news(null, 20) where kind = 'bossArrived' and quote like 'Handover%') < 1 then raise exception 'a page still quotes the words said at its handover'; end if;
end $$;

-- ---- Netting a thread out of the list is idempotent, and the counter replays to the list ----
do $$
declare
  sys uuid := system_board();
  rthread uuid := (select a.thread from seasons s join acts a on a.id = s.reveal_act where s.number = 1);
  tthread uuid := (select turns_thread from seasons where number = 1);
  counter integer := (select threads from board_counts where board = sys);
  marked bigint := (select count(*) from unlisted_threads);
begin
  -- The season's row written again, and the netting asked for again: nothing moves.
  update seasons set reveal_act = reveal_act, turns_thread = turns_thread where number = 1;
  perform net_unlisted_thread(rthread);
  perform net_unlisted_thread(rthread);
  if (select threads from board_counts where board = sys) is distinct from counter or (select count(*) from unlisted_threads) is distinct from marked then
    raise exception 'netting a thread twice moved the counter (% to %)', counter, (select threads from board_counts where board = sys);
  end if;
  -- A season's row pointed at a thread it already named, or cleared and set again, nets nothing: the Turns thread is listed.
  update seasons set turns_thread = null where number = 1;
  update seasons set turns_thread = tthread where number = 1;
  if (select threads from board_counts where board = sys) is distinct from counter then raise exception 'clearing and setting the Turns thread netted it again'; end if;
  -- Replayed from the threads, the counter is the list.
  perform backfill_board_counts();
  if (select threads from board_counts where board = sys) is distinct from (select count(*)::integer from thread_list where board = sys) then
    raise exception 'the backfill counts the list: % of %', (select threads from board_counts where board = sys), (select count(*) from thread_list where board = sys);
  end if;
end $$;

-- ---- The migration's backfill, over seasons that existed before it ----
-- A database that predates 0063 has seasons with a reveal thread, tallies without a landing time, and a counter that
-- counted every thread but the updates thread. One file cannot be that database, so it is made here: the new tables emptied and the counter put
-- back as it stood, then the two functions the migration runs for the old rows.
do $$
declare
  sys uuid := system_board();
  listed integer := (select count(*)::integer from thread_list where board = sys);
  gone integer;
begin
  with gone as (
    delete from unlisted_threads where thread in (select r.thread from seasons s join acts r on r.id = s.reveal_act)
    returning thread
  )
  select count(*) into gone from gone g;
  delete from news_landed;
  update board_thread_counts set threads = threads + gone where board = sys and shard = 0;
  if (select threads from board_counts where board = sys) is not distinct from listed then
    raise exception 'the staged old database counts the reveal threads (the test would prove nothing)';
  end if;
  perform backfill_unlisted_threads();
  perform backfill_news_landed();
  if (select threads from board_counts where board = sys) is distinct from listed or (select count(*)::integer from thread_list where board = sys) is distinct from listed then
    raise exception 'the backfill nets the old reveal threads out of the counter: % of %', (select threads from board_counts where board = sys), listed;
  end if;
  if (select count(*) from unlisted_threads where thread in (select r.thread from seasons s join acts r on r.id = s.reveal_act)) is distinct from gone then
    raise exception 'every reveal thread is recorded as unlisted again';
  end if;
  if (select count(*) from news_landed) is distinct from (select count(*) from acts where kind = 'tally' and tally_names(payload) > 0) + (select count(*) from (select distinct thread, created_at from acts where kind = 'announce') l) then
    raise exception 'every old tally and every landing of announcements gets a landing time, and no reveal header does';
  end if;
  if exists (select 1 from news_landed n join acts a on a.id = n.act where n.landed_at is distinct from a.created_at) then raise exception 'an old item landed when it is dated'; end if;
  -- Run again, it changes nothing.
  perform backfill_unlisted_threads();
  perform backfill_news_landed();
  if (select threads from board_counts where board = sys) is distinct from (select count(*)::integer from thread_list where board = sys) then raise exception 'the backfill is idempotent'; end if;
end $$;

-- ---- The HUD's count finds news since the mark by time alone, from an index led by the time ----
-- alerts_news_unread asks news_landed for rows landed after the mark, whatever their kind, on every HUD load; the table grows by a
-- row for each tally part and reveal, so that read is a range of an index whose first key is landed_at. (An index led by kind shows
-- the same `Index Cond` in the plan but walks the whole index, so the plan's text alone cannot tell them apart: its index is read.)
do $$
declare ln record; plan text := ''; used text; lead text;
begin
  set local enable_seqscan = off;
  for ln in explain select 1 from news_landed n where n.landed_at > now() - interval '1 day' limit 10 loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
  used := substring(plan from 'Index (?:Only )?Scan (?:Backward )?using (\w+) on news_landed');
  lead := (select a.attname from pg_index i join pg_class c on c.oid = i.indexrelid join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
           where c.relname = used);
  if lead is distinct from 'landed_at' then raise exception 'news since the mark is not read as a range of landed_at (index %, led by %):%', used, lead, plan; end if;
end $$;
