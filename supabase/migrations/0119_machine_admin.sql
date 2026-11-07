-- The machine's admin page (docs/plans/2026-11-04-booster-packs-plan.md, Task 6; the design's section 7).
--
-- An admin reads every slot (the hidden ones too, which machine_now leaves out), changes a slot's availability and price, and moves a slot up or down the
-- grid. These are configuration, saved in place as the settings row is; no Act is written for them ("Append-only" is about what a player wrote, and a slot is
-- no one's words). Three functions, each an admin's alone (only_admins, 0021), security definer, callable by the web client:
--
--   admin_machine()                    every slot in grid order at the ADMIN's price and availability (the Boss's move over it is beside, never folded in), and the
--                                      Boss's machine move in force on each: {slot, position, card, pack, rarity, availability, price, move}, `move` {kind, act, ends,
--                                      percent, hours} or null. The REVERSE of a move is the queue's (reverse_move, 0049), reached by the move's act.
--   set_slot(slot, availability, price) saves both. Taking a PACK off sale (sold out or hidden) ends, as `reversed` by that admin and in the same transaction, every
--                                      Pull whose card is then in no pack on sale (card_in_open_pack, 0117), so the floor ("packs are the floor", the design's section 6)
--                                      holds after a Pull has landed too. The fiction learns of it as it does of any reversal (say_move_end, 0051).
--   move_slot(slot, direction)         swaps the slot with its neighbor, `up` or `down`; the first slot up and the last slot down do nothing and say so.
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

create function set_slot(slot uuid, availability text, price integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  seen machine_slots;
  pull record;
  ended integer := 0;
begin
  perform only_admins('changes the machine');
  if availability is null or availability not in ('onSale', 'soldOut', 'hidden') then
    raise exception 'a slot is on sale, sold out or hidden' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if price is null or price < 1 then raise exception 'a price is at least 0.01' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if price > 100000000 then raise exception 'a price is at most 1000000.00' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  select * into seen from machine_slots s where s.id = set_slot.slot for update;
  if not found then raise exception 'the machine has no such slot' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  update machine_slots s set availability = set_slot.availability, price = set_slot.price where s.id = set_slot.slot;
  -- A pack off sale may leave a pulled card in no pack on sale: the floor is the pack's, so that Pull ends here, as this admin's reversal.
  if seen.pack is not null and set_slot.availability <> 'onSale' then
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
  end if;
  return jsonb_build_object('slot', set_slot.slot, 'ended', ended);
end $$;
revoke execute on function set_slot(uuid, text, integer) from public, anon;
grant execute on function set_slot(uuid, text, integer) to authenticated;

create function move_slot(slot uuid, direction text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  mine machine_slots;
  other machine_slots;
begin
  perform only_admins('moves a slot');
  if direction is null or direction not in ('up', 'down') then raise exception 'a slot moves up or down' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- One reorder at a time, so two admins' moves are two swaps and never a torn one.
  perform pg_advisory_xact_lock(hashtext('kayfabb.move_slot'));
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
