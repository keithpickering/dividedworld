-- A Mod's outcome post quotes what it answers (supabase/migrations/0452_outcome_quotes.sql; docs/plans/2026-11-27-outcome-quotes-plan.md, Task 1; #1205).
--
-- 1. Every kind of outcome post (a filing, an infraction's ruling, a model and a stock concession, a ban's entry, a ban's ruling, a move's ruling) opens with a real `[quote=<target>]` of its target's opening words and a line break,
--    then the Mod's words; the post's target is that Act; and its payload is never `forged`.
-- 2. The words (they open at the target's own: a leading quote is skipped, and the (body, room) cases are one generated list, 0452-outcome-quotes-parity.sql, held by the TS mirror too): a short target whole, a long one cut at a word to at most 280 characters then `…`, markup and whitespace as a reader sees them, `[noparse]` around words that hold a `[`, a literal `[/noparse]` held, a target
--    with markup or nested quotes or an edit (the latest eligible version), none of it forged.
-- 3. A ban's entry quotes the post that tipped the bar (in another thread), and its target is that post; a ban's ruling quotes the entry; a move's ruling quotes the move's said line.
-- 4. The forged-quote check counts a move with a text body as a version of itself: a player's quote of it is real, a doctored one is forged; posts, spins and edits read as they did.
-- 5. A target under a live No quote: no quote, no target, the post lands. A quote trap springs once, on the Mod, and the post stands.
-- 6. The bound: the Mod's words are whole, the quote shrinks with `postMaxLength`, then goes with the target kept, and the body always fits.
-- 7. outcome_quote is internal: no role can call it.

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


-- ---- helpers of this file ----
create function pg_temp.forged(a uuid) returns boolean language sql as $$ select payload ? 'forged' from acts where id = a $$;
create function pg_temp.target(a uuid) returns uuid language sql as $$ select target_act_id from acts where id = a $$;

-- The words between a post's leading `[quote=<target>]` and its `[/quote]` + line break (null where the body does not open with a quote of the target).
create function pg_temp.said_quote(a uuid, target uuid) returns text language plpgsql as $$
declare b text := pg_temp.body(a); opener text := '[quote=' || target::text || ']'; at integer;
begin
  if left(b, length(opener)) <> opener then return null; end if;
  at := strpos(b, E'[/quote]\n');
  if at = 0 then return null; end if;
  return substr(b, length(opener) + 1, at - length(opener) - 1);
end $$;

-- What follows the quote: the Mod's own words.
create function pg_temp.after_quote(a uuid) returns text language sql as $$ select substr(pg_temp.body(a), strpos(pg_temp.body(a), E'[/quote]\n') + 9) $$;

-- A filing of a fresh post whose body is given: the outcome post's id.
create function pg_temp.filed(in_thread uuid, target_body text, line text default 'Filed.') returns uuid language plpgsql as $$
declare
  p uuid := tests.post(pg_temp.chr('Op Bob A'), in_thread, target_body);
  v uuid := pg_temp.visit(p, 'op-m1');
begin
  perform file_visit(v, line);
  return (select o.post_act from outcome_posts o where o.about_act = (pg_temp.end_of(v)).id);
end $$;

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

-- ---- 1. Every kind opens with a quote of its target ----
-- (a) A filing, a ruling, a model concession and a stock concession.
do $$
declare
  author uuid := tests.character(pg_temp.bob(), 'Op Bob Q');
  ann uuid := pg_temp.chr('Op Ann A');
  t uuid := tests.thread('Op quotes kinds');
  p uuid := tests.post(author, t, 'A post a Mod filed.');
  v uuid := pg_temp.visit(p, 'op-m1');
  p2 uuid := tests.post(author, t, 'A post that drew an infraction.');
  v2 uuid := pg_temp.visit(p2, 'op-m1');
  p3 uuid := tests.post(author, t, 'A visited post a bribe talked down.');
  v3 uuid := pg_temp.visit(p3, 'op-m1');
  p4 uuid := tests.post(author, t, 'A visited post the tick answers.');
  v4 uuid := pg_temp.visit(p4, 'op-m1');
  o outcome_posts%rowtype; inf uuid; ap uuid; closed jsonb; r jsonb; tick jsonb;
begin
  perform file_visit(v, 'Filed, and I mean it.');
  select * into o from outcome_posts where about_act = (pg_temp.end_of(v)).id;
  perform pg_temp.expect(pg_temp.body(o.post_act) = '[quote=' || p || E']A post a Mod filed.[/quote]\nFiled, and I mean it.', 'the filing body is wrong: ' || coalesce(pg_temp.body(o.post_act), 'no post'));
  perform pg_temp.expect(pg_temp.target(o.post_act) = p and not pg_temp.forged(o.post_act), 'the filing is forged or lost its target');

  perform file_visit(v2, 'Filed.');
  inf := (select i.id from acts i where i.kind = 'infraction' and i.payload ->> 'visit_act' = v2::text);
  ap := pg_temp.appeal(author, inf);
  closed := close_appeal(ap, 'upheld', 'No. The infraction stands.', null, null);
  select * into o from outcome_posts where about_act = (closed ->> 'ruling_act')::uuid;
  perform pg_temp.expect(pg_temp.body(o.post_act) = '[quote=' || p2 || E']A post that drew an infraction.[/quote]\nNo. The infraction stands.', 'the ruling body is wrong: ' || coalesce(pg_temp.body(o.post_act), 'no post'));
  perform pg_temp.expect(pg_temp.target(o.post_act) = p2 and not pg_temp.forged(o.post_act), 'the ruling is forged or lost its target');

  perform pg_temp.try(ann, v3);
  r := post_visit_concession(v3, 'Fine, {who}.');
  select * into o from outcome_posts where visit_act = v3 and kind = 'intercepted';
  perform pg_temp.expect(pg_temp.body(o.post_act) = '[quote=' || p3 || E']A visited post a bribe talked down.[/quote]\nFine, Op Ann A.', 'the concession body is wrong: ' || coalesce(pg_temp.body(o.post_act), 'no post'));
  perform pg_temp.expect(pg_temp.target(o.post_act) = p3 and not pg_temp.forged(o.post_act), 'the concession is forged or lost its target');

  perform pg_temp.try(ann, v4);
  perform pg_temp.age('concessions_owed', 'visit_act', v4, 16);
  tick := system_tick();
  select * into o from outcome_posts where visit_act = v4 and kind = 'intercepted';
  perform pg_temp.expect(o.source = 'stock' and o.post_act is not null, 'the tick posted no stock concession: ' || coalesce(to_jsonb(o)::text, 'no row'));
  perform pg_temp.expect(pg_temp.said_quote(o.post_act, p4) = 'A visited post the tick answers.' and not pg_temp.forged(o.post_act), 'the stock concession does not quote its post: ' || pg_temp.body(o.post_act));
end $$;

-- (b) A ban's entry quotes the post that tipped the bar, in another thread; the ruling on the ban quotes the entry.
do $$
declare
  c uuid := pg_temp.fresh('Op Banned Q');
  t uuid := tests.thread('Op quote ban');
  p uuid := tests.post(c, t, 'A post that fills the bar for a quote.');
  ban uuid; r jsonb; entry outcome_posts%rowtype; ruling outcome_posts%rowtype; bt uuid; ap uuid; closed jsonb; head text;
begin
  ban := (infract(c, 'severe', p, 'op-m1') ->> 'ban')::uuid;
  r := post_ban_entry(ban, 'Mind the rules.', 'model');
  perform pg_temp.expect((r ->> 'posted')::boolean, 'the entry did not post: ' || r::text);
  bt := (select banlist_thread from seasons where ends_at is null);
  select * into entry from outcome_posts where about_act = ban;
  head := (select (regexp_match(pg_temp.body(entry.post_act), E'\\[/quote\\]\n(.*)\n\nMind the rules\\.$', 'n'))[1]);
  perform pg_temp.expect(pg_temp.said_quote(entry.post_act, p) = 'A post that fills the bar for a quote.' and pg_temp.after_quote(entry.post_act) = head || E'\n\nMind the rules.'
    and head like 'Banned: Op Banned Q, 1 days, %[url=/t/' || t || '#post-' || (select a.seq from acts a where a.id = p) || ']The post that did it.[/url]', 'the entry body is wrong: ' || coalesce(pg_temp.body(entry.post_act), 'no post'));
  perform pg_temp.expect(pg_temp.target(entry.post_act) = p and (select thread from acts where id = entry.post_act) = bt and bt <> t, 'the entry does not target the post that tipped the bar from the Banlist');
  perform pg_temp.expect(not pg_temp.forged(entry.post_act), 'the entry is forged');
  ap := pg_temp.appeal(c, ban);
  closed := close_appeal(ap, 'upheld', 'The ban stands.', null, null);
  select * into ruling from outcome_posts where about_act = (closed ->> 'ruling_act')::uuid;
  perform pg_temp.expect(ruling.post_act is not null and pg_temp.target(ruling.post_act) = entry.post_act, 'the ban ruling does not target the entry: ' || to_jsonb(ruling)::text);
  perform pg_temp.expect(pg_temp.said_quote(ruling.post_act, entry.post_act) like 'Banned: Op Banned Q, 1 days%' and pg_temp.said_quote(ruling.post_act, entry.post_act) not like 'A post that fills%', 'the ban ruling does not quote the entry''s own opening words (not the quote it opens with): ' || pg_temp.body(ruling.post_act));
  perform pg_temp.expect(pg_temp.after_quote(ruling.post_act) = 'The ban stands.' and not pg_temp.forged(ruling.post_act), 'the ban ruling is forged or its words changed');
end $$;

-- (c) A move's ruling quotes the move's said line, and the check counts the move: a player's quote of it is real, a doctored one forged.
do $$
declare
  c uuid := pg_temp.fresh('Op Eve Quoted');
  mt uuid := open_staff_thread('op-m1', 'A quoted move');
  m uuid := pg_temp.landed('op-m1', c, mt);
  ap uuid := pg_temp.appeal(c, m);
  closed jsonb; o outcome_posts%rowtype; real_q uuid; doctored uuid;
begin
  perform pg_temp.expect(exists (select 1 from quote_sources s where s.act = m), 'a move has no quote source');
  closed := close_appeal(ap, 'overturned', 'Overturned. Sorry about that.', null, null);
  select * into o from outcome_posts where about_act = (closed ->> 'ruling_act')::uuid;
  perform pg_temp.expect(pg_temp.body(o.post_act) = '[quote=' || m || E']Moved.[/quote]\nOverturned. Sorry about that.', 'the move ruling body is wrong: ' || coalesce(pg_temp.body(o.post_act), 'no post: ' || coalesce(o.error, '')));
  perform pg_temp.expect(pg_temp.target(o.post_act) = m and not pg_temp.forged(o.post_act), 'the move ruling is forged or lost its target');
  real_q := tests.act(c, 'post', mt, jsonb_build_object('body', '[quote=' || m || ']Moved.[/quote] Hm.'), m);
  perform pg_temp.expect(not pg_temp.forged(real_q) and pg_temp.target(real_q) = m, 'a player''s quote of a move is a counterfeit: ' || (select payload::text from acts where id = real_q));
  doctored := tests.act(c, 'post', mt, jsonb_build_object('body', '[quote=' || m || ']Moved to a better place.[/quote] Hm.'), m);
  perform pg_temp.expect(pg_temp.forged(doctored) and pg_temp.target(doctored) is null, 'a doctored quote of a move is not forged: ' || (select payload::text from acts where id = doctored));
end $$;

-- ---- 2. The words ----
do $$
declare
  t uuid := tests.thread('Op quote words');
  long text := (select string_agg('word' || i, ' ') from generate_series(1, 100) i);
  whole uuid; cut uuid; br uuid; closer uuid; marked uuid; nested uuid; other uuid; spaced uuid; edited uuid; ed uuid; p uuid; hid uuid;
  w text; src text;
begin
  -- A short target is quoted whole; whitespace is collapsed to single spaces.
  spaced := pg_temp.filed(t, E'  Spread \n\n  out   words  ');
  perform pg_temp.expect(pg_temp.said_quote(spaced, pg_temp.target(spaced)) = 'Spread out words' and not pg_temp.forged(spaced), 'whitespace is not collapsed: ' || pg_temp.body(spaced));

  -- A long target is cut at a word to at most 280 characters, then `…`; the cut stands in the target.
  cut := pg_temp.filed(t, long);
  w := pg_temp.said_quote(cut, pg_temp.target(cut));
  perform pg_temp.expect(w like '%…' and length(w) <= 281 and length(w) > 250, 'the long quote is not cut to 280: ' || length(w) || ' ' || w);
  perform pg_temp.expect(left(long, length(w) - 1) = left(w, length(w) - 1) and substr(long, length(w), 1) = ' ' and w ~ 'word[0-9]+…$', 'the long quote is not cut at a word: ' || w);
  perform pg_temp.expect(not pg_temp.forged(cut), 'the cut quote is forged');
  -- One word longer than the cut has no space to cut at: it is cut hard, and still not forged.
  hid := pg_temp.filed(t, repeat('abcdefgh', 60));
  w := pg_temp.said_quote(hid, pg_temp.target(hid));
  perform pg_temp.expect(w like '%…' and length(w) = 281 and not pg_temp.forged(hid), 'the one long word is not cut hard: ' || length(w));

  -- Markup is not quoted: the words a reader sees.
  marked := pg_temp.filed(t, E'[b]Bold[/b] and [i]italic[/i] [url=https://x.test/a]a link[/url]\n[list][*]one[*]two[/list] [spoiler]hid[/spoiler] [color=red]red[/color] http://x.test/b');
  perform pg_temp.expect(pg_temp.said_quote(marked, pg_temp.target(marked)) like 'Bold and italic a link%' and not pg_temp.forged(marked), 'a post with markup is wrong or forged: ' || pg_temp.body(marked));

  -- Words that hold a `[` are wrapped in noparse, and a literal closer inside them is held; neither is forged.
  br := pg_temp.filed(t, '[noparse][b]hi[/b] and [i][/noparse] there');
  perform pg_temp.expect(pg_temp.said_quote(br, pg_temp.target(br)) = '[noparse][b]hi[/b] and [i] there[/noparse]' and not pg_temp.forged(br), 'a bracket is not wrapped or is forged: ' || pg_temp.body(br));
  -- A bracket that reads as no tag is left bare.
  br := pg_temp.filed(t, 'item [1] done');
  perform pg_temp.expect(pg_temp.said_quote(br, pg_temp.target(br)) = 'item [1] done' and not pg_temp.forged(br), 'a bracket that is no tag was wrapped or is forged: ' || pg_temp.body(br));
  closer := pg_temp.filed(t, 'closing [/noparse] and [/NoParse] words [/quote] too');
  perform pg_temp.expect(pg_temp.said_quote(closer, pg_temp.target(closer)) like '[noparse]closing [/noparse%' and not pg_temp.forged(closer), 'a literal closer ends the cover or is forged: ' || pg_temp.body(closer));
  perform pg_temp.expect(strpos(pg_temp.body(closer), '[/quote] too') > 0, 'the closer test lost its words: ' || pg_temp.body(closer));

  -- The words are the forged-quote check's own source: a link's, a code block's, a spoiler's and its title, and a real quote's words are all in it.
  other := tests.post(pg_temp.chr('Op Ann A'), t, 'inner');
  for src in select unnest(array['see [url=https://x.test/a]this link[/url] now', 'a [code]x=1[/code] b', 'a [spoiler=Title]hidden[/spoiler] b', 'a [quote=' || other || ']inner[/quote] b']) loop
    marked := pg_temp.filed(t, src);
    perform pg_temp.expect(pg_temp.said_quote(marked, pg_temp.target(marked)) is not null and not pg_temp.forged(marked) and pg_temp.target(marked) is not null, 'a quote of ' || src || ' is forged or lost: ' || pg_temp.body(marked));
    perform pg_temp.expect(strpos(pg_temp.body(marked), E'\ufdd0') = 0, 'a cut mark reached a post: ' || src);
  end loop;

  -- A quote the target opens with is not its own words: the quote is of what follows it.
  other := tests.post(pg_temp.chr('Op Ann A'), t, 'Their words here');
  nested := pg_temp.filed(t, '[quote=' || other || E']Their words here[/quote]\nMy reply words');
  perform pg_temp.expect(pg_temp.said_quote(nested, pg_temp.target(nested)) = 'My reply words' and not pg_temp.forged(nested), 'a leading quote is not skipped or is forged: ' || pg_temp.body(nested));

end $$;

-- The words open at the target's own: a leading quote is skipped (a player's reply, a ban entry), a post that is only a quote quotes its words, and the (body, room) cases of the rule are one list with the TS mirror's (engine/bbcode/outcome-quote.fixtures.ts, held in 0452-outcome-quotes-parity.sql).
do $$
declare
  t uuid := tests.thread('Op quote leading');
  other uuid := tests.post(pg_temp.chr('Op Ann A'), t, 'x');
  reply uuid; only_q uuid; nested uuid;
begin
  reply := pg_temp.filed(t, '[quote=' || other || ']x[/quote] my reply');
  perform pg_temp.expect(pg_temp.said_quote(reply, pg_temp.target(reply)) = 'my reply' and not pg_temp.forged(reply), 'a leading quote is not skipped: ' || pg_temp.body(reply));
  only_q := pg_temp.filed(t, '[quote=' || other || ']x[/quote]');
  perform pg_temp.expect(pg_temp.said_quote(only_q, pg_temp.target(only_q)) = 'x' and not pg_temp.forged(only_q), 'a post that is only a quote does not quote its words: ' || pg_temp.body(only_q));
  nested := pg_temp.filed(t, '[quote=' || other || ']a [quote=' || other || ']x[/quote] b[/quote] after both');
  perform pg_temp.expect(pg_temp.said_quote(nested, pg_temp.target(nested)) = 'after both' and not pg_temp.forged(nested), 'a nested leading quote is not skipped whole: ' || pg_temp.body(nested));
end $$;

-- An edited target quotes its latest version; a later edit is the latest; an edit an admin hid is skipped for the one before it.
do $$
declare
  t uuid := tests.thread('Op quote edits');
  bob uuid := pg_temp.chr('Op Bob A');
  p uuid := tests.post(bob, t, 'The words before the edit.', now() - interval '3 hours');
  e1 uuid; e2 uuid; v uuid; v2 uuid; v3 uuid; o uuid;
begin
  e1 := tests.act(bob, 'edit', t, '{"body": "The words after the first edit."}', p, now() - interval '2 hours');
  v := pg_temp.visit(p, 'op-m1');
  perform file_visit(v, 'Filed.');
  o := (select x.post_act from outcome_posts x where x.about_act = (pg_temp.end_of(v)).id);
  perform pg_temp.expect(pg_temp.said_quote(o, p) = 'The words after the first edit.' and not pg_temp.forged(o), 'an edited target is not quoted at its latest version: ' || pg_temp.body(o));
  -- A twice-edited post's concession: the later edit is the latest.
  p := tests.post(bob, t, 'Other words before the edit.', now() - interval '3 hours');
  e1 := tests.act(bob, 'edit', t, '{"body": "Other words after the first edit."}', p, now() - interval '2 hours');
  e2 := tests.act(bob, 'edit', t, '{"body": "Second edit [b]with a tag[/b] in it."}', p, now() - interval '1 hour');
  v2 := pg_temp.visit(p, 'op-m1');
  perform pg_temp.try(pg_temp.chr('Op Ann A'), v2);
  perform post_visit_concession(v2, 'Fine.');
  o := (select x.post_act from outcome_posts x where x.visit_act = v2 and x.kind = 'intercepted');
  perform pg_temp.expect(pg_temp.said_quote(o, p) = 'Second edit with a tag in it.' and not pg_temp.forged(o), 'a twice-edited target is not quoted at its latest version: ' || pg_temp.body(o));
  -- The latest edit an admin hid: the quote falls back to the earlier visible version (an edit is hidden by a decision of its own, as 0393's tests write one).
  p := tests.post(bob, t, 'Hidden-case words before the edits.', now() - interval '3 hours');
  e1 := tests.act(bob, 'edit', t, '{"body": "Hidden-case words after the first edit."}', p, now() - interval '2 hours');
  e2 := tests.act(bob, 'edit', t, '{"body": "Hidden-case latest edit an admin hides."}', p, now() - interval '1 hour');
  insert into admins (account) values (pg_temp.eve()) on conflict do nothing;
  perform tests.become(pg_temp.eve());
  perform decide(null, e2, 'hide', null, 'op hidden latest edit');
  perform tests.unbecome();
  perform pg_temp.expect(version_hidden(e2, p) and not version_hidden(e1, p), 'the test did not hide the latest edit alone');
  v3 := pg_temp.visit(p, 'op-m1');
  perform file_visit(v3, 'Filed.');
  o := (select x.post_act from outcome_posts x where x.about_act = (pg_temp.end_of(v3)).id);
  perform pg_temp.expect(pg_temp.said_quote(o, p) = 'Hidden-case words after the first edit.' and not pg_temp.forged(o), 'a hidden latest edit is quoted, or the earlier visible version is not: ' || pg_temp.body(o));
end $$;

-- ---- 3. No quote and a quote trap ----
do $$
declare
  setacc uuid := tests.account('op-q-nq');
  setter uuid := tests.character(setacc, 'Op Q Setter');
  t uuid := tests.thread('Op quote no quote');
  p uuid := tests.post(setter, t, 'A post that cannot be quoted.');
  v uuid; got jsonb; o outcome_posts%rowtype; n_spring bigint;
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts, gimmick) values
    ('op-nq', 'Op Last Word', 'salty', 'uncommon', 'use', null, '{post}', interval '7 days', '{"kind": "noQuote"}') on conflict (key) do nothing;
  perform tests.act(setter, 'card', t, jsonb_build_object('card', 'op-nq', 'message', '', 'config', '{}'::jsonb, 'layer', 1, 'ends', now() + interval '2 days'), p);
  v := pg_temp.visit(p, 'op-m1');
  n_spring := (select count(*) from acts where kind = 'spring');
  got := file_visit(v, 'Filed, quoting nothing.');
  select * into o from outcome_posts where about_act = (pg_temp.end_of(v)).id;
  perform pg_temp.expect(o.post_act is not null and o.error is null, 'a No quote refused the outcome post: ' || to_jsonb(o)::text);
  perform pg_temp.expect(pg_temp.body(o.post_act) = 'Filed, quoting nothing.' and pg_temp.target(o.post_act) is null and not pg_temp.forged(o.post_act), 'the post under No quote is not a plain reply: ' || pg_temp.body(o.post_act));
  perform pg_temp.expect((select count(*) from acts where kind = 'spring') = n_spring, 'a post under No quote sprang something');
end $$;

do $$
declare
  setacc uuid := tests.account('op-q-trap');
  setter uuid := tests.character(setacc, 'Op Q Trapper');
  t uuid := tests.thread('Op quote trap');
  p uuid := tests.post(setter, t, 'A trapped post to quote.');
  v uuid; o outcome_posts%rowtype;
begin
  insert into card_kinds (key, name, alignment, rarity, play, trap, reaches, lasts) values ('op-move', 'Op Move', 'salty', 'common', 'cast', null, '{post}', null) on conflict (key) do nothing;
  insert into card_ledger (account, card, kind, price) select setacc, 'op-move', 'bought', 0 from generate_series(1, 14);
  perform set_card(setacc, 'op-move', setter, p, '{}', 0, null);
  v := pg_temp.visit(p, 'op-m1');
  perform file_visit(v, 'Filed into a trap.');
  select * into o from outcome_posts where about_act = (pg_temp.end_of(v)).id;
  perform pg_temp.expect(o.post_act is not null and o.error is null, 'the trap refused the outcome post: ' || to_jsonb(o)::text);
  perform pg_temp.expect(pg_temp.said_quote(o.post_act, p) = 'A trapped post to quote.' and pg_temp.target(o.post_act) = p and not pg_temp.forged(o.post_act), 'the trapped post is not quoted: ' || pg_temp.body(o.post_act));
  perform pg_temp.expect((select count(*) from acts a where a.kind = 'spring' and a.thread = t and a.payload ->> 'set' is not null and a.target_act_id = p) = 1, 'the trap did not spring once');
end $$;

-- ---- 4. The bound: the Mod's words are whole; the quote shrinks, then goes; the body fits ----
do $$
declare
  t uuid := tests.thread('Op quote room');
  bob uuid := pg_temp.chr('Op Bob A');
  body_text text := 'Kept whole.';
  p uuid; v uuid; o uuid; w text; cap integer; used integer := 53;
begin
  -- Room for twelve characters of words: the quote shrinks to what fits and the Mod's words are whole.
  cap := length(body_text) + used + 12;
  insert into settings (key, value) values ('postMaxLength', to_jsonb(cap)) on conflict (key) do update set value = excluded.value;
  p := tests.post(bob, t, 'A target that is rather longer than twelve characters.');
  v := pg_temp.visit(p, 'op-m1');
  perform file_visit(v, body_text);
  o := (select x.post_act from outcome_posts x where x.about_act = (pg_temp.end_of(v)).id);
  w := pg_temp.said_quote(o, p);
  perform pg_temp.expect(w is not null and w like '%…' and length(w) <= 12 and pg_temp.after_quote(o) = body_text and length(pg_temp.body(o)) <= cap and not pg_temp.forged(o), 'the quote did not shrink to the room: ' || coalesce(pg_temp.body(o), 'no post') || ' / ' || cap);
  -- Room for nothing: the quote is left out, the target is kept, the words are whole.
  cap := length(body_text) + used;
  update settings set value = to_jsonb(cap) where key = 'postMaxLength';
  p := tests.post(bob, t, 'Another target with words.');
  v := pg_temp.visit(p, 'op-m1');
  perform file_visit(v, body_text);
  o := (select x.post_act from outcome_posts x where x.about_act = (pg_temp.end_of(v)).id);
  perform pg_temp.expect(pg_temp.body(o) = body_text and pg_temp.target(o) = p and not pg_temp.forged(o), 'with no room the post is not the Mod''s words alone with the target kept: ' || coalesce(pg_temp.body(o), 'no post'));
  -- Bracket words need their cover: the quote still fits.
  cap := length(body_text) + used + 40;
  update settings set value = to_jsonb(cap) where key = 'postMaxLength';
  p := tests.post(bob, t, '[noparse][b]bold[/b] words that go on and on and on and on[/noparse]');
  v := pg_temp.visit(p, 'op-m1');
  perform file_visit(v, body_text);
  o := (select x.post_act from outcome_posts x where x.about_act = (pg_temp.end_of(v)).id);
  perform pg_temp.expect(length(pg_temp.body(o)) <= cap and pg_temp.after_quote(o) = body_text and not pg_temp.forged(o) and pg_temp.body(o) like '%[noparse]%', 'a wrapped quote overran the room or is forged: ' || coalesce(pg_temp.body(o), 'no post') || ' / ' || cap);
  delete from settings where key = 'postMaxLength';
end $$;

-- ---- 5. outcome_quote is internal ----
do $$
begin
  perform pg_temp.expect(not has_function_privilege('anon', 'outcome_quote(uuid, integer)', 'execute')
    and not has_function_privilege('authenticated', 'outcome_quote(uuid, integer)', 'execute')
    and not has_function_privilege('service_role', 'outcome_quote(uuid, integer)', 'execute'), 'a role can call outcome_quote');
  perform pg_temp.expect((select p.prosecdef and p.proconfig::text like '%pg_temp%' from pg_proc p where p.oid = 'outcome_quote(uuid, integer)'::regprocedure), 'outcome_quote is not a security definer that pins its search_path');
end $$;
