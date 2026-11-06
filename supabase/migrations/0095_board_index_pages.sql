-- board_page and index_page (the forum-load plan, Task 5; the design's section 2): a board's page and the index, each in one read.
-- What they hold is what BoardScreen's and IndexScreen's loads read today, in the same order and the same projections, as the
-- adapter's own reads (web/src/data/supabase.ts: board, threads, pinnedThreads, effectsAbove, effectStates, myReleases, tallies,
-- myReactions, reading, viewCounts, characters, boards): the rows are the views' own columns, not reshaped.
--
-- The bound: a board's page is at most 20 threads (THREADS_PER_PAGE, engine/ui/board/Board.tsx), the board's live pins (a handful),
-- its one board card, and what those hold: their authors, their tallies, states and releases. The index is one row a board
-- (a lateral probe of thread_list by the (board, last_at) index) and one character a board. Nothing grows with the instance's Acts.
--
-- The masks: each is `security invoker` and `stable`, and reads only the public projections the browser reads (boards_now, board_counts,
-- thread_list, reaction_tallies, effect_state, thread_view_counts, characters_public, character_profiles) and the caller's own rows
-- (reading, effect_releases, my_reactions, my_alerts_unread) as the caller, plus the functions the browser may call (pinned_threads,
-- effects_above, presence_box, my_alerts_unread). supabase/tests/e2e/0016-screen-reads.ts holds that. They write nothing: a read of a
-- board does not mark a mask present (presence_box, not here).
--
-- Ways out: no state is added; a page is a read. A page past the end shows the last, a missing board is null (the screen's "no such
-- board").

-- ------------------------------------------------------------------------------------------------------------ board_page ----

-- in_slug may also be the board's id, as api.board(slugOrId) takes either. in_page is clamped to 1..last page. Pins are page 1's alone.
-- Threads are ordered by last_at desc alone, as the adapter orders them, which the (board, last_at desc) index serves. The 20 is
-- THREADS_PER_PAGE in engine/ui/board/Board.tsx and must match it. A pin's and a banner's order is spelled out below to match
-- pinned_threads (created_at desc, id desc) and effects_above (created_at, id).
create function board_page(in_slug text, in_page integer, effect_cards text[]) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with b as (
    select x.id, x.slug, x.name, x.description, x.is_system, x.move_act from boards_now x where x.slug = in_slug or x.id::text = in_slug order by (x.slug = in_slug) desc limit 1
  ),
  p as (
    select b.id as board, c.total,
           least(greatest(coalesce(in_page, 1), 1), greatest(1, ceil(c.total / 20.0)::integer)) as page
    from b cross join lateral (select coalesce((select n.threads from board_counts n where n.board = b.id), 0) as total) c
  ),
  listed as materialized (
    select l.* from thread_list l
    where l.board = (select board from p)
    order by l.last_at desc
    offset (select (page - 1) * 20 from p) limit 20
  ),
  pins as materialized (
    select x.thread, x.play, x.ends_at, x.act from p cross join lateral pinned_threads(p.board) x where p.page = 1
  ),
  banner as materialized (
    select x.play, x.reach, x.target, x.ends_at, x.act from p cross join lateral effects_above('{}'::uuid[], null::uuid, p.board) x
  ),
  marked as materialized (
    select (m.act ->> 'id')::uuid as id, m.act ->> 'character' as character, m.act #>> '{payload,card}' as card
    from (select act from pins union all select act from banner) m
  ),
  wanted as (select m.id from marked m where m.card = any (coalesce(effect_cards, '{}'))),
  threads as materialized (
    select l.id, l.first_character, l.last_character from listed l
    union
    select (x.thread ->> 'id')::uuid, (x.thread ->> 'first_character')::uuid, (x.thread ->> 'last_character')::uuid from pins x
  ),
  people as (
    select t.first_character as id from threads t union select t.last_character from threads t union select m.character::uuid from marked m
  )
  select jsonb_build_object(
    'board', to_jsonb(b),
    'total', p.total,
    'page', p.page,
    'threads', (select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from listed l),
    'pins', (select coalesce(jsonb_agg(to_jsonb(x) order by (x.act ->> 'created_at')::timestamptz desc, x.play desc), '[]'::jsonb) from pins x),
    'banner', (select coalesce(jsonb_agg(to_jsonb(x) order by (x.act ->> 'created_at')::timestamptz, x.play), '[]'::jsonb) from banner x),
    'states', (select coalesce(jsonb_agg(jsonb_build_object('play', s.play, 'state', s.state, 'saved_at', s.saved_at)), '[]'::jsonb)
               from effect_state s where s.play in (select id from wanted)),
    'releases', (select coalesce(jsonb_agg(jsonb_build_object('play', r.play)), '[]'::jsonb)
                 from effect_releases r where r.play in (select id from wanted)),
    'tallies', (select coalesce(jsonb_agg(jsonb_build_object('act', t.act, 'kind', t.kind, 'count', t.count)), '[]'::jsonb)
                from reaction_tallies t where t.act in (select id from marked)),
    'mine', (select coalesce(jsonb_agg(jsonb_build_object('act', r.act, 'kind', r.kind, 'character', r.character)), '[]'::jsonb)
             from my_reactions r where r.act in (select id from marked)),
    'reading', (select coalesce(jsonb_agg(jsonb_build_object('thread', r.thread, 'furthest_seq', r.furthest_seq)), '[]'::jsonb)
                from reading r where r.thread in (select id from threads)),
    'views', (select coalesce(jsonb_agg(jsonb_build_object('thread', v.thread, 'views', v.views)), '[]'::jsonb)
              from thread_view_counts v where v.thread in (select id from threads)),
    'characters', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office,
                     'profile', case when f.character is null then null else jsonb_build_object(
                       'title', f.title, 'signature', f.signature, 'avatar_square', f.avatar_square, 'avatar_portrait', f.avatar_portrait,
                       'square_frame', f.square_frame, 'portrait_frame', f.portrait_frame, 'pip_style', f.pip_style) end)), '[]'::jsonb)
                   from characters_public c left join character_profiles f on f.character = c.id
                   where c.id in (select id from people where id is not null)),
    'presence', presence_box('board', p.board),
    'unread', my_alerts_unread())
  from b join p on p.board = b.id;
end;

revoke execute on function board_page(text, integer, text[]) from public, anon, authenticated;
grant execute on function board_page(text, integer, text[]) to authenticated;

-- ------------------------------------------------------------------------------------------------------------ index_page ----

-- The boards as api.boards() reads them: each board's name, description, count (board_counts) and newest thread, one row a board.
-- The newest thread is a lateral probe of thread_list by the (board, last_at) index, a row a board instead of a request a board.
create function index_page() returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with bs as materialized (
    select b.id, b.slug, b.name, b.description, b.is_system, b.move_act, b.created_at,
           coalesce(c.threads, 0) as thread_count, l.id as last_thread, l.last_at, l.last_character
    from boards_now b
    left join board_counts c on c.board = b.id
    left join lateral (
      select t.id, t.last_at, t.last_character from thread_list t where t.board = b.id order by t.last_at desc limit 1
    ) l on true
  )
  select jsonb_build_object(
    'boards', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act,
                 'thread_count', b.thread_count, 'last_at', b.last_at, 'last_character', b.last_character, 'last_thread', b.last_thread)
               order by b.created_at, b.id), '[]'::jsonb) from bs b),
    'characters', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office,
                     'profile', case when f.character is null then null else jsonb_build_object(
                       'title', f.title, 'signature', f.signature, 'avatar_square', f.avatar_square, 'avatar_portrait', f.avatar_portrait,
                       'square_frame', f.square_frame, 'portrait_frame', f.portrait_frame, 'pip_style', f.pip_style) end)), '[]'::jsonb)
                   from characters_public c left join character_profiles f on f.character = c.id
                   where c.id in (select b.last_character from bs b where b.last_character is not null)),
    'presence', presence_box('index', null),
    'unread', my_alerts_unread());
end;

revoke execute on function index_page() from public, anon, authenticated;
grant execute on function index_page() to authenticated;
