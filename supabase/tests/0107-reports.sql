-- Reports (supabase/migrations/0105_reports.sql; the Mod Bots design, section 7 and "What could slip a mask"; its plan, Task 8).
--
-- 1. open_report: a player's door. It spends reportPrice (wallet_events kind 'report') and writes a public `report` Act naming the reporter, with the reason, on the post, taking
--    no seq. It answers with what the judgment needs (the beat Mod, the board, the reporter's public name) and no account.
-- 2. It refuses, writing and spending nothing: a character the caller does not play (the same words as one that does not exist), a banned character, a blank or over-long reason,
--    a post by The System, no such post, a short wallet. It refuses past reportsPerDay for THAT character only (the player's other masks report on), a refunded report not counted.
-- 3. The daily judgment budget (judgmentsPerDay, one instance-wide count of the ledger) is checked before anything is paid, and refuses in the same words whoever asks.
-- 4. A report across one's own masks is allowed, and answers as any other.
-- 5. close_report writes the verdict by the Mod on the board's beat, once: twice closes once. A visit verdict starts a visit with cause 'report'; a charge naming no rule in force
--    on the board becomes the board's premise at the minor band; a rule's charge takes the rule's band; a house rule is told apart from a board's rule of the same number.
-- 6. A dismissed report spends its Aura and the Mod's line is public (the stock line where none is given). A backfire visits the reporter's latest post (cause 'backfire',
--    minor); a reporter with no post gets no visit, and the verdict still lands.
-- 7. refund_report refunds once (twice refunds once), writes no Act, frees the quota, refuses a report that has a verdict; a refunded report cannot be closed; a free report is
--    refunded all the same. refund_stale_reports refunds a report whose judgment never came, and no other. Two sessions refunding at once refund once.
-- 8. The doors: close_report, refund_report and the budget are the service's, open_report the player's, and a client cannot write a report or a verdict.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

create function pg_temp.announcements() returns uuid language sql as $$
  select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements'
$$;

create function pg_temp.rule(on_board uuid, predicate text, param jsonb default null, band text default 'minor') returns uuid language plpgsql as $$
declare written uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  written := tests.act((select id from characters where staff = 'rp-boss'), 'move', pg_temp.announcements(),
    jsonb_build_object('kind', 'setRule', 'body', 'A rule.',
      'params', jsonb_build_object('board', on_board, 'predicate', predicate, 'param', param, 'band', band)),
    null, clock_timestamp());
  perform set_config('kayfabb.staff_writer', '', true);
  return written;
end $$;

-- A player says something through the real post(), as the account that owns the character.
create function pg_temp.say(by_character uuid, in_thread uuid, body text) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become((select owner from characters where id = by_character));
  made := post(in_thread, by_character, body);
  perform tests.unbecome();
  return (made ->> 'id')::uuid;
end $$;

-- A report, made through the real open_report as the account that owns the character.
create function pg_temp.report(through uuid, post uuid, reason text default 'This one breaks the spirit of the board.') returns jsonb language plpgsql as $$
declare made jsonb;
begin
  perform tests.become((select owner from characters where id = through));
  made := open_report(through, post, reason);
  perform tests.unbecome();
  return made;
end $$;

create function pg_temp.ann() returns uuid language sql as $$ select id from auth.users where email = 'rp-ann@test.invalid' $$;
create function pg_temp.bob() returns uuid language sql as $$ select id from auth.users where email = 'rp-bob@test.invalid' $$;
create function pg_temp.eve() returns uuid language sql as $$ select id from auth.users where email = 'rp-eve@test.invalid' $$;
create function pg_temp.wallet(a uuid) returns integer language sql as $$ select coalesce((select balance from wallets where account = a), 0) $$;
create function pg_temp.reports_n(c uuid) returns bigint language sql as $$ select count(*) from acts where kind = 'report' and character = c $$;
create function pg_temp.events_n(a uuid, k text) returns bigint language sql as $$ select count(*) from wallet_events where account = a and kind = k $$;
-- One of Bob's posts to be the target (a quiet one: it breaks no rule).
create function pg_temp.victim(t uuid) returns uuid language sql as $$
  select pg_temp.say((select id from characters where name = 'Rp Bob A'), t, 'A quiet post ' || gen_random_uuid())
$$;

-- ---- 0a. Two sessions refunding one report refund it once (first: the committed rows must not meet this file's own locks) ----
do $$
declare
  u uuid := gen_random_uuid(); c uuid := gen_random_uuid(); t uuid := gen_random_uuid(); p uuid := gen_random_uuid(); r uuid := gen_random_uuid(); op uuid := gen_random_uuid();
  said text[];
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'rp-race@test.invalid');
    insert into accounts (id) values (%1$L);
    insert into wallets (account, balance) values (%1$L, 100);
    insert into characters (id, owner, name, created_at, debuted_at) values (%2$L, %1$L, 'Rp Racer', now(), now());
    insert into class_history (character, class_key, started_at) values (%2$L, 'alpha', now());
    insert into characters (id, owner, name, created_at, debuted_at) values (%6$L, %1$L, 'Rp Racer Target', now(), now());
    insert into class_history (character, class_key, started_at) values (%6$L, 'alpha', now());
    insert into threads (id, board, title) select %3$L, b.id, 'Rp race' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload) values (%4$L, %6$L, 'post', %3$L, '{"body": "A racing post."}');
    set kayfabb.report_writer = 'on';
    insert into acts (id, character, kind, thread, target_act_id, payload) values (%5$L, %2$L, 'report', %3$L, %4$L, '{"reason": "race"}');
    reset kayfabb.report_writer;
    update wallets set balance = 75 where account = %1$L;
    insert into wallet_events (account, kind, change, balance_after, ref) values (%1$L, 'report', -25, 75, %5$L);
  $sql$, u, c, t, p, r, op));
  said := tests.race_service(format('select refund_report(%L)', r), format('select refund_report(%L)', r));
  if said[1] is not null or said[2] is not null then raise exception 'a racing refund failed: %', said; end if;
  if (select balance from wallets where account = u) is distinct from 100 then raise exception 'two sessions refunded a report into %', (select balance from wallets where account = u); end if;
  if (select count(*) from wallet_events where kind = 'refund' and ref = r) is distinct from 1::bigint or (select count(*) from report_refunds where report_act = r) is distinct from 1::bigint then raise exception 'two sessions refunded a report twice'; end if;
end $$;

-- ---- 0. The world: a Boss, two Mods on staff, three players, the settings, a rule on General and a house rule ----
do $$
declare
  seed jsonb;
  general uuid := (select id from boards where slug = 'general');
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'ruleSet', jsonb_build_array('On {board}: {rule}.'),
        'visitArrived', jsonb_build_array('{mod} is looking at this post under {rule}.'),
        'visitFiled', jsonb_build_array('{mod} filed this post under {rule}.'),
        'reportDismissed', jsonb_build_array('{mod} dismisses {reporter} with a sigh.'),
        'reportBackfired', jsonb_build_array('{mod} has words for {reporter}.')),
      'systemMoveWords', jsonb_build_object('setRule', 'a rule')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'rp-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'rp-boss', 'name', 'Report Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'rp-m1', 'name', 'Report Mod One', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50)),
        jsonb_build_object('key', 'rp-m2', 'name', 'Report Mod Two', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50))),
      'firstStaff', jsonb_build_array('rp-m1', 'rp-m2'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(
        jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'),
        jsonb_build_object('key', 'bannedWord', 'param', 'word', 'least', 1, 'most', 40, 'plain', 'the word "{param}" is banned'))));
  perform seed_instance(seed);
  -- Rule 1 on General (minor) and House Rule 1 (moderate): the same number on different footings.
  perform pg_temp.rule(general, 'noAllCaps', null, 'minor');
  perform pg_temp.rule(null, 'bannedWord', '"zzzz"'::jsonb, 'moderate');
  perform tests.account('rp-ann');
  perform tests.account('rp-bob');
  perform tests.account('rp-eve');
  insert into wallets (account, balance) values (pg_temp.ann(), 500), (pg_temp.bob(), 500), (pg_temp.eve(), 0);
  perform tests.character(pg_temp.bob(), 'Rp Bob A');
  perform tests.character(pg_temp.ann(), 'Rp Ann A');
  perform tests.character(pg_temp.ann(), 'Rp Ann B');
  perform tests.character(pg_temp.eve(), 'Rp Eve A');
  if beat_of(general) is distinct from 'rp-m1' then raise exception 'the world: the beat Mod of General is %', beat_of(general); end if;
end $$;

-- ---- 1. open_report pays, writes a public report naming its reporter, and answers with what the judgment needs ----
do $$
declare
  ann_a uuid := (select id from characters where name = 'Rp Ann A');
  t uuid := tests.thread('Reports one');
  p uuid := pg_temp.say((select id from characters where name = 'Rp Bob A'), t, 'A quiet post to report.');
  before_w integer := pg_temp.wallet(pg_temp.ann());
  got jsonb;
  r acts%rowtype;
  ev wallet_events%rowtype;
begin
  got := pg_temp.report(ann_a, p, '  It reads like bait.  ');
  select * into r from acts where id = (got ->> 'report')::uuid;
  if r.kind is distinct from 'report' or r.character is distinct from ann_a or r.target_act_id is distinct from p or r.thread is distinct from t then raise exception 'the report Act is wrong: %', to_jsonb(r); end if;
  if r.seq is not null then raise exception 'a report took a seq: %', r.seq; end if;
  if r.payload is distinct from '{"reason": "It reads like bait."}'::jsonb then raise exception 'the reason is not kept trimmed: %', r.payload; end if;
  if pg_temp.wallet(pg_temp.ann()) is distinct from before_w - 25 then raise exception 'the price was not spent: % -> %', before_w, pg_temp.wallet(pg_temp.ann()); end if;
  select * into ev from wallet_events where kind = 'report' and ref = r.id;
  if ev.change is distinct from -25 or ev.account is distinct from pg_temp.ann() then raise exception 'the wallet event is wrong: %', to_jsonb(ev); end if;
  if got ->> 'staff' is distinct from 'rp-m1' or got #>> '{reporter,name}' is distinct from 'Rp Ann A' or got #>> '{board,id}' is distinct from (select id::text from boards where slug = 'general')
     or got ->> 'reason' is distinct from 'It reads like bait.' or (got ->> 'price')::integer <> 25 then raise exception 'the answer is wrong: %', got;
  end if;
  -- Masks: the answer and the Act carry no account.
  if got::text ~* (pg_temp.ann()::text || '|' || pg_temp.bob()::text) or to_jsonb(r)::text ~* (pg_temp.ann()::text || '|' || pg_temp.bob()::text) then raise exception 'a report names an account'; end if;
  -- The reporter's name is on the public view of the Act.
  if not exists (select 1 from acts_public a where a.id = r.id and a.character = ann_a) then raise exception 'the report is not a public Act of its reporter'; end if;
  -- It is not a page's business: the thread's next seq did not move.
  if (select next_seq from threads where id = t) is distinct from 2 then raise exception 'a report moved the thread''s seq: %', (select next_seq from threads where id = t); end if;
end $$;

-- ---- 2. Refusals write and spend nothing; the quota is the character's own ----
do $$
declare
  annu uuid := pg_temp.ann();
  bobu uuid := pg_temp.bob();
  eveu uuid := pg_temp.eve();
  ann_a uuid := (select id from characters where name = 'Rp Ann A');
  ann_b uuid := (select id from characters where name = 'Rp Ann B');
  bob_a uuid := (select id from characters where name = 'Rp Bob A');
  eve_a uuid := (select id from characters where name = 'Rp Eve A');
  t uuid := tests.thread('Reports two');
  p uuid := pg_temp.say(bob_a, t, 'A quiet post.');
  staff_post uuid;
  a0 integer := pg_temp.wallet(pg_temp.ann());
  n0 bigint := (select count(*) from acts where kind = 'report');
  e0 bigint := (select count(*) from wallet_events where kind = 'report');
  said text;
  other text;
  r1 jsonb; r2 jsonb;
begin
  -- No session at all.
  perform tests.become_anon();
  said := pg_temp.refusal(format('select open_report(%L, %L, %L)', ann_a, p, 'Why.'));
  perform tests.unbecome();
  if said is null then raise exception 'an anonymous visitor reported'; end if;
  -- A character the caller does not play: the same words as one that does not exist.
  perform tests.become(bobu);
  said := pg_temp.refusal(format('select open_report(%L, %L, %L)', ann_a, p, 'Why.'));
  other := pg_temp.refusal(format('select open_report(%L, %L, %L)', gen_random_uuid(), p, 'Why.'));
  perform tests.unbecome();
  if said is null or said is distinct from other then raise exception 'acting through another''s character: % / %', said, other; end if;
  perform tests.become(annu);
  -- A blank reason and an over-long one.
  if pg_temp.refusal(format('select open_report(%L, %L, %L)', ann_a, p, E'  \n\t ')) is null then raise exception 'a blank reason was taken'; end if;
  if pg_temp.refusal(format('select open_report(%L, %L, %L)', ann_a, p, U&'\200B\3000')) is null then raise exception 'an invisible reason was taken'; end if;
  if pg_temp.refusal(format('select open_report(%L, %L, %L)', ann_a, p, repeat('x', 281))) is null then raise exception 'a 281-character reason was taken'; end if;
  if pg_temp.refusal(format('select open_report(%L, %L, %L)', ann_a, gen_random_uuid(), 'Why.')) is null then raise exception 'a report of no post was taken'; end if;
  -- A post by The System is not reported.
  perform tests.unbecome();
  staff_post := (write_staff_act('rp-m1', 'post', t, null, jsonb_build_object('body', 'The Mod speaks.')) ->> 'id')::uuid;
  perform tests.become(annu);
  if pg_temp.refusal(format('select open_report(%L, %L, %L)', ann_a, staff_post, 'Why.')) is null then raise exception 'a post by the Mod was reported'; end if;
  perform tests.unbecome();
  if (select count(*) from acts where kind = 'report') is distinct from n0 or pg_temp.wallet(pg_temp.ann()) is distinct from a0 then raise exception 'a refusal wrote or spent'; end if;
  -- A short wallet is refused, and the Act it was about to write is not left behind.
  perform tests.become(eveu);
  said := pg_temp.refusal(format('select open_report(%L, %L, %L)', eve_a, p, 'Why.'));
  perform tests.unbecome();
  if said is null or said not like '%costs%' then raise exception 'a short wallet reported: %', said; end if;
  if (select count(*) from acts where kind = 'report') is distinct from n0 or (select count(*) from wallet_events where kind = 'report') is distinct from e0 then raise exception 'a short wallet left a report behind'; end if;
  -- Three reports a day for a character; the fourth is refused, and the player's other mask reports on.
  for i in 1..2 loop perform pg_temp.report(ann_a, p, 'Report ' || i); end loop;
  perform tests.become(annu);
  said := pg_temp.refusal(format('select open_report(%L, %L, %L)', ann_a, p, 'Four.'));
  perform tests.unbecome();
  if said is null or said not like '%3 reports%' then raise exception 'the fourth report of a character went through: %', said; end if;
  if pg_temp.reports_n(ann_a) is distinct from 3::bigint then raise exception 'Rp Ann A holds % reports (the first section''s, and two)', pg_temp.reports_n(ann_a); end if;
  r1 := pg_temp.report(ann_b, p, 'From the other mask.');
  if r1 ->> 'report' is null then raise exception 'the quota was shared across a player''s masks'; end if;
  -- A refunded report is not counted: the character reports again. (Rp Ann A holds three reports today, one of them from section 1; refund two, and it is under the quota.)
  perform refund_report((select id from acts where kind = 'report' and character = ann_a order by created_at, id offset 1 limit 1));
  perform refund_report((select id from acts where kind = 'report' and character = ann_a order by created_at, id offset 2 limit 1));
  r2 := pg_temp.report(ann_a, p, 'After the refunds.');
  if r2 ->> 'report' is null then raise exception 'a refunded report still counted against the quota'; end if;
  -- A report across one's own masks: Ann B reports Ann A's post, and is answered as any other.
  r1 := pg_temp.report(ann_b, pg_temp.say(ann_a, t, 'Ann A speaks.'), 'My own other mask.');
  if r1 ->> 'report' is null or r1 ->> 'staff' is distinct from 'rp-m1' then raise exception 'a report across one''s own masks was refused or answered differently: %', r1; end if;
end $$;

-- ---- 2b. A banned character cannot report ----
do $$
declare
  eveu uuid := pg_temp.eve();
  eve_a uuid := (select id from characters where name = 'Rp Eve A');
  t uuid := tests.thread('Reports ban');
  p uuid := pg_temp.say((select id from characters where name = 'Rp Bob A'), t, 'A quiet post.');
  mine uuid := pg_temp.say(eve_a, t, 'A post of Eve''s.');
  said text;
begin
  update wallets set balance = 500 where account = pg_temp.eve();
  perform infract(eve_a, 'severe', mine, 'rp-m1');
  perform infract(eve_a, 'severe', mine, 'rp-m1');
  if banned_until(eve_a) is null then raise exception 'the world: two severe infractions did not ban'; end if;
  perform tests.become(eveu);
  said := pg_temp.refusal(format('select open_report(%L, %L, %L)', eve_a, p, 'Why.'));
  perform tests.unbecome();
  if said is null or said not like '%banned until%' then raise exception 'a banned character reported: %', said; end if;
  if pg_temp.reports_n(eve_a) is distinct from 0::bigint then raise exception 'a banned character left a report'; end if;
end $$;

-- ---- 3. The budget is one count, checked before the price, and says the same to everyone ----
do $$
declare
  annu uuid := pg_temp.ann();
  bobu uuid := pg_temp.bob();
  eveu uuid := pg_temp.eve();
  ann_b uuid := (select id from characters where name = 'Rp Ann B');
  bob_a uuid := (select id from characters where name = 'Rp Bob A');
  carol uuid := tests.character(pg_temp.bob(), 'Rp Bob B');
  t uuid := tests.thread('Reports budget');
  p uuid := pg_temp.say(bob_a, t, 'A quiet post.');
  mine uuid := pg_temp.say(ann_b, t, 'Another quiet post.');
  w_ann integer := pg_temp.wallet(pg_temp.ann());
  w_bob integer := pg_temp.wallet(pg_temp.bob());
  n0 bigint := (select count(*) from acts where kind = 'report');
  said_ann text; said_bob text; said_own text;
  was jsonb := (select value from settings where key = 'modBots');
  used integer := judgment_calls_today();
begin
  -- The ledger's calls count (reportJudge, patrolJudge, appeal); a filing does not.
  insert into model_calls (duty, staff, provider, model, cost_microdollars, outcome) values ('filing', 'rp-m1', 'fake', 'fake', 0, 'ok'), ('filing', 'rp-m1', 'fake', 'fake', 0, 'ok');
  if judgment_calls_today() is distinct from used then raise exception 'a filing call counted as a judgment'; end if;
  insert into model_calls (duty, staff, provider, model, cost_microdollars, outcome) values ('reportJudge', 'rp-m1', 'fake', 'fake', 0, 'ok'), ('patrolJudge', 'rp-m2', 'fake', 'fake', 0, 'failed'), ('appeal', 'rp-m2', 'fake', 'fake', 0, 'ok');
  if judgment_calls_today() is distinct from used + 3 then raise exception 'the judgments counted % not %', judgment_calls_today(), used + 3; end if;
  update settings set value = jsonb_set(value, '{judgmentsPerDay}', to_jsonb(judgment_calls_today())) where key = 'modBots';
  perform tests.become(annu);
  said_ann := pg_temp.refusal(format('select open_report(%L, %L, %L)', ann_b, p, 'Why.'));
  -- Reporting one's own mask's post is the same.
  said_own := pg_temp.refusal(format('select open_report(%L, %L, %L)', ann_b, mine, 'Why.'));
  perform tests.become(bobu);
  said_bob := pg_temp.refusal(format('select open_report(%L, %L, %L)', carol, p, 'Why.'));
  perform tests.unbecome();
  if said_ann is null or said_ann not like '%all the reports they will today%' then raise exception 'the budget did not refuse: %', said_ann; end if;
  if said_bob is distinct from said_ann or said_own is distinct from said_ann then raise exception 'the budget refusal differs with who asks: % / % / %', said_ann, said_bob, said_own; end if;
  -- A short wallet meets the same words: the budget is read before the price, so the refusal does not say who can pay.
  perform tests.become(eveu);
  said_own := pg_temp.refusal(format('select open_report(%L, %L, %L)', (select id from characters where name = 'Rp Eve A'), p, 'Why.'));
  perform tests.unbecome();
  update wallets set balance = 0 where account = pg_temp.eve();
  update settings set value = was where key = 'modBots';
  if pg_temp.wallet(pg_temp.ann()) is distinct from w_ann or pg_temp.wallet(pg_temp.bob()) is distinct from w_bob or (select count(*) from acts where kind = 'report') is distinct from n0 then
    raise exception 'a refused report paid or wrote';
  end if;
end $$;

-- ---- 4. close_report: a visit verdict, once, with the charge repaired ----
-- (From here on many reports are made by a few characters: the daily quota is raised out of the way.)
update settings set value = jsonb_set(value, '{reportsPerDay}', '100') where key = 'modBots';
do $$
declare
  ann_a uuid := (select id from characters where name = 'Rp Ann A');
  ann_b uuid := (select id from characters where name = 'Rp Ann B');
  t uuid := tests.thread('Reports verdicts');
  p1 uuid := pg_temp.victim(t);
  rep jsonb := pg_temp.report(ann_b, p1);
  got jsonb;
  again jsonb;
  v acts%rowtype;
  vis acts%rowtype;
begin
  got := close_report((rep ->> 'report')::uuid, 'visit', 'Rule 1, says the Mod.', '{"rule_number": 1, "band": "severe"}');
  if not (got ->> 'closed')::boolean or got ->> 'visit' is null then raise exception 'the verdict did not close with a visit: %', got; end if;
  select * into v from acts where id = (got ->> 'verdict_act')::uuid;
  if v.kind is distinct from 'report_verdict' or v.target_act_id is distinct from (rep ->> 'report')::uuid or v.thread is distinct from t or v.seq is not null
     or v.character is distinct from (select id from characters where staff = 'rp-m1') then raise exception 'the verdict Act is wrong: %', to_jsonb(v); end if;
  if v.payload is distinct from jsonb_build_object('report_act', rep ->> 'report', 'verdict', 'visit', 'line', 'Rule 1, says the Mod.', 'visit_act', got ->> 'visit') then raise exception 'the verdict payload is wrong: %', v.payload; end if;
  select * into vis from acts where id = (got ->> 'visit')::uuid;
  if vis.kind is distinct from 'visit' or vis.target_act_id is distinct from p1 or vis.payload #>> '{charges,0,cause}' is distinct from 'report' or vis.payload #>> '{charges,0,rule_number}' is distinct from '1'
     or vis.payload #>> '{charges,0,band}' is distinct from 'minor' or vis.payload #>> '{charges,0,rule}' is distinct from 'Rule 1: no all-caps posts' then raise exception 'the visit is wrong: %', vis.payload;
  end if;
  -- Twice closes once: the second returns the first, and writes no second verdict or visit.
  again := close_report((rep ->> 'report')::uuid, 'dismissed', 'Changed my mind.');
  if (again ->> 'closed')::boolean or (again ->> 'verdict_act')::uuid is distinct from v.id or again ->> 'verdict' is distinct from 'visit' or again ->> 'visit' is distinct from got ->> 'visit' then raise exception 'closing twice: %', again; end if;
  if (select count(*) from acts where kind = 'report_verdict' and target_act_id = (rep ->> 'report')::uuid) is distinct from 1::bigint then raise exception 'two verdicts'; end if;
  if (select count(*) from acts where kind = 'visit' and target_act_id = p1) is distinct from 1::bigint then raise exception 'two visits'; end if;
  -- A refunded or closed report is not refunded: it has its verdict.
  again := refund_report((rep ->> 'report')::uuid);
  if (again ->> 'refunded')::boolean or not (again ->> 'closed')::boolean then raise exception 'a closed report was refunded: %', again; end if;

  -- A charge naming no rule in force on the board becomes the premise at the minor band, even when it claims a severe one.
  rep := pg_temp.report(ann_b, pg_temp.victim(t));
  got := close_report((rep ->> 'report')::uuid, 'visit', null, '{"rule_number": 9, "band": "severe"}');
  select * into vis from acts where id = (got ->> 'visit')::uuid;
  if vis.payload #>> '{charges,0,rule_number}' is not null then raise exception 'a rule that is not in force kept its number: %', vis.payload; end if;
  if vis.payload #>> '{charges,0,band}' is distinct from 'minor' or vis.payload #>> '{charges,0,rule}' is distinct from 'the premise of ' || (select name from boards_now where id = (select id from boards where slug = 'general')) then raise exception 'the repaired charge is wrong: %', vis.payload -> 'charges'; end if;
  if not (got ->> 'charge_repaired')::boolean then raise exception 'the repair is not said'; end if;
  -- The stock line stands where the Mod gave none.
  if (select payload ->> 'line' from acts where id = (got ->> 'verdict_act')::uuid) is distinct from format('%s is looking at this post under the premise of %s.', 'Report Mod One', (select name from boards_now where id = (select id from boards where slug = 'general'))) then
    raise exception 'the stock line: %', (select payload ->> 'line' from acts where id = (got ->> 'verdict_act')::uuid);
  end if;
  -- A premise charge the Mod meant (no rule number) keeps its band.
  got := close_report((pg_temp.report(ann_b, pg_temp.victim(t)) ->> 'report')::uuid, 'visit', null, '{"rule_number": null, "band": "moderate"}');
  if (select payload #>> '{charges,0,band}' from acts where id = (got ->> 'visit')::uuid) is distinct from 'moderate' then raise exception 'a premise charge lost its band'; end if;
  -- No charge at all is the premise at the minor band.
  got := close_report((pg_temp.report(ann_b, pg_temp.victim(t)) ->> 'report')::uuid, 'visit', null, null);
  if (select payload #>> '{charges,0,band}' from acts where id = (got ->> 'visit')::uuid) is distinct from 'minor' then raise exception 'no charge was not minor'; end if;
  -- The house rule is told apart from the board's rule of the same number, and takes its own band.
  got := close_report((pg_temp.report(ann_b, pg_temp.victim(t)) ->> 'report')::uuid, 'visit', null, '{"rule_number": 1, "house": true, "band": "minor"}');
  vis := (select a from acts a where id = (got ->> 'visit')::uuid);
  if vis.payload #>> '{charges,0,rule}' is distinct from 'House Rule 1: the word "zzzz" is banned' or vis.payload #>> '{charges,0,band}' is distinct from 'moderate' then raise exception 'the house rule charge: %', vis.payload -> 'charges'; end if;
  -- Nothing names an account.
  if (select string_agg(payload::text, ' ') from acts where kind in ('report_verdict', 'visit') and thread = t) ~* (pg_temp.ann()::text || '|' || pg_temp.bob()::text) then raise exception 'a verdict or visit names an account'; end if;
  -- A verdict nobody can give.
  if pg_temp.refusal(format('select close_report(%L, %L)', (pg_temp.report(ann_a, pg_temp.victim(t)) ->> 'report'), 'maybe')) is null then raise exception 'a verdict of no kind was written'; end if;
  if pg_temp.refusal(format('select close_report(%L, %L)', gen_random_uuid(), 'dismissed')) is null then raise exception 'a report that is none was closed'; end if;
end $$;

-- ---- 5. A dismissed report: the Aura is spent, the Mod grumbles in public ----
do $$
declare
  ann_b uuid := (select id from characters where name = 'Rp Ann B');
  t uuid := tests.thread('Reports dismissed');
  p uuid := pg_temp.victim(t);
  w0 integer := pg_temp.wallet(pg_temp.ann());
  rep jsonb;
  got jsonb;
begin
  rep := pg_temp.report(ann_b, p);
  if pg_temp.wallet(pg_temp.ann()) is distinct from w0 - 25 then raise exception 'the report was not paid'; end if;
  got := close_report((rep ->> 'report')::uuid, 'dismissed', 'Nothing to see here, says the Mod.');
  if (select payload from acts where id = (got ->> 'verdict_act')::uuid) is distinct from jsonb_build_object('report_act', rep ->> 'report', 'verdict', 'dismissed', 'line', 'Nothing to see here, says the Mod.') then
    raise exception 'the dismissal is wrong: %', (select payload from acts where id = (got ->> 'verdict_act')::uuid);
  end if;
  if exists (select 1 from acts where kind = 'visit' and target_act_id = p) then raise exception 'a dismissed report drew a visit'; end if;
  if pg_temp.wallet(pg_temp.ann()) is distinct from w0 - 25 or exists (select 1 from report_refunds where report_act = (rep ->> 'report')::uuid) then raise exception 'a dismissal gave the Aura back'; end if;
  -- The stock line where the Mod gave none (an empty or blank line), with the Mod's and the reporter's public names.
  got := close_report((pg_temp.report(ann_b, pg_temp.victim(t)) ->> 'report')::uuid, 'dismissed', '   ');
  if (select payload ->> 'line' from acts where id = (got ->> 'verdict_act')::uuid) is distinct from 'Report Mod One dismisses Rp Ann B with a sigh.' then
    raise exception 'the dismissal''s stock line: %', (select payload ->> 'line' from acts where id = (got ->> 'verdict_act')::uuid);
  end if;
  -- A Mod's line past 280 is cut, never refused.
  got := close_report((pg_temp.report(ann_b, pg_temp.victim(t)) ->> 'report')::uuid, 'dismissed', repeat('w', 400));
  if char_length((select payload ->> 'line' from acts where id = (got ->> 'verdict_act')::uuid)) is distinct from 280 then raise exception 'a long line was not cut'; end if;
end $$;

-- ---- 6. A backfire visits the reporter's latest post; a reporter with no post draws no visit and the verdict still lands ----
do $$
declare
  ann_a uuid := (select id from characters where name = 'Rp Ann A');
  eve_a uuid := (select id from characters where name = 'Rp Eve A');
  t uuid := tests.thread('Reports backfire');
  p uuid := pg_temp.victim(t);
  -- Posted at distinct instants (a transaction's now() is one instant, and "latest" is by time): later than any post of Ann A's before.
  first_post uuid := tests.post(ann_a, t, 'My first word.', clock_timestamp());
  latest uuid := tests.post(ann_a, t, 'My last word.', clock_timestamp());
  rep jsonb;
  got jsonb;
  vis acts%rowtype;
  bare uuid := tests.character(pg_temp.ann(), 'Rp Ann Bare');
  visits0 bigint;
begin
  -- The backfire is checked against the latest post by its time, not by its place in some thread: a post elsewhere, later, is the latest.
  rep := pg_temp.report(ann_a, p);
  got := close_report((rep ->> 'report')::uuid, 'backfire', 'You have wasted my time, says the Mod.', '{"rule_number": 1, "band": "severe"}');
  if got ->> 'visit' is null then raise exception 'a backfire drew no visit: %', got; end if;
  select * into vis from acts where id = (got ->> 'visit')::uuid;
  if vis.target_act_id is distinct from latest or vis.character is distinct from (select id from characters where staff = 'rp-m1') then raise exception 'the backfire did not visit the reporter''s latest post: %', to_jsonb(vis); end if;
  if vis.payload #>> '{charges,0,cause}' is distinct from 'backfire' or vis.payload #>> '{charges,0,band}' is distinct from 'minor' or vis.payload #>> '{charges,0,rule_number}' is not null then
    raise exception 'the backfire''s charge is wrong (always minor, no rule): %', vis.payload -> 'charges';
  end if;
  if exists (select 1 from acts where kind = 'visit' and target_act_id = p) then raise exception 'a backfire visited the reported post'; end if;
  if (select payload from acts where id = (got ->> 'verdict_act')::uuid) is distinct from jsonb_build_object('report_act', rep ->> 'report', 'verdict', 'backfire', 'line', 'You have wasted my time, says the Mod.', 'visit_act', got ->> 'visit') then
    raise exception 'the backfire''s verdict is wrong';
  end if;
  -- The stock line, with the reporter's name.
  got := close_report((pg_temp.report(ann_a, pg_temp.victim(t)) ->> 'report')::uuid, 'backfire');
  if (select payload ->> 'line' from acts where id = (got ->> 'verdict_act')::uuid) is distinct from 'Report Mod One has words for Rp Ann A.' then raise exception 'the backfire''s stock line: %', (select payload ->> 'line' from acts where id = (got ->> 'verdict_act')::uuid); end if;
  -- The same latest post is not charged twice for one wasted report: the second backfire finds the charge already there, and the verdict still lands.
  if (select count(*) from acts where kind = 'visit' and target_act_id = latest) is distinct from 1::bigint then raise exception 'a second backfire opened a second visit on the post'; end if;
  -- A reporter with no post at all: no visit, the verdict lands, with no visit_act.
  rep := pg_temp.report(bare, pg_temp.victim(t));
  visits0 := (select count(*) from acts where kind = 'visit');
  got := close_report((rep ->> 'report')::uuid, 'backfire', 'And you have not even posted.');
  if got ->> 'closed' is distinct from 'true' or got ->> 'visit' is not null then raise exception 'a backfire on a reporter with no post: %', got; end if;
  if (select payload from acts where id = (got ->> 'verdict_act')::uuid) is distinct from jsonb_build_object('report_act', rep ->> 'report', 'verdict', 'backfire', 'line', 'And you have not even posted.') then
    raise exception 'the verdict for a reporter with no post: %', (select payload from acts where id = (got ->> 'verdict_act')::uuid);
  end if;
  if (select count(*) from acts where kind = 'visit') is distinct from visits0 then raise exception 'a visit was started for a reporter with no post'; end if;
end $$;

-- ---- 7. refund_report: once, nothing else written, the report can be made again ----
do $$
declare
  ann_a uuid := tests.character(pg_temp.ann(), 'Rp Ann Refund');
  t uuid := tests.thread('Reports refund');
  p uuid := pg_temp.victim(t);
  w0 integer := pg_temp.wallet(pg_temp.ann());
  acts0 bigint;
  rep jsonb;
  got jsonb;
  old uuid;
  fresh jsonb;
  closed jsonb;
  w1 integer;
  swept integer;
begin
  rep := pg_temp.report(ann_a, p);
  acts0 := (select count(*) from acts);
  got := refund_report((rep ->> 'report')::uuid);
  if not (got ->> 'refunded')::boolean or (got ->> 'amount')::integer <> 25 then raise exception 'the refund: %', got; end if;
  if pg_temp.wallet(pg_temp.ann()) is distinct from w0 then raise exception 'the refund did not return the price: % vs %', pg_temp.wallet(pg_temp.ann()), w0; end if;
  if (select count(*) from acts) is distinct from acts0 then raise exception 'a refund wrote an Act'; end if;
  if not exists (select 1 from wallet_events where kind = 'refund' and ref = (rep ->> 'report')::uuid and change = 25 and account = pg_temp.ann()) then raise exception 'the refund is not in the wallet history'; end if;
  -- Twice refunds once.
  got := refund_report((rep ->> 'report')::uuid);
  if (got ->> 'refunded')::boolean or not (got ->> 'already')::boolean then raise exception 'a second refund: %', got; end if;
  if pg_temp.wallet(pg_temp.ann()) is distinct from w0 or (select count(*) from wallet_events where kind = 'refund' and ref = (rep ->> 'report')::uuid) is distinct from 1::bigint then raise exception 'a second refund paid again'; end if;
  -- A refunded report cannot then be closed (the reporter has her Aura back, and the Mod must not also act on it).
  closed := close_report((rep ->> 'report')::uuid, 'visit', null, null);
  if (closed ->> 'closed')::boolean or not (closed ->> 'refunded')::boolean or exists (select 1 from acts where kind = 'report_verdict' and target_act_id = (rep ->> 'report')::uuid) or exists (select 1 from acts where kind = 'visit' and target_act_id = p) then
    raise exception 'a refunded report was closed: %', closed;
  end if;
  -- The report can be made again.
  fresh := pg_temp.report(ann_a, p, 'Once more.');
  if fresh ->> 'report' is null or (fresh ->> 'report') = (rep ->> 'report') then raise exception 'the report could not be made again'; end if;
  -- Records are never edited, so a refund is a fact the table holds.
  if pg_temp.refusal(format('delete from report_refunds where report_act = %L', rep ->> 'report')) is null or pg_temp.refusal(format('update report_refunds set amount = 0 where report_act = %L', rep ->> 'report')) is null then raise exception 'a refund was edited'; end if;

  -- A free report (the price is a setting) is refunded all the same: nothing to pay back, and the report is refunded.
  update settings set value = jsonb_set(value, '{reportPrice}', '0') where key = 'modBots';
  w1 := pg_temp.wallet(pg_temp.ann());
  fresh := pg_temp.report(ann_a, p, 'Free.');
  got := refund_report((fresh ->> 'report')::uuid);
  if not (got ->> 'refunded')::boolean or (got ->> 'amount')::integer <> 0 or pg_temp.wallet(pg_temp.ann()) is distinct from w1 then raise exception 'a free report''s refund: %', got; end if;
  if (refund_report((fresh ->> 'report')::uuid) ->> 'refunded')::boolean then raise exception 'a free report was refunded twice'; end if;
  update settings set value = jsonb_set(value, '{reportPrice}', '25') where key = 'modBots';

  -- Stale: a report whose judgment never came back is refunded, a fresh one and a closed one are not.
  perform set_config('kayfabb.report_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at) values (ann_a, 'report', t, p, '{"reason": "an old one"}', now() - interval '1 hour') returning id into old;
  perform set_config('kayfabb.report_writer', '', true);
  update wallets set balance = balance - 25 where account = pg_temp.ann();
  insert into wallet_events (account, kind, change, balance_after, ref) values (pg_temp.ann(), 'report', -25, pg_temp.wallet(pg_temp.ann()), old);
  fresh := pg_temp.report(ann_a, p, 'Just now.');
  perform refund_report((pg_temp.report(ann_a, p, 'Refunded.') ->> 'report')::uuid);
  perform close_report((pg_temp.report(ann_a, p, 'Answered.') ->> 'report')::uuid, 'dismissed');
  w1 := pg_temp.wallet(pg_temp.ann());
  swept := refund_stale_reports(10);
  if swept is distinct from 1 then raise exception 'the sweep refunded % reports, not the one old one', swept; end if;
  if pg_temp.wallet(pg_temp.ann()) is distinct from w1 + 25 then raise exception 'the old report was not refunded: % -> %', w1, pg_temp.wallet(pg_temp.ann()); end if;
  if not exists (select 1 from report_refunds where report_act = old) or exists (select 1 from report_refunds where report_act = (fresh ->> 'report')::uuid) then raise exception 'the sweep refunded the wrong reports'; end if;
  if refund_stale_reports(10) is distinct from 0 then raise exception 'the sweep refunded again'; end if;
end $$;

-- ---- 8. The doors ----
do $$
declare
  annu uuid := pg_temp.ann();
  ann_a uuid := (select id from characters where name = 'Rp Ann A');
  t uuid := tests.thread('Reports doors');
  p uuid := pg_temp.victim(t);
  rep jsonb := pg_temp.report(ann_a, p);
  said text;
  w integer := pg_temp.wallet(pg_temp.ann());
begin
  perform tests.become(annu);
  for said in select unnest(array[
      format('select close_report(%L, ''dismissed'')', rep ->> 'report'),
      format('select refund_report(%L)', rep ->> 'report'),
      'select refund_stale_reports(1)',
      'select judgment_calls_today()',
      format('select report_line(''reportDismissed'', ''rp-m1'', ''x'')'),
      format('select start_visit(%L, ''rp-m1'', ''{"band": "minor", "cause": "backfire"}'')', p)]) loop
    if pg_temp.refusal(said) is null then raise exception 'a player ran %', said; end if;
  end loop;
  -- A client cannot write a report or a verdict by hand, nor as the Mod.
  if pg_temp.refusal(format('insert into acts (character, kind, thread, target_act_id, payload) values (%L, ''report'', %L, %L, ''{"reason": "by hand"}'')', ann_a, t, p)) is null then raise exception 'a player wrote a report by hand'; end if;
  perform tests.unbecome();
  -- Not even as the owner of the table: only open_report writes one, and a verdict only the Mod's, on a report.
  if pg_temp.refusal(format('insert into acts (character, kind, thread, target_act_id, payload) values (%L, ''report'', %L, %L, ''{"reason": "by hand"}'')', ann_a, t, p)) is null then raise exception 'a report was written outside open_report'; end if;
  if pg_temp.refusal(format('insert into acts (character, kind, thread, target_act_id, payload) values (%L, ''report_verdict'', %L, %L, jsonb_build_object(''report_act'', %L::text, ''verdict'', ''dismissed'', ''line'', ''x''))', ann_a, t, rep ->> 'report', rep ->> 'report')) is null then raise exception 'a player''s character gave a verdict'; end if;
  if pg_temp.refusal(format('select write_staff_act(''rp-m1'', ''report_verdict'', %L, %L, jsonb_build_object(''report_act'', %L::text, ''verdict'', ''dismissed'', ''line'', %L))', t, p, p::text, 'x')) is null then raise exception 'a verdict was written on a post'; end if;
  if pg_temp.refusal(format('select write_staff_act(''rp-m1'', ''report_verdict'', %L, %L, jsonb_build_object(''verdict'', ''dismissed'', ''line'', ''x''))', t, rep ->> 'report')) is null then raise exception 'a verdict with no report named was written'; end if;
  -- The tables: no client grant.
  perform tests.become(annu);
  if pg_temp.refusal('select * from report_refunds') is null then raise exception 'a client read report_refunds'; end if;
  perform tests.unbecome();
  if pg_temp.wallet(pg_temp.ann()) is distinct from w then raise exception 'the doors moved a wallet'; end if;
end $$;

