-- The bar and the apology (supabase/migrations/0126_bars_apologies.sql; docs/plans/2026-11-06-member-groups-plan.md, Task 6).
--
-- 1. barred(character, board) reads bars_now: true for the barred mask on that board only, false for the player's other mask, for another board, and for a move past its expiry
--    that the tick has not ended yet.
-- 2. post, start_thread, spin and edit_post each refuse a barred character in plain words naming the character, the board and the expiry; the same player's other mask is let through
--    on the same board; the bar is per board; a spin's board is the board its thread opens on.
-- 3. A banned and barred character is told of its ban, by each of the four.
-- 4. apologize: refused on someone else's move, on a move with another demand, on a move that has ended, and while banned; accepted for a move that bars the very board it spins onto;
--    a second apology while one waits, or within apologyEveryHours of one accepted, rejected or waiting, is refused, and one after a `returned` (or after the day) is allowed.
-- 5. rule_apology (service role): returned sets the row only; accepted and rejected write the ruling as a post by the move's staff character in the apology's thread, with the
--    payload {ruling, apology}; a second ruling on a ruled row is refused; an accepted one meets the demand, so system_tick ends the move `met` and lifts the bar.
-- 5b. A ruling on a move whose staff persona has since been benched sets the row all the same, and writes no post.
-- 6. pending_apologies (service role): the pending rows, oldest first, at most apologyJudgeBatch; a player cannot call either.

create function pg_temp.announcements() returns uuid language sql as $$
  select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements'
$$;
create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where boards.slug = board.slug $$;

-- Run a statement as an account (null: the service role); its first column as text, or 'ERROR: ' and the refusal.
create function pg_temp.as_val(who uuid, stmt text) returns text language plpgsql as $$
declare
  r text;
begin
  if who is null then perform tests.become_service(); else perform tests.become(who); end if;
  begin
    execute stmt into r;
  exception when others then
    r := 'ERROR: ' || sqlerrm;
  end;
  perform tests.unbecome();
  return r;
end $$;

-- A group move that has landed (as an Act), created `ago` ago, as in 0126's test.
create function pg_temp.landed(staff text, who uuid, grp text, ago interval default interval '0', board uuid default null, demand jsonb default null,
                               expires_in interval default interval '3 days', ended text default null) returns uuid language plpgsql as $$
declare
  made uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  made := tests.act((select id from characters c where c.staff = landed.staff), 'move', pg_temp.announcements(),
    jsonb_build_object('kind', 'conferGroup', 'body', 'Moved.',
      'params', jsonb_strip_nulls(jsonb_build_object('character', who::text, 'group', grp, 'board', board::text)))
      || case when demand is not null then jsonb_build_object('demand', demand) else '{}'::jsonb end
      || jsonb_build_object('expires_at', clock_timestamp() - ago + expires_in),
    null, clock_timestamp() - ago);
  perform set_config('kayfabb.staff_writer', '', true);
  if ended is not null then perform end_move(made, ended, 'test'); end if;
  return made;
end $$;

create function pg_temp.apology() returns jsonb language sql as $$ select jsonb_build_object('kind', 'apologyAccepted', 'params', '{}'::jsonb) $$;
create function pg_temp.posts_on(board uuid) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', board, 'count', 1))
$$;

-- A one-day ban of a character, with the infraction a ban follows, about a post of the character's in the thread.
create function pg_temp.ban(who uuid, in_thread uuid) returns void language plpgsql as $$
declare
  p uuid := tests.post(who, in_thread, 'A post that earned it.');
  inf uuid;
begin
  perform set_config('kayfabb.warn_writer', 'on', true);
  inf := tests.act(null, 'infraction', in_thread, jsonb_build_object('character', who, 'band', 'minor', 'points', 2, 'rule_number', null,
    'board', (select board from threads where id = in_thread), 'about_act', p, 'visit_act', null, 'staff', 'ba-boss', 'expires_at', now() + interval '14 days'));
  perform tests.act(null, 'ban', in_thread, jsonb_build_object('character', who, 'days', 1, 'until', now() + interval '1 day', 'infraction_act', inf, 'season', 1));
  perform set_config('kayfabb.warn_writer', '', true);
end $$;

-- How the bar names its end, as the refusal does: UTC, rounded up to the minute.
create function pg_temp.until_words(t timestamptz) returns text language sql as $$
  select to_char(date_trunc('minute', t + interval '59.999999 seconds') at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC'
$$;

-- ---- 0. The world: a Boss, a ladder with two conferred groups, two boards beside the fixtures' General ----
do $$
declare
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true,
      'apology', jsonb_build_object('apologyEveryHours', 24, 'apologyJudgeBatch', 2, 'apologyRulingMaxWords', 80),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'moveMet', jsonb_build_array('Met, {move}.')),
      'systemMoveWords', jsonb_build_object('conferGroup', 'moving a member into "{groupName}"')),
    'groups', jsonb_build_array(
      jsonb_build_object('key', 'members', 'name', 'Members', 'color', '#7a7a7a', 'source', 'ladder', 'rung', 0, 'condition', 'default'),
      jsonb_build_object('key', 'trialMembers', 'name', 'Trial Members', 'color', '#d2691e', 'stripe', true, 'source', 'conferred', 'tone', 'punishment'),
      jsonb_build_object('key', 'teachersPet', 'name', 'Teacher''s Pet', 'color', '#c2408f', 'source', 'conferred', 'tone', 'favor')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'ba-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'ba-boss', 'name', 'Bar Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb),
        jsonb_build_object('key', 'ba-mod', 'name', 'Bar Mod', 'title', 'Mod', 'signature', 'Hi', 'beats', '[]'::jsonb)),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'conferGroup', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'), 'derived', jsonb_build_array('groupName'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'), jsonb_build_object('key', 'apologyAccepted')),
      'predicates', jsonb_build_array(jsonb_build_object('key', 'noAllCaps', 'param', 'none', 'least', null, 'most', null, 'plain', 'no all-caps posts'))));
  perform seed_instance(seed);
  insert into boards (slug, name, description) values ('ba-games', 'Games', 'Talk about games.'), ('ba-general', 'Ba General', 'Talk about anything.');
end $$;

create function pg_temp.acct(label text) returns uuid language sql as $$ select id from auth.users where email = label || '@test.invalid' $$;

-- ---- 1. barred(): per character, per board, in force ----
do $$
declare
  games uuid := pg_temp.board('ba-games');
  general uuid := pg_temp.board('general');
  a uuid := tests.account('ba-a');
  b uuid := tests.account('ba-b');
  sorry uuid := tests.character(a, 'Ba Sorry');
  mask uuid := tests.character(a, 'Ba Mask');
  other uuid := tests.character(b, 'Ba Other');
  lapsed uuid := tests.character(tests.account('ba-lapsed'), 'Ba Lapsed');
  m uuid;
begin
  m := pg_temp.landed('ba-boss', sorry, 'trialMembers', interval '1 hour', games, pg_temp.apology());
  -- Past its expiry and not yet ended by the tick: no longer a bar.
  perform pg_temp.landed('ba-boss', lapsed, 'trialMembers', interval '2 hours', games, pg_temp.apology(), interval '1 hour');
  if pg_temp.as_val(a, format('select barred(%L, %L)', sorry, games)) is distinct from 'true' then
    raise exception 'the barred character is barred on its board: %', pg_temp.as_val(a, format('select barred(%L, %L)', sorry, games));
  end if;
  if pg_temp.as_val(a, format('select barred(%L, %L)', sorry, general)) is distinct from 'false' then raise exception 'a bar is per board: %', pg_temp.as_val(a, format('select barred(%L, %L)', sorry, general)); end if;
  if pg_temp.as_val(a, format('select barred(%L, %L)', mask, games)) is distinct from 'false' then raise exception 'a bar is per character: %', pg_temp.as_val(a, format('select barred(%L, %L)', mask, games)); end if;
  if pg_temp.as_val(b, format('select barred(%L, %L)', other, games)) is distinct from 'false' then raise exception 'another player is not barred: %', pg_temp.as_val(b, format('select barred(%L, %L)', other, games)); end if;
  if pg_temp.as_val(a, format('select barred(%L, %L)', lapsed, games)) is distinct from 'false' then raise exception 'a move past its expiry no longer bars: %', pg_temp.as_val(a, format('select barred(%L, %L)', lapsed, games)); end if;
  if pg_temp.as_val(a, 'select barred(null, null)') is distinct from 'false' then raise exception 'nobody on no board is not barred: %', pg_temp.as_val(a, 'select barred(null, null)'); end if;
  if move_expires_at(m) is null then raise exception 'the world has a move with an expiry'; end if;
end $$;

-- ---- 2. The four functions refuse a barred character, and let the same player's other mask through ----
do $$
declare
  games uuid := pg_temp.board('ba-games');
  general uuid := pg_temp.board('ba-general');
  a uuid := pg_temp.acct('ba-a');
  sorry uuid := (select id from characters where name = 'Ba Sorry');
  mask uuid := (select id from characters where name = 'Ba Mask');
  games_thread uuid;
  general_thread uuid;
  p_sorry uuid;
  p_sorry_general uuid;
  p_mask uuid;
  m uuid := (select move_act from bars_now where character = sorry);
  said text;
  want text;
  got text;
  threads_before bigint;
begin
  insert into threads (board, title) values (games, 'Ba games thread') returning id into games_thread;
  insert into threads (board, title) values (general, 'Ba general thread') returning id into general_thread;
  p_sorry := tests.post(sorry, games_thread, 'Before the bar.');
  p_sorry_general := tests.post(sorry, general_thread, 'Elsewhere, before.');
  p_mask := tests.post(mask, games_thread, 'The other mask.');
  want := 'ERROR: Ba Sorry is barred from posting on Games until ' || pg_temp.until_words(move_expires_at(m));
  threads_before := (select count(*) from threads);

  -- post
  got := pg_temp.as_val(a, format('select post(%L, %L, %L)', games_thread, sorry, 'Hello again.'));
  if got is distinct from want then raise exception 'post by the barred character: got %, wanted %', got, want; end if;
  got := pg_temp.as_val(a, format('select post(%L, %L, %L)', games_thread, mask, 'The other mask posts.'));
  if got like 'ERROR:%' then raise exception 'post by the other mask on the same board: %', got; end if;
  got := pg_temp.as_val(a, format('select post(%L, %L, %L)', general_thread, sorry, 'Elsewhere.'));
  if got like 'ERROR:%' then raise exception 'post by the barred character on another board: %', got; end if;

  -- start_thread
  got := pg_temp.as_val(a, format('select start_thread(%L, %L, %L, %L)', 'ba-games', sorry, 'A title', 'A body'));
  if got is distinct from want then raise exception 'start_thread by the barred character: got %, wanted %', got, want; end if;
  got := pg_temp.as_val(a, format('select start_thread(%L, %L, %L, %L)', 'ba-games', mask, 'Mask title', 'A body'));
  if got like 'ERROR:%' then raise exception 'start_thread by the other mask on the same board: %', got; end if;
  got := pg_temp.as_val(a, format('select start_thread(%L, %L, %L, %L)', 'ba-general', sorry, 'Elsewhere title', 'A body'));
  if got like 'ERROR:%' then raise exception 'start_thread by the barred character on another board: %', got; end if;
  if (select count(*) from threads) is distinct from threads_before + 2 then raise exception 'a refused start_thread left a thread behind'; end if;

  -- spin: the board is the board the new thread opens on, the origin's own
  got := pg_temp.as_val(a, format('select spin(%L, %L, %L, %L)', p_sorry, sorry, 'A spin', 'Body'));
  if got is distinct from want then raise exception 'spin onto the barred board: got %, wanted %', got, want; end if;
  got := pg_temp.as_val(a, format('select spin(%L, %L, %L, %L)', p_mask, mask, 'A spin', 'Body'));
  if got like 'ERROR:%' then raise exception 'spin by the other mask onto the same board: %', got; end if;
  got := pg_temp.as_val(a, format('select spin(%L, %L, %L, %L)', p_sorry_general, sorry, 'A spin', 'Body'));
  if got like 'ERROR:%' then raise exception 'spin by the barred character onto another board: %', got; end if;

  -- edit_post
  got := pg_temp.as_val(a, format('select edit_post(%L, %L, %L)', p_sorry, sorry, 'Edited.'));
  if got is distinct from want then raise exception 'edit_post by the barred character: got %, wanted %', got, want; end if;
  got := pg_temp.as_val(a, format('select edit_post(%L, %L, %L)', p_mask, mask, 'Edited by the other mask.'));
  if got like 'ERROR:%' then raise exception 'edit_post by the other mask on the same board: %', got; end if;
  got := pg_temp.as_val(a, format('select edit_post(%L, %L, %L)', p_sorry_general, sorry, 'Edited elsewhere.'));
  if got like 'ERROR:%' then raise exception 'edit_post by the barred character on another board: %', got; end if;
end $$;

-- ---- 3. A banned and barred character is told of its ban ----
do $$
declare
  games uuid := pg_temp.board('ba-games');
  c uuid := tests.account('ba-c');
  banbar uuid := tests.character(c, 'Ba Both');
  games_thread uuid := (select id from threads where title = 'Ba games thread');
  p uuid;
  got text;
begin
  p := tests.post(banbar, games_thread, 'Before banbar.');
  perform pg_temp.landed('ba-boss', banbar, 'trialMembers', interval '1 hour', games, pg_temp.apology());
  perform pg_temp.ban(banbar, games_thread);
  got := pg_temp.as_val(c, format('select post(%L, %L, %L)', games_thread, banbar, 'x'));
  if got is null or got not like 'ERROR: this character is banned until %' then raise exception 'post: a banned and barred character is told of its ban, got %', got; end if;
  got := pg_temp.as_val(c, format('select start_thread(%L, %L, %L, %L)', 'ba-games', banbar, 't', 'x'));
  if got is null or got not like 'ERROR: this character is banned until %' then raise exception 'start_thread: told of its ban, got %', got; end if;
  got := pg_temp.as_val(c, format('select spin(%L, %L, %L, %L)', p, banbar, 't', 'x'));
  if got is null or got not like 'ERROR: this character is banned until %' then raise exception 'spin: told of its ban, got %', got; end if;
  got := pg_temp.as_val(c, format('select edit_post(%L, %L, %L)', p, banbar, 'x'));
  if got is null or got not like 'ERROR: this character is banned until %' then raise exception 'edit_post: told of its ban, got %', got; end if;
end $$;

-- ---- 4. apologize ----
do $$
declare
  general uuid := pg_temp.board('general');
  games uuid := pg_temp.board('ba-games');
  d uuid := tests.account('ba-d');
  e uuid := tests.account('ba-e');
  sorry uuid := tests.character(d, 'Ap Sorry');
  other uuid := tests.character(e, 'Ap Other');
  plain uuid := tests.character(tests.account('ba-plain'), 'Ap Plain');
  gone uuid := tests.character(tests.account('ba-gone'), 'Ap Gone');
  banned_c uuid := tests.character(tests.account('ba-banned'), 'Ap Banned');
  m uuid;
  m_plain uuid;
  m_gone uuid;
  m_banned uuid;
  got text;
  row_ record;
  nope text := 'ERROR: there is no move of this character''s that an apology can answer';
begin
  -- The move bars General, the very board an apology spun from The System's announcement opens on.
  m := pg_temp.landed('ba-boss', sorry, 'trialMembers', interval '1 hour', general, pg_temp.apology());
  m_plain := pg_temp.landed('ba-boss', plain, 'trialMembers', interval '1 hour', null, pg_temp.posts_on(games));
  m_gone := pg_temp.landed('ba-boss', gone, 'trialMembers', interval '1 hour', general, pg_temp.apology(), interval '3 days', 'reversed');
  m_banned := pg_temp.landed('ba-boss', banned_c, 'trialMembers', interval '1 hour', general, pg_temp.apology());
  perform pg_temp.ban(banned_c, (select id from threads where title = 'Ba games thread'));

  if not (select barred(sorry, general)) then raise exception 'the move bars General'; end if;
  got := pg_temp.as_val(d, format('select spin(%L, %L, %L, %L)', m, sorry, 'Plain spin', 'Body'));
  if got is distinct from 'ERROR: Ap Sorry is barred from posting on General until ' || pg_temp.until_words(move_expires_at(m)) then
    raise exception 'a plain spin onto the barred board is refused, got %', got;
  end if;

  -- Whose move, which demand, and whether it is in force.
  got := pg_temp.as_val(e, format('select apologize(%L, %L, %L, %L)', m, other, 'Sorry', 'Not mine.'));
  if got is distinct from nope then raise exception 'apologize on someone else''s move: got %', got; end if;
  got := pg_temp.as_val(e, format('select apologize(%L, %L, %L, %L)', m, sorry, 'Sorry', 'Not mine.'));
  if got is null or got not like 'ERROR:%' then raise exception 'apologize as a character the caller does not play was allowed: %', got; end if;
  got := pg_temp.as_val(pg_temp.acct('ba-plain'), format('select apologize(%L, %L, %L, %L)', m_plain, plain, 'Sorry', 'No apology asked.'));
  if got is distinct from nope then raise exception 'apologize on a move whose demand is not an apology: got %', got; end if;
  got := pg_temp.as_val(pg_temp.acct('ba-gone'), format('select apologize(%L, %L, %L, %L)', m_gone, gone, 'Sorry', 'Too late.'));
  if got is distinct from nope then raise exception 'apologize on a move that has ended: got %', got; end if;
  got := pg_temp.as_val(pg_temp.acct('ba-banned'), format('select apologize(%L, %L, %L, %L)', m_banned, banned_c, 'Sorry', 'While banned.'));
  if got is null or got not like 'ERROR: this character is banned until %' then raise exception 'apologize while banned: got %', got; end if;
  if exists (select 1 from apologies where move_act in (m_plain, m_gone, m_banned) or character = other) then raise exception 'a refused apology left a row'; end if;

  -- The good one: spun from the move's Act onto the barred board, a pending row.
  got := pg_temp.as_val(d, format('select apologize(%L, %L, %L, %L)', m, sorry, 'I am sorry', 'I was wrong, and here is why.'));
  if got like 'ERROR:%' then raise exception 'apologize on a move that bars the very board it spins onto: %', got; end if;
  select * into row_ from apologies where move_act = m;
  if row_ is null or row_.state is distinct from 'pending' or row_.character is distinct from sorry or row_.ruling_act is not null then
    raise exception 'one pending row for the apology: %', to_jsonb(row_);
  end if;
  if not exists (select 1 from acts a join threads t on t.id = a.thread
                 where a.id = row_.apology_act and a.kind = 'spin' and a.character = sorry and a.target_act_id = m and t.origin_act_id = m and t.board = general
                   and a.payload ->> 'title' = 'I am sorry' and a.payload ->> 'body' = 'I was wrong, and here is why.') then
    raise exception 'the apology is the spin of the move Act, on General: %', (select to_jsonb(a) from acts a where a.id = row_.apology_act);
  end if;
  if got::jsonb -> 'thread' ->> 'id' is distinct from (select thread::text from acts where id = row_.apology_act) then raise exception 'apologize returns the thread: %', got; end if;

  -- One at a time.
  got := pg_temp.as_val(d, format('select apologize(%L, %L, %L, %L)', m, sorry, 'Again', 'Again.'));
  if got is distinct from 'ERROR: an apology to that move is still waiting for a ruling' then raise exception 'a second apology while one waits: got %', got; end if;
end $$;

-- ---- 4b. An apology frames as the spin it is (0118's framed alert) ----
do $$
declare
  general uuid := pg_temp.board('general');
  d uuid := tests.account('ba-fr-d');
  e uuid := tests.account('ba-fr-e');
  sorry uuid := tests.character(d, 'Ap Fr Sorry');
  named uuid := tests.character(e, 'Ap Fr Named');
  m uuid;
  got text;
begin
  m := pg_temp.landed('ba-boss', sorry, 'trialMembers', interval '1 hour', general, pg_temp.apology());
  got := pg_temp.as_val(d, format('select apologize(%L, %L, %L, %L, %L)', m, sorry, 'Sorry', 'As [quote=Them user=' || named || ']they said[/quote].', array[named]));
  if got like 'ERROR:%' then raise exception 'an apology with framing was refused: %', got; end if;
  if (select count(*) from alerts where kind = 'framed' and act = (got::jsonb -> 'act' ->> 'id')::uuid and account = e and character = named) is distinct from 1::bigint then
    raise exception 'an apology naming another player''s character in a counterfeit quote writes one framed alert for its owner';
  end if;
  -- Returned, so that nothing waits when section 6 counts.
  got := pg_temp.as_val(null, format('select rule_apology(%s, %L, %L)', (select id from apologies where move_act = m), 'returned', ''));
  if got like 'ERROR:%' then raise exception 'returning the framing apology was refused: %', got; end if;
end $$;

-- ---- 5. rule_apology ----
do $$
declare
  d uuid := pg_temp.acct('ba-d');
  e uuid := pg_temp.acct('ba-e');
  sorry uuid := (select id from characters where name = 'Ap Sorry');
  general uuid := pg_temp.board('general');
  m uuid := (select move_act from bars_now where character = sorry);
  boss uuid := (select id from characters where staff = 'ba-boss');
  id1 bigint := (select id from apologies where move_act = m);
  id2 bigint;
  id3 bigint;
  got text;
  row_ record;
  ruling record;
  ended record;
begin
  -- Players cannot rule.
  got := pg_temp.as_val(d, format('select rule_apology(%s, %L, %L)', id1, 'accepted', 'I rule myself in.'));
  if got is null or got not like 'ERROR:%' then raise exception 'a player ruled on an apology: %', got; end if;
  if (select state from apologies where id = id1) is distinct from 'pending' then raise exception 'the player''s ruling changed the row'; end if;
  got := pg_temp.as_val(null, format('select rule_apology(%s, %L, %L)', id1, 'maybe', 'Hmm.'));
  if got is null or got not like 'ERROR:%' then raise exception 'a verdict outside the list was taken: %', got; end if;
  got := pg_temp.as_val(null, format('select rule_apology(%s, %L, %L)', id1, 'accepted', '  '));
  if got is null or got not like 'ERROR:%' then raise exception 'an accepted apology with no ruling words was taken: %', got; end if;
  got := pg_temp.as_val(null, format('select rule_apology(%s, %L, %L)', -1, 'accepted', 'Who?'));
  if got is null or got not like 'ERROR:%' then raise exception 'a ruling on no apology was taken: %', got; end if;
  if (select state from apologies where id = id1) is distinct from 'pending' then raise exception 'a refused ruling changed the row'; end if;

  -- returned: the row only, no post.
  got := pg_temp.as_val(null, format('select rule_apology(%s, %L, %L)', id1, 'returned', ''));
  if got like 'ERROR:%' then raise exception 'returned was refused: %', got; end if;
  select * into row_ from apologies where id = id1;
  if row_.state is distinct from 'returned' or row_.ruling_act is not null then raise exception 'returned sets the row only: %', to_jsonb(row_); end if;
  if exists (select 1 from acts a where a.character = boss and a.kind = 'post' and a.payload ? 'ruling') then raise exception 'a returned apology got a ruling post'; end if;
  got := pg_temp.as_val(null, format('select rule_apology(%s, %L, %L)', id1, 'accepted', 'Too late for that.'));
  if got is null or got not like 'ERROR:%' then raise exception 'a second ruling on a ruled row was taken: %', got; end if;

  -- After a returned one an apology is open again.
  got := pg_temp.as_val(d, format('select apologize(%L, %L, %L, %L)', m, sorry, 'Second try', 'Sorry, again.'));
  if got like 'ERROR:%' then raise exception 'apologize after a returned one: %', got; end if;
  id2 := (select id from apologies where move_act = m and state = 'pending');
  if id2 is null or id2 = id1 then raise exception 'the second apology has its own pending row'; end if;

  -- rejected: the ruling is the move's staff character's post in the apology's thread.
  got := pg_temp.as_val(null, format('select rule_apology(%s, %L, %L)', id2, 'rejected', 'Not good enough.'));
  if got like 'ERROR:%' then raise exception 'rejected was refused: %', got; end if;
  select * into row_ from apologies where id = id2;
  select a.* into ruling from acts a where a.id = row_.ruling_act;
  if row_.state is distinct from 'rejected' or ruling is null then raise exception 'rejected sets the row and its ruling: %', to_jsonb(row_); end if;
  if ruling.kind is distinct from 'post' or ruling.character is distinct from boss or ruling.thread is distinct from (select thread from acts where id = row_.apology_act)
     or ruling.payload ->> 'body' is distinct from 'Not good enough.' or ruling.payload ->> 'ruling' is distinct from 'rejected' or ruling.payload ->> 'apology' is distinct from row_.apology_act::text then
    raise exception 'the ruling is a post by the move''s staff character in the apology''s thread: %', to_jsonb(ruling);
  end if;
  -- ... and the move is still in force: a rejection meets nothing.
  if not exists (select 1 from open_moves where move_act = m) then raise exception 'a rejected apology ended the move'; end if;

  -- A day's wait after one ruled on.
  got := pg_temp.as_val(d, format('select apologize(%L, %L, %L, %L)', m, sorry, 'Third', 'Sorry, once more.'));
  if got is null or got not like 'ERROR: this character has already apologized to that move in the last 24 hours%' then raise exception 'an apology the day after a rejection: got %', got; end if;
  update apologies set created_at = now() - interval '25 hours' where id = id2;
  got := pg_temp.as_val(d, format('select apologize(%L, %L, %L, %L)', m, sorry, 'Third', 'Sorry, once more.'));
  if got like 'ERROR:%' then raise exception 'an apology after the day: %', got; end if;
  id3 := (select id from apologies where move_act = m and state = 'pending');

  -- accepted: ruled, then the tick finds the demand met and ends the move.
  got := pg_temp.as_val(null, format('select rule_apology(%s, %L, %L)', id3, 'accepted', 'Fine. Forgiven.'));
  if got like 'ERROR:%' then raise exception 'accepted was refused: %', got; end if;
  select * into row_ from apologies where id = id3;
  if row_.state is distinct from 'accepted' or row_.ruling_act is null then raise exception 'accepted sets the row and its ruling: %', to_jsonb(row_); end if;
  if (select payload ->> 'ruling' from acts where id = row_.ruling_act) is distinct from 'accepted' then raise exception 'the accepted ruling post carries its verdict'; end if;
  got := pg_temp.as_val(null, format('select rule_apology(%s, %L, %L)', id3, 'rejected', 'Changed my mind.'));
  if got is null or got not like 'ERROR:%' then raise exception 'a ruling on an accepted apology was taken: %', got; end if;
  if not (select barred(sorry, general)) then raise exception 'the bar holds until the tick finds the demand met'; end if;
  perform system_tick();
  select * into ended from acts where kind = 'move_end' and target_act_id = m;
  if ended is null or ended.payload ->> 'why' is distinct from 'met' then raise exception 'an accepted apology ends the move met: %', coalesce(to_jsonb(ended), 'null'::jsonb); end if;
  if (select barred(sorry, general)) then raise exception 'the bar is lifted when the move ends'; end if;
  got := pg_temp.as_val(d, format('select post(%L, %L, %L)', (select id from threads where board = general limit 1), sorry, 'Back on General.'));
  if got like 'ERROR:%' then raise exception 'the apologized character posts on the board again: %', got; end if;
end $$;

-- ---- 6. pending_apologies: oldest first, one batch ----
do $$
declare
  games uuid := pg_temp.board('ba-games');
  general uuid := pg_temp.board('general');
  who uuid[];
  acct uuid[];
  mv uuid;
  i integer;
  ids bigint[];
  got text;
  first_row record;
begin
  if pg_temp.as_val(null, 'select count(*) from pending_apologies()') is distinct from '0' then raise exception 'no apology is waiting yet: %', pg_temp.as_val(null, 'select count(*) from pending_apologies()'); end if;
  for i in 1..3 loop
    acct[i] := tests.account('ba-q' || i);
    who[i] := tests.character(acct[i], 'Ba Q' || i);
    mv := pg_temp.landed('ba-boss', who[i], 'trialMembers', interval '1 hour', games, pg_temp.apology());
    got := pg_temp.as_val(acct[i], format('select apologize(%L, %L, %L, %L)', mv, who[i], 'Sorry ' || i, 'Body ' || i));
    if got like 'ERROR:%' then raise exception 'apologize %: %', i, got; end if;
    -- Q3 waited longest, then Q2, then Q1.
    update apologies set created_at = now() - make_interval(hours => i) where character = who[i];
  end loop;
  ids := array(select id from apologies where character = any (who) order by created_at, id);
  got := pg_temp.as_val(null, 'select array_agg(p.apology)::text from pending_apologies() p');
  if got is distinct from format('{%s,%s}', ids[1], ids[2]) then raise exception 'the oldest two, oldest first (apologyJudgeBatch is 2): got %, wanted %', got, ids; end if;
  select * into first_row from pending_apologies() limit 1;
  if first_row.apology is distinct from ids[1] or first_row.character is distinct from who[3] or first_row.staff is distinct from 'ba-boss' or first_row.body is distinct from 'Body 3'
     or first_row.params ->> 'group' is distinct from 'trialMembers' or first_row.line is distinct from 'It is done: moving a member into "Trial Members".' then
    raise exception 'a pending row carries the character, the staff key, the body, the move''s params and its stock line: %', to_jsonb(first_row);
  end if;
  got := pg_temp.as_val(acct[1], 'select count(*) from pending_apologies()');
  if got is null or got not like 'ERROR:%' then raise exception 'a player read the pending apologies: %', got; end if;
  got := pg_temp.as_val(acct[1], format('select rule_apology(%s, %L, %L)', ids[1], 'accepted', 'Mine now.'));
  if got is null or got not like 'ERROR:%' then raise exception 'a player ruled on an apology: %', got; end if;
end $$;

-- ---- 5b. A benched staff persona writes no ruling, and the row is still set ----
do $$
declare
  games uuid := pg_temp.board('ba-games');
  f uuid := tests.account('ba-f');
  sorry uuid := tests.character(f, 'Bn Sorry');
  mod_c uuid := (select id from characters where staff = 'ba-mod');
  m uuid;
  id_ bigint;
  ap_thread uuid;
  posts_before bigint;
  got text;
  row_ record;
begin
  update characters set debuted_at = now() - interval '1 day' where id = mod_c;
  m := pg_temp.landed('ba-mod', sorry, 'trialMembers', interval '1 hour', games, pg_temp.apology());
  got := pg_temp.as_val(f, format('select apologize(%L, %L, %L, %L)', m, sorry, 'Sorry', 'To a benched Mod.'));
  if got like 'ERROR:%' then raise exception 'apologize to a Mod''s move: %', got; end if;
  select x.id, a.thread into id_, ap_thread from apologies x join acts a on a.id = x.apology_act where x.move_act = m;
  insert into staff_offices (staff, office, cause) values ('ba-mod', 'benched', 'admin');
  if (select office from staff_office_now where staff = 'ba-mod') is distinct from 'benched' then raise exception 'the persona is benched'; end if;
  posts_before := (select count(*) from acts where thread = ap_thread);
  got := pg_temp.as_val(null, format('select rule_apology(%s, %L, %L)', id_, 'accepted', 'Forgiven, from the bench.'));
  if got like 'ERROR:%' then raise exception 'a ruling for a benched persona was refused: %', got; end if;
  select * into row_ from apologies where id = id_;
  if row_.state is distinct from 'accepted' or row_.ruling_act is not null then raise exception 'the row is set and has no ruling Act: %', to_jsonb(row_); end if;
  if (select count(*) from acts where thread = ap_thread) is distinct from posts_before then raise exception 'a benched persona wrote a ruling post'; end if;
end $$;
