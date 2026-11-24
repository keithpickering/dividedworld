-- Staff requests (docs/plans/2026-11-24-staff-requests-plan.md; docs/plans/2026-11-24-staff-requests-design.md). The plan numbered this NNNN; 0423 was reserved for another PR when it was built. One migration, in sections, each
-- added by the task that needs it.
--
--   1. A Mod's moveThread (Task 1; design section 2). move_kinds.offices for moveThread becomes boss and mod (an instance seeded earlier keeps the Boss's alone until this runs; seed_instance writes it from the catalog
--      for one seeded after). apply_mod_move (0136) skips the expiry clamp for a lasting kind and queues it with expires_at null (the guard has kept none on a lasting move since 0320). queued_moves_guard (0335) holds a
--      Mod's moveThread to two boards: the thread's board now (thread_place, 0407) and the board it goes to must each be on the Mod's beat (beat_of), and each refusal says which. A Mod's moveThread spends one of its
--      allowance, as any Mod move does. The Boss's moveThread is as it was.
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
