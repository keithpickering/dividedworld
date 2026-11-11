-- origin_place (supabase/migrations/0079_origin_place.sql; docs/plans/2026-11-04-origin-place-design.md, section 2): thread_open and
-- thread_list say where a spun thread's origin can be found, as one jsonb read with the row. A post, a spin's first post and the other
-- Acts with a place number read as `post`; an update as `update`; a card, a face-down set and a trap's spring as `play`, with the
-- card's key (null for a set, so the column never names a trap) and where it landed: a post, an update, a character, a thread or a
-- board. A legacy numbered card (0035's leftover) is a play, never `#N`. The two old columns, origin_title and origin_seq, are gone.
-- A board is named as it is called now (supabase/migrations/0150_origin_place_board_now.sql; docs/plans/2026-11-11-origin-place-rename-plan.md):
-- boards_now's name, so a rename in force shows and one that ends gives the earlier name back.

-- The migration exists at all (so a missing one fails here, on an assertion, and not on a fixture below).
do $$
declare vw text;
begin
  foreach vw in array array['thread_open', 'thread_list'] loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = vw and column_name = 'origin_place') then
      raise exception '% has no origin_place column', vw;
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = vw and column_name in ('origin_title', 'origin_seq')) then
      raise exception '% still has origin_title or origin_seq', vw;
    end if;
    if (select column_name::text from information_schema.columns where table_schema = 'public' and table_name = vw order by ordinal_position desc limit 1) is distinct from 'origin_place' then
      raise exception 'origin_place is not the last column of %', vw;
    end if;
  end loop;
  -- The ORIGIN box subscribes to the origin's thread: it stays.
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'thread_list' and column_name = 'origin_thread') then
    raise exception 'thread_list lost origin_thread';
  end if;
end $$;

-- The place a thread's row gives, read from both views, which must agree. Null when the thread was not spun.
create function pg_temp.place(th uuid) returns jsonb language plpgsql as $$
declare a jsonb; b jsonb;
begin
  select origin_place into a from thread_open where id = th;
  select origin_place into b from thread_list where id = th;
  if a is distinct from b then raise exception 'thread_open and thread_list differ: % and %', a, b; end if;
  return a;
end $$;

-- A thread spun from an Act, through spin() as the Act's player.
create function pg_temp.spun(who uuid, through uuid, origin uuid, title text) returns uuid language plpgsql as $$
declare made jsonb;
begin
  perform tests.become(who);
  made := spin(origin, through, title, 'Discuss.');
  perform tests.unbecome();
  return (made -> 'thread' ->> 'id')::uuid;
end $$;

-- ---- Every origin a thread can be spun from ----
do $$
declare
  ann uuid := tests.account('op-ann'); bob uuid := tests.account('op-bob');
  a uuid := tests.character(ann, 'Op Ann'); b uuid := tests.character(bob, 'Op Bob');
  hidden uuid;
  t uuid := tests.thread('Op Thread'); other uuid := tests.thread('Op Other');
  general uuid := (select id from boards where slug = 'general');
  first_post uuid; p uuid; card_act uuid; set_act uuid; spring_act uuid; reach_act uuid; legacy uuid; upd uuid; plain uuid;
  got jsonb;
  p_place jsonb;
  dev uuid;
begin
  first_post := tests.post(b, t, 'First.');
  p := tests.post(b, t, 'Second.');
  p_place := jsonb_build_object('kind', 'post', 'thread', t, 'title', 'Op Thread', 'seq', (select seq from acts where id = p));

  -- A thread not spun has no place.
  if pg_temp.place(t) is not null then raise exception 'a thread that was not spun has a place: %', pg_temp.place(t); end if;

  -- A post: its thread, that thread's title and its own place number.
  got := pg_temp.place(pg_temp.spun(ann, a, p, 'From a post'));
  if got is distinct from p_place then raise exception 'a spin from a post: %, wanted %', got, p_place; end if;

  -- A face-up card on that post: a play, with the card's key and the post's place.
  card_act := tests.act(a, 'card', t, '{"card": "sweetie"}', p);
  got := pg_temp.place(pg_temp.spun(ann, a, card_act, 'From a card'));
  if got is distinct from jsonb_build_object('kind', 'play', 'card', 'sweetie', 'on', p_place) then raise exception 'a spin from a card on a post: %', got; end if;

  -- A face-down set on that post: a play whose card is null, and the jsonb holds no card key anywhere.
  set_act := tests.act(b, 'set', t, '{}', p);
  insert into face_down (play, account, card, post, thread, round, ends_at) values (set_act, bob, 'splat', p, t, 1, now() + interval '1 day');
  got := pg_temp.place(pg_temp.spun(ann, a, set_act, 'From a set'));
  if got is distinct from jsonb_build_object('kind', 'play', 'card', null, 'on', p_place) then raise exception 'a spin from a face-down set: %', got; end if;
  if got::text like '%splat%' or got ? 'trap' then raise exception 'a set''s place names its trap: %', got; end if;

  -- A trap's spring: a play with the trap's card key, on the post.
  spring_act := tests.act(b, 'spring', t, jsonb_build_object('card', 'splat', 'trigger', 'cast', 'outcome', jsonb_build_object('do', 'nullify'), 'set', set_act), p);
  got := pg_temp.place(pg_temp.spun(ann, a, spring_act, 'From a spring'));
  if got is distinct from jsonb_build_object('kind', 'play', 'card', 'splat', 'on', p_place) then raise exception 'a spin from a spring: %', got; end if;
  -- A set whose spring has landed still reads face down: the spring is its own Act.
  got := pg_temp.place((select id from threads where origin_act_id = set_act));
  if got is distinct from jsonb_build_object('kind', 'play', 'card', null, 'on', p_place) then raise exception 'a set stays face down once sprung: %', got; end if;

  -- A play on a character, through play_reach: the character's name.
  reach_act := tests.act(a, 'card', t, jsonb_build_object('card', 'sweetie', 'reach', 'character', 'character', b), p);
  insert into play_reach (play, reach, character, ends_at) values (reach_act, 'character', b, now() + interval '1 day');
  got := pg_temp.place(pg_temp.spun(ann, a, reach_act, 'From a character play'));
  if got is distinct from jsonb_build_object('kind', 'play', 'card', 'sweetie', 'on', jsonb_build_object('kind', 'character', 'id', b, 'name', 'Op Bob')) then
    raise exception 'a spin from a play on a character: %', got;
  end if;
  -- A character that has not debuted is not named: the name reads null, and nothing else in the place gives the character away
  -- beyond the id the play's own row already carries.
  insert into characters (owner, name) values (bob, 'Op Hidden') returning id into hidden;
  reach_act := tests.act(a, 'card', t, jsonb_build_object('card', 'sweetie', 'reach', 'character', 'character', hidden), p);
  insert into play_reach (play, reach, character, ends_at) values (reach_act, 'character', hidden, now() + interval '1 day');
  got := pg_temp.place(pg_temp.spun(ann, a, reach_act, 'From a play on a waiting character'));
  if got is distinct from jsonb_build_object('kind', 'play', 'card', 'sweetie', 'on', jsonb_build_object('kind', 'character', 'id', hidden, 'name', null)) then
    raise exception 'a play on a character that has not debuted: %', got;
  end if;
  if got::text like '%Op Hidden%' then raise exception 'a waiting character''s name is in the place: %', got; end if;

  -- A play on a thread: the thread and its title (the play sits on that thread's first post).
  reach_act := tests.act(a, 'card', other, jsonb_build_object('card', 'sweetie', 'reach', 'thread', 'thread', t), first_post);
  insert into play_reach (play, reach, thread, ends_at) values (reach_act, 'thread', t, now() + interval '1 day');
  got := pg_temp.place(pg_temp.spun(ann, a, reach_act, 'From a thread play'));
  if got is distinct from jsonb_build_object('kind', 'play', 'card', 'sweetie', 'on', jsonb_build_object('kind', 'thread', 'id', t, 'title', 'Op Thread')) then
    raise exception 'a spin from a play on a thread: %', got;
  end if;

  -- A play on a board: the board's slug and name, with no post to point at.
  reach_act := tests.act(a, 'card', other, jsonb_build_object('card', 'sweetie', 'reach', 'board', 'board', general), null);
  insert into play_reach (play, reach, board, ends_at) values (reach_act, 'board', general, now() + interval '1 day');
  got := pg_temp.place(pg_temp.spun(ann, a, reach_act, 'From a board play'));
  if got is distinct from jsonb_build_object('kind', 'play', 'card', 'sweetie', 'on', jsonb_build_object('kind', 'board', 'slug', 'general', 'name', 'General')) then
    raise exception 'a spin from a play on a board: %', got;
  end if;

  -- A legacy numbered card (an old database's row, from before 0035): a play, never `#N` in a place no page draws.
  alter table acts disable trigger acts_take_seq;
  insert into acts (character, kind, thread, payload, target_act_id, seq) values (a, 'card', t, '{"card": "sweetie"}', p, 99) returning id into legacy;
  alter table acts enable trigger acts_take_seq;
  if (select seq from acts where id = legacy) is distinct from 99 then raise exception 'the fixture did not stage a numbered card'; end if;
  got := pg_temp.place(pg_temp.spun(ann, a, legacy, 'From an old card'));
  if got is distinct from jsonb_build_object('kind', 'play', 'card', 'sweetie', 'on', p_place) then raise exception 'a legacy numbered card is not a play: %', got; end if;

  -- An update: its headline, and the thread it opens is listed on the players' first board and is not "#N in Updates".
  perform seed_instance(jsonb_build_object('settings', '{}'::jsonb, 'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Op Gabe', 'title', 'Made this.', 'avatar', 'gabe')));
  select id into dev from characters where staff_kind = 'developer';
  perform set_config('kayfabb.update_writer', 'on', true);
  perform set_config('kayfabb.staff_writer', 'on', true);
  upd := tests.act(dev, 'update', (select (value #>> '{}')::uuid from settings where key = 'updatesThread'), '{"title": "Op Headline", "body": "Body.", "changes": []}');
  perform set_config('kayfabb.update_writer', 'off', true);
  perform set_config('kayfabb.staff_writer', 'off', true);
  plain := pg_temp.spun(ann, a, upd, 'From an update');
  got := pg_temp.place(plain);
  if got is distinct from jsonb_build_object('kind', 'update', 'act', upd, 'title', 'Op Headline') then raise exception 'a spin from an update: %', got; end if;
  if not exists (select 1 from thread_list where id = plain and board = players_board()) then raise exception 'a thread spun from an update is listed on the players'' board'; end if;
  if got::text like '%Updates%' then raise exception 'an update''s place is read as a post in the Updates thread: %', got; end if;

  -- A play on an update: the update's headline. No door writes one today (a card lands on a post, acts_well_formed), so the row is staged
  -- with that trigger off; the view still reads it, for the day one does.
  alter table acts disable trigger acts_well_formed;
  reach_act := tests.act(a, 'card', (select thread from acts where id = upd), '{"card": "sweetie"}', upd);
  alter table acts enable trigger acts_well_formed;
  got := pg_temp.place(pg_temp.spun(ann, a, reach_act, 'From a card on an update'));
  if got is distinct from jsonb_build_object('kind', 'play', 'card', 'sweetie', 'on', jsonb_build_object('kind', 'update', 'act', upd, 'title', 'Op Headline')) then
    raise exception 'a spin from a card on an update: %', got;
  end if;
end $$;

-- ---- A play on a board names the board as it is called now ----
-- A renameBoard move as a staff Boss's Act, written as the tick writes one (supabase/tests/0051-moves.sql), at a time of the test's choosing.
create function pg_temp.rename(on_board uuid, new_name text, at timestamptz) returns uuid language plpgsql as $$
declare boss uuid; ann uuid; written uuid;
begin
  select id into boss from characters where staff = 'op-boss';
  if boss is null then insert into characters (name, staff, staff_kind, debuted_at) values ('Op Boss', 'op-boss', 'persona', now()) returning id into boss; end if;
  select t.id into ann from threads t join boards b on b.id = t.board where b.is_system and t.title = 'Op Announcements';
  if ann is null then insert into threads (board, title) select id, 'Op Announcements' from boards where is_system returning id into ann; end if;
  insert into move_kinds (key, structural) values ('renameBoard', true) on conflict (key) do update set structural = excluded.structural;
  perform set_config('kayfabb.staff_writer', 'on', true);
  written := tests.act(boss, 'move', ann, jsonb_build_object('kind', 'renameBoard', 'body', 'The System has spoken.',
    'params', jsonb_build_object('board', on_board, 'name', new_name, 'premise', 'The subject of ' || new_name, 'description', 'About ' || new_name),
    'expires_at', at + interval '3 days'), null, at);
  perform set_config('kayfabb.staff_writer', '', true);
  return written;
end $$;

do $$
declare
  ann uuid := tests.account('opr-ann');
  a uuid := tests.character(ann, 'Opr Ann');
  t uuid := tests.thread('Opr Thread');
  general uuid := (select id from boards where slug = 'general');
  elsewhere uuid;
  play uuid; spun uuid; first_move uuid; second_move uuid;
  got jsonb;
begin
  perform tests.post(a, t, 'First.');
  insert into boards (slug, name, description) values ('opr-elsewhere', 'Opr Elsewhere', 'Another board.') returning id into elsewhere;
  play := tests.act(a, 'card', t, jsonb_build_object('card', 'sweetie', 'reach', 'board', 'board', general), null);
  insert into play_reach (play, reach, board, ends_at) values (play, 'board', general, now() + interval '1 day');
  spun := pg_temp.spun(ann, a, play, 'From a play on a board that is renamed');

  -- What the place must read: the play's card, on the board by its slug and the name given. The name is also boards_now's, at every step.
  create function pg_temp.named(th uuid, board uuid, name text, step text) returns void language plpgsql as $f$
  declare got jsonb := pg_temp.place(th);
  begin
    if got is distinct from jsonb_build_object('kind', 'play', 'card', 'sweetie', 'on', jsonb_build_object('kind', 'board', 'slug', 'general', 'name', name)) then
      raise exception '%: the place is %, wanted the board named %', step, got, name;
    end if;
    if (select n.name from boards_now n where n.id = board) is distinct from name then
      raise exception '%: boards_now names the board %, the test expected %', step, (select n.name from boards_now n where n.id = board), name;
    end if;
  end $f$;

  -- No move: the board's own name.
  perform pg_temp.named(spun, general, 'General', 'before any move');

  -- A rename of another board is not this board's name.
  perform pg_temp.rename(elsewhere, 'Opr Nowhere', now() - interval '3 hours');
  perform pg_temp.named(spun, general, 'General', 'another board renamed');

  -- A rename lands: the place names the board as every other screen does, and the slug, the link, is as it was.
  first_move := pg_temp.rename(general, 'Toast Palace', now() - interval '2 hours');
  perform pg_temp.named(spun, general, 'Toast Palace', 'a rename in force');

  -- A later rename: the latest one in force.
  second_move := pg_temp.rename(general, 'Crumb Hall', now() - interval '1 hour');
  perform pg_temp.named(spun, general, 'Crumb Hall', 'a second rename in force');

  -- An admin reverses the later one: the earlier rename, still in force, names the board again.
  perform end_move(second_move, 'reversed', 'admin');
  perform pg_temp.named(spun, general, 'Toast Palace', 'the second rename reversed');

  -- The first expires: the board's own name is back.
  perform end_move(first_move, 'expired', 'tick');
  perform pg_temp.named(spun, general, 'General', 'every rename ended');

  -- A thread spun from the play after a rename reads the same as one spun before it: the name is the board's now, not the spin's day's.
  first_move := pg_temp.rename(general, 'Butter Annex', now() - interval '30 minutes');
  perform pg_temp.named(pg_temp.spun(ann, a, play, 'Spun after a rename'), general, 'Butter Annex', 'spun while renamed');
  perform pg_temp.named(spun, general, 'Butter Annex', 'spun before the rename');

  -- Every move still in force ended, so the section leaves the board names as it found them (as 0051-moves.sql's sections do).
  perform end_move(o.move_act, 'expired', 'test') from open_moves o;
  perform pg_temp.named(spun, general, 'General', 'the section''s moves ended');
end $$;

-- ---- The columns, and who reads them ----
do $$
declare vw text;
begin
  foreach vw in array array['thread_open', 'thread_list'] loop
    if (select array_agg(column_name::text order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = vw)
       is distinct from array['id', 'board', 'title', 'origin_act_id', 'created_at', 'last_at', 'last_seq', 'replies', 'first_act', 'first_character', 'last_act', 'last_character', 'replies_this_week', 'origin_thread', 'origin_place'] then
      raise exception '% shows more or less than it should', vw;
    end if;
  end loop;
  if not (has_table_privilege('authenticated', 'thread_open', 'select') and has_table_privilege('authenticated', 'thread_list', 'select')) then raise exception 'a player cannot read the views'; end if;
  if has_table_privilege('anon', 'thread_open', 'select') or has_table_privilege('anon', 'thread_list', 'select') then raise exception 'a visitor can read the views'; end if;
  if has_table_privilege('authenticated', 'thread_list', 'insert') or has_table_privilege('authenticated', 'thread_open', 'update') then raise exception 'a player can write the views'; end if;
  if not has_table_privilege('kayfabb_digest', 'thread_list', 'select') then raise exception 'the digest cannot read thread_list (0045)'; end if;
  if has_table_privilege('kayfabb_digest', 'thread_open', 'select') then raise exception 'the digest reads thread_open'; end if;
end $$;
