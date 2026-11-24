-- Hot triggers name their post (supabase/migrations/0420_hot_posts.sql; docs/plans/2026-11-23-hot-triggers-name-their-post-plan.md, Tasks 1, 4 and 6).
-- Review fix F1 (the last section): a spin takes a spend and a note, record_pool_spend and write_staff_note refusing any other Act.
-- Task 1: pool_signals' `hot` part carries, for each of a hot thread's authors, `top` (that author's most reacted post in the thread inside the window, a tie to the newer, a post under a live totals veil counting none),
-- and for the thread `tops` (its two most reacted posts, by two different characters, each {act, character}). Each author's `top` is a probe of acts_thread_posts; `tops` is one index pass over the thread's window posts.

do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'moveSuperseded', jsonb_build_array('Superseded: {move}.'), 'moveReversed', jsonb_build_array('Reversed: {move}.')),
      'systemMoveWords', jsonb_build_object('mergeBoard', 'the merging of a board into another')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Hp Gabe', 'title', 'Made this.', 'avatar', 'gabe'),
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'hp-pat',
      'staff', jsonb_build_array(jsonb_build_object('key', 'hp-pat', 'name', 'Hp Pat', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'hp-wait', 'name', 'Hp Wait', 'title', 'Waiting', 'signature', 'b'),
        jsonb_build_object('key', 'hp-bench', 'name', 'Hp Bench', 'title', 'Bench', 'signature', 'c')),
      'firstStaff', jsonb_build_array('hp-pat'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'nameSuccessor', 'structural', true),
        jsonb_build_object('key', 'mergeBoard', 'structural', true, 'shapesBoard', true, 'lasting', true, 'offices', jsonb_build_array('boss'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')))));
  insert into settings (key, value) values ('digestThreads', '3'), ('pool', '{"weekly": 20, "holdback": 0.2, "threadsWeekly": 1, "cardRarityMost": "common", "priorityDays": 28, "notesRead": 12, "chatterThreadPosts": 8, "strengths": {"named": 5, "quoted": 5, "legacy": 5, "successorStumbles": 5, "oldFlame": 5, "homeTurf": 2, "seasonTurn": 2, "hotOnBeat": 2}, "sessions": {"perDay": 3, "minutes": {"least": 20, "most": 60}, "waking": {"from": 13, "to": 5}}, "turns": {"waitHours": 48, "perThread": 2, "perSession": 4}, "charsPerDay": 780000, "readMost": 40000, "chatterCron": "37 17 * * *"}') on conflict (key) do update set value = excluded.value;
  update characters set debuted_at = now() where staff = 'hp-bench';
  insert into staff_offices (staff, office, cause) values ('hp-bench', 'benched', 'admin');
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
  select chars[1 + (i % 400)], 'post', th[1 + (i % 80)], jsonb_build_object('body', 'Chatter ' || i), i / 80 + 2, pg_temp.base() + (i % 3000) * interval '1 second' from generate_series(1, 40000) i;
  insert into reaction_tallies (act, kind, count) select id, 'up', 1 + (seq % 5) from acts where thread = any (th) and seq % 3 = 0;
  set local session_replication_role = origin;
  analyze acts; analyze reaction_tallies; analyze characters;
  -- As 0304-post-veils.sql does: with seq scans priced out, a Seq Scan on acts in a plan means no index can serve that part, which is what this asks; a planner's choice of a scan over an index it could use (as CI's made
  -- for acts_public's latest-edit probe, over a table seeded with no edits) is not.
  set local enable_seqscan = off;
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
  set local enable_seqscan = on;
end $$;

-- ---- Task 4: write_staff_spin ----
-- A persona's spin of a post: a thread on the post's board with origin_act_id set and a spin Act aimed at the origin; a spin of a post on The System's board lands on the players' board; a waiting or benched persona, a
-- non-persona, an empty body, an edit as origin and a missing origin are each refused; a client cannot call it.
create function pg_temp.refused(stmt text) returns text language plpgsql as $$
begin execute stmt; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;

do $$
declare
  ann uuid := tests.character(tests.account('hs-ann'), 'Hs Ann');
  th uuid := tests.thread('Hs Origin');
  post uuid := tests.post(ann, th, 'Spin me.');
  edit uuid := tests.act(ann, 'edit', th, '{"body": "Spun."}', post);
  sys_thread uuid := (select t.id from threads t join boards b on b.id = t.board where b.is_system limit 1);
  sys_post uuid; gone uuid; keep uuid; gone_post uuid; q bigint; m bigint;
  r jsonb; made uuid; said text; fl text; who text;
begin
  sys_post := tests.post(ann, sys_thread, 'On the system board.');
  perform tests.become_service();
  r := write_staff_spin('hp-pat', post, 'A spun title', 'The spinning words.', '{"pool": "2051-03-01"}');
  made := (r -> 'act' ->> 'id')::uuid;
  if made is null then raise exception 'the spin wrote no Act: %', r; end if;
  if (select a.kind from acts a where a.id = made) is distinct from 'spin' then raise exception 'the Act is no spin'; end if;
  if (select a.target_act_id from acts a where a.id = made) is distinct from post then raise exception 'the spin does not aim at its origin'; end if;
  if (select a.character from acts a where a.id = made) is distinct from (select id from characters where staff = 'hp-pat') then raise exception 'the spin is not the persona''s'; end if;
  if (select a.payload from acts a where a.id = made) is distinct from '{"pool": "2051-03-01", "title": "A spun title", "body": "The spinning words."}'::jsonb then raise exception 'the spin''s payload: %', (select a.payload from acts a where a.id = made); end if;
  if (select t.origin_act_id from threads t where t.id = (select a.thread from acts a where a.id = made)) is distinct from post then raise exception 'the thread does not carry its origin'; end if;
  if (select t.board from threads t where t.id = (select a.thread from acts a where a.id = made)) is distinct from (select t.board from threads t where t.id = th) then raise exception 'the spun thread is not on the origin''s board'; end if;
  if r -> 'thread' is null then raise exception 'no thread in the answer: %', r; end if;
  -- a post on The System's board: the players' board
  r := write_staff_spin('hp-pat', sys_post, 'From the system', 'Words.');
  if (select t.board from threads t where t.id = (select a.thread from acts a where a.id = (r -> 'act' ->> 'id')::uuid)) is distinct from players_board() then raise exception 'a spin of a post on The System''s board did not land on the players'' board'; end if;
  if (select t.origin_act_id from threads t where t.id = (select a.thread from acts a where a.id = (r -> 'act' ->> 'id')::uuid)) is distinct from sys_post then raise exception 'that thread lost its origin'; end if;
  -- refusals
  said := pg_temp.refused(format('select write_staff_spin(%L, %L, %L, %L)', 'hp-wait', post, 'T', 'B'));
  if said is null or said !~ '^55000 a waiting persona writes nothing' then raise exception 'a waiting persona spun: %', said; end if;
  said := pg_temp.refused(format('select write_staff_spin(%L, %L, %L, %L)', 'hp-bench', post, 'T', 'B'));
  if said is null or said !~ '^55000 a benched persona writes nothing' then raise exception 'a benched persona spun: %', said; end if;
  said := pg_temp.refused(format('select write_staff_spin(%L, %L, %L, %L)', (select staff from characters where staff_kind = 'developer'), post, 'T', 'B'));
  if said is null or said !~ '^42501' then raise exception 'the developer spun: %', said; end if;
  said := pg_temp.refused(format('select write_staff_spin(%L, %L, %L, %L)', 'hp-nobody', post, 'T', 'B'));
  if said is null or said !~ '^P0002' then raise exception 'no one spun: %', said; end if;
  said := pg_temp.refused(format('select write_staff_spin(%L, %L, %L, %L)', 'hp-pat', post, 'T', E' \n '));
  if said is null or said !~ '^22023 body is empty' then raise exception 'an empty body was spun, or refused in other words: %', said; end if;
  said := pg_temp.refused(format('select write_staff_spin(%L, %L, %L, %L)', 'hp-pat', post, E' ', 'B'));
  if said is null or said !~ '^22023 title is empty' then raise exception 'a blank title was spun, or refused in other words: %', said; end if;
  said := pg_temp.refused(format('select write_staff_spin(%L, %L, %L, %L)', 'hp-pat', post, repeat('t', (setting('titleMaxLength'))::int + 1), 'B'));
  if said is null or said !~ '^22001' then raise exception 'a title past titleMaxLength was spun: %', said; end if;
  said := pg_temp.refused(format('select write_staff_spin(%L, %L, %L, %L)', 'hp-pat', post, 'T', repeat('b', (setting('postMaxLength'))::int + 1)));
  if said is null or said !~ '^22001' then raise exception 'a body past postMaxLength was spun: %', said; end if;
  said := pg_temp.refused(format('select write_staff_spin(%L, %L, %L, %L)', 'hp-pat', edit, 'T', 'B'));
  if said is null or said !~ '^P0002' then raise exception 'an edit was spun from: %', said; end if;
  said := pg_temp.refused(format('select write_staff_spin(%L, %L, %L, %L)', 'hp-pat', gen_random_uuid(), 'T', 'B'));
  if said is null or said !~ '^P0002' then raise exception 'a missing origin was spun from: %', said; end if;
  perform tests.unbecome();
  -- a board that is closed (merged away, landed by the tick): a spin of a post on it is refused by threads_on_open_board (0339), as every other insert into threads is
  insert into boards (slug, name) values ('hp-gone', 'Hp Gone'), ('hp-keep', 'Hp Keep');
  select id into gone from boards where slug = 'hp-gone'; select id into keep from boards where slug = 'hp-keep';
  insert into threads (board, title) values (gone, 'Hs Doomed') returning id into th;
  gone_post := tests.post(ann, th, 'On a board to be merged.');
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (m, 'hp-pat', 'mergeBoard', jsonb_build_object('board', gone, 'into', keep), null, 'because', now() - interval '1 minute', now() - interval '1 minute', true) returning id into q;
  perform tests.become_service();
  perform system_tick();
  if (select landed_act from queued_moves where id = q) is null then raise exception 'the merge did not land'; end if;
  if board_closed_to(gone) is null then raise exception 'the board is not closed'; end if;
  -- The merge carried the origin's thread to the board it went into, so a spin of it lands there. A spin of a post still on the closed board (a thread the merge has not carried yet) is what the guard refuses: the thread is put back on
  -- the closed board in the replica role, as the fixtures write rows, and a spin of its post meets the trigger.
  perform tests.unbecome();
  set local session_replication_role = replica;
  update threads set board = gone where id = th;
  set local session_replication_role = origin;
  perform tests.become_service();
  said := pg_temp.refused(format('select write_staff_spin(%L, %L, %L, %L)', 'hp-pat', gone_post, 'T', 'B'));
  if said is null then raise exception 'a spin of a post on a closed board was written'; end if;
  if said !~ '^55000 .*merged' then raise exception 'a spin on a closed board is not refused as a thread on one: %', said; end if;
  -- The refusal fired after the flag was opened (the trigger meets the insert), so the flag put back is what the error path restored.
  fl := coalesce(current_setting('kayfabb.staff_writer', true), '');
  if fl <> '' then raise exception 'the staff flag was left open after a refused insert: %', fl; end if;
  perform tests.unbecome();
  -- a client cannot call it
  foreach who in array array['anon', 'authenticated'] loop
    perform set_config('role', who, true);
    said := pg_temp.refused(format('select write_staff_spin(%L, %L, %L, %L)', 'hp-pat', post, 'T', 'B'));
    perform tests.unbecome();
    if said is null or said !~ '^42501' then raise exception '% can call write_staff_spin: %', who, said; end if;
  end loop;
end $$;

-- ---- Task 6: a persona's spin is its writing ----
-- Six reads count the persona's `spin` Acts beside its `post` Acts: the three waiting reads (a reply to a spin waits as a reply to a post does, once), pool_conversation (the spin is one of its posts), the presence functions (a persona
-- that spun is present), pool_orphans (a spin with a pool marker is adopted, a started thread), pool_signals' tallies (a reaction to a spin counts toward its priority) and pool_thread (a thread's spin is read as its first post).
do $$
declare
  ann uuid := tests.character(tests.account('h6-ann'), 'H6 Ann');
  bea uuid := tests.character(tests.account('h6-bea'), 'H6 Bea');
  base uuid := tests.thread('H6 Origin');
  origin uuid := tests.post(ann, base, 'Spin me, persona.');
  today text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD');
  r jsonb; elsewhere uuid := tests.thread('H6 Elsewhere'); spin uuid; th uuid; reply uuid; spin2 uuid; th2 uuid; before_t jsonb; after_t jsonb; t6 uuid; pspin uuid; pr jsonb;
  since timestamptz := now() - interval '2 days';
begin
  perform tests.become_service();
  r := write_staff_spin('hp-pat', origin, 'The persona spins', 'The persona''s opener words.', jsonb_build_object('pool', today));
  spin := (r -> 'act' ->> 'id')::uuid; th := (r -> 'thread' ->> 'id')::uuid;
  perform tests.unbecome();
  -- Nothing waits yet; a player replies to the spin, quoting it. (The three waiting reads are invoker functions, read as the owner here as supabase/tests/0415-chattier-staff.sql reads them.)
  if (select count(*) from pool_waiting_rows(array['hp-pat'], since) w where w.thread = th) is distinct from 0 then raise exception 'something waits on a spin with no reply'; end if;
  reply := tests.act(bea, 'post', th, '{"body": "A reply to the spin."}', spin);
  if (select count(*) from pool_waiting_rows(array['hp-pat'], since) w where w.thread = th and w.act = reply and w.author = bea) is distinct from 1 then
    raise exception 'pool_waiting_rows: a reply to a persona''s spin does not wait, once: %', (select jsonb_agg(w) from pool_waiting_rows(array['hp-pat'], since) w);
  end if;
  if (select count(*) from pool_waiting_in_thread(th, array['hp-pat'], since) w where w.act = reply) is distinct from 1 then raise exception 'pool_waiting_in_thread: a reply to a persona''s spin does not wait, once'; end if;
  if (select count(*) from pool_waiting_in_board((select board from threads where id = th), array['hp-pat'], since) w where w.act = reply) is distinct from 1 then raise exception 'pool_waiting_in_board: a reply to a persona''s spin does not wait, once'; end if;
  -- pool_waiting (the grouped read) carries it; write_staff_turn asks pool_waiting_in_thread for what it may answer.
  if (select g -> 'replies' -> 0 ->> 'act' from jsonb_array_elements(pool_waiting(array['hp-pat'], since)) g where g ->> 'thread' = th::text) is distinct from reply::text then raise exception 'pool_waiting does not carry the reply to the spin'; end if;
  -- It is in the conversation: the spin is one of the persona's posts, its body the spin's, the reply its reply.
  r := pool_conversation('hp-pat', th, 5, 5, 200);
  if jsonb_array_length(r -> 'posts') is distinct from 1 or r -> 'posts' -> 0 ->> 'act' is distinct from spin::text or r -> 'posts' -> 0 ->> 'body' is distinct from 'The persona''s opener words.' then
    raise exception 'pool_conversation does not hold the persona''s spin as a post: %', r;
  end if;
  if jsonb_array_length(r -> 'posts' -> 0 -> 'replies') is distinct from 1 or r -> 'posts' -> 0 -> 'replies' -> 0 ->> 'act' is distinct from reply::text then raise exception 'the reply to the spin is not in the conversation: %', r; end if;
  -- A post of the persona's beside its spin: both are its posts (one transaction, one instant, so no order is asserted).
  perform write_staff_act('hp-pat', 'post', th, null, '{"body": "A later post by the persona."}');
  r := pool_conversation('hp-pat', th, 5, 5, 200);
  if jsonb_array_length(r -> 'posts') is distinct from 2 or not exists (select 1 from jsonb_array_elements(r -> 'posts') e where e ->> 'act' = spin::text) then raise exception 'the spin and the post are not both in the conversation: %', r; end if;
  perform tests.unbecome();

  -- Presence: a persona in session is in the box of the thread it spun and of that thread's board, with no reply waiting there (a second spin with no reply).
  perform tests.become_service();
  perform write_sessions((now() at time zone 'UTC')::date, '[{"staff": "hp-pat", "start": 0, "end": 1440}]');
  r := write_staff_spin('hp-pat', tests.post(ann, tests.thread('H6 Origin Two'), 'Another to spin.'), 'The persona spins again', 'Nobody replies to this one.');
  spin2 := (r -> 'act' ->> 'id')::uuid; th2 := (r -> 'thread' ->> 'id')::uuid;
  if not exists (select 1 from jsonb_array_elements(presence_box('thread', th2) -> 'names') e where e ->> 'name' = 'Hp Pat' and (e ->> 'staff')::boolean) then
    raise exception 'a persona in session is not present in the thread it spun: %', presence_box('thread', th2);
  end if;
  if not exists (select 1 from jsonb_array_elements(presence_box('board', (select board from threads where id = th2)) -> 'names') e where e ->> 'name' = 'Hp Pat' and (e ->> 'staff')::boolean) then
    raise exception 'a persona in session is not present on the board it spun on';
  end if;
  if exists (select 1 from jsonb_array_elements(presence_box('thread', elsewhere) -> 'names') e where e ->> 'name' = 'Hp Pat') then raise exception 'a persona is present in a thread it has nothing in'; end if;

  -- pool_orphans: a spin carrying a pool marker whose spend was never recorded is adopted, a started thread.
  r := pool_orphans(today::date);
  if not exists (select 1 from jsonb_array_elements(r) e where e ->> 'act' = spin::text and e ->> 'staff' = 'hp-pat' and e ->> 'day' = today and (e ->> 'startedThread')::boolean) then
    raise exception 'an orphaned spin is not adopted as a started thread: %', r;
  end if;

  -- pool_signals' tallies: a reaction to a persona's spin counts toward its priority, and the spin counts among its posts.
  before_t := (select t from jsonb_array_elements(pool_signals(now() - interval '1 hour', now() + interval '1 hour') -> 'tallies') t where t ->> 'staff' = 'hp-pat');
  perform tests.unbecome();
  insert into reaction_tallies (act, kind, count) values (spin, 'up', 4);
  perform tests.become_service();
  after_t := (select t from jsonb_array_elements(pool_signals(now() - interval '1 hour', now() + interval '1 hour') -> 'tallies') t where t ->> 'staff' = 'hp-pat');
  perform tests.unbecome();
  if (after_t ->> 'reactions')::bigint - (before_t ->> 'reactions')::bigint is distinct from 4 then raise exception 'a reaction to a spin does not move the tally: % then %', before_t, after_t; end if;
  if coalesce((after_t ->> 'posts')::integer, 0) < 2 then raise exception 'the spins are not among the persona''s posts in the tally: %', after_t; end if;

  -- pool_thread of a player's spun thread lists the spin first, as the first post, with the spin's body.
  insert into threads (board, title, origin_act_id) select t.board, 'H6 Player spin', origin from threads t where t.id = base returning id into t6;
  pspin := tests.act(ann, 'spin', t6, '{"title": "H6 Player spin", "body": "The player''s opener."}', origin);
  perform tests.post(bea, t6, 'First reply.', now() + interval '1 second');
  perform tests.post(ann, t6, 'Second reply.', now() + interval '2 seconds');
  perform tests.post(bea, t6, 'Third reply.', now() + interval '3 seconds');
  perform tests.become_service();
  pr := pool_thread(t6, 2, 200);
  if jsonb_array_length(pr -> 'posts') is distinct from 3 or pr -> 'posts' -> 0 ->> 'act' is distinct from pspin::text or pr -> 'posts' -> 0 ->> 'body' is distinct from 'The player''s opener.' then
    raise exception 'pool_thread of a spun thread does not list the spin first with its body (the opener plus the newest 2): %', pr;
  end if;
  if pr -> 'posts' -> 0 ->> 'name' is distinct from 'H6 Ann' then raise exception 'the spin is not shown as its author''s: %', pr; end if;
  -- The persona's own spun thread reads the same; a thread with no spin is as it was.
  pr := pool_thread(th, 0, 200);
  if pr -> 'posts' -> 0 ->> 'act' is distinct from spin::text or pr -> 'posts' -> 0 ->> 'body' is distinct from 'The persona''s opener words.' then raise exception 'pool_thread of the persona''s spun thread: %', pr; end if;
  if jsonb_array_length(pool_thread(base, 5, 200) -> 'posts') is distinct from 1 then raise exception 'a thread with no spin changed: %', pool_thread(base, 5, 200); end if;
  -- the spin comes by `also` too without being listed twice
  pr := pool_thread(t6, 5, 200, pspin);
  if jsonb_array_length(pr -> 'posts') is distinct from 4 then raise exception 'the spin is listed twice or not at all when named: %', pr; end if;
  perform tests.unbecome();
end $$;

-- The cost: each waiting read's posts branch still probes acts_thread_posts (thread, character, created_at) for the persona's posts in its thread, with a branch of spins beside it, and the target index for replies.
-- A busy instance in miniature, as supabase/tests/0415-chattier-staff.sql seeds it: 40000 posts, a persona with 300 posts and 40 spins of its own.
do $$
declare
  boss uuid := (select id from characters where staff = 'hp-pat');
  th uuid[]; chars uuid[]; plan text; ln record; q text;
begin
  select array_agg(tests.thread('H6 Big ' || i)) into th from generate_series(1, 80) i;
  select array_agg(tests.character(tests.account('h6-big-' || i), 'H6 Big ' || i)) into chars from generate_series(1, 400) i;
  set local session_replication_role = replica;
  insert into acts (character, kind, thread, payload, seq, created_at)
  select chars[1 + (i % 400)], 'post', th[1 + (i % 80)], jsonb_build_object('body', 'Chatter ' || i), i / 80 + 2, now() - (i % 40000) * interval '3 seconds' from generate_series(1, 40000) i;
  insert into acts (character, kind, thread, payload, seq, created_at)
  select boss, 'post', th[1 + (i % 80)], jsonb_build_object('body', 'Staff ' || i), 100000 + i, now() - (i % 300) * interval '5 minutes' from generate_series(1, 300) i;
  insert into acts (character, kind, thread, payload, target_act_id, seq, created_at)
  select boss, 'spin', th[1 + (i % 80)], jsonb_build_object('title', 'T', 'body', 'Spun ' || i), (select a.id from acts a where a.thread = th[1 + (i % 80)] and a.kind = 'post' limit 1), 1, now() - (i % 40) * interval '5 minutes' from generate_series(1, 40) i;
  insert into acts (character, kind, thread, payload, target_act_id, seq, created_at)
  select chars[1 + (row_number() over ())::int % 400], 'post', p.thread, '{"body": "A reply."}', p.id, 200000 + row_number() over (), now() - interval '10 minutes'
  from (select id, thread from acts where character = boss and kind in ('post', 'spin') and thread = any (th) order by created_at desc limit 40) p;
  set local session_replication_role = origin;
  analyze acts;
  analyze characters;
  -- As 0304-post-veils.sql does: with seq scans priced out, a Seq Scan on acts in a plan means no index can serve that part, which is what this asks; a planner's choice of a scan over an index it could use (as CI's made
  -- for acts_public's latest-edit probe, over a table seeded with no edits) is not.
  set local enable_seqscan = off;
  -- A spin is always its thread's opener (seq 1: spin_written and write_staff_spin each insert it as the first Act of the thread they make), so a thread-keyed spin branch is keyed on (thread, seq = 1) and is one probe
  -- however large the thread; the seeded spins above are one to a thread (threads 2 to 41), each seq 1. A spin branch keyed on the persona alone (a board's, or all of them) is bounded by the persona's own openers.
  foreach q in array array[
    format('select * from pool_waiting_rows(array[%L], now() - interval ''2 days'')', 'hp-pat'),
    format('select * from pool_waiting_in_thread(%L, array[%L], now() - interval ''2 days'')', th[2], 'hp-pat'),
    format('select * from pool_waiting_in_board(%L, array[%L], now() - interval ''2 days'')', (select board from threads where id = th[2]), 'hp-pat'),
    -- pool_conversation and the presence functions are not inlined (security definer, plpgsql), so an explain of the call shows one function scan: their spin branch is explained here as written, and their source is checked below to carry the same key.
    format('select a.id, a.created_at, a.current_payload from acts_public a where a.thread = %L and a.seq = 1 and a.kind = ''spin'' and a.character = (select c.id from characters c where c.staff = %L)', th[2], 'hp-pat'),
    format('select exists (select 1 from acts_public x where x.thread = %L and x.character = %L and x.kind = ''spin'' and x.seq = 1 and x.created_at >= now() - interval ''2 days'')', th[2], boss),
    format('select exists (select 1 from acts_public x join threads xt on xt.id = x.thread where xt.board = %L and x.character = %L and x.kind = ''spin'' and x.seq = 1 and x.created_at >= now() - interval ''2 days'')', (select board from threads where id = th[2]), boss)] loop
    plan := '';
    for ln in execute 'explain ' || q loop plan := plan || E'\n' || ln."QUERY PLAN"; end loop;
    if plan ~ 'Seq Scan on acts\M' or plan ~ 'Merge Join' then raise exception 'a read scans or merges acts (%): %', q, plan; end if;
    if q like '%pool_waiting%' and (plan !~ 'acts_(target|replies)' or plan !~ 'target_act_id = ') then raise exception 'a waiting read does not probe the target index for replies (%): %', q, plan; end if;
    if q like '%pool_waiting_in_thread%' and (plan !~ 'acts_thread_posts' or plan !~ format('thread = ''%s''', th[2])) then raise exception 'the thread read does not probe acts_thread_posts for the posts branch: %', plan; end if;
    -- The spin branch of every read is a probe of an opener index (the unique (thread, seq) one when the thread is named, the persona's openers (character, thread) where seq = 1 otherwise) and never acts_patrol_posts, which a
    -- thread-keyed spin branch without seq = 1 is served by, scanning the thread's whole window to filter it by character.
    if plan !~ 'Index (Only )?Scan using (acts_thread_seq_key|acts_thread_openers) on acts' or plan ~ 'acts_patrol_posts' then
      raise exception 'a read''s spin branch is not a probe of acts_thread_seq_key or acts_thread_openers (%): %', q, plan;
    end if;
    -- A thread-keyed spin branch is one probe with the thread and the opener both in the key: acts_thread_seq_key on (thread, seq = 1), or acts_thread_openers (character, thread) where seq = 1 with the thread given; the planner
    -- takes either, and neither grows with the thread.
    if q ~ 'pool_waiting_in_thread|a\.thread = |x\.thread = ' and plan !~ format('using acts_thread_seq_key on acts[^
]*
\s*Index Cond: [^
]*thread = ''%1$s''::uuid\)? AND \(?seq = 1|using acts_thread_openers on acts[^
]*
\s*Index Cond: [^
]*thread = ''%1$s''::uuid', th[2]) then
      raise exception 'a thread-keyed spin branch is not keyed on the thread''s opener (%): %', q, plan;
    end if;
  end loop;
  set local enable_seqscan = on;
  -- The explained spin branches of pool_conversation and the presence functions are copies of the functions' own; the functions carry the same key.
  if (select count(*) from pg_proc where proname in ('presence_staff_in_thread', 'presence_staff_in_board') and prosrc ~ 'x\.kind = ''spin'' and x\.seq = 1') is distinct from 2
     or (select count(*) from pg_proc where proname = 'pool_conversation' and prosrc ~ 'a\.seq = 1 and a\.kind = ''spin''') is distinct from 1 then
    raise exception 'a presence function''s or pool_conversation''s spin test is not keyed on seq = 1';
  end if;
end $$;

-- ---- Review fix F1: a spin is spent and noted ----
-- record_pool_spend (0317) and write_staff_note (0089) took only a `post` Act, so the spin write_staff_spin makes was never spent: kept_picks listed the pick again every round and pool_week counted the week's thread as unused, so every
-- round paid for another model call and wrote another spun thread. Both take a persona's `post` or `spin` now, and still refuse any other Act (a card, an edit, another character's post or spin) with the messages they gave.
do $$
declare
  ann uuid := tests.character(tests.account('f1-ann'), 'F1 Ann');
  d1 date := date_trunc('week', '2051-03-01'::timestamp)::date + 1;
  d0 date := date_trunc('week', '2051-03-01'::timestamp)::date;
  origin uuid := tests.post(ann, tests.thread('F1 Origin'), 'Spin me, persona.');
  edit uuid := tests.act(ann, 'edit', (select thread from acts where id = origin), '{"body": "Edited."}', origin);
  r jsonb; spin1 uuid; spin2 uuid; pspin uuid; th uuid; said text; n bigint;
begin
  perform tests.become_service();
  -- A spun thread's spend, with started = true, and its note.
  r := write_staff_spin('hp-pat', origin, 'F1 spun', 'Spun words.', jsonb_build_object('pool', d1::text));
  spin1 := (r -> 'act' ->> 'id')::uuid; th := (r -> 'thread' ->> 'id')::uuid;
  perform keep_pick(d1, 'hp-pat', '{"trigger": "hot"}');
  if jsonb_array_length(kept_picks(d1)) is distinct from 1 then raise exception 'the kept pick is not listed before its spend: %', kept_picks(d1); end if;
  r := record_pool_spend(d1, 'hp-pat', 'hotOnBeat', spin1, null, true, '{}', 0);
  if r ->> 'status' is distinct from 'spent' then raise exception 'a spin takes no spend: %', r; end if;
  if (select s.started_thread from pool_spends s where s.day = d1 and s.staff = 'hp-pat' and s.post_act = spin1) is distinct from true then raise exception 'the spend of a spin is not a started thread'; end if;
  if jsonb_array_length(kept_picks(d1)) is distinct from 0 then raise exception 'a spent spin''s pick is listed again: %', kept_picks(d1); end if;
  if (pool_week(d1 + 1) ->> 'threads')::bigint is distinct from 1 then raise exception 'the week does not count the spun thread: %', pool_week(d1 + 1); end if;
  if write_staff_note('hp-pat', spin1, 'A note on the spin.') is null then raise exception 'a spin takes no note'; end if;
  if (select count(*) from staff_notes n where n.act = spin1 and n.staff = 'hp-pat') is distinct from 1 then raise exception 'the spin''s note was not written'; end if;

  -- An orphan spin: a pool-marked spin with no spend is listed as a started thread, and adopting it takes it off the list.
  r := write_staff_spin('hp-pat', tests.post(ann, tests.thread('F1 Origin Two'), 'Another.'), 'F1 spun two', 'More words.', jsonb_build_object('pool', d0::text));
  spin2 := (r -> 'act' ->> 'id')::uuid;
  if not exists (select 1 from jsonb_array_elements(pool_orphans(d1)) e where e ->> 'act' = spin2::text and (e ->> 'startedThread')::boolean and e ->> 'day' = d0::text) then
    raise exception 'an orphaned spin is not listed: %', pool_orphans(d1);
  end if;
  if exists (select 1 from jsonb_array_elements(pool_orphans(d1)) e where e ->> 'act' = spin1::text) then raise exception 'a spent spin is listed as an orphan'; end if;
  r := record_pool_spend(d0, 'hp-pat', 'adopted', spin2, null, true, '{}', 0);
  if r ->> 'status' is distinct from 'spent' then raise exception 'adopting an orphaned spin failed: %', r; end if;
  if exists (select 1 from jsonb_array_elements(pool_orphans(d1)) e where e ->> 'act' = spin2::text) then raise exception 'an adopted spin is still listed as an orphan'; end if;
  if (pool_week(d1 + 1) ->> 'threads')::bigint is distinct from 2 then raise exception 'the week does not count both spun threads: %', pool_week(d1 + 1); end if;

  -- Neither a post nor a spin of the persona's: refused as before.
  perform tests.unbecome();
  pspin := tests.act(ann, 'spin', (select thread from acts where id = spin1), '{"title": "x", "body": "A player''s spin."}', origin);
  perform tests.become_service();
  foreach r in array array[to_jsonb(edit), to_jsonb(origin), to_jsonb(pspin)] loop
    said := pg_temp.refused(format('select record_pool_spend(%L, %L, %L, %L, null, false, ''{}'', 0)', d1 + 1, 'hp-pat', 'hotOnBeat', r #>> '{}'));
    if said is distinct from '22023 the spend''s post is not a post of hp-pat' then raise exception 'a spend of another''s Act: %', said; end if;
    said := pg_temp.refused(format('select write_staff_note(%L, %L, %L)', 'hp-pat', r #>> '{}', 'No.'));
    if said is distinct from '22023 a note goes with a post of its own persona' then raise exception 'a note on another''s Act: %', said; end if;
  end loop;
  perform tests.unbecome();
end $$;
