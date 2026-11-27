-- A board's list and the index hear every post (supabase/migrations/0453_live_lists_and_self.sql; docs/plans/2026-11-25-live-lists-and-self-plan.md, Task 1).
--
-- 1. A post in a thread queues one `row` on `board:<board>` that equals the thread's row as board_page lists it, and one `board` on `index` that equals the board's entry as index_page builds it.
-- 1b. A statement that writes many Acts sends each thread's row and board's entry once.
-- 2. An Act with no place number (an edit) queues neither; neither does a reaction (a tally is not an Act in a thread).
-- 3. The `row` carries no view count, no reading position, and nothing about an owner or an account; the `board` entry holds exactly index_page's keys.
-- 4. A thread thread_list does not list, and a board the index leaves out (closed), queue nothing.
-- 5. masks_change opens its Turns thread without a `thread` event on a board: the thread's first Act sends the `row`.
-- 6. thread_row and board_summary are for the trigger alone: no API role can call them.
-- 7. A signed-in role hears `index`, a visitor does not, and an account's own channel stays its own.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- The events waiting to be sent on a topic, as [{event, payload}], oldest first.
create function pg_temp.queued(on_topic text) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('event', b.event, 'payload', b.payload) order by b.id), '[]'::jsonb) from broadcasts_due b where b.topic = on_topic
$$;

-- The thread's row as board_page lists it to a signed-in reader, and the board's entry as index_page builds it.
create function pg_temp.page_row(reader uuid, in_thread uuid) returns jsonb language plpgsql as $$
declare
  got jsonb;
begin
  perform tests.become(reader);
  select t into got from jsonb_array_elements(board_page((select b.slug from threads x join boards b on b.id = x.board where x.id = in_thread), 1, '{}') -> 'threads') t where t ->> 'id' = in_thread::text;
  perform tests.unbecome();
  return got;
end $$;

create function pg_temp.index_entry(reader uuid, in_board uuid) returns jsonb language plpgsql as $$
declare
  got jsonb;
begin
  perform tests.become(reader);
  select e into got from jsonb_array_elements(index_page() -> 'boards') e where e ->> 'id' = in_board::text;
  perform tests.unbecome();
  return got;
end $$;

do $$
declare
  ann uuid := tests.account('live-ann');
  bob uuid := tests.account('live-bob');
  a uuid := tests.character(ann, 'Live Ann', 'alpha', now() - interval '60 days');
  b uuid := tests.character(bob, 'Live Bob', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Live list');
  board uuid;
  first_post uuid;
  second_post uuid;
  rows jsonb;
  boards jsonb;
  row_keys text[];
  entry_keys text[];
begin
  select x.board into board from threads x where x.id = t;
  first_post := tests.post(a, t, 'The first post.');
  delete from broadcasts_due;

  -- 1. A post queues one row on its board and one board entry on the index, equal to what the readers give.
  second_post := tests.post(b, t, 'A reply.');
  rows := pg_temp.queued('board:' || board);
  if jsonb_array_length(rows) is distinct from 1 or rows -> 0 ->> 'event' is distinct from 'row' then
    raise exception 'a post should queue one row on its board, queued %', rows;
  end if;
  if (rows -> 0 -> 'payload') is distinct from pg_temp.page_row(ann, t) then
    raise exception 'the row is not the thread''s row as board_page lists it: % vs %', rows -> 0 -> 'payload', pg_temp.page_row(ann, t);
  end if;
  if (rows -> 0 -> 'payload' ->> 'replies')::integer is distinct from 1 or (rows -> 0 -> 'payload' ->> 'last_act')::uuid is distinct from second_post then
    raise exception 'the row does not show the reply that was just written: %', rows -> 0 -> 'payload';
  end if;
  boards := pg_temp.queued('index');
  if jsonb_array_length(boards) is distinct from 1 or boards -> 0 ->> 'event' is distinct from 'board' then
    raise exception 'a post should queue one board on the index, queued %', boards;
  end if;
  if (boards -> 0 -> 'payload') is distinct from pg_temp.index_entry(ann, board) then
    raise exception 'the board is not the board''s entry as index_page builds it: % vs %', boards -> 0 -> 'payload', pg_temp.index_entry(ann, board);
  end if;
  if (boards -> 0 -> 'payload' ->> 'last_thread')::uuid is distinct from t or (boards -> 0 -> 'payload' ->> 'last_character')::uuid is distinct from b then
    raise exception 'the board entry does not show the post that was just written: %', boards -> 0 -> 'payload';
  end if;
  if (select count(*) from broadcasts_due where topic like 'board:%' or topic = 'index') is distinct from 2 then
    raise exception 'a post queued more than its row and its board: %', (select jsonb_agg(topic || ' ' || event) from broadcasts_due);
  end if;

  -- A new thread's first post is a row too.
  delete from broadcasts_due;
  declare
    fresh uuid := tests.thread('A fresh thread');
  begin
    perform tests.post(a, fresh, 'Opening words.');
    rows := pg_temp.queued('board:' || board);
    if jsonb_array_length(rows) is distinct from 1 or rows -> 0 ->> 'event' is distinct from 'row' or (rows -> 0 -> 'payload' ->> 'id')::uuid is distinct from fresh then
      raise exception 'a thread''s first post should queue its row, queued %', rows;
    end if;
    if (rows -> 0 -> 'payload') is distinct from pg_temp.page_row(ann, fresh) then raise exception 'a new thread''s row is not as board_page lists it'; end if;
  end;

  -- 3. What the row and the board carry.
  select array_agg(k order by k) into row_keys from jsonb_object_keys(rows -> 0 -> 'payload') k;
  if exists (select 1 from unnest(row_keys) k where k ~* 'view|reading|owner|account|reactor|class') then
    raise exception 'the row carries a private or batched field: %', row_keys;
  end if;
  if row_keys is distinct from array['board', 'created_at', 'first_act', 'first_character', 'id', 'last_act', 'last_at', 'last_character', 'last_seq', 'origin_act_id', 'origin_place', 'origin_thread', 'replies', 'replies_this_week', 'title'] then
    raise exception 'the row''s keys are not the list: %', row_keys;
  end if;
  select array_agg(k order by k) into entry_keys from jsonb_object_keys((select payload from broadcasts_due where topic = 'index')) k;
  if entry_keys is distinct from array['description', 'id', 'is_system', 'last_at', 'last_character', 'last_thread', 'last_title', 'move_act', 'name', 'slug', 'thread_count'] then
    raise exception 'the board entry''s keys are not index_page''s: %', entry_keys;
  end if;

  -- 2. An edit has no place number and queues neither; a reaction is not an Act in a thread.
  delete from broadcasts_due;
  perform tests.act(a, 'edit', t, jsonb_build_object('body', 'The first post, edited.'), first_post);
  if exists (select 1 from broadcasts_due where topic like 'board:%' or topic = 'index') then
    raise exception 'an edit queued a list event: %', (select jsonb_agg(topic || ' ' || event) from broadcasts_due);
  end if;
  delete from broadcasts_due;
  perform tests.become(bob);
  perform react(first_post, b, 'up');
  perform tests.unbecome();
  if exists (select 1 from broadcasts_due where topic like 'board:%' or topic = 'index') then
    raise exception 'a reaction queued a list event: %', (select jsonb_agg(topic || ' ' || event) from broadcasts_due);
  end if;
end $$;

-- 4. A thread no list shows queues nothing: the Updates thread is left out of thread_list.
do $$
declare
  ann uuid := tests.account('live-unlisted');
  a uuid := tests.character(ann, 'Live Unlisted', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('The Updates thread');
begin
  insert into unlisted_threads (thread) values (t);
  delete from broadcasts_due;
  perform tests.post(a, t, 'Nobody lists me.');
  if exists (select 1 from broadcasts_due where topic like 'board:%') then
    raise exception 'an unlisted thread queued a row: %', (select jsonb_agg(topic || ' ' || event) from broadcasts_due);
  end if;
  if thread_row(t) is not null then raise exception 'thread_row answered for a thread thread_list does not list'; end if;
  if board_summary(gen_random_uuid()) is not null then raise exception 'board_summary answered for a board that is not there'; end if;
end $$;

-- A statement that writes many Acts sends each thread's row and each board's entry once, as the state after the statement.
do $$
declare
  ann uuid := tests.account('live-bulk');
  a uuid := tests.character(ann, 'Live Bulk', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Live bulk');
  board uuid;
begin
  select x.board into board from threads x where x.id = t;
  perform tests.post(a, t, 'Opening.');
  delete from broadcasts_due;
  insert into acts (character, kind, thread, payload) select a, 'post', t, jsonb_build_object('body', 'Again ' || g) from generate_series(1, 50) g;
  if (select count(*) from broadcasts_due where topic = 'board:' || board) is distinct from 1 or (select count(*) from broadcasts_due where topic = 'index') is distinct from 1 then
    raise exception 'fifty Acts in one statement queued % rows and % board entries, not one of each', (select count(*) from broadcasts_due where topic = 'board:' || board), (select count(*) from broadcasts_due where topic = 'index');
  end if;
  if (select payload ->> 'replies' from broadcasts_due where topic = 'board:' || board) is distinct from '50' then raise exception 'the row of a bulk statement is not the state after it'; end if;
end $$;

-- 6. Only the trigger calls the two projections.
do $$
begin
  if has_function_privilege('anon', 'thread_row(uuid)', 'execute') or has_function_privilege('authenticated', 'thread_row(uuid)', 'execute') or has_function_privilege('public', 'thread_row(uuid)', 'execute') then
    raise exception 'an API role can call thread_row';
  end if;
  if has_function_privilege('anon', 'board_summary(uuid)', 'execute') or has_function_privilege('authenticated', 'board_summary(uuid)', 'execute') or has_function_privilege('public', 'board_summary(uuid)', 'execute') then
    raise exception 'an API role can call board_summary';
  end if;
end $$;

-- 5. masks_change opens the Turns thread and sends no `thread` event: the first Act of the thread sends its row.
do $$
declare
  ann uuid := tests.account('live-turn');
  turner uuid := tests.character(ann, 'Live Turner', 'alpha', now() - interval '60 days');
  s timestamptz;
  due jsonb;
  opened uuid;
begin
  insert into settlements (starts_at, ends_at, season) select date_trunc('day', now()), date_trunc('day', now()) + interval '1 day', id from seasons where ends_at is null;
  s := (select max(ends_at) from settlements);
  perform tests.queue_old_turn(turner, 'beta', false, true);
  update pending_turns set asked_at = s - interval '1 hour' where character = turner;
  update seasons set turns_thread = null where ends_at is null;
  delete from broadcasts_due;
  perform set_config('role', 'service_role', true);
  perform apply_settlement(s, s + interval '1 day', '[]');
  perform tests.unbecome();
  if not exists (select 1 from acts where kind = 'announce' and character = turner) then raise exception 'the Turn was not announced, so this proves nothing'; end if;
  if exists (select 1 from broadcasts_due where topic like 'board:%' and event = 'thread') then
    raise exception 'masks_change still sends a thread event: %', (select jsonb_agg(topic || ' ' || event) from broadcasts_due where event = 'thread');
  end if;
  select (payload ->> 'thread')::uuid into opened from broadcasts_due where topic like 'thread:%' and event = 'act' and (payload ->> 'character')::uuid = turner limit 1;
  due := pg_temp.queued('board:' || system_board());
  if not exists (select 1 from jsonb_array_elements(due) m where m ->> 'event' = 'row' and (m -> 'payload' ->> 'id')::uuid = opened) then
    raise exception 'the Turns thread the announcement opened was not told to its board by a row: %', due;
  end if;
end $$;

-- 7. The realtime policy: a signed-in role hears `index`, a visitor does not, and another account's channel stays closed.
do $$
declare
  ann uuid := tests.account('live-hear-ann');
  bob uuid := tests.account('live-hear-bob');
  n integer;
begin
  delete from realtime.messages;
  insert into realtime.messages (topic, payload, event) values ('index', '{}', 'board'), ('account:' || ann, '{}', 'alert');
  perform set_config('realtime.topic', 'index', true);
  perform tests.become(bob);
  select count(*) into n from realtime.messages where topic is not distinct from current_setting('realtime.topic');
  perform tests.unbecome();
  if n is distinct from 1 then raise exception 'a signed-in player should hear index, heard % messages', n; end if;
  perform tests.become_anon();
  begin
    select count(*) into n from realtime.messages where topic is not distinct from current_setting('realtime.topic');
  exception when insufficient_privilege then n := 0;
  end;
  perform tests.unbecome();
  if n is distinct from 0 then raise exception 'a visitor heard index'; end if;
  -- Not a look-alike or a wildcard.
  insert into realtime.messages (topic, payload, event) values ('index2', '{}', 'board'), ('inde', '{}', 'board');
  perform tests.become(bob);
  perform set_config('realtime.topic', 'index2', true);
  select count(*) into n from realtime.messages where topic is not distinct from current_setting('realtime.topic');
  if n is distinct from 0 then raise exception 'a look-alike of index was heard'; end if;
  perform set_config('realtime.topic', 'account:' || ann, true);
  select count(*) into n from realtime.messages where topic is not distinct from current_setting('realtime.topic');
  perform tests.unbecome();
  if n is distinct from 0 then raise exception 'index opened another account''s channel to a signed-in player'; end if;
  perform set_config('realtime.topic', 'account:' || ann, true);
  perform tests.become(ann);
  select count(*) into n from realtime.messages where topic is not distinct from current_setting('realtime.topic');
  perform tests.unbecome();
  if n is distinct from 1 then raise exception 'an account no longer hears its own channel'; end if;
end $$;
