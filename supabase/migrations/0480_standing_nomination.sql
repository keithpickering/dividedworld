-- The Boss's standing nomination in the meeting's context (the rehearsal patch design, section 5).
--
-- A Boss that named a successor and is asked again in its last meetings has no way to know it already did: it names the same Boss again, or another, as if the first never stood. The
-- nomination that would stand now (the latest nameSuccessor of the Boss, waiting or landed, not held, not refused and not ended; the one the handover would seat) is handed to the meeting as
-- `nomination` {boss, at}, `at` the epoch milliseconds its meeting began, null when none stands. The prompt tells the Boss of it and the repair drops a successor that names the same Boss
-- again. It is the Boss's own move, public play; nothing in it is computed from who owns a mask, a class or a reactor.
--
-- meeting_context (0337) with that one key added; everything else as 0337 wrote it. The function's grants are as 0051 gave them: create or replace keeps them.
create or replace function meeting_context() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'season', (select jsonb_build_object('startsAt', (extract(epoch from s.starts_at) * 1000)::bigint,
        'endsAt', (extract(epoch from coalesce(s.ends_at, s.starts_at + span_interval(setting('seasonLength')))) * 1000)::bigint)
      from seasons s where s.ends_at is null order by s.starts_at desc limit 1),
    'boss', current_boss(),
    -- The Boss's arc (0334): the beats unlocked and not yet played, each with whether it is due, and the kinds still held back. Never a locked beat, a brief or a template.
    'arc', arc_for_meeting(current_boss(), (select x.id from seasons x where x.ends_at is null)),
    -- The farewell and the handoff (0337, above): a meeting within farewellWindowHours of the season's end is shown what the code knows of the season (`handoffFacts`), to write its handoff from;
    -- the new Boss is handed its predecessor's facts and note (`predecessor`) for inheritanceGraceDays after the handover. Both are null otherwise.
    'handoffFacts', case when in_farewell_window() then handoff_facts((select x.id from seasons x where x.ends_at is null)) end,
    'predecessor', predecessor_handoff(),
    -- The Boss's standing nomination (the rehearsal patch design, section 5): its latest nameSuccessor, waiting or landed and not ended, that no admin held or refused.
    'nomination', (select jsonb_build_object('boss', q.params ->> 'boss', 'at', (extract(epoch from m.started_at) * 1000)::bigint)
      from queued_moves q join meetings m on m.id = q.meeting
      where q.kind = 'nameSuccessor' and q.staff = current_boss() and q.held_at is null and q.refused_at is null
        and (q.landed_act is null or not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = q.landed_act))
      order by q.id desc limit 1),
    'lastSlot', (select m.slot from meetings m where m.outcome in ('ok', 'failed', 'rejected') order by m.slot desc limit 1),
    'boards', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name, b.id)
      from (select n.id, n.name from boards_now n where not n.is_system and not n.closed order by n.name, n.id limit 50) b), '[]'),
    'successors', to_jsonb(array(select r from unnest(boss_roster()) with ordinality x(r, ord) where r is distinct from current_boss() order by x.ord)),
    'inheritanceDue', coalesce((select jsonb_agg(jsonb_build_object('act', d.act, 'kind', d.payload ->> 'kind', 'params', d.payload -> 'params',
        'landedAt', d.landed_at, 'expiresAt', d.payload -> 'expires_at', 'by', d.author, 'boardName', d.board_name) order by d.landed_at, d.act)
      from inheritance_due(current_boss(), 20) d), '[]'),
    -- The Mods on staff: what the Boss's meeting needs to order each (its latest order, the allowance it has not spent, and so what returns to the bank).
    'mods', coalesce((select jsonb_agg(jsonb_build_object('key', n.staff, 'since', n.since, 'allowance', order_unspent(n.staff), 'granted', o.allowance,
        'boards', coalesce(to_jsonb(o.boards), '[]'::jsonb), 'order', o.order_line) order by n.staff)
      from staff_now n left join lateral (select x.allowance, x.boards, x.order_line from staff_orders x where x.staff = n.staff order by x.id desc limit 1) o on true), '[]'),
    -- The rules in force, so the meeting drops a rule that would leave no compliant post before the queue would refuse it.
    'rules', coalesce((select jsonb_agg(jsonb_build_object('board', r.board, 'predicate', r.predicate, 'param', r.param, 'number', r.number) order by r.board nulls last, r.number)
      from rules_now r), '[]'),
    -- The groups (member groups design, section 5): the catalog a move may confer, and the characters the meeting may not choose. A character is held while a group move is
    -- in force on it or queued and not held (the guard's one-at-a-time rule), and capped while staff_punishments is at the cap; each is listed with the group it is in now.
    -- Only those two kinds are listed, which a busy instance keeps to a handful; every other character is in its earned group and free to be chosen.
    'groups', jsonb_build_object(
      'conferred', coalesce((select jsonb_agg(jsonb_build_object('key', g.key, 'name', g.name, 'tone', g.tone) order by g.tone desc, g.key) from group_kinds g where g.source = 'conferred'), '[]'),
      'characters', group_move_bars()),
    -- The machine, so the Boss can name a slot: the admins' own word on each (hidden ones too, for a flash sale), whether a pull of it could land, and the Boss's move
    -- in force on it. Slots and moves only: no purchase, no buyer, nothing computed from who owns what.
    'machine', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'position', s.position, 'card', s.card, 'pack', s.pack, 'availability', s.availability, 'price', s.price,
        'pullable', s.card is not null and s.availability = 'onSale' and card_in_open_pack(s.card),
        'move', (select jsonb_build_object('kind', m.kind, 'act', m.move_act) from machine_moves_open m where m.slot = s.id order by m.landed_at desc, m.move_act desc limit 1)) order by s.position)
      from (select x.* from machine_slots x order by x.position limit 60) s), '[]'))
$$;
