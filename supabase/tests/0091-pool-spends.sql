-- The pool's spends and the chatter function's doors (supabase/migrations/0089_pool_spends.sql; the staff roster design, sections 4, 5 and 8;
-- its plan, Task 10). A persona spends at most once a day (unique (day, staff)); the ledger is append-only and no client reaches it; the week
-- counts a row as a slot and a card as one more, leaving today's own rows out so a rerun counts what the first run did; a crash between a
-- post and its spend leaves an orphan the rerun finds by the post's `pool` marker; write_staff_thread holds titleMaxLength and postMaxLength,
-- and refuses a waiting or benched persona, the developer and a board that is not there; write_staff_note goes with the persona's own post;
-- the schedule is the settings trigger's. The poisons are planted below: a second spend, an edit, a note on another's post.

do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('Landed: {move}.'),
        'bossFarewell', jsonb_build_array('Farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.'))),
    'classes', '[]'::jsonb,
    'boards', jsonb_build_array(jsonb_build_object('slug', 'side', 'name', 'Side', 'description', 'Off to one side.')),
    'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Ps Gabe', 'title', 'Made this.', 'avatar', 'gabe'),
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'ps-boss',
      'staffGroup', jsonb_build_object('name', 'Test Cores'),
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'ps-boss', 'name', 'Ps Boss', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'ps-mod', 'name', 'Ps Mod', 'title', 'Mod', 'signature', 'b'),
        jsonb_build_object('key', 'ps-wait', 'name', 'Ps Wait', 'title', 'Waiting', 'signature', 'c'),
        jsonb_build_object('key', 'ps-bench', 'name', 'Ps Bench', 'title', 'Bench', 'signature', 'd')),
      'firstStaff', jsonb_build_array('ps-mod'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')))));
  update characters set debuted_at = now() where staff = 'ps-bench';
  insert into staff_offices (staff, office, cause) values ('ps-bench', 'benched', 'admin');
end $$;

create function pg_temp.refused(stmt text) returns text language plpgsql as $$
begin execute stmt; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create function pg_temp.staff_post(k text, in_thread uuid, body text, marker text default null) returns uuid language sql as $$
  select (write_staff_act(k, 'post', in_thread, null, jsonb_build_object('body', body) || coalesce(jsonb_build_object('pool', marker), '{}'::jsonb)) ->> 'id')::uuid
$$;

-- A persona's orphan of a day, as the week's orphans (through the Sunday) list it: the element for (staff, day), or null.
create function pg_temp.orphan(k text, d text) returns jsonb language sql as $$
  select e from jsonb_array_elements(pool_orphans('2030-01-13')) e where e ->> 'staff' = k and e ->> 'day' = d limit 1
$$;

-- ---- The ledger: one spend a day for a persona, written once, and no client's ----
do $$
declare
  t uuid := tests.thread('Spends');
  p1 uuid := pg_temp.staff_post('ps-boss', t, 'A pool post.');
  p2 uuid := pg_temp.staff_post('ps-mod', t, 'Another.');
  p3 uuid := pg_temp.staff_post('ps-boss', t, 'A second the same day.');
  r jsonb; said text;
begin
  perform tests.become_service();
  r := record_pool_spend('2030-01-07', 'ps-boss', 'named', p1, null, false, '{"trims": []}');
  if r ->> 'status' is distinct from 'spent' then raise exception 'the first spend was not recorded: %', r; end if;
  -- The poison: the same persona, the same day, a different post. It is not an error and it writes nothing.
  r := record_pool_spend('2030-01-07', 'ps-boss', 'quoted', p3, null, false);
  if r ->> 'status' is distinct from 'already' then raise exception 'a second spend for a day was recorded: %', r; end if;
  perform record_pool_spend('2030-01-07', 'ps-mod', 'hotOnBeat', p2, null, true, '{"cardRefused": "No."}');
  perform tests.unbecome();
  if (select count(*) from pool_spends) is distinct from 2 then raise exception 'the day holds % spends, not 2', (select count(*) from pool_spends); end if;
  -- The unique key is the table's own, not only the function's.
  said := pg_temp.refused(format('insert into pool_spends (day, staff, trigger, post_act) values (%L, %L, %L, %L)', '2030-01-07', 'ps-boss', 'named', p3));
  if said is null or said !~ '^23505' then raise exception 'the table took two spends for a persona and a day: %', said; end if;
  said := pg_temp.refused(format('insert into pool_spends (day, staff, trigger, post_act) values (%L, %L, %L, %L)', '2030-01-08', 'ps-boss', 'nonsense', p3));
  if said is null or said !~ '^23514' then raise exception 'a trigger the pool does not have was recorded: %', said; end if;
  said := pg_temp.refused('update pool_spends set started_thread = true');
  if said is null then raise exception 'a spend was updated'; end if;
  said := pg_temp.refused('delete from pool_spends');
  if said is null then raise exception 'a spend was deleted'; end if;
  said := pg_temp.refused('truncate pool_spends');
  if said is null then raise exception 'the spends were truncated'; end if;
  if (select count(*) from pg_trigger t where t.tgrelid = 'public.pool_spends'::regclass and t.tgname in ('pool_spends_no_update', 'pool_spends_no_truncate') and t.tgenabled = 'A') is distinct from 2 then
    raise exception 'the spends'' append-only triggers must fire always';
  end if;
  -- A spend names the persona's own posts: another persona's post, a post that is not a post, and a persona that is not one are refused.
  perform tests.become_service();
  said := pg_temp.refused(format('select record_pool_spend(%L, %L, %L, %L, null, false)', '2030-01-09', 'ps-boss', 'named', p2));
  if said is null or said !~ '^22023' then raise exception 'a spend named another persona''s post: %', said; end if;
  said := pg_temp.refused(format('select record_pool_spend(%L, %L, %L, %L, null, false)', '2030-01-09', 'ps-boss', 'named', t));
  if said is null then raise exception 'a spend named a thread as its post'; end if;
  said := pg_temp.refused(format('select record_pool_spend(%L, %L, %L, %L, %L, false)', '2030-01-09', 'ps-boss', 'named', p3, p3));
  if said is null or said !~ '^22023' then raise exception 'a post was a spend''s card: %', said; end if;
  said := pg_temp.refused(format('select record_pool_spend(%L, %L, %L, %L, null, false)', '2030-01-09', 'nobody', 'named', p3));
  if said is null or said !~ '^P0002' then raise exception 'a spend for no one: %', said; end if;
  perform tests.unbecome();
end $$;

-- ---- No client reaches the ledger or its doors ----
do $$
declare
  who text; denied boolean; fn text;
begin
  foreach who in array array['anon', 'authenticated'] loop
    perform set_config('role', who, true);
    denied := false;
    begin perform count(*) from pool_spends; exception when insufficient_privilege then denied := true; end;
    if not denied then raise exception '% can read the pool''s spends', who; end if;
    foreach fn in array array['select pool_week(''2030-01-07'')', 'select pool_orphans(''2030-01-07'')', 'select claim_pool_run(''2030-01-07'')', 'select pool_context()', 'select pool_names(''[]'')',
      'select pool_thread(gen_random_uuid(), 1, 1, null)', 'select write_staff_thread(''ps-boss'', ''side'', ''t'', ''b'')', 'select schedule_chatter()',
      'select record_pool_spend(''2030-01-07'', ''ps-boss'', ''named'', gen_random_uuid(), null, false)', 'select write_staff_note(''ps-boss'', gen_random_uuid(), ''n'')'] loop
      denied := false;
      begin execute fn; exception when insufficient_privilege then denied := true; end;
      if not denied then raise exception '% can call %', who, fn; end if;
    end loop;
    perform tests.unbecome();
  end loop;
end $$;

-- ---- The week: a row is a slot, a card is one more, and today's rows are left out ----
do $$
declare
  t uuid := tests.thread('Week');
  c uuid := (select id from characters where staff = 'ps-boss');
  mon uuid; tue uuid; wed uuid; card uuid; w jsonb;
begin
  -- 2030-01-07 is a Monday. Monday: the boss (above) and the mod, who started a thread (already recorded). Tuesday: the boss, with a card.
  tue := pg_temp.staff_post('ps-boss', t, 'Tuesday.');
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (c, 'card', t, tue, jsonb_build_object('card', (select key from card_kinds order by key limit 1))) returning id into card;
  perform set_config('kayfabb.staff_writer', '', true);
  perform tests.become_service();
  perform record_pool_spend('2030-01-08', 'ps-boss', 'quoted', tue, card, false);
  -- Wednesday asks: Monday's two rows and Tuesday's card row are three slots and one card, four slots, and one thread.
  w := pool_week('2030-01-09');
  if (w ->> 'spent')::int is distinct from 4 or (w ->> 'threads')::int is distinct from 1 or jsonb_array_length(w -> 'today') is distinct from 0 then
    raise exception 'Wednesday''s week is wrong: %', w;
  end if;
  -- Tuesday asks again: its own row is today's, not the week's, so a rerun counts what the first run did.
  w := pool_week('2030-01-08');
  if (w ->> 'spent')::int is distinct from 2 or (w ->> 'threads')::int is distinct from 1 or w -> 'today' -> 0 ->> 'staff' is distinct from 'ps-boss' or jsonb_array_length(w -> 'today') is distinct from 1 then
    raise exception 'Tuesday''s week is wrong: %', w;
  end if;
  -- The next Monday starts a new week.
  w := pool_week('2030-01-14');
  if (w ->> 'spent')::int is distinct from 0 or (w ->> 'threads')::int is distinct from 0 then raise exception 'a new week carried the last one''s spend: %', w; end if;
  -- Sunday still belongs to the week that began on the Monday.
  w := pool_week('2030-01-13');
  if (w ->> 'spent')::int is distinct from 4 then raise exception 'Sunday is not in its week: %', w; end if;
  perform tests.unbecome();
end $$;

-- ---- A crash between a post and its spend leaves an orphan the rerun finds, once ----
do $$
declare
  t uuid := tests.thread('Orphans');
  unmarked uuid := pg_temp.staff_post('ps-mod', t, 'A post that is none of the pool''s.');
  marked uuid := pg_temp.staff_post('ps-mod', t, 'Written, then the run died.', '2030-01-10');
  found jsonb;
begin
  perform tests.become_service();
  found := pg_temp.orphan('ps-mod', '2030-01-10');
  if found is null or (found ->> 'act')::uuid is distinct from marked or (found ->> 'startedThread')::boolean then raise exception 'the orphan was not found: %', found; end if;
  if pg_temp.orphan('ps-mod', '2030-01-11') is not null then raise exception 'an orphan of another day was found'; end if;
  if pg_temp.orphan('ps-boss', '2030-01-10') is not null then raise exception 'an orphan of another persona was found'; end if;
  -- Once its spend is recorded it is no orphan.
  perform record_pool_spend('2030-01-10', 'ps-mod', 'named', marked, null, false);
  if pg_temp.orphan('ps-mod', '2030-01-10') is not null then raise exception 'a spent post is still an orphan'; end if;
  perform tests.unbecome();
end $$;

-- ---- An orphan names the card the crash left beside it, exactly: by the pool marker and the target ----
-- A Cast is the persona's card Act marked with the day, on the reply's quoted target; a Set is its set Act (whose payload is empty) on the post itself. A
-- card of another persona, on another target, with no marker or another day's, or already some spend's, is none of the post's, however
-- close in time it was made.
do $$
declare
  t uuid := tests.thread('Orphan cards');
  quoted uuid := pg_temp.staff_post('ps-boss', t, 'The post a reply quotes.');
  other uuid := pg_temp.staff_post('ps-boss', t, 'Some other post.');
  reply uuid;
  found jsonb;
  mine uuid;
begin
  perform tests.become_service();
  reply := (write_staff_act('ps-mod', 'post', t, quoted, '{"body": "A reply.", "pool": "2030-01-12"}') ->> 'id')::uuid;
  found := pg_temp.orphan('ps-mod', '2030-01-12');
  if found ->> 'act' is distinct from reply::text or found -> 'card' is distinct from 'null'::jsonb then raise exception 'a card is tied to a post with none: %', found; end if;
  perform write_staff_act('ps-mod', 'card', t, other, '{"card": "x", "pool": "2030-01-12"}');
  perform write_staff_act('ps-boss', 'card', t, quoted, '{"card": "x", "pool": "2030-01-12"}');
  found := pg_temp.orphan('ps-mod', '2030-01-12');
  if found -> 'card' is distinct from 'null'::jsonb then raise exception 'a card on another target or of another persona is tied: %', found; end if;
  -- The poison the old tie fell for: the persona's card on the quoted target, made seconds after the post, with no marker, or another day's.
  perform write_staff_act('ps-mod', 'card', t, quoted, '{"card": "x"}');
  perform write_staff_act('ps-mod', 'card', t, quoted, '{"card": "x", "pool": "2030-01-11"}');
  found := pg_temp.orphan('ps-mod', '2030-01-12');
  if found -> 'card' is distinct from 'null'::jsonb then raise exception 'a card with no marker, or another day''s, is tied: %', found; end if;
  mine := (write_staff_act('ps-mod', 'card', t, quoted, '{"card": "x", "pool": "2030-01-12"}') ->> 'id')::uuid;
  found := pg_temp.orphan('ps-mod', '2030-01-12');
  if (found ->> 'card')::uuid is distinct from mine then raise exception 'the marked Cast on the quoted target is not tied: %', found; end if;
  -- Recorded as the spend's card, the card is no one else's, and the post is no orphan.
  perform record_pool_spend('2030-01-12', 'ps-mod', 'named', reply, mine, false);
  if pg_temp.orphan('ps-mod', '2030-01-12') is not null then raise exception 'a spent post is still an orphan'; end if;
  perform tests.unbecome();
end $$;
do $$
declare
  start_post uuid;
  set_act uuid;
  found jsonb;
begin
  perform tests.become_service();
  start_post := (write_staff_thread('ps-boss', 'side', 'A start', 'Opening.', '{"pool": "2030-01-13"}') -> 'act' ->> 'id')::uuid;
  found := pg_temp.orphan('ps-boss', '2030-01-13');
  if found -> 'card' is distinct from 'null'::jsonb then raise exception 'a thread start with no Set names a card: %', found; end if;
  -- A card Act on the post itself is no Set: only a set Act (empty payload, 0054) on the post is.
  perform write_staff_act('ps-boss', 'card', (select thread from acts where id = start_post), start_post, '{"card": "x", "pool": "2030-01-13"}');
  found := pg_temp.orphan('ps-boss', '2030-01-13');
  if found -> 'card' is distinct from 'null'::jsonb then raise exception 'a card Act on the post is tied as its Set: %', found; end if;
  -- As staff_set_card writes it (0086): the staff flag open for the insert.
  perform tests.unbecome();
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  select a.character, 'set', a.thread, a.id, '{}' from acts a where a.id = start_post returning id into set_act;
  perform set_config('kayfabb.staff_writer', '', true);
  perform tests.become_service();
  found := pg_temp.orphan('ps-boss', '2030-01-13');
  if (found ->> 'card')::uuid is distinct from set_act then raise exception 'the Set on the post is not tied: %', found; end if;
  -- And it is recorded as the spend's card (the spend names a card or a set Act).
  perform record_pool_spend('2030-01-13', 'ps-boss', 'adopted', start_post, set_act, true);
  if (select card_act from pool_spends where post_act = start_post) is distinct from set_act then raise exception 'the Set was not recorded as the spend''s card'; end if;
  perform tests.unbecome();
end $$;

-- ---- An orphan of an earlier day of the week is found on a later day, and not one of an earlier week ----
-- The run is once a day, so a crash's orphan is met the day after. 2030-01-09 is a Wednesday of the week of 01-07; 2030-01-05 a Saturday of
-- the week before; the run of 01-13 (a Sunday) is the week's last.
do $$
declare
  t uuid := tests.thread('Orphan days');
  early uuid;
  found jsonb;
begin
  perform tests.become_service();
  early := (write_staff_act('ps-mod', 'post', t, null, '{"body": "Written on Wednesday.", "pool": "2030-01-09"}') ->> 'id')::uuid;
  perform write_staff_act('ps-mod', 'post', t, null, '{"body": "Written the week before.", "pool": "2030-01-05"}');
  found := pg_temp.orphan('ps-mod', '2030-01-09');
  if (found ->> 'act')::uuid is distinct from early then raise exception 'Wednesday''s orphan was not found on Sunday: %', found; end if;
  if pg_temp.orphan('ps-mod', '2030-01-05') is not null then raise exception 'an orphan of the week before was found'; end if;
  if jsonb_array_length(pool_orphans('2030-01-07')) <> 0 then raise exception 'the orphans of later days were listed on Monday: %', pool_orphans('2030-01-07'); end if;
  -- Adopted on its own day, so the week counts it, and the unique (day, staff) holds.
  perform record_pool_spend('2030-01-09', 'ps-mod', 'adopted', early, null, false, '{"adopted": true}');
  if pg_temp.orphan('ps-mod', '2030-01-09') is not null then raise exception 'an adopted post is still an orphan'; end if;
  if (pool_week('2030-01-13') ->> 'spent')::int < 1 then raise exception 'the week does not count the adopted spend: %', pool_week('2030-01-13'); end if;
  perform tests.unbecome();
end $$;

-- ---- A run claim: the second claim inside the lease is refused, one after it is allowed, and a crashed run's ages out ----
do $$
declare
  first uuid; again uuid; said text;
begin
  perform tests.become_service();
  first := claim_pool_run('2030-02-01');
  if first is null then raise exception 'the first claim was refused'; end if;
  again := claim_pool_run('2030-02-01');
  if again is not null then raise exception 'a second claim within the lease was granted'; end if;
  if claim_pool_run('2030-02-02') is null then raise exception 'a claim for another day was refused'; end if;
  -- A lease the first claim is older than: a short lease lets a claim by.
  perform pg_sleep(0.05);
  if claim_pool_run('2030-02-01', interval '10 milliseconds') is null then raise exception 'a claim after the lease was refused'; end if;
  perform tests.unbecome();
  -- The way out of a crashed run is time alone: a claim made an hour ago does not hold the day.
  insert into pool_run_claims (day, at) values ('2030-02-03', now() - interval '1 hour');
  perform tests.become_service();
  if claim_pool_run('2030-02-03') is null then raise exception 'a claim an hour old held the day'; end if;
  if claim_pool_run('2030-02-03') is not null then raise exception 'the fresh claim did not hold the day'; end if;
  perform tests.unbecome();
  -- Two claimers cannot both win: the function takes the day's lock itself.
  if pg_get_functiondef('claim_pool_run(date, interval)'::regprocedure) !~ 'pg_advisory_xact_lock' then raise exception 'the claim does not lock'; end if;
  if (select prosecdef and proconfig::text ~ 'search_path' from pg_proc where oid = 'claim_pool_run(date, interval)'::regprocedure) is not true then raise exception 'the claim is not definer with a pinned search_path'; end if;
  said := pg_temp.refused('update pool_run_claims set day = day');
  if said is null then raise exception 'a claim was updated'; end if;
  said := pg_temp.refused('delete from pool_run_claims');
  if said is null then raise exception 'a claim was deleted'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.pool_run_claims'::regclass) then raise exception 'the claims have no row level security'; end if;
  if has_table_privilege('anon', 'public.pool_run_claims', 'select,insert,update,delete') or has_table_privilege('authenticated', 'public.pool_run_claims', 'select,insert,update,delete') then raise exception 'a client reaches the claims'; end if;
end $$;

-- ---- write_staff_thread: a thread and its first post, held to the bounds, refused to those who write nothing ----
do $$
declare
  r jsonb; said text; most_title int := (setting('titleMaxLength'))::int; most_post int := (setting('postMaxLength'))::int; fl text;
begin
  perform tests.become_service();
  r := write_staff_thread('ps-boss', 'side', 'A staff thread', 'Opening words.', '{"pool": "2030-01-10"}');
  if r -> 'thread' ->> 'title' is distinct from 'A staff thread' or r -> 'act' -> 'payload' ->> 'body' is distinct from 'Opening words.' then raise exception 'the thread: %', r; end if;
  if (select a.payload ->> 'pool' from acts a where a.id = (r -> 'act' ->> 'id')::uuid) is distinct from '2030-01-10' then raise exception 'the pool marker did not reach the post'; end if;
  if (select a.seq from acts a where a.id = (r -> 'act' ->> 'id')::uuid) is distinct from 1 then raise exception 'the first post is not the thread''s first'; end if;
  if (select a.character from acts a where a.id = (r -> 'act' ->> 'id')::uuid) is distinct from (select id from characters where staff = 'ps-boss') then raise exception 'the thread was not the persona''s'; end if;
  if not (pg_temp.orphan('ps-boss', '2030-01-10') ->> 'startedThread')::boolean then raise exception 'a thread''s first post is not read as a thread start'; end if;
  said := pg_temp.refused(format('select write_staff_thread(%L, %L, %L, %L)', 'ps-boss', 'side', repeat('t', most_title + 1), 'Body.'));
  if said is null or said !~ '^22001' then raise exception 'a title past titleMaxLength: %', said; end if;
  said := pg_temp.refused(format('select write_staff_thread(%L, %L, %L, %L)', 'ps-boss', 'side', 'Title', repeat('b', most_post + 1)));
  if said is null or said !~ '^22001' then raise exception 'a body past postMaxLength: %', said; end if;
  said := pg_temp.refused(format('select write_staff_thread(%L, %L, %L, %L)', 'ps-boss', 'side', E'  \n ', 'Body.'));
  if said is null then raise exception 'a blank title was written'; end if;
  said := pg_temp.refused(format('select write_staff_thread(%L, %L, %L, %L)', 'ps-boss', 'no-such-board', 'Title', 'Body.'));
  if said is null or said !~ '^P0002' then raise exception 'a board that is not there: %', said; end if;
  said := pg_temp.refused(format('select write_staff_thread(%L, %L, %L, %L)', 'ps-wait', 'side', 'Title', 'Body.'));
  if said is null or said !~ '^55000 a waiting persona writes nothing' then raise exception 'a waiting persona started a thread: %', said; end if;
  said := pg_temp.refused(format('select write_staff_thread(%L, %L, %L, %L)', 'ps-bench', 'side', 'Title', 'Body.'));
  if said is null or said !~ '^55000 a benched persona writes nothing' then raise exception 'a benched persona started a thread: %', said; end if;
  said := pg_temp.refused(format('select write_staff_thread(%L, %L, %L, %L)', 'ps-gabe-nobody', 'side', 'Title', 'Body.'));
  if said is null or said !~ '^P0002' then raise exception 'a thread by no one: %', said; end if;
  said := pg_temp.refused(format('select write_staff_thread(%L, %L, %L, %L)', (select staff from characters where staff_kind = 'developer'), 'side', 'Title', 'Body.'));
  if said is null or said !~ '^42501' then raise exception 'the developer started a thread: %', said; end if;
  -- The staff flag is put back as it was: a refused call leaves the transaction's flag as it found it, and a call that lands closes it.
  fl := coalesce(current_setting('kayfabb.staff_writer', true), '');
  if fl <> '' then raise exception 'the staff flag was left open: %', fl; end if;
  perform tests.unbecome();
end $$;

-- ---- write_staff_note: the persona's own post, at most 280 characters ----
do $$
declare
  t uuid := tests.thread('Notes');
  mine uuid := pg_temp.staff_post('ps-boss', t, 'Mine.');
  theirs uuid := pg_temp.staff_post('ps-mod', t, 'Theirs.');
  said text; made bigint;
begin
  perform tests.become_service();
  made := write_staff_note('ps-boss', mine, 'A thought.');
  if (select body from staff_notes where id = made) is distinct from 'A thought.' then raise exception 'the note was not written'; end if;
  -- The poison: a note on a post that is another persona's.
  said := pg_temp.refused(format('select write_staff_note(%L, %L, %L)', 'ps-boss', theirs, 'Not mine.'));
  if said is null or said !~ '^22023' then raise exception 'a note went with another persona''s post: %', said; end if;
  said := pg_temp.refused(format('select write_staff_note(%L, %L, %L)', 'ps-boss', mine, repeat('n', 281)));
  if said is null or said !~ '^23514' then raise exception 'a 281-character note: %', said; end if;
  perform tests.unbecome();
end $$;

-- ---- The context and the reads: staff facts, boards and public posts; nothing of an owner ----
do $$
declare
  ann uuid := tests.account('ps-ann'); a uuid := tests.character(ann, 'Ps Ann');
  t uuid := tests.thread('Read me');
  ctx jsonb; th jsonb; names jsonb; first_post uuid;
begin
  first_post := tests.post(a, t, 'First.', now() - interval '3 minutes');
  perform tests.post(a, t, 'Second, which is longer than ten.', now() - interval '2 minutes');
  perform tests.post(a, t, 'Third.', now() - interval '1 minute');
  perform tests.become_service();
  ctx := pool_context();
  if ctx -> 'offices' ->> 'ps-boss' is distinct from 'boss' or ctx -> 'offices' ->> 'ps-mod' is distinct from 'mod' or ctx -> 'offices' ->> 'ps-wait' is distinct from 'waiting'
     or ctx -> 'offices' ->> 'ps-bench' is distinct from 'benched' then raise exception 'the offices: %', ctx -> 'offices'; end if;
  if ctx ->> 'boss' is distinct from 'ps-boss' then raise exception 'the boss: %', ctx ->> 'boss'; end if;
  if ctx -> 'characters' ->> 'ps-boss' is distinct from (select id::text from characters where staff = 'ps-boss') then raise exception 'the persona''s character'; end if;
  if ctx -> 'characters' ? 'Ps Ann' or (select count(*) from jsonb_object_keys(ctx -> 'characters')) is distinct from 4::bigint then raise exception 'the characters map holds more than the four personas: %', ctx -> 'characters'; end if;
  if (select count(*) from jsonb_each_text(ctx -> 'boards') where value = 'side') is distinct from 1::bigint then raise exception 'the boards: %', ctx -> 'boards'; end if;
  if (select count(*) from jsonb_each_text(ctx -> 'boards') b join boards bb on bb.id = b.key::uuid where bb.is_system) is distinct from 0::bigint then raise exception 'the system board is a beat'; end if;
  if jsonb_typeof(ctx -> 'season') is distinct from 'object' then raise exception 'the season: %', ctx -> 'season'; end if;
  th := pool_thread(t, 2, 10);
  if th ->> 'title' is distinct from 'Read me' or jsonb_array_length(th -> 'posts') is distinct from 2 or th -> 'posts' -> 0 ->> 'body' is distinct from 'Second, wh' or th -> 'posts' -> 1 ->> 'body' is distinct from 'Third.'
     or th -> 'posts' -> 0 ->> 'name' is distinct from 'Ps Ann' then raise exception 'the thread read is not the newest two, oldest first, cut to ten: %', th; end if;
  if th::text ~* 'owner|account|class' then raise exception 'the thread read carries a private column: %', th; end if;
  -- `also` brings in the post a reply quotes when it is older than the newest, and ignores anything that is not a post of the thread.
  th := pool_thread(t, 1, 10, first_post);
  if jsonb_array_length(th -> 'posts') is distinct from 2 or th -> 'posts' -> 0 ->> 'body' is distinct from 'First.' or th -> 'posts' -> 1 ->> 'body' is distinct from 'Third.' then raise exception 'the quoted post was not included: %', th; end if;
  th := pool_thread(t, 1, 10, gen_random_uuid());
  if jsonb_array_length(th -> 'posts') is distinct from 1 then raise exception 'a post that is not there changed the read: %', th; end if;
  names := pool_names(jsonb_build_array(a, gen_random_uuid(), 'not an id', 7));
  if names ->> a::text is distinct from 'Ps Ann' or (select count(*) from jsonb_object_keys(names)) is distinct from 1::bigint then raise exception 'the names: %', names; end if;
  perform tests.unbecome();
end $$;

-- ---- The schedule is the settings trigger's, at pool.chatterCron, and sends nothing until the Vault holds both secrets ----
do $$
declare cmd text; sched text;
begin
  if (select count(*) from pg_trigger where tgname = 'settings_reschedule_chatter' and not tgisinternal) is distinct from 1::bigint then raise exception 'the pool setting does not reschedule the chatter'; end if;
  insert into settings (key, value) values ('pool', '{"weekly": 20, "holdback": 0.2, "threadsWeekly": 1, "cardRarityMost": "common", "priorityDays": 28, "notesRead": 12, "chatterThreadPosts": 8, "strengths": {"named": 5, "quoted": 5, "legacy": 5, "successorStumbles": 5, "oldFlame": 5, "homeTurf": 2, "seasonTurn": 2, "hotOnBeat": 2}, "chatterCron": "41 3 * * *"}')
  on conflict (key) do update set value = excluded.value;
  select schedule, command into sched, cmd from cron.job where jobname = 'kayfabb-chatter';
  if sched is distinct from '41 3 * * *' then raise exception 'the chatter is scheduled at %', sched; end if;
  if cmd !~ '/functions/v1/chatter' or cmd !~ 'kayfabb_jobs_key' or cmd ~ 'kayfabb_service_key' then raise exception 'the chatter job: %', cmd; end if;
  delete from vault.decrypted_secrets where name in ('kayfabb_functions_url', 'kayfabb_service_key', 'kayfabb_jobs_key');
  delete from net.http_request_queue;
  execute cmd;
  if exists (select 1 from net.http_request_queue) then raise exception 'the chatter''s job sent a request with no secrets'; end if;
  insert into vault.decrypted_secrets values ('kayfabb_functions_url', 'https://project.example');
  execute cmd;
  if exists (select 1 from net.http_request_queue) then raise exception 'the chatter''s job sent a request with half its secrets'; end if;
  insert into vault.decrypted_secrets values ('kayfabb_jobs_key', 'sb_secret_jobs');
  execute cmd;
  if (select count(*) from net.http_request_queue) is distinct from 1::bigint then raise exception 'the chatter''s job did not send once with both secrets'; end if;
end $$;
