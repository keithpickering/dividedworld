-- A later meeting's silence displaces nothing (docs/plans/2026-11-06-fangame-split-plan.md, Task 8, review).
--
-- apply_meeting (0190) wrote a row with a null farewell when a later in-window meeting gave only a note, and that row stood as the season's latest, so a real farewell gave way to the stock
-- line. The new row now carries the latest row's farewell where this meeting gave none, and its note where it gave none. Done here and not in a trigger: an import inserts rows in replica mode,
-- and must not have them changed. Everything else as 0190 wrote it.
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
    -- A kind the Boss does not use yet (its persona holds it back until a beat unlocks, 0186) is skipped and recorded, and costs nothing: the engine drops it too, and the database holds the line.
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

  -- The farewell and the handoff (0180), kept only from a meeting within farewellWindowHours of the season's end: the engine's repair already dropped them from any other, and the database holds
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
      from (select 1) one left join handoffs_latest x on x.season = season_id;
    end if;
  end if;

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
      -- What was actually played (0188): the engine's `beatsDefaulted` and its `playedWithDefaults` trims say what it meant to play, and are kept only for the beats this transaction played.
      'beatsPlayed', to_jsonb(beats_played),
      'beatsDefaulted', coalesce((select jsonb_agg(d.k) from jsonb_array_elements_text(case when jsonb_typeof(payload #> '{record,beatsDefaulted}') = 'array' then payload #> '{record,beatsDefaulted}' else '[]'::jsonb end) d(k) where d.k = any (beats_played)), '[]'::jsonb),
      'trims', coalesce((select jsonb_agg(x.t order by x.n) from jsonb_array_elements(case when jsonb_typeof(payload #> '{record,trims}') = 'array' then payload #> '{record,trims}' else '[]'::jsonb end) with ordinality x(t, n)
                         where not (x.t ->> 'predicate' = 'playedWithDefaults' and not ((regexp_replace(coalesce(x.t ->> 'path', ''), '^beats\.', '')) = any (beats_played)))), '[]'::jsonb),
      'heldBackSkipped', held_skipped,
      'bundlesSkipped', bundles_skipped,
      'handoffTrims', hf_trims,
      'handoffSkipped', hf_skipped,
      'patrolsWritten', jsonb_build_object('written', pat_n, 'skipped', pat_skipped)));
  return jsonb_build_object('status', 'applied', 'meeting', apply_meeting.meeting, 'queued', jsonb_array_length(kept_moves) + queued_n, 'beats_played', to_jsonb(beats_played), 'bank_before', bal, 'bank_after', bal2 - spent - handed,
    'returned', returned, 'handed', handed);
end $$;
