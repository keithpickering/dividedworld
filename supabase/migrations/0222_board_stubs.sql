-- Board stubs, a closed board's page, and a thread started on a closed board (docs/plans/2026-11-06-fangame-split-plan.md, Task 3; design section 4, "Noticing").
--
-- A thread a move took away from a board is listed on that board for `movedStubDays` days, below the board's own threads, as a stub that says where it is now. A board that is
-- closed (merged into another, or made by a move that was reversed) answers its page with {closed, mergedInto | fallback} and no threads; the index lists none; and a thread started on
-- one is refused in words that name where its threads went. Every state here has its way out: a stub goes by itself after movedStubDays, a closed board's page links to the board
-- that took its threads, and the refusal says where to start the thread instead.
--
-- "Moved away at time t" is read from the move's landing, not guessed afterward. thread_departures (act, thread, from_board, left_at) is one row for each moveThread Act, written by a
-- trigger when the Act is inserted, from the board the thread is stored on at that instant: the landing writes the Act and only then rebuilds threads.board (0216), so the stored board is
-- exactly the one it leaves, a merge's re-homing included. It is insert-only (its guard is enabled always), like origin_board: it is a fact about the Act it names, the way `seq` is. A
-- move later reversed or overturned is ignored by the read (its move_end), and a thread that is back on the board is no stub of it. A move that was superseded stays a stub of the
-- board it left (the thread did leave), and the board it is on now is read from threads.board, so a stub always names where the thread is today. A mergeBoard writes no row: the merged
-- board is closed and its page shows no stubs, and the threads it sent on are on the other board as its own.
--
--   board_stubs(board)           the stubs of a board as a jsonb array, newest move first, at most 50 (a Boss's moves are few, and a stub is a pointer, not an archive).
--   board_closed_to(board)       null for an open board; for a closed one {mergedInto} or {fallback}, each a {id, slug, name}: the merge in force, else the creating move's fallback, else the first open board.
--   not_closed(board)            the refusal start_thread makes, in words.
--   moved_stub_days()            the setting, 7 where an instance seeded before it has none (as digestBoards).
--   board_page (0125)            gains `closed`, `mergedInto`, `fallback` and `stubs`; a closed board's page lists nothing (no threads, pins, banner or presence) and keeps the board and the count of unread.
--   index_page (0143)            leaves out a closed board.
--   start_thread (0130)          refuses a closed board after the board is found, beside not_the_systems; before it asks, it takes the board's shared place key (lock_board_start, 0235) in a statement of its
--                                own, so a merge or a reversed createBoard that is closing the board and has not committed is waited for, and the check that follows sees it (final review of PR #450, F7).
--   settings_held (0221)         copied whole; movedStubDays is a whole number from 1 to 365.
--
-- Cost on a busy instance. Write: one row a moveThread, which is a Boss's decision (a few a meeting), and nothing for any other Act. Read: a board's page reads thread_departures by
-- (from_board, left_at desc), a range of the moves that left that board inside the window, then one probe of threads by id each (50 at most). It never reads the Acts of other boards or a
-- scan of moves: the page costs what that board's own departures cost, whatever the instance's history. The index index_page reads is unchanged (boards_now's closed is computed once a board).
-- Masks. A move, the board a thread is on and its title are public; nothing here is computed from who owns a character, a class or a reaction.
-- Append-only. No Act is touched; the new table is written once a row and never updated.

create table thread_departures (
  act uuid primary key references acts (id),
  thread uuid not null references threads (id),
  from_board uuid not null references boards (id),
  left_at timestamptz not null
);
create index thread_departures_from on thread_departures (from_board, left_at desc);
alter table thread_departures enable row level security;
revoke all on thread_departures from public, anon, authenticated;

create function thread_departures_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  th uuid := safe_uuid(new.payload #>> '{params,thread}');
  there uuid;
begin
  select t.board into there from threads t where t.id = th;
  if there is not null then
    insert into thread_departures (act, thread, from_board, left_at) values (new.id, th, there, new.created_at) on conflict (act) do nothing;
  end if;
  return null;
end $$;
revoke execute on function thread_departures_write() from public, anon, authenticated;
create trigger acts_thread_departures after insert on acts for each row
  when (new.kind = 'move' and new.payload ->> 'kind' = 'moveThread') execute function thread_departures_write();

create function thread_departures_fixed() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'a thread''s departure is a fact of the move that took it; it is never changed' using errcode = 'P0001';
end $$;
revoke execute on function thread_departures_fixed() from public, anon, authenticated;
create trigger thread_departures_fixed before update or delete on thread_departures for each row execute function thread_departures_fixed();
alter table thread_departures enable always trigger thread_departures_fixed;

create function moved_stub_days() returns integer
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return (setting('movedStubDays'))::integer;
exception when no_data_found then
  return 7;
end $$;
revoke execute on function moved_stub_days() from public, anon, authenticated;
grant execute on function moved_stub_days() to service_role;

-- A board's stubs. Each thread once, by its latest departure from this board inside the window that is not ended as reversed or overturned, and only if the thread is not back here.
create function board_stubs(in_board uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.thread, 'title', s.title, 'moved_to', s.board, 'moved_to_slug', n.slug, 'moved_to_name', n.name, 'moved_at', s.left_at)
                           order by s.left_at desc, s.thread), '[]'::jsonb)
  from (
    select * from (
      select distinct on (d.thread) d.thread, d.left_at, t.title, t.board
      from thread_departures d
      join threads t on t.id = d.thread
      where d.from_board = in_board and d.left_at >= now() - moved_stub_days() * interval '1 day' and t.board <> in_board
        and not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = d.act and e.payload ->> 'why' in ('reversed', 'overturned'))
      order by d.thread, d.left_at desc
    ) latest
    order by left_at desc, thread
    limit 50
  ) s
  join boards_now n on n.id = s.board
$$;
revoke execute on function board_stubs(uuid) from public, anon;
grant execute on function board_stubs(uuid) to authenticated;

-- Where a closed board's threads went: null for an open board. The board the move names (a merge's `into`, a reversed creation's `fallback`), else the first open board; it may itself be closed since,
-- and its own page says where its threads went in turn.
create function board_closed_to(in_board uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when not n.closed then null
    when n.merged_into is not null then jsonb_build_object('mergedInto', (select jsonb_build_object('id', m.id, 'slug', m.slug, 'name', m.name) from boards_now m where m.id = n.merged_into))
    else jsonb_build_object('fallback', (
      select jsonb_build_object('id', f.id, 'slug', f.slug, 'name', f.name) from boards_now f
      where f.id = coalesce((select x.id from boards b join acts a on a.id = b.created_by_act join boards_now x on x.id = safe_uuid(a.payload #>> '{params,fallback}')
                             where b.id = in_board and x.id <> in_board and not x.is_system), first_open_board()))) end
  from boards_now n where n.id = in_board
$$;
revoke execute on function board_closed_to(uuid) from public, anon;
grant execute on function board_closed_to(uuid) to authenticated;

create function not_closed(on_board uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  went jsonb := board_closed_to(on_board);
begin
  if went is null then return; end if;
  if went ? 'mergedInto' then
    raise exception 'this board was merged into %, and its threads are there; start your thread there instead', went -> 'mergedInto' ->> 'name' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  raise exception 'this board was closed, and its threads are in %; start your thread there instead', coalesce(went -> 'fallback' ->> 'name', 'another board') using hint = 'kayfabb.refusal', errcode = '55000';
end $$;
revoke execute on function not_closed(uuid) from public, anon, authenticated;
grant execute on function not_closed(uuid) to service_role;

-- start_thread (0130), refusing a closed board after the board is found. Everything else as 0130 wrote it.
CREATE OR REPLACE FUNCTION public.start_thread(board_slug text, through uuid, title text, body text, framing uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  on_board uuid;
  made uuid;
  written uuid;
begin
  perform acting(through);
  perform not_banned(through);
  perform within('title', title, 'titleMaxLength');
  perform within('body', body, 'postMaxLength');
  select id into on_board from boards where slug = board_slug;
  if on_board is null then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform not_the_systems(on_board);
  -- Shared, and in a statement before the check, so the check's snapshot is made once a closing move on this board has committed (or none is open): the thread is never stored on a board that is closing.
  perform lock_board_start(on_board);
  perform not_closed(on_board);
  perform not_barred(through, on_board);
  insert into threads (board, title) values (on_board, title) returning id into made;
  insert into acts (character, kind, thread, payload) values (through, 'post', made, jsonb_build_object('body', body)) returning id into written;
  perform write_framed(body, framing, written, auth.uid());
  perform draw_visits(written);
  return jsonb_build_object('thread', thread_projection(made), 'act', act_projection(written));
end $function$;

-- index_page (0143), leaving out a closed board. Everything else as 0143 wrote it.
create or replace function index_page() returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with bs as materialized (
    select b.id, b.slug, b.name, b.description, b.is_system, b.move_act, b.created_at,
           coalesce(c.threads, 0) as thread_count, l.id as last_thread, l.title as last_title, l.last_at, l.last_character
    from boards_now b
    left join board_counts c on c.board = b.id
    left join lateral (
      select t.id, t.title, t.last_at, t.last_character from thread_list t where t.board = b.id order by t.last_at desc limit 1
    ) l on true
    where not b.closed
  )
  select jsonb_build_object(
    'boards', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', b.id, 'slug', b.slug, 'name', b.name, 'description', b.description, 'is_system', b.is_system, 'move_act', b.move_act,
                 'thread_count', b.thread_count, 'last_at', b.last_at, 'last_character', b.last_character, 'last_thread', b.last_thread, 'last_title', b.last_title)
               order by b.created_at, b.id), '[]'::jsonb) from bs b),
    'characters', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', c.id, 'name', c.name, 'joined', c.joined, 'staff', c.staff, 'office', c.office,
                     'profile', case when f.character is null then null else jsonb_build_object(
                       'title', f.title, 'signature', f.signature, 'avatar_square', f.avatar_square, 'avatar_portrait', f.avatar_portrait,
                       'square_frame', f.square_frame, 'portrait_frame', f.portrait_frame, 'pip_style', f.pip_style, 'pronouns', f.pronouns) end)), '[]'::jsonb)
                   from characters_public c left join character_profiles f on f.character = c.id
                   where c.id in (select b.last_character from bs b where b.last_character is not null)),
    'presence', presence_box('index', null),
    'unread', my_alerts_unread());
end;

-- board_page (0125), with the board's stubs, and a closed board's page. The `b` step also reads `closed`; `p` is empty for a closed board, so every step that hangs on it is empty
-- (no threads, pins, banner, states, tallies, reading, views or characters) and presence is left out; the board and the unread count stay. Stubs are on the last page, below
-- the board's own threads. Everything else as 0125 wrote it.
create or replace function board_page(in_slug text, in_page integer, effect_cards text[]) returns jsonb
language sql stable security invoker set search_path = public, pg_temp
begin atomic
  with b as (
    select x.id, x.slug, x.name, x.description, x.is_system, x.move_act, x.closed from boards_now x where x.slug = in_slug or x.id::text = in_slug order by (x.slug = in_slug) desc limit 1
  ),
  p as (
    select b.id as board, c.total,
           least(greatest(coalesce(in_page, 1), 1), greatest(1, ceil(c.total / 20.0)::integer)) as page,
           greatest(1, ceil(c.total / 20.0)::integer) as last_page
    from b cross join lateral (select coalesce((select n.threads from board_counts n where n.board = b.id), 0) as total) c
    where not b.closed
  ),
  went as (select board_closed_to(b.id) as to_board from b where b.closed),
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
    'board', to_jsonb(b) - 'closed',
    'closed', b.closed,
    'mergedInto', (select w.to_board -> 'mergedInto' from went w),
    'fallback', (select w.to_board -> 'fallback' from went w),
    'stubs', case when p.page = p.last_page then board_stubs(p.board) else '[]'::jsonb end,
    'total', coalesce(p.total, 0),
    'page', coalesce(p.page, 1),
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
                       'square_frame', f.square_frame, 'portrait_frame', f.portrait_frame, 'pip_style', f.pip_style, 'pronouns', f.pronouns) end)), '[]'::jsonb)
                   from characters_public c left join character_profiles f on f.character = c.id
                   where c.id in (select id from people where id is not null)),
    'presence', case when p.board is null then null else presence_box('board', p.board) end,
    'unread', my_alerts_unread())
  from b left join p on p.board = b.id;
end;

-- settings_held (0221), also holding movedStubDays (a whole number from 1 to 365). Everything else as 0221 wrote it.
create or replace function settings_held() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v jsonb := new.value;
  why text;
  shape text;
  phase text;
  pkey text;
  kinds text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded', 'framed'];
begin
  why := case new.key
    when 'walletCap' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'vote' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'halving' then case when not coalesce(jsonb_typeof(v) = 'number' and setting_positive(v) and (v #>> '{}')::numeric <= 1, false)
      then 'a fraction above 0 and at most 1' end
    when 'reactionCap' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'charactersPerPlayer' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'settlementCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    when 'viewCountCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    when 'meetingCron' then case when not setting_cron(v) then 'a five-field cron expression, each field inside its range' end
    -- The spans the earlier triggers hold, but let through with a field missing.
    when 'settlementLength' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'seasonLength' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'turnCooldown' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'inviteLifetime' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'setLasts' then case when not setting_span(v, array['day', 'week', 'month']) then 'a span: a unit of day, week or month and a whole count from 1 to 1000' end
    when 'editGrace' then case when not setting_span(v, array['minute', 'day', 'week', 'month']) then 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000' end
    when 'presenceWindow' then case when not setting_span(v, array['minute', 'day', 'week', 'month']) then 'a span: a unit of minute, day, week or month and a whole count from 1 to 1000' end
    when 'registrationMode' then case when v not in ('"open"', '"invite"', '"closed"') then '"open", "invite" or "closed"' end
    when 'postMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'titleMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'postsPerPage' then case when not setting_whole(v, 1) then 'a whole number of posts, at least 1' end
    when 'hotReplies' then case when not setting_whole(v, 1) then 'a whole number of replies, at least 1' end
    when 'presenceNames' then case when not setting_whole(v, 1) then 'a whole number of names, at least 1' end
    when 'presencePollSeconds' then case when not setting_whole(v, 10, 300) then 'a whole number of seconds from 10 to 300' end
    when 'cardSettings' then case when not setting_named_numbers(v) then 'an object of named numbers' end
    when 'systemEnabled' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
    when 'oldVoice' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
    when 'cardWriteSettleSeconds' then case when not setting_whole(v, 0, 600) then 'a whole number of seconds, at least 0 and at most 600' end
    when 'hints' then case when not coalesce(jsonb_typeof(v) = 'object'
        and setting_whole(v -> 'least', 1)
        and jsonb_typeof(v -> 'share') = 'number' and (v ->> 'share')::numeric > 0.5 and (v ->> 'share')::numeric <= 1
        and jsonb_typeof(v -> 'split') = 'number' and setting_positive(v -> 'split') and (v ->> 'split')::numeric <= 0.5
        and setting_span(v -> 'window', array['minute', 'day', 'week', 'month']), false)
      then 'an object giving least (a whole number of reactions, at least 1), share (above 0.5, at most 1), split (above 0, at most 0.5) and window (a span: a unit of minute, day, week or month and a whole count from 1 to 1000)' end
    when 'toastDefaults' then case when not coalesce(jsonb_typeof(v) = 'array'
        and not exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string' or (e #>> '{}') <> all (kinds))
        and (select count(*) = count(distinct e) from jsonb_array_elements(v) e), false)
      then 'a list of the kinds of alert that toast (' || array_to_string(kinds, ', ') || '), each named once' end
    when 'phases' then null  -- below: it needs a loop
    when 'inheritanceGraceDays' then case when not setting_whole(v, 0) then 'a whole number of days, at least 0' end
    when 'rosterRecentExcluded' then case when not setting_whole(v, 0) then 'a whole number of Bosses, at least 0' end
    when 'structuralHoldHours' then case when not setting_whole(v, 1) then 'a whole number of hours, at least 1' end
    when 'microEventDailyCalls' then case when not setting_whole(v, 0) then 'a whole number of calls, at least 0' end
    when 'digestThreads' then case when not setting_whole(v, 1, 25) then 'a whole number of threads, at least 1 and at most 25' end
    when 'digestExcerpts' then case when not setting_whole(v, 1, 20) then 'a whole number of posts, at least 1 and at most 20' end
    when 'digestBoards' then case when not setting_whole(v, 1, 30) then 'a whole number of boards, at least 1 and at most 30' end
    when 'digestBoardDays' then case when not setting_whole(v, 1, 365) then 'a whole number of days, at least 1 and at most 365' end
    when 'movedStubDays' then case when not setting_whole(v, 1, 365) then 'a whole number of days, at least 1 and at most 365' end
    when 'digestExcerptChars' then case when not setting_whole(v, 1, 1000) then 'a whole number of characters, at least 1 and at most 1000' end
    when 'memoryOpinions' then case when not setting_whole(v, 1) then 'a whole number of opinions, at least 1' end
    when 'memoryGrudges' then case when not setting_whole(v, 1) then 'a whole number of grudges, at least 1' end
    when 'memoryWheelhouse' then case when not setting_whole(v, 1) then 'a whole number of subjects, at least 1' end
    when 'memoryRealWorld' then case when not setting_whole(v, 1) then 'a whole number of subjects, at least 1' end
    when 'boardNameMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'moveExpiryMostDays' then case when not setting_whole(v, 1) then 'a whole number of days, at least 1' end
    when 'moveExpiryLeastHours' then case when not setting_whole(v, 1) then 'a whole number of hours, at least 1' end
    when 'demandCheckMinutes' then case when not setting_whole(v, 1, 1440) then 'a whole number of minutes, at least 1 and at most 1440' end
    when 'demandChecksPerTick' then case when not setting_whole(v, 1, 1000) then 'a whole number of moves, at least 1 and at most 1000' end
    when 'searchLanguage' then case when not coalesce(jsonb_typeof(v) = 'string' and exists (select 1 from pg_ts_config c where c.cfgname = v #>> '{}'), false)
      then 'the name of a text search configuration this database holds (english or simple, for example)' end
    when 'searchRankPool' then case when not setting_whole(v, 100, 100000) then 'a whole number of matches from 100 to 100,000' end
    when 'pool' then setting_pool(v)
    when 'modBots' then setting_modbots(v)
    when 'warnBar' then setting_warnbar(v)
    when 'pronouns' then case when not pronouns_hold(pronouns_lowered(v)) then 'an object of five words of 1 to 12 letters each (an apostrophe or a hyphen between two letters is allowed) and a plural, true or false' end
    when 'apology' then setting_apology(v)
    when 'modelTiers' then case when not coalesce(jsonb_typeof(v) = 'object'
        and jsonb_typeof(v -> 'strong') = 'string' and btrim(v ->> 'strong', E' \t\n\r\f\v') <> ''
        and jsonb_typeof(v -> 'light') = 'string' and btrim(v ->> 'light', E' \t\n\r\f\v') <> '', false)
      then 'an object naming a model id for "strong" and for "light"' end
    else null
  end;
  if new.key = 'phases' then
    shape := 'an object of honeymoon, reign and meltdown, each holding its numbers (honeymoon and meltdown also their days) as whole numbers, at least 1';
    if jsonb_typeof(v) <> 'object' then raise exception 'phases is %', shape using errcode = '23514'; end if;
    foreach phase in array array['honeymoon', 'reign', 'meltdown'] loop
      if jsonb_typeof(v -> phase) is distinct from 'object' then raise exception 'phases is %; "%" is missing', shape, phase using errcode = '23514'; end if;
      foreach pkey in array case when phase = 'reign' then array['weeklyMoves', 'bankCap', 'moveExpiryMostDays']
                                 else array['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'] end loop
        if not setting_whole(v -> phase -> pkey, 1) then raise exception 'phases is %; "%.%" is not', shape, phase, pkey using errcode = '23514'; end if;
      end loop;
      select k into pkey from jsonb_object_keys(v -> phase) k
        where k <> all (case when phase = 'reign' then array['weeklyMoves', 'bankCap', 'moveExpiryMostDays']
                             else array['days', 'weeklyMoves', 'bankCap', 'moveExpiryMostDays'] end) limit 1;
      if pkey is not null then raise exception 'phases is %; "%.%" is not a number a phase holds', shape, phase, pkey using errcode = '23514'; end if;
    end loop;
  end if;
  if why is not null then raise exception '% is %', new.key, why using errcode = '23514'; end if;
  return new;
end $$;
