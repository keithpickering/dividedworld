-- The concession post under concurrency (supabase/migrations/0447_concession_post.sql; docs/plans/2026-11-24-concession-post-plan.md, Task 1 and "Review focus").
-- Races, so they commit through dblink on purpose (the way 0446-written-quiz-race.sql does), and each round's world is committed first. Every name is this file's (cr...).
--   A. Two right answers to one quiz visit at once: one succeeds, the other finds the visit over; one concession post, one visit end.
--      (A quiz answered right racing a distraction on one visit cannot happen: a quiz visit is moved only by an answer and a distraction visit only by a card, so the same-visit race a card allows is B.)
--   B. Two casts at one distraction visit at once: one concession post, one visit end.
--   C. A bribe talk-down and a late write_visit_concession at once: one post; a write that lost writes nothing, one that won is what is posted.
--   D. A thread cast (ending two distraction visits of two Mods) and an interception (a bribe) in one thread at once: no deadlock, three posts, three ends.

do $$
begin
  perform tests.commit($sql$
    do $w$
    declare
      seed jsonb;
    begin
      seed := jsonb_build_object(
        'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
          'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
          'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5, 'patrolPool', 20,
            'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
            'cap', jsonb_build_object('punishments', 3, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10, 'quizQuestionsPerDay', 60, 'quizWriteMinutes', 15, 'concessionsPerDay', 60, 'concessionWriteMinutes', 15),
          'systemLines', jsonb_build_object('visitArrived', jsonb_build_array('{mod} is looking at this post under {rule}.')),
          'systemMoveWords', jsonb_build_object('setRule', 'a rule')),
        'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
        'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'cr-boss',
          'staff', jsonb_build_array(
            jsonb_build_object('key', 'cr-boss', 'name', 'Cr Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
            jsonb_build_object('key', 'cr-m1', 'name', 'Cr Quiz Mod', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
              'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'quiz', 'questions', 1),
              'quiz', jsonb_build_array(jsonb_build_object('question', 'Which is the oldest?', 'choices', jsonb_build_array('Moss', 'Stone'), 'answer', 'Stone')),
              'concessions', jsonb_build_array('Quiz line one, {who}.', 'Quiz line two, {who}.', 'Quiz line three.')),
            jsonb_build_object('key', 'cr-m2', 'name', 'Cr Bribe Mod', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
              'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50),
              'concessions', jsonb_build_array('Bribe line one, {who}.', 'Bribe line two, {who}.', 'Bribe line three.')),
            jsonb_build_object('key', 'cr-m3', 'name', 'Cr Distract One', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
              'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'distraction'),
              'concessions', jsonb_build_array('One line one, {who}.', 'One line two, {who}.', 'One line three.')),
            jsonb_build_object('key', 'cr-m4', 'name', 'Cr Distract Two', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
              'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'distraction'),
              'concessions', jsonb_build_array('Two line one, {who}.', 'Two line two, {who}.', 'Two line three.'))),
          'firstStaff', jsonb_build_array('cr-m1', 'cr-m2', 'cr-m3', 'cr-m4'),
          'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
          'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
          'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
      perform seed_instance(seed);
      insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack) values ('cr-th', 'Cr Thread', 'sweet', 'common', 'cast', '{thread}', interval '1 day', 50);
      create table public.cr_ids (round text, k text, id uuid);
      create table public.cr_said (round text, who text, said text);
    end $w$;
  $sql$);
end $$;

-- A round's world, committed: accounts (a, b, with wallets), their characters, a thread, and what the scenario names. `kind` picks the posts and visits made.
create function pg_temp.round(name text, kind text) returns void language plpgsql as $$
begin
  perform tests.commit(format($sql$
    do $w$
    declare
      ua uuid; ub uuid; ca uuid; cb uuid; au uuid; ca2 uuid; t uuid; p uuid; v uuid;
      rd text := %1$L;
      kd text := %2$L;
      function_mark int;
    begin
      ua := tests.account('cr-a-' || rd); ub := tests.account('cr-b-' || rd); au := tests.account('cr-au-' || rd);
      ca := tests.character(ua, 'Cr A ' || rd); cb := tests.character(ub, 'Cr B ' || rd); ca2 := tests.character(au, 'Cr Author ' || rd);
      insert into wallets (account, balance) values (ua, 500), (ub, 500) on conflict (account) do update set balance = 500;
      insert into card_ledger (account, card, kind, price) values (ua, 'cr-th', 'bought', 0), (ub, 'cr-th', 'bought', 0);
      t := tests.thread('Cr ' || rd);
      insert into public.cr_ids values (rd, 'ua', ua), (rd, 'ub', ub), (rd, 'ca', ca), (rd, 'cb', cb), (rd, 't', t);
      if kd = 'quiz' then
        p := tests.post(ca2, t, 'A quiz post.');
        v := (start_visit(p, 'cr-m1', jsonb_build_object('rule_number', 1, 'board', (select th.board from threads th where th.id = t), 'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'Rule 1: no all-caps posts')) ->> 'visit')::uuid;
        perform write_visit_quiz(v, 'model', 'Which is the oldest?', '["Moss", "Stone"]'::jsonb, 'Stone');
        insert into public.cr_ids values (rd, 'v1', v);
      elsif kd = 'bribe' then
        p := tests.post(ca2, t, 'A bribe post.');
        v := (start_visit(p, 'cr-m2', jsonb_build_object('rule_number', 1, 'board', (select th.board from threads th where th.id = t), 'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'Rule 1: no all-caps posts')) ->> 'visit')::uuid;
        insert into public.cr_ids values (rd, 'v1', v), (rd, 'p1', p);
      elsif kd = 'distract1' or kd = 'mixed' then
        p := tests.post(ca2, t, 'A distraction post.');
        v := (start_visit(p, 'cr-m3', jsonb_build_object('rule_number', 1, 'board', (select th.board from threads th where th.id = t), 'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'Rule 1: no all-caps posts')) ->> 'visit')::uuid;
        insert into public.cr_ids values (rd, 'v1', v);
        if kd = 'mixed' then
          p := tests.post(ca2, t, 'A second distraction post.');
          v := (start_visit(p, 'cr-m4', jsonb_build_object('rule_number', 1, 'board', (select th.board from threads th where th.id = t), 'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'Rule 1: no all-caps posts')) ->> 'visit')::uuid;
          insert into public.cr_ids values (rd, 'v2', v);
          p := tests.post(ca2, t, 'A bribe post.');
          v := (start_visit(p, 'cr-m2', jsonb_build_object('rule_number', 1, 'board', (select th.board from threads th where th.id = t), 'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'Rule 1: no all-caps posts')) ->> 'visit')::uuid;
          insert into public.cr_ids values (rd, 'v3', v);
        end if;
      end if;
    end $w$;
  $sql$, name, kind));
end $$;

create function pg_temp.id(rd text, k text) returns uuid language sql as $$ select id from public.cr_ids where round = rd and k = $2 $$;

-- The two sessions' answers: a statement that is a refusal of the visit being over, or of a race it lost, is not a failure; a deadlock or a lock timeout is.
create function pg_temp.fine(said text) returns boolean language sql as $$
  select said is null or (said !~* 'deadlock|lock timeout|could not obtain lock|canceling statement')
$$;

create function pg_temp.posts_of(v uuid) returns bigint language sql as $$ select count(*) from visit_concession_posts where visit_act = v and post_act is not null $$;
create function pg_temp.ends_of(v uuid) returns bigint language sql as $$ select count(*) from acts where kind = 'visit_end' and target_act_id = v $$;

-- ---- A. Two right answers at once ----
do $$
declare
  rd text; v uuid; said text[]; r integer;
begin
  for r in 1..4 loop
    rd := 'a' || r;
    perform pg_temp.round(rd, 'quiz');
    v := pg_temp.id(rd, 'v1');
    said := tests.race(pg_temp.id(rd, 'ua'), format('select intercept(%L, %L, %L)', pg_temp.id(rd, 'ca'), v, 'Stone'),
                       pg_temp.id(rd, 'ub'), format('select intercept(%L, %L, %L)', pg_temp.id(rd, 'cb'), v, 'Stone'));
    if not pg_temp.fine(said[1]) or not pg_temp.fine(said[2]) then raise exception 'round %: a racer failed in a way that is no lost race: %', rd, said; end if;
    if (said[1] is null)::int + (said[2] is null)::int is distinct from 1 then raise exception 'round %: not exactly one answer won: %', rd, said; end if;
    if pg_temp.ends_of(v) is distinct from 1::bigint then raise exception 'round %: % visit ends', rd, pg_temp.ends_of(v); end if;
    if pg_temp.posts_of(v) is distinct from 1::bigint or (select count(*) from visit_concession_posts where visit_act = v) is distinct from 1::bigint then raise exception 'round %: not exactly one concession post', rd; end if;
    if (select count(*) from acts a where a.kind = 'post' and a.thread = pg_temp.id(rd, 't') and a.character in (select id from characters where staff is not null)) is distinct from 1::bigint then raise exception 'round %: the thread holds more than one Mod post', rd; end if;
  end loop;
end $$;

-- ---- B. Two casts at one distraction visit at once ----
do $$
declare
  rd text; v uuid; said text[]; r integer;
begin
  for r in 1..4 loop
    rd := 'b' || r;
    perform pg_temp.round(rd, 'distract1');
    v := pg_temp.id(rd, 'v1');
    said := tests.race_service(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', pg_temp.id(rd, 'ua'), 'cr-th', pg_temp.id(rd, 'ca'), pg_temp.id(rd, 't'), '{}', '', 'thread'),
                               format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', pg_temp.id(rd, 'ub'), 'cr-th', pg_temp.id(rd, 'cb'), pg_temp.id(rd, 't'), '{}', '', 'thread'));
    if not pg_temp.fine(said[1]) or not pg_temp.fine(said[2]) then raise exception 'round %: a cast failed in a way that is no lost race: %', rd, said; end if;
    if pg_temp.ends_of(v) is distinct from 1::bigint then raise exception 'round %: % visit ends', rd, pg_temp.ends_of(v); end if;
    if pg_temp.posts_of(v) is distinct from 1::bigint then raise exception 'round %: % concession posts for one visit', rd, pg_temp.posts_of(v); end if;
    if (select count(*) from acts a where a.kind = 'intercept' and a.payload ->> 'visit_act' = v::text) is distinct from 1::bigint then raise exception 'round %: two casts both distracted the visit', rd; end if;
  end loop;
end $$;

-- ---- C. A talk-down and a late write of the concession at once ----
do $$
declare
  rd text; v uuid; said text[]; r integer; wrote boolean; body text;
begin
  for r in 1..6 loop
    rd := 'c' || r;
    perform pg_temp.round(rd, 'bribe');
    v := pg_temp.id(rd, 'v1');
    said := tests.race_as(pg_temp.id(rd, 'ua'), format('select intercept(%L, %L)', pg_temp.id(rd, 'ca'), v),
                          null, format('select write_visit_concession(%L, %L, %L, null)', v, 'model', 'A late written line for {who}.'));
    if said[1] is not null or said[2] is not null then raise exception 'round %: a racer failed: %', rd, said; end if;
    if pg_temp.ends_of(v) is distinct from 1::bigint or pg_temp.posts_of(v) is distinct from 1::bigint then raise exception 'round %: not one end and one post (% / %)', rd, pg_temp.ends_of(v), pg_temp.posts_of(v); end if;
    wrote := exists (select 1 from visit_concessions where visit_act = v);
    select a.payload ->> 'body' into body from visit_concession_posts p join acts a on a.id = p.post_act where p.visit_act = v;
    if wrote and (select source from visit_concession_posts where visit_act = v) is distinct from 'model' then raise exception 'round %: a written concession stood and the post is not it', rd; end if;
    if not wrote and (select source from visit_concession_posts where visit_act = v) is distinct from 'stock' then raise exception 'round %: nothing was written and the post is not the stock', rd; end if;
    if wrote and body is distinct from 'A late written line for Cr A ' || rd || '.' then raise exception 'round %: the posted body is not the written one: %', rd, body; end if;
  end loop;
end $$;

-- ---- D. One cast ending two visits, and an interception, in one thread at once ----
do $$
declare
  rd text; said text[]; r integer; v uuid;
begin
  for r in 1..6 loop
    rd := 'd' || r;
    perform pg_temp.round(rd, 'mixed');
    said := tests.race_as(pg_temp.id(rd, 'ua'), format('select intercept(%L, %L)', pg_temp.id(rd, 'ca'), pg_temp.id(rd, 'v3')),
                          null, format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', pg_temp.id(rd, 'ub'), 'cr-th', pg_temp.id(rd, 'cb'), pg_temp.id(rd, 't'), '{}', '', 'thread'));
    if said[1] is not null or said[2] is not null then raise exception 'round %: a cast and an interception in one thread failed (deadlock?): %', rd, said; end if;
    foreach v in array array[pg_temp.id(rd, 'v1'), pg_temp.id(rd, 'v2'), pg_temp.id(rd, 'v3')] loop
      if pg_temp.ends_of(v) is distinct from 1::bigint or pg_temp.posts_of(v) is distinct from 1::bigint then raise exception 'round %: visit % has % ends and % posts', rd, v, pg_temp.ends_of(v), pg_temp.posts_of(v); end if;
    end loop;
  end loop;
end $$;

-- ---- E. The interleaving forced: a cast holds the thread's row (as place_cast does at thread reach) and an interception of a bribe visit in that thread is already in flight ----
-- A (the cast): opens a transaction, takes the thread row `for no key update`. B (the interception, async): starts and, with no thread lock of its own first, takes the bribe visit's open row and then waits for the thread's row
-- (the concession post). A then runs distract_visits for the thread, which ends the two distraction visits. A cast and an interception never want the same open row (a distraction visit is moved by a card only, a bribe visit by
-- a payment only; an interception of a distraction visit is refused before it posts), so A needs nothing B holds: A commits, B's wait ends, both succeed, one post per ended visit.
do $$
declare
  url text := current_setting('kayfabb.scratch_url');
  rd text := 'e1'; t uuid; v uuid; waited integer := 0; r text; said_a text; said_b text;
begin
  perform pg_temp.round(rd, 'mixed');
  t := pg_temp.id(rd, 't');
  perform extensions.dblink_connect('cr_a', url);
  perform extensions.dblink_connect('cr_b', url);
  begin
    perform extensions.dblink_exec('cr_a', 'begin');
    perform * from extensions.dblink('cr_a', format('select 1 from threads where id = %L for no key update', t)) as x(one int);
    perform extensions.dblink_exec('cr_b', 'begin');
    perform * from extensions.dblink('cr_b', format($c$select set_config('request.jwt.claims', %L, true), set_config('role', 'authenticated', true)$c$,
      jsonb_build_object('sub', pg_temp.id(rd, 'ua'), 'role', 'authenticated')::text)) as x(a text, b text);
    perform extensions.dblink_send_query('cr_b', format('select intercept(%L, %L)', pg_temp.id(rd, 'ca'), pg_temp.id(rd, 'v3')));
    -- B is in flight and waiting for a lock (the thread's row) before A goes on. pg_stat_activity is read from a snapshot kept for the whole transaction (this block is one), so the snapshot is dropped before every
    -- look: without it a first look taken before B had reached its wait stays the answer for the whole loop, and the poll times out (it did on CI, where B is slower to get there than on a quiet local machine).
    loop
      perform pg_stat_clear_snapshot();
      exit when exists (select 1 from pg_stat_activity s where s.datname = current_database() and s.wait_event_type = 'Lock' and s.query like '%intercept(%' || pg_temp.id(rd, 'v3')::text || '%');
      waited := waited + 1;
      if waited > 400 then raise exception 'the interception never waited on a lock'; end if;
      perform pg_sleep(0.025);
    end loop;
    begin
      perform * from extensions.dblink('cr_a', format('select distract_visits(%L, %L, %L)', pg_temp.id(rd, 'cb'), t, gen_random_uuid())) as x(n int);
      said_a := null;
    exception when others then said_a := sqlerrm;
    end;
    begin perform extensions.dblink_exec('cr_a', 'commit'); exception when others then said_a := coalesce(said_a, sqlerrm); end;
    begin
      select x.s into said_b from extensions.dblink_get_result('cr_b') as x(s text);
      perform * from extensions.dblink_get_result('cr_b') as x(s text);
    exception when others then said_b := sqlerrm;
    end;
    begin perform extensions.dblink_exec('cr_b', 'commit'); exception when others then null; end;
  exception when others then
    perform extensions.dblink_disconnect('cr_a'); perform extensions.dblink_disconnect('cr_b');
    raise;
  end;
  perform extensions.dblink_disconnect('cr_a'); perform extensions.dblink_disconnect('cr_b');
  if said_a is not null then raise exception 'the cast failed: %', said_a; end if;
  if said_b is null or said_b !~ 'succeeded' then raise exception 'the interception failed: %', said_b; end if;
  foreach v in array array[pg_temp.id(rd, 'v1'), pg_temp.id(rd, 'v2'), pg_temp.id(rd, 'v3')] loop
    if pg_temp.ends_of(v) is distinct from 1::bigint or pg_temp.posts_of(v) is distinct from 1::bigint then raise exception 'visit % has % ends and % posts', v, pg_temp.ends_of(v), pg_temp.posts_of(v); end if;
  end loop;
end $$;
