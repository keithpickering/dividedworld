-- Presence (supabase/migrations/0041_presence.sql): who is browsing a thread, a board and the index.
-- One row per character, written only by that character's own polls; a swap of masks writes only the
-- new mask's row, so the old one ages out by itself; a hidden, retired or waiting mask is listed
-- nowhere; the answer names characters and counts them, and never says which are the caller's. The
-- presence plan, Task 2 (docs/plans/2026-10-31-presence-plan.md).

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate;
end $$;

-- The names a box lists, in order.
create function pg_temp.names(box jsonb) returns uuid[] language sql as $$
  select coalesce(array_agg((e ->> 'id')::uuid order by i), '{}') from jsonb_array_elements(box -> 'names') with ordinality x(e, i)
$$;

do $$
declare
  ann uuid := tests.account('here-ann');
  bob uuid := tests.account('here-bob');
  a1 uuid := tests.character(ann, 'Here One');
  a2 uuid := tests.character(ann, 'Here Two');
  b1 uuid := tests.character(bob, 'Here Bee');
  t uuid := tests.thread('Browse me');
  other_board uuid;
  box jsonb;
  waiting uuid;
begin
  insert into boards (slug, name) values ('elsewhere', 'Elsewhere') returning id into other_board;

  -- Answering from rows: a mask is listed on its own poll, and a second player's after it, in arrival order.
  perform tests.become(ann);
  box := here('thread', t, a1);
  if pg_temp.names(box) is distinct from array[a1] then raise exception 'a poll lists its own mask: %', box; end if;
  perform tests.unbecome();
  update presence set place_since = now() - interval '1 minute', online_since = now() - interval '1 minute' where character = a1;
  perform tests.become(bob);
  box := here('thread', t, b1);
  if pg_temp.names(box) is distinct from array[a1, b1] then raise exception 'two players, in arrival order: %', box; end if;
  if (box ->> 'others')::integer is distinct from 0 then raise exception 'nobody past the cap: %', box; end if;

  -- The answer's shape: names and a count, each name an id and a name, never an account or a flag for "yours".
  if (select array_agg(k order by k) from jsonb_object_keys(box) k) is distinct from array['names', 'others'] then
    raise exception 'the answer holds only names and others: %', box;
  end if;
  if exists (select 1 from jsonb_array_elements(box -> 'names') e
             where (select array_agg(k order by k) from jsonb_object_keys(e) k) is distinct from array['id', 'name']) then
    raise exception 'a name holds only its id and its name: %', box;
  end if;
  if box #>> '{names,0,name}' is distinct from 'Here One' then raise exception 'a name is the character''s: %', box; end if;

  -- The swap (the poison): through a1, then at once through a2, the same account on the same thread.
  -- Both are listed: the swap never removes the old mask, which ages out by itself.
  perform tests.become(ann);
  perform here('thread', t, a2);
  box := here('thread', t, a2);
  if not (pg_temp.names(box) @> array[a1, a2, b1]) then raise exception 'a swap removed the old mask: %', box; end if;
  perform tests.unbecome();
  update presence set seen_at = now() - interval '6 minutes' where character = a1;
  perform tests.become(bob);
  box := here('thread', t, b1);
  if pg_temp.names(box) @> array[a1] or not (pg_temp.names(box) @> array[a2]) then raise exception 'the old mask ages out, the new one stays: %', box; end if;

  -- The window is the setting's: at 10 minutes, a1's poll 6 minutes ago is listed again.
  perform tests.unbecome();
  update settings set value = '{"unit": "minute", "count": 10}' where key = 'presenceWindow';
  perform tests.become(bob);
  if not (pg_temp.names(here('thread', t, b1)) @> array[a1]) then raise exception 'a poll inside a longer window is listed'; end if;
  perform tests.unbecome();
  update settings set value = '{"unit": "minute", "count": 5}' where key = 'presenceWindow';
  update presence set seen_at = now() where character = a1;

  -- Not your mask, and not yet debuted: refused as played_by refuses them.
  perform tests.become(bob);
  if pg_temp.refusal(format('select here(%L, %L, %L)', 'thread', t, a1)) is distinct from '42501' then raise exception 'a poll through another''s mask'; end if;
  perform tests.unbecome();
  insert into characters (owner, name) values (bob, 'Here Waiting') returning id into waiting;
  perform tests.become(bob);
  if pg_temp.refusal(format('select here(%L, %L, %L)', 'thread', t, waiting)) is distinct from '55000' then raise exception 'a poll through a waiting mask'; end if;
  -- A place that is not one.
  if pg_temp.refusal(format('select here(%L, %L, null)', 'thread', gen_random_uuid())) is distinct from 'P0002' then raise exception 'a poll of no thread'; end if;
  if pg_temp.refusal(format('select here(%L, %L, null)', 'board', gen_random_uuid())) is distinct from 'P0002' then raise exception 'a poll of no board'; end if;
  if pg_temp.refusal(format('select here(%L, null, null)', 'room')) is distinct from 'P0002' then raise exception 'a poll of no kind of place'; end if;
  -- A poll with no mask writes nothing and still answers.
  if not (pg_temp.names(here('thread', t, null)) @> array[a1, a2, b1]) then raise exception 'a poll with no mask answers the box'; end if;

  -- The board and the index: a mask in a thread on a board is in that board's box and the index's, and no other board's.
  box := here('board', (select board from threads where id = t), null);
  if not (pg_temp.names(box) @> array[a1, a2, b1]) then raise exception 'a board''s box counts its threads: %', box; end if;
  if pg_temp.names(here('board', other_board, null)) <> '{}' then raise exception 'another board''s box lists nobody'; end if;
  if not (pg_temp.names(here('index', null, null)) @> array[a1, a2, b1]) then raise exception 'the index lists everyone online'; end if;
  -- On another board's page, b1 is in that board's box, no longer in the thread's, and still in the index's.
  perform here('board', other_board, b1);
  if pg_temp.names(here('board', other_board, null)) is distinct from array[b1] then raise exception 'a board''s own page'; end if;
  if pg_temp.names(here('thread', t, null)) @> array[b1] then raise exception 'a mask is at one place at a time'; end if;

  -- The cap: with two names shown and three present, the first two by place_since, and one other.
  perform here('thread', t, b1);
  perform tests.unbecome();
  update settings set value = '2' where key = 'presenceNames';
  update presence set place_since = now() - interval '3 minutes' where character = a1;
  update presence set place_since = now() - interval '2 minutes' where character = a2;
  update presence set place_since = now() - interval '1 minute' where character = b1;
  perform tests.become(bob);
  box := here('thread', t, null);
  if pg_temp.names(box) is distinct from array[a1, a2] or (box ->> 'others')::integer is distinct from 1 then raise exception 'the cap: %', box; end if;
  perform tests.unbecome();
  update settings set value = '15' where key = 'presenceNames';

  -- Hidden: its row goes at once, a later poll through it writes nothing, nobody's box lists it, and its player sees the switch on.
  perform tests.become(bob);
  if pg_temp.refusal(format('select set_presence_hidden(%L, true)', a1)) is distinct from '42501' then raise exception 'another account hid a mask'; end if;
  perform tests.become(ann);
  if set_presence_hidden(a1, true) is distinct from jsonb_build_object('character', a1, 'hidden', true) then raise exception 'the switch answers'; end if;
  perform tests.unbecome();
  if exists (select 1 from presence where character = a1) then raise exception 'hiding removes the row'; end if;
  if not exists (select 1 from presence where character = a2) then raise exception 'hiding one mask removed another'; end if;
  perform tests.become(ann);
  perform here('thread', t, a1);
  if not (select presence_hidden from my_characters where id = a1) or (select presence_hidden from my_characters where id = a2) then
    raise exception 'my_characters says which masks are hidden';
  end if;
  perform tests.unbecome();
  if exists (select 1 from presence where character = a1) then raise exception 'a hidden mask''s poll wrote a row'; end if;
  -- A row written in the moment before it was hidden is listed nowhere either.
  insert into presence (character, place_kind, place, board, place_since, online_since, seen_at)
  values (a1, 'thread', t, (select board from threads where id = t), now(), now(), now());
  perform tests.become(bob);
  if pg_temp.names(here('thread', t, b1)) @> array[a1] then raise exception 'a hidden mask was listed'; end if;
  perform tests.unbecome();
  delete from presence where character = a1;
  -- Shown again, it is listed on its next poll.
  perform tests.become(ann);
  perform set_presence_hidden(a1, false);
  if (select presence_hidden from my_characters where id = a1) then raise exception 'shown again'; end if;
  if not (pg_temp.names(here('thread', t, a1)) @> array[a1]) then raise exception 'a mask shown again is listed on its next poll'; end if;

  -- Retired: its poll writes nothing and answers, and it is listed nowhere, even with a fresh row.
  perform tests.unbecome();
  update characters set retired_at = now() where id = a2;
  delete from presence where character = a2;
  perform tests.become(ann);
  box := here('thread', t, a2);
  if pg_temp.names(box) @> array[a2] then raise exception 'a retired mask was listed: %', box; end if;
  perform tests.unbecome();
  if exists (select 1 from presence where character = a2) then raise exception 'a retired mask''s poll wrote a row'; end if;
  insert into presence (character, place_kind, place, board, place_since, online_since, seen_at)
  values (a2, 'index', null, null, now(), now(), now());
  perform tests.become(bob);
  if pg_temp.names(here('index', null, null)) @> array[a2] then raise exception 'a retired mask with a fresh row was listed'; end if;
  -- A retired mask's switch may still be turned.
  perform tests.become(ann);
  perform set_presence_hidden(a2, true);
  perform tests.unbecome();
end $$;

-- A visitor can call neither, and no client reads either table.
do $$
declare
  reader uuid := tests.account('here-reader');
begin
  perform tests.become_anon();
  if pg_temp.refusal($q$select here('index', null, null)$q$) is distinct from '42501' then raise exception 'a visitor polled'; end if;
  if pg_temp.refusal($q$select set_presence_hidden(gen_random_uuid(), true)$q$) is distinct from '42501' then raise exception 'a visitor hid a mask'; end if;
  perform tests.become(reader);
  if pg_temp.refusal('select * from presence') is distinct from '42501' then raise exception 'a client read presence'; end if;
  if pg_temp.refusal('select * from presence_hidden') is distinct from '42501' then raise exception 'a client read presence_hidden'; end if;
  if pg_temp.refusal('select presence_mask(gen_random_uuid(), gen_random_uuid())') is distinct from '42501' then raise exception 'a client called presence_mask'; end if;
  perform tests.unbecome();
end $$;

-- The cost at a busy instance: a thread's box reads by (place, seen_at), and the index's by seen_at,
-- over a few thousand rows of which a few are inside the window.
do $$
declare
  t uuid := tests.thread('Crowded');
  who uuid;
  plan text;
begin
  for i in 1 .. 500 loop
    who := tests.account('here-crowd-' || i);
    insert into presence (character, place_kind, place, board, place_since, online_since, seen_at)
    select tests.character(who, format('Crowd %s %s', i, j)), 'thread', case when i % 50 = 0 then t else gen_random_uuid() end,
           (select board from threads where id = t), now(), now(), now() - (random() * interval '4 hours')
    from generate_series(1, 6) j;
  end loop;
  analyze presence;
  execute format('explain (format json) select 1 from presence p where p.place = %L and p.seen_at >= now() - interval %L', t, '5 minutes') into plan;
  if plan not like '%presence_place%' then raise exception 'a thread''s box reads by place: %', plan; end if;
  execute format('explain (format json) select count(*) from presence p where p.seen_at >= now() - interval %L', '5 minutes') into plan;
  if plan not like '%presence_seen%' then raise exception 'the index''s box reads by seen_at: %', plan; end if;
end $$;
