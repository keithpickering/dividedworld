-- The handover withdraws the outgoing Boss's waiting moves (the rehearsal patch design, section 6; docs/plans/2026-11-13-rehearsal-patch-plan.md, Task 6).
--
-- A structural move waits structuralHoldHours in the admin queue, so the last meeting before the season's end can queue a move that lands after the handover, under the next Boss's name; a board
-- move is never inherited, so the new Boss could not review it. hand_over now refuses, for good and with the reason the admin queue shows, every move of the outgoing Boss that is still waiting
-- (not landed, not held, not refused). A held move stays the admins' to release, a Mod's move is the Mod's own, and nothing is posted for a withdrawn move. It happens only where the seat
-- changes hands, and in a block of its own, so a failure there is a note on the handover and never fails it. queued_moves_guard (0335) allows it: a waiting row takes refused_at, failed_at and
-- failure together. Everything else as 0337 wrote it.

create or replace function hand_over(new_season bigint, outgoing text, at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  chosen text;
  how text;
  note text;
  open_nom record;
  arrival uuid;
begin
  begin
    chosen := nominated_boss(outgoing);
    if chosen is not null then how := 'nomination'; end if;
  exception when others then
    chosen := null;
    note := 'the nomination did not seat: ' || sqlerrm;
  end;
  if chosen is null then
    begin
      chosen := rotation_boss(outgoing);
      how := 'rotation';
    exception when others then
      chosen := outgoing;
      how := case when outgoing is null then 'none' else 'unchanged' end;
      note := coalesce(note || '; ', '') || 'the rotation did not choose: ' || sqlerrm;
    end;
  end if;
  update seasons set boss = chosen where id = new_season;
  -- Every nomination in force is spent: it named the Boss of this handover, whoever was seated.
  for open_nom in
    select o.move_act from open_moves o join acts a on a.id = o.move_act where a.payload ->> 'kind' = 'nameSuccessor' order by o.landed_at, o.move_act
  loop
    begin
      perform end_move(open_nom.move_act, 'spent', 'handover');
    exception when others then
      note := coalesce(note || '; ', '') || 'a nomination was not spent: ' || sqlerrm;
    end;
  end loop;
  if chosen is not null and chosen is distinct from outgoing then
    begin
      insert into move_bank (staff, balance, as_of) values (chosen, 0, at)
      on conflict (staff) do update set balance = 0, as_of = excluded.as_of;
    exception when others then
      note := coalesce(note || '; ', '') || 'the bank was not started: ' || sqlerrm;
    end;
    -- The offices (0082): the arriving Boss debuts if it was waiting; the outgoing Boss becomes a member, or a Mod Bot where no persona
    -- is one now, since the staff is never empty. The Boss's own office is the season's and is never a row, so the two Bosses of this
    -- handover are left out of the count: the outgoing one's latest row may still read mod, from before it was seated; a retired mod is no mod either. Best effort, as the rest.
    begin
      perform pg_advisory_xact_lock(hashtext('kayfabb.offices'));
      update characters set debuted_at = at where staff = chosen and debuted_at is null;
      if outgoing is not null then
        insert into staff_offices (staff, office, cause, season)
        values (outgoing, case when exists (select 1 from staff_office_now o join characters c on c.staff = o.staff where o.office = 'mod' and o.staff is distinct from outgoing and o.staff is distinct from chosen and c.retired_at is null) then 'member' else 'mod' end, 'handover', new_season);
      end if;
    exception when others then
      note := coalesce(note || '; ', '') || 'the offices were not moved: ' || sqlerrm;
    end;
    -- The outgoing Boss's moves still waiting are withdrawn: their Boss has left the chair (the rehearsal patch design, section 6). A Mod's own moves are left alone. Refused for good,
    -- with the reason the admin queue shows; nothing is posted. Best effort, as the rest.
    begin
      update queued_moves set failed_at = at, failure = 'its Boss left the chair before it landed', refused_at = at
      where staff = outgoing and landed_act is null and held_at is null and refused_at is null;
    exception when others then
      note := coalesce(note || '; ', '') || 'the outgoing Boss''s waiting moves were not withdrawn: ' || sqlerrm;
    end;
    -- The Boss's own farewell, written at its last meeting (0337, above), in place of the stock line; the stock line stands where none was written or it could not be posted.
    if not say_farewell(outgoing, new_season) then
      perform say_in_announcements(outgoing, 'bossFarewell');
    end if;
    arrival := say_in_announcements(chosen, 'bossArrival');
  end if;
  insert into season_handovers (season, outgoing, boss, how, note, at, arrival_act) values (new_season, outgoing, chosen, how, left(note, 1000), at, arrival);
  return jsonb_build_object('boss', chosen, 'how', how, 'note', note);
end $$;
