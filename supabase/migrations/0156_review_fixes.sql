-- Review fixes for the lasting board moves (plan Task 2).
--
-- 1. apply_meeting (0140) ran no check on the three lasting kinds, so a mergeBoard into a board already merged away, a cycle, a moveThread onto a closed board or a closed fallback raised in
--    the queue's guard and lost every other move in the answer. It now runs lasting_move_problem for them (and refuses a demand, which a lasting move cannot carry), skips the move and records
--    it as `lastingSkipped` ({index, why}) on the meeting's record, as a machine move is. meeting_context (0140) leaves a closed board out of its board list (chosen over marking it closed:
--    the model is never offered a board it could not rename, merge into or move a thread onto, and the engine's "is a board the meeting was given" drops then follow without a change to it).
-- 2. A superseded moveThread restored by the reversal of its superseder is in force again (0153 puts its board back in the thread's place), so open_moves, and with it the admin queue's list of
--    moves in force, shows it and an admin can find it to reverse it. move_thread_effective(thread) is the latest moveThread of the thread not ended reversed or overturned: the move the
--    thread's place reads. acts_track_moves (0046) keeps open_moves to it: a move_end of a moveThread takes that move out and puts the effective one in if it has no end but a
--    supersession; a moveThread landing takes out the restored ones it supersedes (the tick ends the ones with no end). rebuild_open_moves (0046) derives the same rows from the Acts.
--    Derived from the ends, append-only.
-- 3. boards_now (0152) called board_merge_into, and a function in a view is checked against the role that reads the view (only the view's tables are the owner's), so anon, authenticated and the
--    digest role were refused (permission denied for function board_merge_into) whenever a board was read. It now reads the merge inline, as the view's own tables, so no role needs execute on a
--    helper and the helpers stay the service role's. 0158 reads boards_now as each role and the board index as a signed-in player; 0050, 0051 and 0057 read the digest.

create function move_thread_effective(in_thread uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id from acts a
  where a.kind = 'move' and a.payload ->> 'kind' = 'moveThread' and lower(a.payload #>> '{params,thread}') = in_thread::text
    and not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = a.id and e.payload ->> 'why' in ('reversed', 'overturned'))
  order by a.created_at desc, a.seq desc nulls last, a.id desc limit 1
$$;
revoke execute on function move_thread_effective(uuid) from public, anon, authenticated;
grant execute on function move_thread_effective(uuid) to service_role;

-- acts_track_moves (0046), also keeping a restored moveThread in force. Everything else as 0046 wrote it.
create or replace function acts_track_moves() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target_kind text;
  th uuid;
  eff uuid;
begin
  if new.kind = 'move' then
    insert into open_moves (move_act, landed_at) values (new.id, new.created_at);
    if new.payload ->> 'kind' = 'moveThread' then
      delete from open_moves o using acts a
      where o.move_act = a.id and a.id <> new.id and a.payload ->> 'kind' = 'moveThread' and lower(a.payload #>> '{params,thread}') = lower(new.payload #>> '{params,thread}')
        and exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = a.id and e.payload ->> 'why' = 'superseded');
    end if;
  else
    delete from open_moves where move_act = new.target_act_id;
    select a.payload ->> 'kind', safe_uuid(a.payload #>> '{params,thread}') into target_kind, th from acts a where a.id = new.target_act_id;
    if target_kind = 'moveThread' and th is not null then
      eff := move_thread_effective(th);
      if eff is not null and not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = eff and e.payload ->> 'why' <> 'superseded') then
        insert into open_moves (move_act, landed_at) select a.id, a.created_at from acts a where a.id = eff on conflict (move_act) do nothing;
      end if;
    end if;
  end if;
  return null;
end $$;

-- rebuild_open_moves (0046), the same rows from the Acts: a move with no end, and a moveThread ended only as superseded that is its thread's effective move.
create or replace function rebuild_open_moves() returns integer
language sql security definer set search_path = public, pg_temp as $$
  with live as (
    select a.id, a.created_at from acts a
    where a.kind = 'move' and (
      not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = a.id)
      or (a.payload ->> 'kind' = 'moveThread'
          and not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = a.id and e.payload ->> 'why' <> 'superseded')
          and a.id = move_thread_effective(safe_uuid(a.payload #>> '{params,thread}'))))
  ), gone as (
    delete from open_moves o where not exists (select 1 from live l where l.id = o.move_act) returning 1
  ), added as (
    insert into open_moves (move_act, landed_at) select l.id, l.created_at from live l on conflict (move_act) do nothing returning 1
  )
  select ((select count(*) from gone) + (select count(*) from added))::integer
$$;

-- meeting_context (0140), leaving a closed board out of its board list. Everything else as 0140 wrote it.
create or replace function meeting_context() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'season', (select jsonb_build_object('startsAt', (extract(epoch from s.starts_at) * 1000)::bigint,
        'endsAt', (extract(epoch from coalesce(s.ends_at, s.starts_at + span_interval(setting('seasonLength')))) * 1000)::bigint)
      from seasons s where s.ends_at is null order by s.starts_at desc limit 1),
    'boss', current_boss(),
    'lastSlot', (select m.slot from meetings m where m.outcome in ('ok', 'failed', 'rejected') order by m.slot desc limit 1),
    'boards', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name, b.id)
      from (select n.id, n.name from boards_now n where not n.is_system and not n.closed order by n.name, n.id limit 50) b), '[]'),
    'successors', to_jsonb(array(select r from unnest(boss_roster()) with ordinality x(r, ord) where r is distinct from current_boss() order by x.ord)),
    'inheritanceDue', coalesce((select jsonb_agg(jsonb_build_object('act', d.act, 'kind', d.payload ->> 'kind', 'params', d.payload -> 'params',
        'landedAt', d.landed_at, 'expiresAt', d.payload -> 'expires_at', 'by', d.author, 'boardName', d.board_name) order by d.landed_at, d.act)
      from inheritance_due(current_boss(), 20) d), '[]'),
    -- The Mods on staff: what the Boss's meeting needs to order each (its latest order, the allowance it has not spent, and so what returns to the bank).
    'mods', coalesce((select jsonb_agg(jsonb_build_object('key', n.staff, 'since', n.since, 'allowance', order_unspent(n.staff), 'granted', o.allowance,
        'boards', coalesce(to_jsonb(o.boards), '[]'::jsonb), 'order', o.order_line) order by n.staff)
      from staff_now n left join lateral (select x.allowance, x.boards, x.order_line from staff_orders x where x.staff = n.staff order by x.id desc limit 1) o on true), '[]'),
    -- The rules in force, so the meeting drops a rule that would leave no compliant post before the queue would refuse it.
    'rules', coalesce((select jsonb_agg(jsonb_build_object('board', r.board, 'predicate', r.predicate, 'param', r.param, 'number', r.number) order by r.board nulls last, r.number)
      from rules_now r), '[]'),
    -- The groups (member groups design, section 5): the catalog a move may confer, and the characters the meeting may not choose. A character is held while a group move is
    -- in force on it or queued and not held (the guard's one-at-a-time rule), and capped while staff_punishments is at the cap; each is listed with the group it is in now.
    -- Only those two kinds are listed, which a busy instance keeps to a handful; every other character is in its earned group and free to be chosen.
    'groups', jsonb_build_object(
      'conferred', coalesce((select jsonb_agg(jsonb_build_object('key', g.key, 'name', g.name, 'tone', g.tone) order by g.tone desc, g.key) from group_kinds g where g.source = 'conferred'), '[]'),
      'characters', group_move_bars()),
    -- The machine, so the Boss can name a slot: the admins' own word on each (hidden ones too, for a flash sale), whether a pull of it could land, and the Boss's move
    -- in force on it. Slots and moves only: no purchase, no buyer, nothing computed from who owns what.
    'machine', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'position', s.position, 'card', s.card, 'pack', s.pack, 'availability', s.availability, 'price', s.price,
        'pullable', s.card is not null and s.availability = 'onSale' and card_in_open_pack(s.card),
        'move', (select jsonb_build_object('kind', m.kind, 'act', m.move_act) from machine_moves_open m where m.slot = s.id order by m.landed_at desc, m.move_act desc limit 1)) order by s.position)
      from (select x.* from machine_slots x order by x.position limit 60) s), '[]'))
$$;

-- apply_meeting (0140), skipping and recording a lasting move the queue would refuse. Everything else as 0140 wrote it.
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
  bal := bank_now(boss, (payload ->> 'weekly_moves')::numeric, (payload ->> 'bank_cap')::numeric);
  if bal is null then raise exception 'a meeting names the phase''s weekly_moves and bank_cap' using errcode = '22023'; end if;

  -- The moves: a kind outside the catalog raises; a rule the queue would refuse is skipped and recorded, and costs nothing.
  for mv in select value from jsonb_array_elements(coalesce(payload -> 'moves', '[]')) loop
    idx := idx + 1;
    select * into kind_row from move_kinds k where k.key = mv ->> 'kind';
    if not found then raise exception 'there is no move kind "%"', mv ->> 'kind' using errcode = '23514'; end if;
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
  if spent > floor(bal2) then
    raise exception 'the moves cost % and the bank holds %', spent, bal2 using errcode = '23514';
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

  -- Only debuted public characters are named: the engine checks this too, and the database keeps it whatever the caller sent.
  if jsonb_typeof(memory) = 'object' then
    memory := jsonb_set(jsonb_set(memory, '{opinions}', public_entries(memory -> 'opinions')), '{grudges}', public_entries(memory -> 'grudges'));
  end if;
  insert into staff_memory (staff, meeting, body) values (boss, apply_meeting.meeting, memory);
  insert into staff_profiles (staff, meeting, interests, favorites, mood, signature)
  values (boss, apply_meeting.meeting,
    array(select jsonb_array_elements_text(coalesce(payload -> 'profile' -> 'interests', '[]'))),
    array(select f.id from (select case when t.f ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then t.f::uuid end as id, min(t.ord) as ord from jsonb_array_elements_text(coalesce(payload -> 'profile' -> 'favorites', '[]')) with ordinality t(f, ord) group by 1) f
      where f.id in (select c.id from characters_public c) order by f.ord),
    coalesce(payload -> 'profile' ->> 'mood', ''), coalesce(payload -> 'profile' ->> 'signature', ''));

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

  -- An answer that left a persona with an order out
  -- carries it forward: its beat (less what another order claimed, and nothing once it is off staff) and its line, with an allowance of 0, because
  -- what it had was returned above. After this meeting every persona with an order has its latest from it.
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
    insert into staff_orders (meeting, staff, boards, order_line, allowance)
    values (apply_meeting.meeting, who,
      case when exists (select 1 from staff_now n where n.staff = who) then array(select x from unnest(prev.boards) x where x <> all (claimed)) else '{}' end,
      prev.order_line, 0);
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

  insert into move_bank (staff, balance, as_of) values (boss, bal2 - spent - handed, now())
  on conflict (staff) do update set balance = excluded.balance, as_of = excluded.as_of;
  perform close_meeting(apply_meeting.meeting, 'ok', null, bal, bal2 - spent - handed,
    coalesce(payload -> 'record', '{}') || jsonb_build_object(
      'handover', jsonb_build_object('kept', kept, 'ended', ended_n, 'skipped', skipped, 'nominated', nominated),
      'allowances', jsonb_build_object('returned', returned, 'handed', handed, 'orders', jsonb_array_length(planned), 'skipped', orders_skipped, 'clamped', clamped, 'trimmed', trimmed),
      'rulesSkipped', rules_skipped,
      'machineSkipped', machine_skipped,
      'lastingSkipped', lasting_skipped,
      'patrolsWritten', jsonb_build_object('written', pat_n, 'skipped', pat_skipped)));
  return jsonb_build_object('status', 'applied', 'meeting', apply_meeting.meeting, 'queued', spent, 'bank_before', bal, 'bank_after', bal2 - spent - handed,
    'returned', returned, 'handed', handed);
end $$;

-- boards_now (0152), the merge read inline, so no reader needs execute on a helper function. Columns and rows as 0152 wrote them.
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
  left join lateral (
    select d.id as merged_into from acts a join boards d on d.id::text = lower(a.payload #>> '{params,into}')
    where a.kind = 'move' and a.payload ->> 'kind' = 'mergeBoard' and lower(a.payload #>> '{params,board}') = b.id::text
      and exists (select 1 from open_moves o where o.move_act = a.id)
    order by a.created_at desc, a.id desc limit 1
  ) g on true;
