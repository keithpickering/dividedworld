-- The handover (supabase/migrations/0051_succession.sql; the system plan, Task 12b; the seasonal Boss design, sections 2 and 3).
-- A season's roll-over seats the next Boss: the landed, unheld, unended nomination (the latest), else the roster's rotation, skipping the
-- outgoing Boss and the last rosterRecentExcluded ones; a failure of the succession falls back to the rotation and a failure of the rotation
-- leaves the outgoing Boss, and neither stops the reveal or the new season. The new Boss reviews what it inherits: keep (a move_keep), end
-- (superseded), at no cost to the bank; what it never reaches ends by the tick after inheritanceGraceDays. The farewell and the arrival are
-- said once.

-- ---- A seed: four Bosses in a roster, the stock lines, the announcements thread, a day-long season ----
do $$
begin
  perform seed_instance(jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24, 'rosterRecentExcluded', 2, 'inheritanceGraceDays', 3,
      'seasonLength', jsonb_build_object('unit', 'day', 'count', 1),
      'systemLines', jsonb_build_object(
        'moveLanded', jsonb_build_array('Landed: {move}.'),
        'moveSuperseded', jsonb_build_array('Set aside: {move}.'),
        'bossFarewell', jsonb_build_array('Farewell from {boss}.'),
        'bossArrival', jsonb_build_array('Hello from {boss}.')),
      'systemMoveWords', jsonb_build_object('renameBoard', 'the renaming of a board to "{name}"', 'nameSuccessor', 'the naming of a successor')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'su-a',
      'staff', jsonb_build_array(
        jsonb_build_object('key', 'su-a', 'name', 'Su A', 'kind', 'boss', 'title', 'Boss', 'signature', 'a'),
        jsonb_build_object('key', 'su-b', 'name', 'Su B', 'kind', 'boss', 'title', 'Boss', 'signature', 'b'),
        jsonb_build_object('key', 'su-c', 'name', 'Su C', 'kind', 'boss', 'title', 'Boss', 'signature', 'c'),
        jsonb_build_object('key', 'su-d', 'name', 'Su D', 'kind', 'boss', 'title', 'Boss', 'signature', 'd')),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(jsonb_build_object('key', 'renameBoard', 'structural', true, 'shapesBoard', true), jsonb_build_object('key', 'nameSuccessor', 'structural', true)),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard')))));
  insert into admins (account) values (tests.account('su-admin'));
  perform tests.account('su-player');
  -- The seed's roster order is the rotation's.
  if (select value from settings where key = 'bossRoster') is distinct from '["su-a", "su-b", "su-c", "su-d"]'::jsonb then raise exception 'the seed did not persist the roster order: %', (select value from settings where key = 'bossRoster'); end if;
  if not (select shapes_board from move_kinds where key = 'renameBoard') or (select shapes_board from move_kinds where key = 'nameSuccessor') then raise exception 'shapes_board was not seeded'; end if;
  -- The season begins long ago, so that a day-long season rolls over many times without touching the present.
  update seasons set starts_at = now() - interval '60 days' where ends_at is null;
end $$;

create function pg_temp.ann() returns uuid language sql as $$ select (value #>> '{}')::uuid from settings where key = 'systemAnnouncements' $$;
create function pg_temp.boss() returns text language sql as $$ select boss from seasons where ends_at is null $$;
-- Rolls the open season over, at the end its length gives it.
create function pg_temp.roll() returns jsonb language sql as $$
  select reveal_season((select starts_at from seasons where ends_at is null) + interval '1 day')
$$;
create function pg_temp.meeting() returns bigint language sql as $$
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id
$$;
-- A nomination waiting to land, due now.
create function pg_temp.queue_nomination(from_staff text, to_staff text) returns bigint language sql as $$
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (pg_temp.meeting(), from_staff, 'nameSuccessor', jsonb_build_object('boss', to_staff), null, 'because', now() - interval '1 hour', null, true) returning id
$$;
-- A move of a Boss landed at a given time (an Act written in the past, as the tick would have in its day).
create function pg_temp.land(by_staff text, kind text, params jsonb, at timestamptz) returns uuid language plpgsql as $$
declare
  written uuid;
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, payload, created_at)
  values ((select c.id from characters c where c.staff = by_staff), 'move', pg_temp.ann(), jsonb_build_object('kind', kind, 'params', params, 'body', 'landed'), at) returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  return written;
end $$;
create function pg_temp.rename(by_staff text, new_name text, at timestamptz) returns uuid language sql as $$
  select pg_temp.land(by_staff, 'renameBoard', jsonb_build_object('board', (select id from boards where slug = 'general'), 'name', new_name, 'premise', 'p', 'description', 'd'), at)
$$;
create function pg_temp.posts_by(speaker text, body text) returns bigint language sql as $$
  select count(*) from acts a join characters c on c.id = a.character where c.staff = speaker and a.kind = 'post' and a.payload ->> 'body' = body
$$;

-- ---- A held nomination leaves the rotation to choose ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'su-admin@test.invalid');
  q bigint;
  ran jsonb;
  hand season_handovers%rowtype;
begin
  if pg_temp.boss() is distinct from 'su-a' then raise exception 'the first season has the seed''s first Boss, not %', pg_temp.boss(); end if;
  -- Re-naming the Boss a nomination already names is refused in plain words, never a raw guard error.
  q := pg_temp.queue_nomination('su-a', 'su-c');
  perform tests.become(admin);
  begin
    perform replace_successor(q, 'su-c');
    raise exception 'a nomination was replaced with the Boss it already names';
  exception when others then
    if sqlstate is distinct from '55000' or sqlerrm is distinct from 'that Boss is already the one named' then raise exception 'naming the same Boss again answered % %', sqlstate, sqlerrm; end if;
  end;
  -- Held, so this nomination never lands and the handover below is the rotation's alone.
  perform hold_move(q);
  perform tests.unbecome();
  q := pg_temp.queue_nomination('su-a', 'su-c');
  perform tests.become(admin); perform hold_move(q); perform tests.unbecome();
  -- A held nomination is no one's to replace: the refusal is the plain 55000, in its own words.
  perform tests.become(admin);
  begin
    perform replace_successor(q, 'su-d');
    raise exception 'a held nomination was replaced';
  exception when others then
    if sqlstate is distinct from '55000' or sqlerrm is distinct from 'that nomination is held' then raise exception 'replacing a held nomination answered % %', sqlstate, sqlerrm; end if;
  end;
  perform tests.unbecome();
  perform system_tick();
  if (select landed_act from queued_moves where id = q) is not null then raise exception 'a held nomination landed'; end if;
  ran := pg_temp.roll();
  if ran is null then raise exception 'the season did not roll over'; end if;
  if pg_temp.boss() is distinct from 'su-b' then raise exception 'a held nomination did not leave the rotation to choose su-b, the next in the roster: %', pg_temp.boss(); end if;
  select * into hand from season_handovers where season = (select id from seasons where ends_at is null);
  if hand.how is distinct from 'rotation' or hand.outgoing is distinct from 'su-a' then raise exception 'the handover recorded %', to_jsonb(hand); end if;
  -- The reveal and the new season are there.
  if not exists (select 1 from seasons where number = 1 and ends_at is not null and reveal_act is not null) then raise exception 'the season was not revealed'; end if;
  -- The farewell and the arrival, said once, each by its own Boss; and the arriving Boss starts at zero.
  if pg_temp.posts_by('su-a', 'Farewell from Su A.') is distinct from 1::bigint then raise exception 'the farewell was said % times', pg_temp.posts_by('su-a', 'Farewell from Su A.'); end if;
  if pg_temp.posts_by('su-b', 'Hello from Su B.') is distinct from 1::bigint then raise exception 'the arrival was said % times', pg_temp.posts_by('su-b', 'Hello from Su B.'); end if;
  if (select balance from move_bank where staff = 'su-b') is distinct from 0::numeric then raise exception 'an arriving Boss did not start at zero'; end if;
  perform system_tick(); perform system_tick();
  if pg_temp.posts_by('su-b', 'Hello from Su B.') is distinct from 1::bigint then raise exception 'a tick said the arrival again'; end if;
  if (select landed_act from queued_moves where id = q) is not null then raise exception 'a held nomination landed after the handover'; end if;
end $$;

-- ---- A replaced nomination names the admin's Boss ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'su-admin@test.invalid');
  player uuid := (select id from auth.users where email = 'su-player@test.invalid');
  q bigint;
  denied boolean;
  mv uuid;
  qj jsonb;
  row_j jsonb;
begin
  q := pg_temp.queue_nomination('su-b', 'su-c');
  -- A player cannot replace; the nominee must be a roster Boss that is not the nominating one; one that is not a nomination is no target.
  denied := false;
  perform tests.become(player);
  begin perform replace_successor(q, 'su-d'); exception when insufficient_privilege then denied := true; end;
  perform tests.unbecome();
  if not denied then raise exception 'a player replaced a successor'; end if;
  perform tests.become(admin);
  denied := false; begin perform replace_successor(q, 'nobody'); exception when sqlstate '22023' then denied := true; end;
  if not denied then raise exception 'a successor was replaced with a name that is no Boss'; end if;
  denied := false; begin perform replace_successor(q, 'su-b'); exception when sqlstate '22023' then denied := true; end;
  if not denied then raise exception 'a Boss was put in place of its own successor'; end if;
  perform tests.unbecome();
  if (select params ->> 'boss' from queued_moves where id = q) is distinct from 'su-c' then raise exception 'a refused replacement changed the nomination'; end if;
  if (select replaced_by is not null or replaced_at is not null from queued_moves where id = q) then raise exception 'an unreplaced nomination has a replacement on record'; end if;
  perform tests.become(admin);
  perform replace_successor(q, 'su-d');
  -- The queue shows when it was replaced and nobody's account; its roster offers the Bosses that can take the seat (not retired, debuted).
  qj := admin_queue();
  perform tests.unbecome();
  if (select params ->> 'boss' from queued_moves where id = q) is distinct from 'su-d' then raise exception 'the nomination was not replaced'; end if;
  if (select replaced_by from queued_moves where id = q) is distinct from admin or (select replaced_at from queued_moves where id = q) is null then raise exception 'the replacement was not recorded'; end if;
  row_j := (select e from jsonb_array_elements(qj -> 'waiting') e where (e ->> 'id')::bigint = q);
  if row_j -> 'replacedAt' is null or jsonb_typeof(row_j -> 'replacedAt') <> 'string' or row_j ? 'replacedBy' or row_j::text like '%' || admin::text || '%' then raise exception 'the queue shows the replacement as %', row_j; end if;
  if (select jsonb_agg(r ->> 'staff' order by ord) from jsonb_array_elements(qj -> 'roster') with ordinality x(r, ord)) is distinct from '["su-a", "su-b", "su-c", "su-d"]'::jsonb then raise exception 'the queue offered the roster %', qj -> 'roster'; end if;
  update characters set retired_at = now() where staff = 'su-c';
  update characters set debuted_at = null where staff = 'su-b';
  perform tests.become(admin); qj := admin_queue(); perform tests.unbecome();
  update characters set retired_at = null where staff = 'su-c';
  update characters set debuted_at = now() where staff = 'su-b';
  if (select jsonb_agg(r ->> 'staff' order by ord) from jsonb_array_elements(qj -> 'roster') with ordinality x(r, ord)) is distinct from '["su-a", "su-d"]'::jsonb then raise exception 'the queue offered a retired or undebuted Boss: %', qj -> 'roster'; end if;
  if has_column_privilege('authenticated', 'queued_moves', 'replaced_by', 'select') or has_column_privilege('authenticated', 'queued_moves', 'replaced_at', 'select')
     or has_column_privilege('anon', 'queued_moves', 'replaced_by', 'select') or has_column_privilege('kayfabb_digest', 'queued_moves', 'replaced_by', 'select')
     or has_column_privilege('kayfabb_digest', 'queued_moves', 'replaced_at', 'select') then raise exception 'a client or the digest reads who replaced a nomination'; end if;
  -- The record of a replacement changes only with the Boss it replaces; it is not editable on its own.
  denied := false; begin update queued_moves set replaced_at = null where id = q; exception when check_violation then denied := true; end;
  if not denied then raise exception 'a replacement record was erased on its own'; end if;
  -- Nothing but the Boss of a waiting nomination changes: the guard refuses a rename of anything else.
  denied := false; begin update queued_moves set params = params || '{"extra": 1}' where id = q; exception when check_violation then denied := true; end;
  if not denied then raise exception 'a nomination''s other params changed'; end if;
  denied := false; begin update queued_moves set why = 'something else' where id = q; exception when check_violation then denied := true; end;
  if not denied then raise exception 'a nomination''s why changed'; end if;
  -- It lands as the replaced Boss, and a landed nomination can no longer be replaced.
  perform system_tick();
  mv := (select landed_act from queued_moves where id = q);
  if mv is null then raise exception 'the nomination did not land'; end if;
  if (select a.payload #>> '{params,boss}' from acts a where a.id = mv) is distinct from 'su-d' then raise exception 'the nomination landed naming %', (select a.payload #>> '{params,boss}' from acts a where a.id = mv); end if;
  perform tests.become(admin);
  denied := false; begin perform replace_successor(q, 'su-a'); exception when sqlstate '55000' then denied := true; end;
  perform tests.unbecome();
  if not denied then raise exception 'a landed nomination was replaced'; end if;
  -- A nomination has no demand to check and no expiry: the tick never ends it.
  perform system_tick();
  if exists (select 1 from acts where kind = 'move_end' and target_act_id = mv) then raise exception 'the tick ended a nomination'; end if;
  perform pg_temp.roll();
  if pg_temp.boss() is distinct from 'su-d' then raise exception 'the nominated Boss did not arrive: %', pg_temp.boss(); end if;
  if (select how from season_handovers where season = (select id from seasons where ends_at is null)) is distinct from 'nomination' then raise exception 'the handover was not recorded as a nomination'; end if;
  -- Spent at the handover.
  if (select e.payload from acts e where e.kind = 'move_end' and e.target_act_id = mv) is distinct from jsonb_build_object('why', 'spent', 'by', 'handover') then
    raise exception 'the nomination was not spent at the handover: %', (select e.payload from acts e where e.kind = 'move_end' and e.target_act_id = mv);
  end if;
  if pg_temp.posts_by('su-d', 'Hello from Su D.') is distinct from 1::bigint then raise exception 'the nominated Boss''s arrival was not said once'; end if;
end $$;

-- ---- The latest of two landed nominations wins; an ended one is not a nomination ----
do $$
declare
  n1 bigint; n2 bigint; n3 bigint;
  a1 uuid; a2 uuid; a3 uuid;
begin
  -- su-d is the Boss. Two landed nominations: the later wins; a third, reversed by an admin, is not counted whatever its time.
  a1 := pg_temp.land('su-d', 'nameSuccessor', '{"boss": "su-a"}', now() - interval '3 hours');
  a2 := pg_temp.land('su-d', 'nameSuccessor', '{"boss": "su-c"}', now() - interval '2 hours');
  a3 := pg_temp.land('su-d', 'nameSuccessor', '{"boss": "su-b"}', now() - interval '1 hour');
  n1 := pg_temp.queue_nomination('su-d', 'su-a'); n2 := pg_temp.queue_nomination('su-d', 'su-c'); n3 := pg_temp.queue_nomination('su-d', 'su-b');
  update queued_moves set landed_act = a1 where id = n1;
  update queued_moves set landed_act = a2 where id = n2;
  update queued_moves set landed_act = a3 where id = n3;
  perform end_move(a3, 'reversed', 'admin');
  if nominated_boss('su-d') is distinct from 'su-c' then raise exception 'the latest standing nomination did not win: %', nominated_boss('su-d'); end if;
  perform pg_temp.roll();
  if pg_temp.boss() is distinct from 'su-c' then raise exception 'the season opened under %', pg_temp.boss(); end if;
  if exists (select 1 from open_moves o join acts a on a.id = o.move_act where a.payload ->> 'kind' = 'nameSuccessor') then raise exception 'a nomination outlived the handover'; end if;
end $$;

-- ---- The rotation skips the outgoing Boss and the last rosterRecentExcluded Bosses ----
do $$
begin
  -- su-c is the Boss, of season 4. The seasons that ended held su-a, su-b and su-d, in that order.
  -- Three recent excluded: the one just ended (su-c), su-d and su-b. The draw runs from the Boss after su-c: su-d is recent and skipped, su-a is free.
  update settings set value = '3' where key = 'rosterRecentExcluded';
  perform pg_temp.roll();
  if pg_temp.boss() is distinct from 'su-a' then raise exception 'the rotation chose % after su-c, with su-c, su-d and su-b recent (su-d is next, and skipped)', pg_temp.boss(); end if;
  -- With every Boss recent the exclusion is dropped and only the outgoing Boss stays out: the one after su-a.
  update settings set value = '12' where key = 'rosterRecentExcluded';
  perform pg_temp.roll();
  if pg_temp.boss() is distinct from 'su-b' then raise exception 'with every Boss recent the rotation chose % (the one after the outgoing Boss su-a)', pg_temp.boss(); end if;
  -- The usual exclusion of two: su-b out, su-b and su-a recent, su-c is next and free.
  update settings set value = '2' where key = 'rosterRecentExcluded';
  perform pg_temp.roll();
  if pg_temp.boss() is distinct from 'su-c' then raise exception 'the rotation chose % after su-b', pg_temp.boss(); end if;
  -- The outgoing Boss is never the draw, whatever is excluded.
  if rotation_boss('su-c') is not distinct from 'su-c' then raise exception 'the rotation chose the outgoing Boss'; end if;
  update settings set value = '0' where key = 'rosterRecentExcluded';
  if rotation_boss('su-d') is distinct from 'su-a' then raise exception 'with none excluded the rotation chose % after su-d', rotation_boss('su-d'); end if;
  update settings set value = '2' where key = 'rosterRecentExcluded';
end $$;

-- ---- The inheritance review: keep, end, or leave it; no bank; the grace; the successor answer ----
create function pg_temp.payload(inherited jsonb, successor jsonb default null) returns jsonb language sql as $$
  select jsonb_build_object('boss', pg_temp.boss(), 'weekly_moves', 5, 'bank_cap', 10,
    'memory', jsonb_build_object('hobby', jsonb_build_object('name', 'pie', 'since', 'today', 'from', 'a friend'), 'opinions', '[]'::jsonb, 'grudges', '[]'::jsonb,
      'wheelhouse', '[]'::jsonb, 'realWorld', '[]'::jsonb, 'marks', '[]'::jsonb),
    'profile', jsonb_build_object('interests', jsonb_build_array('pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'It is decided.'),
    'moves', '[]'::jsonb, 'inherited', inherited, 'record', '{}'::jsonb)
  || case when successor is null then '{}'::jsonb else jsonb_build_object('successor', successor) end
$$;
do $$
declare
  new_boss text := pg_temp.boss();
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; nom uuid;
  meet bigint;
  ctx jsonb;
  rec jsonb;
  denied boolean;
  mt meetings%rowtype;
  q queued_moves%rowtype;
  keep_act uuid;
begin
  -- su-a wrote three renames before the handover and a fourth after it, and a nomination; the Boss now is another.
  if new_boss is not distinct from 'su-a' then raise exception 'the test needs a Boss other than su-a'; end if;
  m1 := pg_temp.rename('su-a', 'Kept Keep', now() - interval '56 days');
  m2 := pg_temp.rename('su-a', 'Ended End', now() - interval '56 days');
  m3 := pg_temp.rename('su-a', 'Forgotten Fen', now() - interval '56 days');
  m4 := pg_temp.rename('su-a', 'Late Lane', now());
  nom := pg_temp.land('su-a', 'nameSuccessor', '{"boss": "su-b"}', now() - interval '56 days');
  insert into move_bank (staff, balance, as_of) values (new_boss, 2, now()) on conflict (staff) do update set balance = 2, as_of = now();

  -- The meeting reads the moves it inherited: renames only, with the Boss that wrote them; the nomination shapes no board.
  ctx := meeting_context();
  if jsonb_array_length(ctx -> 'inheritanceDue') is distinct from 4 then raise exception 'the meeting was handed % inherited moves: %', jsonb_array_length(ctx -> 'inheritanceDue'), ctx -> 'inheritanceDue'; end if;
  if exists (select 1 from jsonb_array_elements(ctx -> 'inheritanceDue') e where e ->> 'kind' <> 'renameBoard' or e ->> 'by' <> 'Su A') then raise exception 'the inherited moves were %', ctx -> 'inheritanceDue'; end if;
  if (select e ->> 'boardName' from jsonb_array_elements(ctx -> 'inheritanceDue') e where e ->> 'act' = m1::text) is distinct from 'General' then raise exception 'the inherited rename did not carry its board''s own name'; end if;

  -- The answer: keep one, end one, and three that are not due (an unknown move, a nomination, a second word on the one kept).
  meet := (begin_meeting(clock_timestamp()) ->> 'meeting')::bigint;
  perform apply_meeting(meet, pg_temp.payload(jsonb_build_array(
    jsonb_build_object('move_act', m1, 'decision', 'keep'), jsonb_build_object('move_act', m2, 'decision', 'end'),
    jsonb_build_object('move_act', gen_random_uuid(), 'decision', 'keep'), jsonb_build_object('move_act', nom, 'decision', 'end'),
    jsonb_build_object('move_act', m1, 'decision', 'end'),
    -- a move named by something that is no uuid, and a move named with no decision at all: both skipped, neither ends the move.
    jsonb_build_object('move_act', 'not-a-uuid', 'decision', 'keep'), jsonb_build_object('move_act', m3))));
  select * into mt from meetings where id = meet;
  if mt.outcome is distinct from 'ok' then raise exception 'the meeting did not close ok'; end if;
  if exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = m3) or not exists (select 1 from open_moves where move_act = m3) then raise exception 'an answer with no decision ended the move'; end if;
  if mt.bank_after is distinct from mt.bank_before then raise exception 'reviewing cost the bank: % to %', mt.bank_before, mt.bank_after; end if;
  if (select balance from move_bank where staff = new_boss) is distinct from mt.bank_before then raise exception 'the bank changed by reviewing'; end if;
  if mt.record -> 'handover' is distinct from jsonb_build_object('kept', 1, 'ended', 1, 'skipped', 5, 'nominated', false) then raise exception 'the meeting recorded the handover as %', mt.record -> 'handover'; end if;

  select k.id into keep_act from acts k where k.kind = 'move_keep' and k.target_act_id = m1;
  if keep_act is null or (select c.staff from acts k join characters c on c.id = k.character where k.id = keep_act) is distinct from new_boss then raise exception 'the kept move has no move_keep by the new Boss'; end if;
  if not exists (select 1 from open_moves where move_act = m1) then raise exception 'a kept move ended'; end if;
  if move_owner(m1) is distinct from new_boss then raise exception 'a kept move is not its keeper''s own'; end if;
  if (select e.payload from acts e where e.kind = 'move_end' and e.target_act_id = m2) is distinct from jsonb_build_object('why', 'superseded', 'by', 'boss') then
    raise exception 'the ended move was recorded as %', (select e.payload from acts e where e.kind = 'move_end' and e.target_act_id = m2);
  end if;
  if exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = nom) then raise exception 'an answer ended a move that was not due (the nomination)'; end if;
  if pg_temp.posts_by(new_boss, 'Set aside: the renaming of a board to "Ended End".') is distinct from 1::bigint then raise exception 'the new Boss did not say the set-aside once'; end if;
  if (select array_agg(d.act order by d.landed_at, d.act) from inheritance_due(new_boss) d) is distinct from (select array_agg(x order by a.created_at, x) from unnest(array[m3, m4]) x join acts a on a.id = x) then
    raise exception 'what was left to review was not the forgotten move and the late one';
  end if;

  -- The log: the kept move says who keeps it, the set-aside one says how it ended.
  if (select kept_by from moves_log where id = m1) is distinct from new_boss then raise exception 'the log does not say who kept the move'; end if;
  if (select ended_why from moves_log where id = m2) is distinct from 'superseded' then raise exception 'the log does not say the move was set aside'; end if;

  -- A keep is the season's Boss's, of a move in force that is not already its own.
  denied := false; begin perform write_staff_act(new_boss, 'move_keep', pg_temp.ann(), m1, '{}'); exception when sqlstate '55000' then denied := true; end;
  if not denied then raise exception 'a Boss kept its own move'; end if;
  denied := false; begin perform write_staff_act(new_boss, 'move_keep', pg_temp.ann(), m2, '{}'); exception when sqlstate '55000' then denied := true; end;
  if not denied then raise exception 'a move that had ended was kept'; end if;
  denied := false; begin perform write_staff_act('su-a', 'move_keep', pg_temp.ann(), m4, '{}'); exception when sqlstate '42501' then denied := true; end;
  if not denied then raise exception 'a Boss that is not the season''s kept a move'; end if;

  -- The tick: the forgotten move ends superseded (landed and handed over long ago), the late one has its grace, the kept one stays, and the
  -- nomination is spent. Twice changes nothing.
  perform system_tick(); perform system_tick();
  if (select e.payload from acts e where e.kind = 'move_end' and e.target_act_id = m3) is distinct from jsonb_build_object('why', 'superseded', 'by', 'inheritance') then
    raise exception 'the forgotten move was not superseded by the tick: %', (select e.payload from acts e where e.kind = 'move_end' and e.target_act_id = m3);
  end if;
  if not exists (select 1 from open_moves where move_act = m1) then raise exception 'the tick ended a kept move'; end if;
  if not exists (select 1 from open_moves where move_act = m4) then raise exception 'the tick ended a move before its grace'; end if;
  if (select e.payload ->> 'why' from acts e where e.kind = 'move_end' and e.target_act_id = nom) is distinct from 'spent' then raise exception 'a stale nomination was not spent by the tick'; end if;
  if (select count(*) from acts e where e.kind = 'move_end' and e.target_act_id in (m1, m2, m3, m4, nom)) is distinct from 3::bigint then raise exception 'the tick wrote an end twice or ended the wrong ones'; end if;
  if pg_temp.posts_by(new_boss, 'Set aside: the renaming of a board to "Forgotten Fen".') is distinct from 1::bigint then raise exception 'the forgotten move''s set-aside was not said once'; end if;

  -- Its grace is counted from the handover or its landing, whichever is later: a move landed three days ago and not reviewed ends.
  m4 := pg_temp.rename('su-a', 'Old Oak', now() - interval '4 days');
  perform system_tick();
  if (select e.payload ->> 'why' from acts e where e.kind = 'move_end' and e.target_act_id = m4) is distinct from 'superseded' then raise exception 'a move past its grace did not end'; end if;

  -- The successor answer: queued, held at least the structural hold, costing nothing; the Boss itself and a stranger are dropped.
  meet := (begin_meeting(clock_timestamp()) ->> 'meeting')::bigint;
  perform apply_meeting(meet, pg_temp.payload('[]', jsonb_build_object('boss', 'su-b', 'why', 'It likes pie.')));
  select * into q from queued_moves where meeting = meet;
  if q.kind is distinct from 'nameSuccessor' or q.params is distinct from '{"boss": "su-b"}'::jsonb or q.demand is not null or q.expires_at is not null or q.structural is not true or q.why is distinct from 'It likes pie.' or q.staff is distinct from new_boss then
    raise exception 'the successor was queued as %', to_jsonb(q);
  end if;
  if q.go_live_at < now() + interval '24 hours' then raise exception 'a nomination was not held for the structural hold'; end if;
  select * into mt from meetings where id = meet;
  if mt.bank_after is distinct from mt.bank_before then raise exception 'naming a successor cost the bank'; end if;
  if mt.record -> 'handover' is distinct from jsonb_build_object('kept', 0, 'ended', 0, 'skipped', 0, 'nominated', true) then raise exception 'the nomination was recorded as %', mt.record -> 'handover'; end if;
  meet := (begin_meeting(clock_timestamp()) ->> 'meeting')::bigint;
  perform apply_meeting(meet, pg_temp.payload('[]', jsonb_build_object('boss', new_boss, 'why', 'Me.')));
  if exists (select 1 from queued_moves where meeting = meet) then raise exception 'a Boss named itself its successor'; end if;
  meet := (begin_meeting(clock_timestamp()) ->> 'meeting')::bigint;
  perform apply_meeting(meet, pg_temp.payload('[]', jsonb_build_object('boss', 'nobody', 'why', 'Who.')));
  if exists (select 1 from queued_moves where meeting = meet) then raise exception 'a stranger was named a successor'; end if;
  if (select record -> 'handover' ->> 'skipped' from meetings where id = meet) is distinct from '1' then raise exception 'a dropped successor was not recorded'; end if;
  -- The queue refuses a nomination with a demand or an expiry, whatever wrote it.
  denied := false;
  begin
    insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
    values (pg_temp.meeting(), new_boss, 'nameSuccessor', '{"boss": "su-b"}', null, 'x', now(), now() + interval '1 day', true);
  exception when check_violation then denied := true; end;
  if not denied then raise exception 'a nomination was queued with an expiry'; end if;
end $$;

-- ---- A Boss can keep a move again: A wrote it, B kept it, A returned and kept it, and B returns and keeps it ----
create function pg_temp.hand_to(next_boss text) returns void language plpgsql as $$
declare
  n bigint;
begin
  n := pg_temp.queue_nomination(pg_temp.boss(), next_boss);
  update queued_moves set landed_act = pg_temp.land(pg_temp.boss(), 'nameSuccessor', jsonb_build_object('boss', next_boss), now() - interval '1 hour') where id = n;
  perform pg_temp.roll();
  if pg_temp.boss() is distinct from next_boss then raise exception 'the nominated Boss % did not arrive: %', next_boss, pg_temp.boss(); end if;
end $$;
-- A keep written in the past, as a Boss's meeting would have in its day (a transaction has one now(), so the order needs its own times).
create function pg_temp.keep_at(boss text, move uuid, at timestamptz) returns void language plpgsql as $$
begin
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  values ((select c.id from characters c where c.staff = boss), 'move_keep', pg_temp.ann(), move, '{}', at);
  perform set_config('kayfabb.staff_writer', '', true);
end $$;
do $$
declare
  a text := pg_temp.boss();
  b text := case when pg_temp.boss() = 'su-c' then 'su-d' else 'su-c' end;
  m uuid;
  meet bigint;
  mt meetings%rowtype;
  log moves_log%rowtype;
begin
  m := pg_temp.rename(a, 'Round Trip', now() - interval '56 days');
  insert into move_bank (staff, balance, as_of) values (a, 2, now()), (b, 2, now()) on conflict (staff) do update set balance = 2, as_of = now();
  -- A wrote it; B comes and keeps it; A comes back and keeps it.
  perform pg_temp.hand_to(b);
  perform pg_temp.keep_at(b, m, now() - interval '3 days');
  if move_owner(m) is distinct from b then raise exception 'the first keeper does not own the move'; end if;
  perform pg_temp.hand_to(a);
  perform pg_temp.keep_at(a, m, now() - interval '2 days');
  if move_owner(m) is distinct from a then raise exception 'the returning writer does not own the move'; end if;
  -- B returns: the move is due for B again, and B keeps it a second time.
  perform pg_temp.hand_to(b);
  if not exists (select 1 from inheritance_due(b) d where d.act = m) then raise exception 'the move is not due for the returning Boss'; end if;
  meet := (begin_meeting(clock_timestamp()) ->> 'meeting')::bigint;
  perform apply_meeting(meet, pg_temp.payload(jsonb_build_array(jsonb_build_object('move_act', m, 'decision', 'keep'))));
  select * into mt from meetings where id = meet;
  if mt.outcome is distinct from 'ok' then raise exception 'the meeting of the Boss keeping a move a second time did not close ok: %', mt.outcome; end if;
  if mt.record -> 'handover' is distinct from jsonb_build_object('kept', 1, 'ended', 0, 'skipped', 0, 'nominated', false) then raise exception 'the second keep was recorded as %', mt.record -> 'handover'; end if;
  if (select count(*) from acts k join characters c on c.id = k.character where k.kind = 'move_keep' and k.target_act_id = m and c.staff = b) is distinct from 2::bigint then raise exception 'the Boss does not have two keeps of the move'; end if;
  if move_owner(m) is distinct from b then raise exception 'the Boss that kept the move last does not own it: %', move_owner(m); end if;
  -- The log shows the latest keeper, and when.
  select * into log from moves_log where id = m;
  if log.kept_by is distinct from b or log.kept_at is distinct from (select max(k.created_at) from acts k where k.kind = 'move_keep' and k.target_act_id = m) then
    raise exception 'the log does not show the latest keeper: %', to_jsonb(log);
  end if;
  if log.staff is distinct from a then raise exception 'the log lost the move''s writer'; end if;
  -- Still once at a time: the owner cannot keep it again, and a retried meeting writes nothing more.
  begin perform write_staff_act(b, 'move_keep', pg_temp.ann(), m, '{}'); raise exception 'a Boss kept its own move again';
  exception when sqlstate '55000' then null; end;
  perform apply_meeting(meet, pg_temp.payload(jsonb_build_array(jsonb_build_object('move_act', m, 'decision', 'keep'))));
  if (select count(*) from acts k where k.kind = 'move_keep' and k.target_act_id = m) is distinct from 3::bigint then raise exception 'a retried meeting wrote a keep again'; end if;
end $$;

-- ---- A succession that fails still opens the season and shows the reveal ----
do $$
declare
  nominee_move uuid;
  outgoing text := pg_temp.boss();
  nominee text := case when pg_temp.boss() = 'su-b' then 'su-a' else 'su-b' end;
  before_number integer := (select number from seasons where ends_at is null);
  h season_handovers%rowtype;
begin
  -- A landed, unheld nomination of a Boss whose character was retired meanwhile cannot seat: the rotation chooses, and the season opens.
  nominee_move := pg_temp.land(outgoing, 'nameSuccessor', jsonb_build_object('boss', nominee), now() - interval '1 hour');
  update queued_moves set landed_act = nominee_move where id = pg_temp.queue_nomination(outgoing, nominee);
  update characters set retired_at = now() where staff = nominee;
  perform pg_temp.roll();
  if (select number from seasons where ends_at is null) is distinct from before_number + 1 then raise exception 'the new season did not open'; end if;
  if not exists (select 1 from seasons where number = before_number and reveal_act is not null) then raise exception 'the reveal did not happen'; end if;
  select * into h from season_handovers where season = (select id from seasons where ends_at is null);
  if h.how is distinct from 'rotation' or h.boss is not distinct from nominee or h.boss is null or h.note not like 'the nomination did not seat%' then raise exception 'the failed succession was recorded as %', to_jsonb(h); end if;

  -- A rotation with nobody to rotate to leaves the season with the outgoing Boss; the reveal and the new season still happen.
  outgoing := pg_temp.boss();
  before_number := (select number from seasons where ends_at is null);
  update characters set retired_at = now() where staff_kind = 'boss' and staff <> outgoing;
  perform pg_temp.roll();
  if (select number from seasons where ends_at is null) is distinct from before_number + 1 then raise exception 'the new season did not open when the rotation had nobody'; end if;
  if pg_temp.boss() is distinct from outgoing then raise exception 'the season did not keep the outgoing Boss: %', pg_temp.boss(); end if;
  select * into h from season_handovers where season = (select id from seasons where ends_at is null);
  if h.how is distinct from 'unchanged' or h.note not like '%the rotation did not choose%' then raise exception 'the failed rotation was recorded as %', to_jsonb(h); end if;
  if not exists (select 1 from seasons where number = before_number and reveal_act is not null) then raise exception 'the reveal did not happen when the rotation failed'; end if;

  -- Even the handover itself failing stops neither: the season keeps the outgoing Boss.
  update characters set retired_at = null where staff_kind = 'boss';
  before_number := (select number from seasons where ends_at is null);
  create or replace function hand_over(new_season bigint, outgoing text, at timestamptz) returns jsonb language plpgsql as $f$
  begin raise exception 'boom'; end $f$;
  perform pg_temp.roll();
  if (select number from seasons where ends_at is null) is distinct from before_number + 1 then raise exception 'the new season did not open when the handover raised'; end if;
  if pg_temp.boss() is distinct from outgoing then raise exception 'the season did not keep the outgoing Boss when the handover raised: %', pg_temp.boss(); end if;
  if (select note from season_handovers where season = (select id from seasons where ends_at is null)) not like 'the handover failed: boom%' then raise exception 'the raised handover was not recorded'; end if;
  if not exists (select 1 from seasons where number = before_number and reveal_act is not null) then raise exception 'the reveal did not happen when the handover raised'; end if;
end $$;

-- ---- The review is capped: inheritance_due at the cap it is given, the meeting's context at 20 ----
do $$
declare
  boss text := pg_temp.boss();
  other text := (select staff from characters where staff_kind = 'boss' and staff is distinct from pg_temp.boss() order by staff limit 1);
  n integer;
begin
  for i in 1..22 loop perform pg_temp.rename(other, 'Capped ' || i, now() - interval '50 days'); end loop;
  select count(*) into n from inheritance_due(boss, 2);
  if n is distinct from 2 then raise exception 'inheritance_due(boss, 2) returned % moves', n; end if;
  select count(*) into n from inheritance_due(boss, 100);
  if n < 22 then raise exception 'the uncapped review should hold the 22 new moves, held %', n; end if;
  n := jsonb_array_length(meeting_context() -> 'inheritanceDue');
  if n is distinct from 20 then raise exception 'the meeting was handed % inherited moves, not at most 20', n; end if;
end $$;

-- ---- The handover is nobody's to call ----
do $$
begin
  if has_function_privilege('authenticated', 'hand_over(bigint,text,timestamptz)', 'execute') or has_function_privilege('anon', 'hand_over(bigint,text,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'inheritance_due(text,integer)', 'execute') or has_function_privilege('authenticated', 'rotation_boss(text)', 'execute')
     or has_function_privilege('authenticated', 'nominated_boss(text)', 'execute') or has_function_privilege('authenticated', 'move_owner(uuid)', 'execute') then
    raise exception 'a client can call the handover''s internals';
  end if;
  if not has_function_privilege('authenticated', 'replace_successor(bigint,text)', 'execute') or has_function_privilege('anon', 'replace_successor(bigint,text)', 'execute') then raise exception 'replace_successor is not the web client''s alone'; end if;
  if has_table_privilege('authenticated', 'season_handovers', 'select') or has_table_privilege('anon', 'season_handovers', 'select') then raise exception 'a client reads the handover record'; end if;
end $$;
