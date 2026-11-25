-- Each decision in a thread of its own, on the staff's board (docs/plans/2026-11-24-staff-board-threads-plan.md, Task 4; the design, section 6).
--
-- A landed move used to be written in the one announcements thread. Now each landed move opens a thread of its own on the system board, started by the staff member who made it, the move its first post, titled by
-- the instance's stock title for its kind (the setting `systemThreadTitles`, kind -> title; a kind with none is titled by its plain words, `systemMoveWords`). A part of a bundle lands in the thread of the bundle's
-- earliest landed part. What belongs to a move already follows its Act's thread (end_move, say_move_end, the keep, reverse_move, open_appeal and close_appeal), so nothing else changes for them. A handover opens a
-- thread (the farewell, then the arrival), recorded on its row; an admin's description of a board with no rename in force opens one (titled as a rename of that board, the stock line `boardDescription` its first post).
-- The announcements thread takes nothing new and stays listed, an archive; an instance that has one keeps it (seed_instance is as it was: it makes the thread only for a seed that names a title, and a seed that
-- names none, as Divided World's no longer will, makes none).
--
--   threads.staff_placed          a staff thread: opened by open_staff_thread, on the system board, and following the flag as the settings' and the seasons' threads do (0407). One partial index.
--   system_thread_rows()          what the seed looks at: the instance's own threads (instance_thread_rows(): the two settings' and each season's turns_thread and meetings_thread) and the staff threads stored off the system board.
--                                 system_threads() is the whole set, every staff thread included; instance_threads() is the small set alone.
--   thread_place, thread_places_computed, lasting_move_problem   read `staff_placed` from the row they are already on and keep the small set for the settings' and the seasons' threads, so a thousand staff
--                                 threads add no join, no array and no probe to the set-based placement (the test checks the definitions; an EXPLAIN at 5,000 staff threads shows the small set's function scan answering 0 rows).
--   board counts                  a staff thread is counted exactly as it is listed: thread_list lists it on the system board, the board's count is the length of that list (the page's total), and the insert trigger
--                                 (0030) and the seed's recount (0407) already count it so. 0339's rebuild leaves the system board out of its deltas, and a flag moved by the seed is recounted by the seed (0407).
--   system_tick                   no `ann`, no gate on it, no `noThread` in its answer. write_describe, hand_over, say_farewell (a fourth argument) and say_in_thread (say_in_announcements, renamed) follow the rule.
--   season_news                   finds a Boss's quote in the handover's thread, in the announcements thread for a handover recorded before.
--
-- Masks. Nothing here reads an owner, a class or a reactor. Ways out. A staff thread is read-only to players as every thread on the system board is (not_the_systems); it ends when an admin or the flag moves it,
-- and a move's thread is as lasting as the move's Acts. At a busy instance: one short thread for each landed move (a few a day), read through the flag column and a partial index, never scanned for a move.

-- ---------------------------------------------------------------------------------------------- the columns ----
alter table threads add column staff_placed boolean not null default false;
create index threads_staff_placed on threads (board) where staff_placed;
-- Task 6 uses it for the season's Staff Meetings thread; added here so the set below can name it.
alter table seasons add column if not exists meetings_thread uuid references threads (id);
alter table season_handovers add column thread uuid references threads (id);

-- --------------------------------------------------------------------------------------- the staff's threads ----

-- A staff thread: opened on the system board, flagged, the title cut to titleMaxLength. It writes no Act; the caller's first write_staff_act takes seq 1. Not callable by a client.
create function open_staff_thread(staff_key text, title text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  sys uuid := system_board();
  words text := left(btrim(coalesce(title, ''), E' \t\n\r\f\v'), (setting('titleMaxLength'))::integer);
  made uuid;
begin
  if sys is null then raise exception 'a staff thread needs The System''s board' using errcode = '55000'; end if;
  if not exists (select 1 from characters c where c.staff = staff_key) then raise exception 'there is no staff member "%"', staff_key using errcode = 'P0002'; end if;
  if words = '' then raise exception 'a staff thread needs a title' using errcode = '22023'; end if;
  insert into threads (board, title, staff_placed) values (sys, words, true) returning id into made;
  return made;
end $$;
revoke execute on function open_staff_thread(text, text) from public, anon, authenticated;
grant execute on function open_staff_thread(text, text) to service_role;

-- The threads the settings and the seasons name (0407's set, with each season's meetings_thread), each with its stored board from one keyed probe of threads.
create function instance_thread_rows() returns table (id uuid, board uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.board from threads t
  where t.id = any (array(
    select case when s.value #>> '{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (s.value #>> '{}')::uuid end
    from settings s where s.key in ('systemAnnouncements', 'updatesThread')
    union select x.turns_thread from seasons x where x.turns_thread is not null
    union select x.meetings_thread from seasons x where x.meetings_thread is not null))
$$;
revoke execute on function instance_thread_rows() from public, anon, authenticated, service_role;

create function instance_threads() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select r.id from instance_thread_rows() r
$$;
revoke execute on function instance_threads() from public, anon, authenticated, service_role;

-- system_thread_rows (0407), the threads the seed must look at on every run: the instance's own, and the staff threads that are not stored on the system board, which are the strays a flag the seed moved leaves behind.
-- A staff thread already on the system board is not here: the seed never has anything to do for it, and reading every one of them on every seed would make a reseed cost what the moves landed cost (0308 holds a reseed
-- to a few index entries). The strays are read one board at a time, a probe of the partial index on (board) for each board that is not the system board (a handful of boards), so only the strays' own entries are read. A thread in both sets is one row.
create or replace function system_thread_rows() returns table (id uuid, board uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select r.id, r.board from instance_thread_rows() r
  union
  select t.id, t.board from boards b cross join lateral (select x.id, x.board from threads x where x.board = b.id and x.staff_placed offset 0) t where not b.is_system
$$;

-- system_threads (0407), the whole set: the instance's threads and every staff thread, wherever it is stored. Only tests and the people who read the database ask for it; the placements read the flag and the small set.
create or replace function system_threads() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select r.id from instance_thread_rows() r
  union
  select t.id from threads t where t.staff_placed
$$;

-- thread_place (0407): a staff thread is on the system board by its own flag, read from the one row asked about; the threads the settings and the seasons name stay in the small set. Everything else as 0407 wrote it.
create or replace function thread_place(in_thread uuid) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  here uuid;
  moved uuid;
  hop uuid;
  fallback uuid;
  steps integer := 0;
begin
  -- A thread the instance itself makes is on the system board, whatever its origin, a move or a merge says: a staff thread by its own flag (one keyed probe), the settings' and the seasons' threads by their small set.
  if system_board() is not null and (exists (select 1 from threads s where s.id = in_thread and s.staff_placed) or in_thread in (select instance_threads())) then return system_board(); end if;
  select t.origin_board into here from threads t where t.id = in_thread;
  if here is null then return null; end if;
  select safe_uuid(a.payload #>> '{params,board}') into moved
  from acts a
  where a.kind = 'move' and a.payload ->> 'kind' = 'moveThread' and lower(a.payload #>> '{params,thread}') = in_thread::text
    and not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = a.id and e.payload ->> 'why' in ('reversed', 'overturned'))
    and exists (select 1 from boards d where d.id = safe_uuid(a.payload #>> '{params,board}')
                and not exists (select 1 from acts x where x.kind = 'move_end' and x.target_act_id = d.created_by_act))
  order by a.created_at desc, a.seq desc nulls last, a.id desc limit 1;
  if moved is not null then here := moved; end if;
  while steps < 50 and not board_is_open(here) loop
    steps := steps + 1;
    hop := board_merge_into(here);
    if hop is null then
      select safe_uuid(a.payload #>> '{params,fallback}') into fallback from boards b join acts a on a.id = b.created_by_act where b.id = here;
      hop := coalesce((select b.id from boards b where b.id = fallback and b.id <> here),
                      (select b.id from boards b where not b.is_system and board_is_open(b.id) order by b.created_at, b.id limit 1));
    end if;
    exit when hop is null or hop = here;
    here := hop;
  end loop;
  return here;
end $$;

-- thread_places_computed (0407): the final select reads each thread's flag from the row it is already on, and the small set is the only join, so the staff's threads (one for each move that ever landed) add no join and no probe. Everything else as 0407 wrote it.
create or replace function thread_places_computed() returns table (thread uuid, place uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive
  mg as (
    select distinct on (m.src) m.src, m.dst from (
      select safe_uuid(a.payload #>> '{params,board}') as src, safe_uuid(a.payload #>> '{params,into}') as dst, a.created_at, a.id
      from open_moves o join acts a on a.id = o.move_act where a.payload ->> 'kind' = 'mergeBoard'
    ) m
    where m.src is not null and exists (select 1 from boards d where d.id = m.dst)
    order by m.src, m.created_at desc, m.id desc
  ),
  bs as (
    select b.id, b.is_system, b.created_at, mg.dst as merged_into,
           (b.created_by_act is not null and exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = b.created_by_act)) as made_ended,
           safe_uuid((select a.payload #>> '{params,fallback}' from acts a where a.id = b.created_by_act)) as fallback
    from boards b left join mg on mg.src = b.id
  ),
  first_open as (select x.id from bs x where x.merged_into is null and not x.made_ended and not x.is_system order by x.created_at, x.id limit 1),
  hop as (
    select x.id, (x.merged_into is not null or x.made_ended) as closed,
           coalesce(x.merged_into, case when x.made_ended then coalesce((select f.id from bs f where f.id = x.fallback and f.id <> x.id), (select id from first_open)) end) as nxt
    from bs x
  ),
  walk (board, cur, steps) as (
    select h.id, h.id, 0 from hop h
    union all
    select w.board, h.nxt, w.steps + 1 from walk w join hop h on h.id = w.cur where h.closed and h.nxt is not null and h.nxt <> w.cur and w.steps < 50
  ),
  placed as (select distinct on (w.board) w.board, w.cur from walk w order by w.board, w.steps desc),
  mt as (
    select distinct on (m.th) m.th, m.bd from (
      select safe_uuid(a.payload #>> '{params,thread}') as th, safe_uuid(a.payload #>> '{params,board}') as bd, a.created_at, a.seq, a.id
      from acts a where a.kind = 'move' and a.payload ->> 'kind' = 'moveThread'
        and not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = a.id and e.payload ->> 'why' in ('reversed', 'overturned'))
    ) m
    where m.th is not null and exists (select 1 from boards d where d.id = m.bd
                                       and not exists (select 1 from acts x where x.kind = 'move_end' and x.target_act_id = d.created_by_act))
    order by m.th, m.created_at desc, m.seq desc nulls last, m.id desc
  )
  select t.id, case when (t.staff_placed or st.id is not null) and sb.id is not null then sb.id else p.cur end
  from threads t left join mt on mt.th = t.id join placed p on p.board = coalesce(mt.bd, t.origin_board)
    left join instance_threads() st(id) on st.id = t.id cross join (select system_board() as id) sb
$$;

-- lasting_move_problem (0407): a moveThread naming a staff thread is refused, by its flag. Everything else as 0407 wrote it.
create or replace function lasting_move_problem(in_kind text, params jsonb) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  th record;
  src uuid;
  dst uuid;
  target uuid;
  fb uuid;
  hop uuid;
  steps integer := 0;
begin
  if in_kind = 'createBoard' then
    if jsonb_typeof(params -> 'name') is distinct from 'string' or btrim(params ->> 'name') = '' then return 'a new board needs a name'; end if;
    if char_length(params ->> 'name') > 200 then return 'a board''s name is at most 200 characters'; end if;
    if jsonb_typeof(params -> 'premise') is distinct from 'string' or btrim(params ->> 'premise') = '' then return 'a new board needs a premise'; end if;
    if jsonb_typeof(params -> 'description') is distinct from 'string' or btrim(params ->> 'description') = '' then return 'a new board needs a description'; end if;
    if params -> 'fallback' is not null and params -> 'fallback' <> 'null'::jsonb then
      fb := safe_uuid(params ->> 'fallback');
      if fb is null or not exists (select 1 from boards b where b.id = fb and not b.is_system and board_is_open(b.id)) then
        return 'a new board''s fallback is an open board of the players';
      end if;
    end if;
  elsif in_kind = 'moveThread' then
    select t.id, t.board, t.origin_board, t.staff_placed into th from threads t where t.id = safe_uuid(params ->> 'thread');
    if th.id is null then return 'there is no such thread to move'; end if;
    if exists (select 1 from boards b where b.is_system and b.id in (th.board, th.origin_board)) then return 'a thread on The System''s own board is never moved'; end if;
    if th.staff_placed or th.id in (select instance_threads()) then return 'that thread is the staff''s own and stays on their board'; end if;
    target := safe_uuid(params ->> 'board');
    if target is null or not exists (select 1 from boards b where b.id = target) then return 'there is no such board to move the thread to'; end if;
    if exists (select 1 from boards b where b.id = target and b.is_system) then return 'a thread is never moved onto The System''s own board'; end if;
    if not board_is_open(target) then return 'that board is closed, so a thread cannot be moved onto it'; end if;
  elsif in_kind = 'mergeBoard' then
    src := safe_uuid(params ->> 'board');
    dst := safe_uuid(params ->> 'into');
    if src is null or not exists (select 1 from boards b where b.id = src) then return 'there is no such board to merge'; end if;
    if dst is null or not exists (select 1 from boards b where b.id = dst) then return 'there is no such board to merge it into'; end if;
    if src = dst then return 'a board is never merged into itself'; end if;
    if exists (select 1 from boards b where b.is_system and b.id in (src, dst)) then return 'The System''s own board is never merged or merged into'; end if;
    -- A cycle: the board it would merge into is already sent, by merges in force, on to this one.
    hop := dst;
    while hop is not null and steps < 50 loop
      if hop = src then return 'a board is never merged into one that is already merged into it'; end if;
      hop := board_merge_into(hop);
      steps := steps + 1;
    end loop;
    if not board_is_open(src) then return 'that board is already closed'; end if;
    if not board_is_open(dst) then return 'a board is never merged into a closed board'; end if;
  end if;
  return null;
end $$;

-- ----------------------------------------------------------------------------------------------- the words ----

-- system_line (0209) is split in two: system_line_fill fills a template with the tokens system_line fills ({boss}, {board}, {move}, {rule} and the Boss's pronouns), and system_line picks a stock line
-- and fills it. A template of null answers the move's plain words, as a kind with no stock line always has. Nothing changes for a caller of system_line.
create function system_line_fill(template text, move_kind text, params jsonb, staff_key text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  words text;
  boss_name text;
  boss_id uuid;
  board_name text := '';
  rule_words text := '';
  rule_board uuid;
  predicate_words text;
begin
  select s.value ->> move_kind into words from settings s where s.key = 'systemMoveWords';
  words := coalesce(words, 'a move');
  if jsonb_typeof(params) = 'object' then
    -- A kind that derives `groupName` gets the conferred group's name (its key where no row has it), for its words and for the line's `{move}`.
    if exists (select 1 from move_kinds k where k.key = move_kind and 'groupName' = any (k.derived)) then
      params := params || jsonb_build_object('groupName', coalesce((select g.name from group_kinds g where g.key = params ->> 'group'), params ->> 'group', ''));
    end if;
    -- A kind that derives `trophyName` and `characterName` (the Boss's trophy award) gets the trophy's name and the character's (the key, or nothing, where no row has it): both are public.
    if exists (select 1 from move_kinds k where k.key = move_kind and 'trophyName' = any (k.derived)) then
      params := params || jsonb_build_object(
        'trophyName', coalesce((select t.name from trophy_kinds t where t.key = params ->> 'trophy'), params ->> 'trophy', ''),
        'characterName', coalesce((select c.name from characters c where c.id = case when lower(params ->> 'character') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (params ->> 'character')::uuid end), ''));
    end if;
    words := fill_tokens(words, params);
    if lower(params ->> 'board') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      board_name := coalesce((select b.name from boards_now b where b.id = (params ->> 'board')::uuid), '');
    end if;
    if move_kind = 'setRule' then
      rule_board := case when lower(params ->> 'board') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (params ->> 'board')::uuid end;
      if rule_board is null then board_name := 'every board'; end if;
      select fill_tokens(x.plain, jsonb_build_object('param', coalesce(params #>> '{param}', ''))) into predicate_words from rule_predicates x where x.key = params ->> 'predicate';
      rule_words := case when rule_board is null then 'House Rule ' else 'Rule ' end
        || ((select count(*) from acts p where p.kind = 'move' and p.payload ->> 'kind' = 'setRule' and coalesce(p.payload #>> '{params,board}', '') = coalesce(rule_board::text, '')) + 1)::text
        || ': ' || coalesce(predicate_words, 'a rule');
    end if;
  end if;
  select c.name, c.id into boss_name, boss_id from characters c where c.staff = staff_key;
  if template is null then return words; end if;
  return fill_tokens(template, jsonb_build_object('boss', coalesce(boss_name, ''), 'board', board_name, 'move', words, 'rule', rule_words) || pronoun_tokens('boss', boss_id));
end $$;
revoke execute on function system_line_fill(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function system_line_fill(text, text, jsonb, text) to service_role;

create or replace function system_line(line_key text, move_kind text, params jsonb, staff_key text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lines jsonb;
  line text;
begin
  select s.value -> line_key into lines from settings s where s.key = 'systemLines';
  if jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0 and jsonb_typeof(lines -> 0) = 'string' then
    line := lines ->> floor(random() * jsonb_array_length(lines))::integer;
  end if;
  return system_line_fill(line, move_kind, params, staff_key);
end $$;

-- A move thread's title: the instance's `systemThreadTitles ->> kind`, its tokens filled as a stock line's are; a kind with no title is titled by its plain words, the first letter capitalized. The caller cuts it.
create function move_thread_title(kind text, params jsonb, staff text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  template text := (select nullif(btrim(s.value ->> kind), '') from settings s where s.key = 'systemThreadTitles');
  words text := system_line_fill(template, kind, params, staff);
begin
  if template is null then words := upper(left(words, 1)) || substr(words, 2); end if;
  return words;
end $$;
revoke execute on function move_thread_title(text, jsonb, text) from public, anon, authenticated;
grant execute on function move_thread_title(text, jsonb, text) to service_role;

-- A handover's thread title: the instance's copy.handoverThreadTitle with {boss} (the arriving Boss's name) and {season} (the new season's number); a plain one where the instance gives none.
create function handover_thread_title(boss_key text, new_season bigint) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select fill_tokens(nullif(btrim(c.value ->> 'handoverThreadTitle'), ''), jsonb_build_object('boss', coalesce(b.name, ''), 'season', coalesce(n.number::text, '')))
     from (select 1) x left join settings c on c.key = 'copy' left join characters b on b.staff = boss_key left join seasons n on n.id = new_season where c.value ->> 'handoverThreadTitle' is not null),
    'A new Boss takes the chair')
$$;
revoke execute on function handover_thread_title(text, bigint) from public, anon, authenticated;
grant execute on function handover_thread_title(text, bigint) to service_role;

-- Whether the instance has a stock line under the key.
create function line_set(line_key text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from settings s where s.key = 'systemLines' and jsonb_typeof(s.value -> line_key) = 'array' and jsonb_array_length(s.value -> line_key) > 0)
$$;
revoke execute on function line_set(text) from public, anon, authenticated;

-- The farewell a Boss wrote at its last meeting (0337), the season it served named by the handover's kind (0403), trimmed and cut to a post's length; null where none was written.
create function farewell_words(speaker text, new_season bigint, departure boolean default false) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  words text;
  most integer := (select (s.value #>> '{}')::integer from settings s where s.key = 'postMaxLength');
begin
  if speaker is null then return null; end if;
  select nullif(btrim(h.farewell, E' \t\n\r\f\v'), '') into words
  from handoffs_latest h
  where h.season = case when farewell_words.departure then farewell_words.new_season else (select max(p.id) from seasons p where p.id < farewell_words.new_season) end
    and h.staff = farewell_words.speaker;
  if words is not null and most is not null then words := left(words, most); end if;
  return words;
end $$;
revoke execute on function farewell_words(text, bigint, boolean) from public, anon, authenticated;

-- say_farewell (0403_departed_personas.sql), written in the thread it is given (the handover's) and not in the announcements thread. Everything else as 0403 wrote it.
drop function say_farewell(text, bigint, boolean);
create function say_farewell(speaker text, new_season bigint, departure boolean, in_thread uuid) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  words text := farewell_words(speaker, new_season, departure);
begin
  if in_thread is null or words is null then return false; end if;
  perform write_staff_act(speaker, 'post', in_thread, null, jsonb_build_object('body', words));
  return true;
exception when others then
  raise warning 'say_farewell: the farewell of % was not said: % (%)', speaker, sqlerrm, sqlstate;
  return false;
end $$;
revoke execute on function say_farewell(text, bigint, boolean, uuid) from public, anon, authenticated;
grant execute on function say_farewell(text, bigint, boolean, uuid) to service_role;

-- say_in_announcements (0082), renamed say_in_thread and given the thread: a stock line said by a staff member in it, the post's id, or null where nothing was said (no line, no speaker, or the post failed: it is best
-- effort). Only hand_over calls it, by name.
drop function say_in_announcements(text, text);
create function say_in_thread(speaker text, line_key text, in_thread uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if in_thread is null or speaker is null then return null; end if;
  if not line_set(line_key) then return null; end if;
  return (write_staff_act(speaker, 'post', in_thread, null, jsonb_build_object('body', system_line(line_key, null, null, speaker))) ->> 'id')::uuid;
exception when others then
  raise warning 'say_in_thread: % was not said by %: % (%)', line_key, speaker, sqlerrm, sqlstate;
  return null;
end $$;
revoke execute on function say_in_thread(text, text, uuid) from public, anon, authenticated;
grant execute on function say_in_thread(text, text, uuid) to service_role;

-- write_describe (0101): with no move, an admin's description opens a staff thread by the current Boss, titled as a rename of that board is, whose first post is the stock line `boardDescription` (the title
-- where the instance has none), and the describe Act follows it there. With a move it is written in the move's thread, as it was. Everything else as 0101 wrote it.
create or replace function write_describe(board uuid, description text, move_act uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  in_thread uuid;
  written uuid;
  boss text;
  params jsonb;
  titled text;
  most integer := (select (s.value #>> '{}')::integer from settings s where s.key = 'postMaxLength');
begin
  if move_act is not null then
    in_thread := (select m.thread from acts m where m.id = move_act and m.kind = 'move');
  else
    boss := current_boss();
    if boss is null then raise exception 'The staff has no Boss to open a thread for this description yet. An admin seats one by naming a first Boss (system.firstBoss) in the instance''s seed and seeding again, or the next season''s handover seats one.' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
    params := jsonb_build_object('board', write_describe.board::text, 'name', coalesce((select b.name from boards_now b where b.id = write_describe.board), ''));
    titled := move_thread_title('renameBoard', params, boss);
    in_thread := open_staff_thread(boss, titled);
    perform write_staff_act(boss, 'post', in_thread, null, jsonb_build_object('body',
      left(case when line_set('boardDescription') then system_line('boardDescription', 'renameBoard', params, boss) else titled end, coalesce(most, 2000))));
  end if;
  if in_thread is null then raise exception 'there is no thread to describe the board in' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  perform set_config('kayfabb.describe_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  values (null, 'describe', in_thread, move_act,
    jsonb_build_object('description', description, 'move_act', move_act, 'by', 'admin', 'board', board), clock_timestamp()) returning id into written;
  perform set_config('kayfabb.describe_writer', '', true);
  return written;
end $$;


-- ----------------------------------------------------------------------------------------------- the handover ----

-- hand_over (0403_departed_personas.sql), opening a staff thread for the handover: the farewell and then the arrival are written in it, and the row records it (season_handovers.thread). Everything else as 0403 wrote it.
-- The signature is the one 0403 made, so the function is replaced in place and its grants stand.
create or replace function hand_over(new_season bigint, outgoing text, at timestamptz, departure boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  chosen text;
  how text;
  note text;
  open_nom record;
  arrival uuid;
  ht uuid;
  said boolean;
begin
  begin
    chosen := nominated_boss(outgoing);
    if chosen is not null then how := 'nomination'; end if;
  exception when others then
    chosen := null;
    note := 'the nomination did not seat: ' || sqlerrm;
  end;
  if chosen is null then
    begin
      chosen := rotation_boss(outgoing);
      how := 'rotation';
    exception when others then
      chosen := outgoing;
      how := case when outgoing is null then 'none' else 'unchanged' end;
      note := coalesce(note || '; ', '') || 'the rotation did not choose: ' || sqlerrm;
    end;
  end if;
  -- A departure is the outgoing Boss leaving the roster: it refuses where no other Boss can take the chair, since the outgoing one has no persona file left to sit in it. Nothing has been written yet.
  if departure and (chosen is null or chosen is not distinct from outgoing) then
    raise exception 'the open season''s Boss % has left the roster, and no Boss in it can take the chair', outgoing using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  update seasons set boss = chosen where id = new_season;
  -- Every nomination in force is spent: it named the Boss of this handover, whoever was seated.
  for open_nom in
    select o.move_act from open_moves o join acts a on a.id = o.move_act where a.payload ->> 'kind' = 'nameSuccessor' order by o.landed_at, o.move_act
  loop
    begin
      perform end_move(open_nom.move_act, 'spent', 'handover');
    exception when others then
      note := coalesce(note || '; ', '') || 'a nomination was not spent: ' || sqlerrm;
    end;
  end loop;
  if chosen is not null and chosen is distinct from outgoing then
    begin
      insert into move_bank (staff, balance, as_of) values (chosen, 0, at)
      on conflict (staff) do update set balance = 0, as_of = excluded.as_of;
    exception when others then
      note := coalesce(note || '; ', '') || 'the bank was not started: ' || sqlerrm;
    end;
    -- The offices (0082): the arriving Boss debuts if it was waiting; the outgoing Boss becomes a member, or a Mod Bot where no persona
    -- is one now, since the staff is never empty. The Boss's own office is the season's and is never a row, so the two Bosses of this
    -- handover are left out of the count: the outgoing one's latest row may still read mod, from before it was seated; a retired mod is no mod either. Best effort, as the rest.
    begin
      perform pg_advisory_xact_lock(hashtext('kayfabb.offices'));
      update characters set debuted_at = at where staff = chosen and debuted_at is null;
      if outgoing is not null then
        insert into staff_offices (staff, office, cause, season)
        values (outgoing, case when exists (select 1 from staff_office_now o join characters c on c.staff = o.staff where o.office = 'mod' and o.staff is distinct from outgoing and o.staff is distinct from chosen and c.retired_at is null) then 'member' else 'mod' end, 'handover', new_season);
      end if;
    exception when others then
      note := coalesce(note || '; ', '') || 'the offices were not moved: ' || sqlerrm;
    end;
    -- The outgoing Boss's moves still waiting are withdrawn: their Boss has left the chair (the rehearsal patch design, section 6). A Mod's own moves are left alone. Refused for good,
    -- with the reason the admin queue shows; nothing is posted. Best effort, as the rest.
    begin
      update queued_moves set failed_at = at, failure = 'its Boss left the chair before it landed', refused_at = at
      where staff = outgoing and landed_act is null and held_at is null and refused_at is null;
    exception when others then
      note := coalesce(note || '; ', '') || 'the outgoing Boss''s waiting moves were not withdrawn: ' || sqlerrm;
    end;
    -- The handover's thread (the staff-board threads design, section 6): one staff thread on the system board, titled by the instance's handoverThreadTitle with the arriving Boss's name and the new season's
    -- number, opened only where there is anything to say in it and kept only if a post lands in it. The Boss's own farewell, written at its last meeting (0337, above), comes first, in place of the stock line,
    -- which stands where none was written or it could not be posted; the arrival follows. The farewell and the arrival swallow their own failures, so the whole is one block: where neither lands the block
    -- raises, which takes the thread back with it (a thread with no post holds nothing a player wrote), and the row records none. A thread that cannot be opened says nothing and the handover stands.
    if (outgoing is not null and (farewell_words(outgoing, new_season, departure) is not null or line_set('bossFarewell'))) or line_set('bossArrival') then
      begin
        ht := open_staff_thread(chosen, handover_thread_title(chosen, new_season));
        said := say_farewell(outgoing, new_season, departure, ht);
        if not said then said := say_in_thread(outgoing, 'bossFarewell', ht) is not null; end if;
        arrival := say_in_thread(chosen, 'bossArrival', ht);
        if not said and arrival is null then raise exception 'neither the farewell nor the arrival could be posted'; end if;
      exception when others then
        ht := null;
        arrival := null;
        note := coalesce(note || '; ', '') || 'the handover''s thread was not kept: ' || sqlerrm;
      end;
    end if;
  end if;
  insert into season_handovers (season, outgoing, boss, how, note, at, arrival_act, cause, thread)
  values (new_season, outgoing, chosen, how, left(note, 1000), at, arrival, case when departure then 'departure' else 'rollover' end, ht);
  return jsonb_build_object('boss', chosen, 'how', how, 'note', note);
end $$;
-- season_boss_changes (0403_departed_personas.sql), with the handover's thread at its end, so season_news reads it from the row it is already on. Everything else as 0403 wrote it.
create or replace view season_boss_changes as
  select h.season, s.number, h.outgoing, h.boss, h.at, h.landed_at, h.id as handover, h.cause, h.thread
  from season_handovers h join seasons s on s.id = h.season
  where h.boss is not null and h.boss is distinct from h.outgoing and h.how in ('nomination', 'rotation');

-- season_news (0403_departed_personas.sql), a Boss's quote read from the thread its handover opened (season_handovers.thread), the announcements thread for a handover recorded before there was one. A handover's own thread holds only its two Bosses' posts, so a Boss's line there is found by the Boss and the thread, not by the instant (staff Acts are stamped by the clock, the handover's landed_at by the transaction); the announcements thread still matches by the instant. Everything else as 0403 wrote it.
create or replace function public.season_news(before timestamp with time zone DEFAULT NULL::timestamp with time zone, most integer DEFAULT 20)
 returns setof season_news_row
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
 set plan_cache_mode = force_generic_plan
 set jit = off
as $function$
#variable_conflict use_column
begin
  return query
  with
  lim as (select coalesce($1, 'infinity'::timestamptz) as b, greatest(1, least(coalesce($2, 20), 50)) as k),
  ann as (select (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements') as thread),
  r_floor as (
    select coalesce((select s.results_at from seasons s where s.results_at is not null and s.results_at < (select b from lim)
                     order by s.results_at desc, s.number desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  results as (
    select 'results'::text as kind, null::uuid as act, null::uuid as thread, null::integer as seq, s.results_at as at, s.number as season,
           null::text as name, null::text as quote, coalesce(s.results_count, 0) as count,
           jsonb_build_object('top', (
             select coalesce(jsonb_agg(jsonb_build_object('character', t.character, 'name', t.name, 'place', t.place, 'standing', t.standing, 'shown', t.shown)
                                       order by t.place, t.name, t.character), '[]'::jsonb)
             from (select r.* from season_results r where r.season = s.id and r.standing > 0 and r.place is not null order by r.standing desc, r.name, r.character limit 3) t)) as detail
    from seasons s
    where s.results_at is not null and s.results_at < (select b from lim) and s.results_at >= (select at from r_floor)
  ),
  t_floor as (
    select coalesce((select n.landed_at from news_landed n where n.kind in ('tally', 'announcements') and n.landed_at < (select b from lim)
                     order by n.landed_at desc, n.act desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz) as at
  ),
  tallies as (
    select 'tally'::text as kind, a.id as act, a.thread, a.seq, n.landed_at as at,
           case when n.kind = 'tally' then (a.payload ->> 'season')::integer else (select s.number from seasons s where s.turns_thread = a.thread) end as season,
           null::text as name, null::text as quote,
           case when n.kind = 'tally' then tally_names(a.payload)
                else (select count(*) from acts x where x.kind = 'announce' and x.thread = a.thread and x.created_at = a.created_at)::integer end as count,
           case when n.kind = 'tally' then
             jsonb_build_object('debuts', case when jsonb_typeof(a.payload -> 'debuts') = 'array' then a.payload -> 'debuts' else '[]'::jsonb end,
                                'turns', case when jsonb_typeof(a.payload -> 'turns') = 'array' then a.payload -> 'turns' else '[]'::jsonb end)
           else (
             select jsonb_build_object(
               'debuts', coalesce(jsonb_agg(f.entry order by f.seq) filter (where f.what = 'debut'), '[]'::jsonb),
               'turns', coalesce(jsonb_agg(f.entry order by f.seq) filter (where f.what = 'turn'), '[]'::jsonb))
             from (
               select x.seq, x.payload ->> 'what' as what,
                      jsonb_build_object('character', x.character, 'name', c.name)
                        || case when x.payload ? 'class' then jsonb_build_object('class', x.payload -> 'class') else '{}'::jsonb end
                        || case when x.payload ? 'was' then jsonb_build_object('was', x.payload -> 'was') else '{}'::jsonb end as entry
               from acts x join characters c on c.id = x.character
               where x.kind = 'announce' and x.thread = a.thread and x.created_at = a.created_at
               order by x.seq limit 20
             ) f) end as detail
    from news_landed n join acts a on a.id = n.act
    where n.kind in ('tally', 'announcements') and n.landed_at < (select b from lim) and n.landed_at >= (select at from t_floor)
  ),
  boss_all as materialized (
    select 'bossArrived'::text as kind, h.boss as who, h.landed_at as at, h.number as season, 'bossArrival'::text as line, h.thread as handover_thread from season_boss_changes h
    where h.landed_at < (select b from lim)
    union all
    select 'bossLeft', h.outgoing, h.landed_at, case when h.cause = 'departure' then h.number else h.number - 1 end, 'bossFarewell', h.thread from season_boss_changes h
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
      -- A handover with a thread of its own: the Boss's first post there, by the thread's (thread, seq) index. An older handover has none: the Boss's first post in the announcements thread at that instant, by created_at. Each branch is its own lateral so each keeps its own index; one OR across both made the planner give up the created_at probe.
      select a.id, a.thread, a.seq, public_payload(a.payload, version_hidden(a.id), a.id) ->> 'body' as body
      from characters ch join acts a on a.thread = c.handover_thread and a.character = ch.id
      where c.handover_thread is not null and ch.staff = c.who and a.kind = 'post'
        and exists (select 1 from settings s where s.key = 'systemLines' and jsonb_typeof(s.value -> c.line) = 'array' and jsonb_array_length(s.value -> c.line) > 0)
      order by a.seq limit 1
    ) ph on true
    left join lateral (
      select a.id, a.thread, a.seq, public_payload(a.payload, version_hidden(a.id), a.id) ->> 'body' as body
      from characters ch join acts a on a.character = ch.id
      where c.handover_thread is null and ch.staff = c.who and a.created_at = c.at and a.kind = 'post' and a.thread = (select thread from ann)
        and exists (select 1 from settings s where s.key = 'systemLines' and jsonb_typeof(s.value -> c.line) = 'array' and jsonb_array_length(s.value -> c.line) > 0)
      order by a.seq limit 1
    ) pa on true
    cross join lateral (select coalesce(ph.id, pa.id) as id, coalesce(ph.thread, pa.thread) as thread, coalesce(ph.seq, pa.seq) as seq, coalesce(ph.body, pa.body) as body) p
  ),
  merged as (
    select * from results union all select * from tallies union all select * from bosses
  )
  select m.kind, m.act, m.thread, m.seq, m.at, m.season, m.name, m.quote, m.count, m.detail
  from merged m
  where m.at >= coalesce((select m2.at from merged m2 order by m2.at desc offset (select k - 1 from lim) limit 1), '-infinity'::timestamptz)
  order by m.at desc, m.kind, m.act nulls first;
end
$function$;

-- ----------------------------------------------------------------------------------------------- the staff's writer ----

-- write_staff_act (0402_thread_lockout.sql), a move's Act dated by the clock and not the transaction, so that moves landed in one tick, each in a thread of its own, still order as they landed. Everything else as 0402 wrote it; its grants are as they were.
create or replace function write_staff_act(staff_key text, kind text, thread uuid, target uuid, payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  whose text;
  written uuid;
  kept uuid;
  held text;
  stamped jsonb := payload;
  quoting boolean := kind = 'post' and target is not null;
  locked uuid[];
  sprung jsonb;
begin
  select c.id, c.staff_kind into who, whose from characters c where c.staff = staff_key;
  if whose = 'developer' then
    raise exception 'the developer speaks only through post_update, by an admin' using errcode = '42501';
  end if;
  if kind is null or kind not in ('post', 'spin', 'card', 'edit', 'move', 'move_keep', 'visit', 'visit_join', 'report_verdict', 'appeal_ruling') then
    raise exception 'a staff character posts, spins, plays a card, edits, moves, keeps a move, visits or gives a verdict or a ruling, not %', coalesce(kind, 'nothing') using errcode = '22023';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'an Act''s payload is an object' using errcode = '22023'; end if;
  if who is null then raise exception 'there is no staff member "%"', staff_key using errcode = 'P0002'; end if;
  -- A persona that has not debuted writes nothing, and a benched one is silent (0082).
  select o.office into held from staff_office_now o where o.staff = staff_key;
  if held in ('waiting', 'benched') then
    raise exception 'a % persona writes nothing', held using errcode = '55000';
  end if;
  -- A move says which office made it, and an appeal's ruling which office heard it, as the office stood when it landed.
  if kind in ('move', 'appeal_ruling') and held in ('boss', 'mod') and not (payload ? 'office') then
    stamped := payload || jsonb_build_object('office', held);
  end if;
  -- A pool reply to a post that holds a live No quote is written as a plain reply, with no target: the paid answer is kept, and nothing springs (the post holds no back, as the two never share one). The post's plays are public.
  if quoting and exists (select 1 from no_quote_on(target)) then
    quoting := false;
    target := null;
  end if;
  -- A staff post in a thread its character is locked out of is refused, as a player's is (a spin, a card, an edit and the rest are not asked: a card goes through place_cast and place_set).
  if kind = 'post' and write_staff_act.thread is not null then perform not_locked_out(who, write_staff_act.thread); end if;
  -- A pool post that quotes: the quoted post's back, the thread and the count rows, in the lock order, before the insert.
  if quoting then
    locked := lock_for_quote(who, write_staff_act.thread, target);
    if write_staff_act.thread is not null and kind = 'post' then perform not_locked_out(who, write_staff_act.thread); end if;
  end if;
  perform set_config('kayfabb.staff_writer', 'on', true);
  -- Every staff Act is stamped with the clock and not the transaction. A move must be: each landed move opens a thread of its own, so the seq that once ordered two moves of one tick (they shared a thread) no longer does,
  -- and two moveThreads of one thread landed in one tick must still read in the order they landed (thread_place takes the latest). The rest follow, so that the Acts of one transaction (a move, its end, the Boss's line
  -- that says it) are dated in the order they were written, and a line is never dated before the end it follows.
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values (who, kind, write_staff_act.thread, target, stamped, clock_timestamp()) returning id, target_act_id into written, kept;
  perform set_config('kayfabb.staff_writer', '', true);
  -- Only a post that still has its target springs: one whose quote is doctored was written with none (acts_forged_quotes).
  if quoting and kept is not null then sprung := spring_traps('quote', kept, written, held => locked); end if;
  return act_projection(written) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;

-- end_move (0322), its end dated by the clock and not the transaction, as write_staff_act dates a move: a move landed and ended in one tick (a trophy, spent at once) would otherwise be dated before itself. Everything else as 0322 wrote it.
create or replace function end_move(move_act uuid, why text, by text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m acts%rowtype;
  existing uuid;
  written uuid;
  lasting boolean;
  first_before uuid;
  shaped uuid;
begin
  if why is null or why not in ('met', 'expired', 'reversed', 'superseded', 'spent', 'unmet', 'overturned') then raise exception 'a move ends as met, expired, reversed, superseded, spent, unmet or overturned, not %', coalesce(why, 'nothing') using errcode = '22023'; end if;
  if by is null or char_length(by) not between 1 and 40 then raise exception 'a move''s end says who ended it' using errcode = '22023'; end if;
  -- A lasting move's end rewrites places: the global key first, before the per-move key (the tick holds the global key when it ends a superseded move, so this is the one order), and before anything is read.
  if coalesce((select k.lasting from acts a join move_kinds k on k.key = a.payload ->> 'kind' where a.id = move_act and a.kind = 'move'), false) then perform lock_thread_places(); end if;
  perform pg_advisory_xact_lock(hashtext('kayfabb.end_move'), hashtext(move_act::text));
  select * into m from acts where id = move_act and kind = 'move';
  if not found then raise exception 'there is no such move' using errcode = 'P0002'; end if;
  lasting := coalesce((select k.lasting from move_kinds k where k.key = m.payload ->> 'kind'), false);
  -- A move has one end of each class: superseded, and any other. A lasting move ended as superseded may take one later end, reversed or overturned, so an admin can undo
  -- any lasting move after it lands (a new move_end Act beside the first, never an update). Any other second end is refused, as before.
  select e.id into existing from acts e where e.kind = 'move_end' and e.target_act_id = move_act and ((e.payload ->> 'why' = 'superseded') = (why = 'superseded')) limit 1;
  if existing is null and exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = move_act)
     and not (lasting and why in ('reversed', 'overturned')
              and not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = move_act and e.payload ->> 'why' <> 'superseded')) then
    select e.id into existing from acts e where e.kind = 'move_end' and e.target_act_id = move_act limit 1;
  end if;
  if existing is not null then return jsonb_build_object('act', existing, 'ended', false); end if;
  if lasting then
    -- The board a merge or a creation takes out of play (or back): a start on it is refused at once while this end is open (0339), and after it lands on the board it should or is refused with the new home named.
    shaped := case m.payload ->> 'kind' when 'mergeBoard' then safe_uuid(m.payload #>> '{params,board}') when 'createBoard' then (select b.id from boards b where b.created_by_act = move_act) end;
    if shaped is not null then perform lock_board_closing(shaped); end if;
    first_before := first_open_board();
  end if;
  -- A tick that read the old expiry before a ruling moved it is too late: the ruling is a fact of the lock's holder, read here under the lock.
  if why = 'expired' and exists (select 1 from acts a join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
                                 where a.kind = 'appeal' and a.target_act_id = move_act and (r.payload ->> 'until')::timestamptz > now()) then
    return jsonb_build_object('act', null, 'ended', false, 'extended', true);
  end if;
  perform set_config('kayfabb.move_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  values (null, 'move_end', m.thread, move_act, jsonb_build_object('why', why, 'by', by), clock_timestamp()) returning id into written;
  perform set_config('kayfabb.move_end_writer', '', true);
  if lasting then perform lasting_rebuild(move_act, first_before); end if;
  return jsonb_build_object('act', written, 'ended', true);
end $$;

-- ----------------------------------------------------------------------------------------------- the tick ----

-- system_tick (0424_staff_requests.sql, which took it from 0423_rulings_alerts.sql), landing each move in a thread of its own on the staff's board: no announcements thread is needed, and the System being on is the whole gate
-- (the answer's `noThread` goes with it). Everything else as 0424 wrote it.
create or replace function system_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  enabled boolean := coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'systemEnabled'), false);
  check_every interval := make_interval(mins => coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'demandCheckMinutes'), 5));
  cap integer := coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'demandChecksPerTick'), 40);
  budget_ends timestamptz := clock_timestamp() + make_interval(secs => coalesce(nullif(current_setting('kayfabb.tick_budget_seconds', true), '')::numeric, 20));
  due record;
  inforce record;
  written uuid;
  why text;
  clash text;
  ended_by text;
  counted jsonb;
  expires timestamptz;
  did_end boolean;
  landed integer := 0;
  met integer := 0;
  expired integer := 0;
  failed integer := 0;
  unmet integer := 0;
  arcs integer := 0;
  awards_failed integer := 0;
  checked integer := 0;
  out_of_time boolean := false;
  superseded integer := 0;
  filed integer := 0;
  tries integer;
  late record;
  check_at timestamptz;
  filing_grace interval := make_interval(mins => coalesce((select (s.value #>> '{filingGraceMinutes}')::integer from settings s where s.key = 'modBots'), 10));
  boss text := current_boss();
  -- The instant the open season's Boss was seated: the latest Boss-changing handover of the open season (a departure's included), else the season's start.
  handed timestamptz := coalesce((select h.at from season_boss_changes h join seasons x on x.id = h.season and x.ends_at is null order by h.landed_at desc, h.handover desc limit 1),
                                  (select x.starts_at from seasons x where x.ends_at is null));
  grace interval := make_interval(days => coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'inheritanceGraceDays'), 3));
  first_before uuid;
  was record;
  dep record;
  lp jsonb;
  rk text;
  resolved uuid;
  lapsed_n integer := 0;
  rq record;
  rq_post uuid;
  rq_public boolean;
  mt uuid;
begin
  if not pg_try_advisory_xact_lock(hashtext('kayfabb.system_tick')) then return jsonb_build_object('skipped', true); end if;

  -- The one lock order (0339): the global place key before anything is written. A lasting move due to land, or one in force that this tick may end (an expiry, a demand met, a superseded one), writes places, so
  -- the key is taken first. A landing move also opens a thread of its own on the system board and writes its Act into it, a thread no one else holds until the tick commits; an admin's reversal takes the key
  -- and only then writes its end into the move's thread. A non-lasting landing therefore has no row a reversal waits for, and the key is needed only where a lasting move is due or in force, which is the test
  -- below. The one key is held to the end of the tick; the tick's own rows are the only thing it waits for before it is taken.
  if exists (select 1 from queued_moves q join move_kinds k on k.key = q.kind
             where k.lasting and q.landed_act is null and q.held_at is null and q.refused_at is null and q.go_live_at <= now())
     or exists (select 1 from open_moves o join acts a on a.id = o.move_act join move_kinds k on k.key = a.payload ->> 'kind' where k.lasting) then
    perform lock_thread_places();
  end if;

  -- 1. Landing: only while The System is on. A landed move is written in a thread of its own on the staff's board (below), so it needs no thread made beforehand.
  if enabled then
    for due in
      select q.id, q.staff, q.kind, q.params, q.demand, q.expires_at, q.admin_description, q.bundle, q.depends_on from queued_moves q where q.landed_act is null and q.held_at is null and q.refused_at is null and q.go_live_at <= now() order by q.go_live_at, q.id for update skip locked
    loop
      -- A machine move is checked against the machine as it is now, so it waits for the machine's one lock (0141's admin functions take it to take a pack off sale or
      -- reorder), taken here and not inside the block below so that a timeout is not swallowed as a failed move. Without it a Pull landing as an admin took the last pack
      -- holding its card off sale could each miss the other and leave a Pull with no pack on sale. The tick holds only queued_moves rows (and Acts it inserts) when it
      -- waits here, and those functions never lock those rows, so there is no cycle. Taken only when a machine move is about to be checked, and held to the end of
      -- the tick, so the checks below read what the admin committed.
      if due.kind in ('pullSlot', 'repriceSlot', 'flashSale') then perform pg_advisory_xact_lock(hashtext('kayfabb.machine')); end if;
      begin
        -- A part of a bundle (0329) lands after the parts it builds on, and not before: one of them still waiting, and this one waits; one refused, and it is refused with it (nothing
        -- will ever make the board it names); one held (an admin's hold follows its dependents at once, so this only meets a row queued after the hold), and it is held with it. Then each
        -- role in its params is the board the part it names made, in the Act, so the Act says which board it moved to and the log can name it.
        lp := due.params;
        if due.depends_on is not null then
          select d.id, d.held_at, d.held_by, d.refused_at, d.role into dep from queued_moves d
          where d.id = any (due.depends_on) and d.landed_act is null order by (d.refused_at is not null) desc, (d.held_at is not null) desc, d.id limit 1;
          if found then
            if dep.refused_at is not null then
              update queued_moves set failed_at = now(), failure = left('that move cannot land: the move it builds on was refused', 500), refused_at = now() where id = due.id;
            elsif dep.held_at is not null then
              update queued_moves set held_at = dep.held_at, held_by = dep.held_by where id = due.id;
            end if;
            continue;
          end if;
        end if;
        for rk in select e.key from jsonb_each(lp) e where jsonb_typeof(e.value) = 'object' and e.value ? 'role' loop
          resolved := case when (lp -> rk) ? 'beat'
            then beat_role_board(meeting_season((select q.meeting from queued_moves q where q.id = due.id)), due.staff, lp #>> array[rk, 'beat'], lp #>> array[rk, 'role'])
            else role_board(due.bundle, lp #>> array[rk, 'role']) end;
          if resolved is null then exit; end if;
          lp := jsonb_set(lp, array[rk], to_jsonb(resolved::text));
        end loop;
        if resolved is null and exists (select 1 from jsonb_each(lp) e where jsonb_typeof(e.value) = 'object' and e.value ? 'role') then
          update queued_moves set failed_at = now(), failure = left('that move cannot land: a part it names made no board', 500), refused_at = now() where id = due.id;
          continue;
        end if;
        -- Two rules that conflict may have waited together; the one that lands second meets the first. It is refused for good, with the reason.
        if due.kind = 'setRule' then
          clash := rule_conflict(nullif(lp ->> 'board', '')::uuid, lp ->> 'predicate', nullif(lp -> 'param', 'null'::jsonb));
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that rule would leave no post that follows the rules: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
        end if;
        -- The machine's moves are checked against the machine as it is now (0140): a slot an admin has since changed, a card no pack on sale can give, a pull too many.
        -- Refused for good with the reason, as a rule is, and never applied: it is no Act, so nothing was put on the machine and nothing needs reversing.
        if due.kind in ('pullSlot', 'repriceSlot', 'flashSale') then
          clash := machine_move_problem(due.kind, lp, due.demand, (select q.go_live_at from queued_moves q where q.id = due.id), due.expires_at, true);
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that machine move cannot land: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
        end if;
        -- The three moves that build the board are checked against the boards and threads as they are now (0320), as a machine move is against the machine: state changes between
        -- the queue and the landing (a board closed, a thread gone, a merge that would now make a cycle). Refused for good, with the reason; it is no Act, so nothing needs reversing.
        if due.kind in ('createBoard', 'moveThread', 'mergeBoard') then
          -- The writers of a place wait for each other (0339): the global key (already held, taken before the loop; a second take costs nothing), and for a merge the key of the board it closes, which a
          -- thread insert on that board tries shared, so a thread started there is committed before the merge reads its threads, or is refused at once. Both are held to the end of the tick.
          perform lock_thread_places();
          if due.kind = 'mergeBoard' then perform lock_board_closing(safe_uuid(lp ->> 'board')); end if;
          clash := lasting_move_problem(due.kind, lp);
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that move cannot land: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
          first_before := first_open_board();
        end if;
        -- The Boss's trophy (0208) is checked against the instance as it is now: a character that has since become staff or retired, a trophy it was given meanwhile, a belt it
        -- already holds. Refused for good with the reason, as the machine's moves are, and never applied: it is no Act, so no award was written and nothing needs reversing.
        if due.kind = 'awardTrophy' then
          clash := trophy_move_problem(due.params, due.demand);
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that trophy cannot be given: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
        end if;
        -- The move's thread (the staff-board threads design, section 6): a part of a bundle goes in the thread of the bundle's earliest landed part, whenever that landed; anything else, and a bundle's first part,
        -- opens a staff thread of its own, titled for its kind. It is opened here, inside this move's block, so a part that fails to land takes its thread with it and the next one that lands opens it again.
        mt := null;
        if due.bundle is not null then
          select a.thread into mt from queued_moves p join acts a on a.id = p.landed_act where p.bundle = due.bundle and p.landed_act is not null order by a.created_at, a.seq, a.id limit 1;
        end if;
        if mt is null then mt := open_staff_thread(due.staff, move_thread_title(due.kind, lp, due.staff)); end if;
        written := (write_staff_act(due.staff, 'move', mt, null,
          jsonb_build_object('kind', due.kind, 'params', lp, 'body', system_line(case when due.kind = 'setRule' then 'ruleSet' else 'moveLanded' end, due.kind, lp, due.staff))
          || case when due.demand is not null then jsonb_build_object('demand', due.demand) else '{}'::jsonb end
          || case when due.expires_at is not null then jsonb_build_object('expires_at', due.expires_at) else '{}'::jsonb end) ->> 'id')::uuid;
        update queued_moves set landed_act = written where id = due.id;
        -- A ruling on a player's own character (design section 2): the member a Boss put in a group is told, as is the starter of a thread the Boss moved. A mergeBoard and a group left alert no one.
        if due.kind = 'conferGroup' then
          perform write_alert(safe_uuid(lp ->> 'character'), 'ruling', 'grouped', written, null);
        elsif due.kind = 'moveThread' then
          perform write_alert((select a.character from acts a where a.thread = safe_uuid(lp ->> 'thread') and a.seq = 1), 'ruling', 'threadMoved', written, null);
        end if;
        -- What it was built on, recorded now that it has landed: an admin's reversal of one of them follows it (reverse_move).
        if due.depends_on is not null then
          insert into move_dependencies (act, on_act) select written, d.landed_act from queued_moves d where d.id = any (due.depends_on) and d.landed_act is not null and d.landed_act <> written on conflict do nothing;
        end if;
        -- The award is the move's whole effect and outlasts it: written in this transaction, naming the move's Act, and the move ends at once (`spent`, as a nomination does). If
        -- either fails, the Act goes with them (this block's rollback) and the move is left due, with the failure recorded below.
        if due.kind = 'awardTrophy' then
          insert into trophy_awards (trophy, character, by, act) values (due.params ->> 'trophy', (due.params ->> 'character')::uuid, 'boss', written);
          perform end_move(written, 'spent', 'award');
        end if;
        if due.kind = 'renameBoard' and due.admin_description is not null then
          perform write_describe((lp ->> 'board')::uuid, due.admin_description, written);
        end if;
        -- A made board is a row (its slug from its name), pointing at the Act that made it; a moved thread ends the move of the same thread that was in force, as superseded; then the
        -- threads the move touched are rebuilt (lasting_rebuild), so the stored board follows the Acts.
        if due.kind = 'createBoard' then
          insert into boards (slug, name, description, created_by_act) values (board_slug_for(lp ->> 'name'), lp ->> 'name', coalesce(lp ->> 'description', ''), written);
        elsif due.kind = 'moveThread' then
          for was in
            select o.move_act from open_moves o join acts a on a.id = o.move_act
            where a.payload ->> 'kind' = 'moveThread' and lower(a.payload #>> '{params,thread}') = lower(lp ->> 'thread') and a.id <> written
            order by o.landed_at, o.move_act
          loop
            if (end_move(was.move_act, 'superseded', 'landing') ->> 'ended')::boolean then perform say_move_end(was.move_act, 'superseded'); end if;
          end loop;
        end if;
        if due.kind in ('createBoard', 'moveThread', 'mergeBoard') then perform lasting_rebuild(written, first_before); end if;
        landed := landed + 1;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: queued move % did not land: % (%)', due.id, sqlerrm, sqlstate;
        -- Recorded on the row (the latest failure), so the admin queue can show it and an admin can hold the row. The row stays due.
        update queued_moves set failed_at = now(), failure = left(sqlerrm || ' (' || sqlstate || ')', 500) where id = due.id;
      end;
    end loop;
  end if;

  -- 1b. Arcs (0332): after landing, so a bundle that landed in this tick has unlocked what waited on it in the same one. Only while The System is on (a beat unlocks for a meeting). The pass reads the
  -- season's Boss alone and costs the same however many Acts there are; a failure of it is counted and warned about and never stops the rest of the tick.
  if enabled then
    begin
      lp := arc_pass();
      arcs := (lp ->> 'unlocked')::integer + (lp ->> 'lapsed')::integer;
    exception when others then
      failed := failed + 1;
      raise warning 'system_tick: the arc pass failed: % (%)', sqlerrm, sqlstate;
    end;
  end if;

  -- 2. Expiry: whatever the switch says, for every move in force, every tick. It is a comparison.
  for inforce in
    select o.move_act, a.character, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act order by o.landed_at, o.move_act
  loop
    expires := move_expires_at(inforce.move_act);
    if expires is not null and expires <= now() then
      begin
        did_end := (end_move(inforce.move_act, 'expired', 'expiry') ->> 'ended')::boolean;
        if did_end then expired := expired + 1; perform say_move_end(inforce.move_act, 'expired'); end if;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
      end;
    end if;
  end loop;

  -- 2b. The handover's leftovers, whatever the switch says. A nomination in force whose Boss is not the season's is spent (a nomination that
  -- landed after the handover it was for); a move that shapes a board and is not the season's Boss's, still unaddressed `inheritanceGraceDays`
  -- after the handover that seated the Boss, the latest of the season's (a departure's included), or after it landed, if later, ends `superseded`: the new Boss's review never came, or never reached it. A move the
  -- Boss kept is its own (move_owner), so it never ends here. The read is of the moves in force, a handful of rows.
  if boss is not null then
    for inforce in
      select o.move_act, a.payload ->> 'kind' as kind, o.landed_at
      from open_moves o join acts a on a.id = o.move_act join move_kinds k on k.key = a.payload ->> 'kind' and (k.shapes_board or k.key = 'nameSuccessor') and not k.lasting
      where move_owner(o.move_act) is distinct from boss
      order by o.landed_at, o.move_act
    loop
      begin
        if inforce.kind = 'nameSuccessor' then
          perform end_move(inforce.move_act, 'spent', 'handover');
        elsif greatest(inforce.landed_at, handed) + grace <= now() then
          did_end := (end_move(inforce.move_act, 'superseded', 'inheritance') ->> 'ended')::boolean;
          if did_end then superseded := superseded + 1; perform say_move_end(inforce.move_act, 'superseded'); end if;
        end if;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: inherited move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
      end;
    end loop;
  end if;

  -- 3. Demands: the moves least recently checked, at most `cap`, none checked within `check_every`, and none once the budget is spent.
  -- A move with no demand is never read. `checked_at` is set before the read, so a move whose progress errors takes its turn like the
  -- rest instead of holding the front of the line; the count it read is stored beside it (`open_moves.progress`, 0053).
  for inforce in
    select o.move_act, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act where jsonb_typeof(a.payload -> 'demand') = 'object' and not (a.payload ->> 'kind' = 'conferGroup' and a.payload #> '{params,checkAt}' is not null) and (o.checked_at is null or o.checked_at <= now() - check_every) order by o.checked_at nulls first, o.move_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    update open_moves set checked_at = now() where move_act = inforce.move_act;
    checked := checked + 1;
    did_end := false;
    counted := null;
    begin
      counted := demand_progress_or_error(inforce.move_act);
      if coalesce((counted ->> 'met')::boolean, false) then
        did_end := (end_move(inforce.move_act, 'met', 'demand') ->> 'ended')::boolean;
        if did_end then
          met := met + 1;
          -- The met demand's trophy to each character that made it (0206), in a block of its own: the move is ended whatever happens here. A failure is a warning, a row
          -- (trophy_award_failures) and a count in the tick's answer, and an admin can give the trophy by hand.
          begin
            perform award_demand_trophies(inforce.move_act);
          exception when others then
            awards_failed := awards_failed + 1;
            raise warning 'system_tick: the trophies for move % were not given: % (%)', inforce.move_act, sqlerrm, sqlstate;
            begin
              insert into trophy_award_failures (move_act, error) values (inforce.move_act, left(sqlerrm || ' (' || sqlstate || ')', 500))
              on conflict (move_act) do update set error = excluded.error, at = now();
            exception when others then null;
            end;
          end;
        end if;
      end if;
    exception when others then
      failed := failed + 1;
      did_end := false;
      raise warning 'system_tick: move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
    end;
    -- What it read is kept on the move's row (a move just ended has no row left, and the update finds none), outside the block above so
    -- that a failure in ending the move does not take the count with it. The board and the admin queue read this, not the evaluator.
    if counted is not null then update open_moves set progress = counted where move_act = inforce.move_act; end if;
    -- The Boss says it. The move is ended whether or not the line is posted.
    if did_end then perform say_move_end(inforce.move_act, 'met'); end if;
  end loop;

  -- 3b. Favors: a favor is a group conferred with a check (`params.checkAt`) and the demand it reads. It is not ended `met` by the pass above: a favor met is kept to its
  -- expiry. At its check, one whose demand is not met is stripped, `unmet`, and the Boss says so. A demand that cannot be evaluated (progress carries an `error`) is no evidence:
  -- the favor is left and read again at the next turn. The moves in force that carry a check are a handful; one past its check is read at most once in `demandCheckMinutes`, the
  -- least recently checked first, and none once the budget is spent. One already recorded met (open_moves.progress) is not read again: a demand only ever grows, and the favor
  -- is kept to its expiry.
  for inforce in
    select o.move_act, a.payload from open_moves o join acts a on a.id = o.move_act
    where a.payload ->> 'kind' = 'conferGroup' and a.payload #> '{params,checkAt}' is not null and (o.checked_at is null or o.checked_at <= now() - check_every)
      and coalesce((o.progress ->> 'met')::boolean, false) is not true
      -- Only a favor whose check has come (the case keeps a malformed time from being cast: the guard refuses one, and a move written any other way must not stop the tick).
      and case when a.payload #>> '{params,checkAt}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then (a.payload #>> '{params,checkAt}')::timestamptz end <= now()
    order by o.checked_at nulls first, o.move_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      check_at := (inforce.payload #>> '{params,checkAt}')::timestamptz;
      if check_at <= now() then
        update open_moves set checked_at = now() where move_act = inforce.move_act;
        checked := checked + 1;
        counted := demand_progress_or_error(inforce.move_act);
        if not (counted ? 'error') then update open_moves set progress = counted where move_act = inforce.move_act; end if;
        if counted ? 'error' then
          failed := failed + 1;
          raise warning 'system_tick: favor % could not be read at its check: % ', inforce.move_act, counted ->> 'error';
        elsif not coalesce((counted ->> 'met')::boolean, false) then
          did_end := (end_move(inforce.move_act, 'unmet', 'check') ->> 'ended')::boolean;
          if did_end then unmet := unmet + 1; perform say_move_end(inforce.move_act, 'unmet'); end if;
        end if;
      end if;
    exception when others then
      failed := failed + 1;
      raise warning 'system_tick: favor % was not checked: % (%)', inforce.move_act, sqlerrm, sqlstate;
    end;
  end loop;

  -- 4. Visits: each open visit `filingGraceMinutes` past its end is filed with the stock line, so nothing waits on a model. Whatever the switch says: a
  -- visit that has started is filed even if The System is turned off, and even if its Mod has left the staff. By visits_open_due, oldest first, and none once
  -- the budget is spent, at most `demandChecksPerTick` (the tick's one count for work per run; visits have no setting of their own); one that has failed goes behind the
  -- rest, by its last failure; file_visit locks the visit, so the filing cron racing this files it once. One that fails is left for the next tick.
  for late in
    select o.visit_act from visits_open o where o.ends_at <= now() - filing_grace order by o.failed_at nulls first, o.ends_at, o.visit_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      if (file_visit(late.visit_act, null) ->> 'filed')::boolean then filed := filed + 1; end if;
    exception when others then
      failed := failed + 1;
      raise warning 'system_tick: visit % did not file: % (%)', late.visit_act, sqlerrm, sqlstate;
      -- Recorded, and sent behind the others (the order above), so a visit that keeps failing never starves the rest.
      update visits_open set failed_at = now(), attempts = attempts + 1 where visit_act = late.visit_act returning attempts into tries;
      insert into visit_file_failures (visit_act, attempts, error) values (late.visit_act, coalesce(tries, 1), left(sqlerrm || ' (' || sqlstate || ')', 500))
      on conflict (visit_act) do update set attempts = excluded.attempts, error = excluded.error, at = now();
      -- The ceiling: a visit that cannot be filed after `visit_file_attempts_most` tries is dropped (ended `dropped`, no infraction), so it is never stuck for good.
      if coalesce(tries, 1) >= 10 then
        begin
          perform end_visit(late.visit_act, 'dropped', null, 'This visit could not be filed and was dropped.');
        exception when others then
          raise warning 'system_tick: visit % could not be dropped: % (%)', late.visit_act, sqlerrm, sqlstate;
        end;
      end if;
    end;
  end loop;

  -- 5. Staff requests (0424): a request a persona conferred and no meeting has ruled lapses `staffRequests.daysMost` days after it was conferred (staff_requests_now.lapses_at), and one whose request post is
  -- hidden, or gone, lapses at the next tick. Whatever the switch says, as a visit is filed: a state's way out is time, so a request does not wait on The System being on. The oldest first, at most `demandChecksPerTick`
  -- (the tick's one count for work per run), and none once the budget is spent. Where the post is still public and The System is on, the Boss replies in the thread to the request post with the stock line
  -- `requestLapsed` ({boss}, {asker}: the asker as the post's public author shows, so a veiled one is the anonymous name); an instance with no such line says nothing, and a post that cannot be written is
  -- a warning, never a request left waiting (boss_request_reply writes it, as requests_ruled's replies are). The reply is written before its ruling row (which names it), so the request's key is held first: try-locked, never waited on, so a meeting ruling the same
  -- request (requests_ruled holds the same key) and this pass cannot wait on each other; one it holds is left to the next tick. It reads the queue (staff_requests_open), the requests that wait and no other, so a row is read per
  -- waiting request, which the days they wait bound, and never one per request ruled in the past. As visits are (4 above), a request that failed to lapse, or was held by a meeting, goes behind the rest by its last
  -- failure (failed_at, then the oldest first), so one request that keeps raising or keeps being held never holds a slot of the pass from the others; it is still read when the others have been, and a meeting can rule it.
  for rq in select d.id, d.request_act, d.thread from staff_requests_due(cap) d
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    begin
      if not pg_try_advisory_xact_lock(hashtextextended('kayfabb.request.' || rq.id, 0)) then
        -- A meeting holds it (the row may be one its transaction has already ruled): behind the others, and never waited for (skip locked), so the tick does not wait on that transaction either.
        update staff_requests_open set failed_at = now() where request = (select x.request from staff_requests_open x where x.request = rq.id for update skip locked);
        continue;
      end if;
      if exists (select 1 from staff_request_rulings g where g.request = rq.id) then continue; end if;
      rq_post := null;
      rq_public := staff_request_post_public(rq.request_act);
      if rq_public and enabled and boss is not null then
        begin
          rq_post := boss_request_reply(boss, rq.thread, rq.request_act, 'requestLapsed', null);
        exception when others then
          rq_post := null;
          raise warning 'system_tick: the lapse of request % was not said: % (%)', rq.id, sqlerrm, sqlstate;
        end;
      end if;
      insert into staff_request_rulings (request, ruling, post_act) values (rq.id, 'lapsed', rq_post);
      lapsed_n := lapsed_n + 1;
    exception when others then
      failed := failed + 1;
      raise warning 'system_tick: request % did not lapse: % (%)', rq.id, sqlerrm, sqlstate;
      -- Recorded and sent behind the others (the order above). The block's own writes are undone, so this is the one write left; a row a meeting is ruling is not waited for.
      update staff_requests_open set failed_at = now(), attempts = attempts + 1 where request = (select x.request from staff_requests_open x where x.request = rq.id for update skip locked);
    end;
  end loop;

  return jsonb_build_object('landed', landed, 'met', met, 'expired', expired, 'superseded', superseded, 'unmet', unmet, 'failed', failed, 'checked', checked, 'visits', filed, 'beats', arcs, 'budget', out_of_time,
    'awardsFailed', awards_failed, 'requestsLapsed', lapsed_n);
end $$;
