-- createBoard, moveThread and mergeBoard land and end (docs/plans/2026-11-06-fangame-split-design.md, section 4; docs/plans/2026-11-06-fangame-split-plan.md, Task 2).
--
-- The three lasting moves (0291) are made real: each is queued as every move is, lands through the tick as every move does, and ends by being reversed or superseded.
--
--   boards.created_by_act       is set only when the board is inserted (a trigger refuses any later change, enabled always, as origin_board's is), names a createBoard Act, and is
--                               unique: one Act makes one board. A created board's premise is read from that Act's params (append-only; boards has no premise column), in boards_now.
--   boards_now                  grows, at its end, `closed` (a mergeBoard of it in force, or the createBoard that made it ended) and `merged_into` (where a merge in force sends it).
--   lasting_move_problem        what a lasting move names, held to the boards and threads as they are: read by the queue's guard and again by the tick at landing, since a board can
--                               close, a thread can go and a merge can become a cycle between the two. In words, for the admin queue.
--   board_slug_for              a slug from a name, made unique with a suffix (-2, -3, ...).
--   first_open_board            the instance's first open board that is not The System's own: where a closed created board's threads go when its move names no fallback.
--   threads_touching_board      the threads a change to one board's openness or merge can move: those that START in the board or in any board whose threads route into it (merges in
--                               force, and the explicit fallback of an ended createBoard, followed backward), those stored on it, and those a moveThread names it for. Complete because
--                               a thread's place is computed from where it starts (its origin, or the board a moveThread in force names) and the routes from there; only the routes
--                               through this board change.
--   lasting_rebuild             rebuilds the threads a lasting move touched, after it landed or ended. If the instance's first open board changed (a merge of the first open board, or its
--                               reversal), the implicit route "closed created board with no fallback -> first open board" moved too, and every thread is rebuilt; that is rare.
--   end_move (0135)             ending a lasting move calls lasting_rebuild.
--   (0312)                      lasting_rebuild takes the global place key (lock_thread_places) before it reads, as every writer of a place does, so what it rebuilds from is what the others committed.
--   queued_moves_guard (0140)   a lasting move has no demand and no expiry (the meeting queues it with 0 hours, so the guard keeps none); the three kinds' refusals, in words.
--   system_tick (0140)          lands the three kinds beside renameBoard: a createBoard inserts its board; a moveThread ends the earlier move of the same thread as `superseded`; each
--                               then rebuilds the threads it touched. The handover's pass (2b) no longer ends a lasting move as unaddressed: a new Boss inherits the landscape (0291).
--   threads_recount_board       board_thread_counts follows a thread whose board changes (it counted only inserts): one off the old board's count, one on the new one's, a shard taken
--                               with `for update skip locked` as the insert's is. The system board's count stays 0 (its threads are taken off at insert), so it is never adjusted.
--
-- Other tallies on threads.board: post_search.board is already rewritten by threads_search_board (0117) when a thread's board changes; board_counts is a sum of board_thread_counts
-- (this migration); thread_list is a view over threads. No other trigger or table keys on a thread's board.
--
-- Not changed: acts_well_formed (0148) checks no move's params, so it already admits these kinds' (the queue's guard is what holds them, and the readers of a place read a
-- malformed Act as no move at all, 0292).
--
-- Cost on a busy instance: a landing or an end costs the threads it touches (one indexed read of threads by origin and by board per board in the route, an index probe of moves
-- per thread), never the history. A thread whose board changes is not free: threads_recount_board fires per thread, and threads_search_board (0117) rewrites post_search.board for
-- every post of the thread, so a moved thread costs its posts. A merge of a large board does one pass over that board's threads, and so rewrites the post_search row of every post
-- in the board, in the tick's one transaction (and the tick's statement bound): proportional to the posts in the merged board. Merging a very large board is a deliberate, rare
-- admin-reviewed move (it waits a day in the queue); a batched rebuild is the way out if one ever outgrows a transaction. The guard and the tick's check are a handful of indexed probes.
-- Masks. Public facts only (boards, threads, the Boss's own moves). Append-only: a move is an Act, its end an Act; the board row is the only thing a landing writes, and it is derived
-- from the Act. Ways out: every lasting move can be reversed by an admin; a thread is never without a board.
--
-- Merged with main's 0154 (#469): system_tick ends a visit that cannot be filed as 'dropped' (end_visit(..., 'dropped', ...)), no longer 'reversed'; carried into this definition, which is built on 0140's body.

-- ---------------------------------------------------------------------------------------------------- boards ----
--
-- Ported onto main (merge of #449 Cosmetics, migrations 0205-0213): system_tick: rebuilt on 0208's body (main's awardTrophy refusal and landing, the met demand's trophies in their own block, and 'awardsFailed' kept beside this migration's own).

create unique index boards_created_by_act on boards (created_by_act) where created_by_act is not null;
create index acts_move_thread_board on acts ((lower(payload #>> '{params,board}'))) where kind = 'move' and payload ->> 'kind' = 'moveThread';

create function boards_made_by_checked() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'a board''s created_by_act is set when the board is made and never changes' using errcode = 'P0001';
  end if;
  if new.created_by_act is not null and not exists (select 1 from acts a where a.id = new.created_by_act and a.kind = 'move' and a.payload ->> 'kind' = 'createBoard') then
    raise exception 'a board is made by a createBoard move' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger boards_made_by_checked before insert on boards for each row execute function boards_made_by_checked();
create trigger boards_made_by_fixed before update of created_by_act on boards for each row
  when (old.created_by_act is distinct from new.created_by_act) execute function boards_made_by_checked();
-- Always: a session in replica mode, as a restore with triggers disabled runs, fires it too.
alter table boards enable always trigger boards_made_by_fixed;

revoke execute on function boards_made_by_checked() from public, anon, authenticated;

comment on column boards.created_by_act is 'The createBoard move Act that made this board; null for a board seeded or made before. Set only at insert.';

-- --------------------------------------------------------------------------------------------------- helpers ----

-- A slug from a name: lowercase letters and digits, runs of anything else one hyphen; made unique with a suffix.
create function board_slug_for(in_name text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  base text := left(btrim(regexp_replace(lower(coalesce(in_name, '')), '[^a-z0-9]+', '-', 'g'), '-'), 40);
  candidate text;
  n integer := 1;
begin
  base := btrim(base, '-');
  if base = '' then base := 'board'; end if;
  candidate := base;
  while exists (select 1 from boards b where b.slug = candidate) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  return candidate;
end $$;

-- The first open board that is not The System's own.
create function first_open_board() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select b.id from boards b where not b.is_system and board_is_open(b.id) order by b.created_at, b.id limit 1
$$;

-- What a lasting move on boards and threads names, held to the boards and threads as they are now: null when it can stand, else the reason in plain words.
create function lasting_move_problem(in_kind text, params jsonb) returns text
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
    select t.id, t.board, t.origin_board into th from threads t where t.id = safe_uuid(params ->> 'thread');
    if th.id is null then return 'there is no such thread to move'; end if;
    if exists (select 1 from boards b where b.is_system and b.id in (th.board, th.origin_board)) then return 'a thread on The System''s own board is never moved'; end if;
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

-- The threads a change to this board can move (see the header).
create function threads_touching_board(in_board uuid) returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive
  edges as (
    select safe_uuid(a.payload #>> '{params,board}') as src, safe_uuid(a.payload #>> '{params,into}') as dst
    from open_moves o join acts a on a.id = o.move_act where a.payload ->> 'kind' = 'mergeBoard'
    union
    select b.id, safe_uuid(a.payload #>> '{params,fallback}')
    from boards b join acts a on a.id = b.created_by_act
    where exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = b.created_by_act)
  ),
  reach (b) as (
    select in_board
    union
    select e.src from reach r join edges e on e.dst = r.b where e.src is not null
  )
  select coalesce(array_agg(x.id), '{}') from (
    select t.id from threads t where t.origin_board in (select b from reach) or t.board in (select b from reach)
    union
    select safe_uuid(a.payload #>> '{params,thread}')
    from acts a where a.kind = 'move' and a.payload ->> 'kind' = 'moveThread' and lower(a.payload #>> '{params,board}') in (select b::text from reach)
  ) x where x.id is not null
$$;

-- Rebuilds the threads a lasting move touched, after it landed or ended; first_before is first_open_board() as it was before the change.
create function lasting_rebuild(in_move uuid, first_before uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m acts%rowtype;
  touched uuid[];
begin
  perform lock_thread_places();
  select * into m from acts where id = in_move and kind = 'move';
  if not found then return 0; end if;
  -- The implicit route of a closed created board with no fallback is the first open board: when that moved, any such board's threads move, so all are rebuilt.
  if first_open_board() is distinct from first_before then return rebuild_thread_places(); end if;
  touched := case m.payload ->> 'kind'
    when 'moveThread' then array[safe_uuid(m.payload #>> '{params,thread}')]
    when 'mergeBoard' then threads_touching_board(safe_uuid(m.payload #>> '{params,board}'))
    when 'createBoard' then threads_touching_board((select b.id from boards b where b.created_by_act = in_move))
    else '{}'::uuid[] end;
  return rebuild_thread_places(touched);
end $$;

revoke execute on function board_slug_for(text), first_open_board(), lasting_move_problem(text, jsonb), threads_touching_board(uuid), lasting_rebuild(uuid, uuid) from public, anon, authenticated;
grant execute on function board_slug_for(text), first_open_board(), lasting_move_problem(text, jsonb), threads_touching_board(uuid), lasting_rebuild(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------------------------- the counts ----

-- board_thread_counts counted a thread only when it was started (0030). A thread whose board is rebuilt moves one off the board it left and one onto the board it joined.
-- The system board is never adjusted: its threads are taken off its count when they are started, so it reads 0 and no thread is moved off or onto it.
create function threads_recount_board() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from boards b where b.id = old.board and b.is_system) then
    update board_thread_counts set threads = threads - 1
     where board = old.board and shard = coalesce((select c.shard from board_thread_counts c where c.board = old.board order by c.shard for update skip locked limit 1), 0);
  end if;
  if not exists (select 1 from boards b where b.id = new.board and b.is_system) then
    update board_thread_counts set threads = threads + 1
     where board = new.board and shard = coalesce((select c.shard from board_thread_counts c where c.board = new.board order by c.shard for update skip locked limit 1), 0);
  end if;
  return null;
end $$;
create trigger threads_recount_board after update of board on threads
  for each row when (old.board is distinct from new.board) execute function threads_recount_board();
revoke execute on function threads_recount_board() from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ boards_now ----

-- boards_now (0101), also `closed` and `merged_into`, at its end; and a created board's premise read from the Act that made it, between a rename's and the board's own description.
create or replace view boards_now as
  with live as materialized (
    select a.id as move_act, a.created_at, a.payload #>> '{params,board}' as board, a.payload #>> '{params,name}' as name,
           a.payload #>> '{params,premise}' as premise, a.payload #>> '{params,description}' as description
    from open_moves o
    cross join lateral (select x.id, x.created_at, x.payload from acts x where x.id = o.move_act offset 0) a
    where a.payload ->> 'kind' = 'renameBoard'
  )
  select b.id, b.slug, coalesce(m.name, b.name) as name,
         coalesce(m.premise, (select c.payload #>> '{params,premise}' from acts c where c.id = b.created_by_act), b.description) as premise,
         coalesce(d.description, m.description, b.description) as description, b.is_system, b.created_at, m.move_act,
         (g.merged_into is not null
          or (b.created_by_act is not null and exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = b.created_by_act))) as closed,
         g.merged_into
  from boards b
  left join lateral (
    select l.move_act, l.name, l.premise, l.description from live l
    where lower(l.board) = b.id::text
    order by l.created_at desc, l.move_act desc
    limit 1
  ) m on true
  left join lateral (
    select x.payload ->> 'description' as description from acts x
    where x.kind = 'describe' and x.payload ->> 'board' = b.id::text and x.payload ->> 'move_act' is not distinct from m.move_act::text
    order by x.created_at desc, x.id desc
    limit 1
  ) d on true
  left join lateral (select board_merge_into(b.id) as merged_into) g on true;

-- ------------------------------------------------------------------------------------------------- end_move ----

-- end_move (0135), a lasting move's end also rebuilding the threads it touched. Everything else as 0135 wrote it.
create or replace function end_move(move_act uuid, why text, by text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m acts%rowtype;
  existing uuid;
  written uuid;
  lasting boolean;
  first_before uuid;
begin
  if why is null or why not in ('met', 'expired', 'reversed', 'superseded', 'spent', 'unmet', 'overturned') then raise exception 'a move ends as met, expired, reversed, superseded, spent, unmet or overturned, not %', coalesce(why, 'nothing') using errcode = '22023'; end if;
  if by is null or char_length(by) not between 1 and 40 then raise exception 'a move''s end says who ended it' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('kayfabb.end_move'), hashtext(move_act::text));
  select * into m from acts where id = move_act and kind = 'move';
  if not found then raise exception 'there is no such move' using errcode = 'P0002'; end if;
  select e.id into existing from acts e where e.kind = 'move_end' and e.target_act_id = move_act;
  if existing is not null then return jsonb_build_object('act', existing, 'ended', false); end if;
  -- A tick that read the old expiry before a ruling moved it is too late: the ruling is a fact of the lock's holder, read here under the lock.
  if why = 'expired' and exists (select 1 from acts a join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
                                 where a.kind = 'appeal' and a.target_act_id = move_act and (r.payload ->> 'until')::timestamptz > now()) then
    return jsonb_build_object('act', null, 'ended', false, 'extended', true);
  end if;
  lasting := coalesce((select k.lasting from move_kinds k where k.key = m.payload ->> 'kind'), false);
  if lasting then first_before := first_open_board(); end if;
  perform set_config('kayfabb.move_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (null, 'move_end', m.thread, move_act, jsonb_build_object('why', why, 'by', by)) returning id into written;
  perform set_config('kayfabb.move_end_writer', '', true);
  if lasting then perform lasting_rebuild(move_act, first_before); end if;
  return jsonb_build_object('act', written, 'ended', true);
end $$;

-- ------------------------------------------------------------------------------------ the queue's guard ----

-- queued_moves_guard (0140), also holding the three lasting board moves to what they name, and keeping no demand or expiry on a lasting move. Everything else as 0140 wrote it.
create or replace function queued_moves_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  params_ok boolean;
  problem text;
  holder text;
  watched uuid;
  target record;
  grp group_kinds%rowtype;
  has_board boolean;
  dkind text;
  check_at timestamptz;
  cap jsonb;
  lasting_param text;
begin
  if tg_op = 'DELETE' then
    raise exception 'a queued move is held or landed, never removed' using errcode = '23514';
  elsif tg_op = 'INSERT' then
    if new.demand is not null and not exists (select 1 from demand_kinds d where d.key = new.demand ->> 'kind') then
      raise exception 'there is no demand kind "%"', coalesce(new.demand ->> 'kind', '') using errcode = '23514';
    end if;
    if new.demand is not null and demand_params_problem(new.demand) is not null then
      raise exception 'the demand''s params are malformed at %', demand_params_problem(new.demand) using errcode = '23514';
    end if;
    if not exists (select 1 from move_kinds k where k.key = new.kind) then
      raise exception 'there is no move kind "%"', new.kind using errcode = '23514';
    end if;
    if new.structural is distinct from (select k.structural from move_kinds k where k.key = new.kind) then
      raise exception 'a % move is not queued as structural = %', new.kind, new.structural using errcode = '23514';
    end if;
    -- Who may make a move: the office the staff member holds now must be one the kind names (0103). The Boss holds the seat the open season names;
    -- a Mod Bot is on staff; a member, a benched persona, a waiting one and the developer make none.
    holder := (select o.office from staff_office_now o where o.staff = new.staff);
    if holder is null or not exists (select 1 from move_kinds k where k.key = new.kind and holder = any (k.offices)) then
      raise exception 'a % move is not one a % makes', new.kind, coalesce(holder, 'staff member with no office') using errcode = '23514';
    end if;
    -- The Boss's three moves on the machine (0140): the params, the demand and the bounds, from the move and the economy alone. What the machine looks like when
    -- the move lands is checked then, by the tick, which refuses a move that cannot (a meeting that read the machine a day earlier is not failed for it).
    if new.kind in ('pullSlot', 'repriceSlot', 'flashSale') then
      if jsonb_typeof(new.params -> 'slot') = 'string' then new.params := jsonb_set(new.params, '{slot}', to_jsonb(lower(new.params ->> 'slot'))); end if;
      problem := machine_move_problem(new.kind, new.params, new.demand, new.go_live_at, new.expires_at, false);
      if problem is not null then raise exception 'a machine move is refused: %', problem using errcode = '23514'; end if;
    end if;
    -- A lasting move (0293) has no expiry and carries no demand: the meeting queues it with an expiry of its own length (0 hours), which is nothing, so the guard keeps none.
    if (select k.lasting from move_kinds k where k.key = new.kind) then
      if new.demand is not null then raise exception 'a % has no demand; what it builds stays', new.kind using errcode = '23514'; end if;
      new.expires_at := null;
    end if;
    -- The three moves that build the board: one form of the ids for every reader (the indexes on the moves compare lowercase), then what the move names, as it is now.
    if new.kind in ('createBoard', 'moveThread', 'mergeBoard') then
      for lasting_param in select unnest(array['thread', 'board', 'into', 'fallback']) loop
        if jsonb_typeof(new.params -> lasting_param) = 'string' then new.params := jsonb_set(new.params, array[lasting_param], to_jsonb(lower(new.params ->> lasting_param))); end if;
      end loop;
      problem := lasting_move_problem(new.kind, new.params);
      if problem is not null then raise exception 'a % is refused: %', new.kind, problem using errcode = '23514'; end if;
    end if;
    if new.kind = 'nameSuccessor' then
      if new.demand is not null or new.expires_at is not null then raise exception 'a nomination has no demand and no expiry' using errcode = '23514'; end if;
      if jsonb_typeof(new.params -> 'boss') is distinct from 'string'
         or not (new.params ->> 'boss' = any (boss_roster())) then
        raise exception 'a nomination names a persona on the Boss roster, not a benched or retired one' using errcode = '23514';
      end if;
      if new.params ->> 'boss' = new.staff then raise exception 'a Boss does not name itself' using errcode = '23514'; end if;
    end if;
    -- A group move (the design's section 5). The character is a debuted one of the players' and not staff; the group is one the instance lists as conferred. A board is barred
    -- only by a punishment, and it is a board of the players. A punishment that bars a board carries the apology that lifts it, and nothing else carries that demand. A favor
    -- carries the check the tick reads and the demand it reads; a punishment carries none. A character has one such move at a time, and a punishment waits out the cap.
    if new.kind = 'conferGroup' then
      -- One form of the ids for every reader (the landed-Act count, the index), as a rule's board is kept in lowercase.
      if jsonb_typeof(new.params -> 'character') = 'string' then new.params := jsonb_set(new.params, '{character}', to_jsonb(lower(new.params ->> 'character'))); end if;
      if jsonb_typeof(new.params -> 'board') = 'string' then new.params := jsonb_set(new.params, '{board}', to_jsonb(lower(new.params ->> 'board'))); end if;
      select c.id, c.name, c.staff into target from characters_public c
      where c.id = case when lower(new.params ->> 'character') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (new.params ->> 'character')::uuid end;
      if target.id is null then raise exception 'a group move names a member who has debuted' using errcode = '23514'; end if;
      if target.staff is not null then raise exception 'a group move never names a staff member' using errcode = '23514'; end if;
      select * into grp from group_kinds k where k.key = new.params ->> 'group' and k.source = 'conferred';
      if not found then raise exception 'a group move names a conferred group, and "%" is not one', coalesce(new.params ->> 'group', '') using errcode = '23514'; end if;
      -- A Mod's group move is a punishment that bars a board of its beat: the favor is refused here, and the board and the beat by the Mod's rules below.
      if holder = 'mod' and grp.tone <> 'punishment' then raise exception 'a Mod confers a punishment, never a favor' using errcode = '23514'; end if;
      has_board := new.params -> 'board' is not null and new.params -> 'board' <> 'null'::jsonb;
      if has_board then
        if grp.tone <> 'punishment' then raise exception 'only a punishment bars a board' using errcode = '23514'; end if;
        if lower(new.params ->> 'board') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           or not exists (select 1 from boards b where b.id = (new.params ->> 'board')::uuid and b.id is distinct from system_board()) then
          raise exception 'a group move bars a board of the players, not The System''s' using errcode = '23514';
        end if;
      end if;
      dkind := new.demand ->> 'kind';
      if grp.tone = 'punishment' and has_board and dkind is distinct from 'apologyAccepted' then
        raise exception 'a punishment that bars a board carries the demand apologyAccepted' using errcode = '23514';
      end if;
      if dkind = 'apologyAccepted' and not (grp.tone = 'punishment' and has_board) then
        raise exception 'only a punishment that bars a board carries the demand apologyAccepted' using errcode = '23514';
      end if;
      if grp.tone = 'favor' then
        begin
          check_at := (new.params ->> 'checkAt')::timestamptz;
        exception when others then
          check_at := null;
        end;
        if new.expires_at is null or check_at is null or check_at <= new.go_live_at or check_at >= new.expires_at then
          raise exception 'a favor carries a checkAt between its go-live and its expiry' using errcode = '23514';
        end if;
        if new.demand is null then raise exception 'a favor carries the demand its check reads' using errcode = '23514'; end if;
      elsif new.params ? 'checkAt' then
        raise exception 'a punishment carries no checkAt' using errcode = '23514';
      end if;
      -- One decision under the character's lock, as a patrol's finding is (start_visit): the one-at-a-time rule and the cap.
      perform pg_advisory_xact_lock(hashtextextended('kayfabb.cap:' || target.id::text, 0));
      if exists (select 1 from open_moves o join acts a on a.id = o.move_act where a.payload ->> 'kind' = 'conferGroup' and lower(a.payload #>> '{params,character}') = target.id::text)
         or exists (select 1 from queued_moves q where q.kind = 'conferGroup' and lower(q.params ->> 'character') = target.id::text and q.landed_act is null and q.held_at is null and q.refused_at is null) then
        raise exception 'that character is already in a group a move put it in' using errcode = '23514';
      end if;
      if grp.tone = 'punishment' then
        cap := mod_cap();
        if staff_punishments(target.id, (cap ->> 'days')::integer) >= (cap ->> 'punishments')::integer then
          raise exception '% has been punished % times in % days, the most staff may', target.name, cap ->> 'punishments', cap ->> 'days' using errcode = '23514';
        end if;
      end if;
    end if;
    if new.admin_description is not null then raise exception 'a queued move is queued without an admin''s replacement' using errcode = '23514'; end if;
    if new.kind = 'setRule' then
      -- A rule ends by its expiry, so none waits on an admin; the board is stored in lowercase, the one form numbering and indexes compare.
      if new.expires_at is null then raise exception 'a rule needs an expiry' using errcode = '23514'; end if;
      if jsonb_typeof(new.params -> 'board') = 'string' then new.params := jsonb_set(new.params, '{board}', to_jsonb(lower(new.params ->> 'board'))); end if;
      -- The board's shape comes before anything casts it: a board that is no uuid is a malformed rule, never an error in a cast.
      if jsonb_typeof(new.params -> 'board') is distinct from 'string' and new.params -> 'board' is not null and new.params -> 'board' <> 'null'::jsonb then
        raise exception 'a rule is malformed: the board is no board of the players' using errcode = '23514';
      end if;
      if jsonb_typeof(new.params -> 'board') = 'string' and (new.params ->> 'board') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'a rule is malformed: the board is no board of the players' using errcode = '23514';
      end if;
      problem := rule_params_problem(new.params);
      if problem is not null then raise exception 'a rule is malformed: %', problem using errcode = '23514'; end if;
      problem := rule_conflict(nullif(new.params ->> 'board', '')::uuid, new.params ->> 'predicate', nullif(new.params -> 'param', 'null'::jsonb));
      if problem is not null then raise exception 'that rule would leave no post that follows the rules: %', problem using errcode = '23514'; end if;
    end if;
    -- A Mod's move names a board of its beat and spends an allowance (0103). The board is the beat_of answer for it, so a board the Boss's order left out is
    -- still some Mod's; the allowance is counted under a lock of the Mod's own, so two moves queued at once cannot spend the one left.
    -- Only the guard says which order a row spends against: a caller's value is never kept.
    new.spent_order := null;
    if holder = 'mod' then
      -- The Mod's own lock comes first: the beat and the allowance are read under it, so two moves queued at once (two sessions, or two rows of one insert,
      -- which are counted because these functions are volatile) cannot spend the one left.
      perform pg_advisory_xact_lock(hashtextextended('kayfabb.allowance.' || new.staff, 0));
      watched := case when (new.params ->> 'board') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (new.params ->> 'board')::uuid end;
      if watched is null then raise exception 'a Mod''s move names the board it watches' using errcode = '23514'; end if;
      if beat_of(watched) is distinct from new.staff then raise exception 'that board is not on %''s beat', new.staff using errcode = '23514'; end if;
      -- A rule a Mod sets lasts at most `modBots.ruleDaysMost` days (7 where the setting is not there yet; setting_modbots holds it a whole number, and it is read as numeric all the same): the Boss's phase bounds the Boss's, and nothing but this bounds a Mod's.
      if new.kind = 'setRule' and new.expires_at > new.go_live_at + coalesce((select (s.value ->> 'ruleDaysMost')::numeric from settings s where s.key = 'modBots'), 7) * interval '1 day' then
        raise exception 'a rule a Mod sets lasts at most % days', coalesce((select (s.value ->> 'ruleDaysMost')::numeric from settings s where s.key = 'modBots'), 7)::numeric(10,0) using errcode = '23514';
      end if;
      if mod_allowance(new.staff) < 1 then raise exception '% has no allowance left; the Boss hands out more at its meeting', new.staff using errcode = '23514'; end if;
      new.spent_order := (select x.id from staff_orders x where x.staff = new.staff order by x.id desc limit 1);
    end if;
  else
    params_ok := new.params is not distinct from old.params
      or (old.kind = 'nameSuccessor' and old.landed_act is null and old.held_at is null
          and new.params - 'boss' = old.params - 'boss' and jsonb_typeof(new.params -> 'boss') = 'string');
    if not params_ok
       or (new.id, new.meeting, new.staff, new.kind, new.demand, new.why, new.go_live_at, new.expires_at, new.structural, new.spent_order, new.cause_act)
          is distinct from (old.id, old.meeting, old.staff, old.kind, old.demand, old.why, old.go_live_at, old.expires_at, old.structural, old.spent_order, old.cause_act) then
      raise exception 'a queued move is only ever held or landed' using errcode = '23514';
    end if;
    -- Who replaced a nomination and when change only with the Boss they replace, and with each other.
    if (new.replaced_by, new.replaced_at) is distinct from (old.replaced_by, old.replaced_at)
       and (new.params is not distinct from old.params or new.replaced_by is null or new.replaced_at is null) then
      raise exception 'a replacement is recorded with the Boss it puts in place' using errcode = '23514';
    end if;
    -- An admin's replacement of a description is for a rename still waiting, and never leaves the row afterward.
    if (new.admin_description, new.described_by, new.described_at) is distinct from (old.admin_description, old.described_by, old.described_at)
       and (old.kind <> 'renameBoard' or old.landed_act is not null or old.held_at is not null or new.admin_description is null) then
      raise exception 'only a rename that is still waiting takes an admin''s description' using errcode = '23514';
    end if;
    -- A refusal at landing is final: set once, on a row still waiting, and never changed or taken back.
    if (new.refused_at, new.failed_at, new.failure) is distinct from (old.refused_at, old.failed_at, old.failure)
       and (old.refused_at is not null or (new.refused_at is not null and (old.landed_act is not null or old.held_at is not null or new.failure is null))) then
      raise exception 'a refused rule stays refused' using errcode = '23514';
    end if;
    if (old.held_at is not null and (new.held_at, new.held_by) is distinct from (old.held_at, old.held_by))
       or (old.landed_act is not null and new.landed_act is distinct from old.landed_act) then
      raise exception 'a queued move that is held or landed stays so' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- ----------------------------------------------------------------------------------------------- the tick ----

-- system_tick (0140), also landing the three lasting board moves, and no longer ending one at the handover's review (a lasting move is not handed on, 0291). Everything else as
-- 0140 wrote it.
create or replace function system_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  enabled boolean := coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'systemEnabled'), false);
  ann uuid := (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements');
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
  season_start timestamptz := (select x.starts_at from seasons x where x.ends_at is null);
  grace interval := make_interval(days => coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'inheritanceGraceDays'), 3));
  first_before uuid;
  was record;
begin
  if not pg_try_advisory_xact_lock(hashtext('kayfabb.system_tick')) then return jsonb_build_object('skipped', true); end if;

  -- 1. Landing: only while The System is on, and only where there is a thread to say it in.
  if enabled and ann is not null then
    for due in
      select q.id, q.staff, q.kind, q.params, q.demand, q.expires_at, q.admin_description from queued_moves q where q.landed_act is null and q.held_at is null and q.refused_at is null and q.go_live_at <= now() order by q.go_live_at, q.id for update skip locked
    loop
      -- A machine move is checked against the machine as it is now, so it waits for the machine's one lock (0141's admin functions take it to take a pack off sale or
      -- reorder), taken here and not inside the block below so that a timeout is not swallowed as a failed move. Without it a Pull landing as an admin took the last pack
      -- holding its card off sale could each miss the other and leave a Pull with no pack on sale. The tick holds only queued_moves rows (and Acts it inserts) when it
      -- waits here, and those functions never lock those rows, so there is no cycle. Taken only when a machine move is about to be checked, and held to the end of
      -- the tick, so the checks below read what the admin committed.
      if due.kind in ('pullSlot', 'repriceSlot', 'flashSale') then perform pg_advisory_xact_lock(hashtext('kayfabb.machine')); end if;
      begin
        -- Two rules that conflict may have waited together; the one that lands second meets the first. It is refused for good, with the reason.
        if due.kind = 'setRule' then
          clash := rule_conflict(nullif(due.params ->> 'board', '')::uuid, due.params ->> 'predicate', nullif(due.params -> 'param', 'null'::jsonb));
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that rule would leave no post that follows the rules: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
        end if;
        -- The machine's moves are checked against the machine as it is now (0140): a slot an admin has since changed, a card no pack on sale can give, a pull too many.
        -- Refused for good with the reason, as a rule is, and never applied: it is no Act, so nothing was put on the machine and nothing needs reversing.
        if due.kind in ('pullSlot', 'repriceSlot', 'flashSale') then
          clash := machine_move_problem(due.kind, due.params, due.demand, (select q.go_live_at from queued_moves q where q.id = due.id), due.expires_at, true);
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that machine move cannot land: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
        end if;
        -- The three moves that build the board are checked against the boards and threads as they are now (0293), as a machine move is against the machine: state changes between
        -- the queue and the landing (a board closed, a thread gone, a merge that would now make a cycle). Refused for good, with the reason; it is no Act, so nothing needs reversing.
        if due.kind in ('createBoard', 'moveThread', 'mergeBoard') then
          clash := lasting_move_problem(due.kind, due.params);
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
        written := (write_staff_act(due.staff, 'move', ann, null,
          jsonb_build_object('kind', due.kind, 'params', due.params, 'body', system_line(case when due.kind = 'setRule' then 'ruleSet' else 'moveLanded' end, due.kind, due.params, due.staff))
          || case when due.demand is not null then jsonb_build_object('demand', due.demand) else '{}'::jsonb end
          || case when due.expires_at is not null then jsonb_build_object('expires_at', due.expires_at) else '{}'::jsonb end) ->> 'id')::uuid;
        update queued_moves set landed_act = written where id = due.id;
        -- The award is the move's whole effect and outlasts it: written in this transaction, naming the move's Act, and the move ends at once (`spent`, as a nomination does). If
        -- either fails, the Act goes with them (this block's rollback) and the move is left due, with the failure recorded below.
        if due.kind = 'awardTrophy' then
          insert into trophy_awards (trophy, character, by, act) values (due.params ->> 'trophy', (due.params ->> 'character')::uuid, 'boss', written);
          perform end_move(written, 'spent', 'award');
        end if;
        if due.kind = 'renameBoard' and due.admin_description is not null then
          perform write_describe((due.params ->> 'board')::uuid, due.admin_description, written);
        end if;
        -- A made board is a row (its slug from its name), pointing at the Act that made it; a moved thread ends the move of the same thread that was in force, as superseded; then the
        -- threads the move touched are rebuilt (lasting_rebuild), so the stored board follows the Acts.
        if due.kind = 'createBoard' then
          insert into boards (slug, name, description, created_by_act) values (board_slug_for(due.params ->> 'name'), due.params ->> 'name', coalesce(due.params ->> 'description', ''), written);
        elsif due.kind = 'moveThread' then
          for was in
            select o.move_act from open_moves o join acts a on a.id = o.move_act
            where a.payload ->> 'kind' = 'moveThread' and lower(a.payload #>> '{params,thread}') = lower(due.params ->> 'thread') and a.id <> written
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
  -- after the handover (or after it landed, if later), ends `superseded`: the new Boss's review never came, or never reached it. A move the
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
        elsif greatest(inforce.landed_at, season_start) + grace <= now() then
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

  return jsonb_build_object('landed', landed, 'met', met, 'expired', expired, 'superseded', superseded, 'unmet', unmet, 'failed', failed, 'checked', checked, 'visits', filed, 'budget', out_of_time,
    'noThread', enabled and ann is null, 'awardsFailed', awards_failed);
end $$;
