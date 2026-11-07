-- Appealing a group punishment (docs/plans/2026-11-06-member-groups-plan.md, Task 14, as amended 2026-11-07; the design is docs/plans/2026-11-06-member-groups-design.md).
--
-- A group move whose group is a punishment (group_kinds.tone = 'punishment') is appealed as an infraction and a ban are (0109): the punished character pays appealPrice, the
-- move's own staff character (the Boss or the Mod that made it) hears it, and the ruling is a public `appeal_ruling` Act. Nothing is written into the move: its expiry is read
-- through the ruling, as banned_until reads a ban's. open_moves gains no column.
--
--   move_expires_at(move)   when a move ends by itself: the latest ruling's `until` on an appeal of it, else the move's own expires_at (null: it has none). The tick's expiry pass,
--                           bars_now, barred/not_barred, apologize and the log (moves_log, below) all read it.
--   acts_appeal_guard       an appeal may also target a landed conferGroup move whose group is a punishment, of the appealing character (params.character), in the move's thread.
--   punishment_running      a move is running while it is in force (open_moves) and its end, as move_expires_at reads it, has not come.
--   appeal_hearer           a move is heard by its staff character while that one is on staff; else by the Boss.
--   open_appeal             also takes such a move. The answer names the move (kind 'move'), the group by name, the board it bars (details.bars), its length in days, its end,
--                           who made it, and whether an apology ends it; no post (a move is not about one).
--   close_appeal(appeal, verdict, line, staff, most_days)   gains `most_days`, the phase's moveExpiryMostDays as the Edge Function computes it from the season and the Boss
--                           (null: the instance's own moveExpiryMostDays setting alone, which must exist; the smaller of the two applies, as the Boss's meeting reads them). On a move:
--                             overturned  the move ends at once, why `overturned`, by `appeal`; the fee is refunded; a line says so (say_move_end);
--                             upheld      nothing changes;
--                             reduced     it ends at its landing plus half its length (the ruling's `until`); if that has passed, the move ends then, why `expired`, by `appeal`;
--                             increased   half its length more, never past most_days from landing (the ruling's `until`).
--                           A move with no end of its own has no length: reduced and increased are written as `upheld` (its stock line, not the model's, which spoke of another
--                           verdict). The move's lock (end_move's) is taken first, so a ruling and the tick or an apology end a move once, whichever comes first; a move that has
--                           ended while the appeal waited is refunded as run out, like a ban that ran out.
--   end_move                an `expired` end is refused (ended false) while a ruling's `until` is still ahead: a tick that read the old expiry before the ruling committed
--                           must not end a move the ruling extended. Any other end is as before.
--   moves_log               the move's expires_at read through move_expires_at, and the log row of an appeal's ruling on a move names its group (params.group) and its new end
--                           (params.until).
--
-- Masks. A move, its appeal and its ruling are public Acts; the answer names the appellant's public name, and the fee is found in the wallet event as for any appeal.
-- Ways out. This adds one: a group punishment can be appealed. Append-only: the ruling is an Act of its own; the move's Act is never changed.
-- Not changed: the acts.kind list, the appeal_ruling payload check (points_delta is 0 for a move), acts_take_seq, appeal_blocks (one appeal per target, generic), appeal_line,
-- refund_appeal, refund_stale_appeals, judgment_load_today and staff_punishments (0120 already leaves out a move that ended `overturned`, which is how an overturned appeal ends one).

-- ---------------------------------------------------------------------------------------------------- the expiry ----

create or replace function move_expires_at(in_move uuid) returns timestamptz
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select (r.payload ->> 'until')::timestamptz from acts a join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
     where a.kind = 'appeal' and a.target_act_id = m.id and r.payload ? 'until' order by r.created_at desc, r.id desc limit 1),
    (m.payload ->> 'expires_at')::timestamptz)
  from acts m where m.id = in_move and m.kind = 'move'
$$;

-- end_move (0120), an `expired` end refused while an appeal's ruling has put the end ahead. Everything else as 0120 wrote it.
create or replace function end_move(move_act uuid, why text, by text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m acts%rowtype;
  existing uuid;
  written uuid;
begin
  if why is null or why not in ('met', 'expired', 'reversed', 'superseded', 'spent', 'unmet', 'overturned') then raise exception 'a move ends as met, expired, reversed, superseded, spent, unmet or overturned, not %', coalesce(why, 'nothing') using errcode = '22023'; end if;
  if by is null or char_length(by) not between 1 and 40 then raise exception 'a move''s end says who ended it' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('kayfabb.end_move'), hashtext(move_act::text));
  select * into m from acts where id = move_act and kind = 'move';
  if not found then raise exception 'there is no such move' using errcode = 'P0002'; end if;
  select e.id into existing from acts e where e.kind = 'move_end' and e.target_act_id = move_act;
  if existing is not null then return jsonb_build_object('act', existing, 'ended', false); end if;
  -- A tick that read the old expiry before a ruling moved it is too late: the ruling is a fact of the lock's holder, read here under the lock.
  if why = 'expired' and exists (select 1 from acts a join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
                                 where a.kind = 'appeal' and a.target_act_id = move_act and (r.payload ->> 'until')::timestamptz > now()) then
    return jsonb_build_object('act', null, 'ended', false, 'extended', true);
  end if;
  perform set_config('kayfabb.move_end_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (null, 'move_end', m.thread, move_act, jsonb_build_object('why', why, 'by', by)) returning id into written;
  perform set_config('kayfabb.move_end_writer', '', true);
  return jsonb_build_object('act', written, 'ended', true);
end $$;

-- ------------------------------------------------------------------------------------------------------ the guard ----

-- acts_appeal_guard (0109), also an appeal of a group punishment move. Everything else as 0109 wrote it.
create or replace function acts_appeal_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t acts%rowtype;
  ok boolean;
begin
  select * into t from acts where id = new.target_act_id;
  if new.kind = 'appeal' then
    if coalesce(current_setting('kayfabb.appeal_writer', true), '') <> 'on' then
      raise exception 'an appeal is made only through open_appeal' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    if new.character is null or exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
      raise exception 'an appeal is a player''s character''s Act' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    ok := t.thread is not distinct from new.thread and case t.kind
      when 'move' then t.payload ->> 'kind' = 'conferGroup' and lower(t.payload #>> '{params,character}') = new.character::text
                       and exists (select 1 from group_kinds g where g.key = t.payload #>> '{params,group}' and g.tone = 'punishment')
      when 'infraction' then t.payload ->> 'character' is not distinct from new.character::text
      when 'ban' then t.payload ->> 'character' is not distinct from new.character::text
      else false end;
    if ok is not true then
      raise exception 'an appeal is of a punishment of its own character''s, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
  else
    if new.character is null or not exists (select 1 from characters c where c.id = new.character and c.staff is not null) then
      raise exception 'an appeal_ruling is a staff character''s Act' using hint = 'kayfabb.refusal', errcode = '42501';
    end if;
    if t.kind is distinct from 'appeal' or t.thread <> new.thread or new.payload ->> 'appeal_act' <> t.id::text then
      raise exception 'an appeal_ruling is of an appeal, in its thread' using hint = 'kayfabb.refusal', errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- --------------------------------------------------------------------------------------------------- the helpers ----

-- punishment_running (0109), also a move: in force, and its end (read through its ruling) not yet come.
create or replace function punishment_running(punishment uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case p.kind
      when 'infraction' then (p.payload ->> 'expires_at')::timestamptz > now()
        and p.created_at > coalesce((select max(b.created_at) from acts b where b.kind = 'ban' and b.payload ->> 'character' = p.payload ->> 'character'), '-infinity'::timestamptz)
      when 'move' then exists (select 1 from open_moves o where o.move_act = p.id) and coalesce(move_expires_at(p.id) > now(), true)
      else coalesce((select (r.payload ->> 'until')::timestamptz from acts a join acts r on r.kind = 'appeal_ruling' and r.target_act_id = a.id
                     where a.kind = 'appeal' and a.target_act_id = p.id and r.payload ? 'until' limit 1),
                    (p.payload ->> 'until')::timestamptz) > now()
    end
    from acts p where p.id = punishment_running.punishment and p.kind in ('infraction', 'ban', 'move')), false)
$$;

-- appeal_hearer (0109), also a move: its staff character while that one is on staff, else the season's Boss.
create or replace function appeal_hearer(punishment uuid) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  p acts%rowtype;
  board uuid;
  maker text;
begin
  select * into p from acts a where a.id = appeal_hearer.punishment and a.kind in ('infraction', 'ban', 'move');
  if not found then return null; end if;
  if p.kind = 'move' then
    select c.staff into maker from characters c where c.id = p.character;
    if maker is not null and exists (select 1 from staff_now n where n.staff = maker) then return maker; end if;
    return current_boss();
  end if;
  select t.board into board from threads t where t.id = p.thread;
  if p.kind = 'ban' then
    return coalesce(current_boss(), beat_of(board));
  end if;
  if exists (select 1 from staff_now n where n.staff = p.payload ->> 'staff') then return p.payload ->> 'staff'; end if;
  return coalesce(beat_of(board), current_boss());
end $$;

-- ------------------------------------------------------------------------------------------------------ open_appeal ----

-- open_appeal (0109), also a group punishment move. Everything else as 0109 wrote it.
create or replace function open_appeal(through uuid, punishment_act uuid, plea text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  caller uuid;
  pun acts%rowtype;
  bots jsonb := coalesce((select s.value from settings s where s.key = 'modBots'), '{}'::jsonb);
  price integer := coalesce((bots ->> 'appealPrice')::integer, 50);
  budget integer := coalesce((bots ->> 'judgmentsPerDay')::integer, 60);
  said text := btrim(coalesce(plea, ''));
  hearer text;
  aid uuid;
  board record;
  me text;
  inf acts%rowtype;
  details jsonb;
  bars uuid;
  bars_name text;
  own_end timestamptz;
begin
  caller := acting(through);
  if regexp_replace(said, '[\s ​-‍⁠　﻿]', '', 'g') = '' then
    raise exception 'say why this punishment should change' using hint = 'kayfabb.refusal', errcode = '22023';
  end if;
  if char_length(said) > 1000 then
    raise exception 'a plea is at most 1000 characters' using hint = 'kayfabb.refusal', errcode = '22001';
  end if;
  if not coalesce((select s.value = 'true'::jsonb from settings s where s.key = 'systemEnabled'), false) then
    raise exception 'there is no one on duty to hear an appeal right now' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  -- An infraction or a ban of THIS character, or a group move that punishes it: the same words for one that is another's, a favor, and one that is none.
  select * into pun from acts a where a.id = open_appeal.punishment_act and (
    (a.kind in ('infraction', 'ban') and a.payload ->> 'character' = open_appeal.through::text)
    or (a.kind = 'move' and a.payload ->> 'kind' = 'conferGroup' and lower(a.payload #>> '{params,character}') = open_appeal.through::text
        and exists (select 1 from group_kinds g where g.key = a.payload #>> '{params,group}' and g.tone = 'punishment')));
  if not found then raise exception 'that is not a punishment of this character' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  if not punishment_running(pun.id) then raise exception 'that punishment has already run out' using hint = 'kayfabb.refusal', errcode = '55000'; end if;
  hearer := appeal_hearer(pun.id);
  if hearer is null then raise exception 'there is no one on duty to hear an appeal right now' using hint = 'kayfabb.refusal', errcode = '55000'; end if;

  -- One decision per punishment, then the instance's budget (the reports' lock: the two share one count).
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.appeal.for.' || pun.id::text, 0));
  if appeal_blocks(pun.id) then
    raise exception 'this punishment has already been appealed; each punishment is appealed once' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.reports', 0));
  if judgment_load_today() >= budget then
    raise exception 'the Mods have heard all the appeals they will today; appeals open again after midnight UTC' using hint = 'kayfabb.refusal', errcode = '55000';
  end if;

  perform set_config('kayfabb.appeal_writer', 'on', true);
  insert into acts (character, kind, thread, target_act_id, payload)
  values (through, 'appeal', pun.thread, pun.id, jsonb_build_object('plea', said)) returning id into aid;
  perform set_config('kayfabb.appeal_writer', '', true);
  perform wallet_spend(caller, price, 'appeal', aid);

  select c.name into me from characters c where c.id = through;
  if pun.kind = 'move' then
    -- The board the judgment reads is the one the move bars, if it bars one; else the board of the thread the move was announced in.
    bars := case when lower(pun.payload #>> '{params,board}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then lower(pun.payload #>> '{params,board}')::uuid end;
    select b.name into bars_name from boards_now b where b.id = bars;
    select b.id, b.name, b.premise into board from boards_now b where b.id = coalesce(bars, (select t.board from threads t where t.id = pun.thread));
    own_end := (pun.payload ->> 'expires_at')::timestamptz;
    details := jsonb_build_object('kind', 'move', 'filed_at', pun.created_at, 'filed_by', (select c.staff from characters c where c.id = pun.character),
      'group', coalesce((select g.name from group_kinds g where g.key = pun.payload #>> '{params,group}'), pun.payload #>> '{params,group}'),
      'group_key', pun.payload #>> '{params,group}', 'bars', bars_name, 'until', own_end,
      'days', case when own_end is null then null else round(extract(epoch from own_end - pun.created_at) / 86400.0, 2) end,
      'apology', pun.payload #>> '{demand,kind}' = 'apologyAccepted');
    return jsonb_build_object('appeal', aid, 'punishment', pun.id, 'post', null, 'thread', pun.thread, 'staff', hearer, 'price', price, 'plea', said,
      'kind', 'move', 'details', details,
      'board', jsonb_build_object('id', board.id, 'name', board.name, 'premise', board.premise),
      'appellant', jsonb_build_object('id', through, 'name', me));
  end if;

  select b.id, b.name, b.premise into board from threads t join boards_now b on b.id = t.board where t.id = pun.thread;
  if pun.kind = 'ban' then select * into inf from acts i where i.id = (pun.payload ->> 'infraction_act')::uuid; else inf := pun; end if;
  details := jsonb_build_object('kind', pun.kind, 'filed_at', pun.created_at, 'band', inf.payload ->> 'band', 'points', (inf.payload ->> 'points')::integer,
    'rule', punishment_words(inf.id), 'filed_by', inf.payload ->> 'staff')
    || case when pun.kind = 'ban' then jsonb_build_object('days', (pun.payload ->> 'days')::integer, 'until', pun.payload ->> 'until') else '{}'::jsonb end;
  return jsonb_build_object('appeal', aid, 'punishment', pun.id, 'post', inf.payload ->> 'about_act', 'thread', pun.thread, 'staff', hearer, 'price', price, 'plea', said,
    'kind', pun.kind, 'details', details,
    'board', jsonb_build_object('id', board.id, 'name', board.name, 'premise', board.premise),
    'appellant', jsonb_build_object('id', through, 'name', me));
end $$;
revoke execute on function open_appeal(uuid, uuid, text) from public, anon;
grant execute on function open_appeal(uuid, uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------------------------------- close_appeal ----

-- close_appeal (0109) with the phase's most days, and a group move. The signature changes, so the old one goes.
drop function close_appeal(uuid, text, text, text);
create function close_appeal(appeal_act uuid, verdict text, line text default null, staff text default null, most_days integer default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ap acts%rowtype;
  pun acts%rowtype;
  ruling acts%rowtype;
  mod_key text;
  who uuid;
  appellant text;
  said text := left(btrim(coalesce(close_appeal.line, '')), 280);
  v text := close_appeal.verdict;
  pts integer;
  delta integer := 0;
  payload jsonb;
  hit jsonb;
  new_until timestamptz;
  days integer;
  paid record;
  amount integer := 0;
  written uuid;
  key text;
  own_end timestamptz;
  length interval;
  most_all numeric;
  most numeric;
  ended boolean := false;
begin
  select * into ap from acts a where a.id = close_appeal.appeal_act and a.kind = 'appeal';
  if not found then raise exception 'there is no such appeal' using hint = 'kayfabb.refusal', errcode = 'P0002'; end if;
  -- The appeal's own lock: closing and refunding it are one decision, so it is closed once, or refunded once, never both.
  perform pg_advisory_xact_lock(hashtextextended('kayfabb.appeal.' || ap.id::text, 0));
  select * into ruling from acts a where a.kind = 'appeal_ruling' and a.target_act_id = ap.id;
  if found then
    -- The ruling's own numbers, so a retry after a lost answer reports the true outcome.
    return jsonb_build_object('closed', false, 'existing', true, 'ruling_act', ruling.id, 'verdict', ruling.payload ->> 'verdict', 'line', ruling.payload ->> 'line',
      'points_delta', (ruling.payload ->> 'points_delta')::integer,
      'refunded_amount', coalesce((select f.amount from appeal_refunds f where f.appeal_act = ap.id and f.why = 'overturned'), 0))
      || case when ruling.payload ? 'until' then jsonb_build_object('until', ruling.payload ->> 'until') else '{}'::jsonb end;
  end if;
  if exists (select 1 from appeal_refunds f where f.appeal_act = ap.id) then
    return jsonb_build_object('closed', false, 'refunded', true);
  end if;
  if v is null or v not in ('overturned', 'upheld', 'reduced', 'increased') then
    raise exception 'an appeal is answered with overturned, upheld, reduced or increased, not %', coalesce(v, 'nothing') using errcode = '22023';
  end if;
  select * into pun from acts a where a.id = ap.target_act_id;
  -- A move ends under its own lock (end_move's): the ruling, the tick and an apology's end are then one after another, and a move one of them ended is seen as ended here.
  if pun.kind = 'move' then perform pg_advisory_xact_lock(hashtext('kayfabb.end_move'), hashtext(pun.id::text)); end if;
  -- The punishment ran out while the appeal waited: nothing is left to rule on, and an increase must not revive it. No ruling; the price comes back (the appeal stays used).
  if not punishment_running(pun.id) then
    perform refund_appeal(ap.id, 'expired');
    return jsonb_build_object('closed', false, 'refunded', true, 'expired', true, 'reason', 'that punishment had already run out before the appeal was heard, so nothing was ruled and your Aura is back');
  end if;
  mod_key := appeal_hearer(pun.id);
  if mod_key is null then raise exception 'no one is on staff to hear an appeal' using errcode = '55000'; end if;
  if close_appeal.staff is not null and close_appeal.staff <> mod_key then
    raise exception 'this appeal is heard by someone else now' using errcode = '55000';
  end if;
  who := ap.character;
  appellant := (select c.name from characters c where c.id = who);

  if pun.kind = 'move' then
    own_end := (pun.payload ->> 'expires_at')::timestamptz;
    -- A move that ends only by an apology or an admin has no length to halve or add to: the model's other verdicts are written as upheld, in the stock line.
    if own_end is null and v in ('reduced', 'increased') then v := 'upheld'; said := ''; end if;
  end if;
  payload := jsonb_build_object('appeal_act', ap.id, 'verdict', v);

  if pun.kind = 'infraction' then
    pts := (pun.payload ->> 'points')::integer;
    if v = 'overturned' then delta := -pts;
    elsif v = 'reduced' then delta := -least(pts, greatest(1, (pts + 1) / 2));
    elsif v = 'increased' then
      -- One more infraction of the same band for the same post: at most one band's points, and a full bar bans.
      hit := infract(who, pun.payload ->> 'band', (pun.payload ->> 'about_act')::uuid, mod_key, nullif(pun.payload ->> 'rule_number', '')::integer, nullif(pun.payload ->> 'visit_act', '')::uuid);
      delta := (hit ->> 'points')::integer;
      payload := payload || jsonb_build_object('infraction_act', hit ->> 'infraction');
    end if;
  elsif pun.kind = 'move' then
    -- Its length is from its landing to its own end. A reduction ends it at landing plus half the length (the end may be behind us); an increase adds half the length, but
    -- never past the phase's most days from landing (the smaller of the phase's number and the instance's own).
    length := own_end - pun.created_at;
    if v = 'overturned' then new_until := now();
    elsif v = 'reduced' then new_until := pun.created_at + length / 2;
    elsif v = 'increased' then
      -- The instance's setting is the outer limit (setting() raises where it is missing); the phase's number, where the call has one, can only lower it.
      most_all := (setting('moveExpiryMostDays') #>> '{}')::numeric;
      most := greatest(1, least(coalesce(close_appeal.most_days, most_all), most_all));
      new_until := own_end + least(length / 2, greatest(interval '0', most * interval '1 day' - length));
    end if;
    if new_until is not null then payload := payload || jsonb_build_object('until', new_until); end if;
  else
    -- A ban: its length is its days; a reduction counts half of them from the ban's start, an increase runs half of them past its end.
    days := (pun.payload ->> 'days')::integer;
    if v = 'overturned' then new_until := now();
    elsif v = 'reduced' then new_until := pun.created_at + days * interval '12 hours';
    elsif v = 'increased' then new_until := (pun.payload ->> 'until')::timestamptz + days * interval '12 hours';
    end if;
    if new_until is not null then payload := payload || jsonb_build_object('until', new_until); end if;
  end if;

  key := 'appeal' || initcap(v);
  said := coalesce(nullif(said, ''), appeal_line(key, mod_key, appellant));
  payload := payload || jsonb_build_object('points_delta', delta, 'line', said);
  written := (write_staff_act(mod_key, 'appeal_ruling', ap.thread, ap.id, payload) ->> 'id')::uuid;

  -- A move's effect: overturned ends it at once; a reduction that has already run its course ends it now. Each is end_move's, so a move something else just ended is not ended twice.
  if pun.kind = 'move' then
    if v = 'overturned' then
      ended := (end_move(pun.id, 'overturned', 'appeal') ->> 'ended')::boolean;
      if ended then perform say_move_end(pun.id, 'overturned'); end if;
    elsif v = 'reduced' and new_until <= now() then
      ended := (end_move(pun.id, 'expired', 'appeal') ->> 'ended')::boolean;
      if ended then perform say_move_end(pun.id, 'expired'); end if;
    end if;
  end if;

  -- An overturned appeal gets its price back.
  if v = 'overturned' then
    select w.account, -w.change as price into paid from wallet_events w where w.kind = 'appeal' and w.ref = ap.id;
    amount := coalesce(paid.price, 0);
    insert into appeal_refunds (appeal_act, amount, why) values (ap.id, amount, 'overturned');
    if amount > 0 then perform wallet_move(paid.account, amount, 'refund', null, ap.id); end if;
  end if;
  return jsonb_build_object('closed', true, 'ruling_act', written, 'verdict', v, 'staff', mod_key, 'line', said, 'points_delta', delta, 'refunded_amount', amount)
    || case when new_until is not null then jsonb_build_object('until', new_until) else '{}'::jsonb end
    || case when ended then jsonb_build_object('ended', true) else '{}'::jsonb end
    || case when hit is not null then jsonb_build_object('infraction', hit ->> 'infraction', 'ban', hit -> 'ban') else '{}'::jsonb end;
end $$;
revoke execute on function close_appeal(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function close_appeal(uuid, text, text, text, integer) to service_role;

-- ------------------------------------------------------------------------------------------------------- the log ----

-- moves_log (0111), a move's expires_at read through move_expires_at, and an appeal's ruling on a group move also saying its group and its new end. Columns and every other
-- row as 0111 wrote them.
create or replace view moves_log as
  select a.id, c.staff, a.payload ->> 'kind' as kind, a.payload -> 'params' as params, a.payload -> 'demand' as demand,
         move_expires_at(a.id) as expires_at, a.thread, a.created_at as at,
         e.payload ->> 'why' as ended_why, e.payload ->> 'by' as ended_by, e.created_at as ended_at,
         k.staff as kept_by, k.at as kept_at
  from characters c
  cross join lateral (select x.* from acts x where x.character = c.id and x.kind = 'move') a
  left join acts e on e.kind = 'move_end' and e.target_act_id = a.id
  left join lateral (
    select kc.staff, ka.created_at as at from acts ka join characters kc on kc.id = ka.character
    where ka.kind = 'move_keep' and ka.target_act_id = a.id order by ka.created_at desc, ka.id desc limit 1
  ) k on true
  where c.staff is not null
  union all
  select v.id, c.staff, 'visit'::text, jsonb_build_object('post', p.seq, 'rule', v.payload #>> '{charges,0,rule}', 'rule_number', v.payload #> '{charges,0,rule_number}', 'band', v.payload #>> '{charges,0,band}', 'cause', v.payload #>> '{charges,0,cause}'),
         null::jsonb, (v.payload ->> 'ends_at')::timestamptz, v.thread, v.created_at,
         e.payload ->> 'outcome', null::text, e.created_at, null::text, null::timestamptz
  from characters c
  join acts v on v.character = c.id and v.kind = 'visit'
  join acts p on p.id = v.target_act_id
  left join acts e on e.kind = 'visit_end' and e.target_act_id = v.id
  where c.staff is not null
  union all
  select d.id, c.staff, 'report'::text, jsonb_build_object('post', p.seq, 'verdict', d.payload ->> 'verdict'),
         null::jsonb, null::timestamptz, d.thread, d.created_at,
         d.payload ->> 'verdict', null::text, d.created_at, null::text, null::timestamptz
  from characters c
  join acts d on d.character = c.id and d.kind = 'report_verdict'
  join acts r on r.id = d.target_act_id
  join acts p on p.id = r.target_act_id
  where c.staff is not null
  union all
  select u.id, c.staff, 'appeal'::text,
         jsonb_build_object('post', (select x.seq from acts x where x.id = case when pu.kind = 'infraction' then (pu.payload ->> 'about_act')::uuid else (select (i.payload ->> 'about_act')::uuid from acts i where i.id = (pu.payload ->> 'infraction_act')::uuid) end),
                            'punishment', pu.kind, 'verdict', u.payload ->> 'verdict', 'points_delta', u.payload -> 'points_delta')
           || case when pu.kind = 'move' then jsonb_build_object('group', pu.payload #>> '{params,group}', 'until', u.payload ->> 'until') else '{}'::jsonb end,
         null::jsonb, null::timestamptz, u.thread, u.created_at,
         u.payload ->> 'verdict', null::text, u.created_at, null::text, null::timestamptz
  from characters c
  join acts u on u.character = c.id and u.kind = 'appeal_ruling'
  join acts ap on ap.id = u.target_act_id
  join acts pu on pu.id = ap.target_act_id
  where c.staff is not null;
grant select on moves_log to anon, authenticated;
