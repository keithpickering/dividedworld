-- The machine's admin page (docs/plans/2026-11-04-booster-packs-plan.md, Task 6; the design's section 7).
--
-- An admin reads every slot (the hidden ones too, which machine_now leaves out), changes a slot's availability and price, and moves a slot up or down the
-- grid. These are configuration, saved in place as the settings row is; no Act is written for them ("Append-only" is about what a player wrote, and a slot is
-- no one's words). Four functions, each an admin's alone (only_admins, 0021, before anything else), security definer, callable by the web client:
--
--   admin_machine()                    every slot in grid order at the ADMIN's price and availability (the Boss's move over it is beside, never folded in), and the
--                                      Boss's machine move in force on each: {slot, position, card, pack, rarity, availability, price, move}, `move` {kind, act, ends,
--                                      percent, hours} or null. The REVERSE of a move is the queue's (reverse_move, 0049), reached by the move's act.
--   set_slot(slot, availability, price) saves both. Taking a PACK off sale (sold out or hidden) ends, as `reversed` by that admin and in the same transaction, every
--                                      Pull whose card is then in no pack on sale (card_in_open_pack, 0140), so the floor ("packs are the floor", the design's section 6)
--                                      holds after a Pull has landed too. The fiction learns of it as it does of any reversal (say_move_end, 0051).
--   move_slot(slot, direction)         swaps the slot with its neighbor, `up` or `down`; the first slot up and the last slot down do nothing and say so.
--   save_machine(changes)              what the page's one "Save changes" sends: `changes` is every slot, once, in the order wanted, each with its availability and price
--                                      ([{slot, availability, price}, ...]). The order, every availability and every price are saved in ONE transaction, with the same
--                                      words and the same ending of Pulls as set_slot; a refusal anywhere saves nothing, and its detail (`slot=<id> field=<availability|
--                                      price>`) names the slot and the field.
--
-- The machine's one lock: taking a pack off sale (set_slot, save_machine) and reordering (move_slot) each take pg_advisory_xact_lock(hashtext('kayfabb.machine'))
-- first, so they run one at a time, and the Boss's machine landings in system_tick (0140) take the same lock before checking a machine move, so a landing and an admin's change serialize too. Without it two admins each taking a different pack off sale could each see the other's pack still on sale, and leave a Pull
-- whose card is in no pack on sale: "packs are the floor" would fail by a race. With it the second admin's check reads the first's committed change.
--
-- Two private helpers (no grant to the web client): machine_apply_slot validates and writes one slot and says whether a pack just left sale; and
-- machine_end_unfloored_pulls ends the Pulls the floor no longer holds.
--
-- Masks: the page is an admin's and the machine is public and the same for every caller; nothing here reads a purchase or a buyer.
-- Ways out: every state a slot can be put in is one an admin changes back on this page; a Pull this ends was the Boss's, and ends sooner than its expiry.
-- Cost: the slots (at most 60 are read by the meeting; the page reads them all) times the moves in force, never the purchases.

create function admin_machine() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform only_admins('reads the machine');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'slot', s.id, 'position', s.position, 'card', s.card, 'pack', s.pack, 'rarity', k.rarity, 'availability', s.availability, 'price', s.price,
      'move', (select jsonb_build_object('kind', m.kind, 'act', m.move_act, 'ends', m.expires_at, 'percent', m.percent, 'hours', m.hours)
               from machine_moves_open m where m.slot = s.id order by m.landed_at desc, m.move_act desc limit 1)
    ) order by s.position)
    from machine_slots s left join card_kinds k on k.key = s.card), '[]'::jsonb);
end $$;
revoke execute on function admin_machine() from public, anon;
grant execute on function admin_machine() to authenticated;

-- One slot's availability and price: the words checked (each refusal names the slot and the field in its detail), the row written. True where a PACK that was on
-- sale no longer is, which is the only change that can leave a Pull without a floor. Not the web client's: the admin functions below call it, after the lock.
create function machine_apply_slot(slot uuid, availability text, price bigint) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  seen machine_slots;
begin
  if availability is null or availability not in ('onSale', 'soldOut', 'hidden') then
    raise exception 'a slot is on sale, sold out or hidden' using hint = 'kayfabb.refusal', errcode = '22023', detail = format('slot=%s field=availability', machine_apply_slot.slot);
  end if;
  if price is null or price < 1 then
    raise exception 'a price is at least 0.01' using hint = 'kayfabb.refusal', errcode = '22023', detail = format('slot=%s field=price', machine_apply_slot.slot);
  end if;
  if price > 100000000 then
    raise exception 'a price is at most 1000000.00' using hint = 'kayfabb.refusal', errcode = '22023', detail = format('slot=%s field=price', machine_apply_slot.slot);
  end if;
  select * into seen from machine_slots s where s.id = machine_apply_slot.slot for update;
  if not found then raise exception 'the machine has no such slot' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  update machine_slots s set availability = machine_apply_slot.availability, price = machine_apply_slot.price::integer where s.id = machine_apply_slot.slot;
  return seen.pack is not null and seen.availability = 'onSale' and machine_apply_slot.availability <> 'onSale';
end $$;
revoke execute on function machine_apply_slot(uuid, text, bigint) from public, anon, authenticated;

-- A pack off sale may leave a pulled card in no pack on sale: the floor is the pack's, so that Pull ends here, as this admin's reversal. How many ended.
create function machine_end_unfloored_pulls() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pull record;
  ended integer := 0;
begin
  for pull in
    select m.move_act from machine_moves_open m join machine_slots t on t.id = m.slot
    where m.kind = 'pullSlot' and t.card is not null and not card_in_open_pack(t.card)
    order by m.landed_at, m.move_act
  loop
    if (end_move(pull.move_act, 'reversed', 'admin') ->> 'ended')::boolean then
      perform say_move_end(pull.move_act, 'reversed');
      ended := ended + 1;
    end if;
  end loop;
  return ended;
end $$;
revoke execute on function machine_end_unfloored_pulls() from public, anon, authenticated;

create function set_slot(slot uuid, availability text, price integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  left_sale boolean;
begin
  perform only_admins('changes the machine');
  perform pg_advisory_xact_lock(hashtext('kayfabb.machine'));
  left_sale := machine_apply_slot(set_slot.slot, set_slot.availability, set_slot.price);
  return jsonb_build_object('slot', set_slot.slot, 'ended', case when left_sale then machine_end_unfloored_pulls() else 0 end);
end $$;
revoke execute on function set_slot(uuid, text, integer) from public, anon;
grant execute on function set_slot(uuid, text, integer) to authenticated;

create function save_machine(changes jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e jsonb;
  ids uuid[] := '{}';
  places integer[];
  n integer := 0;
  one uuid;
  amount bigint;
  left_sale boolean := false;
begin
  perform only_admins('changes the machine');
  perform pg_advisory_xact_lock(hashtext('kayfabb.machine'));
  if changes is null or jsonb_typeof(changes) <> 'array' then
    raise exception 'the machine is saved as a list of its slots' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- The list is the whole machine, each slot once: a page that was read before the machine changed is told to reload, never half applied.
  for e in select x.value from jsonb_array_elements(changes) x loop
    if jsonb_typeof(e) <> 'object' or coalesce(e ->> 'slot', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'the machine has no such slot' using hint = 'kayfabb.refusal', errcode = 'P0002';
    end if;
    one := (e ->> 'slot')::uuid;
    if one = any (ids) then raise exception 'a slot is named once' using hint = 'kayfabb.refusal', errcode = '22023', detail = format('slot=%s', one); end if;
    ids := ids || one;
  end loop;
  if exists (select 1 from unnest(ids) u(i) where not exists (select 1 from machine_slots s where s.id = u.i)) then
    raise exception 'the machine has no such slot' using hint = 'kayfabb.refusal', errcode = 'P0002';
  end if;
  if coalesce(array_length(ids, 1), 0) <> (select count(*) from machine_slots) then
    raise exception 'the machine has changed since this page was read: reload the page' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  -- The slots take the grid's places in the order given (the places are unique and deferrable, so all of them trade in one statement).
  select array_agg(position order by position) into places from machine_slots;
  update machine_slots s set position = places[o.n] from unnest(ids) with ordinality o(i, n) where s.id = o.i;
  for e in select x.value from jsonb_array_elements(changes) x loop
    n := n + 1;
    one := ids[n];
    -- A price is a JSON number of whole hundredths; anything else is the price's refusal, with the slot and the field named.
    if jsonb_typeof(e -> 'price') is distinct from 'number' or (e ->> 'price') !~ '^-?[0-9]{1,15}$' then
      raise exception 'a price is a whole number of hundredths, at least 0.01' using hint = 'kayfabb.refusal', errcode = '22023', detail = format('slot=%s field=price', one);
    end if;
    amount := (e ->> 'price')::bigint;
    if machine_apply_slot(one, e ->> 'availability', amount) then left_sale := true; end if;
  end loop;
  return jsonb_build_object('ended', case when left_sale then machine_end_unfloored_pulls() else 0 end);
end $$;
revoke execute on function save_machine(jsonb) from public, anon;
grant execute on function save_machine(jsonb) to authenticated;

create function move_slot(slot uuid, direction text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  mine machine_slots;
  other machine_slots;
begin
  perform only_admins('moves a slot');
  if direction is null or direction not in ('up', 'down') then raise exception 'a slot moves up or down' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- The machine's one lock, shared with set_slot and save_machine: one change at a time, so two admins' moves are two swaps and never a torn one.
  perform pg_advisory_xact_lock(hashtext('kayfabb.machine'));
  select * into mine from machine_slots s where s.id = move_slot.slot;
  if not found then raise exception 'the machine has no such slot' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  select * into other from machine_slots s
  where case move_slot.direction when 'up' then s.position < mine.position else s.position > mine.position end
  order by case move_slot.direction when 'up' then -s.position else s.position end limit 1;
  if not found then return jsonb_build_object('slot', move_slot.slot, 'moved', false); end if;
  -- The position is unique and deferrable, checked at the end of the statement, so the two can trade places in one.
  update machine_slots s set position = case when s.id = mine.id then other.position else mine.position end where s.id in (mine.id, other.id);
  return jsonb_build_object('slot', move_slot.slot, 'moved', true);
end $$;
revoke execute on function move_slot(uuid, text) from public, anon;
grant execute on function move_slot(uuid, text) to authenticated;
