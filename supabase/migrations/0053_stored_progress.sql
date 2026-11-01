-- Stored progress (the final review of the system plan, F1). A board view called move_progress, which called the demand evaluator, which
-- reads every post on the board since the move landed: a cost that grows with the board, per viewer, callable by anyone. The tick already
-- paces exactly these reads (demandCheckMinutes, demandChecksPerTick, the budget) because they are costly, so the tick is now the one place
-- that counts, and what it counted is stored on the move's row in open_moves (`progress`, with `checked_at` saying when). Everything that
-- shows a move's way out to a client reads that row:
--
--   move_progress(move_act)  {done, of, met, checkedAt} from the move's open_moves row by primary key, the evaluator never called. A move
--                            in force that the tick has not counted yet answers {checkedAt: null} (the tick counts the unchecked first,
--                            least recently checked first, nulls first). A malformed demand is stored in the evaluator's own error form
--                            ({done: 0, of: 0, met: false, error: <SQLSTATE>}) and read back with its checkedAt. A move that has ended has
--                            no open_moves row: it answers {checkedAt: null}, as one not counted; a board shows only the move in force
--                            (boards_now.move_act), so no screen reads an ended move's count, and the count it ended on is in its move_end
--                            and the log. An Act that is no move still raises, in words. The grants are as before (a visitor and a player).
--   admin_queue()            its in-force group reads the same stored count, so the queue's cost is its page (at most 100 moves) and no
--                            longer 100 evaluations.
--   system_tick()            pass 3 stores the progress it reads, beside checked_at. The reads 0053-tick.sql pins are unchanged, word for word.
--
-- Cost on a busy instance: a board view is one primary-key probe whatever the board holds; the counting is the tick's, bounded by the cap
-- and the budget as before. A count is at most demandCheckMinutes old (plus a tick), and a move that is met ends at the tick that counts it,
-- so the board may show a count that lags the board by minutes, and says when it was counted.
--
-- A response never proves a private fact: the count is characters, posts and public tallies (0046), stored as the tick read it; nothing is
-- computed from who reacted or who owns what at the time of the read, and no read does any work the viewer can time.
--
-- Its way out: derived state, written in place by the tick; a restore or a rebuild_open_moves leaves it null, which only means "not
-- counted yet", and the next tick counts it.

alter table open_moves add column progress jsonb;

-- move_progress (0050), reading the stored count. Owner, grants and search path as 0050 made them; it no longer needs the evaluator. The
-- Act is checked in `acts` itself (a primary-key probe) and not in acts_public, whose lateral join to the Act's edits walks the Acts as a board
-- grows (18 buffers at 2,000 posts, 163 at 20,000, measured by supabase/tests/0058-progress-scale.sql); it answers what acts_public would
-- (that an Act is a move), and a view with no filter shows every Act to anyone.
create or replace function move_progress(move_act uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  stored record;
begin
  if not exists (select 1 from acts a where a.id = move_progress.move_act and a.kind = 'move') then
    raise exception 'that is not a move' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  select o.progress, o.checked_at into stored from open_moves o where o.move_act = move_progress.move_act;
  if stored.progress is null then return jsonb_build_object('checkedAt', null); end if;
  return stored.progress || jsonb_build_object('checkedAt', stored.checked_at);
end $$;
revoke execute on function move_progress(uuid) from public;
grant execute on function move_progress(uuid) to anon, authenticated;

-- admin_queue (0051), its in-force group reading the stored count. Everything else as 0051 wrote it; the owner and grants are kept.
create or replace function admin_queue() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cap constant integer := 100;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  win constant timestamptz := now() - interval '30 days';
  waiting jsonb; waiting_more boolean;
  in_force jsonb; in_force_more boolean;
  ended jsonb; ended_more boolean;
  roster jsonb;
begin
  perform only_admins('reads the queue');

  -- The Bosses that can take a nomination's seat, by the roster's own rule and order (boss_roster): not retired, debuted.
  select coalesce(jsonb_agg(jsonb_build_object('staff', c.staff, 'name', c.name) order by r.ord), '[]'::jsonb) into roster
  from unnest(boss_roster()) with ordinality r(staff, ord) join characters c on c.staff = r.staff;

  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into waiting, waiting_more from (
    select row_number() over (order by q.go_live_at, q.id) as n,
           jsonb_build_object('id', q.id, 'staff', q.staff, 'boss', (select c.name from characters c where c.staff = q.staff), 'kind', q.kind,
             'params', q.params, 'demand', q.demand, 'why', q.why, 'goLiveAt', q.go_live_at, 'expiresAt', q.expires_at, 'structural', q.structural,
             'failedAt', q.failed_at, 'failure', q.failure, 'replacedAt', q.replaced_at,
             'boardName', case when q.kind = 'renameBoard' and lower(q.params ->> 'board') ~ uuid_re
                               then (select b.name from boards_now b where b.id = (q.params ->> 'board')::uuid) end) as j
    from queued_moves q where q.landed_act is null and q.held_at is null
    order by q.go_live_at, q.id limit cap + 1
  ) x;

  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into in_force, in_force_more from (
    select row_number() over (order by a.created_at desc, a.id) as n,
           jsonb_build_object('act', a.id, 'id', q.id, 'staff', c.staff, 'boss', c.name, 'kind', a.payload ->> 'kind', 'params', a.payload -> 'params',
             'demand', a.payload -> 'demand', 'why', q.why, 'landedAt', a.created_at, 'expiresAt', a.payload -> 'expires_at',
             'progress', case when o.progress is null then jsonb_build_object('checkedAt', null)
                              else o.progress || jsonb_build_object('checkedAt', o.checked_at) end) as j
    from open_moves o
    join acts a on a.id = o.move_act
    left join characters c on c.id = a.character
    left join queued_moves q on q.landed_act = a.id
    order by a.created_at desc, a.id limit cap + 1
  ) x;

  -- Ended and held, merged: each side cut at cap + 1 first, so the merge never reads more than 2 * (cap + 1) rows.
  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into ended, ended_more from (
    select row_number() over (order by u.at desc, u.tie) as n, u.j from (
      (select e.created_at as at, e.id::text as tie,
              jsonb_build_object('how', e.payload ->> 'why', 'by', e.payload ->> 'by', 'at', e.created_at, 'act', a.id, 'id', q.id, 'staff', c.staff, 'boss', c.name,
                'kind', a.payload ->> 'kind', 'params', a.payload -> 'params', 'demand', a.payload -> 'demand', 'why', q.why, 'landedAt', a.created_at) as j
       from acts e
       join acts a on a.id = e.target_act_id
       left join characters c on c.id = a.character
       left join queued_moves q on q.landed_act = a.id
       where e.kind = 'move_end' and e.created_at >= win
       order by e.created_at desc, e.id desc limit cap + 1)
      union all
      (select h.held_at, 'q' || h.id::text,
              jsonb_build_object('how', 'held', 'by', 'admin', 'at', h.held_at, 'act', null, 'id', h.id, 'staff', h.staff, 'boss', c.name,
                'kind', h.kind, 'params', h.params, 'demand', h.demand, 'why', h.why, 'landedAt', null)
       from queued_moves h
       left join characters c on c.staff = h.staff
       where h.held_at is not null and h.held_at >= win
       order by h.held_at desc, h.id desc limit cap + 1)
    ) u order by u.at desc, u.tie limit cap + 1
  ) x;

  return jsonb_build_object('cap', cap, 'waiting', waiting, 'inForce', in_force, 'ended', ended, 'roster', roster,
    'more', jsonb_build_object('waiting', waiting_more, 'inForce', in_force_more, 'ended', ended_more));
end $$;

-- system_tick (0051), pass 3 storing the progress it reads. Its variable `progress` is renamed `counted`, the column of that name now being in
-- scope. Everything else as 0051 wrote it; the reads 0053-tick.sql pins are unchanged.
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
  ended_by text;
  counted jsonb;
  expires timestamptz;
  did_end boolean;
  landed integer := 0;
  met integer := 0;
  expired integer := 0;
  failed integer := 0;
  checked integer := 0;
  out_of_time boolean := false;
  superseded integer := 0;
  boss text := current_boss();
  season_start timestamptz := (select x.starts_at from seasons x where x.ends_at is null);
  grace interval := make_interval(days => coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'inheritanceGraceDays'), 3));
begin
  if not pg_try_advisory_xact_lock(hashtext('kayfabb.system_tick')) then return jsonb_build_object('skipped', true); end if;

  -- 1. Landing: only while The System is on, and only where there is a thread to say it in.
  if enabled and ann is not null then
    for due in
      select q.id, q.staff, q.kind, q.params, q.demand, q.expires_at from queued_moves q where q.landed_act is null and q.held_at is null and q.go_live_at <= now() order by q.go_live_at, q.id for update skip locked
    loop
      begin
        written := (write_staff_act(due.staff, 'move', ann, null,
          jsonb_build_object('kind', due.kind, 'params', due.params, 'body', system_line('moveLanded', due.kind, due.params, due.staff))
          || case when due.demand is not null then jsonb_build_object('demand', due.demand) else '{}'::jsonb end
          || case when due.expires_at is not null then jsonb_build_object('expires_at', due.expires_at) else '{}'::jsonb end) ->> 'id')::uuid;
        update queued_moves set landed_act = written where id = due.id;
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
    expires := (inforce.payload ->> 'expires_at')::timestamptz;
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
      from open_moves o join acts a on a.id = o.move_act join move_kinds k on k.key = a.payload ->> 'kind' and (k.shapes_board or k.key = 'nameSuccessor')
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
    select o.move_act, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act where jsonb_typeof(a.payload -> 'demand') = 'object' and (o.checked_at is null or o.checked_at <= now() - check_every) order by o.checked_at nulls first, o.move_act limit cap
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
        if did_end then met := met + 1; end if;
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

  return jsonb_build_object('landed', landed, 'met', met, 'expired', expired, 'superseded', superseded, 'failed', failed, 'checked', checked, 'budget', out_of_time,
    'noThread', enabled and ann is null);
end $$;
