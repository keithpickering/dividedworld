-- The barred box's read (supabase/migrations/0124_barred_reads.sql; docs/plans/2026-11-06-member-groups-plan.md, Task 10).
--
-- my_apologies(character): the caller's own acting character's apologies, each with its move, its state, when it was written and when the next one may be.
--   * A player reads its own character's rows and nobody else's: another player calling with the same id, and the anonymous, get none, as they do for an id that is no one's.
--   * A pending or ruled apology says when the next may be written (created_at + apologyEveryHours); a returned one says none, since it opens the next at once.
--   * Rows are newest first.
-- my_characters.bars: the caller's own character carries the boards it is barred from now ({board, move, group, expires_at}), [] for the other mask and for a move past its expiry
--   that the tick has not ended; another player's view of their own characters carries no bar of this player's.

create function pg_temp.announcements() returns uuid language sql as $$
  select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements'
$$;
create function pg_temp.board(slug text) returns uuid language sql as $$ select id from boards where boards.slug = board.slug $$;
create function pg_temp.acct(label text) returns uuid language sql as $$ select id from auth.users where email = label || '@test.invalid' $$;
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
      jsonb_build_object('key', 'trialMembers', 'name', 'Trial Members', 'color', '#d2691e', 'stripe', true, 'source', 'conferred', 'tone', 'punishment')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'br-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'br-boss', 'name', 'Reads Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb)),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'conferGroup', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss', 'mod'), 'derived', jsonb_build_array('groupName'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'apologyAccepted')),
      'predicates', '[]'::jsonb));
  perform seed_instance(seed);
end $$;

do $$
declare
  general uuid := pg_temp.board('general');
  a uuid := tests.account('br-a');
  b uuid := tests.account('br-b');
  sorry uuid := tests.character(a, 'Br Sorry');
  mask uuid := tests.character(a, 'Br Mask');
  m uuid;
  ap bigint;
  got text;
  first_at timestamptz;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  m := tests.act((select id from characters c where c.staff = 'br-boss'), 'move', pg_temp.announcements(),
    jsonb_build_object('kind', 'conferGroup', 'body', 'Moved.', 'params', jsonb_build_object('character', sorry::text, 'group', 'trialMembers', 'board', general::text),
      'demand', jsonb_build_object('kind', 'apologyAccepted', 'params', '{}'::jsonb), 'expires_at', now() + interval '3 days'), null, now() - interval '1 hour');
  perform set_config('kayfabb.staff_writer', '', true);

  -- Nothing written yet.
  got := pg_temp.as_val(a, format('select count(*) from my_apologies(%L)', sorry));
  if got is distinct from '0' then raise exception 'no apology yet, no row: %', got; end if;

  -- Waiting: a pending row, the next opening a day after it was written.
  got := pg_temp.as_val(a, format('select apologize(%L, %L, %L, %L)', m, sorry, 'Sorry', 'I was wrong.'));
  if got like 'ERROR:%' then raise exception 'the apology: %', got; end if;
  select x.created_at into first_at from apologies x where x.move_act = m;
  got := pg_temp.as_val(a, format('select concat_ws(%L, state, next_at = created_at + interval %L, move_act = %L) from my_apologies(%L)', '/', '24 hours', m, sorry));
  if got is distinct from 'pending/t/t' then raise exception 'a waiting apology reads pending with its next opening: %', got; end if;

  -- Another player, and the anonymous, read nothing of it; an id that is no one's reads the same.
  got := pg_temp.as_val(b, format('select count(*) from my_apologies(%L)', sorry));
  if got is distinct from '0' then raise exception 'another player reads none of a character''s apologies: %', got; end if;
  got := pg_temp.as_val(a, format('select count(*) from my_apologies(%L)', mask));
  if got is distinct from '0' then raise exception 'the same player''s other mask has none: %', got; end if;
  got := pg_temp.as_val(a, format('select count(*) from my_apologies(%L)', gen_random_uuid()));
  if got is distinct from '0' then raise exception 'an id that is no one''s reads none: %', got; end if;
  got := pg_temp.as_val(null, format('select count(*) from my_apologies(%L)', sorry));
  if got not like 'ERROR:%' and got is distinct from '0' then raise exception 'the service role reads as no player: %', got; end if;
  perform tests.become_anon();
  begin
    perform * from my_apologies(sorry);
    raise exception 'anon calls my_apologies';
  exception when insufficient_privilege then null;
  end;
  perform tests.unbecome();

  -- Rejected: the row stays, with the next opening; returned: none.
  ap := (select id from apologies where move_act = m);
  perform pg_temp.as_val(null, format('select rule_apology(%L, %L, %L)', ap, 'rejected', 'No.'));
  got := pg_temp.as_val(a, format('select concat_ws(%L, state, next_at is not null) from my_apologies(%L)', '/', sorry));
  if got is distinct from 'rejected/t' then raise exception 'a rejected apology says when the next may be written: %', got; end if;
  update apologies set state = 'returned' where id = ap;
  got := pg_temp.as_val(a, format('select concat_ws(%L, state, next_at is null) from my_apologies(%L)', '/', sorry));
  if got is distinct from 'returned/t' then raise exception 'a returned apology opens the next at once: %', got; end if;
end $$;

do $$
declare
  general uuid := pg_temp.board('general');
  a uuid := (select id from auth.users where email = 'br-a@test.invalid');
  b uuid := (select id from auth.users where email = 'br-b@test.invalid');
  sorry uuid := (select id from characters where name = 'Br Sorry');
  mask uuid := (select id from characters where name = 'Br Mask');
  lapsed uuid := tests.character(tests.account('br-lapsed'), 'Br Lapsed');
  m uuid := (select move_act from bars_now where character = sorry);
  got text;
begin
  got := pg_temp.as_val(a, format('select (bars -> 0 ->> %L) || %L || (bars -> 0 ->> %L) || %L || (bars -> 0 ->> %L) || %L || jsonb_array_length(bars) from my_characters where id = %L',
    'board', '/', 'move', '/', 'group', '/', sorry));
  if got is distinct from general::text || '/' || m::text || '/trialMembers/1' then raise exception 'the barred character carries its bar: %', got; end if;
  got := pg_temp.as_val(a, format('select bars::text from my_characters where id = %L', mask));
  if got is distinct from '[]' then raise exception 'the other mask carries none: %', got; end if;
  got := pg_temp.as_val(b, format('select count(*) from my_characters where id = %L', sorry));
  if got is distinct from '0' then raise exception 'another player does not see this player''s characters: %', got; end if;

  -- A move past its expiry that the tick has not ended bars nobody, and the view says so as barred() does.
  perform set_config('kayfabb.staff_writer', 'on', true);
  perform tests.act((select id from characters c where c.staff = 'br-boss'), 'move', pg_temp.announcements(),
    jsonb_build_object('kind', 'conferGroup', 'body', 'Moved.', 'params', jsonb_build_object('character', lapsed::text, 'group', 'trialMembers', 'board', general::text),
      'demand', jsonb_build_object('kind', 'apologyAccepted', 'params', '{}'::jsonb), 'expires_at', now() - interval '1 hour'), null, now() - interval '2 hours');
  perform set_config('kayfabb.staff_writer', '', true);
  got := pg_temp.as_val((select owner from characters where id = lapsed), format('select bars::text from my_characters where id = %L', lapsed));
  if got is distinct from '[]' then raise exception 'a lapsed bar is not carried: %', got; end if;
end $$;
