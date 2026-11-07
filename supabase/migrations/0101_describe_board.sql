-- An admin replaces a board's description (the Mod Bots design, docs/plans/2026-11-06-mod-bots-design.md, section 1, "Admin overrides";
-- its plan, docs/plans/2026-11-06-mod-bots-plan.md, Task 2). The Boss's words stay on the rename's `move` Act; what a board shows is computed.
--
--   describe   An admin's replacement of a board's description. No character; the thread is the rename's, or the announcements thread when
--              no rename is open; target_act_id is the rename's move Act or null. Payload: exactly {description (1-2000), move_act
--              (uuid or null, the open rename it replaces the words of), by ('admin'), board (the board)}. The admin's account is
--              not on the Act, as with a move_end and a card_end: every signed-in player reads an Act's payload. The plan named
--              no `board` key ("target the board"), but an Act has no board column and a describe with no rename open names no move, so the
--              board rides in the payload (PLAN GAP). It takes no seq, as a card_end takes none (0092): it is not a post in any
--              thread, and no thread page lists it. Written only by write_describe, which sets `kayfabb.describe_writer` for the insert.
--   queued_moves gains admin_description, described_by and described_at: an admin's replacement of a waiting rename's description, kept
--              on the row (a queue entry, not an Act) until the tick lands the rename, when it becomes a describe Act in the same
--              subtransaction. A second call replaces the first.
--   boards_now: a board's description is the latest describe naming the open rename's move, else that move's own description; with no
--              rename open, the latest describe naming no move, else boards.description. A describe naming an ended rename shows nothing.
--
-- What changed, each redefined whole from its latest definition:
--   - acts_kind_check (0092) gains 'describe'; acts_character_null (0092) needs none (a describe is no character's, so it joins the kinds
--     with a null character); acts_check1 (0062) lists 'describe' among the kinds that may point at nothing; acts_seq_check and
--     acts_take_seq (0092) leave a describe without a seq.
--   - queued_moves_guard (0082) lets the three new columns change while a row is waiting, together, and never after it is held or landed.
--   - system_tick (0053) writes the describe Act after landing a rename that carries an admin_description.
--   - boards_now (0046), same columns, the description computed as above.
-- Ways out: a replacement is replaced by the next one, and a describe stops showing when its rename ends (the base words return).

alter table acts drop constraint acts_kind_check;
-- (0100's 'announce' kept: an announce Act is already in the table on a database that has run 0100.)
alter table acts add constraint acts_kind_check check (kind in ('post', 'spin', 'card', 'edit', 'tally', 'reveal', 'unmask', 'move', 'move_end', 'move_keep', 'set', 'spring', 'update', 'card_end', 'announce', 'describe'));

alter table acts drop constraint acts_character_null;
alter table acts add constraint acts_character_null check ((character is null) = (kind in ('tally', 'reveal', 'move_end', 'card_end', 'describe')));

alter table acts drop constraint acts_check1;
-- (0100's 'announce' kept, as in acts_kind_check.)
alter table acts add constraint acts_check1 check (kind in ('post', 'tally', 'reveal', 'unmask', 'move', 'update', 'announce', 'describe') or target_act_id is not null
  or (kind = 'card' and payload ->> 'reach' = 'board'));

alter table acts drop constraint acts_seq_check;
alter table acts add constraint acts_seq_check check ((kind = 'edit') = (seq is null) or kind in ('card', 'set', 'spring', 'card_end', 'describe'));

-- Each field named; `is true` so a missing key fails the check instead of passing as null. The move it names is its target.
alter table acts add constraint acts_describe_payload check (kind <> 'describe' or (
  payload - 'description' - 'move_act' - 'by' - 'board' = '{}'::jsonb
  and jsonb_typeof(payload -> 'description') = 'string' and char_length(payload ->> 'description') between 1 and 2000
  and jsonb_typeof(payload -> 'board') = 'string' and payload ->> 'board' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and payload -> 'by' = '"admin"'::jsonb
  and jsonb_typeof(payload -> 'move_act') in ('string', 'null')
  and (payload ->> 'move_act' is null or payload ->> 'move_act' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  and payload ->> 'move_act' is not distinct from target_act_id::text) is true);

-- boards_now asks for a board's latest describe naming one move (or none): one probe on this.
create index acts_describes on acts ((payload ->> 'board'), created_at desc, id desc) where kind = 'describe';

-- acts_take_seq (0092), with a describe among the kinds that take no place in their thread; everything else as 0092 wrote it.
create or replace function acts_take_seq() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind in ('edit', 'card', 'set', 'spring', 'card_end', 'describe') then
    new.seq := null;
  else
    -- On the right of an assignment a column is its old value: a post that takes a seq above 1 is a reply.
    update threads set next_seq = next_seq + 1, last_at = greatest(last_at, new.created_at),
                       replies = replies + case when new.kind = 'post' and next_seq > 1 then 1 else 0 end
     where id = new.thread returning next_seq - 1 into new.seq;
  end if;
  return new;
end $$;

-- A describe is written only through write_describe, for a board that is there, and when it names a move, a renameBoard move of that board
-- still in force (one naming an ended rename would never show).
create function acts_describe_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind = 'describe' then
    if coalesce(current_setting('kayfabb.describe_writer', true), '') <> 'on' then
      raise exception 'a board is described only through describe_board' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    if not exists (select 1 from boards b where b.id::text = new.payload ->> 'board') then
      raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002';
    end if;
    if new.target_act_id is not null and not exists (
         select 1 from acts m join open_moves o on o.move_act = m.id
         where m.id = new.target_act_id and m.kind = 'move' and m.payload ->> 'kind' = 'renameBoard'
           and lower(m.payload #>> '{params,board}') = new.payload ->> 'board') then
      raise exception 'a describe names a rename of its own board that is still in force' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke execute on function acts_describe_guard() from public, anon, authenticated;
create trigger acts_describe_guard before insert on acts for each row execute function acts_describe_guard();

-- ------------------------------------------------------------------------------------ queued_moves ----

alter table queued_moves add column admin_description text check (admin_description is null or char_length(admin_description) between 1 and 2000);
alter table queued_moves add column described_by uuid references accounts (id);
alter table queued_moves add column described_at timestamptz;
alter table queued_moves add constraint queued_moves_described check ((admin_description is null) = (described_by is null) and (admin_description is null) = (described_at is null));

-- queued_moves_guard (0082), with the three description columns changing only on a waiting row. Everything else as 0082 wrote it.
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
         or not (new.params ->> 'boss' = any (boss_roster())) then
        raise exception 'a nomination names a persona on the Boss roster, not a benched or retired one' using errcode = '23514';
      end if;
      if new.params ->> 'boss' = new.staff then raise exception 'a Boss does not name itself' using errcode = '23514'; end if;
    end if;
    if new.admin_description is not null then raise exception 'a queued move is queued without an admin''s replacement' using errcode = '23514'; end if;
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
    -- An admin's replacement of a description is for a rename still waiting, and never leaves the row afterward.
    if (new.admin_description, new.described_by, new.described_at) is distinct from (old.admin_description, old.described_by, old.described_at)
       and (old.kind <> 'renameBoard' or old.landed_act is not null or old.held_at is not null or new.admin_description is null) then
      raise exception 'only a rename that is still waiting takes an admin''s description' using errcode = '23514';
    end if;
    if (old.held_at is not null and (new.held_at, new.held_by) is distinct from (old.held_at, old.held_by))
       or (old.landed_act is not null and new.landed_act is distinct from old.landed_act) then
      raise exception 'a queued move that is held or landed stays so' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- ------------------------------------------------------------------------------------ the writers ----

-- The one place a describe Act is written (who wrote it is on the queue row for a queued one, and nowhere public). The thread is the rename's, or the announcements thread; created_at is the clock's, not the
-- transaction's, so a describe written beside the move it replaces the words of is strictly after it. Not callable by a client.
create function write_describe(board uuid, description text, move_act uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  in_thread uuid;
  written uuid;
begin
  if move_act is not null then
    in_thread := (select m.thread from acts m where m.id = move_act and m.kind = 'move');
  else
    in_thread := (select (s.value #>> '{}')::uuid from settings s where s.key = 'systemAnnouncements');
  end if;
  if in_thread is null then raise exception 'there is no announcements thread yet' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  perform set_config('kayfabb.describe_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload, created_at)
  values (null, 'describe', in_thread, move_act,
    jsonb_build_object('description', description, 'move_act', move_act, 'by', 'admin', 'board', board), clock_timestamp()) returning id into written;
  perform set_config('kayfabb.describe_writer', '', true);
  return written;
end $$;
revoke execute on function write_describe(uuid, text, uuid) from public, anon, authenticated;
grant execute on function write_describe(uuid, text, uuid) to service_role;

-- The words of a description, or the refusal naming what is wrong with them.
create function description_problem(words text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when words is null or words ~ '^\s*$' then 'a description needs words'
              when char_length(words) > 2000 then 'a description is at most 2000 characters' end
$$;
revoke execute on function description_problem(text) from public, anon, authenticated;

-- An admin replaces the description a waiting rename will land with. The Boss's words stay on the row.
create function replace_queued_description(id bigint, description text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q queued_moves%rowtype;
begin
  perform only_admins('replaces a description');
  select * into q from queued_moves where queued_moves.id = replace_queued_description.id for update;
  if not found then raise exception 'there is no such queued move' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if q.kind <> 'renameBoard' then raise exception 'that move renames no board' using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  if q.landed_act is not null then raise exception 'that rename has already landed; describe the board instead' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  if q.held_at is not null then raise exception 'that rename is held' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  if description_problem(description) is not null then raise exception '%', description_problem(description) using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  update queued_moves set admin_description = description, described_by = auth.uid(), described_at = clock_timestamp() where queued_moves.id = replace_queued_description.id;
  return jsonb_build_object('id', q.id, 'description', description);
end $$;
revoke execute on function replace_queued_description(bigint, text) from public, anon;
grant execute on function replace_queued_description(bigint, text) to authenticated;

-- An admin replaces a board's description at any time. It names the board's open rename, if there is one, so it ends with that rename.
create function describe_board(board uuid, description text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  now_move uuid;
  written uuid;
begin
  perform only_admins('describes a board');
  if not exists (select 1 from boards b where b.id = describe_board.board) then raise exception 'there is no such board' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if description_problem(description) is not null then raise exception '%', description_problem(description) using hint = 'kayfabb.refusal', errcode = '22023'; end if;
  -- The open rename is read again under end_move's own lock on it, so a tick that ends it between the read and the write is waited for,
  -- and the describe names the rename still in force at the moment it is written (or none).
  loop
    now_move := (select b.move_act from boards_now b where b.id = describe_board.board);
    exit when now_move is null;
    perform pg_advisory_xact_lock(hashtext('kayfabb.end_move'), hashtext(now_move::text));
    exit when exists (select 1 from open_moves o where o.move_act = now_move);
  end loop;
  written := write_describe(describe_board.board, description, now_move);
  return jsonb_build_object('act', written, 'board', describe_board.board, 'description', description, 'move_act', now_move);
end $$;
revoke execute on function describe_board(uuid, text) from public, anon;
grant execute on function describe_board(uuid, text) to authenticated;

-- ------------------------------------------------------------------------------------ boards_now ----

-- boards_now (0046), the description computed from the describes. Same columns, same moves-in-force step; a board's latest describe naming
-- its open rename (or, with none open, naming no move) is one probe of acts_describes per board.
create or replace view boards_now as
  with live as materialized (
    select a.id as move_act, a.created_at, a.payload #>> '{params,board}' as board, a.payload #>> '{params,name}' as name,
           a.payload #>> '{params,premise}' as premise, a.payload #>> '{params,description}' as description
    from open_moves o
    cross join lateral (select x.id, x.created_at, x.payload from acts x where x.id = o.move_act offset 0) a
    where a.payload ->> 'kind' = 'renameBoard'
  )
  select b.id, b.slug, coalesce(m.name, b.name) as name, coalesce(m.premise, b.description) as premise,
         coalesce(d.description, m.description, b.description) as description, b.is_system, b.created_at, m.move_act
  from boards b
  left join lateral (
    select l.move_act, l.name, l.premise, l.description from live l
    where lower(l.board) = b.id::text
    order by l.created_at desc, l.move_act desc
    limit 1
  ) m on true
  left join lateral (
    select x.payload ->> 'description' as description from acts x
    where x.kind = 'describe' and x.payload ->> 'board' = b.id::text and x.payload ->> 'move_act' is not distinct from m.move_act::text
    order by x.created_at desc, x.id desc
    limit 1
  ) d on true;

-- ------------------------------------------------------------------------------------ system_tick ----

-- system_tick (0053), landing a rename that carries an admin's description with its describe Act, in the same subtransaction as the move.
-- Everything else as 0053 wrote it.
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
  counted jsonb;
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
      select q.id, q.staff, q.kind, q.params, q.demand, q.expires_at, q.admin_description from queued_moves q where q.landed_act is null and q.held_at is null and q.go_live_at <= now() order by q.go_live_at, q.id for update skip locked
    loop
      begin
        written := (write_staff_act(due.staff, 'move', ann, null,
          jsonb_build_object('kind', due.kind, 'params', due.params, 'body', system_line('moveLanded', due.kind, due.params, due.staff))
          || case when due.demand is not null then jsonb_build_object('demand', due.demand) else '{}'::jsonb end
          || case when due.expires_at is not null then jsonb_build_object('expires_at', due.expires_at) else '{}'::jsonb end) ->> 'id')::uuid;
        update queued_moves set landed_act = written where id = due.id;
        if due.kind = 'renameBoard' and due.admin_description is not null then
          perform write_describe((due.params ->> 'board')::uuid, due.admin_description, written);
        end if;
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
  -- rest instead of holding the front of the line; the count it read is stored beside it (`open_moves.progress`, 0053).
  for inforce in
    select o.move_act, a.thread, a.payload from open_moves o join acts a on a.id = o.move_act where jsonb_typeof(a.payload -> 'demand') = 'object' and (o.checked_at is null or o.checked_at <= now() - check_every) order by o.checked_at nulls first, o.move_act limit cap
  loop
    if clock_timestamp() > budget_ends then out_of_time := true; exit; end if;
    update open_moves set checked_at = now() where move_act = inforce.move_act;
    checked := checked + 1;
    did_end := false;
    counted := null;
    begin
      counted := demand_progress_or_error(inforce.move_act);
      if coalesce((counted ->> 'met')::boolean, false) then
        did_end := (end_move(inforce.move_act, 'met', 'demand') ->> 'ended')::boolean;
        if did_end then met := met + 1; end if;
      end if;
    exception when others then
      failed := failed + 1;
      did_end := false;
      raise warning 'system_tick: move % did not end: % (%)', inforce.move_act, sqlerrm, sqlstate;
    end;
    -- What it read is kept on the move's row (a move just ended has no row left, and the update finds none), outside the block above so
    -- that a failure in ending the move does not take the count with it. The board and the admin queue read this, not the evaluator.
    if counted is not null then update open_moves set progress = counted where move_act = inforce.move_act; end if;
    -- The Boss says it. The move is ended whether or not the line is posted.
    if did_end then perform say_move_end(inforce.move_act, 'met'); end if;
  end loop;

  return jsonb_build_object('landed', landed, 'met', met, 'expired', expired, 'superseded', superseded, 'failed', failed, 'checked', checked, 'budget', out_of_time,
    'noThread', enabled and ann is null);
end $$;

-- admin_queue (0092), a waiting row also carrying `adminDescription`: the words an admin has put in the place of the Boss's description,
-- or null. Everything else as 0092 wrote it.
create or replace function admin_queue() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  cap constant integer := 100;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  win constant timestamptz := now() - interval '30 days';
  waiting jsonb; waiting_more boolean;
  in_force jsonb; in_force_more boolean;
  staff_cards jsonb; staff_cards_more boolean;
  ended jsonb; ended_more boolean;
  roster jsonb;
  todos jsonb;
  latest_update timestamptz;
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
             'adminDescription', q.admin_description,
             'boardName', case when q.kind = 'renameBoard' and lower(q.params ->> 'board') ~ uuid_re
                               then (select b.name from boards_now b where b.id = (q.params ->> 'board')::uuid) end) as j
    from queued_moves q where q.landed_act is null and q.held_at is null
    order by q.go_live_at, q.id limit cap + 1
  ) x;

  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into in_force, in_force_more from (
    select row_number() over (order by a.created_at desc, a.id) as n,
           jsonb_build_object('act', a.id, 'id', q.id, 'staff', c.staff, 'boss', c.name, 'kind', a.payload ->> 'kind', 'params', a.payload -> 'params',
             'demand', a.payload -> 'demand', 'why', q.why, 'landedAt', a.created_at, 'expiresAt', a.payload -> 'expires_at',
             'progress', case when o.progress is null then jsonb_build_object('checkedAt', null)
                              else o.progress || jsonb_build_object('checkedAt', o.checked_at) end) as j
    from open_moves o
    join acts a on a.id = o.move_act
    left join characters c on c.id = a.character
    left join queued_moves q on q.landed_act = a.id
    order by a.created_at desc, a.id limit cap + 1
  ) x;

  -- The Mod Bots' cards (Task 7): the face-up plays of staff characters in the last 30 days that are still in force: not caught, not worn
  -- off (by the play's own end or its reach's), not ended by an admin. A Set is a `set` Act, never a `card`, so a face-down card is not
  -- here until it springs; its strike is a `card` Act and is. Per staff character a probe of acts_card_plays (character, created_at desc)
  -- reads only that character's plays in the window, newest first and cut at cap + 1 inside the probe, so the cost is the staff roster
  -- times cap and never the history of Acts or the players' plays. The names are public ones (the card's, the persona's, the post
  -- author's or the target the play named); nothing private is read.
  select coalesce(jsonb_agg(x.j order by x.n) filter (where x.n <= cap), '[]'::jsonb), coalesce(bool_or(x.n > cap), false) into staff_cards, staff_cards_more from (
    select row_number() over (order by k.created_at desc, k.id) as n,
           jsonb_build_object('play', k.id, 'card', k.payload ->> 'card', 'cardName', (select ck.name from card_kinds ck where ck.key = k.payload ->> 'card'),
             'staff', c.staff, 'persona', c.name,
             'targetName', coalesce(k.payload ->> 'targetName', (select tc.name from acts pa join characters tc on tc.id = pa.character where pa.id = k.target_act_id)),
             'thread', k.thread, 'threadTitle', (select th.title from threads th where th.id = k.thread), 'at', k.created_at) as j
    from characters c
    cross join lateral (
      select p.* from acts p
      where p.character = c.id and p.kind = 'card' and p.created_at >= win
        and not (p.payload ? 'caught')
        and (p.payload ->> 'ends' is null or (p.payload ->> 'ends')::timestamptz > now())
        and not exists (select 1 from play_reach r where r.play = p.id and r.ends_at <= now())
        and not exists (select 1 from acts e where e.kind = 'card_end' and e.target_act_id = p.id)
      order by p.created_at desc, p.id desc limit cap + 1
    ) k
    where c.staff is not null
    order by k.created_at desc, k.id limit cap + 1
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
      (select e.created_at, e.id::text,
              jsonb_build_object('how', 'reversed', 'by', 'admin', 'at', e.created_at, 'act', p.id, 'id', null, 'staff', c.staff, 'boss', c.name,
                'kind', 'card', 'params', '{}'::jsonb, 'demand', null, 'why', null, 'landedAt', p.created_at,
                'card', coalesce((select ck.name from card_kinds ck where ck.key = p.payload ->> 'card'), p.payload ->> 'card'))
       from acts e
       join acts p on p.id = e.target_act_id
       left join characters c on c.id = p.character
       where e.kind = 'card_end' and e.created_at >= win
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

  -- The to-dos (the staff roster design, section 11): each handover that changed the Boss, until an update is posted after it landed or an
  -- admin dismisses it. "An update after it" is one read of the newest update (the acts_updates index, 0062) against each handover's instant.
  latest_update := (select a.created_at from acts a where a.kind = 'update' order by a.created_at desc, a.id desc limit 1);
  select coalesce(jsonb_agg(jsonb_build_object(
           'season', t.number, 'boss', t.boss, 'bossName', bc.name,
           'bossWas', (select o.office from staff_offices o where o.staff = t.boss and o.at <= t.landed_at order by o.id desc limit 1),
           'outgoing', t.outgoing, 'outgoingName', oc.name, 'outgoingOffice', (select n.office from staff_office_now n where n.staff = t.outgoing),
           'how', h.how, 'landedAt', t.landed_at) order by t.landed_at desc, t.number desc), '[]'::jsonb) into todos
  from season_boss_changes t
  join season_handovers h on h.season = t.season
  join characters bc on bc.staff = t.boss
  left join characters oc on oc.staff = t.outgoing
  where (latest_update is null or latest_update <= t.landed_at)
    and not exists (select 1 from handover_dismissals d where d.season = t.season);

  return jsonb_build_object('cap', cap, 'waiting', waiting, 'inForce', in_force, 'staffCards', staff_cards, 'ended', ended, 'roster', roster, 'todos', todos,
    'more', jsonb_build_object('waiting', waiting_more, 'inForce', in_force_more, 'staffCards', staff_cards_more, 'ended', ended_more));
end $$;
