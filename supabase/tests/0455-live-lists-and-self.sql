-- A board's list and the index hear every post (supabase/migrations/0455_live_lists_and_self.sql; docs/plans/2026-11-25-live-lists-and-self-plan.md, Task 1).
--
-- 1. A post in a thread queues one `row` on `board:<board>` that equals the thread's row as board_page lists it, and one `board` on `index` that equals the board's entry as index_page builds it.
-- 1b. A statement that writes many Acts sends each thread's row and board's entry once.
-- 2. An Act with no place number (an edit) queues neither; neither does a reaction (a tally is not an Act in a thread).
-- 3. The `row` carries no view count, no reading position, and nothing about an owner or an account; the `board` entry holds exactly index_page's keys.
-- 4. A thread thread_list does not list, and a board the index leaves out (closed), queue nothing.
-- 5. masks_change opens its Turns thread without a `thread` event on a board: the thread's first Act sends the `row`.
-- 6. thread_row and board_summary are for the trigger alone: no API role can call them.
-- 7. A signed-in role hears `index`, a visitor does not, and an account's own channel stays its own.
-- 8. write_roster_entry opens the season's Roster thread without a `thread` event on a board: the thread's first post sends the `row` (section R below).
--
-- Task 2, the poke (sections P1 to P7 and R2, below):
-- P1. grant_aura pokes its account alone; a settlement's wallet rows poke nobody, and a settlement's crowd pay (kind crowd, with `settlement` set) pokes nobody either.
-- P2. A card_ledger row pokes its account; a statement of many rows pokes each account once.
-- P3. Every kind in self_kinds() has a fixture Act that pokes its character's owner alone; an appeal_ruling on an infraction and on a move (two hops), and a card_end that ends a lockout's spring (through `locks`), poke too.
-- P4. A quiet kind, an unresolvable character and an ownerless character poke no one.
-- P5. ban_lifts and warn_reliefs rows poke the owner of the character they change.
-- P6. acts_kind_check's kinds equal self_kinds() and quiet_kinds(), with no overlap.
-- P7. The functions are for the triggers alone.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- The live lists are built at commit (live_lists_flush, a deferred constraint trigger), and a test never commits: `set constraints all immediate` fires what is pending, and the constraints are deferred again after,
-- so that the rest of the file runs as a transaction does.
create function pg_temp.flush() returns void language plpgsql as $$
begin
  set constraints all immediate;
  set constraints all deferred;
end $$;

-- The events waiting to be sent on a topic, as [{event, payload}], oldest first.
create function pg_temp.queued(on_topic text) returns jsonb language plpgsql as $$
begin
  perform pg_temp.flush();
  return (select coalesce(jsonb_agg(jsonb_build_object('event', b.event, 'payload', b.payload) order by b.id), '[]'::jsonb) from broadcasts_due b where b.topic = on_topic);
end $$;

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
  perform pg_temp.flush();
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
  perform pg_temp.flush();
  if (select count(*) from broadcasts_due where topic like 'board:%' or topic = 'index') is distinct from 2 then
    raise exception 'a post queued more than its row and its board: %', (select jsonb_agg(topic || ' ' || event) from broadcasts_due);
  end if;

  -- A new thread's first post is a row too.
  perform pg_temp.flush();
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
  -- A message aid: it names a private or batched field plainly when one is added. The exact pin of the keys below is the check.
  if exists (select 1 from unnest(row_keys) k where k ~* 'view|reading|owner|account|reactor|class') then
    raise exception 'the row carries a private or batched field: %', row_keys;
  end if;
  if row_keys is distinct from array['board', 'created_at', 'first_act', 'first_character', 'id', 'last_act', 'last_at', 'last_character', 'last_seq', 'origin_act_id', 'origin_place', 'origin_thread', 'replies', 'replies_this_week', 'title'] then
    raise exception 'the row''s keys are not the list: %', row_keys;
  end if;
  perform pg_temp.flush();
  select array_agg(k order by k) into entry_keys from jsonb_object_keys((select payload from broadcasts_due where topic = 'index')) k;
  if entry_keys is distinct from array['description', 'id', 'is_system', 'last_at', 'last_character', 'last_thread', 'last_title', 'move_act', 'name', 'slug', 'thread_count'] then
    raise exception 'the board entry''s keys are not index_page''s: %', entry_keys;
  end if;

  -- 2. An edit has no place number and queues neither; a reaction is not an Act in a thread.
  perform pg_temp.flush();
  delete from broadcasts_due;
  perform tests.act(a, 'edit', t, jsonb_build_object('body', 'The first post, edited.'), first_post);
  perform pg_temp.flush();
  if exists (select 1 from broadcasts_due where topic like 'board:%' or topic = 'index') then
    raise exception 'an edit queued a list event: %', (select jsonb_agg(topic || ' ' || event) from broadcasts_due);
  end if;
  perform pg_temp.flush();
  delete from broadcasts_due;
  perform tests.become(bob);
  perform react(first_post, b, 'up');
  perform tests.unbecome();
  perform pg_temp.flush();
  if exists (select 1 from broadcasts_due where topic like 'board:%' or topic = 'index') then
    raise exception 'a reaction queued a list event: %', (select jsonb_agg(topic || ' ' || event) from broadcasts_due);
  end if;
end $$;

-- 4. A thread no list shows queues nothing (no row, and no board entry either, which would change nothing): the Updates thread is left out of thread_list.
do $$
declare
  ann uuid := tests.account('live-unlisted');
  a uuid := tests.character(ann, 'Live Unlisted', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('The Updates thread');
begin
  insert into unlisted_threads (thread) values (t);
  perform pg_temp.flush();
  delete from broadcasts_due;
  perform tests.post(a, t, 'Nobody lists me.');
  perform pg_temp.flush();
  if exists (select 1 from broadcasts_due where topic like 'board:%' or topic = 'index') then
    raise exception 'an unlisted thread queued a row or a board: %', (select jsonb_agg(topic || ' ' || event) from broadcasts_due);
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
  perform pg_temp.flush();
  delete from broadcasts_due;
  insert into acts (character, kind, thread, payload) select a, 'post', t, jsonb_build_object('body', 'Again ' || g) from generate_series(1, 50) g;
  perform pg_temp.flush();
  if (select count(*) from broadcasts_due where topic = 'board:' || board) is distinct from 1 or (select count(*) from broadcasts_due where topic = 'index') is distinct from 1 then
    raise exception 'fifty Acts in one statement queued % rows and % board entries, not one of each', (select count(*) from broadcasts_due where topic = 'board:' || board), (select count(*) from broadcasts_due where topic = 'index');
  end if;
  perform pg_temp.flush();
  if (select payload ->> 'replies' from broadcasts_due where topic = 'board:' || board) is distinct from '50' then raise exception 'the row of a bulk statement is not the state after it'; end if;
end $$;

-- 1c. A statement that places Acts in more than 50 threads of one board tells that board once: one `changed` {}, no `row`; the index still hears the board's entry once.
-- A statement that places Acts in 3 threads keeps one `row` per thread, each equal to board_page's.
do $$
declare
  ann uuid := tests.account('live-many');
  a uuid := tests.character(ann, 'Live Many', 'alpha', now() - interval '60 days');
  ts uuid[] := '{}';
  t uuid;
  board uuid;
  got jsonb;
  mine jsonb;
begin
  for i in 1..3 loop
    t := tests.thread('Many ' || i);
    perform tests.post(a, t, 'Opening ' || i);
    ts := ts || t;
  end loop;
  select x.board into board from threads x where x.id = ts[1];
  perform pg_temp.flush();
  delete from broadcasts_due;
  insert into acts (character, kind, thread, payload) select a, 'post', x, jsonb_build_object('body', 'Reply again') from unnest(ts) x;
  got := pg_temp.queued('board:' || board);
  if (select count(*) from jsonb_array_elements(got) e where e ->> 'event' = 'row') is distinct from 3 or jsonb_array_length(got) is distinct from 3 then
    raise exception '3 threads in one statement should send 3 rows, queued %', got;
  end if;
  foreach t in array ts[1:3] loop
    select e -> 'payload' into mine from jsonb_array_elements(got) e where e -> 'payload' ->> 'id' = t::text;
    if mine is distinct from pg_temp.page_row(ann, t) then raise exception 'the row of % is not board_page''s: % against %', t, mine, pg_temp.page_row(ann, t); end if;
  end loop;

  for i in 4..51 loop
    t := tests.thread('Many ' || i);
    perform tests.post(a, t, 'Opening ' || i);
    ts := ts || t;
  end loop;
  perform pg_temp.flush();
  delete from broadcasts_due;
  insert into acts (character, kind, thread, payload) select a, 'post', x, jsonb_build_object('body', 'Reply') from unnest(ts) x;
  got := pg_temp.queued('board:' || board);
  if jsonb_array_length(got) is distinct from 1 or got -> 0 is distinct from jsonb_build_object('event', 'changed', 'payload', '{}'::jsonb) then
    raise exception '51 threads of one board in one statement should send one changed {} and no row, queued % events, first %', jsonb_array_length(got), got -> 0 ->> 'event';
  end if;
  perform pg_temp.flush();
  if (select count(*) from broadcasts_due where topic = 'index' and event = 'board') is distinct from 1 then
    raise exception 'the index should hear the board once, queued %', pg_temp.queued('index');
  end if;

end $$;

-- 1d. The row and the entry are built at commit, after the work the writer does behind its insert: a post that quotes a face-down author veil takes the veil after the post is inserted (post() springs the trap
-- afterwards), and the row and the board's entry name the stand-in, as post()'s answer, acts_public, board_page and index_page do. (0304-post-veils.sql, section 5, is the setup.)
do $$
declare
  ann uuid := tests.account('live-vann');
  bob uuid := tests.account('live-vbob');
  a uuid := tests.character(ann, 'Live Vann', 'alpha', now() - interval '60 days');
  b uuid := tests.character(bob, 'Live Vbob', 'alpha', now() - interval '60 days');
  t uuid;
  stand uuid;
  held uuid;
  made jsonb;
  q uuid;
  board uuid;
  rows jsonb;
  boards jsonb;
begin
  insert into characters (name, staff, staff_kind, debuted_at) values ('Anonymous', 'anonymous', 'anonymous', now()) returning characters.id into stand;
  insert into character_profiles (character, title, signature) values (stand, 'Could be anyone.', '');
  insert into card_kinds (key, name, alignment, rarity, play, reaches, lasts, veil, stack, gimmick) values ('lvauthor', 'Lv Whodunnit', 'salty', 'rare', 'cast', '{post}', interval '3 days', 'author', 1, null);
  insert into card_ledger (account, card, kind, price) values (ann, 'lvauthor', 'bought', 0);
  -- A board of its own, so that its entry's last thread is this one (every thread of the file was written at one instant).
  insert into boards (slug, name) values ('live-veil', 'Live veil') returning id into board;
  insert into threads (board, title) values (board, 'Live veil') returning id into t;
  held := tests.post(a, t, 'A back lies here.');
  perform tests.become_service();
  perform set_card(ann, 'lvauthor', a, held, '{}', 0);
  perform tests.unbecome();
  perform pg_temp.flush();
  delete from broadcasts_due;
  perform tests.become(bob);
  made := post(t, b, 'Quoting the back.', held);
  perform tests.unbecome();
  q := (made ->> 'id')::uuid;
  if not exists (select 1 from post_veils v where v.post = q) then raise exception 'the face-down veil did not land on the quoting post, so this proves nothing: %', made; end if;
  rows := pg_temp.queued('board:' || board);
  boards := pg_temp.queued('index');
  if (rows -> 0 -> 'payload' ->> 'last_character')::uuid is distinct from stand then
    raise exception 'the queued row names % as the last character, not the stand-in %', rows -> 0 -> 'payload' ->> 'last_character', stand;
  end if;
  if (boards -> 0 -> 'payload' ->> 'last_character')::uuid is distinct from stand then
    raise exception 'the queued board entry names % as the last character, not the stand-in %: %', boards -> 0 -> 'payload' ->> 'last_character', stand, boards;
  end if;
  if jsonb_array_length(rows) is distinct from 1 or jsonb_array_length(boards) is distinct from 1 then raise exception 'the quote queued % rows and % entries, not one each', jsonb_array_length(rows), jsonb_array_length(boards); end if;
  if (rows -> 0 -> 'payload') is distinct from pg_temp.page_row(bob, t) then raise exception 'the row is not board_page''s after the veil: % vs %', rows -> 0 -> 'payload', pg_temp.page_row(bob, t); end if;
  if (boards -> 0 -> 'payload') is distinct from pg_temp.index_entry(bob, board) then raise exception 'the entry is not index_page''s after the veil: % vs %', boards -> 0 -> 'payload', pg_temp.index_entry(bob, board); end if;
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
  perform pg_temp.flush();
  delete from broadcasts_due;
  perform set_config('role', 'service_role', true);
  perform apply_settlement(s, s + interval '1 day', '[]');
  perform tests.unbecome();
  if not exists (select 1 from acts where kind = 'announce' and character = turner) then raise exception 'the Turn was not announced, so this proves nothing'; end if;
  perform pg_temp.flush();
  if exists (select 1 from broadcasts_due where topic like 'board:%' and event = 'thread') then
    raise exception 'masks_change still sends a thread event: %', (select jsonb_agg(topic || ' ' || event) from broadcasts_due where event = 'thread');
  end if;
  perform pg_temp.flush();
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

-- ================================================================== Task 2: the poke (plan Task 2) ==================================================================
--
-- P1. grant_aura queues one `self` on its account's channel and none on any other; the payload is `{}`; a settlement (apply_settlement with an entry for the account) queues none.
-- P2. A card_ledger row queues one `self` for its account; a statement that writes many wallet or ledger rows pokes each account once.
-- P3. For every kind in self_kinds(), a fixture Act on a character queues `self` on its owner's account alone (a character of someone else's is never poked), and every kind in self_kinds() has a fixture here.
-- P4. An Act of a quiet kind queues none; an Act whose character cannot be found, or whose character has no owner, pokes no one.
-- P5. The rows beside the Acts that change what a player's characters show (ban_lifts, warn_reliefs) poke the owner of the character they change.
-- P6. THE CHECK: the kinds acts_kind_check allows equal self_kinds() union quiet_kinds(), and the two sets do not overlap. Driven red here by a kind added to the constraint and listed in neither.
-- P7. The functions are for the triggers alone: no API role can call them.

create function pg_temp.selfs(for_account uuid) returns integer language sql as $$
  select count(*)::integer from broadcasts_due where topic = 'account:' || for_account and event = 'self'
$$;
create function pg_temp.all_selfs() returns text language sql as $$
  select coalesce(string_agg(topic || ' ' || payload::text, ', ' order by id), '') from broadcasts_due where event = 'self'
$$;

-- The kinds acts_kind_check allows, read from its definition as the database keeps it, and what is wrong with their classification (null: nothing).
create function pg_temp.constraint_kinds() returns text[] language sql as $$
  select coalesce(array_agg(m[1] order by m[1]), '{}') from regexp_matches(
    (select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname = 'acts_kind_check' and c.conrelid = 'acts'::regclass), '''([^'']+)''::text', 'g') m
$$;
create function pg_temp.classification_problem() returns text language sql as $$
  with allowed as (select unnest(pg_temp.constraint_kinds()) k), mine as (select unnest(self_kinds()) k), quiet as (select unnest(quiet_kinds()) k)
  select nullif(concat_ws('; ',
    case when exists (select 1 from allowed where k not in (select k from mine) and k not in (select k from quiet))
      then 'in acts_kind_check and in neither list: ' || (select string_agg(k, ', ' order by k) from allowed where k not in (select k from mine) and k not in (select k from quiet)) end,
    case when exists (select 1 from mine where k not in (select k from allowed) union all select 1 from quiet where k not in (select k from allowed))
      then 'listed and not in acts_kind_check: ' || (select string_agg(k, ', ' order by k) from (select k from mine union all select k from quiet) l where k not in (select k from allowed)) end,
    case when exists (select 1 from mine where k in (select k from quiet))
      then 'in both lists: ' || (select string_agg(k, ', ' order by k) from mine where k in (select k from quiet)) end), '')
$$;


-- Payloads as the writers write them: the table's own checks hold their shapes (acts_ban_payload, acts_infraction_payload, acts_spring_payload and the others), so a fixture meets them.
create function pg_temp.ban_of(c uuid) returns jsonb language sql as $$
  select jsonb_build_object('character', c, 'days', 3, 'until', now() + interval '3 days', 'infraction_act', gen_random_uuid(), 'season', 1)
$$;
create function pg_temp.infraction_of(c uuid) returns jsonb language sql as $$
  select jsonb_build_object('character', c, 'band', 'minor', 'points', 3, 'rule_number', null, 'board', gen_random_uuid(), 'about_act', gen_random_uuid(), 'visit_act', null, 'staff', 'poke-mod', 'expires_at', now() + interval '7 days')
$$;
create function pg_temp.lockout_of(c uuid) returns jsonb language sql as $$
  select jsonb_build_object('card', 'lkback', 'trigger', 'cast', 'did', 'lockedOut', 'set', gen_random_uuid(), 'locks', c, 'until', now() + interval '3 days')
$$;
create function pg_temp.move_of(c uuid) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'conferGroup', 'params', jsonb_build_object('character', c, 'group', 'x'), 'expires_at', now() + interval '3 days')
$$;

-- P1, P2: the wallet and the cards.
do $$
declare
  ann uuid := tests.account('poke-ann');
  bob uuid := tests.account('poke-bob');
  w1 timestamptz := (select max(ends_at) from settlements);
  w2 timestamptz := (select max(ends_at) from settlements) + interval '1 day';
  a uuid := tests.character(ann, 'Poke Ann', 'alpha', now() - interval '60 days');
  said jsonb;
begin
  delete from broadcasts_due;
  perform grant_aura(ann, 100);
  if pg_temp.selfs(ann) is distinct from 1 then raise exception 'grant_aura should queue one self on its account, queued: %', pg_temp.all_selfs(); end if;
  if pg_temp.selfs(bob) is distinct from 0 then raise exception 'grant_aura poked another account'; end if;
  if (select count(*) from broadcasts_due where event = 'self') is distinct from 1 then raise exception 'grant_aura queued more than one self: %', pg_temp.all_selfs(); end if;
  if exists (select 1 from broadcasts_due where event = 'self' and payload is distinct from '{}'::jsonb) then raise exception 'a self carries something: %', pg_temp.all_selfs(); end if;

  -- A settlement writes wallet rows of kind settlement and pokes nobody.
  delete from broadcasts_due;
  said := apply_settlement(w1, w2, jsonb_build_array(jsonb_build_object('player', ann, 'character', a, 'reason', 'alpha.cheered', 'amount', 350)), '{"alpha": 350}');
  if not (said ->> 'applied')::boolean then raise exception 'the settlement did not apply, so this proves nothing: %', said; end if;
  if not exists (select 1 from wallet_events where account = ann and kind = 'settlement') then raise exception 'the settlement wrote no settlement wallet row, so this proves nothing'; end if;
  if exists (select 1 from broadcasts_due where event = 'self') then raise exception 'a settlement queued a self: %', pg_temp.all_selfs(); end if;

  -- A settlement's crowd pay is a wallet row of kind crowd with `settlement` set: it moves every paid wallet in the one transaction, as the settlement's own rows do, and pokes nobody (the HUD reads again on `settled`).
  declare
    cb uuid := tests.character(bob, 'Poke Crowd Author', 'alpha', now() - interval '60 days');
    ct uuid := tests.thread('Poke crowd');
    cp uuid := tests.post(cb, ct, 'A post the crowd pays for.');
    w3 timestamptz := w2 + interval '1 day';
  begin
    insert into reactions (act, reactor_character, reactor_account, kind, slot, created_at) values (cp, a, ann, 'up', 1, w2 + interval '1 hour');
    update settings set value = '2' where key = 'crowdPayEach';
    delete from broadcasts_due;
    said := apply_settlement(w2, w3, '[]', '{}', '[]', '[]', jsonb_build_array(jsonb_build_object('player', ann, 'acts', jsonb_build_array(cp))));
    if not (said ->> 'applied')::boolean then raise exception 'the crowd window did not apply, so this proves nothing: %', said; end if;
    if not exists (select 1 from wallet_events where account = ann and kind = 'crowd' and settlement is not null) then raise exception 'the settlement wrote no crowd wallet row, so this proves nothing'; end if;
    if exists (select 1 from broadcasts_due where event = 'self') then raise exception 'a settlement''s crowd pay queued a self: %', pg_temp.all_selfs(); end if;
  end;

  -- A card_ledger row.
  delete from broadcasts_due;
  insert into card_ledger (account, card, kind, price) select bob, key, 'bought', 0 from card_kinds limit 1;
  if pg_temp.selfs(bob) is distinct from 1 or (select count(*) from broadcasts_due where event = 'self') is distinct from 1 then raise exception 'a card_ledger row should queue one self for its account: %', pg_temp.all_selfs(); end if;

  -- One statement, one poke for each account.
  delete from broadcasts_due;
  insert into card_ledger (account, card, kind, price) select x, k.key, 'bought', 0 from (values (ann), (ann), (ann), (bob)) v(x), (select key from card_kinds limit 1) k;
  if pg_temp.selfs(ann) is distinct from 1 or pg_temp.selfs(bob) is distinct from 1 then raise exception 'a statement of four ledger rows should poke each of two accounts once: %', pg_temp.all_selfs(); end if;
  delete from broadcasts_due;
  insert into wallet_events (account, settlement, kind, change, balance_after) values (ann, null, 'grant', 1, 1), (ann, null, 'grant', 1, 2), (bob, (select max(id) from settlements), 'settlement', 1, 1);
  if pg_temp.selfs(ann) is distinct from 1 or pg_temp.selfs(bob) is distinct from 0 then raise exception 'wallet rows: ann once, bob (a settlement row) not at all: %', pg_temp.all_selfs(); end if;
end $$;

-- P3, P4, P5: the Acts, one fixture for each kind self_kinds() names.
do $$
declare
  ann uuid := tests.account('poke-own');
  bob uuid := tests.account('poke-other');
  mine uuid := tests.character(ann, 'Poke Mine', 'alpha', now() - interval '60 days');
  theirs uuid := tests.character(bob, 'Poke Theirs', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Poke fixtures');
  staff uuid;
  k text;
  target uuid;
  ban uuid;
  infraction uuid;
  moved uuid;
  theirs_post uuid;
  fixtures text[] := array['infraction', 'ban', 'move', 'move_end', 'card_end', 'appeal_ruling', 'unmask', 'spring', 'open_gift'];
begin
  insert into characters (id, name, staff, staff_kind, debuted_at) values (gen_random_uuid(), 'Poke Mod', 'poke-mod', 'persona', now()) returning id into staff;
  -- The guards on the writers' own shapes stand down for these inserts (a rollback gives them back): this file asks what a poke does with an Act of a kind, not whether the Act's writer is allowed to write it.
  alter table acts disable trigger acts_well_formed;
  alter table acts disable trigger acts_warn_guard;
  alter table acts disable trigger acts_appeal_guard;

  theirs_post := tests.post(theirs, t, 'A post a card can land on.');
  foreach k in array self_kinds() loop
    if not k = any (fixtures) then raise exception 'self_kinds() names "%" and this test has no fixture for it: add one, so the kind is held to the poke', k; end if;
    -- The setup, then the queue emptied, then the one Act of the kind.
    if k = 'infraction' then
      delete from broadcasts_due;
      insert into acts (character, kind, thread, payload) values (null, 'infraction', t, pg_temp.infraction_of(mine));
    elsif k = 'ban' then
      delete from broadcasts_due;
      insert into acts (character, kind, thread, payload) values (null, 'ban', t, pg_temp.ban_of(mine));
    elsif k = 'move' then
      delete from broadcasts_due;
      insert into acts (character, kind, thread, payload) values (staff, 'move', t, pg_temp.move_of(mine));
    elsif k = 'move_end' then
      insert into acts (character, kind, thread, payload) values (staff, 'move', t, pg_temp.move_of(mine)) returning id into moved;
      delete from broadcasts_due;
      insert into acts (character, kind, thread, target_act_id, payload) values (null, 'move_end', t, moved, '{"why": "met", "by": "tick"}');
    elsif k = 'card_end' then
      insert into acts (character, kind, thread, target_act_id, payload) values (theirs, 'spring', t, theirs_post, pg_temp.lockout_of(mine)) returning id into target;
      delete from broadcasts_due;
      insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', t, target, '{"why": "reversed", "by": "admin"}');
    elsif k = 'appeal_ruling' then
      insert into acts (character, kind, thread, payload) values (null, 'ban', t, pg_temp.ban_of(mine)) returning id into ban;
      insert into acts (character, kind, thread, target_act_id, payload) values (mine, 'appeal', t, ban, '{"plea": "Please."}') returning id into target;
      delete from broadcasts_due;
      insert into acts (character, kind, thread, target_act_id, payload) values (staff, 'appeal_ruling', t, target, jsonb_build_object('appeal_act', target::text, 'verdict', 'overturned', 'points_delta', -3, 'line', 'Gone.'));
    elsif k = 'unmask' then
      delete from broadcasts_due;
      insert into acts (character, kind, thread, payload) values (mine, 'unmask', t, '{"class": "alpha", "message": "", "via": "act"}');
    elsif k = 'spring' then
      delete from broadcasts_due;
      insert into acts (character, kind, thread, target_act_id, payload) values (theirs, 'spring', t, theirs_post, pg_temp.lockout_of(mine));
    elsif k = 'open_gift' then
      -- A present the character left and opened itself: the opener and the box's character are one owner's, so one poke (a stranger's box is asked below).
      insert into acts (character, kind, thread, target_act_id, payload) values (mine, 'card', t, theirs_post, '{"card": "pokebox", "message": "", "config": {}, "layer": 1}') returning id into target;
      delete from broadcasts_due;
      insert into acts (character, kind, thread, target_act_id, payload) values (mine, 'open_gift', t, target, jsonb_build_object('box', target, 'did', 'returned', 'gift', null, 'why', 'No.'));
    end if;
    if pg_temp.selfs(ann) is distinct from 1 then raise exception 'a "%" Act on a character should queue one self for its owner, queued: [%]', k, pg_temp.all_selfs(); end if;
    if (select count(*) from broadcasts_due where event = 'self') is distinct from 1 then raise exception 'a "%" Act poked someone beside its character''s owner: [%]', k, pg_temp.all_selfs(); end if;
    if exists (select 1 from broadcasts_due where event = 'self' and (payload is distinct from '{}'::jsonb or topic is distinct from 'account:' || ann)) then raise exception 'a "%" self is not an empty poke on the owner''s channel: [%]', k, pg_temp.all_selfs(); end if;
  end loop;

  -- An appeal_ruling reaches the punished character's owner through two hops: the ruling points at the appeal, which points at the infraction (or the move) that names the character.
  insert into acts (character, kind, thread, payload) values (null, 'infraction', t, pg_temp.infraction_of(mine)) returning id into infraction;
  insert into acts (character, kind, thread, target_act_id, payload) values (mine, 'appeal', t, infraction, '{"plea": "Please."}') returning id into target;
  delete from broadcasts_due;
  insert into acts (character, kind, thread, target_act_id, payload) values (staff, 'appeal_ruling', t, target, jsonb_build_object('appeal_act', target::text, 'verdict', 'overturned', 'points_delta', -3, 'line', 'Gone.'));
  if pg_temp.selfs(ann) is distinct from 1 or (select count(*) from broadcasts_due where event = 'self') is distinct from 1 then raise exception 'an appeal_ruling on an infraction should poke the infracted character''s owner alone: [%]', pg_temp.all_selfs(); end if;
  insert into acts (character, kind, thread, payload) values (staff, 'move', t, pg_temp.move_of(mine)) returning id into moved;
  insert into acts (character, kind, thread, target_act_id, payload) values (mine, 'appeal', t, moved, '{"plea": "Please."}') returning id into target;
  delete from broadcasts_due;
  insert into acts (character, kind, thread, target_act_id, payload) values (staff, 'appeal_ruling', t, target, jsonb_build_object('appeal_act', target::text, 'verdict', 'overturned', 'points_delta', 0, 'line', 'Gone.'));
  if pg_temp.selfs(ann) is distinct from 1 or (select count(*) from broadcasts_due where event = 'self') is distinct from 1 then raise exception 'an appeal_ruling on a move should poke the moved character''s owner alone: [%]', pg_temp.all_selfs(); end if;
  -- An open of a stranger's present pokes the opener and the giver (0457): the giver's hand changes on a return, and the open Act names the box's character and not the giver's owner.
  insert into acts (character, kind, thread, target_act_id, payload) values (theirs, 'card', t, theirs_post, '{"card": "pokebox", "message": "", "config": {}, "layer": 2}') returning id into target;
  delete from broadcasts_due;
  insert into acts (character, kind, thread, target_act_id, payload) values (mine, 'open_gift', t, target, jsonb_build_object('box', target, 'did', 'returned', 'gift', null, 'why', 'No.'));
  if pg_temp.selfs(ann) is distinct from 1 or pg_temp.selfs(bob) is distinct from 1 or (select count(*) from broadcasts_due where event = 'self') is distinct from 2 then raise exception 'an open_gift should poke the opener and the giver, once each: [%]', pg_temp.all_selfs(); end if;
  -- A card_end that ends a lockout's spring reaches the locked character's owner through `locks`, and not the caster's.
  insert into acts (character, kind, thread, target_act_id, payload) values (theirs, 'spring', t, theirs_post, pg_temp.lockout_of(mine)) returning id into target;
  delete from broadcasts_due;
  insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', t, target, '{"why": "reversed", "by": "admin"}');
  if pg_temp.selfs(ann) is distinct from 1 or pg_temp.selfs(bob) is distinct from 0 or (select count(*) from broadcasts_due where event = 'self') is distinct from 1 then raise exception 'a card_end of a lockout''s spring should poke the locked character''s owner alone: [%]', pg_temp.all_selfs(); end if;

  -- A character of someone else's is poked for its own owner: the same fixture on `theirs` reaches bob alone.
  delete from broadcasts_due;
  insert into acts (character, kind, thread, payload) values (null, 'ban', t, pg_temp.ban_of(theirs));
  if pg_temp.selfs(bob) is distinct from 1 or pg_temp.selfs(ann) is distinct from 0 then raise exception 'a ban on bob''s character should poke bob alone: [%]', pg_temp.all_selfs(); end if;

  -- P4. Quiet: a post, an edit, a card play, an announcement queue none, whatever character they name.
  delete from broadcasts_due;
  perform tests.post(mine, t, 'A post.');
  insert into acts (character, kind, thread, payload) values (mine, 'announce', t, jsonb_build_object('what', 'turn', 'character', mine));
  insert into acts (character, kind, thread, target_act_id, payload) values (theirs, 'card', t, theirs_post, jsonb_build_object('card', 'splat', 'reach', 'character', 'character', mine));
  if exists (select 1 from broadcasts_due where event = 'self') then raise exception 'a quiet kind queued a self: [%]', pg_temp.all_selfs(); end if;

  -- An Act whose character cannot be found pokes no one: none named, one that is not a uuid, one that is no character, one with no owner (a staff persona); the end of an ordinary card play, which names no character.
  delete from broadcasts_due;
  insert into acts (character, kind, thread, payload) values (staff, 'move', t, '{"kind": "conferGroup", "params": {}}');
  insert into acts (character, kind, thread, payload) values (staff, 'move', t, '{"kind": "conferGroup", "params": {"character": "not-a-uuid"}}');
  insert into acts (character, kind, thread, payload) values (null, 'ban', t, pg_temp.ban_of(gen_random_uuid()));
  insert into acts (character, kind, thread, payload) values (null, 'ban', t, pg_temp.ban_of(staff));
  insert into acts (character, kind, thread, target_act_id, payload) values (theirs, 'card', t, theirs_post, '{"card": "splat", "layer": 1}') returning id into target;
  insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', t, target, '{"why": "reversed", "by": "admin"}');
  if exists (select 1 from broadcasts_due where event = 'self') then raise exception 'an Act with no resolvable owner poked someone: [%]', pg_temp.all_selfs(); end if;

  -- P5. The rows beside the Acts: an unban's lift of a ban, a relief of an infraction.
  insert into acts (character, kind, thread, payload) values (null, 'ban', t, pg_temp.ban_of(mine)) returning id into ban;
  insert into acts (character, kind, thread, payload) values (null, 'infraction', t, pg_temp.infraction_of(mine)) returning id into infraction;
  insert into acts (character, kind, thread, target_act_id, payload) values (theirs, 'card', t, theirs_post, '{"card": "unban", "reach": "character", "instant": true}') returning id into target;
  delete from broadcasts_due;
  insert into ban_lifts (play, ban) values (target, ban);
  if pg_temp.selfs(ann) is distinct from 1 or (select count(*) from broadcasts_due where event = 'self') is distinct from 1 then raise exception 'a ban_lifts row should poke the banned character''s owner alone: [%]', pg_temp.all_selfs(); end if;
  delete from broadcasts_due;
  insert into warn_reliefs (play, infraction, points) values (target, infraction, 1);
  if pg_temp.selfs(ann) is distinct from 1 or (select count(*) from broadcasts_due where event = 'self') is distinct from 1 then raise exception 'a warn_reliefs row should poke the infracted character''s owner alone: [%]', pg_temp.all_selfs(); end if;
  -- An admin's end of the unban's play puts the ban back: it reaches the banned character's owner through the lift.
  delete from broadcasts_due;
  insert into acts (character, kind, thread, target_act_id, payload) values (null, 'card_end', t, target, '{"why": "reversed", "by": "admin"}');
  if pg_temp.selfs(ann) is distinct from 1 or pg_temp.selfs(bob) is distinct from 0 then raise exception 'ending a play that lifted a ban should poke the banned character''s owner: [%]', pg_temp.all_selfs(); end if;

  alter table acts enable trigger acts_well_formed;
  alter table acts enable trigger acts_warn_guard;
  alter table acts enable trigger acts_appeal_guard;
end $$;

-- P6. THE CHECK, and its red run. Every kind acts_kind_check allows is a kind that can change a player's own state (self_kinds) or one that cannot (quiet_kinds), never both and never neither.
do $$
declare
  problem text := pg_temp.classification_problem();
  red text;
  kinds text[] := pg_temp.constraint_kinds();
begin
  if problem is not null then raise exception 'THE CHECK: an Act kind is not held to a choice of "can change a player''s own state" or "cannot": %', problem; end if;
  if cardinality(kinds) < 30 then raise exception 'the check read % kinds out of acts_kind_check, which is too few to be reading it right: %', cardinality(kinds), kinds; end if;

  -- Red: a kind added to the constraint and listed in neither is found. The sub-block is rolled back whole (the exception below ends it), so the constraint is as it was.
  begin
    execute 'alter table acts drop constraint acts_kind_check';
    execute 'alter table acts add constraint acts_kind_check check (kind = any (array[' || (select string_agg(quote_literal(k), ', ') from unnest(array_append(kinds, 'zz_new_kind')) k) || ']))';
    red := pg_temp.classification_problem();
    raise exception using errcode = 'P0001', message = 'the check ran';
  exception when raise_exception then
    if sqlerrm <> 'the check ran' then raise; end if;
  end;
  if red is null or red is distinct from 'in acts_kind_check and in neither list: zz_new_kind' then raise exception 'THE CHECK did not go red on a kind added to acts_kind_check and listed in neither: %', coalesce(red, 'null'); end if;
  raise notice 'the check, driven red by a new kind: %', red;
  if pg_temp.constraint_kinds() is distinct from kinds then raise exception 'the red run left acts_kind_check changed'; end if;
  -- And a kind listed in both is found, and a kind listed and not allowed.
  if exists (select 1 from unnest(self_kinds()) s where s = any (quiet_kinds())) then raise exception 'a kind is in both lists'; end if;
end $$;

-- P7. The functions are for the triggers alone.
do $$
declare
  f text;
begin
  foreach f in array array['poke_self(uuid)', 'acts_self()', 'act_self_characters(uuid)', 'wallet_events_self()', 'card_ledger_self()', 'ban_lifts_self()', 'warn_reliefs_self()', 'self_uuid(text)', 'self_kinds()', 'quiet_kinds()'] loop
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute') or has_function_privilege('public', f, 'execute') or has_function_privilege('service_role', f, 'execute') then
      raise exception 'an API role can call %', f;
    end if;
  end loop;
end $$;

-- R. write_roster_entry opens the season's Roster thread and sends no `thread` event on a board: the thread's first post (a seq Act) fires acts_live_lists, which sends the board's `row` and the index's `board`.
do $$
declare
  boss_before text;
  sid bigint;
  base timestamptz := now() + interval '30 days';
  said jsonb;
  th uuid;
  bd uuid;
  rows jsonb;
begin
  insert into characters (name, staff, staff_kind, debuted_at) values ('Poke Boss', 'poke-boss', 'persona', now());
  update seasons set boss = 'poke-boss', turns_thread = null where ends_at is null;
  insert into settings (key, value) values ('systemEnabled', 'true') on conflict (key) do update set value = 'true';
  update settings set value = value || jsonb_build_object('rosterThreadTitle', 'Season {season}: Roster Report') where key = 'copy';
  select id into sid from seasons where ends_at is null;
  insert into settlements (starts_at, ends_at, season) values (base - interval '1 day', base, sid);
  delete from broadcasts_due;
  said := write_roster_entry(base, '{}', array['A roster body.'], '{}'::jsonb);
  if not (said ->> 'written')::boolean or (said ->> 'posts')::integer is distinct from 1 then raise exception 'the roster entry did not post, so this proves nothing: %', said; end if;
  th := (said ->> 'thread')::uuid;
  select t.board into bd from threads t where t.id = th;
  if exists (select 1 from broadcasts_due where event = 'thread') then raise exception 'write_roster_entry queued a thread event: %', (select jsonb_agg(topic) from broadcasts_due where event = 'thread'); end if;
  rows := pg_temp.queued('board:' || bd);
  if not exists (select 1 from jsonb_array_elements(rows) r where r ->> 'event' = 'row' and r -> 'payload' ->> 'id' = th::text) then
    raise exception 'the roster thread''s first post should send its row on the board, queued %', rows;
  end if;
end $$;

-- M. A board move tells both boards (issue #1241): the new board hears the thread's `row`, the old board hears `moved` with the stub board_page lists for it, and the index hears each board's entry.
-- M1. One moveThread queues one `row` on the new board equal to board_page's row there, one `moved` on the old board equal to board_page's stub there, and a `board` on `index` for each board.
-- M2. The `moved` payload holds exactly the stub's keys, and neither event carries an owner, an account or a reader.
-- M3. A reversal queues a `row` on the board the thread is back on, and a `gone` {id} (no `moved`) on the board it leaves; an update of threads that moves nothing queues none.
-- M5. A move of two threads gives each its own row and moved; a move of more than 50 threads off a board gives that board one `changed` {} and no row, moved or gone.
-- M4. thread_stub is for the trigger alone.
create function pg_temp.mv_board(slug text) returns uuid language sql as $$ select id from boards where slug = mv_board.slug $$;
create function pg_temp.mv_queue(kind text, params jsonb) returns bigint language plpgsql as $$
declare
  m bigint;
  q bigint;
begin
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (m, 'mv-boss', kind, params, null, 'because', now() - interval '1 minute', now() - interval '1 minute', false) returning id into q;
  return q;
end $$;
create function pg_temp.mv_land(q bigint) returns uuid language plpgsql as $$
declare
  r queued_moves;
begin
  perform system_tick();
  select * into r from queued_moves where id = q;
  if r.landed_act is null then raise exception 'the move did not land: refused % failure %', r.refused_at, r.failure; end if;
  return r.landed_act;
end $$;
create function pg_temp.mv_stub(reader uuid, slug text, in_thread uuid) returns jsonb language plpgsql as $$
declare
  got jsonb;
begin
  perform tests.become(reader);
  select s into got from jsonb_array_elements(board_page(slug, 1, array[]::text[]) -> 'stubs') s where s ->> 'id' = in_thread::text;
  perform tests.unbecome();
  return got;
end $$;

do $$
declare
  seed jsonb;
  ann uuid := tests.account('mv-ann');
  a uuid;
  t uuid;
  mv uuid;
  one uuid;
  two uuid;
  got jsonb;
  ev jsonb;
  want jsonb;
  keys text[];
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'movedStubDays', 7, 'titleMaxLength', 100, 'postMaxLength', 5000,
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'moveSuperseded', jsonb_build_array('Superseded: {move}.'), 'moveReversed', jsonb_build_array('Reversed: {move}.')),
      'systemMoveWords', jsonb_build_object('moveThread', 'the moving of a thread to another board')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'mv-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'mv-boss', 'name', 'Move Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb)),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(jsonb_build_object('key', 'moveThread', 'structural', false, 'shapesBoard', false, 'lasting', true, 'offices', jsonb_build_array('boss'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'))));
  perform seed_instance(seed);
  insert into boards (slug, name, created_at) values ('mv-one', 'Move One', now() - interval '9 days'), ('mv-two', 'Move Two', now() - interval '8 days');
  one := pg_temp.mv_board('mv-one');
  two := pg_temp.mv_board('mv-two');
  a := tests.character(ann, 'Move Ann', 'alpha', now() - interval '60 days');
  insert into threads (board, title) values (one, 'Wandering list') returning id into t;
  perform tests.post(a, t, 'First post.');
  perform tests.post(a, t, 'Second post.');
  perform pg_temp.flush();
  delete from broadcasts_due;

  -- M1. The move.
  mv := pg_temp.mv_land(pg_temp.mv_queue('moveThread', jsonb_build_object('thread', t, 'board', two)));
  if (select board from threads where id = t) is distinct from two then raise exception 'the thread did not move, so this proves nothing'; end if;

  got := pg_temp.queued('board:' || two);
  if (select count(*) from jsonb_array_elements(got) e where e ->> 'event' = 'row' and e -> 'payload' ->> 'id' = t::text) is distinct from 1 then
    raise exception 'a move should queue one row of the thread on the new board, queued %', got;
  end if;
  ev := (select e -> 'payload' from jsonb_array_elements(got) e where e ->> 'event' = 'row' and e -> 'payload' ->> 'id' = t::text);
  if ev is distinct from pg_temp.page_row(ann, t) then
    raise exception 'the row on the new board should equal board_page''s row there: queued % page %', ev, pg_temp.page_row(ann, t);
  end if;
  got := pg_temp.queued('board:' || one);
  if (select count(*) from jsonb_array_elements(got) e where e ->> 'event' = 'moved') is distinct from 1 then
    raise exception 'a move should queue one moved on the old board, queued %', got;
  end if;
  if exists (select 1 from jsonb_array_elements(got) e where e ->> 'event' = 'row' and e -> 'payload' ->> 'id' = t::text) then
    raise exception 'the old board should hear no row of a thread that left it, queued %', got;
  end if;
  ev := (select e -> 'payload' from jsonb_array_elements(got) e where e ->> 'event' = 'moved');
  want := pg_temp.mv_stub(ann, 'mv-one', t);
  if want is null or ev is distinct from want then
    raise exception 'the moved payload should equal the stub board_page lists on the old board: queued % page %', ev, want;
  end if;
  -- M2. The stub's keys, pinned; nothing private.
  select array_agg(k order by k) into keys from jsonb_object_keys(ev) k;
  if keys is distinct from array['id', 'moved_at', 'moved_to', 'moved_to_name', 'moved_to_slug', 'title'] then
    raise exception 'the moved payload''s keys changed: %', keys;
  end if;
  if exists (select 1 from jsonb_array_elements(pg_temp.queued('board:' || one) || pg_temp.queued('board:' || two)) e
             where e::text ~* '(owner|account|reader|views)' ) then
    raise exception 'a move event carries something private: % %', pg_temp.queued('board:' || one), pg_temp.queued('board:' || two);
  end if;
  -- The index hears each board's entry, equal to index_page's.
  foreach mv in array array[one, two] loop
    if (select count(*) from jsonb_array_elements(pg_temp.queued('index')) e where e ->> 'event' = 'board' and e -> 'payload' ->> 'id' = mv::text) is distinct from 1 then
      raise exception 'a move should queue one board entry on the index for each board, queued %', pg_temp.queued('index');
    end if;
    if (select e -> 'payload' from jsonb_array_elements(pg_temp.queued('index')) e where e ->> 'event' = 'board' and e -> 'payload' ->> 'id' = mv::text) is distinct from pg_temp.index_entry(ann, mv) then
      raise exception 'the index entry should equal index_page''s: % %', pg_temp.queued('index'), pg_temp.index_entry(ann, mv);
    end if;
  end loop;

  -- M3. A reversal: the thread is back on the first board, which hears its row; the second lists no stub of it, so it hears `gone` with the id alone. A non-move update queues nothing.
  select id into mv from acts where kind = 'move' and thread is not null and payload ->> 'kind' = 'moveThread' order by created_at desc limit 1;
  delete from broadcasts_due;
  perform end_move(mv, 'reversed', 'admin');
  if (select board from threads where id = t) is distinct from one then raise exception 'the reversal did not move the thread back, so this proves nothing'; end if;
  if (select count(*) from jsonb_array_elements(pg_temp.queued('board:' || one)) e where e ->> 'event' = 'row' and e -> 'payload' ->> 'id' = t::text) is distinct from 1 then
    raise exception 'a reversal should queue the thread''s row on the board it is back on, queued %', pg_temp.queued('board:' || one);
  end if;
  if exists (select 1 from broadcasts_due where event = 'moved') then raise exception 'a reversal queued a moved: %', (select jsonb_agg(payload) from broadcasts_due where event = 'moved'); end if;
  got := pg_temp.queued('board:' || two);
  if (select count(*) from jsonb_array_elements(got) e where e ->> 'event' = 'gone') is distinct from 1
     or (select e -> 'payload' from jsonb_array_elements(got) e where e ->> 'event' = 'gone') is distinct from jsonb_build_object('id', t) then
    raise exception 'a reversal should queue one gone with the thread id alone on the board it leaves, queued %', got;
  end if;
  delete from broadcasts_due;
  update threads set title = title where id = t;
  update threads set last_at = last_at where id = t;
  perform pg_temp.flush();
  if exists (select 1 from broadcasts_due where event in ('row', 'moved', 'board')) then
    raise exception 'an update of threads that moves nothing queued %', (select jsonb_agg(topic || ':' || event) from broadcasts_due);
  end if;

  -- M5. Several threads leave one board at once, as a rebuild finds them (stale rows put under replica role, which sends nothing): each gets its own events.
  declare
    ts uuid[] := array[]::uuid[];
    i integer;
    ks text[];
  begin
    for i in 1..3 loop
      insert into threads (board, title) values (one, 'Batch ' || i) returning id into mv;
      perform tests.post(a, mv, 'Batch post ' || i);
      ts := ts || mv;
    end loop;
    perform set_config('session_replication_role', 'replica', true);
    update threads set board = two where id = any (ts);
    perform set_config('session_replication_role', 'origin', true);
    delete from broadcasts_due;
    if rebuild_thread_places(ts) is distinct from 3 then raise exception 'the rebuild did not move the three threads'; end if;
    if (select count(*) from jsonb_array_elements(pg_temp.queued('board:' || one)) e where e ->> 'event' = 'row') is distinct from 3 then
      raise exception 'three threads joining a board should send three rows, queued %', pg_temp.queued('board:' || one);
    end if;
    got := pg_temp.queued('board:' || two);
    if (select count(*) from jsonb_array_elements(got) e where e ->> 'event' = 'gone') is distinct from 3
       or exists (select 1 from jsonb_array_elements(got) e where e ->> 'event' not in ('gone')) then
      raise exception 'three threads leaving a board should send three gone and nothing else, queued %', got;
    end if;
    select array_agg(k order by k) into ks from jsonb_array_elements(got) e, jsonb_object_keys(e -> 'payload') k;
    if ks is distinct from array['id', 'id', 'id'] then raise exception 'a gone payload holds the id alone, keys %', ks; end if;

    -- More than 50: the board they leave and the board they join each hear one `changed` with an empty payload, and nothing per thread.
    ts := array[]::uuid[];
    for i in 1..55 loop
      insert into threads (board, title) values (one, 'Bulk ' || i) returning id into mv;
      ts := ts || mv;
    end loop;
    perform set_config('session_replication_role', 'replica', true);
    update threads set board = two where id = any (ts);
    perform set_config('session_replication_role', 'origin', true);
    delete from broadcasts_due;
    if rebuild_thread_places(ts) is distinct from 55 then raise exception 'the rebuild did not move the 55 threads'; end if;
    foreach mv in array array[one, two] loop
      got := pg_temp.queued('board:' || mv);
      if jsonb_array_length(got) is distinct from 1 or got -> 0 is distinct from jsonb_build_object('event', 'changed', 'payload', '{}'::jsonb) then
        raise exception 'a board 55 threads leave or join should hear one changed {} and nothing else, queued %', got;
      end if;
    end loop;
    if (select count(*) from broadcasts_due where topic = 'index' and event = 'board') is distinct from 2 then
      raise exception 'the index should still hear each board once, queued %', pg_temp.queued('index');
    end if;
  end;
end $$;

do $$
begin
  if has_function_privilege('anon', 'thread_stub(uuid, uuid)', 'execute') or has_function_privilege('authenticated', 'thread_stub(uuid, uuid)', 'execute')
     or has_function_privilege('public', 'thread_stub(uuid, uuid)', 'execute') then
    raise exception 'an API role can call thread_stub';
  end if;
end $$;

-- D3. The commit flush runs once for a transaction: one queue row for each statement means one deferred firing for each, and the firings after the first return at once, without reading the queue. 2,000 single-Act
-- statements in one transaction flush with at most 3 reads of live_list_queue (the first firing's drain; the old code made one for each of the 2,000, which cost 10 s at 20,000 statements), and a row queued after
-- the flush still flushes.
do $$
declare
  ann uuid := tests.account('Flush Ann');
  a uuid := tests.character(ann, 'Flush Ann', 'alpha', now() - interval '60 days');
  t uuid := tests.thread('Flush list');
  i integer; reads_before bigint; reads_after bigint; 
begin
  perform tests.post(a, t, 'Seed.');
  perform pg_temp.flush();
  delete from broadcasts_due;
  for i in 1..2000 loop
    insert into acts (character, kind, thread, payload) values (a, 'post', t, jsonb_build_object('body', 'Statement ' || i));
  end loop;
  if (select count(*) from live_list_queue) is distinct from 2000 then raise exception 'expected 2000 queued rows, found %', (select count(*) from live_list_queue); end if;
  reads_before := (select coalesce(sum(x.seq_scan + coalesce(x.idx_scan, 0)), 0) from pg_stat_xact_user_tables x where x.relname = 'live_list_queue');
  perform pg_temp.flush();
  reads_after := (select coalesce(sum(x.seq_scan + coalesce(x.idx_scan, 0)), 0) from pg_stat_xact_user_tables x where x.relname = 'live_list_queue');
  -- Measured: 1 read; the old code read once for each of the 2,000 firings, so a bound of 3 fails it.
  if reads_after - reads_before > 3 then raise exception '2,000 statements flushed with % reads of live_list_queue', reads_after - reads_before; end if;
  if (select count(*) from broadcasts_due where event = 'row') is distinct from 1 then raise exception 'one thread, one row expected, queued %', (select count(*) from broadcasts_due where event = 'row'); end if;
  -- A statement after the flush, in the same transaction, is flushed too.
  delete from broadcasts_due;
  insert into acts (character, kind, thread, payload) values (a, 'post', t, jsonb_build_object('body', 'After the flush.'));
  perform pg_temp.flush();
  if (select count(*) from broadcasts_due where event = 'row') is distinct from 1 then raise exception 'a post queued after a flush should flush its row, queued %', (select count(*) from broadcasts_due); end if;
  raise notice 'D3: % reads of the queue', reads_after - reads_before;
end $$;
