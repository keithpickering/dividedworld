-- Masks change at the tally (supabase/migrations/0007_seasons.sql, 0009_registration.sql and
-- 0003's apply_settlement): a character made between settlements debuts at the next one, a Turn
-- takes effect there, and an invite reads as used only once one has run after its account
-- opened; The System's tally names the debuts and the announced Turns; the season's reveal runs
-- from the settlement of its last window; and what The System posts reaches its readers live,
-- through an outbox that a failed send leaves for the next run. The fix round's Task F; the
-- owner's answers 16 and 17, on #4.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- Settle the next window, a day long, as the job does, as the service.
create function pg_temp.settle_day() returns jsonb language plpgsql as $$
declare
  s timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  said jsonb;
begin
  perform set_config('role', 'service_role', true);
  said := apply_settlement(s, s + interval '1 day', '[]');
  perform tests.unbecome();
  return said || jsonb_build_object('start', s, 'end', s + interval '1 day');
end $$;

-- ---- A character made between settlements waits to debut: unseen, and unable to act ----
do $$
declare
  ann uuid := tests.account('mask-ann');
  bob uuid := tests.account('mask-bob');
  old uuid := tests.character(bob, 'Old Hand', 'alpha', now() - interval '10 days');
  t uuid := tests.thread();
  p uuid := tests.post(old, t, 'Already here.');
  made jsonb;
  fresh uuid;
  why text;
  settled jsonb;
begin
  perform tests.become(ann);
  made := create_character('Fresh Face', 'alpha');
  fresh := (made ->> 'id')::uuid;
  if not (made ->> 'waiting')::boolean then raise exception 'a new character says it waits to debut: %', made; end if;
  -- Its player sees it, waiting.
  if (select debuted_at from characters where id = fresh) is not null or not exists (select 1 from characters where id = fresh) then
    raise exception 'its player sees their character, waiting to debut';
  end if;
  -- It cannot act by any path, and says why to the player who plays it.
  why := pg_temp.refusal(format('select post(%L, %L, %L)', t, fresh, 'Too soon.'));
  if why is distinct from 'that character debuts at the next settlement' then raise exception 'a waiting character posted: %', why; end if;
  if pg_temp.refusal(format('select react(%L, %L, %L)', p, fresh, 'up')) is distinct from 'that character debuts at the next settlement' then raise exception 'a waiting character reacted'; end if;
  if pg_temp.refusal(format('select spin(%L, %L, %L)', p, fresh, 'Spun')) is distinct from 'that character debuts at the next settlement' then raise exception 'a waiting character spun'; end if;
  if pg_temp.refusal(format('select start_thread(%L, %L, %L, %L)', 'general', fresh, 'A thread', 'Hi.')) is distinct from 'that character debuts at the next settlement' then raise exception 'a waiting character started a thread'; end if;
  if pg_temp.refusal(format('select turn(%L, %L, %L)', fresh, 'beta', 'silent')) is distinct from 'that character debuts at the next settlement' then raise exception 'a waiting character Turned'; end if;
  perform tests.unbecome();
  -- Nobody else sees it: not in the public list, and not by its id.
  perform tests.become(bob);
  if exists (select 1 from characters_public where id = fresh or name = 'Fresh Face') then raise exception 'another player saw a character waiting to debut'; end if;
  -- To another player it is any character they do not play.
  if pg_temp.refusal(format('select post(%L, %L, %L)', t, fresh, 'Mine?')) is distinct from 'you do not play that character' then raise exception 'another player learned a waiting character exists'; end if;
  perform tests.unbecome();
  if pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, %L)', ann, 'splat', fresh, p, '{}', 0)) is distinct from 'that character debuts at the next settlement' then
    raise exception 'a waiting character played a card';
  end if;
  if pg_temp.refusal(format('select save_effect_state(%L, %L, %L, %L)', ann, fresh, gen_random_uuid(), '{}')) is distinct from 'that character debuts at the next settlement' then
    raise exception 'a waiting character saved an effect';
  end if;
  -- And the table holds it, for any writer that forgets to ask.
  if coalesce(pg_temp.refusal(format('insert into acts (character, kind, thread, payload) values (%L, %L, %L, %L)', fresh, 'post', t, '{"body": "x"}')), '') not like '%debuts%' then
    raise exception 'an Act by a waiting character was written past every action';
  end if;

  -- The settlement after it was made debuts it, and its tally names it.
  settled := pg_temp.settle_day();
  if (select debuted_at from characters where id = fresh) is distinct from (settled ->> 'end')::timestamptz then raise exception 'it debuts at the end of the window it was made in'; end if;
  perform tests.become(bob);
  if not exists (select 1 from characters_public where id = fresh) then raise exception 'a debuted character is seen'; end if;
  perform tests.unbecome();
  perform tests.become(ann);
  perform post(t, fresh, 'Here now.');
  perform tests.unbecome();
  if not coalesce((select payload -> 'debuts' from acts where kind = 'tally' and id = (settled ->> 'tally')::uuid) @> jsonb_build_array(jsonb_build_object('character', fresh, 'name', 'Fresh Face')), false) then
    raise exception 'the tally names the debut: %', (select payload from acts where id = (settled ->> 'tally')::uuid);
  end if;
end $$;

-- ---- A Turn waits for the settlement: changed or withdrawn until then, and in effect from it ----
do $$
declare
  ann uuid := tests.account('pend-ann');
  bob uuid := tests.account('pend-bob');
  loud uuid := tests.character(ann, 'Loud Turner', 'alpha', now() - interval '60 days');
  shy uuid := tests.character(ann, 'Shy Turner', 'alpha', now() - interval '60 days');
  late uuid := tests.character(bob, 'Late Turner', 'alpha', now() - interval '60 days');
  gone uuid := tests.character(bob, 'Changed Mind', 'alpha', now() - interval '60 days');
  said jsonb;
  input jsonb;
  settled jsonb;
  window_end timestamptz;
  tally jsonb;
  seen text;
begin
  perform tests.become(bob);
  seen := (select coalesce(jsonb_agg(a order by a.id), '[]')::text from acts_public a);
  perform tests.unbecome();
  perform tests.become(ann);
  said := turn(loud, 'beta', 'silent');
  if not (said ->> 'pending')::boolean then raise exception 'a Turn waits for the settlement: %', said; end if;
  -- Changed before it takes effect: louder, and the change is the Turn.
  said := turn(loud, 'beta', 'revealed');
  -- "revealed", from an older client, waits as announced naming the class it Turns from (0028).
  if (select (loudness, show_from) from pending_turns where character = loud) is distinct from ('announced'::text, true) then raise exception 'a waiting Turn is changed'; end if;
  perform turn(shy, 'beta', 'silent');
  -- Nothing public moves while a Turn waits, announced or not.
  if (select class_key from class_history where character = loud order by started_at desc limit 1) is distinct from 'alpha' then raise exception 'a waiting Turn changed the class'; end if;
  perform tests.unbecome();
  perform tests.become(bob);
  if (select coalesce(jsonb_agg(a order by a.id), '[]')::text from acts_public a) is distinct from seen then raise exception 'a waiting Turn wrote a public Act'; end if;
  -- Nobody else reads a waiting Turn.
  if exists (select 1 from pending_turns where character in (loud, shy)) then raise exception 'another player read a waiting Turn'; end if;
  perform turn(late, 'beta', 'announced');
  perform turn(gone, 'beta', 'announced');
  said := withdraw_turn(gone);
  if exists (select 1 from pending_turns where character = gone) then raise exception 'a withdrawn Turn still waits'; end if;
  if pg_temp.refusal(format('select withdraw_turn(%L)', gone)) is distinct from 'no Turn of that character is waiting' then raise exception 'withdrawing nothing should say so'; end if;
  if pg_temp.refusal(format('select withdraw_turn(%L)', loud)) is distinct from 'you do not play that character' then raise exception 'withdrawing another''s Turn'; end if;
  perform tests.unbecome();
  -- Two Turns made minutes apart and two made hours apart, in one window.
  update pending_turns set asked_at = now() + interval '1 hour' where character = loud;
  update pending_turns set asked_at = now() + interval '1 hour 2 minutes' where character = shy;
  update pending_turns set asked_at = now() + interval '3 hours' where character = late;

  -- A waiting Turn changes no class rule's input: the window's settlement reads the old class.
  window_end := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons)) + interval '1 day';
  input := settlement_input(window_end - interval '1 day', window_end);
  if exists (select 1 from jsonb_array_elements(input -> 'characters') c, jsonb_array_elements(c -> 'classes') k where c ->> 'id' in (loud::text, shy::text, late::text) and k ->> 'class' = 'beta') then
    raise exception 'a waiting Turn reached the settlement''s input: %', input -> 'characters';
  end if;
  update pending_turns set asked_at = window_end - interval '1 minute' where character = late;
  settled := pg_temp.settle_day();
  -- Each in effect from the settlement, the minutes and hours between them gone.
  if (select array_agg(distinct started_at) from class_history where class_key = 'beta' and character in (loud, shy, late)) is distinct from array[window_end] then
    raise exception 'every Turn of a window takes effect at its end: %', (select array_agg(started_at) from class_history where character in (loud, shy, late));
  end if;
  if exists (select 1 from pending_turns where character in (loud, shy, late)) then raise exception 'a Turn that took effect still waits'; end if;
  if exists (select 1 from class_history where character = gone and class_key = 'beta') then raise exception 'a withdrawn Turn took effect'; end if;
  -- The tally names the announced and revealed Turns, never a silent one, never to what.
  select payload into tally from acts where id = (settled ->> 'tally')::uuid;
  if tally is null or (select kind from acts where id = (settled ->> 'tally')::uuid) is distinct from 'tally' or (select character from acts where id = (settled ->> 'tally')::uuid) is not null then
    raise exception 'the settlement posts The System''s tally: %', settled;
  end if;
  if (select jsonb_agg(x ->> 'name' order by x ->> 'name') from jsonb_array_elements(tally -> 'turns') x) is distinct from '["Late Turner", "Loud Turner"]' then
    raise exception 'the tally names the loud Turns and only those: %', tally;
  end if;
  if (select x ->> 'was' from jsonb_array_elements(tally -> 'turns') x where x ->> 'name' = 'Loud Turner') is distinct from 'alpha' then raise exception 'a revealed Turn says what it was: %', tally; end if;
  if (select x ? 'was' from jsonb_array_elements(tally -> 'turns') x where x ->> 'name' = 'Late Turner') then raise exception 'an announced Turn says nothing of its class: %', tally; end if;
  if tally::text like '%beta%' then raise exception 'the tally said what a mask Turned to'; end if;
  -- It is posted in the season's Turns thread, once.
  if (select thread from acts where id = (settled ->> 'tally')::uuid) is distinct from (select turns_thread from seasons where ends_at is null) then raise exception 'the tally is in the season''s Turns thread'; end if;
  if (pg_temp.settle_day() ->> 'tally') is not null then raise exception 'a settlement with no debut and no loud Turn posts no tally'; end if;

  -- The cooldown runs from when a Turn took effect.
  perform tests.become(ann);
  if substring(pg_temp.refusal(format('select turn(%L, %L, %L)', loud, 'alpha', 'silent')) from '\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z')::timestamptz is distinct from window_end + interval '30 days' then
    raise exception 'the cooldown runs from the settlement the Turn took effect at: %', pg_temp.refusal(format('select turn(%L, %L, %L)', loud, 'alpha', 'silent'));
  end if;
  perform tests.unbecome();
end $$;

-- ---- A settlement applied twice posts its tally once; what it posts waits in the outbox until sent ----
do $$
declare
  ann uuid := tests.account('out-ann');
  start_at timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  said jsonb;
  due jsonb;
  tallies integer;
begin
  perform tests.become(ann);
  perform create_character('Outboxed', 'alpha');
  perform tests.unbecome();
  delete from broadcasts_due;
  -- A row from a send that failed a run ago (a day, at a daily cron) is still sent.
  insert into broadcasts_due (topic, event, payload, made_at) values ('thread:late', 'act', '{"id": "late"}', now() - interval '2 days');
  said := pg_temp.settle_day();
  tallies := (select count(*) from acts where kind = 'tally');
  perform set_config('role', 'service_role', true);
  if (apply_settlement(start_at, start_at + interval '1 day', '[]') ->> 'applied')::boolean then raise exception 'a window applied twice'; end if;
  due := due_broadcasts();
  perform tests.unbecome();
  if (select count(*) from acts where kind = 'tally') is distinct from tallies then raise exception 'a window applied twice posted its tally twice'; end if;
  if not exists (select 1 from jsonb_array_elements(due) m where m ->> 'event' = 'act' and m -> 'payload' ->> 'id' = said ->> 'tally'
                 and m ->> 'topic' = 'thread:' || (select thread from acts where id = (said ->> 'tally')::uuid)) then
    raise exception 'the tally waits to be broadcast on its thread: %', due;
  end if;
  if (select count(*) from jsonb_array_elements(due) m where m -> 'payload' ->> 'id' = said ->> 'tally') is distinct from 1 then raise exception 'the tally is broadcast once: %', due; end if;
  if not exists (select 1 from jsonb_array_elements(due) m where m -> 'payload' ->> 'id' = 'late') then raise exception 'a broadcast a failed send left was dropped before the next run sent it'; end if;
  -- Sent, it is gone; unsent, it waits for the next run, however long that is.
  perform set_config('role', 'service_role', true);
  perform broadcasts_sent((select jsonb_agg(m -> 'id') from jsonb_array_elements(due) m));
  if jsonb_array_length(due_broadcasts()) <> 0 then raise exception 'a sent broadcast is still due'; end if;
  perform tests.unbecome();
  perform tests.become(ann);
  if pg_temp.refusal('select due_broadcasts()') is null then raise exception 'a player read the outbox'; end if;
  perform tests.unbecome();
end $$;

-- ---- An invite reads as used only once a settlement has run after its account opened ----
do $$
declare
  ann uuid := tests.account('inv-ann');
  newcomer uuid;
  made jsonb;
  window_start timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
begin
  perform tests.become(ann);
  made := create_invite();
  perform tests.unbecome();
  insert into auth.users (email) values ('inv-new@test.invalid') returning id into newcomer;
  perform tests.become(newcomer);
  perform open_account(made ->> 'code');
  perform tests.unbecome();
  -- The account opened inside the next window.
  update invites set used_at = window_start + interval '2 hours' where id = (made ->> 'invite')::bigint;
  perform tests.become(ann);
  if (select used from my_invites where id = (made ->> 'invite')::bigint) then raise exception 'an invite read as used before a settlement ran'; end if;
  -- Sent again, it answers as any unused invite does.
  if pg_temp.refusal(format('select reissue_invite(%s)', made ->> 'invite')) is not null then raise exception 'reissuing an invite whose use is not yet shown was refused'; end if;
  perform tests.unbecome();
  -- And the sign-up answer, which anyone holding a code can ask for, says the same: a code whose
  -- use the settlement has not yet shown opens, as far as anyone asking can tell.
  update invites set code_hash = invite_hash('probe-code') where id = (made ->> 'invite')::bigint;
  perform tests.become_service();
  if invite_open('probe-code') is distinct from 'opens' then raise exception 'the sign-up answer showed an invite''s use before a settlement ran'; end if;
  perform tests.unbecome();
  perform pg_temp.settle_day();
  perform tests.become_service();
  if invite_open('probe-code') is distinct from 'nothing' then raise exception 'a spent invite still opens after the settlement shows it used'; end if;
  perform tests.unbecome();
  perform tests.become(ann);
  if not (select used from my_invites where id = (made ->> 'invite')::bigint) then raise exception 'an invite reads as used after the settlement'; end if;
  if pg_temp.refusal(format('select reissue_invite(%s)', made ->> 'invite')) is null then raise exception 'a used invite was sent again'; end if;
  if pg_temp.refusal('select used_at from invites') is null then raise exception 'the inviter read when an invite was used'; end if;
  perform tests.unbecome();
end $$;

-- ---- The edges: what the settlement's window holds, and what it does not; a tally of any size ----
do $$
declare
  ann uuid := tests.account('edge-ann');
  start_at timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  window_end timestamptz := start_at + interval '1 day';
  later uuid;
  turner uuid := tests.character(ann, 'Edge Turner', 'alpha', now() - interval '60 days');
  asked timestamptz;
  said jsonb;
  tallies integer;
  due jsonb;
  ids jsonb;
  biggest integer;
begin
  -- A character made after the window's end, and a Turn asked then, wait for the next one.
  insert into characters (owner, name, created_at) values (ann, 'Made After The Window', window_end + interval '1 minute') returning id into later;
  perform tests.become(ann);
  perform turn(turner, 'beta', 'announced');
  perform tests.unbecome();
  asked := (select asked_at from pending_turns where character = turner);
  -- Asked again, the Turn is asked anew.
  perform tests.become(ann);
  perform turn(turner, 'beta', 'revealed');
  perform tests.unbecome();
  if (select asked_at from pending_turns where character = turner) <= asked then raise exception 'a changed Turn keeps the moment it was first asked'; end if;
  perform tests.become(ann);
  -- Asking for the class it holds while a Turn waits says the way to keep it.
  if coalesce(pg_temp.refusal(format('select turn(%L, %L, %L)', turner, 'alpha', 'silent')), '') not like '%withdraw%' then
    raise exception 'asking for the class it holds, with a Turn waiting, should say to withdraw it: %', pg_temp.refusal(format('select turn(%L, %L, %L)', turner, 'alpha', 'silent'));
  end if;
  perform tests.unbecome();
  update pending_turns set asked_at = window_end where character = turner;
  -- A tally of many debuts is several Acts of at most a hundred names each, never one payload holding all.
  for i in 1..150 loop
    insert into characters (owner, name, created_at) values (tests.account('edge-many-' || i), 'Many Masks ' || i, start_at + interval '1 hour');
  end loop;
  -- The season's first loud Turn or debut opens its Turns thread, and says so to its board.
  update seasons set turns_thread = null where ends_at is null;
  delete from broadcasts_due;
  tallies := (select count(*) from acts where kind = 'tally');
  said := pg_temp.settle_day();
  if (select debuted_at from characters where id = later) is not null then raise exception 'a character made after the window debuted at its end'; end if;
  if not exists (select 1 from pending_turns where character = turner) then raise exception 'a Turn asked at the window''s end took effect at it'; end if;
  if (select count(*) from acts where kind = 'tally') - tallies < 2 then raise exception 'a tally of 150 debuts was one Act'; end if;
  select max(jsonb_array_length(payload -> 'debuts') + jsonb_array_length(payload -> 'turns')) into biggest from acts where kind = 'tally';
  if biggest > 100 then raise exception 'a tally Act names % masks', biggest; end if;
  if (select count(*) from acts a, jsonb_array_elements(a.payload -> 'debuts') d where a.kind = 'tally' and d ->> 'name' like 'Many Masks %') is distinct from 150 then
    raise exception 'every debut is named, once';
  end if;
  perform set_config('role', 'service_role', true);
  due := due_broadcasts();
  perform tests.unbecome();
  if not exists (select 1 from jsonb_array_elements(due) m where m ->> 'event' = 'thread' and m ->> 'topic' = 'board:' || system_board()) then
    raise exception 'a Turns thread the tally opened was not told to its board';
  end if;
  -- Oldest first, and only what was sent is cleared.
  if (select array_agg((m ->> 'id')::bigint order by o) from jsonb_array_elements(due) with ordinality as x(m, o))
     is distinct from (select array_agg(id order by id) from broadcasts_due) then
    raise exception 'the outbox is not read oldest first';
  end if;
  ids := jsonb_build_array(due -> 0 -> 'id');
  perform set_config('role', 'service_role', true);
  perform broadcasts_sent(ids);
  perform tests.unbecome();
  if (select count(*) from broadcasts_due) is distinct from jsonb_array_length(due) - 1 then raise exception 'clearing one sent broadcast cleared others'; end if;
  -- A reveal that is not due reveals nothing, however it is called.
  if reveal_season(now()) is not null then raise exception 'a season not yet at its end was revealed'; end if;
end $$;

-- ---- A tally that cannot be written does not hold the settlement back ----
do $$
declare
  ann uuid := tests.account('stuck-ann');
  start_at timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  waiting uuid;
  said jsonb;
  words jsonb := (select value from settings where key = 'copy');
begin
  insert into characters (owner, name, created_at) values (ann, 'Stuck Debut', start_at + interval '1 hour') returning id into waiting;
  -- The instance's words lost (only by hand: settings_copy_kept holds them otherwise).
  alter table settings disable trigger settings_copy_kept;
  delete from settings where key = 'copy';
  -- A season with no Turns thread yet, whose tally needs the words to title one.
  update seasons set turns_thread = null where ends_at is null;
  said := pg_temp.settle_day();
  if not (said ->> 'applied')::boolean then raise exception 'a settlement whose tally failed was not applied: %', said; end if;
  if said ->> 'masks' is null or said ->> 'masks' not like '%copy%' then raise exception 'the settlement should say why its masks did not change: %', said; end if;
  if (select debuted_at from characters where id = waiting) is not null then raise exception 'a debut went ahead with no tally to name it'; end if;
  -- Once the words are back, the next settlement debuts it.
  insert into settings (key, value) values ('copy', words);
  alter table settings enable trigger settings_copy_kept;
  said := pg_temp.settle_day();
  if (select debuted_at from characters where id = waiting) is null then raise exception 'the next settlement should debut what waited'; end if;
end $$;

-- ---- An invite opened at the very instant a window ends is the next window's ----
do $$
declare
  ann uuid := tests.account('inst-ann');
  newcomer uuid;
  made jsonb;
  start_at timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
begin
  perform tests.become(ann);
  made := create_invite();
  perform tests.unbecome();
  insert into auth.users (email) values ('inst-new@test.invalid') returning id into newcomer;
  perform tests.become(newcomer);
  perform open_account(made ->> 'code');
  perform tests.unbecome();
  update invites set used_at = start_at where id = (made ->> 'invite')::bigint;
  perform tests.become(ann);
  if (select used from my_invites where id = (made ->> 'invite')::bigint) then raise exception 'an invite opened as a window began read as used before that window settled'; end if;
  perform tests.unbecome();
end $$;

-- ---- The reveal runs from the settlement of the season's last window, dated by window ----
do $$
declare
  ann uuid := tests.account('rv-ann');
  quick uuid := tests.character(ann, 'Quick Pair One', 'alpha', now() - interval '60 days');
  quick2 uuid := tests.character(ann, 'Quick Pair Two', 'alpha', now() - interval '60 days');
  slow uuid := tests.character(ann, 'Slow Pair One', 'alpha', now() - interval '60 days');
  slow2 uuid := tests.character(ann, 'Slow Pair Two', 'alpha', now() - interval '60 days');
  next_start timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  season_no integer := (select number from seasons where ends_at is null);
  settled jsonb;
  revealed jsonb;
  due jsonb;
  w jsonb;
begin
  -- The open season's length runs out halfway through the window after next.
  update settings set value = '{"unit": "month", "count": 3}' where key = 'seasonLength';
  update seasons set starts_at = next_start + interval '1 day 12 hours' - interval '3 months' where ends_at is null;
  perform tests.become(ann);
  -- Announced, naming the class each leaves, so the reveal shows them (0029: a silent one it never does).
  perform turn(quick, 'beta', 'announced', true, false);
  perform turn(quick2, 'beta', 'announced', true, false);
  perform turn(slow, 'beta', 'announced', true, false);
  perform turn(slow2, 'beta', 'announced', true, false);
  perform tests.unbecome();
  update pending_turns set asked_at = next_start + interval '1 hour' where character = quick;
  update pending_turns set asked_at = next_start + interval '1 hour 3 minutes' where character = quick2;
  update pending_turns set asked_at = next_start + interval '2 hours' where character = slow;
  update pending_turns set asked_at = next_start + interval '9 hours' where character = slow2;
  settled := pg_temp.settle_day();
  if settled ? 'revealed' and settled ->> 'revealed' is not null then raise exception 'a season with a window left was revealed: %', settled; end if;
  -- The last window stops at the season's end, and its settlement reveals the season. A window
  -- past the season's end is refused.
  w := next_settlement_window(next_start + interval '5 days');
  if (w ->> 'end')::timestamptz is distinct from next_start + interval '1 day 12 hours' then raise exception 'the season''s last window ends with the season: %', w; end if;
  if coalesce(pg_temp.refusal(format('select apply_settlement(%L, %L, %L)', w ->> 'start', next_start + interval '2 days', '[]')), '') not like '%season%' then
    raise exception 'a window running past its season''s end was applied';
  end if;
  delete from broadcasts_due;
  -- One character made in the last window, which debuts at the reveal's own settlement, and one
  -- still waiting: neither played in the season, and neither is in its reveal.
  insert into characters (owner, name, created_at) values (ann, 'Debuts At The Reveal', (w ->> 'start')::timestamptz + interval '1 hour'), (ann, 'Still Waiting', 'infinity');
  perform set_config('role', 'service_role', true);
  settled := apply_settlement((w ->> 'start')::timestamptz, (w ->> 'end')::timestamptz, '[]');
  perform tests.unbecome();
  if (settled ->> 'revealed')::integer is distinct from season_no then raise exception 'the settlement of the season''s last window reveals it: %', settled; end if;
  if (select ends_at from seasons where number = season_no) is distinct from next_start + interval '1 day 12 hours' then raise exception 'the season ends where its last window does'; end if;
  if (select starts_at from seasons where ends_at is null) is distinct from next_start + interval '1 day 12 hours' then raise exception 'the next season opens as the last ends'; end if;
  if exists (select 1 from acts where kind = 'reveal' and payload ->> 'season' = season_no::text and payload ->> 'name' in ('Debuts At The Reveal', 'Still Waiting')) then
    raise exception 'the reveal named a character that played no part in the season';
  end if;
  if (select (payload ->> 'characters')::integer from acts where kind = 'reveal' and payload ->> 'season' = season_no::text and payload ? 'body')
     is distinct from (select count(*) from characters where debuted_at < next_start + interval '1 day 12 hours') then
    raise exception 'the reveal counted a character that played no part in the season';
  end if;
  -- Two Turns made minutes apart read as two made hours apart: each is dated by its window.
  select jsonb_object_agg(payload ->> 'name', payload -> 'shown') into revealed from acts
  where kind = 'reveal' and payload ->> 'season' = season_no::text and payload ->> 'name' like '% Pair %';
  if revealed -> 'Quick Pair One' is distinct from revealed -> 'Quick Pair Two' or revealed -> 'Quick Pair One' is distinct from revealed -> 'Slow Pair One' or revealed -> 'Slow Pair One' is distinct from revealed -> 'Slow Pair Two' then
    raise exception 'Turns in one window are told apart in the reveal: %', revealed;
  end if;
  if (revealed -> 'Quick Pair One' -> 0 ->> 'at')::timestamptz is distinct from next_start + interval '1 day' then raise exception 'a Turn is dated by the window it took effect at: %', revealed; end if;
  -- The reveal's Acts wait in the outbox, its thread for its board and each Act for the thread.
  perform set_config('role', 'service_role', true);
  due := due_broadcasts();
  perform tests.unbecome();
  if (select count(*) from jsonb_array_elements(due) m where m ->> 'event' = 'act' and m -> 'payload' ->> 'kind' = 'reveal')
     is distinct from (select count(*) from acts where kind = 'reveal' and payload ->> 'season' = season_no::text) then
    raise exception 'every Act of the reveal is broadcast: %', due;
  end if;
  if not exists (select 1 from jsonb_array_elements(due) m where m ->> 'event' = 'thread' and m ->> 'topic' = 'board:' || system_board()) then raise exception 'the reveal''s thread is broadcast on its board'; end if;
  -- Revealed once, however often the window is applied.
  perform set_config('role', 'service_role', true);
  perform apply_settlement((w ->> 'start')::timestamptz, (w ->> 'end')::timestamptz, '[]');
  perform tests.unbecome();
  if (select count(*) from acts where kind = 'reveal' and payload ->> 'season' = season_no::text and payload ? 'body') is distinct from 1 then raise exception 'a season was revealed twice'; end if;
  -- No hourly job reveals a season any more.
  if exists (select 1 from cron.job where jobname = 'kayfabb-reveal') then raise exception 'the hourly reveal job is still scheduled'; end if;
end $$;
