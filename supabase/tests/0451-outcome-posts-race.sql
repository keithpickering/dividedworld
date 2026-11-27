-- Outcome posts under concurrency (supabase/migrations/0451_outcome_posts.sql; docs/plans/2026-11-26-outcome-posts-plan.md, Task 1 "Race file").
-- Races, so they commit through dblink on purpose (the way 0449-concession-post-race.sql does), and each round's world is committed first. Every name is this file's (or...).
--   A. Two staff runs writing one owed concession at once: one post, one outcome row.
--   B. A model write racing the tick's stock for one owed concession: exactly one of them posts.
--   C. Two casts at one thread's two distraction visits at once: two ends, two owed rows, two posts at most once each, no deadlock.
--   D. close_appeal twice on one appeal at once: one ruling Act, one ruling post.
--   E. Two staff runs writing one ban's entry at once: one entry.
--   F. A ban's model entry racing close_appeal's stock entry for the same ban: one entry, and the ruling quotes it.
--   G. Two first bans of a season, in two transactions, opening one Banlist.

do $$
begin
  perform tests.commit($sql$
    do $w$
    declare
      seed jsonb;
    begin
      seed := jsonb_build_object(
        'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
          'warnBar', jsonb_build_object('size', 7, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
          'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5, 'patrolPool', 20,
            'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 600, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
            'cap', jsonb_build_object('punishments', 50, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10, 'quizQuestionsPerDay', 60, 'quizWriteMinutes', 15, 'concessionsPerDay', 60, 'concessionWriteMinutes', 15),
          'systemLines', jsonb_build_object('visitArrived', jsonb_build_array('{mod} is looking at this post under {rule}.'), 'appealUpheld', jsonb_build_array('{mod} turns {appellant} down.'),
            'banEntry', jsonb_build_array('The System shrugs at {banned}.')),
          'systemMoveWords', jsonb_build_object('setRule', 'a rule')),
        'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
        'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'or-boss',
          'staff', jsonb_build_array(
            jsonb_build_object('key', 'or-boss', 'name', 'Or Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
            jsonb_build_object('key', 'or-m1', 'name', 'Or Bribe Mod', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
              'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50),
              'concessions', jsonb_build_array('Bribe line one, {who}.', 'Bribe line two, {who}.', 'Bribe line three.')),
            jsonb_build_object('key', 'or-m3', 'name', 'Or Distract One', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
              'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'distraction'),
              'concessions', jsonb_build_array('One line one, {who}.')),
            jsonb_build_object('key', 'or-m4', 'name', 'Or Distract Two', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
              'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'distraction'),
              'concessions', jsonb_build_array('Two line one, {who}.'))),
          'firstStaff', jsonb_build_array('or-m1', 'or-m3', 'or-m4'),
          'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
          'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
          'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
      perform seed_instance(seed);
      update settings set value = value || jsonb_build_object('banlistThreadTitle', 'Season {season}: Banlist',
        'banlistEntry', 'Banned: {character}, {days} days, {rule}. [url={post}]The post that did it.[/url]') where key = 'copy';
      insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, stack) values ('or-th', 'Or Thread', 'sweet', 'common', 'cast', '{thread}', interval '1 day', 50);
      create table public.or_ids (round text, k text, id uuid);
    end $w$;
  $sql$);
end $$;

-- A round's world, committed: two players with wallets and characters, an author, a thread, and what the scenario names.
create function pg_temp.round(name text, kind text) returns void language plpgsql as $$
begin
  perform tests.commit(format($sql$
    do $w$
    declare
      ua uuid; ub uuid; ca uuid; cb uuid; au uuid; ca2 uuid; t uuid; p uuid; p2 uuid; v uuid; ban uuid; ap uuid; ban2 uuid;
      rd text := %1$L;
      kd text := %2$L;
      charge jsonb;
    begin
      ua := tests.account('or-a-' || rd); ub := tests.account('or-b-' || rd); au := tests.account('or-au-' || rd);
      ca := tests.character(ua, 'Or A ' || rd); cb := tests.character(ub, 'Or B ' || rd); ca2 := tests.character(au, 'Or Author ' || rd);
      insert into wallets (account, balance) values (ua, 500), (ub, 500), (au, 500) on conflict (account) do update set balance = 500;
      insert into card_ledger (account, card, kind, price) values (ua, 'or-th', 'bought', 0), (ub, 'or-th', 'bought', 0);
      t := tests.thread('Or ' || rd);
      insert into public.or_ids values (rd, 'ua', ua), (rd, 'ub', ub), (rd, 'ca', ca), (rd, 'cb', cb), (rd, 't', t), (rd, 'au', au), (rd, 'cau', ca2);
      if kd in ('owed', 'owed_aged') then
        p := tests.post(ca2, t, 'A bribe post.');
        v := (start_visit(p, 'or-m1', jsonb_build_object('rule_number', 1, 'board', (select th.board from threads th where th.id = t), 'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'Rule 1: no all-caps posts')) ->> 'visit')::uuid;
        perform tests.become(ua);
        perform intercept(ca, v);
        perform tests.unbecome();
        insert into public.or_ids values (rd, 'v1', v), (rd, 'p1', p);
        if kd = 'owed_aged' then
          alter table concessions_owed disable trigger concessions_owed_no_update;
          update concessions_owed set at = at - interval '20 minutes' where visit_act = v;
          alter table concessions_owed enable always trigger concessions_owed_no_update;
        end if;
      elsif kd = 'cast' then
        p := tests.post(ca2, t, 'A distraction post.');
        v := (start_visit(p, 'or-m3', jsonb_build_object('rule_number', 1, 'board', (select th.board from threads th where th.id = t), 'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'Rule 1: no all-caps posts')) ->> 'visit')::uuid;
        insert into public.or_ids values (rd, 'v1', v);
        p := tests.post(ca2, t, 'A second distraction post.');
        v := (start_visit(p, 'or-m4', jsonb_build_object('rule_number', 1, 'board', (select th.board from threads th where th.id = t), 'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'Rule 1: no all-caps posts')) ->> 'visit')::uuid;
        insert into public.or_ids values (rd, 'v2', v);
      elsif kd = 'appeal' then
        p := tests.post(ca2, t, 'A post that drew an infraction.');
        v := (start_visit(p, 'or-m1', jsonb_build_object('rule_number', 1, 'board', (select th.board from threads th where th.id = t), 'band', 'minor', 'cause', 'rule', 'about_act', p, 'rule', 'Rule 1: no all-caps posts')) ->> 'visit')::uuid;
        perform file_visit(v, 'Filed.');
        ban := (select i.id from acts i where i.kind = 'infraction' and i.payload ->> 'visit_act' = v::text);
        perform tests.become(au);
        ap := (open_appeal(ca2, ban, 'I did nothing wrong.') ->> 'appeal')::uuid;
        perform tests.unbecome();
        insert into public.or_ids values (rd, 'ap', ap), (rd, 'p1', p);
      elsif kd = 'ban' then
        p := tests.post(ca2, t, 'A post that fills the bar.');
        ban := (infract(ca2, 'severe', p, 'or-m1') ->> 'ban')::uuid;
        insert into public.or_ids values (rd, 'ban', ban), (rd, 'p1', p);
      elsif kd = 'banappeal' then
        p := tests.post(ca2, t, 'A post that fills the bar.');
        ban := (infract(ca2, 'severe', p, 'or-m1') ->> 'ban')::uuid;
        perform tests.become(au);
        ap := (open_appeal(ca2, ban, 'I did nothing wrong.') ->> 'appeal')::uuid;
        perform tests.unbecome();
        insert into public.or_ids values (rd, 'ban', ban), (rd, 'ap', ap), (rd, 'p1', p);
      elsif kd = 'twobans' then
        -- A season of its own (the number is the round's), so its Banlist is not yet made.
        update seasons set ends_at = now() where ends_at is null;
        insert into seasons (number, starts_at) values ((select max(number) + 1 from seasons), now());
        p := tests.post(ca2, t, 'A post that fills the bar.');
        p2 := tests.post(ca2, t, 'A post that fills the bar, in another thread.');
        ban := (infract(ca2, 'severe', p, 'or-m1') ->> 'ban')::uuid;
        ban2 := (infract(ca, 'severe', tests.post(ca, t, 'Another one.'), 'or-m1') ->> 'ban')::uuid;
        insert into public.or_ids values (rd, 'ban', ban), (rd, 'ban2', ban2);
      end if;
    end $w$;
  $sql$, name, kind));
end $$;

create function pg_temp.id(rd text, k text) returns uuid language sql as $$ select id from public.or_ids where round = rd and k = $2 $$;

-- The two sessions' answers: a lost race is no failure; a deadlock or a lock timeout is.
create function pg_temp.fine(said text) returns boolean language sql as $$
  select said is null or (said !~* 'deadlock|lock timeout|could not obtain lock|canceling statement')
$$;

create function pg_temp.end_of(v uuid) returns uuid language sql as $$ select id from acts where kind = 'visit_end' and target_act_id = v $$;
create function pg_temp.outcomes(about uuid) returns bigint language sql as $$ select count(*) from outcome_posts where about_act = about $$;
create function pg_temp.mod_posts(in_thread uuid) returns bigint language sql as $$
  select count(*) from acts a where a.kind = 'post' and a.thread = in_thread and a.character in (select id from characters where staff is not null)
$$;

-- ---- A. Two staff runs writing one owed concession at once ----
do $$
declare
  rd text; v uuid; said text[]; r integer;
begin
  for r in 1..4 loop
    rd := 'a' || r;
    perform pg_temp.round(rd, 'owed');
    v := pg_temp.id(rd, 'v1');
    said := tests.race_service(format('select post_visit_concession(%L, %L)', v, 'Run one, {who}.'), format('select post_visit_concession(%L, %L)', v, 'Run two, {who}.'));
    if not pg_temp.fine(said[1]) or not pg_temp.fine(said[2]) or said[1] is not null or said[2] is not null then raise exception 'round %: a staff run failed: %', rd, said; end if;
    if pg_temp.outcomes(pg_temp.end_of(v)) is distinct from 1::bigint then raise exception 'round %: % outcome rows', rd, pg_temp.outcomes(pg_temp.end_of(v)); end if;
    if pg_temp.mod_posts(pg_temp.id(rd, 't')) is distinct from 1::bigint then raise exception 'round %: % Mod posts for one concession', rd, pg_temp.mod_posts(pg_temp.id(rd, 't')); end if;
  end loop;
end $$;

-- ---- B. A model write racing the tick's stock ----
do $$
declare
  rd text; v uuid; said text[]; r integer; src text;
begin
  for r in 1..6 loop
    rd := 'b' || r;
    perform pg_temp.round(rd, 'owed_aged');
    v := pg_temp.id(rd, 'v1');
    said := tests.race_service(format('select post_visit_concession(%L, %L)', v, 'A model line for {who}.'), 'select system_tick()');
    if said[1] is not null or said[2] is not null then raise exception 'round %: a racer failed: %', rd, said; end if;
    if pg_temp.outcomes(pg_temp.end_of(v)) is distinct from 1::bigint then raise exception 'round %: % outcome rows', rd, pg_temp.outcomes(pg_temp.end_of(v)); end if;
    if pg_temp.mod_posts(pg_temp.id(rd, 't')) is distinct from 1::bigint then raise exception 'round %: % Mod posts for one concession', rd, pg_temp.mod_posts(pg_temp.id(rd, 't')); end if;
    select source into src from outcome_posts where about_act = pg_temp.end_of(v);
    if src not in ('model', 'stock') then raise exception 'round %: the post says %', rd, src; end if;
  end loop;
end $$;

-- ---- C. Two casts at one thread's two distraction visits ----
do $$
declare
  rd text; said text[]; r integer; v uuid;
begin
  for r in 1..4 loop
    rd := 'c' || r;
    perform pg_temp.round(rd, 'cast');
    said := tests.race_service(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', pg_temp.id(rd, 'ua'), 'or-th', pg_temp.id(rd, 'ca'), pg_temp.id(rd, 't'), '{}', '', 'thread'),
                               format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', pg_temp.id(rd, 'ub'), 'or-th', pg_temp.id(rd, 'cb'), pg_temp.id(rd, 't'), '{}', '', 'thread'));
    if not pg_temp.fine(said[1]) or not pg_temp.fine(said[2]) then raise exception 'round %: a cast failed in a way that is no lost race: %', rd, said; end if;
    foreach v in array array[pg_temp.id(rd, 'v1'), pg_temp.id(rd, 'v2')] loop
      if (select count(*) from acts where kind = 'visit_end' and target_act_id = v) is distinct from 1::bigint then raise exception 'round %: visit % has not one end', rd, v; end if;
      if (select count(*) from concessions_owed where visit_act = v) is distinct from 1::bigint then raise exception 'round %: visit % owes % concessions', rd, v, (select count(*) from concessions_owed where visit_act = v); end if;
    end loop;
    if pg_temp.mod_posts(pg_temp.id(rd, 't')) is distinct from 0::bigint then raise exception 'round %: a cast posted a concession at once', rd; end if;
  end loop;
end $$;

-- ---- D. close_appeal twice on one appeal ----
do $$
declare
  rd text; said text[]; r integer; ap uuid;
begin
  for r in 1..6 loop
    rd := 'd' || r;
    perform pg_temp.round(rd, 'appeal');
    ap := pg_temp.id(rd, 'ap');
    said := tests.race_service(format('select close_appeal(%L, %L, %L, null, null)', ap, 'upheld', 'First ruling.'), format('select close_appeal(%L, %L, %L, null, null)', ap, 'upheld', 'Second ruling.'));
    if said[1] is not null or said[2] is not null then raise exception 'round %: a closer failed: %', rd, said; end if;
    if (select count(*) from acts where kind = 'appeal_ruling' and target_act_id = ap) is distinct from 1::bigint then raise exception 'round %: not one ruling', rd; end if;
    if (select count(*) from outcome_posts o where o.kind = 'ruling' and o.about_act = (select id from acts where kind = 'appeal_ruling' and target_act_id = ap)) is distinct from 1::bigint then raise exception 'round %: not one ruling post', rd; end if;
    -- The filing's own post and the ruling's: two Mod posts in the thread.
    if pg_temp.mod_posts(pg_temp.id(rd, 't')) is distinct from 2::bigint then raise exception 'round %: % Mod posts (the filing and one ruling wanted)', rd, pg_temp.mod_posts(pg_temp.id(rd, 't')); end if;
  end loop;
end $$;

-- ---- E. Two staff runs writing one ban's entry ----
do $$
declare
  rd text; said text[]; r integer; ban uuid; bt uuid;
begin
  for r in 1..4 loop
    rd := 'e' || r;
    perform pg_temp.round(rd, 'ban');
    ban := pg_temp.id(rd, 'ban');
    said := tests.race_service(format('select post_ban_entry(%L, %L, %L)', ban, 'Line one.', 'model'), format('select post_ban_entry(%L, %L, %L)', ban, 'Line two.', 'model'));
    if said[1] is not null or said[2] is not null then raise exception 'round %: a staff run failed: %', rd, said; end if;
    if pg_temp.outcomes(ban) is distinct from 1::bigint then raise exception 'round %: % entry rows', rd, pg_temp.outcomes(ban); end if;
    bt := (select s.banlist_thread from seasons s where s.ends_at is null);
    if (select count(*) from acts a where a.thread = bt and a.kind = 'post' and a.payload ->> 'body' like '%Banned: Or Author ' || rd || '%') is distinct from 1::bigint then raise exception 'round %: not one entry post', rd; end if;
  end loop;
end $$;

-- ---- F. A ban's model entry racing close_appeal's stock entry for it ----
do $$
declare
  rd text; said text[]; r integer; ban uuid; ap uuid; ruling uuid; entry uuid;
begin
  for r in 1..6 loop
    rd := 'f' || r;
    perform pg_temp.round(rd, 'banappeal');
    ban := pg_temp.id(rd, 'ban'); ap := pg_temp.id(rd, 'ap');
    said := tests.race_service(format('select post_ban_entry(%L, %L, %L)', ban, 'The model''s line.', 'model'), format('select close_appeal(%L, %L, %L, null, null)', ap, 'upheld', 'The ruling.'));
    if said[1] is not null or said[2] is not null then raise exception 'round %: a racer failed: %', rd, said; end if;
    if pg_temp.outcomes(ban) is distinct from 1::bigint then raise exception 'round %: % entry rows', rd, pg_temp.outcomes(ban); end if;
    ruling := (select id from acts where kind = 'appeal_ruling' and target_act_id = ap);
    entry := (select post_act from outcome_posts where about_act = ban);
    if entry is null then raise exception 'round %: the entry did not post', rd; end if;
    if (select target_act_id from acts a join outcome_posts o on o.post_act = a.id where o.about_act = ruling) is distinct from entry then raise exception 'round %: the ruling does not quote the entry', rd; end if;
    if (select count(*) from acts a where a.thread = (select thread from acts where id = entry) and a.kind = 'post') < 2 then raise exception 'round %: the Banlist lacks the entry and the ruling', rd; end if;
  end loop;
end $$;

-- ---- G. Two first bans of a season, in two transactions, opening one Banlist ----
do $$
declare
  rd text; said text[]; r integer; b1 uuid; b2 uuid; bt uuid; n_threads_before bigint;
begin
  for r in 1..3 loop
    rd := 'g' || r;
    perform pg_temp.round(rd, 'twobans');
    b1 := pg_temp.id(rd, 'ban'); b2 := pg_temp.id(rd, 'ban2');
    if (select s.banlist_thread from seasons s where s.ends_at is null) is not null then raise exception 'round %: the season already has a Banlist', rd; end if;
    n_threads_before := (select count(*) from threads);
    said := tests.race_service(format('select post_ban_entry(%L, %L, %L)', b1, 'First.', 'model'), format('select post_ban_entry(%L, %L, %L)', b2, 'Second.', 'model'));
    if said[1] is not null or said[2] is not null then raise exception 'round %: a staff run failed: %', rd, said; end if;
    bt := (select s.banlist_thread from seasons s where s.ends_at is null);
    if bt is null then raise exception 'round %: no Banlist was opened', rd; end if;
    if (select count(*) from threads) is distinct from n_threads_before + 1 then raise exception 'round %: % threads opened', rd, (select count(*) from threads) - n_threads_before; end if;
    if (select count(*) from acts a where a.thread = bt and a.kind = 'post') is distinct from 2::bigint then raise exception 'round %: the Banlist holds % entries', rd, (select count(*) from acts a where a.thread = bt and a.kind = 'post'); end if;
  end loop;
end $$;
