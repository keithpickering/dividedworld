-- Pronouns on the screens' reads (supabase/migrations/0125_pronouns_on_screens.sql; docs/plans/2026-11-07-pronouns-plan.md, Task 4; the amendment, section 5).
--
-- 1. Every read that hands a screen a character's profile hands its `pronouns` too: thread_page, board_page, index_page, profile_page, record_page and boot each carry a she/her
--    character's set, and no profile in any of them is without one. (A profile is any object with a `pip_style`; the check finds them wherever a read nests them.)
-- 1b. my_characters (the player's own, read by the client and carried by boot) says the set too.
-- 2. Where a read hands a screen a staff member by name alone, its pronouns go beside the name: a visit's Mod in thread_page (its row in `people`), beat_mod_name, the queue's Boss
--    and the Boss list, and an update's persona.
-- 5. The one-read pages (alerts_page, my_characters_page and log_page) carry the set on every profile they nest; updates_page and queue_page hand the persona's and the Bosses' beside
--    their names (season_page hands no profile and no staff name, so it carries none).

create function pg_temp.profiles(doc jsonb) returns setof jsonb language sql as $$
  select jsonb_path_query(doc, 'strict $.** ? (exists(@.pip_style))')
$$;
-- Every profile in the document has a set; one of them is the subject's.
create function pg_temp.carries(label text, doc jsonb, subject text) returns void language plpgsql as $$
begin
  if doc is null then raise exception '%: the read answered nothing', label; end if;
  if not exists (select 1 from pg_temp.profiles(doc)) then raise exception '%: no profile in the read: %', label, doc; end if;
  if exists (select 1 from pg_temp.profiles(doc) p where jsonb_typeof(p -> 'pronouns') is distinct from 'object') then
    raise exception '%: a profile without pronouns: %', label, (select p from pg_temp.profiles(doc) p where jsonb_typeof(p -> 'pronouns') is distinct from 'object' limit 1);
  end if;
  if not exists (select 1 from pg_temp.profiles(doc) p where p #>> '{pronouns,subject}' = subject) then
    raise exception '%: no profile carries the % set: %', label, subject, doc;
  end if;
end $$;
create function pg_temp.say(by_character uuid, in_thread uuid, body text) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become((select owner from characters where id = by_character));
  made := post(in_thread, by_character, body);
  perform tests.unbecome();
  return (made ->> 'id')::uuid;
end $$;

-- ---- 0. The world: a Boss (she/her) and a Mod (they/them) on staff, the developer (he/him), one admin ----
do $$
declare
  seed jsonb;
  she jsonb := '{"subject": "she", "object": "her", "determiner": "her", "possessive": "hers", "reflexive": "herself", "plural": false}';
  they jsonb := '{"subject": "they", "object": "them", "determiner": "their", "possessive": "theirs", "reflexive": "themself", "plural": true}';
  he jsonb := '{"subject": "he", "object": "him", "determiner": "his", "possessive": "his", "reflexive": "himself", "plural": false}';
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3, 'pronouns', she,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5, 'patrolPool', 20,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'bossFarewell', jsonb_build_array('Farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.'), 'ruleSet', jsonb_build_array('On {board}: {rule}.'),
        'visitArrived', jsonb_build_array('{mod} is looking at this post under {rule}.'),
        'visitFiled', jsonb_build_array('{mod} filed this post under {rule}.'),
        'appealUpheld', jsonb_build_array('{mod} turns {appellant} down.')),
      'systemMoveWords', jsonb_build_object('setRule', 'a rule', 'renameBoard', 'the renaming of a board')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Pn Gabe', 'title', 'Made this. Sorry.', 'pronouns', he),
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'ps-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'ps-boss', 'name', 'Pn Screens Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb, 'pronouns', she),
        jsonb_build_object('key', 'ps-m1', 'name', 'Pn Screens Mod', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb, 'pronouns', they,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50))),
      'firstStaff', jsonb_build_array('ps-m1'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod')),
                                 jsonb_build_object('key', 'renameBoard', 'structural', true), jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
  perform seed_instance(seed);
  if beat_of((select id from boards where slug = 'general')) is distinct from 'ps-m1' then raise exception 'the world: the beat Mod of General is %', beat_of((select id from boards where slug = 'general')); end if;
  insert into admins (account) values (tests.account('ps-admin'));
end $$;

-- ---- 1. Each page read carries the profile's pronouns; a visit's Mod is in `people` with its own ----
do $$
declare
  she jsonb := '{"subject": "she", "object": "her", "determiner": "her", "possessive": "hers", "reflexive": "herself", "plural": false}';
  a uuid := tests.account('ps-ann');
  ann uuid := tests.character(a, 'Ps Ann');
  t uuid := tests.thread('Pronoun screens');
  t2 uuid;
  p uuid;
  page jsonb;
  mod jsonb;
  mod_id uuid := (select id from characters where staff = 'ps-m1');
begin
  insert into character_profiles (character, pronouns) values (ann, she);
  p := pg_temp.say(ann, t, 'a post by a she/her character');
  perform start_visit(p, 'ps-m1', jsonb_build_object('rule_number', 2, 'board', (select board from threads where id = t), 'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'Rule 2: No double posting'));

  -- The index shows the last poster of each board: a board of its own, so ann is the last on it.
  insert into boards (slug, name, description) values ('ps-board', 'Ps Board', 'Words.');
  insert into threads (board, title) select b.id, 'Pronoun index' from boards b where b.slug = 'ps-board' returning id into t2;
  perform pg_temp.say(ann, t2, 'the last post on the board');
  perform tests.become(a);
  page := thread_page(t, 1, null, 20, '{}');
  perform pg_temp.carries('thread_page', page, 'she');
  -- The visit's Mod is a character in `people` with its profile, and the profile carries the Mod's set.
  select x -> 'profile' into mod from jsonb_array_elements(page -> 'people') x where x -> 'character' ->> 'staff' = 'ps-m1';
  if mod #>> '{pronouns,subject}' is distinct from 'they' or mod #>> '{pronouns,plural}' is distinct from 'true' then raise exception 'the visit''s Mod has no pronouns on thread_page: %', page -> 'people'; end if;
  if not exists (select 1 from jsonb_array_elements(page -> 'visits') v where v ->> 'mod' = (select x -> 'character' ->> 'id' from jsonb_array_elements(page -> 'people') x where x -> 'character' ->> 'staff' = 'ps-m1')) then
    raise exception 'the visit does not name the Mod that people carries: %', page -> 'visits';
  end if;
  perform pg_temp.carries('board_page', board_page('general', 1, '{}'), 'she');
  perform pg_temp.carries('index_page', index_page(), 'she');
  perform pg_temp.carries('profile_page', profile_page(ann), 'she');
  perform pg_temp.carries('record_page', record_page(ann, 'post', 1), 'she');
  perform pg_temp.carries('boot', boot(), 'she');
  -- The player's own characters say their set too, in the view and in boot.
  if (select m.pronouns ->> 'subject' from my_characters m where m.id = ann) is distinct from 'she' then raise exception 'my_characters does not say the pronouns'; end if;
  if not exists (select 1 from jsonb_array_elements(boot() -> 'characters') x where x ->> 'id' = ann::text and x #>> '{pronouns,subject}' = 'she') then raise exception 'boot''s characters do not say the pronouns: %', boot() -> 'characters'; end if;
  -- A staff persona's profile on its own page carries the set the seed gave it.
  perform pg_temp.carries('profile_page of the Mod', profile_page(mod_id), 'they');
  perform tests.unbecome();
end $$;

-- ---- 2. A staff member handed by name alone is handed with its pronouns ----
do $$
declare
  a uuid := tests.account('ps-bea');
  c uuid := tests.character(a, 'Ps Bea');
  gen uuid := (select id from boards where slug = 'general');
  admin uuid := (select id from auth.users where email = 'ps-admin@test.invalid');
  m bigint;
  q bigint;
  got jsonb;
  u uuid;
  row jsonb;
begin
  -- beat_mod_name: the Mod on the beat and its set.
  perform tests.become(a);
  got := beat_mod_name(gen);
  perform tests.unbecome();
  if got ->> 'mod' is distinct from 'Pn Screens Mod' or got #>> '{pronouns,subject}' is distinct from 'they' then raise exception 'beat_mod_name does not hand the Mod''s pronouns: %', got; end if;

  -- The queue: a waiting move names its Boss and the Boss's set beside it; the roster of replacements and the todo carry theirs; the Boss list does too.
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (m, 'ps-boss', 'renameBoard', jsonb_build_object('board', gen, 'name', 'Pn Renamed', 'premise', 'A premise', 'description', 'Words.'), null, 'because',
          now() - interval '1 minute', now() + interval '3 days', true) returning id into q;
  perform tests.become(admin);
  got := admin_queue();
  perform tests.unbecome();
  row := (select w from jsonb_array_elements(got -> 'waiting') w where (w ->> 'id')::bigint = q);
  if row ->> 'boss' is distinct from 'Pn Screens Boss' or row #>> '{bossPronouns,subject}' is distinct from 'she' then raise exception 'the queue does not hand the Boss''s pronouns beside its name: %', row; end if;
  -- (A persona an earlier file left with no profile row has a null set; the client reads that as the default.)
  if not exists (select 1 from jsonb_array_elements(got -> 'roster') r where r ->> 'staff' = 'ps-boss' and r #>> '{pronouns,subject}' = 'she') then
    raise exception 'the queue''s roster does not hand pronouns: %', got -> 'roster';
  end if;
  perform tests.become(admin);
  got := boss_roster_names();
  perform tests.unbecome();
  if not exists (select 1 from jsonb_array_elements(got) r where r ->> 'staff' = 'ps-boss' and r #>> '{pronouns,subject}' = 'she')
     or not exists (select 1 from jsonb_array_elements(got) r where r ->> 'staff' = 'ps-m1' and r #>> '{pronouns,subject}' = 'they') then
    raise exception 'the Boss list does not hand pronouns: %', got;
  end if;

  -- Updates: the persona that wrote an update, and its set.
  perform tests.become(admin);
  perform post_update('Pronoun news', 'Body.', '[]');
  got := to_jsonb((select x from updates() x limit 1));
  perform tests.unbecome();
  if got ->> 'name' is distinct from 'Pn Gabe' or got #>> '{pronouns,subject}' is distinct from 'he' then raise exception 'an update does not hand its persona''s pronouns: %', got; end if;
end $$;

-- ---- 3. A move in force and a move that ended carry the Boss's set; the screens' settings carry the instance's default ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'ps-admin@test.invalid');
  g uuid := (select id from boards where slug = 'general');
  landed uuid;
  ended uuid;
  q jsonb;
begin
  landed := (write_staff_act('ps-boss', 'move', (select value #>> '{}' from settings where key = 'systemAnnouncements')::uuid, null,
    jsonb_build_object('kind', 'renameBoard', 'body', 'Landed.', 'params', jsonb_build_object('board', g, 'name', 'Pn Landed', 'premise', 'p', 'description', 'd'))) ->> 'id')::uuid;
  ended := (write_staff_act('ps-boss', 'move', (select value #>> '{}' from settings where key = 'systemAnnouncements')::uuid, null,
    jsonb_build_object('kind', 'renameBoard', 'body', 'Landed.', 'params', jsonb_build_object('board', g, 'name', 'Pn Ended', 'premise', 'p', 'description', 'd'))) ->> 'id')::uuid;
  perform end_move(ended, 'met', 'demand');
  perform tests.become(admin);
  q := admin_queue();
  perform tests.unbecome();
  if not exists (select 1 from jsonb_array_elements(q -> 'inForce') j where j ->> 'act' = landed::text and j #>> '{bossPronouns,subject}' = 'she' and j ->> 'boss' = 'Pn Screens Boss') then
    raise exception 'a move in force does not hand the Boss''s pronouns: %', q -> 'inForce';
  end if;
  if not exists (select 1 from jsonb_array_elements(q -> 'ended') j where j ->> 'act' = ended::text and j #>> '{bossPronouns,subject}' = 'she' and j ->> 'boss' = 'Pn Screens Boss') then
    raise exception 'a move that ended does not hand the Boss''s pronouns: %', q -> 'ended';
  end if;
  -- The instance's default is a setting the screens read, public: in the screen settings and in boot, which carries them.
  if (select s.settings #>> '{pronouns,subject}' from screen_settings s) is distinct from 'she' then raise exception 'screen_settings does not carry the default pronouns: %', (select s.settings from screen_settings s); end if;
  perform tests.become((select id from auth.users where email = 'ps-ann@test.invalid'));
  if boot() #>> '{settings,pronouns,subject}' is distinct from 'she' then raise exception 'boot''s settings do not carry the default pronouns: %', boot() -> 'settings'; end if;
  perform tests.unbecome();
end $$;

-- ---- 4. A handover to-do carries the new Boss's set and the outgoing Boss's ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'ps-admin@test.invalid');
  todo jsonb;
begin
  update seasons set starts_at = now() - interval '60 days' where ends_at is null;
  perform reveal_season((select starts_at from seasons where ends_at is null) + interval '1 day');
  perform tests.become(admin);
  todo := admin_queue() -> 'todos' -> 0;
  perform tests.unbecome();
  if todo is null then raise exception 'the handover made no to-do'; end if;
  if todo ->> 'outgoing' is distinct from 'ps-boss' or todo #>> '{outgoingPronouns,subject}' is distinct from 'she' then raise exception 'the to-do does not hand the outgoing Boss''s pronouns: %', todo; end if;
  if todo #>> '{bossPronouns,subject}' is distinct from (select p.pronouns ->> 'subject' from characters c join character_profiles p on p.character = c.id where c.staff = todo ->> 'boss')
     or todo #>> '{bossPronouns,subject}' is null then
    raise exception 'the to-do does not hand the new Boss''s pronouns: %', todo;
  end if;
end $$;

-- ---- 5. The screens' one-read pages (0119 to 0123) hand a she/her character's set wherever they hand its profile or a staff member by name ----
do $$
declare
  she jsonb := '{"subject": "she", "object": "her", "determiner": "her", "possessive": "hers", "reflexive": "herself", "plural": false}';
  me uuid := tests.account('ps-cid');
  her uuid := tests.account('ps-dot');
  admin uuid := (select id from auth.users where email = 'ps-admin@test.invalid');
  mine uuid := tests.character(me, 'Ps Cid', 'alpha', now() - interval '60 days');
  dot uuid := tests.character(her, 'Ps Dot', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Pronoun pages');
  base timestamptz := now() - interval '2 hours';
  pp uuid; mp uuid; cplay uuid; cend uuid; onmine uuid;
  doc jsonb;
begin
  insert into character_profiles (character, pronouns) values (mine, she), (dot, she);
  -- An admin ended a card Cid played on Dot's post: the alerts page names the post's author, Dot, with her profile.
  pp := tests.post(dot, t, 'Dot posts.', base);
  cplay := tests.act(mine, 'card', t, '{"card": "splat"}', pp, base + interval '1 minute');
  perform set_config('kayfabb.card_end_writer', 'on', true);
  cend := tests.act(null::uuid, 'card_end', t, '{"why": "reversed", "by": "admin"}', cplay, base + interval '2 minutes');
  perform set_config('kayfabb.card_end_writer', 'off', true);
  insert into alerts (account, kind, act, character, at) values (me, 'cardEnded', cend, mine, base + interval '3 minutes');
  -- Dot played a card on Cid's post: the log names the play's author, Dot.
  mp := tests.post(mine, t, 'Cid posts.', base + interval '4 minutes');
  onmine := tests.act(dot, 'card', t, '{"card": "splat"}', mp, base + interval '5 minutes');

  perform tests.become(me);
  perform pg_temp.carries('alerts_page', alerts_page(null), 'she');
  doc := my_characters_page();
  perform pg_temp.carries('my_characters_page', doc, 'she');
  if not exists (select 1 from jsonb_array_elements(doc -> 'characters') x where x ->> 'id' = mine::text and x #>> '{pronouns,subject}' = 'she') then
    raise exception 'my_characters_page''s characters do not say the pronouns: %', doc -> 'characters';
  end if;
  perform pg_temp.carries('log_page', log_page(null), 'she');
  perform tests.unbecome();

  -- The Updates and queue pages hand the update's persona and the Bosses beside their names, as updates(), admin_queue() and boss_roster_names() do.
  perform tests.become(admin);
  doc := updates_page(null, null, 1);
  if not exists (select 1 from jsonb_array_elements(doc -> 'updates') u where u ->> 'name' = 'Pn Gabe' and u #>> '{pronouns,subject}' = 'he') then raise exception 'updates_page does not hand the persona''s pronouns: %', doc -> 'updates'; end if;
  if not exists (select 1 from jsonb_array_elements(doc #> '{queue,roster}') r where r ->> 'staff' = 'ps-boss' and r #>> '{pronouns,subject}' = 'she') then raise exception 'updates_page''s queue does not hand pronouns: %', doc -> 'queue'; end if;
  doc := queue_page();
  if not exists (select 1 from jsonb_array_elements(doc -> 'bosses') r where r ->> 'staff' = 'ps-boss' and r #>> '{pronouns,subject}' = 'she') then raise exception 'queue_page''s bosses do not hand pronouns: %', doc -> 'bosses'; end if;
  if not exists (select 1 from jsonb_array_elements(doc #> '{queue,roster}') r where r ->> 'staff' = 'ps-boss' and r #>> '{pronouns,subject}' = 'she') then raise exception 'queue_page''s queue does not hand pronouns: %', doc -> 'queue'; end if;
  perform tests.unbecome();
end $$;
