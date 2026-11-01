-- The handover: a Boss names its successor, the season's roll-over seats the next Boss, and the new Boss reviews what it inherits
-- (the system plan, Task 12b; the seasonal Boss design, sections 2 and 3).
--
--   nameSuccessor        a move the Boss makes in the last week of its season: `{boss}`, a roster Boss, never itself. Structural, so it
--                        waits in the admin queue like any, where an admin may HOLD it or replace its Boss (replace_successor). It has no
--                        demand and no expiry; it is spent at the handover (a move_end with why `spent`, by `handover`), and it costs the
--                        Boss no move from its bank (it is no move against the userbase; the plan was silent, and the meeting queues it
--                        beside the moves rather than among them).
--   the roll-over        reveal_season (0042) now seats the next Boss in the same transaction: the landed, unheld, unended nomination
--                        (the latest, if there are several), else the next Boss in the roster by rotation, skipping the outgoing Boss and
--                        the last `rosterRecentExcluded` Bosses. The succession runs in its own begin/exception block and falls back to
--                        the rotation; the rotation falls back to leaving the season with the outgoing Boss; neither stops the reveal
--                        or the new season from opening. Which happened is recorded in season_handovers (no client reads it).
--   the inheritance      a landed move that shapes a board, in force, whose owner (the Boss that wrote it, or the latest Boss that kept
--   review               it) is not the season's Boss is "inherited". The new Boss's meeting answers keep (a `move_keep` Act by the
--                        new Boss: the move is its own, its expiry unchanged) or end (`move_end` why `superseded`), at no cost to the
--                        bank. The tick ends any still unaddressed `inheritanceGraceDays` after the handover (`superseded`, by
--                        `inheritance`). Bans are not reviewed.
--
-- Choices the plan left open: the reasons of a move_end gain `spent` as well as `superseded`; the roster's order is the seed's
-- (`system.staff` order for Bosses), persisted as the setting `bossRoster` by seed_instance; a Boss arriving starts its bank at zero
-- as of the handover (a row written, so a Boss returning does not collect the weeks it was away); where every roster Boss is excluded
-- as recent, the rotation drops that exclusion and keeps only the outgoing Boss's; the nominations still waiting at a handover land
-- later and are ended `spent` by the tick, since they could never name a Boss now.
--
-- Its way out: an inherited move is kept or ended by the new Boss's review, or ends by the tick after the grace; a held nomination
-- leaves the rotation to choose; a nomination that cannot seat its Boss falls back to the rotation; a rotation that cannot choose
-- leaves the outgoing Boss, whose next meeting is the next roll-over's chance.

-- ------------------------------------------------------------------------------ the catalog ----

-- Whether a move shapes a board, so the new Boss reviews it (the engine's `shapesBoard`, seeded). renameBoard does; nameSuccessor does not.
alter table move_kinds add column shapes_board boolean not null default false;
update move_kinds set shapes_board = true where key = 'renameBoard';

-- ------------------------------------------------------------------------- the new Act kind ----

alter table acts drop constraint acts_kind_check;
alter table acts add constraint acts_kind_check check (kind in ('post', 'spin', 'card', 'edit', 'tally', 'reveal', 'unmask', 'move', 'move_end', 'move_keep'));
-- (acts_check1 needs no change: a move_keep names its move, so it is not among the kinds that point at nothing; acts_character_null
-- needs none either: a move_keep is a Boss's, so it has a character.)
alter table acts drop constraint acts_move_end_payload;
alter table acts add constraint acts_move_end_payload check (kind <> 'move_end' or (
  payload ->> 'why' in ('met', 'expired', 'reversed', 'superseded', 'spent')
  and jsonb_typeof(payload -> 'by') = 'string' and char_length(payload ->> 'by') between 1 and 40) is true);
-- No uniqueness on a keep. A keep is an Act, and a move changes hands: A wrote it, B kept it, A returned and kept it, and when B
-- returns the move is due for B again, so B writes a second keep of it. A unique (move, Boss) index would raise there and fail the whole
-- meeting. What a per-(move, Boss) index would guard is already guarded: acts_well_formed refuses a keep by the Boss that already owns
-- the move (move_owner), so one Boss cannot keep one move twice running, in a meeting or at one instant; inheritance_due drops a move
-- once it is the Boss's own, so one meeting keeps it once; and a retried apply_meeting is idempotent per meeting. The latest keep names
-- the owner.

-- The owner of a move: the staff member that wrote it, or the latest Boss that kept it. Null for what is not a move.
create function move_owner(move_act uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select c.staff from acts k join characters c on c.id = k.character where k.kind = 'move_keep' and k.target_act_id = move_owner.move_act order by k.created_at desc, k.id desc limit 1),
    (select c.staff from acts a join characters c on c.id = a.character where a.id = move_owner.move_act and a.kind = 'move'))
$$;
revoke execute on function move_owner(uuid) from public, anon, authenticated;
grant execute on function move_owner(uuid) to service_role;

-- acts_well_formed (0045), with one rule added; everything else as 0045 wrote it: a move_keep is the season's Boss's Act, of a move
-- in force in its own thread that the Boss does not already own.
create or replace function acts_well_formed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare t acts%rowtype;
begin
  if new.character is not null and coalesce(current_setting('kayfabb.staff_writer', true), '') <> 'on'
     and exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a staff character acts only through The System' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind in ('move', 'move_keep') and new.character is not null and not exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
    raise exception 'a % is a staff character''s Act', new.kind using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.kind = 'move' then
    if not exists (select 1 from move_kinds k where k.key = new.payload ->> 'kind') then
      raise exception 'there is no move kind "%"', coalesce(new.payload ->> 'kind', '') using errcode = '23514';
    end if;
    if jsonb_typeof(new.payload -> 'demand') = 'object' and not exists (select 1 from demand_kinds d where d.key = new.payload #>> '{demand,kind}') then
      raise exception 'there is no demand kind "%"', coalesce(new.payload #>> '{demand,kind}', '') using errcode = '23514';
    end if;
    if jsonb_typeof(new.payload -> 'demand') = 'object' and demand_params_problem(new.payload -> 'demand') is not null then
      raise exception 'the demand''s params are malformed at %', demand_params_problem(new.payload -> 'demand') using errcode = '23514';
    end if;
    -- Cast once here, so an expiry that is no time is refused at the door and the readers of it never meet one.
    if jsonb_typeof(new.payload -> 'expires_at') = 'string' then perform (new.payload ->> 'expires_at')::timestamptz; end if;
  end if;
  if new.kind = 'move_end' and coalesce(current_setting('kayfabb.move_end_writer', true), '') <> 'on' then
    raise exception 'a move ends only through end_move' using hint = 'kayfabb.refusal', errcode = '42501';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.debuted_at is null) then
    raise exception 'that character debuts at the next settlement' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.character is not null and exists (select 1 from characters c where c.id = new.character and c.retired_at is not null) then
    raise exception 'that character is retired; an admin can restore it' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  if new.kind = 'unmask' and (new.payload ->> 'class') is distinct from (select class_key from class_now(new.character, new.created_at)) then
    raise exception 'an unmask names the class its character holds' using errcode = '23514';
  end if;
  if new.target_act_id is null then return new; end if;
  select * into t from acts where id = new.target_act_id;
  if new.kind = 'move_end' and (t.kind <> 'move' or t.thread <> new.thread) then
    raise exception 'a move_end is of a move, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'move_keep' then
    if t.kind <> 'move' or t.thread <> new.thread then
      raise exception 'a move_keep is of a move, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
    if not exists (select 1 from open_moves o where o.move_act = t.id) then
      raise exception 'only a move in force can be kept' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
    if (select c.staff from characters c where c.id = new.character) is distinct from current_boss() then
      raise exception 'only the season''s Boss keeps a move' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    if move_owner(t.id) is not distinct from current_boss() then
      raise exception 'that move is already the Boss''s own' using hint = 'kayfabb.refusal', errcode = '55000';
    end if;
  end if;
  if new.kind = 'edit' and (t.kind <> 'post' or t.character <> new.character or t.thread <> new.thread) then
    raise exception 'an edit is of its own author''s post, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind = 'card' and t.kind <> 'post' then
    raise exception 'a card lands on a post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  if new.kind <> 'edit' and t.kind = 'edit' then
    raise exception 'an edit is not answered; answer the post' using hint = 'kayfabb.refusal', errcode = '23514';
  end if;
  return new;
end $$;

-- write_staff_act (0045), also allowing a move_keep. Everything else as 0045 wrote it.
create or replace function write_staff_act(staff_key text, kind text, thread uuid, target uuid, payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  who uuid;
  written uuid;
begin
  if kind is null or kind not in ('post', 'spin', 'card', 'edit', 'move', 'move_keep') then
    raise exception 'a staff character posts, spins, plays a card, edits, moves or keeps a move, not %', coalesce(kind, 'nothing') using errcode = '22023';
  end if;
  if jsonb_typeof(payload) is distinct from 'object' then raise exception 'an Act''s payload is an object' using errcode = '22023'; end if;
  select c.id into who from characters c where c.staff = staff_key;
  if who is null then raise exception 'there is no staff member "%"', staff_key using errcode = 'P0002'; end if;
  perform set_config('kayfabb.staff_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload) values (who, kind, thread, target, payload) returning id into written;
  perform set_config('kayfabb.staff_writer', '', true);
  return act_projection(written);
end $$;

-- end_move (0045), the reasons also `superseded` (the new Boss set an inherited move aside) and `spent` (a nomination used up at the
-- handover). Everything else as 0045 wrote it.
create or replace function end_move(move_act uuid, why text, by text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m acts%rowtype;
  existing uuid;
  written uuid;
begin
  if why is null or why not in ('met', 'expired', 'reversed', 'superseded', 'spent') then raise exception 'a move ends as met, expired, reversed, superseded or spent, not %', coalesce(why, 'nothing') using errcode = '22023'; end if;
  if by is null or char_length(by) not between 1 and 40 then raise exception 'a move''s end says who ended it' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('kayfabb.end_move'), hashtext(move_act::text));
  select * into m from acts where id = move_act and kind = 'move';
  if not found then raise exception 'there is no such move' using errcode = 'P0002'; end if;
  select e.id into existing from acts e where e.kind = 'move_end' and e.target_act_id = move_act;
  if existing is not null then return jsonb_build_object('act', existing, 'ended', false); end if;
  perform set_config('kayfabb.move_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (null, 'move_end', m.thread, move_act, jsonb_build_object('why', why, 'by', by)) returning id into written;
  perform set_config('kayfabb.move_end_writer', '', true);
  return jsonb_build_object('act', written, 'ended', true);
end $$;

-- ------------------------------------------------------------------------ the nomination ----

-- A replaced nomination keeps the record of it: which admin's account, and when. Like held_by, no client and not the digest role reads
-- them (their grants are by column and name neither); admin_queue shows an admin only that it was replaced, and when.
alter table queued_moves add column replaced_by uuid references accounts, add column replaced_at timestamptz;

-- queued_moves_guard (0045), with two rules added: a nameSuccessor is queued with a roster Boss, no demand and no expiry; and an
-- admin's replace_successor may change a waiting nomination's `boss` (and nothing else about its params), with replaced_by and replaced_at
-- beside it, while it has neither landed nor been held. Everything else as 0045 wrote it.
create or replace function queued_moves_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  params_ok boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'a queued move is held or landed, never removed' using errcode = '23514';
  elsif tg_op = 'INSERT' then
    if new.demand is not null and not exists (select 1 from demand_kinds d where d.key = new.demand ->> 'kind') then
      raise exception 'there is no demand kind "%"', coalesce(new.demand ->> 'kind', '') using errcode = '23514';
    end if;
    if new.demand is not null and demand_params_problem(new.demand) is not null then
      raise exception 'the demand''s params are malformed at %', demand_params_problem(new.demand) using errcode = '23514';
    end if;
    if not exists (select 1 from move_kinds k where k.key = new.kind) then
      raise exception 'there is no move kind "%"', new.kind using errcode = '23514';
    end if;
    if new.structural is distinct from (select k.structural from move_kinds k where k.key = new.kind) then
      raise exception 'a % move is not queued as structural = %', new.kind, new.structural using errcode = '23514';
    end if;
    if new.kind = 'nameSuccessor' then
      if new.demand is not null or new.expires_at is not null then raise exception 'a nomination has no demand and no expiry' using errcode = '23514'; end if;
      if jsonb_typeof(new.params -> 'boss') is distinct from 'string'
         or not exists (select 1 from characters c where c.staff = new.params ->> 'boss' and c.staff_kind = 'boss') then
        raise exception 'a nomination names a Boss of the roster' using errcode = '23514';
      end if;
      if new.params ->> 'boss' = new.staff then raise exception 'a Boss does not name itself' using errcode = '23514'; end if;
    end if;
  else
    params_ok := new.params is not distinct from old.params
      or (old.kind = 'nameSuccessor' and old.landed_act is null and old.held_at is null
          and new.params - 'boss' = old.params - 'boss' and jsonb_typeof(new.params -> 'boss') = 'string');
    if not params_ok
       or (new.id, new.meeting, new.staff, new.kind, new.demand, new.why, new.go_live_at, new.expires_at, new.structural)
          is distinct from (old.id, old.meeting, old.staff, old.kind, old.demand, old.why, old.go_live_at, old.expires_at, old.structural) then
      raise exception 'a queued move is only ever held or landed' using errcode = '23514';
    end if;
    -- Who replaced a nomination and when change only with the Boss they replace, and with each other.
    if (new.replaced_by, new.replaced_at) is distinct from (old.replaced_by, old.replaced_at)
       and (new.params is not distinct from old.params or new.replaced_by is null or new.replaced_at is null) then
      raise exception 'a replacement is recorded with the Boss it puts in place' using errcode = '23514';
    end if;
    if (old.held_at is not null and (new.held_at, new.held_by) is distinct from (old.held_at, old.held_by))
       or (old.landed_act is not null and new.landed_act is distinct from old.landed_act) then
      raise exception 'a queued move that is held or landed stays so' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- An admin puts another roster Boss in a waiting nomination's place. The nomination must not have landed (after that, an admin
-- reverses it and the rotation chooses) and must not be held. The new Boss is a roster Boss that is not retired and is not the
-- Boss that wrote the nomination.
create function replace_successor(id bigint, boss text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q queued_moves%rowtype;
begin
  perform only_admins('replaces a successor');
  select * into q from queued_moves where queued_moves.id = replace_successor.id for update;
  if not found then raise exception 'there is no such queued move' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if q.kind <> 'nameSuccessor' then raise exception 'that move names no successor' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if q.landed_act is not null then raise exception 'that nomination has already landed; reverse it instead' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  if q.held_at is not null then raise exception 'that nomination is held' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  if boss is null or not exists (select 1 from characters c where c.staff = boss and c.staff_kind = 'boss' and c.retired_at is null) then
    raise exception 'that is not a Boss of the roster' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if boss = q.staff then raise exception 'a Boss cannot succeed itself' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if boss = q.params ->> 'boss' then raise exception 'that Boss is already the one named' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  update queued_moves set params = params || jsonb_build_object('boss', replace_successor.boss), replaced_by = auth.uid(), replaced_at = now()
  where queued_moves.id = replace_successor.id;
  return jsonb_build_object('id', q.id, 'boss', boss);
end $$;
revoke execute on function replace_successor(bigint, text) from public, anon;
grant execute on function replace_successor(bigint, text) to authenticated;

-- admin_queue (0048), its waiting rows also saying `replacedAt` (when an admin put another Boss in a nomination's place, else null; not
-- who: admins do not need each other's accounts here, and replaced_by is read by nobody), and `roster`: the Bosses a nomination can be
-- replaced with, [{staff, name}] in the rotation's order (boss_roster: not retired, debuted), so the screen offers no one that cannot
-- take the seat. Everything else as 0048 wrote it; the owner and grants are kept.
create or replace function admin_queue() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cap constant integer := 100;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  win constant timestamptz := now() - interval '30 days';
  waiting jsonb; waiting_more boolean;
  in_force jsonb; in_force_more boolean;
  ended jsonb; ended_more boolean;
  roster jsonb;
begin
  perform only_admins('reads the queue');

  -- The Bosses that can take a nomination's seat, by the roster's own rule and order (boss_roster): not retired, debuted.
  select coalesce(jsonb_agg(jsonb_build_object('staff', c.staff, 'name', c.name) order by r.ord), '[]'::jsonb) into roster
  from unnest(boss_roster()) with ordinality r(staff, ord) join characters c on c.staff = r.staff;

  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into waiting, waiting_more from (
    select row_number() over (order by q.go_live_at, q.id) as n,
           jsonb_build_object('id', q.id, 'staff', q.staff, 'boss', (select c.name from characters c where c.staff = q.staff), 'kind', q.kind,
             'params', q.params, 'demand', q.demand, 'why', q.why, 'goLiveAt', q.go_live_at, 'expiresAt', q.expires_at, 'structural', q.structural,
             'failedAt', q.failed_at, 'failure', q.failure, 'replacedAt', q.replaced_at,
             'boardName', case when q.kind = 'renameBoard' and lower(q.params ->> 'board') ~ uuid_re
                               then (select b.name from boards_now b where b.id = (q.params ->> 'board')::uuid) end) as j
    from queued_moves q where q.landed_act is null and q.held_at is null
    order by q.go_live_at, q.id limit cap + 1
  ) x;

  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into in_force, in_force_more from (
    select row_number() over (order by a.created_at desc, a.id) as n,
           jsonb_build_object('act', a.id, 'id', q.id, 'staff', c.staff, 'boss', c.name, 'kind', a.payload ->> 'kind', 'params', a.payload -> 'params',
             'demand', a.payload -> 'demand', 'why', q.why, 'landedAt', a.created_at, 'expiresAt', a.payload -> 'expires_at',
             'progress', demand_progress_or_error(a.id)) as j
    from open_moves o
    join acts a on a.id = o.move_act
    left join characters c on c.id = a.character
    left join queued_moves q on q.landed_act = a.id
    order by a.created_at desc, a.id limit cap + 1
  ) x;

  -- Ended and held, merged: each side cut at cap + 1 first, so the merge never reads more than 2 * (cap + 1) rows.
  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into ended, ended_more from (
    select row_number() over (order by u.at desc, u.tie) as n, u.j from (
      (select e.created_at as at, e.id::text as tie,
              jsonb_build_object('how', e.payload ->> 'why', 'by', e.payload ->> 'by', 'at', e.created_at, 'act', a.id, 'id', q.id, 'staff', c.staff, 'boss', c.name,
                'kind', a.payload ->> 'kind', 'params', a.payload -> 'params', 'demand', a.payload -> 'demand', 'why', q.why, 'landedAt', a.created_at) as j
       from acts e
       join acts a on a.id = e.target_act_id
       left join characters c on c.id = a.character
       left join queued_moves q on q.landed_act = a.id
       where e.kind = 'move_end' and e.created_at >= win
       order by e.created_at desc, e.id desc limit cap + 1)
      union all
      (select h.held_at, 'q' || h.id::text,
              jsonb_build_object('how', 'held', 'by', 'admin', 'at', h.held_at, 'act', null, 'id', h.id, 'staff', h.staff, 'boss', c.name,
                'kind', h.kind, 'params', h.params, 'demand', h.demand, 'why', h.why, 'landedAt', null)
       from queued_moves h
       left join characters c on c.staff = h.staff
       where h.held_at is not null and h.held_at >= win
       order by h.held_at desc, h.id desc limit cap + 1)
    ) u order by u.at desc, u.tie limit cap + 1
  ) x;

  return jsonb_build_object('cap', cap, 'waiting', waiting, 'inForce', in_force, 'ended', ended, 'roster', roster,
    'more', jsonb_build_object('waiting', waiting_more, 'inForce', in_force_more, 'ended', ended_more));
end $$;

-- ---------------------------------------------------------------------------- the review ----

-- The moves the Boss `for_boss` inherits: in force, shaping a board, not its own (move_owner), oldest first, at most `cap`.
create function inheritance_due(for_boss text, cap integer default 100) returns table (act uuid, thread uuid, payload jsonb, landed_at timestamptz, author text, board_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.thread, a.payload, a.created_at, c.name,
         (select b.name from boards b where lower(a.payload #>> '{params,board}') = b.id::text)
  from open_moves o
  join acts a on a.id = o.move_act
  join characters c on c.id = a.character
  join move_kinds k on k.key = a.payload ->> 'kind' and k.shapes_board
  where inheritance_due.for_boss is not null and move_owner(a.id) is distinct from inheritance_due.for_boss
  order by a.created_at, a.id
  limit inheritance_due.cap
$$;
revoke execute on function inheritance_due(text, integer) from public, anon, authenticated;
grant execute on function inheritance_due(text, integer) to service_role;

-- moves_log (0045), also saying who keeps a move now (`kept_by`, a staff key, and `kept_at`; null when nobody kept it). A move
-- ended `superseded` shows it in ended_why. Existing columns first, as a view may only grow at its end.
create or replace view moves_log as
  select a.id, c.staff, a.payload ->> 'kind' as kind, a.payload -> 'params' as params, a.payload -> 'demand' as demand,
         (a.payload ->> 'expires_at')::timestamptz as expires_at, a.thread, a.created_at as at,
         e.payload ->> 'why' as ended_why, e.payload ->> 'by' as ended_by, e.created_at as ended_at,
         k.staff as kept_by, k.at as kept_at
  from characters c
  cross join lateral (select x.* from acts x where x.character = c.id and x.kind = 'move') a
  left join acts e on e.kind = 'move_end' and e.target_act_id = a.id
  left join lateral (
    select kc.staff, ka.created_at as at from acts ka join characters kc on kc.id = ka.character
    where ka.kind = 'move_keep' and ka.target_act_id = a.id order by ka.created_at desc, ka.id desc limit 1
  ) k on true
  where c.staff is not null;
grant select on moves_log to anon, authenticated;

-- ----------------------------------------------------------------------- saying an end ----

-- say_move_end (0047), a move set aside at a handover is said by the season's Boss that set it aside, not by the Boss that wrote it
-- (and by `moveSuperseded`'s line). Everything else as 0047 wrote it.
create or replace function say_move_end(move_act uuid, why text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m record;
begin
  select a.thread, a.payload, c.staff into m from acts a join characters c on c.id = a.character where a.id = move_act and a.kind = 'move';
  perform write_staff_act(case when why = 'superseded' then coalesce(current_boss(), m.staff) else m.staff end, 'post', m.thread, null, jsonb_build_object('body',
    system_line(case why when 'met' then 'moveMet' when 'reversed' then 'moveReversed' when 'superseded' then 'moveSuperseded' else 'moveExpired' end, m.payload ->> 'kind', m.payload -> 'params', m.staff)));
exception when others then
  raise warning 'say_move_end: the end of move % was not said: % (%)', move_act, sqlerrm, sqlstate;
end $$;

-- ------------------------------------------------------------------------- the handover ----

-- What happened at each handover, for the admins and the tests: the season it opened, the Boss it began with, how that Boss was
-- chosen (nomination, rotation, or unchanged where nothing could be chosen) and what went wrong on the way, in the error's words.
-- No client reads it: an error's words are not for a player.
create table season_handovers (
  season bigint primary key references seasons (id),
  outgoing text references characters (staff),
  boss text references characters (staff),
  how text not null check (how in ('nomination', 'rotation', 'unchanged', 'none')),
  note text,
  at timestamptz not null default now()
);
alter table season_handovers enable row level security;
revoke all on season_handovers from public, anon, authenticated;

-- The roster of Bosses in order: the seed's (`bossRoster`, a list of keys) first, for those that still exist as Bosses, then any
-- other Boss character by key. A Boss that is retired or has not debuted is not a candidate.
create function boss_roster() returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  with listed as (
    select r.key, r.ord from jsonb_array_elements_text(coalesce((select s.value from settings s where s.key = 'bossRoster' and jsonb_typeof(s.value) = 'array'), '[]'::jsonb)) with ordinality r(key, ord)
  ), bosses as (
    select c.staff, coalesce(l.ord, 1000000) as ord from characters c left join listed l on l.key = c.staff
    where c.staff_kind = 'boss' and c.retired_at is null and c.debuted_at is not null
  )
  select coalesce(array_agg(b.staff order by b.ord, b.staff), '{}') from bosses b
$$;
revoke execute on function boss_roster() from public, anon, authenticated;
grant execute on function boss_roster() to service_role;

-- The Boss the outgoing Boss's latest standing nomination names: landed, not held, not ended. Null where there is none. Raises where
-- the nominated Boss cannot take the seat (not a Boss of the roster, retired, not debuted, or the outgoing Boss itself), which the
-- handover answers with the rotation.
create function nominated_boss(outgoing text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  nominee text;
begin
  select a.payload #>> '{params,boss}' into nominee
  from queued_moves q join acts a on a.id = q.landed_act
  where q.kind = 'nameSuccessor' and q.staff = nominated_boss.outgoing and q.held_at is null
    and not exists (select 1 from acts e where e.kind = 'move_end' and e.target_act_id = a.id)
  order by a.created_at desc, a.id desc limit 1;
  if nominee is null then return null; end if;
  if nominee = outgoing then raise exception 'the nomination names the outgoing Boss'; end if;
  if not (nominee = any (boss_roster())) then raise exception 'the nominated Boss "%" is not on the roster, or is retired', nominee; end if;
  return nominee;
end $$;
revoke execute on function nominated_boss(text) from public, anon, authenticated;
grant execute on function nominated_boss(text) to service_role;

-- The next Boss by rotation: the roster in order, from the one after the outgoing Boss round to the one before it, the first not among
-- the last `rosterRecentExcluded` Bosses of the seasons that have ended (the one that just ended included) and not the outgoing Boss. Where
-- every Boss is excluded, only the outgoing Boss is. Raises where the roster holds no Boss but the outgoing one, which the handover answers by
-- leaving the season with it.
create function rotation_boss(outgoing text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  roster text[] := boss_roster();
  n integer := coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'rosterRecentExcluded'), 2);
  recent text[] := coalesce((select array_agg(x.boss) from (select p.boss from seasons p where p.ends_at is not null and p.boss is not null order by p.number desc limit greatest(n, 0)) x), '{}');
  at integer := coalesce(array_position(roster, outgoing), 0);
  len integer := coalesce(array_length(roster, 1), 0);
  pick text;
  i integer;
begin
  for pass in 1..2 loop
    for i in 1..len loop
      pick := roster[((at + i - 1) % len) + 1];
      if pick is distinct from outgoing and (pass = 2 or not (pick = any (recent))) then return pick; end if;
    end loop;
  end loop;
  raise exception 'the roster holds no Boss to rotate to';
end $$;
revoke execute on function rotation_boss(text) from public, anon, authenticated;
grant execute on function rotation_boss(text) to service_role;

-- The line a stock key holds, said by a staff member in the announcements thread, if the instance wrote one. Best effort: a failure is a warning.
create function say_in_announcements(speaker text, line_key text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ann uuid := (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements');
begin
  if ann is null or speaker is null then return; end if;
  if not exists (select 1 from settings s where s.key = 'systemLines' and jsonb_typeof(s.value -> line_key) = 'array' and jsonb_array_length(s.value -> line_key) > 0) then return; end if;
  perform write_staff_act(speaker, 'post', ann, null, jsonb_build_object('body', system_line(line_key, null, null, speaker)));
exception when others then
  raise warning 'say_in_announcements: % was not said by %: % (%)', line_key, speaker, sqlerrm, sqlstate;
end $$;
revoke execute on function say_in_announcements(text, text) from public, anon, authenticated;
grant execute on function say_in_announcements(text, text) to service_role;

-- The handover, inside the roll-over's transaction: chooses the new season's Boss and seats it, spends the nominations, starts the arriving
-- Boss's bank at zero, and has the outgoing Boss say farewell and the new Boss arrive. It never raises (reveal_season also calls it in a block
-- of its own): the nomination falls back to the rotation, the rotation to the outgoing Boss, and each side effect is best effort.
create function hand_over(new_season bigint, outgoing text, at timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  chosen text;
  how text;
  note text;
  open_nom record;
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
    perform say_in_announcements(outgoing, 'bossFarewell');
    perform say_in_announcements(chosen, 'bossArrival');
  end if;
  insert into season_handovers (season, outgoing, boss, how, note, at) values (new_season, outgoing, chosen, how, left(note, 1000), at);
  return jsonb_build_object('boss', chosen, 'how', how, 'note', note);
end $$;
revoke execute on function hand_over(bigint, text, timestamptz) from public, anon, authenticated;
grant execute on function hand_over(bigint, text, timestamptz) to service_role;

-- reveal_season (0042), the roll-over also seating the next Boss. Everything else as 0042 wrote it. The handover is a call in a block of its
-- own: if even that raises, the reveal and the new season stand and the new season has no Boss until an admin or the next roll-over gives one
-- (the meeting then records "the open season has no Boss"; a seat is never lost to a failure of the succession).
create or replace function reveal_season(ended timestamptz) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s seasons%rowtype;
  new_season bigint;
  in_thread uuid;
  written uuid;
begin
  select * into s from seasons where ends_at is null for no key update;
  if s.id is null or s.starts_at + span_interval(setting('seasonLength')) > ended then return null; end if;

  update seasons set ends_at = ended where id = s.id;
  insert into seasons (number, starts_at) values (s.number + 1, ended) returning id into new_season;
  begin
    perform hand_over(new_season, s.boss, ended);
  exception when others then
    raise warning 'reveal_season: the handover of season % failed: % (%)', s.number + 1, sqlerrm, sqlstate;
    -- The season keeps its outgoing Boss rather than none, where that much can still be done.
    begin
      update seasons set boss = s.boss where id = new_season and boss is null;
      insert into season_handovers (season, outgoing, boss, how, note, at)
      values (new_season, s.boss, s.boss, case when s.boss is null then 'none' else 'unchanged' end, left('the handover failed: ' || sqlerrm, 1000), ended)
      on conflict (season) do nothing;
    exception when others then null;
    end;
  end;
  insert into threads (board, title) values (system_board(), copy_of('revealTitle', s.number)) returning id into in_thread;
  perform broadcast_later('board:' || (select board from threads where id = in_thread), 'thread', thread_projection(in_thread));
  -- The reveal's own Act says what the season was; each character follows it as an Act of its
  -- own, so the reveal is many small rows at any size of cast, never one payload holding all of
  -- them. Characters by name; who plays them, never. A character that debuts at this very
  -- settlement played no part in the season, and is the next one's.
  insert into acts (character, kind, thread, payload, created_at)
  values (null, 'reveal', in_thread, jsonb_build_object('season', s.number, 'from', s.starts_at, 'to', ended,
    'body', copy_of('revealBody', s.number), 'characters', (select count(*) from characters where debuted_at < ended and staff is null)), ended) returning id into written;
  perform broadcast_later('thread:' || in_thread, 'act', act_projection(written));
  -- Each character in order of final standing, with its place and its standing, and only what its
  -- player made public in the season (`shown`): its reveals, and its announced Turns with the class
  -- each left where the Turn named it, in order. Read from class_reveals and turns_announced (0027),
  -- which read Acts alone, so no unrevealed class and no silent Turn is in it: they roll over into
  -- the next season, a clue rather than a stated fact (the class reveal design, section 5). A Turn
  -- that took effect at this very end is the next season's, as before. At one instant a Turn comes
  -- before the reveal it wrote (0028), as its tally stands before it in the thread.
  insert into acts (character, kind, thread, payload, created_at)
    select null, 'reveal', in_thread, jsonb_build_object('season', s.number, 'character', c.id, 'name', c.name,
        'place', rank() over (order by coalesce(st.amount, 0) desc), 'standing', coalesce(st.amount, 0),
        'shown', coalesce((
          select jsonb_agg(x.entry order by x.at, x.after, x.act) from (
            select r.at, 1 as after, r.act, jsonb_build_object('kind', 'reveal', 'act', r.act, 'at', r.at, 'class', r.class, 'via', r.via) as entry
            from class_reveals r where r.character = c.id and r.at >= s.starts_at and r.at < ended
            union all
            select t.at, 0, t.act, jsonb_build_object('kind', 'turn', 'act', t.act, 'at', t.at)
              || case when t.was is null then '{}'::jsonb else jsonb_build_object('was', t.was, 'since', t.since) end
            from turns_announced t where t.character = c.id and t.at >= s.starts_at and t.at < ended
          ) x), '[]'::jsonb)), ended
    from characters c left join standings st on st.character = c.id and st.season = s.id
    where c.debuted_at < ended and c.staff is null
    order by coalesce(st.amount, 0) desc, c.name, c.id;
  -- Each in the thread's order, in a statement of its own, which sees the rows the one above wrote.
  insert into broadcasts_due (topic, event, payload)
  select 'thread:' || in_thread, 'act', act_projection(a.id) from acts a where a.thread = in_thread and a.id <> written order by a.seq;
  update seasons set reveal_act = written where id = s.id;
  return jsonb_build_object('season', s.number, 'thread', thread_projection(in_thread), 'act', act_projection(written));
end $$;

-- ------------------------------------------------------------------------------- the tick ----

-- system_tick (0047), with the handover's leftovers added as pass 2b (its comment says what they are) and `superseded` counted in
-- its answer. The reads 0052 pins are the function's as 0047 wrote them. Everything else as 0047 wrote it.
create or replace function system_tick() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  enabled boolean := coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'systemEnabled'), false);
  ann uuid := (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements');
  check_every interval := make_interval(mins => coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'demandCheckMinutes'), 5));
  cap integer := coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'demandChecksPerTick'), 40);
  budget_ends timestamptz := clock_timestamp() + make_interval(secs => coalesce(nullif(current_setting('kayfabb.tick_budget_seconds', true), '')::numeric, 20));
  due record;
  inforce record;
  written uuid;
  why text;
  ended_by text;
  progress jsonb;
  expires timestamptz;
  did_end boolean;
  landed integer := 0;
  met integer := 0;
  expired integer := 0;
  failed integer := 0;
  checked integer := 0;
  out_of_time boolean := false;
  superseded integer := 0;
  boss text := current_boss();
  season_start timestamptz := (select x.starts_at from seasons x where x.ends_at is null);
  grace interval := make_interval(days => coalesce((select (s.value #>> '{}')::integer from settings s where s.key = 'inheritanceGraceDays'), 3));
begin
  if not pg_try_advisory_xact_lock(hashtext('kayfabb.system_tick')) then return jsonb_build_object('skipped', true); end if;

  -- 1. Landing: only while The System is on, and only where there is a thread to say it in.
  if enabled and ann is not null then
    for due in
      select q.id, q.staff, q.kind, q.params, q.demand, q.expires_at from queued_moves q where q.landed_act is null and q.held_at is null and q.go_live_at <= now() order by q.go_live_at, q.id for update skip locked
    loop
      begin
        written := (write_staff_act(due.staff, 'move', ann, null,
          jsonb_build_object('kind', due.kind, 'params', due.params, 'body', system_line('moveLanded', due.kind, due.params, due.staff))
          || case when due.demand is not null then jsonb_build_object('demand', due.demand) else '{}'::jsonb end
          || case when due.expires_at is not null then jsonb_build_object('expires_at', due.expires_at) else '{}'::jsonb end) ->> 'id')::uuid;
        update queued_moves set landed_act = written where id = due.id;
        landed := landed + 1;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: queued move % did not land: % (%)', due.id, sqlerrm, sqlstate;
        -- Recorded on the row (the latest failure), so the admin queue can show it and an admin can hold the row. The row stays due.
        update queued_moves set failed_at = now(), failure = left(sqlerrm || ' (' || sqlstate || ')', 500) where id = due.id;
      end;
    end loop;
  end if;

  -- 2. Expiry: whatever the switch says, for every move in force, every tick. It is a comparison.
  for inforce in
    select o.move_act, a.character, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act order by o.landed_at, o.move_act
  loop
    expires := (inforce.payload ->> 'expires_at')::timestamptz;
    if expires is not null and expires <= now() then
      begin
        did_end := (end_move(inforce.move_act, 'expired', 'expiry') ->> 'ended')::boolean;
        if did_end then expired := expired + 1; perform say_move_end(inforce.move_act, 'expired'); end if;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
      end;
    end if;
  end loop;

  -- 2b. The handover's leftovers, whatever the switch says. A nomination in force whose Boss is not the season's is spent (a nomination that
  -- landed after the handover it was for); a move that shapes a board and is not the season's Boss's, still unaddressed `inheritanceGraceDays`
  -- after the handover (or after it landed, if later), ends `superseded`: the new Boss's review never came, or never reached it. A move the
  -- Boss kept is its own (move_owner), so it never ends here. The read is of the moves in force, a handful of rows.
  if boss is not null then
    for inforce in
      select o.move_act, a.payload ->> 'kind' as kind, o.landed_at
      from open_moves o join acts a on a.id = o.move_act join move_kinds k on k.key = a.payload ->> 'kind' and (k.shapes_board or k.key = 'nameSuccessor')
      where move_owner(o.move_act) is distinct from boss
      order by o.landed_at, o.move_act
    loop
      begin
        if inforce.kind = 'nameSuccessor' then
          perform end_move(inforce.move_act, 'spent', 'handover');
        elsif greatest(inforce.landed_at, season_start) + grace <= now() then
          did_end := (end_move(inforce.move_act, 'superseded', 'inheritance') ->> 'ended')::boolean;
          if did_end then superseded := superseded + 1; perform say_move_end(inforce.move_act, 'superseded'); end if;
        end if;
      exception when others then
        failed := failed + 1;
        raise warning 'system_tick: inherited move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
      end;
    end loop;
  end if;

  -- 3. Demands: the moves least recently checked, at most `cap`, none checked within `check_every`, and none once the budget is spent.
  -- A move with no demand is never read. `checked_at` is set before the read, so a move whose progress errors takes its turn like the
  -- rest instead of holding the front of the line.
  for inforce in
    select o.move_act, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act where jsonb_typeof(a.payload -> 'demand') = 'object' and (o.checked_at is null or o.checked_at <= now() - check_every) order by o.checked_at nulls first, o.move_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    update open_moves set checked_at = now() where move_act = inforce.move_act;
    checked := checked + 1;
    did_end := false;
    begin
      progress := demand_progress_or_error(inforce.move_act);
      if coalesce((progress ->> 'met')::boolean, false) then
        did_end := (end_move(inforce.move_act, 'met', 'demand') ->> 'ended')::boolean;
        if did_end then met := met + 1; end if;
      end if;
    exception when others then
      failed := failed + 1;
      did_end := false;
      raise warning 'system_tick: move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
    end;
    -- The Boss says it. The move is ended whether or not the line is posted.
    if did_end then perform say_move_end(inforce.move_act, 'met'); end if;
  end loop;

  return jsonb_build_object('landed', landed, 'met', met, 'expired', expired, 'superseded', superseded, 'failed', failed, 'checked', checked, 'budget', out_of_time,
    'noThread', enabled and ann is null);
end $$;

-- ---------------------------------------------------------------------------------- the seed ----

-- seed_instance (0047), also keeping each move kind's `shapesBoard` and the roster's order (the setting `bossRoster`). Everything else as 0047 wrote it.
create or replace function seed_instance(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  flags integer;
  flagged text;
  unknown text;
begin
  -- Two seeds at once would each find no hire row and both write one into append-only staff_changes. An advisory
  -- transaction lock serializes seeds without locking any table a player reads, and lets go at commit.
  perform pg_advisory_xact_lock(hashtext('kayfabb.seed_instance'));
  select count(*), min(e ->> 'slug') into flags, flagged
  from jsonb_array_elements(coalesce(payload -> 'boards', '[]')) e where coalesce((e ->> 'system')::boolean, false);
  if flags > 1 then raise exception 'a seed flags one board as The System''s, not %', flags using errcode = '22023'; end if;
  -- The economy is merged, number by number: a card kind is never removed, so the price of one
  -- the code no longer sells stays in the row with it (settings_economy_whole, 0006).
  insert into settings (key, value) select key, value from jsonb_each(payload -> 'settings')
  on conflict (key) do update set value = case when settings.key = 'economy' then settings.value || excluded.value else excluded.value end;
  insert into class_kinds (key, name) select e ->> 'key', e ->> 'name' from jsonb_array_elements(payload -> 'classes') e
  on conflict (key) do update set name = excluded.name;
  insert into reaction_kinds (key, emoji, quadrant) select e ->> 'key', e ->> 'emoji', e ->> 'quadrant' from jsonb_array_elements(payload -> 'reactions') e
  on conflict (key) do update set emoji = excluded.emoji, quadrant = excluded.quadrant;
  -- A card's stack, whether it is seeded and the economy numbers its rules read are the code's, as its name and price are.
  insert into card_kinds (key, name, alignment, price_setting, stack, seeded, reads)
  select e ->> 'key', e ->> 'name', e ->> 'alignment', e ->> 'priceSetting', coalesce((e ->> 'stack')::integer, 1), coalesce((e ->> 'seeded')::boolean, false),
    coalesce(array(select jsonb_array_elements_text(e -> 'reads')), '{}')
  from jsonb_array_elements(payload -> 'cards') e
  on conflict (key) do update set name = excluded.name, alignment = excluded.alignment, price_setting = excluded.price_setting,
    stack = excluded.stack, seeded = excluded.seeded, reads = excluded.reads;
  -- The flag leaves the board that held it before another takes it, so the index never sees two.
  -- A seed naming one slug twice is refused by the upsert ("cannot affect row a second time"),
  -- where 0004 took its first; an instance never holds one (instanceProblems).
  if flagged is not null then update boards set is_system = false where is_system and slug <> flagged; end if;
  insert into boards (slug, name, description, is_system)
  select e ->> 'slug', e ->> 'name', coalesce(e ->> 'description', ''), coalesce(e ->> 'slug' = flagged, false) from jsonb_array_elements(payload -> 'boards') e
  on conflict (slug) do update set is_system = true where excluded.is_system and not boards.is_system;
  -- A pip style is added or renamed, never removed: a profile may name it.
  insert into pip_styles (key, name, full_image, empty_image)
  select e ->> 'key', e ->> 'name', e ->> 'full', e ->> 'empty' from jsonb_array_elements(coalesce(payload -> 'pipStyles', '[]')) e
  on conflict (key) do update set name = excluded.name, full_image = excluded.full_image, empty_image = excluded.empty_image;
  -- The instance's staff (0042), once each: a Boss or a Mod Bot is made when its key has no character yet, debuted at
  -- seed time, with the profile its seed gives (its title and its signature, cut to what a profile holds). What an admin
  -- wrote is never written over: a reseed finds the key and does nothing. A bot in firstStaff with no staff_changes row
  -- is hired; one with a row, a fired bot's included, is left as that row says.
  with seeded as (
    select e ->> 'key' as staff, e ->> 'name' as name, e ->> 'kind' as kind, coalesce(e ->> 'title', '') as title, coalesce(e ->> 'signature', '') as signature
    from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) e
  ), made as (
    insert into characters (name, staff, staff_kind, debuted_at) select s.name, s.staff, s.kind, now() from seeded s
    on conflict (staff) do nothing returning id, staff
  )
  insert into character_profiles (character, title, signature)
  select m.id, left(s.title, 40), left(s.signature, 500) from made m join seeded s on s.staff = m.staff;
  select string_agg(k, ', ') into unknown from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from characters c where c.staff = k and c.staff_kind = 'bot');
  if unknown is not null then raise exception 'firstStaff names %, which no bot in the seed''s staff is', unknown using errcode = '22023'; end if;
  insert into staff_changes (staff, on_staff)
  select k, true from jsonb_array_elements_text(coalesce(payload -> 'system' -> 'firstStaff', '[]')) k
  where not exists (select 1 from staff_changes x where x.staff = k);
  -- The catalogs (0045): the moves and demands the engine holds, as the engine lists them. A reseed upserts a move's flag and
  -- never removes a kind, since a landed move may name it. A missing flag is a seed's mistake (a move that reshapes a board
  -- must not be seeded as one that does not), so it is refused by the column.
  insert into move_kinds (key, structural, shapes_board) select e ->> 'key', (e ->> 'structural')::boolean, coalesce((e ->> 'shapesBoard')::boolean, false) from jsonb_array_elements(coalesce(payload -> 'system' -> 'moves', '[]')) e
  on conflict (key) do update set structural = excluded.structural, shapes_board = excluded.shapes_board;
  insert into demand_kinds (key) select e ->> 'key' from jsonb_array_elements(coalesce(payload -> 'system' -> 'demands', '[]')) e
  on conflict (key) do nothing;
  -- The roster's order (0050): the Bosses of the seed's staff, in the order it lists them, so the rotation has one to follow. A seed with no
  -- Boss leaves the setting as it was.
  insert into settings (key, value)
  select 'bossRoster', jsonb_agg(e.value ->> 'key' order by e.ord)
  from jsonb_array_elements(coalesce(payload -> 'system' -> 'staff', '[]')) with ordinality e(value, ord) where e.value ->> 'kind' = 'boss'
  having count(*) > 0
  on conflict (key) do update set value = excluded.value;
  if not exists (select 1 from seasons) then insert into seasons (number, starts_at) values (1, now()); end if;
  -- The open season's Boss (0042's seasons.boss) is the seed's firstBoss when it has none: a season opened before a Boss
  -- existed, or by this seed. A season that already has a Boss keeps it.
  if nullif(payload -> 'system' ->> 'firstBoss', '') is not null then
    update seasons set boss = payload -> 'system' ->> 'firstBoss' where ends_at is null and boss is null;
  end if;
  -- The announcements thread: the one thread on The System's board where a landed move is written and a move's end is said. Made once,
  -- titled from the seed (`system.announcementsTitle`), and its id recorded in the setting `systemAnnouncements` where the tick finds it.
  -- A reseed finds the setting (and the thread it names) and makes nothing; a seed with no title makes none, and until a seed has one
  -- the tick lands nothing (a board with nowhere to say a move is no board it can move). The setting is not in a seed's `settings`,
  -- so no seed writes it over.
  if nullif(payload -> 'system' ->> 'announcementsTitle', '') is not null
     and not exists (select 1 from settings s join threads t on t.id::text = s.value #>> '{}' where s.key = 'systemAnnouncements') then
    with made as (
      insert into threads (board, title) values (system_board(), payload -> 'system' ->> 'announcementsTitle') returning id
    )
    insert into settings (key, value) select 'systemAnnouncements', to_jsonb(made.id::text) from made
    on conflict (key) do update set value = excluded.value;
  end if;
  return jsonb_build_object('settings', (select count(*) from settings), 'classes', (select count(*) from class_kinds),
    'reactions', (select count(*) from reaction_kinds), 'cards', (select count(*) from card_kinds), 'boards', (select count(*) from boards));
end $$;

-- ---------------------------------------------------------------------------- the meeting ----

-- meeting_context (0046), also carrying `inheritanceDue`: the moves the season's Boss inherits and has not yet kept or ended, oldest first,
-- at most 20 (the repair keeps no more answers than that): {act, kind, params, landedAt, expiresAt, by (the Boss that wrote it, by name),
-- boardName (the board's own name, before any rename)}. Everything else as 0046 wrote it.
create or replace function meeting_context() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'season', (select jsonb_build_object('startsAt', (extract(epoch from s.starts_at) * 1000)::bigint,
        'endsAt', (extract(epoch from coalesce(s.ends_at, s.starts_at + span_interval(setting('seasonLength')))) * 1000)::bigint)
      from seasons s where s.ends_at is null order by s.starts_at desc limit 1),
    'boss', current_boss(),
    'lastSlot', (select m.slot from meetings m where m.outcome in ('ok', 'failed', 'rejected') order by m.slot desc limit 1),
    'boards', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name, b.id)
      from (select n.id, n.name from boards_now n where not n.is_system order by n.name, n.id limit 50) b), '[]'),
    'inheritanceDue', coalesce((select jsonb_agg(jsonb_build_object('act', d.act, 'kind', d.payload ->> 'kind', 'params', d.payload -> 'params',
        'landedAt', d.landed_at, 'expiresAt', d.payload -> 'expires_at', 'by', d.author, 'boardName', d.board_name) order by d.landed_at, d.act)
      from inheritance_due(current_boss(), 20) d), '[]'))
$$;

-- apply_meeting (0046), also acting on the handover's two answers, in the same transaction as everything else the meeting keeps:
--   successor {boss, why}   a nameSuccessor move is queued (structural, so held at least structuralHoldHours; no demand, no expiry), costing
--                           the bank nothing. A boss that is not a roster Boss, or is the Boss itself, is dropped and recorded.
--   inherited [{move_act, decision}]
--                           for each move in the Boss's inheritance_due: keep writes a move_keep Act as the Boss; end ends the move
--                           `superseded` (by `boss`) and the Boss says so. At no cost to the bank. An answer naming a move that is not
--                           due (not in force, already the Boss's, or not one that shapes a board) is dropped and recorded.
-- The meeting's record gains `handover`: {kept, ended, skipped, nominated}. Everything else as 0046 wrote it.
create or replace function apply_meeting(meeting bigint, payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  boss text := payload ->> 'boss';
  bal numeric;
  spent integer := jsonb_array_length(coalesce(payload -> 'moves', '[]'));
  hold interval := ((setting('structuralHoldHours')) #>> '{}')::numeric * interval '1 hour';
  memory jsonb := payload -> 'memory';
  mv jsonb;
  inh jsonb;
  due record;
  kind_row move_kinds%rowtype;
  live timestamptz;
  kept integer := 0;
  ended_n integer := 0;
  skipped integer := 0;
  nominated boolean := false;
  act_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.meeting.' || apply_meeting.meeting, 0));
  if not exists (select 1 from meetings x where x.id = apply_meeting.meeting) then
    raise exception 'there is no meeting %', apply_meeting.meeting using errcode = '22023';
  end if;
  if exists (select 1 from meetings x where x.id = apply_meeting.meeting and x.finished_at is not null) then
    return jsonb_build_object('status', 'already applied', 'meeting', apply_meeting.meeting);
  end if;
  if boss is null or boss is distinct from current_boss() then
    raise exception 'a meeting is the open season''s Boss''s; % is not (%)', boss, current_boss() using errcode = '22023';
  end if;
  if hold is null then raise exception 'a meeting needs structuralHoldHours, which this instance does not set' using errcode = '22023'; end if;
  bal := bank_now(boss, (payload ->> 'weekly_moves')::numeric, (payload ->> 'bank_cap')::numeric);
  if bal is null then raise exception 'a meeting names the phase''s weekly_moves and bank_cap' using errcode = '22023'; end if;
  if spent > floor(bal) then
    raise exception 'the moves cost % and the bank holds %', spent, bal using errcode = '23514';
  end if;

  -- Only debuted public characters are named: the engine checks this too, and the database keeps it whatever the caller sent.
  if jsonb_typeof(memory) = 'object' then
    memory := jsonb_set(jsonb_set(memory, '{opinions}', public_entries(memory -> 'opinions')), '{grudges}', public_entries(memory -> 'grudges'));
  end if;
  insert into staff_memory (staff, meeting, body) values (boss, apply_meeting.meeting, memory);
  insert into staff_profiles (staff, meeting, interests, favorites, mood, signature)
  values (boss, apply_meeting.meeting,
    array(select jsonb_array_elements_text(coalesce(payload -> 'profile' -> 'interests', '[]'))),
    array(select f.id from (select case when t.f ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then t.f::uuid end as id, min(t.ord) as ord from jsonb_array_elements_text(coalesce(payload -> 'profile' -> 'favorites', '[]')) with ordinality t(f, ord) group by 1) f
      where f.id in (select c.id from characters_public c) order by f.ord),
    coalesce(payload -> 'profile' ->> 'mood', ''), coalesce(payload -> 'profile' ->> 'signature', ''));

  for mv in select value from jsonb_array_elements(coalesce(payload -> 'moves', '[]')) loop
    select * into kind_row from move_kinds k where k.key = mv ->> 'kind';
    if not found then raise exception 'there is no move kind "%"', mv ->> 'kind' using errcode = '23514'; end if;
    live := greatest((mv ->> 'go_live_at')::timestamptz, now());
    if kind_row.structural then live := greatest(live, now() + hold); end if;
    insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
    values (apply_meeting.meeting, boss, kind_row.key, mv -> 'params', mv -> 'demand', mv ->> 'why', live,
      live + ((mv ->> 'expires_in_hours')::numeric * interval '1 hour'), kind_row.structural);
  end loop;

  -- The successor: queued beside the moves, not among them, and not charged to the bank.
  if jsonb_typeof(payload -> 'successor') = 'object' then
    select * into kind_row from move_kinds k where k.key = 'nameSuccessor';
    if found and jsonb_typeof(payload #> '{successor,boss}') = 'string' and (payload #>> '{successor,boss}') = any (boss_roster()) and (payload #>> '{successor,boss}') <> boss then
      insert into queued_moves (meeting, staff, kind, params, demand, why, go_live_at, expires_at, structural)
      values (apply_meeting.meeting, boss, 'nameSuccessor', jsonb_build_object('boss', payload #>> '{successor,boss}'), null,
        left(coalesce(nullif(payload #>> '{successor,why}', ''), 'No reason given.'), 200), now() + hold, null, kind_row.structural);
      nominated := true;
    else
      skipped := skipped + 1;
    end if;
  end if;

  -- The inheritance review: what the answer names must be among the moves due now; the rest is dropped. Each is answered at most once.
  for inh in select value from jsonb_array_elements(case when jsonb_typeof(payload -> 'inherited') = 'array' then payload -> 'inherited' else '[]'::jsonb end) loop
    act_id := case when (inh ->> 'move_act') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (inh ->> 'move_act')::uuid end;
    select * into due from inheritance_due(boss, 100) d where d.act = act_id;
    -- An answer with no decision (null in the test) is no decision: skipped, never read as "end".
    if act_id is null or not found or not coalesce((inh ->> 'decision') in ('keep', 'end'), false) then
      skipped := skipped + 1;
    elsif inh ->> 'decision' = 'keep' then
      perform write_staff_act(boss, 'move_keep', due.thread, due.act, '{}'::jsonb);
      kept := kept + 1;
    elsif inh ->> 'decision' = 'end' then
      if (end_move(due.act, 'superseded', 'boss') ->> 'ended')::boolean then perform say_move_end(due.act, 'superseded'); ended_n := ended_n + 1; end if;
    end if;
  end loop;

  insert into move_bank (staff, balance, as_of) values (boss, bal - spent, now())
  on conflict (staff) do update set balance = excluded.balance, as_of = excluded.as_of;
  perform close_meeting(apply_meeting.meeting, 'ok', null, bal, bal - spent,
    coalesce(payload -> 'record', '{}') || jsonb_build_object('handover', jsonb_build_object('kept', kept, 'ended', ended_n, 'skipped', skipped, 'nominated', nominated)));
  return jsonb_build_object('status', 'applied', 'meeting', apply_meeting.meeting, 'queued', spent, 'bank_before', bal, 'bank_after', bal - spent);
end $$;

revoke execute on function apply_meeting(bigint, jsonb), meeting_context() from public, anon, authenticated;
grant execute on function apply_meeting(bigint, jsonb), meeting_context() to service_role;
