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
-- ended, so the tick costs the same however many moves an instance has made (supabase/tests/0052-tick.sql holds both plans).
--
-- Safe to run twice, or two at once. A second tick that finds one running returns at once (a transaction advisory lock); and
-- each landing locks its queue row `for update skip locked` and each end goes through end_move, which is idempotent, so a move
-- lands once and ends once whatever interleaves. One move that cannot land, or whose progress errors, never stops the rest: each
-- runs in its own subtransaction, the error is a warning in the log, and the move is met again at the next minute. (A move whose
-- progress errors is not ended by its demand, but it still expires.)
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
-- Its way out: a queued move lands at its time or is held by an admin; a landed one ends when its demand is met, at its expiry, or
-- by an admin's reversal. Switching The System off strands none of them.


-- ------------------------------------------------------------------------------- the lines ----

-- A stock line for a standing order, its tokens filled: `{move}` the move kind's plain words (systemMoveWords, with the move's
-- string params in them), `{boss}` the staff member's name, `{board}` the move's board as boards_now calls it now. Words in a param
-- are put in last and never read as tokens. When the instance has no line for the key, the move's plain words stand alone.
create function system_line(line_key text, move_kind text, params jsonb, staff_key text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  lines jsonb;
  words text;
  line text;
  k text;
  v text;
  boss_name text;
  board_name text := '';
begin
  select s.value -> line_key into lines from settings s where s.key = 'systemLines';
  select s.value ->> move_kind into words from settings s where s.key = 'systemMoveWords';
  words := coalesce(words, move_kind);
  if jsonb_typeof(params) = 'object' then
    for k, v in select e.key, e.value from jsonb_each_text(params) e where jsonb_typeof(params -> e.key) = 'string' loop
      words := replace(words, '{' || k || '}', v);
    end loop;
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
  line := replace(line, '{boss}', coalesce(boss_name, ''));
  line := replace(line, '{board}', board_name);
  return replace(line, '{move}', words);
end $$;
revoke execute on function system_line(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function system_line(text, text, jsonb, text) to service_role;

-- ------------------------------------------------------------------------------- the tick ----

-- The owner of this function reads demand_progress_or_error, which is the digest role's and granted to the service role alone (0045).
do $$ begin execute format('grant execute on function demand_progress_or_error(uuid) to %I', current_user); end $$;

create function system_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  enabled boolean := coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'systemEnabled'), false);
  ann uuid := (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements');
  due record;
  inforce record;
  written uuid;
  why text;
  ended_by text;
  progress jsonb;
  expires timestamptz;
  staff_key text;
  did_end boolean;
  landed integer := 0;
  met integer := 0;
  expired integer := 0;
  failed integer := 0;
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
      end;
    end loop;
  end if;

  -- 2. Ending: whatever the switch says. Expiry is a comparison; progress is read only for a move not yet expired.
  for inforce in
    select o.move_act, a.character, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act order by o.landed_at, o.move_act
  loop
    why := null; did_end := false;
    begin
      expires := (inforce.payload ->> 'expires_at')::timestamptz;
      if expires is not null and expires <= now() then
        why := 'expired'; ended_by := 'expiry';
      else
        progress := demand_progress_or_error(inforce.move_act);
        if coalesce((progress ->> 'met')::boolean, false) then why := 'met'; ended_by := 'demand'; end if;
      end if;
      if why is not null then
        did_end := (end_move(inforce.move_act, why, ended_by) ->> 'ended')::boolean;
        if did_end then
          if why = 'met' then met := met + 1; else expired := expired + 1; end if;
        end if;
      end if;
    exception when others then
      failed := failed + 1;
      why := null;
      raise warning 'system_tick: move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
    end;
    -- The Boss says it. The move is ended whether or not the line is posted.
    if why is not null and did_end then
      begin
        select c.staff into staff_key from characters c where c.id = inforce.character;
        perform write_staff_act(staff_key, 'post', inforce.thread, null, jsonb_build_object('body',
          system_line(case why when 'met' then 'moveMet' else 'moveExpired' end, inforce.payload ->> 'kind', inforce.payload -> 'params', staff_key)));
      exception when others then
        raise warning 'system_tick: the end of move % was not said: % (%)', inforce.move_act, sqlerrm, sqlstate;
      end;
    end if;
  end loop;

  return jsonb_build_object('landed', landed, 'met', met, 'expired', expired, 'failed', failed);
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
