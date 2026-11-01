-- The tick: The System's standing orders, every minute (the system plan, Task 10; the system design, sections 2, 3 and 7).
--
-- system_tick() does two things and calls no model:
--
--   1. While `systemEnabled` is true, it LANDS each queued move whose go_live_at has passed that is neither held nor landed, in
--      go_live order, by writing the move Act through write_staff_act as the move's own staff member, in the announcements
--      thread, with the stock line for it as its body, and setting `landed_act` on the queue row.
--   2. Whatever `systemEnabled` says ("landed moves still end by the tick": a switch that stranded a rename would be a trap), it
--      ENDS each move in force: past its `expires_at` it ends `expired` (by `expiry`); else if demand_progress says met, `met`
--      (by `demand`). The Boss says the end in the announcements thread, in the stock line for it, as a post.
--
-- What it reads, and what that costs: due queue rows (partial index queued_moves_due, only rows still waiting) and the moves in
-- force (open_moves, a handful of rows, each probed in acts by primary key). Neither read touches a move that has landed and
-- ended, so the tick costs the same however many moves an instance has made (supabase/tests/0052-tick.sql holds the plans).
--
-- Pacing the demand checks. Expiry is a comparison and is checked for every move in force every minute. A demand's progress is a read
-- of the Acts since the move landed (measured at about 18 ms a move at 20,000 posts since landing, with some 200 moves possibly in force),
-- and the tick is one transaction, so an overrun would roll back every end. So a demand is checked only for a move whose `checked_at`
-- (open_moves, derived state) is null or older than the setting `demandCheckMinutes` (default 5), the least recently checked first,
-- at most `demandChecksPerTick` (default 40) a tick, and the tick stops checking when its own clock passes a budget (20 seconds, or
-- the transaction setting `kayfabb.tick_budget_seconds`, which a test sets) and carries on next minute. A player feels it as a met demand
-- ending within about demandCheckMinutes, longer when more moves are in force than the cap checks in that time. Nothing is skipped for
-- good: a move's turn comes, and its expiry never waits for it.
--
-- Safe to run twice, or two at once. A second tick that finds one running returns at once (a transaction advisory lock); and
-- each landing locks its queue row `for update skip locked` and each end goes through end_move, which is idempotent, so a move
-- lands once and ends once whatever interleaves. One move that cannot land, or whose progress errors, never stops the rest: each
-- runs in its own subtransaction and the error is a warning in the log. A move that cannot land is tried again every minute (the
-- failure is a fact about the request, not a transport hiccup, so there is no cap to count toward) and is recorded on its queue row
-- (`failed_at`, `failure`, overwritten by the latest), where the admin queue shows it so an admin can hold it. A move whose progress
-- errors is checked again when its turn comes, is not ended by its demand, and still expires.
-- The result says what it did: landed, met, expired, failed, checked (demands read), `budget` (it ran out of time checking) and
-- `noThread` (it is on but there is no announcements thread to land a move in, so nothing landed).
--
-- Choices:
--   * A queued move whose Boss is no longer the season's Boss still lands, as its own staff member. The meeting that chose it
--     made a decision; skipping it would leave a queued row nothing can end (a trap), and the handover (Task 12b) is where a
--     Boss's inherited moves are reviewed or ended, not the tick.
--   * A move that expires before it lands is written and ended in the same tick (as `expired`): the record shows the whole story.
--   * The end of a move is said by the move's Boss, in the move's own thread, once (only the call that wrote the move_end speaks).
--     If the post fails the move stays ended: the move_end is the record, the line is color.
--   * The stock lines are the instance's, carried as the setting `systemLines` (an object: line key -> list of lines, one chosen
--     at random); the plain words for `{move}` are the setting `systemMoveWords` (an object: move kind -> a phrase in which
--     `{param}` is filled from the move's string params). The tick names no instance and no kind of its own. A line missing
--     falls back to the move's plain words alone.
--
-- Re-enabling The System lands every due structural row at once, as intended: the admin queue shows such rows as waiting, and an admin
-- can hold the ones they do not want before switching The System back on.
--
-- Its way out: a queued move lands at its time or is held by an admin; a landed one ends when its demand is met, at its expiry, or
-- by an admin's reversal. Switching The System off strands none of them.


-- ------------------------------------------------------------------------------- the lines ----

-- Fills `{token}`s in a template from an object of values, in ONE pass: the template is scanned once, left to right, and the text put in
-- for a token is never scanned again, so a value that itself reads `{boss}` or `{premise}` (a name a model chose) stays as typed. A token
-- with no value stays as written.
create function fill_tokens(template text, vals jsonb) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  rest text := coalesce(template, '');
  out text := '';
  m text[];
begin
  loop
    m := regexp_match(rest, '^(.*?)\{(\w+)\}(.*)$', 's');
    exit when m is null;
    out := out || m[1] || case when jsonb_typeof(vals -> m[2]) = 'string' then vals ->> m[2] else '{' || m[2] || '}' end;
    rest := m[3];
  end loop;
  return out || rest;
end $$;
revoke execute on function fill_tokens(text, jsonb) from public, anon, authenticated;

-- A stock line for a standing order, its tokens filled: `{move}` the move kind's plain words (systemMoveWords, with the move's
-- string params in them), `{boss}` the staff member's name, `{board}` the move's board as boards_now calls it now. Each fill is a single
-- pass (fill_tokens): words in a param are put in once and never read as tokens, in the plain words or in the line. A move kind with no
-- plain words reads "a move"; when the instance has no line for the key, the move's plain words stand alone.
create function system_line(line_key text, move_kind text, params jsonb, staff_key text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lines jsonb;
  words text;
  line text;
  boss_name text;
  board_name text := '';
begin
  select s.value -> line_key into lines from settings s where s.key = 'systemLines';
  select s.value ->> move_kind into words from settings s where s.key = 'systemMoveWords';
  words := coalesce(words, 'a move');
  if jsonb_typeof(params) = 'object' then
    words := fill_tokens(words, params);
    if lower(params ->> 'board') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      board_name := coalesce((select b.name from boards_now b where b.id = (params ->> 'board')::uuid), '');
    end if;
  end if;
  select c.name into boss_name from characters c where c.staff = staff_key;
  if jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0 and jsonb_typeof(lines -> 0) = 'string' then
    line := lines ->> floor(random() * jsonb_array_length(lines))::integer;
  else
    return words;
  end if;
  return fill_tokens(line, jsonb_build_object('boss', coalesce(boss_name, ''), 'board', board_name, 'move', words));
end $$;
revoke execute on function system_line(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function system_line(text, text, jsonb, text) to service_role;

-- The Boss says a move has ended, in the move's own thread, as a post in the stock line for it (`moveMet`, `moveExpired`,
-- `moveReversed`). The move is ended whether or not the line is posted: the move_end is the record, the line is color, so a failure
-- is a warning and never an error. The tick and the admin's reversal (0048) both say an end this way, and only the call that wrote
-- the move_end calls it.
create function say_move_end(move_act uuid, why text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m record;
begin
  select a.thread, a.payload, c.staff into m from acts a join characters c on c.id = a.character where a.id = move_act and a.kind = 'move';
  perform write_staff_act(m.staff, 'post', m.thread, null, jsonb_build_object('body',
    system_line(case why when 'met' then 'moveMet' when 'reversed' then 'moveReversed' else 'moveExpired' end, m.payload ->> 'kind', m.payload -> 'params', m.staff)));
exception when others then
  raise warning 'say_move_end: the end of move % was not said: % (%)', move_act, sqlerrm, sqlstate;
end $$;
revoke execute on function say_move_end(uuid, text) from public, anon, authenticated;
grant execute on function say_move_end(uuid, text) to service_role;

-- ------------------------------------------------------------------------------- the tick ----

-- The owner of this function reads demand_progress_or_error, which is the digest role's and granted to the service role alone (0045).
do $$ begin execute format('grant execute on function demand_progress_or_error(uuid) to %I', current_user); end $$;

create function system_tick() returns jsonb
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
  progress jsonb;
  expires timestamptz;
  did_end boolean;
  landed integer := 0;
  met integer := 0;
  expired integer := 0;
  failed integer := 0;
  checked integer := 0;
  out_of_time boolean := false;
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

  -- 3. Demands: the moves least recently checked, at most `cap`, none checked within `check_every`, and none once the budget is spent.
  -- A move with no demand is never read. `checked_at` is set before the read, so a move whose progress errors takes its turn like the
  -- rest instead of holding the front of the line.
  for inforce in
    select o.move_act, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act where jsonb_typeof(a.payload -> 'demand') = 'object' and (o.checked_at is null or o.checked_at <= now() - check_every) order by o.checked_at nulls first, o.move_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    update open_moves set checked_at = now() where move_act = inforce.move_act;
    checked := checked + 1;
    did_end := false;
    begin
      progress := demand_progress_or_error(inforce.move_act);
      if coalesce((progress ->> 'met')::boolean, false) then
        did_end := (end_move(inforce.move_act, 'met', 'demand') ->> 'ended')::boolean;
        if did_end then met := met + 1; end if;
      end if;
    exception when others then
      failed := failed + 1;
      did_end := false;
      raise warning 'system_tick: move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
    end;
    -- The Boss says it. The move is ended whether or not the line is posted.
    if did_end then perform say_move_end(inforce.move_act, 'met'); end if;
  end loop;

  return jsonb_build_object('landed', landed, 'met', met, 'expired', expired, 'failed', failed, 'checked', checked, 'budget', out_of_time,
    'noThread', enabled and ann is null);
end $$;
revoke execute on function system_tick() from public, anon, authenticated;
grant execute on function system_tick() to service_role;

-- ---------------------------------------------------------------------------- the schedule ----

-- Every minute, with no setting of its own: the switch is checked inside the tick, since the tick ends moves even while it is off.
-- Scheduled when the instance's `systemEnabled` setting is first written or changed (a seed does that), as 0018 schedules the view
-- counts, and once now for an instance that already holds it. tools/import-instance.mjs schedules it again after an import.
create function schedule_system_tick() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return cron.schedule('kayfabb-system-tick', '* * * * *', 'select public.system_tick()');
end $$;

create function settings_reschedule_system_tick() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform schedule_system_tick();
  return null;
end $$;
create trigger settings_reschedule_system_tick after insert or update on settings
  for each row when (new.key = 'systemEnabled') execute function settings_reschedule_system_tick();
revoke execute on function schedule_system_tick(), settings_reschedule_system_tick() from public, anon, authenticated;
select schedule_system_tick() where exists (select 1 from settings where key = 'systemEnabled');

-- ---------------------------------------------------------------------------------- the seed ----

-- seed_instance (0046), also making the announcements thread. Everything else as 0046 wrote it.
create or replace function seed_instance(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  flags integer;
  flagged text;
  unknown text;
begin
  -- Two seeds at once would each find no hire row and both write one into append-only staff_changes. An advisory
  -- transaction lock serializes seeds without locking any table a player reads, and lets go at commit.
  perform pg_advisory_xact_lock(hashtext('kayfabb.seed_instance'));
  select count(*), min(e ->> 'slug') into flags, flagged
  from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false);
  if flags > 1 then raise exception 'a seed flags one board as The System''s, not %', flags using errcode = '22023'; end if;
  -- The economy is merged, number by number: a card kind is never removed, so the price of one
  -- the code no longer sells stays in the row with it (settings_economy_whole, 0006).
  insert into settings (key, value) select key, value from jsonb_each(payload -> 'settings')
  on conflict (key) do update set value = case when settings.key = 'economy' then settings.value || excluded.value else excluded.value end;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  insert into reaction_kinds (key, emoji, quadrant) select e ->> 'key', e ->> 'emoji', e ->> 'quadrant' from jsonb_array_elements(payload -> 'reactions') e
  on conflict (key) do update set emoji = excluded.emoji, quadrant = excluded.quadrant;
  -- A card's stack, whether it is seeded and the economy numbers its rules read are the code's, as its name and price are.
  insert into card_kinds (key, name, alignment, price_setting, stack, seeded, reads)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', e ->> 'priceSetting', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}')
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment, price_setting = excluded.price_setting,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads;
  -- The flag leaves the board that held it before another takes it, so the index never sees two.
  -- A seed naming one slug twice is refused by the upsert ("cannot affect row a second time"),
  -- where 0004 took its first; an instance never holds one (instanceProblems).
  if flagged is not null then update boards set is_system = false where is_system and slug <> flagged; end if;
  insert into boards (slug, name, description, is_system)
  select e ->> 'slug', e ->> 'name', coalesce(e ->> 'description', ''), coalesce(e ->> 'slug' = flagged, false) from jsonb_array_elements(payload -> 'boards') e
  on conflict (slug) do update set is_system = true where excluded.is_system and not boards.is_system;
  -- A pip style is added or renamed, never removed: a profile may name it.
  insert into pip_styles (key, name, full_image, empty_image)
  select e ->> 'key', e ->> 'name', e ->> 'full', e ->> 'empty' from jsonb_array_elements(coalesce(payload -> 'pipStyles', '[]')) e
  on conflict (key) do update set name = excluded.name, full_image = excluded.full_image, empty_image = excluded.empty_image;
  -- The instance's staff (0042), once each: a Boss or a Mod Bot is made when its key has no character yet, debuted at
  -- seed time, with the profile its seed gives (its title and its signature, cut to what a profile holds). What an admin
  -- wrote is never written over: a reseed finds the key and does nothing. A bot in firstStaff with no staff_changes row
  -- is hired; one with a row, a fired bot's included, is left as that row says.
  with seeded as (
    select e ->> 'key' as staff, e ->> 'name' as name, e ->> 'kind' as kind, coalesce(e ->> 'title', '') as title, coalesce(e ->> 'signature', '') as signature
    from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  ), made as (
    insert into characters (name, staff, staff_kind, debuted_at) select s.name, s.staff, s.kind, now() from seeded s
    on conflict (staff) do nothing returning id, staff
  )
  insert into character_profiles (character, title, signature)
  select m.id, left(s.title, 40), left(s.signature, 500) from made m join seeded s on s.staff = m.staff;
  select string_agg(k, ', ') into unknown from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from characters c where c.staff = k and c.staff_kind = 'bot');
  if unknown is not null then raise exception 'firstStaff names %, which no bot in the seed''s staff is', unknown using errcode = '22023'; end if;
  insert into staff_changes (staff, on_staff)
  select k, true from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from staff_changes x where x.staff = k);
  -- The catalogs (0045): the moves and demands the engine holds, as the engine lists them. A reseed upserts a move's flag and
  -- never removes a kind, since a landed move may name it. A missing flag is a seed's mistake (a move that reshapes a board
  -- must not be seeded as one that does not), so it is refused by the column.
  insert into move_kinds (key, structural) select e ->> 'key', (e ->> 'structural')::boolean from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural;
  insert into demand_kinds (key) select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'demands', '[]')) e
  on conflict (key) do nothing;
  if not exists (select 1 from seasons) then insert into seasons (number, starts_at) values (1, now()); end if;
  -- The open season's Boss (0042's seasons.boss) is the seed's firstBoss when it has none: a season opened before a Boss
  -- existed, or by this seed. A season that already has a Boss keeps it.
  if nullif(payload -> 'system' ->> 'firstBoss', '') is not null then
    update seasons set boss = payload -> 'system' ->> 'firstBoss' where ends_at is null and boss is null;
  end if;
  -- The announcements thread: the one thread on The System's board where a landed move is written and a move's end is said. Made once,
  -- titled from the seed (`system.announcementsTitle`), and its id recorded in the setting `systemAnnouncements` where the tick finds it.
  -- A reseed finds the setting (and the thread it names) and makes nothing; a seed with no title makes none, and until a seed has one
  -- the tick lands nothing (a board with nowhere to say a move is no board it can move). The setting is not in a seed's `settings`,
  -- so no seed writes it over.
  if nullif(payload -> 'system' ->> 'announcementsTitle', '') is not null
     and not exists (select 1 from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'systemAnnouncements') then
    with made as (
      insert into threads (board, title) values (system_board(), payload -> 'system' ->> 'announcementsTitle') returning id
    )
    insert into settings (key, value) select 'systemAnnouncements', to_jsonb(made.id::text) from made
    on conflict (key) do update set value = excluded.value;
  end if;
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;
