-- Hot triggers name their post (supabase/migrations/0420_hot_posts.sql; docs/plans/2026-11-23-hot-triggers-name-their-post-plan.md, Task 1).
-- Task 1: pool_signals' `hot` part carries, for each of a hot thread's authors, `top` (that author's most reacted post in the thread inside the window, a tie to the newer, a post under a live totals veil counting none),
-- and for the thread `tops` (its two most reacted posts, by two different characters, each {act, character}). Each author's `top` is a probe of acts_thread_posts; `tops` is one index pass over the thread's window posts.

do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1)),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'hp-pat',
      'staff', jsonb_build_array(jsonb_build_object('key', 'hp-pat', 'name', 'Hp Pat', 'title', 'Boss', 'signature', 'a')),
      'firstStaff', jsonb_build_array('hp-pat'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')))));
  insert into settings (key, value) values ('digestThreads', '3'), ('pool', '{"weekly": 20, "holdback": 0.2, "threadsWeekly": 1, "cardRarityMost": "common", "priorityDays": 28, "notesRead": 12, "chatterThreadPosts": 8, "strengths": {"named": 5, "quoted": 5, "legacy": 5, "successorStumbles": 5, "oldFlame": 5, "homeTurf": 2, "seasonTurn": 2, "hotOnBeat": 2}, "sessions": {"perDay": 3, "minutes": {"least": 20, "most": 60}, "waking": {"from": 13, "to": 5}}, "turns": {"waitHours": 48, "perThread": 2, "perSession": 4, "perDay": 60}, "chatterCron": "37 17 * * *"}') on conflict (key) do update set value = excluded.value;
end $$;

-- The window is far from now: other files commit rows that a window around now would count.
create function pg_temp.base() returns timestamptz language sql as $$ select '2051-03-01T12:00:00Z'::timestamptz $$;
create function pg_temp.signals() returns jsonb language plpgsql as $$
declare d jsonb;
begin
  perform tests.become_service();
  d := pool_signals(pg_temp.base(), pg_temp.base() + interval '1 hour');
  perform tests.unbecome();
  return d;
end $$;
-- A thread's entry of the hot signal.
create function pg_temp.hot_of(d jsonb, th uuid) returns jsonb language sql as $$
  select h from jsonb_array_elements(d -> 'hot') h where (h ->> 'thread')::uuid = th
$$;
-- A character's `top` among a thread's authors, as text (null where it has none).
create function pg_temp.top_of(d jsonb, th uuid, who uuid) returns text language sql as $$
  select a ->> 'top' from jsonb_array_elements(pg_temp.hot_of(d, th) -> 'authors') a where (a ->> 'character')::uuid = who
$$;
-- A post's reactions: the kinds and counts given, as the tally table holds them.
create function pg_temp.react(p uuid, up integer, other_kind text default null, other integer default 0) returns void language plpgsql as $$
begin
  if up > 0 then insert into reaction_tallies (act, kind, count) values (p, 'up', up); end if;
  if other > 0 then insert into reaction_tallies (act, kind, count) values (p, other_kind, other); end if;
end $$;
create table pg_temp.fx (k text primary key, v text);

-- ---- Task 1 ----
-- Fixture. Thread 'Hp Flame': Ann has three posts in the window, the oldest the most reacted (5), the middle one 1, the newest none, and one before the window with 100 that no window reads; Bea has one post (2); Cy has two that tie
-- (2 reactions each, one of them split over two kinds: the total is what counts), the newer wins. Thread 'Hp Pair': Xan holds the two biggest posts (9 and 8), Yul one (1), Zed one (0).
do $$
declare
  base timestamptz := pg_temp.base();
  ann uuid := tests.character(tests.account('hp-ann'), 'Hp Ann');
  bea uuid := tests.character(tests.account('hp-bea'), 'Hp Bea');
  cy uuid := tests.character(tests.account('hp-cy'), 'Hp Cy');
  xan uuid := tests.character(tests.account('hp-xan'), 'Hp Xan');
  yul uuid := tests.character(tests.account('hp-yul'), 'Hp Yul');
  zed uuid := tests.character(tests.account('hp-zed'), 'Hp Zed');
  fl uuid := tests.thread('Hp Flame'); pr uuid := tests.thread('Hp Pair');
  p uuid;
begin
  p := tests.post(ann, fl, 'Before the window.', base - interval '2 hours'); perform pg_temp.react(p, 100);
  p := tests.post(ann, fl, 'Ann oldest in the window.', base + interval '1 minute'); insert into pg_temp.fx values ('ann1', p); perform pg_temp.react(p, 5);
  p := tests.post(ann, fl, 'Ann middle.', base + interval '20 minutes'); insert into pg_temp.fx values ('ann2', p); perform pg_temp.react(p, 1);
  p := tests.post(ann, fl, 'Ann newest.', base + interval '30 minutes'); insert into pg_temp.fx values ('ann3', p);
  p := tests.post(bea, fl, 'Bea alone.', base + interval '5 minutes'); insert into pg_temp.fx values ('bea1', p); perform pg_temp.react(p, 2);
  p := tests.post(cy, fl, 'Cy first.', base + interval '2 minutes'); insert into pg_temp.fx values ('cy1', p); perform pg_temp.react(p, 2);
  p := tests.post(cy, fl, 'Cy second.', base + interval '3 minutes'); insert into pg_temp.fx values ('cy2', p); perform pg_temp.react(p, 1, 'wow', 1);
  p := tests.post(xan, pr, 'Xan big.', base + interval '1 minute'); insert into pg_temp.fx values ('xan1', p); perform pg_temp.react(p, 9);
  p := tests.post(xan, pr, 'Xan next.', base + interval '2 minutes'); insert into pg_temp.fx values ('xan2', p); perform pg_temp.react(p, 8);
  p := tests.post(yul, pr, 'Yul.', base + interval '3 minutes'); insert into pg_temp.fx values ('yul1', p); perform pg_temp.react(p, 1);
  p := tests.post(zed, pr, 'Zed.', base + interval '4 minutes'); insert into pg_temp.fx values ('zed1', p);
  insert into pg_temp.fx values ('ann', ann::text), ('bea', bea::text), ('cy', cy::text), ('xan', xan::text), ('yul', yul::text), ('zed', zed::text), ('fl', fl::text), ('pr', pr::text);
end $$;

-- An author's top is their most reacted post of the window, the older one where the newest has fewer; a tie goes to the newer; one post is its own top; a post before the window is nobody's.
do $$
declare
  d jsonb := pg_temp.signals();
  fl uuid := (select v::uuid from pg_temp.fx where k = 'fl');
  top text;
begin
  top := pg_temp.top_of(d, fl, (select v::uuid from pg_temp.fx where k = 'ann'));
  if top is distinct from (select v from pg_temp.fx where k = 'ann1') then
    raise exception 'the flame''s top is % and not her most reacted post, older than her newest: %', top, pg_temp.hot_of(d, fl);
  end if;
  top := pg_temp.top_of(d, fl, (select v::uuid from pg_temp.fx where k = 'cy'));
  if top is distinct from (select v from pg_temp.fx where k = 'cy2') then
    raise exception 'a tie (2 and 1+1) does not go to the newer post: top is %', top;
  end if;
  top := pg_temp.top_of(d, fl, (select v::uuid from pg_temp.fx where k = 'bea'));
  if top is distinct from (select v from pg_temp.fx where k = 'bea1') then raise exception 'a lone post is not its author''s top: %', top; end if;
  if exists (select 1 from jsonb_array_elements(pg_temp.hot_of(d, fl) -> 'authors') a where not (a ? 'top') or a -> 'top' = 'null'::jsonb) then
    raise exception 'an author of a hot thread has no top: %', pg_temp.hot_of(d, fl) -> 'authors';
  end if;
end $$;

-- A post under a live totals veil counts none: veil Ann's oldest and her top moves to the middle one.
do $$
declare
  fl uuid := (select v::uuid from pg_temp.fx where k = 'fl');
  ann uuid := (select v::uuid from pg_temp.fx where k = 'ann');
  bea uuid := (select v::uuid from pg_temp.fx where k = 'bea');
  ann1 uuid := (select v::uuid from pg_temp.fx where k = 'ann1');
  play uuid;
  d jsonb;
begin
  -- Before the veil the thread's two best are Ann's 5 and then Bea's 2 (Bea's newer than Cy's tying 2).
  if pg_temp.hot_of(pg_temp.signals(), fl) -> 'tops' is distinct from jsonb_build_array(
       jsonb_build_object('act', ann1, 'character', ann), jsonb_build_object('act', (select v::uuid from pg_temp.fx where k = 'bea1'), 'character', bea)) then
    raise exception 'tops before the veil are %', pg_temp.hot_of(pg_temp.signals(), fl) -> 'tops';
  end if;
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, stack) values ('hpveil', 'Hp Veil', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'totals', 1) on conflict (key) do nothing;
  play := tests.act(bea, 'card', fl, '{"card": "hpveil", "reach": "post"}', ann1);
  insert into post_veils (play, post, veil, author, caster_account, ends_at) values (play, ann1, 'totals', ann, (select owner from characters where id = bea), now() + interval '3 days');
  d := pg_temp.signals();
  if pg_temp.top_of(d, fl, ann) is distinct from (select v from pg_temp.fx where k = 'ann2') then
    raise exception 'a post under a live totals veil still counts: Ann''s top is %', pg_temp.top_of(d, fl, ann);
  end if;
  -- After it Ann's best counts 1 (her middle post), so the two best are Bea's 2 and Cy's newer 2.
  if pg_temp.hot_of(d, fl) -> 'tops' is distinct from jsonb_build_array(
       jsonb_build_object('act', (select v::uuid from pg_temp.fx where k = 'bea1'), 'character', bea),
       jsonb_build_object('act', (select v::uuid from pg_temp.fx where k = 'cy2'), 'character', (select v::uuid from pg_temp.fx where k = 'cy'))) then
    raise exception 'tops under the veil are %', pg_temp.hot_of(d, fl) -> 'tops';
  end if;
end $$;

-- `tops`: two posts by two different characters even where one character holds the two biggest, in the tops' own order.
do $$
declare
  d jsonb := pg_temp.signals();
  pr uuid := (select v::uuid from pg_temp.fx where k = 'pr');
  tops jsonb := pg_temp.hot_of(d, pr) -> 'tops';
begin
  if jsonb_array_length(tops) is distinct from 2 then raise exception 'tops does not hold two posts: %', tops; end if;
  if (tops -> 0 ->> 'act') is distinct from (select v from pg_temp.fx where k = 'xan1') or (tops -> 0 ->> 'character') is distinct from (select v from pg_temp.fx where k = 'xan') then
    raise exception 'the first top is not the biggest post, by its character: %', tops;
  end if;
  if (tops -> 1 ->> 'act') is distinct from (select v from pg_temp.fx where k = 'yul1') or (tops -> 1 ->> 'character') is distinct from (select v from pg_temp.fx where k = 'yul') then
    raise exception 'the second top is not the best post of another character (Yul''s 1 over Zed''s 0): %', tops;
  end if;
  -- Nothing else of the hot part moved.
  if (pg_temp.hot_of(d, pr) ->> 'heat')::numeric is distinct from 4.00 or (pg_temp.hot_of(d, pr) -> 'authors' -> 0 ->> 'posts') is distinct from '2' then
    raise exception 'the hot part changed beyond top and tops: %', pg_temp.hot_of(d, pr);
  end if;
  -- A thread of one character holds one top.
  perform tests.post((select v::uuid from pg_temp.fx where k = 'zed'), tests.thread('Hp Solo'), 'Alone.', pg_temp.base() + interval '10 minutes');
  d := pg_temp.signals();
  if jsonb_array_length((select h -> 'tops' from jsonb_array_elements(d -> 'hot') h where h ->> 'thread' = (select id::text from threads where title = 'Hp Solo'))) is distinct from 1 then
    raise exception 'a thread of one character does not hold one top: %', d -> 'hot';
  end if;
end $$;

-- The cost: each author's top is read by an index probe of acts_thread_posts (thread, character, created_at). The read is taken from the function's own text, so it cannot drift from it, and run on a busy instance in miniature:
-- 40000 posts over 80 threads and 400 characters, bulk rows written with triggers off, as a restore does.
do $$
declare
  def text := pg_get_functiondef('pool_signals(timestamptz, timestamptz)'::regprocedure);
  q text := (regexp_match(def, '(select tp\.id from acts_public tp.*?limit 1)\)'))[1];
  tq text := (regexp_match(def, '(select coalesce\(jsonb_agg\(jsonb_build_object\(''act'', b\.id.*?limit 2\) b)\) as tops'))[1];
  th uuid[]; chars uuid[]; plan text := ''; ln record; got text;
begin
  if q is null then raise exception 'the top read is not in pool_signals'; end if;
  select array_agg(tests.thread('Hp Big ' || i)) into th from generate_series(1, 80) i;
  select array_agg(tests.character(tests.account('hp-big-' || i), 'Hp Big ' || i)) into chars from generate_series(1, 400) i;
  set local session_replication_role = replica;
  insert into acts (character, kind, thread, payload, seq, created_at)
  select chars[1 + (i % 400)], 'post', th[1 + (i % 80)], jsonb_build_object('body', 'Chatter ' || i), i / 80 + 1, pg_temp.base() + (i % 3000) * interval '1 second' from generate_series(1, 40000) i;
  insert into reaction_tallies (act, kind, count) select id, 'up', 1 + (seq % 5) from acts where thread = any (th) and seq % 3 = 0;
  set local session_replication_role = origin;
  analyze acts; analyze reaction_tallies; analyze characters;
  q := replace(replace(replace(replace(q, 'tl.id', quote_literal(th[1])), 'a.character', quote_literal(chars[1])), 'since', quote_literal(pg_temp.base())), 'until', quote_literal(pg_temp.base() + interval '1 hour'));
  set local role kayfabb_digest;
  for ln in execute 'explain ' || q loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
  reset role;
  if plan !~ 'acts_thread_posts' or plan !~ 'Index Cond: \(\(thread = ' then raise exception 'the top read does not probe acts_thread_posts by thread and character: %', plan; end if;
  if plan ~ 'Seq Scan on acts\M' then raise exception 'the top read scans acts: %', plan; end if;
  -- `tops` is a pass over the thread's window posts: the planner reaches them through an index on the thread and the window (acts_patrol_posts, (thread, created_at), which reads exactly the window's posts of the thread;
  -- acts_thread_posts is not what it prices lowest for a read with no character), never a scan of acts.
  if tq is null then raise exception 'the tops read is not in pool_signals'; end if;
  tq := replace(replace(replace(tq, 'tl.id', quote_literal(th[1])), 'since', quote_literal(pg_temp.base())), 'until', quote_literal(pg_temp.base() + interval '1 hour'));
  plan := '';
  set local role kayfabb_digest;
  for ln in execute 'explain ' || tq loop plan := plan || E'
' || ln."QUERY PLAN"; end loop;
  reset role;
  if plan !~ 'Index Cond: \(\(thread = ''[0-9a-f-]+''::uuid\) AND \(created_at >= ' or plan !~ '(acts_thread_posts|acts_patrol_posts)' then raise exception 'the tops read does not reach posts through an index on the thread and the window: %', plan; end if;
  if plan ~ 'Seq Scan on acts\M' then raise exception 'the tops read scans acts: %', plan; end if;
  -- the read answers a post of that author
  set local role kayfabb_digest;
  execute q into got;
  reset role;
  if got is null then raise exception 'the top read of a character with posts in the window answers none'; end if;
end $$;
