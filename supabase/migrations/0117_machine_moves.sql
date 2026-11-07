-- The Boss's three moves on the machine (docs/plans/2026-11-04-booster-packs-design.md, section 6; its plan, Task 4).
--
-- Pull, Reprice and Flash sale are moves in the catalog The System already has (engine/system/moves.ts): an effect from the code's fixed list with limits, a hard
-- expiry, a demand where it punishes. Each lands on the Boss's schedule as a move Act, and an admin can reverse it. What the machine shows is COMPUTED from the
-- Acts, as a board's name is (boards_now, 0046): nothing is written to machine_slots, so ending a move brings the slot back with nothing rewritten.
--
--   machine_limit(name)           one of the economy's `machine.*` numbers, the engine's own default where the row lacks it (engine/rules/packs.ts MACHINE_DEFAULTS; the
--                                 engine falls back the same way, so the meeting and the database never disagree about a bound).
--   card_in_open_pack(card)       whether a pack on sale can still give the card: the floor under a Pull ("packs are the floor"). Reads the packs' pulls and leave-outs the
--                                 way roll_pack does.
--   machine_moves_open            the machine moves in force, one row each (read from open_moves, a handful of rows, and the move's Act by its key). Not a client's.
--   machine_move_problem(...)     what is wrong with a machine move, or null. The same words are the queue guard's (the params, the demand, the bounds) and the tick's at
--                                 landing (the machine as it is then: the slot, its availability, the card in a pack on sale, the pulls in force, one move per slot, one flash
--                                 sale at a time). A move failing it at landing is refused for good with the reason (`queued_moves.refused_at`, as a rule is): it is never an
--                                 Act, so it is never applied and there is nothing to reverse.
--   machine_now (0115)            also applies the moves in force and carries them (`move`, last): a Pull makes a slot sold out; a Reprice sets round(price * percent / 100),
--                                 at least 1; a Flash sale lists its hidden slot as on sale. An admin's sold out or hidden wins over a Pull and a Reprice, and the moved price is the
--                                 admin's CURRENT price times the factor. `move` is {kind, act, ends, demand, progress, was, percent, hours}: the demand as the move's Act holds it and
--                                 its stored progress as move_progress (0053) reads it, `was` the admin's price.
--   queued_moves_guard (0106)     also refuses a machine move whose params, demand or bounds are wrong.
--   system_tick (0105)            also refuses at landing a machine move the machine can no longer take.
--   meeting_context (0103)        also carries `machine`: the slots (hidden ones too, for a flash sale), whether a pull could land, the Boss's move on each.
--
-- Cost: machine_now costs the slots times the machine moves in force, never the purchases; the meeting reads at most 60 slots.
-- Masks: the machine and the moves over it are public and the same for every caller, computed from slots and public move Acts. The Boss's read has no purchase in it.
-- Ways out: a Pull and a markup end by their demand, their expiry (at most `machine.moveDaysMost` days) or an admin's reverse; a markdown and a flash sale by their expiry or an
-- admin. A pulled card is in a pack on sale the whole time, because a Pull of one that is not is refused at landing. No state is added to a player, a character or a post.

-- ------------------------------------------------------------------------------------------------- the numbers ----

create function machine_limit(name text) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((setting('economy') ->> ('machine.' || machine_limit.name))::numeric, case machine_limit.name
    when 'pullMost' then 2 when 'moveDaysMost' then 7 when 'repriceLeast' then 50 when 'repriceMost' then 200
    when 'flashHoursLeast' then 24 when 'flashHoursMost' then 48 end)
$$;
revoke execute on function machine_limit(text) from public, anon, authenticated;
grant execute on function machine_limit(text) to service_role;

-- Whether a pack on sale (an admin's availability, the slot's own) can still give the card: the card is not one it leaves out, and one of its pulls rolls the card's rarity.
create function card_in_open_pack(card text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1
    from card_kinds c
    join machine_slots s on s.pack is not null and s.availability = 'onSale'
    join pack_kinds p on p.key = s.pack
    where c.key = card_in_open_pack.card
      and c.key <> all (p.leaves)
      and exists (select 1 from jsonb_array_elements(p.pulls) e where (e -> 'weights') ? c.rarity)
  )
$$;
revoke execute on function card_in_open_pack(text) from public, anon, authenticated;
grant execute on function card_in_open_pack(text) to service_role;

-- --------------------------------------------------------------------------------------------- the moves in force ----

-- The machine moves in force, one row each: the slot they name, their kind, when they landed and end, their numbers, and their demand with its stored count. The moves in force are
-- read once, from open_moves, with the Act probed by its primary key (as boards_now does), so the plan cannot become a walk of the Acts. A move that has ended is not in
-- open_moves, so it is not here. The slot is read only from a well-formed uuid, so a malformed Act never raises in a reader.
create view machine_moves_open as
  with live as materialized (
    select o.move_act, o.landed_at, o.progress, o.checked_at, a.payload
    from open_moves o
    cross join lateral (select x.payload from acts x where x.id = o.move_act offset 0) a
    where a.payload ->> 'kind' in ('pullSlot', 'repriceSlot', 'flashSale')
  )
  select case when l.payload #>> '{params,slot}' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then lower(l.payload #>> '{params,slot}')::uuid end as slot,
         l.move_act, l.payload ->> 'kind' as kind, l.landed_at, (l.payload ->> 'expires_at')::timestamptz as expires_at,
         case when jsonb_typeof(l.payload #> '{params,percent}') = 'number' then (l.payload #>> '{params,percent}')::numeric end as percent,
         case when jsonb_typeof(l.payload #> '{params,hours}') = 'number' then (l.payload #>> '{params,hours}')::numeric end as hours,
         case when jsonb_typeof(l.payload -> 'demand') = 'object' then l.payload -> 'demand' end as demand,
         case when jsonb_typeof(l.payload -> 'demand') is distinct from 'object' then null
              when l.progress is null then jsonb_build_object('checkedAt', null)
              else l.progress || jsonb_build_object('checkedAt', l.checked_at) end as progress
  from live l;
revoke all on machine_moves_open from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------ the limits ----

-- What is wrong with a machine move, or null. `landing` adds what only the machine as it is now can say. A kind that is no machine move has nothing wrong here.
-- The words are plain and the same for every caller: they name no buyer and no private fact.
create function machine_move_problem(kind text, params jsonb, demand jsonb, go_live timestamptz, expires timestamptz, landing boolean) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  target machine_slots%rowtype;
  days numeric := machine_limit('moveDaysMost');
  pct numeric;
  hrs numeric;
  lo numeric;
  hi numeric;
begin
  if kind is null or kind not in ('pullSlot', 'repriceSlot', 'flashSale') then return null; end if;
  if jsonb_typeof(params -> 'slot') is distinct from 'string' or (params ->> 'slot') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return 'a machine move names a slot of the machine';
  end if;
  select * into target from machine_slots s where s.id = lower(params ->> 'slot')::uuid;
  if not found then return 'the machine has no such slot'; end if;
  if expires is null then return 'a machine move has an expiry'; end if;
  if expires > go_live + (days * 24) * interval '1 hour' then return format('a machine move lasts at most %s days', days); end if;

  if kind = 'pullSlot' then
    if jsonb_typeof(demand) is distinct from 'object' then return 'a pull carries a demand the characters can meet'; end if;
  elsif kind = 'repriceSlot' then
    if jsonb_typeof(params -> 'percent') is distinct from 'number' or (params ->> 'percent')::numeric <> trunc((params ->> 'percent')::numeric) then return 'a reprice names a whole percent'; end if;
    pct := (params ->> 'percent')::numeric;
    lo := machine_limit('repriceLeast');
    hi := machine_limit('repriceMost');
    if pct < lo then return format('a reprice is at least %s percent', lo); end if;
    if pct > hi then return format('a reprice is at most %s percent', hi); end if;
    if pct = 100 then return 'a reprice of 100 percent changes nothing'; end if;
    if pct > 100 and jsonb_typeof(demand) is distinct from 'object' then return 'a markup carries a demand the characters can meet'; end if;
    if pct < 100 and demand is not null then return 'a markdown carries no demand'; end if;
  else
    if jsonb_typeof(params -> 'hours') is distinct from 'number' or (params ->> 'hours')::numeric <> trunc((params ->> 'hours')::numeric) then return 'a flash sale names whole hours'; end if;
    hrs := (params ->> 'hours')::numeric;
    lo := machine_limit('flashHoursLeast');
    hi := machine_limit('flashHoursMost');
    if hrs < lo then return format('a flash sale lasts at least %s hours', lo); end if;
    if hrs > hi then return format('a flash sale lasts at most %s hours', hi); end if;
    if demand is not null then return 'a flash sale carries no demand'; end if;
    if expires <> go_live + hrs * interval '1 hour' then return 'a flash sale lasts its hours and no longer'; end if;
  end if;

  if not landing then return null; end if;

  -- The machine as it is now.
  if expires <= now() then return 'it ran out before it could land'; end if;
  if exists (select 1 from machine_moves_open m where m.slot = target.id) then return 'the slot already has a move in force'; end if;
  if kind = 'pullSlot' then
    if target.card is null then return 'a pack is never pulled'; end if;
    if target.availability <> 'onSale' then return 'only a slot on sale is pulled'; end if;
    if not card_in_open_pack(target.card) then return 'no pack on sale can still give that card'; end if;
    if (select count(*) from machine_moves_open m where m.kind = 'pullSlot') >= machine_limit('pullMost') then
      return format('at most %s slots are pulled at once', machine_limit('pullMost'));
    end if;
  elsif kind = 'repriceSlot' then
    if target.availability <> 'onSale' then return 'only a slot on sale is repriced'; end if;
  else
    if target.availability <> 'hidden' then return 'a flash sale opens a slot an admin hid'; end if;
    if exists (select 1 from machine_moves_open m where m.kind = 'flashSale') then return 'one flash sale runs at a time'; end if;
  end if;
  return null;
end $$;
revoke execute on function machine_move_problem(text, jsonb, jsonb, timestamptz, timestamptz, boolean) from public, anon, authenticated;
grant execute on function machine_move_problem(text, jsonb, jsonb, timestamptz, timestamptz, boolean) to service_role;

-- ------------------------------------------------------------------------------------ the queue's guard ----

-- queued_moves_guard (0106), also holding a machine move to its params, its demand and its bounds. Everything else as 0106 wrote it.
create or replace function queued_moves_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  params_ok boolean;
  problem text;
  holder text;
  watched uuid;
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
    -- The Boss's three moves on the machine (0117): the params, the demand and the bounds, from the move and the economy alone. What the machine looks like when
    -- the move lands is checked then, by the tick, which refuses a move that cannot (a meeting that read the machine a day earlier is not failed for it).
    if new.kind in ('pullSlot', 'repriceSlot', 'flashSale') then
      if jsonb_typeof(new.params -> 'slot') = 'string' then new.params := jsonb_set(new.params, '{slot}', to_jsonb(lower(new.params ->> 'slot'))); end if;
      problem := machine_move_problem(new.kind, new.params, new.demand, new.go_live_at, new.expires_at, false);
      if problem is not null then raise exception 'a machine move is refused: %', problem using errcode = '23514'; end if;
    end if;
    if new.kind = 'nameSuccessor' then
      if new.demand is not null or new.expires_at is not null then raise exception 'a nomination has no demand and no expiry' using errcode = '23514'; end if;
      if jsonb_typeof(new.params -> 'boss') is distinct from 'string'
         or not (new.params ->> 'boss' = any (boss_roster())) then
        raise exception 'a nomination names a persona on the Boss roster, not a benched or retired one' using errcode = '23514';
      end if;
      if new.params ->> 'boss' = new.staff then raise exception 'a Boss does not name itself' using errcode = '23514'; end if;
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

-- system_tick (0105), also refusing at landing a machine move the machine can no longer take (queued_moves.refused_at, as for a rule). Everything else as 0105 wrote it.
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
  checked integer := 0;
  out_of_time boolean := false;
  superseded integer := 0;
  filed integer := 0;
  tries integer;
  late record;
  filing_grace interval := make_interval(mins => coalesce((select (s.value #>> '{filingGraceMinutes}')::integer from settings s where s.key = 'modBots'), 10));
  boss text := current_boss();
  season_start timestamptz := (select x.starts_at from seasons x where x.ends_at is null);
  grace interval := make_interval(days => coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'inheritanceGraceDays'), 3));
begin
  if not pg_try_advisory_xact_lock(hashtext('kayfabb.system_tick')) then return jsonb_build_object('skipped', true); end if;

  -- 1. Landing: only while The System is on, and only where there is a thread to say it in.
  if enabled and ann is not null then
    for due in
      select q.id, q.staff, q.kind, q.params, q.demand, q.expires_at, q.admin_description from queued_moves q where q.landed_act is null and q.held_at is null and q.refused_at is null and q.go_live_at <= now() order by q.go_live_at, q.id for update skip locked
    loop
      begin
        -- Two rules that conflict may have waited together; the one that lands second meets the first. It is refused for good, with the reason.
        if due.kind = 'setRule' then
          clash := rule_conflict(nullif(due.params ->> 'board', '')::uuid, due.params ->> 'predicate', nullif(due.params -> 'param', 'null'::jsonb));
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that rule would leave no post that follows the rules: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
        end if;
        -- The machine's moves are checked against the machine as it is now (0117): a slot an admin has since changed, a card no pack on sale can give, a pull too many.
        -- Refused for good with the reason, as a rule is, and never applied: it is no Act, so nothing was put on the machine and nothing needs reversing.
        if due.kind in ('pullSlot', 'repriceSlot', 'flashSale') then
          clash := machine_move_problem(due.kind, due.params, due.demand, (select q.go_live_at from queued_moves q where q.id = due.id), due.expires_at, true);
          if clash is not null then
            update queued_moves set failed_at = now(), failure = left('that machine move cannot land: ' || clash, 500), refused_at = now() where id = due.id;
            continue;
          end if;
        end if;
        written := (write_staff_act(due.staff, 'move', ann, null,
          jsonb_build_object('kind', due.kind, 'params', due.params, 'body', system_line(case when due.kind = 'setRule' then 'ruleSet' else 'moveLanded' end, due.kind, due.params, due.staff))
          || case when due.demand is not null then jsonb_build_object('demand', due.demand) else '{}'::jsonb end
          || case when due.expires_at is not null then jsonb_build_object('expires_at', due.expires_at) else '{}'::jsonb end) ->> 'id')::uuid;
        update queued_moves set landed_act = written where id = due.id;
        if due.kind = 'renameBoard' and due.admin_description is not null then
          perform write_describe((due.params ->> 'board')::uuid, due.admin_description, written);
        end if;
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
      -- The ceiling: a visit that cannot be filed after `visit_file_attempts_most` tries is dropped (reversed, no infraction), so it is never stuck for good.
      if coalesce(tries, 1) >= 10 then
        begin
          perform end_visit(late.visit_act, 'reversed', null, 'This visit could not be filed and was dropped.');
        exception when others then
          raise warning 'system_tick: visit % could not be dropped: % (%)', late.visit_act, sqlerrm, sqlstate;
        end;
      end if;
    end;
  end loop;

  return jsonb_build_object('landed', landed, 'met', met, 'expired', expired, 'superseded', superseded, 'failed', failed, 'checked', checked, 'visits', filed, 'budget', out_of_time,
    'noThread', enabled and ann is null);
end $$;

-- ------------------------------------------------------------------------------------- the meeting's read ----

-- meeting_context (0103), also carrying `machine`. Everything else as 0103 wrote it.
create or replace function meeting_context() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'season', (select jsonb_build_object('startsAt', (extract(epoch from s.starts_at) * 1000)::bigint,
        'endsAt', (extract(epoch from coalesce(s.ends_at, s.starts_at + span_interval(setting('seasonLength')))) * 1000)::bigint)
      from seasons s where s.ends_at is null order by s.starts_at desc limit 1),
    'boss', current_boss(),
    'lastSlot', (select m.slot from meetings m where m.outcome in ('ok', 'failed', 'rejected') order by m.slot desc limit 1),
    'boards', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name, b.id)
      from (select n.id, n.name from boards_now n where not n.is_system order by n.name, n.id limit 50) b), '[]'),
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
    -- The machine, so the Boss can name a slot: the admins' own word on each (hidden ones too, for a flash sale), whether a pull of it could land, and the Boss's move
    -- in force on it. Slots and moves only: no purchase, no buyer, nothing computed from who owns what.
    'machine', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'position', s.position, 'card', s.card, 'pack', s.pack, 'availability', s.availability, 'price', s.price,
        'pullable', s.card is not null and s.availability = 'onSale' and card_in_open_pack(s.card),
        'move', (select jsonb_build_object('kind', m.kind, 'act', m.move_act) from machine_moves_open m where m.slot = s.id order by m.landed_at desc, m.move_act desc limit 1)) order by s.position)
      from (select x.* from machine_slots x order by x.position limit 60) s), '[]'))
$$;

-- ----------------------------------------------------------------------------------------------- the machine ----

-- machine_now (0115), the moves laid over it. A slot an admin made sold out stays so, and a hidden one stays hidden unless a flash sale is open on it, whatever a Pull or a Reprice
-- says: the admin's word wins. A Reprice moves the price of a slot that is on sale, from the admin's price as it is now. `move` is added last, so readers of the columns before it
-- keep working. One row per slot (the newest move, should two ever be in force).
create or replace view machine_now as
  select s.id as slot, s.position, s.card, s.pack, k.rarity,
         case
           when s.availability = 'soldOut' then 'soldOut'
           when s.availability = 'hidden' then case when mv.kind = 'flashSale' then 'onSale' else 'hidden' end
           when mv.kind = 'pullSlot' then 'soldOut'
           else 'onSale'
         end as availability,
         case when s.availability = 'onSale' and mv.kind = 'repriceSlot' and mv.percent is not null then greatest(1, round(s.price * mv.percent / 100.0)::integer) else s.price end as price,
         case when mv.move_act is null then null
              else jsonb_build_object('kind', mv.kind, 'act', mv.move_act, 'ends', mv.expires_at, 'demand', mv.demand, 'progress', mv.progress, 'was', s.price,
                                      'percent', mv.percent, 'hours', mv.hours) end as move
  from machine_slots s
  left join card_kinds k on k.key = s.card
  left join (select distinct on (m.slot) m.* from machine_moves_open m where m.slot is not null order by m.slot, m.landed_at desc, m.move_act desc) mv on mv.slot = s.id
  where s.availability <> 'hidden' or mv.kind = 'flashSale';
