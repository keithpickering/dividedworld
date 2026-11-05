-- The pool's signals (supabase/migrations/0086_pool_signals.sql; the staff roster plan, Task 8): pool_signals(since, until) is the one read the
-- daily pick makes, owned by the digest role (0045) so that the database, not review, keeps it from owners, classes and reactors. Each kind
-- is found from a planted fixture and one outside the window is not; a name is matched once over the window's posts however many personas
-- there are (the plan shape says so, not the fixture's size); and a copy of the function that reads characters.owner is refused.
--
-- The rules the fixture pins, where the plan left a choice:
--   - A name is matched as the folds see it (name_skeleton, 0011: case, lookalike letters, accents) and as a whole name: a name inside a
--     longer word is not a mention, so "the Clerkenwell" does not name "The Clerk" and "Wardenclyffe" does not name "Warden". The folds
--     say when two names are the same name and know nothing of word edges; the edge is this function's, and the fixture records it.
--   - A post never names, or quotes, its own author's persona: a persona is not triggered by itself. A staff post that names another
--     persona does count, as any public post does.
--   - Each persona's `named`, `quoted` and `legacy` rows are its five newest in the window, so the answer's size follows the roster, not
--     the day's traffic.
--   - `legacy` and `reversals` name the owner a move had when the Act fell (move_owner, 0051, for an end; for a keep, the owner before it).

do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1)),
    'classes', '[]'::jsonb, 'reactions', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'ps-pat',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'ps-pat', 'name', 'Pat Boss', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'ps-old', 'name', 'Old Boss', 'title', 'Boss', 'signature', 'b'),
        jsonb_build_object('key', 'ps-clerk', 'name', 'The Clerk', 'title', 'Mod', 'signature', 'c'),
        jsonb_build_object('key', 'ps-warden', 'name', 'Warden', 'title', 'Mod', 'signature', 'd'),
        jsonb_build_object('key', 'ps-ghost', 'name', 'Ghost', 'title', 'Waiting', 'signature', 'e')),
      'firstStaff', jsonb_build_array('ps-clerk', 'ps-warden'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')))));
  update seasons set starts_at = now() - interval '60 days' where ends_at is null;
end $$;

-- The window is far from now: other files commit rows that a window around now would count.
create function pg_temp.base() returns timestamptz language sql as $$ select '2041-03-01T12:00:00Z'::timestamptz $$;
create function pg_temp.ann() returns uuid language sql as $$ select (value #>> '{}')::uuid from settings where key = 'systemAnnouncements' $$;
-- A staff character's Act, as The System would write it.
create function pg_temp.say(staff_key text, in_thread uuid, body text, at timestamptz, target uuid default null) returns uuid language plpgsql as $$
declare written uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload, target_act_id, created_at)
  values ((select c.id from characters c where c.staff = staff_key), 'post', in_thread, jsonb_build_object('body', body), target, at) returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  return written;
end $$;
-- A move of a Boss's, landed at a given time, a keep of it, and its end, as the tick writes them.
create function pg_temp.land(staff_key text, at timestamptz) returns uuid language plpgsql as $$
declare written uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at)
  values ((select c.id from characters c where c.staff = staff_key), 'move', pg_temp.ann(), jsonb_build_object('kind', 'nameSuccessor', 'params', '{}'::jsonb, 'body', 'landed'), at) returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  return written;
end $$;
create function pg_temp.keep(staff_key text, move uuid, at timestamptz) returns uuid language plpgsql as $$
declare written uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  values ((select c.id from characters c where c.staff = staff_key), 'move_keep', pg_temp.ann(), move, '{}'::jsonb, at) returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  return written;
end $$;
create function pg_temp.finish(move uuid, why text, by_whom text, at timestamptz) returns uuid language plpgsql as $$
declare written uuid;
begin
  perform set_config('kayfabb.move_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  values (null, 'move_end', pg_temp.ann(), move, jsonb_build_object('why', why, 'by', by_whom), at) returning id into written;
  perform set_config('kayfabb.move_end_writer', '', true);
  return written;
end $$;
-- The signals as the service role reads them.
create function pg_temp.signals(since timestamptz, until timestamptz) returns jsonb language plpgsql as $$
declare d jsonb;
begin
  perform tests.become_service();
  d := pool_signals(since, until);
  perform tests.unbecome();
  return d;
end $$;
-- (staff, act) pairs of a signal kind, sorted, as text; and the same from a list of pairs.
create function pg_temp.pairs(d jsonb, kind text) returns text language sql as $$
  select coalesce(string_agg(e ->> 'staff' || '=' || (e ->> 'act'), ' ' order by e ->> 'staff', e ->> 'act'), '') from jsonb_array_elements(d -> kind) e
$$;
create function pg_temp.expected(wanted text[]) returns text language sql as $$
  select coalesce(string_agg(wanted[i] || '=' || wanted[i + 1], ' ' order by wanted[i], wanted[i + 1]), '') from generate_series(1, array_length(wanted, 1), 2) i
$$;

-- ----------------------------------------------------------------------------------------------- the fixture ----
create table pg_temp.fx (k text primary key, v text);

do $$
declare
  base timestamptz := pg_temp.base();
  a uuid; b uuid; c uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid;
  clerk_post uuid; warden_post uuid; edit_target uuid; w uuid; old_post uuid;
  m_old_end uuid; m_old_keep uuid; m_old_rev uuid; m_old_early uuid; m_pat_rev uuid; m_pat_met uuid; m_pat_early uuid; m_kept_rev uuid;
  i integer;
begin
  perform tests.account('ps-admin');
  a := tests.character(tests.account('ps-a'), 'Ps A'); b := tests.character(tests.account('ps-b'), 'Ps B'); c := tests.character(tests.account('ps-c'), 'Ps C');
  update characters set debuted_at = now() where staff in ('ps-pat', 'ps-old', 'ps-clerk', 'ps-warden') and debuted_at is null;
  update characters set debuted_at = null where staff = 'ps-ghost';
  -- The developer is staff of a third kind, never a persona; its name in a post names no one.
  insert into characters (name, staff, staff_kind, debuted_at) values ('Dev Gabe', 'ps-dev', 'developer', now());
  insert into settings (key, value) values ('digestThreads', '3'), ('poolPriorityDays', '28') on conflict (key) do update set value = excluded.value;
  t1 := tests.thread('Named'); t2 := tests.thread('Staff started'); t3 := tests.thread('Third'); t4 := tests.thread('Fourth');

  -- ------------------------------------------------------------------ named ----
  -- Threads started by staff characters (the opener is the starter), which others then reply to.
  clerk_post := pg_temp.say('ps-clerk', t2, 'Good day.', base + interval '1 minute');
  warden_post := pg_temp.say('ps-warden', t3, 'Quiet here.', base + interval '2 minutes');
  insert into pg_temp.fx values ('clerk_post', clerk_post), ('warden_post', warden_post);
  -- Two mentions the folds see through: a lowercase one, and a Warden with a Cyrillic a (the lookalike the folds fold).
  insert into pg_temp.fx values ('n_clerk_lower', tests.post(a, t1, 'I saw the clerk today', base + interval '10 minutes'));
  insert into pg_temp.fx values ('n_warden_look', tests.post(b, t1, U&'W\0430rden said hello', base + interval '11 minutes'));
  -- One post names two personas, and punctuation is an edge.
  insert into pg_temp.fx values ('n_both', tests.post(b, t1, 'The Clerk and Warden walk in.', base + interval '12 minutes'));
  insert into pg_temp.fx values ('n_pat', tests.post(a, t1, 'Pat Boss, what now?', base + interval '13 minutes'));
  -- A name inside a longer word is not the name; a waiting persona and the developer are named by no one.
  perform tests.post(a, t1, 'Wardenclyffe tower is tall', base + interval '14 minutes');
  perform tests.post(a, t1, 'We met in the Clerkenwell', base + interval '15 minutes');
  perform tests.post(c, t1, 'Ghost story night', base + interval '16 minutes');
  perform tests.post(a, t1, 'Dev Gabe is nice', base + interval '17 minutes');
  -- A persona does not name itself; another persona's mention counts.
  perform pg_temp.say('ps-warden', t1, 'I am Warden, and I say so.', base + interval '18 minutes');
  insert into pg_temp.fx values ('n_staff_names', pg_temp.say('ps-clerk', t1, 'Warden, what do you think?', base + interval '19 minutes'));
  -- The edited words are the words (an edit is an Act beside the post).
  edit_target := tests.post(c, t1, 'Nothing to see.', base + interval '20 minutes');
  perform tests.act(c, 'edit', t1, '{"body": "Nothing, but the Clerk knows."}', edit_target, base + interval '21 minutes');
  insert into pg_temp.fx values ('n_edited', edit_target);
  -- A post edited away from the name no longer names it.
  w := tests.post(c, t1, 'Old Boss was here once', base + interval '22 minutes');
  perform tests.act(c, 'edit', t1, '{"body": "Someone was here once"}', w, base + interval '23 minutes');
  -- Outside the window: before it, and exactly at its end (the window is half-open).
  perform tests.post(a, t1, 'The Clerk, long ago', base - interval '2 hours');
  perform tests.post(a, t1, 'The Clerk, at the end', base + interval '1 hour');
  -- Seven mentions of one persona: only the five newest are carried.
  for i in 1..7 loop
    insert into pg_temp.fx values ('n_old_' || i, tests.post(b, t4, 'Old Boss, number ' || i, base + interval '30 minutes' + i * interval '1 minute'));
  end loop;
  -- A reply to a player's post, for the quote rule.
  old_post := (select id from acts where character = b and thread = t1 and kind = 'post' limit 1);

  -- ----------------------------------------------------------------- quoted ----
  insert into pg_temp.fx values ('q_player', tests.act(a, 'post', t2, '{"body": "replying"}', clerk_post, base + interval '25 minutes'));
  insert into pg_temp.fx values ('q_staff', pg_temp.say('ps-warden', t2, 'And a reply from staff.', base + interval '26 minutes', clerk_post));
  perform pg_temp.say('ps-clerk', t2, 'A reply to itself.', base + interval '27 minutes', clerk_post);
  perform tests.act(a, 'post', t1, '{"body": "reply to a player"}', old_post, base + interval '28 minutes');
  perform tests.act(b, 'post', t3, '{"body": "too early"}', warden_post, base - interval '2 hours');
  insert into pg_temp.fx values ('q_warden', tests.act(b, 'post', t3, '{"body": "on time"}', warden_post, base + interval '29 minutes'));

  -- ----------------------------------------------------------------- moves ----
  -- Old Boss's moves: one ended in the window, one kept by the current Boss in the window, one reversed by an admin in the window, one
  -- reversed before it. Pat's own: one reversed by an admin in the window, one met, one reversed before the window. And one Old Boss
  -- wrote that Pat kept before the window and an admin reversed in it (it is Pat's by then).
  m_old_end := pg_temp.land('ps-old', base - interval '5 days');
  m_old_keep := pg_temp.land('ps-old', base - interval '5 days');
  m_old_rev := pg_temp.land('ps-old', base - interval '5 days');
  m_old_early := pg_temp.land('ps-old', base - interval '5 days');
  m_pat_rev := pg_temp.land('ps-pat', base - interval '5 days');
  m_pat_met := pg_temp.land('ps-pat', base - interval '5 days');
  m_pat_early := pg_temp.land('ps-pat', base - interval '5 days');
  m_kept_rev := pg_temp.land('ps-old', base - interval '5 days');
  insert into pg_temp.fx values ('m_old_end', m_old_end), ('m_old_keep', m_old_keep), ('m_old_rev', m_old_rev), ('m_pat_rev', m_pat_rev), ('m_kept_rev', m_kept_rev);
  perform pg_temp.keep('ps-pat', m_kept_rev, base - interval '1 day');
  insert into pg_temp.fx values ('e_old_end', pg_temp.finish(m_old_end, 'expired', 'tick', base + interval '40 minutes'));
  insert into pg_temp.fx values ('k_old_keep', pg_temp.keep('ps-pat', m_old_keep, base + interval '41 minutes'));
  insert into pg_temp.fx values ('e_old_rev', pg_temp.finish(m_old_rev, 'reversed', 'admin', base + interval '42 minutes'));
  perform pg_temp.finish(m_old_early, 'reversed', 'admin', base - interval '2 hours');
  insert into pg_temp.fx values ('e_pat_rev', pg_temp.finish(m_pat_rev, 'reversed', 'admin', base + interval '43 minutes'));
  perform pg_temp.finish(m_pat_met, 'met', 'tick', base + interval '44 minutes');
  perform pg_temp.finish(m_pat_early, 'reversed', 'admin', base - interval '2 hours');
  insert into pg_temp.fx values ('e_kept_rev', pg_temp.finish(m_kept_rev, 'reversed', 'admin', base + interval '45 minutes'));

  -- ------------------------------------------------------------- handovers ----
  insert into season_handovers (season, outgoing, boss, how, note, at, landed_at)
  values ((select id from seasons where ends_at is null), 'ps-old', 'ps-pat', 'rotation', 'a secret error note', base + interval '5 minutes', base + interval '5 minutes');

  -- ----------------------------------------------------------------- tallies ----
  -- The Clerk's posts: three in the window, one 27 days back (inside the 28), one 29 days back (outside), one after the window.
  insert into pg_temp.fx values ('clerk_old', pg_temp.say('ps-clerk', t3, 'Older still.', base - interval '27 days'));
  perform pg_temp.say('ps-clerk', t3, 'Too old to count.', base - interval '29 days');
  insert into pg_temp.fx values ('clerk_late', pg_temp.say('ps-clerk', t3, 'Later than the window.', base + interval '2 hours'));
  insert into reaction_tallies (act, kind, count) values (clerk_post, 'up', 2), ((select v::uuid from pg_temp.fx where k = 'clerk_old'), 'boo', 3),
    ((select v::uuid from pg_temp.fx where k = 'clerk_late'), 'up', 40);
end $$;

-- --------------------------------------------------------------------------------------------- the surface ----
do $$
declare
  t text;
  fn regprocedure := 'pool_signals(timestamptz, timestamptz)'::regprocedure;
begin
  if (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = fn) is distinct from 'kayfabb_digest' then raise exception 'pool_signals is not owned by kayfabb_digest'; end if;
  if not (select prosecdef from pg_proc where oid = fn) then raise exception 'pool_signals is not security definer'; end if;
  if not exists (select 1 from pg_proc p, unnest(p.proconfig) c where p.oid = fn and c like 'search_path=%' and c like '%pg_temp') then raise exception 'pool_signals has no pinned search_path ending in pg_temp'; end if;
  foreach t in array array['public', 'anon', 'authenticated'] loop
    if has_function_privilege(t, fn, 'execute') then raise exception '% can execute pool_signals', t; end if;
  end loop;
  if not has_function_privilege('service_role', fn, 'execute') then raise exception 'service_role cannot execute pool_signals'; end if;
  foreach t in array array['public', 'anon', 'authenticated', 'service_role'] loop
    if has_function_privilege(t, 'pool_named(timestamptz, timestamptz)', 'execute') then raise exception '% can execute pool_named, which only pool_signals calls', t; end if;
  end loop;
  foreach t in array array['anon', 'authenticated'] loop
    perform set_config('role', t, true);
    begin
      perform pool_signals(pg_temp.base(), pg_temp.base() + interval '1 hour');
      raise exception '% could call pool_signals', t;
    exception when insufficient_privilege then null;
    end;
    perform tests.unbecome();
  end loop;
  -- A window that ends before it starts is refused.
  begin perform pg_temp.signals(pg_temp.base(), pg_temp.base()); raise exception 'an empty window was answered';
  exception when sqlstate '22023' then null; end;
  perform tests.unbecome();
  -- Every key is there, whatever the window holds.
  if (select array_agg(k order by k) from jsonb_object_keys(pg_temp.signals(pg_temp.base() + interval '10 days', pg_temp.base() + interval '11 days')) k)
     is distinct from array['handovers', 'hot', 'legacy', 'named', 'quoted', 'reversals', 'tallies'] then
    raise exception 'the keys are %', pg_temp.signals(pg_temp.base() + interval '10 days', pg_temp.base() + interval '11 days');
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------- named ----
do $$
declare
  d jsonb := pg_temp.signals(pg_temp.base(), pg_temp.base() + interval '1 hour');
  fx jsonb := (select jsonb_object_agg(k, v) from pg_temp.fx);
  want text;
begin
  -- The Clerk: a lowercase mention, a shared post, an edited-in mention. Not "the Clerkenwell", not the early or end-of-window ones.
  -- Warden: a lookalike spelling, the shared post, a persona's mention of it; not Wardenclyffe, not its own words. Old Boss: its five newest.
  want := pg_temp.expected(array[
    'ps-clerk', fx ->> 'n_clerk_lower', 'ps-clerk', fx ->> 'n_both', 'ps-clerk', fx ->> 'n_edited',
    'ps-warden', fx ->> 'n_warden_look', 'ps-warden', fx ->> 'n_both', 'ps-warden', fx ->> 'n_staff_names',
    'ps-pat', fx ->> 'n_pat',
    'ps-old', fx ->> 'n_old_3', 'ps-old', fx ->> 'n_old_4', 'ps-old', fx ->> 'n_old_5', 'ps-old', fx ->> 'n_old_6', 'ps-old', fx ->> 'n_old_7']);
  if pg_temp.pairs(d, 'named') is distinct from want then
    raise exception E'named is\n%\nwanted\n%', pg_temp.pairs(d, 'named'), want;
  end if;
  -- Every row carries the thread of its Act.
  if exists (select 1 from jsonb_array_elements(d -> 'named') e where (e ->> 'thread')::uuid is distinct from (select thread from acts where id = (e ->> 'act')::uuid)) then
    raise exception 'a named row has the wrong thread: %', d -> 'named';
  end if;
  -- The developer, a waiting persona and a name inside a word are in no row (the wanted list above is the whole list).
  -- A window past all of it names no one.
  d := pg_temp.signals(pg_temp.base() + interval '10 days', pg_temp.base() + interval '11 days');
  if d -> 'named' is distinct from '[]'::jsonb then raise exception 'a window with no posts names someone: %', d -> 'named'; end if;
end $$;

-- pool_named folds each distinct word once and puts a post's folded words back together with the spaces between. That is the folds' own
-- result only while they never reach across a space: no map has a space as its source (other spaces, the no-break one, map TO a space,
-- inside their word, which changes nothing), and a mark after a space stays where it is. Held here to name_skeleton itself, on words that use each fold (case, lookalikes, accents, Hangul, marks out of order, doubled spaces).
do $$
declare
  probes text[] := array[
    'I saw the clerk today', U&'W\0430rden said hello', 'The  Clerk   and Warden', U&'Cafe\0301 au lait', U&'e\0323\0301 x', U&'a \0301b',
    U&'\D55C\AE00 \0043lerk', 'C1erk and 0ld Boss', 'STRASSE und Stra' || U&'\00DF' || 'e', ' leading and trailing ', '', U&'\FF21\FF22 \2160\2161'];
  p text;
begin
  if exists (select 1 from name_maps where source = ' ') then raise exception 'a fold maps the space'; end if;
  foreach p in array probes loop
    if name_skeleton(p) is distinct from (select coalesce(string_agg(name_skeleton(x.word), ' ' order by x.n), '') from unnest(string_to_array(p, ' ')) with ordinality x(word, n)) then
      raise exception 'folding word by word is not folding the whole for %', p;
    end if;
  end loop;
end $$;

-- --------------------------------------------------------------------------------------------------- quoted ----
do $$
declare
  d jsonb := pg_temp.signals(pg_temp.base(), pg_temp.base() + interval '1 hour');
  fx jsonb := (select jsonb_object_agg(k, v) from pg_temp.fx);
  digest jsonb;
  clerk uuid := (select id from characters where staff = 'ps-clerk');
  quotes_to_clerk integer;
begin
  -- Replies to a staff post: a player's and another persona's, and the one on time. Not a persona's reply to itself, not a reply to a
  -- player, not the one before the window.
  if pg_temp.pairs(d, 'quoted') is distinct from pg_temp.expected(array['ps-clerk', fx ->> 'q_player', 'ps-clerk', fx ->> 'q_staff', 'ps-warden', fx ->> 'q_warden']) then
    raise exception 'quoted is %', pg_temp.pairs(d, 'quoted');
  end if;
  if exists (select 1 from jsonb_array_elements(d -> 'quoted') e where (e ->> 'thread')::uuid is distinct from (select thread from acts where id = (e ->> 'act')::uuid)) then
    raise exception 'a quoted row has the wrong thread: %', d -> 'quoted';
  end if;
  -- As system_digest reads quotes (0052): the digest's pairs counted to the Clerk are the rows pool_signals lists for it.
  insert into settings (key, value) values ('digestExcerpts', '20'), ('digestExcerptChars', '280') on conflict (key) do update set value = excluded.value;
  perform tests.become_service();
  digest := system_digest(pg_temp.base(), pg_temp.base() + interval '1 hour');
  perform tests.unbecome();
  select coalesce(sum((q ->> 'count')::integer), 0) into quotes_to_clerk from jsonb_array_elements(digest -> 'quotes') q where (q ->> 'to')::uuid = clerk;
  if quotes_to_clerk is distinct from (select count(*)::integer from jsonb_array_elements(d -> 'quoted') e where e ->> 'staff' = 'ps-clerk') or quotes_to_clerk <> 2 then
    raise exception 'the digest counts % quotes to the Clerk, pool_signals lists %', quotes_to_clerk, d -> 'quoted';
  end if;
  d := pg_temp.signals(pg_temp.base() + interval '10 days', pg_temp.base() + interval '11 days');
  if d -> 'quoted' is distinct from '[]'::jsonb then raise exception 'a window with no posts quotes someone: %', d -> 'quoted'; end if;
end $$;

-- ----------------------------------------------------------------------------------------- legacy, reversals ----
do $$
declare
  d jsonb := pg_temp.signals(pg_temp.base(), pg_temp.base() + interval '1 hour');
  fx jsonb := (select jsonb_object_agg(k, v) from pg_temp.fx);
  r jsonb;
begin
  -- Legacy: Old Boss's move that expired, the keep of its move by the current Boss (still Old Boss's signal: it is a move it made), and
  -- the reversal an admin gave another of its moves. Not the early end, not Pat's own moves.
  if pg_temp.pairs(d, 'legacy') is distinct from pg_temp.expected(array['ps-old', fx ->> 'e_old_end', 'ps-old', fx ->> 'k_old_keep', 'ps-old', fx ->> 'e_old_rev']) then
    raise exception 'legacy is %', pg_temp.pairs(d, 'legacy');
  end if;
  select e into r from jsonb_array_elements(d -> 'legacy') e where e ->> 'act' = fx ->> 'e_old_end';
  if r ->> 'move' is distinct from fx ->> 'm_old_end' or r ->> 'how' is distinct from 'expired' then raise exception 'an ended move reads %', r; end if;
  select e into r from jsonb_array_elements(d -> 'legacy') e where e ->> 'act' = fx ->> 'k_old_keep';
  if r ->> 'move' is distinct from fx ->> 'm_old_keep' or r ->> 'how' is distinct from 'kept' then raise exception 'a kept move reads %', r; end if;
  select e into r from jsonb_array_elements(d -> 'legacy') e where e ->> 'act' = fx ->> 'e_old_rev';
  if r ->> 'move' is distinct from fx ->> 'm_old_rev' or r ->> 'how' is distinct from 'reversed' then raise exception 'a reversed move reads %', r; end if;
  -- The owner a row names is move_owner's (0051) for an end: asked of the database, the owner of each ended move.
  if exists (select 1 from jsonb_array_elements(d -> 'legacy') e where e ->> 'how' <> 'kept' and move_owner((e ->> 'move')::uuid) is distinct from e ->> 'staff') then
    raise exception 'legacy names an owner move_owner does not: %', d -> 'legacy';
  end if;
  -- Reversals: admin reversals of the current Boss's moves: its own, and Old Boss's that it kept. Not the met one, not the early one.
  if pg_temp.pairs(d, 'reversals') is distinct from pg_temp.expected(array['ps-pat', fx ->> 'e_pat_rev', 'ps-pat', fx ->> 'e_kept_rev']) then
    raise exception 'reversals is %', pg_temp.pairs(d, 'reversals');
  end if;
  select e into r from jsonb_array_elements(d -> 'reversals') e where e ->> 'act' = fx ->> 'e_kept_rev';
  if r ->> 'move' is distinct from fx ->> 'm_kept_rev' then raise exception 'a reversal names move %', r; end if;
  if exists (select 1 from jsonb_array_elements(d -> 'reversals') e where move_owner((e ->> 'move')::uuid) is distinct from e ->> 'staff') then raise exception 'reversals names an owner move_owner does not: %', d -> 'reversals'; end if;
  d := pg_temp.signals(pg_temp.base() + interval '10 days', pg_temp.base() + interval '11 days');
  if d -> 'legacy' is distinct from '[]'::jsonb or d -> 'reversals' is distinct from '[]'::jsonb then raise exception 'a window with no moves has some: %, %', d -> 'legacy', d -> 'reversals'; end if;
end $$;

-- ----------------------------------------------------------------------------------------------- handovers ----
do $$
declare
  d jsonb := pg_temp.signals(pg_temp.base(), pg_temp.base() + interval '1 hour');
  h jsonb;
begin
  if jsonb_array_length(d -> 'handovers') <> 1 then raise exception 'handovers are %', d -> 'handovers'; end if;
  h := d -> 'handovers' -> 0;
  if (h ->> 'season')::bigint is distinct from (select id from seasons where ends_at is null) or h ->> 'outgoing' is distinct from 'ps-old' or h ->> 'boss' is distinct from 'ps-pat' or h ->> 'how' is distinct from 'rotation' then
    raise exception 'the handover reads %', h;
  end if;
  -- The error note is not for the pool: it is not in the answer and the role cannot read it.
  if h ? 'note' or d::text like '%secret error note%' then raise exception 'the handover carries its note: %', h; end if;
  if has_column_privilege('kayfabb_digest', 'season_handovers', 'note', 'select') then raise exception 'the digest role reads season_handovers.note'; end if;
  d := pg_temp.signals(pg_temp.base() + interval '1 hour', pg_temp.base() + interval '2 hours');
  if d -> 'handovers' is distinct from '[]'::jsonb then raise exception 'a handover outside the window is listed: %', d -> 'handovers'; end if;
end $$;

-- -------------------------------------------------------------------------------------------------------- hot ----
do $$
declare
  d jsonb := pg_temp.signals(pg_temp.base(), pg_temp.base() + interval '1 hour');
  t1 uuid := (select id from threads where title = 'Named');
  t2 uuid := (select id from threads where title = 'Staff started');
  t4 uuid := (select id from threads where title = 'Fourth');
  general uuid := (select id from boards where slug = 'general');
begin
  if jsonb_array_length(d -> 'hot') <> 3 then raise exception 'hot is not capped at digestThreads: %', d -> 'hot'; end if;
  -- In the window t1 has 13 posts, t4 seven, t2 four and the third thread two: the top three, hottest first.
  if (d #>> '{hot,0,thread}')::uuid <> t1 or (d #>> '{hot,1,thread}')::uuid <> t4 or (d #>> '{hot,2,thread}')::uuid <> t2 then raise exception 'hot is ordered %', d -> 'hot'; end if;
  if (d #>> '{hot,0,board}')::uuid is distinct from general then raise exception 'hot does not name its board: %', d -> 'hot'; end if;
  if (d #>> '{hot,0,heat}')::numeric is distinct from 13.00 or (d #>> '{hot,1,heat}')::numeric is distinct from 7.00 then raise exception 'heat is posts an hour: %', d -> 'hot'; end if;
  -- Who started each: a player started t1 and t4 (their first post); the Clerk started t2.
  if (d #>> '{hot,0,staffStarted}')::boolean is distinct from false or (d #>> '{hot,1,staffStarted}')::boolean is distinct from false
     or (d #>> '{hot,2,staffStarted}')::boolean is distinct from true or (d #>> '{hot,2,starterStaff}') is distinct from 'ps-clerk'
     or (d #>> '{hot,0,starterStaff}') is not null then
    raise exception 'who started the hot threads: %', d -> 'hot';
  end if;
  if (d #>> '{hot,2,starter}')::uuid is distinct from (select id from characters where staff = 'ps-clerk') then raise exception 'the starter is %', d -> 'hot' -> 2; end if;
  d := pg_temp.signals(pg_temp.base() + interval '10 days', pg_temp.base() + interval '11 days');
  if d -> 'hot' is distinct from '[]'::jsonb then raise exception 'a window with no posts has hot threads: %', d -> 'hot'; end if;
end $$;

-- ----------------------------------------------------------------------------------------------- tallies ----
do $$
declare
  d jsonb := pg_temp.signals(pg_temp.base(), pg_temp.base() + interval '1 hour');
  tl jsonb;
begin
  -- The Clerk: its three posts in the window (2 reactions), its older one 27 days back (3, in another quadrant: every kind counts alike),
  -- and not the one 29 days back or the one after the window (40 reactions).
  select e into tl from jsonb_array_elements(d -> 'tallies') e where e ->> 'staff' = 'ps-clerk';
  if (tl ->> 'posts')::integer is distinct from 4 or (tl ->> 'reactions')::integer is distinct from 5 then raise exception 'the Clerk reads %', tl; end if;
  select e into tl from jsonb_array_elements(d -> 'tallies') e where e ->> 'staff' = 'ps-warden';
  if (tl ->> 'posts')::integer is distinct from 3 or (tl ->> 'reactions')::integer is distinct from 0 then raise exception 'the Warden reads %', tl; end if;
  -- A persona with no posts is listed with none (the pick treats it as new); the waiting one and the developer are not listed.
  select e into tl from jsonb_array_elements(d -> 'tallies') e where e ->> 'staff' = 'ps-old';
  if (tl ->> 'posts')::integer is distinct from 0 or (tl ->> 'reactions')::integer is distinct from 0 then raise exception 'a persona with no posts reads %', tl; end if;
  if exists (select 1 from jsonb_array_elements(d -> 'tallies') e where e ->> 'staff' in ('ps-ghost', 'ps-dev')) then raise exception 'tallies lists a persona that is not one: %', d -> 'tallies'; end if;
  -- The trailing days are the setting's: at 7 the older post (27 days back) is out.
  update settings set value = '7' where key = 'poolPriorityDays';
  d := pg_temp.signals(pg_temp.base(), pg_temp.base() + interval '1 hour');
  select e into tl from jsonb_array_elements(d -> 'tallies') e where e ->> 'staff' = 'ps-clerk';
  if (tl ->> 'posts')::integer is distinct from 3 or (tl ->> 'reactions')::integer is distinct from 2 then raise exception 'the Clerk reads % over 7 days', tl; end if;
  update settings set value = '28' where key = 'poolPriorityDays';
end $$;

-- ------------------------------------------------------------------------------------------ one pass, by plan ----
-- The named read is the statement in pool_named's body (positional parameters, one select), prepared and explained as it runs. It must
-- scan the window's posts once and match every persona in that one pass: the plan has the same acts nodes, and one regexp_matches call,
-- with one persona as with four.
create function pg_temp.plan(src text) returns jsonb language plpgsql as $$
declare
  p jsonb;
begin
  -- The fixture is a few dozen rows, where a sequential scan is the planner's right answer; the plan of a busy instance reads indexes, so
  -- that is the shape to look at.
  perform set_config('enable_seqscan', 'off', true);
  execute format('prepare pn(timestamptz, timestamptz) as %s', src);
  execute format('explain (analyze, format json) execute pn(%L, %L)', pg_temp.base(), pg_temp.base() + interval '1 hour') into p;
  execute 'deallocate pn';
  perform set_config('enable_seqscan', 'on', true);
  return p;
end $$;
-- The plan's nodes, all of them.
create function pg_temp.nodes(p jsonb) returns setof jsonb language sql as $$
  with recursive nodes(n) as (
    select p -> 0 -> 'Plan'
    union all
    select c from nodes, jsonb_array_elements(coalesce(n -> 'Plans', '[]'::jsonb)) c
  ) select n from nodes
$$;
-- The plan's shape: the acts nodes as (type, loops), sorted, and the regexp_matches scans as their count and loops.
create function pg_temp.shape(p jsonb) returns text language sql as $$
  select 'acts:' || coalesce((select string_agg(n ->> 'Node Type' || 'x' || (n ->> 'Actual Loops'), ',' order by n ->> 'Node Type', n ->> 'Actual Loops')
                              from pg_temp.nodes(p) n where n ->> 'Relation Name' = 'acts'), '')
      || ' regexp:' || (select count(*) from pg_temp.nodes(p) n where n ->> 'Node Type' = 'Function Scan' and n ->> 'Function Name' = 'regexp_matches')
      || 'x' || coalesce((select max((n ->> 'Actual Loops')::integer) from pg_temp.nodes(p) n where n ->> 'Node Type' = 'Function Scan' and n ->> 'Function Name' = 'regexp_matches'), 0)
$$;
-- A single pass: one regexp_matches scan, run once per post of the window at most (so the personas are in its pattern, not in its loops),
-- and no acts node looped more than the window has posts.
create function pg_temp.single_pass(p jsonb, posts integer) returns boolean language sql as $$
  select (select count(*) from pg_temp.nodes(p) n where n ->> 'Node Type' = 'Function Scan' and n ->> 'Function Name' = 'regexp_matches') = 1
     and coalesce((select max((n ->> 'Actual Loops')::integer) from pg_temp.nodes(p) n where n ->> 'Node Type' = 'Function Scan' and n ->> 'Function Name' = 'regexp_matches'), 0) <= posts
     and not exists (select 1 from pg_temp.nodes(p) n where n ->> 'Relation Name' = 'acts' and (n ->> 'Actual Loops')::integer > posts)
$$;

do $$
declare
  src text := (select prosrc from pg_proc where oid = 'pool_named(timestamptz, timestamptz)'::regprocedure);
  -- The defect the check exists to catch: the same match run once per persona, a scan of the window's posts for each.
  per_persona text := $q$
    select coalesce(jsonb_agg(h.id), '[]'::jsonb) from (
      select p.id from (select cp.staff, name_skeleton(cp.name) as folded from characters_public cp where cp.staff is not null and cp.office is distinct from 'developer') n
      cross join lateral (
        select a.id from acts_public a
        where a.kind = 'post' and a.created_at >= $1 and a.created_at < $2
          and name_skeleton(coalesce(a.current_payload ->> 'body', '')) ~ ('(?<![[:alnum:]])' || n.folded || '(?![[:alnum:]])')) p) h $q$;
  many text; one text; posts integer; personas integer; p jsonb; bad jsonb;
begin
  select count(*) into personas from characters_public where staff is not null and office is distinct from 'developer';
  select count(*) into posts from acts_public where kind = 'post' and created_at >= pg_temp.base() and created_at < pg_temp.base() + interval '1 hour';
  if personas < 4 or posts < 20 then raise exception 'the plan test needs several personas and posts (% and %)', personas, posts; end if;
  analyze acts;
  p := pg_temp.plan(src);
  many := pg_temp.shape(p);
  bad := pg_temp.plan(per_persona);
  -- The check sees the defect: a match run once per persona is not a single pass.
  if pg_temp.single_pass(bad, posts) then raise exception 'the plan check takes a per-persona match for a single pass: %', pg_temp.shape(bad); end if;
  if not pg_temp.single_pass(p, posts) then raise exception 'the named match is not one pass over the window''s posts: %', many; end if;
  -- And the plan does not change with the roster: one persona, the others not debuted.
  -- (The posts of the three that left are not public posts now, so the loops fall with them; the kinds of node do not change.)
  update characters set debuted_at = null where staff in ('ps-pat', 'ps-old', 'ps-warden');
  p := pg_temp.plan(src);
  one := pg_temp.shape(p);
  if not pg_temp.single_pass(p, (select count(*)::integer from acts_public where kind = 'post' and created_at >= pg_temp.base() and created_at < pg_temp.base() + interval '1 hour')) then
    raise exception 'the named match is not one pass with one persona: %', one;
  end if;
  update characters set debuted_at = now() where staff in ('ps-pat', 'ps-old', 'ps-warden');
  if regexp_replace(many, 'x[0-9]+', 'x', 'g') is distinct from regexp_replace(one, 'x[0-9]+', 'x', 'g') then
    raise exception E'the plan depends on the number of personas:\n  % personas: %\n  one: %', personas, many, one;
  end if;
  raise notice 'plan shape (% personas, % posts): %; the per-persona defect: %', personas, posts, many, pg_temp.shape(bad);
end $$;

-- ----------------------------------------------------------------------------------------------- the poison ----
-- A copy of pool_signals that also reads characters.owner, owned by the digest role as the real one is: the database refuses it, and the
-- same copy without the read runs (so it is the read that is refused, and nothing else about the copy).
do $$
declare
  def text := pg_get_functiondef('pool_signals(timestamptz, timestamptz)'::regprocedure);
  clean text;
  poisoned text;
  denied boolean;
  v text;
begin
  clean := replace(def, 'FUNCTION public.pool_signals(', 'FUNCTION public.poison_pool_signals(');
  if clean = def then raise exception 'the definition of pool_signals is not as the poison expects'; end if;
  poisoned := regexp_replace(clean, 'jsonb_build_object\(', 'jsonb_build_object(''owners'', (select count(c.owner) from characters c), ');
  if poisoned = clean then raise exception 'the poison did not plant a read'; end if;
  grant create on schema public to kayfabb_digest;
  execute clean;
  alter function poison_pool_signals(timestamptz, timestamptz) owner to kayfabb_digest;
  -- The control: the copy as it is runs.
  perform poison_pool_signals(pg_temp.base(), pg_temp.base() + interval '1 hour');
  -- The three private facts: who owns a character, a character's class, who reacted.
  foreach v in array array['count(c.owner) from characters c', 'count(h.class_key) from class_history h', 'count(r.reactor_character) from reactions r'] loop
    execute 'drop function poison_pool_signals(timestamptz, timestamptz)';
    execute replace(poisoned, 'count(c.owner) from characters c', v);
    alter function poison_pool_signals(timestamptz, timestamptz) owner to kayfabb_digest;
    denied := false;
    begin perform poison_pool_signals(pg_temp.base(), pg_temp.base() + interval '1 hour');
    exception when insufficient_privilege then denied := true; end;
    if not denied then raise exception 'a copy of pool_signals read (%)', v; end if;
  end loop;
  revoke create on schema public from kayfabb_digest;
end $$;
