-- A Mod's outcome is a post in the thread (supabase/migrations/0451_outcome_posts.sql; docs/plans/2026-11-26-outcome-posts-design.md; its plan, Task 1).
--
-- 1. A filing posts its line quoting the visited post, once, as the Mod: the call's line, else the visitFiled stock line; a benched Mod's filing ends the visit and records the error with no post.
-- 2. An infraction's ruling posts quoting the punished post, in its thread; the stock appeal line when none is given; a second close posts nothing more.
-- 3. A talk-down (a bribe paid, a quiz answered right, a card cast) owes one concession and posts nothing; a wrong answer owes nothing. pending_concessions says what the staff run needs. post_visit_concession posts
--    with {who} filled, once; past the window the tick posts the persona's stock line, and a late model write after it posts nothing; a Mod with no lines records `no line`.
-- 4. thread_page puts a visit on a page that holds only its outcome post, with `answers`; visit_outcome_posts answers only public posts.
-- 5. The carried rows: a #1191 concession post is copied into outcome_posts as `intercepted`.
-- 6. A group move's ruling posts in the move's staff thread quoting the move, and its overturn owes no end line; with the ruling refused (the hearer benched) the end line is owed; a move in a thread that is not a staff thread posts nothing.
-- 7. The Banlist: a filing that fills the bar owes one bans_owed row and posts nothing at once; post_ban_entry posts the code line and the persona's line in the season's Banlist, opening it once with the copy's title;
--    the season's second ban posts in the same thread; past the grace the tick posts the stock entry; a late model write after it posts nothing; an `increased` ruling that bans owes an entry; a ruling on a ban whose
--    entry is owed posts the stock entry then the ruling quoting it; on a ban whose entry was refused, the ruling quotes nothing; on a ban from before the migration, nothing. With no banlistThreadTitle a ban records
--    the error, opens no thread and still bans; a refused first entry leaves no thread; the Banlist is one of the instance's own threads. A ban of the next season opens that season's Banlist.
-- 8. The tables are append-only and no client reads them.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

create function pg_temp.ann() returns uuid language sql as $$ select id from auth.users where email = 'op-ann@test.invalid' $$;
create function pg_temp.bob() returns uuid language sql as $$ select id from auth.users where email = 'op-bob@test.invalid' $$;
create function pg_temp.eve() returns uuid language sql as $$ select id from auth.users where email = 'op-eve@test.invalid' $$;
create function pg_temp.chr(n text) returns uuid language sql as $$ select id from characters where name = n $$;
create function pg_temp.modchar(staff text) returns uuid language sql as $$ select id from characters where characters.staff = modchar.staff $$;
create function pg_temp.owner(c uuid) returns uuid language sql as $$ select owner from characters where id = c $$;
create function pg_temp.wallet(a uuid) returns integer language sql as $$ select balance from wallets where account = a $$;

create function pg_temp.visit(p uuid, staff text, band text default 'minor') returns uuid language sql as $$
  select (start_visit(p, staff, jsonb_build_object('rule_number', 1, 'board', (select t.board from acts a join threads t on t.id = a.thread where a.id = p),
    'band', band, 'cause', 'rule', 'about_act', p, 'rule', 'Rule 1: no all-caps posts')) ->> 'visit')::uuid
$$;

create function pg_temp.end_of(visit uuid) returns acts language sql as $$ select * from acts where kind = 'visit_end' and target_act_id = visit $$;

create function pg_temp.try(through uuid, visit uuid, answer text default null) returns jsonb language plpgsql as $$
declare got jsonb;
begin
  perform tests.become((select owner from characters where id = through));
  got := intercept(through, visit, answer);
  perform tests.unbecome();
  return got;
end $$;

-- A row of an owed table made older by some minutes (the append-only trigger stood down for the update, then put back).
create function pg_temp.age(tbl text, keycol text, k uuid, minutes integer) returns void language plpgsql as $$
begin
  execute format('alter table %I disable trigger %I', tbl, tbl || '_no_update');
  execute format('update %I set at = at - make_interval(mins => %s) where %I = %L', tbl, minutes, keycol, k);
  -- The open set carries its own copy of the time (the tick and the staff run read it), aged with the row it was made beside.
  execute format('update %I set at = at - make_interval(mins => %s) where %I = %L', tbl || '_open', minutes, keycol, k);
  execute format('alter table %I enable always trigger %I', tbl, tbl || '_no_update');
end $$;

create function pg_temp.outcome(about uuid) returns outcome_posts language sql as $$ select * from outcome_posts where about_act = about $$;
create function pg_temp.body(a uuid) returns text language sql as $$ select payload ->> 'body' from acts where id = a $$;

create function pg_temp.say(by_character uuid, in_thread uuid, body text default null) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become(pg_temp.owner(by_character));
  made := post(in_thread, by_character, coalesce(body, 'A post ' || gen_random_uuid()));
  perform tests.unbecome();
  return (made ->> 'id')::uuid;
end $$;

create function pg_temp.appeal(c uuid, punishment uuid) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become(pg_temp.owner(c));
  made := open_appeal(c, punishment, 'I did nothing wrong.');
  perform tests.unbecome();
  return (made ->> 'appeal')::uuid;
end $$;

-- A character of an account of its own, with a wallet for an appeal (a player holds at most six characters).
create function pg_temp.fresh(name text) returns uuid language plpgsql as $$
declare a uuid := tests.account('op-' || replace(name, ' ', '-'));
begin
  insert into wallets (account, balance) values (a, 600);
  return tests.character(a, name);
end $$;

create function pg_temp.modbots() returns jsonb language sql as $$
  select jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5, 'patrolPool', 20,
    'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 200, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
    'cap', jsonb_build_object('punishments', 50, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10, 'quizQuestionsPerDay', 60, 'quizWriteMinutes', 15,
    'concessionsPerDay', 60, 'concessionWriteMinutes', 15)
$$;

-- ---- 0. The world: a Boss, a quiz Mod, a bribe Mod with lines, a distraction Mod, a bribe Mod with none, two more Mods; a punishment group; three players ----
do $$
declare seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'warnBar', jsonb_build_object('size', 7, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'modBots', pg_temp.modbots(),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'ruleSet', jsonb_build_array('On {board}: {rule}.'),
        'visitArrived', jsonb_build_array('{mod} is looking at this post under {rule}.'),
        'visitFiled', jsonb_build_array('{mod} filed this post under {rule}.'),
        'appealUpheld', jsonb_build_array('{mod} turns {appellant} down.'),
        'appealOverturned', jsonb_build_array('{mod} sets {appellant} free.'),
        'appealIncreased', jsonb_build_array('{mod} makes it worse for {appellant}.'),
        'banEntry', jsonb_build_array('The System shrugs at {banned}.')),
      'systemMoveWords', jsonb_build_object('setRule', 'a rule', 'conferGroup', 'moving a member into "{groupName}"')),
    'groups', jsonb_build_array(
      jsonb_build_object('key', 'members', 'name', 'Members', 'color', '#7a7a7a', 'source', 'ladder', 'rung', 0, 'condition', 'default'),
      jsonb_build_object('key', 'trialMembers', 'name', 'Trial Members', 'color', '#d2691e', 'stripe', true, 'source', 'conferred', 'tone', 'punishment')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'op-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'op-boss', 'name', 'Outcome Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'op-m1', 'name', 'Outcome Mod One', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50),
          'concessions', jsonb_build_array('Stock bribe line for {who}.', 'Another bribe line, {who}.', 'A third bribe line.')),
        jsonb_build_object('key', 'op-m2', 'name', 'Outcome Mod Two', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'quiz', 'questions', 1),
          'quiz', jsonb_build_array(jsonb_build_object('question', 'Which is the oldest?', 'choices', jsonb_build_array('Moss', 'Stone', 'Dust'), 'answer', 'Stone')),
          'concessions', jsonb_build_array('Stock quiz line for {who}.')),
        jsonb_build_object('key', 'op-m3', 'name', 'Outcome Mod Three', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'distraction'),
          'concessions', jsonb_build_array('{who} wins. This time.')),
        jsonb_build_object('key', 'op-m4', 'name', 'Outcome Mod Four', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50)),
        jsonb_build_object('key', 'op-m6', 'name', 'Outcome Mod Six', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50))),
      'firstStaff', jsonb_build_array('op-m1', 'op-m2', 'op-m3', 'op-m4', 'op-m6'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod')),
                                 jsonb_build_object('key', 'conferGroup', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'), 'derived', jsonb_build_array('groupName'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
  perform seed_instance(seed);
  perform tests.account('op-ann');
  perform tests.account('op-bob');
  perform tests.account('op-eve');
  insert into wallets (account, balance) values (pg_temp.ann(), 600), (pg_temp.bob(), 600), (pg_temp.eve(), 600);
  perform tests.character(pg_temp.bob(), 'Op Bob A');
  perform tests.character(pg_temp.ann(), 'Op Ann A');
  perform tests.character(pg_temp.ann(), 'Op Ann B');
  perform tests.character(pg_temp.eve(), 'Op Eve A');
  -- The Banlist's words are an instance's: the copy's title and entry, and a persona's own banEntry lines (the instance's set is in systemLines above).
  update settings set value = value || jsonb_build_object('banlistThreadTitle', 'Season {season}: Banlist',
    'banlistEntry', 'Banned: {character}, {days} days, {rule}. [url={post}]The post that did it.[/url]') where key = 'copy';
  insert into settings (key, value) values ('personaLines', '{"op-m1": {"banEntry": ["{mod} notes {banned} for the record."]}}') on conflict (key) do update set value = excluded.value;
end $$;

-- ---- 1. A filing posts its line, quoting the visited post, once ----
do $$
declare
  author uuid := pg_temp.chr('Op Bob A');
  mod uuid := pg_temp.modchar('op-m1');
  t uuid := tests.thread('Op filing');
  p uuid := tests.post(author, t, 'A post a Mod filed.');
  v uuid := pg_temp.visit(p, 'op-m1');
  p2 uuid := tests.post(author, t, 'A post a Mod filed with no line.');
  v2 uuid := pg_temp.visit(p2, 'op-m1');
  got jsonb;
  o outcome_posts%rowtype;
  posted acts%rowtype;
  n_posts bigint := (select count(*) from acts where kind = 'post');
  e uuid;
begin
  got := file_visit(v, 'Filed, and I mean it.');
  perform pg_temp.expect((got ->> 'filed')::boolean, 'the visit did not file: ' || got::text);
  e := (pg_temp.end_of(v)).id;
  select * into o from outcome_posts where about_act = e;
  perform pg_temp.expect(o.about_act is not null and o.kind = 'filed' and o.visit_act = v and o.source = 'model' and o.post_act is not null and o.error is null, 'the outcome row is wrong: ' || to_jsonb(o)::text);
  select * into posted from acts where id = o.post_act;
  perform pg_temp.expect(posted.kind = 'post' and posted.character = mod and posted.thread = t and posted.target_act_id = p, 'the filing post is wrong: ' || to_jsonb(posted)::text);
  perform pg_temp.expect(posted.payload ->> 'body' = 'Filed, and I mean it.', 'the filing post body is wrong: ' || (posted.payload ->> 'body'));
  perform pg_temp.expect((select count(*) from acts where kind = 'post') = n_posts + 1, 'the filing wrote ' || ((select count(*) from acts where kind = 'post') - n_posts) || ' posts');
  -- A second filing of the same visit posts nothing more.
  perform file_visit(v, 'Again.');
  perform pg_temp.expect((select count(*) from outcome_posts where visit_act = v) = 1 and (select count(*) from acts where kind = 'post') = n_posts + 1, 'a second filing posted again');

  -- No line: the visitFiled stock line.
  got := file_visit(v2, null);
  select * into o from outcome_posts where about_act = (pg_temp.end_of(v2)).id;
  perform pg_temp.expect(o.source = 'stock' and o.post_act is not null, 'the stock filing row is wrong: ' || to_jsonb(o)::text);
  perform pg_temp.expect(pg_temp.body(o.post_act) = 'Outcome Mod One filed this post under Rule 1: no all-caps posts.', 'the stock filing body is wrong: ' || pg_temp.body(o.post_act));
  perform pg_temp.expect((select a.target_act_id from acts a where a.id = o.post_act) = p2, 'the stock filing post does not quote the visited post');
end $$;

do $$
declare
  author uuid := pg_temp.chr('Op Bob A');
  t uuid := tests.thread('Op benched filing');
  p uuid := tests.post(author, t, 'A post a benched Mod filed.');
  v uuid := pg_temp.visit(p, 'op-m6');
  got jsonb;
  o outcome_posts%rowtype;
  n_posts bigint := (select count(*) from acts where kind = 'post');
begin
  insert into staff_offices (staff, office, cause) values ('op-m6', 'benched', 'admin');
  got := file_visit(v, 'A benched Mod files.');
  perform pg_temp.expect((got ->> 'filed')::boolean, 'a benched Mod''s filing did not file: ' || got::text);
  perform pg_temp.expect((pg_temp.end_of(v)).payload ->> 'outcome' = 'filed', 'the visit did not end filed');
  select * into o from outcome_posts where about_act = (pg_temp.end_of(v)).id;
  perform pg_temp.expect(o.about_act is not null and o.post_act is null and o.error is not null and o.kind = 'filed', 'the refusal was not recorded: ' || to_jsonb(o)::text);
  perform pg_temp.expect((select count(*) from acts where kind = 'post') = n_posts, 'a benched Mod posted');
  perform pg_temp.expect(exists (select 1 from acts where kind = 'infraction' and payload ->> 'visit_act' = v::text), 'the infraction did not stand');
end $$;

-- ---- 2. An infraction's ruling posts quoting the punished post; the stock line when none; once ----
do $$
declare
  author uuid := tests.character(pg_temp.bob(), 'Op Bob R');
  mod uuid := pg_temp.modchar('op-m1');
  t uuid := tests.thread('Op ruling');
  p uuid := tests.post(author, t, 'A post that drew an infraction.');
  v uuid := pg_temp.visit(p, 'op-m1');
  p2 uuid := tests.post(author, t, 'Another post that drew an infraction.');
  v2 uuid := pg_temp.visit(p2, 'op-m1');
  inf uuid; inf2 uuid; ap uuid; ap2 uuid; closed jsonb; o outcome_posts%rowtype; posted acts%rowtype;
  n_posts bigint;
begin
  perform file_visit(v, 'Filed.');
  perform file_visit(v2, 'Filed.');
  inf := (select i.id from acts i where i.kind = 'infraction' and i.payload ->> 'visit_act' = v::text);
  inf2 := (select i.id from acts i where i.kind = 'infraction' and i.payload ->> 'visit_act' = v2::text);
  ap := pg_temp.appeal(author, inf);
  n_posts := (select count(*) from acts where kind = 'post');
  closed := close_appeal(ap, 'upheld', 'No. The infraction stands, and so does this post.', null, null);
  perform pg_temp.expect((closed ->> 'closed')::boolean, 'the appeal did not close: ' || closed::text);
  select * into o from outcome_posts where about_act = (closed ->> 'ruling_act')::uuid;
  perform pg_temp.expect(o.kind = 'ruling' and o.visit_act = v and o.source = 'model' and o.post_act is not null, 'the ruling row is wrong: ' || to_jsonb(o)::text);
  select * into posted from acts where id = o.post_act;
  perform pg_temp.expect(posted.character = mod and posted.thread = t and posted.target_act_id = p, 'the ruling post is not in the punished post''s thread quoting it: ' || to_jsonb(posted)::text);
  perform pg_temp.expect(posted.payload ->> 'body' = 'No. The infraction stands, and so does this post.', 'the ruling post body is wrong');
  perform pg_temp.expect((select count(*) from acts where kind = 'post') = n_posts + 1, 'the ruling wrote another number of posts');
  -- Closing again returns the ruling that stands and posts nothing.
  closed := close_appeal(ap, 'upheld', 'Again.', null, null);
  perform pg_temp.expect((closed ->> 'existing')::boolean and (select count(*) from acts where kind = 'post') = n_posts + 1 and (select count(*) from outcome_posts where visit_act = v and kind = 'ruling') = 1, 'a second close posted');
  -- No line: the stock appeal line, in the same thread.
  ap2 := pg_temp.appeal(author, inf2);
  closed := close_appeal(ap2, 'overturned', null, null, null);
  select * into o from outcome_posts where about_act = (closed ->> 'ruling_act')::uuid;
  perform pg_temp.expect(o.source = 'stock' and o.post_act is not null, 'the stock ruling row is wrong: ' || to_jsonb(o)::text);
  perform pg_temp.expect(pg_temp.body(o.post_act) = 'Outcome Mod One sets Op Bob R free.', 'the stock ruling body is wrong: ' || pg_temp.body(o.post_act));
end $$;

-- ---- 3. A talk-down owes one concession and posts nothing; the staff write posts it; the tick posts the stock ----
do $$
declare
  author uuid := pg_temp.chr('Op Bob A');
  ann uuid := pg_temp.chr('Op Ann A');
  mod uuid := pg_temp.modchar('op-m1');
  t uuid := tests.thread('Op bribe');
  p uuid := tests.post(author, t, 'A post a bribable Mod visited.');
  v uuid := pg_temp.visit(p, 'op-m1');
  got jsonb;
  w0 integer := pg_temp.wallet(pg_temp.ann());
  n_posts bigint := (select count(*) from acts where kind = 'post');
  c concessions_owed%rowtype;
  pend record;
  r jsonb;
  o outcome_posts%rowtype;
  posted acts%rowtype;
  e uuid;
begin
  got := pg_temp.try(ann, v);
  perform pg_temp.expect((got ->> 'ended')::boolean, 'the bribe did not end the visit: ' || got::text);
  perform pg_temp.expect(pg_temp.wallet(pg_temp.ann()) = w0 - 50, 'the bribe was not spent');
  perform pg_temp.expect((select count(*) from acts where kind = 'post') = n_posts, 'a talk-down posted at once');
  perform pg_temp.expect((select count(*) from outcome_posts where visit_act = v) = 0, 'a talk-down recorded an outcome post');
  e := (pg_temp.end_of(v)).id;
  select * into c from concessions_owed where visit_act = v;
  perform pg_temp.expect(c.visit_act is not null and c.end_act = e and c.interceptor = ann and c.how = 'paid' and c.intercept_act is not null, 'the owed row is wrong: ' || to_jsonb(c)::text);
  perform pg_temp.expect((select count(*) from concessions_owed where visit_act = v) = 1, 'not one owed row');
  -- What the staff run reads.
  select * into pend from pending_concessions(50) x where x.visit_act = v;
  perform pg_temp.expect(pend.visit_act is not null and pend.end_act = e and pend.staff = 'op-m1' and pend.post_act = p and pend.thread = t and pend.interceptor_name = 'Op Ann A' and pend.how = 'paid' and pend.price = 50,
    'pending_concessions is wrong: ' || to_jsonb(pend)::text);
  perform pg_temp.expect(pend.charges is not null and jsonb_typeof(pend.charges) = 'array', 'the charges are not there');
  -- The staff write: {who} filled, once.
  r := post_visit_concession(v, 'Fine, {who}. You may pass.');
  perform pg_temp.expect((r ->> 'posted')::boolean, 'the concession was not posted: ' || r::text);
  select * into o from outcome_posts where about_act = e;
  perform pg_temp.expect(o.kind = 'intercepted' and o.visit_act = v and o.source = 'model' and o.post_act is not null, 'the concession row is wrong: ' || to_jsonb(o)::text);
  select * into posted from acts where id = o.post_act;
  perform pg_temp.expect(posted.character = mod and posted.thread = t and posted.target_act_id = p and posted.payload ->> 'body' = 'Fine, Op Ann A. You may pass.', 'the concession post is wrong: ' || to_jsonb(posted)::text);
  r := post_visit_concession(v, 'A second try.');
  perform pg_temp.expect(not (r ->> 'posted')::boolean and (r ->> 'existing')::boolean, 'a second write posted: ' || r::text);
  perform pg_temp.expect((select count(*) from acts where kind = 'post') = n_posts + 1, 'the concession wrote another number of posts');
  perform pg_temp.expect(not exists (select 1 from pending_concessions(50) x where x.visit_act = v), 'a posted concession is still pending');
  -- A visit that was not talked down owes nothing, so nothing is posted for it.
  perform pg_temp.expect(post_visit_concession(gen_random_uuid(), 'Nothing.') ->> 'posted' = 'false', 'a visit that was not talked down posted');
end $$;

do $$
declare
  author uuid := pg_temp.chr('Op Bob A');
  ann uuid := pg_temp.chr('Op Ann A');
  t uuid := tests.thread('Op window');
  p1 uuid := tests.post(author, t, 'A stock concession post.');
  v1 uuid := pg_temp.visit(p1, 'op-m1');
  p2 uuid := tests.post(author, t, 'A fresh one.');
  v2 uuid := pg_temp.visit(p2, 'op-m1');
  p3 uuid := tests.post(author, t, 'A Mod with no lines.');
  v3 uuid := pg_temp.visit(p3, 'op-m4');
  p4 uuid := tests.post(author, t, 'Late model write.');
  v4 uuid := pg_temp.visit(p4, 'op-m1');
  expected text;
  o outcome_posts%rowtype;
  tick jsonb;
  n_posts bigint;
  r jsonb;
begin
  perform pg_temp.try(ann, v1);
  perform pg_temp.try(ann, v2);
  perform pg_temp.try(ann, v3);
  perform pg_temp.try(ann, v4);
  perform pg_temp.age('concessions_owed', 'visit_act', v1, 16);
  perform pg_temp.age('concessions_owed', 'visit_act', v3, 16);
  perform pg_temp.age('concessions_owed', 'visit_act', v4, 16);
  perform pg_temp.expect(not exists (select 1 from pending_concessions(50) x where x.visit_act in (v1, v3, v4)), 'a concession past the window is still listed for the staff run');
  perform pg_temp.expect(exists (select 1 from pending_concessions(50) x where x.visit_act = v2), 'a fresh concession is not listed');
  n_posts := (select count(*) from acts where kind = 'post');
  tick := system_tick();
  perform pg_temp.expect((tick ->> 'concessionsLapsed')::integer >= 3, 'the tick settled no concessions: ' || tick::text);
  select * into o from outcome_posts where about_act = (pg_temp.end_of(v1)).id;
  perform pg_temp.expect(o.kind = 'intercepted' and o.source = 'stock' and o.post_act is not null and o.visit_act = v1, 'the stock row is wrong: ' || to_jsonb(o)::text);
  select replace(l.line, '{who}', 'Op Ann A') into expected from staff_concessions l where l.staff = 'op-m1' order by l.idx offset concession_line_index(v1, 3) limit 1;
  perform pg_temp.expect(pg_temp.body(o.post_act) = expected, 'the stock line is not the one the visit draws: ' || pg_temp.body(o.post_act) || ' vs ' || expected);
  -- The fresh one is untouched; the Mod with no lines records `no line`.
  perform pg_temp.expect(not exists (select 1 from outcome_posts where about_act = (pg_temp.end_of(v2)).id), 'a concession inside the window was posted by the tick');
  select * into o from outcome_posts where about_act = (pg_temp.end_of(v3)).id;
  perform pg_temp.expect(o.post_act is null and o.error = 'no line', 'a Mod with nothing to say was not recorded as such: ' || to_jsonb(o)::text);
  -- A late model write after the stock posts nothing.
  n_posts := (select count(*) from acts where kind = 'post');
  r := post_visit_concession(v4, 'Too late, {who}.');
  perform pg_temp.expect(not (r ->> 'posted')::boolean and (r ->> 'existing')::boolean, 'a late write after the stock posted: ' || r::text);
  perform pg_temp.expect((select count(*) from acts where kind = 'post') = n_posts, 'a late write after the stock wrote a post');
  perform pg_temp.expect((select count(*) from outcome_posts where visit_act = v4) = 1 and (select source from outcome_posts where visit_act = v4) = 'stock', 'the stock did not stand');
  -- A second tick settles nothing again.
  tick := system_tick();
  perform pg_temp.expect((tick ->> 'concessionsLapsed')::integer = 0, 'a second tick settled concessions again: ' || tick::text);
end $$;

-- A quiz answered right owes with the question; a wrong answer owes nothing; a card cast owes one for each visit.
do $$
declare
  author uuid := pg_temp.chr('Op Bob A');
  ann uuid := pg_temp.chr('Op Ann A');
  caster uuid := pg_temp.chr('Op Ann B');
  t uuid := tests.thread('Op quiz and cast');
  vq uuid := pg_temp.visit(tests.post(author, t, 'A quiz post.'), 'op-m2');
  vw uuid := pg_temp.visit(tests.post(author, t, 'A wrong answer post.'), 'op-m2');
  v3 uuid := pg_temp.visit(tests.post(author, t, 'A distraction post.'), 'op-m3');
  v3b uuid := pg_temp.visit(tests.post(author, t, 'A second distraction post.'), 'op-m3');
  got jsonb;
  pend record;
  played jsonb;
  card_act uuid;
  n_posts bigint := (select count(*) from acts where kind = 'post');
begin
  perform write_visit_quiz(vq, 'model', 'Which is the oldest?', '["Moss", "Stone", "Dust"]'::jsonb, 'Stone');
  perform write_visit_quiz(vw, 'model', 'Which is the oldest?', '["Moss", "Stone", "Dust"]'::jsonb, 'Stone');
  got := pg_temp.try(ann, vw, 'Moss');
  perform pg_temp.expect((got ->> 'succeeded')::boolean is false, 'a wrong answer succeeded');
  perform pg_temp.expect(not exists (select 1 from concessions_owed where visit_act = vw), 'a wrong answer owed a concession');
  got := pg_temp.try(ann, vq, 'Stone');
  perform pg_temp.expect((got ->> 'ended')::boolean, 'the right answer did not end the visit: ' || got::text);
  select * into pend from pending_concessions(50) x where x.visit_act = vq;
  perform pg_temp.expect(pend.how = 'answered' and pend.question = 'Which is the oldest?' and pend.choices = '["Moss", "Stone", "Dust"]'::jsonb and pend.answer = 'Stone' and pend.price is null and pend.card is null,
    'the quiz concession is wrong: ' || to_jsonb(pend)::text);
  perform pg_temp.expect((select how from concessions_owed where visit_act = vq) = 'answered', 'the quiz owed row says the wrong how');

  insert into card_kinds (key, name, alignment, rarity, play, stack, gimmick, lasts, reaches, pins, trap) values ('op-th', 'Op Thread', 'sweet', 'common', 'cast', 3, null, interval '1 day', '{thread}', false, null) on conflict (key) do nothing;
  played := place_cast(caster, 'op-th', t, '{}', '', 'thread', null, pg_temp.ann(), 0);
  perform pg_temp.expect((select count(*) from concessions_owed where visit_act in (v3, v3b)) = 2 and (select count(*) from concessions_owed where visit_act in (v3, v3b) and how = 'distracted' and interceptor = caster) = 2, 'the cast did not owe two distracted concessions');
  select * into pend from pending_concessions(50) x where x.visit_act = v3;
  perform pg_temp.expect(pend.how = 'distracted' and pend.card = 'op-th' and pend.interceptor_name = 'Op Ann B' and pend.question is null, 'the distraction concession is wrong: ' || to_jsonb(pend)::text);
  perform pg_temp.expect((select count(*) from acts where kind = 'post') = n_posts, 'a talk-down posted at once');
  -- A second cast ends nothing more and owes nothing more.
  perform place_cast(caster, 'op-th', t, '{}', '', 'thread', null, pg_temp.ann(), 0);
  perform pg_temp.expect((select count(*) from concessions_owed where visit_act in (v3, v3b)) = 2, 'a second cast owed again');
  -- A trap, a filing, a reversal and a drop owe nothing.
  perform pg_temp.expect(not exists (select 1 from concessions_owed c join acts v on v.id = c.visit_act where (pg_temp.end_of(v.id)).payload ->> 'outcome' <> 'intercepted'), 'a visit that was not talked down owes a concession');
end $$;

-- ---- 4. thread_page and visit_outcome_posts ----
do $$
declare
  author uuid := tests.character(pg_temp.bob(), 'Op Bob P');
  ann uuid := pg_temp.chr('Op Ann A');
  t uuid := tests.thread('Op page');
  p uuid := tests.post(author, t, 'The visited post.');
  filler uuid := tests.post(author, t, 'Filler.');
  v uuid := pg_temp.visit(p, 'op-m1');
  vb uuid := pg_temp.visit(tests.post(author, t, 'Another visited post.'), 'op-m1');
  vr uuid := pg_temp.visit(tests.post(author, t, 'A benched Mod''s post.'), 'op-m4');
  r1 jsonb; r2 jsonb; e uuid; entry jsonb;
  out_post uuid;
begin
  perform pg_temp.try(ann, v);
  perform post_visit_concession(v, 'Concession, {who}.');
  out_post := (select post_act from outcome_posts where visit_act = v);
  perform pg_temp.expect(out_post is not null, 'no outcome post');
  -- Posts: p (1), filler (2), visited-b (3), the benched Mod's visited post (4), the outcome post (5). Two a page: the outcome post is alone on page 3, its visit's post on page 1.
  perform tests.become(pg_temp.owner(ann));
  r1 := thread_page(t, 1, null, 2, '{}');
  r2 := thread_page(t, 3, null, 2, '{}');
  perform tests.unbecome();
  entry := (select x from jsonb_array_elements(r1 -> 'visits') x where x ->> 'visit' = v::text);
  perform pg_temp.expect(entry is not null and entry -> 'answers' = '[]'::jsonb, 'page 1 does not carry the visit with no answers: ' || coalesce((r1 -> 'visits')::text, 'null'));
  entry := (select x from jsonb_array_elements(r2 -> 'visits') x where x ->> 'visit' = v::text);
  perform pg_temp.expect(entry is not null and entry -> 'answers' = jsonb_build_array(out_post), 'page 3 does not carry the visit with its answer: ' || coalesce((r2 -> 'visits')::text, 'null'));
  perform pg_temp.expect(entry ->> 'post' = p::text, 'the visit''s post is not the visited post');

  -- A page that holds the visited post carries its outcome post in answers only where that post is on the page.
  perform tests.become(pg_temp.owner(ann));
  r1 := thread_page(t, 1, null, 20, '{}');
  perform tests.unbecome();
  entry := (select x from jsonb_array_elements(r1 -> 'visits') x where x ->> 'visit' = v::text);
  perform pg_temp.expect(entry -> 'answers' = jsonb_build_array(out_post), 'the whole thread''s page does not carry the answer');

  -- visit_outcome_posts: only public posts, for anyone.
  perform tests.become_anon();
  entry := visit_outcome_posts(v);
  perform tests.unbecome();
  perform pg_temp.expect(entry = jsonb_build_array(jsonb_build_object('kind', 'intercepted', 'about', (pg_temp.end_of(v)).id, 'post', out_post)), 'visit_outcome_posts is wrong: ' || entry::text);
  perform pg_temp.expect(visit_outcome_posts(vb) = '[]'::jsonb, 'a visit with no outcome post answered posts');
  -- A refused post is not listed.
  insert into staff_offices (staff, office, cause) values ('op-m4', 'benched', 'admin');
  perform file_visit(vr, 'Benched filing.');
  perform pg_temp.expect((select error from outcome_posts where visit_act = vr) is not null, 'the refusal was not recorded');
  perform pg_temp.expect(visit_outcome_posts(vr) = '[]'::jsonb, 'a refused post was listed');
end $$;

-- ---- 5. The carried rows ----
do $$
declare
  author uuid := pg_temp.chr('Op Bob A');
  t uuid := tests.thread('Op carried');
  v uuid := pg_temp.visit(tests.post(author, t, 'A visit from before.'), 'op-m1');
  v2 uuid := pg_temp.visit(tests.post(author, t, 'A visit from before, refused.'), 'op-m1');
  pa uuid;
  n integer;
begin
  perform end_visit(v, 'intercepted', null, 'Talked down before.');
  perform end_visit(v2, 'intercepted', null, 'Talked down before.');
  pa := (write_staff_act('op-m1', 'post', t, (select target_act_id from acts where id = v), jsonb_build_object('body', 'An old concession.')) ->> 'id')::uuid;
  insert into visit_concession_posts (visit_act, source, post_act) values (v, 'model', pa);
  insert into visit_concession_posts (visit_act, source, error) values (v2, 'stock', 'locked out');
  n := carry_visit_concession_posts();
  perform pg_temp.expect(n >= 2, 'the carry copied ' || n);
  perform pg_temp.expect((select o.kind || o.source || coalesce(o.post_act::text, '-') || o.visit_act::text from outcome_posts o where o.about_act = (pg_temp.end_of(v)).id) = 'intercepted' || 'model' || pa::text || v::text, 'the carried row is wrong');
  perform pg_temp.expect((select o.error from outcome_posts o where o.about_act = (pg_temp.end_of(v2)).id) = 'locked out', 'the carried refusal is wrong');
  perform pg_temp.expect(carry_visit_concession_posts() = 0, 'the carry is not idempotent');
  perform pg_temp.expect(not exists (select 1 from bans_owed), 'a carry made a bans_owed row');
end $$;

-- ---- 6. A group move's ruling ----
create function pg_temp.landed(staff text, who uuid, in_thread uuid) returns uuid language plpgsql as $$
declare
  made uuid;
  at timestamptz := clock_timestamp() - interval '1 day';
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  made := tests.act((select id from characters c where c.staff = landed.staff), 'move', in_thread,
    jsonb_build_object('kind', 'conferGroup', 'body', 'Moved.', 'params', jsonb_build_object('character', who::text, 'group', 'trialMembers'), 'expires_at', at + interval '4 days'), null, at);
  perform set_config('kayfabb.staff_writer', '', true);
  return made;
end $$;

do $$
declare
  c uuid := pg_temp.fresh('Op Eve Moved');
  c2 uuid := pg_temp.fresh('Op Eve Moved Two');
  mt uuid := open_staff_thread('op-m1', 'An overturned move');
  mt2 uuid := open_staff_thread('op-boss', 'A refused move ruling');
  lp uuid; sset uuid;
  m uuid; m2 uuid; ap uuid; closed jsonb; o outcome_posts%rowtype; posted acts%rowtype; n_posts bigint;
begin
  m := pg_temp.landed('op-m1', c, mt);
  ap := pg_temp.appeal(c, m);
  n_posts := (select count(*) from acts where kind = 'post');
  closed := close_appeal(ap, 'overturned', 'Overturned. Sorry about that.', null, null);
  perform pg_temp.expect((closed ->> 'closed')::boolean, 'the move appeal did not close: ' || closed::text);
  select * into o from outcome_posts where about_act = (closed ->> 'ruling_act')::uuid;
  perform pg_temp.expect(o.kind = 'move_ruling' and o.visit_act is null and o.post_act is not null and o.source = 'model', 'the move ruling row is wrong: ' || to_jsonb(o)::text);
  select * into posted from acts where id = o.post_act;
  perform pg_temp.expect(posted.thread = mt and posted.target_act_id = m and posted.character = pg_temp.modchar('op-m1') and posted.payload ->> 'body' = 'Overturned. Sorry about that.', 'the move ruling post is wrong: ' || to_jsonb(posted)::text);
  perform pg_temp.expect((select count(*) from acts where kind = 'post') = n_posts + 1, 'the move ruling wrote another number of posts');
  perform pg_temp.expect(exists (select 1 from acts where kind = 'move_end' and target_act_id = m), 'the overturn did not end the move');
  perform pg_temp.expect(not exists (select 1 from lines_owed where cause_act = m), 'an overturn that posted its ruling owes an end line');

  -- The ruling refused (the hearer locked out of the thread): the end line is owed as today.
  -- The Boss makes this one, so the Boss hears it, and the Boss is locked out of the move's thread: the ruling cannot post.
  m2 := pg_temp.landed('op-boss', c2, mt2);
  ap := pg_temp.appeal(c2, m2);
  lp := tests.post(c2, mt2, 'A post to hang the lock on.');
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, gimmick, stack, replies) values
    ('op-lk', 'Op Lock', 'pepperoni', 'rare', 'set', '{"trigger": {"on": "cast"}, "match": {"flavors": ["salty", "pepperoni"], "upTo": "rare"}, "outcome": {"kind": "lockout", "hours": 24}}', '{post}', null, null, 1, false)
  on conflict (key) do nothing;
  sset := tests.act(c2, 'set', mt2, '{}', lp);
  perform tests.act(c2, 'spring', mt2, jsonb_build_object('card', 'op-lk', 'trigger', 'cast', 'did', 'lockedOut', 'set', sset::text, 'locks', pg_temp.modchar('op-boss')::text, 'until', (now() + interval '1 day')::text), lp);
  perform pg_temp.expect(locked_out_until(pg_temp.modchar('op-boss'), mt2) is not null, 'the Boss is not locked out of the move thread');
  closed := close_appeal(ap, 'overturned', 'Overturned again.', null, null);
  select * into o from outcome_posts where about_act = (closed ->> 'ruling_act')::uuid;
  perform pg_temp.expect(o.post_act is null and o.error is not null and o.kind = 'move_ruling', 'the refused move ruling was not recorded: ' || to_jsonb(o)::text);
  perform pg_temp.expect(exists (select 1 from lines_owed where cause_act = m2 and line_key = 'moveOverturned'), 'the end line is not owed after a refused ruling');
end $$;

-- A move in a thread that is not a staff thread posts nothing.
do $$
declare
  c uuid := pg_temp.fresh('Op Eve Old Move');
  ann_t uuid := (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements');
  t uuid := tests.thread('Op not a staff thread');
  m uuid; ap uuid; closed jsonb; n_posts bigint; n_out bigint;
begin
  -- The Boss's own move, in a thread that no staff opened: its ruling has nowhere to post.
  m := pg_temp.landed('op-boss', c, t);
  ap := pg_temp.appeal(c, m);
  n_posts := (select count(*) from acts where kind = 'post');
  n_out := (select count(*) from outcome_posts);
  closed := close_appeal(ap, 'upheld', 'Upheld.', null, null);
  perform pg_temp.expect((closed ->> 'closed')::boolean, 'the old move appeal did not close: ' || closed::text);
  perform pg_temp.expect((select count(*) from acts where kind = 'post') = n_posts and (select count(*) from outcome_posts) = n_out, 'a move in a thread that is not a staff thread posted');
end $$;

-- ---- 7. The Banlist ----
-- (a) With no banlistThreadTitle: the ban records the error, opens no thread, and still bans.
do $$
declare
  c uuid := pg_temp.fresh('Op Banned Untitled');
  t uuid := tests.thread('Op untitled');
  p uuid := tests.post(c, t, 'A post that fills the bar.');
  hit jsonb; ban uuid; r jsonb; o outcome_posts%rowtype; n_threads bigint;
begin
  update settings set value = value - 'banlistThreadTitle' where key = 'copy';
  n_threads := (select count(*) from threads);
  hit := infract(c, 'severe', p, 'op-m2');
  ban := (hit ->> 'ban')::uuid;
  perform pg_temp.expect(ban is not null, 'the infraction did not ban: ' || hit::text);
  perform pg_temp.expect((select staff from bans_owed where ban_act = ban) = 'op-m2' and (select season from bans_owed where ban_act = ban) = 1, 'the owed row is wrong');
  r := post_ban_entry(ban, 'A line.', 'model');
  perform pg_temp.expect(not (r ->> 'posted')::boolean, 'an entry with no title posted: ' || r::text);
  select * into o from outcome_posts where about_act = ban;
  perform pg_temp.expect(o.kind = 'banned' and o.post_act is null and o.error ~ 'banlistThreadTitle', 'the refusal was not recorded with its reason: ' || to_jsonb(o)::text);
  perform pg_temp.expect((select count(*) from threads) = n_threads and (select banlist_thread from seasons where ends_at is null) is null, 'a refused entry left a thread');
  perform pg_temp.expect(exists (select 1 from acts where kind = 'ban' and id = ban), 'the ban did not stand');
  update settings set value = value || jsonb_build_object('banlistThreadTitle', 'Season {season}: Banlist') where key = 'copy';
end $$;

-- (b) A refused first entry (the Mod benched) leaves no thread.
do $$
declare
  c uuid := pg_temp.fresh('Op Banned Refused');
  t uuid := tests.thread('Op refused first');
  p uuid := tests.post(c, t, 'A post that fills the bar.');
  hit jsonb; ban uuid; r jsonb; o outcome_posts%rowtype; n_threads bigint;
begin
  perform pg_temp.expect(exists (select 1 from staff_offices where staff = 'op-m6' and office = 'benched'), 'the world: op-m6 is not benched');
  n_threads := (select count(*) from threads);
  hit := infract(c, 'severe', p, 'op-m6');
  ban := (hit ->> 'ban')::uuid;
  r := post_ban_entry(ban, 'A line.', 'model');
  perform pg_temp.expect(not (r ->> 'posted')::boolean, 'a benched Mod''s entry posted: ' || r::text);
  select * into o from outcome_posts where about_act = ban;
  perform pg_temp.expect(o.post_act is null and o.error is not null, 'the refusal was not recorded: ' || to_jsonb(o)::text);
  perform pg_temp.expect((select count(*) from threads) = n_threads and (select banlist_thread from seasons where ends_at is null) is null, 'a refused first entry left a thread');
end $$;

-- (c) A filing that fills the bar owes one entry and posts nothing at once; the Mod's line posts the entry in the season's Banlist, opened once.
do $$
declare
  author uuid := pg_temp.fresh('Op Banned One');
  second uuid := pg_temp.fresh('Op Banned Two');
  t uuid := tests.thread('Op ban filing');
  p uuid := tests.post(author, t, 'A post that fills the bar.');
  p2 uuid := tests.post(second, t, 'Another post that fills the bar.');
  v uuid := pg_temp.visit(p, 'op-m1', 'severe');
  v2 uuid := pg_temp.visit(p2, 'op-m1', 'severe');
  got jsonb; ban uuid; ban2 uuid; r jsonb; o outcome_posts%rowtype; posted acts%rowtype; bt uuid; n_threads bigint; seq integer; head text;
  n_posts bigint;
begin
  got := file_visit(v, 'Filed it.');
  ban := (got ->> 'ban')::uuid;
  perform pg_temp.expect(ban is not null, 'the filing did not ban: ' || got::text);
  perform pg_temp.expect((select count(*) from bans_owed where ban_act = ban) = 1 and (select staff from bans_owed where ban_act = ban) = 'op-m1', 'a filing that fills the bar did not owe one entry');
  perform pg_temp.expect(not exists (select 1 from outcome_posts where about_act = ban), 'the ban posted its entry at once');
  perform pg_temp.expect((select banlist_thread from seasons where ends_at is null) is null, 'the ban opened the Banlist at once');
  -- What the staff run reads.
  declare pend record;
  begin
    select * into pend from pending_ban_entries(50) x where x.ban_act = ban;
    perform pg_temp.expect(pend.ban_act is not null and pend.staff = 'op-m1' and pend.banned = 'Op Banned One' and pend.days = 1 and pend.rule = 'Rule 1: no all-caps posts' and pend.season = 1 and pend.post_act = p and pend.thread = t,
      'pending_ban_entries is wrong: ' || to_jsonb(pend)::text);
  end;
  n_threads := (select count(*) from threads);
  n_posts := (select count(*) from acts where kind = 'post');
  r := post_ban_entry(ban, 'Mind the rules next time.', 'model');
  perform pg_temp.expect((r ->> 'posted')::boolean, 'the entry did not post: ' || r::text);
  bt := (select banlist_thread from seasons where ends_at is null);
  perform pg_temp.expect(bt is not null and (select count(*) from threads) = n_threads + 1, 'the Banlist was not opened once');
  perform pg_temp.expect((select title from threads where id = bt) = 'Season 1: Banlist' and (select board from threads where id = bt) = system_board(), 'the Banlist is not titled or placed as the copy says');
  select * into o from outcome_posts where about_act = ban;
  perform pg_temp.expect(o.kind = 'banned' and o.visit_act is null and o.source = 'model' and o.post_act is not null, 'the entry row is wrong: ' || to_jsonb(o)::text);
  select * into posted from acts where id = o.post_act;
  seq := (select a.seq from acts a where a.id = p);
  head := 'Banned: Op Banned One, 1 days, Rule 1: no all-caps posts. [url=/t/' || t || '#post-' || seq || ']The post that did it.[/url]';
  perform pg_temp.expect(posted.character = pg_temp.modchar('op-m1') and posted.thread = bt and posted.target_act_id is null, 'the entry post is wrong: ' || to_jsonb(posted)::text);
  perform pg_temp.expect(posted.payload ->> 'body' = head || E'\n\n' || 'Mind the rules next time.', 'the entry body is wrong: ' || (posted.payload ->> 'body'));
  perform pg_temp.expect(not exists (select 1 from pending_ban_entries(50) x where x.ban_act = ban), 'a posted entry is still pending');
  -- A second try posts nothing.
  r := post_ban_entry(ban, 'Again.', 'model');
  perform pg_temp.expect(not (r ->> 'posted')::boolean and (r ->> 'existing')::boolean and (select count(*) from acts where kind = 'post' and thread = bt) = 1, 'a second write posted');
  -- The season's second ban posts in the same thread, with the entry's stock line from the persona's own set.
  got := file_visit(v2, 'Filed it too.');
  ban2 := (got ->> 'ban')::uuid;
  r := post_ban_entry(ban2, null, 'stock');
  perform pg_temp.expect((r ->> 'posted')::boolean, 'the stock entry did not post: ' || r::text);
  perform pg_temp.expect((select count(*) from acts where kind = 'post' and thread = bt) = 2 and (select count(*) from threads) = n_threads + 1, 'the second ban did not post in the same thread');
  perform pg_temp.expect(pg_temp.body((pg_temp.outcome(ban2)).post_act) ~ '\n\nOutcome Mod One notes Op Banned Two for the record\.$', 'the stock entry body is wrong: ' || pg_temp.body((pg_temp.outcome(ban2)).post_act));
  perform pg_temp.expect((pg_temp.outcome(ban2)).source = 'stock', 'the stock entry says model');
  -- The Banlist is one of the instance's own threads, and follows the system board's flag.
  perform pg_temp.expect(bt in (select instance_threads()) and thread_place(bt) = system_board(), 'the Banlist is not one of the instance''s own threads');
end $$;

-- (d) Past the grace the tick posts the stock entry; a late model write after it posts nothing. An instance's own set serves a persona with none.
do $$
declare
  c uuid := pg_temp.fresh('Op Banned Three');
  t uuid := tests.thread('Op ban tick');
  p uuid := tests.post(c, t, 'A post that fills the bar.');
  ban uuid; bt uuid; tick jsonb; r jsonb; n_posts bigint; o outcome_posts%rowtype;
begin
  ban := (infract(c, 'severe', p, 'op-m3') ->> 'ban')::uuid;
  perform pg_temp.age('bans_owed', 'ban_act', ban, 10);
  tick := system_tick();
  perform pg_temp.expect(not exists (select 1 from outcome_posts where about_act = ban), 'the tick posted an entry inside the grace');
  perform pg_temp.age('bans_owed', 'ban_act', ban, 10);
  tick := system_tick();
  perform pg_temp.expect((tick ->> 'banEntriesLapsed')::integer >= 1, 'the tick did not lapse the entry: ' || tick::text);
  select * into o from outcome_posts where about_act = ban;
  perform pg_temp.expect(o.kind = 'banned' and o.source = 'stock' and o.post_act is not null, 'the lapsed entry row is wrong: ' || to_jsonb(o)::text);
  bt := (select banlist_thread from seasons where ends_at is null);
  perform pg_temp.expect((select thread from acts where id = o.post_act) = bt, 'the lapsed entry is not in the Banlist');
  perform pg_temp.expect(pg_temp.body(o.post_act) ~ '\n\nThe System shrugs at Op Banned Three\.$', 'the instance''s own stock line did not serve: ' || pg_temp.body(o.post_act));
  n_posts := (select count(*) from acts where kind = 'post');
  r := post_ban_entry(ban, 'Too late.', 'model');
  perform pg_temp.expect(not (r ->> 'posted')::boolean and (select count(*) from acts where kind = 'post') = n_posts, 'a late write after the stock posted');
  tick := system_tick();
  perform pg_temp.expect((tick ->> 'banEntriesLapsed')::integer = 0, 'a second tick lapsed again');
end $$;

-- (e) An `increased` ruling that bans owes an entry for the hearer.
do $$
declare
  author uuid := pg_temp.fresh('Op Banned Four');
  t uuid := tests.thread('Op increased');
  p uuid := tests.post(author, t, 'A post that draws two moderates.');
  v uuid := pg_temp.visit(p, 'op-m3', 'moderate');
  inf uuid; ap uuid; closed jsonb; ban uuid;
begin
  perform file_visit(v, 'Filed.');
  inf := (select i.id from acts i where i.kind = 'infraction' and i.payload ->> 'visit_act' = v::text);
  perform pg_temp.expect(not exists (select 1 from acts where kind = 'ban' and payload ->> 'character' = author::text), 'four points banned');
  ap := pg_temp.appeal(author, inf);
  closed := close_appeal(ap, 'increased', 'Worse.', null, null);
  ban := (closed ->> 'ban')::uuid;
  perform pg_temp.expect(ban is not null, 'the increase did not ban: ' || closed::text);
  perform pg_temp.expect((select staff from bans_owed where ban_act = ban) = 'op-m3', 'the increase''s entry is not owed by the hearer: ' || coalesce((select staff from bans_owed where ban_act = ban), 'nobody'));
  perform pg_temp.expect(not exists (select 1 from outcome_posts where about_act = ban), 'the increase posted the entry at once');
end $$;

-- (f) A ruling on a ban whose entry is owed posts the stock entry, then the ruling quoting it as the hearer (the Boss).
do $$
declare
  c uuid := pg_temp.fresh('Op Banned Five');
  t uuid := tests.thread('Op ban ruling');
  p uuid := tests.post(c, t, 'A post that fills the bar.');
  ban uuid; ap uuid; closed jsonb; entry outcome_posts%rowtype; ruling outcome_posts%rowtype; posted acts%rowtype; bt uuid;
begin
  ban := (infract(c, 'severe', p, 'op-m1') ->> 'ban')::uuid;
  ap := pg_temp.appeal(c, ban);
  closed := close_appeal(ap, 'upheld', 'The ban stands.', null, null);
  perform pg_temp.expect((closed ->> 'closed')::boolean, 'the ban appeal did not close: ' || closed::text);
  select * into entry from outcome_posts where about_act = ban;
  perform pg_temp.expect(entry.kind = 'banned' and entry.source = 'stock' and entry.post_act is not null, 'the entry was not posted from stock first: ' || to_jsonb(entry)::text);
  select * into ruling from outcome_posts where about_act = (closed ->> 'ruling_act')::uuid;
  perform pg_temp.expect(ruling.kind = 'ban_ruling' and ruling.visit_act is null and ruling.source = 'model' and ruling.post_act is not null, 'the ban ruling row is wrong: ' || to_jsonb(ruling)::text);
  select * into posted from acts where id = ruling.post_act;
  bt := (select banlist_thread from seasons where ends_at is null);
  perform pg_temp.expect(posted.thread = bt and posted.target_act_id = entry.post_act and posted.character = pg_temp.modchar('op-boss') and posted.payload ->> 'body' = 'The ban stands.', 'the ban ruling post is wrong: ' || to_jsonb(posted)::text);
  perform pg_temp.expect((select a.created_at from acts a where a.id = entry.post_act) < posted.created_at, 'the entry is not before the ruling');
end $$;

-- (g) A ruling on a ban whose entry was refused quotes nothing; on a ban from before the migration, nothing is posted.
do $$
declare
  c uuid := pg_temp.fresh('Op Banned Six');
  c2 uuid := pg_temp.fresh('Op Banned Seven');
  t uuid := tests.thread('Op ban refused ruling');
  p uuid := tests.post(c, t, 'A post that fills the bar.');
  p2 uuid := tests.post(c2, t, 'A post that filled the bar before.');
  ban uuid; ban2 uuid; ap uuid; closed jsonb; ruling outcome_posts%rowtype; posted acts%rowtype; bt uuid; n_posts bigint; n_out bigint;
begin
  bt := (select banlist_thread from seasons where ends_at is null);
  perform pg_temp.expect(bt is not null, 'the world: no Banlist');
  ban := (infract(c, 'severe', p, 'op-m6') ->> 'ban')::uuid;
  perform pg_temp.expect((post_ban_entry(ban, null, 'stock') ->> 'posted')::boolean is false, 'a benched Mod''s stock entry posted');
  perform pg_temp.expect((select error from outcome_posts where about_act = ban) is not null, 'the refusal was not recorded');
  ap := pg_temp.appeal(c, ban);
  closed := close_appeal(ap, 'upheld', 'Upheld, entry or no entry.', null, null);
  select * into ruling from outcome_posts where about_act = (closed ->> 'ruling_act')::uuid;
  perform pg_temp.expect(ruling.kind = 'ban_ruling' and ruling.post_act is not null, 'the ruling was not posted: ' || to_jsonb(ruling)::text);
  select * into posted from acts where id = ruling.post_act;
  perform pg_temp.expect(posted.thread = bt and posted.target_act_id is null, 'the ruling on a refused entry quotes something: ' || to_jsonb(posted)::text);

  -- A ban from before the migration: no bans_owed row.
  ban2 := (infract(c2, 'severe', p2, 'op-m1') ->> 'ban')::uuid;
  alter table bans_owed disable trigger bans_owed_no_update;
  delete from bans_owed where ban_act = ban2;
  alter table bans_owed enable always trigger bans_owed_no_update;
  ap := pg_temp.appeal(c2, ban2);
  n_posts := (select count(*) from acts where kind = 'post');
  n_out := (select count(*) from outcome_posts);
  closed := close_appeal(ap, 'upheld', 'Nothing for an old ban.', null, null);
  perform pg_temp.expect((closed ->> 'closed')::boolean, 'the old ban appeal did not close');
  perform pg_temp.expect((select count(*) from acts where kind = 'post') = n_posts and (select count(*) from outcome_posts) = n_out, 'a ruling on a ban from before the migration posted');
end $$;

-- (h) A ban of the next season opens that season's Banlist.
do $$
declare
  c uuid := pg_temp.fresh('Op Banned Eight');
  t uuid := tests.thread('Op next season');
  p uuid := tests.post(c, t, 'A post that fills the bar.');
  ban uuid; r jsonb; first_bt uuid; bt uuid;
begin
  first_bt := (select banlist_thread from seasons where number = 1);
  update seasons set ends_at = now() where ends_at is null;
  insert into seasons (number, starts_at) values (2, now());
  ban := (infract(c, 'severe', p, 'op-m1') ->> 'ban')::uuid;
  perform pg_temp.expect((select season from bans_owed where ban_act = ban) = 2, 'the owed row names the wrong season');
  r := post_ban_entry(ban, 'A new season.', 'model');
  perform pg_temp.expect((r ->> 'posted')::boolean, 'the next season''s entry did not post: ' || r::text);
  bt := (select banlist_thread from seasons where number = 2);
  perform pg_temp.expect(bt is not null and bt <> first_bt and (select title from threads where id = bt) = 'Season 2: Banlist', 'the next season did not open its own Banlist');
  perform pg_temp.expect((select banlist_thread from seasons where number = 1) = first_bt, 'the first season''s Banlist moved');
end $$;

-- ---- 8. The tables are append-only, hold the one-post guard, and no client reads them ----
do $$
declare
  why text;
  o outcome_posts%rowtype;
begin
  select * into o from outcome_posts where post_act is not null limit 1;
  why := pg_temp.refusal(format('update outcome_posts set source = ''stock'' where about_act = %L', o.about_act));
  perform pg_temp.expect(why ~ '^P0001', 'an outcome post was edited: ' || coalesce(why, 'allowed'));
  why := pg_temp.refusal(format('delete from outcome_posts where about_act = %L', o.about_act));
  perform pg_temp.expect(why ~ '^P0001', 'an outcome post was deleted: ' || coalesce(why, 'allowed'));
  why := pg_temp.refusal('truncate outcome_posts');
  perform pg_temp.expect(why ~ '^P0001', 'outcome_posts was truncated: ' || coalesce(why, 'allowed'));
  why := pg_temp.refusal('update concessions_owed set how = ''paid''');
  perform pg_temp.expect(why ~ '^P0001', 'a concessions_owed row was edited: ' || coalesce(why, 'allowed'));
  why := pg_temp.refusal('delete from bans_owed');
  perform pg_temp.expect(why ~ '^P0001', 'a bans_owed row was deleted: ' || coalesce(why, 'allowed'));
  -- Posted or refused, never both and never neither; a second row for one outcome is refused.
  why := pg_temp.refusal(format('insert into outcome_posts (about_act, kind, source) values (%L, ''filed'', ''stock'')', gen_random_uuid()));
  perform pg_temp.expect(why ~ '^2[35]', 'an outcome with neither a post nor an error was accepted: ' || coalesce(why, 'allowed'));
  why := pg_temp.refusal(format('insert into outcome_posts (about_act, kind, source, error) values (%L, ''filed'', ''stock'', ''x'')', o.about_act));
  perform pg_temp.expect(why ~ '^2[35]', 'a second outcome for one Act was accepted: ' || coalesce(why, 'allowed'));
  why := pg_temp.refusal(format('insert into outcome_posts (about_act, kind, source, error) values (%L, ''confetti'', ''stock'', ''x'')', (select id from acts limit 1)));
  perform pg_temp.expect(why ~ '^23', 'an outcome of an unknown kind was accepted: ' || coalesce(why, 'allowed'));
  -- No client role reads them.
  perform tests.become((select id from auth.users limit 1));
  why := pg_temp.refusal('select count(*) from outcome_posts');
  perform pg_temp.expect(why ~ '^42501', 'a player read outcome_posts: ' || coalesce(why, 'allowed'));
  why := pg_temp.refusal('select count(*) from concessions_owed');
  perform pg_temp.expect(why ~ '^42501', 'a player read concessions_owed: ' || coalesce(why, 'allowed'));
  why := pg_temp.refusal('select count(*) from bans_owed');
  perform pg_temp.expect(why ~ '^42501', 'a player read bans_owed: ' || coalesce(why, 'allowed'));
  why := pg_temp.refusal('select pending_concessions(5)');
  perform pg_temp.expect(why ~ '^42501', 'a player called pending_concessions: ' || coalesce(why, 'allowed'));
  why := pg_temp.refusal('select pending_ban_entries(5)');
  perform pg_temp.expect(why ~ '^42501', 'a player called pending_ban_entries: ' || coalesce(why, 'allowed'));
  why := pg_temp.refusal('select post_ban_entry(gen_random_uuid(), null, ''stock'')');
  perform pg_temp.expect(why ~ '^42501', 'a player called post_ban_entry: ' || coalesce(why, 'allowed'));
  why := pg_temp.refusal('select post_visit_concession(gen_random_uuid(), ''x'')');
  perform pg_temp.expect(why ~ '^42501', 'a player called post_visit_concession: ' || coalesce(why, 'allowed'));
  why := pg_temp.refusal('select post_outcome(gen_random_uuid(), ''filed'', null, ''op-m1'', null, null, ''x'', ''stock'')');
  perform pg_temp.expect(why ~ '^42501', 'a player called post_outcome: ' || coalesce(why, 'allowed'));
  perform tests.unbecome();
  perform tests.become_service();
  why := pg_temp.refusal('select post_outcome(gen_random_uuid(), ''filed'', null, ''op-m1'', null, null, ''x'', ''stock'')');
  perform pg_temp.expect(why ~ '^42501', 'the service role called post_outcome: ' || coalesce(why, 'allowed'));
  perform tests.unbecome();
end $$;

-- ---- 9. The review's fixes ----
-- (a) No debt is too old to be paid: an owed concession and an owed ban entry dated eight days ago are posted by the tick from stock, and a paid one leaves the open set.
do $$
declare
  author uuid := pg_temp.chr('Op Bob A');
  ann uuid := pg_temp.chr('Op Ann A');
  t uuid := tests.thread('Op eight days');
  v uuid := pg_temp.visit(tests.post(author, t, 'A post talked down a long time ago.'), 'op-m1');
  c uuid := pg_temp.fresh('Op Banned Nine');
  pb uuid := tests.post(c, t, 'A post that filled the bar a long time ago.');
  e uuid; ban uuid; tick jsonb;
begin
  perform pg_temp.try(ann, v);
  e := (pg_temp.end_of(v)).id;
  ban := (infract(c, 'severe', pb, 'op-m3') ->> 'ban')::uuid;
  perform pg_temp.expect(exists (select 1 from concessions_owed_open where visit_act = v and end_act = e) and exists (select 1 from bans_owed_open where ban_act = ban), 'an owed row made no open row');
  perform pg_temp.age('concessions_owed', 'visit_act', v, 8 * 24 * 60);
  perform pg_temp.age('bans_owed', 'ban_act', ban, 8 * 24 * 60);
  tick := system_tick();
  perform pg_temp.expect((pg_temp.outcome(e)).post_act is not null and (pg_temp.outcome(e)).source = 'stock', 'a concession eight days owed was not posted by the tick: ' || tick::text);
  perform pg_temp.expect((pg_temp.outcome(ban)).post_act is not null and (pg_temp.outcome(ban)).source = 'stock', 'a ban entry eight days owed was not posted by the tick: ' || tick::text);
  perform pg_temp.expect(not exists (select 1 from concessions_owed_open where visit_act = v) and not exists (select 1 from bans_owed_open where ban_act = ban), 'a paid debt is still in the open set');
  perform pg_temp.expect(exists (select 1 from concessions_owed where visit_act = v) and exists (select 1 from bans_owed where ban_act = ban), 'a paid debt left its owed table');
  -- A debt settled by an outcome that was refused leaves the open set too.
  perform pg_temp.expect(not exists (select 1 from concessions_owed_open o join outcome_posts p on p.about_act = o.end_act) and not exists (select 1 from bans_owed_open o join outcome_posts p on p.about_act = o.ban_act), 'an open row has an outcome post');
  perform pg_temp.expect((select relrowsecurity from pg_class where relname = 'concessions_owed_open') and (select relrowsecurity from pg_class where relname = 'bans_owed_open'), 'an open table has no row level security');
  perform pg_temp.expect(not has_table_privilege('authenticated', 'concessions_owed_open', 'select') and not has_table_privilege('anon', 'bans_owed_open', 'select'), 'a client can read an open table');
end $$;

-- (b) The Banlist follows the system board's flag, as the Roster Report and the Staff Meetings thread do.
do $$
declare
  bt uuid := (select banlist_thread from seasons where number = 1);
  was_system uuid := system_board();
  other_board uuid;
begin
  perform pg_temp.expect(bt is not null and bt in (select instance_threads()), 'the world: the Banlist is not one of the instance''s own');
  insert into boards (slug, name) values ('op-other', 'Op Other');
  other_board := (select id from boards where slug = 'op-other');
  update boards set is_system = false where is_system;
  update boards set is_system = true where id = other_board;
  perform pg_temp.expect(thread_place(bt) = other_board, 'the Banlist did not follow the flag');
  perform pg_temp.expect((select c.place from thread_places_computed() c where c.thread = bt) = other_board, 'the computed place of the Banlist did not follow the flag');
  perform rebuild_thread_places((select array_agg(r.id) from system_thread_rows() r where r.board is distinct from other_board));
  perform pg_temp.expect((select board from threads where id = bt) = other_board and not exists (select 1 from thread_places_drift()), 'the Banlist is not stored on the flagged board after the rebuild');
  update boards set is_system = false where is_system;
  update boards set is_system = true where id = was_system;
  perform rebuild_thread_places((select array_agg(r.id) from system_thread_rows() r where r.board is distinct from was_system));
  perform pg_temp.expect(thread_place(bt) = was_system and (select board from threads where id = bt) = was_system and not exists (select 1 from thread_places_drift()), 'the Banlist did not follow the flag back');
end $$;

-- (c) A player's reply to an outcome post is found waiting for that Mod, with nothing changed in it, and the outcome post itself waits for no one.
do $$
declare
  poster uuid := pg_temp.chr('Op Bob A');
  ann uuid := pg_temp.chr('Op Ann A');
  t uuid := tests.thread('Op reply');
  p uuid := tests.post(poster, t, 'A post for a reply to the concession.');
  v uuid := pg_temp.visit(p, 'op-m1');
  conc uuid; reply uuid;
  since timestamptz := now() - interval '2 days';
  before_acts bigint;
  before_answered bigint := (select count(*) from pool_answered);
begin
  perform pg_temp.try(ann, v);
  perform post_visit_concession(v, 'Fine, {who}.');
  conc := (pg_temp.outcome((pg_temp.end_of(v)).id)).post_act;
  perform pg_temp.expect(conc is not null, 'no outcome post to reply to');
  perform pg_temp.expect(not exists (select 1 from pool_waiting_in_thread(t, array['op-m1'], since) w where w.act is not null), 'something waited before any reply');
  reply := tests.act(poster, 'post', t, jsonb_build_object('body', 'A reply to the concession.'), conc);
  before_acts := (select count(*) from acts);
  perform pg_temp.expect((select count(*) from pool_waiting_in_thread(t, array['op-m1'], since) w where w.act = reply and w.staff = 'op-m1' and w.author = poster) = 1,
    'a reply to the outcome post is not found waiting for its Mod: ' || coalesce((select jsonb_agg(to_jsonb(w))::text from pool_waiting_in_thread(t, array['op-m1'], since) w), 'nothing'));
  perform pg_temp.expect((select count(*) from acts) = before_acts and (select count(*) from pool_answered) = before_answered, 'finding the reply changed something');
  perform pg_temp.expect(not exists (select 1 from pool_waiting_in_thread(t, array['op-m1'], since) w where w.act = conc), 'the outcome post counted as waiting');
end $$;

-- (d) A ban that already has its entry, posted or refused, answers existing before the words are looked at, even where the copy has since lost them.
do $$
declare
  c uuid := pg_temp.fresh('Op Banned Ten');
  t uuid := tests.thread('Op ban existing');
  p uuid := tests.post(c, t, 'A post that fills the bar.');
  ban uuid; r jsonb;
begin
  ban := (infract(c, 'severe', p, 'op-m1') ->> 'ban')::uuid;
  perform pg_temp.expect((post_ban_entry(ban, 'Once.', 'model') ->> 'posted')::boolean, 'the entry did not post');
  update settings set value = value - 'banlistEntry' where key = 'copy';
  r := post_ban_entry(ban, 'Twice.', 'model');
  perform pg_temp.expect((r ->> 'existing')::boolean and not (r ->> 'posted')::boolean and r ->> 'post' is not null and r ->> 'error' is null, 'a posted ban answered something else with the words missing: ' || r::text);
  update settings set value = value || jsonb_build_object('banlistEntry', 'Banned: {character}, {days} days, {rule}. [url={post}]The post that did it.[/url]') where key = 'copy';
end $$;

-- (e) The page's reads answer nothing for a visit that is not a public visit Act, even with an outcome post recorded against it.
do $$
declare
  author uuid := pg_temp.chr('Op Bob A');
  ann uuid := pg_temp.chr('Op Ann A');
  t uuid := tests.thread('Op not public');
  p uuid := tests.post(author, t, 'A visited post.');
  v uuid := pg_temp.visit(p, 'op-m1');
  other uuid := tests.post(author, t, 'Not a visit.');
  made uuid;
begin
  perform pg_temp.try(ann, v);
  perform post_visit_concession(v, 'Fine, {who}.');
  made := (pg_temp.outcome((pg_temp.end_of(v)).id)).post_act;
  perform pg_temp.expect(jsonb_array_length(visit_outcome_posts(v)) = 1 and (select count(*) from outcome_page_rows(array[made])) = 1, 'the public visit answers nothing');
  insert into outcome_posts (about_act, kind, visit_act, source, post_act) values (other, 'intercepted', other, 'stock', made);
  perform pg_temp.expect(visit_outcome_posts(other) = '[]'::jsonb, 'an act that is not a visit answered posts: ' || visit_outcome_posts(other)::text);
  perform pg_temp.expect((select count(*) from outcome_page_rows(array[made])) = 1, 'the page read answered a row whose visit is not a visit Act');
end $$;
