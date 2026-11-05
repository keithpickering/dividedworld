-- Staff in the presence boxes (0084_staff_presence.sql; the staff roster design, section 10; its plan, Task 4).
-- A staff character is listed in a thread's box, and its board's, for presenceWindow after its own post there, and not after; it is
-- listed once in a board's box however many threads it posted in; it is never in the index's box; the developer's updates are no posts, so it is never listed; a
-- player's post lists no one (a player is listed by its own poll alone); each name carries `staff`, true for the persona only.
-- It is computed from public posts alone: a player character reading changes nothing in a staff character's listing, and the
-- listing does not depend on any player's. The poison is the staff rows left out of the view (the first check fails) and the board
-- branch not folding a persona's threads into one name (the second).

do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 0, 'inheritanceGraceDays', 3,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('Landed: {move}.'),
        'bossFarewell', jsonb_build_array('Farewell from {boss}.'), 'bossArrival', jsonb_build_array('Hello from {boss}.'))),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'developer', jsonb_build_object('name', 'The Devs', 'title', 'Developers', 'avatar', ''),
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'sp-boss',
      'staffGroup', jsonb_build_object('name', 'Test Cores'),
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'sp-boss', 'name', 'Sp Boss', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'sp-mod', 'name', 'Sp Mod', 'title', 'Mod', 'signature', 'b')),
      'firstStaff', jsonb_build_array('sp-mod'),
      'moves', jsonb_build_array(jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')))));
end $$;

create function pg_temp.names(box jsonb) returns uuid[] language sql as $$
  select coalesce(array_agg((e ->> 'id')::uuid order by i), '{}') from jsonb_array_elements(box -> 'names') with ordinality x(e, i)
$$;

-- A box as a signed-in player reads it, without polling a mask (here() asks for a signed-in account).
create function pg_temp.look(kind text, place uuid, who uuid) returns jsonb language plpgsql as $f$
declare box jsonb;
begin
  perform tests.become(who);
  box := here(kind, place, null);
  perform tests.unbecome();
  return box;
end $f$;

do $$
declare
  ann uuid := tests.account('sp-ann');
  a1 uuid := tests.character(ann, 'Sp Anvil');
  t1 uuid := tests.thread('Staff here one');
  t2 uuid := tests.thread('Staff here two');
  t3 uuid := tests.thread('Nobody here');
  boss uuid := (select id from characters where staff = 'sp-boss');
  modbot uuid := (select id from characters where staff = 'sp-mod');
  dev uuid := (select id from characters where staff_kind = 'developer');
  general uuid := (select board from threads where id = t1);
  box jsonb;
begin
  if boss is null or modbot is null or dev is null then raise exception 'the seed made no staff characters'; end if;
  -- A staff character's post is the pool's (a later task's writer); the test opens the writer's door as 0048 does.
  perform set_config('kayfabb.staff_writer', 'on', true);
  perform tests.become(ann);
  perform here('thread', t1, a1);
  perform tests.unbecome();

  -- Before any staff post, the persona is in no box.
  if pg_temp.names(pg_temp.look('thread', t1, ann)) is distinct from array[a1] then raise exception 'only the polling player is listed: %', pg_temp.look('thread', t1, ann); end if;

  -- A staff post lists the persona in its thread, flagged staff, and the player not flagged.
  perform tests.post(boss, t1, 'From the Boss.');
  box := pg_temp.look('thread', t1, ann);
  if not (pg_temp.names(box) @> array[boss, a1]) then raise exception 'a staff post lists the persona in its thread: %', box; end if;
  if (select e ->> 'staff' from jsonb_array_elements(box -> 'names') e where (e ->> 'id')::uuid = boss) is distinct from 'true' then raise exception 'the persona is flagged staff: %', box; end if;
  if (select e ->> 'staff' from jsonb_array_elements(box -> 'names') e where (e ->> 'id')::uuid = a1) is distinct from 'false' then raise exception 'a player is not flagged staff: %', box; end if;
  if pg_temp.names(pg_temp.look('thread', t3, ann)) <> '{}' then raise exception 'a thread it did not post in lists nobody'; end if;

  -- A board's box lists it once, though it posted in two threads of the board; and the index never lists staff.
  perform tests.post(boss, t2, 'Again, elsewhere.');
  box := pg_temp.look('board', general, ann);
  if (select count(*) from jsonb_array_elements(box -> 'names') e where (e ->> 'id')::uuid = boss) is distinct from 1 then raise exception 'a board lists a persona once: %', box; end if;
  if (box ->> 'others')::integer is distinct from 0 then raise exception 'a persona counted twice on a board: %', box; end if;
  if pg_temp.names(pg_temp.look('index', null, ann)) @> array[boss] then raise exception 'the index lists no staff'; end if;

  -- A player's post lists no one: a player is listed by its own poll alone. (The developer speaks only through post_update, as an `update` Act
  -- and never a `post`, so no post of it lists it; the view also leaves it out by kind.)
  perform tests.post(a1, t3, 'A player posts.');
  if pg_temp.names(pg_temp.look('thread', t3, ann)) <> '{}' then raise exception 'a player''s post lists no one: %', pg_temp.look('thread', t3, ann); end if;

  -- After the window it is gone: a post 6 minutes old (the window is 5) lists no one; one inside it lists.
  perform tests.post(modbot, t3, 'Old.', now() - interval '6 minutes');
  if pg_temp.names(pg_temp.look('thread', t3, ann)) @> array[modbot] then raise exception 'a persona stays past the window'; end if;
  perform tests.post(modbot, t3, 'Inside.', now() - interval '4 minutes');
  if not (pg_temp.names(pg_temp.look('thread', t3, ann)) @> array[modbot]) then raise exception 'a persona inside the window is listed'; end if;

  -- Longer window: the six-minute post... then back, and a waiting or retired persona is listed nowhere.
  update characters set retired_at = now() where id = modbot;
  if pg_temp.names(pg_temp.look('thread', t3, ann)) @> array[modbot] then raise exception 'a retired persona is listed'; end if;
  update characters set retired_at = null where id = modbot;

  -- Not a private fact: the persona's listing is the same whether or not a player character is polling there.
  box := pg_temp.look('thread', t1, ann);
  delete from presence;
  if pg_temp.names(pg_temp.look('thread', t1, ann)) is distinct from array[boss] or pg_temp.look('thread', t1, ann) -> 'names' -> 0 ->> 'staff' is distinct from 'true' then
    raise exception 'a persona''s listing depends on a player: %', pg_temp.look('thread', t1, ann);
  end if;

  -- The answer's names hold an id, a name and the flag, nothing else.
  if exists (select 1 from jsonb_array_elements(box -> 'names') e
             where (select array_agg(k order by k) from jsonb_object_keys(e) k) is distinct from array['id', 'name', 'staff']) then
    raise exception 'a name holds id, name and staff: %', box;
  end if;
end $$;
