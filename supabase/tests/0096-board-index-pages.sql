-- board_page and index_page (supabase/migrations/0094_board_index_pages.sql; the forum-load plan, Task 5): a board's page and the index in
-- one read. Two boards with threads: board_page's page 1 and page 2 hold the right threads and page 1 alone the pins; a page past the end
-- clamps; a missing slug is null; every piece equals the view or function read made directly here; index_page holds each board's newest
-- thread and count; anon is refused.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate;
end $$;

do $$
declare
  ann uuid := tests.account('bp-ann');
  bob uuid := tests.account('bp-bob');
  cat uuid := tests.account('bp-cat');
  c1 uuid := tests.character(cat, 'Reader Two');
  a1 uuid := tests.character(ann, 'Reader One');
  b1 uuid := tests.character(bob, 'Poster One');
  gen uuid := (select id from boards where slug = 'general');
  side uuid;
  t uuid;
  tp uuid;
  tp2 uuid;
  pin2 uuid;
  ban2 uuid;
  ts uuid;
  first_post uuid;
  pin_play uuid;
  banner_play uuid;
  got jsonb;
  want jsonb;
  ids_want jsonb;
  total integer;
  last_page integer;
  i integer;
begin
  insert into boards (slug, name, description) values ('side', 'Side Board', 'Off to the side.') returning id into side;

  -- Twenty-five threads on general, the newest posted a minute ago, each a minute older than the last.
  for i in 1..25 loop
    t := tests.thread('Thread ' || i);
    perform tests.post(b1, t, 'Post in ' || i, now() - (i || ' minutes')::interval);
  end loop;
  -- Two on the side board, the newer one by the other player's character.
  insert into threads (board, title) values (side, 'Side one') returning id into ts;
  perform tests.post(b1, ts, 'Side post.', now() - interval '2 hours');
  insert into threads (board, title) values (side, 'Side two') returning id into ts;
  perform tests.post(a1, ts, 'Newer side post.', now() - interval '1 hour');

  -- A pinned thread on general and a board card on general, both live, and a state, a release, a reading row and a view count.
  insert into threads (board, title) values (gen, 'Pinned') returning id into tp;
  first_post := tests.post(b1, tp, 'Pin me.', now() - interval '3 days');
  pin_play := tests.act(b1, 'card', tp, jsonb_build_object('card', 'banner', 'reach', 'thread', 'thread', tp, 'ends', now() + interval '1 day'), first_post);
  insert into play_reach (play, reach, thread, pins_board, ends_at) values (pin_play, 'thread', tp, gen, now() + interval '1 day');
  banner_play := tests.act(b1, 'card', (select id from threads where title = 'Thread 1'),
    jsonb_build_object('card', 'banner', 'reach', 'board', 'board', gen, 'ends', now() + interval '1 day'), null);
  insert into play_reach (play, reach, board, ends_at) values (banner_play, 'board', gen, now() + interval '1 day');
  -- A second pin (older) and a second board card (older): the order of each aggregate is the function's own, not luck.
  insert into threads (board, title) values (gen, 'Pinned two') returning id into tp2;
  pin2 := tests.act(b1, 'card', tp2, jsonb_build_object('card', 'banner', 'reach', 'thread', 'thread', tp2, 'ends', now() + interval '1 day'),
    tests.post(b1, tp2, 'Pin me too.', now() - interval '4 days'), now() - interval '1 hour');
  insert into play_reach (play, reach, thread, pins_board, ends_at) values (pin2, 'thread', tp2, gen, now() + interval '1 day');
  ban2 := tests.act(b1, 'card', (select id from threads where title = 'Thread 2'),
    jsonb_build_object('card', 'banner', 'reach', 'board', 'board', gen, 'ends', now() + interval '1 day'), null, now() - interval '2 hours');
  insert into play_reach (play, reach, board, ends_at) values (ban2, 'board', gen, now() + interval '1 day');
  insert into effect_state (play, state, saved_by) values (pin_play, '{"wash": 3}', b1);
  insert into effect_state (play, state, saved_by) values (banner_play, '{"wash": 1}', b1);
  insert into effect_releases (account, play) values (ann, pin_play);
  insert into effect_releases (account, play) values (bob, banner_play);
  insert into reading (account, thread, furthest_seq, first_character) values (ann, (select id from threads where title = 'Thread 3'), 1, a1);
  insert into reading (account, thread, furthest_seq, first_character) values (bob, (select id from threads where title = 'Thread 4'), 1, b1);
  insert into thread_view_counts (thread, views, counted_at) values ((select id from threads where title = 'Thread 3'), 7, now());

  -- Another player reacts to the pin too: the tally counts both, and ann's own reactions hold only hers.
  perform tests.become(cat);
  perform react(pin_play, c1, 'up');
  perform tests.unbecome();
  perform tests.become(ann);
  perform react(pin_play, a1, 'up');

  -- ---- board_page, page 1 ----
  got := board_page('general', 1, array['banner']);
  total := (select threads from board_counts where board = gen);
  last_page := greatest(1, ceil(total / 20.0))::integer;
  if last_page < 2 then raise exception 'the board needs a second page: % threads', total; end if;
  if got -> 'board' is distinct from (select to_jsonb(b) from (select id, slug, name, description, is_system, move_act from boards_now where id = gen) b) then
    raise exception 'the board: %', got -> 'board'; end if;
  if (got ->> 'total')::integer is distinct from total then raise exception 'total: %', got ->> 'total'; end if;
  if (got ->> 'page')::integer <> 1 then raise exception 'page: %', got ->> 'page'; end if;
  ids_want := (select jsonb_agg(f.id order by f.last_at desc) from (select id, last_at from thread_list where board = gen order by last_at desc limit 20) f);
  if (select jsonb_agg(e ->> 'id' order by n) from jsonb_array_elements(got -> 'threads') with ordinality x(e, n)) is distinct from ids_want then
    raise exception 'page 1 threads: %', got -> 'threads'; end if;
  if got -> 'threads' -> 0 is distinct from (select to_jsonb(l) from thread_list l where l.id = (ids_want ->> 0)::uuid) then raise exception 'a thread row is the thread_list row'; end if;
  want := (select coalesce(jsonb_agg(to_jsonb(p)), '[]') from pinned_threads(gen) p);
  if jsonb_array_length(want) <> 2 or got -> 'pins' is distinct from want or got -> 'pins' -> 0 ->> 'play' <> pin_play::text or got -> 'pins' -> 1 ->> 'play' <> pin2::text then raise exception 'pins: % wanted %', got -> 'pins', want; end if;
  want := (select coalesce(jsonb_agg(to_jsonb(p)), '[]') from effects_above('{}', null, gen) p);
  if jsonb_array_length(want) <> 2 or got -> 'banner' is distinct from want or got -> 'banner' -> 0 ->> 'play' <> ban2::text or got -> 'banner' -> 1 ->> 'play' <> banner_play::text then raise exception 'banner: % wanted %', got -> 'banner', want; end if;

  -- The plays' pieces: states for the cards asked, the caller's releases, tallies, the caller's reactions.
  if (select jsonb_agg(e ->> 'play' order by e ->> 'play') from jsonb_array_elements(got -> 'states') e)
     is distinct from (select jsonb_agg(s.play::text order by s.play::text) from effect_state s where s.play in (pin_play, banner_play)) then
    raise exception 'states: %', got -> 'states'; end if;
  if (select jsonb_agg(e ->> 'play') from jsonb_array_elements(got -> 'releases') e) is distinct from jsonb_build_array(pin_play::text) then
    raise exception 'releases hold only the caller''s: %', got -> 'releases'; end if;
  if jsonb_array_length(board_page('general', 1, array[]::text[]) -> 'states') <> 0 then raise exception 'no card asked, no state'; end if;
  want := (select coalesce(jsonb_agg(to_jsonb(r) order by r.act, r.kind), '[]') from (select act, kind, count from reaction_tallies where act in (pin_play, banner_play)) r);
  if (select coalesce(jsonb_agg(e order by e ->> 'act', e ->> 'kind'), '[]') from jsonb_array_elements(got -> 'tallies') e) is distinct from want or jsonb_array_length(want) = 0 then
    raise exception 'tallies: % wanted %', got -> 'tallies', want; end if;
  want := (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from (select act, kind, character from my_reactions where act in (pin_play, banner_play)) r);
  if got -> 'mine' is distinct from want or jsonb_array_length(want) <> 1 then raise exception 'mine: % wanted %', got -> 'mine', want; end if;
  if got -> 'mine' -> 0 ->> 'character' <> a1::text or (select (e ->> 'count')::integer from jsonb_array_elements(got -> 'tallies') e where (e ->> 'act') = pin_play::text) is distinct from 2 then
    raise exception 'mine holds only ann''s reaction, the tally both: % %', got -> 'mine', got -> 'tallies'; end if;

  -- The listed threads' pieces.
  if (select jsonb_agg(e ->> 'thread') from jsonb_array_elements(got -> 'reading') e) is distinct from
     jsonb_build_array((select id::text from threads where title = 'Thread 3')) then raise exception 'reading holds only the caller''s: %', got -> 'reading'; end if;
  if got -> 'reading' -> 0 ->> 'furthest_seq' <> '1' then raise exception 'reading: %', got -> 'reading'; end if;
  if (select jsonb_agg(e ->> 'thread') from jsonb_array_elements(got -> 'views') e) is distinct from jsonb_build_array((select id::text from threads where title = 'Thread 3'))
     or got -> 'views' -> 0 ->> 'views' <> '7' then raise exception 'views: %', got -> 'views'; end if;
  if (select jsonb_agg(e ->> 'id') from jsonb_array_elements(got -> 'characters') e) is distinct from jsonb_build_array(b1::text) then
    raise exception 'characters: %', got -> 'characters'; end if;
  if got -> 'characters' -> 0 ->> 'name' <> 'Poster One' then raise exception 'a character has its name: %', got -> 'characters'; end if;
  if got -> 'presence' is distinct from presence_box('board', gen) then raise exception 'presence: %', got -> 'presence'; end if;
  if (got ->> 'unread')::integer is distinct from my_alerts_unread() then raise exception 'unread: %', got -> 'unread'; end if;

  -- ---- page 2, clamping, missing ----
  got := board_page('general', 2, array[]::text[]);
  ids_want := (select jsonb_agg(f.id order by f.last_at desc) from (select id, last_at from thread_list where board = gen order by last_at desc offset 20 limit 20) f);
  if (select jsonb_agg(e ->> 'id' order by n) from jsonb_array_elements(got -> 'threads') with ordinality x(e, n)) is distinct from ids_want then
    raise exception 'page 2 threads: %', got -> 'threads'; end if;
  if jsonb_array_length(got -> 'pins') <> 0 or jsonb_array_length(got -> 'threads') = 0 then raise exception 'page 2 holds no pins: %', got -> 'pins'; end if;
  if (board_page('general', 999, array[]::text[]) ->> 'page')::integer <> last_page then raise exception 'a page past the end clamps to %', last_page; end if;
  if board_page('general', 999, array[]::text[]) -> 'threads' is distinct from got -> 'threads' then raise exception 'the clamped page is the last page'; end if;
  if (board_page('general', 0, array[]::text[]) ->> 'page')::integer <> 1 or (board_page('general', null, array[]::text[]) ->> 'page')::integer <> 1 then
    raise exception 'page 0 or null is page 1'; end if;
  if board_page('no-such-board', 1, array[]::text[]) is not null then raise exception 'a missing slug is null'; end if;
  if board_page(gen::text, 1, array[]::text[]) -> 'board' ->> 'slug' <> 'general' then raise exception 'a board by its id'; end if;
  if board_page('side', 1, array[]::text[]) ->> 'total' <> '2' then raise exception 'the side board holds two'; end if;
  if board_page('side', 1, array[]::text[]) -> 'threads' -> 0 ->> 'title' <> 'Side two' then raise exception 'newest first'; end if;

  -- ---- index_page ----
  got := index_page();
  if jsonb_array_length(got -> 'boards') <> (select count(*) from boards_now) then raise exception 'index boards: %', got -> 'boards'; end if;
  if (select (e ->> 'thread_count')::integer from jsonb_array_elements(got -> 'boards') e where e ->> 'slug' = 'general') is distinct from total then raise exception 'general count'; end if;
  if (select e ->> 'last_thread' from jsonb_array_elements(got -> 'boards') e where e ->> 'slug' = 'side') is distinct from ts::text
     or (select e ->> 'last_character' from jsonb_array_elements(got -> 'boards') e where e ->> 'slug' = 'side') is distinct from a1::text then
    raise exception 'side board newest thread: %', got -> 'boards'; end if;
  if (select (e ->> 'thread_count')::integer from jsonb_array_elements(got -> 'boards') e where e ->> 'slug' = 'side') is distinct from 2 then raise exception 'side count'; end if;
  if (select e ->> 'last_thread' from jsonb_array_elements(got -> 'boards') e where e ->> 'slug' = 'general')
     is distinct from (select l.id::text from thread_list l where l.board = gen order by l.last_at desc limit 1) then raise exception 'general newest thread'; end if;
  if (select jsonb_agg(e ->> 'id' order by e ->> 'id') from jsonb_array_elements(got -> 'characters') e)
     is distinct from (select jsonb_agg(q.x::text order by q.x::text) from (select distinct l.last_character x from thread_list l
                         where l.last_character is not null
                           and l.id in (select (select n.id from thread_list n where n.board = b.id order by n.last_at desc limit 1) from boards b)) q) then
    raise exception 'index characters: %', got -> 'characters'; end if;
  if got -> 'presence' is distinct from presence_box('index', null) then raise exception 'index presence'; end if;
  if (got ->> 'unread')::integer is distinct from my_alerts_unread() then raise exception 'index unread'; end if;
  perform tests.unbecome();

  -- ---- anon ----
  perform tests.become_anon();
  if pg_temp.refusal(format('select board_page(%L, 1, array[]::text[])', 'general')) is distinct from '42501' then raise exception 'anon reads a board'; end if;
  if pg_temp.refusal('select index_page()') is distinct from '42501' then raise exception 'anon reads the index'; end if;
  perform tests.unbecome();
end $$;
