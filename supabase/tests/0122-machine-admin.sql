-- The machine's admin page (supabase/migrations/0121_machine_admin.sql; docs/plans/2026-11-04-booster-packs-plan.md, Task 6; the design's section 7).
--
-- 1. A player and a visitor are refused by all three calls (admin_machine, set_slot, move_slot), and nothing they asked for is written.
-- 2. admin_machine lists every slot, hidden ones too, in grid order, at the admin's price, with the Boss's move in force on each.
-- 3. set_slot saves an availability and a price, and a saved price shows on the machine at once; bad words are refused and write nothing.
-- 4. move_slot swaps a slot with its neighbor; the first slot up and the last slot down do nothing.
-- 5. Taking a pack off sale ends, as reversed by that admin and in the same transaction, every Pull whose card is then in no pack on sale. A Pull whose card another
--    pack on sale can still give stays.
--    (Poison: set_slot without the ending loop. The test is red on "the pull of a card only the pack gave ended".)
--    A card slot going off sale ends nothing.
-- 6. save_machine saves the order, every availability and every price in one transaction: a refusal anywhere in the list saves nothing and names the slot and the
--    field; a list that is not the whole machine is refused; two packs off sale in one save end the Pull neither can still give.
-- 1b. Anything that takes a pack off sale, or moves a slot, waits for the machine's one lock (the race: two admins each taking a pack off sale, each seeing the
--    other's still on sale, would leave a Pull with no pack on sale). A second session holds the lock and set_slot, save_machine and move_slot each wait for it.
--    (Poison: set_slot without the lock. The test is red on "set_slot did not wait for the machine's lock".)

create function pg_temp.refusal(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return null;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- A refusal's detail (which slot and which field), or null where the statement ran.
create function pg_temp.refusal_detail(stmt text) returns text language plpgsql as $$
declare
  d text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics d = pg_exception_detail;
  return d;
end $$;

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception '%', what; end if;
end $$;

create function pg_temp.announcements() returns uuid language sql as $$
  select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements'
$$;

-- ---- 0. The world: a Boss, an admin, a player, cards, two packs and slots of each availability ----
do $$
declare
  seed jsonb;
begin
  seed := jsonb_build_object(
    'settings', jsonb_build_object('systemEnabled', true, 'structuralHoldHours', 24,
      'economy', jsonb_build_object('machine.pullMost', 2, 'machine.moveDaysMost', 7, 'machine.repriceLeast', 50, 'machine.repriceMost', 200, 'machine.flashHoursLeast', 24, 'machine.flashHoursMost', 48),
      'systemLines', jsonb_build_object('moveLanded', jsonb_build_array('It is done: {move}.'), 'moveMet', jsonb_build_array('Met: {move}.'), 'moveExpired', jsonb_build_array('Expired: {move}.'),
        'moveReversed', jsonb_build_array('Overruled: {move}.')),
      'systemMoveWords', jsonb_build_object('pullSlot', 'the pulling of a card from the machine', 'repriceSlot', 'the repricing of a slot at the machine', 'flashSale', 'a flash sale at the machine')),
    'classes', '[]'::jsonb, 'boards', '[]'::jsonb, 'cards', '[]'::jsonb,
    'system', jsonb_build_object('announcementsTitle', 'Announcements', 'firstBoss', 'ma-boss',
      'staff', jsonb_build_array(jsonb_build_object('key', 'ma-boss', 'name', 'Admin Page Boss', 'title', 'Boss', 'signature', 'Hi', 'beats', '[]'::jsonb)),
      'firstStaff', '[]'::jsonb,
      'moves', jsonb_build_array(
        jsonb_build_object('key', 'pullSlot', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'repriceSlot', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss')),
        jsonb_build_object('key', 'flashSale', 'structural', false, 'shapesBoard', false, 'offices', jsonb_build_array('boss'))),
      'demands', jsonb_build_array(jsonb_build_object('key', 'postsOnBoard'))));
  perform seed_instance(seed);

  insert into card_kinds (key, name, alignment, rarity) values
    ('ma-a', 'Card A', 'sweet', 'common'), ('ma-b', 'Card B', 'sweet', 'uncommon'), ('ma-h', 'Card H', 'salty', 'rare');
  -- ma-pack1 rolls common and uncommon; ma-pack2 rolls common alone. Card B is only in the first.
  insert into pack_kinds (key, pulls, leaves) values
    ('ma-pack1', '[{"weights": {"common": 80, "uncommon": 20}}]', '{}'),
    ('ma-pack2', '[{"weights": {"common": 1}}]', '{}');
  insert into machine_slots (position, card, availability, price) values (9201, 'ma-a', 'onSale', 100), (9202, 'ma-b', 'onSale', 200), (9203, 'ma-h', 'hidden', 300);
  insert into machine_slots (position, pack, availability, price) values (9204, 'ma-pack1', 'onSale', 300), (9205, 'ma-pack2', 'onSale', 300);
  create temp table w (name text primary key, id uuid not null);
  insert into w select 'A', id from machine_slots where card = 'ma-a';
  insert into w select 'B', id from machine_slots where card = 'ma-b';
  insert into w select 'H', id from machine_slots where card = 'ma-h';
  insert into w select 'P1', id from machine_slots where pack = 'ma-pack1';
  insert into w select 'P2', id from machine_slots where pack = 'ma-pack2';
  grant select on w to public;
  insert into admins (account) values (tests.account('ma-admin'));
  perform tests.account('ma-player');
end $$;

create function pg_temp.slot(name text) returns uuid language sql as $$ select id from w where w.name = slot.name $$;
create function pg_temp.row_of(name text) returns machine_slots language sql as $$ select s from machine_slots s where s.id = pg_temp.slot(name) $$;
-- A landed Pull as the tick writes it, whatever the floor says (landing is checked by the tick, 0119; the ending under test is the admin's).
create function pg_temp.pulled(name text) returns uuid language plpgsql as $$
begin
  return (write_staff_act('ma-boss', 'move', pg_temp.announcements(), null,
    jsonb_build_object('kind', 'pullSlot', 'body', 'Landed.', 'params', jsonb_build_object('slot', pg_temp.slot(name)),
      'demand', jsonb_build_object('kind', 'postsOnBoard', 'params', jsonb_build_object('board', (select id from boards where slug = 'general'), 'count', 9)),
      'expires_at', now() + interval '3 days')) ->> 'id')::uuid;
end $$;
-- The grid's order, read as the test's owner (the web client reads machine_now, never the table).
create function pg_temp.grid() returns uuid[] language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return (select array_agg(id order by position) from machine_slots);
end $$;
create function pg_temp.ended(act uuid) returns jsonb language sql as $$ select e.payload from acts e where e.kind = 'move_end' and e.target_act_id = act $$;
-- What the page sends: the slots in this order, each at its own availability and price unless `mods` (keyed by slot id) says otherwise.
create function pg_temp.changes(ids uuid[], mods jsonb default '{}') returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return (select jsonb_agg(jsonb_build_object('slot', u.i, 'availability', s.availability, 'price', s.price) || coalesce(mods -> u.i::text, '{}') order by u.n)
          from unnest(ids) with ordinality u(i, n) join machine_slots s on s.id = u.i);
end $$;

-- ---- 1. A player and a visitor are refused ----
do $$
declare
  player uuid := (select id from auth.users where email = 'ma-player@test.invalid');
  before_price integer := (pg_temp.row_of('A')).price;
  before_position integer := (pg_temp.row_of('A')).position;
begin
  perform tests.become(player);
  begin perform admin_machine(); raise exception 'a player read the machine''s admin page'; exception when insufficient_privilege then null; end;
  begin perform set_slot(pg_temp.slot('A'), 'soldOut', 999); raise exception 'a player set a slot'; exception when insufficient_privilege then null; end;
  begin perform move_slot(pg_temp.slot('A'), 'down'); raise exception 'a player moved a slot'; exception when insufficient_privilege then null; end;
  begin perform save_machine(pg_temp.changes(pg_temp.grid())); raise exception 'a player saved the machine'; exception when insufficient_privilege then null; end;
  perform tests.unbecome();
  perform tests.become_anon();
  begin perform admin_machine(); raise exception 'a visitor reached admin_machine'; exception when insufficient_privilege then null; end;
  begin perform set_slot(pg_temp.slot('A'), 'soldOut', 999); raise exception 'a visitor reached set_slot'; exception when insufficient_privilege then null; end;
  begin perform move_slot(pg_temp.slot('A'), 'down'); raise exception 'a visitor reached move_slot'; exception when insufficient_privilege then null; end;
  begin perform save_machine('[]'::jsonb); raise exception 'a visitor reached save_machine'; exception when insufficient_privilege then null; end;
  perform tests.unbecome();
  perform pg_temp.expect((pg_temp.row_of('A')).price = before_price and (pg_temp.row_of('A')).availability = 'onSale' and (pg_temp.row_of('A')).position = before_position, 'a refused call wrote');
  perform pg_temp.expect(has_function_privilege('authenticated', 'admin_machine()', 'execute') and has_function_privilege('authenticated', 'set_slot(uuid,text,integer)', 'execute')
    and has_function_privilege('authenticated', 'move_slot(uuid,text)', 'execute') and has_function_privilege('authenticated', 'save_machine(jsonb)', 'execute'), 'the web client cannot call the admin functions');
  perform pg_temp.expect((select count(*) from pg_proc p where p.proname in ('admin_machine', 'set_slot', 'move_slot', 'save_machine') and p.prosecdef
    and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public, pg_temp')) = 4, 'an admin function is not security definer with a pinned search_path');
  perform pg_temp.expect(not has_function_privilege('authenticated', 'machine_apply_slot(uuid,text,bigint)', 'execute') and not has_function_privilege('anon', 'machine_apply_slot(uuid,text,bigint)', 'execute')
    and not has_function_privilege('authenticated', 'machine_end_unfloored_pulls()', 'execute'), 'a helper under the admin functions is callable by the web client');
end $$;

-- ---- 1b. One lock for the machine: a pack going off sale and a reorder wait for it ----
-- (Before any other section: a lock taken in a transaction is held to its end, so once this file has saved anything it holds the machine's lock itself.)
do $$
declare
  admin uuid := (select id from auth.users where email = 'ma-admin@test.invalid');
  url text := current_setting('kayfabb.scratch_url');
  waited text := current_setting('lock_timeout');
  order_now uuid[] := pg_temp.grid();
  held text;
begin
  -- Another admin's transaction is in the middle of taking a pack off sale: it holds the machine's lock.
  perform extensions.dblink_connect('machine_lock', url);
  perform extensions.dblink_exec('machine_lock', 'begin');
  perform 1 from extensions.dblink('machine_lock', $sql$select 1 from (select pg_advisory_xact_lock(hashtext('kayfabb.machine'))) t$sql$) as x(one integer);
  perform set_config('lock_timeout', '200ms', true);
  perform tests.become(admin);
  held := pg_temp.refusal(format('select set_slot(%L, %L, 350)', pg_temp.slot('P1'), 'soldOut'));
  perform pg_temp.expect(held like '55P03%', 'set_slot did not wait for the machine''s lock: ' || coalesce(held, 'it ran'));
  held := pg_temp.refusal(format('select save_machine(%L)', pg_temp.changes(order_now, jsonb_build_object(pg_temp.slot('P1')::text, '{"availability": "soldOut"}'::jsonb))));
  perform pg_temp.expect(held like '55P03%', 'save_machine did not wait for the machine''s lock: ' || coalesce(held, 'it ran'));
  held := pg_temp.refusal(format('select move_slot(%L, %L)', order_now[1], 'down'));
  perform pg_temp.expect(held like '55P03%', 'move_slot did not wait for the machine''s lock: ' || coalesce(held, 'it ran'));
  perform tests.unbecome();
  perform extensions.dblink_exec('machine_lock', 'rollback');
  perform extensions.dblink_disconnect('machine_lock');
  perform set_config('lock_timeout', waited, true);
  perform pg_temp.expect(pg_temp.grid() = order_now and (pg_temp.row_of('P1')).availability = 'onSale', 'a call that waited and failed wrote');
end $$;

-- ---- 2. admin_machine lists every slot, with the move in force ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'ma-admin@test.invalid');
  got jsonb;
  pulled uuid;
begin
  pulled := pg_temp.pulled('A');
  perform tests.become(admin);
  got := admin_machine();
  perform tests.unbecome();
  perform pg_temp.expect(jsonb_typeof(got) = 'array', 'an array: ' || got::text);
  perform pg_temp.expect((select count(*) from jsonb_array_elements(got) e where (e ->> 'slot')::uuid in (select id from w)) = 5, 'all five slots, the hidden one too: ' || got::text);
  perform pg_temp.expect((select e ->> 'availability' from jsonb_array_elements(got) e where (e ->> 'slot')::uuid = pg_temp.slot('H')) = 'hidden', 'the hidden slot says hidden');
  perform pg_temp.expect((select (e ->> 'price')::integer from jsonb_array_elements(got) e where (e ->> 'slot')::uuid = pg_temp.slot('A')) = 100, 'the admin''s price, not the machine''s');
  perform pg_temp.expect((select e #>> '{move,kind}' from jsonb_array_elements(got) e where (e ->> 'slot')::uuid = pg_temp.slot('A')) = 'pullSlot'
    and (select (e #>> '{move,act}')::uuid from jsonb_array_elements(got) e where (e ->> 'slot')::uuid = pg_temp.slot('A')) = pulled, 'the move in force on its slot: ' || got::text);
  perform pg_temp.expect((select e -> 'move' from jsonb_array_elements(got) e where (e ->> 'slot')::uuid = pg_temp.slot('B')) = 'null'::jsonb, 'no move on B');
  perform pg_temp.expect((select array_agg((e ->> 'position')::integer order by ord) from jsonb_array_elements(got) with ordinality x(e, ord)) = (select array_agg(position order by position) from machine_slots), 'in grid order');
  perform pg_temp.expect((select e ->> 'rarity' from jsonb_array_elements(got) e where (e ->> 'slot')::uuid = pg_temp.slot('B')) = 'uncommon' and (select e ->> 'pack' from jsonb_array_elements(got) e where (e ->> 'slot')::uuid = pg_temp.slot('P1')) = 'ma-pack1', 'rarity and item');
  -- The Pull ends again so the next sections start clean.
  perform end_move(pulled, 'reversed', 'admin');
end $$;

-- ---- 3. set_slot: a saved price shows on the machine; bad words write nothing ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'ma-admin@test.invalid');
begin
  perform tests.become(admin);
  perform set_slot(pg_temp.slot('A'), 'onSale', 175);
  perform tests.unbecome();
  perform pg_temp.expect((select price from machine_now where slot = pg_temp.slot('A')) = 175, 'a saved price shows on the machine');
  perform tests.become(admin);
  perform set_slot(pg_temp.slot('A'), 'soldOut', 175);
  perform tests.unbecome();
  perform pg_temp.expect((select availability from machine_now where slot = pg_temp.slot('A')) = 'soldOut', 'sold out shows');
  perform tests.become(admin);
  perform set_slot(pg_temp.slot('A'), 'hidden', 175);
  perform tests.unbecome();
  perform pg_temp.expect(not exists (select 1 from machine_now where slot = pg_temp.slot('A')), 'a hidden slot is not on the machine');
  perform tests.become(admin);
  perform set_slot(pg_temp.slot('A'), 'onSale', 100);
  perform pg_temp.expect(pg_temp.refusal(format('select set_slot(%L, %L, 100)', pg_temp.slot('A'), 'closed')) like '22023%', 'an availability that is not one of three');
  perform pg_temp.expect(pg_temp.refusal(format('select set_slot(%L, %L, 0)', pg_temp.slot('A'), 'onSale')) like '22023%', 'a price of nothing');
  perform pg_temp.expect(pg_temp.refusal(format('select set_slot(%L, %L, -5)', pg_temp.slot('A'), 'onSale')) like '22023%', 'a price below nothing');
  perform pg_temp.expect(pg_temp.refusal(format('select set_slot(%L, %L, 100000001)', pg_temp.slot('A'), 'onSale')) like '22023%at most 1000000.00', 'a price above a million orbs');
  perform pg_temp.expect(pg_temp.refusal(format('select set_slot(%L, %L, 100000000)', pg_temp.slot('A'), 'onSale')) is null, 'a price of exactly a million orbs');
  perform set_slot(pg_temp.slot('A'), 'onSale', 100);
  perform pg_temp.expect(pg_temp.refusal(format('select set_slot(%L, null, 100)', pg_temp.slot('A'))) like '22023: a slot is on sale, sold out or hidden', 'no availability, plainly');
  perform pg_temp.expect(pg_temp.refusal(format('select set_slot(%L, %L, null)', pg_temp.slot('A'), 'onSale')) like '22023: a price is at least 0.01', 'no price, plainly');
  perform pg_temp.expect(pg_temp.refusal(format('select move_slot(%L, null)', pg_temp.slot('A'))) like '22023: a slot moves up or down', 'no direction, plainly');
  perform pg_temp.expect(pg_temp.refusal_detail(format('select set_slot(%L, %L, 0)', pg_temp.slot('A'), 'onSale')) = format('slot=%s field=price', pg_temp.slot('A')), 'a refusal names the slot and the field');
  perform pg_temp.expect(pg_temp.refusal_detail(format('select set_slot(%L, %L, 100)', pg_temp.slot('A'), 'closed')) = format('slot=%s field=availability', pg_temp.slot('A')), 'a refusal names the availability');
  perform pg_temp.expect(pg_temp.refusal(format('select set_slot(%L, %L, 100)', gen_random_uuid(), 'onSale')) like 'P0002%', 'no such slot');
  perform pg_temp.expect(pg_temp.refusal(format('select move_slot(%L, %L)', pg_temp.slot('A'), 'sideways')) like '22023%', 'a direction that is not up or down');
  perform pg_temp.expect(pg_temp.refusal(format('select move_slot(%L, %L)', gen_random_uuid(), 'up')) like 'P0002%', 'no such slot to move');
  perform tests.unbecome();
  perform pg_temp.expect((pg_temp.row_of('A')).price = 100 and (pg_temp.row_of('A')).availability = 'onSale', 'a refused call wrote');
end $$;

-- ---- 4. move_slot swaps neighbors; the first slot up and the last slot down do nothing ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'ma-admin@test.invalid');
  order_before uuid[] := pg_temp.grid();
  got jsonb;
begin
  perform tests.become(admin);
  got := move_slot(order_before[1], 'up');
  perform pg_temp.expect(got ->> 'moved' = 'false', 'the first slot up answers that nothing moved: ' || got::text);
  got := move_slot(order_before[array_length(order_before, 1)], 'down');
  perform pg_temp.expect(got ->> 'moved' = 'false', 'the last slot down answers that nothing moved: ' || got::text);
  perform pg_temp.expect(pg_temp.grid() = order_before, 'the first up and the last down changed nothing');
  got := move_slot(order_before[1], 'down');
  perform pg_temp.expect(got ->> 'moved' = 'true', 'down moved');
  perform tests.unbecome();
  perform pg_temp.expect(pg_temp.grid() = array[order_before[2], order_before[1]] || order_before[3:], 'the first two swapped, the rest stayed');
  perform tests.become(admin);
  perform move_slot(order_before[1], 'up');
  perform tests.unbecome();
  perform pg_temp.expect(pg_temp.grid() = order_before, 'up put it back');
end $$;

-- ---- 5. Taking a pack off sale ends the Pulls whose card is then in no pack on sale ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'ma-admin@test.invalid');
  pull_a uuid := pg_temp.pulled('A');
  pull_b uuid := pg_temp.pulled('B');
  got jsonb;
begin
  -- Card A is in both packs, Card B only in the first.
  perform pg_temp.expect((select availability from machine_now where slot = pg_temp.slot('A')) = 'soldOut' and (select availability from machine_now where slot = pg_temp.slot('B')) = 'soldOut', 'both are pulled');
  perform tests.become(admin);
  -- A sold out card changes nothing about the floor.
  perform set_slot(pg_temp.slot('P2'), 'onSale', 300);
  got := set_slot(pg_temp.slot('P1'), 'soldOut', 300);
  perform tests.unbecome();
  perform pg_temp.expect(pg_temp.ended(pull_b) = '{"why": "reversed", "by": "admin"}'::jsonb, 'the pull of a card only the pack gave ended: ' || coalesce(pg_temp.ended(pull_b)::text, 'not ended'));
  perform pg_temp.expect(pg_temp.ended(pull_a) is null, 'the pull of a card another pack on sale gives stays');
  perform pg_temp.expect(got ->> 'ended' = '1', 'the answer counts what ended: ' || got::text);
  perform pg_temp.expect((select availability from machine_now where slot = pg_temp.slot('B')) = 'onSale' and (select move from machine_now where slot = pg_temp.slot('B')) is null, 'B is back on the machine');
  -- The last pack on sale that gave Card A goes: its pull ends too, and a hidden pack does the same.
  perform tests.become(admin);
  got := set_slot(pg_temp.slot('P2'), 'hidden', 300);
  perform tests.unbecome();
  perform pg_temp.expect(pg_temp.ended(pull_a) = '{"why": "reversed", "by": "admin"}'::jsonb and got ->> 'ended' = '1', 'hiding the last pack ended A''s pull: ' || got::text);
  -- A price change on a pack, or a card, ends nothing.
  perform tests.become(admin);
  perform set_slot(pg_temp.slot('P1'), 'onSale', 350);
  perform set_slot(pg_temp.slot('P2'), 'onSale', 350);
  perform tests.unbecome();
  perform pg_temp.expect((select count(*) from acts where kind = 'move_end' and payload ->> 'by' = 'admin' and target_act_id in (pull_a, pull_b)) = 2, 'each pull ended once');
end $$;

-- A card slot going off sale (sold out or hidden) ends nothing: the floor is the packs'.
do $$
declare
  admin uuid := (select id from auth.users where email = 'ma-admin@test.invalid');
  pull_a uuid := pg_temp.pulled('A');
  got jsonb;
begin
  perform tests.become(admin);
  got := set_slot(pg_temp.slot('B'), 'hidden', 200);
  perform set_slot(pg_temp.slot('A'), 'hidden', 100);
  got := set_slot(pg_temp.slot('A'), 'soldOut', 100);
  perform tests.unbecome();
  perform pg_temp.expect(got ->> 'ended' = '0' and pg_temp.ended(pull_a) is null, 'a card slot going off sale ended a pull: ' || got::text);
  perform tests.become(admin);
  perform set_slot(pg_temp.slot('A'), 'onSale', 100);
  perform set_slot(pg_temp.slot('B'), 'onSale', 200);
  perform tests.unbecome();
  perform end_move(pull_a, 'reversed', 'admin');
end $$;

-- ---- 6. save_machine: the order, every availability and every price, in one transaction ----
do $$
declare
  admin uuid := (select id from auth.users where email = 'ma-admin@test.invalid');
  order_before uuid[] := pg_temp.grid();
  swapped uuid[];
  got jsonb;
  pull_a uuid;
  pull_b uuid;
  all_slots jsonb;
  snapshot jsonb;
begin
  snapshot := pg_temp.changes(order_before);
  swapped := array[order_before[2], order_before[1]] || order_before[3:];
  perform tests.become(admin);
  got := save_machine(pg_temp.changes(swapped, jsonb_build_object(order_before[1]::text, '{"price": 111}'::jsonb, order_before[3]::text, '{"availability": "soldOut"}'::jsonb)));
  perform tests.unbecome();
  perform pg_temp.expect(pg_temp.grid() = swapped, 'the saved order is the machine''s order');
  perform pg_temp.expect((select price from machine_slots where id = order_before[1]) = 111, 'the saved price');
  perform pg_temp.expect((select availability from machine_slots where id = order_before[3]) = 'soldOut', 'the saved availability');
  perform pg_temp.expect(got ->> 'ended' = '0', 'nothing ended: ' || got::text);
  -- Put it back, the same way.
  perform tests.become(admin);
  perform save_machine(snapshot);
  perform tests.unbecome();
  perform pg_temp.expect(pg_temp.grid() = order_before and pg_temp.changes(order_before) = snapshot, 'put back');

  -- A refusal anywhere in the list saves nothing, and names the slot and the field.
  perform tests.become(admin);
  perform pg_temp.expect(pg_temp.refusal(format('select save_machine(%L)', pg_temp.changes(swapped, jsonb_build_object(order_before[1]::text, '{"price": 222}'::jsonb, order_before[4]::text, '{"price": 0}'::jsonb)))) like '22023%',
    'a price of nothing mid-list');
  perform pg_temp.expect(pg_temp.refusal_detail(format('select save_machine(%L)', pg_temp.changes(swapped, jsonb_build_object(order_before[1]::text, '{"price": 222}'::jsonb, order_before[4]::text, '{"price": 0}'::jsonb))))
    = format('slot=%s field=price', order_before[4]), 'the refusal names the slot and the field');
  perform pg_temp.expect(pg_temp.refusal_detail(format('select save_machine(%L)', pg_temp.changes(swapped, jsonb_build_object(order_before[2]::text, '{"availability": "closed"}'::jsonb))))
    = format('slot=%s field=availability', order_before[2]), 'the refusal names the availability');
  perform pg_temp.expect(pg_temp.refusal(format('select save_machine(%L)', pg_temp.changes(swapped, jsonb_build_object(order_before[2]::text, '{"price": 100000001}'::jsonb)))) like '22023%at most 1000000.00', 'a price above a million orbs');
  perform pg_temp.expect(pg_temp.refusal(format('select save_machine(%L)', pg_temp.changes(swapped, jsonb_build_object(order_before[2]::text, '{"price": "9"}'::jsonb)))) like '22023%', 'a price that is not a number');
  perform pg_temp.expect(pg_temp.refusal(format('select save_machine(%L)', pg_temp.changes(swapped, jsonb_build_object(order_before[2]::text, '{"price": 1.5}'::jsonb)))) like '22023%', 'a price that is not whole hundredths');
  perform pg_temp.expect(pg_temp.refusal(format('select save_machine(%L)', pg_temp.changes(swapped, jsonb_build_object(order_before[2]::text, '{"availability": null}'::jsonb)))) like '22023%', 'no availability');
  perform pg_temp.expect(pg_temp.refusal('select save_machine(null)') like '22023%', 'no list');
  perform pg_temp.expect(pg_temp.refusal('select save_machine(''{"a": 1}'')') like '22023%', 'not a list');
  -- Not the whole machine: a slot short, a slot twice, a slot the machine does not have.
  perform pg_temp.expect(pg_temp.refusal(format('select save_machine(%L)', pg_temp.changes(order_before[1:4]))) like '22023%', 'a list that leaves a slot out');
  perform pg_temp.expect(pg_temp.refusal(format('select save_machine(%L)', pg_temp.changes(order_before[1:4] || order_before[1]))) like '22023%', 'a list that names a slot twice');
  all_slots := pg_temp.changes(order_before) || jsonb_build_array(jsonb_build_object('slot', gen_random_uuid(), 'availability', 'onSale', 'price', 100));
  perform pg_temp.expect(pg_temp.refusal(format('select save_machine(%L)', all_slots)) like 'P0002%', 'a slot the machine does not have');
  perform tests.unbecome();
  perform pg_temp.expect(pg_temp.grid() = order_before and pg_temp.changes(order_before) = snapshot, 'a refused save wrote');

  -- Two packs off sale in one save end the Pull neither can still give (the page sends both at once).
  pull_a := pg_temp.pulled('A');
  pull_b := pg_temp.pulled('B');
  perform tests.become(admin);
  got := save_machine(pg_temp.changes(order_before, jsonb_build_object(pg_temp.slot('P1')::text, '{"availability": "soldOut"}'::jsonb, pg_temp.slot('P2')::text, '{"availability": "hidden"}'::jsonb)));
  perform tests.unbecome();
  perform pg_temp.expect(pg_temp.ended(pull_a) = '{"why": "reversed", "by": "admin"}'::jsonb and pg_temp.ended(pull_b) = '{"why": "reversed", "by": "admin"}'::jsonb and got ->> 'ended' = '2',
    'both packs off sale in one save ended both pulls: ' || got::text);
  -- Saving them again, off sale, ends nothing more and is not an error.
  perform tests.become(admin);
  got := save_machine(pg_temp.changes(order_before));
  perform set_slot(pg_temp.slot('P1'), 'onSale', 350);
  perform set_slot(pg_temp.slot('P2'), 'onSale', 350);
  perform tests.unbecome();
  perform pg_temp.expect(got ->> 'ended' = '0', 'a save with no pack going off sale ended something: ' || got::text);
end $$;
