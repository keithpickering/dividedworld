-- Gabe's to-do (supabase/migrations/0090_handover_todos.sql; the staff roster design, section 11; its plan, Task 11).
-- A handover that changed the Boss leaves a to-do in the admin queue: "Season N opens with a new Boss; write the announcement". It clears when
-- an update is posted after the handover landed, or when an admin dismisses it, and not otherwise: an update posted before the handover
-- does not clear it (the poison, planted below). Only an admin reads it or dismisses it; a dismissal is written once and never edited.

do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('Landed: {move}.'),
        'bossFarewell', jsonb_build_array('Farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.'))),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'Ht Gabe', 'title', 'Made this.', 'avatar', 'gabe'),
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'ht-boss',
      'staffGroup', jsonb_build_object('name', 'Test Cores'),
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'ht-boss', 'name', 'Ht Boss', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'ht-mod', 'name', 'Ht Mod', 'title', 'Mod', 'signature', 'b'),
        jsonb_build_object('key', 'ht-mod2', 'name', 'Ht Mod Two', 'title', 'Mod', 'signature', 'c')),
      'firstStaff', jsonb_build_array('ht-mod', 'ht-mod2'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')))));
  insert into admins (account) values (tests.account('ht-admin'));
  perform tests.account('ht-player');
  update seasons set starts_at = now() - interval '60 days' where ends_at is null;
end $$;

create function pg_temp.refused(stmt text) returns text language plpgsql as $$
begin execute stmt; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create function pg_temp.as_admin() returns void language sql as $$ select tests.become((select id from auth.users where email = 'ht-admin@test.invalid')) $$;
create function pg_temp.as_player() returns void language sql as $$ select tests.become((select id from auth.users where email = 'ht-player@test.invalid')) $$;
-- The to-dos, as an admin reads them.
create function pg_temp.todos() returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.as_admin();
  r := admin_queue() -> 'todos';
  perform tests.unbecome();
  return r;
end $$;
create function pg_temp.write_update(title text) returns void language plpgsql as $$
begin
  perform pg_temp.as_admin();
  perform post_update(title, 'Words.', '[]');
  perform tests.unbecome();
end $$;
create function pg_temp.dismiss(n integer) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.as_admin();
  r := dismiss_handover_todo(n);
  perform tests.unbecome();
  return r;
end $$;
-- Where the handover landed, moved by the test so that "before" and "after" an update are not a matter of the clock.
create function pg_temp.landed(n integer, moved_to timestamptz) returns void language sql security definer as $$
  update season_handovers set landed_at = moved_to where season = (select id from seasons where number = n)
$$;

-- ---- No handover, no to-do ----
do $$
begin
  if pg_temp.todos() is distinct from '[]'::jsonb then raise exception 'a to-do with no handover: %', pg_temp.todos(); end if;
end $$;

-- ---- A handover that changed the Boss makes a to-do, in the admin queue, with the facts the announcement needs ----
do $$
declare
  t jsonb; todo jsonb;
begin
  perform reveal_season((select starts_at from seasons where ends_at is null) + interval '1 day');
  t := pg_temp.todos();
  if jsonb_array_length(t) is distinct from 1 then raise exception 'a handover did not make one to-do: %', t; end if;
  todo := t -> 0;
  if (todo ->> 'season')::integer is distinct from 2 then raise exception 'the to-do names the wrong season: %', todo; end if;
  if todo ->> 'outgoing' is distinct from 'ht-boss' or todo ->> 'outgoingName' is distinct from 'Ht Boss' then raise exception 'the to-do does not name the outgoing Boss: %', todo; end if;
  if todo ->> 'boss' is null or todo ->> 'bossName' is null or todo ->> 'boss' = 'ht-boss' then raise exception 'the to-do does not name the new Boss: %', todo; end if;
  if todo ->> 'how' not in ('nomination', 'rotation') then raise exception 'the to-do does not say how the Boss was chosen: %', todo; end if;
  if todo ->> 'outgoingOffice' is distinct from (select office from staff_office_now where staff = 'ht-boss') or todo ->> 'outgoingOffice' not in ('member', 'mod') then
    raise exception 'the to-do does not give the outgoing Boss''s office now: %', todo;
  end if;
  if todo ->> 'bossWas' is distinct from 'mod' then raise exception 'the to-do does not say the new Boss was a Moderator: %', todo; end if;
  if (todo ->> 'landedAt')::timestamptz is distinct from (select landed_at from season_handovers where season = (select id from seasons where number = 2)) then
    raise exception 'the to-do does not say when the handover landed: %', todo;
  end if;
end $$;

-- ---- A player is refused the queue and the dismissal; a visitor cannot reach either ----
do $$
declare
  said text;
begin
  perform pg_temp.as_player();
  said := pg_temp.refused('select dismiss_handover_todo(2)');
  perform tests.unbecome();
  if said is null or said not like '42501%' then raise exception 'a player dismissed a to-do: %', said; end if;
  if exists (select 1 from handover_dismissals) then raise exception 'a refused dismissal left a row'; end if;
  perform tests.become_anon();
  said := pg_temp.refused('select dismiss_handover_todo(2)');
  perform tests.unbecome();
  if said is null then raise exception 'a visitor reached dismiss_handover_todo'; end if;
  perform pg_temp.as_player();
  said := pg_temp.refused('select admin_queue()');
  perform tests.unbecome();
  if said is null or said not like '42501%' then raise exception 'a player read the to-dos: %', said; end if;
end $$;

-- ---- The poison: an update posted BEFORE the handover landed does not clear it ----
do $$
begin
  perform pg_temp.landed(2, now() + interval '1 hour');
  perform pg_temp.write_update('Posted before the handover');
  if jsonb_array_length(pg_temp.todos()) is distinct from 1 then raise exception 'an update posted before the handover cleared its to-do: %', pg_temp.todos(); end if;
end $$;

-- ---- A handover that did not change the Boss leaves no to-do ----
do $$
declare
  kept record;
begin
  -- (The row as hand_over writes it when nothing could be chosen: the Boss stays.)
  select h.outgoing, h.boss, h.how into kept from season_handovers h where h.season = (select id from seasons where number = 2);
  update season_handovers set boss = outgoing, how = 'unchanged' where season = (select id from seasons where number = 2);
  if jsonb_array_length(pg_temp.todos()) is distinct from 0 then raise exception 'an unchanged Boss left a to-do: %', pg_temp.todos(); end if;
  update season_handovers set boss = kept.boss, how = kept.how where season = (select id from seasons where number = 2);
end $$;

-- ---- An update posted after the handover clears it ----
do $$
begin
  perform pg_temp.landed(2, now() - interval '1 hour');
  if jsonb_array_length(pg_temp.todos()) is distinct from 0 then raise exception 'an update after the handover did not clear its to-do: %', pg_temp.todos(); end if;
  -- The same update, moved to before the handover again, brings it back: nothing was written to clear it.
  perform pg_temp.landed(2, now() + interval '1 hour');
  if jsonb_array_length(pg_temp.todos()) is distinct from 1 then raise exception 'the to-do is not computed from the updates: %', pg_temp.todos(); end if;
end $$;

-- ---- A dismissal clears it, once, for good ----
do $$
declare
  r jsonb; said text;
begin
  r := pg_temp.dismiss(2);
  if r ->> 'season' is distinct from '2' then raise exception 'the dismissal did not say what it dismissed: %', r; end if;
  if jsonb_array_length(pg_temp.todos()) is distinct from 0 then raise exception 'a dismissal did not clear the to-do: %', pg_temp.todos(); end if;
  if (select count(*) from handover_dismissals) is distinct from 1 or (select admin from handover_dismissals) is distinct from (select id from auth.users where email = 'ht-admin@test.invalid') then
    raise exception 'the dismissal was not written once, with the admin''s name';
  end if;
  -- Twice is not an error and writes nothing more.
  r := pg_temp.dismiss(2);
  if (select count(*) from handover_dismissals) is distinct from 1 then raise exception 'a second dismissal wrote a second row'; end if;
  if r ->> 'season' is distinct from '2' then raise exception 'a second dismissal was not answered: %', r; end if;
  -- A season with no to-do (the first has no handover) is refused in words.
  perform pg_temp.as_admin();
  said := pg_temp.refused('select dismiss_handover_todo(1)');
  perform tests.unbecome();
  if said is null or said not like '%no to-do%' then raise exception 'a dismissal of a season with no to-do was not refused in words: %', said; end if;
  -- The ledger is append-only and no client's.
  said := pg_temp.refused('update handover_dismissals set at = now()');
  if said is null then raise exception 'a dismissal was edited'; end if;
  said := pg_temp.refused('delete from handover_dismissals');
  if said is null then raise exception 'a dismissal was removed'; end if;
  perform pg_temp.as_admin();
  said := pg_temp.refused('select * from handover_dismissals');
  perform tests.unbecome();
  if said is null then raise exception 'a client read the dismissals'; end if;
end $$;
