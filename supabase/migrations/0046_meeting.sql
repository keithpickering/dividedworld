-- The meeting: the Boss's run, its row, and the schedule (the system plan, Task 9; the system design, sections 4 and 12; the seasonal
-- Boss design, sections 1, 3 and 4).
--
-- **The meeting's row is opened at its start and closed once.** The plan had the row written once, at the end. Every model call's
-- ledger row (model_calls.meeting, 0043) names its meeting, so the row must exist before the first call. So:
--
--   begin_meeting(slot)      opens the row for the scheduled minute the cron fired for (`slot`, unique: as settle's `until`), or
--                            says the slot was already met (its row is closed), or hands back the row of a run that began and
--                            never closed, so a retry reuses it. A run that throws closes its own row `failed` with the error
--                            (best effort, in meet/core.ts) and rethrows, so `resumed` follows only a run whose close failed too
--                            (or that was killed). It also closes, as `failed`, any earlier row that was never closed, so even
--                            that counts toward the consecutive failures.
--   apply_meeting(m, body)   one transaction, under an advisory lock on the meeting: refuses a closed meeting (`already applied`),
--                            else writes the Boss's memory and profile versions, queues the moves, debits the bank and closes
--                            the row `ok`. A retry therefore cannot queue a move twice. Favorites, opinions and grudges name
--                            debuted public characters only: the others are filtered out here, whatever the caller sent.
--   fail_meeting(m, how, e)  closes the row `failed`, `rejected` or `off` with nothing else written.
--
-- A closed row never changes. The guard on `meetings` allows exactly one update to an open row: it sets finished_at, outcome,
-- error, the bank figures, the failures in a row and the record, from null, and nothing else; it refuses every delete and every
-- truncate, with the triggers `enable always` as 0043's were. The update the guard allows is made by close_meeting() only.
--
-- `consecutive_failures` is the previous closed meeting's count plus one for a `failed` or `rejected` row, reset to zero by an
-- `ok`, and carried unchanged by an `off` (a switched-off day is neither). Only consecutive failures count toward any cap.
--
-- `record` is the meeting's own record, one jsonb: the trims and drops the meeting made, the notes, the feeds it skipped, the
-- phase and the answers of the handover (Task 12b). The plan's list of columns had none; "every change is recorded" needs a place.
--
-- The reads the meeting needs are here too, all the service role's: meeting_context(), staff_memory_latest(staff) and
-- public_characters(ids). The digest window starts at the previous meeting's slot, not its finish time, so no play falls between
-- two windows (a meeting finishes minutes after its slot).
--
-- Its way out: a meeting that failed leaves no player stuck; the next meeting is its retry, a row left open is closed by the next
-- slot, and an admin can switch The System off (`systemEnabled`).

-- ------------------------------------------------------------------------------------ the row ----

-- The guard goes first: the backfill below is an update 0043's trigger would refuse (no instance holds a meeting yet; a replay
-- from zero holds none, and a dump that did takes its slot from its start).
drop trigger meetings_no_update on meetings;

alter table meetings add column slot timestamptz;
update meetings set slot = started_at;
alter table meetings alter column slot set not null;
alter table meetings add constraint meetings_slot_key unique (slot);
alter table meetings add column record jsonb check (record is null or jsonb_typeof(record) = 'object');
alter table meetings alter column finished_at drop not null;
alter table meetings alter column outcome drop not null;
alter table meetings add constraint meetings_closed_whole check ((finished_at is null) = (outcome is null));

create function meetings_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'meetings is never edited or removed (DELETE); write a new row' using errcode = 'P0001';
  end if;
  if old.finished_at is not null then
    raise exception 'meetings is never edited or removed (UPDATE); a closed meeting stays as it closed' using errcode = 'P0001';
  end if;
  if (new.id, new.started_at, new.slot) is distinct from (old.id, old.started_at, old.slot) then
    raise exception 'a meeting''s id, start and slot never change' using errcode = 'P0001';
  end if;
  if new.finished_at is null or new.outcome is null then
    raise exception 'a meeting is closed once, with its finish time and its outcome' using errcode = 'P0001';
  end if;
  if old.error is not null or old.bank_before is not null or old.bank_after is not null or old.record is not null then
    raise exception 'a meeting''s error, bank and record are written once, as it closes' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke execute on function meetings_guard() from public, anon, authenticated;
create trigger meetings_no_update before update or delete on meetings for each row execute function meetings_guard();
alter table meetings enable always trigger meetings_no_update;

-- --------------------------------------------------------------------------------- the writes ----

-- Closes an open meeting. Internal: begin_meeting, apply_meeting and fail_meeting call it, and nothing else: no role can execute it.
create function close_meeting(m bigint, how text, why text, bank_was numeric, bank_is numeric, rec jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  prior integer;
begin
  select p.consecutive_failures into prior from meetings p
  where p.finished_at is not null and p.slot < (select x.slot from meetings x where x.id = m) order by p.slot desc limit 1;
  update meetings set finished_at = greatest(now(), started_at), outcome = how, error = why, bank_before = bank_was, bank_after = bank_is,
    record = rec, consecutive_failures = case how when 'ok' then 0 when 'off' then coalesce(prior, 0) else coalesce(prior, 0) + 1 end
  where id = m;
end $$;
revoke execute on function close_meeting(bigint, text, text, numeric, numeric, jsonb) from public, anon, authenticated, service_role;

-- The entries of a memory list ({character, ...}) whose character is debuted and public now, in order; anything else is dropped.
create function public_entries(list jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(t.e order by t.ord), '[]')
  from jsonb_array_elements(case when jsonb_typeof(list) = 'array' then list else '[]'::jsonb end) with ordinality t(e, ord)
  where jsonb_typeof(t.e) = 'object'
    -- The cast sits in a case, so it is evaluated only for text the pattern accepts: SQL does not promise to read an
    -- and from left to right.
    and case when (t.e ->> 'character') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             then (t.e ->> 'character')::uuid in (select c.id from characters_public c) else false end
$$;
revoke execute on function public_entries(jsonb) from public, anon, authenticated, service_role;

create function begin_meeting(slot timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  found_row meetings%rowtype;
  stale bigint;
  made bigint;
begin
  if slot is null then raise exception 'a meeting has a slot' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.begin_meeting', 0));
  select * into found_row from meetings x where x.slot = begin_meeting.slot;
  if found then
    if found_row.finished_at is not null then
      return jsonb_build_object('status', 'already met', 'meeting', found_row.id, 'outcome', found_row.outcome);
    end if;
    return jsonb_build_object('status', 'resumed', 'meeting', found_row.id);
  end if;
  -- A run that began an earlier slot and never closed it died without saying so.
  for stale in select x.id from meetings x where x.finished_at is null and x.slot < begin_meeting.slot order by x.slot loop
    perform close_meeting(stale, 'failed', 'the run ended without closing its meeting', null, null, '{}');
  end loop;
  insert into meetings (started_at, slot) values (now(), begin_meeting.slot) returning id into made;
  return jsonb_build_object('status', 'begun', 'meeting', made);
end $$;

create function fail_meeting(meeting bigint, outcome text, error text, record jsonb default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if outcome not in ('failed', 'rejected', 'off') then
    raise exception 'a meeting that did nothing closes failed, rejected or off, not %', outcome using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.meeting.' || fail_meeting.meeting, 0));
  if not exists (select 1 from meetings x where x.id = fail_meeting.meeting) then
    raise exception 'there is no meeting %', fail_meeting.meeting using errcode = '22023';
  end if;
  if exists (select 1 from meetings x where x.id = fail_meeting.meeting and x.finished_at is not null) then
    return jsonb_build_object('status', 'already closed', 'meeting', fail_meeting.meeting);
  end if;
  perform close_meeting(fail_meeting.meeting, outcome, left(error, 2000), null, null, coalesce(record, '{}'));
  return jsonb_build_object('status', 'closed', 'meeting', fail_meeting.meeting);
end $$;

-- Everything the meeting keeps, in one transaction:
--   {boss, memory, profile: {interests, favorites, mood, signature}, moves: [{kind, params, demand, go_live_at, expires_in_hours, why}],
--    weekly_moves, bank_cap, record}
-- The bank is computed here, in the transaction, from the phase's numbers the caller read (bank_now is the one place the
-- accrual is done): the moves may not cost more than floor(bank), and the balance written back is the bank less what was spent,
-- as of now, so a Boss with no row gets one and a fraction keeps accruing. A structural move's go_live_at is at least
-- `structuralHoldHours` from now whatever the caller asked (enforced here as the meeting enforces it), and a move's expiry is
-- counted from the go-live it ends up with.
create function apply_meeting(meeting bigint, payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  boss text := payload ->> 'boss';
  bal numeric;
  spent integer := jsonb_array_length(coalesce(payload -> 'moves', '[]'));
  hold interval := ((setting('structuralHoldHours')) #>> '{}')::numeric * interval '1 hour';
  memory jsonb := payload -> 'memory';
  mv jsonb;
  kind_row move_kinds%rowtype;
  live timestamptz;
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
  if spent > floor(bal) then
    raise exception 'the moves cost % and the bank holds %', spent, bal using errcode = '23514';
  end if;

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

  for mv in select value from jsonb_array_elements(coalesce(payload -> 'moves', '[]')) loop
    select * into kind_row from move_kinds k where k.key = mv ->> 'kind';
    if not found then raise exception 'there is no move kind "%"', mv ->> 'kind' using errcode = '23514'; end if;
    live := greatest((mv ->> 'go_live_at')::timestamptz, now());
    if kind_row.structural then live := greatest(live, now() + hold); end if;
    insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
    values (apply_meeting.meeting, boss, kind_row.key, mv -> 'params', mv -> 'demand', mv ->> 'why', live,
      live + ((mv ->> 'expires_in_hours')::numeric * interval '1 hour'), kind_row.structural);
  end loop;

  insert into move_bank (staff, balance, as_of) values (boss, bal - spent, now())
  on conflict (staff) do update set balance = excluded.balance, as_of = excluded.as_of;
  perform close_meeting(apply_meeting.meeting, 'ok', null, bal, bal - spent, coalesce(payload -> 'record', '{}'));
  return jsonb_build_object('status', 'applied', 'meeting', apply_meeting.meeting, 'queued', spent, 'bank_before', bal, 'bank_after', bal - spent);
end $$;

-- ---------------------------------------------------------------------------------- the reads ----

-- What the meeting reads about the season and the schedule: the open season's start and the end the database computes (epoch ms;
-- seasonLength is a calendar span, so the caller cannot), its Boss, the slot of the last meeting that closed (any outcome but off:
-- the window of a failed one was read by nobody, but the digest is a sample and its window is bounded either way), and the boards a
-- move may name (not The System's own, at most 50, by their name now).
create function meeting_context() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'season', (select jsonb_build_object('startsAt', (extract(epoch from s.starts_at) * 1000)::bigint,
        'endsAt', (extract(epoch from coalesce(s.ends_at, s.starts_at + span_interval(setting('seasonLength')))) * 1000)::bigint)
      from seasons s where s.ends_at is null order by s.starts_at desc limit 1),
    'boss', current_boss(),
    'lastSlot', (select m.slot from meetings m where m.outcome in ('ok', 'failed', 'rejected') order by m.slot desc limit 1),
    'boards', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name, b.id)
      from (select n.id, n.name from boards_now n where not n.is_system order by n.name, n.id limit 50) b), '[]'))
$$;

create function staff_memory_latest(staff text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select m.body from staff_memory m where m.staff = staff_memory_latest.staff order by m.at desc, m.id desc limit 1
$$;

-- The ids among `ids` (a json array of uuid strings; anything else in it is ignored) that are debuted, public characters now:
-- what repairMemory and the profile's favorites are held to.
create function public_characters(ids jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(c.id order by c.id), '[]')
  from characters_public c
  where c.id in (select case when x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then x::uuid end
                 from jsonb_array_elements_text(case when jsonb_typeof(ids) = 'array' then ids else '[]'::jsonb end) x)
$$;

revoke execute on function begin_meeting(timestamptz), fail_meeting(bigint, text, text, jsonb), apply_meeting(bigint, jsonb),
  meeting_context(), staff_memory_latest(text), public_characters(jsonb) from public, anon, authenticated;
grant execute on function begin_meeting(timestamptz), fail_meeting(bigint, text, text, jsonb), apply_meeting(bigint, jsonb),
  meeting_context(), staff_memory_latest(text), public_characters(jsonb) to service_role;

-- --------------------------------------------------------------------------- the schedule ----

-- (Re)schedule the meeting at the instance's meetingCron, as schedule_settlement() (0004) schedules the settlement. The body carries
-- the minute the job fired in, the meeting's slot: the digest ends there, and the same slot sent again is a meeting already met.
create function schedule_meeting() returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return cron.schedule('kayfabb-meet', setting('meetingCron') #>> '{}', $job$
    select net.http_post(
      url := s.base || '/functions/v1/meet',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || s.secret),
      body := jsonb_build_object('slot', date_trunc('minute', now())),
      timeout_milliseconds := 150000
    )
    from (
      select (select decrypted_secret from vault.decrypted_secrets where name = 'kayfabb_functions_url') as base,
             (select decrypted_secret from vault.decrypted_secrets where name = 'kayfabb_service_key') as secret
    ) s
    where s.base is not null and s.secret is not null
  $job$);
end $$;

create function settings_reschedule_meeting() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform schedule_meeting();
  return null;
end $$;
create trigger settings_reschedule_meeting after insert or update on settings
  for each row when (new.key = 'meetingCron') execute function settings_reschedule_meeting();
revoke execute on function schedule_meeting(), settings_reschedule_meeting() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------- the seed ----

-- seed_instance (0045), also giving the open season the seed's `system.firstBoss` when it has none. Everything else as 0045 wrote it.
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
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;
