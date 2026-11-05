-- Updates (supabase/migrations/0062_updates.sql; the alerts plan, Task 7; the alerts design, sections 3 and 6): the developer is a
-- staff character of its own kind, written only by post_update (an admin's), in a thread The System's board never lists; its Acts
-- earn nothing; a spin from one opens a board thread; a new update is one `update` alert for every player.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- A suite shares one database, and 0031 commits tallies of its own, which are news for every player (0063). The counts below are of what this
-- file makes, so season news is counted apart (0068 holds it): `old_news()` is the season news newer than the signed-in account's mark, and
-- `unread()` is the HUD's count less it.
create function pg_temp.old_news() returns integer language sql security definer as $f$
  select (select count(*)::integer from (
    select 1 from news_landed n where n.landed_at > coalesce((select p.alerts_seen_at from account_preferences p where p.account = signed_in_account()), (select a.created_at from accounts a where a.id = signed_in_account()))
    union all select 1 from season_boss_changes h where h.landed_at > coalesce((select p.alerts_seen_at from account_preferences p where p.account = signed_in_account()), (select a.created_at from accounts a where a.id = signed_in_account()))
    union all select 1 from season_boss_changes h where h.outgoing is not null and h.landed_at > coalesce((select p.alerts_seen_at from account_preferences p where p.account = signed_in_account()), (select a.created_at from accounts a where a.id = signed_in_account()))
  ) old)
$f$;
create function pg_temp.unread() returns integer language sql security definer as $f$ select my_alerts_unread() - pg_temp.old_news() $f$;


-- The migration exists at all (so a missing one fails here, on an assertion, and not on a missing function below).
do $$
begin
  if to_regprocedure('post_update(text,text,jsonb)') is null then raise exception 'post_update(text, text, jsonb) exists'; end if;
  if to_regprocedure('updates(timestamptz,integer)') is null then raise exception 'updates(timestamptz, integer) exists'; end if;
end $$;

-- ---- The seed makes the developer and its thread, once, and only when its seed has one ----
do $$
declare
  seed jsonb := jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Gabe', 'title', 'Made this. Sorry.', 'avatar', 'gabe'));
  dev uuid;
  ut uuid;
  sys uuid := system_board();
  before_threads integer;
begin
  -- A seed with no developer makes none and no thread.
  perform seed_instance(seed - 'developer');
  if exists (select 1 from characters where staff_kind = 'developer') then raise exception 'a seed with no developer made one'; end if;
  if exists (select 1 from settings where key = 'updatesThread') then raise exception 'a seed with no developer made an updates thread'; end if;

  before_threads := (select count(*) from threads where board = sys);
  perform seed_instance(seed);
  select id into dev from characters where staff_kind = 'developer';
  if dev is null then raise exception 'the seed made no developer'; end if;
  if (select name from characters where id = dev) is distinct from 'Gabe' or (select staff from characters where id = dev) is distinct from 'developer'
     or (select owner from characters where id = dev) is not null or (select debuted_at from characters where id = dev) is null then
    raise exception 'the developer is a staff character with the seed''s name, no owner, and has debuted';
  end if;
  if (select title from character_profiles where character = dev) is distinct from 'Made this. Sorry.' then raise exception 'the developer''s tagline is its profile title'; end if;
  if (select value #>> '{}' from settings where key = 'developerAvatar') is distinct from 'gabe' then raise exception 'the developer''s avatar key is recorded'; end if;
  select (value #>> '{}')::uuid into ut from settings where key = 'updatesThread';
  if ut is null or (select board from threads where id = ut) is distinct from sys then raise exception 'the updates thread is on The System''s board and recorded in updatesThread'; end if;
  if (select count(*) from threads where board = sys) is distinct from before_threads + 1 then raise exception 'the seed made one thread'; end if;

  -- A reseed makes no second of either.
  perform seed_instance(seed);
  if (select count(*) from characters where staff_kind = 'developer') is distinct from 1 or (select count(*) from threads where board = sys) is distinct from before_threads + 1 then
    raise exception 'a reseed made a second developer or thread';
  end if;
  -- Only one developer can exist.
  begin insert into characters (name, staff, staff_kind, debuted_at) values ('Second Dev', 'dev-two', 'developer', now()); raise exception 'a second developer was made';
  exception when unique_violation then null; end;
  -- The kind is among the two.
  begin insert into characters (name, staff, staff_kind, debuted_at) values ('Odd Kind', 'odd', 'henchman', now()); raise exception 'a kind outside persona and developer was made';
  exception when check_violation then null; end;

  -- The board's thread counter is the length of its list: the hidden thread is in neither.
  if (select count(*) from thread_list where board = sys) is distinct from coalesce((select threads from board_counts where board = sys), 0) then
    raise exception 'the system board''s counter (%) is not its list (%)', (select threads from board_counts where board = sys), (select count(*) from thread_list where board = sys);
  end if;
end $$;

-- ---- A new update is one `update` alert for every player, the same for each ----
do $$
declare
  ann uuid := tests.account('upa-ann');
  bob uuid := tests.account('upa-bob');
  cat uuid := tests.account('upa-cat');
  adm uuid := tests.account('upa-admin');
  ut uuid;
  u1 uuid;
  ann_rows jsonb;
  bob_rows jsonb;
  stored integer := (select count(*) from alerts);
begin
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Gabe', 'title', 'Made this. Sorry.')));
  select (value #>> '{}')::uuid into ut from settings where key = 'updatesThread';
  insert into admins (account) values (adm);
  -- A player with no character at all gets it too: it is nothing of theirs.
  perform tests.become(ann);
  if (select count(*) from my_alerts() where kind = 'update') is distinct from 0 or pg_temp.unread() is distinct from 0 then raise exception 'no update, no alert'; end if;
  perform tests.unbecome();

  perform tests.become(adm);
  u1 := (post_update('First news', 'Body one.', '[]') ->> 'act')::uuid;
  perform tests.unbecome();

  perform tests.become(ann);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at, x.act), '[]') into ann_rows from my_alerts() x where x.kind = 'update';
  if pg_temp.unread() is distinct from 1 then raise exception 'the count includes the update: %', pg_temp.unread(); end if;
  perform tests.unbecome();
  perform tests.become(bob);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.at, x.act), '[]') into bob_rows from my_alerts() x where x.kind = 'update';
  if pg_temp.unread() is distinct from 1 then raise exception 'the count includes the update for every player'; end if;
  perform tests.unbecome();
  if jsonb_array_length(ann_rows) is distinct from 1 then raise exception 'each player gets one update alert: %', ann_rows; end if;
  if ann_rows is distinct from bob_rows then raise exception 'an update alert is the same for every player: % vs %', ann_rows, bob_rows; end if;
  if ann_rows #>> '{0,act}' is distinct from u1::text or ann_rows #>> '{0,thread}' is distinct from ut::text or ann_rows #>> '{0,title}' is distinct from 'First news'
     or ann_rows #>> '{0,name}' is distinct from 'Gabe' or ann_rows #>> '{0,character}' is not null or ann_rows #>> '{0,sub}' is not null or ann_rows #>> '{0,count}' is not null then
    raise exception 'the update alert names the Act, the thread, the update''s title and the persona, and no character of the player''s: %', ann_rows;
  end if;
  -- Nothing is stored per player.
  if (select count(*) from alerts) is distinct from stored then raise exception 'an update is written as no row per player'; end if;

  -- The count moves with the mark, and a second update is a second alert, for a player who never looked as for one who did.
  perform tests.become(ann);
  perform see_alerts(now());
  if pg_temp.unread() is distinct from 0 then raise exception 'the count falls when the mark moves: %', pg_temp.unread(); end if;
  perform tests.unbecome();
  perform tests.become(adm);
  perform post_update('Second news', 'Body two.', '[]');
  perform tests.unbecome();
  update account_preferences set alerts_seen_at = now() - interval '1 second' where account = ann;
  perform tests.become(ann);
  if (select count(*) from my_alerts() where kind = 'update') is distinct from 2 or pg_temp.unread() is distinct from 2 then
    raise exception 'two updates, two alerts, both after the mark: % / %', (select count(*) from my_alerts() where kind = 'update'), pg_temp.unread();
  end if;
  perform tests.unbecome();
  perform tests.become(cat);
  if (select count(*) from my_alerts() where kind = 'update') is distinct from 2 or pg_temp.unread() is distinct from 2 then
    raise exception 'a player who never opened Alerts has both new: % / %', (select count(*) from my_alerts() where kind = 'update'), pg_temp.unread();
  end if;
  perform tests.unbecome();
  -- A player who joins after both updates (issue #148): they are in the list, and neither is new.
  update accounts set created_at = now() + interval '1 second' where id = cat;
  perform tests.become(cat);
  if (select count(*) from my_alerts() where kind = 'update') is distinct from 2 or pg_temp.unread() is distinct from 0 then
    raise exception 'news from before the account was opened is listed but not new: % / %', (select count(*) from my_alerts() where kind = 'update'), pg_temp.unread();
  end if;
  perform tests.unbecome();
end $$;

-- ---- Only an admin posts an update; it is an Act of kind update by the developer ----
do $$
declare
  ann uuid := tests.account('up-ann');
  adm uuid := tests.account('up-admin');
  ut uuid;
  dev uuid;
  written jsonb;
  act_id uuid;
  said text;
  was integer;
begin
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Gabe', 'title', 'Made this. Sorry.', 'avatar', 'gabe')));
  select (value #>> '{}')::uuid into ut from settings where key = 'updatesThread';
  select id into dev from characters where staff_kind = 'developer';
  insert into admins (account) values (adm);
  was := (select count(*) from acts where kind = 'update');

  -- A player, a visitor and the service role cannot.
  perform tests.become(ann);
  said := pg_temp.refusal($q$select post_update('Mine', 'A player''s update.', '[]')$q$);
  perform tests.unbecome();
  if said is null or said not like '42501%' then raise exception 'a player posted an update: %', coalesce(said, 'no refusal'); end if;
  perform tests.become_anon();
  said := pg_temp.refusal($q$select post_update('Visitor', 'A visitor''s update.', '[]')$q$);
  perform tests.unbecome();
  if said is null then raise exception 'a visitor reached post_update'; end if;
  perform tests.become_service();
  said := pg_temp.refusal($q$select post_update('Service', 'The service''s update.', '[]')$q$);
  perform tests.unbecome();
  if said is null then raise exception 'the service role posted an update, and a model would reach it so'; end if;
  if (select count(*) from acts where kind = 'update') is distinct from was then raise exception 'a refused update left an Act'; end if;

  -- An admin does, as the developer, in the updates thread.
  perform tests.become(adm);
  written := post_update('Traps now bite board cards', E'Somebody played Main Event on a thread called "why is my thread pinned".',
    '[{"label": "Trap Card", "text": "can now catch a card played on a thread or a board."}, {"label": "Fixed:", "text": "the log names the character, thread or board a card was played on."}]');
  perform tests.unbecome();
  act_id := (written ->> 'act')::uuid;
  if act_id is null or (written ->> 'title') is distinct from 'Traps now bite board cards' or (written ->> 'name') is distinct from 'Gabe' or (written ->> 'tagline') is distinct from 'Made this. Sorry.' then
    raise exception 'post_update answers the update as updates() reads it, persona and all: %', written;
  end if;
  if (select character from acts where id = act_id) is distinct from dev or (select thread from acts where id = act_id) is distinct from ut or (select kind from acts where id = act_id) is distinct from 'update' then
    raise exception 'an update is an Act of kind update by the developer in the updates thread';
  end if;
  if (select payload ->> 'title' from acts where id = act_id) is distinct from 'Traps now bite board cards'
     or (select jsonb_array_length(payload -> 'changes') from acts where id = act_id) is distinct from 2
     or (select payload #>> '{changes,0,label}' from acts where id = act_id) is distinct from 'Trap Card'
     or (select payload ->> 'body' from acts where id = act_id) not like 'Somebody played Main Event%' then
    raise exception 'the payload holds the title, body and changes: %', (select payload from acts where id = act_id);
  end if;
  if (select seq from acts where id = act_id) is distinct from (select count(*) from acts where thread = ut and kind = 'update')::integer then raise exception 'an update takes the next place in the thread'; end if;
  if (select count(*) from acts where character = dev) is distinct from was + 1 then raise exception 'the developer has one Act more'; end if;
end $$;

-- ---- The changes are repaired where they can be and refused, naming the predicate, where they cannot ----
do $$
declare
  adm uuid := tests.account('upv-admin');
  said text;
  got jsonb;
  act_id uuid;
  was integer := (select count(*) from acts where kind = 'update');
begin
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Gabe', 'title', 'Made this. Sorry.')));
  insert into admins (account) values (adm);
  perform tests.become(adm);

  -- Repaired: space around words, a blank row, a missing label, a null list, and keys that are no part of a change.
  act_id := (post_update('Repairs', 'Body.', '[{"label": "  Spaced  ", "text": "  words.  "}, {"label": "", "text": "  "}, {"text": "no label"}, {"label": "Extra", "text": "kept", "color": "red"}]') ->> 'act')::uuid;
  select payload -> 'changes' into got from acts where id = act_id;
  if got is distinct from '[{"label": "Spaced", "text": "words."}, {"label": "", "text": "no label"}, {"label": "Extra", "text": "kept"}]'::jsonb then raise exception 'the changes are trimmed, a blank row dropped, a missing label empty and other keys dropped: %', got; end if;
  act_id := (post_update('No list', 'Body.', null) ->> 'act')::uuid;
  if (select payload -> 'changes' from acts where id = act_id) is distinct from '[]'::jsonb then raise exception 'no changes is an empty list'; end if;
  act_id := (post_update('Empty list', 'Body.') ->> 'act')::uuid;
  if (select payload -> 'changes' from acts where id = act_id) is distinct from '[]'::jsonb then raise exception 'changes may be left out'; end if;

  -- Refused: each names what failed.
  said := pg_temp.refusal($q$select post_update('T', 'B.', '{"label": "x"}')$q$);
  if said is null or said not like '22023%' or said not like '%changes is a list%' then raise exception 'changes that are no list: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal($q$select post_update('T', 'B.', '["a string"]')$q$);
  if said is null or said not like '22023%' or said not like '%change 1%' then raise exception 'a change that is no object names its number: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal($q$select post_update('T', 'B.', '[{"label": "ok", "text": "fine"}, {"label": "Orphan", "text": "  "}]')$q$);
  if said is null or said not like '22023%' or said not like '%change 2%' then raise exception 'a label with no text names its number: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal($q$select post_update('T', 'B.', '[{"label": 3, "text": "fine"}]')$q$);
  if said is null or said not like '22023%' or said not like '%change 1%' then raise exception 'a label that is no string: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal(format($q$select post_update('T', 'B.', %L)$q$, jsonb_build_array(jsonb_build_object('label', 'L', 'text', repeat('x', 601)))::text));
  if said is null or said not like '22023%' or said not like '%change 1%' or said not like '%600%' then raise exception 'a text over 600 characters names its number and the bound: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal(format($q$select post_update('T', 'B.', %L)$q$, jsonb_build_array(jsonb_build_object('label', repeat('x', 81), 'text', 'fine'))::text));
  if said is null or said not like '22023%' or said not like '%80%' then raise exception 'a label over 80 characters names the bound: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal(format($q$select post_update('T', 'B.', %L)$q$, (select jsonb_agg(jsonb_build_object('label', 'L', 'text', 'row ' || g)) from generate_series(1, 31) g)::text));
  if said is null or said not like '22023%' or said not like '%30%' then raise exception 'more than 30 changes names the bound: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal($q$select post_update('   ', 'B.', '[]')$q$);
  if said is null or said not like '22023%' then raise exception 'a blank title: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal($q$select post_update('T', '', '[]')$q$);
  if said is null or said not like '22023%' then raise exception 'a blank body: %', coalesce(said, 'no refusal'); end if;
  perform tests.unbecome();
  if (select count(*) from acts where kind = 'update') is distinct from was + 3 then raise exception 'a refused update left an Act: % new updates', (select count(*) from acts where kind = 'update') - was; end if;
end $$;

-- ---- The developer is reachable by no model, no player, and no other writer ----
do $$
declare
  ann uuid := tests.account('upm-ann');
  a1 uuid := tests.character(ann, 'Upm Ann');
  dev uuid;
  boss uuid;
  ut uuid;
  t uuid := tests.thread('Upm thread');
  mine uuid;
  said text;
  stmt text;
begin
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Gabe', 'title', 'Made this. Sorry.')));
  select id into dev from characters where staff_kind = 'developer';
  select (value #>> '{}')::uuid into ut from settings where key = 'updatesThread';
  insert into characters (name, staff, staff_kind, debuted_at) values ('Upm Boss', 'upm-boss', 'persona', now()) returning id into boss;
  mine := tests.post(a1, t, 'A post.');

  -- The Director's path (the service role, by staff key) refuses the developer, whatever kind it asks for; a Boss it still writes.
  perform tests.become_service();
  foreach stmt in array array[
    format('select write_staff_act(%L, %L, %L, null, %L)', 'developer', 'post', t, '{"body": "As the developer."}'),
    format('select write_staff_act(%L, %L, %L, null, %L)', 'developer', 'post', ut, '{"body": "In its own thread."}'),
    format('select write_staff_act(%L, %L, %L, null, %L)', 'developer', 'update', ut, '{"title": "T", "body": "B", "changes": []}'),
    format('select write_staff_act(%L, %L, %L, %L, %L)', 'developer', 'card', t, mine, '{}')] loop
    said := pg_temp.refusal(stmt);
    if said is null then raise exception 'the service wrote as the developer: %', stmt; end if;
    if said not like '42501%' then raise exception 'the developer''s refusal is the privilege refusal, not %: %', said, stmt; end if;
  end loop;
  perform write_staff_act('upm-boss', 'post', t, null, '{"body": "A Boss still posts."}');
  said := pg_temp.refusal(format('select write_staff_act(%L, %L, %L, null, %L)', 'developer', 'post', t, '{"body": "x"}'));
  perform tests.unbecome();
  if exists (select 1 from acts where character = dev and kind <> 'update') then raise exception 'an Act by the developer that is no update exists though none was posted'; end if;
  if said not like '%post_update%' then raise exception 'the refusal names the way in: %', said; end if;

  -- An update by any other path is refused: no flag; the flag without the developer; a malformed payload; the developer's other kinds under the staff flag.
  said := pg_temp.refusal(format('insert into acts (character, kind, thread, payload) values (%L, ''update'', %L, %L)', dev, ut, '{"title": "T", "body": "B", "changes": []}'));
  if said is null or said not like '42501%' then raise exception 'an update was written without post_update: %', coalesce(said, 'no refusal'); end if;
  perform set_config('kayfabb.staff_writer', 'on', true);
  perform set_config('kayfabb.update_writer', 'on', true);
  said := pg_temp.refusal(format('insert into acts (character, kind, thread, payload) values (%L, ''update'', %L, %L)', boss, ut, '{"title": "T", "body": "B", "changes": []}'));
  if said is null or said not like '42501%' then raise exception 'a Boss wrote an update: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal(format('insert into acts (character, kind, thread, payload) values (null, ''update'', %L, %L)', ut, '{"title": "T", "body": "B", "changes": []}'));
  if said is null then raise exception 'an update with no author was written'; end if;
  said := pg_temp.refusal(format('insert into acts (character, kind, thread, payload) values (%L, ''update'', %L, %L)', dev, ut, '{"title": "T", "body": "B", "changes": "none"}'));
  if said is null or said not like '23514%' then raise exception 'an update whose changes are no list was written: %', coalesce(said, 'no refusal'); end if;
  said := pg_temp.refusal(format('insert into acts (character, kind, thread, payload) values (%L, ''update'', %L, %L)', dev, ut, '{"title": "T", "body": "B", "changes": [{"text": "x", "html": "<b>"}]}'));
  if said is null or said not like '23514%' then raise exception 'an update whose change holds a key of its own was written: %', coalesce(said, 'no refusal'); end if;
  perform set_config('kayfabb.update_writer', '', true);
  said := pg_temp.refusal(format('insert into acts (character, kind, thread, payload) values (%L, ''post'', %L, %L)', dev, t, '{"body": "Under the staff flag alone."}'));
  perform set_config('kayfabb.staff_writer', '', true);
  if said is null or said not like '42501%' then raise exception 'the developer posted under the staff flag alone: %', coalesce(said, 'no refusal'); end if;

  -- No player acts as it.
  perform tests.become(ann);
  foreach stmt in array array[
    format('select post(%L, %L, %L)', t, dev, 'As the developer.'),
    format('select spin(%L, %L, %L, %L)', mine, dev, 'A spin', 'Body.'),
    format('select start_thread(%L, %L, %L, %L)', 'general', dev, 'A thread', 'Body.'),
    format('select react(%L, %L, %L)', mine, dev, 'up'),
    format('select turn(%L, %L, %L)', dev, 'beta', 'x')] loop
    said := pg_temp.refusal(stmt);
    if said is null or said not like '42501%' then raise exception 'a player acted as the developer (%): %', stmt, coalesce(said, 'no refusal'); end if;
  end loop;
  perform tests.unbecome();

  -- It cannot be hired as a Mod Bot (the office log holds only personas), so no road from the roster a model works through leads to it.
  begin insert into staff_offices (staff, office, cause) values ('developer', 'mod', 'admin'); raise exception 'the developer was hired as a Mod Bot';
  exception when check_violation then null; end;
end $$;

-- ---- The board never lists the thread; updates() reads it; a reaction pays no one; a spin opens a board thread ----
do $$
declare
  ann uuid := tests.account('upr-ann');
  bob uuid := tests.account('upr-bob');
  adm uuid := tests.account('upr-admin');
  a1 uuid := tests.character(ann, 'Upr Ann', 'alpha', '2000-01-02');
  b1 uuid := tests.character(bob, 'Upr Bob', 'beta', '2000-01-02');
  s timestamptz := coalesce((select max(ends_at) from settlements), (select min(starts_at) from seasons));
  ut uuid;
  dev uuid;
  sys uuid := system_board();
  first_update uuid;
  second_update uuid;
  own uuid;
  made jsonb;
  spun uuid;
  input jsonb;
  est jsonb;
  got record;
  n integer;
  was integer;
begin
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Gabe', 'title', 'Made this. Sorry.', 'avatar', 'gabe')));
  select (value #>> '{}')::uuid into ut from settings where key = 'updatesThread';
  select id into dev from characters where staff_kind = 'developer';
  insert into admins (account) values (adm);
  was := (select count(*) from acts where kind = 'update');
  own := tests.post(a1, tests.thread('Upr own'), 'Ann earns for this.', now() - interval '10 minutes');

  -- Two updates, two hours apart: the earlier is dated by hand, as post_update writes it at the transaction's clock.
  perform set_config('kayfabb.staff_writer', 'on', true);
  perform set_config('kayfabb.update_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at)
  values (dev, 'update', ut, '{"title": "Welcome to the playtest", "body": "Hello.", "changes": []}', now() - interval '2 hours') returning id into first_update;
  perform set_config('kayfabb.staff_writer', '', true);
  perform set_config('kayfabb.update_writer', '', true);
  perform tests.become(adm);
  second_update := (post_update('Traps now bite board cards', 'The trap was right to be offended.', '[{"label": "Trap Card", "text": "catches more."}]') ->> 'act')::uuid;
  perform tests.unbecome();

  -- The board never lists the thread, however it is asked, and the board's counter is its list.
  perform tests.become(ann);
  if exists (select 1 from thread_list where id = ut) then raise exception 'thread_list lists the updates thread'; end if;
  if exists (select 1 from thread_list where board = sys and id = ut) then raise exception 'the system board lists the updates thread'; end if;
  if (select count(*) from thread_list where board = sys) is distinct from coalesce((select threads from board_counts where board = sys), 0) then
    raise exception 'the board''s count (%) is not its list (%)', (select threads from board_counts where board = sys), (select count(*) from thread_list where board = sys);
  end if;

  -- updates(): newest first, the persona on each row, the changes as a list; paged by before.
  select count(*) into n from updates();
  if n is distinct from least(20, was + 2) then raise exception 'updates() holds the updates, to its page: %', n; end if;
  select * into got from updates(null, 50) where act = second_update;
  if (select act from updates(null, 50) offset least(50, was + 2) - 1 limit 1) is distinct from first_update then raise exception 'updates() runs newest first: the earliest is last'; end if;
  if got.act is distinct from second_update or got.title is distinct from 'Traps now bite board cards' or got.name is distinct from 'Gabe'
     or got.tagline is distinct from 'Made this. Sorry.' or got.avatar is distinct from 'gabe' or got.character is distinct from dev
     or got.thread is distinct from ut or got.body is distinct from 'The trap was right to be offended.' or got.changes is distinct from '[{"label": "Trap Card", "text": "catches more."}]'::jsonb
     or got.seq is distinct from was + 2 then
    raise exception 'the newest update with the persona: %', got;
  end if;
  if (select act from updates(now() - interval '1 hour', 10)) is distinct from first_update then raise exception 'before is exclusive and pages back'; end if;
  if (select count(*) from updates(null, 1)) is distinct from 1 then raise exception 'most bounds the page'; end if;
  if (select count(*) from updates(null, 0)) is distinct from 1 or (select count(*) from updates(null, 1000)) is distinct from least(50, was + 2) then raise exception 'most is held to 1 through 50'; end if;
  perform tests.unbecome();
  -- Its readers: a signed-in player, not a visitor.
  perform tests.become_anon();
  if pg_temp.refusal('select * from updates()') is null then raise exception 'a visitor read updates()'; end if;
  perform tests.unbecome();

  -- A reaction to an update is tallied and pays no one: the update is a System Act in the input, not an Act that earns.
  perform tests.become(bob);
  perform react(second_update, b1, 'up');
  perform react(own, b1, 'up');
  perform tests.unbecome();
  if not exists (select 1 from reaction_tallies where act = second_update and kind = 'up' and count = 1) then raise exception 'a reaction to an update is not tallied'; end if;
  input := settlement_input(now() - interval '1 day', now() + interval '1 day');
  if exists (select 1 from jsonb_array_elements(input -> 'acts') x where x ->> 'id' in (first_update::text, second_update::text) or x ->> 'character' = dev::text) then
    raise exception 'an update is in what earns: %', input -> 'acts';
  end if;
  if exists (select 1 from jsonb_array_elements(input -> 'characters') x where x ->> 'id' = dev::text) then raise exception 'the developer is among the settlement''s characters'; end if;
  if not (input -> 'systemActs') @> to_jsonb(second_update::text) then raise exception 'an update reacted to is not named a System Act, so settle.ts would pay for its reactions: %', input -> 'systemActs'; end if;
  if not exists (select 1 from jsonb_array_elements(input -> 'acts') x where x ->> 'id' = own::text) then raise exception 'an ordinary Act is still settled'; end if;
  est := estimate_input(bob, now() + interval '1 day');
  if est is not null and exists (select 1 from jsonb_array_elements(est -> 'acts') x where x ->> 'id' = second_update::text or x ->> 'character' = dev::text) then
    raise exception 'the estimate settles an update: %', est -> 'acts';
  end if;
  if is_staff_side(dev, 'update', null) is distinct from true then raise exception 'is_staff_side counts the developer''s Act'; end if;
  if exists (select 1 from ledger where character = dev) then raise exception 'the developer has a ledger row'; end if;
  -- The developer has no owner to hold a reactor apart from: Ann reacts too, and both are tallied.
  perform tests.become(ann);
  perform react(second_update, a1, 'wow');
  perform tests.unbecome();
  if (select sum(count) from reaction_tallies where act = second_update) is distinct from 2::bigint then raise exception 'both players'' reactions are tallied'; end if;

  -- A spin from an update opens a thread on the players' board, with the update as its origin.
  perform tests.become(ann);
  made := spin(second_update, a1, 'The trap was right to be offended', 'Discuss.');
  perform tests.unbecome();
  spun := (made -> 'thread' ->> 'id')::uuid;
  if spun is null or (select board from threads where id = spun) is distinct from players_board() or (select origin_act_id from threads where id = spun) is distinct from second_update then
    raise exception 'a spin from an update opens a thread on the players'' board with the update as origin: %', made;
  end if;
  perform tests.become(bob);
  select * into got from thread_list where id = spun;
  perform tests.unbecome();
  if got.id is null or got.origin_place is distinct from jsonb_build_object('kind', 'update', 'act', second_update, 'title', (select payload ->> 'title' from acts where id = second_update)) or got.origin_thread is distinct from ut then
    raise exception 'the spun thread names where it was spun from: %', got;
  end if;
  if not exists (select 1 from thread_list where board = players_board() and id = spun) then raise exception 'the spun thread is listed on the board'; end if;
end $$;

-- ---- Who can call what ----
do $$
begin
  if has_function_privilege('anon', 'post_update(text,text,jsonb)', 'execute') or has_function_privilege('anon', 'updates(timestamptz,integer)', 'execute') then raise exception 'a visitor can call the updates functions'; end if;
  if not (has_function_privilege('authenticated', 'post_update(text,text,jsonb)', 'execute') and has_function_privilege('authenticated', 'updates(timestamptz,integer)', 'execute')) then
    raise exception 'the web client cannot call the updates functions';
  end if;
  if has_function_privilege('authenticated', 'alerts_news(timestamptz,integer)', 'execute') or has_function_privilege('authenticated', 'alerts_news_unread(timestamptz)', 'execute') then
    raise exception 'a player can call the news sources directly';
  end if;
  if (select prosecdef from pg_proc where oid = 'post_update(text,text,jsonb)'::regprocedure) is not true
     or (select proconfig::text from pg_proc where oid = 'post_update(text,text,jsonb)'::regprocedure) not like '%search_path=public, pg_temp%' then
    raise exception 'post_update is a definer with a pinned search_path';
  end if;
end $$;

-- ---- A seed with a developer but no board to open its thread on says so plainly ----
do $$
declare
  said text;
begin
  begin
    -- Foreign keys and triggers are set aside for the one subtransaction that is rolled back below.
    set local session_replication_role = replica;
    delete from boards;
    if system_board() is not null then raise exception 'the boards are gone but system_board() is not null'; end if;
    delete from characters where staff_kind = 'developer';
    delete from settings where key = 'updatesThread';
    begin
      perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
        'developer', jsonb_build_object('name', 'Gabe', 'title', 'Made this. Sorry.', 'avatar', 'gabe')));
    exception when others then
      said := sqlerrm;
    end;
    raise exception 'undo';
  exception when raise_exception then
    if sqlerrm is distinct from 'undo' then raise; end if;
  end;
  if said is distinct from 'a developer needs The System''s board; seed boards first' then
    raise exception 'a developer with no board is refused in plain words, not: %', said;
  end if;
end $$;
