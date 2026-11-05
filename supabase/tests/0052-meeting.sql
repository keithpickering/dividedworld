-- The meeting's row and writes (supabase/migrations/0047_meeting.sql; the system plan, Task 9): the row is opened at its start and
-- closed once; a retry of a slot does nothing, or resumes the run that never closed; apply_meeting is one transaction that refuses a
-- closed meeting; the guard allows exactly one close; the consecutive failures count; no client can call any of it.

create function pg_temp.payload(boss text, moves jsonb, memory_hobby text default 'wrestling') returns jsonb language sql as $$
  select jsonb_build_object('boss', boss, 'weekly_moves', 5, 'bank_cap', 10,
    'memory', jsonb_build_object('hobby', jsonb_build_object('name', memory_hobby, 'since', 'today', 'from', 'a friend'), 'opinions', '[]'::jsonb, 'grudges', '[]'::jsonb,
      'wheelhouse', '[]'::jsonb, 'realWorld', '[]'::jsonb, 'marks', '[]'::jsonb),
    'profile', jsonb_build_object('interests', jsonb_build_array('wrestling', 'pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'It is decided.'),
    'moves', moves,
    'record', jsonb_build_object('trims', jsonb_build_array(jsonb_build_object('path', 'moves', 'predicate', 'atMost(2)', 'before', 3, 'after', 2))))
$$;
create function pg_temp.rename(board uuid, name text, go_live timestamptz, hours numeric) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'renameBoard',
    'params', jsonb_build_object('board', board, 'name', name, 'premise', 'About ' || name, 'description', 'Welcome to ' || name),
    'demand', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', board, 'count', 5)),
    'go_live_at', go_live, 'expires_in_hours', hours, 'why', 'Because.')
$$;

do $$
declare
  general uuid;
  boss_char uuid;
  slot1 timestamptz := '2026-01-01T09:00:00Z';
  m1 bigint; m2 bigint; m3 bigint; m4 bigint; m5 bigint; m6 bigint; m7 bigint;
  r jsonb;
  denied boolean;
  who text;
  q record;
  mt meetings%rowtype;
  hidden uuid;
  pl jsonb;
  m8 bigint; m9 bigint;
begin
  select id into general from boards where slug = 'general';
  insert into characters (name, staff, staff_kind, debuted_at) values ('Mt Boss', 'mt-boss', 'persona', now()), ('Mt Other', 'mt-other', 'persona', now());
  select id into boss_char from characters where staff = 'mt-boss';
  insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do nothing;
  insert into demand_kinds (key) values ('postsOnBoard') on conflict (key) do nothing;
  insert into settings (key, value) values ('structuralHoldHours', '24'), ('meetingCron', '"23 9 * * *"') on conflict (key) do update set value = excluded.value;
  update seasons set boss = 'mt-boss' where ends_at is null;

  -- begin: a new slot opens a row; the same slot again resumes it; a closed slot is already met.
  r := begin_meeting(slot1);
  if r ->> 'status' is distinct from 'begun' then raise exception 'a new slot did not begin: %', r; end if;
  m1 := (r ->> 'meeting')::bigint;
  r := begin_meeting(slot1);
  if r is distinct from jsonb_build_object('status', 'resumed', 'meeting', m1) then raise exception 'a slot begun and never closed was not resumed under its meeting: %', r; end if;
  if (select count(*) from meetings where slot = slot1) is distinct from 1::bigint then raise exception 'a slot has two rows'; end if;
  if (select finished_at is not null or outcome is not null from meetings where id = m1) then raise exception 'a new meeting is born closed'; end if;

  -- apply refuses what the bank cannot pay, the wrong Boss, and a kind outside the catalog; nothing of a refused apply stays.
  denied := false;
  begin perform apply_meeting(m1, pg_temp.payload('mt-boss', jsonb_build_array(pg_temp.rename(general, 'Pirate Puns Palace', now(), 48)))); exception when check_violation then denied := true; end;
  if not denied then raise exception 'a Boss with no bank spent a move'; end if;
  denied := false;
  begin perform apply_meeting(m1, pg_temp.payload('mt-other', '[]')); exception when sqlstate '22023' then denied := true; end;
  if not denied then raise exception 'a meeting was applied for a Boss that is not the season''s'; end if;
  denied := false;
  begin perform apply_meeting(m1, pg_temp.payload('mt-boss', jsonb_build_array(jsonb_set(pg_temp.rename(general, 'x', now(), 48), '{kind}', '"banEveryone"')))); exception when check_violation then denied := true; end;
  if not denied then raise exception 'a move of a kind outside the catalog was queued'; end if;
  if exists (select 1 from staff_memory where meeting = m1) or exists (select 1 from queued_moves where meeting = m1) or (select outcome from meetings where id = m1) is not null then
    raise exception 'a refused apply left something behind';
  end if;

  -- (The first apply of a Boss with no bank row is checked below, with mt-other.)
  -- apply: two moves from a bank of three; the first asked for an hour from now, which a structural move's hold raises.
  insert into move_bank (staff, balance, as_of) values ('mt-boss', 3, now());
  r := apply_meeting(m1, pg_temp.payload('mt-boss', jsonb_build_array(
    pg_temp.rename(general, 'Pirate Puns Palace', now() + interval '1 hour', 48), pg_temp.rename(general, 'Big Bad Bowser', now() + interval '30 hours', 72))));
  if r ->> 'status' is distinct from 'applied' or (r ->> 'queued')::integer is distinct from 2 then raise exception 'apply: %', r; end if;
  if (select count(*) from queued_moves where meeting = m1) is distinct from 2::bigint then raise exception 'two moves were not queued'; end if;
  select * into q from queued_moves where meeting = m1 and params ->> 'name' = 'Pirate Puns Palace';
  if q.go_live_at < now() + interval '24 hours' - interval '1 minute' then raise exception 'a structural move was queued inside its hold: %', q.go_live_at; end if;
  if q.expires_at is distinct from q.go_live_at + interval '48 hours' then raise exception 'an expiry is counted from the go-live it ends up with'; end if;
  if not q.structural or q.staff is distinct from 'mt-boss' then raise exception 'a queued move is the Boss''s and structural as its kind is'; end if;
  select * into q from queued_moves where meeting = m1 and params ->> 'name' = 'Big Bad Bowser';
  if abs(extract(epoch from (q.go_live_at - (now() + interval '30 hours')))) > 5 then raise exception 'a go-live past the hold was moved'; end if;
  if (select balance from move_bank where staff = 'mt-boss') is distinct from 1::numeric then raise exception 'the bank was not debited by what was spent'; end if;
  if (select hobby from (select body -> 'hobby' ->> 'name' as hobby from staff_memory where meeting = m1) x) is distinct from 'wrestling' then raise exception 'no memory version'; end if;
  if (select array_to_string(interests, ',') || mood from staff_profiles where meeting = m1) is distinct from 'wrestling,piesmug' then raise exception 'no profile version'; end if;
  select * into mt from meetings where id = m1;
  if mt.outcome is distinct from 'ok' or mt.finished_at is null or mt.bank_before is distinct from 3::numeric or mt.bank_after is distinct from 1::numeric
     or mt.consecutive_failures is distinct from 0 or mt.record #>> '{trims,0,predicate}' is distinct from 'atMost(2)' then
    raise exception 'the closed row: %', to_jsonb(mt);
  end if;

  -- A second apply of the same meeting writes nothing: a retry cannot queue a move twice. Nor can its slot begin again.
  r := apply_meeting(m1, pg_temp.payload('mt-boss', jsonb_build_array(pg_temp.rename(general, 'Koopa Kart Klub', now(), 48)), 'later'));
  if r ->> 'status' is distinct from 'already applied' then raise exception 'a closed meeting was applied again: %', r; end if;
  if (select count(*) from queued_moves where meeting = m1) is distinct from 2::bigint or (select count(*) from staff_memory where meeting = m1) is distinct from 1::bigint
     or (select balance from move_bank where staff = 'mt-boss') is distinct from 1::numeric then
    raise exception 'an apply of a closed meeting wrote something';
  end if;
  r := begin_meeting(slot1);
  if r ->> 'status' is distinct from 'already met' or (r ->> 'meeting')::bigint is distinct from m1 then raise exception 'a slot already met began again: %', r; end if;

  -- fail: the count of consecutive failures is the previous closed meeting's plus one, and an ok resets it; a closed row is not closed twice.
  m2 := (begin_meeting(slot1 + interval '1 day') ->> 'meeting')::bigint;
  r := fail_meeting(m2, 'rejected', 'the answer failed atMost(6) at moves', jsonb_build_object('phase', 'reign'));
  if r ->> 'status' is distinct from 'closed' then raise exception 'fail: %', r; end if;
  select * into mt from meetings where id = m2;
  if mt.outcome is distinct from 'rejected' or mt.consecutive_failures is distinct from 1 or mt.error is distinct from 'the answer failed atMost(6) at moves' or mt.record ->> 'phase' is distinct from 'reign' then
    raise exception 'the rejected row: %', to_jsonb(mt);
  end if;
  if fail_meeting(m2, 'failed', 'again') ->> 'status' is distinct from 'already closed' or (select outcome from meetings where id = m2) is distinct from 'rejected' then raise exception 'a closed meeting was closed again'; end if;
  denied := false;
  begin perform fail_meeting(m2, 'ok', 'cheating'); exception when sqlstate '22023' then denied := true; end;
  if not denied then raise exception 'fail_meeting closed a meeting ok'; end if;
  if (select count(*) from staff_memory where meeting = m2) is distinct from 0::bigint then raise exception 'a failed meeting wrote a memory'; end if;
  if (select balance from move_bank where staff = 'mt-boss') is distinct from 1::numeric then raise exception 'a failed meeting touched the bank'; end if;

  -- A run that began and never closed is closed failed by the next slot, and counts.
  m3 := (begin_meeting(slot1 + interval '2 days') ->> 'meeting')::bigint;
  m4 := (begin_meeting(slot1 + interval '3 days') ->> 'meeting')::bigint;
  select * into mt from meetings where id = m3;
  if mt.outcome is distinct from 'failed' or mt.consecutive_failures is distinct from 2 or mt.error is null then raise exception 'a meeting never closed was not closed failed: %', to_jsonb(mt); end if;
  perform fail_meeting(m4, 'failed', 'upstream 500');
  if (select consecutive_failures from meetings where id = m4) is distinct from 3 then raise exception 'three in a row are not three'; end if;
  -- An ok resets it; an off carries it; the next failure is the first again.
  m5 := (begin_meeting(slot1 + interval '4 days') ->> 'meeting')::bigint;
  perform apply_meeting(m5, pg_temp.payload('mt-boss', '[]', 'later'));
  if (select consecutive_failures from meetings where id = m5) is distinct from 0 then raise exception 'an ok did not reset the failures'; end if;
  m6 := (begin_meeting(slot1 + interval '5 days') ->> 'meeting')::bigint;
  perform fail_meeting(m6, 'off', null);
  if (select outcome || consecutive_failures from meetings where id = m6) is distinct from 'off0' then raise exception 'an off meeting is neither a failure nor a success'; end if;
  m7 := (begin_meeting(slot1 + interval '6 days') ->> 'meeting')::bigint;
  perform fail_meeting(m7, 'failed', 'x');
  if (select consecutive_failures from meetings where id = m7) is distinct from 1 then raise exception 'a failure after an ok is the first again'; end if;
  -- The bank accrues on from what it held: m5's apply wrote it as of now with the same balance (nothing was spent).
  if (select balance from move_bank where staff = 'mt-boss') is distinct from 1::numeric then raise exception 'an apply with no moves changed the balance'; end if;

  -- The reads.
  r := meeting_context();
  if r #>> '{season,startsAt}' is distinct from '946684800000' or r ->> 'boss' is distinct from 'mt-boss' or (r ->> 'lastSlot')::timestamptz is distinct from slot1 + interval '6 days' then
    raise exception 'meeting_context: %', r;
  end if;
  if not (r -> 'boards' @> jsonb_build_array(jsonb_build_object('id', general, 'name', 'General'))) or jsonb_array_length(r -> 'boards') is distinct from 1 then
    raise exception 'the boards a move may name are the ones that are not The System''s: %', r -> 'boards';
  end if;
  if staff_memory_latest('mt-boss') #>> '{hobby,name}' is distinct from 'later' then raise exception 'the latest memory is not the latest: %', staff_memory_latest('mt-boss'); end if;
  if staff_memory_latest('mt-other') is not null then raise exception 'a Boss with no memory has one'; end if;
  if staff_memory_at('mt-boss') is distinct from (select max(at) from staff_memory where staff = 'mt-boss') then raise exception 'staff_memory_at is not the latest version''s time'; end if;
  if staff_memory_at('mt-other') is not null then raise exception 'a Boss with no memory has a time'; end if;
  r := public_characters(jsonb_build_array(boss_char, gen_random_uuid(), 'not a uuid', 7, null));
  if r is distinct from jsonb_build_array(boss_char) then raise exception 'public_characters: %', r; end if;
  if public_characters('"x"') is distinct from '[]'::jsonb then raise exception 'public_characters of a non-list'; end if;

  -- The guard on meetings: a closed row never changes, an open one closes once and nothing else changes, and none is removed.
  denied := false;
  begin update meetings set error = 'edited' where id = m1; exception when sqlstate 'P0001' then denied := true; end;
  if not denied then raise exception 'a closed meeting was edited'; end if;
  denied := false;
  begin delete from meetings where id = m1; exception when sqlstate 'P0001' then denied := true; end;
  if not denied then raise exception 'a meeting was deleted'; end if;
  m1 := (begin_meeting(slot1 + interval '7 days') ->> 'meeting')::bigint;
  denied := false;
  begin update meetings set slot = slot + interval '1 hour' where id = m1; exception when sqlstate 'P0001' then denied := true; end;
  if not denied then raise exception 'an open meeting''s slot was changed'; end if;
  denied := false;
  begin update meetings set error = 'half a close' where id = m1; exception when sqlstate 'P0001' then denied := true; end;
  if not denied then raise exception 'an open meeting was edited without being closed'; end if;
  update meetings set finished_at = now(), outcome = 'failed', error = 'closed by hand', consecutive_failures = 9 where id = m1;
  denied := false;
  begin update meetings set error = 'closed twice' where id = m1; exception when sqlstate 'P0001' then denied := true; end;
  if not denied then raise exception 'a meeting was closed twice'; end if;
  denied := false;
  begin truncate meetings cascade; exception when sqlstate 'P0001' then denied := true; end;
  if not denied then raise exception 'meetings was truncated'; end if;

  -- A favorite, an opinion and a grudge in the memory name debuted public characters only; the database keeps the filter whatever the caller sent.
  insert into characters (name, staff, staff_kind) values ('Mt Hidden', 'mt-hidden', 'persona');
  select id into hidden from characters where staff = 'mt-hidden';
  m8 := (begin_meeting(slot1 + interval '20 days') ->> 'meeting')::bigint;
  pl := pg_temp.payload('mt-boss', '[]', 'filtered');
  pl := jsonb_set(pl, '{profile,favorites}', jsonb_build_array(boss_char, hidden, boss_char, 'not-a-uuid'));
  pl := jsonb_set(pl, '{memory,opinions}', jsonb_build_array(jsonb_build_object('character', boss_char, 'score', 2, 'note', 'fine'), jsonb_build_object('character', hidden, 'score', 5, 'note', 'secret')));
  pl := jsonb_set(pl, '{memory,grudges}', jsonb_build_array(jsonb_build_object('character', hidden, 'score', -5, 'note', 'secret')));
  perform apply_meeting(m8, pl);
  if (select favorites from staff_profiles where meeting = m8) is distinct from array[boss_char] then raise exception 'a favorite who is not public was written: %', (select favorites from staff_profiles where meeting = m8); end if;
  if (select jsonb_array_length(body -> 'opinions') from staff_memory where meeting = m8) is distinct from 1 or (select jsonb_array_length(body -> 'grudges') from staff_memory where meeting = m8) is distinct from 0 then
    raise exception 'an opinion or grudge naming a character who is not public was written: %', (select body from staff_memory where meeting = m8);
  end if;

  -- A structural hold that is not set is an error, not a hold of zero: unset raises, and so does a JSON null (which would drop the hold in silence).
  m9 := (begin_meeting(slot1 + interval '21 days') ->> 'meeting')::bigint;
  -- A JSON null is no longer writable (settings_held, 0077 refuses it), so the hold cannot be dropped in silence from the table.
  denied := false;
  begin update settings set value = 'null' where key = 'structuralHoldHours'; exception when check_violation then denied := true; end;
  if not denied then raise exception 'a null structuralHoldHours was written'; end if;
  delete from settings where key = 'structuralHoldHours';
  denied := false;
  begin perform apply_meeting(m9, pg_temp.payload('mt-boss', '[]', 'no hold')); exception when sqlstate 'P0002' then denied := true; end;
  if not denied then raise exception 'a meeting was applied with no structuralHoldHours'; end if;
  insert into settings (key, value) values ('structuralHoldHours', '24');
  perform fail_meeting(m9, 'failed', 'x');

  -- Clients cannot call any of it; the service role can.
  foreach who in array array['anon', 'authenticated'] loop
    perform set_config('role', who, true);
    denied := false;
    begin perform begin_meeting(now()); exception when insufficient_privilege then denied := true; end;
    if not denied then raise exception '% can begin a meeting', who; end if;
    denied := false;
    begin perform apply_meeting(m1, '{}'); exception when insufficient_privilege then denied := true; end;
    if not denied then raise exception '% can apply a meeting', who; end if;
    denied := false;
    begin perform fail_meeting(m1, 'failed', 'x'); exception when insufficient_privilege then denied := true; end;
    if not denied then raise exception '% can fail a meeting', who; end if;
    denied := false;
    begin perform meeting_context(); exception when insufficient_privilege then denied := true; end;
    if not denied then raise exception '% can read the meeting''s context', who; end if;
    denied := false;
    begin perform staff_memory_latest('mt-boss'); exception when insufficient_privilege then denied := true; end;
    if not denied then raise exception '% can read a Boss''s memory', who; end if;
    denied := false;
    begin perform public_characters('[]'); exception when insufficient_privilege then denied := true; end;
    if not denied then raise exception '% can call public_characters', who; end if;
    denied := false;
    begin perform close_meeting(m1, 'failed', 'x', null, null, '{}'); exception when insufficient_privilege then denied := true; end;
    if not denied then raise exception '% can close a meeting directly', who; end if;
    denied := false;
    begin perform schedule_meeting(); exception when insufficient_privilege then denied := true; end;
    if not denied then raise exception '% can schedule the meeting', who; end if;
    perform tests.unbecome();
  end loop;
  perform set_config('role', 'service_role', true);
  denied := false;
  begin perform close_meeting(m1, 'failed', 'x', null, null, '{}'); exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'the service role can close a meeting directly'; end if;
  perform tests.unbecome();
  perform set_config('role', 'service_role', true);
  perform begin_meeting(slot1 + interval '8 days');
  perform meeting_context();
  perform tests.unbecome();

  -- The seed gives the open season its first Boss when it has none, and leaves one it has.
  update seasons set boss = null where ends_at is null;
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'reactions', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('staff', '[]'::jsonb, 'firstStaff', '[]'::jsonb, 'firstBoss', 'mt-other')));
  if current_boss() is distinct from 'mt-other' then raise exception 'the seed did not give the open season its Boss'; end if;
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'reactions', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('staff', '[]'::jsonb, 'firstStaff', '[]'::jsonb, 'firstBoss', 'mt-boss')));
  if current_boss() is distinct from 'mt-other' then raise exception 'a reseed changed a season''s Boss'; end if;

  -- A Boss with no bank row gets one at its first successful apply: the bank was empty, so nothing could be spent, and the row holds zero as of now.
  if exists (select 1 from move_bank where staff = 'mt-other') then raise exception 'the test expects mt-other to have no bank row'; end if;
  m9 := (begin_meeting(slot1 + interval '22 days') ->> 'meeting')::bigint;
  r := apply_meeting(m9, pg_temp.payload('mt-other', '[]'));
  if (select balance from move_bank where staff = 'mt-other') is distinct from 0::numeric or (select now() - as_of from move_bank where staff = 'mt-other') > interval '1 minute' then
    raise exception 'a Boss with no bank row did not get one: %', (select to_jsonb(b) from move_bank b where staff = 'mt-other');
  end if;
  if (select bank_before || ',' || bank_after from meetings where id = m9) is distinct from '0,0' then raise exception 'the closed row of the first apply: %', (select to_jsonb(x) from meetings x where id = m9); end if;

  -- The schedule is the settings trigger's: a meetingCron write reschedules.
  if (select count(*) from pg_trigger where tgname = 'settings_reschedule_meeting' and not tgisinternal) is distinct from 1::bigint then raise exception 'meetingCron does not reschedule the meeting'; end if;
end $$;

-- ---- The meeting's job sends nothing until both of its secrets exist, then calls meet with the jobs key in apikey alone ----
do $$
declare
  cmd text;
  q record;
begin
  delete from vault.decrypted_secrets where name in ('kayfabb_functions_url', 'kayfabb_service_key', 'kayfabb_jobs_key');
  perform schedule_meeting();
  select command into cmd from cron.job where jobname = 'kayfabb-meet';
  delete from net.http_request_queue;
  execute cmd;
  if exists (select 1 from net.http_request_queue) then raise exception 'the meeting''s job sent a request with no secrets'; end if;
  insert into vault.decrypted_secrets values ('kayfabb_functions_url', 'https://project.example');
  execute cmd;
  if exists (select 1 from net.http_request_queue) then raise exception 'the meeting''s job sent a request with half its secrets'; end if;
  insert into vault.decrypted_secrets values ('kayfabb_service_key', 'sb_secret_old_name');
  execute cmd;
  if exists (select 1 from net.http_request_queue) then raise exception 'the meeting''s job sent a request with only the old kayfabb_service_key'; end if;
  insert into vault.decrypted_secrets values ('kayfabb_jobs_key', 'sb_secret_not_a_real_key');
  execute cmd;
  select * into q from net.http_request_queue;
  if q.url <> 'https://project.example/functions/v1/meet' then raise exception 'the meeting''s job called %', q.url; end if;
  if q.headers ->> 'apikey' is distinct from 'sb_secret_not_a_real_key' then raise exception 'the meeting''s job should carry the jobs key in apikey: %', q.headers; end if;
  if q.headers ? 'Authorization' then raise exception 'the meeting''s job should send no Authorization: %', q.headers; end if;
  if (q.body ->> 'slot')::timestamptz <> date_trunc('minute', now()) then raise exception 'the body should carry the minute the job fired in: %', q.body; end if;
end $$;
