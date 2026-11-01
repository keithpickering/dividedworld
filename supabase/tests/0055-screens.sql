-- The screens' public progress read (supabase/migrations/0050_screens.sql, and 0053_stored_progress.sql, which made it a probe of a
-- stored row; the system plan, Task 12). move_progress(move_act) is the count the tick last stored for a landed move, and a visitor may
-- call it: a board page shows a move's way out ("7 of 12 posters"). It answers no number before the tick has counted, the evaluator's
-- own answer and the time it was counted after (never a newer one: posts after the count wait for the next), nothing for a move that
-- ended, raises in words for an Act that is no move, and is not the digest role's (the reviewed list of that role is supabase/tests/0050-digest.sql's).
-- That it costs nothing in the board's size is supabase/tests/0058-progress-scale.sql's.

-- ---- A seed with a Boss, a board's move in force, and posters ----
do $$
declare
  seed jsonb := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true), 'classes', '[]'::jsonb, 'reactions', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'sc-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'sc-boss', 'name', 'Screens Boss', 'kind', 'boss', 'title', 'Boss', 'signature', 'Hi')),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(jsonb_build_object('key', 'renameBoard', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'distinctCharactersOnBoard'))));
  general uuid := (select id from boards where slug = 'general');
  sys uuid;
  mv uuid;
  acct uuid := tests.account('sc-a');
  a uuid := tests.character(acct, 'Sc A');
  b uuid := tests.character(tests.account('sc-b'), 'Sc B');
  t uuid;
begin
  perform seed_instance(seed);
  select th.id into sys from threads th join boards bd on bd.id = th.board where bd.is_system and th.title = 'Announcements';
  mv := (write_staff_act('sc-boss', 'move', sys, null, jsonb_build_object('kind', 'renameBoard', 'body', 'The System has spoken.',
    'params', jsonb_build_object('board', general, 'name', 'Screens Hall', 'premise', 'Screens.', 'description', 'About screens.'),
    'demand', jsonb_build_object('kind', 'distinctCharactersOnBoard', 'params', jsonb_build_object('board', general, 'count', 4)),
    'expires_at', now() + interval '3 days')) ->> 'id')::uuid;
  -- Two different characters have posted on the board since the landing, one of them twice: two characters, not three posts.
  t := (select id from threads where board = general limit 1);
  if t is null then insert into threads (board, title) values (general, 'Screens thread') returning id into t; end if;
  perform tests.post(a, t, 'one', now() + interval '1 second');
  perform tests.post(a, t, 'two', now() + interval '2 seconds');
  perform tests.post(b, t, 'three', now() + interval '3 seconds');
  create temp table screens_fixture as select mv as move_act, acct as account, t as thread;
  grant select on screens_fixture to public;
end $$;

-- ---- A visitor and a player may call it; before the tick it has no count; after, it equals the evaluator's answer, with when it was counted ----
do $$
declare
  mv uuid := (select move_act from screens_fixture);
  want jsonb;
  got jsonb;
  counted timestamptz;
begin
  perform tests.become_anon();
  got := move_progress(mv);
  perform tests.unbecome();
  if got is distinct from '{"checkedAt": null}'::jsonb then raise exception 'a move the tick has not counted read % to a visitor', got; end if;

  perform system_tick();
  counted := (select checked_at from open_moves where move_act = mv);
  if counted is null then raise exception 'the tick did not count the move'; end if;
  perform tests.become_service();
  want := demand_progress(mv);
  perform tests.unbecome();
  if want is distinct from jsonb_build_object('done', 2, 'of', 4, 'met', false) then raise exception 'the evaluator answered % for the fixture', want; end if;

  perform tests.become_anon();
  got := move_progress(mv);
  perform tests.unbecome();
  if got is distinct from want || jsonb_build_object('checkedAt', counted) then raise exception 'a visitor read % and the tick counted % at %', got, want, counted; end if;

  perform tests.become((select account from screens_fixture));
  got := move_progress(mv);
  perform tests.unbecome();
  if got is distinct from want || jsonb_build_object('checkedAt', counted) then raise exception 'a player read % and the tick counted % at %', got, want, counted; end if;

  if not (has_function_privilege('anon', 'move_progress(uuid)', 'execute') and has_function_privilege('authenticated', 'move_progress(uuid)', 'execute')) then
    raise exception 'the web client cannot call move_progress';
  end if;
  if has_function_privilege('public', 'move_progress(uuid)', 'execute') and not has_function_privilege('anon', 'move_progress(uuid)', 'execute') then
    raise exception 'move_progress is callable by public but not by the clients';
  end if;
end $$;

-- ---- A post after the count waits for the next count; the next tick's count comes with its own time; a met demand ends the move ----
do $$
declare
  mv uuid := (select move_act from screens_fixture);
  thread uuid := (select thread from screens_fixture);
  c uuid := tests.character(tests.account('sc-c'), 'Sc C');
  d uuid := tests.character(tests.account('sc-d'), 'Sc D');
  before_ jsonb;
  got jsonb;
begin
  before_ := move_progress(mv);
  perform tests.post(c, thread, 'four', now() + interval '4 seconds');
  perform tests.become_anon(); got := move_progress(mv); perform tests.unbecome();
  if got is distinct from before_ then raise exception 'a post after the count changed what a visitor reads: % then %', before_, got; end if;
  -- The tick checks a move again once it was last checked demandCheckMinutes (5) ago.
  update open_moves set checked_at = now() - interval '10 minutes' where move_act = mv;
  perform tests.become_anon(); got := move_progress(mv); perform tests.unbecome();
  if got is distinct from (before_ - 'checkedAt') || jsonb_build_object('checkedAt', now() - interval '10 minutes') then raise exception 'the time of the count is not the row''s: %', got; end if;
  perform system_tick();
  perform tests.become_anon(); got := move_progress(mv); perform tests.unbecome();
  if got is distinct from jsonb_build_object('done', 3, 'of', 4, 'met', false, 'checkedAt', now()) then raise exception 'the next count read % to a visitor', got; end if;
  -- The count that meets the demand ends the move; an ended move has no count to show.
  perform tests.post(d, thread, 'five', now() + interval '5 seconds');
  update open_moves set checked_at = now() - interval '10 minutes' where move_act = mv;
  if (system_tick() ->> 'met')::integer is distinct from 1 then raise exception 'the tick did not end the met move'; end if;
  perform tests.become_anon(); got := move_progress(mv); perform tests.unbecome();
  if got is distinct from '{"checkedAt": null}'::jsonb then raise exception 'a move that ended read % to a visitor', got; end if;
end $$;

-- ---- An Act that is no move raises in words, for a visitor too ----
do $$
declare
  post uuid := (select id from acts where kind = 'post' limit 1);
begin
  perform tests.become_anon();
  begin perform move_progress(post); raise exception 'move_progress answered for a post';
  exception when others then
    if sqlstate <> 'P0002' or sqlerrm <> 'that is not a move' then raise exception 'a post said % (%)', sqlerrm, sqlstate; end if;
  end;
  begin perform move_progress(gen_random_uuid()); raise exception 'move_progress answered for no Act';
  exception when others then
    if sqlstate <> 'P0002' or sqlerrm <> 'that is not a move' then raise exception 'no Act said % (%)', sqlerrm, sqlstate; end if;
  end;
  perform tests.unbecome();
end $$;

-- ---- It is the migration's owner's and reads through the digest role's evaluator; it is not itself the digest role's ----
do $$
begin
  if (select r.rolname from pg_proc p join pg_roles r on r.oid = p.proowner where p.oid = 'move_progress(uuid)'::regprocedure) = 'kayfabb_digest' then
    raise exception 'move_progress is owned by the digest role, whose reviewed list does not hold it';
  end if;
  if not (select prosecdef from pg_proc where oid = 'move_progress(uuid)'::regprocedure) then raise exception 'move_progress is not security definer'; end if;
  if not exists (select 1 from pg_proc p where p.oid = 'move_progress(uuid)'::regprocedure and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public, pg_temp')) then
    raise exception 'move_progress does not pin its search_path';
  end if;
end $$;
