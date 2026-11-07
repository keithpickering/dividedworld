-- The Boss's three moves on the machine (supabase/migrations/0117_machine_moves.sql; docs/plans/2026-11-04-booster-packs-plan.md, Task 4).
--
-- 1. A Pull shows its slot sold out in machine_now, and the slot comes back at its expiry, when its demand is met, and when an admin reverses it.
--    (Poison: machine_now ignoring whether a move has ended. The test is red on "a slot is back" when the view reads every move Act and not the ones in force.)
-- 2. The limits, in SQL: the queue's guard refuses what the params, the demand and the economy's bounds forbid; the tick refuses, for good and with the reason, a move
--    the machine can no longer take at landing: a card in no pack on sale, a slot not on sale, a pull too many, a second move on a slot, a second flash sale.
-- 3. A markup during an admin's price change reads the new price times the factor; a price is never below 1; an admin's sold out or hidden wins over a Pull and a Reprice.
-- 4. A flash sale lists a hidden slot and hides it again after.
-- 5. The masks: machine_now is the same for every caller, the move helper view is not a client's, and the machine costs the slots, never the purchases.
-- 6. The meeting reads the slots (hidden ones too), whether a pull could land and the Boss's moves in force, and no purchase.

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

create function pg_temp.ann() returns uuid language sql as $$ select id from auth.users where email = 'mv-ann@test.invalid' $$;
create function pg_temp.announcements() returns uuid language sql as $$
  select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements'
$$;

-- ---- 0. The world: a Boss, cards of three rarities, packs, and slots of each availability ----
do $$
declare
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'economy', jsonb_build_object('machine.pullMost', 2, 'machine.moveDaysMost', 7, 'machine.repriceLeast', 50, 'machine.repriceMost', 200, 'machine.flashHoursLeast', 24, 'machine.flashHoursMost', 48),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'moveMet', jsonb_build_array('Met: {move}.'), 'moveExpired', jsonb_build_array('Expired: {move}.')),
      'systemMoveWords', jsonb_build_object('pullSlot', 'the pulling of a card from the machine', 'repriceSlot', 'the repricing of a slot at the machine', 'flashSale', 'a flash sale at the machine')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'mv-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'mv-boss', 'name', 'Machine Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb)),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'pullSlot', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'repriceSlot', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'flashSale', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'))));
  perform seed_instance(seed);

  insert into card_kinds (key, name, alignment, rarity) values
    ('mv-a', 'Card A', 'sweet', 'common'), ('mv-b', 'Card B', 'sweet', 'common'), ('mv-c', 'Card C', 'salty', 'uncommon'), ('mv-d', 'Card D', 'salty', 'common'),
    ('mv-orphan', 'Orphan', 'salty', 'legendary'), ('mv-hid', 'Hidden One', 'sweet', 'rare'), ('mv-out', 'Out One', 'sweet', 'common'), ('mv-low', 'Low One', 'sweet', 'common');
  -- The pack on sale rolls common, uncommon and rare, and leaves Card D out: D and the legendary orphan are in no pack on sale. A pack the admins have hidden holds the rest.
  insert into pack_kinds (key, pulls, leaves) values
    ('mv-pack', '[{"weights": {"common": 80, "uncommon": 20}}, {"weights": {"uncommon": 75, "rare": 25}}]', '{mv-d}'),
    ('mv-hidden-pack', '[{"weights": {"legendary": 1}}]', '{}');
  insert into machine_slots (position, card, availability, price) values
    (9101, 'mv-a', 'onSale', 100), (9102, 'mv-b', 'onSale', 200), (9103, 'mv-c', 'onSale', 300), (9104, 'mv-d', 'onSale', 100),
    (9105, 'mv-orphan', 'onSale', 100), (9106, 'mv-hid', 'hidden', 500), (9107, 'mv-out', 'soldOut', 100), (9108, 'mv-low', 'onSale', 4);
  insert into machine_slots (position, pack, availability, price) values (9110, 'mv-pack', 'onSale', 300), (9111, 'mv-hidden-pack', 'hidden', 300);
  create temp table w (name text primary key, id uuid not null);
  insert into w select 'A', id from machine_slots where card = 'mv-a';
  insert into w select 'B', id from machine_slots where card = 'mv-b';
  insert into w select 'C', id from machine_slots where card = 'mv-c';
  insert into w select 'D', id from machine_slots where card = 'mv-d';
  insert into w select 'orphan', id from machine_slots where card = 'mv-orphan';
  insert into w select 'hid', id from machine_slots where card = 'mv-hid';
  insert into w select 'out', id from machine_slots where card = 'mv-out';
  insert into w select 'low', id from machine_slots where card = 'mv-low';
  insert into w select 'pack', id from machine_slots where pack = 'mv-pack';
  insert into w select 'hidpack', id from machine_slots where pack = 'mv-hidden-pack';
  grant select on w to public;
  perform tests.account('mv-ann');
end $$;

create function pg_temp.slot(name text) returns uuid language sql as $$ select id from w where w.name = slot.name $$;
create function pg_temp.seen(name text) returns machine_now language sql as $$ select m from machine_now m where m.slot = pg_temp.slot(name) $$;
create function pg_temp.demand(count integer default 1) returns jsonb language sql as $$
  select jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', (select id from boards where slug = 'general'), 'count', count))
$$;
-- A move waiting to land, as the meeting queues it: live a minute ago, for `hours`.
create function pg_temp.queue(kind text, params jsonb, demand jsonb, hours integer default 48) returns bigint language plpgsql as $$
declare
  m bigint;
  q bigint;
  live timestamptz := now() - interval '1 minute';
begin
  insert into meetings (started_at, slot, finished_at, outcome) values (now(), clock_timestamp(), now(), 'ok') returning id into m;
  insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
  values (m, 'mv-boss', kind, params, demand, 'because', live, live + hours * interval '1 hour', false) returning id into q;
  return q;
end $$;
-- A landed move's Act as the tick writes it, for the moves a test wants in force whatever the limits say (an expiry already past, a percent the bounds forbid).
create function pg_temp.landed(kind text, params jsonb, demand jsonb, expires timestamptz) returns uuid language plpgsql as $$
begin
  return (write_staff_act('mv-boss', 'move', pg_temp.announcements(), null,
    jsonb_strip_nulls(jsonb_build_object('kind', kind, 'body', 'Landed.', 'params', params, 'demand', demand, 'expires_at', expires))) ->> 'id')::uuid;
end $$;
create function pg_temp.landing(q bigint) returns queued_moves language plpgsql as $$
declare r queued_moves;
begin
  perform system_tick();
  select * into r from queued_moves where id = q;
  return r;
end $$;
create function pg_temp.slot_param(name text) returns jsonb language sql as $$ select jsonb_build_object('slot', pg_temp.slot(name)) $$;

-- ---- 0b. The landing waits for the machine's one lock ----
-- (Before any landing: a lock taken in a transaction is held to its end, so once this file has landed a machine move it holds the machine's lock itself. The move
-- queued here is undone at the end of the block, so nothing after it sees it.)
do $$
declare
  q bigint;
  got queued_moves;
  acts_held text;
begin
  begin
    -- The landing waits for the machine's one lock (the admin functions' own, 0119): an admin mid-way through taking a pack off sale holds it, and a Pull checked now
    -- could miss that change. A landing that would otherwise succeed times out instead (55P03, not swallowed as a failed move) and the row is untouched.
    q := pg_temp.queue('pullSlot', pg_temp.slot_param('A'), pg_temp.demand());
    perform extensions.dblink_connect('machine_lock', current_setting('kayfabb.scratch_url'));
    perform extensions.dblink_exec('machine_lock', 'begin');
    perform 1 from extensions.dblink('machine_lock', $sql$select 1 from (select pg_advisory_xact_lock(hashtext('kayfabb.machine'))) t$sql$) as x(one integer);
    perform set_config('lock_timeout', '200ms', true);
    acts_held := pg_temp.refusal('select system_tick()');
    perform set_config('lock_timeout', '0', true);
    perform extensions.dblink_exec('machine_lock', 'rollback');
    perform extensions.dblink_disconnect('machine_lock');
    perform pg_temp.expect(acts_held like '55P03%', 'a machine landing did not wait for the machine''s lock: ' || coalesce(acts_held, 'it ran'));
    perform pg_temp.expect((select landed_act is null and refused_at is null and failed_at is null from queued_moves where id = q), 'a landing that timed out left the row due and untouched');
    got := pg_temp.landing(q);
    perform pg_temp.expect(got.landed_act is not null, 'with the lock free the same move lands: ' || to_jsonb(got)::text);
    raise sqlstate 'MV999' using message = 'undo';
  exception when sqlstate 'MV999' then null;
  end;
end $$;

-- ---- 1. The guard: what the params, the demand and the bounds forbid is refused at the queue ----
do $$
declare
  why text;
begin
  perform pg_temp.expect(machine_limit('pullMost') = 2 and machine_limit('repriceLeast') = 50 and machine_limit('repriceMost') = 200 and machine_limit('flashHoursLeast') = 24
                         and machine_limit('flashHoursMost') = 48 and machine_limit('moveDaysMost') = 7, 'the economy''s bounds');
  -- A row of the economy without the machine keys falls back to the engine's own numbers, as the meeting does.
  update settings set value = '{}' where key = 'economy';
  perform pg_temp.expect(machine_limit('pullMost') = 2 and machine_limit('moveDaysMost') = 7 and machine_limit('repriceLeast') = 50 and machine_limit('repriceMost') = 200
                         and machine_limit('flashHoursLeast') = 24 and machine_limit('flashHoursMost') = 48, 'the defaults when the economy holds no key');
  update settings set value = '{"machine.pullMost": 2, "machine.moveDaysMost": 7, "machine.repriceLeast": 50, "machine.repriceMost": 200, "machine.flashHoursLeast": 24, "machine.flashHoursMost": 48}' where key = 'economy';

  -- Every one of these is a malformed or out-of-bounds move, refused with the words of the limit it breaks.
  why := pg_temp.refusal(format('select pg_temp.queue(%L, %L, %L)', 'repriceSlot', jsonb_build_object('slot', pg_temp.slot('A'), 'percent', 100), null));
  perform pg_temp.expect(why like '23514%100 percent changes nothing%', 'a reprice of 100: ' || why);
  why := pg_temp.refusal(format('select pg_temp.queue(%L, %L, %L)', 'repriceSlot', jsonb_build_object('slot', pg_temp.slot('A'), 'percent', 49), null));
  perform pg_temp.expect(why like '23514%at least 50 percent%', 'a reprice under the bound: ' || why);
  why := pg_temp.refusal(format('select pg_temp.queue(%L, %L, %L)', 'repriceSlot', jsonb_build_object('slot', pg_temp.slot('A'), 'percent', 201), pg_temp.demand()));
  perform pg_temp.expect(why like '23514%at most 200 percent%', 'a reprice over the bound: ' || why);
  why := pg_temp.refusal(format('select pg_temp.queue(%L, %L, %L)', 'repriceSlot', jsonb_build_object('slot', pg_temp.slot('A'), 'percent', 150.5), pg_temp.demand()));
  perform pg_temp.expect(why like '23514%whole percent%', 'a reprice of a fraction: ' || why);
  why := pg_temp.refusal(format('select pg_temp.queue(%L, %L, %L)', 'repriceSlot', jsonb_build_object('slot', pg_temp.slot('A'), 'percent', 150), null));
  perform pg_temp.expect(why like '23514%markup carries a demand%', 'a markup with no demand: ' || why);
  why := pg_temp.refusal(format('select pg_temp.queue(%L, %L, %L)', 'repriceSlot', jsonb_build_object('slot', pg_temp.slot('A'), 'percent', 60), pg_temp.demand()));
  perform pg_temp.expect(why like '23514%markdown carries no demand%', 'a markdown with a demand: ' || why);
  why := pg_temp.refusal(format('select pg_temp.queue(%L, %L, %L)', 'pullSlot', pg_temp.slot_param('A'), null));
  perform pg_temp.expect(why like '23514%pull carries a demand%', 'a pull with no demand: ' || why);
  why := pg_temp.refusal(format('select pg_temp.queue(%L, %L, %L, 200)', 'pullSlot', pg_temp.slot_param('A'), pg_temp.demand()));
  perform pg_temp.expect(why like '23514%lasts at most 7 days%', 'a pull past its days: ' || why);
  why := pg_temp.refusal(format('select pg_temp.queue(%L, %L, %L, 24)', 'flashSale', jsonb_build_object('slot', pg_temp.slot('hid'), 'hours', 23), null));
  perform pg_temp.expect(why like '23514%at least 24 hours%', 'a flash sale under its hours: ' || why);
  why := pg_temp.refusal(format('select pg_temp.queue(%L, %L, %L, 49)', 'flashSale', jsonb_build_object('slot', pg_temp.slot('hid'), 'hours', 49), null));
  perform pg_temp.expect(why like '23514%at most 48 hours%', 'a flash sale over its hours: ' || why);
  why := pg_temp.refusal(format('select pg_temp.queue(%L, %L, %L, 24)', 'flashSale', jsonb_build_object('slot', pg_temp.slot('hid'), 'hours', 24), pg_temp.demand()));
  perform pg_temp.expect(why like '23514%flash sale carries no demand%', 'a flash sale with a demand: ' || why);
  why := pg_temp.refusal(format('select pg_temp.queue(%L, %L, %L, 30)', 'flashSale', jsonb_build_object('slot', pg_temp.slot('hid'), 'hours', 24), null));
  perform pg_temp.expect(why like '23514%lasts its hours and no longer%', 'a flash sale with another expiry: ' || why);
  why := pg_temp.refusal(format('select pg_temp.queue(%L, %L, %L)', 'pullSlot', jsonb_build_object('slot', gen_random_uuid()), pg_temp.demand()));
  perform pg_temp.expect(why like '23514%no such slot%', 'a slot that does not exist: ' || why);
  why := pg_temp.refusal(format('select pg_temp.queue(%L, %L, %L)', 'pullSlot', '{"slot": "not-a-slot"}'::jsonb, pg_temp.demand()));
  perform pg_temp.expect(why like '23514%names a slot%', 'a slot that is no uuid: ' || why);
  -- Nothing was queued by any of them.
  perform pg_temp.expect(not exists (select 1 from queued_moves where kind in ('pullSlot', 'repriceSlot', 'flashSale')), 'a refused move was queued');
  -- A slot in capitals is stored in lowercase, the one form every reader compares.
  perform pg_temp.queue('pullSlot', jsonb_build_object('slot', upper(pg_temp.slot('A')::text)), pg_temp.demand());
  perform pg_temp.expect((select params ->> 'slot' from queued_moves where kind = 'pullSlot') = pg_temp.slot('A')::text, 'the slot is stored in lowercase');
end $$;

-- ---- 2. A Pull lands, and its slot is sold out in machine_now with the move on it ----
do $$
declare
  q bigint;
  got queued_moves;
  s machine_now;
begin
  -- The one queued above (slot A) lands at the next tick.
  select id into q from queued_moves where kind = 'pullSlot';
  got := pg_temp.landing(q);
  perform pg_temp.expect(got.landed_act is not null and got.refused_at is null, 'the pull did not land: ' || to_jsonb(got)::text);
  s := pg_temp.seen('A');
  perform pg_temp.expect(s.availability = 'soldOut' and s.price = 100, 'a pulled slot is sold out at its price: ' || to_jsonb(s)::text);
  perform pg_temp.expect(s.move ->> 'kind' = 'pullSlot' and (s.move ->> 'act')::uuid = got.landed_act and (s.move ->> 'ends')::timestamptz = got.expires_at, 'the move on the slot: ' || s.move::text);
  perform pg_temp.expect(s.move #>> '{demand,kind}' = 'postsOnBoard' and s.move -> 'progress' ? 'checkedAt' and (s.move ->> 'was')::integer = 100, 'its demand and progress: ' || s.move::text);
  -- The tick counted it (step 3), and the count is the stored one, as move_progress reads it.
  perform pg_temp.expect((s.move -> 'progress' ->> 'of')::integer = 1 and (s.move -> 'progress' ->> 'done')::integer = 0, 'progress is stored by the tick: ' || s.move::text);
  perform pg_temp.expect(s.move -> 'progress' = move_progress(got.landed_act), 'progress is read as move_progress reads it');
  -- The slot is no longer for sale: the same words for everyone, and the card is still in a pack.
  perform pg_temp.expect(pg_temp.refusal(format('select buy_card(%L, %L, 100)', pg_temp.ann(), s.slot)) like '%this slot is sold out', 'a pulled slot is refused as sold out');
  perform pg_temp.expect(card_in_open_pack('mv-a'), 'a pulled card is still in a pack on sale');
  -- The other slots are as they were.
  perform pg_temp.expect((select availability from pg_temp.seen('B')) = 'onSale' and (pg_temp.seen('B')).move is null, 'another slot is untouched');
end $$;

-- ---- 3. The slot comes back when its demand is met, at its expiry, and when an admin reverses it ----
do $$
declare
  pc uuid := tests.character(tests.account('mv-player'), 'Mv Player');
  th uuid := tests.thread('Mv thread');
  pulled uuid;
  by_expiry uuid;
  by_admin uuid;
begin
  -- Met: a post on the board after the move landed meets its demand of one post at the next count.
  pulled := (select landed_act from queued_moves where kind = 'pullSlot');
  perform pg_temp.expect((pg_temp.seen('A')).availability = 'soldOut', 'pulled before the demand is met');
  perform tests.post(pc, th, 'Hello there.', now() + interval '1 minute');
  update open_moves set checked_at = null;
  perform system_tick();
  perform pg_temp.expect((select e.payload ->> 'why' from acts e where e.kind = 'move_end' and e.target_act_id = pulled) = 'met', 'the demand ended the move');
  perform pg_temp.expect((pg_temp.seen('A')).availability = 'onSale' and (pg_temp.seen('A')).move is null, 'a slot is back when its demand is met: ' || (pg_temp.seen('A'))::text);
  perform pg_temp.expect(pg_temp.refusal(format('select buy_card(%L, %L, 100)', pg_temp.ann(), pg_temp.slot('A'))) is distinct from null
    and pg_temp.refusal(format('select buy_card(%L, %L, 100)', pg_temp.ann(), pg_temp.slot('A'))) not like '%sold out%', 'a slot that came back is not refused as sold out');

  -- Expired: a move whose expiry has passed ends at the tick.
  perform pg_temp.landed('pullSlot', pg_temp.slot_param('B'), pg_temp.demand(9), now() + interval '1 hour');
  perform pg_temp.expect((pg_temp.seen('B')).availability = 'soldOut', 'B is pulled');
  -- An Act cannot be edited, so a move past its expiry is written as one: the tick finds it in force and ends it.
  by_expiry := pg_temp.landed('pullSlot', pg_temp.slot_param('C'), pg_temp.demand(9), now() - interval '1 minute');
  perform pg_temp.expect((pg_temp.seen('C')).availability = 'soldOut', 'C is pulled until the tick sees it has expired');
  perform system_tick();
  perform pg_temp.expect((select e.payload ->> 'why' from acts e where e.kind = 'move_end' and e.target_act_id = by_expiry) = 'expired', 'the expiry ended the move');
  perform pg_temp.expect((pg_temp.seen('C')).availability = 'onSale', 'a slot is back at its expiry: ' || (pg_temp.seen('C'))::text);

  -- Reversed: an admin ends B's pull.
  by_admin := (select (pg_temp.seen('B')).move ->> 'act')::uuid;
  perform end_move(by_admin, 'reversed', 'admin');
  perform pg_temp.expect((pg_temp.seen('B')).availability = 'onSale' and (pg_temp.seen('B')).move is null, 'a slot is back when an admin reverses it: ' || (pg_temp.seen('B'))::text);
  perform pg_temp.expect(not exists (select 1 from machine_now m where m.move is not null), 'no move is in force on the machine now');
end $$;

-- ---- 4. A move that cannot land is refused for good at landing, with the reason, and never applied ----
do $$
declare
  q bigint;
  got queued_moves;
  acts_before bigint;
  pack_slot uuid := pg_temp.slot('pack');
begin
  select count(*) into acts_before from acts where kind = 'move';

  -- A Pull of a card in no pack on sale: Card D is left out by the pack, the orphan is not in its pulls.
  q := pg_temp.queue('pullSlot', pg_temp.slot_param('D'), pg_temp.demand());
  got := pg_temp.landing(q);
  perform pg_temp.expect(got.refused_at is not null and got.landed_act is null and got.failure like '%no pack on sale can still give that card%', 'a pull of a card left out of every pack: ' || to_jsonb(got)::text);
  perform pg_temp.expect(got.failed_at is not null, 'the refusal is recorded on the row');
  q := pg_temp.queue('pullSlot', pg_temp.slot_param('orphan'), pg_temp.demand());
  got := pg_temp.landing(q);
  perform pg_temp.expect(got.refused_at is not null and got.failure like '%no pack on sale can still give that card%', 'a pull of a card in no pack: ' || to_jsonb(got)::text);
  perform pg_temp.expect((pg_temp.seen('D')).availability = 'onSale' and (pg_temp.seen('orphan')).availability = 'onSale', 'a refused pull changed nothing');
  -- Not applied, and never tried again: the row is not due any more.
  perform system_tick();
  perform pg_temp.expect((select count(*) from acts where kind = 'move') = acts_before, 'a refused move wrote an Act');

  -- The floor holds at landing: with the only pack off sale, even a card it holds cannot be pulled.
  update machine_slots set availability = 'soldOut' where id = pack_slot;
  perform pg_temp.expect(not card_in_open_pack('mv-a'), 'with the pack off sale no card is in a pack on sale');
  q := pg_temp.queue('pullSlot', pg_temp.slot_param('A'), pg_temp.demand());
  got := pg_temp.landing(q);
  perform pg_temp.expect(got.refused_at is not null and got.failure like '%no pack on sale%', 'a pull while the pack is off sale: ' || to_jsonb(got)::text);
  update machine_slots set availability = 'onSale' where id = pack_slot;

  -- A pack is never pulled; a slot is pulled only while it is on sale; only an on-sale slot is repriced; a flash sale opens only a hidden slot.
  got := pg_temp.landing(pg_temp.queue('pullSlot', jsonb_build_object('slot', pack_slot), pg_temp.demand()));
  perform pg_temp.expect(got.failure like '%a pack is never pulled%', 'a pull of a pack: ' || got.failure);
  got := pg_temp.landing(pg_temp.queue('pullSlot', pg_temp.slot_param('out'), pg_temp.demand()));
  perform pg_temp.expect(got.failure like '%only a slot on sale is pulled%', 'a pull of a sold out slot: ' || got.failure);
  got := pg_temp.landing(pg_temp.queue('repriceSlot', jsonb_build_object('slot', pg_temp.slot('out'), 'percent', 60), null));
  perform pg_temp.expect(got.failure like '%only a slot on sale is repriced%', 'a reprice of a sold out slot: ' || got.failure);
  got := pg_temp.landing(pg_temp.queue('flashSale', jsonb_build_object('slot', pg_temp.slot('A'), 'hours', 24), null, 24));
  perform pg_temp.expect(got.failure like '%opens a slot an admin hid%', 'a flash sale of a slot on sale: ' || got.failure);
  -- A move that ran out before it could land (The System was off for days) is refused, not landed and ended in the same minute.
  perform pg_temp.expect(machine_move_problem('pullSlot', pg_temp.slot_param('A'), pg_temp.demand(), now() - interval '3 days', now() - interval '1 day', true) like '%ran out before it could land%', 'an expired move');

  perform pg_temp.expect((select count(*) from acts where kind = 'move') = acts_before, 'no refused move wrote an Act');
  perform pg_temp.expect(not exists (select 1 from machine_now m where m.move is not null), 'nothing is on the machine');
end $$;

-- ---- 5. At most machine.pullMost pulls in force, and one move per slot ----
do $$
declare
  a_pull uuid;
  got queued_moves;
begin
  got := pg_temp.landing(pg_temp.queue('pullSlot', pg_temp.slot_param('A'), pg_temp.demand(50)));
  perform pg_temp.expect(got.landed_act is not null, 'the first pull landed: ' || to_jsonb(got)::text);
  a_pull := got.landed_act;
  got := pg_temp.landing(pg_temp.queue('pullSlot', pg_temp.slot_param('B'), pg_temp.demand(50)));
  perform pg_temp.expect(got.landed_act is not null, 'the second pull landed: ' || to_jsonb(got)::text);
  got := pg_temp.landing(pg_temp.queue('pullSlot', pg_temp.slot_param('C'), pg_temp.demand(50)));
  perform pg_temp.expect(got.refused_at is not null and got.failure like '%at most 2 slots are pulled at once%', 'a pull over pullMost: ' || to_jsonb(got)::text);
  perform pg_temp.expect((select count(*) from machine_now where move ->> 'kind' = 'pullSlot') = 2, 'two slots are pulled');
  -- One move per slot: a reprice of a pulled slot is refused.
  got := pg_temp.landing(pg_temp.queue('repriceSlot', jsonb_build_object('slot', pg_temp.slot('A'), 'percent', 150), pg_temp.demand(50)));
  perform pg_temp.expect(got.failure like '%already has a move in force%', 'a second move on a slot: ' || to_jsonb(got)::text);
  -- When one comes back the room is back: the next pull lands.
  perform end_move(a_pull, 'reversed', 'admin');
  got := pg_temp.landing(pg_temp.queue('pullSlot', pg_temp.slot_param('C'), pg_temp.demand(50)));
  perform pg_temp.expect(got.landed_act is not null, 'a pull lands when a pull has ended: ' || to_jsonb(got)::text);
  -- The pullMost is the economy's: raised to 3, a third is allowed.
  update settings set value = jsonb_set(value, '{machine.pullMost}', '3') where key = 'economy';
  got := pg_temp.landing(pg_temp.queue('pullSlot', pg_temp.slot_param('A'), pg_temp.demand(50)));
  perform pg_temp.expect(got.landed_act is not null, 'a third pull lands when pullMost is 3: ' || to_jsonb(got)::text);
  update settings set value = jsonb_set(value, '{machine.pullMost}', '2') where key = 'economy';
  -- Clean up for the sections after: all the moves in force end.
  perform end_move(m.move_act, 'reversed', 'admin') from machine_moves_open m;
  perform pg_temp.expect(not exists (select 1 from machine_now m where m.move is not null), 'the moves ended');
end $$;

-- ---- 6. A Reprice: a markup during an admin's price change, a markdown, the least of 1, and the admin's word over both ----
do $$
declare
  up uuid;
  s machine_now;
  got queued_moves;
begin
  -- A markup lands with its demand: 150 percent of 1.00 is 1.50, and the move says what the admin's price was.
  got := pg_temp.landing(pg_temp.queue('repriceSlot', jsonb_build_object('slot', pg_temp.slot('A'), 'percent', 150), pg_temp.demand(50)));
  perform pg_temp.expect(got.landed_act is not null, 'the markup landed: ' || to_jsonb(got)::text);
  up := got.landed_act;
  s := pg_temp.seen('A');
  perform pg_temp.expect(s.price = 150 and s.availability = 'onSale' and (s.move ->> 'was')::integer = 100 and (s.move ->> 'percent')::numeric = 150, 'a markup: ' || to_jsonb(s)::text);
  -- The admin retunes the price during the markup: the new price times the factor.
  update machine_slots set price = 300 where id = pg_temp.slot('A');
  s := pg_temp.seen('A');
  perform pg_temp.expect(s.price = 450 and (s.move ->> 'was')::integer = 300, 'a markup during an admin''s price change reads the new price times the factor: ' || to_jsonb(s)::text);
  -- A purchase meets the moved price: the old one is refused in words, the new one is taken.
  perform pg_temp.expect(pg_temp.refusal(format('select buy_card(%L, %L, 300)', pg_temp.ann(), s.slot)) like '%the price is now 4.50, not 3.00', 'the moved price is the price');
  -- The markup ends: the admin's price returns, whatever the admin did meanwhile.
  perform end_move(up, 'reversed', 'admin');
  perform pg_temp.expect((pg_temp.seen('A')).price = 300 and (pg_temp.seen('A')).move is null, 'the admin''s price returns: ' || (pg_temp.seen('A'))::text);
  update machine_slots set price = 100 where id = pg_temp.slot('A');

  -- A markdown carries no demand: B at 200 is 100 at 50 percent.
  got := pg_temp.landing(pg_temp.queue('repriceSlot', jsonb_build_object('slot', pg_temp.slot('B'), 'percent', 50), null));
  perform pg_temp.expect(got.landed_act is not null, 'the markdown landed: ' || to_jsonb(got)::text);
  s := pg_temp.seen('B');
  perform pg_temp.expect(s.price = 100 and s.move -> 'demand' = 'null'::jsonb and s.move -> 'progress' = 'null'::jsonb, 'a markdown has no demand and no progress: ' || to_jsonb(s)::text);
  -- A pack is repriced as a card is.
  got := pg_temp.landing(pg_temp.queue('repriceSlot', jsonb_build_object('slot', pg_temp.slot('pack'), 'percent', 80), null));
  perform pg_temp.expect(got.landed_act is not null and (pg_temp.seen('pack')).price = 240, 'a pack is repriced: ' || (pg_temp.seen('pack'))::text);

  -- A price is never below 1: 10 percent of 0.04 rounds to nothing, and is 1.
  perform pg_temp.landed('repriceSlot', jsonb_build_object('slot', pg_temp.slot('low'), 'percent', 10), null, now() + interval '1 day');
  perform pg_temp.expect((pg_temp.seen('low')).price = 1, 'a moved price is at least 1: ' || (pg_temp.seen('low'))::text);
  -- Rounded to the nearest hundredth: 4 at 150 percent is 6; 4 at 60 percent is 2.4, so 2.
  perform end_move(((pg_temp.seen('low')).move ->> 'act')::uuid, 'reversed', 'admin');
  perform pg_temp.landed('repriceSlot', jsonb_build_object('slot', pg_temp.slot('low'), 'percent', 60), null, now() + interval '1 day');
  perform pg_temp.expect((pg_temp.seen('low')).price = 2, 'a moved price is rounded: ' || (pg_temp.seen('low'))::text);
  perform end_move(((pg_temp.seen('low')).move ->> 'act')::uuid, 'reversed', 'admin');

  -- The admin's sold out wins: a Reprice written on a slot an admin marked sold out leaves it sold out, at the admin's price.
  perform pg_temp.landed('repriceSlot', jsonb_build_object('slot', pg_temp.slot('out'), 'percent', 60), null, now() + interval '1 day');
  s := pg_temp.seen('out');
  perform pg_temp.expect(s.availability = 'soldOut' and s.price = 100, 'a reprice on a slot an admin sold out leaves it sold out: ' || to_jsonb(s)::text);
  -- The same when the admin marks a repriced slot sold out after the move landed.
  update machine_slots set availability = 'soldOut' where id = pg_temp.slot('B');
  s := pg_temp.seen('B');
  perform pg_temp.expect(s.availability = 'soldOut' and s.price = 200, 'a repriced slot an admin then sold out stays sold out: ' || to_jsonb(s)::text);
  update machine_slots set availability = 'onSale' where id = pg_temp.slot('B');
  -- A hidden slot stays hidden under a Pull or a Reprice.
  perform end_move(m.move_act, 'reversed', 'admin') from machine_moves_open m;
  update machine_slots set availability = 'hidden' where id = pg_temp.slot('C');
  perform pg_temp.landed('pullSlot', pg_temp.slot_param('C'), pg_temp.demand(9), now() + interval '1 day');
  perform pg_temp.expect(not exists (select 1 from machine_now where slot = pg_temp.slot('C')), 'a pulled slot an admin hid stays hidden');
  perform end_move(m.move_act, 'reversed', 'admin') from machine_moves_open m;
  update machine_slots set availability = 'onSale' where id = pg_temp.slot('C');
end $$;

-- ---- 7. A flash sale lists a hidden slot, and hides it again after ----
do $$
declare
  got queued_moves;
  flash uuid;
  s machine_now;
  pack_slot uuid := pg_temp.slot('hidpack');
begin
  perform pg_temp.expect(not exists (select 1 from machine_now where slot in (pg_temp.slot('hid'), pack_slot)), 'hidden slots are not on the machine');
  perform pg_temp.expect(pg_temp.refusal(format('select buy_card(%L, %L, 500)', pg_temp.ann(), pg_temp.slot('hid'))) like '%the machine has no such slot', 'a hidden slot reads as no slot');
  got := pg_temp.landing(pg_temp.queue('flashSale', jsonb_build_object('slot', pg_temp.slot('hid'), 'hours', 24), null, 24));
  perform pg_temp.expect(got.landed_act is not null, 'the flash sale landed: ' || to_jsonb(got)::text);
  flash := got.landed_act;
  s := pg_temp.seen('hid');
  perform pg_temp.expect(s.slot is not null and s.availability = 'onSale' and s.price = 500 and s.move ->> 'kind' = 'flashSale' and (s.move ->> 'hours')::integer = 24, 'a flash sale lists a hidden slot: ' || to_jsonb(s)::text);
  perform pg_temp.expect(s.move -> 'demand' = 'null'::jsonb, 'a flash sale has no demand');
  -- It can be bought while it is listed.
  insert into wallets (account, balance) values (pg_temp.ann(), 600);
  perform pg_temp.expect((buy_card(pg_temp.ann(), s.slot, 500) ->> 'card') = 'mv-hid', 'a flash sale slot is bought');
  -- One at a time.
  got := pg_temp.landing(pg_temp.queue('flashSale', jsonb_build_object('slot', pack_slot, 'hours', 24), null, 24));
  perform pg_temp.expect(got.failure like '%one flash sale runs at a time%', 'a second flash sale: ' || to_jsonb(got)::text);
  -- A flash sale lifts hidden only: an admin who marks the slot sold out during it has the last word.
  update machine_slots set availability = 'soldOut' where id = pg_temp.slot('hid');
  perform pg_temp.expect((pg_temp.seen('hid')).availability = 'soldOut', 'a sold out slot stays so under a flash sale');
  update machine_slots set availability = 'hidden' where id = pg_temp.slot('hid');
  -- Ended, it is hidden again.
  perform end_move(flash, 'expired', 'expiry');
  perform pg_temp.expect(not exists (select 1 from machine_now where slot = pg_temp.slot('hid')), 'a flash sale hides its slot again after: ' || coalesce((pg_temp.seen('hid'))::text, ''));
  -- And with a next one: after it has ended another may open.
  got := pg_temp.landing(pg_temp.queue('flashSale', jsonb_build_object('slot', pack_slot, 'hours', 48), null, 48));
  perform pg_temp.expect(got.landed_act is not null and (pg_temp.seen('hidpack')).availability = 'onSale', 'a flash sale opens a hidden pack: ' || to_jsonb(got)::text);
  perform end_move(m.move_act, 'reversed', 'admin') from machine_moves_open m;
end $$;

-- ---- 8. The masks: the same for every caller, no helper view for a client, and the cost is the slots and the moves ----
do $$
declare
  as_service jsonb;
  as_anon jsonb;
  as_player jsonb;
  plan text;
  p json;
  player uuid := pg_temp.ann();
begin
  perform pg_temp.landed('pullSlot', pg_temp.slot_param('A'), pg_temp.demand(9), now() + interval '1 day');
  perform pg_temp.landed('repriceSlot', jsonb_build_object('slot', pg_temp.slot('B'), 'percent', 70), null, now() + interval '1 day');
  select jsonb_agg(to_jsonb(m) order by m.position) into as_service from machine_now m where m.slot in (select id from w);
  perform tests.become_anon();
  select jsonb_agg(to_jsonb(m) order by m.position) into as_anon from machine_now m where m.slot in (select id from w);
  perform tests.become(player);
  select jsonb_agg(to_jsonb(m) order by m.position) into as_player from machine_now m where m.slot in (select id from w);
  perform pg_temp.expect(pg_temp.refusal('select * from machine_moves_open') like '42501%', 'a player reads the helper view: ' || coalesce(pg_temp.refusal('select * from machine_moves_open'), 'allowed'));
  perform pg_temp.expect(pg_temp.refusal('select machine_move_problem(''pullSlot'', ''{}'', null, now(), now(), true)') like '42501%', 'a player calls the limit check');
  perform tests.unbecome();
  perform pg_temp.expect(as_service = as_anon and as_anon = as_player, 'machine_now differs between callers');
  perform pg_temp.expect(as_player is not null and jsonb_array_length(as_player) = 8, 'the slots on the machine, hidden ones not: ' || jsonb_array_length(as_player));
  -- It reads the slots and the moves in force and no purchase: the plan names neither the ledger nor the packs.
  execute 'explain (format json) select * from machine_now' into p;
  plan := p::text;
  perform pg_temp.expect(plan not like '%card_ledger%' and plan not like '%"packs"%' and plan not like '%wallet%', 'machine_now reads a purchase');
  perform pg_temp.expect(plan like '%open_moves%', 'machine_now reads the moves in force');
  perform end_move(m.move_act, 'reversed', 'admin') from machine_moves_open m;
end $$;

-- ---- 9. The meeting reads the slots, hidden ones too, and the moves in force, and no purchase ----
do $$
declare
  ctx jsonb;
  pulled uuid;
  r jsonb;
begin
  pulled := pg_temp.landed('pullSlot', pg_temp.slot_param('A'), pg_temp.demand(9), now() + interval '1 day');
  ctx := meeting_context();
  perform pg_temp.expect(jsonb_typeof(ctx -> 'machine') = 'array', 'the context carries the machine');
  select e into r from jsonb_array_elements(ctx -> 'machine') e where (e ->> 'id')::uuid = pg_temp.slot('A');
  perform pg_temp.expect(r ->> 'card' = 'mv-a' and r ->> 'availability' = 'onSale' and (r ->> 'price')::integer = 100 and r #>> '{move,kind}' = 'pullSlot' and (r #>> '{move,act}')::uuid = pulled and (r ->> 'pullable')::boolean = true,
    'a slot the Boss pulled: ' || r::text);
  select e into r from jsonb_array_elements(ctx -> 'machine') e where (e ->> 'id')::uuid = pg_temp.slot('B');
  perform pg_temp.expect((r ->> 'pullable')::boolean = true and r -> 'move' = 'null'::jsonb, 'a slot that could be pulled: ' || r::text);
  select e into r from jsonb_array_elements(ctx -> 'machine') e where (e ->> 'id')::uuid = pg_temp.slot('hid');
  perform pg_temp.expect(r ->> 'availability' = 'hidden' and (r ->> 'pullable')::boolean = false, 'a hidden slot is in the Boss''s read, for a flash sale: ' || r::text);
  select e into r from jsonb_array_elements(ctx -> 'machine') e where (e ->> 'id')::uuid = pg_temp.slot('orphan');
  perform pg_temp.expect((r ->> 'pullable')::boolean = false, 'a card in no pack on sale cannot be pulled: ' || r::text);
  select e into r from jsonb_array_elements(ctx -> 'machine') e where (e ->> 'id')::uuid = pg_temp.slot('pack');
  perform pg_temp.expect((r ->> 'pullable')::boolean = false and r ->> 'pack' = 'mv-pack', 'a pack is never pullable: ' || r::text);
  perform pg_temp.expect((select array_agg(k order by k) from jsonb_object_keys((ctx -> 'machine') -> 0) k) = array['availability', 'card', 'id', 'move', 'pack', 'position', 'price', 'pullable'], 'the slot says nothing else');
  perform pg_temp.expect(ctx::text not like '%' || pg_temp.ann()::text || '%', 'the context names no account');
  perform end_move(pulled, 'reversed', 'admin');
end $$;

-- ---- 10. A price that would overflow an integer is clamped, and the view does not raise for everyone ----
do $$
declare
  big uuid;
  s machine_now;
begin
  insert into card_kinds (key, name, alignment, rarity) values ('mv-big', 'Big One', 'sweet', 'common');
  insert into machine_slots (position, card, availability, price) values (9120, 'mv-big', 'onSale', 2000000000) returning id into big;
  perform pg_temp.landed('repriceSlot', jsonb_build_object('slot', big, 'percent', 200), pg_temp.demand(9), now() + interval '1 day');
  select * into s from machine_now m where m.slot = big;
  perform pg_temp.expect(s.price = 2147483647, 'a moved price past the largest integer is that integer: ' || coalesce(to_jsonb(s)::text, 'no row'));
  perform pg_temp.expect((select count(*) from machine_now) > 0, 'the machine still reads for everyone');
  perform end_move(m.move_act, 'reversed', 'admin') from machine_moves_open m;
end $$;

-- ---- 11. Several moves due in one tick: the machine as each finds it, so exactly the ones the machine can take land ----
do $$
declare
  q1 bigint;
  q2 bigint;
  qs bigint[] := '{}';
  q bigint;
  r queued_moves;
  landed_n integer;
begin
  -- Two moves on one slot, one tick: the first lands, the second meets it and is refused for good, with the reason.
  q1 := pg_temp.queue('repriceSlot', jsonb_build_object('slot', pg_temp.slot('A'), 'percent', 150), pg_temp.demand(50));
  q2 := pg_temp.queue('repriceSlot', jsonb_build_object('slot', pg_temp.slot('A'), 'percent', 160), pg_temp.demand(50));
  perform system_tick();
  perform pg_temp.expect((select count(*) from queued_moves where id in (q1, q2) and landed_act is not null) = 1, 'exactly one of two moves on a slot landed');
  select * into r from queued_moves where id in (q1, q2) and landed_act is null;
  perform pg_temp.expect(r.refused_at is not null and r.failed_at is not null and r.failure like '%already has a move in force%', 'the other was refused with its reason: ' || to_jsonb(r)::text);
  perform pg_temp.expect((select count(*) from machine_moves_open where slot = pg_temp.slot('A')) = 1, 'one move is in force on the slot');
  perform end_move(m.move_act, 'reversed', 'admin') from machine_moves_open m;

  -- pullMost + 1 pulls due at once, one tick: pullMost land, the rest are refused with the reason.
  perform pg_temp.expect(machine_limit('pullMost') = 2, 'pullMost is 2');
  foreach q in array array[
    pg_temp.queue('pullSlot', pg_temp.slot_param('A'), pg_temp.demand(50)),
    pg_temp.queue('pullSlot', pg_temp.slot_param('B'), pg_temp.demand(50)),
    pg_temp.queue('pullSlot', pg_temp.slot_param('C'), pg_temp.demand(50))] loop
    qs := qs || q;
  end loop;
  perform system_tick();
  select count(*) into landed_n from queued_moves where id = any (qs) and landed_act is not null;
  perform pg_temp.expect(landed_n = 2, 'exactly pullMost pulls landed: ' || landed_n);
  perform pg_temp.expect((select count(*) from queued_moves where id = any (qs) and landed_act is null and refused_at is not null and failure like '%at most 2 slots are pulled at once%') = 1, 'the rest were refused with the reason');
  perform pg_temp.expect((select count(*) from machine_moves_open where kind = 'pullSlot') = 2, 'two pulls are in force');
  perform end_move(m.move_act, 'reversed', 'admin') from machine_moves_open m;
end $$;

-- ---- 12. A meeting's answer with a machine move the queue would refuse applies the rest and records the skipped one ----
do $$
declare
  m bigint;
  r jsonb;
  rec jsonb;
  pl jsonb;
  good jsonb;
  bad jsonb;
begin
  update seasons set boss = 'mv-boss' where ends_at is null;
  insert into settings (key, value) values ('structuralHoldHours', '24') on conflict (key) do update set value = excluded.value;
  insert into move_bank (staff, balance, as_of) values ('mv-boss', 5, now()) on conflict (staff) do update set balance = 5, as_of = now();
  good := jsonb_build_object('kind', 'repriceSlot', 'params', jsonb_build_object('slot', pg_temp.slot('B'), 'percent', 60),
    'go_live_at', now(), 'expires_in_hours', 48, 'why', 'Cheap.');
  -- A percent past the economy's bound: the queue's guard refuses it, so the meeting skips it.
  bad := jsonb_build_object('kind', 'repriceSlot', 'params', jsonb_build_object('slot', pg_temp.slot('C'), 'percent', 900), 'demand', pg_temp.demand(),
    'go_live_at', now(), 'expires_in_hours', 48, 'why', 'Dear.');
  pl := jsonb_build_object('boss', 'mv-boss', 'weekly_moves', 5, 'bank_cap', 10,
    'memory', jsonb_build_object('hobby', jsonb_build_object('name', 'pie', 'since', 'today', 'from', 'a friend'), 'opinions', '[]'::jsonb, 'grudges', '[]'::jsonb,
      'wheelhouse', '[]'::jsonb, 'realWorld', '[]'::jsonb, 'marks', '[]'::jsonb),
    'profile', jsonb_build_object('interests', jsonb_build_array('pie'), 'favorites', '[]'::jsonb, 'mood', 'smug', 'signature', 'Done.'),
    'moves', jsonb_build_array(bad, good, bad || jsonb_build_object('params', jsonb_build_object('slot', 'not-a-slot', 'percent', 150))),
    'record', '{}'::jsonb);
  m := (begin_meeting(clock_timestamp()) ->> 'meeting')::bigint;
  r := apply_meeting(m, pl);
  perform pg_temp.expect(r ->> 'status' = 'applied' and (r ->> 'queued')::integer = 1, 'the meeting applied with the one good move: ' || r::text);
  perform pg_temp.expect((select count(*) from queued_moves where meeting = m) = 1 and (select params ->> 'percent' from queued_moves where meeting = m) = '60', 'only the good move was queued');
  select record into rec from meetings where id = m;
  perform pg_temp.expect(jsonb_array_length(rec -> 'machineSkipped') = 2 and rec #>> '{machineSkipped,0,index}' = '0' and rec #>> '{machineSkipped,0,why}' like '%a reprice is at most 200 percent%'
    and rec #>> '{machineSkipped,1,index}' = '2', 'the skipped ones are on the record: ' || rec::text);
end $$;

-- ---- 13. A purchase records whether the Boss had moved its price, and the player's own log reads it with the pack ----
-- (Poison: buy_card and buy_pack left as 0115 wrote them. The test is red on "bought at a markup" when nothing writes the flag.)
do $$
declare
  player uuid := pg_temp.ann();
  bought jsonb;
  pk jsonb;
  seen_price integer;
  rows_n integer;
begin
  insert into wallets (account, balance) values (player, 600) on conflict (account) do update set balance = 600;
  perform tests.become_service();
  -- Before any move: card B at its own price, the pack at its own.
  update wallets set balance = 600 where account = player;
  bought := buy_card(player, pg_temp.slot('B'), 200);
  perform pg_temp.expect((select not repriced from card_ledger where account = player and kind = 'bought' and card = 'mv-b'), 'a card bought at its own price is not repriced');
  update wallets set balance = 600 where account = player;
  pk := buy_pack(player, pg_temp.slot('pack'), 300);
  perform pg_temp.expect((select not repriced from packs where id = (pk ->> 'pack')::uuid), 'a pack bought at its own price is not repriced');
  -- A markup in force on both slots.
  perform tests.unbecome();
  perform pg_temp.landed('repriceSlot', jsonb_build_object('slot', pg_temp.slot('B'), 'percent', 150), null, now() + interval '1 day');
  perform pg_temp.landed('repriceSlot', jsonb_build_object('slot', pg_temp.slot('pack'), 'percent', 150), null, now() + interval '1 day');
  perform tests.become_service();
  update wallets set balance = 600 where account = player;
  bought := buy_card(player, pg_temp.slot('B'), 300);
  perform pg_temp.expect((select repriced from card_ledger where account = player and kind = 'bought' and card = 'mv-b' order by id desc limit 1) and (select count(*) from card_ledger where repriced) = 1, 'a card bought at a markup is repriced');
  update wallets set balance = 600 where account = player;
  pk := buy_pack(player, pg_temp.slot('pack'), 450);
  perform pg_temp.expect((select repriced and price = 450 from packs where id = (pk ->> 'pack')::uuid), 'a pack bought at a markup is repriced');
  perform pg_temp.expect((select count(*) from packs where repriced) = 1 and (select count(*) from card_ledger where kind = 'pulled' and repriced) = 0, 'the flag is on the purchase alone');
  perform tests.unbecome();
  -- The player's own log: the pulled rows with their pack in pull order's company, the purchase's flag, and the pack's kind and price.
  perform tests.become(player);
  perform pg_temp.expect((select count(*) from my_card_ledger where kind = 'pulled' and pack = (pk ->> 'pack')::uuid) = 2, 'my_card_ledger shows the pulled rows with their pack');
  perform pg_temp.expect((select count(*) from my_card_ledger where kind = 'bought' and repriced) = 1, 'my_card_ledger shows a repriced purchase');
  perform pg_temp.expect((select repriced and pack = 'mv-pack' and price = 450 and cardinality(contents) = 2 from my_packs where id = (pk ->> 'pack')::uuid), 'my_packs carries kind, price and the flag');
  perform tests.unbecome();
  -- Another player sees none of it.
  perform tests.account('mv-bob');
  perform tests.become((select id from auth.users where email = 'mv-bob@test.invalid'));
  perform pg_temp.expect(not exists (select 1 from my_card_ledger) and not exists (select 1 from my_packs), 'another player reads the pulled rows or the packs');
  perform tests.unbecome();
  perform end_move(m.move_act, 'reversed', 'admin') from machine_moves_open m;
end $$;
