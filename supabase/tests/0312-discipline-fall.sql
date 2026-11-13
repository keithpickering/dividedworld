-- Taking the fall (supabase/migrations/0361_discipline_cards.sql, section 3; docs/plans/2026-11-11-card-notes-part-5-plan.md, Task 4; the design docs/plans/2026-11-11-card-notes-design.md, "Take the Fall").
--
-- A card with a discipline of kind `fall`, cast on another character's post, waits there; the first filing of a visit to that post lands its infraction on the character that cast it, not on the post's author.
--
-- 0. The locks (first: committed rows must not meet this file's own locks): file_visit and a fall cast both take the post's row, so a cast racing a filing either takes it or stays unspent, never both.
-- 0b. The lock order (0357's: post, then visits_open, then character): a heart cast from a post onto its author and a filing on that post meet at the post, with and without a fall on it, in both orders and at once.
-- 1. A filing with a fall: the points on the caster's bar and none on the author's; the infraction names the author's post, the visit and the play; the visit's end and the post's notice are as without a fall.
-- 2. A severe filing bans the caster, and the author is not banned; a caster banned after casting takes the points all the same.
-- 3. The first filing spends it: the second visit files on the author; a second fall on the post is refused with the stack's words; a visit talked down or trapped spends nothing; a fall cast while a visit is open takes
--    that visit's filing.
-- 4. An admin's end before the filing: the author takes the points; after the filing: the infraction stays where it landed. A caught fall is no fall.
-- 5. Appeals: the caster appeals and the author cannot; overturned frees the caster's bar; increased lands on the caster. staff_punishments counts a patrol-caused fall infraction against the caster.
-- 6. The masks: an own post and a staff post are refused; a second mask of the author's own account may take the fall and the filing goes to that mask; nothing differs with who owns the caster or the author.
-- 7. A ward on the post turns a fall away; file_visit never fails or stalls because of a fall (a taker that is staff now).
-- 8. The reads: my_falls_taken shows the author's player the row and nobody else; thread_page.spent names the play after the filing; my_infractions.fall_play names it for the caster; card_target names the author.
-- 9. infract and the guard take a fall only from the play itself.
-- The cards are this file's own (t-fall, t-fward, t-tcatch, t-vtrap), never an instance's.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- Two statements sent to two sessions in a fixed order while a third holds the post's row: each is seen waiting on it before the next is sent, then the holder lets go. Returns what each said (null for none).
create function pg_temp.ordered(on_post uuid, first_stmt text, second_stmt text) returns text[] language plpgsql as $$
declare
  url text := current_setting('kayfabb.scratch_url');
  out text[] := array[null, null]::text[]; tries integer; conn text; n integer := 0;
begin
  perform extensions.dblink_connect('df_h', url);
  perform extensions.dblink_connect('df_1', url);
  perform extensions.dblink_connect('df_2', url);
  begin
    perform extensions.dblink_exec('df_h', 'begin');
    perform extensions.dblink_exec('df_h', format('do $h$ begin perform 1 from acts where id = %L for no key update; end $h$', on_post));
    foreach conn in array array['df_1', 'df_2'] loop
      n := n + 1;
      perform extensions.dblink_exec(conn, 'set lock_timeout = ''20s''');
      perform extensions.dblink_send_query(conn, format('/* df_wait_%s */ %s', n, case when n = 1 then first_stmt else second_stmt end));
      tries := 0;
      loop
        -- The activity view is read once in a transaction unless the snapshot is cleared.
        perform pg_stat_clear_snapshot();
        exit when exists (select 1 from pg_stat_activity a where a.query like '%/* df_wait_' || n || ' */%' and a.pid <> pg_backend_pid() and a.wait_event_type = 'Lock');
        tries := tries + 1;
        if tries > 400 then raise exception 'statement % never waited on the post''s row', n; end if;
        perform pg_sleep(0.025);
      end loop;
    end loop;
    perform extensions.dblink_exec('df_h', 'commit');
  exception when others then
    perform extensions.dblink_disconnect('df_h'); perform extensions.dblink_disconnect('df_1'); perform extensions.dblink_disconnect('df_2');
    raise;
  end;
  foreach conn in array array['df_1', 'df_2'] loop
    begin
      perform * from extensions.dblink_get_result(conn) as x(r jsonb);
    exception when others then
      out[case when conn = 'df_1' then 1 else 2 end] := sqlerrm;
    end;
    begin perform * from extensions.dblink_get_result(conn) as x(r jsonb); exception when others then null; end;
  end loop;
  perform extensions.dblink_disconnect('df_h'); perform extensions.dblink_disconnect('df_1'); perform extensions.dblink_disconnect('df_2');
  return out;
end $$;

-- ---- 0. The locks and the race ----
-- A post, its open visit, an author and a taker, all committed (a second session must read them). Another session holds the post's row, as place_cast does for a cast on it: a filing and a fall cast
-- each wait on it (55P03 is the lock timeout) and change nothing; then the two race for it, eight times, and the one that goes second sees the first.
do $$
declare
  n integer; i integer; ua uuid; ut uuid; ca uuid; ct uuid; m uuid := gen_random_uuid(); t uuid := gen_random_uuid(); p uuid; v uuid;
  why text; held text; said text[]; falls integer := 0; elses integer := 0; infs integer; spent integer; bar_a integer; bar_t integer; play uuid;
begin
  perform tests.commit(format($sql$
    insert into settings (key, value) values ('warnBar', '{"size": 10, "bands": {"minor": 2, "moderate": 4, "severe": 7}, "decay": {"unit": "day", "count": 14}, "banDays": [1, 3, 7]}') on conflict (key) do nothing;
    insert into card_kinds (key, name, alignment, rarity, play, reaches, discipline) values ('t-fall', 'Test Fall', 'sweet', 'uncommon', 'cast', '{post}', '{"kind": "fall"}') on conflict (key) do nothing;
    insert into characters (id, name, staff, staff_kind, debuted_at) values (%1$L, 'Df Race Mod', 'df-race-mod', 'persona', now());
    insert into threads (id, board, title) select %2$L, b.id, 'Df race' from boards b where b.slug = 'general';
  $sql$, m, t));
  for i in 1..8 loop
    ua := gen_random_uuid(); ut := gen_random_uuid(); ca := gen_random_uuid(); ct := gen_random_uuid(); p := gen_random_uuid(); v := gen_random_uuid();
    perform tests.commit(format($sql$
      insert into auth.users (id, email) values (%1$L, 'df-race-a%8$s@test.invalid'), (%2$L, 'df-race-t%8$s@test.invalid');
      insert into accounts (id) values (%1$L), (%2$L);
      insert into wallets (account, balance) values (%1$L, 100), (%2$L, 100);
      insert into characters (id, owner, name, created_at, debuted_at) values (%3$L, %1$L, 'Df Race Author %8$s', now(), now()), (%4$L, %2$L, 'Df Race Taker %8$s', now(), now());
      insert into class_history (character, class_key, started_at) values (%3$L, 'alpha', now()), (%4$L, 'alpha', now());
      insert into card_ledger (account, card, kind, price) values (%2$L, 't-fall', 'bought', 0);
      insert into acts (id, character, kind, thread, payload) values (%5$L, %3$L, 'post', %6$L, '{"body": "A racing post."}');
      set kayfabb.staff_writer = 'on';
      insert into acts (id, character, kind, thread, target_act_id, payload) values (%7$L, %9$L, 'visit', %6$L, %5$L, jsonb_build_object(
        'charges', jsonb_build_array(jsonb_build_object('rule_number', 1, 'board', (select board from threads where id = %6$L), 'band', 'moderate', 'cause', 'patrol', 'about_act', %5$L::text)),
        'ends_at', now() - interval '1 hour', 'challenge', jsonb_build_object('kind', 'distraction'), 'line', 'Looking.'));
      reset kayfabb.staff_writer;
    $sql$, ua, ut, ca, ct, p, t, v, i, m));
    if i = 1 then
      -- The lock, deterministically. Another session holds the post's row for no key update (the lock place_cast takes); a filing and a cast wait on it and are refused by the timeout, and nothing is written.
      held := current_setting('lock_timeout');
      perform extensions.dblink_connect('df_holder', current_setting('kayfabb.scratch_url'));
      begin
        perform extensions.dblink_exec('df_holder', 'begin');
        perform extensions.dblink_exec('df_holder', format('do $h$ begin perform 1 from acts where id = %L for no key update; end $h$', p));
        perform set_config('lock_timeout', '200ms', true);
        why := pg_temp.refusal(format('select file_visit(%L, ''Filed.'')', v));
        said := array[why, pg_temp.refusal(format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', ut, 't-fall', ct, p, '{}', '', 'post'))];
        perform set_config('lock_timeout', held, true);
        perform extensions.dblink_exec('df_holder', 'rollback');
      exception when others then
        perform extensions.dblink_disconnect('df_holder');
        raise;
      end;
      perform extensions.dblink_disconnect('df_holder');
      if why is null or why not like '55P03:%' then raise exception 'a filing waits on the post''s row lock, said %', why; end if;
      if said[2] is null or said[2] not like '55P03:%' then raise exception 'a fall cast waits on the post''s row lock, said %', said[2]; end if;
      if exists (select 1 from acts where kind in ('visit_end', 'infraction') and (target_act_id = v or payload ->> 'visit_act' = v::text)) then raise exception 'a refused filing wrote something'; end if;
    end if;
    if i <= 6 then
      -- Both orders, deterministically: another session holds the post's row, the first statement is sent and seen waiting on it, then the second, and the holder lets go. The lock queue is first come, first
      -- served, so the first statement lands first and the second reads what it left. Odd: the filing first (the cast then lands on a post whose visit is over: unspent); even: the cast first (the filing takes it).
      said := pg_temp.ordered(p, case when i % 2 = 1 then format('select file_visit(%L, ''Filed.'')', v) else format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', ut, 't-fall', ct, p, '{}', '', 'post') end, case when i % 2 = 1 then format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', ut, 't-fall', ct, p, '{}', '', 'post') else format('select file_visit(%L, ''Filed.'')', v) end);
    else
      -- And two sessions at once, whichever goes first.
      said := tests.race_service(format('select file_visit(%L, ''Filed.'')', v), format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L)', ut, 't-fall', ct, p, '{}', '', 'post'));
    end if;
    if said[1] is not null or said[2] is not null then raise exception 'a fall cast racing a filing: both land, said %', said; end if;
    select count(*), count(*) filter (where payload ? 'fall_play') into infs, spent from acts where kind = 'infraction' and payload ->> 'visit_act' = v::text;
    bar_a := warn_points(ca); bar_t := warn_points(ct);
    play := (select k.id from acts k where k.kind = 'card' and k.target_act_id = p and k.character = ct);
    if infs is distinct from 1 or play is null then raise exception 'one filing, one cast: % infractions, play %', infs, play; end if;
    if i <= 6 and (spent = 1) is distinct from (i % 2 = 0) then raise exception 'race % went the wrong way for its order: % infractions name the play', i, spent; end if;
    if spent = 1 then
      falls := falls + 1;
      if bar_t is distinct from 4 or bar_a is distinct from 0 or (select payload ->> 'fall_play' from acts where kind = 'infraction' and payload ->> 'visit_act' = v::text) is distinct from play::text or (select payload ->> 'character' from acts where kind = 'infraction' and payload ->> 'visit_act' = v::text) is distinct from ct::text
        then raise exception 'the fall took the filing: taker %, author % (race %)', bar_t, bar_a, i; end if;
    else
      elses := elses + 1;
      if bar_a is distinct from 4 or bar_t is distinct from 0 or exists (select 1 from acts i where i.kind = 'infraction' and i.payload ->> 'fall_play' = play::text) then
        raise exception 'the filing went first, so the fall stays unspent and lands nowhere: author %, taker % (race %)', bar_a, bar_t, i;
      end if;
    end if;
  end loop;
  raise notice 'the eight races: % went to the fall and % to the author', falls, elses;
end $$;

-- ---- 0b. The lock order a heart keeps against a filing ----
-- A heart is a card at character reach played from a post: place_cast takes that post `for share`, then the target character's row `for no key update`, and reads the bar. A visit's filing takes the post's row
-- (`for no key update`), then visits_open, then in infract the character the infraction lands on (the post's author, or the taker of a fall on the post). So a heart cast from post P onto P's author T and a filing
-- of a visit on P meet at P first: whichever holds P goes on, the other waits on P and holds nothing, and both finish. Were the heart to take T before P, a filing holding P and waiting on T and a heart holding T
-- and waiting on P would be a deadlock, which this section was driven red with (a scratch copy of place_cast with the two locks swapped: the filing-first race below failed with 40P01).
--
-- Each race: another session holds P's row (as place_cast holds it for a cast on P), the first statement is sent and seen waiting on a lock, then the second, and the holder lets go; the lock queue is first come,
-- first served. Both orders, without a fall on P (the filing lands on T, the heart's own target) and with one (the filing lands on the taker), and then the two at once. Nothing may fail, and the bars add up.
-- The rows are committed (a second session must read them), so this section runs before the world below, and makes its own cards (t-lo-...), never an instance's.

-- Two statements sent to two sessions in a fixed order while a third holds the post's row: each is seen waiting on a lock before the next is sent, then the holder lets go. Returns what each said (null for none).
create function pg_temp.ordered_lo(on_post uuid, first_stmt text, second_stmt text) returns text[] language plpgsql as $$
declare
  url text := current_setting('kayfabb.scratch_url');
  out text[] := array[null, null]::text[]; tries integer; conn text; n integer := 0;
begin
  perform extensions.dblink_connect('lo_h', url);
  perform extensions.dblink_connect('lo_1', url);
  perform extensions.dblink_connect('lo_2', url);
  begin
    perform extensions.dblink_exec('lo_h', 'begin');
    perform extensions.dblink_exec('lo_h', format('do $h$ begin perform 1 from acts where id = %L for no key update; end $h$', on_post));
    foreach conn in array array['lo_1', 'lo_2'] loop
      n := n + 1;
      perform extensions.dblink_exec(conn, 'set lock_timeout = ''20s''');
      perform extensions.dblink_send_query(conn, format('/* lo_wait_%s */ %s', n, case when n = 1 then first_stmt else second_stmt end));
      tries := 0;
      loop
        -- The activity view is read once in a transaction unless the snapshot is cleared.
        perform pg_stat_clear_snapshot();
        exit when exists (select 1 from pg_stat_activity a where a.query like '%/* lo_wait_' || n || ' */%' and a.pid <> pg_backend_pid() and a.wait_event_type = 'Lock');
        tries := tries + 1;
        if tries > 400 then raise exception 'statement % never waited on a lock', n; end if;
        perform pg_sleep(0.025);
      end loop;
    end loop;
    perform extensions.dblink_exec('lo_h', 'commit');
  exception when others then
    perform extensions.dblink_disconnect('lo_h'); perform extensions.dblink_disconnect('lo_1'); perform extensions.dblink_disconnect('lo_2');
    raise;
  end;
  foreach conn in array array['lo_1', 'lo_2'] loop
    begin
      perform * from extensions.dblink_get_result(conn) as x(r jsonb);
    exception when others then
      out[case when conn = 'lo_1' then 1 else 2 end] := sqlstate || ' ' || sqlerrm;
    end;
    begin perform * from extensions.dblink_get_result(conn) as x(r jsonb); exception when others then null; end;
  end loop;
  perform extensions.dblink_disconnect('lo_h'); perform extensions.dblink_disconnect('lo_1'); perform extensions.dblink_disconnect('lo_2');
  return out;
end $$;

do $$
declare
  m uuid := gen_random_uuid(); t uuid := gen_random_uuid();
  i integer; with_fall boolean; heart_first boolean; label text;
  ua uuid; uc uuid; ux uuid; author uuid; healer uuid; taker uuid; p uuid; old uuid; v uuid;
  heart text; filing text; said text[]; bar_a integer; bar_x integer; infs integer; spent integer;
begin
  perform tests.commit(format($sql$
    insert into settings (key, value) values ('warnBar', '{"size": 10, "bands": {"minor": 2, "moderate": 4, "severe": 7}, "decay": {"unit": "day", "count": 14}, "banDays": [1, 3, 7]}') on conflict (key) do nothing;
    insert into card_kinds (key, name, alignment, rarity, play, reaches, discipline) values
      ('t-lo-heart', 'Test Lock Heart', 'sweet', 'uncommon', 'cast', '{character}', '{"kind": "relief", "points": "lightestBand"}'),
      ('t-lo-fall', 'Test Lock Fall', 'sweet', 'uncommon', 'cast', '{post}', '{"kind": "fall"}')
      on conflict (key) do nothing;
    insert into characters (id, name, staff, staff_kind, debuted_at) values (%1$L, 'Lo Race Mod', 'lo-race-mod', 'persona', now());
    insert into threads (id, board, title) select %2$L, b.id, 'Lo race' from boards b where b.slug = 'general';
  $sql$, m, t));
  -- 1..4: the four ordered races (filing first or heart first, with or without a fall); 5..6: the two at once, with and without a fall.
  for i in 1..6 loop
    with_fall := i in (2, 4, 6);
    heart_first := i in (3, 4);
    label := format('race %s (%s, %s)', i, case when i >= 5 then 'at once' when heart_first then 'heart first' else 'filing first' end, case when with_fall then 'a fall on the post' else 'no fall' end);
    ua := gen_random_uuid(); uc := gen_random_uuid(); ux := gen_random_uuid(); author := gen_random_uuid(); healer := gen_random_uuid(); taker := gen_random_uuid();
    p := gen_random_uuid(); old := gen_random_uuid(); v := gen_random_uuid();
    -- The author T has 4 points from an older post, so a heart has something to take (the lightest band, 2). P is T's post, with a visit on it that is due to file (a moderate charge, 4).
    perform tests.commit(format($sql$
      insert into auth.users (id, email) values (%1$L, 'lo-a%10$s@test.invalid'), (%2$L, 'lo-c%10$s@test.invalid'), (%3$L, 'lo-x%10$s@test.invalid');
      insert into accounts (id) values (%1$L), (%2$L), (%3$L);
      insert into wallets (account, balance) values (%1$L, 100), (%2$L, 100), (%3$L, 100);
      insert into characters (id, owner, name, created_at, debuted_at) values (%4$L, %1$L, 'Lo Author %10$s', now(), now()), (%5$L, %2$L, 'Lo Healer %10$s', now(), now()), (%6$L, %3$L, 'Lo Taker %10$s', now(), now());
      insert into class_history (character, class_key, started_at) values (%4$L, 'alpha', now()), (%5$L, 'alpha', now()), (%6$L, 'alpha', now());
      insert into card_ledger (account, card, kind, price) values (%2$L, 't-lo-heart', 'bought', 0), (%3$L, 't-lo-fall', 'bought', 0);
      insert into acts (id, character, kind, thread, payload) values (%8$L, %4$L, 'post', %7$L, '{"body": "An older post."}'), (%9$L, %4$L, 'post', %7$L, '{"body": "A racing post."}');
      do $d$ begin perform infract(%4$L, 'moderate', %8$L, 'lo-race-mod'); end $d$;
      set kayfabb.staff_writer = 'on';
      insert into acts (id, character, kind, thread, target_act_id, payload) values (%11$L, %12$L, 'visit', %7$L, %9$L, jsonb_build_object(
        'charges', jsonb_build_array(jsonb_build_object('rule_number', 1, 'board', (select board from threads where id = %7$L), 'band', 'moderate', 'cause', 'patrol', 'about_act', %9$L::text)),
        'ends_at', now() - interval '1 hour', 'challenge', jsonb_build_object('kind', 'distraction'), 'line', 'Looking.'));
      reset kayfabb.staff_writer;
    $sql$, ua, uc, ux, author, healer, taker, t, old, p, i, v, m));
    if with_fall then
      perform tests.commit(format($sql$ do $d$ begin perform play_card(%L, 't-lo-fall', %L, %L, '{}', 0, '', 'post'); end $d$ $sql$, ux, taker, p));
    end if;
    if warn_points(author) is distinct from 4 then raise exception '%: the author starts at 4, not %', label, warn_points(author); end if;
    heart := format('select play_card(%L, %L, %L, %L, %L, 0, %L, %L, %L)', uc, 't-lo-heart', healer, author, '{}', '', 'character', p);
    filing := format('select file_visit(%L, ''Filed.'')', v);
    if i <= 4 then
      said := pg_temp.ordered_lo(p, case when heart_first then heart else filing end, case when heart_first then filing else heart end);
    else
      said := tests.race_service(heart, filing);
    end if;
    if said[1] is not null or said[2] is not null then raise exception '%: a heart cast from the post onto its author and a filing on the post must both finish, said %', label, said; end if;
    select count(*), count(*) filter (where payload ? 'fall_play') into infs, spent from acts where kind = 'infraction' and payload ->> 'visit_act' = v::text;
    if infs is distinct from 1 then raise exception '%: the visit filed once, not % times', label, infs; end if;
    if (select count(*) from acts k where k.kind = 'card' and k.character = healer and k.payload ->> 'card' = 't-lo-heart') is distinct from 1 then raise exception '%: the heart landed once', label; end if;
    bar_a := warn_points(author); bar_x := warn_points(taker);
    -- Whichever went first, the bars add up: the heart takes 2 off the author's oldest points; the filing's 4 land on the author, or on the taker where a fall was on the post.
    if with_fall then
      if spent is distinct from 1 or bar_a is distinct from 2 or bar_x is distinct from 4 then raise exception '%: author % (2), taker % (4), fall spent %', label, bar_a, bar_x, spent; end if;
    else
      if spent is distinct from 0 or bar_a is distinct from 6 or bar_x is distinct from 0 then raise exception '%: author % (6), taker % (0)', label, bar_a, bar_x; end if;
    end if;
  end loop;
end $$;

-- ---- The world: a Boss, a Mod on staff, the settings, players ----
do $$
declare
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'warnBar', jsonb_build_object('size', 10, 'bands', jsonb_build_object('minor', 2, 'moderate', 4, 'severe', 7), 'decay', jsonb_build_object('unit', 'day', 'count', 14), 'banDays', jsonb_build_array(1, 3, 7)),
      'modBots', jsonb_build_object('allowanceMost', 3, 'ruleDaysMost', 7, 'visitHours', jsonb_build_object('least', 3, 'most', 5), 'patrolsPerDay', 6, 'patrolSample', 5, 'patrolPool', 20,
        'reportPrice', 25, 'reportsPerDay', 3, 'judgmentsPerDay', 60, 'filingLinesPerDay', 60, 'appealPrice', 50, 'tailHours', 24,
        'cap', jsonb_build_object('punishments', 50, 'days', 7), 'filingCron', '*/5 * * * *', 'filingGraceMinutes', 10),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'ruleSet', jsonb_build_array('On {board}: {rule}.'),
        'visitArrived', jsonb_build_array('{mod} is looking at this post under {rule}.'),
        'visitFiled', jsonb_build_array('{mod} filed this post under {rule}.'),
        'appealUpheld', jsonb_build_array('{mod} turns {appellant} down.')),
      'systemMoveWords', jsonb_build_object('setRule', 'a rule')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'df-boss',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'df-boss', 'name', 'Fall Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'df-m1', 'name', 'Fall Mod One', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb,
          'visitHours', jsonb_build_object('least', 3, 'most', 5), 'challenge', jsonb_build_object('kind', 'bribe', 'price', 50))),
      'firstStaff', jsonb_build_array('df-m1'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'setRule', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
  perform seed_instance(seed);
  insert into card_kinds (key, name, alignment, rarity, play, reaches, discipline) values ('t-fall', 'Test Fall', 'sweet', 'uncommon', 'cast', '{post}', '{"kind": "fall"}') on conflict (key) do nothing;
  -- A ward on a post that turns cards up to uncommon away (as Force Field does), a back that catches a Test Fall, and a back that springs on a visit.
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, gimmick) values ('t-fward', 'Test Field', 'sweet', 'uncommon', 'use', '{post}', interval '7 days', '{"kind": "ward", "upTo": "uncommon"}') on conflict (key) do nothing;
  insert into card_kinds (key, name, alignment, rarity, play, trap) values ('t-tcatch', 'Test Catcher', 'salty', 'rare', 'set', '{"trigger": {"on": "cast"}}'), ('t-vtrap', 'Test Visit Trap', 'salty', 'uncommon', 'set', '{"trigger": {"on": "visit"}}') on conflict (key) do nothing;
end $$;

create function pg_temp.owner(c uuid) returns uuid language sql as $$ select owner from characters where id = c $$;

create function pg_temp.player(label text, cash integer default 500) returns uuid language plpgsql as $$
declare a uuid := tests.account('df-' || label);
begin
  insert into wallets (account, balance) values (a, cash) on conflict (account) do update set balance = excluded.balance;
  return tests.character(a, 'Df ' || label);
end $$;

-- A second mask of the same player's account.
create function pg_temp.mask(c uuid, label text) returns uuid language sql as $$ select tests.character(pg_temp.owner(c), 'Df ' || label) $$;

create function pg_temp.wallet(c uuid) returns integer language sql as $$ select coalesce((select w.balance from wallets w where w.account = pg_temp.owner(c)), 0) $$;

create function pg_temp.say(by_character uuid, in_thread uuid, body text) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become(pg_temp.owner(by_character));
  made := post(in_thread, by_character, body);
  perform tests.unbecome();
  return (made ->> 'id')::uuid;
end $$;

create function pg_temp.hand(c uuid, card text, n integer default 1) returns void language sql as $$
  insert into card_ledger (account, card, kind, price) select pg_temp.owner(c), card, 'bought', 0 from generate_series(1, n)
$$;

-- A fall: the caster's player plays Test Fall through the caster on the post, paying `price`.
create function pg_temp.fall(caster uuid, on_post uuid, price integer default 0) returns jsonb language sql as $$
  select play_card(pg_temp.owner(caster), 't-fall', caster, on_post, '{}', price, '', 'post')
$$;

-- A visit of the Mod's on the post (a charge of its own each time, so a second visit is not a repeat of the first).
create function pg_temp.visit(on_post uuid, band text default 'moderate', cause text default 'patrol') returns uuid language plpgsql as $$
declare r jsonb;
begin
  r := start_visit(on_post, 'df-m1', jsonb_build_object('rule_number', null, 'band', band, 'cause', cause, 'rule', 'Rule ' || gen_random_uuid()));
  if r ->> 'visit' is null then raise exception 'no visit started: %', r; end if;
  return (r ->> 'visit')::uuid;
end $$;

create function pg_temp.bar(c uuid) returns integer language sql as $$ select warn_points(c) $$;

create function pg_temp.fall_of(on_post uuid) returns uuid language sql as $$
  select k.id from acts k where k.kind = 'card' and k.target_act_id = on_post and k.payload ->> 'card' = 't-fall' order by k.created_at, k.id limit 1
$$;

-- The infraction a visit filed.
create function pg_temp.filed(v uuid) returns acts language sql as $$ select a from acts a where a.kind = 'infraction' and a.payload ->> 'visit_act' = v::text order by a.created_at limit 1 $$;

-- ---- 1. A filing with a fall: the points land on the caster ----
do $$
declare
  t uuid := tests.thread('Df fall');
  author uuid := pg_temp.player('f1-author'); taker uuid := pg_temp.player('f1-taker'); stranger uuid := pg_temp.player('f1-stranger');
  p uuid := pg_temp.say(author, t, 'A post that breaks a rule.');
  control uuid := pg_temp.say(author, t, 'A post that breaks another rule.');
  v uuid; vc uuid; play uuid; w0 integer; filed jsonb; inf acts; end_fall acts; end_ctl acts; row jsonb; page jsonb;
begin
  perform pg_temp.hand(taker, 't-fall', 3);
  w0 := pg_temp.wallet(taker);
  play := (pg_temp.fall(taker, p, 50) ->> 'id')::uuid;
  if pg_temp.wallet(taker) is distinct from w0 - 50 or card_held(pg_temp.owner(taker), 't-fall') is distinct from 2 then raise exception 'a fall is paid for as any play is'; end if;
  if exists (select 1 from acts a where a.id = play and (a.payload ? 'ends' or a.payload ? 'instant')) then raise exception 'a fall carries no time up and is not instant: %', (select payload from acts where id = play); end if;
  v := pg_temp.visit(p);
  vc := pg_temp.visit(control);
  filed := file_visit(v, 'Filed.');
  perform file_visit(vc, 'Filed.');
  if (filed ->> 'filed')::boolean is distinct from true then raise exception 'the visit filed: %', filed; end if;
  if pg_temp.bar(taker) is distinct from 4 or pg_temp.bar(author) is distinct from 4 then
    -- The author's 4 is the control post's (no fall on it); the post under the fall is the taker's.
    raise exception 'the fall is on the taker (4) and the control on the author (4): taker %, author %', pg_temp.bar(taker), pg_temp.bar(author);
  end if;
  inf := pg_temp.filed(v);
  if inf.payload ->> 'character' is distinct from taker::text or inf.payload ->> 'about_act' is distinct from p::text or inf.payload ->> 'visit_act' is distinct from v::text or inf.payload ->> 'fall_play' is distinct from play::text
     or inf.payload ->> 'band' is distinct from 'moderate' or (inf.payload ->> 'points')::integer is distinct from 4 or inf.thread is distinct from t then
    raise exception 'the infraction names the post, the visit and the play, and is the taker''s: %', inf.payload;
  end if;
  if exists (select 1 from acts i where i.kind = 'infraction' and i.payload ->> 'character' = author::text and i.payload ->> 'about_act' = p::text) then raise exception 'the author has no infraction for the post the fall covers'; end if;
  -- The post's visit_end and notice are as without a fall: the same outcome, the same keys, the same line.
  select * into end_fall from acts e where e.kind = 'visit_end' and e.target_act_id = v;
  select * into end_ctl from acts e where e.kind = 'visit_end' and e.target_act_id = vc;
  if end_fall.payload ->> 'outcome' is distinct from 'filed' or end_fall.payload ->> 'line' is distinct from end_ctl.payload ->> 'line'
     or (select array_agg(k order by k) from jsonb_object_keys(end_fall.payload) k) is distinct from (select array_agg(k order by k) from jsonb_object_keys(end_ctl.payload) k) or end_fall.thread is distinct from end_ctl.thread then
    raise exception 'a visit''s end is as without a fall: %, %', end_fall.payload, end_ctl.payload;
  end if;
  -- file_visit twice files once.
  filed := file_visit(v, 'Filed again.');
  if (filed ->> 'filed')::boolean is not false or (select count(*) from acts i where i.kind = 'infraction' and i.payload ->> 'visit_act' = v::text) is distinct from 1::bigint or pg_temp.bar(taker) is distinct from 4 then
    raise exception 'file_visit twice files once: %, taker %', filed, pg_temp.bar(taker);
  end if;

  -- The caster's own reads: my_infractions names the play (Task 3 left it untested), the bar is the caster's.
  perform tests.become(pg_temp.owner(taker));
  select to_jsonb(i) into row from my_infractions i where i.infraction = inf.id;
  if row ->> 'fall_play' is distinct from play::text or row ->> 'character' is distinct from taker::text or row ->> 'post' is distinct from p::text then raise exception 'my_infractions names the play for the taker: %', row; end if;
  if exists (select 1 from my_falls_taken) then raise exception 'the taker is shown no fall of its own: it took it'; end if;
  perform tests.unbecome();
  -- The author's player is told: one row, the taker named by its public name; no one else sees it.
  perform tests.become(pg_temp.owner(author));
  select to_jsonb(f) into row from my_falls_taken f where f.infraction = inf.id;
  if row is null or row ->> 'character' is distinct from author::text or row ->> 'taker_name' is distinct from 'Df f1-taker' or row ->> 'post' is distinct from p::text or (row ->> 'points')::integer is distinct from 4
     or row ->> 'thread' is distinct from t::text or row ->> 'mod_name' is distinct from 'Fall Mod One' or row ->> 'rule' is null or (row ->> 'post_seq')::integer is distinct from (select seq from acts where id = p) or row ->> 'at' is null then
    raise exception 'my_falls_taken shows the author''s player the row: %', row;
  end if;
  if (select count(*) from my_falls_taken) is distinct from 1::bigint then raise exception 'one fall taken for the author'; end if;
  if exists (select 1 from my_infractions i where i.infraction = inf.id) then raise exception 'the author''s infractions hold none of the taker''s'; end if;
  page := log_page(null);
  if jsonb_array_length(page -> 'sources' -> 'falls') is distinct from 1 or page -> 'sources' -> 'falls' -> 0 ->> 'infraction' is distinct from inf.id::text or page -> 'sources' -> 'falls' -> 0 ->> 'taker_name' is distinct from 'Df f1-taker' then
    raise exception 'log_page carries the fall for the author: %', page -> 'sources' -> 'falls';
  end if;
  perform tests.unbecome();
  foreach row in array array[to_jsonb(taker), to_jsonb(stranger)] loop
    perform tests.become(pg_temp.owner((row #>> '{}')::uuid));
    page := log_page(null);
    if exists (select 1 from my_falls_taken) or jsonb_array_length(page -> 'sources' -> 'falls') <> 0 then raise exception 'a fall is shown to the author''s player alone: %', page -> 'sources' -> 'falls'; end if;
    perform tests.unbecome();
  end loop;

  -- card_target names the post's author, a public fact the engine compares the caster with (a character, never an account).
  if (card_target(p) ->> 'author') is distinct from author::text then raise exception 'card_target names the author: %', card_target(p); end if;

  -- thread_page.spent names the play now that a filing took it, and not before (the control post's none).
  perform tests.become(pg_temp.owner(stranger));
  page := thread_page(t, 1, null, 50, array['t-fall']);
  if (page -> 'spent') is distinct from jsonb_build_array(play) then raise exception 'thread_page.spent names the spent play: %', page -> 'spent'; end if;
  perform tests.unbecome();
end $$;

-- ---- 2. A severe filing bans the caster and not the author; a banned caster still takes the points ----
do $$
declare
  t uuid := tests.thread('Df ban');
  author uuid := pg_temp.player('f2-author'); taker uuid := pg_temp.player('f2-taker');
  p1 uuid := pg_temp.say(author, t, 'First.'); p2 uuid := pg_temp.say(author, t, 'Second.');
  mine uuid := pg_temp.say(taker, t, 'The taker''s own post.');
  v uuid; hit jsonb; ban uuid;
begin
  perform pg_temp.hand(taker, 't-fall', 2);
  -- The taker holds 4 from its own post (moderate); both falls are cast before any ban, since a banned character plays nothing.
  perform infract(taker, 'moderate', mine, 'df-m1');
  perform pg_temp.fall(taker, p1); perform pg_temp.fall(taker, p2);
  -- A severe fall on top fills the bar.
  v := pg_temp.visit(p1, 'severe');
  hit := file_visit(v, 'Filed.');
  if hit -> 'ban' is null or hit ->> 'ban' = '' or pg_temp.bar(taker) is distinct from 0 or banned_until(taker) is null then raise exception 'a severe fall bans the taker: %', hit; end if;
  if banned_until(author) is not null or pg_temp.bar(author) is distinct from 0 or exists (select 1 from acts b where b.kind = 'ban' and b.payload ->> 'character' = author::text) then raise exception 'the author is not banned and has no points'; end if;
  ban := (hit ->> 'ban')::uuid;
  if (select b.payload ->> 'character' from acts b where b.id = ban) is distinct from taker::text then raise exception 'the ban is the taker''s'; end if;
  -- The taker is banned now, and takes the second fall's points all the same: infract refuses no banned character, and neither does the fall.
  v := pg_temp.visit(p2, 'minor');
  hit := file_visit(v, 'Filed.');
  if (pg_temp.filed(v)).payload ->> 'character' is distinct from taker::text or pg_temp.bar(taker) is distinct from 2 or pg_temp.bar(author) is distinct from 0 or banned_until(taker) is null then
    raise exception 'a banned taker still takes the points: bar %, author %', pg_temp.bar(taker), pg_temp.bar(author);
  end if;
end $$;

-- ---- 3. Spent once; a visit talked down or trapped spends nothing; a fall cast while a visit is open takes that filing ----
do $$
declare
  t uuid := tests.thread('Df spent');
  author uuid := pg_temp.player('f3-author'); taker uuid := pg_temp.player('f3-taker'); other uuid := pg_temp.player('f3-other');
  p uuid := pg_temp.say(author, t, 'A post.');
  q uuid := pg_temp.say(author, t, 'A post that is visited, then not.');
  r uuid := pg_temp.say(author, t, 'A post with a back on it.');
  s uuid := pg_temp.say(author, t, 'A post visited before it is covered.');
  v uuid; v2 uuid; play uuid; said text; w0 integer; n0 bigint;
begin
  perform pg_temp.hand(taker, 't-fall', 6); perform pg_temp.hand(other, 't-fall', 2);
  play := (pg_temp.fall(taker, p) ->> 'id')::uuid;
  -- The first filing spends it; the second visit to the same post files on the author.
  v := pg_temp.visit(p, 'minor'); perform file_visit(v, 'Filed.');
  v2 := pg_temp.visit(p, 'moderate'); perform file_visit(v2, 'Filed.');
  if (pg_temp.filed(v)).payload ->> 'character' is distinct from taker::text or (pg_temp.filed(v2)).payload ->> 'character' is distinct from author::text or (pg_temp.filed(v2)).payload ? 'fall_play'
     or pg_temp.bar(taker) is distinct from 2 or pg_temp.bar(author) is distinct from 4 then raise exception 'the first filing took the fall, the second is the author''s: taker %, author %', pg_temp.bar(taker), pg_temp.bar(author); end if;
  -- A second fall on the post (spent or not) is refused with the stack's words, and nothing is spent.
  w0 := pg_temp.wallet(other);
  said := pg_temp.refusal(format('select pg_temp.fall(%L, %L, 50)', other, p));
  if said is distinct from '23505: this post already carries that card' then raise exception 'a second fall is refused with the stack''s words, said %', said; end if;
  if pg_temp.wallet(other) is distinct from w0 or card_held(pg_temp.owner(other), 't-fall') is distinct from 2 then raise exception 'a refused fall spent something'; end if;

  -- A visit that is talked down spends nothing: the next filing on the post lands on the caster.
  play := (pg_temp.fall(taker, q) ->> 'id')::uuid;
  v := pg_temp.visit(q, 'minor');
  perform end_visit(v, 'intercepted', null, 'Talked down.');
  if exists (select 1 from acts i where i.kind = 'infraction' and i.payload ->> 'fall_play' = play::text) then raise exception 'a visit talked down spends nothing'; end if;
  v2 := pg_temp.visit(q, 'minor');
  perform file_visit(v2, 'Filed.');
  if (pg_temp.filed(v2)).payload ->> 'character' is distinct from taker::text or (pg_temp.filed(v2)).payload ->> 'fall_play' is distinct from play::text then raise exception 'the filing after a talk-down lands on the caster'; end if;

  -- A visit trapped as it begins spends nothing, either (a back set on a post that springs on a visit).
  perform pg_temp.hand(author, 't-vtrap', 1);
  perform set_card(pg_temp.owner(author), 't-vtrap', author, r, '{}', 0);
  play := (pg_temp.fall(taker, r) ->> 'id')::uuid;
  v := pg_temp.visit(r, 'minor');
  if not exists (select 1 from acts e where e.kind = 'visit_end' and e.target_act_id = v and e.payload ->> 'outcome' = 'trapped') then raise exception 'the visit was trapped as it began'; end if;
  if exists (select 1 from acts i where i.kind = 'infraction' and i.payload ->> 'fall_play' = play::text) then raise exception 'a visit trapped spends nothing'; end if;
  v2 := pg_temp.visit(r, 'minor');
  perform file_visit(v2, 'Filed.');
  if (pg_temp.filed(v2)).payload ->> 'fall_play' is distinct from play::text then raise exception 'the filing after a trap lands on the caster'; end if;

  -- Cast while a visit is open: it takes that visit's filing.
  v := pg_temp.visit(s, 'minor');
  play := (pg_temp.fall(taker, s) ->> 'id')::uuid;
  perform file_visit(v, 'Filed.');
  if (pg_temp.filed(v)).payload ->> 'fall_play' is distinct from play::text or (pg_temp.filed(v)).payload ->> 'character' is distinct from taker::text then raise exception 'a fall cast while a visit is open takes its filing'; end if;
end $$;

-- ---- 4. An admin's end, before and after the filing; a caught fall is no fall ----
do $$
declare
  t uuid := tests.thread('Df end');
  admin_acc uuid := tests.account('df-admin');
  author uuid := pg_temp.player('f4-author'); taker uuid := pg_temp.player('f4-taker');
  p uuid := pg_temp.say(author, t, 'Before.'); q uuid := pg_temp.say(author, t, 'After.'); c uuid := pg_temp.say(author, t, 'Under a catcher.');
  play uuid; v uuid; before_bar integer; sprung jsonb; cst jsonb;
begin
  insert into admins (account) values (admin_acc);
  perform pg_temp.hand(taker, 't-fall', 4);
  -- Ended before the filing: the author takes the points.
  play := (pg_temp.fall(taker, p) ->> 'id')::uuid;
  perform tests.become(admin_acc); perform reverse_card(play); perform tests.unbecome();
  v := pg_temp.visit(p, 'moderate'); perform file_visit(v, 'Filed.');
  if (pg_temp.filed(v)).payload ->> 'character' is distinct from author::text or (pg_temp.filed(v)).payload ? 'fall_play' or pg_temp.bar(taker) is distinct from 0 or pg_temp.bar(author) is distinct from 4 then raise exception 'an ended fall is no fall: the author takes the points'; end if;
  -- Ended after the filing: the infraction stays where it landed (an Act is never moved), and the bar is the taker's still.
  play := (pg_temp.fall(taker, q) ->> 'id')::uuid;
  v := pg_temp.visit(q, 'minor'); perform file_visit(v, 'Filed.');
  before_bar := pg_temp.bar(taker);
  perform tests.become(admin_acc); perform reverse_card(play); perform tests.unbecome();
  if (pg_temp.filed(v)).payload ->> 'character' is distinct from taker::text or pg_temp.bar(taker) is distinct from before_bar or before_bar is distinct from 2 then raise exception 'an admin''s end after the filing leaves the infraction on the caster: %', pg_temp.bar(taker); end if;
  -- A fall that a back caught is no fall: it is written `caught`, holds no place, and the filing lands on the author.
  perform pg_temp.hand(author, 't-tcatch', 1);
  perform set_card(pg_temp.owner(author), 't-tcatch', author, c, '{"card": "t-fall"}', 0, 't-fall');
  cst := pg_temp.fall(taker, c);
  if cst -> 'sprung' is null or not (cst -> 'payload' ? 'caught') then raise exception 'the back caught the fall: %', cst; end if;
  v := pg_temp.visit(c, 'minor'); perform file_visit(v, 'Filed.');
  if (pg_temp.filed(v)).payload ->> 'character' is distinct from author::text or (pg_temp.filed(v)).payload ? 'fall_play' then raise exception 'a caught fall is no fall: %', (pg_temp.filed(v)).payload; end if;
end $$;

-- ---- 5. Appeals: the caster's, never the author's; overturned frees the caster's bar; increased lands on the caster; the targeting cap counts the caster ----
do $$
declare
  t uuid := tests.thread('Df appeals');
  author uuid := pg_temp.player('f5-author'); taker uuid := pg_temp.player('f5-taker');
  p uuid := pg_temp.say(author, t, 'One.'); q uuid := pg_temp.say(author, t, 'Two.'); r uuid := pg_temp.say(author, t, 'Three.');
  v uuid; inf1 acts; inf2 acts; inf3 acts; ap jsonb; closed jsonb; play uuid; said text; before_n bigint;
begin
  perform pg_temp.hand(taker, 't-fall', 3);
  perform pg_temp.fall(taker, p); perform pg_temp.fall(taker, q); perform pg_temp.fall(taker, r);
  v := pg_temp.visit(p, 'moderate'); perform file_visit(v, 'Filed.'); inf1 := pg_temp.filed(v);
  v := pg_temp.visit(q, 'minor'); perform file_visit(v, 'Filed.'); inf2 := pg_temp.filed(v);
  v := pg_temp.visit(r, 'minor'); perform file_visit(v, 'Filed.'); inf3 := pg_temp.filed(v);
  if pg_temp.bar(taker) is distinct from 8 then raise exception 'three falls: 4 + 2 + 2, got %', pg_temp.bar(taker); end if;
  -- The caster appeals; the author, asking through its own character, is told it is no punishment of theirs.
  perform tests.become(pg_temp.owner(author));
  said := pg_temp.refusal(format('select open_appeal(%L, %L, %L)', author, inf1.id, 'It was my post.'));
  perform tests.unbecome();
  if said is distinct from '42501: that is not a punishment of this character' and said is distinct from 'P0002: that is not a punishment of this character' then raise exception 'the author cannot appeal the caster''s infraction, said %', said; end if;
  perform tests.become(pg_temp.owner(taker));
  ap := open_appeal(taker, inf1.id, 'I took it.');
  perform tests.unbecome();
  if ap ->> 'appeal' is null then raise exception 'the caster appeals: %', ap; end if;
  -- Overturned takes the infraction's points off the caster's bar.
  before_n := pg_temp.bar(taker);
  closed := close_appeal((ap ->> 'appeal')::uuid, 'overturned');
  if pg_temp.bar(taker) is distinct from before_n - 4 or pg_temp.bar(author) is distinct from 0 then raise exception 'overturned frees the caster''s bar: before %, now %', before_n, pg_temp.bar(taker); end if;
  -- Increased files one more of the same band on the caster, for the same post, naming the same play.
  perform tests.become(pg_temp.owner(taker));
  ap := open_appeal(taker, inf3.id, 'Please.');
  perform tests.unbecome();
  before_n := pg_temp.bar(taker);
  closed := close_appeal((ap ->> 'appeal')::uuid, 'increased');
  if closed ->> 'infraction' is null then raise exception 'increased filed one more: %', closed; end if;
  if (select a.payload ->> 'character' from acts a where a.id = (closed ->> 'infraction')::uuid) is distinct from taker::text
     or (select a.payload ->> 'fall_play' from acts a where a.id = (closed ->> 'infraction')::uuid) is distinct from inf3.payload ->> 'fall_play'
     or (select a.payload ->> 'about_act' from acts a where a.id = (closed ->> 'infraction')::uuid) is distinct from r::text
     or pg_temp.bar(author) is distinct from 0 then
    raise exception 'increased lands on the caster, for the same post and play: %', (select payload from acts a where a.id = (closed ->> 'infraction')::uuid);
  end if;
  -- staff_punishments (the targeting cap) counts a patrol-caused fall infraction against the caster, and none against the author whose post it was.
  if staff_punishments(taker, 7) < 3 or staff_punishments(author, 7) is distinct from 0 then raise exception 'the cap counts the caster: taker %, author %', staff_punishments(taker, 7), staff_punishments(author, 7); end if;
end $$;

-- ---- 6. The masks ----
do $$
declare
  t uuid := tests.thread('Df masks');
  ann uuid := tests.account('df-ann'); bob uuid := tests.account('df-bob');
  a1 uuid; a2 uuid; b1 uuid;
  pa1 uuid; pa1b uuid; pb1 uuid; pstaff uuid; bot uuid := (select id from characters where staff = 'df-m1');
  said_own text; said_staff text; said_other text; play uuid; v uuid; w0 integer; row jsonb;
begin
  insert into wallets (account, balance) values (ann, 500), (bob, 500) on conflict (account) do update set balance = excluded.balance;
  a1 := tests.character(ann, 'Df Ann One'); a2 := tests.character(ann, 'Df Ann Two'); b1 := tests.character(bob, 'Df Bob One');
  pa1 := pg_temp.say(a1, t, 'Ann one speaks.'); pa1b := pg_temp.say(a1, t, 'Ann one speaks again.'); pb1 := pg_temp.say(b1, t, 'Bob speaks.');
  perform set_config('kayfabb.staff_writer', 'on', true);
  pstaff := tests.post(bot, t, 'Behave.');
  perform set_config('kayfabb.staff_writer', '', true);
  perform pg_temp.hand(a1, 't-fall', 2); perform pg_temp.hand(a2, 't-fall', 2); perform pg_temp.hand(b1, 't-fall', 1);
  -- Your own post is refused; a staff character's post is refused; each before anything is spent, and in the same words whoever asks.
  w0 := pg_temp.wallet(a1);
  said_own := pg_temp.refusal(format('select pg_temp.fall(%L, %L, 50)', a1, pa1));
  said_staff := pg_temp.refusal(format('select pg_temp.fall(%L, %L, 50)', a1, pstaff));
  said_other := pg_temp.refusal(format('select pg_temp.fall(%L, %L, 50)', b1, pstaff));
  if said_own is distinct from '42501: Test Fall is played on another character''s post' then raise exception 'an own post is refused, said %', said_own; end if;
  if said_staff is distinct from '22023: Test Fall is played on a player''s post' or said_other is distinct from said_staff then raise exception 'a staff post is refused in the same words for everyone, said %, %', said_staff, said_other; end if;
  if pg_temp.wallet(a1) is distinct from w0 or card_held(ann, 't-fall') is distinct from 4 then raise exception 'a refused fall spent something'; end if;
  -- "Own post" compares characters: a second mask of the author's account takes the fall, and the filing goes to that mask.
  play := (pg_temp.fall(a2, pa1) ->> 'id')::uuid;
  v := pg_temp.visit(pa1, 'moderate'); perform file_visit(v, 'Filed.');
  if (pg_temp.filed(v)).payload ->> 'character' is distinct from a2::text or pg_temp.bar(a2) is distinct from 4 or pg_temp.bar(a1) is distinct from 0 then raise exception 'a second mask of the author takes the fall: a2 %, a1 %', pg_temp.bar(a2), pg_temp.bar(a1); end if;
  -- The author's player is also the taker's: the row is shown (it is the author's), as is the infraction on the taker's own bar.
  perform tests.become(ann);
  if (select count(*) from my_falls_taken) is distinct from 1::bigint or (select count(*) from my_infractions i where i.fall_play = play) is distinct from 1::bigint then raise exception 'the player of both masks sees both rows'; end if;
  perform tests.unbecome();
  -- A stranger takes a fall on the same character's other post: no refusal, no word and no price differs with who owns the caster or the author.
  perform pg_temp.fall(b1, pa1b, 0);
  if pg_temp.refusal(format('select pg_temp.fall(%L, %L, 50)', a2, pb1)) is not null then raise exception 'a mask casts on another player''s post as any other does'; end if;
end $$;

-- ---- 7. A ward turns a fall away; file_visit never fails because of a fall ----
do $$
declare
  t uuid := tests.thread('Df ward');
  author uuid := pg_temp.player('f7-author'); taker uuid := pg_temp.player('f7-taker'); gone uuid := pg_temp.player('f7-gone');
  p uuid := pg_temp.say(author, t, 'Warded.'); q uuid := pg_temp.say(author, t, 'Taken by one who then joins the staff.');
  said text; v uuid; w0 integer; hit jsonb;
begin
  perform pg_temp.hand(author, 't-fward', 1); perform pg_temp.hand(taker, 't-fall', 1); perform pg_temp.hand(gone, 't-fall', 1);
  perform play_card(pg_temp.owner(author), 't-fward', author, p, '{}', 0, '', 'post');
  w0 := pg_temp.wallet(taker);
  said := pg_temp.refusal(format('select pg_temp.fall(%L, %L, 50)', taker, p));
  if said is distinct from '42501: this post''s Test Field turns away cards up to uncommon' then raise exception 'a ward turns a fall away, said %', said; end if;
  if pg_temp.wallet(taker) is distinct from w0 or card_held(pg_temp.owner(taker), 't-fall') is distinct from 1 or pg_temp.fall_of(p) is not null then raise exception 'a warded fall did nothing and cost nothing'; end if;
  -- A taker that has since joined the staff: infract refuses a staff character (there is no player character to warn), so the filing lands on the author as if there were no fall, and the fall stays unspent.
  perform pg_temp.fall(gone, q);
  update characters set owner = null, staff = 'df-gone', staff_kind = 'persona' where id = gone;
  v := pg_temp.visit(q, 'moderate');
  begin
    hit := file_visit(v, 'Filed.');
  exception when others then
    raise exception 'a taker who is staff now must not fail the filing: %: %', sqlstate, sqlerrm;
  end;
  if (hit ->> 'filed')::boolean is distinct from true or (pg_temp.filed(v)).payload ->> 'character' is distinct from author::text or (pg_temp.filed(v)).payload ? 'fall_play' or pg_temp.bar(author) is distinct from 4 then
    raise exception 'a taker who is staff now changes nothing: the filing lands on the author: %', hit;
  end if;
  if exists (select 1 from acts i where i.kind = 'infraction' and i.payload ->> 'fall_play' = pg_temp.fall_of(q)::text) then raise exception 'the fall stays unspent'; end if;
end $$;

-- ---- 8. infract and the guard take a fall only from the play itself ----
do $$
declare
  t uuid := tests.thread('Df guard');
  author uuid := pg_temp.player('f9-author'); taker uuid := pg_temp.player('f9-taker'); other uuid := pg_temp.player('f9-other');
  p uuid := pg_temp.say(author, t, 'A post.'); q uuid := pg_temp.say(author, t, 'Another post.');
  play uuid; why text; board uuid := (select board from threads where id = t); own uuid := pg_temp.say(taker, t, 'The taker''s own post.');
begin
  perform pg_temp.hand(taker, 't-fall', 1);
  play := (pg_temp.fall(taker, p) ->> 'id')::uuid;
  -- Without a fall an infraction is for the character's own post, as it was.
  why := pg_temp.refusal(format('select infract(%L, ''minor'', %L, ''df-m1'')', taker, p));
  if why not like 'P0002: an infraction is for a post this character wrote%' then raise exception 'no fall, not the character''s post: %', why; end if;
  -- With the play, the character that cast it, on the post it was cast on.
  why := pg_temp.refusal(format('select infract(%L, ''minor'', %L, ''df-m1'', null, null, %L)', other, p, play));
  if why is null or why not like 'P0002:%' then raise exception 'a play is the caster''s alone: %', why; end if;
  why := pg_temp.refusal(format('select infract(%L, ''minor'', %L, ''df-m1'', null, null, %L)', taker, q, play));
  if why is null or why not like 'P0002:%' then raise exception 'a play is on its own post: %', why; end if;
  why := pg_temp.refusal(format('select infract(%L, ''minor'', %L, ''df-m1'', null, null, %L)', taker, p, gen_random_uuid()));
  if why is null or why not like 'P0002:%' then raise exception 'a play that is no Act: %', why; end if;
  why := pg_temp.refusal(format('select infract(%L, ''minor'', %L, ''df-m1'', null, null, %L)', taker, p, p));
  if why is null or why not like 'P0002:%' then raise exception 'a post is no play: %', why; end if;
  -- The guard holds the same for a writer that skips infract.
  perform set_config('kayfabb.warn_writer', 'on', true);
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, payload) values (null, 'infraction', %L, jsonb_build_object('character', %L::uuid, 'band', 'minor', 'points', 2, 'rule_number', null, 'board', %L::uuid, 'about_act', %L::uuid, 'visit_act', null, 'staff', 'df-m1', 'expires_at', now() + interval '1 day', 'fall_play', %L::uuid, 'fall_for', %L::uuid))$s$, t, other, board, p, play, author));
  if why is null or why not like '23514:%' then raise exception 'the guard refuses a fall that is not the character''s play: %', why; end if;
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, payload) values (null, 'infraction', %L, jsonb_build_object('character', %L::uuid, 'band', 'minor', 'points', 2, 'rule_number', null, 'board', %L::uuid, 'about_act', %L::uuid, 'visit_act', null, 'staff', 'df-m1', 'expires_at', now() + interval '1 day'))$s$, t, taker, board, p));
  if why is null or why not like '23514:%' then raise exception 'the guard refuses another character''s post with no play: %', why; end if;
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, payload) values (null, 'infraction', %L, jsonb_build_object('character', %L::uuid, 'band', 'minor', 'points', 2, 'rule_number', null, 'board', %L::uuid, 'about_act', %L::uuid, 'visit_act', null, 'staff', 'df-m1', 'expires_at', now() + interval '1 day', 'fall_play', %L::uuid, 'fall_for', %L::uuid))$s$, t, taker, board, p, play, author));
  if why is not null then raise exception 'the guard takes the caster''s own play on its post: %', why; end if;
  -- An infraction about the character's own post carries no fall: the key is checked whenever it is present, so a forged play (the taker's own, which is spent nowhere yet) is refused.
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, payload) values (null, 'infraction', %L, jsonb_build_object('character', %L::uuid, 'band', 'minor', 'points', 2, 'rule_number', null, 'board', %L::uuid, 'about_act', %L::uuid, 'visit_act', null, 'staff', 'df-m1', 'expires_at', now() + interval '1 day', 'fall_play', %L::uuid, 'fall_for', %L::uuid))$s$, t, taker, board, own, play, taker));
  if why is null or why not like '23514:%' then raise exception 'the guard refuses a fall_play on an infraction about the character''s own post: %', why; end if;
  -- The author named is the post's author, whatever the play.
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, payload) values (null, 'infraction', %L, jsonb_build_object('character', %L::uuid, 'band', 'minor', 'points', 2, 'rule_number', null, 'board', %L::uuid, 'about_act', %L::uuid, 'visit_act', null, 'staff', 'df-m1', 'expires_at', now() + interval '1 day', 'fall_play', %L::uuid, 'fall_for', %L::uuid))$s$, t, taker, board, p, play, other));
  if why is null or why not like '23514:%' then raise exception 'the guard refuses a fall_for that is not the post''s author: %', why; end if;
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, payload) values (null, 'infraction', %L, jsonb_build_object('character', %L::uuid, 'band', 'minor', 'points', 2, 'rule_number', null, 'board', %L::uuid, 'about_act', %L::uuid, 'visit_act', null, 'staff', 'df-m1', 'expires_at', now() + interval '1 day', 'fall_play', %L::uuid))$s$, t, taker, board, p, play));
  if why is null or why not like '23514:%' then raise exception 'a fall_play names the author with it: %', why; end if;
  perform set_config('kayfabb.warn_writer', '', true);
  -- fall_play is a uuid and nothing else: the constraint says so (triggers off, so the guard does not answer first), and so does the guard.
  perform set_config('session_replication_role', 'replica', true);
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, payload) values (null, 'infraction', %L, jsonb_build_object('character', %L::uuid, 'band', 'minor', 'points', 2, 'rule_number', null, 'board', %L::uuid, 'about_act', %L::uuid, 'visit_act', null, 'staff', 'df-m1', 'expires_at', now() + interval '1 day', 'fall_play', 'not a uuid', 'fall_for', %L::uuid))$s$, t, taker, board, p, author));
  if why is null or why not like '23514:%acts_infraction_payload%' then raise exception 'fall_play is a uuid, said %', why; end if;
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, payload) values (null, 'infraction', %L, jsonb_build_object('character', %L::uuid, 'band', 'minor', 'points', 2, 'rule_number', null, 'board', %L::uuid, 'about_act', %L::uuid, 'visit_act', null, 'staff', 'df-m1', 'expires_at', now() + interval '1 day', 'fall_play', %L::uuid, 'fall_for', %L::uuid, 'extra', 1))$s$, t, taker, board, p, play, author));
  if why is null or why not like '23514:%acts_infraction_payload%' then raise exception 'an infraction holds no other key, said %', why; end if;
  perform set_config('session_replication_role', 'origin', true);
  perform set_config('kayfabb.warn_writer', 'on', true);
  why := pg_temp.refusal(format($s$insert into acts (character, kind, thread, payload) values (null, 'infraction', %L, jsonb_build_object('character', %L::uuid, 'band', 'minor', 'points', 2, 'rule_number', null, 'board', %L::uuid, 'about_act', %L::uuid, 'visit_act', null, 'staff', 'df-m1', 'expires_at', now() + interval '1 day', 'fall_play', 'not a uuid', 'fall_for', %L::uuid))$s$, t, taker, board, p, author));
  if why is null then raise exception 'the guard refuses a fall_play that is no uuid'; end if;
  perform set_config('kayfabb.warn_writer', '', true);
end $$;
