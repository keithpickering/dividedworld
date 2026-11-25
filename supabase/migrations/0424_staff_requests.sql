-- Staff requests (docs/plans/2026-11-24-staff-requests-plan.md; docs/plans/2026-11-24-staff-requests-design.md). The plan numbered this NNNN; 0423 was reserved for another PR when it was built. One migration, in sections, each
-- added by the task that needs it.
--
--   1. A Mod's moveThread (Task 1; design section 2). move_kinds.offices for moveThread becomes boss and mod (an instance seeded earlier keeps the Boss's alone until this runs; seed_instance writes it from the catalog
--      for one seeded after). apply_mod_move (0136) skips the expiry clamp for a lasting kind and queues it with expires_at null (the guard has kept none on a lasting move since 0320). queued_moves_guard (0335) holds a
--      Mod's moveThread to two boards: the thread's board now (thread_place, 0407) and the board it goes to must each be on the Mod's beat (beat_of), and each refusal says which. A Mod's moveThread spends one of its
--      allowance, as any Mod move does. The Boss's moveThread is as it was.
--
--   2. The tables, the writes and the reads (Task 3): staff_requests, staff_request_rulings, apply_boss_move, rule_request, requests_waiting, requests_ruled, staffRequests' validator, and the tick's lapse (see section 2's own header).
--
--   2b. The turn's ruling and its call record (Task 4): staff_call_records takes the duty `ruling`, a staff turn's ruling on a request, keyed by the turn's post (the chatter Edge Function writes it with record_staff_call);
--      and write_staff_turn takes the ruling (a trailing `in_ruling`) and writes it with the post, in the turn's one transaction, so a turn retried or lost between the two cannot lose its ruling.
--
-- Masks. Nothing here reads an owner, a class or a reactor; a board and a thread are public. Ways out. A moveThread is lasting and ends as 0320 wrote it: reversed by an admin, or superseded by a later move of the thread.
-- Cost: one thread_place call for a Mod's moveThread, and none for any other kind.

-- ===================================================================================== 1. A Mod's moveThread ====
-- The catalog says a Mod makes it too (the engine's MOVE_THREAD.offices, a test asserts the two agree).
-- begin: moveThread offices (the suite replays only these lines)
update move_kinds set offices = array['boss', 'mod'] where key = 'moveThread';
-- end: moveThread offices

-- apply_mod_move (0136), a lasting kind taking no expiry. Everything else as 0136 wrote it.
create or replace function apply_mod_move(staff text, move jsonb, cause_act uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  kind text;
  params jsonb;
  hours numeric;
  most numeric := coalesce((select (s.value ->> 'ruleDaysMost')::numeric from settings s where s.key = 'modBots'), 7) * 24;
  least numeric := coalesce((select (s.value #>> '{}')::numeric from settings s where s.key = 'moveExpiryLeastHours'), 24);
  why text;
  ord staff_orders%rowtype;
  existing bigint;
  made bigint;
  trimmed jsonb := '{}'::jsonb;
  lives timestamptz := now();
  demand jsonb;
  lasting boolean;
begin
  if apply_mod_move.cause_act is null or not exists (select 1 from acts a where a.id = apply_mod_move.cause_act) then
    raise exception 'a Mod''s move names the Act that drew it' using errcode = '22023';
  end if;
  -- The Mod's own lock, the one the queue guard takes for the allowance: the check for an earlier move of this cause and the insert are one decision.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.allowance.' || apply_mod_move.staff, 0));
  select q.id into existing from queued_moves q where q.staff = apply_mod_move.staff and q.cause_act = apply_mod_move.cause_act;
  if found then return jsonb_build_object('move', existing, 'queued', false, 'existing', true); end if;

  if jsonb_typeof(move) is distinct from 'object' then return jsonb_build_object('move', null, 'queued', false, 'reason', 'the move is no object'); end if;
  kind := move ->> 'kind';
  params := move -> 'params';
  if kind is null or jsonb_typeof(params) is distinct from 'object' then return jsonb_build_object('move', null, 'queued', false, 'reason', 'the move names its kind and its params'); end if;
  -- The demand is an object or none; the guard says whether this kind may carry this one.
  demand := case when jsonb_typeof(move -> 'demand') = 'object' then move -> 'demand' end;
  why := left(btrim(regexp_replace(coalesce(move ->> 'why', ''), '\s+', ' ', 'g')), 200);
  if why = '' then return jsonb_build_object('move', null, 'queued', false, 'reason', 'the move says why'); end if;
  -- A lasting kind (moveThread, 0320) has no expiry: it skips the clamp and queues with expires_at null, whatever hours it was given.
  lasting := coalesce((select k.lasting from move_kinds k where k.key = kind), false);
  if not lasting then
    if jsonb_typeof(move -> 'expires_in_hours') is distinct from 'number' then return jsonb_build_object('move', null, 'queued', false, 'reason', 'the move says how many hours it lasts'); end if;
    hours := round((move ->> 'expires_in_hours')::numeric);
    if hours > most then
      trimmed := trimmed || jsonb_build_object('expires_in_hours', jsonb_build_object('before', hours, 'after', most));
      hours := most;
    elsif hours < least then
      trimmed := trimmed || jsonb_build_object('expires_in_hours', jsonb_build_object('before', hours, 'after', least));
      hours := least;
    end if;
  end if;
  -- A move does not ride on a filing that never happened: a visit ended any way but filed (talked down, trapped, reversed) draws no move.
  if exists (select 1 from acts e where e.kind = 'visit_end' and e.target_act_id = apply_mod_move.cause_act and e.payload ->> 'outcome' is distinct from 'filed') then
    return jsonb_build_object('move', null, 'queued', false, 'reason', 'that visit ended and was never filed, so it draws no move');
  end if;
  select * into ord from staff_orders o where o.staff = apply_mod_move.staff order by o.id desc limit 1;
  if not found then return jsonb_build_object('move', null, 'queued', false, 'reason', apply_mod_move.staff || ' has had no order from the Boss'); end if;

  begin
    -- The guard decides: the office, the beat, the allowance, the cap and the rule itself. It stamps the order the move spends against.
    insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural, cause_act)
    values (ord.meeting, apply_mod_move.staff, kind, params, demand, why, lives, case when lasting then null else lives + make_interval(hours => hours::integer) end,
            coalesce((select k.structural from move_kinds k where k.key = kind), false), apply_mod_move.cause_act)
    returning id into made;
  exception
    when unique_violation then
      select q.id into existing from queued_moves q where q.staff = apply_mod_move.staff and q.cause_act = apply_mod_move.cause_act;
      return jsonb_build_object('move', existing, 'queued', false, 'existing', true);
    when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or data_exception then
      -- The guard's refusals and a malformed move (a cast, a null, a wrong type) are refusals: the filing it rode in on is not left open to pay for the call again. Anything
      -- else (a lock timeout, a deadlock, a failing trigger, a resource error) is not a verdict on the move, and raises: the visit stays open and the next run tries again.
      return jsonb_build_object('move', null, 'queued', false, 'reason', case when sqlstate in ('23514', '23502') then sqlerrm else 'the move is malformed' end);
  end;
  return jsonb_build_object('move', made, 'queued', true, 'existing', false) || case when trimmed = '{}'::jsonb then '{}'::jsonb else jsonb_build_object('trimmed', trimmed) end;
end $$;

-- queued_moves_guard (0335), a Mod's moveThread held to two boards of its beat. Everything else as 0335 wrote it.
create or replace function queued_moves_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  params_ok boolean;
  problem text;
  holder text;
  watched uuid;
  source uuid;
  target record;
  grp group_kinds%rowtype;
  has_board boolean;
  dkind text;
  check_at timestamptz;
  cap jsonb;
  lasting_param text;
  rk text;
  rn text;
  part queued_moves%rowtype;
  has_role boolean := false;
  depends bigint[] := '{}';
  probe jsonb;
  used text[] := '{}';
  stand uuid;
  made_board uuid;
  maker bigint;
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
    -- A lasting move (0320) has no expiry and carries no demand: the meeting queues it with an expiry of its own length (0 hours), which is nothing, so the guard keeps none.
    if (select k.lasting from move_kinds k where k.key = new.kind) then
      if new.demand is not null then raise exception 'a % has no demand; what it builds stays', new.kind using errcode = '23514'; end if;
      new.expires_at := null;
    end if;
    -- A bundle (0329): parts sharing one id and one name. A part may name another part's result by its role, {"role": r}, where a board goes; the part it names is the bundle's own, made
    -- earlier in the queue, and makes a board. What a move builds on is its `depends_on`, set here and nowhere else: a caller's value is never kept. A later move naming a board a move made
    -- (a real id, outside any bundle) depends on that move's row too, so an admin's hold or reversal of the creation follows it.
    new.depends_on := null;
    if new.bundle is null then
      if new.role is not null or new.bundle_name is not null then raise exception 'a role and a name belong to a part of a bundle, and this move is in none' using errcode = '23514'; end if;
    else
      if new.bundle_name is null or btrim(new.bundle_name) = '' then raise exception 'a bundle has a name' using errcode = '23514'; end if;
      if exists (select 1 from queued_moves p where p.bundle = new.bundle and p.bundle_name <> new.bundle_name) then
        raise exception 'a bundle has one name: this part says "%" and its bundle says otherwise', new.bundle_name using errcode = '23514';
      end if;
    end if;
    if new.kind in ('createBoard', 'moveThread', 'mergeBoard') then
      for rk in select unnest(array['thread', 'board', 'into', 'fallback']) loop
        if jsonb_typeof(new.params -> rk) = 'object' then
          if rk = 'thread' then raise exception 'a role names a board, never a thread' using errcode = '23514'; end if;
          if new.bundle is null then raise exception 'a {"role"} names a part of the same bundle and is admitted only inside a bundle' using errcode = '23514'; end if;
          if jsonb_typeof(new.params #> array[rk, 'role']) is distinct from 'string'
             or (select count(*) from jsonb_object_keys(new.params -> rk)) not in (1, 2)
             or ((select count(*) from jsonb_object_keys(new.params -> rk)) = 2 and jsonb_typeof(new.params #> array[rk, 'beat']) is distinct from 'string') then
            raise exception 'a role is written {"role": name}, or {"role": name, "beat": key} for a board an earlier beat made, and nothing more' using errcode = '23514';
          end if;
          rn := new.params #>> array[rk, 'role'];
          if (new.params -> rk) ? 'beat' then
            -- A board an earlier beat's bundle made (0334): resolved now, from the landed Acts, so it must have landed; the move that made it is what this part builds on.
            made_board := beat_role_board(meeting_season(new.meeting), new.staff, new.params #>> array[rk, 'beat'], rn);
            if made_board is null then
              raise exception 'the role "%" of the beat "%" has made no board yet', rn, new.params #>> array[rk, 'beat'] using errcode = '23514';
            end if;
            maker := (select q.id from queued_moves q join boards b on b.created_by_act = q.landed_act where b.id = made_board);
            depends := depends || coalesce(maker, 0::bigint);
            has_role := true;
          else
            select * into part from queued_moves p where p.bundle = new.bundle and p.role = rn;
            if not found then raise exception 'the role "%" names no part of this bundle made before this one', rn using errcode = '23514'; end if;
            if part.kind <> 'createBoard' then raise exception 'the part with the role "%" makes no board', rn using errcode = '23514'; end if;
            depends := depends || part.id;
            has_role := true;
          end if;
        end if;
      end loop;
      if new.kind = 'mergeBoard' and has_role and new.params -> 'board' = new.params -> 'into' then raise exception 'a board is never merged into itself' using errcode = '23514'; end if;
    elsif exists (select 1 from jsonb_each(new.params) e where jsonb_typeof(e.value) = 'object' and e.value ? 'role') then
      raise exception 'a role is for the moves that build the board, and a % is not one', new.kind using errcode = '23514';
    end if;
    -- The three moves that build the board: one form of the ids for every reader (the indexes on the moves compare lowercase), then what the move names, as it is now.
    if new.kind in ('createBoard', 'moveThread', 'mergeBoard') then
      for lasting_param in select unnest(array['thread', 'board', 'into', 'fallback']) loop
        if jsonb_typeof(new.params -> lasting_param) = 'string' then new.params := jsonb_set(new.params, array[lasting_param], to_jsonb(lower(new.params ->> lasting_param))); end if;
      end loop;
      -- A real id that a move made puts that move among what this one depends on; the names it carries are checked as they are now (a role's board does not exist yet: an open board of
      -- the players stands in for each, a different one each, and the landing checks the real one).
      for lasting_param in select unnest(array['board', 'into', 'fallback']) loop
        if jsonb_typeof(new.params -> lasting_param) = 'string' then
          used := used || (new.params ->> lasting_param);
          depends := depends || coalesce((select q.id from queued_moves q join boards b on b.created_by_act = q.landed_act where b.id = safe_uuid(new.params ->> lasting_param)), 0::bigint);
        end if;
      end loop;
      depends := array_remove(depends, 0::bigint);
      probe := new.params;
      if has_role then
        for rk in select k from jsonb_object_keys(new.params) k where jsonb_typeof(new.params -> k) = 'object' loop
          stand := (select b.id from boards b where not b.is_system and board_is_open(b.id) and not (b.id::text = any (used)) order by b.created_at, b.id limit 1);
          if stand is null then probe := null; exit; end if;
          used := used || stand::text;
          probe := jsonb_set(probe, array[rk], to_jsonb(stand::text));
        end loop;
      end if;
      if probe is not null then problem := lasting_move_problem(new.kind, probe); end if;
      if problem is not null then raise exception 'a % is refused: %', new.kind, problem using errcode = '23514'; end if;
      if cardinality(depends) > 0 then new.depends_on := (select array_agg(distinct x order by x) from unnest(depends) x); end if;
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
    -- A Mod's move names a board of its beat and spends an allowance (0103); a Mod's moveThread names two, the thread's and its destination. The board is the beat_of answer for it, so a board the Boss's order left out is
    -- still some Mod's; the allowance is counted under a lock of the Mod's own, so two moves queued at once cannot spend the one left.
    -- Only the guard says which order a row spends against: a caller's value is never kept.
    new.spent_order := null;
    if holder = 'mod' then
      -- The Mod's own lock comes first: the beat and the allowance are read under it, so two moves queued at once (two sessions, or two rows of one insert,
      -- which are counted because these functions are volatile) cannot spend the one left.
      perform pg_advisory_xact_lock(hashtextextended('kayfabb.allowance.' || new.staff, 0));
      watched := case when (new.params ->> 'board') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (new.params ->> 'board')::uuid end;
      if watched is null then raise exception 'a Mod''s move names the board it watches' using errcode = '23514'; end if;
      if new.kind = 'moveThread' then
        -- A Mod moves a thread between boards of its beat: the thread's board now and the board it goes to are each on it, and each refusal names which.
        source := thread_place(safe_uuid(new.params ->> 'thread'));
        if source is null or beat_of(source) is distinct from new.staff then raise exception 'the thread is on a board that is not on %''s beat', new.staff using errcode = '23514'; end if;
        if beat_of(watched) is distinct from new.staff then raise exception 'the board it goes to is not on %''s beat', new.staff using errcode = '23514'; end if;
        if watched = source then raise exception 'the thread is already on that board' using errcode = '23514'; end if;
      elsif beat_of(watched) is distinct from new.staff then raise exception 'that board is not on %''s beat', new.staff using errcode = '23514';
      end if;
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
       or (new.id, new.meeting, new.staff, new.kind, new.demand, new.why, new.go_live_at, new.expires_at, new.structural, new.spent_order, new.cause_act, new.bundle, new.bundle_name, new.role, new.depends_on)
          is distinct from (old.id, old.meeting, old.staff, old.kind, old.demand, old.why, old.go_live_at, old.expires_at, old.structural, old.spent_order, old.cause_act, old.bundle, old.bundle_name, old.role, old.depends_on) then
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

-- ===================================================================================== 2. The tables, the writes and the reads ====
-- Task 3 of the plan (docs/plans/2026-11-24-staff-requests-plan.md; design sections 2 to 5).
--
--   tables      staff_requests (a persona's first ruling on a request: fulfill, reject or confer) and staff_request_rulings (the one later ruling a waiting request gets: a meeting's, or a lapse): both append-only by
--               staff_rows_append_only (0415) firing always, RLS on and no client's grant. A request is ruled once (unique (request)), and a row for a request that is not a confer is refused. Beside them is the QUEUE,
--               staff_requests_open (request, at, failed_at, attempts): one row for each request that waits, and nothing else. It is not a record (the records are the two tables above, which stay as they are written):
--               a trigger on staff_requests puts a confer in it, and a trigger on staff_request_rulings takes the request out in the same transaction, so a request waits exactly while it is in the queue. That is
--               what keeps a read of what waits to the waiting set, however many requests have been ruled since the game began: no index over the records could, since a ruled confer keeps its ruling in staff_requests.
--               RLS on, no client's grant; the instance's export carries it as it carries every table, and an import's replica write carries its rows as they were.
--               staff_requests_now reads each request's latest ruling and, while it waits, when it lapses (`at` + staffRequests.daysMost days, staff_request_days()).
--   functions   apply_boss_move (the Boss's side of apply_mod_move: the Boss's bank pays), rule_request (the turn's ruling: one transaction, idempotent on (staff, request post)), requests_waiting (the meeting's read of
--               what waits), requests_ruled (what apply_meeting calls for the meeting's answers; Task 5), setting_staffrequests, and settings_held (0416) and system_tick (0403) re-created.
--   The bank. A turn's fulfill and a meeting both spend the Boss's bank, and apply_meeting writes the balance it read at its start. apply_boss_move therefore takes the lock a meeting takes (`kayfabb.meeting.<id>`, for each
--   meeting still open) and then the Boss's own bank lock (`kayfabb.bank.<boss>`), and reads bank_now under both: a turn and a meeting at one minute are one after the other, and the second reads what the first left. Task 5's
--   apply_meeting takes `kayfabb.bank.<boss>` right after its own meeting lock, so a meeting begun after a turn read its meetings is held too.
--   Masks. Nothing here reads who owns a character, a class or who reacted. A request's asker is read for its public name through acts_public, so a veiled author shows as the anonymous character; the staff's own state
--   (office, bank, allowance, beat) and the boards decide every ruling and refusal, never an owner: a confer, a refusal and when they happen are the same whoever is behind a request.
--   Ways out. A waiting request lapses by itself at lapses_at (the tick), or when its post is hidden at the next tick, or is ruled at a meeting. Nothing else is added.
--   Cost. requests_waiting is one statement driven by the queue's oldest rows, each joined by key to its public post, thread, board and names, stopping at `most` shown (a row whose post is not public, which the tick lapses, is passed at one tuple); requests_waiting_total counts the queue the same way, for the digest's "N more wait"; the tick's pass reads the queue, one public post
--   per waiting request, which the days a request waits (daysMost) bound, `cap` of them at most, and a row that failed or was held by a meeting goes behind the rest (failed_at), so one row cannot hold a slot for good;
--   rule_request and apply_boss_move are one request's reads and writes. Nothing here grows with the requests ruled in the past.
--   The digest. requests_waiting is owned by kayfabb_digest (0045), which Task 5's system_digest calls it from: it reads public relations only (acts_public, characters_public, thread_list, boards_now), the queue, and
--   the columns of staff_requests that are public (id, request_act, thread, staff, turn_act, at; never `asker`, which is a post's real author even where it is veiled), each by a policy and a grant of its own.

create table staff_requests (
  id bigint generated always as identity primary key,
  request_act uuid not null references acts (id),
  thread uuid not null references threads (id),
  asker uuid not null references characters (id),
  staff text not null references characters (staff),
  turn_act uuid not null references acts (id),
  ruling text not null check (ruling in ('fulfill', 'reject', 'confer')),
  move bigint references queued_moves (id),
  at timestamptz not null default now(),
  -- A fulfill names its move, and nothing else does.
  check ((ruling = 'fulfill') = (move is not null)),
  unique (staff, request_act)
);

create table staff_request_rulings (
  id bigint generated always as identity primary key,
  request bigint not null unique references staff_requests (id),
  ruling text not null check (ruling in ('fulfill', 'reject', 'lapsed')),
  move bigint references queued_moves (id),
  meeting bigint references meetings (id),
  post_act uuid references acts (id),
  -- Why a meeting's fulfill was a reject (the bank could not pay, the guard refused it): the code's own words, never a model's.
  reason text check (reason is null or char_length(reason) <= 500),
  at timestamptz not null default now(),
  check ((ruling = 'fulfill') = (move is not null))
);

-- A later ruling is for a request that waits: its first ruling was a confer.
create function staff_request_rulings_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from staff_requests q where q.id = new.request and q.ruling = 'confer') then
    raise exception 'a request is ruled on later only if its first ruling was to confer' using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function staff_request_rulings_guard() from public, anon, authenticated;
create trigger staff_request_rulings_guard before insert on staff_request_rulings for each row execute function staff_request_rulings_guard();

-- The queue of requests that wait. A row is never a ruling and never a record of one: it says only that the request waits, and goes when the request is ruled. `failed_at` and `attempts` are the tick's own, as
-- visits_open's are: a row the tick could not lapse (a failure, or a meeting holding it) goes behind the others by its last failure, so it never holds a slot of the pass for good.
create table staff_requests_open (
  request bigint primary key references staff_requests (id),
  at timestamptz not null,
  failed_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0)
);
-- The meeting's read (oldest first) and the tick's (failures last, then oldest first).
create index staff_requests_open_at on staff_requests_open (at, request);
create index staff_requests_open_tick on staff_requests_open (failed_at nulls first, at, request);

-- A confer waits: it joins the queue in the transaction that wrote it, whoever wrote it. A request that is ruled is taken out in the transaction that rules it. (An import writes both tables as a replica, which fires no
-- trigger, and carries the queue's rows as they were.)
create function staff_requests_enqueue() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.ruling = 'confer' then insert into staff_requests_open (request, at) values (new.id, new.at); end if;
  return null;
end $$;
revoke execute on function staff_requests_enqueue() from public, anon, authenticated;
create trigger staff_requests_enqueue after insert on staff_requests for each row execute function staff_requests_enqueue();

create function staff_requests_dequeue() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from staff_requests_open where request = new.request;
  return null;
end $$;
revoke execute on function staff_requests_dequeue() from public, anon, authenticated;
create trigger staff_requests_dequeue after insert on staff_request_rulings for each row execute function staff_requests_dequeue();

do $$
declare t text;
begin
  foreach t in array array['staff_requests', 'staff_request_rulings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from public, anon, authenticated', t);
    execute format('create trigger %I before update or delete on %I for each row execute function staff_rows_append_only()', t || '_no_update', t);
    execute format('create trigger %I before truncate on %I for each statement execute function staff_rows_append_only()', t || '_no_truncate', t);
    execute format('alter table %I enable always trigger %I', t, t || '_no_update');
    execute format('alter table %I enable always trigger %I', t, t || '_no_truncate');
  end loop;
end $$;
alter table staff_requests_open enable row level security;
revoke all on staff_requests_open from public, anon, authenticated;

-- The digest role reads what the digest may: the queue, and the public columns of staff_requests (not the asker, a veiled post's real author, nor the move).
grant select on staff_requests_open to kayfabb_digest;
create policy digest_reads on staff_requests_open for select to kayfabb_digest using (true);
grant select (id, request_act, thread, staff, turn_act, at) on staff_requests to kayfabb_digest;
create policy digest_reads on staff_requests for select to kayfabb_digest using (true);

-- How many days a request waits for a ruling (staffRequests.daysMost; 3 where the setting is not there yet).
create function staff_request_days() returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (s.value ->> 'daysMost')::integer from settings s where s.key = 'staffRequests'), 3)
$$;
revoke execute on function staff_request_days() from public, anon, authenticated;
grant execute on function staff_request_days() to kayfabb_digest;

-- Each request with its latest ruling and, while it waits (it is in the queue), when it lapses (daysMost is staffRequests.daysMost, 3 where the setting is not there yet). No client reads it: the log's reads (Task 7) are functions of their own.
create view staff_requests_now as
  select q.id, q.request_act, q.thread, q.asker, q.staff, q.turn_act, q.at, q.ruling as first_ruling,
         coalesce(g.ruling, q.ruling) as ruling, coalesce(g.move, q.move) as move, g.meeting, g.post_act, g.reason, g.at as ruled_at,
         (o.request is not null) as waiting,
         case when o.request is not null then q.at + make_interval(days => staff_request_days()) end as lapses_at
  from staff_requests q left join staff_request_rulings g on g.request = q.id left join staff_requests_open o on o.request = q.id;
revoke all on staff_requests_now from public, anon, authenticated;

-- ---- the Boss's move ----

-- The queue's side of a Boss's move, shared by a turn's fulfill (apply_boss_move) and a meeting's (requests_ruled): the checks the meeting makes of each of the Boss's moves (a kind held back, a rule, a machine move or a lasting
-- board move the queue would never land) as refusals with their words, then the insert, which the guard decides the rest of. It takes no lock and spends nothing: whoever calls it holds the bank. A structural kind goes
-- live structuralHoldHours out, to wait for admins; a lasting kind is queued with no expiry, and any other with the hours it was given (the engine's repair has clamped them to the phase, as it does a meeting's).
-- A refusal is a reason and no row; a raise is a failure of the database and not a verdict on the move. A moveThread to the board its thread is on now is refused ("the thread is already on that board"), as a Mod's is
-- (queued_moves_guard): it would change nothing and spend a move to do it. `in_season` is the season whose arc holds kinds back (held_back_kinds); a meeting's own is its slot's (meeting_season), which a turn does not have.
create function boss_move_queue(staff text, move jsonb, cause_act uuid, in_meeting bigint, in_season bigint default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  kind text;
  params jsonb;
  demand jsonb;
  why text;
  hours numeric;
  hold interval := ((setting('structuralHoldHours')) #>> '{}')::numeric * interval '1 hour';
  kind_row move_kinds%rowtype;
  season_id bigint := coalesce(boss_move_queue.in_season, meeting_season(boss_move_queue.in_meeting), (select x.id from seasons x where x.ends_at is null));
  problem text;
  lives timestamptz := now();
  check_at timestamptz;
  existing bigint;
  made bigint;
begin
  if jsonb_typeof(move) is distinct from 'object' then return jsonb_build_object('move', null, 'queued', false, 'reason', 'the move is no object'); end if;
  kind := move ->> 'kind';
  params := move -> 'params';
  if kind is null or jsonb_typeof(params) is distinct from 'object' then return jsonb_build_object('move', null, 'queued', false, 'reason', 'the move names its kind and its params'); end if;
  demand := case when jsonb_typeof(move -> 'demand') = 'object' then move -> 'demand' end;
  why := left(btrim(regexp_replace(coalesce(move ->> 'why', ''), '\s+', ' ', 'g')), 200);
  if why = '' then return jsonb_build_object('move', null, 'queued', false, 'reason', 'the move says why'); end if;
  select * into kind_row from move_kinds k where k.key = kind;
  if not found then return jsonb_build_object('move', null, 'queued', false, 'reason', 'there is no move kind "' || left(kind, 60) || '"'); end if;
  if kind = any (held_back_kinds(boss_move_queue.staff, season_id)) then
    return jsonb_build_object('move', null, 'queued', false, 'reason', 'the Boss does not use ' || kind || ' yet');
  end if;
  begin
    if kind = 'setRule' then
      problem := rule_params_problem(params);
      if problem is null then problem := rule_conflict(nullif(params ->> 'board', '')::uuid, params ->> 'predicate', nullif(params -> 'param', 'null'::jsonb)); end if;
    elsif kind in ('pullSlot', 'repriceSlot', 'flashSale') then
      problem := machine_move_problem(kind,
        case when jsonb_typeof(params -> 'slot') = 'string' then jsonb_set(params, '{slot}', to_jsonb(lower(params ->> 'slot'))) else params end,
        demand, lives, case when jsonb_typeof(move -> 'expires_in_hours') = 'number' then lives + (move ->> 'expires_in_hours')::numeric * interval '1 hour' end, false);
    elsif kind in ('createBoard', 'moveThread', 'mergeBoard') then
      problem := case when demand is not null then 'a lasting move carries no demand' else lasting_move_problem(kind, params) end;
      if problem is null and kind = 'moveThread' and thread_place(safe_uuid(params ->> 'thread')) = safe_uuid(params ->> 'board') then problem := 'the thread is already on that board'; end if;
    end if;
    if problem is null and demand is not null then
      if not exists (select 1 from demand_kinds d where d.key = demand ->> 'kind') then problem := 'there is no such demand kind';
      else problem := demand_params_problem(demand); end if;
    end if;
  exception when others then
    problem := 'the move is malformed';
  end;
  if problem is not null then return jsonb_build_object('move', null, 'queued', false, 'reason', problem); end if;
  if kind_row.structural then
    if hold is null then return jsonb_build_object('move', null, 'queued', false, 'reason', 'this instance sets no structuralHoldHours'); end if;
    lives := lives + hold;
  end if;
  if not kind_row.lasting then
    if jsonb_typeof(move -> 'expires_in_hours') is distinct from 'number' then return jsonb_build_object('move', null, 'queued', false, 'reason', 'the move says how many hours it lasts'); end if;
    hours := (move ->> 'expires_in_hours')::numeric;
  end if;
  -- A favor's check must fall between its go-live and its expiry as the queue lands them (as apply_meeting moves one that does not).
  if kind = 'conferGroup' and params #> '{checkAt}' is not null and hours is not null then
    begin
      check_at := (params ->> 'checkAt')::timestamptz;
    exception when others then
      check_at := null;
    end;
    if check_at is null or check_at <= lives or check_at >= lives + hours * interval '1 hour' then
      params := jsonb_set(params, '{checkAt}', to_jsonb(to_char((lives + hours * interval '30 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
    end if;
  end if;
  begin
    insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural, cause_act)
    values (boss_move_queue.in_meeting, boss_move_queue.staff, kind, params, demand, why, lives,
            case when kind_row.lasting then null else lives + hours * interval '1 hour' end, kind_row.structural, boss_move_queue.cause_act)
    returning id into made;
  exception
    when unique_violation then
      select q.id into existing from queued_moves q where q.staff = boss_move_queue.staff and q.cause_act = boss_move_queue.cause_act;
      return jsonb_build_object('move', existing, 'queued', false, 'existing', true);
    when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or data_exception then
      return jsonb_build_object('move', null, 'queued', false, 'reason', case when sqlstate in ('23514', '23502') then sqlerrm else 'the move is malformed' end);
  end;
  return jsonb_build_object('move', made, 'queued', true, 'existing', false);
end $$;
revoke execute on function boss_move_queue(text, jsonb, uuid, bigint, bigint) from public, anon, authenticated;

-- apply_boss_move: apply_mod_move for the Boss (0136, as section 1 re-created it). The Boss pays from its bank: one move, taken in the transaction that queues it. Idempotent on (staff, cause_act), as a Mod's is, so a
-- retried turn never spends twice. `weekly_moves` and `bank_cap` are the phase's numbers, which only the engine computes (phaseAt, with the Boss's own overrides), as the meeting passes them to bank_now.
-- The move is filed under the latest meeting that has finished (queued_moves.meeting is not null; apply_mod_move files a Mod's under its order's), but the kinds the Boss holds back are those of the season it is now (the
-- season that covers this instant, as the newest one if two do), which a meeting held at the end of the one before would not see: a beat unlocked since then lets its kind through, and one this season has not unlocked holds it back.
-- The locks, in the meeting's order: every meeting still open (the lock apply_meeting takes first), then the Boss's bank lock; bank_now is read under both.
create function apply_boss_move(staff text, move jsonb, cause_act uuid, weekly_moves numeric, bank_cap numeric) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  open_meeting record;
  existing bigint;
  bal numeric;
  filed bigint;
  season_now bigint;
  made jsonb;
begin
  if apply_boss_move.cause_act is null or not exists (select 1 from acts a where a.id = apply_boss_move.cause_act) then
    raise exception 'a Boss''s move names the Act that drew it' using errcode = '22023';
  end if;
  if apply_boss_move.weekly_moves is null or apply_boss_move.bank_cap is null then
    raise exception 'a Boss''s move names the phase''s weekly_moves and bank_cap' using errcode = '22023';
  end if;
  for open_meeting in select x.id from meetings x where x.finished_at is null order by x.id loop
    perform pg_advisory_xact_lock(hashtextextended('kayfabb.meeting.' || open_meeting.id, 0));
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.bank.' || apply_boss_move.staff, 0));
  select q.id into existing from queued_moves q where q.staff = apply_boss_move.staff and q.cause_act = apply_boss_move.cause_act;
  if found then return jsonb_build_object('move', existing, 'queued', false, 'existing', true); end if;
  if (select o.office from staff_office_now o where o.staff = apply_boss_move.staff) is distinct from 'boss' then
    return jsonb_build_object('move', null, 'queued', false, 'reason', apply_boss_move.staff || ' is not the Boss');
  end if;
  bal := bank_now(apply_boss_move.staff, apply_boss_move.weekly_moves, apply_boss_move.bank_cap);
  if bal < 1 then return jsonb_build_object('move', null, 'queued', false, 'reason', 'the Boss has no move left to spend'); end if;
  select x.id into filed from meetings x where x.finished_at is not null order by x.id desc limit 1;
  if filed is null then return jsonb_build_object('move', null, 'queued', false, 'reason', 'no meeting has been held'); end if;
  select s.id into season_now from seasons s where s.starts_at <= now() and (s.ends_at is null or s.ends_at > now()) order by s.starts_at desc limit 1;
  made := boss_move_queue(apply_boss_move.staff, apply_boss_move.move, apply_boss_move.cause_act, filed, season_now);
  if (made ->> 'queued')::boolean then
    insert into move_bank (staff, balance, as_of) values (apply_boss_move.staff, bal - 1, now())
    on conflict on constraint move_bank_pkey do update set balance = excluded.balance, as_of = excluded.as_of;
  end if;
  return made;
end $$;
revoke execute on function apply_boss_move(text, jsonb, uuid, numeric, numeric) from public, anon, authenticated;
grant execute on function apply_boss_move(text, jsonb, uuid, numeric, numeric) to service_role;

-- ---- the turn's ruling ----

-- rule_request: a staff turn's ruling on a request, in one transaction. The request post is a reply in the turn's thread and the turn is the persona's own post; the persona is the Boss or a Mod. A fulfill is made by the
-- persona's office (apply_mod_move, or apply_boss_move with the phase's numbers, which a Boss's fulfill must pass) with the request post as the move's cause; a fulfill whose move is refused is written as a confer, with the
-- refusal's reason returned. Idempotent on (staff, request post): a second call returns the first row as it was written. Nothing here reads the asker's owner or the thread's: a refusal is the persona's state and the boards.
-- Returns {request, ruling, move, existing} and, when a fulfill became a confer, {asked: 'fulfill', reason}.
create function rule_request(staff_key text, request_act uuid, turn_act uuid, ruling text, move jsonb, weekly_moves numeric default null, bank_cap numeric default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  office text;
  req record;
  turn record;
  prior staff_requests%rowtype;
  result jsonb;
  final text := rule_request.ruling;
  why text;
  made bigint;
  written bigint;
begin
  if rule_request.ruling is null or rule_request.ruling not in ('fulfill', 'reject', 'confer') then
    raise exception 'a request is ruled fulfill, reject or confer' using errcode = '22023';
  end if;
  select c.id into who from characters c where c.staff = rule_request.staff_key;
  if not found then raise exception 'there is no staff member "%"', rule_request.staff_key using errcode = '22023'; end if;
  select o.office into office from staff_office_now o where o.staff = rule_request.staff_key;
  if office is null or office not in ('boss', 'mod') then raise exception 'only the Boss and a Mod Bot rule on a request' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.request-ask.' || rule_request.staff_key || '.' || rule_request.request_act::text, 0));
  select * into prior from staff_requests q where q.staff = rule_request.staff_key and q.request_act = rule_request.request_act;
  if found then return jsonb_build_object('request', prior.id, 'ruling', prior.ruling, 'move', prior.move, 'existing', true); end if;
  select a.thread, a.kind, a.target_act_id, a.character into req from acts a where a.id = rule_request.request_act;
  if not found or req.kind <> 'post' or req.target_act_id is null or req.thread is null then raise exception 'a request is a reply' using errcode = '22023'; end if;
  select a.thread, a.kind, a.character into turn from acts a where a.id = rule_request.turn_act;
  if not found or turn.kind <> 'post' or turn.character is distinct from who then raise exception 'the turn is the persona''s own post' using errcode = '22023'; end if;
  if turn.thread is distinct from req.thread then raise exception 'the request and the turn are in one thread' using errcode = '22023'; end if;
  if req.character = who then raise exception 'a persona does not rule on its own post' using errcode = '22023'; end if;

  if rule_request.ruling = 'fulfill' then
    if office = 'boss' then
      result := apply_boss_move(rule_request.staff_key, rule_request.move, rule_request.request_act, rule_request.weekly_moves, rule_request.bank_cap);
    else
      result := apply_mod_move(rule_request.staff_key, rule_request.move, rule_request.request_act);
    end if;
    if (result ->> 'queued')::boolean or (result ->> 'existing')::boolean then
      made := (result ->> 'move')::bigint;
    else
      final := 'confer';
      why := coalesce(result ->> 'reason', 'the move was not made');
    end if;
  end if;
  insert into staff_requests (request_act, thread, asker, staff, turn_act, ruling, move)
  values (rule_request.request_act, req.thread, req.character, rule_request.staff_key, rule_request.turn_act, final, made) returning id into written;
  return jsonb_build_object('request', written, 'ruling', final, 'move', made, 'existing', false)
    || case when why is not null then jsonb_build_object('asked', 'fulfill', 'reason', why) else '{}'::jsonb end;
end $$;
revoke execute on function rule_request(text, uuid, uuid, text, jsonb, numeric, numeric) from public, anon, authenticated;
grant execute on function rule_request(text, uuid, uuid, text, jsonb, numeric, numeric) to service_role;

-- ---- the meeting's reads and rulings ----

-- requests_waiting: the waiting requests, oldest conferral first, at most `most` (none for a null or less than 1; never more than 500), each with its id, thread, title, board's name, the asker's public name (as the post
-- shows its author, so a veiled one is the anonymous character), the conferring staff's key and name, the request post and its current public body, whole (as pool_read reads a post: acts_public's current payload, a
-- hidden one not read at all). A request whose post is not public is left out, and the tick lapses it. [{id, requestAct, thread, title, board, boardName, askerName, staff, staffName, body, at, lapsesAt}]
-- Read from the queue (staff_requests_open), which holds the requests that wait and no other, so the read is as long as the waiting set and never as long as the requests ruled before it. Owned by kayfabb_digest, since
-- the digest calls it: it reads public relations only, and the name of the persona that conferred is the name of the author of its turn's post (acts_public, characters_public), never a read of `characters`.
create function requests_waiting(most integer) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cap integer := least(greatest(coalesce(requests_waiting.most, 0), 0), 500);
  days integer := staff_request_days();
  out jsonb;
begin
  if cap = 0 then return '[]'::jsonb; end if;
  -- One statement: the queue in order drives it, each row's request, its public post and author, its thread, board and conferring persona are joined by key, and a row whose post is not public is not a row, so `limit` stops
  -- the scan at the `cap`th request that is shown (it reads the queue's rows up to there, and a hidden one it passes is one tuple, never a lookup of its thread or names).
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'requestAct', w.request_act, 'thread', w.thread, 'title', coalesce(w.title, ''), 'board', w.board, 'boardName', coalesce(w.board_name, ''),
      'askerName', w.asker_name, 'staff', w.staff, 'staffName', coalesce(w.staff_name, ''), 'body', w.body, 'at', w.at, 'lapsesAt', w.at + make_interval(days => days)) order by w.at, w.id), '[]'::jsonb)
  into out
  from (
    select q.id, q.request_act, q.thread, q.staff, o.at, t.title, t.board, b.name as board_name, k.name as asker_name, coalesce(a.current_payload ->> 'body', '') as body, tk.name as staff_name
    from staff_requests_open o
    join staff_requests q on q.id = o.request
    join acts_public a on a.id = q.request_act and a.hidden is not true
    join characters_public k on k.id = a.character
    left join thread_list t on t.id = q.thread
    left join boards_now b on b.id = t.board
    left join acts_public ta on ta.id = q.turn_act
    left join characters_public tk on tk.id = ta.character
    order by o.at, o.request
    limit cap
  ) w;
  return out;
end $$;
grant create on schema public to kayfabb_digest;
alter function requests_waiting(integer) owner to kayfabb_digest;
revoke create on schema public from kayfabb_digest;
revoke execute on function requests_waiting(integer) from public, anon, authenticated;
grant execute on function requests_waiting(integer) to service_role, kayfabb_digest;

-- requests_waiting_total: how many requests wait in all (the queue's rows whose post is public, as requests_waiting lists them), so the digest can say how many more wait than it holds. Read from the queue, which holds the
-- requests that wait and no other, so it is as long as the waiting set; owned by the digest role as requests_waiting is.
create function requests_waiting_total() returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::integer from staff_requests_open o
  join staff_requests q on q.id = o.request
  join acts_public a on a.id = q.request_act and a.hidden is not true
$$;
grant create on schema public to kayfabb_digest;
alter function requests_waiting_total() owner to kayfabb_digest;
revoke create on schema public from kayfabb_digest;
revoke execute on function requests_waiting_total() from public, anon, authenticated;
grant execute on function requests_waiting_total() to service_role, kayfabb_digest;

-- boss_request_reply: the Boss's reply to a request post, in its thread as a post quoting it (write_staff_act), shared by the meeting's rulings (requests_ruled) and the tick's lapse. `own_line` is the Boss's own words, used
-- as they are; with none, the stock line `stock` of settings systemLines, one of the key's lines chosen at random, with {boss} and {asker} (the asker as the request post's public author shows, so a veiled one is the anonymous
-- name) and the Boss's pronouns filled. Returns the post's id, or null where there is nothing to say (no line and no stock line); a post that cannot be written raises, and the caller says what happens then (a subtransaction
-- of its own, so the writes of a failed reply are undone).
create function boss_request_reply(boss text, in_thread uuid, request_act uuid, stock text, own_line text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lines jsonb;
  body text := nullif(btrim(coalesce(own_line, ''), E' \t\n\r\f\v'), '');
  boss_name text;
  boss_id uuid;
  asker text;
begin
  if body is null then
    lines := (select s.value -> boss_request_reply.stock from settings s where s.key = 'systemLines');
    if jsonb_typeof(lines) is distinct from 'array' or jsonb_array_length(lines) = 0 or jsonb_typeof(lines -> 0) is distinct from 'string' then return null; end if;
    select c.name, c.id into boss_name, boss_id from characters c where c.staff = boss_request_reply.boss;
    select k.name into asker from acts_public a join characters_public k on k.id = a.character where a.id = boss_request_reply.request_act;
    body := fill_tokens(lines ->> floor(random() * jsonb_array_length(lines))::integer,
      jsonb_build_object('boss', coalesce(boss_name, ''), 'asker', coalesce(asker, '')) || pronoun_tokens('boss', boss_id));
  end if;
  return (write_staff_act(boss_request_reply.boss, 'post', in_thread, boss_request_reply.request_act, jsonb_build_object('body', body)) ->> 'id')::uuid;
end $$;
revoke execute on function boss_request_reply(text, uuid, uuid, text, text) from public, anon, authenticated;

-- requests_ruled: what apply_meeting (Task 5) calls, inside its transaction and holding its locks, for the meeting's `requests` answers [{id, ruling: fulfill | reject, move?, line?}], `id` being staff_requests.id as
-- requests_waiting gives it. Answers are read in order, at most staffRequests.meetingMost of them (the rest are skipped), each at most once: an answer for a request that is not waiting, whose post is not public, or
-- whose ruling is neither word is skipped with its reason. A fulfill's move is queued as the Boss's others are (boss_move_queue, filed under `in_meeting`, a structural one held for admins) while `room` moves remain
-- in the bank (what the meeting still has to spend after its own moves); one the bank cannot pay, or the queue refuses, is a reject with the reason recorded (staff_request_rulings.reason). The meeting charges `spent`
-- to its bank itself: it writes the balance at its end, so this never touches move_bank. Each ruling is one row, and the Boss's reply is written with it, in this transaction, before the row (boss_request_reply): in the thread
-- as a post quoting the request post, in the Boss's own line (trimmed, cut to postMaxLength) or, where it gave none, the stock line requestGranted or requestRefused (a line written for a grant that becomes a reject is not posted: the stock refusal stands); the row names it (post_act). The reply is written in a
-- subtransaction: one that cannot be written (the Boss locked out of the thread, say) leaves the ruling, with no post_act and the reason on the row (`reason`, after the reason for a reject, if any), and is returned as
-- `replyFailed`, so the ruling is never lost to its reply and the reply is never lost to a process that died after the commit. A rolled-back meeting leaves neither; a retried one is not run twice.
-- Returns {spent, rulings: [{id, requestAct, thread, staff, ruling, move, reason, postAct, replyFailed}], skipped: [{id, why}]}.
-- A wait. Each answer's key (`kayfabb.request.<id>`) is taken blocking, so it may wait for the tick's transaction while that pass holds the key of a request it is lapsing (it commits with the tick, which is bounded by
-- the budget). It is no cycle: the tick only try-locks that key and never waits on a meeting, and a meeting holds the keys in the order of its answers and takes nothing the tick holds after them.
create function requests_ruled(in_meeting bigint, answers jsonb, room integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  most integer := coalesce((select (s.value ->> 'meetingMost')::integer from settings s where s.key = 'staffRequests'), 10);
  boss text := current_boss();
  post_most integer := (select (s.value #>> '{}')::integer from settings s where s.key = 'postMaxLength');
  left_room integer := greatest(coalesce(requests_ruled.room, 0), 0);
  ans jsonb;
  n integer := 0;
  rid bigint;
  rq staff_requests%rowtype;
  decided text;
  line text;
  result jsonb;
  made bigint;
  why text;
  said uuid;
  unsaid text;
  spent integer := 0;
  out jsonb := '[]';
  skipped jsonb := '[]';
begin
  if not exists (select 1 from meetings x where x.id = requests_ruled.in_meeting) then
    raise exception 'there is no meeting %', requests_ruled.in_meeting using errcode = '22023';
  end if;
  if jsonb_typeof(answers) is distinct from 'array' then
    return jsonb_build_object('spent', 0, 'rulings', out, 'skipped', skipped);
  end if;
  if boss is null then raise exception 'there is no Boss to rule on a request' using errcode = '22023'; end if;
  for ans in select value from jsonb_array_elements(answers) loop
    n := n + 1;
    rid := case when jsonb_typeof(ans) = 'object' and jsonb_typeof(ans -> 'id') = 'number' and (ans ->> 'id') ~ '^[0-9]{1,15}$' then (ans ->> 'id')::bigint end;
    if n > most then
      skipped := skipped || jsonb_build_array(jsonb_build_object('id', rid, 'why', 'a meeting reads at most ' || most || ' answers'));
      continue;
    end if;
    if rid is null then skipped := skipped || jsonb_build_array(jsonb_build_object('id', null, 'why', 'an answer names a request by its id')); continue; end if;
    decided := ans ->> 'ruling';
    if decided is null or decided not in ('fulfill', 'reject') then
      skipped := skipped || jsonb_build_array(jsonb_build_object('id', rid, 'why', 'an answer rules fulfill or reject'));
      continue;
    end if;
    -- The tick's pass try-locks this key before it replies and writes its lapse; a meeting that holds it is waited for, so the lapse is the one that is left to the next tick.
    perform pg_advisory_xact_lock(hashtextextended('kayfabb.request.' || rid, 0));
    select * into rq from staff_requests q where q.id = rid;
    if not found or rq.ruling <> 'confer' or exists (select 1 from staff_request_rulings g where g.request = rid) then
      skipped := skipped || jsonb_build_array(jsonb_build_object('id', rid, 'why', 'that request is not waiting'));
      continue;
    end if;
    if not exists (select 1 from acts_public a where a.id = rq.request_act and a.hidden is not true) then
      skipped := skipped || jsonb_build_array(jsonb_build_object('id', rid, 'why', 'that request post is no longer public'));
      continue;
    end if;
    line := nullif(btrim(coalesce(ans ->> 'line', ''), E' \t\n\r\f\v'), '');
    if line is not null and post_most is not null then line := left(line, post_most); end if;
    made := null;
    why := null;
    if decided = 'fulfill' then
      if spent >= left_room then
        decided := 'reject';
        why := 'the bank could not pay for another move';
        line := null;
      else
        result := boss_move_queue(boss, ans -> 'move', rq.request_act, requests_ruled.in_meeting);
        if (result ->> 'queued')::boolean then
          made := (result ->> 'move')::bigint;
          spent := spent + 1;
        else
          decided := 'reject';
          line := null;
          why := case when (result ->> 'existing')::boolean then 'the Boss has already made a move for that request' else coalesce(result ->> 'reason', 'the move was not made') end;
        end if;
      end if;
    end if;
    said := null;
    unsaid := null;
    begin
      said := boss_request_reply(boss, rq.thread, rq.request_act, case when decided = 'fulfill' then 'requestGranted' else 'requestRefused' end, line);
    exception when others then
      said := null;
      unsaid := 'the Boss''s reply was not posted: ' || sqlerrm;
      raise warning 'requests_ruled: the reply to request % was not posted: % (%)', rid, sqlerrm, sqlstate;
    end;
    insert into staff_request_rulings (request, ruling, move, meeting, post_act, reason)
    values (rid, decided, made, requests_ruled.in_meeting, said, left(nullif(concat_ws('; ', why, unsaid), ''), 500));
    out := out || jsonb_build_array(jsonb_build_object('id', rid, 'requestAct', rq.request_act, 'thread', rq.thread, 'staff', rq.staff, 'ruling', decided, 'move', made, 'reason', why,
      'postAct', said, 'replyFailed', unsaid));
  end loop;
  return jsonb_build_object('spent', spent, 'rulings', out, 'skipped', skipped);
end $$;
revoke execute on function requests_ruled(bigint, jsonb, integer) from public, anon, authenticated;

-- ---- the setting ----

-- setting_staffrequests: the engine's staffRequestsRule (engine/rules/instance.ts) in words and in rule: exactly daysMost (the most days a request waits for a ruling) and meetingMost (the most waiting requests one
-- meeting rules on), each a whole number, at least 1.
create function setting_staffrequests(v jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  shape constant text := 'an object giving daysMost (the most days a request waits for a ruling) and meetingMost (the most waiting requests one meeting rules on), each a whole number, at least 1';
  k text;
begin
  if jsonb_typeof(v) is distinct from 'object' then return shape; end if;
  select e into k from jsonb_object_keys(v) e where e <> all (array['daysMost', 'meetingMost']) limit 1;
  if k is not null then return format('%s; "%s" is not one of its fields', shape, k); end if;
  foreach k in array array['daysMost', 'meetingMost'] loop
    if not setting_whole(v -> k, 1) then return format('%s; "%s" is not', shape, k); end if;
  end loop;
  return null;
end $$;
revoke execute on function setting_staffrequests(jsonb) from public, anon, authenticated;

-- settings_held (0416), staffRequests held by setting_staffrequests. Everything else as 0416_crowd_floor_setting.sql wrote it.
create or replace function public.settings_held()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v jsonb := new.value;
  why text;
  shape text;
  phase text;
  pkey text;
  kinds text[] := array['quote', 'cardOnYours', 'trapStruck', 'trapSprang', 'hint', 'ruling', 'settlement', 'followed', 'update', 'seasonNews', 'cardEnded', 'framed', 'trophy', 'beltLost', 'beltBack'];
begin
  why := case new.key
    when 'walletCap' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'vote' then case when not setting_whole(v, 1) then 'a whole number of hundredths, at least 1' end
    when 'halving' then case when not coalesce(jsonb_typeof(v) = 'number' and setting_positive(v) and (v #>> '{}')::numeric <= 1, false)
      then 'a fraction above 0 and at most 1' end
    when 'revealPerk' then case when not coalesce(jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric between 0 and 1, false) then 'a number from 0 to 1' end
    -- How many days a post's debate is followed (0391): a whole number of days, at least 1 and at most 365 (as digestBoardDays and movedStubDays are), so the `::integer` and the interval the inputs build from it cannot overflow.
    when 'debateDays' then case when not setting_whole(v, 1, 365) then 'a whole number of days, at least 1 and at most 365' end
    when 'reactionCap' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
    when 'postEffects' then case when not setting_whole(v, 1, 16) then 'a whole number of effects, at least 1 and at most 16' end
    when 'crowdPayEach' then case when not setting_whole(v, 0) then 'a whole number of hundredths, at least 0' end
    when 'crowdFloor' then case when not setting_whole(v, 0) then 'a whole number of hundredths, at least 0' end
    when 'crowdPayMost' then case when not setting_whole(v, 1) then 'a whole number, at least 1' end
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
    when 'pollOptionsMax' then case when not setting_whole(v, 2, 100) then 'a whole number of options, at least 2 and at most 100' end
    when 'pollQuestionMax' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'pollOptionMax' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'pollLastsMin' then case when not setting_span(v, array['hour', 'day', 'week', 'month']) then 'a span: a unit of hour, day, week or month and a whole count from 1 to 1000' end
    when 'pollLastsMax' then case when not setting_span(v, array['hour', 'day', 'week', 'month']) then 'a span: a unit of hour, day, week or month and a whole count from 1 to 1000' end
    when 'titleMaxLength' then case when not setting_whole(v, 1) then 'a whole number of characters, at least 1' end
    when 'postsPerPage' then case when not setting_whole(v, 1) then 'a whole number of posts, at least 1' end
    when 'hotReplies' then case when not setting_whole(v, 1) then 'a whole number of replies, at least 1' end
    when 'presenceNames' then case when not setting_whole(v, 1) then 'a whole number of names, at least 1' end
    when 'presencePollSeconds' then case when not setting_whole(v, 10, 300) then 'a whole number of seconds from 10 to 300' end
    when 'cardSettings' then case when not setting_named_numbers(v) then 'an object of named numbers' end
    when 'systemEnabled' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
    when 'oldVoice' then case when jsonb_typeof(v) is distinct from 'boolean' then 'true or false' end
    when 'cardWriteSettleSeconds' then case when not setting_whole(v, 0, 600) then 'a whole number of seconds, at least 0 and at most 600' end
    -- The old voice's window (§4 of docs/plans/2026-11-12-old-voice-window-design.md), in the words engine/rules/instance.ts gives each.
    when 'oldVoiceWindow' then case when not setting_whole(v, 64, 1000000) then 'a whole number of tokens from 64 to 1,000,000' end
    when 'oldVoiceTokenizer' then case when v not in ('"gpt2"', '"bytes"') then '"gpt2" or "bytes"' end
    when 'oldVoicePromptFloor' then case when not setting_whole(v, 1) then 'a whole number of tokens, at least 1' end
    when 'cardWriteFullShare' then case when not coalesce(case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric between 0 and 1 end, false) then 'a number from 0 to 1' end
    when 'cardWriteTopUps' then case when not setting_whole(v, 0, 5) then 'a whole number from 0 to 5' end
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
    -- How many conversations with waiting replies the digest shows a pool persona (0415): a whole number from 0 to 12, as DIGEST_MOST.conversations holds.
    when 'digestConversations' then case when not setting_whole(v, 0, 12) then 'a whole number of conversations, at least 0 and at most 12' end
    when 'digestBoards' then case when not setting_whole(v, 1, 30) then 'a whole number of boards, at least 1 and at most 30' end
    when 'digestBoardDays' then case when not setting_whole(v, 1, 365) then 'a whole number of days, at least 1 and at most 365' end
    when 'movedStubDays' then case when not setting_whole(v, 1, 365) then 'a whole number of days, at least 1 and at most 365' end
    when 'bundleMostParts' then case when not setting_whole(v, 1, 16) then 'a whole number of parts, at least 1 and at most 16' end
    when 'bundleAuthoredMostParts' then case when not setting_whole(v, 1, 16) then 'a whole number of parts, at least 1 and at most 16' end
    when 'farewellWindowHours' then case when not setting_whole(v, 1, 720) then 'a whole number of hours, at least 1 and at most 720' end
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
    -- How long a conferred request waits for a meeting, and how many a meeting reads (0424): setting_staffrequests.
    when 'staffRequests' then setting_staffrequests(v)
    when 'warnBar' then setting_warnbar(v)
    when 'pronouns' then case when not pronouns_hold(pronouns_lowered(v)) then 'an object of five words of 1 to 12 letters each (an apostrophe or a hyphen between two letters is allowed) and a plural, true or false' end
    when 'apology' then setting_apology(v)
    when 'conduct' then setting_conduct(v)
    when 'conductVersion' then case when not setting_whole(v, 1) then 'a whole number, at least 1 (the version of the code of conduct)' end
    when 'conductSections' then case when not coalesce(jsonb_typeof(v) = 'array'
        and not exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) is distinct from 'string' or btrim(e #>> '{}', E' \t\n\r\f\v') = ''), false)
      then 'an array of section keys, each a non-blank string' end
    when 'cosmetics' then setting_cosmetics(v)
    -- The pack an account's first character is given (0377): the key of a pack, or null for none. That it names a fixed pack of the instance is the instance check's (engine/rules/instance.ts) and
    -- welcome_pack_kind's: a name that is no fixed pack grants nothing.
    when 'startingPack' then case when not (jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}', E' \t\n\r\f\v') <> '')) then 'the key of a fixed pack, or null for none' end
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
  -- The least a poll may last is held against the most, whichever is written (the other's row is read as it stands; a row that is not a span is that row's own refusal, never this one).
  if why is null and new.key = 'pollLastsMin' and setting_span((select g.value from settings g where g.key = 'pollLastsMax'), array['hour', 'day', 'week', 'month'])
     and span_interval(v) > span_interval((select g.value from settings g where g.key = 'pollLastsMax')) then
    why := 'a span no longer than pollLastsMax';
  end if;
  if why is null and new.key = 'pollLastsMax' and setting_span((select g.value from settings g where g.key = 'pollLastsMin'), array['hour', 'day', 'week', 'month'])
     and span_interval(v) < span_interval((select g.value from settings g where g.key = 'pollLastsMin')) then
    why := 'a span no shorter than pollLastsMin';
  end if;
  if why is not null then raise exception '% is %', new.key, why using errcode = '23514'; end if;
  return new;
end $function$;

-- system_tick (0403_departed_personas.sql), lapsing the requests whose time has come (step 5). Everything else as 0403 wrote it.
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
begin
  if not pg_try_advisory_xact_lock(hashtext('kayfabb.system_tick')) then return jsonb_build_object('skipped', true); end if;

  -- The one lock order (0339): the global place key before anything is written. A lasting move due to land, or one in force that this tick may end (an expiry, a demand met, a superseded one), writes places;
  -- a move landed before it writes an Act into the announcements thread, a row an admin's reversal (which takes the key and then writes its end into that thread) waits for, so the key cannot wait until the
  -- first lasting landing. The one key is held to the end of the tick; the tick's own rows are the only thing it waits for before it is taken.
  if exists (select 1 from queued_moves q join move_kinds k on k.key = q.kind
             where k.lasting and q.landed_act is null and q.held_at is null and q.refused_at is null and q.go_live_at <= now())
     or exists (select 1 from open_moves o join acts a on a.id = o.move_act join move_kinds k on k.key = a.payload ->> 'kind' where k.lasting) then
    perform lock_thread_places();
  end if;

  -- 1. Landing: only while The System is on, and only where there is a thread to say it in.
  if enabled and ann is not null then
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
        written := (write_staff_act(due.staff, 'move', ann, null,
          jsonb_build_object('kind', due.kind, 'params', lp, 'body', system_line(case when due.kind = 'setRule' then 'ruleSet' else 'moveLanded' end, due.kind, lp, due.staff))
          || case when due.demand is not null then jsonb_build_object('demand', due.demand) else '{}'::jsonb end
          || case when due.expires_at is not null then jsonb_build_object('expires_at', due.expires_at) else '{}'::jsonb end) ->> 'id')::uuid;
        update queued_moves set landed_act = written where id = due.id;
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
  for rq in
    select o.request as id, r.request_act, r.thread
    from staff_requests_open o cross join lateral (select x.request_act, x.thread from staff_requests x where x.id = o.request limit 1) r
    where o.at + make_interval(days => staff_request_days()) <= now() or not exists (select 1 from acts_public a where a.id = r.request_act and a.hidden is not true)
    order by o.failed_at nulls first, o.at, o.request limit cap
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
      rq_public := exists (select 1 from acts_public a where a.id = rq.request_act and a.hidden is not true);
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
    'noThread', enabled and ann is null, 'awardsFailed', awards_failed, 'requestsLapsed', lapsed_n);
end $$;

-- ===================================================================================== 2b. The turn's call record ====
-- A staff turn that rules on a request keeps what it did beside the post: the ruling, the move queued or why a fulfill became a confer, a refusal of the ruling and every trim (record_staff_call, 0106). The duty is
-- `ruling`; its cause is the turn's post. Nothing else changes: the table is still append-only and no client reads it.
alter table staff_call_records drop constraint staff_call_records_duty_check;
alter table staff_call_records add constraint staff_call_records_duty_check check (duty in ('filing', 'reportJudge', 'patrolJudge', 'appeal', 'ruling'));

-- write_staff_turn writes the turn's ruling with the post (Task 4 fix). A ruling written after the turn's transaction could be lost for good: the post is committed and its replies are answered, so a run that died, or a
-- transport error, between the two left a request nobody ruled on and nothing to write it again. So the ruling travels in the turn's own transaction: `in_ruling` {reply, ruling, move, weekly_moves, bank_cap} (the
-- repaired request block; null for a turn that rules on nothing) is handed to rule_request once the post is written, with the new post as its turn.
-- A ruling the database refuses as bad input (22023, the refusals rule_request and the moves raise; 23514 and 22P02 for a value outside its checks or a reply that is no id) is caught in a subtransaction of its own: whatever
-- the ruling began (a debit, a queued move) is undone with it, the post and the turn stand, and the result says `refused` {code, message}. Any other error is not bad input and takes the whole turn back, as ever.
-- Idempotent as write_staff_turn always was: a reply is answered once (pool_answered's key, and the persona's lock before it), so a replay is refused whole and writes neither a second post nor a second ruling; rule_request
-- is itself idempotent on (staff, request post). A turn rolled back after its post leaves no ruling, and a ruling is never written without its post.
-- Returns {turn, post} and, for a ruling, {ruling: rule_request's answer} or {refused: {code, message}}.
drop function write_staff_turn(text, bigint, uuid, uuid, uuid[], text, integer);
create function write_staff_turn(staff_key text, in_session bigint, in_thread uuid, quoting uuid, answers uuid[], body text, in_chars integer, in_ruling jsonb default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  sess staff_sessions;
  wanted uuid[];
  written jsonb;
  made bigint;
  out jsonb;
  ruled jsonb;
begin
  select c.id into who from characters c where c.staff = staff_key and c.staff_kind = 'persona';
  if who is null then raise exception 'there is no persona "%"', staff_key using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kayfabb-staff-turn:' || staff_key, 0));
  select * into sess from staff_sessions s where s.id = in_session;
  if sess.id is null or sess.staff is distinct from staff_key then
    raise exception 'that session is not %''s', staff_key using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if not (sess.starts_at <= now() and now() < sess.ends_at) then
    raise exception 'that session is not open now' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  select coalesce(array_agg(distinct x), '{}') into wanted from unnest(answers) x;
  if cardinality(wanted) = 0 or write_staff_turn.quoting is null or not (write_staff_turn.quoting = any (wanted)) then
    raise exception 'a turn quotes one of the replies it answers' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- A reply is answered once. Two guards: the persona's lock above serializes its turns, so the second of two racing turns finds the first's pool_answered rows here; and pool_answered's primary key (reply) refuses a
  -- duplicate whatever got past this read, rolling the whole turn back.
  if exists (select 1 from pool_answered p where p.reply = any (wanted)) then
    raise exception 'a reply is answered once' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  -- Each answer is waiting now, by the very read that finds waiting replies (pool_waiting_in_thread): a public reply by a character that is not staff to a post of this persona in this thread, within the wait, not under an
  -- author veil, not in a thread the persona is locked out of.
  if (select count(*) from pool_waiting_in_thread(in_thread, array[staff_key], now() - coalesce(((select g.value from settings g where g.key = 'pool') -> 'turns' ->> 'waitHours')::integer, 48) * interval '1 hour') w
      where w.act = any (wanted)) is distinct from cardinality(wanted) then
    raise exception 'a turn answers the replies waiting on its own posts in its thread' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  perform within('body', body, 'postMaxLength');
  written := write_staff_act(staff_key, 'post', in_thread, write_staff_turn.quoting, jsonb_build_object('body', body));
  insert into pool_turns (day, staff, session, thread, post_act, quoting, chars)
  values (sess.day, staff_key, in_session, in_thread, (written ->> 'id')::uuid, write_staff_turn.quoting, in_chars) returning id into made;
  insert into pool_answered (reply, turn) select x, made from unnest(wanted) x;
  out := jsonb_build_object('turn', made, 'post', written);
  if in_ruling is not null and in_ruling <> 'null'::jsonb then
    begin
      ruled := rule_request(staff_key, (in_ruling ->> 'reply')::uuid, (written ->> 'id')::uuid, in_ruling ->> 'ruling', nullif(in_ruling -> 'move', 'null'::jsonb),
        (in_ruling ->> 'weekly_moves')::numeric, (in_ruling ->> 'bank_cap')::numeric);
      out := out || jsonb_build_object('ruling', ruled);
    exception when invalid_parameter_value or check_violation or invalid_text_representation then
      out := out || jsonb_build_object('refused', jsonb_build_object('code', sqlstate, 'message', sqlerrm));
    end;
  end if;
  return out;
end $$;
revoke execute on function write_staff_turn(text, bigint, uuid, uuid, uuid[], text, integer, jsonb) from public, anon, authenticated;
grant execute on function write_staff_turn(text, bigint, uuid, uuid, uuid[], text, integer, jsonb) to service_role;

-- ===================================================================================== 3. the meeting's rules for requests ====
-- apply_meeting (0415_chattier_staff.sql), ruling on the requests the answer names: `payload.requests` is handed to requests_ruled with what the bank can still pay after the Boss's own moves and its bundle (the staff requests design, section 3;
-- the plan's Task 5). The rulings are written in the transaction that closes the meeting, once (a retry finds it closed), and returned as `requests`, each with the Boss's reply, which requests_ruled wrote in the same transaction (the Edge function posts nothing, and reports the replies that could not be written); what they spent is charged
-- to the balance written at the end. Two more changes: the Boss's bank lock (`kayfabb.bank.<boss>`) is taken before the bank is read, as apply_boss_move takes it, so a turn's debit is never overwritten by a meeting that read the bank
-- earlier; and a lasting move a request carries takes the places lock with the rest. Everything else as 0415_chattier_staff.sql wrote it.
create or replace function apply_meeting(meeting bigint, payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  boss text := payload ->> 'boss';
  bal numeric;
  bal2 numeric;
  cap numeric := (payload ->> 'bank_cap')::numeric;
  returned numeric := 0;
  spent integer;
  handed integer := 0;
  hold interval := ((setting('structuralHoldHours')) #>> '{}')::numeric * interval '1 hour';
  memory jsonb := payload -> 'memory';
  mv jsonb;
  inh jsonb;
  due record;
  kind_row move_kinds%rowtype;
  live timestamptz;
  kept integer := 0;
  ended_n integer := 0;
  skipped integer := 0;
  nominated boolean := false;
  act_id uuid;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  kept_moves jsonb := '[]';
  rules_skipped jsonb := '[]';
  machine_skipped jsonb := '[]';
  lasting_skipped jsonb := '[]';
  mlive timestamptz;
  mhours numeric;
  problem text;
  idx integer := 0;
  ord jsonb;
  planned jsonb := '[]';
  most integer;
  who text;
  bs uuid[];
  b text;
  bid uuid;
  claimed uuid[] := '{}';
  asked numeric;
  amount integer;
  line text;
  mod_memory jsonb;
  orders_skipped integer := 0;
  clamped integer := 0;
  trimmed integer := 0;
  planned_mods text[] := '{}';
  prev staff_orders%rowtype;
  at_order integer;
  room integer;
  check_at timestamptz;
  pat jsonb;
  pat_at timestamptz;
  pat_most integer;
  pat_n integer := 0;
  pat_skipped integer := 0;
  -- The season the meeting was held in, which is not the open one when the season turned between the meeting and this apply: the beat's events and the kinds it holds back are that season's.
  season_id bigint := coalesce(meeting_season(apply_meeting.meeting), (select x.id from seasons x where x.ends_at is null));
  held text[] := held_back_kinds(boss, coalesce(meeting_season(apply_meeting.meeting), (select x.id from seasons x where x.ends_at is null)));
  beats_played text[] := '{}';
  held_skipped jsonb := '[]';
  bundles_skipped jsonb := '[]';
  bnd jsonb;
  bpart jsonb;
  bidx integer := 0;
  bundle_id uuid;
  authored boolean;
  parts_n integer;
  charged integer;
  queued_n integer := 0;
  authored_most integer := coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'bundleAuthoredMostParts'), 8);
  composed_most integer := coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'bundleMostParts'), 4);
  hf_farewell text := nullif(btrim(coalesce(payload ->> 'farewell', ''), E' \t\n\r\f\v'), '');
  hf_note text := nullif(btrim(coalesce(payload ->> 'handoff', ''), E' \t\n\r\f\v'), '');
  hf_post_most integer := (select (s.value #>> '{}')::integer from settings s where s.key = 'postMaxLength');
  hf_trims jsonb := '[]';
  hf_skipped jsonb := '[]';
  pt jsonb;
  pt_line text;
  pt_n integer := 0;
  pt_skipped integer := 0;
  pt_trimmed integer := 0;
  rr jsonb := jsonb_build_object('spent', 0, 'rulings', '[]'::jsonb, 'skipped', '[]'::jsonb);
begin
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.meeting.' || apply_meeting.meeting, 0));
  if not exists (select 1 from meetings x where x.id = apply_meeting.meeting) then
    raise exception 'there is no meeting %', apply_meeting.meeting using errcode = '22023';
  end if;
  if exists (select 1 from meetings x where x.id = apply_meeting.meeting and x.finished_at is not null) then
    return jsonb_build_object('status', 'already applied', 'meeting', apply_meeting.meeting);
  end if;
  if boss is null or boss is distinct from current_boss() then
    raise exception 'a meeting is the open season''s Boss''s; % is not (%)', boss, current_boss() using errcode = '22023';
  end if;
  if hold is null then raise exception 'a meeting needs structuralHoldHours, which this instance does not set' using errcode = '22023'; end if;
  -- The Boss's bank lock, in the order apply_boss_move takes them (every open meeting's, then the bank's): a turn's debit is made under it, so a meeting that begins after the turn looked reads the bank the turn left, and a turn that
  -- begins after this one waits for it, never the balance written over by a read taken earlier.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.bank.' || boss, 0));
  bal := bank_now(boss, (payload ->> 'weekly_moves')::numeric, (payload ->> 'bank_cap')::numeric);
  if bal is null then raise exception 'a meeting names the phase''s weekly_moves and bank_cap' using errcode = '22023'; end if;
  -- The one lock order, before the first write: a lasting move queued, or a lasting move ended by an inheritance decision, writes places, and the Acts this answer writes (a move_keep, a move_end) are rows an
  -- admin's reversal waits for after it holds the key.
  if exists (select 1 from jsonb_array_elements(case when jsonb_typeof(payload -> 'inherited') = 'array' then payload -> 'inherited' else '[]'::jsonb end) i where jsonb_typeof(i.value) = 'object')
     or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(payload -> 'moves') = 'array' then payload -> 'moves' else '[]'::jsonb end) m
                join move_kinds k on k.key = m.value ->> 'kind' where k.lasting)
     or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(payload -> 'bundles') = 'array' then payload -> 'bundles' else '[]'::jsonb end) b,
                     jsonb_array_elements(case when jsonb_typeof(b.value -> 'parts') = 'array' then b.value -> 'parts' else '[]'::jsonb end) p
                join move_kinds k on k.key = p.value ->> 'kind' where k.lasting)
     or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(payload -> 'requests') = 'array' then payload -> 'requests' else '[]'::jsonb end) r
                join move_kinds k on k.key = r.value #>> '{move,kind}' where k.lasting) then
    perform lock_thread_places();
  end if;

  -- The moves: a kind outside the catalog raises; a rule the queue would refuse is skipped and recorded, and costs nothing.
  for mv in select value from jsonb_array_elements(coalesce(payload -> 'moves', '[]')) loop
    idx := idx + 1;
    select * into kind_row from move_kinds k where k.key = mv ->> 'kind';
    if not found then raise exception 'there is no move kind "%"', mv ->> 'kind' using errcode = '23514'; end if;
    -- A kind the Boss does not use yet (its persona holds it back until a beat unlocks, 0333) is skipped and recorded, and costs nothing: the engine drops it too, and the database holds the line.
    if kind_row.key = any (held) then
      held_skipped := held_skipped || jsonb_build_array(jsonb_build_object('index', idx - 1, 'kind', kind_row.key));
      continue;
    end if;
    if kind_row.key = 'setRule' then
      problem := rule_params_problem(mv -> 'params');
      if problem is null then
        problem := rule_conflict(nullif(mv #>> '{params,board}', '')::uuid, mv #>> '{params,predicate}', nullif(mv #> '{params,param}', 'null'::jsonb));
      end if;
      if problem is not null then
        rules_skipped := rules_skipped || jsonb_build_array(jsonb_build_object('index', idx - 1, 'why', problem));
        continue;
      end if;
    end if;
    -- A machine move the queue's guard would refuse for its params, its demand or its bounds (the guard's own predicate, machine_move_problem without the machine as it is
    -- at landing) is skipped and recorded, and costs nothing: one bad machine move never fails the whole answer, as a bad rule does not.
    if kind_row.key in ('pullSlot', 'repriceSlot', 'flashSale') then
      problem := null;
      begin
        mlive := greatest((mv ->> 'go_live_at')::timestamptz, now());
        mhours := case when jsonb_typeof(mv -> 'expires_in_hours') = 'number' then (mv ->> 'expires_in_hours')::numeric end;
        problem := machine_move_problem(kind_row.key,
          case when jsonb_typeof(mv #> '{params,slot}') = 'string' then jsonb_set(mv -> 'params', '{slot}', to_jsonb(lower(mv #>> '{params,slot}'))) else mv -> 'params' end,
          mv -> 'demand', mlive, case when mhours is not null then mlive + mhours * interval '1 hour' end, false);
        if problem is null and mv -> 'demand' is not null and jsonb_typeof(mv -> 'demand') <> 'null' then
          if not exists (select 1 from demand_kinds d where d.key = mv #>> '{demand,kind}') then problem := 'there is no such demand kind';
          else problem := demand_params_problem(mv -> 'demand'); end if;
        end if;
      exception when others then
        problem := 'the move is malformed';
      end;
      if problem is not null then
        machine_skipped := machine_skipped || jsonb_build_array(jsonb_build_object('index', idx - 1, 'why', problem));
        continue;
      end if;
    end if;
    -- The three lasting board moves the queue would refuse (what they name is not there, a board is closed, a merge would make a cycle, a demand a lasting move cannot carry) are skipped
    -- and recorded, and cost nothing, as a machine move is: one bad one never fails the whole answer.
    if kind_row.key in ('createBoard', 'moveThread', 'mergeBoard') then
      problem := null;
      begin
        if mv -> 'demand' is not null and jsonb_typeof(mv -> 'demand') <> 'null' then problem := 'a lasting move carries no demand';
        else problem := lasting_move_problem(kind_row.key, mv -> 'params'); end if;
      exception when others then
        problem := 'the move is malformed';
      end;
      if problem is not null then
        lasting_skipped := lasting_skipped || jsonb_build_array(jsonb_build_object('index', idx - 1, 'why', problem));
        continue;
      end if;
    end if;
    kept_moves := kept_moves || jsonb_build_array(mv);
  end loop;
  spent := jsonb_array_length(kept_moves);

  -- The orders: validated into a plan, so nothing is written before the bank has agreed.
  if jsonb_typeof(payload -> 'orders') = 'array' and jsonb_array_length(payload -> 'orders') > 0 then
    most := (setting('modBots') ->> 'allowanceMost')::integer;
    if most is null then raise exception 'orders need the setting modBots, which this instance does not set' using errcode = '22023'; end if;
    for ord in select value from jsonb_array_elements(payload -> 'orders') loop
      who := ord ->> 'mod';
      if jsonb_typeof(ord) is distinct from 'object' or who is null or who = any (planned_mods) or not exists (select 1 from staff_now n where n.staff = who) then
        orders_skipped := orders_skipped + 1;
        continue;
      end if;
      bs := '{}';
      for b in select t.v from jsonb_array_elements_text(case when jsonb_typeof(ord -> 'boards') = 'array' then ord -> 'boards' else '[]'::jsonb end) with ordinality t(v, n) order by t.n loop
        if b ~* uuid_re then
          bid := lower(b)::uuid;
          if exists (select 1 from boards x where x.id = bid and not x.is_system) and bid <> all (claimed) and bid <> all (bs) then bs := bs || bid; end if;
        end if;
      end loop;
      claimed := claimed || bs;
      asked := case when jsonb_typeof(ord -> 'allowance') = 'number' then floor((ord ->> 'allowance')::numeric) else 0 end;
      amount := greatest(0, least(asked, most));
      if amount is distinct from asked then clamped := clamped + 1; end if;
      line := left(btrim(coalesce(ord ->> 'order', ''), E' \t\n\r\f\v'), 200);
      -- A blank line is no instruction: the Mod keeps the one it had.
      if line = '' then line := coalesce((select x.order_line from staff_orders x where x.staff = who order by x.id desc limit 1), ''); end if;
      mod_memory := case when jsonb_typeof(ord -> 'memory') = 'object' then jsonb_set(jsonb_set(ord -> 'memory', '{opinions}', public_entries(ord #> '{memory,opinions}')), '{grudges}', public_entries(ord #> '{memory,grudges}')) end;
      planned := planned || jsonb_build_array(jsonb_build_object('mod', who, 'boards', to_jsonb(bs), 'order', line, 'allowance', amount, 'memory', mod_memory));
      planned_mods := planned_mods || who;
      handed := handed + amount;
    end loop;
  end if;

  -- What the Mods did not spend goes back, never above the cap: one lock per persona with an order, in key order, so a Mod's move queued at the same
  -- moment is either counted here or counted against the new order, never both and never neither.
  for who in select distinct o.staff from staff_orders o order by o.staff loop
    perform pg_advisory_xact_lock(hashtextextended('kayfabb.allowance.' || who, 0));
    returned := returned + order_unspent(who);
  end loop;
  -- What was added is what the cap allowed, and that is what is recorded.
  bal2 := least(cap, bal + returned);
  returned := greatest(0, bal2 - bal);
  -- The Boss's own moves are its own: they must be paid, else this raises, as it always has. The allowances are what is left. A Mod that queued between the
  -- meeting's read and this apply spent some of what the answer counted on; the answer is not failed for it: the allowances are trimmed from the last
  -- order backward to the bank, and the trims are recorded.
  -- The bundles (fangame split design, sections 2, 5 and 9), each all or nothing: its parts are queued under one bundle id and one name, in the order sent (a role names an earlier part), and a
  -- beat's bundle writes `played` with it. An authored bundle (it names a beat of this Boss's that is unlocked and unplayed) costs the bank nothing; a bundle of the Boss's own costs one move a part
  -- and holds at most bundleMostParts, none of a kind held back. A beat with no bundle has no parts and is played by being named. A bundle the queue would refuse (the guard raises), a beat
  -- that is not unlocked and a bank that cannot pay are each skipped and recorded, with the reason: one bad bundle never fails the whole answer. The guard still holds every part.
  for bnd in select value from jsonb_array_elements(case when jsonb_typeof(payload -> 'bundles') = 'array' then payload -> 'bundles' else '[]'::jsonb end) loop
    bidx := bidx + 1;
    begin
      if jsonb_typeof(bnd) is distinct from 'object' or jsonb_typeof(bnd -> 'parts') is distinct from 'array' then
        raise exception 'a bundle is {name, beat, parts}' using errcode = '22023';
      end if;
      authored := jsonb_typeof(bnd -> 'beat') = 'string';
      parts_n := jsonb_array_length(bnd -> 'parts');
      if authored then
        if not exists (select 1 from persona_arcs a, jsonb_array_elements(a.beats) b where a.staff = boss and b.value ->> 'key' = bnd ->> 'beat') then
          raise exception 'the beat "%" is not this Boss''s', bnd ->> 'beat' using errcode = '22023';
        end if;
        if arc_latest_states(boss, season_id) ->> (bnd ->> 'beat') is distinct from 'unlocked' then
          raise exception 'the beat "%" is not unlocked, or has been played', bnd ->> 'beat' using errcode = '22023';
        end if;
        if parts_n > authored_most then raise exception 'an authored bundle holds at most % parts', authored_most using errcode = '22023'; end if;
        charged := 0;
      else
        if parts_n < 1 then raise exception 'a bundle of the Boss''s own has at least one part' using errcode = '22023'; end if;
        if parts_n > composed_most then raise exception 'a bundle of the Boss''s own holds at most % parts', composed_most using errcode = '22023'; end if;
        if spent + parts_n > floor(bal2) then raise exception 'the bank cannot pay for % parts', parts_n using errcode = '23514'; end if;
        charged := parts_n;
      end if;
      if parts_n > 0 and btrim(coalesce(bnd ->> 'name', '')) = '' then raise exception 'a bundle has a name' using errcode = '22023'; end if;
      bundle_id := case when parts_n > 0 then gen_random_uuid() end;
      for bpart in select value from jsonb_array_elements(bnd -> 'parts') loop
        select * into kind_row from move_kinds k where k.key = bpart ->> 'kind';
        if not found then raise exception 'there is no move kind "%"', bpart ->> 'kind' using errcode = '23514'; end if;
        if not authored and kind_row.key = any (held) then raise exception 'the kind % is held back', kind_row.key using errcode = '23514'; end if;
        live := greatest((bpart ->> 'go_live_at')::timestamptz, now());
        if kind_row.structural then live := greatest(live, now() + hold); end if;
        insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural, bundle, bundle_name, role)
        values (apply_meeting.meeting, boss, kind_row.key, bpart -> 'params', bpart -> 'demand', bpart ->> 'why', live,
          live + coalesce((bpart ->> 'expires_in_hours')::numeric, 0) * interval '1 hour', kind_row.structural, bundle_id, left(bnd ->> 'name', 120), nullif(bpart ->> 'role', ''));
      end loop;
      if authored then
        insert into arc_beat_events (season, staff, beat, event, bundle) values (season_id, boss, bnd ->> 'beat', 'played', bundle_id);
        beats_played := beats_played || (bnd ->> 'beat');
      end if;
      spent := spent + charged;
      queued_n := queued_n + parts_n;
    exception when others then
      bundles_skipped := bundles_skipped || jsonb_build_array(jsonb_build_object('index', bidx - 1, 'name', bnd ->> 'name', 'why', left(sqlerrm, 300)));
    end;
  end loop;

  if spent > floor(bal2) then
    raise exception 'the moves cost % and the bank holds %', spent, bal2 using errcode = '23514';
  end if;
  -- The requests the answer ruled on (the staff requests design, section 3): paid from what the bank can still pay after the Boss's own moves and its bundle, before the allowances (the engine counts them in the same order), and
  -- each a row of its own with the Boss's move queued under this meeting. requests_ruled never touches move_bank: what it spent is charged with the rest, in the one write of the balance below.
  if jsonb_typeof(payload -> 'requests') = 'array' then
    rr := requests_ruled(apply_meeting.meeting, payload -> 'requests', floor(bal2)::integer - spent);
    spent := spent + (rr ->> 'spent')::integer;
  end if;
  room := floor(bal2)::integer - spent;
  at_order := jsonb_array_length(planned);
  while handed > room and at_order > 0 loop
    amount := (planned -> (at_order - 1) ->> 'allowance')::integer;
    if amount > 0 then
      asked := least(amount, handed - room);
      planned := jsonb_set(planned, array[(at_order - 1)::text, 'allowance'], to_jsonb(amount - asked::integer));
      handed := handed - asked::integer;
      trimmed := trimmed + 1;
    end if;
    at_order := at_order - 1;
  end loop;

  -- Only debuted public characters are named: the engine checks this too, and the database keeps it whatever the caller sent. The
  -- memory is written only when it came.
  if jsonb_typeof(memory) = 'object' then
    memory := jsonb_set(jsonb_set(memory, '{opinions}', public_entries(memory -> 'opinions')), '{grudges}', public_entries(memory -> 'grudges'));
    insert into staff_memory (staff, meeting, body) values (boss, apply_meeting.meeting, memory);
  end if;
  if jsonb_typeof(payload -> 'profile') = 'object' then
    insert into staff_profiles (staff, meeting, interests, favorites, mood, signature)
    values (boss, apply_meeting.meeting,
      array(select jsonb_array_elements_text(coalesce(payload -> 'profile' -> 'interests', '[]'))),
      array(select f.id from (select case when t.f ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then t.f::uuid end as id, min(t.ord) as ord from jsonb_array_elements_text(coalesce(payload -> 'profile' -> 'favorites', '[]')) with ordinality t(f, ord) group by 1) f
        where f.id in (select c.id from characters_public c) order by f.ord),
      coalesce(payload -> 'profile' ->> 'mood', ''), coalesce(payload -> 'profile' ->> 'signature', ''));
  end if;

  for mv in select value from jsonb_array_elements(kept_moves) loop
    select * into kind_row from move_kinds k where k.key = mv ->> 'kind';
    live := greatest((mv ->> 'go_live_at')::timestamptz, now());
    if kind_row.structural then live := greatest(live, now() + hold); end if;
    -- A favor's check must fall between its go-live and its expiry as the queue lands them; the answer set it from the meeting's clock, so one that no longer does is
    -- moved to half the favor's life from its go-live.
    if kind_row.key = 'conferGroup' and mv #> '{params,checkAt}' is not null then
      begin
        check_at := (mv #>> '{params,checkAt}')::timestamptz;
      exception when others then
        check_at := null;
      end;
      if check_at is null or check_at <= live or check_at >= live + ((mv ->> 'expires_in_hours')::numeric * interval '1 hour') then
        mv := jsonb_set(mv, '{params,checkAt}', to_jsonb(to_char((live + ((mv ->> 'expires_in_hours')::numeric * interval '30 minutes')) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
      end if;
    end if;
    insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
    values (apply_meeting.meeting, boss, kind_row.key, mv -> 'params', mv -> 'demand', mv ->> 'why', live,
      live + ((mv ->> 'expires_in_hours')::numeric * interval '1 hour'), kind_row.structural);
  end loop;

  -- The successor: queued beside the moves, not among them, and not charged to the bank.
  if jsonb_typeof(payload -> 'successor') = 'object' then
    select * into kind_row from move_kinds k where k.key = 'nameSuccessor';
    if found and jsonb_typeof(payload #> '{successor,boss}') = 'string' and (payload #>> '{successor,boss}') = any (boss_roster()) and (payload #>> '{successor,boss}') <> boss then
      insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
      values (apply_meeting.meeting, boss, 'nameSuccessor', jsonb_build_object('boss', payload #>> '{successor,boss}'), null,
        left(coalesce(nullif(payload #>> '{successor,why}', ''), 'No reason given.'), 200), now() + hold, null, kind_row.structural);
      nominated := true;
    else
      skipped := skipped + 1;
    end if;
  end if;

  -- The inheritance review: what the answer names must be among the moves due now; the rest is dropped. Each is answered at most once.
  for inh in select value from jsonb_array_elements(case when jsonb_typeof(payload -> 'inherited') = 'array' then payload -> 'inherited' else '[]'::jsonb end) loop
    act_id := case when (inh ->> 'move_act') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (inh ->> 'move_act')::uuid end;
    select * into due from inheritance_due(boss, 100) d where d.act = act_id;
    -- An answer with no decision (null in the test) is no decision: skipped, never read as "end".
    if act_id is null or not found or not coalesce((inh ->> 'decision') in ('keep', 'end'), false) then
      skipped := skipped + 1;
    elsif inh ->> 'decision' = 'keep' then
      perform write_staff_act(boss, 'move_keep', due.thread, due.act, '{}'::jsonb);
      kept := kept + 1;
    elsif inh ->> 'decision' = 'end' then
      if (end_move(due.act, 'superseded', 'boss') ->> 'ended')::boolean then perform say_move_end(due.act, 'superseded'); ended_n := ended_n + 1; end if;
    end if;
  end loop;

  -- The farewell and the handoff (0337), kept only from a meeting within farewellWindowHours of the season's end: the engine's repair already dropped them from any other, and the database holds
  -- the same line. Each is trimmed to its bound (the farewell to postMaxLength, the note to 2000) and the trim is recorded, never a lost answer. A blank one is none; a meeting that gives neither
  -- writes no row, so an earlier meeting's words are not displaced by silence. A new row is the latest of its season, and the ones before it stay.
  if hf_farewell is not null or hf_note is not null then
    if not in_farewell_window() then
      hf_skipped := jsonb_build_array(jsonb_build_object('why', 'inFarewellWindow'));
    else
      if hf_farewell is not null and hf_post_most is not null and char_length(hf_farewell) > hf_post_most then
        hf_trims := hf_trims || jsonb_build_array(jsonb_build_object('path', 'farewell', 'predicate', 'maxLength(' || hf_post_most || ')', 'before', char_length(hf_farewell), 'after', hf_post_most));
        hf_farewell := left(hf_farewell, hf_post_most);
      end if;
      if hf_note is not null and char_length(hf_note) > 2000 then
        hf_trims := hf_trims || jsonb_build_array(jsonb_build_object('path', 'handoff', 'predicate', 'maxLength(2000)', 'before', char_length(hf_note), 'after', 2000));
        hf_note := left(hf_note, 2000);
      end if;
      -- What this meeting leaves out stands as the latest row had it: a later meeting that writes only a note does not take the farewell back, nor one that writes only a farewell the note.
      insert into handoffs (season, staff, meeting, farewell, note)
      select season_id, boss, apply_meeting.meeting, coalesce(hf_farewell, x.farewell), coalesce(hf_note, x.note, '')
      from (select 1) one left join handoffs_latest x on x.season = season_id and x.staff = boss;
    end if;
  end if;

  -- An answer that left a persona with an order out carries it forward only while the persona is on staff (staff_now: an order ends with the office, the
  -- excerpts-and-orders design, section 2): its beat (less what another order claimed) and its line, with an allowance of 0, because what it had was returned above.
  -- A persona off staff (a Boss, or a Mod moved off) is carried nothing: if its latest row still holds a line, a beat or an allowance, one blank row with 0 ends it (the allowance is
  -- returned above once, and a Mod that comes back has no order until a meeting gives it one), and once the latest row is blank no row is written. After this meeting every
  -- persona on staff with an order has its latest from it.
  for ord in select value from jsonb_array_elements(planned) loop
    insert into staff_orders (meeting, staff, boards, order_line, allowance)
    values (apply_meeting.meeting, ord ->> 'mod', array(select jsonb_array_elements_text(ord -> 'boards'))::uuid[], ord ->> 'order', (ord ->> 'allowance')::integer);
    if jsonb_typeof(ord -> 'memory') = 'object' then
      insert into staff_memory (staff, meeting, body) values (ord ->> 'mod', apply_meeting.meeting, ord -> 'memory');
    end if;
  end loop;
  for who in
    select distinct o.staff from staff_orders o
    where o.meeting <> apply_meeting.meeting and o.staff <> all (planned_mods) order by o.staff
  loop
    select * into prev from staff_orders o where o.staff = who and o.meeting <> apply_meeting.meeting order by o.id desc limit 1;
    if exists (select 1 from staff_now n where n.staff = who) then
      insert into staff_orders (meeting, staff, boards, order_line, allowance)
      values (apply_meeting.meeting, who, array(select x from unnest(prev.boards) x where x <> all (claimed)), prev.order_line, 0);
    elsif prev.order_line <> '' or prev.allowance > 0 or prev.boards <> '{}' then
      insert into staff_orders (meeting, staff, boards, order_line, allowance)
      values (apply_meeting.meeting, who, '{}', '', 0);
    end if;
  end loop;

  -- The patrols the answer scheduled, kept on the meeting record by meet/core.ts (its repair already dropped a Mod off staff, moved a time into today and cut them to
  -- patrolsPerDay); the database holds the same line whatever the caller sent. Written once with the meeting: a retry finds the meeting closed above, and (meeting, n) is
  -- unique besides.
  pat_most := coalesce((select (s.value ->> 'patrolsPerDay')::integer from settings s where s.key = 'modBots'), 0);
  if jsonb_typeof(payload #> '{record,patrols}') = 'array' then
    for pat in select value from jsonb_array_elements(payload #> '{record,patrols}') loop
      if pat_n >= pat_most then pat_skipped := pat_skipped + 1; continue; end if;
      pat_at := null;
      begin
        pat_at := (pat ->> 'at')::timestamptz;
      exception when others then pat_at := null;
      end;
      if jsonb_typeof(pat) is distinct from 'object' or pat_at is null or jsonb_typeof(pat -> 'mod') is distinct from 'string'
         or not exists (select 1 from staff_now n where n.staff = pat ->> 'mod') then
        pat_skipped := pat_skipped + 1;
        continue;
      end if;
      pat_n := pat_n + 1;
      insert into patrols (meeting, n, staff, at)
      values (apply_meeting.meeting, pat_n, pat ->> 'mod', least(greatest(pat_at, now()), now() + interval '24 hours'))
      on conflict on constraint patrols_meeting_n_key do nothing;
    end loop;
  end if;

  -- The talking points the answer wrote (meet/core.ts repaired them: a persona that posts, once each, a line cut at a word to 200 characters, a blank one dropped); the database holds the same line whatever the caller sent. A key
  -- that is not a persona in a posting office (the Boss, a Mod or a member: not benched, not waiting), a second line for one key, a blank line and anything that is not an object are skipped and counted; a line over 200
  -- characters is cut and counted. They are written with the orders in this transaction, once: a retry finds the meeting closed above, and (meeting, staff) is unique besides.
  if jsonb_typeof(payload -> 'points') = 'array' then
    for pt in select value from jsonb_array_elements(payload -> 'points') loop
      pt_line := case when jsonb_typeof(pt) = 'object' and jsonb_typeof(pt -> 'line') = 'string' then nullif(btrim(pt ->> 'line', E' \t\n\r\f\v'), '') end;
      if pt_line is null or jsonb_typeof(pt -> 'staff') is distinct from 'string'
         or not exists (select 1 from staff_office_now o where o.staff = pt ->> 'staff' and o.office in ('boss', 'mod', 'member')) then
        pt_skipped := pt_skipped + 1;
        continue;
      end if;
      if char_length(pt_line) > 200 then pt_line := left(pt_line, 200); pt_trimmed := pt_trimmed + 1; end if;
      insert into staff_points (meeting, staff, line) values (apply_meeting.meeting, pt ->> 'staff', pt_line) on conflict on constraint staff_points_meeting_staff_key do nothing;
      if found then pt_n := pt_n + 1; else pt_skipped := pt_skipped + 1; end if;
    end loop;
  end if;

  insert into move_bank (staff, balance, as_of) values (boss, bal2 - spent - handed, now())
  on conflict (staff) do update set balance = excluded.balance, as_of = excluded.as_of;
  perform close_meeting(apply_meeting.meeting, 'ok', null, bal, bal2 - spent - handed,
    coalesce(payload -> 'record', '{}') || jsonb_build_object(
      'handover', jsonb_build_object('kept', kept, 'ended', ended_n, 'skipped', skipped, 'nominated', nominated),
      'allowances', jsonb_build_object('returned', returned, 'handed', handed, 'orders', jsonb_array_length(planned), 'skipped', orders_skipped, 'clamped', clamped, 'trimmed', trimmed),
      'rulesSkipped', rules_skipped,
      'machineSkipped', machine_skipped,
      'lastingSkipped', lasting_skipped,
      -- What was actually played (0335): the engine's `beatsDefaulted` and its `playedWithDefaults` trims say what it meant to play, and are kept only for the beats this transaction played.
      'beatsPlayed', to_jsonb(beats_played),
      'beatsDefaulted', coalesce((select jsonb_agg(d.k) from jsonb_array_elements_text(case when jsonb_typeof(payload #> '{record,beatsDefaulted}') = 'array' then payload #> '{record,beatsDefaulted}' else '[]'::jsonb end) d(k) where d.k = any (beats_played)), '[]'::jsonb),
      'trims', coalesce((select jsonb_agg(x.t order by x.n) from jsonb_array_elements(case when jsonb_typeof(payload #> '{record,trims}') = 'array' then payload #> '{record,trims}' else '[]'::jsonb end) with ordinality x(t, n)
                         where not (x.t ->> 'predicate' = 'playedWithDefaults' and not ((regexp_replace(coalesce(x.t ->> 'path', ''), '^beats\.', '')) = any (beats_played)))), '[]'::jsonb),
      'heldBackSkipped', held_skipped,
      'bundlesSkipped', bundles_skipped,
      'handoffTrims', hf_trims,
      'handoffSkipped', hf_skipped,
      'patrolsWritten', jsonb_build_object('written', pat_n, 'skipped', pat_skipped),
      'pointsWritten', jsonb_build_object('written', pt_n, 'skipped', pt_skipped, 'trimmed', pt_trimmed),
      'requestsRuled', jsonb_build_object('ruled', jsonb_array_length(rr -> 'rulings'), 'spent', rr -> 'spent', 'skipped', rr -> 'skipped')));
  return jsonb_build_object('status', 'applied', 'meeting', apply_meeting.meeting, 'queued', jsonb_array_length(kept_moves) + queued_n, 'beats_played', to_jsonb(beats_played), 'bank_before', bal, 'bank_after', bal2 - spent - handed,
    'returned', returned, 'handed', handed, 'requests', rr -> 'rulings');
end $$;
revoke execute on function apply_meeting(bigint, jsonb) from public, anon, authenticated;
grant execute on function apply_meeting(bigint, jsonb) to service_role;

-- system_digest (0415_chattier_staff.sql), also returning `requests`: the requests waiting for the Boss's ruling, oldest first, at most the setting staffRequests.meetingMost (requests_waiting, which this role owns and reads public relations
-- only: the request post as it shows, the asker's public name, the persona that conferred). Everything else as 0415 wrote it (owner and grants kept; the grants are stated again below).
create or replace function system_digest(since timestamptz, until timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  threads_cap integer := (setting('digestThreads'))::integer;
  short_cap integer := (setting('digestExcerpts'))::integer;
  chars integer := (setting('digestExcerptChars'))::integer;
  board_cap integer;
  board_days integer;
  conv_cap integer;
  req_most integer;
  hours numeric;
  result jsonb;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  met_by_most constant integer := 8;
begin
  if since is null or until is null or until <= since then
    raise exception 'a digest covers a window that ends after it starts' using errcode = '22023';
  end if;
  -- The board lines' two settings: an instance that has not set them (seeded before them) reads the defaults, as inheritance_due reads inheritanceGraceDays.
  begin board_cap := (setting('digestBoards'))::integer; exception when no_data_found then board_cap := 30; end;
  begin board_days := (setting('digestBoardDays'))::integer; exception when no_data_found then board_days := 21; end;
  -- The conversations' setting (0415): an instance seeded before it reads the default of 6.
  begin conv_cap := (setting('digestConversations'))::integer; exception when no_data_found then conv_cap := 6; end;
  -- The requests' setting (0424): an instance seeded before it reads the default of 10.
  begin req_most := ((setting('staffRequests')) ->> 'meetingMost')::integer; exception when no_data_found then req_most := 10; end;
  hours := greatest(extract(epoch from (until - since)) / 3600.0, 1.0 / 60);
  with
  w as (
    select p.id, p.thread, p.character, p.target_act_id, p.created_at, left(p.current_payload ->> 'body', chars) as excerpt,
           coalesce(length(p.current_payload ->> 'body') > chars, false) as cut
    from acts_public p
    where p.kind = 'post' and p.created_at >= since and p.created_at < until and p.character is not null
  ),
  react as (
    select w.thread, reaction_quadrant(t.act, t.kind) as quadrant, sum(t.count)::integer as n
    from w join reaction_tallies_open t on t.act = w.id
    group by w.thread, reaction_quadrant(t.act, t.kind)
  ),
  split as (
    select r.thread, sum(r.n) as total, max(r.n) as biggest from react r group by r.thread
  ),
  hot as (
    select tl.id as thread, left(tl.title, 120) as title, tl.board as board_id, h.posts,
           round(h.posts / hours, 2) as heat,
           round(coalesce(1 - s.biggest::numeric / nullif(s.total, 0), 0), 4) as controversy,
           tl.last_seq as length
    from (select w.thread, count(*) as posts from w group by w.thread) h
    join thread_list tl on tl.id = h.thread
    left join split s on s.thread = h.thread
    order by h.posts desc, coalesce(1 - s.biggest::numeric / nullif(s.total, 0), 0) desc, tl.id
    limit threads_cap
  ),
  -- Order and cut first, number after. The order is the standings screen's, amount then name (then the character, for
  -- a tie of both), so the top rows come off standings_season_amount (season, amount desc, name; 0030) already in order
  -- and stop at the cap: the season's rows are never sorted, only the few of a tie are. The rank is numbered over the cut.
  -- A row that is not a public character is skipped inside the cut, so the cap is still full.
  stand as (
    select row_number() over (order by top.amount desc, top.name, top.character) as rank, top.character, top.amount
    from (
      select s.character, s.amount, s.name
      from standings s
      where s.season = standings_season()
        and exists (select 1 from settlements x where x.ends_at > since and x.ends_at <= until)
        and exists (select 1 from characters_public cp where cp.id = s.character)
      order by s.amount desc, s.name, s.character
      limit short_cap
    ) top
  ),
  quoted as (
    select w.character as q_from, tgt.character as q_to, count(*) as n
    from w join acts_public tgt on tgt.id = w.target_act_id
    where tgt.kind = 'post' and tgt.character is not null and tgt.character <> w.character
    group by w.character, tgt.character
    order by count(*) desc, w.character, tgt.character
    limit short_cap
  ),
  boss as (
    select cp.id from characters_public cp where cp.staff is not null and cp.staff = current_boss()
  ),
  boss_acts as (
    select a.id, a.thread
    from acts_public a
    where a.character in (select id from boss) and a.kind in ('post', 'spin', 'card')
      and a.created_at >= since - (until - since) and a.created_at < until
  ),
  boss_tally as (
    select ba.id as act, ba.thread, sum(t.count)::integer as total, jsonb_object_agg(t.kind, t.count order by t.kind) as tally
    from boss_acts ba join reaction_tallies_open t on t.act = ba.id
    group by ba.id, ba.thread
    order by sum(t.count) desc, ba.id
    limit short_cap
  ),
  excerpted as (
    select w.id as act, w.thread, w.character, coalesce(sum(t.count), 0)::integer as reactions, w.excerpt, w.cut, w.created_at
    from w left join reaction_tallies_open t on t.act = w.id
    group by w.id, w.thread, w.character, w.excerpt, w.cut, w.created_at
    order by coalesce(sum(t.count), 0) desc, w.created_at desc, w.id
    limit short_cap
  ),
  -- The moves in force (open_moves: a handful of rows, whatever the instance's history) and those whose end fell in the window,
  -- each capped (the reversals first, so a met move's end cannot crowd one out); the merge below orders and caps them again. An end after the window is not the digest's yet.
  open_m as (
    select a.id as act, a.created_at as landed_at, a.payload, null::jsonb as ended, 1 as grp, 'inForce'::text as state, a.created_at as sort_at, null::timestamptz as held_at, null::text as why
    from open_moves o join acts_public a on a.id = o.move_act
    where a.created_at < until
    order by a.created_at desc, a.id
    limit short_cap
  ),
  ended_m as (
    select a.id as act, a.created_at as landed_at, a.payload,
           jsonb_build_object('why', e.payload ->> 'why', 'by', e.payload ->> 'by', 'at', e.created_at) as ended,
           case when e.payload ->> 'by' = 'admin' then 0 else 2 end as grp, 'ended'::text as state, e.created_at as sort_at, null::timestamptz as held_at, null::text as why
    from acts_public e join acts_public a on a.id = e.target_act_id
    where e.kind = 'move_end' and e.created_at >= since and e.created_at < until
    order by (e.payload ->> 'by' = 'admin') desc, e.created_at desc, e.id
    limit short_cap
  ),
  -- A move an admin held in the window never landed, so it has no Act: its row in the queue (the columns the digest role may read).
  held_m as (
    select null::uuid as act, null::timestamptz as landed_at,
           jsonb_build_object('kind', q.kind, 'params', q.params, 'demand', q.demand, 'expires_at', q.expires_at) as payload,
           null::jsonb as ended, 0 as grp, 'held'::text as state, q.held_at as sort_at, q.held_at, q.why
    from queued_moves q
    where q.held_at >= since and q.held_at < until
    order by q.held_at desc, q.id
    limit short_cap
  ),
  moved as (
    select * from (select * from open_m union all select * from ended_m union all select * from held_m) u order by u.grp, u.sort_at desc, u.act limit short_cap
  ),
  -- The moves in the list that ended `met`, with the params of their demand read as the demand evaluator reads them. A param that is
  -- not what its kind needs reads null, so one malformed move cannot stop the digest.
  met_m as (
    select m.act, m.landed_at, (m.ended ->> 'at')::timestamptz as end_at, m.payload #>> '{demand,kind}' as dkind,
           case when m.payload #>> '{demand,params,board}' ~ uuid_re then (m.payload #>> '{demand,params,board}')::uuid end as board,
           case when m.payload #>> '{demand,params,thread}' ~ uuid_re then (m.payload #>> '{demand,params,thread}')::uuid end as thread,
           case when m.payload #>> '{demand,params,character}' ~ uuid_re then (m.payload #>> '{demand,params,character}')::uuid end as character,
           case when m.payload #>> '{demand,params,a}' ~ uuid_re then (m.payload #>> '{demand,params,a}')::uuid end as a,
           case when m.payload #>> '{demand,params,b}' ~ uuid_re then (m.payload #>> '{demand,params,b}')::uuid end as b,
           m.payload #>> '{demand,params,quadrant}' as quadrant,
           case when m.payload #>> '{demand,params,count}' ~ '^[0-9]{1,9}$' then (m.payload #>> '{demand,params,count}')::integer end as cnt
    from moved m
    where m.state = 'ended' and m.ended ->> 'why' = 'met' and jsonb_typeof(m.payload -> 'demand') = 'object'
  ),
  -- Who met a move: the public, non-staff characters whose public Acts counted toward its demand, from the landing to the end. For the
  -- two board counts, whoever posted on the board in between, in the order they first did; for a quadrant, the authors of the posts whose
  -- public tallies counted, the most reacted first; for a post in a thread, the character named; for a crossQuote, the two. A staff
  -- character's Acts never count (the evaluator skips them) and are never listed. Only public relations, and never a reactor.
  met_credit as (
    select p.act, p.character, min(p.created_at) as first_at, 0::bigint as weight
    from (
      -- postsOnBoard: the posts demand_progress counted, the first `count` after the landing (oldest first, staff skipped), read as it
      -- reads them: the Acts in time order from the landing, limited to `count` matches (the header says what that does and doesn't
      -- bound). A post after the count was reached, before the tick noticed, is not the move's.
      select mm.act, x.character, x.created_at
      from met_m mm
      cross join lateral (
        select a.character, a.created_at
        from acts_public a
        join characters_public c on c.id = a.character
        where a.thread in (select tl.id from thread_list tl where tl.board = mm.board)
          and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
        order by a.created_at, a.id
        limit mm.cnt
      ) x
      where mm.dkind = 'postsOnBoard' and mm.cnt >= 1
    ) p
    group by p.act, p.character
    union all
    -- distinctCharactersOnBoard: the first `count` distinct characters to post after the landing, in the order they first did. Each step
    -- finds the next post, in time order from the previous step's, by a character not yet found; every post skipped on the way is by one
    -- already found (or a staff character), so the steps are the characters' first posts in order, and the walk reads the Acts up to the
    -- `count`th new character's first post and no further.
    select w.act, w.character, w.created_at, 0::bigint
    from (
      with recursive walk(act, board, end_at, cnt, n, character, created_at, id, found) as (
        select mm.act, mm.board, mm.end_at, mm.cnt, 0, null::uuid, mm.landed_at, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, '{}'::uuid[]
        from met_m mm
        where mm.dkind = 'distinctCharactersOnBoard' and mm.cnt >= 1
        union all
        select w.act, w.board, w.end_at, w.cnt, w.n + 1, x.character, x.created_at, x.id, w.found || x.character
        from walk w
        cross join lateral (
          select a.character, a.created_at, a.id
          from acts_public a
          join characters_public c on c.id = a.character
          where a.thread in (select tl.id from thread_list tl where tl.board = w.board)
            and a.kind = 'post' and a.created_at >= w.created_at and a.created_at <= w.end_at and (a.created_at, a.id) > (w.created_at, w.id)
            and a.character <> all (w.found) and c.staff is null
          order by a.created_at, a.id
          limit 1
        ) x
        where w.n < w.cnt
      )
      select * from walk where n >= 1
    ) w
    union all
    -- quadrantOnBoard: the public tally as it stands when the digest is built, not as of the move's end. A reaction after the end can raise
    -- it, and a public tally keeps no time per reaction (a reaction's time is private, and is never read here), so this credit may include
    -- an author a later reaction put in the quadrant.
    select mm.act, a.character, min(a.created_at), -sum(t.count)::bigint
    from met_m mm
    join thread_list tl on tl.board = mm.board
    join acts_public a on a.thread = tl.id
    join characters_public c on c.id = a.character
    join reaction_tallies_open t on t.act = a.id
    where mm.dkind = 'quadrantOnBoard' and reaction_quadrant(t.act, t.kind) = mm.quadrant
      and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
    group by mm.act, a.character
    having sum(t.count) > 0
    union all
    select mm.act, a.character, min(a.created_at), 0::bigint
    from met_m mm
    join acts_public a on a.thread = mm.thread and a.character = mm.character
    join characters_public c on c.id = a.character
    where mm.dkind = 'characterPostsInThread'
      and a.kind = 'post' and a.created_at > mm.landed_at and a.created_at <= mm.end_at and c.staff is null
    group by mm.act, a.character
    union all
    select mm.act, c.id, mm.landed_at, (case when c.id = mm.a then 0 else 1 end)::bigint
    from met_m mm
    join characters_public c on c.id in (mm.a, mm.b)
    where mm.dkind = 'crossQuote' and c.staff is null
  ),
  met_top as (
    select r.act, r.character, r.rank
    from (select x.act, x.character, row_number() over (partition by x.act order by x.weight, x.first_at, x.character) as rank from met_credit x) r
    where r.rank <= met_by_most
  ),
  -- The board lines: each open board that is not The System's, with the posts on it over the `board_days` days before the window's end, on the board each thread is on now
  -- (threads.board, which a move that landed has already changed). Public posts of public characters only, counted per board and read from nothing else: no owner,
  -- account, class or reaction. The count is one range of the partial index acts_posts_by_time and one primary-key read per thread's post, grouped by board; the lines are the
  -- number of boards, which a busy instance keeps small. When there are more than `board_cap`, the busiest half (the odd one too) and the quietest half; the numbering is over
  -- the ordered whole, so the two halves cannot overlap, and a cap the boards do not reach keeps them all.
  board_posts as (
    select tl.board, count(*)::integer as n
    from acts_public p join threads tl on tl.id = p.thread
    where p.kind = 'post' and p.character is not null and p.created_at >= until - make_interval(days => board_days) and p.created_at < until
    group by tl.board
  ),
  board_all as (
    select bn.id, left(bn.name, 120) as name, left(bn.premise, 200) as premise, coalesce(bp.n, 0) as n,
           row_number() over (order by coalesce(bp.n, 0) desc, bn.id) as rn, count(*) over () as total
    from boards_now bn left join board_posts bp on bp.board = bn.id
    where not bn.is_system and not bn.closed
  ),
  board_lines as (
    select x.id, x.name, x.premise, x.n, x.rn from board_all x
    where x.rn <= (board_cap + 1) / 2 or x.rn > x.total - board_cap / 2
  ),
  -- The conversations (0415): a persona's turns in one thread over the window, from pool_turns, each turn's post read through acts_public (a removed post is not a turn the digest shows) and its reactions the public
  -- total, as an excerpt's are. Ranked by the reactions, then the turns, then the thread and persona; cut to the setting. The persona is read through characters_public, so one that never debuted is not listed.
  turn_r as (
    select t.id as turn, t.thread, t.staff, t.at, t.post_act, t.quoting,
           (select coalesce(sum(rt.count), 0)::integer from reaction_tallies_open rt where rt.act = t.post_act) as reactions
    from pool_turns t join acts_public pa on pa.id = t.post_act
    -- `day` is the UTC day of the session a turn belongs to, which began no later than the turn; the day bounds (a day wider before, for a session that ran past midnight) let the (day) index serve the read, the `at` bounds make it exact.
    where t.day >= (since at time zone 'UTC')::date - 1 and t.day <= (until at time zone 'UTC')::date and t.at >= since and t.at < until
  ),
  conv as (
    select g.thread, g.staff, g.turns, g.reactions, left(tl.title, 120) as title, cp.id as persona
    from (select tr.thread, tr.staff, count(*)::integer as turns, sum(tr.reactions)::integer as reactions from turn_r tr group by tr.thread, tr.staff) g
    join thread_list tl on tl.id = g.thread
    join characters_public cp on cp.staff = g.staff
    order by g.reactions desc, g.turns desc, g.thread, g.staff
    limit conv_cap
  ),
  -- Who a conversation answered: the public authors of the replies its turns answered (pool_answered), the most answered first, at most 8.
  conv_with as (
    select x.thread, x.staff, x.character, x.name
    from (
      select c.thread, c.staff, r.character, cp.name, row_number() over (partition by c.thread, c.staff order by count(*) desc, r.character) as rn
      from conv c
      join turn_r tr on tr.thread = c.thread and tr.staff = c.staff
      join pool_answered pan on pan.turn = tr.turn
      join acts_public r on r.id = pan.reply
      join characters_public cp on cp.id = r.character
      group by c.thread, c.staff, r.character, cp.name
    ) x
    where x.rn <= 8
  ),
  -- The hottest exchange: the turn the crowd reacted to most (the later one on a tie) and the reply it quoted, each cut to the excerpt setting.
  conv_best as (
    select distinct on (c.thread, c.staff) c.thread, c.staff,
           left(pa.current_payload ->> 'body', chars) as turn_text, coalesce(length(pa.current_payload ->> 'body') > chars, false) as turn_cut,
           q.character as reply_by, left(q.current_payload ->> 'body', chars) as reply_text, coalesce(length(q.current_payload ->> 'body') > chars, false) as reply_cut
    from conv c
    join turn_r tr on tr.thread = c.thread and tr.staff = c.staff
    join acts_public pa on pa.id = tr.post_act
    join acts_public q on q.id = tr.quoting and q.character is not null
    order by c.thread, c.staff, tr.reactions desc, tr.at desc, tr.turn desc
  ),
  named as (
    select q_from as id from quoted union select q_to from quoted union select character from stand union select character from excerpted
    union select character from met_top
    union select persona from conv union select character from conv_with union select reply_by from conv_best
  )
  select jsonb_build_object(
    'since', since,
    'until', until,
    'threads', coalesce((select jsonb_agg(jsonb_build_object('thread', h.thread, 'title', h.title, 'board', (select bn.name from boards_now bn where bn.id = h.board_id), 'posts', h.posts,
                          'heat', h.heat, 'controversy', h.controversy, 'length', h.length)
                         order by h.posts desc, h.controversy desc, h.thread) from hot h), '[]'::jsonb),
    'boards', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'premise', l.premise, 'posts', l.n) order by l.rn) from board_lines l), '[]'::jsonb),
    'boardDays', board_days,
    'standings', coalesce((select jsonb_agg(jsonb_build_object('rank', s.rank, 'character', s.character, 'amount', s.amount) order by s.rank) from stand s), '[]'::jsonb),
    'moves', coalesce((select jsonb_agg(jsonb_build_object('act', m.act, 'kind', m.payload ->> 'kind', 'params', m.payload -> 'params',
                          'demand', m.payload -> 'demand', 'expiresAt', m.payload -> 'expires_at', 'landedAt', m.landed_at,
                          'progress', case when m.state = 'held' then null else demand_progress_or_error(m.act) end, 'ended', m.ended, 'state', m.state)
                          || case when m.state = 'held' then jsonb_build_object('heldAt', m.held_at, 'why', m.why) else '{}'::jsonb end
                          || case when m.state = 'ended' and m.ended ->> 'why' = 'met'
                                  then jsonb_build_object('metBy', coalesce((select jsonb_agg(t.character order by t.rank) from met_top t where t.act = m.act), '[]'::jsonb))
                                  else '{}'::jsonb end
                          order by m.grp, m.sort_at desc, m.act) from moved m), '[]'::jsonb),
    'quotes', coalesce((select jsonb_agg(jsonb_build_object('from', q.q_from, 'to', q.q_to, 'count', q.n) order by q.n desc, q.q_from, q.q_to) from quoted q), '[]'::jsonb),
    'bossReactions', coalesce((select jsonb_agg(jsonb_build_object('act', bt.act, 'thread', bt.thread, 'total', bt.total, 'tally', bt.tally) order by bt.total desc, bt.act) from boss_tally bt), '[]'::jsonb),
    'excerpts', coalesce((select jsonb_agg(jsonb_build_object('act', e.act, 'thread', e.thread, 'character', e.character, 'reactions', e.reactions, 'text', e.excerpt, 'cut', e.cut)
                          || coalesce((select jsonb_build_object('poll', jsonb_build_object('question', p.payload ->> 'question',
                                         'options', (select coalesce(jsonb_agg(jsonb_build_object('text', o.t, 'count', coalesce(c.counts[o.n::integer], 0)) order by o.n), '[]'::jsonb)
                                                     from jsonb_array_elements_text(p.payload -> 'options') with ordinality o(t, n)),
                                         'closed', c.closed))
                                       from (select a.id, a.payload from acts_public a where a.kind = 'poll' and a.target_act_id = e.act order by a.created_at desc, a.id desc limit 1) p
                                       join poll_counts c on c.poll = p.id), '{}'::jsonb)
                          order by e.reactions desc, e.created_at desc, e.act) from excerpted e), '[]'::jsonb),
    'conversations', coalesce((select jsonb_agg(jsonb_build_object('thread', c.thread, 'title', c.title, 'persona', jsonb_build_object('staff', c.staff, 'character', c.persona),
                          'with', coalesce((select jsonb_agg(jsonb_build_object('id', w.character, 'name', w.name) order by w.name, w.character) from conv_with w where w.thread = c.thread and w.staff = c.staff), '[]'::jsonb),
                          'turns', c.turns, 'reactions', c.reactions,
                          'exchange', (select jsonb_build_object('text', b.turn_text, 'cut', b.turn_cut, 'reply', jsonb_build_object('character', b.reply_by, 'text', b.reply_text, 'cut', b.reply_cut))
                                       from conv_best b where b.thread = c.thread and b.staff = c.staff))
                          order by c.reactions desc, c.turns desc, c.thread, c.staff) from conv c), '[]'::jsonb),
    'requests', requests_waiting(req_most),
    'requestsWaiting', requests_waiting_total(),
    'characters', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'name', cp.name, 'staff', cp.staff is not null and cp.office is distinct from 'anonymous',
                                                                'pronouns', (select p.pronouns from character_profiles p where p.character = cp.id)) order by cp.id)
                            from characters_public cp where cp.id in (select id from named)), '[]'::jsonb)
  ) into result;
  return result;
end $$;

revoke execute on function system_digest(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function system_digest(timestamptz, timestamptz) to service_role;


-- ------------------------------------------------------------------------------------------------ 4. the moderation log ----

-- Task 7 (design section 5). moves_log (0401_report_no_visit.sql) lists a staff member's requests too: a row of kind `request` for each request it ruled on (staff_requests_now), with the facts the screen words (the
-- glass's own, never the persona's or the Boss's text). Columns, rows and grants as 0401 left them; the one new branch is below. Masks: the row is the request post's public number, its thread and title (public), the
-- ruling, the office and the move's kind; never `asker`, which is a post's real author even where it is veiled, and nothing that reads who owns a character. At a busy instance's scale: one row per request the
-- staff member ruled on, read for the staff key the screen asks (a page of 20 by keyset), like every other branch.
create or replace view moves_log as
  select a.id, c.staff, a.payload ->> 'kind' as kind, a.payload -> 'params' as params, a.payload -> 'demand' as demand,
         move_expires_at(a.id) as expires_at, a.thread, a.created_at as at,
         e.payload ->> 'why' as ended_why, e.payload ->> 'by' as ended_by, e.created_at as ended_at,
         k.staff as kept_by, k.at as kept_at,
         bq.bundle, bq.role
  from characters c
  cross join lateral (select x.* from acts x where x.character = c.id and x.kind = 'move') a
  left join lateral (select x.* from acts x where x.kind = 'move_end' and x.target_act_id = a.id order by x.created_at desc, x.seq desc nulls last, x.id desc limit 1) e on true
  left join lateral (
    select kc.staff, ka.created_at as at from acts ka join characters kc on kc.id = ka.character
    where ka.kind = 'move_keep' and ka.target_act_id = a.id order by ka.created_at desc, ka.id desc limit 1
  ) k on true
  left join queued_moves bq on bq.landed_act = a.id
  where c.staff is not null
  union all
  select v.id, c.staff, 'visit'::text, jsonb_build_object('post', p.seq, 'rule', v.payload #>> '{charges,0,rule}', 'rule_number', v.payload #> '{charges,0,rule_number}', 'band', v.payload #>> '{charges,0,band}', 'cause', v.payload #>> '{charges,0,cause}'),
         null::jsonb, (v.payload ->> 'ends_at')::timestamptz, v.thread, v.created_at,
         case when e.payload ->> 'outcome' = 'reversed' and e.payload ->> 'by_act' is null then 'dropped' else e.payload ->> 'outcome' end, null::text, e.created_at, null::text, null::timestamptz, null::uuid, null::text
  from characters c
  join acts v on v.character = c.id and v.kind = 'visit'
  join acts p on p.id = v.target_act_id
  left join acts e on e.kind = 'visit_end' and e.target_act_id = v.id
  where c.staff is not null
  union all
  select d.id, c.staff, 'report'::text, jsonb_build_object('post', p.seq, 'verdict', d.payload ->> 'verdict', 'visited', d.payload ? 'visit_act'),
         null::jsonb, null::timestamptz, d.thread, d.created_at,
         d.payload ->> 'verdict', null::text, d.created_at, null::text, null::timestamptz, null::uuid, null::text
  from characters c
  join acts d on d.character = c.id and d.kind = 'report_verdict'
  join acts r on r.id = d.target_act_id
  join acts p on p.id = r.target_act_id
  where c.staff is not null
  union all
  select u.id, c.staff, 'appeal'::text,
         jsonb_build_object('post', (select x.seq from acts x where x.id = case when pu.kind = 'infraction' then (pu.payload ->> 'about_act')::uuid else (select (i.payload ->> 'about_act')::uuid from acts i where i.id = (pu.payload ->> 'infraction_act')::uuid) end),
                            'punishment', pu.kind, 'verdict', u.payload ->> 'verdict', 'points_delta', u.payload -> 'points_delta')
           || case when pu.kind = 'move' then jsonb_build_object('group', pu.payload #>> '{params,group}', 'until', u.payload ->> 'until') else '{}'::jsonb end,
         null::jsonb, null::timestamptz, u.thread, u.created_at,
         u.payload ->> 'verdict', null::text, u.created_at, null::text, null::timestamptz, null::uuid, null::text
  from characters c
  join acts u on u.character = c.id and u.kind = 'appeal_ruling'
  join acts ap on ap.id = u.target_act_id
  join acts pu on pu.id = ap.target_act_id
  where c.staff is not null
  union all
  -- A request the staff member ruled on (0424): what the code did with it, in facts. `post` is the request post's number in its thread, `title` the thread's, `ruling` the first ruling (fulfill, reject or confer), `by` the
  -- office that ruled it then ('boss' where the persona held the open season's seat at that moment, else 'mod'), `move_kind` the kind of the move a grant made, `ruled` the ruling now (null while a confer waits)
  -- and `lapses_at` when a waiting confer lapses. `ended_why` is the later ruling of a confer (fulfill, reject or lapsed), null while it waits and on a request ruled at once. Nothing a persona or the Boss wrote is here, and no asker.
  select q.request_act, q.staff, 'request'::text,
         jsonb_build_object('thread', q.thread, 'title', t.title, 'post', p.seq, 'ruling', q.first_ruling,
                            'by', case when exists (select 1 from seasons s where s.boss = q.staff and s.starts_at <= q.at and (s.ends_at is null or s.ends_at > q.at)) then 'boss' else 'mod' end,
                            'move_kind', (select m.kind from queued_moves m where m.id = q.move),
                            'ruled', case when q.waiting then null else q.ruling end, 'lapses_at', q.lapses_at),
         null::jsonb, null::timestamptz, q.thread, q.at,
         case when q.first_ruling = 'confer' and not q.waiting then q.ruling end, null::text, case when q.first_ruling = 'confer' and not q.waiting then q.ruled_at end, null::text, null::timestamptz, null::uuid, null::text
  from staff_requests_now q
  join threads t on t.id = q.thread
  join acts p on p.id = q.request_act;
