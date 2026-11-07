-- Patrols and the targeting cap (the Mod Bots design, section 8, "A busy instance" and "What could slip a mask"; its plan, Task 11).
--
-- A patrol is the Boss's meeting sending a Mod to look at its beat: `patrols(meeting, n, staff, at, ran_at, sampled, dropped, outcome)`, written by apply_meeting from the answer's
-- `patrols` (kept on the meeting's record by meet/core.ts; this file validates them again: a Mod on staff, a time moved into today, cut to `patrolsPerDay`) in the meeting's own
-- transaction, so a retried meeting ("already applied") writes none twice and (meeting, n) is unique besides. A patrol is not an Act and has none; it is bookkeeping, and the
-- visits it draws are the Acts.
--
--   patrol_sample(boards, most)   the newest `most` posts by players on the given boards (the Mod's beat), not by staff and not under any visit (open or ended), newest first:
--                                 per board its `most` most recently active listed threads, per thread its `most` newest posts, so the read is bounded by the beat's boards (a
--                                 handful, 50 at most) and by `most`, however big the instance is. OWNED BY kayfabb_digest (the pinned list in supabase/tests/0050-digest.sql):
--                                 it reads acts_public, characters_public and thread_list only, so the database itself refuses it who owns a character, a class and who reacted.
--                                 It takes the beat's boards, not the Mod: the digest role cannot read the orders (mod_standing, which the staff function already read, names them).
--   board_premises(boards)        the name and the premise of each board as the players see them now (the patrol's prompt is told them).
--   claim_patrol()                the service's: the oldest due patrol (at <= now, ran_at null) is claimed in one statement (ran_at set, skip locked), so a retry or two runs
--                                 never judge it twice. A patrol lost to a crash after its claim is a lost sampling, never a double judgment.
--   patrol_record(patrol, sampled, outcome)   what the patrol read and what came of it, on its row.
--   record_patrol_call(patrol, staff, record)   the call's record (trims, drops), keyed by the patrol: `staff_call_records` gains `cause_patrol`, and `cause_act` may be null
--                                 when it is set (a patrol has no Act to be caused by).
--   staff_punishments(character, days)   the punishments staff chose for one character: visits whose charge came from a patrol or from a backfire, that filed (an infraction
--                                 names the visit) or are still open (they will land unless talked down, so a cap cannot be passed by visits in flight). Read from public Acts
--                                 and the open-visit set; a rule's visit, a player's report and a tail do not count. Infractions are found by the character's own index.
--   start_visit (cause 'patrol')  refuses past `cap.punishments` in `cap.days` (returns {visit: null, capped: true}, writes no Act) and records the drop on the patrol's row
--                                 (the charge carries `patrol_id`), once per post. Nothing is shown to anyone. The count and the visit are one decision under the character's lock.
--
-- The cap counts patrol and backfire visits filed or still open (so visits in flight count, and one later talked down frees its slot), less any whose infraction an appeal overturned.
--
-- Masks. The cap counts public punishments of one character; the sample and the record read public play; no function here reads an owner, a class or a reactor.
-- Ways out. A character at the cap has nothing to escape: staff cannot choose it until the window passes. A patrol is never anyone's state.
-- Budget. A patrol's call is a ledger row of duty patrolJudge, which judgment_calls_today already counts (0105).

-- ---------------------------------------------------------------------------------------------------- the patrols ----

create table patrols (
  id bigint generated always as identity primary key,
  meeting bigint not null references meetings (id),
  -- Its place in the meeting's answer, among the patrols kept: a retry of the write conflicts here and writes nothing.
  n integer not null check (n >= 1),
  staff text not null references characters (staff),
  at timestamptz not null,
  ran_at timestamptz,
  -- The posts the Mod was shown, and the findings dropped ([{post, why, ...}]: the cap, a post not in the sample).
  sampled uuid[] not null default '{}',
  dropped jsonb not null default '[]' check (jsonb_typeof(dropped) = 'array'),
  -- What came of it, in the record's words ({findings, visits, skipped, ...}).
  outcome jsonb not null default '{}' check (jsonb_typeof(outcome) = 'object'),
  unique (meeting, n)
);
create index patrols_due on patrols (at, id) where ran_at is null;
alter table patrols enable row level security;
revoke all on patrols from public, anon, authenticated;

-- A patrol has no Act, so its call's record is keyed by the patrol.
alter table staff_call_records drop constraint staff_call_records_pkey;
alter table staff_call_records alter column cause_act drop not null;
alter table staff_call_records add column cause_patrol bigint references patrols (id);
alter table staff_call_records add constraint staff_call_records_one_cause check (num_nonnulls(cause_act, cause_patrol) = 1);
create unique index staff_call_records_by_act on staff_call_records (cause_act, duty, staff, attempt) where cause_act is not null;
create unique index staff_call_records_by_patrol on staff_call_records (cause_patrol, duty, staff, attempt) where cause_patrol is not null;

-- ------------------------------------------------------------------------------------------------------ the sample ----

create index acts_patrol_posts on acts (thread, created_at desc, id desc) where kind in ('post', 'spin');

create function patrol_sample(boards uuid[], most integer) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('act', s.id, 'thread', s.thread, 'title', s.title, 'board', s.board, 'name', s.name, 'body', s.body) order by s.created_at desc, s.id desc), '[]'::jsonb)
  from (
    select a.id, a.thread, a.created_at, th.title, th.board, c.name, coalesce(a.current_payload ->> 'body', '') as body
    from unnest(coalesce(boards, '{}'::uuid[])) with ordinality b(id, ord)
    cross join lateral (select t.id, t.title, t.board from thread_list t where t.board = b.id order by t.last_at desc, t.id desc limit greatest(patrol_sample.most, 0)) th
    cross join lateral (
      select p.id, p.thread, p.character, p.created_at, p.current_payload
      from acts_public p
      where p.thread = th.id and p.kind in ('post', 'spin')
        and not exists (select 1 from acts_public v where v.kind = 'visit' and v.target_act_id = p.id)
      order by p.created_at desc, p.id desc limit greatest(patrol_sample.most, 0)
    ) a
    join characters_public c on c.id = a.character and c.staff is null
    where b.ord <= 50
    order by a.created_at desc, a.id desc
    limit greatest(patrol_sample.most, 0)
  ) s
$$;
revoke execute on function patrol_sample(uuid[], integer) from public, anon, authenticated;
grant execute on function patrol_sample(uuid[], integer) to service_role;
-- The digest role's, as pool_thread is (0089): the owner change needs the role to hold create on the schema while it happens, and the grant is taken back at once.
grant create on schema public to kayfabb_digest;
alter function patrol_sample(uuid[], integer) owner to kayfabb_digest;
revoke create on schema public from kayfabb_digest;

-- The boards of a sample, as the players see them now (a rename changes a premise): what the patrol's prompt is told of each. Public facts of boards only.
create function board_premises(boards uuid[]) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'premise', b.premise) order by b.name, b.id), '[]'::jsonb)
  from boards_now b where b.id = any (coalesce(board_premises.boards, '{}'::uuid[])) and not b.is_system
$$;
revoke execute on function board_premises(uuid[]) from public, anon, authenticated;
grant execute on function board_premises(uuid[]) to service_role;

-- ----------------------------------------------------------------------------------------------------- the cap ----

create function staff_punishments(who uuid, days integer) returns integer
language sql security definer set search_path = public, pg_temp as $$
  select (
    (select count(*) from acts i join acts v on v.id = (i.payload ->> 'visit_act')::uuid
     where i.kind = 'infraction' and i.payload ->> 'character' = who::text and i.created_at >= clock_timestamp() - make_interval(days => greatest(staff_punishments.days, 0))
       and not exists (select 1 from acts a join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
                       where a.kind = 'appeal' and a.target_act_id = i.id and r.payload ->> 'verdict' = 'overturned')
       and v.kind = 'visit' and v.payload #>> '{charges,0,cause}' in ('patrol', 'backfire'))
    +
    (select count(*) from visits_open o join acts v on v.id = o.visit_act join acts p on p.id = o.post
     where p.character = who and v.created_at >= clock_timestamp() - make_interval(days => greatest(staff_punishments.days, 0))
       and v.payload #>> '{charges,0,cause}' in ('patrol', 'backfire'))
  )::integer
$$;
revoke execute on function staff_punishments(uuid, integer) from public, anon, authenticated;
grant execute on function staff_punishments(uuid, integer) to service_role;

-- start_visit (0106), a patrol's finding also meeting the targeting cap. Everything else as 0106 wrote it.
create or replace function start_visit(post_act uuid, staff text, charge jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p record;
  ch jsonb;
  open_visit uuid;
  held jsonb;
  top text;
  same boolean;
  ends timestamptz;
  written uuid;
  joined uuid;
  sprung jsonb;
  cap jsonb;
  patrol bigint;
begin
  select a.id, a.thread, t.board, a.character as author, c.staff is not null as by_staff into p
  from acts a join threads t on t.id = a.thread join characters c on c.id = a.character where a.id = post_act and a.kind in ('post', 'spin');
  if not found then raise exception 'there is no such post to visit' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if p.by_staff then return null; end if;
  if jsonb_typeof(charge) is distinct from 'object' or charge ->> 'band' is null or charge ->> 'band' not in ('minor', 'moderate', 'severe') or charge ->> 'cause' is null or charge ->> 'cause' not in ('rule', 'report', 'patrol', 'tail', 'backfire') then
    raise exception 'a charge names its band and its cause' using errcode = '22023';
  end if;
  ch := jsonb_strip_nulls(jsonb_build_object('predicate', charge -> 'predicate', 'rule', charge -> 'rule')) || jsonb_build_object(
    'rule_number', coalesce(charge -> 'rule_number', 'null'::jsonb), 'board', coalesce(charge ->> 'board', p.board::text), 'band', charge ->> 'band', 'cause', charge ->> 'cause',
    'about_act', coalesce(charge ->> 'about_act', post_act::text));
  -- One decision per post at a time: two charges drawn at once meet here, and the second joins.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.visit:' || post_act::text, 0));
  -- The targeting cap (the Mod Bots design, section 8): a patrol's finding is refused for a character that staff has already punished `cap.punishments` times in `cap.days`
  -- (staff_punishments, from public Acts: patrol findings and backfires that landed or are still open). Nothing is shown to anyone; the drop is recorded on the patrol's
  -- row, once per post. Only a patrol's choice meets it: a rule break, a player's report and a tail are never refused. The character's own lock makes the count and the
  -- visit one decision, so two patrols at once do not both pass a cap with room for one.
  if ch ->> 'cause' = 'patrol' then
    perform pg_advisory_xact_lock(hashtextextended('kayfabb.cap:' || p.author::text, 0));
    cap := coalesce((select s.value -> 'cap' from settings s where s.key = 'modBots'), '{"punishments": 3, "days": 7}'::jsonb);
    if staff_punishments(p.author, (cap ->> 'days')::integer) >= (cap ->> 'punishments')::integer then
      if charge ->> 'patrol_id' ~ '^[0-9]{1,18}$' then
        patrol := (charge ->> 'patrol_id')::bigint;
        update patrols x set dropped = x.dropped || jsonb_build_array(jsonb_build_object('post', post_act, 'why', 'cap', 'staff', start_visit.staff))
        where x.id = patrol and not x.dropped @> jsonb_build_array(jsonb_build_object('post', post_act::text, 'why', 'cap'));
      end if;
      return jsonb_build_object('visit', null, 'capped', true);
    end if;
  end if;
  -- The open row is taken for update: a filing (or any end) holding it makes this wait, and then it finds the visit gone and decides afresh, never joining a visit that
  -- has ended.
  select o.visit_act into open_visit from visits_open o where o.post = post_act for update;
  same := visit_charge_repeats(post_act, ch);
  if same then
    return case when open_visit is not null then jsonb_build_object('visit', open_visit, 'joined', false) else jsonb_build_object('visit', null, 'repeat', true) end;
  end if;
  if open_visit is not null then
    -- A second charge joins; the band the visit holds is the highest of its charges.
    held := visit_charges(open_visit);
    top := (select c ->> 'band' from jsonb_array_elements(held || jsonb_build_array(ch)) c
            order by case c ->> 'band' when 'severe' then 3 when 'moderate' then 2 else 1 end desc limit 1);
    joined := (write_staff_act(staff, 'visit_join', p.thread, open_visit, jsonb_build_object('charge', ch, 'band', top)) ->> 'id')::uuid;
    return jsonb_build_object('visit', open_visit, 'joined', true, 'join', joined);
  end if;
  ends := now() + visit_window(post_act, staff);
  written := (write_staff_act(staff, 'visit', p.thread, post_act, jsonb_build_object(
    'charges', jsonb_build_array(ch), 'ends_at', ends, 'challenge', visit_challenge(post_act, staff), 'line', visit_line('visitArrived', staff, jsonb_build_array(ch)))) ->> 'id')::uuid;
  -- A trap set on the post springs when a visit starts on it, and the sprung trap ends the visit (trapped, by the spring): its Acts stay.
  sprung := spring_traps('visit', post_act, written);
  if sprung is not null then
    perform end_visit(written, 'trapped', (sprung ->> 'id')::uuid, 'A trap set on this post sprang as the visit began, and the visit ended.');
  end if;
  return jsonb_build_object('visit', written, 'joined', false, 'ends_at', ends) || case when sprung is not null then jsonb_build_object('sprung', sprung) else '{}'::jsonb end;
end $$;

revoke execute on function start_visit(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function start_visit(uuid, text, jsonb) to service_role;

-- ------------------------------------------------------------------------------------------------------- the run ----

create function claim_patrol() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare p patrols%rowtype;
begin
  select * into p from patrols x where x.ran_at is null and x.at <= clock_timestamp() order by x.at, x.id limit 1 for update skip locked;
  if not found then return null; end if;
  update patrols set ran_at = clock_timestamp() where id = p.id;
  return jsonb_build_object('id', p.id, 'meeting', p.meeting, 'staff', p.staff, 'at', p.at);
end $$;
revoke execute on function claim_patrol() from public, anon, authenticated;
grant execute on function claim_patrol() to service_role;

create function patrol_record(patrol bigint, sampled uuid[], outcome jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update patrols set sampled = coalesce(patrol_record.sampled, '{}'), outcome = coalesce(patrol_record.outcome, '{}'::jsonb) where id = patrol_record.patrol;
  if not found then raise exception 'there is no patrol %', patrol_record.patrol using errcode = 'P0002'; end if;
end $$;
revoke execute on function patrol_record(bigint, uuid[], jsonb) from public, anon, authenticated;
grant execute on function patrol_record(bigint, uuid[], jsonb) to service_role;

create function record_patrol_call(patrol bigint, staff text, record jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.call_record.patrol.' || record_patrol_call.patrol::text || record_patrol_call.staff, 0));
  select count(*) + 1 into n from staff_call_records r where r.cause_patrol = record_patrol_call.patrol and r.duty = 'patrolJudge' and r.staff = record_patrol_call.staff;
  insert into staff_call_records (cause_act, cause_patrol, duty, staff, record, attempt) values (null, record_patrol_call.patrol, 'patrolJudge', record_patrol_call.staff, record_patrol_call.record, n);
  return jsonb_build_object('recorded', true, 'attempt', n);
end $$;
revoke execute on function record_patrol_call(bigint, text, jsonb) from public, anon, authenticated;
grant execute on function record_patrol_call(bigint, text, jsonb) to service_role;

-- --------------------------------------------------------------------------------------------------- the meeting ----

-- apply_meeting (0101), also writing the patrols of the answer's record. Everything else as 0101 wrote it.
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
      'patrolsWritten', jsonb_build_object('written', pat_n, 'skipped', pat_skipped)));
  return jsonb_build_object('status', 'applied', 'meeting', apply_meeting.meeting, 'queued', spent, 'bank_before', bal, 'bank_after', bal2 - spent - handed,
    'returned', returned, 'handed', handed);
end $$;

revoke execute on function apply_meeting(bigint, jsonb) from public, anon, authenticated;
grant execute on function apply_meeting(bigint, jsonb) to service_role;
