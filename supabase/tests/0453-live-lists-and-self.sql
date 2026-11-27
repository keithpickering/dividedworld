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

  -- A card_ledger row.
  delete from broadcasts_due;
  insert into card_ledger (account, card, kind, price) select bob, key, 'bought', 0 from card_kinds limit 1;
  if pg_temp.selfs(bob) is distinct from 1 or (select count(*) from broadcasts_due where event = 'self') is distinct from 1 then raise exception 'a card_ledger row should queue one self for its account: %', pg_temp.all_selfs(); end if;

  -- One statement, one poke for each account.
  delete from broadcasts_due;
  insert into card_ledger (account, card, kind, price) select x, k.key, 'bought', 0 from (values (ann), (ann), (ann), (bob)) v(x), (select key from card_kinds limit 1) k;
  if pg_temp.selfs(ann) is distinct from 1 or pg_temp.selfs(bob) is distinct from 1 then raise exception 'a statement of four ledger rows should poke each of two accounts once: %', pg_temp.all_selfs(); end if;
  delete from broadcasts_due;
  insert into wallet_events (account, kind, change, balance_after) values (ann, 'grant', 1, 1), (ann, 'grant', 1, 2), (bob, 'settlement', 1, 1);
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
  fixtures text[] := array['infraction', 'ban', 'move', 'move_end', 'card_end', 'appeal_ruling', 'unmask', 'spring'];
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
    end if;
    if pg_temp.selfs(ann) is distinct from 1 then raise exception 'a "%" Act on a character should queue one self for its owner, queued: [%]', k, pg_temp.all_selfs(); end if;
    if (select count(*) from broadcasts_due where event = 'self') is distinct from 1 then raise exception 'a "%" Act poked someone beside its character''s owner: [%]', k, pg_temp.all_selfs(); end if;
    if exists (select 1 from broadcasts_due where event = 'self' and (payload is distinct from '{}'::jsonb or topic is distinct from 'account:' || ann)) then raise exception 'a "%" self is not an empty poke on the owner''s channel: [%]', k, pg_temp.all_selfs(); end if;
  end loop;

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
