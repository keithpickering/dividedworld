-- Polls (supabase/migrations/0394_polls.sql; docs/plans/2026-11-20-polls-design.md; plan docs/plans/2026-11-20-polls-plan.md, Task 1; models 0304-post-veils.sql, 0321-veil-cover.sql and 0378-target-lean.sql).
--
-- The kinds, the writes and the guards. Every claim is a `raise exception`; a refusal is held to its one sentence. The cards and rows are this file's own (pl...).
--
--  1. The races (first in the file, as 0304's section 13 is, so the committed rows meet none of this file's locks): an edit of a poll holds the post and a ballot waits for it, and is refused as the replaced poll's;
--     a ballot holds the post and an edit of the poll waits for it, and is refused for the ballot. Never a ballot that counts on a replaced poll.
--  2. The kinds and their payloads: the three kinds take no seq; each payload poison is refused by its own constraint and each good is taken; each Act is held to its target.
--  3. poll_written through post and start_thread: the draft's every refusal in its sentence, and what a good draft writes.
--  4. edit_post: null keeps a poll, an object sets one, {"removed": true} removes it; refused in one sentence once a ballot is cast; a body-only edit still goes.
--  5. cast_ballot: its refusals, the sorted picks, a withdrawal, the projection it answers with.
--  6. What a poll counts: each character's latest ballot before the poll's end, a withdrawal, two characters of one account, a ballot by created_at against a close; poll_counts is the same for every caller.
--  6b. poll_latest_ballots: the row each character's latest ballot is kept in, by the trigger, the later (created_at, id) winning; a ballot created after the close; rebuilt from the Acts; no API role reads it.
--  7. Closing: the author's and an admin's, and each refusal.
--  8. The masks: a secret ballot through acts_public, my_ballots and the projection cast_ballot answers with.
--  9. The guards: react, settlement_input and estimate_input, spin, and a veiled author's ballot (a ballot written before the veil and one after).

create function pg_temp.say(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlerrm;
end $$;

create function pg_temp.coded(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ' ' || sqlerrm;
end $$;

-- A draft as the writers take it.
create function pg_temp.draft(question text default 'Best kart?', options jsonb default '["Pipe Frame", "Badwagon", "Mach Bike"]', pick integer default 1, secret boolean default false, lasts jsonb default '"3 days"') returns jsonb language sql as $$
  select jsonb_build_object('question', question, 'options', options, 'pick', pick, 'secret', secret, 'lasts', lasts)
$$;

-- A poll Act as the writer leaves it, at a time of the test's choosing.
create function pg_temp.mkpoll(in_thread uuid, on_post uuid, by_character uuid, secret boolean default false, pick integer default 1, closes timestamptz default now() + interval '1 day', at timestamptz default now(),
                               options jsonb default '["Pipe Frame", "Badwagon", "Mach Bike"]') returns uuid language sql as $$
  select tests.act(by_character, 'poll', in_thread,
    jsonb_build_object('question', 'Best kart?', 'options', options, 'pick', pick, 'secret', secret, 'closes_at', closes), on_post, at)
$$;

create function pg_temp.vote(on_poll uuid, by_character uuid, picks jsonb, at timestamptz default now()) returns uuid language sql as $$
  select tests.act(by_character, 'ballot', (select p.thread from acts p where p.id = on_poll), jsonb_build_object('picks', picks), on_poll, at)
$$;

-- (plpgsql, so the file can be read and its fixtures built before the view is looked up)
create function pg_temp.counts(on_poll uuid) returns jsonb language plpgsql as $$
begin
  return (select jsonb_build_object('counts', c.counts, 'voters', c.voters, 'closed', c.closed) from poll_counts c where c.poll = on_poll);
end $$;

-- ---- 1. The races ----
-- Rows the racers read are committed (tests.commit). The holder's transaction is a dblink session, which becomes the player inside its own transaction.
create function pg_temp.parked(tag text, conn text) returns text language plpgsql as $$
declare tries integer := 0; max_tries constant integer := 1200;
begin
  loop
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity a where a.query like '%/* ' || tag || ' */%' and a.pid <> pg_backend_pid() and a.wait_event_type = 'Lock') then return 'waiting'; end if;
    if extensions.dblink_is_busy(conn) = 0 then return 'finished'; end if;
    tries := tries + 1;
    -- Gives up at 30 s, the lock_timeout (tools/test-sql.mjs, SESSION_BOUNDS), 1200 looks of 25 ms: the pool runs several files at once, so a parked session can take seconds to show here on a loaded runner. The loop leaves the moment the wait shows, so the bound is only how long a broken race takes to fail.
    if tries > max_tries then return 'neither'; end if;
    perform pg_sleep(0.025);
  end loop;
end $$;

select tests.unbecome();
do $$
declare
  u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); a1 uuid := gen_random_uuid(); b1 uuid := gen_random_uuid(); t uuid := gen_random_uuid();
  p1 uuid := gen_random_uuid(); p2 uuid := gen_random_uuid(); poll1 uuid := gen_random_uuid(); poll2 uuid := gen_random_uuid();
  url text := current_setting('kayfabb.scratch_url');
  seen text; got text; n integer; newest uuid;
  fresh constant text := '{"question": "Replaced?", "options": ["Yes", "No"], "pick": 1, "secret": false, "lasts": "2 days"}';
begin
  perform tests.commit(format($sql$
    insert into auth.users (id, email) values (%1$L, 'pl-race-author@test.invalid'), (%2$L, 'pl-race-voter@test.invalid');
    insert into accounts (id, created_at) values (%1$L, '2000-01-01T00:00:00Z'), (%2$L, '2000-01-01T00:00:00Z');
    insert into characters (id, owner, name, created_at, debuted_at) values (%3$L, %1$L, 'Pl Race Author', now(), now()), (%4$L, %2$L, 'Pl Race Voter', now(), now());
    insert into class_history (character, class_key, started_at) values (%3$L, 'alpha', now()), (%4$L, 'alpha', now());
    insert into threads (id, board, title) select %5$L, b.id, 'Pl race' from boards b where b.slug = 'general';
    insert into acts (id, character, kind, thread, payload, created_at) values
      (%6$L, %3$L, 'post', %5$L, '{"body": "A post whose poll an edit replaces."}', now() - interval '2 hours'),
      (%7$L, %3$L, 'post', %5$L, '{"body": "A post a ballot holds."}', now() - interval '2 hours');
    insert into acts (id, character, kind, thread, payload, target_act_id, created_at) values
      (%8$L, %3$L, 'poll', %5$L, jsonb_build_object('question', 'Old?', 'options', '["A", "B"]'::jsonb, 'pick', 1, 'secret', false, 'closes_at', now() + interval '1 day'), %6$L, now() - interval '1 hour'),
      (%9$L, %3$L, 'poll', %5$L, jsonb_build_object('question', 'Held?', 'options', '["A", "B"]'::jsonb, 'pick', 1, 'secret', false, 'closes_at', now() + interval '1 day'), %7$L, now() - interval '1 hour');
  $sql$, u1, u2, a1, b1, t, p1, p2, poll1, poll2));
  perform extensions.dblink_connect('pl_h', url);
  perform extensions.dblink_connect('pl_v', url);

  -- (a) An edit that replaces the poll holds the post and does not commit; a ballot on the old poll waits for it, and is refused as the replaced poll's.
  perform extensions.dblink_exec('pl_h', 'begin');
  perform * from extensions.dblink('pl_h', format('select tests.become(%L)', u1)) as x(r text);
  perform * from extensions.dblink('pl_h', format('select edit_post(%L, %L, ''A post whose poll an edit replaces.'', %L::jsonb)', p1, a1, fresh)) as x(r jsonb);
  perform extensions.dblink_exec('pl_v', 'begin');
  perform * from extensions.dblink('pl_v', format('select tests.become(%L)', u2)) as x(r text);
  perform extensions.dblink_send_query('pl_v', format('select /* pl_a */ cast_ballot(%L, %L, ''{0}'')', poll1, b1));
  seen := pg_temp.parked('pl_a', 'pl_v');
  perform extensions.dblink_exec('pl_h', 'commit');
  begin perform * from extensions.dblink_get_result('pl_v') as x(r jsonb); got := null; exception when others then got := sqlerrm; end;
  perform * from extensions.dblink_get_result('pl_v') as x(r jsonb);
  perform extensions.dblink_exec('pl_v', 'rollback');
  if seen is distinct from 'waiting' then raise exception 'a ballot did not wait for an edit holding its poll''s post (it %)', seen; end if;
  if got is distinct from 'that poll was replaced' then raise exception 'the ballot after the edit committed: %', got; end if;
  if exists (select 1 from acts b where b.kind = 'ballot' and b.target_act_id = poll1) then raise exception 'a ballot landed on a replaced poll'; end if;
  select a.id into newest from acts a where a.kind = 'poll' and a.target_act_id = p1 order by a.created_at desc, a.id desc limit 1;
  if newest = poll1 then raise exception 'the edit did not write a newer poll'; end if;

  -- (b) A ballot holds the post (cast_ballot takes it for share) and does not commit; an edit of the poll waits for it, and is refused for the ballot.
  perform extensions.dblink_exec('pl_h', 'begin');
  perform * from extensions.dblink('pl_h', format('select tests.become(%L)', u2)) as x(r text);
  perform * from extensions.dblink('pl_h', format('select cast_ballot(%L, %L, ''{1}'')', poll2, b1)) as x(r jsonb);
  perform extensions.dblink_exec('pl_v', 'begin');
  perform * from extensions.dblink('pl_v', format('select tests.become(%L)', u1)) as x(r text);
  perform extensions.dblink_send_query('pl_v', format('select /* pl_b */ edit_post(%L, %L, ''A post a ballot holds.'', %L::jsonb)', p2, a1, fresh));
  seen := pg_temp.parked('pl_b', 'pl_v');
  perform extensions.dblink_exec('pl_h', 'commit');
  begin perform * from extensions.dblink_get_result('pl_v') as x(r jsonb); got := null; exception when others then got := sqlerrm; end;
  perform * from extensions.dblink_get_result('pl_v') as x(r jsonb);
  perform extensions.dblink_exec('pl_v', 'rollback');
  if seen is distinct from 'waiting' then raise exception 'an edit of a poll did not wait for a ballot holding its post (it %)', seen; end if;
  if got is distinct from 'a poll cannot change once a ballot is cast; you can still close it' then raise exception 'the edit after the ballot committed: %', got; end if;
  select count(*) into n from acts a where a.kind = 'poll' and a.target_act_id = p2;
  if n is distinct from 1 then raise exception 'an edit refused for a ballot wrote a poll anyway (% polls on the post)', n; end if;
  perform extensions.dblink_disconnect('pl_h');
  perform extensions.dblink_disconnect('pl_v');
end $$;

-- ---- 2. The kinds and their payloads ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pl-ann'); bob uuid := tests.account('pl-bob');
  a1 uuid := tests.character(ann, 'Pl Ann'); b1 uuid := tests.character(bob, 'Pl Bob');
  t uuid := tests.thread('Pl kinds'); t2 uuid := tests.thread('Pl other thread');
  p uuid := tests.post(a1, t, 'A post.'); pb_own uuid := tests.post(a1, t, 'A second post.'); pb uuid := tests.post(b1, t, 'Bob''s post.'); p_elsewhere uuid := tests.post(a1, t2, 'Another thread.');
  e uuid := tests.act(a1, 'edit', t, '{"body": "Edited."}', p);
  poll uuid; poll_b uuid; seq_before integer; seq_after integer; got text; closes text := to_jsonb(now() + interval '1 day') #>> '{}';
  base constant jsonb := '{"question": "Best kart?", "options": ["Pipe Frame", "Badwagon"], "pick": 1, "secret": false}';
  bad text[]; b text; payload jsonb;
begin
  select next_seq into seq_before from threads where id = t;
  poll := tests.act(a1, 'poll', t, base || jsonb_build_object('closes_at', closes), p);
  perform tests.act(b1, 'ballot', t, '{"picks": [0]}', poll);
  perform tests.act(b1, 'ballot', t, '{"picks": []}', poll);
  perform tests.act(a1, 'poll_close', t, '{"by": "author"}', poll);
  perform tests.act(a1, 'poll', t, '{"removed": true}', p);
  poll_b := tests.act(a1, 'poll', t, base || jsonb_build_object('closes_at', closes), pb_own);
  perform tests.act(null, 'poll_close', t, '{"by": "admin"}', poll_b);
  select next_seq into seq_after from threads where id = t;
  if seq_after is distinct from seq_before then raise exception 'a poll, a ballot or a close took a place in its thread: next_seq % to %', seq_before, seq_after; end if;
  if exists (select 1 from acts a where a.kind in ('poll', 'ballot', 'poll_close') and a.seq is not null) then raise exception 'a poll, a ballot or a close has a seq'; end if;

  -- Each poison is refused by the constraint that holds its kind's payload.
  bad := array[
    '{"question": "Q", "options": ["A", "B"], "pick": 1, "secret": false}',                                                -- no closes_at
    '{"question": "Q", "options": ["A", "B"], "pick": 1, "secret": false, "closes_at": "X"}',                                -- a closes_at that no time is read from
    '{"options": ["A", "B"], "pick": 1, "secret": false, "closes_at": "CLOSES"}',                                                -- no question
    '{"question": 5, "options": ["A", "B"], "pick": 1, "secret": false, "closes_at": "CLOSES"}',                                  -- a question that is no string
    '{"question": "Q", "options": ["A"], "pick": 1, "secret": false, "closes_at": "CLOSES"}',                                     -- one option
    '{"question": "Q", "options": ["A", 2], "pick": 1, "secret": false, "closes_at": "CLOSES"}',                                  -- an option that is no string
    '{"question": "Q", "options": "AB", "pick": 1, "secret": false, "closes_at": "CLOSES"}',                                      -- options that are no array
    '{"question": "Q", "options": ["A", "B"], "pick": 0, "secret": false, "closes_at": "CLOSES"}',                                -- pick 0
    '{"question": "Q", "options": ["A", "B"], "pick": 3, "secret": false, "closes_at": "CLOSES"}',                                -- pick past the options
    '{"question": "Q", "options": ["A", "B"], "pick": 1.5, "secret": false, "closes_at": "CLOSES"}',                              -- pick that is no integer
    '{"question": "Q", "options": ["A", "B"], "pick": "1", "secret": false, "closes_at": "CLOSES"}',                              -- pick that is a string
    '{"question": "Q", "options": ["A", "B"], "pick": 1, "secret": "no", "closes_at": "CLOSES"}',                                 -- secret that is no boolean
    '{"question": "Q", "options": ["A", "B"], "pick": 1, "secret": false, "closes_at": 5}',                                  -- closes_at that is no string
    '{"question": "Q", "options": ["A", "B"], "pick": 1, "secret": false, "closes_at": "CLOSES", "extra": 1}',                    -- a field it does not have
    '{"removed": false}',
    '{"removed": true, "question": "Q"}',
    '{}'];
  -- (the placeholder CLOSES stands for a real time, so each poison is refused for the one defect it has)
  foreach b in array bad loop
    payload := replace(b, 'CLOSES', closes)::jsonb;
    got := pg_temp.say(format('select tests.act(%L, ''poll'', %L, %L::jsonb, %L)', a1, t, payload, p));
    if got is null or got not like '%acts_poll_payload%' then raise exception 'the poll payload % was not refused by acts_poll_payload: %', b, got; end if;
  end loop;
  foreach b in array array['{"picks": "0"}', '{"picks": ["a"]}', '{"picks": [1.5]}', '{"picks": [0], "x": 1}', '{}', '{"picks": null}', '{"picks": {"0": 1}}'] loop
    got := pg_temp.say(format('select tests.act(%L, ''ballot'', %L, %L::jsonb, %L)', b1, t, b, poll));
    if got is null or got not like '%acts_ballot_payload%' then raise exception 'the ballot payload % was not refused by acts_ballot_payload: %', b, got; end if;
  end loop;
  foreach b in array array['{"by": "nobody"}', '{}', '{"by": 5}', '{"by": "author", "x": 1}'] loop
    got := pg_temp.say(format('select tests.act(%L, ''poll_close'', %L, %L::jsonb, %L)', a1, t, b, poll));
    if got is null or got not like '%acts_poll_close_payload%' then raise exception 'the poll_close payload % was not refused by acts_poll_close_payload: %', b, got; end if;
  end loop;

  -- Each Act is held to its target.
  got := pg_temp.say(format('select tests.act(%L, ''poll'', %L, %L::jsonb, %L)', a1, t, base || jsonb_build_object('closes_at', closes), pb));
  if got is distinct from 'a poll is of its own author''s post, in its thread' then raise exception 'a poll on another character''s post: %', got; end if;
  got := pg_temp.say(format('select tests.act(%L, ''poll'', %L, %L::jsonb, %L)', a1, t, base || jsonb_build_object('closes_at', closes), e));
  if got is distinct from 'a poll is of its own author''s post, in its thread' then raise exception 'a poll on an edit: %', got; end if;
  got := pg_temp.say(format('select tests.act(%L, ''poll'', %L, %L::jsonb, %L)', a1, t, base || jsonb_build_object('closes_at', closes), p_elsewhere));
  if got is distinct from 'a poll is of its own author''s post, in its thread' then raise exception 'a poll in a thread other than its post''s: %', got; end if;
  got := pg_temp.say(format('select tests.act(%L, ''poll'', %L, %L::jsonb, null)', a1, t, base || jsonb_build_object('closes_at', closes)));
  if got is null then raise exception 'a poll with no post'; end if;
  got := pg_temp.say(format('select tests.act(%L, ''ballot'', %L, %L::jsonb, %L)', b1, t, '{"picks": [0]}', p));
  if got is distinct from 'a ballot is of a poll, in its thread' then raise exception 'a ballot on a post: %', got; end if;
  got := pg_temp.say(format('select tests.act(%L, ''ballot'', %L, %L::jsonb, %L)', b1, t2, '{"picks": [0]}', poll));
  if got is distinct from 'a ballot is of a poll, in its thread' then raise exception 'a ballot in another thread than its poll''s: %', got; end if;
  got := pg_temp.say(format('select tests.act(%L, ''poll_close'', %L, %L::jsonb, %L)', a1, t, '{"by": "author"}', p));
  if got is distinct from 'a poll_close is of a poll, in its thread' then raise exception 'a close of a post: %', got; end if;
  got := pg_temp.say(format('select tests.act(%L, ''poll_close'', %L, %L::jsonb, %L)', b1, t, '{"by": "author"}', poll));
  if got is distinct from 'a poll is closed by its own author or by an admin' then raise exception 'a close by another character that says it is the author''s: %', got; end if;
  -- An admin's close has no character, and an author's has one.
  got := pg_temp.say(format('select tests.act(%L, ''poll_close'', %L, %L::jsonb, %L)', a1, t, '{"by": "admin"}', poll));
  if got is null or got not like '%acts_character_null%' then raise exception 'an admin''s close with a character: %', got; end if;
  got := pg_temp.say(format('select tests.act(null, ''poll_close'', %L, %L::jsonb, %L)', t, '{"by": "author"}', poll));
  if got is null or got not like '%acts_character_null%' then raise exception 'an author''s close with no character: %', got; end if;
  -- A poll has one close.
  got := pg_temp.say(format('select tests.act(%L, ''poll_close'', %L, %L::jsonb, %L)', a1, t, '{"by": "author"}', poll));
  if got is null or got not like '%acts_one_poll_close%' then raise exception 'a poll took a second close: %', got; end if;
end $$;

-- ---- 3. poll_written through post and start_thread ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pl3-ann');
  a1 uuid := tests.character(ann, 'Pl Three Ann');
  t uuid := tests.thread('Pl writer'); made jsonb; pid uuid; pol jsonb; before_acts integer; got text; cap text;
  too_many jsonb := (select jsonb_agg('Option ' || g) from generate_series(1, 11) g);
  ten jsonb := (select jsonb_agg('Option ' || g) from generate_series(1, 10) g);
begin
  perform tests.become(ann);
  -- A good draft writes the post and the poll, in the post's thread, by the post's character, closing at now() plus what it lasts.
  made := post(in_thread => t, through => a1, body => 'Vote.', poll => pg_temp.draft());
  pid := (made ->> 'id')::uuid;
  perform tests.unbecome();
  select a.payload into pol from acts a where a.kind = 'poll' and a.target_act_id = pid and a.thread = t and a.character = a1;
  if pol is null then raise exception 'a post with a poll wrote no poll: %', made; end if;
  if pol ->> 'question' is distinct from 'Best kart?' or pol -> 'options' is distinct from '["Pipe Frame", "Badwagon", "Mach Bike"]'::jsonb or (pol ->> 'pick')::integer is distinct from 1 or (pol ->> 'secret')::boolean is distinct from false then
    raise exception 'the poll written is not the draft: %', pol;
  end if;
  if (pol ->> 'closes_at')::timestamptz is distinct from now() + interval '3 days' then raise exception 'the poll closes at %, not three days on', pol ->> 'closes_at'; end if;
  if (select seq from acts where id = pid) is null or (select count(*) from acts where kind = 'poll' and thread = t) is distinct from 1 then raise exception 'the post has no seq, or the thread holds another poll'; end if;
  -- A span may be an object as the settings hold it, and a draft may be secret and take more picks.
  perform tests.become(ann);
  made := post(in_thread => t, through => a1, body => 'Vote again.', poll => pg_temp.draft(pick => 3, secret => true, lasts => '{"unit": "week", "count": 2}'));
  perform tests.unbecome();
  select a.payload into pol from acts a where a.kind = 'poll' and a.target_act_id = (made ->> 'id')::uuid;
  if (pol ->> 'secret')::boolean is not true or (pol ->> 'pick')::integer is distinct from 3 or (pol ->> 'closes_at')::timestamptz is distinct from now() + interval '14 days' then raise exception 'a secret three-pick poll of two weeks: %', pol; end if;
  -- Ten options at the most, and the longest and shortest a poll may last, are taken.
  perform tests.become(ann);
  perform post(in_thread => t, through => a1, body => 'Ten.', poll => pg_temp.draft(options => ten, lasts => '"1 hour"'));
  perform post(in_thread => t, through => a1, body => 'Fourteen days.', poll => pg_temp.draft(lasts => '"14 days"'));
  -- A poll on a thread's first post.
  made := start_thread(board_slug => 'general', through => a1, title => 'A thread with a poll', body => 'Opening.', poll => pg_temp.draft(question => 'Opening poll?'));
  perform tests.unbecome();
  if not exists (select 1 from acts a where a.kind = 'poll' and a.target_act_id = (made -> 'act' ->> 'id')::uuid and a.thread = (made -> 'thread' ->> 'id')::uuid and a.payload ->> 'question' = 'Opening poll?') then
    raise exception 'start_thread with a poll wrote no poll: %', made;
  end if;
  -- No poll leaves none.
  perform tests.become(ann);
  made := post(in_thread => t, through => a1, body => 'No poll.');
  perform tests.unbecome();
  if exists (select 1 from acts a where a.kind = 'poll' and a.target_act_id = (made ->> 'id')::uuid) then raise exception 'a post with no poll wrote one'; end if;

  select count(*) into before_acts from acts;
  perform tests.become(ann);
  -- Each refusal, in the one sentence that names the predicate that failed; none of them writes the post.
  got := pg_temp.say(format('select post(in_thread => %L, through => %L, body => ''x'', poll => %L::jsonb)', t, a1, pg_temp.draft(question => '   ')));
  if got is distinct from 'question is empty' then raise exception 'a blank question: %', got; end if;
  got := pg_temp.say(format('select post(in_thread => %L, through => %L, body => ''x'', poll => %L::jsonb)', t, a1, pg_temp.draft(question => repeat('q', 201))));
  if got is distinct from 'question is longer than 200 characters' then raise exception 'a question of 201 characters: %', got; end if;
  got := pg_temp.say(format('select post(in_thread => %L, through => %L, body => ''x'', poll => %L::jsonb)', t, a1, pg_temp.draft(options => '["Only"]')));
  if got is distinct from 'a poll has 2 to 10 options' then raise exception 'one option: %', got; end if;
  got := pg_temp.say(format('select post(in_thread => %L, through => %L, body => ''x'', poll => %L::jsonb)', t, a1, pg_temp.draft(options => too_many)));
  if got is distinct from 'a poll has 2 to 10 options' then raise exception 'eleven options: %', got; end if;
  got := pg_temp.say(format('select post(in_thread => %L, through => %L, body => ''x'', poll => %L::jsonb)', t, a1, pg_temp.draft(options => '"Pipe Frame"')));
  if got is distinct from 'a poll has 2 to 10 options' then raise exception 'options that are no list: %', got; end if;
  got := pg_temp.say(format('select post(in_thread => %L, through => %L, body => ''x'', poll => %L::jsonb)', t, a1, pg_temp.draft(options => jsonb_build_array('A', repeat('o', 101)))));
  if got is distinct from 'option is longer than 100 characters' then raise exception 'an option of 101 characters: %', got; end if;
  got := pg_temp.say(format('select post(in_thread => %L, through => %L, body => ''x'', poll => %L::jsonb)', t, a1, pg_temp.draft(options => '["A", " "]')));
  if got is distinct from 'option is empty' then raise exception 'a blank option: %', got; end if;
  got := pg_temp.say(format('select post(in_thread => %L, through => %L, body => ''x'', poll => %L::jsonb)', t, a1, pg_temp.draft(options => '["A", 2]')));
  if got is distinct from 'option is empty' then raise exception 'an option that is no text: %', got; end if;
  got := pg_temp.say(format('select post(in_thread => %L, through => %L, body => ''x'', poll => %L::jsonb)', t, a1, pg_temp.draft(options => '["Same", "  Same "]')));
  if got is distinct from 'no two options are the same' then raise exception 'two options equal after trimming: %', got; end if;
  got := pg_temp.say(format('select post(in_thread => %L, through => %L, body => ''x'', poll => %L::jsonb)', t, a1, pg_temp.draft(pick => 0)));
  if got is distinct from 'a poll lets 1 to 3 options be picked' then raise exception 'pick 0: %', got; end if;
  got := pg_temp.say(format('select post(in_thread => %L, through => %L, body => ''x'', poll => %L::jsonb)', t, a1, pg_temp.draft(pick => 4)));
  if got is distinct from 'a poll lets 1 to 3 options be picked' then raise exception 'pick past the options: %', got; end if;
  got := pg_temp.say(format('select post(in_thread => %L, through => %L, body => ''x'', poll => %L::jsonb)', t, a1, pg_temp.draft(secret => null) - 'secret' || '{"secret": "yes"}'));
  if got is distinct from 'a poll''s ballots are public or secret' then raise exception 'a secret that is no boolean: %', got; end if;
  got := pg_temp.say(format('select post(in_thread => %L, through => %L, body => ''x'', poll => %L::jsonb)', t, a1, pg_temp.draft(lasts => '"30 minutes"')));
  if got is distinct from 'a poll lasts from 1 hour to 14 days' then raise exception 'a poll of 30 minutes: %', got; end if;
  got := pg_temp.say(format('select post(in_thread => %L, through => %L, body => ''x'', poll => %L::jsonb)', t, a1, pg_temp.draft(lasts => '"15 days"')));
  if got is distinct from 'a poll lasts from 1 hour to 14 days' then raise exception 'a poll of 15 days: %', got; end if;
  got := pg_temp.say(format('select post(in_thread => %L, through => %L, body => ''x'', poll => %L::jsonb)', t, a1, pg_temp.draft(lasts => '"soon"')));
  if got is distinct from 'a poll lasts from 1 hour to 14 days' then raise exception 'a poll that lasts "soon": %', got; end if;
  got := pg_temp.say(format('select post(in_thread => %L, through => %L, body => ''x'', poll => %L::jsonb)', t, a1, pg_temp.draft() - 'lasts'));
  if got is distinct from 'a poll lasts from 1 hour to 14 days' then raise exception 'a poll with no length: %', got; end if;
  got := pg_temp.say(format('select post(in_thread => %L, through => %L, body => ''x'', poll => ''{"removed": true}''::jsonb)', t, a1));
  if got is distinct from 'question is empty' then raise exception 'a draft that is a removal: %', got; end if;
  got := pg_temp.say(format('select start_thread(board_slug => ''general'', through => %L, title => ''T'', body => ''x'', poll => %L::jsonb)', a1, pg_temp.draft(options => '["A"]')));
  if got is distinct from 'a poll has 2 to 10 options' then raise exception 'start_thread with one option: %', got; end if;
  perform tests.unbecome();
  if (select count(*) from acts) is distinct from before_acts then raise exception 'a refused poll left an Act behind'; end if;
  -- (poll_written is internal: no API role runs it.)
  if has_function_privilege('authenticated', 'poll_written(uuid, uuid, jsonb)', 'execute') or has_function_privilege('anon', 'poll_written(uuid, uuid, jsonb)', 'execute') then raise exception 'an API role may run poll_written'; end if;
end $$;

-- Reads of `acts` for a block that is signed in as a player (the API roles read no `character` or `payload` of it): definer helpers, which run as the file's owner.
create function pg_temp.polls_on(on_post uuid) returns bigint language sql security definer as $$ select count(*) from acts where kind = 'poll' and target_act_id = on_post $$;
create function pg_temp.edits_on(on_post uuid) returns bigint language sql security definer as $$ select count(*) from acts where kind = 'edit' and target_act_id = on_post $$;
create function pg_temp.latest(on_post uuid) returns jsonb language sql security definer as $$
  select jsonb_build_object('id', a.id, 'payload', a.payload) from acts a where a.kind = 'poll' and a.target_act_id = on_post order by a.created_at desc, a.id desc limit 1
$$;

-- ---- 4. edit_post ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pl4-ann'); bob uuid := tests.account('pl4-bob');
  a1 uuid := tests.character(ann, 'Pl Four Ann'); b1 uuid := tests.character(bob, 'Pl Four Bob');
  t uuid := tests.thread('Pl edit');
  p_keep uuid := tests.post(a1, t, 'Keep.', now() - interval '3 hours'); p_set uuid := tests.post(a1, t, 'Set.', now() - interval '3 hours'); p_rm uuid := tests.post(a1, t, 'Remove.', now() - interval '3 hours');
  p_ballot uuid := tests.post(a1, t, 'Ballot.', now() - interval '3 hours'); p_late uuid := tests.post(a1, t, 'Late.', now() - interval '3 hours'); p_shut uuid := tests.post(a1, t, 'Shut.', now() - interval '3 hours'); p_none uuid := tests.post(a1, t, 'None.', now() - interval '3 hours'); p_again uuid := tests.post(a1, t, 'Again.', now() - interval '3 hours');
  k uuid; s uuid; r uuid; v uuid; n uuid; w uuid; got text; before_polls integer; fresh jsonb := pg_temp.draft(question => 'Edited poll?', options => '["Yes", "No"]');
  cur uuid;
begin
  k := pg_temp.mkpoll(t, p_keep, a1, at => now() - interval '2 hours');
  s := pg_temp.mkpoll(t, p_set, a1, at => now() - interval '2 hours');
  r := pg_temp.mkpoll(t, p_rm, a1, at => now() - interval '2 hours');
  v := pg_temp.mkpoll(t, p_ballot, a1, at => now() - interval '2 hours');
  perform pg_temp.vote(v, b1, '[0]', now() - interval '1 hour');
  w := tests.act(a1, 'poll', t, '{"removed": true}', p_again, now() - interval '2 hours');
  perform pg_temp.mkpoll(t, p_late, a1, closes => now() - interval '1 minute', at => now() - interval '2 hours');
  perform tests.act(a1, 'poll_close', t, '{"by": "author"}', pg_temp.mkpoll(t, p_shut, a1, at => now() - interval '2 hours'), now() - interval '1 hour');
  perform tests.become(ann);
  -- null keeps the poll: an edit of the words writes an edit and no poll.
  perform edit_post(p_keep, a1, 'Keep, edited.');
  perform edit_post(p_keep, a1, 'Keep, edited again.', null);
  if pg_temp.polls_on(p_keep) is distinct from 1 then raise exception 'an edit with no poll wrote or removed one'; end if;
  -- An object sets one: a newer poll, which is now the post's, and the old is replaced (a ballot on it is refused: below).
  perform edit_post(p_set, a1, 'Set, edited.', fresh);
  cur := (pg_temp.latest(p_set) ->> 'id')::uuid;
  if cur = s or pg_temp.latest(p_set) -> 'payload' ->> 'question' is distinct from 'Edited poll?' then raise exception 'an edit with a poll did not set it'; end if;
  if pg_temp.polls_on(p_set) is distinct from 2 then raise exception 'the replaced poll is gone (Acts are never edited in place)'; end if;
  -- {"removed": true} removes it: the latest poll Act is a removal.
  perform edit_post(p_rm, a1, 'Remove, edited.', '{"removed": true}');
  if pg_temp.latest(p_rm) -> 'payload' is distinct from '{"removed": true}'::jsonb then raise exception 'an edit with {"removed": true} did not remove the poll'; end if;
  -- A removal of a poll the post has not got writes nothing, and a poll may be added to a post that has none, or whose poll was removed.
  before_polls := pg_temp.polls_on(p_none);
  perform edit_post(p_none, a1, 'None, edited.', '{"removed": true}');
  if pg_temp.polls_on(p_none) is distinct from before_polls then raise exception 'a removal on a post with no poll wrote an Act'; end if;
  perform edit_post(p_none, a1, 'None, now with one.', fresh);
  if pg_temp.polls_on(p_none) is distinct from 1 then raise exception 'a poll was not added to a post that had none'; end if;
  perform edit_post(p_again, a1, 'Again, with one.', fresh);
  cur := (pg_temp.latest(p_again) ->> 'id')::uuid;
  if cur = w then raise exception 'a poll was not set on a post whose poll was removed'; end if;
  -- Once the current poll has a ballot, no poll can be set and none removed, in one sentence; nothing is written, not even the words.
  got := pg_temp.say(format('select edit_post(%L, %L, ''Ballot, edited.'', %L::jsonb)', p_ballot, a1, fresh));
  if got is distinct from 'a poll cannot change once a ballot is cast; you can still close it' then raise exception 'setting a poll that has a ballot: %', got; end if;
  got := pg_temp.say(format('select edit_post(%L, %L, ''Ballot, edited.'', ''{"removed": true}''::jsonb)', p_ballot, a1));
  if got is distinct from 'a poll cannot change once a ballot is cast; you can still close it' then raise exception 'removing a poll that has a ballot: %', got; end if;
  if pg_temp.edits_on(p_ballot) is distinct from 0 or pg_temp.polls_on(p_ballot) is distinct from 1 then raise exception 'a refused edit wrote an Act'; end if;
  -- A closed poll is final, with no ballot on it too: one past its time and one its author closed can be neither replaced nor removed, and the words still edit.
  got := pg_temp.say(format('select edit_post(%L, %L, ''Late, edited.'', %L::jsonb)', p_late, a1, fresh));
  if got is distinct from 'a closed poll cannot change' then raise exception 'setting a poll over one past its time: %', got; end if;
  got := pg_temp.say(format('select edit_post(%L, %L, ''Late, edited.'', ''{"removed": true}''::jsonb)', p_late, a1));
  if got is distinct from 'a closed poll cannot change' then raise exception 'removing a poll past its time: %', got; end if;
  got := pg_temp.say(format('select edit_post(%L, %L, ''Shut, edited.'', %L::jsonb)', p_shut, a1, fresh));
  if got is distinct from 'a closed poll cannot change' then raise exception 'setting a poll over one its author closed: %', got; end if;
  got := pg_temp.say(format('select edit_post(%L, %L, ''Shut, edited.'', ''{"removed": true}''::jsonb)', p_shut, a1));
  if got is distinct from 'a closed poll cannot change' then raise exception 'removing a poll its author closed: %', got; end if;
  if pg_temp.polls_on(p_late) is distinct from 1 or pg_temp.polls_on(p_shut) is distinct from 1 or pg_temp.edits_on(p_late) is distinct from 0 then raise exception 'a refused edit of a closed poll wrote an Act'; end if;
  perform edit_post(p_late, a1, 'Late, words only.');
  -- The words still edit, with the poll left alone; a poll can still be closed.
  perform edit_post(p_ballot, a1, 'Ballot, words only.');
  perform edit_post(p_ballot, a1, 'Ballot, words only, again.', null);
  if pg_temp.edits_on(p_ballot) is distinct from 2 then raise exception 'the words of a post whose poll has a ballot did not edit'; end if;
  perform close_poll(v, a1);
  -- Another player's character edits nothing, poll or no poll.
  perform tests.become(bob);
  got := pg_temp.say(format('select edit_post(%L, %L, ''Hijack.'', %L::jsonb)', p_set, b1, fresh));
  if got is null then raise exception 'another player set a poll on a post'; end if;
  got := pg_temp.say(format('select edit_post(%L, %L, ''Hijack.'', %L::jsonb)', p_set, a1, fresh));
  if got is distinct from 'you do not play that character' then raise exception 'a poll set through another player''s character: %', got; end if;
  -- A poll that is bad is refused in its words, and nothing is written.
  perform tests.become(ann);
  got := pg_temp.say(format('select edit_post(%L, %L, ''Bad.'', %L::jsonb)', p_none, a1, pg_temp.draft(options => '["A"]')));
  if got is distinct from 'a poll has 2 to 10 options' then raise exception 'an edit with a bad poll: %', got; end if;
  perform tests.unbecome();
end $$;

-- ---- 5. cast_ballot ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pl5-ann'); bob uuid := tests.account('pl5-bob');
  a1 uuid := tests.character(ann, 'Pl Five Ann'); b1 uuid := tests.character(bob, 'Pl Five Bob'); b2 uuid := tests.character(bob, 'Pl Five Bobby');
  t uuid := tests.thread('Pl ballots'); sys uuid;
  p uuid := tests.post(a1, t, 'Vote.', now() - interval '3 hours');
  pl uuid := pg_temp.mkpoll(t, p, a1, at => now() - interval '2 hours');
  p3 uuid := tests.post(a1, t, 'Vote for three.', now() - interval '3 hours');
  pl3 uuid := pg_temp.mkpoll(t, p3, a1, pick => 3, at => now() - interval '2 hours');
  p_old uuid := tests.post(a1, t, 'Replaced.', now() - interval '3 hours');
  old_poll uuid := pg_temp.mkpoll(t, p_old, a1, at => now() - interval '2 hours');
  new_poll uuid := pg_temp.mkpoll(t, p_old, a1, at => now() - interval '1 hour');
  p_rm uuid := tests.post(a1, t, 'Removed.', now() - interval '3 hours');
  rm_poll uuid := pg_temp.mkpoll(t, p_rm, a1, at => now() - interval '2 hours');
  rm uuid := tests.act(a1, 'poll', t, '{"removed": true}', p_rm, now() - interval '1 hour');
  p_late uuid := tests.post(a1, t, 'Time up.', now() - interval '3 hours');
  late_poll uuid := pg_temp.mkpoll(t, p_late, a1, closes => now() - interval '1 minute', at => now() - interval '2 hours');
  p_shut uuid := tests.post(a1, t, 'Shut.', now() - interval '3 hours');
  shut_poll uuid := pg_temp.mkpoll(t, p_shut, a1, at => now() - interval '2 hours');
  shut uuid := tests.act(a1, 'poll_close', t, '{"by": "author"}', shut_poll, now() - interval '1 hour');
  ts uuid; sp uuid; spoll uuid;
  got text; res jsonb; next_before integer; last_before timestamptz; picked jsonb;
begin
  select next_seq, last_at into next_before, last_before from threads where id = t;
  -- Nobody signed in, and a character the caller does not play (the same words as post's).
  got := pg_temp.say(format('select cast_ballot(%L, %L, ''{0}'')', pl, b1));
  if got is null then raise exception 'a ballot with no session went through'; end if;
  perform tests.become(bob);
  got := pg_temp.say(format('select cast_ballot(%L, %L, ''{0}'')', pl, a1));
  if got is distinct from 'you do not play that character' then raise exception 'a ballot through another player''s character: %', got; end if;
  got := pg_temp.say(format('select cast_ballot(%L, %L, ''{0}'')', gen_random_uuid(), b1));
  if got is distinct from 'there is no such poll' then raise exception 'a ballot on nothing: %', got; end if;
  got := pg_temp.say(format('select cast_ballot(%L, %L, ''{0}'')', p, b1));
  if got is distinct from 'there is no such poll' then raise exception 'a ballot on a post: %', got; end if;
  -- A poll that is replaced or removed, and one that is closed, by its time and by its close.
  got := pg_temp.say(format('select cast_ballot(%L, %L, ''{0}'')', old_poll, b1));
  if got is distinct from 'that poll was replaced' then raise exception 'a ballot on a replaced poll: %', got; end if;
  got := pg_temp.say(format('select cast_ballot(%L, %L, ''{0}'')', rm_poll, b1));
  if got is distinct from 'that poll was replaced' then raise exception 'a ballot on a removed poll: %', got; end if;
  got := pg_temp.say(format('select cast_ballot(%L, %L, ''{0}'')', late_poll, b1));
  if got is distinct from 'that poll has closed' then raise exception 'a ballot after the poll''s time: %', got; end if;
  got := pg_temp.say(format('select cast_ballot(%L, %L, ''{0}'')', shut_poll, b1));
  if got is distinct from 'that poll has closed' then raise exception 'a ballot after the poll''s close: %', got; end if;
  -- Picks out of range, repeated, more than the poll lets, and none at all given.
  got := pg_temp.say(format('select cast_ballot(%L, %L, ''{3}'')', pl, b1));
  if got is distinct from 'pick up to 1 option' then raise exception 'a pick past the options: %', got; end if;
  got := pg_temp.say(format('select cast_ballot(%L, %L, ''{-1}'')', pl, b1));
  if got is distinct from 'pick up to 1 option' then raise exception 'a negative pick: %', got; end if;
  got := pg_temp.say(format('select cast_ballot(%L, %L, ''{0,1}'')', pl, b1));
  if got is distinct from 'pick up to 1 option' then raise exception 'two picks on a pick-one poll: %', got; end if;
  got := pg_temp.say(format('select cast_ballot(%L, %L, ''{1,1}'')', pl3, b1));
  if got is distinct from 'pick up to 3 options' then raise exception 'a repeated pick: %', got; end if;
  got := pg_temp.say(format('select cast_ballot(%L, %L, ''{0,1,2,3}'')', pl3, b1));
  if got is distinct from 'pick up to 3 options' then raise exception 'four picks: %', got; end if;
  got := pg_temp.say(format('select cast_ballot(%L, %L, null)', pl, b1));
  if got is distinct from 'pick up to 1 option' then raise exception 'no picks given: %', got; end if;
  perform tests.unbecome();
  if exists (select 1 from acts a where a.kind = 'ballot' and a.thread = t) then raise exception 'a refused ballot left an Act behind'; end if;
  if (select next_seq from threads where id = t) is distinct from next_before then raise exception 'a refused ballot moved the thread'; end if;

  -- The ballot: its picks sorted, its character and thread, no seq, no move of the thread; the projection and the counts it answers with.
  perform tests.become(bob);
  res := cast_ballot(pl3, b1, '{2,0}');
  perform tests.unbecome();
  select a.payload -> 'picks' into picked from acts a where a.kind = 'ballot' and a.target_act_id = pl3 and a.character = b1;
  if picked is distinct from '[0, 2]'::jsonb then raise exception 'the picks are not stored sorted: %', picked; end if;
  if (res -> 'act' ->> 'kind') is distinct from 'ballot' or (res -> 'act' ->> 'character')::uuid is distinct from b1 or (res ->> 'poll')::uuid is distinct from pl3 or (res ->> 'thread')::uuid is distinct from t then
    raise exception 'cast_ballot answers with the ballot, the poll and the thread: %', res;
  end if;
  if res -> 'counts' is distinct from '[1, 0, 1]'::jsonb or (res ->> 'voters')::integer is distinct from 1 or (res ->> 'closed')::boolean is not false then raise exception 'cast_ballot answers with the poll''s counts: %', res; end if;
  if (select seq from acts where id = (res -> 'act' ->> 'id')::uuid) is not null then raise exception 'a ballot has a seq'; end if;
  if (select next_seq from threads where id = t) is distinct from next_before or (select last_at from threads where id = t) is distinct from last_before then raise exception 'a ballot moved its thread (a place or its last activity)'; end if;
  -- A second character of the same account may cast its own; a withdrawal is a ballot with no picks.
  perform tests.become(bob);
  res := cast_ballot(pl3, b2, '{1}');
  if res -> 'counts' is distinct from '[1, 1, 1]'::jsonb or (res ->> 'voters')::integer is distinct from 2 then raise exception 'two characters of one account each count: %', res; end if;
  res := cast_ballot(pl, b1, '{}');
  if res -> 'counts' is distinct from '[0, 0, 0]'::jsonb or (res ->> 'voters')::integer is distinct from 0 then raise exception 'an empty ballot withdraws: %', res; end if;
  perform tests.unbecome();

  -- Where a poll is on a board only the staff post on, no player casts a ballot (the gate post runs).
  sys := (select b.id from boards b where b.slug = 'the-system');
  insert into threads (board, title) values (sys, 'Pl system thread') returning id into ts;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Pl Staff', 'pl-staff', 'persona', now()) returning id into sp;
  perform set_config('kayfabb.staff_writer', 'on', true);
  p := tests.post(sp, ts, 'The System asks.');
  spoll := pg_temp.mkpoll(ts, p, sp);
  perform set_config('kayfabb.staff_writer', '', true);
  perform tests.become(bob);
  got := pg_temp.say(format('select cast_ballot(%L, %L, ''{0}'')', spoll, b1));
  if got is distinct from 'only the staff post here; spin a thread from what they said' then raise exception 'a ballot on the System''s board: %', got; end if;
  perform tests.unbecome();
end $$;

-- 5b. The gates post runs: a banned character and a barred one are refused in the words not_banned and not_barred raise (a ban and a bar as 0127-bars-apologies.sql makes them).
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pl5b-ann'); bob uuid := tests.account('pl5b-bob');
  a1 uuid := tests.character(ann, 'Pl FiveB Ann'); banned uuid := tests.character(bob, 'Pl FiveB Banned'); barred uuid := tests.character(bob, 'Pl FiveB Barred');
  t uuid := tests.thread('Pl gates'); gen uuid := (select th.board from threads th where th.id = t);
  p uuid := tests.post(a1, t, 'Vote.', now() - interval '3 hours');
  pl uuid := pg_temp.mkpoll(t, p, a1, at => now() - interval '2 hours');
  bp uuid := tests.post(banned, t, 'A post that earned it.', now() - interval '3 hours');
  inf uuid; boss uuid; mv uuid; got text; want text;
begin
  -- A one-day ban of `banned`.
  perform set_config('kayfabb.warn_writer', 'on', true);
  inf := tests.act(null, 'infraction', t, jsonb_build_object('character', banned, 'band', 'minor', 'points', 2, 'rule_number', null, 'board', gen, 'about_act', bp, 'visit_act', null, 'staff', 'pl-boss', 'expires_at', now() + interval '14 days'));
  perform tests.act(null, 'ban', t, jsonb_build_object('character', banned, 'days', 1, 'until', now() + interval '1 day', 'infraction_act', inf, 'season', 1));
  perform set_config('kayfabb.warn_writer', '', true);
  -- A bar of `barred` from the poll's board: a conferred group's move in force, with an expiry.
  insert into move_kinds (key, structural) values ('conferGroup', false) on conflict (key) do nothing;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Pl Boss', 'pl-boss', 'persona', now()) returning id into boss;
  perform set_config('kayfabb.staff_writer', 'on', true);
  mv := tests.act(boss, 'move', t, jsonb_build_object('kind', 'conferGroup', 'body', 'Barred.', 'params', jsonb_build_object('character', barred::text, 'group', 'trialMembers', 'board', gen::text), 'expires_at', now() + interval '3 days'));
  perform set_config('kayfabb.staff_writer', '', true);
  perform tests.become(bob);
  got := pg_temp.say(format('select cast_ballot(%L, %L, ''{0}'')', pl, banned));
  want := format('this character is banned until %s UTC; the ban ends by itself then, and it holds only this character, not your other characters',
    to_char(date_trunc('minute', banned_until(banned) + interval '59.999999 seconds') at time zone 'UTC', 'YYYY-MM-DD HH24:MI'));
  if got is distinct from want then raise exception 'a ballot by a banned character: got %, wanted %', got, want; end if;
  got := pg_temp.say(format('select cast_ballot(%L, %L, ''{0}'')', pl, barred));
  want := format('Pl FiveB Barred is barred from posting on %s until %s UTC', (select n.name from boards_now n where n.id = gen),
    to_char(date_trunc('minute', move_expires_at(mv) + interval '59.999999 seconds') at time zone 'UTC', 'YYYY-MM-DD HH24:MI'));
  if got is distinct from want then raise exception 'a ballot by a barred character: got %, wanted %', got, want; end if;
  perform tests.unbecome();
  if pg_temp.polls_on(p) is distinct from 1 or exists (select 1 from acts a where a.kind = 'ballot' and a.target_act_id = pl) then raise exception 'a refused ballot left an Act behind'; end if;
end $$;

-- 5c. The least a poll may last is held against the most, whichever is written (settings_held): a least past the most, and a most under the least, are refused; the pair is taken in either order when it is whole.
select tests.unbecome();
do $$
declare got text;
begin
  got := pg_temp.say('update settings set value = ''{"unit": "month", "count": 1000}'' where key = ''pollLastsMin''');
  if got is distinct from 'pollLastsMin is a span no longer than pollLastsMax' then raise exception 'a least past the most: %', got; end if;
  update settings set value = '{"unit": "day", "count": 5}' where key = 'pollLastsMin';
  got := pg_temp.say('update settings set value = ''{"unit": "hour", "count": 2}'' where key = ''pollLastsMax''');
  if got is distinct from 'pollLastsMax is a span no shorter than pollLastsMin' then raise exception 'a most under the least: %', got; end if;
  update settings set value = '{"unit": "day", "count": 5}' where key = 'pollLastsMax';
  update settings set value = '{"unit": "week", "count": 2}' where key = 'pollLastsMax';
end $$;

-- ---- 6. What a poll counts ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pl6-ann'); bob uuid := tests.account('pl6-bob'); cat uuid := tests.account('pl6-cat');
  a1 uuid := tests.character(ann, 'Pl Six Ann'); a2 uuid := tests.character(ann, 'Pl Six Anna'); b1 uuid := tests.character(bob, 'Pl Six Bob'); c1 uuid := tests.character(cat, 'Pl Six Cat');
  t uuid := tests.thread('Pl counts');
  p uuid := tests.post(a1, t, 'Vote.', now() - interval '5 hours');
  pl uuid := pg_temp.mkpoll(t, p, a1, closes => now() + interval '1 day', at => now() - interval '4 hours');
  p3 uuid := tests.post(a1, t, 'Vote for three.', now() - interval '5 hours');
  pl3 uuid := pg_temp.mkpoll(t, p3, a1, pick => 3, closes => now() + interval '1 day', at => now() - interval '4 hours');
  ps uuid := tests.post(a1, t, 'Secret vote.', now() - interval '5 hours');
  pls uuid := pg_temp.mkpoll(t, ps, a1, secret => true, closes => now() + interval '1 day', at => now() - interval '4 hours');
  pe uuid := tests.post(a1, t, 'Ends.', now() - interval '5 hours');
  ple uuid := pg_temp.mkpoll(t, pe, a1, closes => now() - interval '1 hour', at => now() - interval '4 hours');
  pc uuid := tests.post(a1, t, 'Closed early.', now() - interval '5 hours');
  plc uuid := pg_temp.mkpoll(t, pc, a1, closes => now() + interval '1 day', at => now() - interval '4 hours');
  closed_at timestamptz := now() - interval '2 hours';
  row_ record; mine jsonb; theirs jsonb;
begin
  -- Each character's latest ballot counts; a change moves it, a withdrawal takes the character out of the voters.
  perform pg_temp.vote(pl, a1, '[0]', now() - interval '3 hours');
  perform pg_temp.vote(pl, b1, '[1]', now() - interval '3 hours');
  perform pg_temp.vote(pl, c1, '[1]', now() - interval '3 hours');
  if pg_temp.counts(pl) is distinct from '{"counts": [1, 2, 0], "voters": 3, "closed": false}'::jsonb then raise exception 'counts of three ballots: %', pg_temp.counts(pl); end if;
  perform pg_temp.vote(pl, b1, '[2]', now() - interval '2 hours');
  if pg_temp.counts(pl) is distinct from '{"counts": [1, 1, 1], "voters": 3, "closed": false}'::jsonb then raise exception 'a changed ballot does not move the character''s pick: %', pg_temp.counts(pl); end if;
  perform pg_temp.vote(pl, c1, '[]', now() - interval '1 hour');
  if pg_temp.counts(pl) is distinct from '{"counts": [1, 0, 1], "voters": 2, "closed": false}'::jsonb then raise exception 'a withdrawal does not take the character out of the voters: %', pg_temp.counts(pl); end if;
  -- A ballot out of order in time is read by created_at, and a ballot after a withdrawal counts again.
  perform pg_temp.vote(pl, c1, '[0]', now() - interval '30 minutes');
  perform pg_temp.vote(pl, a1, '[2]', now() - interval '3 hours 30 minutes');
  if pg_temp.counts(pl) is distinct from '{"counts": [2, 0, 1], "voters": 3, "closed": false}'::jsonb then raise exception 'a late-written ballot older than the character''s latest is counted, or a ballot after a withdrawal is not: %', pg_temp.counts(pl); end if;
  -- Picks count per option, and voters count characters.
  perform pg_temp.vote(pl3, a1, '[0, 1]', now() - interval '3 hours');
  perform pg_temp.vote(pl3, b1, '[1, 2]', now() - interval '3 hours');
  if pg_temp.counts(pl3) is distinct from '{"counts": [1, 2, 1], "voters": 2, "closed": false}'::jsonb then raise exception 'counts of picks: %', pg_temp.counts(pl3); end if;
  -- Two characters of one player each count, and a secret poll's counts are of characters, not of the account.
  perform pg_temp.vote(pls, a1, '[0]', now() - interval '3 hours');
  perform pg_temp.vote(pls, a2, '[0]', now() - interval '3 hours');
  perform pg_temp.vote(pls, b1, '[1]', now() - interval '3 hours');
  if pg_temp.counts(pls) is distinct from '{"counts": [2, 1, 0], "voters": 3, "closed": false}'::jsonb then raise exception 'a secret poll counts the account, not the characters: %', pg_temp.counts(pls); end if;
  -- A poll past its time is closed, counts the ballots before it, and not one at or after it.
  perform pg_temp.vote(ple, a1, '[0]', now() - interval '2 hours');
  perform pg_temp.vote(ple, b1, '[1]', now() - interval '30 minutes');
  if pg_temp.counts(ple) is distinct from '{"counts": [1, 0, 0], "voters": 1, "closed": true}'::jsonb then raise exception 'a poll past its time counts a ballot after it: %', pg_temp.counts(ple); end if;
  if (select c.ends_at from poll_counts c where c.poll = ple) is distinct from now() - interval '1 hour' then raise exception 'a poll ends at its closes_at'; end if;
  -- A close ends it early, by its created_at: a ballot made in the transaction a close commits after (so written before the close is seen, but created later) is not counted; one created before it is, though written after.
  perform tests.act(a1, 'poll_close', t, '{"by": "author"}', plc, closed_at);
  perform pg_temp.vote(plc, a1, '[0]', closed_at - interval '1 minute');
  perform pg_temp.vote(plc, b1, '[1]', closed_at + interval '1 minute');
  perform pg_temp.vote(plc, c1, '[2]', closed_at);
  if pg_temp.counts(plc) is distinct from '{"counts": [1, 0, 0], "voters": 1, "closed": true}'::jsonb then raise exception 'a ballot created after the close is counted, or one created before it is not: %', pg_temp.counts(plc); end if;
  if (select c.ends_at from poll_counts c where c.poll = plc) is distinct from closed_at then raise exception 'a poll closed early ends at its close'; end if;
  -- A close after the poll's own time does not lengthen it: the earlier of the two is the end.
  perform tests.act(a1, 'poll_close', t, '{"by": "author"}', ple, now() - interval '10 minutes');
  if (select c.ends_at from poll_counts c where c.poll = ple) is distinct from now() - interval '1 hour' then raise exception 'a close after closes_at moved the end'; end if;
  -- Every poll has a row, one each, whatever the caller; the replaced and the removed are not counted as live polls, and no row names a character or an owner.
  if (select count(*) from poll_counts c where c.poll in (pl, pl3, pls, ple, plc)) is distinct from 5 then raise exception 'poll_counts has not one row per poll'; end if;
  perform tests.become(ann);
  select to_jsonb(c) into mine from poll_counts c where c.poll = pls;
  perform tests.become(cat);
  select to_jsonb(c) into theirs from poll_counts c where c.poll = pls;
  perform tests.unbecome();
  if mine is distinct from theirs then raise exception 'poll_counts differs by caller: % / %', mine, theirs; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(mine) k) is distinct from array['closed', 'counts', 'ends_at', 'poll', 'voters'] then raise exception 'poll_counts carries more or less than {poll, counts, voters, ends_at, closed}: %', mine; end if;
end $$;

-- ---- 6b. poll_latest_ballots: the row each character's latest ballot is kept in ----
-- Every ballot Act is kept by the trigger in the row of its (poll, character), the later (created_at, id) winning whatever order they were written in; the row is what the ballot Acts say (rebuild_poll_latest_ballots computes it
-- again from them); a character whose latest ballot was created after the poll's end is counted by its latest before it; and no API role can read the row, which says who voted on a secret poll.
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pl6b-ann'); bob uuid := tests.account('pl6b-bob');
  a1 uuid := tests.character(ann, 'Pl SixB Ann'); b1 uuid := tests.character(bob, 'Pl SixB Bob');
  t uuid := tests.thread('Pl latest');
  p uuid := tests.post(a1, t, 'Vote.', now() - interval '5 hours');
  pl uuid := pg_temp.mkpoll(t, p, a1, closes => now() + interval '1 day', at => now() - interval '4 hours');
  p2 uuid := tests.post(a1, t, 'Vote, closed early.', now() - interval '5 hours');
  plc uuid := pg_temp.mkpoll(t, p2, a1, closes => now() + interval '1 day', at => now() - interval '4 hours');
  closed_at timestamptz := now() - interval '2 hours';
  newest uuid; kept record; before_n bigint; voters uuid[]; first_id uuid;
begin
  -- The later (created_at, id) wins whichever was written first: the newer ballot is written first, an older one after it, and the row stays the newer.
  newest := pg_temp.vote(pl, a1, '[1]', now() - interval '1 hour');
  perform pg_temp.vote(pl, a1, '[0]', now() - interval '3 hours');
  select * into kept from poll_latest_ballots r where r.poll = pl and r."character" = a1;
  if kept.act is distinct from newest or kept.picks is distinct from '[1]'::jsonb then raise exception 'an older ballot written after a newer one replaced the character''s row: %', to_jsonb(kept); end if;
  -- A newer ballot replaces it, and there is one row for the character, however many ballots it cast.
  newest := pg_temp.vote(pl, a1, '[]', now() - interval '30 minutes');
  select * into kept from poll_latest_ballots r where r.poll = pl and r."character" = a1;
  if kept.act is distinct from newest or kept.picks is distinct from '[]'::jsonb or (select count(*) from poll_latest_ballots r where r.poll = pl) is distinct from 1::bigint then raise exception 'a newer ballot did not replace the character''s row: %', to_jsonb(kept); end if;
  -- Two ballots at the same time: the greater id wins, written in either order.
  perform tests.act(b1, 'ballot', t, '{"picks": [2]}', pl, now() - interval '10 minutes');
  select r.act into first_id from poll_latest_ballots r where r.poll = pl and r."character" = b1;
  if first_id is distinct from (select b.id from acts b where b.kind = 'ballot' and b.target_act_id = pl and b."character" = b1 order by b.created_at desc, b.id desc limit 1) then raise exception 'the row is not the latest ballot by (created_at, id)'; end if;
  -- A character with a ballot before a poll's close and another created after it: the one before counts, and the voter list names it.
  perform tests.act(a1, 'poll_close', t, '{"by": "author"}', plc, closed_at);
  perform pg_temp.vote(plc, b1, '[0]', closed_at - interval '2 minutes');
  perform pg_temp.vote(plc, b1, '[1]', closed_at + interval '1 minute');
  if pg_temp.counts(plc) is distinct from '{"counts": [1, 0, 0], "voters": 1, "closed": true}'::jsonb then raise exception 'a character''s ballot before the close is not counted when it also has one after: %', pg_temp.counts(plc); end if;
  voters := array(select poll_voter_acts(plc, closed_at, 50));
  if voters is distinct from array[(select b.id from acts b where b.kind = 'ballot' and b.target_act_id = plc and b.created_at < closed_at)] then raise exception 'the voter list does not name the ballot before the close: %', voters; end if;
  -- The row is what the ballot Acts say: computed again from them, it is the same rows.
  select count(*) into before_n from poll_latest_ballots;
  if (select count(*) from (select * from poll_latest_ballots except select b.target_act_id, b."character", b.id, b.payload -> 'picks', b.created_at from (select distinct on (x.target_act_id, x."character") x.* from acts x where x.kind = 'ballot' order by x.target_act_id, x."character", x.created_at desc, x.id desc) b) d) is distinct from 0::bigint then raise exception 'a row of poll_latest_ballots is not the latest ballot of its character'; end if;
  if rebuild_poll_latest_ballots() is distinct from before_n then raise exception 'rebuilding the rows from the ballots gave another number of rows than the trigger kept (%)', before_n; end if;
  if (select count(*) from poll_latest_ballots) is distinct from before_n then raise exception 'rebuilding changed the row count'; end if;
  -- The caller's own latest ballot on each poll, and nobody else's.
  perform tests.become(bob);
  if (select count(*) from my_latest_ballots) is distinct from 2::bigint or exists (select 1 from my_latest_ballots m where m."character" = a1) then raise exception 'my_latest_ballots is not the caller''s own latest ballots: %', (select jsonb_agg(to_jsonb(m)) from my_latest_ballots m); end if;
  perform tests.unbecome();
  -- No API role reads it, nor runs the functions that keep it.
  perform tests.become(ann);
  if pg_temp.say('select * from poll_latest_ballots') is null then raise exception 'a signed-in player reads poll_latest_ballots, which says who voted on a secret poll'; end if;
  if pg_temp.say('select rebuild_poll_latest_ballots()') is null then raise exception 'a signed-in player runs rebuild_poll_latest_ballots'; end if;
  perform tests.unbecome();
  if not (select c.relrowsecurity from pg_class c where c.oid = 'poll_latest_ballots'::regclass) then raise exception 'poll_latest_ballots has no row level security'; end if;
  if exists (select 1 from pg_policy where polrelid = 'poll_latest_ballots'::regclass) then raise exception 'poll_latest_ballots has a policy'; end if;
end $$;

-- ---- 7. Closing ----
create function pg_temp.close_of(on_poll uuid) returns jsonb language sql security definer as $$ select a.payload from acts a where a.kind = 'poll_close' and a.target_act_id = on_poll $$;
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pl7-ann'); bob uuid := tests.account('pl7-bob'); boss uuid := tests.account('pl7-boss');
  a1 uuid := tests.character(ann, 'Pl Seven Ann'); b1 uuid := tests.character(bob, 'Pl Seven Bob'); a2 uuid := tests.character(ann, 'Pl Seven Anna');
  t uuid := tests.thread('Pl closes');
  p1 uuid := tests.post(a1, t, 'One.', now() - interval '3 hours'); p2 uuid := tests.post(a1, t, 'Two.', now() - interval '3 hours'); p3 uuid := tests.post(a1, t, 'Three.', now() - interval '3 hours');
  p4 uuid := tests.post(a1, t, 'Four.', now() - interval '3 hours'); p5 uuid := tests.post(a1, t, 'Five.', now() - interval '3 hours');
  o1 uuid := pg_temp.mkpoll(t, p1, a1, at => now() - interval '2 hours'); o2 uuid := pg_temp.mkpoll(t, p2, a1, at => now() - interval '2 hours');
  o3 uuid := pg_temp.mkpoll(t, p3, a1, at => now() - interval '2 hours'); o4 uuid := pg_temp.mkpoll(t, p4, a1, at => now() - interval '2 hours', closes => now() - interval '1 minute');
  o5a uuid := pg_temp.mkpoll(t, p5, a1, at => now() - interval '2 hours'); o5 uuid := pg_temp.mkpoll(t, p5, a1, at => now() - interval '1 hour');
  res jsonb; got text;
begin
  perform tests.become(ann);
  -- The author's own character closes: the close is its Act, in the poll's thread, and the poll is closed at once.
  res := close_poll(o1, a1);
  if res -> 'act' ->> 'kind' is distinct from 'poll_close' or (res -> 'act' ->> 'character')::uuid is distinct from a1 or (res ->> 'poll')::uuid is distinct from o1 or (res ->> 'thread')::uuid is distinct from t or (res ->> 'closed')::boolean is not true then
    raise exception 'close_poll answers: %', res;
  end if;
  if pg_temp.close_of(o1) is distinct from '{"by": "author"}'::jsonb then raise exception 'the author''s close does not say so'; end if;
  got := pg_temp.say(format('select cast_ballot(%L, %L, ''{0}'')', o1, a2));
  if got is distinct from 'that poll has closed' then raise exception 'a ballot after the author closed the poll: %', got; end if;
  -- It refuses a poll already closed (by its time or by a close), replaced, or removed; a character that is not the poll's, and one the caller does not play.
  got := pg_temp.say(format('select close_poll(%L, %L)', o1, a1));
  if got is distinct from 'that poll has closed' then raise exception 'a second close: %', got; end if;
  got := pg_temp.say(format('select close_poll(%L, %L)', o4, a1));
  if got is distinct from 'that poll has closed' then raise exception 'a close of a poll past its time: %', got; end if;
  got := pg_temp.say(format('select close_poll(%L, %L)', o5a, a1));
  if got is distinct from 'that poll was replaced' then raise exception 'a close of a replaced poll: %', got; end if;
  got := pg_temp.say(format('select close_poll(%L, %L)', o2, a2));
  if got is distinct from 'only a poll''s author can close it' then raise exception 'a close through another of the player''s characters: %', got; end if;
  got := pg_temp.say(format('select close_poll(%L, %L)', o2, b1));
  if got is distinct from 'you do not play that character' then raise exception 'a close through a character the caller does not play: %', got; end if;
  perform tests.unbecome();
  -- Another player's character that is not the author's is refused for it.
  perform tests.become(bob);
  got := pg_temp.say(format('select close_poll(%L, %L)', o2, b1));
  if got is distinct from 'only a poll''s author can close it' then raise exception 'another player closing a poll: %', got; end if;
  -- An admin's close is for an admin alone.
  got := pg_temp.say(format('select close_poll_as_admin(%L)', o2));
  if got is distinct from 'only an admin closes a poll' then raise exception 'a close as admin by a player: %', got; end if;
  perform tests.unbecome();
  insert into admins (account) values (boss);
  perform tests.become(boss);
  res := close_poll_as_admin(o2);
  if res -> 'act' ->> 'kind' is distinct from 'poll_close' or res -> 'act' ->> 'character' is not null or (res ->> 'poll')::uuid is distinct from o2 or (res ->> 'closed')::boolean is not true then raise exception 'close_poll_as_admin answers: %', res; end if;
  if pg_temp.close_of(o2) is distinct from '{"by": "admin"}'::jsonb then raise exception 'the admin''s close does not say so'; end if;
  got := pg_temp.say(format('select close_poll_as_admin(%L)', o2));
  if got is distinct from 'that poll has closed' then raise exception 'an admin closing a closed poll: %', got; end if;
  got := pg_temp.say(format('select close_poll_as_admin(%L)', o5a));
  if got is distinct from 'that poll was replaced' then raise exception 'an admin closing a replaced poll: %', got; end if;
  got := pg_temp.say(format('select close_poll_as_admin(%L)', gen_random_uuid()));
  if got is distinct from 'there is no such poll' then raise exception 'an admin closing nothing: %', got; end if;
  -- An admin closes a poll whose post has had its poll removed: refused as replaced.
  perform tests.unbecome();
  perform tests.act(a1, 'poll', t, '{"removed": true}', p3, now() - interval '30 minutes');
  perform tests.become(boss);
  got := pg_temp.say(format('select close_poll_as_admin(%L)', o3));
  if got is distinct from 'that poll was replaced' then raise exception 'an admin closing a removed poll: %', got; end if;
  perform tests.unbecome();
end $$;

-- ---- 8. The masks: a secret ballot ----
select tests.unbecome();
do $$
declare
  ann uuid := tests.account('pl8-ann'); bob uuid := tests.account('pl8-bob'); cat uuid := tests.account('pl8-cat');
  a1 uuid := tests.character(ann, 'Pl Eight Ann'); b1 uuid := tests.character(bob, 'Pl Eight Bob'); b2 uuid := tests.character(bob, 'Pl Eight Bobby'); c1 uuid := tests.character(cat, 'Pl Eight Cat');
  t uuid := tests.thread('Pl masks');
  p uuid := tests.post(a1, t, 'Secret.', now() - interval '3 hours'); pp uuid := tests.post(a1, t, 'Public.', now() - interval '3 hours');
  sec uuid := pg_temp.mkpoll(t, p, a1, secret => true, pick => 2, at => now() - interval '2 hours'); pub uuid := pg_temp.mkpoll(t, pp, a1, secret => false, pick => 2, at => now() - interval '2 hours');
  sb uuid; pb uuid; res jsonb; row_ jsonb; seen_a jsonb; seen_b jsonb; seen_c jsonb; n integer;
begin
  perform tests.become(bob);
  res := cast_ballot(sec, b1, '{0,2}');
  sb := (res -> 'act' ->> 'id')::uuid;
  -- What cast_ballot answers on a secret poll names no character and no picks, and the event is built from it.
  if res -> 'act' ->> 'character' is not null or res -> 'act' -> 'payload' is distinct from '{"secret": true}'::jsonb or res -> 'act' -> 'current_payload' is distinct from '{"secret": true}'::jsonb then
    raise exception 'the answer to a secret ballot names its character or its picks: %', res;
  end if;
  if res::text like '%' || b1::text || '%' or res::text like '%"picks"%' then raise exception 'the answer to a secret ballot holds the character or the picks somewhere: %', res; end if;
  pb := (cast_ballot(pub, b1, '{1}') -> 'act' ->> 'id')::uuid;
  perform cast_ballot(sec, b2, '{1}');
  perform tests.unbecome();
  -- acts_public, for every caller alike: the author's owner, another player, a third; the secret ballot reads with a null character and no picks, the public one with both.
  perform tests.become(bob);  select to_jsonb(x) into seen_a from acts_public x where x.id = sb;
  perform tests.become(ann);  select to_jsonb(x) into seen_b from acts_public x where x.id = sb;
  perform tests.become(cat);  select to_jsonb(x) into seen_c from acts_public x where x.id = sb;
  perform tests.unbecome();
  if seen_a is distinct from seen_b or seen_b is distinct from seen_c then raise exception 'a secret ballot reads differently by caller: % / % / %', seen_a, seen_b, seen_c; end if;
  if seen_a ->> 'character' is not null or seen_a -> 'payload' is distinct from '{"secret": true}'::jsonb or seen_a -> 'current_payload' is distinct from '{"secret": true}'::jsonb then raise exception 'a secret ballot is shown with its character or picks: %', seen_a; end if;
  if seen_a ->> 'kind' is distinct from 'ballot' or (seen_a ->> 'target_act_id')::uuid is distinct from sec or (seen_a ->> 'thread')::uuid is distinct from t then raise exception 'a secret ballot loses its kind or its poll: %', seen_a; end if;
  if seen_a::text like '%' || b1::text || '%' or seen_a::text like '%"picks"%' then raise exception 'a secret ballot names its character or its picks somewhere in its row: %', seen_a; end if;
  select to_jsonb(x) into seen_a from acts_public x where x.id = pb;
  if (seen_a ->> 'character')::uuid is distinct from b1 or seen_a -> 'payload' is distinct from '{"picks": [1]}'::jsonb then raise exception 'a public ballot hides its character or its picks: %', seen_a; end if;
  -- The poll itself, and the counts, are public and the same for everyone.
  select count(*) into n from acts_public x where x.kind = 'ballot' and x.target_act_id = sec and x."character" is not null;
  if n is distinct from 0 then raise exception 'a secret ballot was shown with a character (% of them)', n; end if;
  -- my_ballots: the caller's own, with the character and the picks, and nobody else's.
  perform tests.become(bob);
  select to_jsonb(m) into row_ from my_ballots m where m.act = sb;
  if row_ is null or (row_ ->> 'character')::uuid is distinct from b1 or row_ -> 'picks' is distinct from '[0, 2]'::jsonb or (row_ ->> 'poll')::uuid is distinct from sec then raise exception 'my_ballots does not give the owner their secret ballot: %', row_; end if;
  if (select count(*) from my_ballots) is distinct from 3 then raise exception 'my_ballots is not the owner''s three ballots: %', (select count(*) from my_ballots); end if;
  if (select array_agg(k order by k) from jsonb_object_keys(row_) k) is distinct from array['act', 'character', 'created_at', 'picks', 'poll'] then raise exception 'my_ballots carries more or less than {act, poll, character, picks, created_at}: %', row_; end if;
  perform tests.become(ann);
  if exists (select 1 from my_ballots) then raise exception 'my_ballots gave a player a ballot that is not theirs'; end if;
  perform tests.become(cat);
  if exists (select 1 from my_ballots m where m.act = sb) then raise exception 'my_ballots gave another account the secret ballot'; end if;
  perform tests.unbecome();
  -- poll_counts is of characters: two ballots of one account on the secret poll are two voters.
  if pg_temp.counts(sec) is distinct from '{"counts": [1, 1, 1], "voters": 2, "closed": false}'::jsonb then raise exception 'the secret poll''s counts: %', pg_temp.counts(sec); end if;
  -- The Realtime row and the digest read acts_public too: no other view or function hands out the character (the migration's header lists each reader of acts by character).
  if has_column_privilege('authenticated', 'acts', 'character', 'select') then raise exception 'the API roles read acts.character directly'; end if;
end $$;

-- ---- 9. The guards ----
select tests.unbecome();
create function pg_temp.stand() returns uuid language plpgsql as $$
declare made uuid;
begin
  select c.id into made from characters c where c.staff_kind = 'anonymous';
  if made is not null then return made; end if;
  insert into characters (name, staff, staff_kind, debuted_at) values ('Anonymous', 'anonymous', 'anonymous', now()) returning characters.id into made;
  insert into character_profiles (character, title, signature) values (made, 'Could be anyone.', '');
  return made;
end $$;

-- A veil on a post, as land_rows writes it beside its play (0321's helper): the play is a card of the caster's on the post, and the row names the post's author.
create function pg_temp.veil(on_post uuid, in_thread uuid, author uuid, caster uuid, caster_acct uuid, layer integer) returns uuid language plpgsql as $$
declare play uuid;
begin
  play := tests.act(caster, 'card', in_thread, jsonb_build_object('card', 'plveil', 'message', '', 'config', '{}'::jsonb, 'layer', layer, 'ends', now() + interval '3 days'), on_post, now() - interval '1 hour');
  insert into post_veils (play, post, veil, author, caster_account, ends_at) values (play, on_post, 'author', author, caster_acct, now() + interval '3 days');
  return play;
end $$;

do $$
declare
  ann uuid := tests.account('pl9-ann'); bob uuid := tests.account('pl9-bob'); cat uuid := tests.account('pl9-cat');
  a1 uuid := tests.character(ann, 'Pl Nine Ann'); b1 uuid := tests.character(bob, 'Pl Nine Bob'); c1 uuid := tests.character(cat, 'Pl Nine Cat');
  s1 constant timestamptz := (select min(starts_at) from seasons);
  w0 timestamptz; w1 timestamptz;
  t uuid := tests.thread('Pl guards');
  p uuid; pl uuid; pls uuid; sb uuid; pb uuid; cl uuid; ps uuid;
  got text; input jsonb; est jsonb; spun jsonb; stand uuid; pr uuid; plr1 uuid; plr2 uuid;
  veiled_post uuid; veiled_secret uuid; vpoll uuid; vspoll uuid; vb_before uuid; vb_after uuid; vb_other uuid; vsb_before uuid; vsb_after uuid;
begin
  if not exists (select 1 from settlements) then
    perform set_config('role', 'service_role', true);
    perform apply_settlement(s1, s1 + interval '1 day', '[]');
    perform tests.unbecome();
  end if;
  w0 := (select max(ends_at) from settlements); w1 := w0 + interval '1 day';
  p := tests.post(a1, t, 'Vote.', w0 + interval '1 hour');
  pl := pg_temp.mkpoll(t, p, a1, closes => w1 + interval '1 day', at => w0 + interval '2 hours');
  ps := tests.post(a1, t, 'Secret vote.', w0 + interval '1 hour');
  pls := pg_temp.mkpoll(t, ps, a1, secret => true, closes => w1 + interval '1 day', at => w0 + interval '2 hours');
  pb := pg_temp.vote(pl, b1, '[0]', w0 + interval '3 hours');
  sb := pg_temp.vote(pls, b1, '[1]', w0 + interval '3 hours');
  cl := tests.act(a1, 'poll_close', t, '{"by": "author"}', pl, w0 + interval '4 hours');

  -- A reaction to a poll, a ballot or a close is refused, in the words that send the reaction to the post.
  perform tests.become(cat);
  got := pg_temp.say(format('select react(%L, %L, ''up'')', pl, c1));
  if got is distinct from 'a poll is not reacted to; react to the post' then raise exception 'a reaction to a poll: %', got; end if;
  got := pg_temp.say(format('select react(%L, %L, ''up'')', pb, c1));
  if got is distinct from 'a poll is not reacted to; react to the post' then raise exception 'a reaction to a ballot: %', got; end if;
  got := pg_temp.say(format('select react(%L, %L, ''up'')', cl, c1));
  if got is distinct from 'a poll is not reacted to; react to the post' then raise exception 'a reaction to a close: %', got; end if;
  perform react(p, c1, 'up');
  perform tests.unbecome();
  if exists (select 1 from reactions r where r.act in (pl, pb, cl, sb)) then raise exception 'a reaction landed on a poll, a ballot or a close'; end if;

  -- The settlement and the estimate hold no poll, ballot or close: the post and its reaction are there, and nothing of the poll.
  input := settlement_input(w0, w1);
  if not exists (select 1 from jsonb_array_elements(input -> 'acts') e where e ->> 'id' = p::text) then raise exception 'the post is not in the settlement''s input'; end if;
  if exists (select 1 from jsonb_array_elements(input -> 'acts') e where (e ->> 'id')::uuid in (pl, pls, pb, sb, cl)) or exists (select 1 from jsonb_array_elements(input -> 'acts') e where e ->> 'kind' in ('poll', 'ballot', 'poll_close')) then
    raise exception 'settlement_input holds a poll, a ballot or a close: %', input -> 'acts';
  end if;
  if input::text like '%' || sb::text || '%' or input::text like '%' || pb::text || '%' then raise exception 'settlement_input names a ballot'; end if;
  perform tests.become_service();
  est := estimate_input(bob, w0 + interval '8 hours');
  if est is null or est::text like '%' || sb::text || '%' or est::text like '%' || pb::text || '%' or est::text like '%"ballot"%' or est::text like '%"poll_close"%' then raise exception 'estimate_input holds a ballot: %', est; end if;
  est := estimate_input(ann, w0 + interval '8 hours');
  if est is null or est::text like '%' || pl::text || '%' or est::text like '%"poll"%' then raise exception 'estimate_input holds a poll: %', est; end if;
  perform tests.unbecome();

  -- A spin: of a close is refused, of a replaced or removed poll is refused, of a secret ballot is refused; of a public ballot and of a poll is written.
  perform tests.become(cat);
  got := pg_temp.say(format('select spin(%L, %L, ''A spin'', ''Discuss.'')', cl, c1));
  if got is distinct from 'spin the poll' then raise exception 'a spin of a close: %', got; end if;
  got := pg_temp.say(format('select spin(%L, %L, ''A spin'', ''Discuss.'')', sb, c1));
  if got is distinct from 'a secret ballot cannot be spun' then raise exception 'a spin of a secret ballot: %', got; end if;
  spun := spin(pl, c1, 'About the poll', 'Discuss.');
  if (spun -> 'act' ->> 'kind') is distinct from 'spin' or not exists (select 1 from threads x where x.origin_act_id = pl) then raise exception 'a spin of a poll was not written: %', spun; end if;
  spun := spin(pb, c1, 'About the ballot', 'Discuss.');
  if not exists (select 1 from threads x where x.origin_act_id = pb) then raise exception 'a spin of a public ballot was not written: %', spun; end if;
  perform tests.unbecome();
  -- A replaced poll (a later poll on its post) and a removed one (a later removal), refused in one sentence.
  pr := tests.post(a1, t, 'Replaced.', w0 + interval '1 hour');
  plr1 := pg_temp.mkpoll(t, pr, a1, closes => w1 + interval '1 day', at => w0 + interval '2 hours');
  plr2 := pg_temp.mkpoll(t, pr, a1, closes => w1 + interval '1 day', at => w0 + interval '3 hours');
  perform tests.act(a1, 'poll', t, '{"removed": true}', p, w0 + interval '5 hours');
  perform tests.become(cat);
  got := pg_temp.say(format('select spin(%L, %L, ''A spin'', ''Discuss.'')', plr1, c1));
  if got is distinct from 'that poll was replaced' then raise exception 'a spin of a replaced poll: %', got; end if;
  got := pg_temp.say(format('select spin(%L, %L, ''A spin'', ''Discuss.'')', pl, c1));
  if got is distinct from 'that poll was replaced' then raise exception 'a spin of a removed poll: %', got; end if;
  perform spin(plr2, c1, 'About the live poll', 'Discuss.');
  perform tests.unbecome();

  -- A veiled author's ballot shows the stand-in: a ballot written before the veil lands and one written after (the veil covers the author's own Acts on the post, and a ballot is one through its poll),
  -- another character's ballot shows its own character, and a secret poll's ballot shows no character even for the veiled author.
  stand := pg_temp.stand();
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, stack, gimmick) values ('plveil', 'Pl Whodunnit', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'author', 1, null) on conflict (key) do nothing;
  veiled_post := tests.post(a1, t, 'A veiled post.', now() - interval '3 hours');
  veiled_secret := tests.post(a1, t, 'A veiled secret.', now() - interval '3 hours');
  vpoll := pg_temp.mkpoll(t, veiled_post, a1, pick => 2, at => now() - interval '2 hours');
  vspoll := pg_temp.mkpoll(t, veiled_secret, a1, secret => true, at => now() - interval '2 hours');
  vb_before := pg_temp.vote(vpoll, a1, '[0]', now() - interval '90 minutes');
  vsb_before := pg_temp.vote(vspoll, a1, '[0]', now() - interval '90 minutes');
  vb_other := pg_temp.vote(vpoll, b1, '[1]', now() - interval '90 minutes');
  if (select x."character" from acts_public x where x.id = vb_before) is distinct from a1 then raise exception 'the author''s ballot is veiled before any veil'; end if;
  perform pg_temp.veil(veiled_post, t, a1, c1, cat, 1);
  perform pg_temp.veil(veiled_secret, t, a1, c1, cat, 2);
  vb_after := pg_temp.vote(vpoll, a1, '[0, 1]', now());
  vsb_after := pg_temp.vote(vspoll, a1, '[1]', now());
  if (select x."character" from acts_public x where x.id = vpoll) is distinct from stand then raise exception 'the poll of a veiled post is shown under its author'; end if;
  if (select x."character" from acts_public x where x.id = vb_before) is distinct from stand then raise exception 'a ballot written by the veiled author before the veil is shown under the author'; end if;
  if (select x."character" from acts_public x where x.id = vb_after) is distinct from stand then raise exception 'a ballot written by the veiled author after the veil is shown under the author'; end if;
  if (select x."character" from acts_public x where x.id = vb_other) is distinct from b1 then raise exception 'another character''s ballot on a veiled post''s poll is shown under the stand-in'; end if;
  if (select x."character" from acts_public x where x.id = vspoll) is distinct from stand then raise exception 'the secret poll of a veiled post is shown under its author'; end if;
  if (select x."character" from acts_public x where x.id = vsb_before) is not null or (select x."character" from acts_public x where x.id = vsb_after) is not null then
    raise exception 'a secret ballot of a veiled author shows a character (the stand-in or the author)';
  end if;
  -- The ballot in my_ballots stays the owner's own (who wrote it is the owner's fact).
  perform tests.become(ann);
  if (select m."character" from my_ballots m where m.act = vb_after) is distinct from a1 then raise exception 'my_ballots does not give the veiled author their own ballot'; end if;
  perform tests.unbecome();
end $$;

-- screen_settings shows the five poll settings to anon, as the database holds them.
insert into settings (key, value) values
  ('pollOptionsMax', '7'::jsonb), ('pollQuestionMax', '150'::jsonb), ('pollOptionMax', '80'::jsonb),
  ('pollLastsMin', '{"unit":"hour","count":2}'::jsonb), ('pollLastsMax', '{"unit":"week","count":3}'::jsonb)
  on conflict (key) do update set value = excluded.value;
set local role anon;
do $$
declare got jsonb;
begin
  select settings into got from screen_settings;
  if got -> 'pollOptionsMax' is distinct from '7'::jsonb then raise exception 'pollOptionsMax is not shown: %', got -> 'pollOptionsMax'; end if;
  if got -> 'pollQuestionMax' is distinct from '150'::jsonb then raise exception 'pollQuestionMax is not shown: %', got -> 'pollQuestionMax'; end if;
  if got -> 'pollOptionMax' is distinct from '80'::jsonb then raise exception 'pollOptionMax is not shown: %', got -> 'pollOptionMax'; end if;
  if got -> 'pollLastsMin' is distinct from '{"unit":"hour","count":2}'::jsonb then raise exception 'pollLastsMin is not shown: %', got -> 'pollLastsMin'; end if;
  if got -> 'pollLastsMax' is distinct from '{"unit":"week","count":3}'::jsonb then raise exception 'pollLastsMax is not shown: %', got -> 'pollLastsMax'; end if;
end $$;
reset role;
